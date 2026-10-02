import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Edição (02/10), na tela: a Entrada com as variantes numa linha só e o
 * "..." com Tirar legenda e Melhorar qualidade; a janela do tratamento com o
 * custo no botão (amostra -> comparar -> vídeo inteiro); os Finais com o
 * gerador de legenda (SRT/VTT, transcrever com custo antes, gravar no vídeo).
 * A função mesa-videos e o editor-video são simulados.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown> }));

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
        from: () => ({
          list: () => Promise.resolve({ data: [], error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/v.mp4" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
// O jsdom não decodifica vídeo: a busca da faixa nos quadros volta sem achar (a regra pura tem teste próprio).
vi.mock("@/lib/edicao/acoesDaEdicao", async (original) => ({
  ...(await original<typeof import("@/lib/edicao/acoesDaEdicao")>()),
  acharLegendaNoVideo: vi.fn().mockResolvedValue({ achada: null, vista: null, tempoDaVista: 0, duracao: 60 }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EtapaEntrada from "@/components/mesa-edicao/EtapaEntrada";
import JanelaDeTratamento from "@/components/mesa-edicao/JanelaDeTratamento";
import Finais from "@/components/mesa-edicao/Finais";
import { normalizarArquivo, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { custoDoTratamento, motorDoTratamento } from "../../supabase/functions/mesa-videos/modulos/tratamento-de-video";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const BRUTO = "aaaaaaaa-0000-4000-8000-000000000001";
const RENDER = "aaaaaaaa-0000-4000-8000-000000000009";
const PEDIDO = "bbbbbbbb-0000-4000-8000-000000000001";

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

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-edicao?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho })))));
}

const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const base = { client_id: CLIENTE, storage_bucket: "mesa", estado: "ativo", melhor: false, grupo: null, roteiro_id: null, cena_ref: null, mime: "video/mp4" };
const ARQUIVOS = [
  { ...base, id: BRUTO, nome: "Depoimento.mov", nome_original: "Depoimento.mov", storage_path: `${CLIENTE}/video/brutos/a.mov`, tipo: "bruto", duracao_s: 60, largura: 1080, altura: 1920, criado_em: "2026-10-02T10:00:00Z" },
  { ...base, id: "c1", nome: "Abertura (cena 9:16)", nome_original: "c1.webm", storage_path: `${CLIENTE}/motion/c1.webm`, tipo: "cena", duracao_s: 5, criado_em: "2026-10-02T10:03:00Z", origem: { motion_id: "m", cena_id: "cena-1", formato: "9:16" } },
  { ...base, id: "c2", nome: "Abertura (cena 16:9)", nome_original: "c2.webm", storage_path: `${CLIENTE}/motion/c2.webm`, tipo: "cena", duracao_s: 5, criado_em: "2026-10-02T10:02:00Z", origem: { motion_id: "m", cena_id: "cena-1", formato: "16:9" } },
  { ...base, id: "c3", nome: "Abertura (amostra 5 s 9:16)", nome_original: "c3.mp4", storage_path: `${CLIENTE}/motion/c3.mp4`, tipo: "amostra", duracao_s: 5, criado_em: "2026-10-02T10:01:00Z", origem: { motion_id: "m", cena_id: "cena-1", formato: "9:16" } },
  { ...base, id: "c4", nome: "Abertura (still 9:16)", nome_original: "c4.png", storage_path: `${CLIENTE}/motion/c4.png`, tipo: "still", duracao_s: null, criado_em: "2026-10-02T10:00:30Z", origem: { motion_id: "m", cena_id: "cena-1", formato: "9:16" } },
  { ...base, id: RENDER, nome: "Depoimento v2 (render 9:16)", nome_original: "r.mp4", storage_path: `${CLIENTE}/video/render/${PEDIDO}.mp4`, tipo: "render", duracao_s: 30, criado_em: "2026-10-02T11:00:00Z", origem: { render_pedido_id: PEDIDO, versao_id: "v", formato: "9:16" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { video_arquivos: ARQUIVOS, video_pedidos: [], video_versoes: [] };
  mock.invoke.mockResolvedValue({ data: {}, error: null });
});

describe("Entrada: variantes numa linha e tratar vídeo", () => {
  it("a cena do Motion em 4 variantes vira uma linha com +3, e diz que é um vídeo", async () => {
    montar(h(EtapaEntrada, { irPara: vi.fn() }));
    expect(await screen.findByText("Abertura (cena 9:16)")).toBeTruthy();
    expect(screen.queryByText("Abertura (still 9:16)")).toBeNull();
    const selo = document.querySelector("[data-variantes]") as HTMLElement;
    expect(selo.getAttribute("data-variantes")).toBe("3");
    fireEvent.click(selo);
    expect(await screen.findByText("Abertura (still 9:16)")).toBeTruthy();
    expect(document.querySelector('[data-modo-da-entrada="um_video"]')).toBeTruthy();
    expect(screen.getByText(/Um vídeo/)).toBeTruthy();
  });
});

describe("janela do tratamento: amostra com custo, comparar, vídeo inteiro", () => {
  const arquivo = normalizarArquivo(ARQUIVOS[0]) as ArquivoDeVideo;
  const motor = motorDoTratamento("melhorar");
  const custoAmostra = custoDoTratamento(motor, 0, 5, { largura: 1080, altura: 1920, fps: 30 }, 1).usd;
  const custoInteiro = custoDoTratamento(motor, 0, 60, { largura: 1080, altura: 1920, fps: 30 }, 1).usd;

  it("melhorar: pede a amostra com o custo do botão, mostra antes e depois e faz o inteiro com o custo", async () => {
    const tratamento = (estado: string, extra: Record<string, unknown> = {}) => ({
      id: "t1",
      arquivo_id: BRUTO,
      nome_do_antes: "Depoimento.mov",
      acao: "melhorar",
      acao_rotulo: "Melhorar qualidade",
      motor: motor.id,
      parametros: {},
      estado,
      fase: "amostra",
      estado_texto: estado === "amostra" ? "Amostra pronta: compare" : "Preparando a amostra na máquina",
      amostra: { inicio_s: 0, fim_s: 5, antes_url: "https://x/antes.mp4", depois_url: estado === "amostra" ? "https://x/depois.mp4" : null, custo_previsto_usd: custoAmostra },
      envios: [],
      custo_usd: 0,
      resultado_arquivo_id: null,
      erro: null,
      criado_em: "2026-10-02T12:00:00Z",
      ...extra,
    });
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "tratamento_status") return Promise.resolve({ data: { tratamentos: [], motores: [{ id: motor.id, acao: "melhorar", rotulo: motor.rotulo, nota: "", pronto: true, motivo: null }] }, error: null });
      if (body.acao === "tratamento_amostra") return Promise.resolve({ data: { tratamento: tratamento("amostra") }, error: null });
      if (body.acao === "tratamento_final") return Promise.resolve({ data: { tratamento: tratamento("preparando", { fase: "final" }) }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(JanelaDeTratamento, { arquivo, acao: "melhorar", aberta: true, onFechar: vi.fn() }));
    const amostra = await waitFor(() => {
      const b = document.querySelector("[data-tratar-amostra]") as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });
    expect(amostra.textContent).toMatch(/Amostra de 5 s por/);
    fireEvent.click(amostra);
    await waitFor(() => expect(chamadas("mesa-videos", "tratamento_amostra")).toHaveLength(1));
    expect(chamadas("mesa-videos", "tratamento_amostra")[0]).toMatchObject({ client_id: CLIENTE, arquivo_id: BRUTO, tipo: "melhorar", motor: "topaz-proteus", custo_confirmado_usd: custoAmostra, nivel: "mesmo_tamanho" });
    // Amostra pronta: o comparador e o botão do inteiro com o custo.
    const inteiro = await waitFor(() => {
      const b = document.querySelector("[data-tratar-inteiro]") as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });
    expect(screen.getAllByText("Antes").length).toBeGreaterThan(0);
    fireEvent.click(inteiro);
    await waitFor(() => expect(chamadas("mesa-videos", "tratamento_final")).toHaveLength(1));
    expect(chamadas("mesa-videos", "tratamento_final")[0]).toMatchObject({ tratamento_id: "t1", custo_confirmado_usd: custoInteiro });
  });

  it("tirar legenda: sem quadros lidos, a faixa é marcada à mão e vai junto no pedido", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "tratamento_status") return Promise.resolve({ data: { tratamentos: [], motores: [] }, error: null });
      return Promise.resolve({ data: { tratamento: null }, error: null });
    });
    montar(h(JanelaDeTratamento, { arquivo, acao: "tirar_legenda", aberta: true, onFechar: vi.fn() }));
    expect(await screen.findByText(/Marque a faixa à mão/)).toBeTruthy();
    fireEvent.click(document.querySelector("[data-tratar-amostra]") as HTMLButtonElement);
    await waitFor(() => expect(chamadas("mesa-videos", "tratamento_amostra")).toHaveLength(1));
    const corpo = chamadas("mesa-videos", "tratamento_amostra")[0];
    expect(corpo.tipo).toBe("tirar_legenda");
    expect(corpo.regiao).toMatchObject({ x: 0.06, y: 0.76, w: 0.88, h: 0.14 });
    expect(corpo.custo_confirmado_usd).toBeCloseTo(0.75, 4);
  });
});

