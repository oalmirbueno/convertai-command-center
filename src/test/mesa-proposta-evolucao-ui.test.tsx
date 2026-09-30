import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Proposta, frente PRO2, na tela: os 3 pacotes no Investimento (o
 * nível de cada item vai no salvar), o follow-up no Envio (mensagem pronta e
 * "Já mandei" registra) e o modelo visual no Rascunho (a prévia muda na hora).
 * Frente UXS: o Salvar é o único da barra do pé de cada etapa.
 */

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
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t), storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }), upload: () => Promise.resolve({ data: null, error: null }) }) } } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Loja da Joana", plan_status: "inactive" }], isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import MesaProposta from "@/pages/MesaProposta";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const diasAtras = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function linha(extra: Record<string, unknown> = {}) {
  const conteudo = comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Mais pedidos pelo Instagram", subtitulo: "", projeto: "Redes" } });
  return {
    id: PROPOSTA,
    client_id: CLIENTE,
    numero: "2026-004",
    titulo: "Redes sociais",
    status: "rascunho",
    versao: 3,
    conteudo,
    itens: [
      { id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" },
      { id: "i2", nome: "Tráfego pago", valor_unitario: 1200, quantidade: 1, recorrencia: "mensal" },
    ],
    validade_ate: hojeMais(10),
    contexto: { notas: "A cliente quer vender mais pelo Instagram." },
    token: null,
    atualizado_em: "2026-09-30T10:00:00Z",
    pacotes: {},
    pagamento: {},
    visual: {},
    anexos: [],
    ...extra,
  };
}

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(MesaProposta))))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

// As etapas abrem por import sob demanda: aquecer antes para o teste não depender da ordem.
beforeAll(async () => {
  await Promise.all([
    import("@/components/mesa-proposta/EtapaContexto"),
    import("@/components/mesa-proposta/EtapaRascunho"),
    import("@/components/mesa-proposta/EtapaEnvio"),
    import("@/components/mesa-proposta/AgenteDaProposta"),
  ]);
}, 60000);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    propostas: [linha()],
    proposta_versoes: [],
    proposta_eventos: [],
    proposta_modelos: [],
    proposta_servicos: [],
    proposta_provas: [],
    commercial_leads: [],
    financial_plans: [],
    financial_plan_versions: [],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "salvar") return Promise.resolve({ data: { proposta: linha({ versao: 4, ...(body.pacotes ? { pacotes: body.pacotes } : {}), ...(body.visual ? { visual: body.visual } : {}) }), custo_usd: 0 }, error: null });
    if (body.acao === "followup") return Promise.resolve({ data: { followup: { situacao: "viu_sem_resposta", dias: 3 }, mensagem: "Oi, Joana. Ficou alguma dúvida?", numero: "5541999999999", custo_usd: 0 }, error: null });
    if (body.acao === "followup_registrar") return Promise.resolve({ data: { ok: true, custo_usd: 0 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("Mesa Proposta, PRO2 na tela", () => {
  it("Contexto: liga os 3 pacotes, escolhe o nível do item e o salvar leva os pacotes", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const caixa = await screen.findByRole("checkbox", { name: /Proposta com 3 pacotes/ }, { timeout: 30000 });
    fireEvent.click(caixa);
    fireEvent.change(await screen.findByLabelText("Pacote de Tráfego pago"), { target: { value: "completo" } });
    // UXS: o Salvar único fica na barra do pé do Contexto e leva só o que mudou (os itens não mudaram).
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar").length).toBe(1));
    const corpo = chamadasDe("salvar")[0][1].body;
    expect(corpo.pacotes).toMatchObject({ ativo: true, niveis: { i1: "essencial", i2: "completo" } });
    expect(Object.keys(corpo.pacotes.niveis).sort()).toEqual(["i1", "i2"]);
    expect(corpo.itens).toBeUndefined();
  });

  it("Envio: proposta vista há dias sem resposta mostra o follow-up com a mensagem pronta; Já mandei registra", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64), enviada_em: diasAtras(5), vista_em: diasAtras(3) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    // findByText na primeira espera: varre a árvore ~9x mais rápido que findByRole (a etapa abre sob carga).
    fireEvent.click(await screen.findByText("Preparar mensagem", {}, { timeout: 30000 }));
    expect(await screen.findByDisplayValue("Oi, Joana. Ficou alguma dúvida?")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Abrir no WhatsApp/ }).some((a) => (a.getAttribute("href") || "").indexOf("5541999999999") >= 0)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Já mandei" }));
    await waitFor(() => expect(chamadasDe("followup_registrar").length).toBe(1));
  });

  it("Rascunho: o modelo visual muda a prévia na hora e o salvar leva o visual", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    const previa = await screen.findByLabelText("Prévia ao vivo", {}, { timeout: 30000 });
    expect((previa.querySelector("[data-proposta-documento]") as HTMLElement).getAttribute("data-tema")).toBe("aceleriq");
    const secao = screen.getByText("Modelo visual", { selector: "h2" }).closest("section") as HTMLElement;
    fireEvent.click(within(secao).getByRole("button", { name: "Mostrar" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Claro/ }));
    expect((previa.querySelector("[data-proposta-documento]") as HTMLElement).getAttribute("data-tema")).toBe("claro");
    // UXS: o Salvar único da barra do pé leva o visual (e só ele, sem texto mudado).
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar").length).toBe(1));
    expect(chamadasDe("salvar")[0][1].body.visual).toEqual({ tema: "claro", cores: [] });
    expect(chamadasDe("salvar")[0][1].body.conteudo).toBeUndefined();
  });
});
