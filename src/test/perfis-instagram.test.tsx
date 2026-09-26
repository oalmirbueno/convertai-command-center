import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente P (26/09): Perfis do Instagram (referências e concorrentes).
 * 1. Números em código: engajamento, mediana, fora da curva, resumo numérico.
 * 2. @ e links; posts novos param no primeiro conhecido.
 * 3. Ações do agente com apelidos (contrato comum) e anti-cópia que bloqueia pauta.
 * 4. Sem laço: uma rodada por perfil por semana, teto de custo.
 * 5. Tela: seletor Referências | Concorrentes, estado lembrado e a seção no Contexto.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }),
        createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        upload: () => Promise.resolve({ data: null, error: null }),
      }),
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import PerfisDoInstagram from "@/components/perfis/PerfisDoInstagram";
import { filtrarPosts } from "@/components/perfis/PerfilAberto";
import { normalizarAcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";
import {
  alvosDasPautas,
  cabeNoTeto,
  datasDasPautas,
  decidirPautas,
  DIAS_ENTRE_RODADAS,
  engajamentoDoPost,
  formatoDaMidia,
  horaEDiaEmSaoPaulo,
  LIMIAR_DA_COPIA,
  LIMITE_POR_PAPEL,
  lerRespostasDaLeitura,
  mediana,
  metricasDoPerfil,
  normalizarHandle,
  normalizarLinkDePost,
  normalizarPauta,
  type PautaDoPerfil,
  perguntasDaAntiCopia,
  perguntasDaLeitura,
  pilaresParaAPergunta,
  podeAdicionar,
  podeRodar,
  postsNovos,
  proximaRodadaEm,
  quantasPautas,
  REGRAS_DO_PERFIL,
  resumoNumerico,
} from "../../supabase/functions/_shared/perfis-instagram";
import { MOTORES } from "../../supabase/functions/_shared/motores";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = "11111111-1111-4111-8111-111111111111";

// ------------------------------------------------------------------ 1. números

describe("números em código", () => {
  it("engajamento = (curtidas + comentários) / seguidores; sem seguidores, nulo", () => {
    expect(engajamentoDoPost(90, 10, 1000)).toBeCloseTo(0.1);
    expect(engajamentoDoPost(null, 5, 100)).toBeCloseTo(0.05);
    expect(engajamentoDoPost(10, 10, 0)).toBeNull();
    expect(engajamentoDoPost(null, null, 100)).toBeNull();
  });

  it("mediana de lista par e ímpar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });

  it("fora da curva é >= 2x a mediana do perfil; poucos posts não marcam ninguém", () => {
    const posts = [
      { id: "a", curtidas: 10, comentarios: 0 },
      { id: "b", curtidas: 12, comentarios: 0 },
      { id: "c", curtidas: 8, comentarios: 2 },
      { id: "d", curtidas: 30, comentarios: 0 },
      { id: "e", curtidas: 19, comentarios: 1 },
    ];
    const m = metricasDoPerfil(posts, 1000);
    expect(m.mediana).toBeCloseTo(0.012);
    expect(m.fora.sort()).toEqual(["d"]);
    expect(m.porPost.e.fora_da_curva).toBe(false); // 0,020 < 0,024
    expect(m.porPost.d.vezes_a_mediana).toBe(2.5);
    const poucos = metricasDoPerfil(posts.slice(0, 3), 1000);
    expect(poucos.mediana).toBeNull();
    expect(poucos.fora).toEqual([]);
  });

  it("resumo numérico: frequência, mix e horas em São Paulo", () => {
    const posts = [
      { id: "1", curtidas: 1, comentarios: 0, publicado_em: "2026-09-01T21:00:00Z", formato: "reel" },
      { id: "2", curtidas: 1, comentarios: 0, publicado_em: "2026-09-08T21:30:00Z", formato: "carrossel" },
      { id: "3", curtidas: 1, comentarios: 0, publicado_em: "2026-09-15T21:10:00Z", formato: "reel" },
    ];
    const r = resumoNumerico(posts, 100);
    expect(r.posts).toBe(3);
    expect(r.por_semana).toBe(1.5);
    expect(r.mix).toEqual({ reel: 2, carrossel: 1 });
    expect(r.horas_mais_usadas[0]).toBe(18);
    expect(horaEDiaEmSaoPaulo("2026-09-01T02:00:00Z")).toEqual({ hora: 23, dia: 1 });
  });

  it("formato da mídia da Graph API", () => {
    expect(formatoDaMidia("VIDEO", "REELS")).toBe("reel");
    expect(formatoDaMidia("CAROUSEL_ALBUM", "FEED")).toBe("carrossel");
    expect(formatoDaMidia("IMAGE", "FEED")).toBe("foto");
    expect(formatoDaMidia("VIDEO", "FEED")).toBe("video");
  });
});

// ------------------------------------------------------------------ 2. @, links, novos, limites

describe("@, links e captura", () => {
  it("normaliza @ e link de perfil; recusa link de post e @ inválido", () => {
    expect(normalizarHandle("@Aceleriq")).toBe("aceleriq");
    expect(normalizarHandle("https://www.instagram.com/terra.flor_/?hl=pt")).toBe("terra.flor_");
    expect(normalizarHandle("instagram.com/p/ABC123")).toBeNull();
    expect(normalizarHandle("com espaço")).toBeNull();
    expect(normalizarHandle(".ponto")).toBeNull();
  });

  it("link de post, reel e reels vira link limpo com código", () => {
    expect(normalizarLinkDePost("https://www.instagram.com/p/CxYz_12-ab/?img_index=1")).toEqual({ permalink: "https://www.instagram.com/p/CxYz_12-ab/", codigo: "CxYz_12-ab" });
    expect(normalizarLinkDePost("https://instagram.com/fulano/reel/Abcde123/")).toEqual({ permalink: "https://www.instagram.com/reel/Abcde123/", codigo: "Abcde123" });
    expect(normalizarLinkDePost("https://www.instagram.com/reels/Abcde123")!.permalink).toBe("https://www.instagram.com/reel/Abcde123/");
    expect(normalizarLinkDePost("https://www.instagram.com/fulano/")).toBeNull();
  });

  it("posts novos param no primeiro já conhecido e respeitam o máximo", () => {
    const recebidos = ["9", "8", "7", "6", "5"].map((id) => ({ id }));
    expect(postsNovos(recebidos, ["7", "3"], 12).map((x) => x.id)).toEqual(["9", "8"]);
    expect(postsNovos(recebidos, [], 3).map((x) => x.id)).toEqual(["9", "8", "7"]);
  });

  it("limite de 6 por papel", () => {
    expect(LIMITE_POR_PAPEL).toBe(6);
    expect(podeAdicionar(5)).toBe(true);
    expect(podeAdicionar(6)).toBe(false);
  });
});

// ------------------------------------------------------------------ 3. Jev, apelidos e anti-cópia

const pauta = (i: number, tema: string): PautaDoPerfil => normalizarPauta({ tema, gancho: `Gancho ${i}`, formato: "carrossel", cards: [{ funcao: "capa", texto: "Capa" }] }, i, ["p1", "p2"])!;

describe("julgamentos e ações", () => {
  it("perguntas da leitura: três por post, Score com lista ordenada e pilar com 'nenhum'", () => {
    const pilares = pilaresParaAPergunta(["Educar", "educar", "Vender"]);
    expect(pilares).toEqual(["Educar", "Vender", "nenhum"]);
    const q = perguntasDaLeitura(2, pilares);
    expect(Object.keys(q).sort()).toEqual(["combina_0", "combina_1", "formato_0", "formato_1", "pilar_0", "pilar_1"]);
    const s = q.combina_0 as { type: string; criteria: unknown };
    expect(s.type).toBe("score");
    expect(Array.isArray(s.criteria)).toBe(true);
    const r = lerRespostasDaLeitura({ formato_0: { choice: "bastidor" }, pilar_0: { choice: "nenhum" }, combina_0: { score: 4 } }, 1, pilares);
    expect(r[0]).toEqual({ formato_editorial: "bastidor", pilar: null, combina: 10 });
    expect(pilaresParaAPergunta([])).toContain("educar");
  });

  it("apelidos: só p para levar ao estilo, só q para agendar; apelido inventado é ignorado", () => {
    const alvos = [
      { id: "post-1", ref: "p1", titulo: "reel", dados: { tem_imagem: true } },
      { id: "post-2", ref: "p2", titulo: "link", dados: { tem_imagem: false } },
    ];
    const a = normalizarAcaoDoAgente(
      { resumo: "", itens: [{ operacao: "levar_ao_estilo", ref: "p1", para: "" }, { operacao: "levar_ao_estilo", ref: "p2", para: "" }, { operacao: "levar_ao_estilo", ref: "p9", para: "" }, { operacao: "agendar", ref: "p1", para: "2026-10-01" }] },
      alvos,
      REGRAS_DO_PERFIL,
      { agente: "perfis" },
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.alvo_id}`)).toEqual(["levar_ao_estilo:post-1"]);
    expect(a.recusados.map((r) => r.ref)).toEqual(["p2"]);
    expect(a.ignorados).toEqual(expect.arrayContaining(["p9", "p1"]));

    const pautas = [pauta(0, "Tema A"), pauta(1, "Tema B")];
    const b = normalizarAcaoDoAgente(
      { resumo: "", itens: [{ operacao: "agendar", ref: "q1", para: "2026-10-02" }, { operacao: "agendar", ref: "q2", para: "amanhã" }] },
      alvosDasPautas(pautas),
      REGRAS_DO_PERFIL,
      { agente: "perfis" },
    )!;
    expect(b.itens).toHaveLength(1);
    expect(b.itens[0]).toMatchObject({ ref: "q1", alvo_id: "q1", para: "2026-10-02" });
    expect(b.ignorados).toEqual(["q2"]);
  });

  it("anti-cópia: pauta que copia sai com aviso; sem resposta do Jev nenhuma passa; gera a mais e escolhe", () => {
    const pautas = [pauta(0, "A"), pauta(1, "B"), pauta(2, "C"), pauta(3, "D")];
    expect(Object.keys(perguntasDaAntiCopia(2)).sort()).toEqual(["copia_0", "copia_1", "ritmo_0", "ritmo_1"]);
    const d = decidirPautas(
      pautas,
      {
        copia_0: { noul: 0.1 }, ritmo_0: { noul: 0.4 },
        copia_1: { noul: LIMIAR_DA_COPIA }, ritmo_1: { noul: 0.9 },
        copia_2: { noul: 0.2 }, ritmo_2: { noul: 0.95 },
        copia_3: { noul: 0.05 }, ritmo_3: { noul: 0.7 },
      },
      2,
    );
    expect(d.bloqueadas.map((b) => b.pauta.tema)).toEqual(["B"]);
    expect(d.bloqueadas[0].motivo).toMatch(/cópia/);
    // As duas que mais mantêm o ritmo, na ordem original.
    expect(d.aprovadas.map((p) => p.tema)).toEqual(["C", "D"]);
    const semJev = decidirPautas(pautas, {}, 3);
    expect(semJev.aprovadas).toEqual([]);
    expect(semJev.bloqueadas).toHaveLength(4);
  });

  it("pauta normalizada: sem travessão, referência só de post conhecido, formato da agenda", () => {
    const p = normalizarPauta({ tema: "Tema — com travessão", gancho: "G", formato: "Carrossel", referencia: "p7", formato_editorial: "bastidor" }, 0, ["p1"])!;
    expect(p.tema).not.toMatch(/[—–]/);
    expect(p.referencia).toBeNull();
    expect(p.formato).toBe("carrossel");
    expect(p.cards).toEqual([{ ordem: 1, funcao: "capa", texto: "G" }]);
    expect(normalizarPauta({ tema: "", gancho: "x" }, 0, [])).toBeNull();
    expect(quantasPautas(40)).toBe(12);
    expect(quantasPautas("x")).toBe(8);
  });

  it("datas das pautas: dias úteis do mês, depois de hoje, espalhadas", () => {
    const d = datasDasPautas("2026-10", "2026-09-26", 4);
    expect(d).toHaveLength(4);
    for (const x of d) {
      const dia = new Date(`${x}T12:00:00Z`).getUTCDay();
      expect(dia === 0 || dia === 6).toBe(false);
    }
    expect(d[0] < d[3]).toBe(true);
    expect(datasDasPautas("2026-09", "2026-09-30", 3)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 4. sem laço

describe("rodada semanal sem laço", () => {
  const agora = new Date("2026-09-28T09:17:00Z");
  it("roda só concorrente monitorado, não arquivado e com a semana vencida", () => {
    const base = { papel: "concorrente", monitorar: true, arquivado_em: null, proxima_rodada_em: null };
    expect(podeRodar(base, agora)).toBe(true);
    expect(podeRodar({ ...base, papel: "referencia" }, agora)).toBe(false);
    expect(podeRodar({ ...base, monitorar: false }, agora)).toBe(false);
    expect(podeRodar({ ...base, arquivado_em: "2026-09-20T00:00:00Z" }, agora)).toBe(false);
    expect(podeRodar({ ...base, proxima_rodada_em: "2026-09-28T09:00:00Z" }, agora)).toBe(true);
    expect(podeRodar({ ...base, proxima_rodada_em: "2026-10-05T09:17:00Z" }, agora)).toBe(false);
  });

  it("a trava anda uma semana antes do trabalho: rodar de novo na mesma semana não pega", () => {
    const proxima = proximaRodadaEm(agora);
    expect(Date.parse(proxima) - agora.getTime()).toBe(DIAS_ENTRE_RODADAS * 24 * 3600 * 1000);
    const depois = { papel: "concorrente", monitorar: true, arquivado_em: null, proxima_rodada_em: proxima };
    expect(podeRodar(depois, new Date(agora.getTime() + 60_000))).toBe(false);
    expect(podeRodar(depois, new Date(agora.getTime() + 3 * 24 * 3600 * 1000))).toBe(false);
  });

  it("teto de custo por rodada", () => {
    expect(cabeNoTeto(0.1, 0.1, 0.3)).toBe(true);
    expect(cabeNoTeto(0.25, 0.1, 0.3)).toBe(false);
  });

  it("a função trava pela proxima_rodada_em antes de capturar, sem nova tentativa e só com o segredo do cron", () => {
    const fonte = ler("supabase/functions/perfis-instagram/index.ts");
    const trava = fonte.indexOf("update({ proxima_rodada_em: proximaRodadaEm(agora)");
    const captura = fonte.indexOf("const cap = await capturarPelaApi(perfil, tokens);");
    expect(trava).toBeGreaterThan(0);
    expect(captura).toBeGreaterThan(trava);
    expect(fonte).toContain('if (!ehCron(req)) return json({ error: "somente_cron"');
    expect(fonte).not.toMatch(/setTimeout|setInterval/);
    // Conflito do banco vira resposta normal (409 "conflito"), nunca 40001 para a tela.
    expect(fonte).toMatch(/e\.code === "40001"[^\n]*ErroHttp\(409, "conflito"/);
    // Nunca devolve token ao front.
    expect(fonte).not.toMatch(/access_token:\s*t/);
    expect(fonte).not.toMatch(/[—–]/);
    // O cron fica comentado no SQL e não é ligado aqui.
    expect(fonte).not.toContain("cron.schedule");
  });

  it("motor do plano registrado e ligado à função", () => {
    const m = MOTORES.find((x) => x.id === "perfis.plano")!;
    expect(m).toBeTruthy();
    expect(m.funcao).toBe("perfis-instagram");
    const fonte = ler(m.ligacao.arquivo);
    for (const t of m.ligacao.trechos) expect(fonte).toContain(t);
  });
});

// ------------------------------------------------------------------ 5. tela

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const perfilFalso = (id: string, papel: string, handle: string, extra: Record<string, unknown> = {}) => ({
  id, papel, handle, nome: null, seguidores: 1200, posts_total: 40, foto_caminho: null, origem: "api", capturado_em: "2026-09-25T12:00:00Z",
  monitorar: false, proxima_rodada_em: null, ultima_rodada_em: null, ultimo_erro: null, resumo: null, metricas: null,
  contagem: { posts: 12, sem_leitura: 0, fora: 2 }, ...extra,
});

const LISTA = {
  sql_pendente: false,
  limite_por_papel: 6,
  captura_api: { disponivel: true, origem: "agencia", motivo: null },
  perfis: [perfilFalso("a", "referencia", "estudio.bonito"), perfilFalso("b", "concorrente", "rival.local")],
  mudancas: [{ id: "r1", perfil_id: "b", handle: "rival.local", tipo: "monitoramento", status: "ok", novos: 3, fora_da_curva: 1, ideias: [{ tema: "Resposta ao rival" }], resumo: null, iniciada_em: "2026-09-21T09:00:00Z", erro: null }],
};

describe("tela dos perfis", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    window.localStorage.clear();
  });

  it("seletor Referências | Concorrentes, Monitorar só nos concorrentes e o papel lembrado", async () => {
    mock.invoke.mockImplementation((_fn: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "listar") return Promise.resolve({ data: LISTA, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const tela = montar(h(PerfisDoInstagram));
    expect(await screen.findByText("@estudio.bonito")).toBeTruthy();
    expect(screen.queryByText("@rival.local")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Concorrentes/ }));
    expect(await screen.findByText("@rival.local")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Monitorar @rival.local/ })).toBeTruthy();
    expect(screen.getByText(/Resposta ao rival/)).toBeTruthy();
    tela.unmount();
    // Sair e voltar: continua em Concorrentes (useEstadoDaTela).
    montar(h(PerfisDoInstagram));
    expect(await screen.findByText("@rival.local")).toBeTruthy();
    const chave = Object.keys(window.localStorage).find((k) => k.indexOf(`mesa:perfis:papel:${CLIENTE}`) >= 0);
    expect(chave).toBeTruthy();
  });

  it("ligar o monitoramento chama a função com o perfil", async () => {
    mock.invoke.mockImplementation((_fn: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "listar") return Promise.resolve({ data: LISTA, error: null });
      return Promise.resolve({ data: { perfil: {} }, error: null });
    });
    montar(h(PerfisDoInstagram));
    await screen.findByText("@estudio.bonito");
    fireEvent.click(screen.getByRole("tab", { name: /Concorrentes/ }));
    fireEvent.click(await screen.findByRole("switch", { name: /Monitorar @rival.local/ }));
    await waitFor(() => {
      const chamada = mock.invoke.mock.calls.find((c) => c[1].body.acao === "monitorar");
      expect(chamada).toBeTruthy();
      expect(chamada![0]).toBe("perfis-instagram");
      expect(chamada![1].body).toMatchObject({ client_id: CLIENTE, perfil_id: "b", ligado: true });
    });
  });

  it("SQL pendente não quebra a tela", async () => {
    mock.invoke.mockResolvedValue({ data: { sql_pendente: true, aviso: "Falta o SQL.", perfis: [], mudancas: [], captura_api: { disponivel: false } }, error: null });
    montar(h(PerfisDoInstagram));
    expect(await screen.findByText("Falta o banco dos perfis")).toBeTruthy();
  });

  it("filtros da grade: formato, pilar e fora da curva", () => {
    const posts = [
      { id: "1", formato: "reel", pilar: "educar", fora_da_curva: true },
      { id: "2", formato: "carrossel", pilar: "vender", fora_da_curva: false },
      { id: "3", formato: "reel", pilar: "vender", fora_da_curva: false },
    ] as never[];
    expect(filtrarPosts(posts, { formato: "reel", pilar: "todos", fora: false }).map((p: any) => p.id)).toEqual(["1", "3"]);
    expect(filtrarPosts(posts, { formato: "todos", pilar: "vender", fora: false }).map((p: any) => p.id)).toEqual(["2", "3"]);
    expect(filtrarPosts(posts, { formato: "todos", pilar: "todos", fora: true }).map((p: any) => p.id)).toEqual(["1"]);
  });

  it("a seção Perfis do Instagram mora no Contexto da Mesa, com carga sob demanda", () => {
    const aba = ler("src/components/mesa/AbaContexto.tsx");
    expect(aba).toContain('id="ctx-perfis"');
    expect(aba).toContain('titulo="Perfis do Instagram"');
    expect(aba).toContain('lazy(() => import("@/components/perfis/PerfisDoInstagram"))');
    for (const p of ["src/components/perfis/PerfisDoInstagram.tsx", "src/components/perfis/PerfilAberto.tsx", "src/components/perfis/AgenteDoPerfil.tsx", "supabase/functions/_shared/perfis-instagram.ts"]) {
      const f = ler(p);
      expect(f, p).not.toMatch(/[—–]/);
      expect(f, p).not.toMatch(/\(\?<[=!]|\\p\{|\.at\(|Object\.hasOwn|aspect-ratio|crypto\.randomUUID/);
    }
  });
});