describe("Finais: gerador de legenda do vídeo pronto", () => {
  it("gera o SRT do corte e grava no vídeo (nova versão + render)", async () => {
    mock.invoke.mockImplementation((f: string, { body }: any) => {
      if (f === "mesa-videos" && body.acao === "final_legenda_gerar") {
        return Promise.resolve({ data: { linhas: [{ texto: "Oi gente.", i: 0.2, f: 1 }], origem: "fala", srt: "1\n...", vtt: "WEBVTT", urls: { srt: "https://x/a.srt", vtt: "https://x/a.vtt" }, precisa_transcrever: false }, error: null });
      }
      if (f === "mesa-videos" && body.acao === "final_legenda_versao") return Promise.resolve({ data: { versao: { id: "v3", numero: 3, titulo: "Depoimento", projeto: { revisao: 1 } } }, error: null });
      if (f === "editor-video" && body.acao === "render_pedir") return Promise.resolve({ data: { pedido: { id: "p", estado: "fila", tipo: "render_final" }, ja_existia: false }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(Finais, {}));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar legenda de Depoimento v2 (render 9:16)" }));
    await waitFor(() => expect(chamadas("mesa-videos", "final_legenda_gerar")).toEqual([{ acao: "final_legenda_gerar", arquivo_id: RENDER }]));
    expect(await screen.findByText("Oi gente.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gravar no vídeo" }));
    await waitFor(() => expect(chamadas("mesa-videos", "final_legenda_versao")).toHaveLength(1));
    expect(chamadas("mesa-videos", "final_legenda_versao")[0]).toMatchObject({ arquivo_id: RENDER, estilo: "simples", linhas: [{ texto: "Oi gente.", i: 0.2, f: 1 }] });
    await waitFor(() => expect(chamadas("editor-video", "render_pedir")).toHaveLength(1));
    expect(chamadas("editor-video", "render_pedir")[0]).toMatchObject({ versao_id: "v3", tipo: "render_final", revisao: 1 });
  });

  it("sem fala no projeto: oferece transcrever o vídeo pronto com o custo antes", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) =>
      Promise.resolve({ data: body.acao === "final_legenda_gerar" ? { linhas: [], origem: null, precisa_transcrever: true, custo_transcricao_usd: 0.006, duracao_s: 30 } : {}, error: null }),
    );
    montar(h(Finais, {}));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar legenda de Depoimento v2 (render 9:16)" }));
    expect(await screen.findByText(/Transcrever por/)).toBeTruthy();
  });
});
