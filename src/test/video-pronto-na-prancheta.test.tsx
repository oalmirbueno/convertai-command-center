import { createElement as h } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 27/10/2026 (dono, pauta de vídeo da Verzelo "Sabe aquela legenda com trinta hashtags? Acabou"): o vídeo subiu
 * na peça (Pronto, "Hashtags edit.mp4"), mas a aba "Legendar o vídeo" dizia "A legenda fica disponível quando o
 * vídeo estiver pronto" e a prancheta ficava vazia. O envio cria o registro no acervo da Mesa Vídeos, mas a lista
 * do Estúdio não relia; e o vídeo escolhido direto do Workspace nem tinha registro. Banco, funções e Storage
 * simulados; as ferramentas pesadas do Estúdio viram marcadores.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  subirVideos: vi.fn(),
  arquivos: [] as unknown[],
  tabelas: {} as Record<string, unknown>,
  download: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update"]) b[m] = () => b;
    const um = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.maybeSingle = um;
    b.single = um;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  const storage = { from: () => ({ createSignedUrl: (c: string) => Promise.resolve({ data: { signedUrl: `https://arquivos.test/${c}` }, error: null }), download: (...a: unknown[]) => mock.download(...a) }) };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(async () => ({ data: { ok: true }, error: null })), from: (t: string) => consulta(t), storage } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, any>;
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...real,
    usePedidos: () => ({ data: { itens: [], disponivel: true }, refetch: vi.fn(), isError: false }),
    useVersoes: () => ({ data: { itens: [], disponivel: true }, refetch: vi.fn(), isError: false }),
    // A lista real do acervo (react-query), lida do banco simulado: só muda quando alguém relê.
    useArquivosDeVideo: (clientId: string) => useQuery({ queryKey: real.chaveDosArquivos(clientId), staleTime: Infinity, queryFn: async () => ({ arquivos: [...mock.arquivos], degradado: false }) }),
    subirVideos: (...a: unknown[]) => mock.subirVideos(...a),
    hashDoArquivo: async () => null,
  };
});
const tela = vi.hoisted(() => ({
  marcador: async (nome: string) => {
    const { createElement } = await import("react");
    return { default: () => createElement("div", { "data-marcador": nome }) };
  },
  comArquivo: async (testid: string, lugar = "default") => {
    const { createElement } = await import("react");
    return { [lugar]: ({ arquivo }: { arquivo: { id: string } }) => createElement(testid === "legendar" ? "li" : "div", { "data-testid": testid }, arquivo.id) };
  },
}));
vi.mock("@/components/mesa/PecaDeVideoDaPauta", () => tela.marcador("peca"));
vi.mock("@/components/mesa/MidiaDaPauta", () => tela.marcador("midia"));
vi.mock("@/components/mesa/GravarDaPauta", () => tela.marcador("gravar"));
vi.mock("@/components/mesa/ComposicaoDoVideoDaPauta", () => tela.marcador("composicao"));
vi.mock("@/components/mesa/GeracoesDaPauta", () => tela.marcador("geracoes"));
vi.mock("@/components/mesa-videos/GeradorLivre", () => tela.marcador("livre"));
vi.mock("@/components/mesa/TrilhaDoVideoDaPauta", () => tela.comArquivo("trilha"));
vi.mock("@/components/mesa/CortarVideoDaPauta", () => tela.comArquivo("cortar"));
vi.mock("@/components/mesa/EntregaDoVideoDaPauta", () => tela.comArquivo("entrega"));
vi.mock("@/components/mesa-edicao/Finais", () => tela.comArquivo("legendar", "LinhaDoFinal"));
vi.mock("@/components/mesa/useFotoRealDaPeca", () => ({ precisaDeFotoReal: () => false, useFotoRealDaPeca: () => ({ data: null }), direcaoComFotoReal: (d: unknown) => d }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioDeVideoDaPauta from "@/components/mesa/EstudioDeVideoDaPauta";
import { garantirVideoNoAcervo } from "@/components/mesa/videoDaPauta";
import { videoEnviadoDaPeca } from "@/components/mesa/resultadosDeVideoDaPauta";

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = ObservadorFalso;

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const TAREFA = "e16a6a18-e768-8722-a675-91c327a05c57";
const ARQUIVO = "daf8ff9b-4b66-4e92-9710-35054833ce36";
const NO_WORKSPACE = `client/${CLIENTE}/mesa-edicao/${ARQUIVO}.mp4`;

const arquivo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, client_id: CLIENTE, nome: "Hashtags edit.mp4", nome_original: "Hashtags edit.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/${id}.mp4`, tipo: "bruto",
  mime: "video/mp4", bytes: 75038485, duracao_s: 40.21, largura: 1080, altura: 1920, sha256: null, gravado_em: null, roteiro_id: null, cena_ref: null, grupo: null, melhor: false,
  nota: null, estado: "ativo", criado_em: "2026-10-27T16:20:04Z", pedido_id: null, origem: null, ...extra,
});

const pauta = (extra: Record<string, unknown> = {}) => ({ id: TAREFA, title: "Sabe aquela legenda com trinta hashtags? Acabou", due_date: "2030-10-29", delivery_type: "reels", status: "todo", project_id: "f99f5957-f67b-4ef3-8acc-d1540ba7d87d", modo_estudio: "video", caminho_video: "gravar", ...extra }) as any;

const mesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Verzelo", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo: [], catalogoCarregando: false,
  atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
}) as unknown as MesaValor;

