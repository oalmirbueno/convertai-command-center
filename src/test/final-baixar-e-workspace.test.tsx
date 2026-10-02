import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Edição (02/10): depois do render, Baixar (nome do final), Salvar no
 * celular (compartilhamento do sistema, com o download de reserva), Abrir no
 * Workspace e o download sozinho com o editor aberto (preferência "Baixar
 * sozinho ao terminar", ligada por padrão). Funções e Storage simulados.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown>, assinados: [] as any[] }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: dados, error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: (bucket: string) => ({
          list: () => Promise.resolve({ data: [], error: null }),
          createSignedUrl: (caminho: string, s: number, o?: { download?: string }) => {
            mock.assinados.push({ bucket, caminho, s, download: o && o.download });
            return Promise.resolve({ data: { signedUrl: `https://arquivo.test/${caminho}?d=${encodeURIComponent((o && o.download) || "")}` }, error: null });
          },
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import Finais from "@/components/mesa-edicao/Finais";
import Renderizar from "@/components/mesa-edicao/editor/Renderizar";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { _limparVigias, marcarRenderAtivo } from "@/lib/editor/render";
import { baixarAoTerminar, CHAVE_DO_BAIXAR_SOZINHO, ehCelular, nomeDoPedido, nomeParaBaixar, podeSalvarNoCelular, ROTA_DO_BAIXAR_SOZINHO, salvarNoCelular } from "@/lib/edicao/baixarFinal";
import { projetoDosTakes } from "../../supabase/functions/_shared/projeto-de-edicao";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const RENDER = "aaaaaaaa-0000-4000-8000-000000000009";
const AMOSTRA = "aaaaaaaa-0000-4000-8000-000000000008";
const PEDIDO = "bbbbbbbb-0000-4000-8000-000000000001";
const VERSAO = "cccccccc-0000-4000-8000-000000000001";

const base = { client_id: CLIENTE, storage_bucket: "mesa", estado: "ativo", melhor: false, grupo: null, roteiro_id: null, cena_ref: null, mime: "video/mp4" };
const ARQUIVOS = [
  { ...base, id: RENDER, nome: "Depoimento v2 (render 9:16)", nome_original: "r.mp4", storage_path: `${CLIENTE}/video/render/${PEDIDO}.mp4`, tipo: "render", duracao_s: 30, criado_em: "2026-10-02T11:00:00Z", origem: { render_pedido_id: PEDIDO, versao_id: "v", formato: "9:16", legenda: { srt_path: `${CLIENTE}/video/render/${PEDIDO}.srt`, vtt_path: `${CLIENTE}/video/render/${PEDIDO}.vtt`, linhas: 3 } } },
  { ...base, id: AMOSTRA, nome: "Depoimento v2 (amostra 9:16)", nome_original: "a.mp4", storage_path: `${CLIENTE}/video/render/amostras/x.mp4`, tipo: "amostra", duracao_s: 12, criado_em: "2026-10-02T10:00:00Z", origem: { render_pedido_id: "outro", versao_id: "v" } },
];

const valorDaMesa = (): MesaValor => ({
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

function Onde() {
  const l = useLocation();
  return h("p", { "data-onde": `${l.pathname}${l.search}` });
}

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: [`/mesa-edicao?client=${CLIENTE}`] },
        h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(Routes, null, h(Route, { path: "/mesa-edicao", element: filho }), h(Route, { path: "/workspace", element: h(Onde) })) })),
      ),
    ),
  );
}

