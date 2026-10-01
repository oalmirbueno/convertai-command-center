import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PropostaPublica from "@/pages/PropostaPublica";
import { conteudoDoModelo, comBloco, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";
import { MESAS, MESAS_FORA_DO_SELETOR, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { MESAS_DO_PAINEL, cargasDaMesa } from "@/lib/mesa/preCarga";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import { entraPeloPadrao } from "@/components/mesa/clientesDaMesa";
import { AREAS_DO_PAINEL, AGENTES_DO_PAINEL } from "../../supabase/functions/_shared/mapa-do-painel";
import { MESAS_QUE_APRENDEM } from "../../supabase/functions/_shared/aprendizado-das-mesas";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const TOKEN = "a".repeat(64);
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function propostaPublica(extra: Record<string, unknown> = {}) {
  const conteudo = comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Mais pedidos pelo Instagram", subtitulo: "", projeto: "Redes" } });
  return {
    proposta: {
      id: "p1",
      numero: "2026-001",
      titulo: "Redes sociais",
      status: "enviada",
      validade_ate: hojeMais(10),
      enviada_em: "2026-09-30T12:00:00Z",
      conteudo,
      itens: [{ id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" }],
      total_unico: 0,
      total_mensal: 1800,
      cliente: "Loja da Joana",
      aceite: null,
      ...extra,
    },
    agencia: { nome: "Aceleriq" },
    logo_cliente_url: null,
  };
}

function montar() {
  return render(
    <MemoryRouter initialEntries={[`/proposta/${TOKEN}`]}>
      <Routes>
        <Route path="/proposta/:token" element={<PropostaPublica />} />
      </Routes>
    </MemoryRouter>,
  );
}

let chamadas: Array<{ url: string; corpo: any }> = [];

function mockFetch(get: unknown, respostaDoPost: (corpo: any) => unknown = () => ({ ok: true })) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const corpo = init && init.body ? JSON.parse(String(init.body)) : null;
      chamadas.push({ url: String(url), corpo });
      const dados = init && init.method === "POST" ? respostaDoPost(corpo) : get;
      return { ok: !(dados && (dados as any).error), json: async () => dados } as Response;
    }),
  );
}

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("link público /proposta/:token", () => {
  it("mostra a proposta, registra a abertura com a sessão e o preço sai dos itens", async () => {
    mockFetch(propostaPublica());
    montar();
    expect(await screen.findByText("Mais pedidos pelo Instagram")).toBeTruthy();
    expect(screen.getByText("R$ 1.800,00 por mês")).toBeTruthy();
    await waitFor(() => expect(chamadas.some((c) => c.corpo && c.corpo.tipo === "aberta")).toBe(true));
    const aberta = chamadas.find((c) => c.corpo && c.corpo.tipo === "aberta")!;
    expect(aberta.corpo.token).toBe(TOKEN);
    expect(String(aberta.corpo.sessao).length).toBeGreaterThanOrEqual(8);
    // Nada de dado pessoal no endereço: o GET leva só o token.
    expect(chamadas[0].url).toContain(`token=${TOKEN}`);
    expect(screen.getByRole("button", { name: "Baixar PDF" })).toBeTruthy();
  });

  it("o aceite pede nome, e-mail e a caixa, e manda pelo token", async () => {
    mockFetch(propostaPublica(), (corpo) => (corpo && corpo.aceitar ? { ok: true, aceita_em: "2026-10-01T10:00:00Z", ja_aceita: false, contrato: "pendente" } : { ok: true }));
    montar();
    await screen.findByText("Mais pedidos pelo Instagram");
    fireEvent.click(screen.getByRole("button", { name: "Aceitar proposta" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(chamadas.some((c) => c.corpo && c.corpo.aceitar)).toBe(false);
    fireEvent.change(screen.getByLabelText("Seu nome completo"), { target: { value: "Joana Lima" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "joana@loja.com.br" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aceitar proposta" }));
    });
    const aceite = chamadas.find((c) => c.corpo && c.corpo.aceitar)!;
    expect(aceite.corpo).toEqual({ token: TOKEN, aceitar: { nome: "Joana Lima", email: "joana@loja.com.br", aceito: true } });
    expect(await screen.findByText(/Proposta aceita por Joana Lima/)).toBeTruthy();
  });

  it("depois da validade não mostra o aceite", async () => {
    mockFetch(propostaPublica({ validade_ate: hojeMais(-2), status: "vista" }));
    montar();
    await screen.findByText("Mais pedidos pelo Instagram");
    expect(screen.queryByRole("button", { name: "Aceitar proposta" })).toBeNull();
    expect(screen.getByText(/validade desta proposta terminou/)).toBeTruthy();
  });

  it("link inválido ou recusado pelo servidor", async () => {
    mockFetch({ error: "link_invalido" });
    montar();
    expect(await screen.findByText("Link indisponível")).toBeTruthy();
  });

  // Frente UXS: falha de rede ou do servidor não é link ruim.
  it("servidor indisponível ou rede caída mostram 'Não abriu agora.' e não 'Link indisponível'", async () => {
    mockFetch({ error: "indisponivel" });
    const { unmount } = montar();
    expect(await screen.findByText("Não abriu agora.")).toBeTruthy();
    expect(screen.queryByText("Link indisponível")).toBeNull();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    montar();
    expect(await screen.findByText("Não abriu agora.")).toBeTruthy();
    expect(screen.queryByText("Link indisponível")).toBeNull();
  });

  it("Tentar de novo lê de novo e, com sucesso, abre a proposta com uma única abertura", async () => {
    chamadas = [];
    let get = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const corpo = init && init.body ? JSON.parse(String(init.body)) : null;
        chamadas.push({ url: String(url), corpo });
        if (init && init.method === "POST") return { ok: true, json: async () => ({ ok: true }) } as Response;
        get += 1;
        if (get === 1) throw new TypeError("Failed to fetch");
        return { ok: true, json: async () => propostaPublica() } as Response;
      }),
    );
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Mais pedidos pelo Instagram")).toBeTruthy();
    expect(get).toBe(2);
    await waitFor(() => expect(chamadas.filter((c) => c.corpo && c.corpo.tipo === "aberta")).toHaveLength(1));
  });

  it("link inválido com o WhatsApp da agência oferece 'Falar com a Aceleriq' (sem token no texto); sem ele, não", async () => {
    mockFetch({ error: "link_invalido", agencia: { nome: "Aceleriq", whatsapp: "(41) 99999-0000" } });
    const { unmount } = montar();
    expect(await screen.findByText("Link indisponível")).toBeTruthy();
    const falar = screen.getByRole("link", { name: "Falar com a Aceleriq" }) as HTMLAnchorElement;
    expect(falar.href).toContain("wa.me/5541999990000");
    expect(falar.href).not.toContain(TOKEN);
    unmount();
    mockFetch({ error: "link_invalido", agencia: { nome: "Aceleriq" } });
    montar();
    expect(await screen.findByText("Link indisponível")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Falar com a Aceleriq" })).toBeNull();
  });

  it("o tempo de leitura sobe na mesma sessão a cada 15 s com a página à vista", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch(propostaPublica());
    montar();
    await screen.findByText("Mais pedidos pelo Instagram");
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    const leituras = chamadas.filter((c) => c.corpo && c.corpo.tipo === "leitura");
    expect(leituras.length).toBeGreaterThanOrEqual(2);
    expect(leituras[leituras.length - 1].corpo.segundos).toBeGreaterThanOrEqual(30);
    const sessoes = new Set(chamadas.filter((c) => c.corpo && c.corpo.sessao).map((c) => c.corpo.sessao));
    expect(sessoes.size).toBe(1);
  });
});

describe("banco: RPCs por token e RLS", () => {
  const sql = ler("supabase/migrations/20260930020000_propostas.sql");

  it("as três RPCs públicas são security definer e só o service_role executa", () => {
    for (const f of ["proposta_publica_ler", "proposta_publica_evento", "proposta_publica_aceitar"]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${f}(`);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
    }
    expect(sql.match(/SECURITY DEFINER/g)!.length).toBe(3);
    expect(sql.match(/IF auth\.role\(\) IS DISTINCT FROM 'service_role' THEN/g)!.length).toBe(3);
  });

  it("aceite confere status e validade (dia de São Paulo), guarda o hash e é idempotente", () => {
    const aceitar = sql.slice(sql.indexOf("FUNCTION public.proposta_publica_aceitar"));
    expect(aceitar).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(aceitar).toContain("IF _p.status = 'aceita' THEN");
    expect(aceitar).toContain("'ja_aceita', true");
    expect(aceitar).toContain("RAISE EXCEPTION 'proposal expired'");
    expect(aceitar).toContain("'hash', _p.hash_enviado");
    expect(aceitar).toContain("'aceita'");
  });

  it("rastreio: uma linha por sessão, tempo com teto de 4 h, primeira abertura marca vista", () => {
    expect(sql).toContain("proposta_eventos_abertura_por_sessao");
    expect(sql).toContain("least(greatest(coalesce(p_segundos, 0), 0), 14400)");
    expect(sql).toContain("CASE WHEN status = 'enviada' THEN 'vista' ELSE status END");
  });

  it("RLS: só admin e gestor com acesso ao cliente leem; ninguém escreve pela API", () => {
    for (const t of ["propostas", "proposta_versoes", "proposta_eventos"]) expect(sql).toMatch(new RegExp(`ON public\\.${t}\\s+FOR SELECT TO authenticated\\s+USING \\(\\s+\\(public\\.has_role[\\s\\S]*?can_access_client\\(client_id\\)`));
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.proposta_modelos, public.propostas, public.proposta_versoes, public.proposta_eventos FROM authenticated;");
    expect(sql).not.toMatch(/USING \(true\)/i);
    expect(sql).toContain("'proposta'");
  });
});

describe("a mesa no painel", () => {
  it("está na lista de mesas, na pré-carga (fora da ociosa), no mapa, no aprendizado e fora dos lugares", () => {
    // PRO3 (30/09): a Proposta saiu do seletor de mesas; a rota continua e entra por Clientes.
    expect(MESAS.some((m) => m.valor === "proposta")).toBe(false);
    expect(MESAS_FORA_DO_SELETOR.some((m) => m.valor === "proposta" && m.caminho === "/mesa-proposta")).toBe(true);
    expect(enderecoDaMesa("proposta", "22222222-2222-4222-8222-222222222222")).toBe("/mesa-proposta?client=22222222-2222-4222-8222-222222222222");
    // PRS: a quinta etapa, Acompanhar, também é pré-carregada.
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-proposta"].etapas)).toEqual(["contexto", "rascunho", "revisao", "envio", "acompanhar"]);
    expect(cargasDaMesa("/mesa-proposta", "?client=22222222-2222-4222-8222-222222222222").map(([k]) => k)).toEqual(["pagina/mesa-proposta", "mesa-proposta/contexto", "mesa-proposta/agente"]);
    const pre = ler("src/lib/mesa/preCarga.ts");
    const primeiras = pre.slice(pre.indexOf("const PRIMEIRAS"), pre.indexOf("];", pre.indexOf("const PRIMEIRAS")));
    expect(primeiras).not.toContain("/mesa-proposta");
    expect(AREAS_DO_PAINEL.some((a) => a.chave === "mesa_proposta" && a.rota === "/mesa-proposta")).toBe(true);
    expect(AGENTES_DO_PAINEL.some((g) => g.chave === "proposta" && g.funcao === "mesa-proposta")).toBe(true);
    expect((MESAS_QUE_APRENDEM as readonly string[]).indexOf("proposta")).toBeGreaterThanOrEqual(0);
    expect(rotuloDoLugar(`/proposta/${TOKEN}`, "")).toBeNull();
    expect(entraPeloPadrao("proposta", { id: "x", plan_status: "inactive", client_type: "one_off" }).entra).toBe(true);
  });

  it("proposta-publica: o 404 do link que não existe leva a agência, lida sem virar 500 (frente UXS)", () => {
    const fonte = ler("supabase/functions/proposta-publica/index.ts");
    const trecho = fonte.slice(fonte.indexOf("if (!data) {"), fonte.indexOf('return json({ error: "link_invalido", agencia: agenciaDoLink }, 404);'));
    expect(trecho).toContain("try {");
    expect(trecho).toContain("registrarFalha(");
    expect(fonte).toContain('return json({ error: "link_invalido", agencia: agenciaDoLink }, 404);');
    // O token com formato ruim continua saindo sem ir ao banco.
    expect(fonte).toContain('if (!TOKEN_OK.test(token)) return json({ error: "link_invalido" }, 404);');
  });

  it("rotas: a mesa só para admin e gestor; o link público fora do login; funções no config", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/proposta/:token" element={<PropostaPublica />} />');
    expect(app).toMatch(/path="\/mesa-proposta" element=\{<>\{\["admin", "manager"\]\.includes/);
    const cfg = ler("supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.mesa-proposta\]\s+verify_jwt = true/);
    expect(cfg).toMatch(/\[functions\.proposta-publica\]\s+verify_jwt = false/);
    // PRO3: a ficha abre a proposta pela seção Propostas (o endereço sai de propostasDaCarteira).
    expect(ler("src/components/admin/EditClientDrawer.tsx")).toContain("<PropostasDoCliente");
    expect(ler("src/components/clientes-propostas/propostasDaCarteira.ts")).toContain("/mesa-proposta?client=");
    expect(ler("src/pages/AdminComercial.tsx")).toContain("/mesa-proposta?lead=");
  });

  it("o documento da proposta não usa fonte fora da escala nem caixa alta nas telas (o tema mora no CSS)", () => {
    const doc = ler("src/components/mesa-proposta/PropostaDocumento.tsx");
    expect(doc).not.toMatch(/text-\[\d+px\]/);
    expect(doc).not.toContain("uppercase");
    const css = ler("src/components/mesa-proposta/proposta-documento.css");
    expect(css).toContain("size: A4 portrait");
    expect(css).not.toMatch(/clamp\(|aspect-ratio/);
  });
});