function montar(item: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arvore = (i: unknown) => h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: h(EstudioDeVideoDaPauta, { item: i as any }) }))));
  const r = render(arvore(item));
  return { qc, trocar: (i: unknown) => r.rerender(arvore(i)) };
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  mock.arquivos = [];
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.invoke.mockImplementation(async (_f: string, o: any) => ({ data: o && o.body && o.body.acao === "pauta_video_pronto" ? { task_id: TAREFA, video_pronto: o.body.video, custo_usd: 0 } : { ok: true, custo_usd: 0 }, error: null }));
});

describe("vídeo Pronto da peça libera legendar, trilha, cortar e entrega no Estúdio (27/10)", () => {
  it("o vídeo acabou de subir com o Estúdio aberto: a prancheta relê o acervo e o vídeo entra em legendar, trilha, cortar e entrega", async () => {
    const { trocar } = montar(pauta());
    await waitFor(() => expect(screen.getByText("A legenda fica disponível quando o vídeo estiver pronto.")).toBeTruthy());
    // O envio criou o registro no acervo e guardou na peça (agente-calendario pauta_video_pronto) com o arquivo_id.
    mock.arquivos = [arquivo(ARQUIVO, { origem: { workspace: { storage_path: NO_WORKSPACE, node_id: "5b30d221-3b2b-4f18-9043-aba56a92750c" } } })];
    trocar(pauta({ video_pronto: { bucket: "workspace", caminho: NO_WORKSPACE, nome: "Hashtags edit.mp4", duracao_s: 40.2, arquivo_id: ARQUIVO, em: "2026-10-27T16:20:08.720Z" } }));
    await waitFor(() => expect(screen.getByTestId("legendar").textContent).toBe(ARQUIVO));
    expect(screen.getByTestId("trilha").textContent).toBe(ARQUIVO);
    expect(screen.getByTestId("cortar").textContent).toBe(ARQUIVO);
    expect(screen.getByTestId("entrega").textContent).toBe(ARQUIVO);
    expect(screen.queryByText("A legenda fica disponível quando o vídeo estiver pronto.")).toBeNull();
    // Na prancheta, sem o X (o vídeo da peça sai pela própria peça).
    expect(document.querySelectorAll("[data-prancheta-do-video] ol li").length).toBe(1);
    expect(mock.subirVideos).not.toHaveBeenCalled();
  });

  it("vídeo escolhido só do Workspace (sem registro no acervo): entra no acervo pelo envio de sempre e a peça guarda o id", async () => {
    const caminho = `${CLIENTE}/videos/gravacao-do-almir.mp4`;
    mock.download.mockResolvedValue({ data: new Blob(["video"], { type: "video/mp4" }), error: null });
    mock.subirVideos.mockImplementation(async () => {
      const novo = arquivo("99999999-9999-4999-8999-999999999999", { nome: "gravacao-do-almir.mp4", nome_original: "gravacao-do-almir.mp4" });
      mock.arquivos = [novo];
      return { registrados: [novo], duplicados: [], recusados: [], sem_registro: 0, aviso: null };
    });
    montar(pauta({ video_pronto: { bucket: "workspace", caminho, nome: "gravacao-do-almir.mp4", em: "2026-10-27T10:00:00Z" } }));
    await waitFor(() => expect(screen.getByTestId("legendar").textContent).toBe("99999999-9999-4999-8999-999999999999"));
    expect(mock.download).toHaveBeenCalledWith(caminho);
    expect(mock.subirVideos).toHaveBeenCalledTimes(1);
    expect((mock.subirVideos.mock.calls[0][1] as File[])[0].name).toBe("gravacao-do-almir.mp4");
    expect(chamadas("pauta_video_pronto")[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, task_id: TAREFA, video: expect.objectContaining({ bucket: "workspace", caminho, arquivo_id: "99999999-9999-4999-8999-999999999999" }) }));
  });
});

describe("garantirVideoNoAcervo e o casamento pelo caminho do Workspace", () => {
  it("o final que a Mesa Vídeos levou ao Workspace é achado pelo caminho de lá, sem baixar nem subir nada", async () => {
    mock.tabelas.video_arquivos = [{ id: ARQUIVO }];
    await expect(garantirVideoNoAcervo(CLIENTE, { bucket: "workspace", caminho: NO_WORKSPACE, nome: "Hashtags edit.mp4" })).resolves.toBe(ARQUIVO);
    expect(mock.download).not.toHaveBeenCalled();
    expect(mock.subirVideos).not.toHaveBeenCalled();
  });

  it("recusa do acervo vira erro legível", async () => {
    mock.download.mockResolvedValue({ data: new Blob(["video"], { type: "video/mp4" }), error: null });
    mock.subirVideos.mockResolvedValue({ registrados: [], duplicados: [], recusados: [{ nome: "x.mp4", motivo: "acima de 4 GB" }], sem_registro: 0, aviso: null });
    await expect(garantirVideoNoAcervo(CLIENTE, { bucket: "workspace", caminho: `${CLIENTE}/x.mp4`, nome: "x.mp4" })).rejects.toThrow("acima de 4 GB");
  });

  it("videoEnviadoDaPeca acha pelo origem.workspace.storage_path quando a peça não guardou o id", () => {
    const a = arquivo(ARQUIVO, { nome: "outro nome.mp4", nome_original: "outro nome.mp4", origem: { workspace: { storage_path: NO_WORKSPACE } } });
    expect(videoEnviadoDaPeca(CLIENTE, { bucket: "workspace", caminho: NO_WORKSPACE, nome: "Hashtags edit.mp4" }, [a as any])?.id).toBe(ARQUIVO);
  });
});
