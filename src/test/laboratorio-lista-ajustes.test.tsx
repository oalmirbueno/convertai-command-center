import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";

const m = vi.hoisted(() => ({ chamar: vi.fn(), falharAjuste: false }));
vi.mock("@/lib/mesa/api", async (original) => ({ ...(await original<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    channel: () => { const canal = { on: () => canal, subscribe: () => canal }; return canal; },
    removeChannel: () => undefined,
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  },
}));

import EditorDoProjeto from "@/components/laboratorio/EditorDoProjeto";
import { ErroDaMesa } from "@/lib/mesa/api";

const P = "aaaaaaaa-0000-4000-8000-000000000001";
const imagens = [1, 2, 3].map((i) => ({ path: `global/laboratorio/${P}/peca-${i}.png`, url: `https://imagem.test/peca-${i}.png` }));
const canvasInicial = (): CanvasDoLab => ({
  nos: [
    { id: "copy", tipo: "copy", x: 0, y: 0, dados: { titulo: "Copy preservada", formato: "anuncio", instrucao: "Não alterar" } },
    { id: "carrossel", tipo: "carrossel", x: 640, y: 0, dados: { titulo: "Três peças", tema: "Oficina demonstrativa", laminas: 3 } },
    { id: "pagina", tipo: "pagina", x: 1280, y: 0, dados: { titulo: "Página preservada", caminho: "/oferta", tipo_pagina: "captura", objetivo: "capturar", instrucao: "" } },
  ],
  ligacoes: [{ id: "l1", de: "copy", para: "carrossel" }, { id: "l2", de: "carrossel", para: "pagina" }],
  viewport: { x: 0, y: 0, zoom: 1 },
});
const execucao = (no: string, status = "pronto", saida: Record<string, unknown> = {}) => ({
  id: `exec-${no}`, no_id: no, tipo: no === "carrossel" ? "carrossel" : no === "pagina" ? "pagina" : "copy", status,
  saida, custo_usd: 0.1, created_at: "2026-10-21T10:00:00Z", rodada_id: null,
});
const projeto = (canvas: CanvasDoLab, versao = 1) => ({ id: P, nome: "Teste de edição no celular", canvas, versao, client_id: null, contexto: "Demonstração", status: "ativo", updated_at: "2026-10-21T10:00:00Z" });
const corpos = (acao: string) => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].acao === acao).map((c) => c[1]);

beforeAll(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 577 });
});

beforeEach(() => {
  m.chamar.mockReset();
  m.falharAjuste = false;
  let canvas = canvasInicial();
  let versao = 1;
  let revisou = false;
  const originais = [execucao("copy", "pronto", { texto: "Copy já pronta" }), execucao("carrossel", "pronto", { imagens }), execucao("pagina", "pronto", { texto: "Página já pronta" })];
  m.chamar.mockImplementation(async (funcao: string, corpo: Record<string, unknown>) => {
    if (funcao !== "laboratorio") return {};
    if (corpo.acao === "projeto_ler") return { projeto: projeto(canvas, versao), execucoes: originais };
    if (corpo.acao === "projeto_salvar") { canvas = corpo.canvas as CanvasDoLab; return { projeto: projeto(canvas, ++versao) }; }
    if (corpo.acao === "execucoes_ler") return { execucoes: revisou ? [...originais.filter((e) => e.no_id !== "carrossel"), { ...execucao("carrossel", "pronto", { imagens: imagens.map((imagem, i) => i === 1 ? { path: "revisada.png", url: "https://imagem.test/revisada.png" } : imagem), origem: { execucao_id: "exec-carrossel", indice: 1, modo: "ajustar" } }), id: "revisao", created_at: "2026-10-21T11:00:00Z" }] : originais };
    if (corpo.acao === "no_ajustar") {
      if (!corpo.confirmado) throw new ErroDaMesa("confirmacao_necessaria", "Confirme o custo.", { custo_usd: 0.04 });
      if (m.falharAjuste) throw new Error("O motor não concluiu o ajuste.");
      revisou = true;
      return { execucao: { ...execucao("carrossel", "rodando", { origem: { execucao_id: "exec-carrossel", indice: 1, modo: "ajustar" } }), id: "revisao", created_at: "2026-10-21T11:00:00Z" } };
    }
    return {};
  });
});

async function abrirCarrossel() {
  const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><EditorDoProjeto projetoId={P} clientes={[]} onVoltar={() => undefined} /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /^Carrossel Oficina demonstrativa/ }));
  const inspetor = view.container.querySelector('[data-inspetor="carrossel"]') as HTMLElement;
  return { ...view, inspetor };
}

async function pedirAjuste(inspetor: HTMLElement) {
  const ui = within(inspetor);
  fireEvent.click(ui.getByRole("button", { name: "Imagem 2" }));
  fireEvent.click(ui.getByRole("button", { name: "Ajustar" }));
  fireEvent.change(ui.getByLabelText("O que mudar na imagem 2"), { target: { value: "Deixe só o fundo desta peça mais claro" } });
  const pedido = inspetor.querySelector('[data-pedido-da-imagem="ajustar"]') as HTMLElement;
  fireEvent.click(within(pedido).getByRole("button", { name: "Ajustar" }));
  await within(pedido).findByRole("button", { name: "Confirmar" });
  return pedido;
}

