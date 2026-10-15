import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lote C (09/10/2026): navegador remoto da Central (Browserbase). Teste isolado:
 * o provedor com fetch falso e a tela com a função falsa. Nada aqui abre sessão
 * de verdade (a conta do provedor ainda não existe).
 */

const api = vi.hoisted(() => ({ chamar: vi.fn() }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: api.chamar, textoDoErro: (e: unknown) => String((e as Error)?.message || e) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/vault/ClientVault", () => ({
  default: ({ clientId, canManage }: { clientId: string; canManage: boolean }) => h("div", { "data-testid": "cofre-falso" }, `${clientId}:${canManage}`),
}));
// Lista de clientes do seletor (quando a conversa não tem cliente): AcelerIQ só.
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (dados: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, f: (e: unknown) => unknown) => Promise.resolve({ data: dados, error: null }).then(ok, f);
    return b;
  };
  return { supabase: { from: (t: string) => consulta(t === "user_roles" ? [{ user_id: "22222222-2222-4222-8222-222222222222" }] : [{ id: "22222222-2222-4222-8222-222222222222", company_name: "AcelerIQ", full_name: null, email: null }]) } };
});

import { ErroDoProvedor, provedorBrowserbase } from "../../supabase/functions/navegador-remoto/provedor";
import NavegadorRemoto from "@/components/execucao/central/NavegadorRemoto";

// O jsdom não tem AbortSignal.timeout (o Deno da função tem).
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

type Chamada = { url: string; init: RequestInit };
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

describe("provedor Browserbase (fetch falso)", () => {
  it("cria o contexto do cliente e a sessão com o contexto persistente, na região us-east-1 e com a chave no cabeçalho", async () => {
    const chamadas: Chamada[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return url.endsWith("/contexts") ? resposta(201, { id: "ctx-1" }) : resposta(201, { id: "ses-1", status: "RUNNING" });
    }) as unknown as typeof fetch;
    const p = provedorBrowserbase("chave-teste", "proj-1", f);
    expect(await p.criarContexto("x")).toBe("ctx-1");
    expect(await p.criarSessao("ctx-1")).toBe("ses-1");
    const corpo = JSON.parse(String(chamadas[1].init.body));
    expect(corpo).toMatchObject({ projectId: "proj-1", keepAlive: true, timeout: 3600, region: "us-east-1", browserSettings: { context: { id: "ctx-1", persist: true } } });
    expect((chamadas[0].init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("chave-teste");
  });

  it("só com a API key (sem Project ID): o corpo não leva projectId e o encerrar manda só o status", async () => {
    const corpos: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      corpos.push({ url, corpo: init.body ? JSON.parse(String(init.body)) : {} });
      return url.endsWith("/contexts") ? resposta(201, { id: "ctx-9" }) : resposta(201, { id: "ses-9" });
    }) as unknown as typeof fetch;
    const p = provedorBrowserbase("k", null, f);
    await p.criarContexto("x");
    await p.criarSessao("ctx-9");
    await p.encerrar("ses-9");
    corpos.forEach((c) => expect(c.corpo).not.toHaveProperty("projectId"));
    expect(corpos[2].corpo).toEqual({ status: "REQUEST_RELEASE" });
  });

  it("plano gratuito recusa keepAlive: abre de novo sem ele e com 15 minutos", async () => {
    const corpos: Record<string, unknown>[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      corpos.push(b);
      return b.keepAlive ? resposta(400, { message: "keepAlive requires a paid plan" }) : resposta(201, { id: "ses-2" });
    }) as unknown as typeof fetch;
    expect(await provedorBrowserbase("k", "p", f).criarSessao("ctx")).toBe("ses-2");
    expect(corpos.map((c) => [c.keepAlive, c.timeout])).toEqual([[true, 3600], [false, 900]]);
  });

  it("chave recusada e limite do plano viram erro claro (sem tentar de novo)", async () => {
    const f401 = vi.fn(async () => resposta(401, {})) as unknown as typeof fetch;
    await expect(provedorBrowserbase("k", "p", f401).criarSessao("ctx")).rejects.toMatchObject({ codigo: "provedor_recusou" });
    expect(f401).toHaveBeenCalledTimes(1);
    const f429 = vi.fn(async () => resposta(429, {})) as unknown as typeof fetch;
    await expect(provedorBrowserbase("k", "p", f429).criarSessao("ctx")).rejects.toBeInstanceOf(ErroDoProvedor);
    expect(f429).toHaveBeenCalledTimes(1);
  });

  it("sessão viva devolve a tela ao vivo e as páginas; parada não finge página aberta", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/debug")) return resposta(200, { debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/x", pages: [{ id: "target-1", title: "Meta Business", url: "https://business.facebook.com/", debuggerFullscreenUrl: "https://x/p1" }] });
      return resposta(200, { status: url.includes("ses-viva") ? "RUNNING" : "COMPLETED" });
    }) as unknown as typeof fetch;
    const p = provedorBrowserbase("k", "p", f);
    expect(await p.verSessao("ses-viva")).toEqual({ rodando: true, ao_vivo: "https://www.browserbase.com/devtools-fullscreen/x", paginas: [{ id: "target-1", titulo: "Meta Business", url: "https://business.facebook.com/", ao_vivo: "https://x/p1" }] });
    expect(await p.verSessao("ses-parada")).toEqual({ rodando: false, ao_vivo: null, paginas: [] });
  });
});

