import { createElement as h, Fragment } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PRS (30/09), pedido do dono: "a parte de proposta está bem completa
 * e confusa". O caminho virou cinco etapas com o nome do que se faz
 * (Conversa, Rascunho, Revisar, Enviar, Acompanhar), cada uma termina no
 * próximo passo, o avançado mora recolhido e a "Nova proposta" é uma janela
 * só em todo o painel. Nenhuma função sumiu (o último bloco confere).
 */

configure({ asyncUtilTimeout: 30000 });

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown>, clientes: [] as Array<Record<string, unknown>> }));

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
  useClients: () => ({ data: mock.clientes, isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import MesaProposta from "@/pages/MesaProposta";
import AreaDePropostas from "@/components/clientes-propostas/AreaDePropostas";
import NovaProposta from "@/components/clientes-propostas/NovaProposta";
import PropostasDoCliente from "@/components/clientes-propostas/PropostasDoCliente";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";
import { ETAPAS_DA_PROPOSTA, etapaPeloStatus, etapasFeitas, proximaEtapa, temConversa, temRascunho } from "@/components/mesa-proposta/caminhoDaProposta";
import { normalizarProposta } from "@/components/mesa-proposta/propostaApi";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import { areaPorChave } from "../../supabase/functions/_shared/mapa-do-painel";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const ARQUIVADA = "33333333-3333-4333-8333-333333333333";
const OUTRA = "66666666-6666-4666-8666-666666666666";
const CLIENTE_B = "55555555-5555-4555-8555-555555555555";
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
const escrito = () => comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Mais pedidos pelo Instagram", subtitulo: "", projeto: "Redes" } });

function linha(extra: Record<string, unknown> = {}) {
  return {
    id: PROPOSTA,
    client_id: CLIENTE,
    numero: "2026-004",
    titulo: "Redes sociais",
    status: "rascunho",
    versao: 3,
    conteudo: escrito(),
    itens: [{ id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" }],
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

function Endereco() {
  const l = useLocation();
  return h("output", { "data-testid": "endereco" }, `${l.pathname}${l.search}`);
}

function montar(endereco: string, filho: ReturnType<typeof h> = h(MesaProposta)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, filho, h(Endereco))))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);
const ler = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
/** Tira os comentários (JSDoc, // e os de JSX): a ação precisa estar no código, não num comentário. */
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  mock.clientes = [
    { id: CLIENTE, company_name: "Loja da Joana", plan_status: "inactive" },
    { id: CLIENTE_B, company_name: "Padaria do Beto", plan_status: "inactive" },
  ];
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
  mock.invoke.mockImplementation((funcao: string, { body }: any) => {
    if (funcao === "contratos") return Promise.resolve({ data: { contrato: { id: "c1" }, ja_existia: false, custo_usd: 0 }, error: null });
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "gerar" && body.previa) return Promise.resolve({ data: { proposto: escrito(), tiradas: [], perguntas: [], custo_usd: 0.1 }, error: null });
    if (body.acao === "gerar") return Promise.resolve({ data: { proposta: linha({ versao: 4 }), tiradas: [], perguntas: [], custo_usd: 0.1 }, error: null });
    if (body.acao === "arquivar") return Promise.resolve({ data: { proposta: linha({ id: body.proposta_id, arquivada_em: body.arquivar ? "2026-09-30T12:00:00Z" : null }), custo_usd: 0 }, error: null });
    if (body.acao === "status_mudar") return Promise.resolve({ data: { proposta: linha({ status: body.status }), custo_usd: 0 }, error: null });
    if (body.acao === "criar") return Promise.resolve({ data: { proposta: { id: PROPOSTA, numero: "2026-020" }, custo_usd: 0 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

/** O BotaoComCusto mostra o custo no botão; caro ou sem estimativa, pede um segundo clique. */
async function clicarComCusto(nome: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: nome }));
  await new Promise((r) => setTimeout(r, 50));
  const armado = screen.queryByRole("button", { name: /clique de novo/i });
  if (armado) fireEvent.click(armado);
}

describe("o caminho da proposta (regras puras)", () => {
  it("cinco etapas na ordem do dono, próxima etapa e onde a proposta abre pelo status", () => {
    expect(ETAPAS_DA_PROPOSTA.map((e) => e.rotulo)).toEqual(["Conversa", "Rascunho", "Revisar", "Enviar", "Acompanhar"]);
    expect(proximaEtapa("contexto")).toBe("rascunho");
    expect(proximaEtapa("envio")).toBe("acompanhar");
    expect(proximaEtapa("acompanhar")).toBeNull();
    expect(etapaPeloStatus("rascunho")).toBe("contexto");
    for (const s of ["enviada", "vista", "aceita", "recusada", "expirada"]) expect(etapaPeloStatus(s)).toBe("acompanhar");
    // Trocando de proposta dentro da Mesa: a enviada sai do formulário do rascunho; o rascunho fica onde está.
    for (const atual of ["contexto", "rascunho", "revisao"] as const) expect(etapaPeloStatus("aceita", atual)).toBe("acompanhar");
    expect(etapaPeloStatus("vista", "envio")).toBe("envio");
    expect(etapaPeloStatus("rascunho", "revisao")).toBe("revisao");
    expect(etapaPeloStatus("rascunho", "acompanhar")).toBe("contexto");
  });

  it("os nomes novos chegam ao histórico de lugares e ao mapa dos agentes (com o Acompanhar)", () => {
    expect(rotuloDoLugar("/mesa-proposta", "?client=x&etapa=contexto")).toBe("Mesa Proposta · Conversa");
    expect(rotuloDoLugar("/mesa-proposta", "?client=x&etapa=acompanhar")).toBe("Mesa Proposta · Acompanhar");
    const mesa = areaPorChave("mesa_proposta")!;
    expect(mesa.etapas).toEqual(ETAPAS_DA_PROPOSTA.map((e) => e.valor));
  });

  it("o check de cada etapa: conversa com material e itens, rascunho escrito, nada bloqueando, enviada, aceita", () => {
    const vazia = normalizarProposta(linha({ conteudo: conteudoDoModelo(MODELO_PADRAO_ACELERIQ), contexto: {}, itens: [] }))!;
    expect(temConversa(vazia)).toBe(false);
    expect(temRascunho(vazia)).toBe(false);
    expect(etapasFeitas(vazia)).toEqual({ contexto: false, rascunho: false, revisao: false, envio: false, acompanhar: false });
    const pronta = normalizarProposta(linha())!;
    expect(etapasFeitas(pronta).contexto).toBe(true);
    expect(etapasFeitas(pronta).rascunho).toBe(true);
    expect(etapasFeitas(normalizarProposta(linha({ status: "vista", token: "a".repeat(64) }))!).envio).toBe(true);
    expect(etapasFeitas(normalizarProposta(linha({ status: "aceita" }))!).acompanhar).toBe(true);
    expect(etapasFeitas(null).contexto).toBe(false);
  });
});

describe("Conversa: o que o cliente disse, o que vai oferecer e o próximo passo", () => {
  it("sem rascunho: 'Gerar o rascunho com IA' (custo antes) gera com as fontes padrão e leva ao Rascunho", async () => {
    mock.tabelas.propostas = [linha({ conteudo: conteudoDoModelo(MODELO_PADRAO_ACELERIQ) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Notas da equipe");
    // Sem a lista de propostas nem o formulário de nova proposta dentro da etapa.
    expect(screen.queryByText("Propostas", { selector: "h2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova proposta" })).toBeNull();
    await clicarComCusto(/Gerar o rascunho com IA/);
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    const corpo = chamadasDe("gerar")[0][1].body;
    expect(corpo).toMatchObject({ proposta_id: PROPOSTA, modelo_id: "openai:gpt-6-sol", pesquisar: true, fontes: ["reuniao", "briefing", "contexto"] });
    expect(corpo.previa).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("etapa=rascunho"));
  });

  it("com rascunho escrito: o próximo passo é 'Seguir para Rascunho' (sem gerar de novo daqui)", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Notas da equipe");
    expect(screen.queryByRole("button", { name: /Gerar o rascunho com IA/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Seguir para Rascunho/ }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("etapa=rascunho"));
  });

  it("pacotes, horas, hora técnica, pagamento e lead ficam em 'Mais opções de preço' (recolhido, com a linha de estado)", async () => {
    mock.tabelas.propostas = [linha({ pagamento: { opcoes: [{ id: "a_vista", tipo: "a_vista", desconto_pct: 5, parcelas: 1, entrada_pct: 0, observacao: "" }] } })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const mais = await screen.findByRole("button", { name: /Mais opções de preço/ });
    expect(mais.getAttribute("aria-expanded")).toBe("false");
    expect(mais.textContent).toContain("à vista 5%");
    expect(screen.queryByRole("checkbox", { name: /Proposta com 3 pacotes/ })).toBeNull();
    fireEvent.click(mais);
    expect(screen.getByRole("checkbox", { name: /Proposta com 3 pacotes/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Horas por item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Calculadora" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "À vista" })).toBeTruthy();
    expect(screen.getByLabelText("Lead do Comercial")).toBeTruthy();
  });
});

describe("Rascunho: um botão de gerar", () => {
  it("com texto, 'Gerar de novo' sempre mostra a prévia antes de gravar; gravar direto e só o mercado ficam nos Ajustes da IA", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Prévia ao vivo");
    expect(screen.queryByRole("button", { name: /Preencher tudo/ })).toBeNull();
    const ajustes = screen.getByRole("button", { name: /Ajustes da IA/ });
    expect(ajustes.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Só pesquisar o mercado/ })).toBeNull();
    fireEvent.click(ajustes);
    expect(screen.getByRole("button", { name: /Só pesquisar o mercado/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gerar e gravar sem prévia/ })).toBeTruthy();
    await clicarComCusto(/^Gerar de novo/);
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    expect(chamadasDe("gerar")[0][1].body.previa).toBe(true);
    expect(await screen.findByText("O que a IA propõe")).toBeTruthy();
    expect(chamadasDe("salvar")).toHaveLength(0);
  });
});

describe("as ações da proposta num lugar só (o ... ao lado do seletor)", () => {
  it("Todas as propostas abre no centro, com as arquivadas num clique", async () => {
    mock.tabelas.propostas = [linha(), linha({ id: ARQUIVADA, numero: "2026-001", titulo: "Antiga", arquivada_em: "2026-09-01T10:00:00Z" })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=revisao&proposta=${PROPOSTA}`);
    await screen.findByText("Antes de enviar", { selector: "h2" });
    // No celular, um controle só com o fim do número (trocar, nova e as ações).
    expect((document.querySelector("[data-menu-da-proposta-celular]") as HTMLElement).textContent).toContain("Nº 004");
    fireEvent.keyDown(screen.getAllByRole("button", { name: "Ações da proposta" })[0], { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Todas as propostas" }));
    const janela = await screen.findByRole("dialog", { name: /Propostas do cliente/ });
    expect(janela.getAttribute("data-janela-central")).toBe("");
    expect(within(janela).queryByText("Antiga")).toBeNull();
    fireEvent.click(within(janela).getByRole("button", { name: "Ver arquivadas" }));
    expect(within(janela).getByText("Antiga")).toBeTruthy();
  });

  it("Arquivar grava direto; Marcar recusada pede Confirmar antes", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=acompanhar&proposta=${PROPOSTA}`);
    await screen.findByText("Situação", { selector: "h2" });
    const menu = () => screen.getAllByRole("button", { name: "Ações da proposta" })[0];
    fireEvent.keyDown(menu(), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar recusada" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(chamadasDe("status_mudar")).toHaveLength(0);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Marcar recusada" }));
    await waitFor(() => expect(chamadasDe("status_mudar")).toHaveLength(1));
    expect(chamadasDe("status_mudar")[0][1].body.status).toBe("recusada");
  });
});

describe("Enviar só envia; Acompanhar mostra o depois", () => {
  it("Enviar não tem mais o rastreio nem o follow-up; Acompanhar tem aberturas, follow-up e a linha do tempo", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "e".repeat(64), enviada_em: new Date(Date.now() - 5 * 86400000).toISOString(), vista_em: new Date(Date.now() - 3 * 86400000).toISOString() })];
    const { unmount } = montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Link da proposta");
    expect(screen.queryByText("Rastreio")).toBeNull();
    expect(screen.queryByText("Preparar mensagem")).toBeNull();
    unmount();
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=acompanhar&proposta=${PROPOSTA}`);
    expect(await screen.findByText("Aberturas")).toBeTruthy();
    expect(screen.getByText("Preparar mensagem")).toBeTruthy();
    expect(screen.getByText("Linha do tempo", { selector: "h2" })).toBeTruthy();
  });

  it("aceita: Gerar contrato no Acompanhar, com Confirmar antes", async () => {
    mock.tabelas.propostas = [linha({ status: "aceita", token: "f".repeat(64), aceite: { nome: "Joana" }, aceita_em: "2026-09-29T10:00:00Z" })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=acompanhar&proposta=${PROPOSTA}`);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar contrato" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Gerar contrato" }));
    await waitFor(() => expect(mock.invoke.mock.calls.filter((c) => c[0] === "contratos")).toHaveLength(1));
  });

  it("as etapas feitas ganham o check pequeno (proposta vista: Conversa a Enviar)", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=acompanhar&proposta=${PROPOSTA}`);
    await screen.findByText("Situação", { selector: "h2" });
    const feitas = Array.prototype.slice.call(document.querySelectorAll("[data-etapa-feita]")).map((el: Element) => (el.closest("[data-etapa]") as HTMLElement).getAttribute("data-etapa"));
    expect(feitas).toEqual(["contexto", "rascunho", "revisao", "envio"]);
  });
});

describe("a proposta abre na etapa do status dela (também dentro da Mesa)", () => {
  const aceita = () => linha({ id: OUTRA, numero: "2026-009", titulo: "Site", status: "aceita", token: "a".repeat(64), aceite: { nome: "Joana" }, aceita_em: "2026-09-29T10:00:00Z" });

  it("na Conversa, escolher uma proposta aceita no seletor da casca abre no Acompanhar", async () => {
    mock.tabelas.propostas = [linha(), aceita()];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Notas da equipe");
    fireEvent.click(screen.getByRole("button", { name: /^Proposta: Nº 2026-004 · Rascunho$/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Nº 2026-009/ }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`proposta=${OUTRA}`));
    expect(screen.getByTestId("endereco").textContent).toContain("etapa=acompanhar");
    expect(await screen.findByText("Situação", { selector: "h2" })).toBeTruthy();
    expect(screen.queryByLabelText("Notas da equipe")).toBeNull();
  });

  it("no celular, o controle único também leva a aceita ao Acompanhar", async () => {
    mock.tabelas.propostas = [linha(), aceita()];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Prévia ao vivo");
    fireEvent.keyDown(document.querySelector("[data-menu-da-proposta-celular]") as HTMLElement, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Nº 2026-009/ }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("etapa=acompanhar"));
  });

  it("sem etapa no endereço, a mais recente aceita abre no Acompanhar; com etapa no link, a etapa fica", async () => {
    mock.tabelas.propostas = [aceita()];
    const { unmount } = montar(`/mesa-proposta?client=${CLIENTE}`);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`proposta=${OUTRA}`));
    expect(screen.getByTestId("endereco").textContent).toContain("etapa=acompanhar");
    unmount();
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=revisao`);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`proposta=${OUTRA}`));
    expect(screen.getByTestId("endereco").textContent).toContain("etapa=revisao");
  });
});