describe("ações das imagens no modo lista do celular", () => {
  it("estima e confirma só a peça 2, acompanha a revisão e mantém as demais peças e nós", async () => {
    const { container, inspetor } = await abrirCarrossel();
    const pedido = await pedirAjuste(inspetor);
    expect(corpos("no_ajustar")).toHaveLength(1);
    expect(corpos("no_ajustar")[0]).toMatchObject({ projeto_id: P, no_id: "carrossel", indice: 1 });
    expect(corpos("no_ajustar")[0].confirmado).not.toBe(true);
    expect(pedido.textContent).toContain("US$ 0,04");
    fireEvent.click(within(pedido).getByRole("button", { name: "Confirmar" }));
    await within(inspetor).findByText("Peça 2 em ajuste. As outras continuam no lugar.");
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(container.querySelector('[data-imagem-gerada="0"] img')?.getAttribute("src")).toBe(imagens[0].url);
    expect(container.querySelector('[data-imagem-gerada="2"] img')?.getAttribute("src")).toBe(imagens[2].url);
    await waitFor(() => expect(container.querySelector('[data-imagem-gerada="1"] img')?.getAttribute("src")).toContain("revisada"));
    expect(corpos("no_ajustar")[1]).toMatchObject({ projeto_id: P, no_id: "carrossel", indice: 1, confirmado: true });
    expect(corpos("execucoes_ler").length).toBeGreaterThan(0);
    expect(corpos("rodar_tudo")).toHaveLength(0);
    expect(corpos("no_executar")).toHaveLength(0);
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(container.querySelector('[data-imagem-gerada="0"] img')?.getAttribute("src")).toBe(imagens[0].url);
    expect(container.querySelector('[data-imagem-gerada="2"] img')?.getAttribute("src")).toBe(imagens[2].url);
    expect(corpos("projeto_salvar")).toHaveLength(0);
  });

  it("uma falha de ajuste preserva as três imagens já prontas", async () => {
    m.falharAjuste = true;
    const { container, inspetor } = await abrirCarrossel();
    const pedido = await pedirAjuste(inspetor);
    fireEvent.click(within(pedido).getByRole("button", { name: "Confirmar" }));
    expect(await within(pedido).findByRole("alert")).toHaveTextContent("O motor não concluiu o ajuste.");
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    imagens.forEach((imagem, i) => expect(container.querySelector(`[data-imagem-gerada="${i}"] img`)?.getAttribute("src")).toBe(imagem.url));
    expect(corpos("rodar_tudo")).toHaveLength(0);
    expect(corpos("no_executar")).toHaveLength(0);
  });

  it("escolher a principal salva somente essa escolha sem gerar nem alterar os demais nós", async () => {
    const { inspetor } = await abrirCarrossel();
    fireEvent.click(within(inspetor).getByRole("button", { name: "Imagem 2" }));
    fireEvent.click(within(inspetor).getByRole("button", { name: "Escolher como principal" }));
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0));
    const salvo = corpos("projeto_salvar").at(-1).canvas as CanvasDoLab;
    expect(salvo.nos.find((n) => n.id === "carrossel")?.dados.principal).toBe(1);
    expect(salvo.nos.filter((n) => n.id !== "carrossel")).toEqual(canvasInicial().nos.filter((n) => n.id !== "carrossel"));
    expect(salvo.ligacoes).toEqual(canvasInicial().ligacoes);
    expect(corpos("no_ajustar")).toHaveLength(0);
    expect(corpos("rodar_tudo")).toHaveLength(0);
    expect(corpos("no_executar")).toHaveLength(0);
  });

  it("usar a imagem central como referência cria somente uma mídia ligada e salva o grafo", async () => {
    const { inspetor } = await abrirCarrossel();
    fireEvent.click(within(inspetor).getByRole("button", { name: "Imagem 2" }));
    fireEvent.click(within(inspetor).getByRole("button", { name: "Usar como referência" }));
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0));
    const salvo = corpos("projeto_salvar").at(-1).canvas as CanvasDoLab;
    const midias = salvo.nos.filter((n) => n.tipo === "midia");
    expect(midias).toHaveLength(1);
    expect(midias[0].dados.imagens).toMatchObject([{ path: imagens[1].path, url: imagens[1].url }]);
    expect(salvo.nos.filter((n) => n.tipo !== "midia")).toEqual(canvasInicial().nos);
    expect(salvo.ligacoes).toEqual(expect.arrayContaining([...canvasInicial().ligacoes, expect.objectContaining({ de: midias[0].id, para: "carrossel" })]));
    expect(salvo.ligacoes).toHaveLength(3);
    expect(corpos("no_ajustar")).toHaveLength(0);
    expect(corpos("rodar_tudo")).toHaveLength(0);
  });
});
