import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente CNV (30/09): o Canvas com os cartões Vídeo e Quadro, na tela.
 * - "Animar esta foto" põe o cartão Vídeo ligado ao 1º quadro, abre os
 *   ajustes, escolhe o motor pronto, mostra o custo e gera pela Mesa Vídeos
 *   (cena_gerar) só depois do Confirmar.
 * - Quadro: a paleta abre o editor; modelo da marca aplica, Desfazer volta,
 *   Texto põe camada, Render grava a versão e pede o MP4 à fila.
 */

// Máquina carregada (várias frentes rodando a suíte): as esperas da tela ganham folga.
configure({ asyncUtilTimeout: 15000 });

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert", "upsert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      storage: {
        from: () => ({
          upload: vi.fn(() => Promise.resolve({ data: {}, error: null })),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://arquivo.test/${p}`, error: null })), error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Ótica Sintética" }], isLoading: false, isSuccess: true }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaCanvas from "@/components/mesa-foto/EtapaCanvas";
import { esquecerAndamentos } from "@/components/mesa-foto/modelosApi";
import { tirarPendentes } from "@/components/mesa-foto/canvas/geracao";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const CANVAS = "ffffffff-0000-4000-8000-000000000001";
const GPT = "openrouter:openai/gpt-image-2.5-sunburst";
const PEDIDO = "cccccccc-0000-4000-8000-000000000001";
const VERSAO = "99999999-0000-4000-8000-000000000001";

const catalogo: ModeloIa[] = [
  { id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto", preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: ["estrategista", "diretor_arte", "leitura", "motion"], ativo: true },
  { id: GPT, provedor: "openrouter", modelo_api: "openai/gpt-image-2.5-sunburst", tipo: "imagem", rotulo: "img", preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.02, media: 0.05, alta: 0.1 }, raciocinio: [], padrao_para: ["imagem"], ativo: true },
] as ModeloIa[];

const valorDaMesa = (): MesaValor => ({ clientId: CLIENTE, clientName: "Ótica Sintética", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() });
const valorDaFoto = (): MesaFotoValor => ({ kitId: null, ensaioId: null, imagemId: null, escolherKit: vi.fn(), escolherEnsaio: vi.fn(), irPara: vi.fn(), selecionadas: [], setSelecionadas: vi.fn(), abrirAgente: vi.fn() });

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(), children: h(EtapaCanvas) }) }))),
    ),
  );
}

const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
const noDoQuadro = (tipo: string) => document.querySelector(`[data-no-do-canvas][data-tipo="${tipo}"]`) as HTMLElement;

beforeAll(() => {
  class Observador {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = Observador;
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22 = 1;
    };
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 1; } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 1; } },
  });
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
  if (!(Element.prototype as any).releasePointerCapture) (Element.prototype as any).releasePointerCapture = () => {};
});

