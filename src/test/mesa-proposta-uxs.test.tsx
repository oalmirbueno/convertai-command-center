import { createElement as h } from "react";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Proposta, frente UXS (30/09): simplificações aprovadas pelo dono.
 * - Salvar único na barra do pé: nada some da tela (notas, seção suja), o
 *   pedido leva só o que mudou e salvar notas não tira o link.
 * - Confirmar antes de tirar o link do cliente (enviada ou vista).
 * - Envio com o contato do cliente a qualquer momento (sem Confirmar de novo).
 * - Seletor da proposta na casca (a etapa remonta ao trocar de proposta).
 * - ?nova=1, "Resolver" das pendências, item inválido apontado, Anexar
 *   desligado com nota não salva, fonte do mercado em um clique e "Salvar
 *   como modelo" no menu do Envio.
 */

configure({ asyncUtilTimeout: 30000 });

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

import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import MesaProposta from "@/pages/MesaProposta";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ } from "../../supabase/functions/_shared/proposta-modelo";
import { CAMPOS_QUE_TIRAM_O_LINK, tiraOLink } from "../../supabase/functions/_shared/proposta-comercial";
import { assinatura } from "@/components/mesa-proposta/edicaoDaProposta";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";
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
    pacotes: {},
    pagamento: {},
    visual: {},
    anexos: [],
    ...extra,
  };
}

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(ConfirmDialogProvider, null, h(TooltipProvider, null, h(MesaProposta))))));
  return { qc, ...tela };
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);
const botaoSalvar = () => screen.getByRole("button", { name: "Salvar" });

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
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
    if (body.acao === "salvar") {
      // A função devolve a proposta gravada (o que veio no pedido entra; a versão sobe).
      const base = (mock.tabelas.propostas as any[])[0];
      const contexto = { ...base.contexto, ...(typeof body.notas === "string" ? { notas: body.notas } : {}), ...(typeof body.transcricao === "string" ? { transcricao: body.transcricao } : {}) };
      const tira = CAMPOS_QUE_TIRAM_O_LINK.some((k) => k in body) && base.status !== "rascunho";
      const nova = { ...base, versao: base.versao + 1, contexto, ...(body.itens ? { itens: body.itens } : {}), ...(body.pagamento ? { pagamento: body.pagamento } : {}), ...(body.lead_id !== undefined ? { lead_id: body.lead_id } : {}), ...(tira ? { status: "rascunho", token: null } : {}) };
      return Promise.resolve({ data: { proposta: nova, custo_usd: 0 }, error: null });
    }
    if (body.acao === "material_remover") {
      const base = (mock.tabelas.propostas as any[])[0];
      return Promise.resolve({ data: { proposta: { ...base, versao: base.versao + 1, contexto: { ...base.contexto, materiais: [] } }, custo_usd: 0 }, error: null });
    }
    if (body.acao === "contato") return Promise.resolve({ data: { nome: "Joana Lima", email: "joana@loja.com.br", numero: "5541988887777", custo_usd: 0 }, error: null });
    if (body.acao === "enviar") return Promise.resolve({ data: { proposta: linha({ status: "enviada", token: "b".repeat(64) }), link: `https://painel.test/proposta/${"b".repeat(64)}`, whatsapp: { texto: "Oi. Segue a proposta A.", numero: "5541999999999" }, email: { assunto: "Proposta", texto: "Olá", para: "joana@loja.com.br" }, custo_usd: 0 }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("regras puras (UXS)", () => {
  it("tirar o link: a mesma lista do servidor, só fora de rascunho e de aceita", () => {
    expect(Array.from(CAMPOS_QUE_TIRAM_O_LINK).sort()).toEqual(["anexos", "conteudo", "itens", "pacotes", "pagamento", "titulo", "validade_ate", "visual"]);
    expect(tiraOLink("vista", ["itens"])).toBe(true);
    expect(tiraOLink("recusada", ["visual"])).toBe(true);
    expect(tiraOLink("enviada", ["notas", "transcricao", "lead_id"])).toBe(false);
    expect(tiraOLink("rascunho", ["conteudo"])).toBe(false);
    expect(tiraOLink("aceita", ["conteudo"])).toBe(false);
    const servidor = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../supabase/functions/mesa-proposta/index.ts"), "utf8") as string;
    expect(servidor).toContain("const mudaTexto = CAMPOS_QUE_TIRAM_O_LINK.some((k) => k in mudancas);");
  });

  it("assinatura curta e estável (a base guardada no navegador não dobra o texto)", () => {
    expect(assinatura("abc")).toBe(assinatura("abc"));
    expect(assinatura("abc")).not.toBe(assinatura("abd"));
    expect(assinatura({ a: 1 }).length).toBeLessThan(20);
  });
});

describe("Contexto: um Salvar só, sem perder texto", () => {
  it("(a) notas digitadas e Pagamento mudado: um pedido só, as notas ficam na tela e vão no pedido", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const notas = (await screen.findByLabelText("Notas da equipe")) as HTMLTextAreaElement;
    fireEvent.change(notas, { target: { value: "Quer 3 posts por semana." } });
    fireEvent.click(screen.getByRole("checkbox", { name: "À vista" }));
    expect(await screen.findByText("Não salvo: Reunião, Pagamento")).toBeTruthy();
    fireEvent.click(botaoSalvar());
    await waitFor(() => expect(chamadasDe("salvar")).toHaveLength(1));
    const corpo = chamadasDe("salvar")[0][1].body;
    expect(corpo.notas).toBe("Quer 3 posts por semana.");
    expect(corpo.pagamento.opcoes.map((o: { tipo: string }) => o.tipo)).toEqual(["a_vista"]);
    expect(corpo.itens).toBeUndefined();
    expect(corpo.versao_base).toBe(3);
    await waitFor(() => expect((screen.getByLabelText("Notas da equipe") as HTMLTextAreaElement).value).toBe("Quer 3 posts por semana."));
    await waitFor(() => expect(screen.queryByText(/Não salvo:/)).toBeNull());
  });

  it("(b) versão nova (relerTudo): a seção limpa mostra os itens novos; a suja fica com o que foi digitado", async () => {
    const { qc } = montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    await screen.findByDisplayValue("Gestão de redes");
    mock.tabelas.propostas = [linha({ versao: 4, itens: [{ id: "i1", nome: "Gestão de redes", valor_unitario: 1800, quantidade: 1, recorrencia: "mensal" }, { id: "i3", nome: "Site novo", valor_unitario: 5000, quantidade: 1, recorrencia: "unico" }] })];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["mesa-proposta", "propostas", CLIENTE] });
    });
    expect(await screen.findByDisplayValue("Site novo")).toBeTruthy();

    // Agora suja: o que a pessoa digitou não é trocado pela versão que chega.
    fireEvent.change(screen.getByDisplayValue("Gestão de redes"), { target: { value: "Gestão completa" } });
    mock.tabelas.propostas = [linha({ versao: 5, itens: [{ id: "i9", nome: "Tráfego", valor_unitario: 900, quantidade: 1, recorrencia: "mensal" }] })];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["mesa-proposta", "propostas", CLIENTE] });
    });
    expect(screen.getByDisplayValue("Gestão completa")).toBeTruthy();
    expect(screen.queryByDisplayValue("Tráfego")).toBeNull();
    expect(screen.getByText("Não salvo: Investimento")).toBeTruthy();
  });

  it("(c) salvar só as notas numa proposta enviada: o pedido não leva itens, pagamento, pacotes nem visual, e não pergunta nada", async () => {
    mock.tabelas.propostas = [linha({ status: "enviada", token: "c".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    fireEvent.change(await screen.findByLabelText("Notas da equipe"), { target: { value: "Ligou pedindo prazo." } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(Object.keys(chamadasDe("salvar")[0][1].body).sort()).toEqual(["acao", "notas", "proposta_id", "versao_base"]);
  });

  it("(d) Arquivos gravam direto e não apagam uma seção suja", async () => {
    mock.tabelas.propostas = [linha({ contexto: { notas: "Notas", materiais: [{ nome: "briefing.txt", tipo: "texto", texto: "abc", em: "2026-09-30T10:00:00Z" }] } })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    fireEvent.change(await screen.findByDisplayValue("1800"), { target: { value: "2100" } });
    expect(await screen.findByText("Não salvo: Investimento")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tirar briefing.txt" }));
    await waitFor(() => expect(chamadasDe("material_remover")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("briefing.txt")).toBeNull());
    expect(screen.getByDisplayValue("2100")).toBeTruthy();
    expect(screen.getByText("Não salvo: Investimento")).toBeTruthy();
  });

  it("o rascunho das notas guardado na chave antiga (com a versão) volta e fica como não salvo", async () => {
    window.localStorage.setItem(`tela:anon:/:mesa-proposta:notas:${PROPOSTA}:3`, JSON.stringify({ v: "Notas digitadas ontem.", em: Date.now() }));
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    await waitFor(() => expect((screen.getByLabelText("Notas da equipe") as HTMLTextAreaElement).value).toBe("Notas digitadas ontem."));
    expect(await screen.findByText("Não salvo: Reunião")).toBeTruthy();
    expect(window.localStorage.getItem(`tela:anon:/:mesa-proposta:notas:${PROPOSTA}:3`)).toBeNull();
  });

  it("Descartar pergunta antes e volta ao que está salvo", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    fireEvent.change(await screen.findByLabelText("Notas da equipe"), { target: { value: "Rascunho que vai embora" } });
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Descartar o que não foi salvo?")).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect((screen.getByLabelText("Notas da equipe") as HTMLTextAreaElement).value).toBe("A cliente quer vender mais pelo Instagram."));
    expect(chamadasDe("salvar")).toHaveLength(0);
  });

  it("Rascunho: versão nova não apaga a edição; a linha 'A proposta mudou' só aparece se o texto mudou no banco", async () => {
    const { qc } = montar(`/mesa-proposta?client=${CLIENTE}&etapa=rascunho&proposta=${PROPOSTA}`);
    fireEvent.click(await screen.findByRole("button", { name: /Capa/ }));
    fireEvent.change(await screen.findByDisplayValue("Mais pedidos pelo Instagram"), { target: { value: "Clientes novos toda semana" } });
    // Versão nova só com anexo (o texto é o mesmo): a edição fica e nada de aviso.
    mock.tabelas.propostas = [linha({ versao: 4, anexos: [{ id: "a1", tipo: "link", titulo: "Portfólio", url: "https://exemplo.com", caminho: "" }] })];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["mesa-proposta", "propostas", CLIENTE] });
    });
    expect(screen.getByDisplayValue("Clientes novos toda semana")).toBeTruthy();
    expect(screen.queryByText("A proposta mudou:")).toBeNull();
    // Agora o texto mudou no banco (o agente trocou o título): aparece a linha, e manter fica com a edição.
    mock.tabelas.propostas = [linha({ versao: 5, titulo: "Redes e tráfego" })];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["mesa-proposta", "propostas", CLIENTE] });
    });
    expect(await screen.findByText("A proposta mudou:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "manter a minha edição" }));
    await waitFor(() => expect(screen.queryByText("A proposta mudou:")).toBeNull());
    expect(screen.getByDisplayValue("Clientes novos toda semana")).toBeTruthy();
  });

  it("Anexar da reunião fica desligado com nota não salva (salve antes)", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const notas = await screen.findByLabelText("Notas da equipe");
    // O Anexar da Reunião (o estrategista tem o dele, na conversa).
    const reuniao = document.getElementById("proposta-reuniao") as HTMLElement;
    const anexar = () => within(reuniao).getByRole("button", { name: "Anexar arquivos" }) as HTMLButtonElement;
    expect(anexar().disabled).toBe(false);
    fireEvent.change(notas, { target: { value: "Nota nova" } });
    await waitFor(() => expect(anexar().disabled).toBe(true));
    expect(anexar().getAttribute("title")).toBe("Salve antes de anexar");
  });

  it("item sem valor: o Salvar não manda nada, marca o campo e diz qual item", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    fireEvent.change(await screen.findByDisplayValue("1800"), { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Falta o valor em Gestão de redes."));
    expect(chamadasDe("salvar")).toHaveLength(0);
    expect(document.querySelector('[data-item="i1"] [data-campo="valor"]')!.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Confirmar antes de tirar o link do cliente", () => {
  it("proposta vista: Salvar abre o Confirmar; Cancelar não grava, Salvar grava", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    fireEvent.change(await screen.findByDisplayValue("1800"), { target: { value: "2000" } });
    expect(await screen.findByText("Vista · salvar tira o link")).toBeTruthy();
    fireEvent.click(botaoSalvar());
    let dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Salvar e tirar o link do cliente?")).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(chamadasDe("salvar")).toHaveLength(0);
    fireEvent.click(botaoSalvar());
    dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar")).toHaveLength(1));
    expect(chamadasDe("salvar")[0][1].body.itens[0].valor_unitario).toBe(2000);
  });

  it("trocar só o lead não pergunta nada e não manda itens nem validade", async () => {
    mock.tabelas.propostas = [linha({ status: "vista", token: "d".repeat(64) })];
    mock.tabelas.commercial_leads = [{ id: LEAD, name: "Joana", company: "Loja da Joana", stage: "proposta", won_client_id: CLIENTE }];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&proposta=${PROPOSTA}`);
    const lead = (await screen.findByLabelText("Lead do Comercial")) as HTMLSelectElement;
    await waitFor(() => expect(lead.querySelectorAll("option").length).toBe(2));
    fireEvent.change(lead, { target: { value: LEAD } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasDe("salvar")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const corpo = chamadasDe("salvar")[0][1].body;
    expect(corpo.lead_id).toBe(LEAD);
    expect(corpo.itens).toBeUndefined();
    expect(corpo.validade_ate).toBeUndefined();
  });
});

describe("Envio, casca e navegação", () => {
  it("Envio de uma proposta já enviada: WhatsApp com o número e e-mail preenchido, sem enviar de novo", async () => {
    mock.tabelas.propostas = [linha({ status: "enviada", token: "e".repeat(64) })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    await waitFor(() => expect(((screen.getByRole("link", { name: /Abrir no WhatsApp/ }) as HTMLAnchorElement).href)).toContain("wa.me/5541988887777"));
    expect((screen.getByLabelText("E-mail do cliente") as HTMLInputElement).value).toBe("joana@loja.com.br");
    const mensagem = screen.getByLabelText("Mensagem do WhatsApp") as HTMLTextAreaElement;
    expect(mensagem.value).toContain("Oi, Joana.");
    // A mensagem dá para editar e o WhatsApp leva o texto editado.
    fireEvent.change(mensagem, { target: { value: "Oi, Joana! Segue o link." } });
    expect((screen.getByRole("link", { name: /Abrir no WhatsApp/ }) as HTMLAnchorElement).href).toContain(encodeURIComponent("Oi, Joana! Segue o link."));
    expect(chamadasDe("enviar")).toHaveLength(0);
    expect(chamadasDe("enviar_email")).toHaveLength(0);
    expect(chamadasDe("contato")[0][1].body.proposta_id).toBe(PROPOSTA);
  });

  it("envio preparado de A não passa para B ao trocar pelo seletor da casca", async () => {
    mock.tabelas.propostas = [linha(), linha({ id: OUTRA, numero: "2026-005", titulo: "Site" })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    fireEvent.click(await screen.findByRole("button", { name: /^Enviar$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar envio" }));
    expect(await screen.findByDisplayValue("Oi. Segue a proposta A.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Proposta: Nº 2026-004 · Enviada$/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Nº 2026-005/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Proposta: Nº 2026-005 · Rascunho" })).toBeTruthy());
    expect(screen.queryByDisplayValue("Oi. Segue a proposta A.")).toBeNull();
    expect(screen.queryByLabelText("Link da proposta")).toBeNull();
  });

  it("?nova=1 abre o formulário e não abre a proposta mais recente sozinha", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=contexto&nova=1`);
    expect(await screen.findByRole("button", { name: /Criar proposta/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar" }).getAttribute("aria-expanded")).toBe("true");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByLabelText("Notas da equipe")).toBeNull();
  });

  it("Revisão: Resolver da pendência leva ao Investimento no Contexto", async () => {
    mock.tabelas.propostas = [linha({ itens: [] })];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=revisao&proposta=${PROPOSTA}`);
    fireEvent.click(await screen.findByRole("button", { name: "Resolver: Faltam os itens e os valores do investimento." }));
    await waitFor(() => expect(document.querySelector('[data-etapa-proposta="contexto"]')).toBeTruthy());
    expect(document.getElementById("proposta-investimento")).toBeTruthy();
  });

  it("Revisão: fonte do mercado abre em um clique (só http) e o Histórico compara pela linha", async () => {
    mock.tabelas.propostas = [
      linha({
        contexto: {
          notas: "Notas",
          conferencia: [
            { rotulo: "Ticket médio", valor: "R$ 90", url: "https://www.exemplo.com.br/dado", veredito: "confere", confianca: 0.9 },
            { rotulo: "Mercado", valor: "12%", url: "javascript:alert(1)", veredito: "sem_trecho", confianca: null },
          ],
        },
      }),
    ];
    mock.tabelas.proposta_versoes = [{ versao: 2, titulo: "Redes sociais", origem: "geracao", nota: "Proposta escrita", criado_em: "2026-09-30T09:00:00Z" }];
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=revisao&proposta=${PROPOSTA}`);
    const fonte = (await screen.findByRole("link", { name: "Abrir a fonte: Ticket médio" })) as HTMLAnchorElement;
    expect(fonte.href).toBe("https://www.exemplo.com.br/dado");
    expect(fonte.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Abrir a fonte: Mercado" })).toBeNull();
    // Histórico nasce recolhido; aberto, pede para escolher antes de dizer "nada mudou".
    const historico = screen.getByText("Histórico", { selector: "h2" }).closest("section") as HTMLElement;
    fireEvent.click(within(historico).getByRole("button", { name: "Mostrar" }));
    expect(await within(historico).findByText("Toque em Comparar numa versão.")).toBeTruthy();
    fireEvent.click(within(historico).getByRole("button", { name: "Comparar a v2 com a atual" }));
    expect(within(historico).getByRole("button", { name: "Comparar a v2 com a atual" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Salvar como modelo")).toBeNull();
  });

  it("Envio: Salvar como modelo está no menu e abre no centro", async () => {
    montar(`/mesa-proposta?client=${CLIENTE}&etapa=envio&proposta=${PROPOSTA}`);
    const envio = (await screen.findByText("Envio", { selector: "h2" })).closest("section") as HTMLElement;
    fireEvent.keyDown(within(envio).getByRole("button", { name: "Mais ações" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Salvar como modelo" }));
    const janela = await screen.findByRole("dialog", { name: "Salvar como modelo" });
    expect(janela.getAttribute("data-janela-central")).toBe("");
    const salvar = within(janela).getByRole("button", { name: "Salvar modelo" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.change(within(janela).getByLabelText("Nome do modelo"), { target: { value: "Redes sociais" } });
    fireEvent.click(salvar);
    await waitFor(() => expect(chamadasDe("modelo_salvar")).toHaveLength(1));
    expect(chamadasDe("modelo_salvar")[0][1].body).toMatchObject({ proposta_id: PROPOSTA, nome: "Redes sociais", padrao: false });
  });
});