describe("o pedido do ... vale uma vez só", () => {
  function Navegar() {
    const ir = useNavigate();
    return h(
      Fragment,
      null,
      h("button", { type: "button", "data-testid": "ir-para-b", onClick: () => ir(`/mesa-proposta?client=${CLIENTE_B}&etapa=contexto&proposta=${OUTRA}`) }),
      h("button", { type: "button", "data-testid": "voltar", onClick: () => ir(-1) }),
    );
  }

  it("arquivar no cliente B e voltar (Voltar do navegador) para o A não arquiva a proposta do A", async () => {
    mock.tabelas.propostas = [linha(), linha({ id: OUTRA, client_id: CLIENTE_B, numero: "2026-007", titulo: "Pães" })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`, h(Fragment, null, h(MesaProposta), h(Navegar)));
    await screen.findByLabelText("Notas da equipe");
    fireEvent.click(screen.getByTestId("ir-para-b"));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`client=${CLIENTE_B}`));
    await screen.findByLabelText("Notas da equipe");
    fireEvent.keyDown(screen.getAllByRole("button", { name: "Ações da proposta" })[0], { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Arquivar" }));
    await waitFor(() => expect(chamadasDe("arquivar")).toHaveLength(1));
    expect(chamadasDe("arquivar")[0][1].body.proposta_id).toBe(OUTRA);
    fireEvent.click(screen.getByTestId("voltar"));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`client=${CLIENTE}&`));
    await screen.findByLabelText("Notas da equipe");
    await new Promise((r) => setTimeout(r, 300));
    expect(chamadasDe("arquivar")).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a janela Todas as propostas não reabre sozinha ao trocar de cliente", async () => {
    mock.tabelas.propostas = [linha(), linha({ id: OUTRA, client_id: CLIENTE_B, numero: "2026-007", titulo: "Pães" })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`, h(Fragment, null, h(MesaProposta), h(Navegar)));
    await screen.findByLabelText("Notas da equipe");
    fireEvent.keyDown(screen.getAllByRole("button", { name: "Ações da proposta" })[0], { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Todas as propostas" }));
    const janela = await screen.findByRole("dialog", { name: /Propostas do cliente/ });
    fireEvent.keyDown(janela, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Propostas do cliente/ })).toBeNull());
    fireEvent.click(screen.getByTestId("ir-para-b"));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`client=${CLIENTE_B}`));
    await screen.findByLabelText("Notas da equipe");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("dialog", { name: /Propostas do cliente/ })).toBeNull();
  });
});

