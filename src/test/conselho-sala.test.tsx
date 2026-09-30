import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FalaDoConselho, SessaoDoConselho } from "@/lib/conselho/api";

/**
 * Sala do Conselho (frente CNS, 30/09): a tela mostra as divergências sem
 * esconder, a decisão do dono vai num clique ("Seguir a recomendação", sem
 * custo e com Desfazer) ou com Confirmar ("Outra decisão"), a recomendação
 * com ação vira o pedido para a mesa (botão com o nome da mesa) e a pergunta
 * que falha volta ao campo.
 *
 * Frente UXS: sessão concluída abre no resultado (mesa e rodadas recolhidas,
 * sem remontar); aviso de parada antes do resultado antigo; Nova rodada no
 * bloco da decisão, com custo antes; Parar com confirmação; Convocar de novo
 * volta ao formulário preenchido; a vista das rodadas não pula sozinha; no
 * celular, a cadeira leva à conversa.
 */

const chamar = vi.fn();
const convocar = vi.fn();
let sessaoAtual: SessaoDoConselho;
let falasAtuais: FalaDoConselho[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useCatalogo: () => ({ data: [], isLoading: false }) }));
vi.mock("@/lib/conselho/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/conselho/api")>();
  return {
    ...real,
    chamarConselho: (corpo: Record<string, unknown>) => chamar(corpo),
    useSessaoDoConselho: () => ({
      sessao: { data: sessaoAtual, isLoading: false, isError: false, error: null },
      falas: { data: falasAtuais, isLoading: false, isError: false, error: null },
    }),
    // O formulário (Convocar de novo) sem rede.
    lerCatalogoDoConselho: async () => ({
      especialistas: MEMBROS.map((m) => ({ id: m.id, nome: m.nome, area: "", visao: "", criterio: "" })),
      padrao: MEMBROS.map((m) => m.id),
      criterios: [],
      limites: { min_especialistas: 2, max_especialistas: 6, min_rodadas: 2, max_rodadas: 4, teto_maximo_usd: 50 },
      modelo_padrao: "m1",
      presets: [],
    }),
    estimarConselho: async () => ({ estimativa: { por_rodada: [], total_usd: 0.3 }, teto_sugerido_usd: 0.4 }),
    listarElencos: async () => [],
    convocarConselho: (p: unknown) => convocar(p),
    useSessoesDoConselho: () => ({ data: [], refetch: vi.fn() }),
  };
});

import SalaDoConselho from "@/components/conselho/SalaDoConselho";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

const MEMBROS = [
  { id: "estrategista_marca", nome: "Estrategista de marca", modelo_id: "m1" },
  { id: "copywriter", nome: "Copywriter", modelo_id: "m1" },
  { id: "cetico", nome: "Cético", modelo_id: "m1" },
];

function sessaoConcluida(extra: Partial<SessaoDoConselho> = {}): SessaoDoConselho {
  return {
    id: "s1",
    client_id: "c1",
    marca_id: null,
    origem: "mesa-roteiros",
    tema: "Série de outubro",
    pergunta: "Qual série gravar?",
    criterios: ["responde à pergunta", "viável", "coerente com a marca"],
    especialistas: MEMBROS,
    rodadas: 4,
    rodadas_extras: 0,
    rodada_atual: 4,
    etapa: "fim",
    status: "concluida",
    teto_usd: 1,
    estimativa_usd: 0.4,
    custo_usd: 0.3,
    resultado: {
      vencedor: "estrategista_marca",
      ranking: [
        { especialista: "estrategista_marca", nome: "Estrategista de marca", titulo: "Bastidores", nota_jev: 9, nota_media: 7.5, probabilidade: 0.7 },
        { especialista: "copywriter", nome: "Copywriter", titulo: "Perguntas", nota_jev: 7, nota_media: 6, probabilidade: 0.2 },
      ],
      consenso: 0.62,
      nivel: "medio",
      fonte: "jev",
      acordo: 0.5,
      divergencias: [
        { tipo: "nota", texto: "Na proposta de Estrategista de marca, \"viável\": Copywriter deu 9 e Cético deu 2.", especialistas: ["copywriter", "cetico"], proposta: "estrategista_marca", criterio: "viável", diferenca: 7 },
        { tipo: "preferencia", texto: "Cético prefere a proposta de Copywriter, não a vencedora.", especialistas: ["cetico"], proposta: "copywriter" },
      ],
      recomendacao: "Gravar a série de bastidores.",
      porque: "Maior nota do Jev.",
      em_aberto: ["Confirmar a agenda do médico"],
      proximos_passos: [],
      acao: { tipo: "usar_na_mesa", rotulo: "Levar para o agente de roteiros", texto: "Gerar 4 roteiros de bastidores" },
      aviso: null,
      rodada: 4,
    },
    decisao: null,
    memoria_id: null,
    erro_codigo: null,
    erro_mensagem: null,
    aviso: null,
    criado_em: "2026-09-30T13:00:00.000Z",
    atualizado_em: "2026-09-30T13:10:00.000Z",
    concluido_em: "2026-09-30T13:10:00.000Z",
    trava_ate: null,
    ...extra,
  };
}

