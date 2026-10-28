import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aceleriq de Bolso (26/10/2026). Regras da tela, o fluxo do estúdio com o banco simulado (a regra de verdade
 * mora nas funções bolso_* e é provada em supabase/testes/bolso_cenarios.sql) e o contrato da migration.
 */

const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), assinar: vi.fn(), respostas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mock.rpc,
    functions: { invoke: mock.invoke },
    storage: { from: () => ({ createSignedUrl: mock.assinar }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-a" }, profile: { role: "client" } }) }));

import { motivoParaNaoPedir, nomeDoArquivo, situacaoDoEstudio, faltasDoBriefing, avisoDeCondicoes, BRIEFING_VAZIO, type EstadoDoEstudio, type Job } from "@/lib/bolso/modelo";
import { erroDoBolso } from "@/lib/bolso/api";
import EstudioBolso from "@/components/membros/bolso/EstudioBolso";
import CreditosBolso from "@/components/membros/bolso/CreditosBolso";

const SIMULADO: EstadoDoEstudio = {
  exposto: true, admin: false, modo: "simulado", carteira: "teste",
  direito: { tipo: "teste", origem: "teste", inicio: "2026-10-26T12:00:00Z", fim: "2027-10-26T12:00:00Z" },
  saldo: { disponivel: 5, reservado: 0 },
  politica: { versao: 1, teste: true, tarifa_texto: 1, tarifa_imagem: 2, formatos: ["feed_1x1", "feed_4x5"] },
  limites_configurados: true, destino_agencia: null,
};

const CAMPANHA = {
  id: "c-1", titulo: "Bolo de pote", versao: 1, versao_escolhida: 1, atualizado_em: "2026-10-26T12:00:00Z",
  briefing: { ...BRIEFING_VAZIO, produto: "Bolo de pote", cta: "Peça no direct" },
  versoes: [{ numero: 1, origem: "simulada", criado_em: "2026-10-26T12:00:00Z", conteudo: { mensagem: "[DEMONSTRAÇÃO] m", texto: "[DEMONSTRAÇÃO] Bolo de pote", cta: "Peça no direct", aplicacao: "", direcao_visual: "" } }],
  jobs: [],
  artes: [{ id: "a-1", caminho: "u-a/c-1/j-1.png", formato: "feed_1x1", mime: "image/png", bytes: 51252, versao_campanha: 1, simulado: true, escolhido: false, criado_em: "2026-10-26T12:00:00Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.respostas = {
    bolso_estado: SIMULADO,
    bolso_marca_ler: { id: "m-1", nome: "Doceria A", descricao: "", publico: "", regiao: "", tom: "", cores: [], direitos_confirmados: true, versao: 1 },
    bolso_campanhas_listar: [{ id: "c-1", titulo: "Bolo de pote", tipo: "venda", versao_escolhida: 1, atualizado_em: "2026-10-26T12:00:00Z", versoes: 1, artes: 1, em_andamento: 0 }],
    bolso_campanha_ler: CAMPANHA,
    bolso_pedir: { job_id: "j-2", estado: "na_fila", repetido: false, tarifa: 2, provedor: "simulado" },
    bolso_extrato: [
      { id: 2, carteira: "teste", tipo: "captura", quantidade: 1, delta_disponivel: 0, delta_reservado: -1, descricao: "Usado: texto da campanha", criado_em: "2026-10-26T12:05:00Z", job_id: "j-1" },
      { id: 1, carteira: "teste", tipo: "concessao", quantidade: 5, delta_disponivel: 5, delta_reservado: 0, descricao: "TESTE: créditos de demonstração", criado_em: "2026-10-26T12:00:00Z", job_id: null },
    ],
  };
  mock.rpc.mockImplementation(async (nome: string) => ({ data: mock.respostas[nome] ?? null, error: null }));
  mock.invoke.mockResolvedValue({ data: { estado: "concluido" }, error: null });
  mock.assinar.mockResolvedValue({ data: { signedUrl: "https://arquivos.test/arte.png" }, error: null });
});

const montar = (filho: unknown) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, filho as never));
  return qc;
};

