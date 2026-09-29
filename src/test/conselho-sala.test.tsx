import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FalaDoConselho, SessaoDoConselho } from "@/lib/conselho/api";

/**
 * Sala do Conselho (frente CNS, 30/09): a tela mostra as divergências sem
 * esconder, a decisão do dono só vai com Confirmar, a recomendação com ação
 * vira cartão com Confirmar e a pergunta que falha volta ao campo.
 */

const chamar = vi.fn();
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
  return render(
    <QueryClientProvider client={qc}>
      <SalaDoConselho aberto onFechar={() => {}} clientId="c1" origem="mesa-roteiros" tema="Roteiros" onUsar={onUsar} />
    </QueryClientProvider>,
  );
}

describe("Sala do Conselho", () => {
  beforeEach(() => {
    chamar.mockReset();
    window.localStorage.clear();
    sessaoAtual = sessaoConcluida();
    falasAtuais = [
      fala("f1", "estrategista_marca", "propostas", 1, "Bastidores da clínica"),
      fala("f2", "copywriter", "propostas", 1, "Perguntas das pacientes"),
      fala("f3", "cetico", "propostas", 1, "Antes e depois com prova"),
    ];
  });

  it("mostra a mesa redonda, a recomendação e as divergências à vista (não recolhem)", () => {
    abrir();
    const mesa = screen.getByLabelText("Mesa redonda");
    expect(within(mesa).getByText("Estrategista de marca")).toBeInTheDocument();
    expect(within(mesa).getByText(/Consenso médio 62%/)).toBeInTheDocument();
    expect(screen.getByText("Gravar a série de bastidores.")).toBeInTheDocument();
    const div = document.querySelector("[data-divergencias]") as HTMLElement;
    expect(div).toBeTruthy();
    expect(within(div).getByText(/Cético deu 2/)).toBeInTheDocument();
    expect(within(div).getByText(/Cético prefere a proposta de Copywriter/)).toBeInTheDocument();
    expect(screen.getByText("Confirmar a agenda do médico")).toBeInTheDocument();
  });

  it("a decisão do dono só vai com Confirmar e manda a escolha", async () => {
    chamar.mockResolvedValue({ prova: "Guardado no cérebro." });
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    fireEvent.click(within(cartao).getByLabelText("Seguir outra proposta"));
    fireEvent.change(within(cartao).getByLabelText("Qual proposta"), { target: { value: "copywriter" } });
    expect(chamar).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith(expect.objectContaining({ acao: "decidir", sessao_id: "s1", escolha: "proposta", especialista: "copywriter" })));
  });

  it("decisão já tomada mostra quem decidiu e o Desfazer", async () => {
    sessaoAtual = sessaoConcluida({ decisao: { escolha: "recomendacao", especialista: null, nota: null, por: "u1", por_nome: "Almir", em: "2026-09-30T14:00:00.000Z", desfeita_em: null } });
    chamar.mockResolvedValue({});
    abrir();
    const cartao = document.querySelector("[data-decisao]") as HTMLElement;
    expect(within(cartao).getByText(/Almir decidiu seguir a recomendação/)).toBeInTheDocument();
    fireEvent.click(within(cartao).getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: "desfazer_decisao", sessao_id: "s1" }));
  });

  it("a recomendação com ação vira cartão com Confirmar que leva o pedido para a mesa", () => {
    const onUsar = vi.fn();
    abrir(onUsar);
    const cartao = document.querySelector("[data-acao-do-conselho]") as HTMLElement;
    expect(within(cartao).getByText("Gerar 4 roteiros de bastidores")).toBeInTheDocument();
    expect(onUsar).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: /Confirmar/ }));
    expect(onUsar).toHaveBeenCalledWith("Gerar 4 roteiros de bastidores");
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

  it("enquanto o conselho debate, a conversa espera e aparece o Parar", () => {
    sessaoAtual = sessaoConcluida({ status: "rodando", etapa: "critica", rodada_atual: 2, resultado: null });
    falasAtuais = [...falasAtuais, { ...fala("f4", "copywriter", "critica", 2, ""), status: "falando" }];
    abrir();
    expect(screen.getByRole("button", { name: "Parar o conselho" })).toBeInTheDocument();
    expect((screen.getByLabelText("Pergunta ao conselho") as HTMLTextAreaElement).disabled).toBe(true);
    expect(document.querySelector('[data-cadeira="copywriter"]')!.getAttribute("data-falando")).toBe("sim");
  });
});
