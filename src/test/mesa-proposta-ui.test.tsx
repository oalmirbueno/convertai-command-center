import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Proposta (frente PRO): a tela contra o contrato da função
 * mesa-proposta, com banco e função simulados. Contexto (abrir, criar,
 * investimento pelos itens), Rascunho (prévia ao vivo e salvar com a versão
 * de base), Envio (bloqueio pelas pendências e Confirmar antes do link) e o
 * estrategista (proposta e modelo escolhidos vão no pedido).
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
import MesaProposta, { ETAPAS_DA_MESA_PROPOSTA } from "@/pages/MesaProposta";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
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
    itens: [{ id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" }],
    validade_ate: hojeMais(10),
    contexto: { notas: "A cliente quer vender mais pelo Instagram." },
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
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    propostas: [linha()],
    proposta_versoes: [{ versao: 2, titulo: "Redes sociais", origem: "geracao", nota: "Proposta escrita", criado_em: "2026-09-30T09:00:00Z" }],
    proposta_eventos: [],
    proposta_modelos: [],
    commercial_leads: [],
    financial_plans: [],
    financial_plan_versions: [],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "criar") return Promise.resolve({ data: { proposta: linha({ id: "33333333-3333-4333-8333-333333333333", numero: "2026-005", versao: 1 }), custo_usd: 0 }, error: null });
    if (body.acao === "salvar") return Promise.resolve({ data: { proposta: linha({ versao: 4, titulo: body.titulo || "Redes sociais", conteudo: body.conteudo || linha().conteudo }), custo_usd: 0 }, error: null });
    if (body.acao === "enviar") return Promise.resolve({ data: { proposta: linha({ status: "enviada", token: "b".repeat(64) }), link: `https://painel.test/proposta/${"b".repeat(64)}`, whatsapp: { texto: "Oi. Segue a proposta.", numero: "5541999999999" }, email: { assunto: "Proposta", texto: "Olá", para: "joana@loja.com.br" }, custo_usd: 0 }, error: null });
    if (body.acao === "agente_conversar") return Promise.resolve({ data: { conversa_id: "44444444-4444-4444-8444-444444444444", mensagem_id: "55555555-5555-4555-8555-555555555555", resposta: "Qual o preço do site?", anexos: [], custo_usd: 0.01 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("Mesa Proposta", () => {
  it("quatro etapas: Contexto, Rascunho, Revisão e Envio", () => {
    expect(ETAPAS_DA_MESA_PROPOSTA.map((e) => e.rotulo)).toEqual(["Contexto", "Rascunho", "Revisão", "Envio"]);
  });

  it("Contexto: abre a proposta do cliente e mostra o investimento que sai dos itens", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto`);
    expect(await screen.findByText("2026-004")).toBeTruthy();
    const investimento = await screen.findByText("Investimento");
    expect(investimento).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/R\$ 1\.800,00 por mês/).length).toBeGreaterThan(0));
    expect((screen.getByDisplayValue("Gestão de redes") as HTMLInputElement).value).toBe("Gestão de redes");
  });

  it("Contexto: Nova proposta chama criar com o cliente", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto`);
    await screen.findByText("2026-004");
    fireEvent.click(screen.getByRole("button", { name: "Nova proposta" }));
    fireEvent.click(await screen.findByRole("button", { name: /Criar proposta/ }));
    await waitFor(() => expect(chamadasDe("criar").length).toBe(1));
    expect(chamadasDe("criar")[0][1].body.client_id).toBe(CLIENTE);
  });

  it("Rascunho: a prévia muda ao vivo e Salvar manda o conteúdo com a versão de base", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    const previa = await screen.findByLabelText("Prévia ao vivo", {}, { timeout: 30000 });
    expect(within(previa).getByText("Mais pedidos pelo Instagram")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Capa/ }));
    const headline = await screen.findByDisplayValue("Mais pedidos pelo Instagram");
    fireEvent.change(headline, { target: { value: "Clientes novos toda semana" } });
    await waitFor(() => expect(within(previa).getByText("Clientes novos toda semana")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar").length).toBe(1));
    const corpo = chamadasDe("salvar")[0][1].body;
    expect(corpo.versao_base).toBe(3);
    expect(corpo.conteudo.blocos[0].dados.headline).toBe("Clientes novos toda semana");
  });

  it("Envio: pendência que bloqueia deixa o botão desligado", async () => {
    mock.tabelas.propostas = [linha({ itens: [] })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    expect(await screen.findByText("Faltam os itens e os valores do investimento.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Enviar$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Envio: Confirmar antes; depois o link e o WhatsApp prontos (nada sai sozinho)", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    fireEvent.click(await screen.findByRole("button", { name: /^Enviar$/ }));
    expect(chamadasDe("enviar").length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar envio" }));
    await waitFor(() => expect(chamadasDe("enviar").length).toBe(1));
    expect(await screen.findByLabelText("Link da proposta")).toBeTruthy();
    const whats = screen.getByRole("link", { name: /Abrir no WhatsApp/ }) as HTMLAnchorElement;
    expect(whats.href).toContain("wa.me/5541999999999");
    expect(chamadasDe("enviar_email").length).toBe(0);
  });

  it("o estrategista recebe a proposta aberta e o modelo escolhido", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const campo = await screen.findByLabelText("Mensagem ao estrategista");
    fireEvent.change(campo, { target: { value: "Monte o investimento" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao estrategista" }));
    await waitFor(() => expect(chamadasDe("agente_conversar").length).toBe(1));
    const corpo = chamadasDe("agente_conversar")[0][1].body;
    expect(corpo.proposta_id).toBe(PROPOSTA);
    expect(corpo.modelo_id).toBe("openai:gpt-6-sol");
    expect(await screen.findByText("Qual o preço do site?")).toBeTruthy();
  });
});