describe("regras da tela", () => {
  it("modo simulado é demonstração e pode pedir; pausado e sem acesso explicam o porquê", () => {
    expect(situacaoDoEstudio(SIMULADO)).toMatchObject({ podeGerar: true, demonstracao: true });
    expect(situacaoDoEstudio({ ...SIMULADO, modo: "pausado", motivo: null }).podeGerar).toBe(false);
    expect(situacaoDoEstudio({ exposto: false }).podeGerar).toBe(false);
  });

  it("botão de pedir: saldo insuficiente, sem texto e limites ausentes dizem o próximo passo", () => {
    expect(motivoParaNaoPedir({ ...SIMULADO, saldo: { disponivel: 1, reservado: 0 } }, 2, true, "imagem")).toMatch(/usa 2 créditos e você tem 1/);
    expect(motivoParaNaoPedir(SIMULADO, 2, false, "imagem")).toMatch(/texto da campanha antes/);
    expect(motivoParaNaoPedir({ ...SIMULADO, limites_configurados: false }, 1, true, "texto")).toMatch(/limites/);
    expect(motivoParaNaoPedir(SIMULADO, 1, true, "texto")).toBeNull();
  });

  it("briefing: aponta o que falta e avisa que preço não é inventado", () => {
    expect(faltasDoBriefing(BRIEFING_VAZIO)).toHaveLength(3);
    expect(avisoDeCondicoes(BRIEFING_VAZIO)).toMatch(/Nada é inventado/);
    expect(avisoDeCondicoes({ ...BRIEFING_VAZIO, condicoes: "R$ 12" })).toBeNull();
  });

  it("nome do arquivo seguro e erro do banco repassado só quando é do estúdio", () => {
    expect(nomeDoArquivo("Bolo de Pote / Promoção!", "feed_4x5", 2, "image/png")).toBe("bolo-de-pote-promocao-feed_4x5-v2.png");
    expect(erroDoBolso({ code: "53400", message: "Saldo insuficiente: este pedido usa 2 crédito(s) e você tem 1." })).toMatch(/Saldo insuficiente/);
    expect(erroDoBolso({ code: "XX000", message: "detalhe interno do servidor" })).not.toMatch(/interno/);
  });
});