describe("Nova proposta: a mesma janela em todo lugar", () => {
  it("Clientes: um botão só (Nova proposta); o tipo se escolhe na janela", async () => {
    mock.tabelas = { propostas: [], commercial_leads: [] };
    montar("/clientes?propostas=1", h(AreaDePropostas, { clientes: [{ id: CLIENTE, nome: "Loja da Joana" }], nomeDoCliente: () => "Loja da Joana", podeCriarCliente: true, abrirNaEntrada: true }));
    expect(screen.queryByRole("button", { name: "Proposta de upsell" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova proposta" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Cliente novo", "Cliente da casa", "Upsell"]);
  });

  it("Cliente da casa: venda nova para quem já é cliente, com projeto e modelo em Mais opções", async () => {
    mock.tabelas = { commercial_leads: [], proposta_modelos: [{ id: "44444444-4444-4444-8444-444444444444", nome: "Site", descricao: "", padrao: false, blocos: [], validade_dias: 15, condicoes: "" }] };
    montar("/clientes", h(NovaProposta, { aberta: true, onAberta: vi.fn(), tipoInicial: "casa", clientes: [{ id: CLIENTE, nome: "Loja da Joana" }], podeCriarCliente: true, onCriarCliente: vi.fn() }));
    const janela = await screen.findByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Cliente da proposta"), { target: { value: CLIENTE } });
    fireEvent.change(within(janela).getByLabelText("Projeto"), { target: { value: "Site novo" } });
    fireEvent.click(within(janela).getByRole("button", { name: /Mais opções/ }));
    const modelo = within(janela).getByLabelText("Modelo de proposta") as HTMLSelectElement;
    await waitFor(() => expect(modelo.querySelectorAll("option").length).toBe(2));
    fireEvent.change(modelo, { target: { value: "44444444-4444-4444-8444-444444444444" } });
    fireEvent.click(within(janela).getByRole("button", { name: /^Criar proposta$/ }));
    await waitFor(() => expect(chamadasDe("criar")).toHaveLength(1));
    expect(chamadasDe("criar")[0][1].body).toMatchObject({ client_id: CLIENTE, titulo: "Site novo", modelo_id: "44444444-4444-4444-8444-444444444444" });
    expect(chamadasDe("criar")[0][1].body.tipo).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${PROPOSTA}&etapa=contexto`));
  });

  it("ficha do cliente: Nova proposta abre a janela já com o cliente (Venda nova e Upsell), sem criar sozinho", async () => {
    mock.tabelas = { propostas: [], commercial_leads: [] };
    montar("/clientes", h(PropostasDoCliente, { cliente: { id: CLIENTE, nome: "Loja da Joana" }, onAbrir: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Nova proposta para este cliente" }));
    const janela = await screen.findByRole("dialog");
    expect(chamadasDe("criar")).toHaveLength(0);
    expect(within(janela).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Venda nova", "Upsell"]);
    expect(within(janela).queryByLabelText("Cliente da proposta")).toBeNull();
    fireEvent.click(within(janela).getByRole("tab", { name: "Upsell" }));
    fireEvent.click(within(janela).getByRole("button", { name: "Criar proposta de upsell" }));
    await waitFor(() => expect(chamadasDe("criar")).toHaveLength(1));
    expect(chamadasDe("criar")[0][1].body).toMatchObject({ client_id: CLIENTE, tipo: "upsell" });
  });

  it("a seção da ficha não tem mais o botão de upsell solto e a linha de Clientes não cria direto", () => {
    expect(semComentarios(ler("src/components/clientes-propostas/PropostasDoCliente.tsx"))).not.toContain("data-botao-upsell");
    // O "..." da linha de Clientes abre a janela (o teste renderizado mora em prs-clientes-linha.test.tsx).
    expect(semComentarios(ler("src/pages/Clients.tsx"))).not.toContain("criarProposta(");
  });
});

describe("nenhuma função sumiu", () => {
  it("o ... da proposta (renderizado) tem todas as ações de antes", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=acompanhar&proposta=${PROPOSTA}`);
    await screen.findByText("Situação", { selector: "h2" });
    fireEvent.keyDown(screen.getAllByRole("button", { name: "Ações da proposta" })[0], { key: "Enter" });
    await screen.findByRole("menuitem", { name: "Todas as propostas" });
    const itens = screen.getAllByRole("menuitem").map((i) => (i.textContent || "").trim());
    for (const a of ["Todas as propostas", "Biblioteca comercial", "Duplicar", "Salvar como modelo", "Voltar para rascunho", "Arquivar", "Marcar recusada"]) expect(itens).toContain(a);
  });

  it("os Ajustes da IA do Rascunho (renderizado) guardam modelo, fontes, gravar sem prévia e só o mercado", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    await screen.findByLabelText("Prévia ao vivo");
    fireEvent.click(screen.getByRole("button", { name: /Ajustes da IA/ }));
    expect(screen.getAllByText("Modelo de IA").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Gerar e gravar sem prévia/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Só pesquisar o mercado/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Pesquisa de mercado na web/ })).toBeTruthy();
  });

  it("cada ação de antes continua na tela (só mudou de lugar ou foi recolhida)", () => {
    const fontes = [
      "src/components/mesa-proposta/EtapaContexto.tsx",
      "src/components/mesa-proposta/EtapaRascunho.tsx",
      "src/components/mesa-proposta/EtapaRevisao.tsx",
      "src/components/mesa-proposta/EtapaEnvio.tsx",
      "src/components/mesa-proposta/EtapaAcompanhar.tsx",
      "src/components/mesa-proposta/AcoesDaProposta.tsx",
      "src/components/mesa-proposta/GeracaoDaProposta.tsx",
      "src/components/mesa-proposta/PagamentoDaProposta.tsx",
      "src/components/mesa-proposta/AnexosDaProposta.tsx",
      "src/components/mesa-proposta/FollowupDaProposta.tsx",
      "src/components/clientes-propostas/NovaProposta.tsx",
    ]
      .map((f) => semComentarios(ler(f)))
      .join("\n");
    const acoes = [
      "Anexar", "Resumir", "Pôr embaixo das notas", "Responder", "Adicionar", "Gerenciar a biblioteca", "Proposta com 3 pacotes", "Horas por item", "Calculadora", "Pacote em destaque",
      "Lead do Comercial", "Usar o sugerido", "Validade",
      "Sugerir o próximo passo", "Gerar o rascunho", "Gerar de novo", "Gerar e gravar sem prévia", "Só pesquisar o mercado", "Pesquisa de mercado na web", "Site do cliente", "Modelo de IA",
      "3 headlines", "Tom da marca", "Reler os dados de hoje", "Preencher o bloco", "Modelo visual", "Anexar link",
      "Resolver", "Revisar com IA", "Números sem origem", "Fontes do mercado", "Comparar", "Restaurar",
      "Enviar de novo", "Copiar mensagem", "Abrir no WhatsApp", "Copiar e-mail", "Mandar e-mail",
      "Preparar mensagem", "Já mandei", "Gerar contrato", "Tempo de leitura", "Linha do tempo",
      "Todas as propostas", "Ver arquivadas", "Biblioteca comercial", "Duplicar", "Salvar como modelo", "Voltar para rascunho", "Desarquivar", "Marcar recusada",
      "Cliente novo", "Cliente da casa", "Upsell", "Modelo de proposta", "Criar o cliente e seguir",
    ];
    const faltando = acoes.filter((a) => fontes.indexOf(a) < 0);
    expect(faltando).toEqual([]);
  });
});