let respostas: Record<string, any> = {};

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAndamentos();
  tirarPendentes(CANVAS);
  respostas = {};
  try {
    window.localStorage.clear();
    window.localStorage.setItem("mesa-foto:canvas:como-funciona-visto", "1");
  } catch {
    /* sem armazenamento */
  }
  mock.tabelas = {
    cliente_imagens: [{ id: F1, client_id: CLIENTE, nome: "foto.png", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/f1.png`, origem: "mesa_foto", tags: [], gerada: true, criado_em: "2026-09-25T10:00:00Z" }],
    foto_kits: [],
    foto_kit_refs: [],
    foto_modelos: [],
    foto_modelo_imagens: [],
    foto_biblioteca: [],
    video_motores: [],
    foto_canvas: [
      {
        id: CANVAS,
        client_id: CLIENTE,
        nome: "Cenas do óculos",
        versao: 2,
        status: "ativo",
        atualizado_em: "2026-09-30T12:00:00Z",
        viewport: { x: 0, y: 0, zoom: 1 },
        nos: [
          {
            id: "no-saida",
            tipo: "saida",
            x: 380,
            y: 40,
            dados: {
              motores: [GPT],
              formato: "9:16",
              qualidade: "alta",
              cena: { ordem: 1, titulo: "Chegada", acao: "Ela abre a caixa e sorri", enquadramento: "close", cenario: "sala", narrativa: "", seed: null, imagem_id: null, animacao: null },
              resultados: [{ geracao_id: "g1", imagem_id: F1, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/f1.png`, motor_id: GPT, status: "gerada", erro: null, custo_usd: 0.1, criado_em: "2026-09-30T10:00:00Z" }],
            },
          },
        ],
        ligacoes: [],
      },
    ],
  };
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  mock.invoke.mockImplementation(async (nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    const chave = `${nome}:${acao}`;
    const r = respostas[chave] !== undefined ? respostas[chave] : respostas[acao];
    if (r !== undefined) return { data: typeof r === "function" ? r(opcoes.body) : r, error: null };
    if (nome === "mesa-videos" && acao === "motores_estado") return { data: { motores: [{ id: "kling-3-pro", estado: "pronto", estado_rotulo: "Pronto", nivel: "top", novo: false, chave: "FAL_KEY" }] }, error: null };
    if (nome === "mesa-foto" && acao === "canvas_salvar") return { data: { canvas: { ...opcoes.body.canvas, id: CANVAS, client_id: CLIENTE, versao: (opcoes.body.versao_esperada || 0) + 1 } }, error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

describe("canvas com vídeo (frente CNV)", () => {
  it("Animar esta foto: cartão Vídeo ligado ao 1º quadro, motor pronto, custo antes e cena_gerar só depois do Confirmar", async () => {
    respostas["mesa-videos:cena_gerar"] = { ok: true, pedido_id: PEDIDO, custo_estimado: { usd: 1.12 } };
    montar();
    await waitFor(() => expect(document.querySelector('[data-animar-resultado="no-saida"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-animar-resultado="no-saida"]') as HTMLElement);
    await waitFor(() => expect(noDoQuadro("video")).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(1));
    const ajustes = await waitFor(() => {
      const a = document.querySelector("[data-ajustes-do-video]") as HTMLElement;
      expect(a).toBeTruthy();
      return a;
    });
    // O motor pronto entra sozinho (nível Normal, o único pronto) e o custo aparece antes.
    await waitFor(() => expect((within(ajustes).getByLabelText("Motor") as HTMLSelectElement).value).toBe("kling-3-pro"));
    expect(chamadas("mesa-videos", "cena_gerar")).toHaveLength(0);
    const gerar = within(ajustes).getByRole("button", { name: /Gerar vídeo/ });
    await waitFor(() => expect((gerar as HTMLButtonElement).disabled).toBe(false));
    expect(gerar.textContent).toMatch(/US\$/);
    fireEvent.click(gerar);
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(chamadas("mesa-videos", "cena_gerar")).toHaveLength(1));
    const corpo = chamadas("mesa-videos", "cena_gerar")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, motor: "kling-3-pro", modo: "primeiro_quadro", tipo: "gerar_plano", plano_ref: "c1", quadro_inicial_path: `${CLIENTE}/foto/canvas/f1.png`, formato: "9:16" });
    expect(corpo.custo_confirmado_usd).toBeGreaterThan(0);
    expect(String(corpo.prompt)).toContain("Ela abre a caixa e sorri");
    // O pedido fica no cartão (Na fila do motor) e vai junto quando o canvas salva.
    await waitFor(() => expect(within(noDoQuadro("video")).getByText(/Na fila do motor/)).toBeTruthy());
    await waitFor(() => expect(chamadas("mesa-foto", "canvas_salvar").length).toBeGreaterThan(0), { timeout: 4000 });
    const salvo = chamadas("mesa-foto", "canvas_salvar").pop();
    const noVideo = salvo.canvas.nos.find((n: any) => n.tipo === "video");
    expect(noVideo.dados.pedidos[0]).toMatchObject({ pedido_id: PEDIDO, estado: "enviado" });
    expect(salvo.canvas.ligacoes[0]).toMatchObject({ de: "no-saida", quadro: "inicio" });
  });

  it("Vídeo pela paleta sem foto ligada: o cartão nasce solto e diz o que falta, sem gastar", async () => {
    mock.tabelas.foto_canvas = [{ ...(mock.tabelas.foto_canvas as any[])[0], nos: [{ id: "no-saida", tipo: "saida", x: 380, y: 40, dados: { motores: [GPT] } }] }];
    montar();
    await waitFor(() => expect(document.querySelector('[data-paleta="video"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-paleta="video"]') as HTMLElement);
    await waitFor(() => expect(noDoQuadro("video")).toBeTruthy());
    expect(document.querySelectorAll(".react-flow__edge").length).toBe(0);
    expect(noDoQuadro("video").textContent).toMatch(/Ligue a foto/);
    const ajustes = await waitFor(() => document.querySelector("[data-ajustes-do-video]") as HTMLElement);
    expect(within(ajustes).getByText(/Ligue a foto de um Resultado/)).toBeTruthy();
    expect(chamadas("mesa-videos", "cena_gerar")).toHaveLength(0);
  });
});

describe("canvas com Quadro animado (frente CNV)", () => {
  it("paleta Quadro abre o editor; modelo da marca aplica, Desfazer volta, Texto põe camada e Render grava a versão e pede o MP4", async () => {
    respostas["mesa-videos:versao_registrar"] = { versao: { id: VERSAO } };
    respostas["editor-video:render_pedir"] = { pedido: { id: "rrrrrrrr-0000-4000-8000-000000000001" }, ja_existia: false };
    montar();
    await waitFor(() => expect(document.querySelector('[data-paleta="quadro"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-paleta="quadro"]') as HTMLElement);
    await waitFor(() => expect(noDoQuadro("quadro")).toBeTruthy());
    const editor = await waitFor(() => {
      const e = document.querySelector("[data-editor-de-quadro]") as HTMLElement;
      expect(e).toBeTruthy();
      return e;
    }, { timeout: 60000 });
    // O Resultado com foto ligou no Quadro: a foto chega como mídia.
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(1));
    const camadas = () => document.querySelectorAll("[data-palco-do-quadro=\"editor\"] [data-camada-no-palco]").length;
    expect(camadas()).toBe(0);
    fireEvent.click(editor.querySelector('[data-opcao-de-layout="modelo-titulo_forte"]') as HTMLElement);
    await waitFor(() => expect(camadas()).toBeGreaterThan(1));
    const depoisDoModelo = camadas();
    fireEvent.click(within(editor).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(camadas()).toBe(0));
    fireEvent.click(within(editor).getByRole("button", { name: "Refazer" }));
    await waitFor(() => expect(camadas()).toBe(depoisDoModelo));
    fireEvent.click(editor.querySelector('[data-por-camada="texto"]') as HTMLElement);
    await waitFor(() => expect(camadas()).toBe(depoisDoModelo + 1));
    expect(editor.querySelector("[data-inspetor]")).toBeTruthy();
    fireEvent.click(editor.querySelector("[data-mandar-para-o-render]") as HTMLElement);
    await waitFor(() => expect(chamadas("editor-video", "render_pedir")).toHaveLength(1));
    const versao = chamadas("mesa-videos", "versao_registrar")[0];
    expect(versao).toMatchObject({ client_id: CLIENTE, estado: "rascunho" });
    expect(versao.projeto.trilhas[0]).toMatchObject({ tipo: "sobreposicao", nome: "Quadro do Canvas" });
    expect(versao.projeto.trilhas[0].clipes.length).toBe(depoisDoModelo + 2);
    expect(chamadas("editor-video", "render_pedir")[0]).toMatchObject({ client_id: CLIENTE, versao_id: VERSAO, tipo: "render_final" });
  });
});