describe("estúdio com o banco simulado", () => {
  it("modo demonstração: faixa e saldo visíveis, limites do produto na ajuda", async () => {
    montar(h(EstudioBolso));
    expect(await screen.findByText("DEMONSTRAÇÃO / PROVEDOR SIMULADO")).toBeTruthy();
    expect(screen.queryByText(/Não é agência humana, não faz gestão de anúncios e não garante vendas/)).toBeNull();
    expect(screen.getByLabelText("Seu saldo de créditos").textContent).toMatch(/5 créditos de teste/);
    expect(await screen.findByText("Bolo de pote")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "O que é isto?" }));
    expect(await screen.findByText(/Não é agência humana, não faz gestão de anúncios e não garante vendas/)).toBeTruthy();
  });

  it("primeira campanha abre a oferta com os campos e objetivos acessíveis", async () => {
    mock.respostas.bolso_campanhas_listar = [];
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: "Criar primeira campanha" }));
    expect(screen.getByRole("radio", { name: "Vender" })).toBeChecked();
    expect(screen.queryByLabelText("Produto ou serviço")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByLabelText("Produto ou serviço")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Produto ou serviço"), { target: { value: "Bolo da semana" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByLabelText("Por que escolher você")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    expect(screen.getByLabelText("Texto da chamada")).toHaveValue("Chame no WhatsApp");
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByLabelText("Produto ou serviço")).toHaveValue("Bolo da semana");
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Criar primeira campanha" })).toBeTruthy();
  });

  it("ao mudar de etapa revela o título fora da área visível sem rolar quando ele já aparece", async () => {
    mock.respostas.bolso_campanhas_listar = [];
    let topoDoTitulo = 600;
    const rolar = vi.fn();
    const anterior = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = rolar;
    const retangulo = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.tagName === "H3" ? topoDoTitulo : 100;
      const bottom = this.tagName === "H3" ? topoDoTitulo + 30 : 500;
      return { top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    try {
      montar(h("main", { className: "membros-conteudo-estudio" }, h(EstudioBolso)));
      fireEvent.click(await screen.findByRole("button", { name: "Criar primeira campanha" }));
      fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
      expect(rolar).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("heading", { name: "O que você quer divulgar?" })).toHaveFocus();

      topoDoTitulo = 150;
      fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
      expect(rolar).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("heading", { name: "Qual é o objetivo?" })).toHaveFocus();

      topoDoTitulo = 600;
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
      fireEvent.click(screen.getByRole("button", { name: "Salvar oferta" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Diga qual produto");
      expect(screen.getByRole("heading", { name: "O que você quer divulgar?" })).toHaveFocus();
      expect(rolar).toHaveBeenCalledTimes(5);
      expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
    } finally {
      retangulo.mockRestore();
      HTMLElement.prototype.scrollIntoView = anterior;
    }
  });

  it("no celular revela o título que ficaria encoberto pelo menu fixo", async () => {
    mock.respostas.bolso_campanhas_listar = [];
    const rolar = vi.fn();
    const anterior = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = rolar;
    vi.stubGlobal("innerWidth", 390);
    const retangulo = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.tagName === "H3" ? 100 : this.classList.contains("membros-menu") ? 70 : 0;
      const bottom = this.tagName === "H3" ? 130 : this.classList.contains("membros-menu") ? 125 : this.classList.contains("membros-topo") ? 70 : 800;
      return { top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    try {
      montar(h("div", { className: "membros-portal" }, h("header", { className: "membros-topo" }), h("aside", { className: "membros-menu" }), h("main", { className: "membros-conteudo-estudio" }, h(EstudioBolso))));
      fireEvent.click(await screen.findByRole("button", { name: "Criar primeira campanha" }));
      fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
      expect(rolar).toHaveBeenCalledOnce();
      expect(screen.getByRole("heading", { name: "O que você quer divulgar?" })).toHaveFocus();
    } finally {
      retangulo.mockRestore();
      HTMLElement.prototype.scrollIntoView = anterior;
      vi.unstubAllGlobals();
    }
  });

  it("revisa o briefing completo e só salva no último passo sem consumir crédito", async () => {
    mock.respostas.bolso_campanhas_listar = [];
    mock.respostas.bolso_campanha_salvar = "c-1";
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: "Criar primeira campanha" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(screen.getByLabelText("Produto ou serviço"), { target: { value: "Bolo de pote" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(screen.getByLabelText("Condições comerciais"), { target: { value: "R$14 por pote" } });
    fireEvent.click(screen.getByRole("button", { name: "Site" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("R$14 por pote")).toBeVisible();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Salvar oferta" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bolso_campanha_salvar", expect.objectContaining({ _dados: expect.objectContaining({ briefing: expect.objectContaining({ produto: "Bolo de pote", condicoes: "R$14 por pote", cta: "Compre pelo site" }) }) })));
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("valida produto antes de salvar e volta ao campo sem chamar o banco", async () => {
    mock.respostas.bolso_campanhas_listar = [];
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: "Criar primeira campanha" }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar oferta" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Diga qual produto");
    expect(screen.getByLabelText("Produto ou serviço")).toHaveAttribute("aria-invalid", "true");
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
  });

  it("sai da edição da marca sem salvar e confirma apenas quando há mudança", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: "Editar marca: Doceria A" }));
    fireEvent.change(screen.getByLabelText("Nome da marca"), { target: { value: "Outro nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Voltar às campanhas" }));
    expect(screen.getByRole("group", { name: "Alterações da marca não salvas" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("button", { name: "Editar marca: Doceria A" })).toBeVisible();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_marca_salvar", expect.anything());
  });

  it("abre a imagem completa, fecha com Escape e devolve foco ao botão", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar para a arte" }));
    const ampliar = await screen.findByRole("button", { name: /Ampliar arte:/ });
    ampliar.focus();
    fireEvent.click(ampliar);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("img")).toHaveAttribute("src", "https://arquivos.test/arte.png");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ver tamanho original" }));
    expect(within(dialogo).getByRole("button", { name: "Ajustar à tela" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(dialogo, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(ampliar).toHaveFocus());
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("mantém recursos novos ocultos quando o servidor não anuncia capacidade", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar para a arte" }));
    expect(screen.queryByText("Fotos e referências")).toBeNull();
    expect(screen.queryByText("Pedir ajuste")).toBeNull();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_referencias_listar", expect.anything());
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
  });

  it("usa o novo motor de copy somente com capacidade ativa e após confirmar crédito", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, recursos_criativos: { briefing: false, legenda: true, referencias: false, ajuste: false } };
    mock.respostas.bolso_pedir_criativo = { job_id: "j-3", estado: "na_fila", repetido: false };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Criar outra versão/ }));
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bolso_pedir_criativo", expect.objectContaining({ _campanha: "c-1", _natureza: "legenda", _tarifa_vista: 1, _entrada: {} })));
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("briefing IA fica como sugestão e só preenche os campos quando a pessoa aplica", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, recursos_criativos: { briefing: true, legenda: false, referencias: false, ajuste: false } };
    mock.respostas.bolso_pedir_criativo = { job_id: "j-4", estado: "na_fila", repetido: false };
    mock.respostas.bolso_criativo_resultado = { estado: "concluido", natureza: "briefing", aplicado: false, briefing: { ...CAMPANHA.briefing, diferencial: "Feito no mesmo dia", condicoes: "R$14", cta: "Chame no WhatsApp" } };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar oferta" }));
    fireEvent.click(screen.getByText("Completar com IA"));
    fireEvent.change(screen.getByLabelText("Conte sua ideia"), { target: { value: "Divulgar o bolo fresco de hoje por14reais" } });
    fireEvent.click(screen.getByRole("button", { name: /Preparar minha oferta/ }));
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    const aplicar = await screen.findByRole("button", { name: "Aplicar sugestão nos campos" });
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
    fireEvent.click(aplicar);
    expect(screen.getByLabelText("Por que escolher você")).toHaveValue("Feito no mesmo dia");
    expect(screen.getByLabelText("Condições comerciais")).toHaveValue("R$14");
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
  });

  it.each(["concluido", "incerto"] as const)("recupera o briefing %s após reabrir sem cobrar novamente", async (situacao) => {
    mock.respostas.bolso_estado = { ...SIMULADO, recursos_criativos: { briefing: true, legenda: false, referencias: false, ajuste: false } };
    mock.respostas.bolso_campanha_ler = { ...CAMPANHA, jobs: [{ ...pedidoDoHistorico("j-recuperado", "texto", situacao, null), natureza: "briefing" }] };
    const conclusao = { estado: "concluido", natureza: "briefing", aplicado: false, briefing: { ...CAMPANHA.briefing, diferencial: "Preparado hoje" } };
    mock.respostas.bolso_criativo_resultado = situacao === "incerto" ? { estado: "incerto", natureza: "briefing" } : conclusao;
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar oferta" }));
    if (situacao === "incerto") {
      const conferir = await screen.findByRole("button", { name: "Conferir pedido" });
      expect(screen.queryByRole("button", { name: /Preparar minha oferta/ })).toBeNull();
      mock.respostas.bolso_criativo_resultado = conclusao;
      fireEvent.click(conferir);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar sugestão nos campos" }));
    expect(screen.getByLabelText("Por que escolher você")).toHaveValue("Preparado hoje");
    expect(mock.rpc).toHaveBeenCalledWith("bolso_criativo_resultado", { _job: "j-recuperado" });
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
  });

  it("leva as referências da campanha para o pedido de imagem confirmado", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, recursos_criativos: { briefing: false, legenda: false, referencias: true, ajuste: false } };
    mock.respostas.bolso_referencias_listar = [{ id: "r-1", caminho: "u-a/c-1/referencias/foto.png", nome: "Produto.png", mime: "image/png", bytes: 1000 }];
    mock.respostas.bolso_pedir_criativo = { job_id: "j-imagem", estado: "na_fila", repetido: false };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar para a arte" }));
    fireEvent.click(await screen.findByText(/Fotos e referências/));
    await screen.findByRole("img", { name: "Referência: Produto.png" });
    const pedirArte = screen.getByRole("button", { name: /Pedir a arte/ });
    await waitFor(() => expect(pedirArte).toBeEnabled());
    fireEvent.click(pedirArte);
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bolso_pedir_criativo", expect.objectContaining({ _campanha: "c-1", _natureza: "imagem", _entrada: { referencias: ["r-1"] } })));
  });

  it("preserva condições e CTA editados ao aplicar uma sugestão antiga e bloqueia geração com rascunho", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, recursos_criativos: { briefing: true, legenda: false, referencias: false, ajuste: false } };
    mock.respostas.bolso_campanha_ler = { ...CAMPANHA, jobs: [{ ...pedidoDoHistorico("j-antigo", "texto", "concluido", null), natureza: "briefing" }] };
    mock.respostas.bolso_criativo_resultado = { estado: "concluido", natureza: "briefing", aplicado: false, briefing: { ...CAMPANHA.briefing, diferencial: "Receita artesanal", condicoes: "R$97", cta: "Compre pelo site" } };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar oferta" }));
    await screen.findByRole("button", { name: "Aplicar sugestão nos campos" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Preparação da campanha" })).getByRole("button", { name: "Oferta" }));
    fireEvent.change(screen.getByLabelText("Condições comerciais"), { target: { value: "R$197" } });
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Preparação da campanha" })).getByRole("button", { name: "Objetivo" }));
    fireEvent.change(screen.getByLabelText("Conte sua ideia"), { target: { value: "Uma nova campanha" } });
    expect(screen.getByRole("button", { name: /Preparar minha oferta/ })).toBeDisabled();
    expect(screen.getByText(/campos que você editou serão mantidos/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar sugestão nos campos" }));
    expect(screen.getByLabelText("Condições comerciais")).toHaveValue("R$197");
    expect(screen.getByLabelText("Sua chamada personalizada")).toHaveValue("Chame no WhatsApp");
    expect(screen.getByLabelText("Por que escolher você")).toHaveValue("Receita artesanal");
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_campanha_salvar", expect.anything());
  });

  it("reabre a sugestão paga após expirar o acesso sem habilitar nova geração", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, modo: "sem_acesso", recursos_criativos: { briefing: false, legenda: false, referencias: false, ajuste: false } };
    mock.respostas.bolso_campanha_ler = { ...CAMPANHA, jobs: [{ ...pedidoDoHistorico("j-pago", "texto", "concluido", null), natureza: "briefing" }] };
    mock.respostas.bolso_criativo_resultado = { estado: "concluido", natureza: "briefing", aplicado: false, briefing: { ...CAMPANHA.briefing, diferencial: "Sugestão já paga" } };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar oferta" }));
    expect(await screen.findByRole("button", { name: "Aplicar sugestão nos campos" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Preparar minha oferta/ })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir_criativo", expect.anything());
  });

  it("copia a legenda editada sem gravar nova versão nem consumir créditos", async () => {
    const anterior = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: escrever } });
    try {
      montar(h(EstudioBolso));
      fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
      fireEvent.change(await screen.findByLabelText("Legenda da publicação"), { target: { value: "Minha legenda revisada" } });
      fireEvent.click(screen.getByRole("button", { name: "Copiar legenda" }));
      await screen.findByText("Legenda copiada.");
      expect(escrever).toHaveBeenCalledWith("Minha legenda revisada");
      expect(mock.rpc).not.toHaveBeenCalledWith("bolso_versao_salvar", expect.anything());
      expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
    } finally {
      if (anterior) Object.defineProperty(navigator, "clipboard", anterior);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("próximo passo leva à arte sem consumir créditos", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar para a arte" }));
    expect(screen.getByRole("button", { name: "Arte e download" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Pedir a arte/ })).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
    expect(await screen.findByRole("img", { name: /versão 1 do texto/ })).toBeTruthy();
  });

  it("selecionar uma campanha troca a lista pelo carregamento antes da resposta do banco", async () => {
    let concluirLeitura!: (resultado: { data: typeof CAMPANHA; error: null }) => void;
    const leitura = new Promise<{ data: typeof CAMPANHA; error: null }>((resolver) => { concluirLeitura = resolver; });
    mock.rpc.mockImplementation((nome: string) => nome === "bolso_campanha_ler"
      ? leitura
      : Promise.resolve({ data: mock.respostas[nome] ?? null, error: null }));
    montar(h(EstudioBolso));

    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));

    expect(screen.getByText("Abrindo a campanha…")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Minhas campanhas" })).toBeNull();
    expect(mock.rpc).toHaveBeenCalledWith("bolso_campanha_ler", { _id: "c-1" });
    await act(async () => { concluirLeitura({ data: CAMPANHA, error: null }); });
    expect(await screen.findByRole("heading", { name: "Bolo de pote" })).toBeTruthy();
  });

  it("atualizar saldo, marca e campanhas não fecha a campanha nem muda a etapa selecionada", async () => {
    const qc = montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Arte e download" }));
    mock.respostas.bolso_estado = { ...SIMULADO, saldo: { disponivel: 12, reservado: 0 } };

    await act(async () => { await qc.invalidateQueries({ queryKey: ["bolso"] }); });

    await waitFor(() => expect(screen.getByLabelText("Seu saldo de créditos").textContent).toMatch(/12 créditos/));
    expect(screen.getByRole("heading", { name: "Bolo de pote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arte e download" })).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("heading", { name: "Minhas campanhas" })).toBeNull();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("erro ao abrir a campanha aparece e permite voltar à lista sem consumir créditos", async () => {
    mock.rpc.mockImplementation(async (nome: string) => nome === "bolso_campanha_ler"
      ? { data: null, error: { code: "42501", message: "Esta campanha não está disponível para sua conta." } }
      : { data: mock.respostas[nome] ?? null, error: null });
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Esta campanha não está disponível para sua conta/);
    expect(screen.queryByRole("heading", { name: "Minhas campanhas" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar às campanhas" }));
    expect(await screen.findByRole("button", { name: /Bolo de pote/ })).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  const pedidoDoHistorico = (id: string, tipo: Job["tipo"], estado: Job["estado"], erro: string | null): Job => ({
    id, tipo, estado, erro, formato: tipo === "imagem" ? "feed_1x1" : null,
    provedor: "openrouter", tarifa: tipo === "imagem" ? 5 : 1, carteira: "real",
    versao_campanha: 1, criado_em: "2026-10-27T12:00:00Z",
  });

  it.each((["texto", "imagem"] as const).flatMap((tipo) =>
    (["concluido", "na_fila", "processando"] as const).map((estado) => ({ tipo, estado })),
  ))("pedido de $tipo $estado substitui a falha anterior sem esconder a falha do outro tipo", async ({ tipo, estado }) => {
    const outroTipo = tipo === "texto" ? "imagem" : "texto";
    mock.respostas.bolso_campanha_ler = {
      ...CAMPANHA,
      jobs: [
        pedidoDoHistorico("novo", tipo, estado, null),
        pedidoDoHistorico("outro", outroTipo, "falhou", "Falha atual de outro tipo"),
        pedidoDoHistorico("antigo", tipo, "falhou", "Falha anterior"),
      ],
    };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));

    expect(await screen.findByRole("heading", { name: "Bolo de pote" })).toBeTruthy();
    expect(screen.queryByText(/Falha anterior/)).toBeNull();
    expect(screen.getByText(/Falha atual de outro tipo/).textContent).toContain(`O último pedido de ${outroTipo === "imagem" ? "arte" : "texto"}`);
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("mantém os avisos quando o pedido mais recente de texto e o de arte falharam", async () => {
    mock.respostas.bolso_campanha_ler = {
      ...CAMPANHA,
      jobs: [
        pedidoDoHistorico("imagem", "imagem", "falhou", "Falha atual da imagem"),
        pedidoDoHistorico("texto", "texto", "falhou", "Falha atual do texto"),
        pedidoDoHistorico("antigo", "imagem", "falhou", "Falha anterior"),
      ],
    };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));

    expect(await screen.findByText(/Falha atual da imagem/)).toBeTruthy();
    expect(screen.getByText(/Falha atual do texto/)).toBeTruthy();
    expect(screen.queryByText(/Falha anterior/)).toBeNull();
  });

  it.each([
    { mensagem: "m".repeat(81), cta: "Peça no direct", aviso: true },
    { mensagem: "Mensagem curta", cta: "c".repeat(51), aviso: true },
    { mensagem: "m".repeat(80), cta: "c".repeat(50), aviso: false },
  ])("avisa sobre texto longo antes da arte, sem bloquear o histórico: $aviso", async ({ mensagem, cta, aviso }) => {
    mock.respostas.bolso_campanha_ler = {
      ...CAMPANHA,
      versoes: [{ ...CAMPANHA.versoes[0], conteudo: { ...CAMPANHA.versoes[0].conteudo, mensagem, cta } }],
    };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    expect(await screen.findByLabelText("Mensagem principal")).toHaveValue(mensagem);
    fireEvent.click(screen.getByRole("button", { name: "Continuar para a arte" }));
    expect(!!screen.queryByText(/Esta versão tem textos longos/)).toBe(aviso);
    expect(await screen.findByRole("img", { name: /versão 1 do texto/ })).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it.each(["", "   "])("avisa antes do gasto quando a versão manual não tem mensagem principal: %j", async (mensagem) => {
    mock.respostas.bolso_campanha_ler = {
      ...CAMPANHA,
      versoes: [{ ...CAMPANHA.versoes[0], origem: "manual", conteudo: { ...CAMPANHA.versoes[0].conteudo, mensagem } }],
    };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    expect(await screen.findByLabelText("Mensagem principal")).toHaveValue(mensagem);
    fireEvent.click(screen.getByRole("button", { name: "Continuar para a arte" }));
    expect(screen.getByText(/Esta versão não tem mensagem principal/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pedir a arte/ })).not.toBeDisabled();
    expect(await screen.findByRole("img", { name: /versão 1 do texto/ })).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
  });

  it("pedir arte: confirma o consumo antes, reserva com a chave e processa; prévia e download por URL assinada", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Arte e download/ }));
    const pedirArte = await screen.findByRole("button", { name: /Pedir a arte/ });
    expect(pedirArte.textContent).toMatch(/2 créditos/);
    fireEvent.click(pedirArte);
    const confirmar = within(screen.getByRole("group", { name: "Confirmar consumo de créditos" }));
    expect(confirmar.getByText(/reserva/).textContent).toMatch(/2 crédito.*de 5.*de teste/);
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
    fireEvent.click(confirmar.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("bolso", { body: { acao: "processar", job_id: "j-2" } }));
    const pedido = mock.rpc.mock.calls.find((c) => c[0] === "bolso_pedir")![1];
    expect(pedido).toEqual(expect.objectContaining({ _campanha: "c-1", _tipo: "imagem", _formato: "feed_1x1", _tarifa_vista: 2 }));
    expect(String(pedido._chave)).toMatch(/^bolso-/);
    // A arte existente: prévia por URL assinada curta e download com nome de arquivo.
    expect(mock.assinar).toHaveBeenCalledWith("u-a/c-1/j-1.png", 60, undefined);
    expect(screen.getByText("Demonstração")).toBeTruthy();
  });

  it("sem saldo: botão desligado com o motivo, consulta e download continuam", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, saldo: { disponivel: 0, reservado: 0 } };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Arte e download/ }));
    expect((await screen.findByRole("button", { name: /Pedir a arte/ })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/você tem 0. Consultar e baixar o que já fez continua livre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Baixar/ }).hasAttribute("disabled")).toBe(false);
  });

  it("estúdio pausado: aviso e nenhuma ação de pedido ativa", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, modo: "pausado", motivo: "O estúdio está pausado pela administração. Suas campanhas e arquivos continuam disponíveis." };
    montar(h(EstudioBolso));
    expect(await screen.findByText(/Estúdio pausado/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    expect((await screen.findByRole("button", { name: /Criar outra versão/ })).hasAttribute("disabled")).toBe(true);
  });

  it("módulo fechado: não mostra o estúdio", async () => {
    mock.respostas.bolso_estado = { exposto: false };
    montar(h(EstudioBolso));
    expect(await screen.findByText(/ainda não está disponível/)).toBeTruthy();
    expect(screen.queryByText("Minhas campanhas")).toBeNull();
  });

  it("serviços da agência sem destino autorizado: botão desligado com explicação", async () => {
    montar(h(EstudioBolso));
    const botao = await screen.findByRole("button", { name: "Conhecer serviços da agência" });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/contato da agência ainda não foi publicado/)).toBeTruthy();
  });

  it("créditos e acesso: saldo, validade e extrato vindos do banco", async () => {
    montar(h(CreditosBolso));
    expect(await screen.findByText("Demonstração")).toBeTruthy();
    expect(screen.getByText(/Até 26\/10\/2027/)).toBeTruthy();
    expect(await screen.findByText("Créditos recebidos")).toBeTruthy();
    expect(screen.getByText("1 usado")).toBeTruthy();
  });
});

