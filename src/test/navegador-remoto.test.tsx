import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      if (url.endsWith("/debug")) return resposta(200, { debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/x", pages: [{ title: "Meta Business", url: "https://business.facebook.com/", debuggerFullscreenUrl: "https://x/p1" }] });
      return resposta(200, { status: url.includes("ses-viva") ? "RUNNING" : "COMPLETED" });
    }) as unknown as typeof fetch;
    const p = provedorBrowserbase("k", "p", f);
    expect(await p.verSessao("ses-viva")).toEqual({ rodando: true, ao_vivo: "https://www.browserbase.com/devtools-fullscreen/x", paginas: [{ titulo: "Meta Business", url: "https://business.facebook.com/", ao_vivo: "https://x/p1" }] });
    expect(await p.verSessao("ses-parada")).toEqual({ rodando: false, ao_vivo: null, paginas: [] });
  });
});

function montar(cliente: { id: string; nome: string } | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(NavegadorRemoto, { cliente })));
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
});
