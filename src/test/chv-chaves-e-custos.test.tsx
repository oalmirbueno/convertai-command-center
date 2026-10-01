// @vitest-environment jsdom
/**
 * Frente CHV (01/10/2026): Configurações › Chaves e custos.
 *
 * Prova:
 * - _shared/chaves.ts: o ambiente tem prioridade, o cofre é a reserva, o cache
 *   funciona (e vence), a falha do cofre não lança e nenhum log leva a chave;
 * - os testes de cada provedor: válida, recusada, só envio, sem saldo, rede
 *   fora; a resposta do provedor que ecoa a chave nunca chega ao resultado;
 * - o quadro: chave do servidor manda, teste de outra chave vira "Não testada";
 * - catálogo = lista do _shared = CHECK do banco;
 * - migration: RLS, nada para anon/authenticated, só a service_role executa;
 * - função: só admin, verify_jwt, nada da chave em log ou resposta;
 * - tela: linha com estado e números, janela no centro com campo de senha,
 *   "Salvar mesmo assim" quando o provedor recusa, a chave some do DOM depois,
 *   e as Configurações em largura total com o atalho do Estado dos motores.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invocar, papel } = vi.hoisted(() => ({ invocar: vi.fn(), papel: { valor: "admin" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: papel.valor }, user: { id: "u-1" } }) }));
vi.mock("@/components/agencia/DadosDaAgencia", () => ({ default: () => h("section", { "aria-label": "Dados da agência" }) }));
vi.mock("@/components/NotificationsPanel", () => ({ default: () => null }));

import { carregarChaves, chave, chaveCarregada, esquecerChaves, NOMES_DAS_CHAVES, origemDaChave, TTL_MS, TTL_VAZIO_MS } from "../../supabase/functions/_shared/chaves";
import { PROVEDORES, SEGREDOS_DO_CATALOGO, type QuadroDasChaves } from "../../supabase/functions/chaves-admin/modulos/catalogo";
import { semAChave, testarChave } from "../../supabase/functions/chaves-admin/modulos/testes";
import { montarQuadro } from "../../supabase/functions/chaves-admin/modulos/quadro";
import { montarEstado } from "../../supabase/functions/motores-estado/modulos/estado";
import { dolar, haQuanto, numerosDaLinha, textoDoUso } from "@/lib/config/chavesECustos";
import { custoSemanalCom, usoDoPapel } from "@/lib/config/custoDaSemana";
import ChavesECustos from "@/components/config/ChavesECustos";
import EstadoDosMotores from "@/components/config/EstadoDosMotores";
import SettingsPage from "@/pages/SettingsPage";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SEGREDO = "sk-or-v1-SEGREDO-DE-TESTE-0123456789abcd";
const resposta = (status: number, corpo: unknown) => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** Junta tudo o que foi para o console (para provar que a chave não vai). */
function espiarConsole() {
  const linhas: string[] = [];
  const guardar = (...a: unknown[]) => linhas.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const espioes = (["log", "warn", "error", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(guardar));
  return { linhas, soltar: () => espioes.forEach((e) => e.mockRestore()) };
}

afterEach(() => {
  esquecerChaves();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ _shared/chaves.ts

describe("_shared/chaves.ts: ambiente primeiro, cofre depois, com cache", () => {
  const base = { url: "https://projeto.supabase.co", chaveDeServico: "service-role-de-teste" };

  it("o segredo do ambiente tem prioridade e o cofre nem é chamado", async () => {
    const buscar = vi.fn();
    const v = await chave("FAL_KEY", { ...base, ambiente: (n) => (n === "FAL_KEY" ? "  do-ambiente-123  " : undefined), fetch: buscar });
    expect(v).toBe("do-ambiente-123");
    expect(buscar).not.toHaveBeenCalled();
    expect(origemDaChave("FAL_KEY", { ambiente: (n) => (n === "FAL_KEY" ? "x" : undefined) })).toBe("servidor");
  });

  it("sem ambiente, lê do cofre pela RPC com a service_role; a segunda leitura vem do cache", async () => {
    const buscar = vi.fn(async () => resposta(200, { FAL_KEY: "do-cofre-abcdef12" }));
    const o = { ...base, ambiente: () => undefined, fetch: buscar, agora: () => 1_000 };
    expect(await chave("FAL_KEY", o)).toBe("do-cofre-abcdef12");
    expect(await chave("FAL_KEY", o)).toBe("do-cofre-abcdef12");
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://projeto.supabase.co/rest/v1/rpc/chaves_do_cofre");
    expect((init.headers as Record<string, string>).apikey).toBe("service-role-de-teste");
    expect(JSON.parse(String(init.body))).toEqual({ _nomes: ["FAL_KEY"] });
    expect(chaveCarregada("FAL_KEY", { ambiente: () => undefined })).toBe("do-cofre-abcdef12");
    expect(origemDaChave("FAL_KEY", { ambiente: () => undefined })).toBe("painel");
  });

  it("o cache vence: depois do TTL lê de novo; a falta fica guardada por menos tempo", async () => {
    let agora = 0;
    const buscar = vi.fn(async () => resposta(200, {}));
    const o = { ...base, ambiente: () => undefined, fetch: buscar, agora: () => agora };
    expect(await chave("HEYGEN_API_KEY", o)).toBe("");
    agora = TTL_VAZIO_MS - 1;
    await chave("HEYGEN_API_KEY", o);
    expect(buscar).toHaveBeenCalledTimes(1);
    agora = TTL_VAZIO_MS + 1;
    buscar.mockResolvedValueOnce(resposta(200, { HEYGEN_API_KEY: "heygen-do-cofre-99" }));
    expect(await chave("HEYGEN_API_KEY", o)).toBe("heygen-do-cofre-99");
    expect(buscar).toHaveBeenCalledTimes(2);
    agora += TTL_MS - 1;
    await chave("HEYGEN_API_KEY", o);
    expect(buscar).toHaveBeenCalledTimes(2);
    agora += 2;
    await chave("HEYGEN_API_KEY", o);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("carrega vários nomes numa chamada só, e só os que faltam no ambiente", async () => {
    const buscar = vi.fn(async () => resposta(200, { RUNWAYML_API_SECRET: "runway-cofre-1234" }));
    await carregarChaves(["FAL_KEY", "RUNWAYML_API_SECRET", "HEYGEN_API_KEY"], { ...base, ambiente: (n) => (n === "FAL_KEY" ? "fal-ambiente" : undefined), fetch: buscar });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((buscar.mock.calls[0] as unknown as [string, RequestInit])[1].body))._nomes).toEqual(["RUNWAYML_API_SECRET", "HEYGEN_API_KEY"]);
    expect(chaveCarregada("RUNWAYML_API_SECRET", { ambiente: () => undefined })).toBe("runway-cofre-1234");
    expect(chaveCarregada("HEYGEN_API_KEY", { ambiente: () => undefined })).toBe("");
  });

  it("cofre fora do ar não lança, devolve vazio e o aviso não leva a chave nem a chave de serviço", async () => {
    const c = espiarConsole();
    try {
      const v = await chave("OPENAI_API_KEY", { ...base, ambiente: () => undefined, fetch: async () => resposta(500, { message: SEGREDO }) });
      expect(v).toBe("");
      expect(c.linhas.join("\n")).toContain("cofre indisponível");
      expect(c.linhas.join("\n")).not.toContain(SEGREDO);
      expect(c.linhas.join("\n")).not.toContain("service-role-de-teste");
    } finally {
      c.soltar();
    }
  });

  it("sem endereço do projeto (teste, navegador) não faz chamada nenhuma", async () => {
    const buscar = vi.fn();
    expect(await chave("FAL_KEY", { ambiente: () => undefined, fetch: buscar })).toBe("");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("nenhum retorno nem log do módulo contém a chave do cofre", async () => {
    const c = espiarConsole();
    try {
      const o = { ...base, ambiente: () => undefined, fetch: async () => resposta(200, { OPENROUTER_API_KEY: SEGREDO }) };
      await carregarChaves(["OPENROUTER_API_KEY"], o);
      expect(c.linhas.join("\n")).not.toContain(SEGREDO);
    } finally {
      c.soltar();
    }
    const fonte = ler("supabase/functions/_shared/chaves.ts");
    expect(fonte).not.toMatch(/console\.(log|warn|error|info)\([^)]*valor/);
    expect(fonte).not.toMatch(/^import .*npm:|^import .*https?:/m);
  });
});

// ------------------------------------------------------------------ teste dos provedores

describe("teste de chave: só leitura, sem custo, nada da chave no resultado", () => {
  const um = (status: number, corpo: unknown) => vi.fn(async () => resposta(status, corpo));

  it("OpenRouter: /key e /credits viram saldo e limite", async () => {
    const buscar = vi.fn(async (u: string) =>
      u.endsWith("/key")
        ? resposta(200, { data: { usage: 12.5, limit: 50, limit_remaining: 37.5, usage_monthly: 3, is_free_tier: false } })
        : resposta(200, { data: { total_credits: 60, total_usage: 59.55 } }),
    );
    const r = await testarChave("openrouter", { OPENROUTER_API_KEY: SEGREDO }, buscar);
    expect(r.estado).toBe("valida");
    expect(r.numeros.saldo_usd).toBeCloseTo(0.45, 5);
    expect(r.numeros.uso).toEqual({ rotulo: "Limite da chave", usado: 12.5, limite: 50, unidade: "usd" });
    expect(r.mensagem).toMatch(/crédito está acabando/);
    expect((buscar.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("GET");
  });

  it("OpenRouter: /credits pedindo chave de gestão não invalida; o saldo vem do limite da chave", async () => {
    const buscar = vi.fn(async (u: string) => (u.endsWith("/key") ? resposta(200, { data: { usage: 1, limit: 10, limit_remaining: 9 } }) : resposta(403, { error: "management key" })));
    const r = await testarChave("openrouter", { OPENROUTER_API_KEY: SEGREDO }, buscar);
    expect(r.estado).toBe("valida");
    expect(r.numeros.saldo_usd).toBe(9);
  });

  it("OpenAI recusa e ecoa o começo da chave: o resultado é nosso, sem nenhum pedaço dela", async () => {
    const r = await testarChave("openai", { OPENAI_API_KEY: SEGREDO }, um(401, { error: { message: `Incorrect API key provided: ${SEGREDO.slice(0, 12)}****abcd` } }));
    expect(r.estado).toBe("invalida");
    expect(JSON.stringify(r)).not.toContain(SEGREDO.slice(0, 12));
    expect(r.mensagem).toBe("O provedor recusou a chave.");
  });

  it("TypeSafe: corpo vazio; 422 é chave válida (nada roda), 401 é recusa", async () => {
    const buscar = um(422, { detail: [] });
    expect((await testarChave("typesafe", { TYPESAFE_API_KEY: "ts-chave-de-teste" }, buscar)).estado).toBe("valida");
    expect((buscar.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe("{}");
    expect((await testarChave("typesafe", { TYPESAFE_API_KEY: "ts-chave-de-teste" }, um(401, {}))).estado).toBe("invalida");
  });

  it("Resend: chave só de envio vale; 'API key is invalid' é recusa; conta domínios verificados", async () => {
    expect((await testarChave("resend", { RESEND_API_KEY: "re_chave_teste" }, um(401, { name: "restricted_api_key" }))).estado).toBe("valida");
    expect((await testarChave("resend", { RESEND_API_KEY: "re_chave_teste" }, um(400, { message: "API key is invalid" }))).estado).toBe("invalida");
    const r = await testarChave("resend", { RESEND_API_KEY: "re_chave_teste" }, um(200, { data: [{ status: "verified" }, { status: "pending" }] }));
    expect(r.numeros.uso).toEqual({ rotulo: "Domínios verificados", usado: 1, limite: 2, unidade: "itens" });
  });

  it("ElevenLabs: caracteres usados e o limite do mês", async () => {
    const r = await testarChave("elevenlabs", { ELEVENLABS_API_KEY: "sk_eleven_teste" }, um(200, { character_count: 95_000, character_limit: 100_000, tier: "creator" }));
    expect(r.estado).toBe("valida");
    expect(textoDoUso(r.numeros.uso)).toBe("Caracteres 95.000 de 100.000");
    expect(r.numeros.conta).toBe("creator");
    expect(r.mensagem).toMatch(/acabando/);
  });

  it("fal: preço valida a chave; o saldo só com chave de administrador (senão, sem saldo pela API)", async () => {
    const buscar = vi.fn(async (u: string) => (u.indexOf("/pricing") >= 0 ? resposta(200, { prices: [] }) : resposta(403, {})));
    const r = await testarChave("fal", { FAL_KEY: "fal-chave-de-teste" }, buscar);
    expect(r.estado).toBe("valida");
    expect(r.numeros.sem_saldo_pela_api).toBe(true);
    expect((buscar.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: "Key fal-chave-de-teste" });
  });

  it("Higgsfield: 404 no pedido inexistente quer dizer chave aceita; sem o segredo nem testa", async () => {
    expect((await testarChave("higgsfield", { HIGGSFIELD_API_KEY: "id-da-chave", HIGGSFIELD_API_SECRET: "segredo-higgs" }, um(404, {}))).estado).toBe("valida");
    expect((await testarChave("higgsfield", { HIGGSFIELD_API_KEY: "id-da-chave" }, um(404, {}))).estado).toBe("nao_testada");
  });

  it("Runway: créditos viram saldo em dólar (1 crédito = US$ 0,01)", async () => {
    const r = await testarChave("runway", { RUNWAYML_API_SECRET: "key_runway_teste" }, um(200, { creditBalance: 5000 }));
    expect(r.numeros.saldo_usd).toBe(50);
    expect(r.numeros.saldo_texto).toBe("5000 créditos");
  });

  it("rede fora, 429 e 5xx viram 'Não testada', nunca lançam", async () => {
    const fora = vi.fn(async () => {
      throw new Error("network down");
    });
    expect((await testarChave("vercel", { VERCEL_TOKEN: "vercel-token-teste" }, fora)).estado).toBe("nao_testada");
    expect((await testarChave("github", { SECOND_BRAIN_GITHUB_TOKEN: "ghp_teste_123456" }, um(429, {}))).estado).toBe("nao_testada");
    expect((await testarChave("anthropic", { ANTHROPIC_API_KEY: "sk-ant-teste-123" }, um(503, {}))).estado).toBe("nao_testada");
  });

  it("todo provedor do catálogo tem teste, só com GET (e o POST vazio da TypeSafe)", async () => {
    for (const p of PROVEDORES) {
      const buscar = vi.fn(async () => resposta(200, {}));
      const valores: Record<string, string> = {};
      p.campos.forEach((c) => (valores[c.nome] = `valor-de-teste-${c.nome}`));
      const r = await testarChave(p.id, valores, buscar);
      expect(r.mensagem, p.id).not.toBe("Este provedor ainda não tem teste.");
      if (p.emBreve) {
        // OpenArt: entrada pronta, sem API pública ainda: não chama nada.
        expect(r.estado, p.id).toBe("nao_testada");
        expect(buscar, p.id).not.toHaveBeenCalled();
        continue;
      }
      expect(buscar, p.id).toHaveBeenCalled();
      for (const chamada of buscar.mock.calls as unknown as Array<[string, RequestInit]>) {
        expect(chamada[1].method, p.id).toBe(p.id === "typesafe" ? "POST" : "GET");
        expect(chamada[0], p.id).not.toContain("valor-de-teste");
      }
    }
  });

  it("semAChave esconde qualquer resultado com pedaço da chave", () => {
    const vazado = semAChave({ estado: "valida", mensagem: `ok ${SEGREDO.slice(4, 20)}`, numeros: {}, http: 200 }, { X: SEGREDO });
    expect(JSON.stringify(vazado)).not.toContain(SEGREDO.slice(4, 20));
  });
});

// ------------------------------------------------------------------ quadro e números

describe("quadro: chave em uso, teste da mesma chave, gasto do mês", () => {
  const listado = {
    cofre: [{ nome: "FAL_KEY", provedor: "fal", final_chave: "a1b2" }, { nome: "OPENAI_API_KEY", provedor: "openai", final_chave: "zzzz" }],
    testes: [
      { provedor: "openrouter", estado: "valida", origem: "servidor", final_chave: "9f9f", testada_em: "2026-10-01T12:00:00Z", resultado: { mensagem: "Chave válida.", numeros: { saldo_usd: 0.45 } } },
      { provedor: "openai", estado: "valida", origem: "painel", final_chave: "yyyy", testada_em: "2026-10-01T12:00:00Z", resultado: {} },
    ],
    gasto_mes: { openrouter: 50.3544, fal: 0.178 },
    eventos: [],
  };

  it("servidor manda; o teste de outra chave não vale; sem chave é 'Sem chave'", () => {
    const q = montarQuadro(listado, { OPENROUTER_API_KEY: "9f9f", OPENAI_API_KEY: "kkkk" }, new Date("2026-10-01T13:00:00Z"));
    const l = (id: string) => q.linhas.find((x) => x.id === id)!;
    expect(l("openrouter")).toMatchObject({ estado: "valida", origem: "servidor", final: "9f9f", mes_usd: 50.3544 });
    expect(l("openrouter").numeros.saldo_usd).toBe(0.45);
    expect(l("openai")).toMatchObject({ estado: "nao_testada", origem: "servidor", final: "kkkk", no_painel: true, no_servidor: true });
    expect(l("fal")).toMatchObject({ estado: "nao_testada", origem: "painel", final: "a1b2", mes_usd: 0.178 });
    expect(l("heygen")).toMatchObject({ estado: "sem_chave", origem: null, final: null });
    expect(l("higgsfield").estado).toBe("sem_chave");
    expect(q.linhas).toHaveLength(PROVEDORES.length);
    expect(q.mes_total_usd).toBeCloseTo(50.5324, 4);
  });

  it("a linha de números: 'Este mês US$ X · Saldo US$ Y' e 'sem saldo pela API' quando o provedor não informa", () => {
    expect(numerosDaLinha({ estado: "valida", mes_usd: 50.3544, numeros: { saldo_usd: 0.45 } })).toEqual(["Este mês US$ 50,35", "Saldo US$ 0,45"]);
    expect(numerosDaLinha({ estado: "valida", mes_usd: 0, numeros: { sem_saldo_pela_api: true, uso: { rotulo: "Caracteres", usado: 1200, limite: 30000, unidade: "caracteres" } } })).toEqual([
      "Este mês US$ 0,00",
      "sem saldo pela API",
      "Caracteres 1.200 de 30.000",
    ]);
    expect(numerosDaLinha({ estado: "sem_chave", mes_usd: 2, numeros: { saldo_usd: 9 } })).toEqual(["Este mês US$ 2,00"]);
    expect(dolar(1234.5)).toBe("US$ 1.234,50");
    expect(haQuanto("2026-10-01T10:00:00Z", Date.parse("2026-10-01T12:00:00Z"))).toBe("há 2 h");
  });
});

// ------------------------------------------------------------------ catálogo, banco e função

describe("catálogo, migration e função: só admin, só servidor", () => {
  const sql = ler("supabase/migrations/20260930323000_chaves_e_custos.sql");
  const fn = ler("supabase/functions/chaves-admin/index.ts");

  it("catálogo = lista do _shared = CHECK do banco; os 12 provedores pedidos estão lá", () => {
    expect(SEGREDOS_DO_CATALOGO.slice().sort()).toEqual(NOMES_DAS_CHAVES.slice().sort());
    const doCheck = (sql.match(/nome IN \(([\s\S]*?)\)\),/) || ["", ""])[1].match(/'([A-Z_]+)'/g)!.map((x) => x.replace(/'/g, ""));
    expect(doCheck.sort()).toEqual(NOMES_DAS_CHAVES.slice().sort());
    for (const id of ["openrouter", "openai", "anthropic", "gemini", "elevenlabs", "fal", "typesafe", "resend", "vercel", "runway", "heygen", "higgsfield"]) {
      expect(PROVEDORES.some((p) => p.id === id), id).toBe(true);
    }
  });

  it("RLS ligada; nada para anon/authenticated; só a service_role executa as RPCs", () => {
    for (const t of ["chaves_cofre", "chaves_testes", "chaves_eventos", "chaves_alertas"]) expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain("REVOKE ALL ON TABLE public.chaves_cofre, public.chaves_testes, public.chaves_eventos, public.chaves_alertas\n  FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/TO (anon|authenticated)\b/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).not.toMatch(/DROP (TABLE|POLICY)|DISABLE ROW LEVEL/i);
    const publicas = ["chaves_admin_salvar", "chaves_admin_remover", "chaves_admin_registrar_teste", "chaves_admin_listar", "chaves_do_cofre", "chaves_admin_alerta", "chaves_admin_uso_semana"];
    for (const f of publicas) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
      const corpo = sql.slice(sql.indexOf(`FUNCTION public.${f}(`));
      expect(corpo.slice(0, corpo.indexOf("$body$;"))).toContain("IF NOT app_private.rpc_trusted_backend() THEN");
    }
    for (const f of ["chaves_salvar", "chaves_remover", "chaves_registrar_teste", "chaves_listar", "chaves_ler", "chaves_alerta", "chaves_uso_semana"]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION app_private\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
    // Toda função SECURITY DEFINER fixa o search_path.
    const definers = (sql.match(/^SECURITY DEFINER$/gm) || []).length;
    const caminhos = (sql.match(/^SECURITY DEFINER\nSET search_path TO ''$/gm) || []).length;
    expect(definers).toBe(14);
    expect(definers).toBe(caminhos);
    // O segredo só no Vault; nem o ponteiro vai para a service_role por SELECT.
    expect(sql).toContain("vault.create_secret(");
    expect(sql).toContain("vault.update_secret(");
    expect(sql).toMatch(/GRANT SELECT \(nome, provedor, final_chave, atualizado_por, criado_em, atualizado_em\)\n  ON public\.chaves_cofre TO service_role;/);
    // A auditoria não tem coluna de valor.
    const eventos = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.chaves_eventos"), sql.indexOf("CREATE INDEX IF NOT EXISTS chaves_eventos_criado_idx"));
    expect(eventos).not.toMatch(/segredo|valor|chave text/);
  });

  it("migration na faixa da frente (20260930323000 a 323900)", () => {
    const v = Number("20260930323000");
    expect(v).toBeGreaterThanOrEqual(20260930323000);
    expect(v).toBeLessThanOrEqual(20260930323900);
  });

  it("função: verify_jwt, só admin antes de qualquer ação, nada da chave em log ou resposta", () => {
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.chaves-admin\]\n\s+verify_jwt = true/);
    expect(fn).toContain('servico().rpc("has_role", { _user_id: userId, _role: "admin" })');
    expect(fn).toContain('throw new ErroHttp(403, "somente_admin"');
    const serve = fn.slice(fn.indexOf("Deno.serve("));
    expect(serve.indexOf("identificarAdmin(req)")).toBeLessThan(serve.indexOf("req.json()"));
    expect(fn).not.toMatch(/console\.(log|info|debug)\(/);
    expect(fn).not.toMatch(/registrarFalha\([^)]*corpo/);
    expect(fn).not.toMatch(/json\(\{[^}]*\b(novos|completos|valores)\b/);
    expect(fn).toContain('if (r.estado === "invalida" && corpo.confirmar !== true)');
    expect(fn).toContain('if (corpo.confirmar !== true) throw new ErroHttp(400, "precisa_confirmar"');
  });

  it("as funções que usam chave de provedor leem pelo _shared/chaves.ts", () => {
    const lerAmbienteDireto = /Deno\.env\.get\(\s*["'](OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|ELEVENLABS_API_KEY|FAL_KEY|TYPESAFE_API_KEY|RESEND_API_KEY|VERCEL_TOKEN|SECOND_BRAIN_GITHUB_TOKEN)["']\s*\)/;
    for (const f of [
      "supabase/functions/_shared/ia-motor.ts",
      "supabase/functions/_shared/jev.ts",
      "supabase/functions/_shared/resend.ts",
      "supabase/functions/_shared/second-brain-github.ts",
      "supabase/functions/editor-video/index.ts",
      "supabase/functions/materiais-classificar/index.ts",
      "supabase/functions/mesa-motion/index.ts",
      "supabase/functions/mesa-site/index.ts",
      "supabase/functions/mesa-videos/geracao.ts",
      "supabase/functions/process-email-queue/index.ts",
      "supabase/functions/send-contract-email/index.ts",
      "supabase/functions/workspace-organizar/nucleo.ts",
    ]) {
      expect(ler(f), f).not.toMatch(lerAmbienteDireto);
      expect(ler(f), f).toMatch(/from "\.\.?\/(_shared\/)?chaves\.ts"|from '\.\.?\/(_shared\/)?chaves\.ts'/);
    }
    expect(ler("supabase/functions/mesa-videos/index.ts")).toContain("await carregarChaves(CHAVES_DE_VIDEO);");
    expect(ler("supabase/functions/motores-estado/index.ts")).toContain("await carregarChaves(SEGREDOS_CONFERIDOS);");
    expect(ler("supabase/functions/mesa-foto/ferramentas-pro.ts").match(/await carregarChaves\(SEGREDOS_DAS_FERRAMENTAS\)/g)).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ motores apontam para Chaves e custos

describe("Estado dos motores aponta para Chaves e custos", () => {
  it("o motor sem chave lista o provedor e diz onde cadastrar", () => {
    const motores = montarEstado({
      agora: Date.parse("2026-10-01T12:00:00Z"),
      admin: true,
      segredos: { OPENROUTER_API_KEY: false, OPENAI_API_KEY: false, FAL_KEY: false, TYPESAFE_API_KEY: false },
      openrouter: null,
      site: { executores: [], abertos: [], ultimaFalha: null, ultimoFeito: null },
      render: { workers: [], abertos: [], erros: [], prontos: [] },
      imagem: { abertos: [], erros: [], feitas24h: 0, ultimaFeita: null },
      video: { abertos: [], erros: [], pedidos7d: 0, prontos7d: 0, angulos7d: 0, ultimoPronto: null },
      carteirasBaixas: [],
    });
    const ia = motores.find((m) => m.id === "ia")!;
    expect(ia.chaves).toEqual(expect.arrayContaining(["openrouter", "typesafe"]));
    expect(ia.falta.join(" ")).toMatch(/Configurações › Chaves e custos/);
    expect(motores.find((m) => m.id === "video")!.chaves).toEqual(expect.arrayContaining(["fal"]));
    expect(motores.find((m) => m.id === "imagem")!.chaves![0]).toBe("openrouter");
  });
});

// ------------------------------------------------------------------ tela

function quadroDeTela(): QuadroDasChaves {
  return montarQuadro(
    {
      cofre: [],
      testes: [{ provedor: "openrouter", estado: "valida", origem: "servidor", final_chave: "9f9f", testada_em: new Date(Date.now() - 2 * 3600_000).toISOString(), resultado: { mensagem: "Chave válida.", numeros: { saldo_usd: 0.45 } } }],
      gasto_mes: { openrouter: 50.3544, lovable: 1 },
      por_cliente: [
        { client_id: "c-2", nome: "CME", mes_usd: 1.1, carteira_usd: null },
        { client_id: "c-1", nome: "Acerbi", mes_usd: 3.2, carteira_usd: 6.8 },
      ],
      eventos: [{ provedor: "fal", acao: "trocada", estado: "valida", ator_nome: "Almir", criado_em: new Date().toISOString() }],
    },
    { OPENROUTER_API_KEY: "9f9f", TYPESAFE_API_KEY: "t0t0" },
  );
}

const montar = (el: ReturnType<typeof h>, rota = "/config") =>
  render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, el)));

describe("tela: Chaves e custos", () => {
  beforeEach(() => {
    invocar.mockReset();
    papel.valor = "admin";
  });

  it("uma linha por provedor com bolinha, estado, fim da chave e os números embaixo", async () => {
    invocar.mockResolvedValue({ data: quadroDeTela(), error: null });
    montar(h(ChavesECustos));
    await waitFor(() => expect(document.querySelectorAll("[data-provedor]").length).toBe(PROVEDORES.length));
    expect(invocar).toHaveBeenCalledWith("chaves-admin", { body: { acao: "listar" } });
    const or = document.querySelector('[data-provedor="openrouter"]') as HTMLElement;
    expect(or.getAttribute("data-estado")).toBe("valida");
    expect(or.querySelector("[data-numeros]")!.textContent).toBe("Este mês US$ 50,35 · Saldo US$ 0,45");
    expect(or.textContent).toContain("•••• 9f9f");
    expect(or.textContent).toMatch(/há 2 h/);
    expect((document.querySelector('[data-provedor="typesafe"]') as HTMLElement).getAttribute("data-estado")).toBe("nao_testada");
    const heygen = document.querySelector('[data-provedor="heygen"]') as HTMLElement;
    expect(heygen.getAttribute("data-estado")).toBe("sem_chave");
    expect(within(heygen).getByRole("button", { name: "Cadastrar" })).toBeInTheDocument();
    expect(within(heygen).queryByRole("button", { name: "Testar" })).toBeNull();
    expect(screen.getByText(`1 de ${PROVEDORES.length} válidas`)).toBeInTheDocument();
    // Topo: gasto do mês de todos os provedores (inclui o que não está no catálogo), por cliente e saldo baixo.
    const totais = document.querySelector("[data-totais-das-chaves]") as HTMLElement;
    expect(totais.textContent).toContain("Gasto do mês");
    expect(totais.textContent).toContain("US$ 51,35");
    expect(totais.textContent).toContain("Maior: Acerbi US$ 3,20");
    expect(totais.textContent).toMatch(/Saldo baixo.*OpenRouter/);
    expect(or.querySelector("[data-saldo-baixo]")).not.toBeNull();
    // Recarregar: página de cobrança do provedor, em outra aba, sem levar nada do painel.
    const recarregar = or.querySelector('[data-recarregar="openrouter"]') as HTMLAnchorElement;
    expect(recarregar.getAttribute("href")).toBe("https://openrouter.ai/settings/credits");
    expect(recarregar.getAttribute("target")).toBe("_blank");
    expect(recarregar.getAttribute("rel")).toBe("noopener noreferrer");
    expect(document.querySelector('[data-recarregar="github"]')).toBeNull();
    expect((document.querySelector('[data-provedor="openart"]') as HTMLElement).textContent).toContain("em breve");
  });

  it("cadastrar: janela no centro com campo de senha; recusada pede 'Salvar mesmo assim'; a chave some depois", async () => {
    invocar.mockResolvedValueOnce({ data: quadroDeTela(), error: null });
    montar(h(ChavesECustos));
    await waitFor(() => expect(document.querySelector('[data-cadastrar="heygen"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-cadastrar="heygen"]') as HTMLButtonElement);
    const janela = await waitFor(() => document.querySelector('[data-janela-de-chave="heygen"]') as HTMLElement);
    const campo = janela.querySelector('input[data-campo-da-chave="HEYGEN_API_KEY"]') as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.getAttribute("autocomplete")).toBe("new-password");
    fireEvent.change(campo, { target: { value: "heygen-chave-errada-123" } });
    invocar.mockResolvedValueOnce({ data: { salva: false, precisa_confirmar: true, teste: { estado: "invalida", mensagem: "O provedor recusou a chave.", numeros: {} } }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Testar e salvar" }));
    await waitFor(() => expect(document.querySelector("[data-chave-recusada]")).not.toBeNull());
    expect(invocar).toHaveBeenLastCalledWith("chaves-admin", { body: { acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: "heygen-chave-errada-123" }, confirmar: false } });
    const salvo = quadroDeTela();
    invocar.mockResolvedValueOnce({ data: { salva: true, teste: { estado: "invalida", mensagem: "O provedor recusou a chave.", numeros: {} }, quadro: salvo }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));
    await waitFor(() => expect(document.querySelector('[data-janela-de-chave="heygen"]')).toBeNull());
    expect(invocar).toHaveBeenLastCalledWith("chaves-admin", { body: { acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: "heygen-chave-errada-123" }, confirmar: true } });
    expect(document.body.innerHTML).not.toContain("heygen-chave-errada-123");
  });

  it("Testar chama a função com o provedor e atualiza a linha", async () => {
    invocar.mockResolvedValueOnce({ data: quadroDeTela(), error: null });
    montar(h(ChavesECustos));
    await waitFor(() => expect(document.querySelector('[data-testar="typesafe"]')).not.toBeNull());
    const depois = quadroDeTela();
    depois.linhas = depois.linhas.map((l) => (l.id === "typesafe" ? { ...l, estado: "valida", testada_em: new Date().toISOString(), numeros: { sem_saldo_pela_api: true } } : l));
    invocar.mockResolvedValueOnce({ data: { teste: { estado: "valida", mensagem: "Chave válida.", numeros: {} }, linha: null, quadro: depois }, error: null });
    fireEvent.click(document.querySelector('[data-testar="typesafe"]') as HTMLButtonElement);
    await waitFor(() => expect((document.querySelector('[data-provedor="typesafe"]') as HTMLElement).getAttribute("data-estado")).toBe("valida"));
    expect(invocar).toHaveBeenLastCalledWith("chaves-admin", { body: { acao: "testar", provedor: "typesafe" } });
    expect((document.querySelector('[data-provedor="typesafe"] [data-numeros]') as HTMLElement).textContent).toBe("Este mês US$ 0,00 · sem saldo pela API");
  });

  it("Configurações: largura total, linha de chaves só para o admin, ?secao=chaves abre", async () => {
    expect(ler("src/pages/SettingsPage.tsx")).not.toContain("max-w-3xl");
    expect(ler("src/components/config/EstadoDosMotores.tsx")).not.toContain("max-w-3xl");
    expect(ler("src/components/config/SuperpoderesDasMesas.tsx")).not.toContain("max-w-3xl");
    expect(ler("src/pages/SettingsPage.tsx")).toContain('lazy(() => import("@/components/config/ChavesECustos"))');
    papel.valor = "team";
    const a = montar(h(SettingsPage));
    expect(document.querySelector("[data-linha-chaves]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Modelos de IA/ })).toBeNull();
    a.unmount();
    papel.valor = "admin";
    const b = montar(h(SettingsPage));
    const linha = document.querySelector("[data-linha-chaves]") as HTMLButtonElement;
    expect(linha.getAttribute("aria-expanded")).toBe("false");
    expect(invocar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Modelos de IA/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sistema" })).toBeInTheDocument();
    b.unmount();
    invocar.mockResolvedValue({ data: quadroDeTela(), error: null });
    montar(h(SettingsPage), "/config?secao=chaves");
    expect((document.querySelector("[data-linha-chaves]") as HTMLButtonElement).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.querySelector("[data-chaves-e-custos]")).not.toBeNull());
  });

  it("Estado dos motores: o motor sem chave mostra 'Abrir Chaves e custos'; quem não é admin vê o pedido ao admin", async () => {
    const motores = [
      { id: "ia", nome: "Chaves e crédito da IA", situacao: "parado", resumo: "Sem chave.", ultimo_sinal: null, fila: { esperando: 0, rodando: 0, desde: null }, ultimo_erro: null, falta: ["Cadastrar a chave do OpenRouter (OPENROUTER_API_KEY) em Configurações › Chaves e custos."], detalhes: [], chaves: ["openrouter"] },
    ];
    invocar.mockResolvedValue({ data: { motores, geral: { parados: 1, atencao: 0, texto: "1 motor parado" }, avisos: [], conferido_em: "2026-10-01T12:00:00Z" }, error: null });
    const abrir = vi.fn();
    const r = montar(h(EstadoDosMotores, { semTitulo: true, onAbrirChaves: abrir }));
    await waitFor(() => expect(document.querySelector('[data-motor="ia"] button')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-motor="ia"] button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /Abrir Chaves e custos/ }));
    expect(abrir).toHaveBeenCalledWith("openrouter");
    r.unmount();
    montar(h(EstadoDosMotores, { semTitulo: true }));
    await waitFor(() => expect(document.querySelector('[data-motor="ia"] button')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-motor="ia"] button') as HTMLButtonElement);
    expect(document.querySelector("[data-atalho-chaves]")!.textContent).toMatch(/Peça a um admin/);
  });
});


// ------------------------------------------------------------------ pedido do dono (rodada 2): recarga, totais, aviso e modelo por papel

describe("recarga, totais e aviso de saldo", () => {
  beforeEach(() => {
    invocar.mockReset();
    papel.valor = "admin";
  });

  it("todo provedor pago tem a página de cobrança (https) e nenhum guarda dado de pagamento", () => {
    for (const p of PROVEDORES) {
      if (p.id === "github") expect(p.recarga).toBeNull();
      else expect(p.recarga, p.id).toMatch(/^https:\/\//);
    }
    const tela = ler("src/components/config/ChavesECustos.tsx");
    expect(tela).not.toMatch(/cc-number|cc-csc|card_number|cvv|payment_method/i);
    expect(PROVEDORES.find((p) => p.id === "openart")).toMatchObject({ emBreve: true, recarga: "https://openart.ai/pricing" });
  });

  it("saldo baixo: começa em US$ 10 e respeita o valor ajustado", () => {
    const base = { cofre: [], testes: [{ provedor: "fal", estado: "valida", origem: "servidor", final_chave: "f4f4", testada_em: "2026-10-01T12:00:00Z", resultado: { numeros: { saldo_usd: 7 } } }], gasto_mes: {}, eventos: [] };
    const padrao = montarQuadro(base, { FAL_KEY: "f4f4" });
    expect(padrao.linhas.find((l) => l.id === "fal")).toMatchObject({ saldo_minimo_usd: 10, saldo_baixo: true });
    expect(padrao.saldo_baixo).toEqual(["fal"]);
    const ajustado = montarQuadro({ ...base, alertas: { fal: 5 } }, { FAL_KEY: "f4f4" });
    expect(ajustado.linhas.find((l) => l.id === "fal")).toMatchObject({ saldo_minimo_usd: 5, saldo_baixo: false });
    expect(ajustado.saldo_baixo).toEqual([]);
  });

  it("o aviso de saldo baixo se ajusta no '...' da linha e vai para a função", async () => {
    invocar.mockResolvedValueOnce({ data: quadroDeTela(), error: null });
    montar(h(ChavesECustos));
    await waitFor(() => expect(document.querySelector('[data-provedor="fal"]')).not.toBeNull());
    const linha = document.querySelector('[data-provedor="fal"]') as HTMLElement;
    const menu = within(linha).getByRole("button", { name: /Mais ações de fal\.ai/ });
    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false });
    fireEvent.keyDown(menu, { key: "Enter" });
    const item = await screen.findByText(/Aviso de saldo baixo \(US\$ 10,00\)/);
    fireEvent.click(item);
    const campo = (await waitFor(() => document.querySelector("[data-campo-aviso]"))) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "25" } });
    invocar.mockResolvedValueOnce({ data: { quadro: quadroDeTela() }, error: null });
    fireEvent.click(document.querySelector("[data-salvar-aviso]") as HTMLButtonElement);
    await waitFor(() => expect(invocar).toHaveBeenLastCalledWith("chaves-admin", { body: { acao: "alerta", provedor: "fal", saldo_minimo_usd: 25 } }));
  });

  it("gasto por cliente abre pelo número do topo, com a carteira de cada um", async () => {
    invocar.mockResolvedValueOnce({ data: quadroDeTela(), error: null });
    montar(h(ChavesECustos));
    await waitFor(() => expect(document.querySelector("[data-totais-das-chaves]")).not.toBeNull());
    expect(document.querySelector("[data-gasto-por-cliente]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Por cliente/ }));
    const lista = document.querySelector("[data-gasto-por-cliente]") as HTMLElement;
    const linhas = Array.from(lista.querySelectorAll("li")).map((li) => li.textContent);
    expect(linhas[0]).toContain("Acerbi");
    expect(linhas[0]).toContain("carteira US$ 6,80");
    expect(linhas[0]).toContain("US$ 3,20");
    expect(linhas[1]).toContain("sem carteira");
  });
});

describe("Modelos de IA: trocar o padrão de um papel mostra o custo da semana e pede Confirmar", () => {
  it("estimativa pelo uso real dos últimos 7 dias, repreçado com o modelo novo", () => {
    const agentes = [
      { agente: "estrategista", chamadas: 170, tokens_entrada: 2_000_000, tokens_saida: 300_000, tokens_cache: 0, imagens: 0, custo_usd: 1.909 },
      { agente: "gerador_imagem", chamadas: 667, tokens_entrada: 0, tokens_saida: 0, tokens_cache: 0, imagens: 600, custo_usd: 43.824 },
    ];
    const texto = { id: "openrouter:x", provedor: "openrouter", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 0.5, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: [], ativo: true } as const;
    expect(custoSemanalCom(usoDoPapel(agentes, "estrategista"), texto as never)).toBeCloseTo(1.6, 6);
    const imagem = { ...texto, tipo: "imagem", preco_entrada_1m: null, preco_saida_1m: null, preco_imagem: { media: 0.04 } } as const;
    expect(custoSemanalCom(usoDoPapel(agentes, "imagem"), imagem as never)).toBeCloseTo(24, 6);
    expect(usoDoPapel(agentes, "naming")).toBeNull();
  });

  it("o seletor do papel só marca a troca; gravar é no Confirmar (nenhum padrão muda sozinho)", () => {
    const fonte = ler("src/components/mesa/ModelosDeIa.tsx");
    expect(fonte).toContain("onValueChange={(v) => setPendente(v && v !== (atual?.id || \"\") ? { papel: papel.valor, para: v } : null)}");
    expect(fonte).not.toContain("onValueChange={(v) => void definirPadrao(");
    expect(fonte).toContain("onConfirmar={() => void definirPadrao(papel.valor, pendente.para)}");
    expect(fonte).toContain("enabled: aberto && !!pendente,");
    expect(fonte).toContain("Com o novo: ");
  });
});