describe("contrato da migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261027120000_aceleriq_de_bolso.sql"), "utf8");

  it("chaves nascem desligadas e sem limites", () => {
    for (const k of ["modulo_exposto", "geracao_real", "pagamentos", "modo_simulado", "kill_switch"]) expect(sql).toContain(`${k} boolean NOT NULL DEFAULT false`);
    expect(sql).toMatch(/limites jsonb CHECK/);
    expect(sql).toContain("Os limites do estúdio ainda não foram configurados");
  });

  it("tabelas fechadas, trabalhador e eventos só com a chave de serviço", () => {
    expect(sql).toContain("EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.%s TO service_role");
    expect(sql).toMatch(/'bolso_trabalho_pegar\(uuid,integer\)'.*'bolso_evento_pagamento\(jsonb\)'/s);
    expect(sql).not.toMatch(/GRANT[^;]*TO anon/);
  });

  it("extrato só de inclusão, captura e liberação uma vez por job", () => {
    expect(sql).toContain("CREATE TRIGGER bolso_creditos_imutavel BEFORE UPDATE OR DELETE ON public.bolso_creditos");
    expect(sql).toContain("CREATE UNIQUE INDEX bolso_creditos_fecha_uma_vez ON public.bolso_creditos (job_id) WHERE tipo IN ('captura', 'liberacao')");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('bolso:' || u::text, 7))");
  });

  it("bucket privado com barreira e leitura só da própria pasta", () => {
    expect(sql).toContain("VALUES ('bolso', 'bolso', false, 10485760");
    expect(sql).toContain("CREATE POLICY bolso_storage_barreira ON storage.objects AS RESTRICTIVE");
    expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });

  it("acesso real só com política aprovada; teste nunca na carteira real", () => {
    expect(sql).toContain("Acesso real só com política comercial aprovada");
    expect(sql).toContain("Crédito de teste só com política de teste");
    expect(sql).toContain("CHECK ((tipo = 'teste') = (carteira = 'teste'))");
  });
});
