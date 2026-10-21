import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ chamar: vi.fn(), userId: "operador-a" }));
vi.mock("@/lib/mesa/api", async (original) => ({ ...(await original<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar, lerCatalogo: async () => [] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: m.userId } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import ConexoesDaCasa from "@/components/laboratorio/no/ConexoesDaCasa";
import CamposDoNo from "@/components/laboratorio/CamposDoNo";
import { ContextoDoQuadro, type AcoesDoQuadro } from "@/components/laboratorio/no/contexto";
import { catalogoDaCasa, puxarContextoDaCasa, type ContextoDaCasa } from "@/lib/laboratorio/conexoesDaCasa";
import { MODELO_PADRAO_DO_LAB, type NoDoLab } from "@/lib/laboratorio/nos";

const PRODUTO_A = "44444444-4444-4444-8444-444444444444";
const PRODUTO_B = "55555555-5555-4555-8555-555555555555";
const no = (tipo: NoDoLab["tipo"], dados: Record<string, unknown>): NoDoLab => ({ id: "no-a", tipo, dados, x: 0, y: 0 });
const produtos = [{ id: PRODUTO_A, titulo: "CRM vendas", estado: "publicado" }, { id: PRODUTO_B, titulo: "Curso do cliente", estado: "rascunho" }];
const nada = () => undefined;
const contexto = (texto: string): { contexto: ContextoDaCasa } => ({ contexto: { texto, json: { origem: "cliente" } } });

function acoes(trocas: Partial<AcoesDoQuadro> = {}): AcoesDoQuadro {
  return { projetoId: "projeto-a", clienteId: "cliente-a", clientes: [{ id: "cliente-a", nome: "Cliente A" }, { id: "cliente-b", nome: "Cliente B" }], antesDeChamar: vi.fn(async () => undefined), travado: false, mudarDados: vi.fn(), rodar: nada, duplicar: nada, sincronizar: null, abrirDetalhes: null, apagar: nada, alternarExpandido: nada, abrirMenu: nada, escolherStoryboard: nada, desligar: nada, mudarGatilho: nada, novaExecucao: nada, ligarNovo: nada, usarComoReferencia: nada, ...trocas };
}

function montar(n: NoDoLab, a = acoes()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = (novoNo: NoDoLab, novasAcoes: AcoesDoQuadro) => <QueryClientProvider client={qc}><ContextoDoQuadro.Provider value={novasAcoes}><ConexoesDaCasa no={novoNo} /></ContextoDoQuadro.Provider></QueryClientProvider>;
  const view = render(tela(n, a));
  return { ...view, a, trocar: (novoNo: NoDoLab, novasAcoes = a) => view.rerender(tela(novoNo, novasAcoes)) };
}

beforeEach(() => {
  m.userId = "operador-a";
  m.chamar.mockReset();
  m.chamar.mockImplementation(async (_f: string, corpo: { catalogo?: boolean }) => corpo.catalogo ? { produtos } : contexto("CRM de Cliente A: 2 contatos e 1 negócio."));
});

describe("Conexões da casa: contrato read-only da API", () => {
  it("envia somente projeto e nó; titular, conta e produto são lidos do projeto salvo no servidor", async () => {
    expect(await catalogoDaCasa("projeto-a", "no-a")).toEqual(produtos);
    expect(await puxarContextoDaCasa("projeto-a", "no-a")).toEqual(contexto("CRM de Cliente A: 2 contatos e 1 negócio.").contexto);
    expect(m.chamar.mock.calls).toEqual([
      ["laboratorio", { acao: "conexoes_da_casa", projeto_id: "projeto-a", no_id: "no-a", catalogo: true }],
      ["laboratorio", { acao: "conexoes_da_casa", projeto_id: "projeto-a", no_id: "no-a" }],
    ]);
  });
});

describe("Conexões da casa: CRM e biblioteca dentro do nó", () => {
  it("sem conexão escolhida não lê dados; trocar a origem limpa o produto anterior", () => {
    const view = montar(no("crm", { produto_crm_id: PRODUTO_A }));
    expect(screen.queryByRole("button", { name: "Puxar contexto" })).toBeNull();
    expect(m.chamar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Origem dos dados"), { target: { value: "agencia" } });
    expect(view.a.mudarDados).toHaveBeenCalledWith("no-a", { crm_origem: "agencia", produto_crm_id: "" });
  });

  it("CRM da agência não carrega catálogo de produtos nem libera qualquer licença", async () => {
    m.chamar.mockResolvedValue(contexto("CRM da agência Aceleriq: 3 oportunidades."));
    const view = montar(no("crm", { crm_origem: "agencia" }));
    expect(screen.queryByLabelText("Ferramenta CRM")).toBeNull();
    expect(m.chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    expect(await screen.findByRole("status")).toHaveTextContent("CRM da agência Aceleriq");
    expect(view.a.antesDeChamar).toHaveBeenCalledTimes(1);
    expect(m.chamar.mock.calls).toEqual([["laboratorio", { acao: "conexoes_da_casa", projeto_id: "projeto-a", no_id: "no-a" }]]);
    expect(screen.getByRole("link", { name: "Abrir CRM da agência" })).toHaveAttribute("href", "/comercial");
  });

  it("CRM do cliente exige titular do projeto e produto selecionado", async () => {
    const view = montar(no("crm", { crm_origem: "cliente" }), acoes({ clienteId: null }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha o cliente do projeto");
    expect(screen.getByRole("button", { name: "Puxar contexto" })).toBeDisabled();
    await screen.findByRole("option", { name: "CRM vendas" });
    view.trocar(no("crm", { crm_origem: "cliente" }), acoes());
    expect(screen.getByRole("option", { name: "CRM de Cliente A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Puxar contexto" })).toBeDisabled();
    view.trocar(no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A }), acoes());
    expect(screen.getByRole("button", { name: "Puxar contexto" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 contatos e 1 negócio");
    expect(m.chamar.mock.calls.filter((c) => !c[1].catalogo)).toHaveLength(1);
  });

  it("catálogo recusado mantém mensagem clara de permissão e não inventa produtos", async () => {
    m.chamar.mockRejectedValue(new Error("A leitura exige administração da área de membros."));
    montar(no("crm", { crm_origem: "cliente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("exige administração da área de membros");
    expect(within(screen.getByLabelText("Ferramenta CRM")).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Puxar contexto" })).toBeDisabled();
  });

  it("biblioteca oferece produto existente e só altera a referência do nó", async () => {
    const view = montar(no("area_membros", { plataforma: "painel" }));
    await screen.findByRole("option", { name: "Curso do cliente · rascunho" });
    fireEvent.change(screen.getByLabelText("Produto existente no painel"), { target: { value: PRODUTO_B } });
    expect(view.a.mudarDados).toHaveBeenCalledWith("no-a", { produto_membros_id: PRODUTO_B });
    expect(m.chamar.mock.calls.every((c) => c[1].acao === "conexoes_da_casa" && c[1].catalogo === true)).toBe(true);
  });

  it("conexão com biblioteca pode ser ativada sem criar ou liberar curso", () => {
    const view = montar(no("area_membros", { plataforma: "hotmart_club" }));
    expect(m.chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar a biblioteca do painel" }));
    expect(view.a.mudarDados).toHaveBeenCalledWith("no-a", { plataforma: "painel" });
    expect(m.chamar).not.toHaveBeenCalled();
  });

  it("trocar cliente, produto, projeto ou operador remove o contexto anterior", async () => {
    const primeiro = no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A });
    const view = montar(primeiro);
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Cliente A");
    view.trocar(primeiro, acoes({ clienteId: "cliente-b" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    m.chamar.mockImplementation(async (_f: string, corpo: { catalogo?: boolean }) => corpo.catalogo ? { produtos } : contexto("CRM de Cliente B."));
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Cliente B");
    view.trocar(no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_B }), acoes({ clienteId: "cliente-b" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    await screen.findByRole("status");
    view.trocar(primeiro, acoes({ projetoId: "projeto-b", clienteId: "cliente-b" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    await screen.findByRole("status");
    m.userId = "operador-b";
    view.trocar(primeiro, acoes({ projetoId: "projeto-b", clienteId: "cliente-b" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("resposta atrasada do cliente anterior é descartada ao trocar o contexto", async () => {
    let resolver: (valor: ReturnType<typeof contexto>) => void = () => undefined;
    const pendente = new Promise<ReturnType<typeof contexto>>((ok) => { resolver = ok; });
    m.chamar.mockImplementation((_f: string, corpo: { catalogo?: boolean }) => corpo.catalogo ? Promise.resolve({ produtos }) : pendente);
    const primeiro = no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A });
    const view = montar(primeiro);
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    await waitFor(() => expect(m.chamar.mock.calls.some((c) => !c[1].catalogo)).toBe(true));
    view.trocar(primeiro, acoes({ clienteId: "cliente-b" }));
    await act(async () => { resolver(contexto("Resposta antiga do Cliente A")); await pendente; });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Resposta antiga do Cliente A")).toBeNull();
    expect(screen.getByRole("button", { name: "Puxar contexto" })).toBeEnabled();
  });

  it("falha de permissão ao puxar é exibida sem apresentar dados como consultados", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: { catalogo?: boolean }) => { if (corpo.catalogo) return { produtos }; throw new Error("Você não tem acesso ao cliente deste projeto."); });
    montar(no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A }));
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não tem acesso ao cliente");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("trocar cliente enquanto o quadro salva cancela a consulta anterior antes da API", async () => {
    const antes = vi.fn<() => Promise<void>>(async () => undefined);
    const primeiro = no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A });
    const view = montar(primeiro, acoes({ antesDeChamar: antes }));
    await screen.findByRole("option", { name: "CRM vendas" });
    let liberar: () => void = () => undefined;
    const salvando = new Promise<void>((ok) => { liberar = ok; });
    antes.mockImplementationOnce(() => salvando);
    fireEvent.click(screen.getByRole("button", { name: "Puxar contexto" }));
    view.trocar(primeiro, acoes({ clienteId: "cliente-b", antesDeChamar: antes }));
    await act(async () => { liberar(); await salvando; });
    expect(m.chamar.mock.calls.filter((c) => !c[1].catalogo)).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("biblioteca nativa oculta geração/modelo e preserva os valores ao voltar para plataforma externa", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dados = { plataforma: "painel", produto_membros_id: PRODUTO_A, modelo_id: MODELO_PADRAO_DO_LAB, modulos: 4, aulas_por_modulo: 5, liberacao: "por_dia" };
    const mudar = vi.fn();
    const tela = (plataforma: string) => <QueryClientProvider client={qc}><CamposDoNo no={no("area_membros", { ...dados, plataforma })} projetoId="p" onMudarDados={mudar} lugar="no" todos /></QueryClientProvider>;
    const view = render(tela("painel"));
    expect(screen.getByLabelText("Onde entrega")).toHaveValue("painel");
    expect(screen.queryByLabelText("Modelo")).toBeNull();
    expect(screen.queryByLabelText("Módulos")).toBeNull();
    expect(screen.queryByLabelText("Aulas por módulo")).toBeNull();
    expect(screen.queryByLabelText("Liberação")).toBeNull();
    expect(mudar).not.toHaveBeenCalled();
    view.rerender(tela("hotmart_club"));
    expect(screen.getByLabelText("Modelo")).toHaveValue(MODELO_PADRAO_DO_LAB);
    expect(screen.getByLabelText("Módulos")).toHaveValue(4);
    expect(screen.getByLabelText("Aulas por módulo")).toHaveValue(5);
    expect(mudar).not.toHaveBeenCalled();
  });
});