function montar(cliente: { id: string; nome: string } | null, podeGerirCofre = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = (proximo: typeof cliente) => h(QueryClientProvider, { client: qc }, h(NavegadorRemoto, { cliente: proximo, podeGerirCofre }));
  const view = render(tela(cliente));
  return { ...view, qc, mudarCliente: (proximo: typeof cliente) => view.rerender(tela(proximo)) };
}

type PedidoFalso = { acao: string; cliente_id?: string; sessao_id?: string; acao_do_navegador?: string; aba_id?: string; url?: string };
function sessaoFalsa(id = "sessao-1", versao = 0) {
  return {
    id, rodando: true, ao_vivo: `https://www.browserbase.com/devtools-fullscreen/${id}?token=${versao}`,
    paginas: [
      { id: "target-1", titulo: "Facebook", url: "https://facebook.com", ao_vivo: `https://www.browserbase.com/devtools-fullscreen/${id}/target-1?token=${versao}` },
      { id: "target-2", titulo: "Instagram", url: "https://instagram.com", ao_vivo: `https://www.browserbase.com/devtools-fullscreen/${id}/target-2?token=${versao}` },
    ],
  };
}
function usarSessaoFalsa(ler: (pedido: PedidoFalso) => ReturnType<typeof sessaoFalsa>, agir?: (pedido: PedidoFalso) => Promise<unknown>) {
  api.chamar.mockImplementation(async (_fn: string, pedido: PedidoFalso) => {
    if (pedido.acao === "estado") return { configurado: true };
    if (pedido.acao === "acoes") return { acoes: [] };
    if (pedido.acao === "conta") return { projetos: [], abertas_agora: 1 };
    if (pedido.acao === "agir") return agir ? agir(pedido) : { resultado: { sessao_id: pedido.sessao_id, aba_id: pedido.aba_id } };
    return { sessao: ler(pedido), reaproveitada: false };
  });
}
function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}

