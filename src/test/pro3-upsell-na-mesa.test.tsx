import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PRO3 (30/09): a proposta de upsell dentro da Mesa Proposta. O
 * Rascunho mostra "O que você já tem" aberto, o "Próximo passo" (a solução),
 * o "Sugerir o próximo passo" (Preencher com IA com modelo e custo antes) e o
 * "Reler os dados de hoje" (ação upsell_atualizar, sem IA, com Desfazer).
 * A casca mostra "Clientes › Propostas" e o Conselho com a referência da proposta.
 */
// As etapas baixam sob demanda (lazy): espera maior que o padrão de 1 s.
configure({ asyncUtilTimeout: 8000 });

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update", "insert", "like"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t), storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Loja da Joana", plan_status: "inactive" }], isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import MesaProposta from "@/pages/MesaProposta";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";
import { blocoJaTem, materialDoUpsell, montarUpsell } from "../../supabase/functions/mesa-proposta/modulos/proposta-upsell";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

const RETRATO = montarUpsell({
  cliente: "Loja da Joana",
  servicos: ["Social media"],
  plano: { nome: "Growth", valor: 2500, periodo: "monthly", desde: "2026-06-01", origem: "financeiro" },
  resultados: [{ titulo: "Seguidores", texto: "4.210 seguidores na semana de 22/09 a 28/09." }],
  lidoEm: "2026-09-30T12:00:00Z",
});

function linhaDoUpsell(extra: Record<string, unknown> = {}) {
  let conteudo = comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "O próximo passo da Loja", subtitulo: "", projeto: "" } });
  conteudo = comBloco(conteudo, "ja_tem", { dados: blocoJaTem(RETRATO) });
  conteudo = comBloco(conteudo, "solucao", { titulo: "Próximo passo" });
  return {
    id: PROPOSTA,
    client_id: CLIENTE,
    numero: "2026-020",
    titulo: "Próximo passo para Loja da Joana",
    status: "rascunho",
    versao: 1,
    conteudo,
    itens: [],
    validade_ate: hojeMais(10),
    contexto: { upsell: RETRATO, materiais: [materialDoUpsell(RETRATO)] },
    token: null,
    atualizado_em: "2026-09-30T10:00:00Z",
    ...extra,
  };
}

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(MesaProposta))))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista", "proposta"] }],
    propostas: [linhaDoUpsell()],
    proposta_versoes: [],
    proposta_eventos: [],
    proposta_modelos: [],
    commercial_leads: [],
    financial_plans: [],
    financial_plan_versions: [],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "upsell_atualizar") return Promise.resolve({ data: { proposta: linhaDoUpsell({ versao: 2 }), avisos_upsell: [], custo_usd: 0 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("upsell na Mesa Proposta", () => {
  it("a casca volta para Clientes › Propostas e traz o Conselho com a proposta", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    const caminho = await screen.findByRole("navigation", { name: "Caminho" });
    expect(within(caminho).getByRole("link", { name: "Propostas" }).getAttribute("href")).toBe("/clientes?propostas=1");
    expect(screen.queryByRole("button", { name: /Mesa aberta:/ })).toBeNull();
    expect(document.querySelector('[data-botao-do-conselho="mesa-proposta"]')).toBeTruthy();
  });

  it("Rascunho: o que ele já tem aberto, o próximo passo, Sugerir com IA e Reler os dados de hoje", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    const previa = await screen.findByLabelText("Prévia ao vivo", {}, { timeout: 30000 });
    // Na página do cliente: o bloco com o plano e o resultado real.
    expect(within(previa).getByText("Growth, R$ 2.500,00 por mês, desde 01/06/2026")).toBeTruthy();
    expect(within(previa).getByText("4.210 seguidores na semana de 22/09 a 28/09.")).toBeTruthy();
    // No editor: o bloco aberto de início (sem clicar), e a solução com o título do próximo passo.
    expect(await screen.findByDisplayValue("Growth, R$ 2.500,00 por mês, desde 01/06/2026")).toBeTruthy();
    expect(screen.getAllByDisplayValue("Próximo passo").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-sugerir-proximo-passo] button")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sugerir o próximo passo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reler os dados de hoje" }));
    await waitFor(() => expect(chamadasDe("upsell_atualizar")).toHaveLength(1));
    expect(chamadasDe("upsell_atualizar")[0][1].body.proposta_id).toBe(PROPOSTA);
  });

  it("proposta de cliente novo não mostra o bloco nem o Sugerir o próximo passo", async () => {
    const nova = linhaDoUpsell({ contexto: {}, conteudo: conteudoDoModelo(MODELO_PADRAO_ACELERIQ) });
    mock.tabelas.propostas = [nova];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Prévia ao vivo", {}, { timeout: 30000 });
    expect(document.querySelector('[data-editor-do-bloco="ja_tem"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Sugerir o próximo passo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reler os dados de hoje" })).toBeNull();
  });
});
