import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente SPM (30/09): no cartão da cena da Mesa Motion, "Reescrever com a
 * causa" aparece quando a conferência recusou a escrita ou quando o último
 * render falhou no lint do worker. É sob pedido (um clique, uma chamada,
 * nunca em laço) e manda a FALHA ANTERIOR no pedido. A prova do render (lint
 * e check do worker) aparece ao lado da amostra.
 *
 * Revisão da SPM: a escrita que falhou vai junto (corrigir, não refazer do
 * zero). A do render já está guardada na cena e a função lê de lá; a recusada
 * pela conferência volta da função e a tela manda em `escrita_anterior`.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "in", "order", "limit", "is", "not", "gte", "lt", "maybeSingle", "single"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => cadeia),
      storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EtapaConstrucao from "@/components/mesa-motion/EtapaConstrucao";
import { cenaDaLinha } from "../../supabase/functions/mesa-motion/modulos/motion-metodo";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "44444444-4444-4444-8444-444444444444";

const base = cenaDaLinha({ ordem: 1, titulo: "Marca entra", peca: "logo_sting", params: { tagline: "Método" }, duracao_s: 5 }).cena;
const cenaSobMedida = { ...base, modo: "sob_medida", peca: null, ideia: "Logo entra devagar", escrita: { html: '<div id="c-a">Oi</div>', css: "", js: "tl.to('#c-a', { opacity: 1 }, 0);", picos: [], resumo: "Logo entra" } };

const filme = (cena: Record<string, unknown>, renders: unknown[] = []) => ({
  id: FILME,
  client_id: CLIENTE,
  marca_id: null,
  nome: "Filme",
  tipo: "apresentacao",
  etapa: "construcao",
  formatos: ["9:16"],
  insumos: {},
  entrevista: { duracao: "15" },
  brand: { essencia: "Método", publico: "", promessa: "", tom: "", provas: [], evitar: "", movimento: "", regras: "", beats: [] },
  storyboards: [],
  storyboard_escolhido: null,
  cenas: [cena],
  renders,
  critica: {},
  som: {},
  montagem: {},
  entrega: {},
  modelo: null,
  custo_usd: 0,
  arquivado_em: null,
  criado_em: "",
  atualizado_em: "",
});

const valor = {
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [{ id: "openrouter:deepseek/deepseek-v4-flash", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", tipo: "texto", rotulo: "DeepSeek V4 Flash", preco_entrada_1m: 0.08, preco_saida_1m: 0.15, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["motion"], ativo: true }],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  versaoCarteira: 0,
  marcas: [],
  marca: null,
} as unknown as MesaValor;

function montar(no: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-motion?client=${CLIENTE}&filme=${FILME}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor, children: no }))));
}

function responder(f: Record<string, unknown>, pedidos: unknown[], escrever: () => Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
    if (body.acao === "filmes_listar") return { data: { filmes: [f] }, error: null };
    if (body.acao === "filme_ler") return { data: { filme: f, links: {} }, error: null };
    if (body.acao === "render_status") return { data: { pedidos, finais: [], links: {}, worker: { visto_em: null, situacao: "ligado" } }, error: null };
    if (body.acao === "cena_escrever") return { data: { filme: f, custo_usd: 0.002, ...escrever() }, error: null };
    return { data: {}, error: null };
  });
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => (c[1] as { body: { acao: string } }).body.acao === acao).map((c) => (c[1] as { body: Record<string, unknown> }).body);

async function abrirEscrever() {
  // O cabeçalho recolhido "Escrever sob medida" abre a seção; o botão da ação tem o mesmo nome, sem aria-expanded.
  fireEvent.click(await screen.findByRole("button", { name: "Escrever sob medida", expanded: false }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Escrever sob medida" }).length).toBe(2));
  return screen.getAllByRole("button", { name: "Escrever sob medida" }).filter((b) => !b.hasAttribute("aria-expanded"))[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

describe("Mesa Motion: reescrever com a causa (SPM)", () => {
  it("render que falhou no lint mostra a causa e o botão; um clique manda FALHA ANTERIOR uma vez só", async () => {
    const pedidos = [{ id: "p9", tipo: "cena_hf", estado: "erro", etapa: null, progresso: 0, entrada: { chave: `${base.id}:amostra:9:16`, modo: "amostra", formato: "9:16", cena_id: base.id }, resultado: null, saida_path: null, erro_mensagem: "A cena não passou no lint do HyperFrames: gsap_css_transform_conflict: translate no elemento animado", criado_em: "2026-09-30T10:00:00Z" }];
    responder(filme(cenaSobMedida), pedidos, () => ({ recusada: null }));
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    await abrirEscrever();
    const botao = await screen.findByRole("button", { name: /Reescrever com a causa/ });
    expect(screen.getByText(/Último render falhou no lint: gsap_css_transform_conflict/)).toBeTruthy();
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas("cena_escrever")).toHaveLength(1));
    const pedido = String(chamadas("cena_escrever")[0].pedido);
    expect(pedido).toMatch(/^Logo entra devagar\n\nFALHA ANTERIOR: lint: gsap_css_transform_conflict/);
    expect(pedido.length).toBeLessThanOrEqual(900);
    // A escrita do render está na cena: a tela não precisa mandar.
    expect(chamadas("cena_escrever")[0].escrita_anterior).toBeUndefined();
    expect(document.querySelector(`[data-custo-da-reescrita="${base.id}"]`)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(chamadas("cena_escrever")).toHaveLength(1);
  });

  it("escrita recusada pela conferência vira o botão com os problemas; sem falha, não há botão", async () => {
    const recusada = { html: '<div id="c-a">Oi</div>', css: "", js: "tl.to('#c-a', { x: Date.now() }, 0);" };
    responder(filme(cenaSobMedida), [], () => ({ recusada: ["proibido: relógio (a cena precisa sair igual em cada quadro)"], escrita_recusada: recusada }));
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    const escrever = await abrirEscrever();
    expect(screen.queryByRole("button", { name: /Reescrever com a causa/ })).toBeNull();
    fireEvent.click(escrever);
    fireEvent.click(await screen.findByRole("button", { name: /Reescrever com a causa/ }));
    await waitFor(() => expect(chamadas("cena_escrever")).toHaveLength(2));
    expect(chamadas("cena_escrever")[0].pedido).toBe("Logo entra devagar");
    expect(chamadas("cena_escrever")[0].escrita_anterior).toBeUndefined();
    expect(String(chamadas("cena_escrever")[1].pedido)).toMatch(/FALHA ANTERIOR: proibido: relógio/);
    // A escrita recusada volta junto, para o modelo corrigir a causa nela.
    expect(chamadas("cena_escrever")[1].escrita_anterior).toEqual(recusada);
  });

  it("a amostra pronta mostra a prova do worker (lint e check)", async () => {
    const render1 = { pedido_id: "p1", cena_id: base.id, modo: "amostra", formato: "9:16", assinatura: "x", estado: "pronto", saida_path: null, arquivo_id: null, folha_path: null, check: { lido: true, ok: true, layout: { errorCount: 0, warningCount: 0 }, contrast: { errorCount: 0, warningCount: 0 } }, em: "2026-09-30T10:00:00Z" };
    responder(filme(cenaSobMedida, [render1]), [], () => ({ recusada: null }));
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    expect(await screen.findByText("Prova: lint ok, check ok")).toBeTruthy();
  });
});