describe("tela do navegador remoto (função falsa)", () => {
  beforeEach(() => {
    api.chamar.mockReset();
    try { localStorage.clear(); } catch { /* sem armazenamento */ }
  });

  it("sem a conta do provedor: diz que não está ligado e não abre nada", async () => {
    api.chamar.mockResolvedValue({ configurado: false });
    montar({ id: "c1", nome: "AcelerIQ" });
    expect(await screen.findByText("O navegador remoto ainda não está ligado.")).toBeTruthy();
    expect(api.chamar.mock.calls.every((c) => (c[1] as { acao: string }).acao === "estado")).toBe(true);
  });

  it("ligado e sem cliente na conversa: pede o cliente e o seletor libera o navegador dele", async () => {
    api.chamar.mockResolvedValue({ configurado: true });
    montar(null);
    expect(await screen.findByText(/cada cliente tem o próprio navegador/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cliente/ }));
    fireEvent.click(await screen.findByText("AcelerIQ"));
    expect(await screen.findByRole("button", { name: "Abrir o navegador de AcelerIQ" })).toBeTruthy();
  });

  it("ligado com cliente: abre a sessão do cliente e mostra a tela ao vivo isolada no iframe", async () => {
    api.chamar.mockImplementation(async (_f: string, b: { acao: string; cliente_id?: string }) => {
      if (b.acao === "estado") return { configurado: true };
      if (b.acao === "abrir") return { sessao: { id: "11111111-1111-4111-8111-111111111111", rodando: true, ao_vivo: "https://www.browserbase.com/devtools-fullscreen/x", paginas: [{ titulo: "Google", url: "https://google.com" }] }, reaproveitada: false };
      return { sessao: { id: "11111111-1111-4111-8111-111111111111", rodando: true, ao_vivo: "https://www.browserbase.com/devtools-fullscreen/x", paginas: [{ titulo: "Google", url: "https://google.com" }] } };
    });
    montar({ id: "22222222-2222-4222-8222-222222222222", nome: "AcelerIQ" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de AcelerIQ" }));
    const quadro = (await screen.findByTitle("Navegador remoto de AcelerIQ")) as HTMLIFrameElement;
    expect(quadro.getAttribute("src")).toBe("https://www.browserbase.com/devtools-fullscreen/x");
    expect(quadro.getAttribute("referrerpolicy")).toBe("no-referrer");
    const abrir = api.chamar.mock.calls.find((c) => (c[1] as { acao: string }).acao === "abrir");
    expect(abrir && abrir[1]).toEqual({ acao: "abrir", cliente_id: "22222222-2222-4222-8222-222222222222", origem: "central" });
  });
  it("mantém o mesmo iframe e src após consultas equivalentes a mais de 30 segundos de polling", async () => {
    let versao = 0;
    usarSessaoFalsa(() => sessaoFalsa("sessao-polling", versao));
    const { qc } = montar({ id: "cliente-polling", nome: "Casa dos Assados" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de Casa dos Assados" }));
    const quadro = await screen.findByTitle("Navegador remoto de Casa dos Assados");
    const src = quadro.getAttribute("src");
    const inicio = Date.now();
    const relogio = vi.spyOn(Date, "now");
    try {
      for (versao = 1; versao <= 3; versao++) {
        relogio.mockReturnValue(inicio + versao * 15_000);
        await act(async () => { await qc.invalidateQueries({ queryKey: ["navegador-remoto", "sessao"] }); });
        await waitFor(() => expect(qc.getQueryData(["navegador-remoto", "sessao", "cliente-polling", "sessao-polling"])).toMatchObject({
          paginas: [expect.objectContaining({ ao_vivo: expect.stringContaining(`token=${versao}`) }), expect.anything()],
        }));
        expect(screen.getByTitle("Navegador remoto de Casa dos Assados")).toBe(quadro);
        expect(quadro.getAttribute("src")).toBe(src);
      }
    } finally { relogio.mockRestore(); }
  });

  it("amplia e reduz no mesmo iframe, inclusive ao fechar a ampliação com Escape", async () => {
    usarSessaoFalsa(() => sessaoFalsa());
    montar({ id: "cliente-ampliacao", nome: "Casa dos Assados" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de Casa dos Assados" }));
    const quadro = await screen.findByTitle("Navegador remoto de Casa dos Assados");
    const src = quadro.getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Ampliar navegador remoto" }));
    const dialogo = screen.getByRole("dialog", { name: "Navegador de Casa dos Assados ampliado" });
    expect(dialogo.contains(quadro)).toBe(true);
    expect(screen.getByTitle("Navegador remoto de Casa dos Assados")).toBe(quadro);
    fireEvent.click(screen.getByRole("button", { name: "Reduzir navegador remoto" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("Navegador remoto de Casa dos Assados")).toBe(quadro);
    fireEvent.click(screen.getByRole("button", { name: "Ampliar navegador remoto" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("Navegador remoto de Casa dos Assados")).toBe(quadro);
    expect(quadro.getAttribute("src")).toBe(src);
  });

  it("distingue abas com a mesma URL por ID e preserva a selecionada após reordenação", async () => {
    let invertidas = false;
    usarSessaoFalsa(() => {
      const sessao = sessaoFalsa();
      sessao.paginas = sessao.paginas.map((pagina) => ({ ...pagina, titulo: "Facebook", url: "https://facebook.com" }));
      if (invertidas) sessao.paginas.reverse();
      return sessao;
    });
    const { qc } = montar({ id: "cliente-abas", nome: "Casa dos Assados" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de Casa dos Assados" }));
    await screen.findByTitle("Navegador remoto de Casa dos Assados");
    fireEvent.click(screen.getAllByRole("tab", { name: "Facebook" })[1]);
    await waitFor(() => expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true"));
    expect(api.chamar).toHaveBeenCalledWith("navegador-remoto", expect.objectContaining({
      acao_do_navegador: "ativar_aba", sessao_id: "sessao-1", aba_id: "target-2",
    }));
    const quadro = screen.getByTitle("Navegador remoto de Casa dos Assados");
    const src = quadro.getAttribute("src");
    expect(src).toContain("target-2");
    invertidas = true;
    await act(async () => { await qc.invalidateQueries({ queryKey: ["navegador-remoto", "sessao"] }); });
    await waitFor(() => expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true"));
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTitle("Navegador remoto de Casa dos Assados")).toBe(quadro);
    expect(quadro.getAttribute("src")).toBe(src);
  });

  it.each(["cliente", "sessão"])("ignora a criação atrasada de aba quando muda o contexto de %s", async (mudanca) => {
    const atrasada = pendente<{ resultado: { sessao_id: string; aba_id: string } }>();
    let sessaoAtual = sessaoFalsa("sessao-antiga");
    usarSessaoFalsa(() => sessaoAtual, () => atrasada.promessa);
    const { qc, mudarCliente } = montar({ id: "cliente-antigo", nome: "Cliente antigo" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de Cliente antigo" }));
    await screen.findByTitle("Navegador remoto de Cliente antigo");
    fireEvent.click(screen.getByRole("button", { name: "Nova aba" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Endereço da nova aba" }), { target: { value: "https://business.facebook.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await waitFor(() => expect(api.chamar).toHaveBeenCalledWith("navegador-remoto", expect.objectContaining({ acao_do_navegador: "nova_aba" })));
    sessaoAtual = sessaoFalsa("sessao-nova");
    const nome = mudanca === "cliente" ? "Cliente novo" : "Cliente antigo";
    if (mudanca === "cliente") mudarCliente({ id: "cliente-novo", nome });
    else await act(async () => { qc.setQueryData(["navegador-remoto", "sessao", "cliente-antigo", "sessao-antiga"], { ...sessaoFalsa("sessao-antiga"), rodando: false }); });
    fireEvent.click(await screen.findByRole("button", { name: `Abrir o navegador de ${nome}` }));
    const quadro = await screen.findByTitle(`Navegador remoto de ${nome}`);
    await waitFor(() => expect(quadro.getAttribute("src")).toContain("sessao-nova"));
    const src = quadro.getAttribute("src");
    await act(async () => { atrasada.resolver({ resultado: { sessao_id: "sessao-antiga", aba_id: "target-2" } }); await atrasada.promessa; });
    await waitFor(() => expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true"));
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTitle(`Navegador remoto de ${nome}`)).toBe(quadro);
    expect(quadro.getAttribute("src")).toBe(src);
  });

  it.each([false, true])("só apresenta o cofre quando a permissão administrativa é %s", async (podeGerir) => {
    usarSessaoFalsa(() => sessaoFalsa());
    montar({ id: "cliente-cofre", nome: "Casa dos Assados" }, podeGerir);
    await screen.findByRole("button", { name: "Abrir o navegador de Casa dos Assados" });
    const cofre = screen.queryByRole("button", { name: "Abrir cofre de Casa dos Assados" });
    expect(Boolean(cofre)).toBe(podeGerir);
    if (cofre) {
      fireEvent.click(cofre);
      expect((await screen.findByTestId("cofre-falso")).textContent).toBe("cliente-cofre:true");
    } else expect(screen.queryByTestId("cofre-falso")).toBeNull();
  });

  it("mantém as abas visíveis e usa o mesmo perfil para ativar e criar outra", async () => {
    const clienteId = "22222222-2222-4222-8222-222222222222";
    const sessaoId = "11111111-1111-4111-8111-111111111111";
    api.chamar.mockImplementation(async (_fn: string, b: { acao: string; acao_do_navegador?: string }) => {
      if (b.acao === "estado") return { configurado: true };
      if (b.acao === "abrir" || b.acao === "ver") return { sessao: {
        id: sessaoId, rodando: true, ao_vivo: "https://www.browserbase.com/devtools-fullscreen/main",
        paginas: [
          { id: "target-1", titulo: "Facebook", url: "https://facebook.com", ao_vivo: "https://www.browserbase.com/devtools-fullscreen/tab-1" },
          { id: "target-2", titulo: "Instagram", url: "https://instagram.com", ao_vivo: "https://www.browserbase.com/devtools-fullscreen/tab-2" },
        ],
      } };
      if (b.acao === "agir") return { resultado: { sessao_id: sessaoId, aba_id: "target-2" } };
      return {};
    });
    montar({ id: clienteId, nome: "Casa dos Assados" });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o navegador de Casa dos Assados" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Instagram" }));
    await waitFor(() => expect(api.chamar).toHaveBeenCalledWith("navegador-remoto", expect.objectContaining({
      acao: "agir", acao_do_navegador: "ativar_aba", cliente_id: clienteId, sessao_id: sessaoId, aba_id: "target-2",
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Nova aba" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Endereço da nova aba" }), { target: { value: "https://business.facebook.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await waitFor(() => expect(api.chamar.mock.calls.some((call) => (call[1] as { acao?: string; acao_do_navegador?: string; url?: string }).acao_do_navegador === "nova_aba"
      && (call[1] as { url?: string }).url === "https://business.facebook.com")).toBe(true));
  });

});
