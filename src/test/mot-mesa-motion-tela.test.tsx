import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente MOT (30/09): telas da Mesa Motion. Storyboards (3 caminhos e o
 * Escolher), entrevista (opção clicável grava) e a construção (amostra e
 * final vão para a fila com a marca do clique).
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
import EtapaStoryboards from "@/components/mesa-motion/EtapaStoryboards";
import EtapaEntrevista from "@/components/mesa-motion/EtapaEntrevista";
import EtapaConstrucao from "@/components/mesa-motion/EtapaConstrucao";
import { cenaDaLinha } from "../../supabase/functions/_shared/motion-metodo";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "33333333-3333-4333-8333-333333333333";

const cenaA = cenaDaLinha({ ordem: 1, titulo: "Marca entra", peca: "logo_sting", params: { tagline: "Método" }, duracao_s: 5 }).cena;
const filmeBase = {
  id: FILME,
  client_id: CLIENTE,
  marca_id: null,
  nome: "Apresentação AcelerIQ",
  tipo: "apresentacao",
  etapa: "storyboards",
  formatos: ["9:16", "16:9"],
  insumos: {},
  entrevista: { duracao: "15" },
  brand: { essencia: "Método", publico: "", promessa: "", tom: "", provas: [], evitar: "", movimento: "", regras: "", beats: [] },
  storyboards: [0, 1, 2].map((i) => ({ conceito: `Conceito ${i + 1}`, resumo: "r", cenas: [cenaA], avisos: [] })),
  storyboard_escolhido: null,
  cenas: [cenaA],
  renders: [],
  critica: {},
  som: {},
  montagem: {},
  entrega: {},
  modelo: null,
  custo_usd: 0,
  arquivado_em: null,
  criado_em: "",
  atualizado_em: "",
};

const valor: MesaValor = {
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [{ id: "openrouter:anthropic/claude-opus-5.5", provedor: "openrouter", modelo_api: "anthropic/claude-opus-5.5", tipo: "texto", rotulo: "Claude Opus 5.5", preco_entrada_1m: 4, preco_saida_1m: 20, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["motion"], ativo: true }],
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
  return render(h(MemoryRouter, { initialEntries: [`/mesa-motion?client=${CLIENTE}&filme=${FILME}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, no))));
}

function responder(filme: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
    if (body.acao === "filmes_listar") return { data: { filmes: [filme] }, error: null };
    if (body.acao === "filme_ler") return { data: { filme, links: {} }, error: null };
    if (body.acao === "render_status") return { data: { pedidos: [], finais: [], links: {}, worker: { visto_em: null, situacao: "ligado" } }, error: null };
    if (body.acao === "storyboard_escolher" || body.acao === "filme_salvar") return { data: { filme: { ...filme, storyboard_escolhido: body.indice ?? null, entrevista: body.entrevista || filme.entrevista } }, error: null };
    if (body.acao === "cena_pedir") return { data: { pedidos: [{ id: "p1" }] }, error: null };
    if (body.acao === "insumos_ler") return { data: { videos: [], musicas: [], imagens: [], kit: null }, error: null };
    return { data: {}, error: null };
  });
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => (c[1] as { body: { acao: string } }).body.acao === acao).map((c) => (c[1] as { body: Record<string, unknown> }).body);

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

describe("Mesa Motion na tela", () => {
  it("storyboards: mostra os 3 caminhos e o Escolher grava o índice", async () => {
    responder(filmeBase);
    montar(h(EtapaStoryboards, { irPara: vi.fn() }));
    await screen.findByText("Conceito 1");
    expect(screen.getByText("Conceito 3")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Escolher" })[1]);
    await waitFor(() => expect(chamadas("storyboard_escolher")[0]).toMatchObject({ filme_id: FILME, indice: 1 }));
  });

  it("entrevista: clicar numa opção nomeada grava o ingrediente", async () => {
    responder(filmeBase);
    montar(h(EtapaEntrevista, { irPara: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Sting com rastro" }));
    await waitFor(() => expect(chamadas("filme_salvar")[0]).toMatchObject({ filme_id: FILME, entrevista: { duracao: "15", logo: "sting" } }));
  });

  it("construção: amostra e cena final vão para a fila com a marca do clique", async () => {
    responder({ ...filmeBase, etapa: "construcao" });
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: /Amostra de 5 s/ }));
    await waitFor(() => expect(chamadas("cena_pedir")[0]).toMatchObject({ filme_id: FILME, cena_id: cenaA.id, modo: "amostra" }));
    fireEvent.click(screen.getByRole("button", { name: /Cena final \(2 formatos\)/ }));
    await waitFor(() => expect(chamadas("cena_pedir")[1]).toMatchObject({ modo: "final" }));
    expect(String(chamadas("cena_pedir")[0].uid)).toMatch(/^amostra-/);
  });
});
