import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { projetoDosTakes } from "../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Tela do editor de vídeo (frente V-B): monta de verdade (linha do tempo,
 * atalhos, desfazer e salvamento automático) com a função e o Storage
 * simulados. O Player do Remotion é trocado por uma caixa (o jsdom não toca
 * vídeo); a composição é testada à parte pela lógica.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, falha: any) => Promise.resolve({ data: [], error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: () => consulta(),
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/v.mp4" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/${p}`, error: null })), error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@remotion/player", () => ({
  Player: () => h("div", { "data-player-falso": "" }),
}));

import EditorDeVideo from "@/components/mesa-edicao/editor/EditorDeVideo";
import AreaDoEditor from "@/components/mesa-edicao/AreaDoEditor";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const VERSAO = "22222222-2222-4222-8222-222222222222";

const valor = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Café Sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function projeto() {
  return projetoDosTakes({
    titulo: "Reel",
    fps: 25,
    takes: [
      { id: "a", nome: "IMG_1.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mov`, cena_ref: null, melhor: true, duracao_s: 10, largura: 1080, altura: 1920 },
      { id: "b", nome: "IMG_2.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, cena_ref: null, melhor: true, duracao_s: 6, largura: 1080, altura: 1920 },
    ],
  });
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-edicao?client=${CLIENTE}&etapa=editar`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(EditorDeVideo, { versaoId: VERSAO, projetoInicial: projeto(), revisao: 2 }) })))),
  );
}

const salvamentos = () => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-videos" && c[1].body.acao === "projeto_salvar").map((c: any[]) => c[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "projeto_salvar" ? { versao: { projeto: { revisao: body.revisao_lida + 1 } } } : {}, error: null }));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  // Navegador atual (o jsdom não tem estes dois).
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).CSS = { supports: () => true };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});
afterEach(() => vi.useRealTimers());

describe("tela do editor de vídeo", () => {
  it("abre com a linha do tempo (apelidos), sem chamar a função; tirar um clipe salva UMA vez com a revisão lida; Ctrl+Z volta e salva de novo", async () => {
    montar();
    expect(document.querySelector('[data-editor-de-video="completo"]')).toBeTruthy();
    expect(document.querySelector('[data-apelido="c1"]')).toBeTruthy();
    expect(document.querySelector('[data-apelido="c2"]')).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();

    // Seleciona c2 (clique sem arrastar) e tira com Delete.
    const c2 = document.querySelector('[data-apelido="c2"]') as HTMLElement;
    fireEvent.mouseDown(c2, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(window, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(document.querySelector('[data-inspector="v2"]')).toBeTruthy());
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(document.querySelector('[data-apelido="c2"]')).toBeNull());
    await waitFor(() => expect(salvamentos()).toHaveLength(1), { timeout: 4000 });
    expect(salvamentos()[0].revisao_lida).toBe(2);
    expect(salvamentos()[0].projeto.trilhas[0].clipes.map((c: any) => c.id)).toEqual(["v1"]);

    // Desfazer: volta o clipe e grava de novo (com a revisão nova).
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(document.querySelector('[data-apelido="c2"]')).toBeTruthy());
    await waitFor(() => expect(salvamentos()).toHaveLength(2), { timeout: 4000 });
    expect(salvamentos()[1].revisao_lida).toBe(3);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1800));
    });
    expect(salvamentos()).toHaveLength(2);
    expect(document.querySelector('[data-salvamento="salvo"]')).toBeTruthy();
  }, 20000);

  it("skills: a proposta aparece no cartão e só muda com Confirmar", async () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    const cartao = document.querySelector('[data-skill="fechar_buracos"]') as HTMLElement;
    expect(cartao).toBeTruthy();
    fireEvent.click(document.querySelector('[data-skill="punch_in"] button:last-child') as HTMLElement);
    expect(await screen.findByRole("button", { name: "Confirmar" })).toBeTruthy();
    expect(document.querySelector('[data-apelido="c1"]')!.textContent).not.toContain("zoom");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(document.querySelector('[data-apelido="c1"]')!.textContent).toContain("zoom 1.12"));
  });

  it("área do editor: sem versão, abre direto criando a versão rascunho com o projeto uma vez só (sem gasto)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AreaDoEditor, { projeto: projeto(), roteiroId: null }) })))));
    await waitFor(() => expect(document.querySelector('[data-area-do-editor="reservada"]')).toBeTruthy());
    // Frente Q (26/09): sem clique em "Editar"; a versão nasce sozinha e a montagem fica à vista enquanto abre.
    await waitFor(() => expect(mock.invoke.mock.calls.filter((c: any[]) => c[1].body.acao === "versao_registrar")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(mock.invoke.mock.calls.filter((c: any[]) => c[1].body.acao === "versao_registrar")).toHaveLength(1);
    const corpo = mock.invoke.mock.calls.find((c: any[]) => c[1].body.acao === "versao_registrar")![1].body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, estado: "rascunho" });
    expect(corpo.projeto.formato_versao).toBe(2);
    expect(corpo.projeto.trilhas[0].clipes).toHaveLength(2);
  });
});