const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
let cliques: { href: string; download: string }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mock.assinados = [];
  mock.tabelas = { video_arquivos: ARQUIVOS, video_pedidos: [], video_versoes: [] };
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  cliques = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    cliques.push({ href: this.href, download: this.download });
  });
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("regras de baixar", () => {
  it("nome do final e do pedido", () => {
    expect(nomeParaBaixar("Depoimento v2 (render 9:16)")).toBe("Depoimento v2 (final 9x16).mp4");
    expect(nomeParaBaixar("Depoimento v2 (render 9:16)", "srt")).toBe("Depoimento v2 (final 9x16).srt");
    expect(nomeParaBaixar("a/b: c")).toBe("a-b- c.mp4");
    expect(nomeDoPedido("Reel", { tipo: "render_final", entrada: { formato: "1:1" } })).toBe("Reel (final 1x1).mp4");
    expect(nomeDoPedido("Reel", { tipo: "amostra", entrada: {} })).toBe("Reel (amostra).mp4");
  });

  it("baixar sozinho: só o vídeo inteiro pronto e só com a preferência ligada", async () => {
    const baixar = vi.fn();
    const assinar = vi.fn(async () => "https://x/assinado");
    const pronto = { tipo: "render_final", estado: "pronto", saida_path: "c/v.mp4", url: "https://x/fila" };
    expect(await baixarAoTerminar(pronto, "a.mp4", false, { baixar, assinar })).toBe(false);
    expect(await baixarAoTerminar({ ...pronto, tipo: "amostra" }, "a.mp4", true, { baixar, assinar })).toBe(false);
    expect(await baixarAoTerminar({ ...pronto, estado: "erro" }, "a.mp4", true, { baixar, assinar })).toBe(false);
    expect(baixar).not.toHaveBeenCalled();
    expect(await baixarAoTerminar(pronto, "a.mp4", true, { baixar, assinar })).toBe(true);
    expect(assinar).toHaveBeenCalledWith("mesa", "c/v.mp4", "a.mp4");
    expect(baixar).toHaveBeenLastCalledWith("https://x/assinado", "a.mp4");
    // Sem o link com nome, o link da fila.
    expect(await baixarAoTerminar(pronto, "a.mp4", true, { baixar, assinar: vi.fn(async () => Promise.reject(new Error("x"))) })).toBe(true);
    expect(baixar).toHaveBeenLastCalledWith("https://x/fila", "a.mp4");
  });

  it("celular: compartilha o arquivo; sem compartilhamento de arquivo, baixa; toque vencido pede outro toque", async () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" };
    expect(ehCelular(iphone)).toBe(true);
    expect(ehCelular({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe(false);
    expect(podeSalvarNoCelular(iphone)).toBe(false);
    const share = vi.fn(async () => undefined);
    const nav = { ...iphone, share, canShare: () => true };
    expect(podeSalvarNoCelular(nav)).toBe(true);
    const buscar = vi.fn(async () => new Response(new Blob(["mp4"], { type: "video/mp4" })));
    expect((await salvarNoCelular("https://x/v.mp4", "v.mp4", { nav, buscar: buscar as unknown as typeof fetch })).resultado).toBe("compartilhado");
    expect((share.mock.calls[0] as any[])[0].files[0].name).toBe("v.mp4");

    expect((await salvarNoCelular("https://x/v.mp4", "v.mp4", { nav: iphone })).resultado).toBe("baixado");
    expect(cliques[cliques.length - 1]).toMatchObject({ href: "https://x/v.mp4", download: "v.mp4" });
    expect((await salvarNoCelular("https://x/v.mp4", "v.mp4", { nav: { ...nav, canShare: () => false }, buscar: buscar as unknown as typeof fetch })).resultado).toBe("baixado");

    const negado = Object.assign(new Error("sem toque"), { name: "NotAllowedError" });
    const r = await salvarNoCelular("https://x/v.mp4", "v.mp4", { nav: { ...nav, share: vi.fn(async () => Promise.reject(negado)) }, buscar: buscar as unknown as typeof fetch });
    expect(r.resultado).toBe("precisa_toque");
    expect(r.arquivo).toBeTruthy();
    // Segundo toque: usa o arquivo pronto, sem baixar de novo.
    buscar.mockClear();
    expect((await salvarNoCelular("https://x/v.mp4", "v.mp4", { nav, pronto: r.arquivo, buscar: buscar as unknown as typeof fetch })).resultado).toBe("compartilhado");
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("Finais: Baixar, Abrir no Workspace e legenda", () => {
  it("o vídeo pronto tem Baixar e Abrir no Workspace; a amostra só Baixar", async () => {
    montar(h(Finais, {}));
    expect(await screen.findByRole("button", { name: "Baixar Depoimento v2 (final 9x16).mp4" })).toBeTruthy();
    const linhaDaAmostra = document.querySelector(`[data-final="${AMOSTRA}"]`);
    if (linhaDaAmostra) expect(linhaDaAmostra.querySelector("[data-abrir-no-workspace]")).toBeNull();
    expect(document.querySelector(`[data-final="${RENDER}"] [data-abrir-no-workspace]`)).toBeTruthy();
  });

  it("Baixar assina com o nome do final e baixa sem abrir aba", async () => {
    montar(h(Finais, {}));
    fireEvent.click(await screen.findByRole("button", { name: "Baixar Depoimento v2 (final 9x16).mp4" }));
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(mock.assinados[mock.assinados.length - 1]).toMatchObject({ bucket: "mesa", caminho: `${CLIENTE}/video/render/${PEDIDO}.mp4`, download: "Depoimento v2 (final 9x16).mp4" });
    expect(cliques[0].download).toBe("Depoimento v2 (final 9x16).mp4");
  });

  it("legenda guardada: SRT e VTT baixam com o nome do vídeo", async () => {
    montar(h(Finais, {}));
    const srt = await waitFor(() => {
      const b = document.querySelector(`[data-final="${RENDER}"] [data-legenda-guardada] button`) as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });
    fireEvent.click(srt);
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(mock.assinados[mock.assinados.length - 1]).toMatchObject({ caminho: `${CLIENTE}/video/render/${PEDIDO}.srt`, download: "Depoimento v2 (final 9x16).srt" });
  });

  it("Abrir no Workspace põe o vídeo na pasta pelo servidor e abre a pasta", async () => {
    mock.invoke.mockImplementation((f: string, { body }: any) =>
      Promise.resolve({ data: f === "mesa-videos" && body.acao === "final_para_workspace" ? { workspace: { estado: "pronto", pasta_id: "pasta-9", node_id: "no-1", nome: "x", caminho: [] }, client_id: CLIENTE } : {}, error: null }),
    );
    montar(h(Finais, {}));
    const botao = await waitFor(() => {
      const b = document.querySelector(`[data-final="${RENDER}"] [data-abrir-no-workspace]`) as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });
    fireEvent.click(botao);
    await waitFor(() => expect(document.querySelector("[data-onde]")).toBeTruthy());
    expect(chamadas("mesa-videos", "final_para_workspace")[0]).toMatchObject({ arquivo_id: RENDER });
    expect(document.querySelector("[data-onde]")!.getAttribute("data-onde")).toBe(`/workspace?client=${CLIENTE}&pasta=pasta-9`);
  });
});

describe("barra do editor: vídeo inteiro pronto com o editor aberto", () => {
  afterEach(() => {
    _limparVigias();
    vi.useRealTimers();
  });

  const projeto = projetoDosTakes({ titulo: "Reel do Café", fps: 25, takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mp4`, cena_ref: null, melhor: true, duracao_s: 12, largura: 1080, altura: 1920 }], agora: "2026-10-02T12:00:00.000Z" });
  const pedido = (estado: string) => ({ id: PEDIDO, tipo: "render_final", estado, etapa: null, progresso: estado === "pronto" ? 1 : 0.4, entrada: { formato: "9:16" }, resultado: null, erro_mensagem: null, criado_em: "2026-10-02T12:00:00Z", concluido_em: null, arquivo_id: estado === "pronto" ? RENDER : null, saida_path: estado === "pronto" ? `${CLIENTE}/video/render/${PEDIDO}.mp4` : null, url: estado === "pronto" ? "https://fila.test/v.mp4" : null });

  async function terminar() {
    const respostas = [{ pedidos: [pedido("rodando")] }, { pedidos: [pedido("pronto")] }];
    mock.invoke.mockImplementation((f: string, { body }: any) => {
      if (f === "editor-video" && body.acao === "render_status") return Promise.resolve({ data: respostas.shift() || { pedidos: [pedido("pronto")] }, error: null });
      if (f === "mesa-videos" && body.acao === "final_para_workspace") return Promise.resolve({ data: { workspace: { estado: "pronto", pasta_id: "pasta-9", node_id: "n", nome: "x", caminho: [] }, client_id: CLIENTE }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    marcarRenderAtivo(VERSAO);
    montar(
      h(Renderizar, { clientId: CLIENTE, versaoId: VERSAO, projeto, salvamento: "salvo", salvarAgora: async () => undefined, estadoDoSalvamento: () => "salvo", revisao: () => 1, cursor: () => 0, onOps: vi.fn() }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    await waitFor(() => expect(chamadas("mesa-videos", "final_para_workspace")).toHaveLength(1));
  }

  it("ligado (padrão): baixa sozinho com o nome do final, põe no Workspace e o aviso abre a pasta", async () => {
    await terminar();
    expect(cliques).toHaveLength(1);
    expect(cliques[0].download).toBe("Reel do Café (final 9x16).mp4");
    expect(chamadas("mesa-videos", "final_para_workspace")[0]).toMatchObject({ arquivo_id: RENDER, automatico: true });
    await waitFor(() => expect((toast.success as any).mock.calls.some((c: any[]) => c[0] === "Vídeo inteiro pronto" && c[1].action && c[1].action.label === "Abrir no Workspace")).toBe(true));
    // A barra mostra Baixar e Abrir no Workspace do vídeo pronto.
    expect(await screen.findByRole("button", { name: "Baixar Reel do Café (final 9x16).mp4" })).toBeTruthy();
    expect(document.querySelector("[data-render-pronto] [data-abrir-no-workspace]")).toBeTruthy();
  });

  it("desligado: não baixa sozinho, mas o vídeo vai para o Workspace", async () => {
    gravarEstadoDaTela(CHAVE_DO_BAIXAR_SOZINHO, false, ROTA_DO_BAIXAR_SOZINHO);
    await terminar();
    expect(cliques).toHaveLength(0);
  });
});