const fala = (id: string, especialista: string, etapa: FalaDoConselho["etapa"], rodada: number, texto: string): FalaDoConselho => ({
  id, sessao_id: "s1", rodada, etapa, especialista, papel: "especialista", modelo_id: "m1", pedido: null, status: "feita",
  conteudo: { titulo: `Título ${especialista}` }, texto, notas: null, custo_usd: 0.01, erro_mensagem: null, criado_em: "2026-09-30T13:01:00.000Z",
});

function abrir(onUsar?: (t: string) => void) {
  gravarEstadoDaTela("conselho:mesa-roteiros:c1:sessao", "s1");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arvore = () => (
    <QueryClientProvider client={qc}>
      <SalaDoConselho aberto onFechar={() => {}} clientId="c1" origem="mesa-roteiros" tema="Roteiros" onUsar={onUsar} />
    </QueryClientProvider>
  );
  const r = render(arvore());
  // A sessão mudou (tempo real): desenha de novo a mesma árvore.
  return { ...r, atualizar: () => r.rerender(arvore()) };
}

const antes = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const rodadaAberta = () => (document.querySelector('nav[aria-label="Rodadas do conselho"] [aria-current="page"]') as HTMLElement).getAttribute("data-etapa");

describe("Sala do Conselho", () => {
  beforeEach(() => {
    chamar.mockReset();
    convocar.mockReset();
    window.localStorage.clear();
    sessaoAtual = sessaoConcluida();
    falasAtuais = [
      fala("f1", "estrategista_marca", "propostas", 1, "Bastidores da clínica"),
      fala("f2", "copywriter", "propostas", 1, "Perguntas das pacientes"),
      fala("f3", "cetico", "propostas", 1, "Antes e depois com prova"),
    ];
  });

  it("mostra a mesa redonda (a um clique), a recomendação e as divergências à vista (não recolhem)", () => {
    abrir();
    const mesa = screen.getByLabelText("Mesa redonda");
    // Concluída: a mesa nasce recolhida, com o resumo.
    expect(within(mesa).queryByText("Estrategista de marca")).toBeNull();
    expect(within(mesa).getByText("3 especialistas · vencedora: Estrategista de marca")).toBeInTheDocument();
    fireEvent.click(within(mesa).getByRole("button", { name: "Mesa" }));
    expect(within(mesa).getByText("Estrategista de marca")).toBeInTheDocument();
    expect(within(mesa).getByText(/Consenso médio 62%/)).toBeInTheDocument();
    expect(screen.getByText("Gravar a série de bastidores.")).toBeInTheDocument();
    const div = document.querySelector("[data-divergencias]") as HTMLElement;
    expect(div).toBeTruthy();
    expect(within(div).getByText(/Cético deu 2/)).toBeInTheDocument();
    expect(within(div).getByText(/Cético prefere a proposta de Copywriter/)).toBeInTheDocument();
    expect(screen.getByText("Confirmar a agenda do médico")).toBeInTheDocument();
  });

  it("sessão concluída: o resultado vem antes da mesa e das rodadas, e a decisão antes do ranking", () => {
    abrir();
    const resultado = document.querySelector("[data-resultado-do-conselho]")!;
    expect(antes(resultado, document.querySelector("[data-mesa-redonda]")!)).toBe(true);
    expect(antes(resultado, screen.getByRole("button", { name: "Rodadas" }))).toBe(true);
    expect(antes(document.querySelector("[data-decisao]")!, screen.getByRole("button", { name: "Ranking" }))).toBe(true);
    expect(antes(document.querySelector("[data-decisao]")!, document.querySelector("[data-acao-do-conselho]")!)).toBe(true);
  });

  it("durante o debate (nova rodada com resultado antigo), a ordem de hoje: mesa ao vivo em cima", () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", rodadas_extras: 1, rodada_atual: 5 });
    abrir();
    const mesa = document.querySelector("[data-mesa-redonda]")!;
    expect(antes(mesa, document.querySelector("[data-resultado-do-conselho]")!)).toBe(true);
    // Ao vivo, a mesa fica à vista, com o título da rodada.
    expect(within(mesa as HTMLElement).getByText("Rodada 5: Crítica cruzada")).toBeInTheDocument();
    expect(document.querySelector('[data-cadeira="copywriter"]')).toBeTruthy();
  });

  it("parou no teto com um resultado antigo: o aviso vem antes do resultado, com Convocar de novo com teto maior", () => {
    sessaoAtual = sessaoConcluida({ status: "teto", aviso: "O conselho parou no teto de custo." });
    abrir();
    const aviso = document.querySelector('[data-aviso-da-sessao="teto"]')!;
    expect(antes(aviso, document.querySelector("[data-resultado-do-conselho]")!)).toBe(true);
    expect(within(aviso as HTMLElement).getByRole("button", { name: /Convocar de novo com teto maior/ })).toBeInTheDocument();
  });

  it("Seguir a recomendação: um clique, sem Confirmar", async () => {
    chamar.mockResolvedValue({ prova: "Guardado no cérebro." });
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: /Seguir a recomendação/ }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: "decidir", sessao_id: "s1", escolha: "recomendacao", especialista: null, nota: "" }));
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it("Seguir a recomendação fica desligado enquanto o conselho debate", () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", rodadas_extras: 1, rodada_atual: 5 });
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    expect(within(cartao).getByRole("button", { name: /Seguir a recomendação/ })).toBeDisabled();
  });

  it("outra decisão só vai com Confirmar e manda a escolha", async () => {
    chamar.mockResolvedValue({ prova: "Guardado no cérebro." });
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: "Outra decisão" }));
    // Aberto, o primário "Seguir a recomendação" sai: fica o Confirmar.
    expect(within(cartao).queryByRole("button", { name: /Seguir a recomendação/ })).toBeNull();
    fireEvent.click(within(cartao).getByLabelText("Seguir outra proposta"));
    fireEvent.change(within(cartao).getByLabelText("Qual proposta"), { target: { value: "copywriter" } });
    expect(chamar).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith(expect.objectContaining({ acao: "decidir", sessao_id: "s1", escolha: "proposta", especialista: "copywriter" })));
  });

  it("decisão já tomada mostra quem decidiu, o Desfazer e a Nova rodada", async () => {
    sessaoAtual = sessaoConcluida({ decisao: { escolha: "recomendacao", especialista: null, nota: null, por: "u1", por_nome: "Almir", em: "2026-09-30T14:00:00.000Z", desfeita_em: null } });
    chamar.mockResolvedValue({});
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    expect(within(cartao).getByText(/Almir decidiu seguir a recomendação/)).toBeInTheDocument();
    expect(within(cartao).getByRole("button", { name: /Nova rodada/ })).toBeInTheDocument();
    fireEvent.click(within(cartao).getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: "desfazer_decisao", sessao_id: "s1" }));
  });

  it("Nova rodada: mostra o custo antes e só vai com confirmar depois do Confirmar", async () => {
    chamar.mockImplementation(async (c: Record<string, unknown>) =>
      c.confirmar ? { sessao: { id: "s1" } } : { estimativa: { total_usd: 0.2 }, cabe_no_teto: true, teto_sugerido_usd: 1 },
    );
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: /Nova rodada/ }));
    await within(cartao).findByText(/Nova rodada: crítica, revisão e consolidação · US\$ 0,20/);
    expect(chamar).toHaveBeenCalledWith({ acao: "nova_rodada", sessao_id: "s1" });
    expect(chamar.mock.calls.some((c) => c[0].confirmar)).toBe(false);
    // Com o plano aberto, os botões de decisão saem e o único primário é o Confirmar.
    expect(within(cartao).queryByRole("button", { name: /Seguir a recomendação/ })).toBeNull();
    fireEvent.click(within(cartao).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith(expect.objectContaining({ acao: "nova_rodada", sessao_id: "s1", confirmar: true })));
  });

  it("a recomendação com ação vira o pedido para a mesa, com o botão com o nome da mesa", () => {
    const onUsar = vi.fn();
    abrir(onUsar);
    const cartao = document.querySelector("[data-acao-do-conselho]") as HTMLElement;
    expect(within(cartao).getByText("Gerar 4 roteiros de bastidores")).toBeInTheDocument();
    expect(within(cartao).queryByRole("button", { name: /Confirmar/ })).toBeNull();
    expect(onUsar).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: "Levar para a mesa" }));
    expect(onUsar).toHaveBeenCalledWith("Gerar 4 roteiros de bastidores");
  });

  it("ranking: tabela de largura fixa e lista no celular, com os mesmos números", () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Ranking" }));
    const [tabela, listaDoCelular] = Array.prototype.slice.call(document.querySelectorAll("[data-ranking]")) as HTMLElement[];
    expect(tabela.tagName).toBe("TABLE");
    expect(tabela.className).toContain("table-fixed");
    expect(within(tabela).getByRole("columnheader", { name: "Jev" })).toBeInTheDocument();
    expect(listaDoCelular.tagName).toBe("UL");
    expect(within(listaDoCelular).getByText("Jev 9 · Crítica 7,5 · Escolha 70%")).toBeInTheDocument();
  });

  it("a pergunta que falha volta ao campo, com o motivo", async () => {
    chamar.mockRejectedValue(new Error("O provedor não respondeu."));
    abrir();
    const campo = screen.getByLabelText("Pergunta ao conselho") as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "E se o médico não puder gravar?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pergunta" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("O provedor não respondeu."));
    expect((screen.getByLabelText("Pergunta ao conselho") as HTMLTextAreaElement).value).toBe("E se o médico não puder gravar?");
    expect(chamar).toHaveBeenCalledWith(expect.objectContaining({ acao: "perguntar", especialista: "moderador" }));
  });

  it("enquanto o conselho debate, a conversa espera e aparece o Parar; o Parar pede confirmação", async () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", etapa: "critica", rodada_atual: 2, resultado: null });
    falasAtuais = [...falasAtuais, { ...fala("f4", "copywriter", "critica", 2, ""), status: "falando" }];
    chamar.mockResolvedValue({ sessao: { status: "parada" } });
    abrir();
    expect((screen.getByLabelText("Pergunta ao conselho") as HTMLTextAreaElement).disabled).toBe(true);
    expect(document.querySelector('[data-cadeira="copywriter"]')!.getAttribute("data-falando")).toBe("sim");
    fireEvent.click(screen.getByRole("button", { name: "Parar o conselho" }));
    expect(chamar).not.toHaveBeenCalled();
    // Confirmação na própria linha: Cancelar (com o foco) e Parar.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Parar o conselho" }));
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: "parar", sessao_id: "s1" }));
  });

  it("sessão parada: Convocar de novo abre o formulário preenchido, sem convocar", async () => {
    sessaoAtual = sessaoConcluida({ status: "parada", resultado: null, aviso: "Parado pela equipe.", rodadas: 3, especialistas: MEMBROS.slice(0, 2) });
    abrir();
    expect(screen.getByText("Parado pela equipe.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Convocar de novo" }));
    const pergunta = (await screen.findByLabelText("Pergunta")) as HTMLTextAreaElement;
    expect(pergunta.value).toBe("Qual série gravar?");
    await waitFor(() => expect(screen.getByRole("button", { name: /Copywriter/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: /Cético/ })).toHaveAttribute("aria-pressed", "false");
    expect(convocar).not.toHaveBeenCalled();
    expect(chamar).not.toHaveBeenCalled();
  });

  it("cabeçalho: Sessões com nome e as atas no menu", () => {
    abrir();
    expect(screen.getByRole("button", { name: "Outras sessões e nova sessão" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ata" })).toBeInTheDocument();
  });

  it("a vista das rodadas só acompanha a rodada nova se a pessoa estava na rodada ao vivo", () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", rodada_atual: 2, resultado: null });
    const tela = abrir();
    expect(rodadaAberta()).toBe("2");
    // Lendo a rodada 1: a crítica termina e a revisão começa. A vista fica na 1 e a 3 fica marcada.
    fireEvent.click(document.querySelector('nav[aria-label="Rodadas do conselho"] [data-etapa="1"]')!);
    sessaoAtual = { ...sessaoAtual, rodada_atual: 3 };
    tela.atualizar();
    expect(rodadaAberta()).toBe("1");
    expect(document.querySelector('nav[aria-label="Rodadas do conselho"] [data-etapa="3"]')!.getAttribute("title")).toBe("Rodada ao vivo");
    // Na rodada ao vivo, acompanha.
    fireEvent.click(document.querySelector('nav[aria-label="Rodadas do conselho"] [data-etapa="3"]')!);
    sessaoAtual = { ...sessaoAtual, rodada_atual: 4 };
    tela.atualizar();
    expect(rodadaAberta()).toBe("4");
  });

  it("com o conselho parado, tocar numa cadeira leva à conversa com ele e põe o foco no campo", async () => {
    abrir();
    fireEvent.click(within(screen.getByLabelText("Mesa redonda")).getByRole("button", { name: "Mesa" }));
    fireEvent.click(document.querySelector('[data-cadeira="copywriter"]')!);
    expect(screen.getByRole("tab", { name: /Conversar/ })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("Com quem conversar") as HTMLSelectElement).value).toBe("copywriter");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Pergunta ao conselho")));
  });

  it("durante o debate, tocar na cadeira só escolhe com quem (não troca de parte)", () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", etapa: "critica", rodada_atual: 2, resultado: null });
    abrir();
    fireEvent.click(document.querySelector('[data-cadeira="cetico"]')!);
    expect(screen.getByRole("tab", { name: /Debate/ })).toHaveAttribute("aria-selected", "true");
  });
});
