import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa, versão 5 (23/09, noite), a aba Campanhas como mesa de trabalho: lista,
 * campanha aberta em seções e o agente da campanha (campanha_conversar,
 * docs/mesa-do-cliente/CONTRATOS-V5.md), com microfone, anexos e atalhos.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) =>
      Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: mock.upload,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaCampanhas from "@/components/mesa/AbaCampanhas";
import CampanhaAgente from "@/components/mesa/CampanhaAgente";
import CampanhaNova from "@/components/mesa/CampanhaNova";
import { corpoDaConversaDaCampanha } from "@/components/mesa/campanhasApi";
import type { Campanha } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === "agente-calendario" && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

const proposta = {
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  project_id: "33333333-3333-3333-3333-333333333333",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  parametros: { campanha_id: "44444444-4444-4444-4444-444444444444" },
  status: "pronta",
  diagnostico: null,
  itens: [{ tema_id: "c1", data: "2026-10-02", formato: "carrossel", tema: "Teaser do amor", gancho: "Quem ama presenteia", cards: [{ ordem: 1, texto: "Capa" }] }],
  conversa_id: null,
  task_ids: [],
  gravada_em: null,
};

const campanha: Campanha = {
  id: "44444444-4444-4444-4444-444444444444",
  client_id: CLIENTE,
  nome: "Promoção do amor",
  pedido: "promoção do amor",
  objetivo: "Vender kits para casal",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  conceito: "O amor se mostra nos detalhes.",
  identidade: { tema_visual: "Luz quente", paleta_apoio: [{ nome: "Vinho", hex: "#880516" }], tipografia: "Serifa", elementos: "Corações", tom: "Leve", selo: { texto: "Amor em dobro", descricao: "Selo redondo" } },
  referencias_ids: [],
  selo_path: null,
  proposta_id: proposta.id,
  status: "planejada",
  custo_usd: 0.2,
  criado_em: "2026-09-23T12:00:00Z",
};

const campanhaAjustada: Campanha = { ...campanha, nome: "Amor em dobro", identidade: { ...campanha.identidade, tom: "Divertido" } };
const propostaAjustada = {
  ...proposta,
  itens: proposta.itens.concat([{ tema_id: "c2", data: "2026-10-05", formato: "estatico", tema: "Depoimento de casal", gancho: "Eles contam", cards: [] } as any]),
};

const matchMediaOriginal = window.matchMedia;

function telaLarga() {
  (window as any).matchMedia = (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockImplementation(async (_funcao: string, { body }: any) => {
    if (body.acao === "campanha_conversar") {
      // O servidor grava: as releituras seguintes já trazem a campanha nova.
      mock.tabelas.mesa_campanhas = [campanhaAjustada];
      mock.tabelas.calendario_propostas = [propostaAjustada];
      mock.tabelas.agente_conversas = [{ id: "conv-1" }];
      mock.tabelas.agente_mensagens = [
        { id: "m2", papel: "agente", conteudo: "Mudei o nome e o tom e acrescentei um depoimento.", anexos: [{ proposta_id: proposta.id }], criado_em: "2026-09-23T20:00:02Z" },
        { id: "m1", papel: "usuario", conteudo: body.mensagem, anexos: [], criado_em: "2026-09-23T20:00:00Z" },
      ];
      return { data: { campanha: campanhaAjustada, proposta: propostaAjustada, resposta: "Mudei o nome e o tom.", conversa_id: "conv-1", custo_usd: 0.03 }, error: null };
    }
    if (body.acao === "campanha_criar") return { data: { campanha, proposta, resposta: "ok", project_id: "proj", custo_usd: 0.1 }, error: null };
    return { data: {}, error: null };
  });
});

afterEach(() => {
  (window as any).matchMedia = matchMediaOriginal;
  delete (window as any).webkitSpeechRecognition;
});

describe("agente da campanha", () => {
  it("Enviar chama campanha_conversar com o id da campanha e a mensagem", async () => {
    montar(h(CampanhaAgente, { campanha }));
    fireEvent.change(screen.getByLabelText("Pedido ao agente da campanha"), { target: { value: "Mude o tom para mais divertido" } });
    const enviar = screen.getByRole("button", { name: /Enviar/ });
    await waitFor(() => expect(enviar).not.toBeDisabled());
    fireEvent.click(enviar);
    await waitFor(() => expect(chamadasDe("campanha_conversar").length).toBe(1));
    expect(chamadasDe("campanha_conversar")[0]).toEqual({
      acao: "campanha_conversar",
      campanha_id: campanha.id,
      mensagem: "Mude o tom para mais divertido",
    });
    // A resposta entra na conversa (lida direto de agente_mensagens).
    expect(await screen.findByText("Mudei o nome e o tom e acrescentei um depoimento.")).toBeTruthy();
  });

  it("os atalhos só preenchem o campo, sem gastar", () => {
    montar(h(CampanhaAgente, { campanha }));
    fireEvent.click(screen.getByRole("button", { name: "Mude o tom para…" }));
    expect((screen.getByLabelText("Pedido ao agente da campanha") as HTMLTextAreaElement).value).toBe("Mude o tom para ");
    for (const rotulo of ["Acrescente um conteúdo de…", "Troque as cores de apoio", "Deixe o selo mais…"]) {
      expect(screen.getByRole("button", { name: rotulo })).toBeTruthy();
    }
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("o corpo leva os anexos (até 6) só quando houver", () => {
    expect(corpoDaConversaDaCampanha({ campanhaId: "c", mensagem: "oi" })).toEqual({ acao: "campanha_conversar", campanha_id: "c", mensagem: "oi" });
    const corpo = corpoDaConversaDaCampanha({ campanhaId: "c", mensagem: "oi", anexos: ["1", "2", "3", "4", "5", "6", "7"] });
    expect((corpo.anexos as string[]).length).toBe(6);
  });

  it("o microfone (Ditado) aparece no agente e na campanha nova quando o navegador tem voz", () => {
    (window as any).webkitSpeechRecognition = function Reconhecedor() {};
    const agente = montar(h(CampanhaAgente, { campanha }));
    expect(screen.getByRole("button", { name: "Falar em vez de digitar" })).toBeTruthy();
    agente.unmount();
    montar(h(CampanhaNova, { onCriada: vi.fn() }));
    expect(screen.getByRole("button", { name: "Falar em vez de digitar" })).toBeTruthy();
  });

  it("o agente tem campo de anexos", () => {
    montar(h(CampanhaAgente, { campanha }));
    expect(screen.getByTestId("entrada-de-anexos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anexar imagens" })).toBeTruthy();
  });
});

describe("aba Campanhas, mesa de trabalho", () => {
  it("tela larga: lista, campanha em seções e agente; a resposta do agente atualiza a campanha na tela", async () => {
    telaLarga();
    mock.tabelas.mesa_campanhas = [campanha];
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(AbaCampanhas, { campanhaId: campanha.id }));

    const lista = await screen.findByRole("navigation", { name: "Campanhas do cliente" });
    expect(await within(lista).findByText("Promoção do amor")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Promoção do amor" })).toBeTruthy();
    for (const secao of ["Visão geral", "Identidade do tema", "Referências", "Conteúdos"]) {
      expect(screen.getByRole("button", { name: new RegExp(secao) })).toHaveAttribute("aria-expanded", "true");
    }
    expect(await screen.findByText("Teaser do amor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gravar tudo na agenda/ })).toBeTruthy();

    const agente = screen.getByRole("complementary", { name: "Agente da campanha" });
    fireEvent.change(within(agente).getByLabelText("Pedido ao agente da campanha"), { target: { value: "Mude o nome e acrescente um depoimento" } });
    const enviar = within(agente).getByRole("button", { name: /Enviar/ });
    await waitFor(() => expect(enviar).not.toBeDisabled());
    fireEvent.click(enviar);

    await waitFor(() => expect(chamadasDe("campanha_conversar").length).toBe(1));
    expect(chamadasDe("campanha_conversar")[0]).toEqual({ acao: "campanha_conversar", campanha_id: campanha.id, mensagem: "Mude o nome e acrescente um depoimento" });
    expect(await screen.findByRole("heading", { name: "Amor em dobro" })).toBeTruthy();
    expect(await screen.findByText("Depoimento de casal")).toBeTruthy();
    expect(screen.getByText("Divertido")).toBeTruthy();
  });

  it("recolher uma seção esconde o conteúdo dela", async () => {
    telaLarga();
    window.localStorage.removeItem("mesa:campanha:secoes-fechadas");
    mock.tabelas.mesa_campanhas = [campanha];
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(AbaCampanhas, { campanhaId: campanha.id }));
    expect(await screen.findByText("Luz quente", { selector: "dd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Identidade do tema/ }));
    expect(screen.queryByText("Serifa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Identidade do tema/ }));
    expect(screen.getByText("Serifa")).toBeTruthy();
  });

  it("sem campanha aberta: estado vazio com Nova campanha e as recentes; sem agente", async () => {
    telaLarga();
    mock.tabelas.mesa_campanhas = [campanha];
    montar(h(AbaCampanhas, {}));
    expect(await screen.findByText("Abra uma campanha ou comece outra")).toBeTruthy();
    const recentes = screen.getByRole("list", { name: "Campanhas recentes" });
    expect(within(recentes).getByText("Promoção do amor")).toBeTruthy();
    expect(screen.queryByLabelText("Pedido ao agente da campanha")).toBeNull();
    fireEvent.click(within(recentes).getByRole("button", { name: /Promoção do amor/ }));
    expect(await screen.findByRole("heading", { name: "Promoção do amor" })).toBeTruthy();
    expect(screen.getByLabelText("Pedido ao agente da campanha")).toBeTruthy();
  });

  it("cliente sem campanhas: convite para a primeira e o formulário abre num clique", async () => {
    montar(h(AbaCampanhas, {}));
    expect(await screen.findByText("A primeira campanha deste cliente")).toBeTruthy();
    const botoes = screen.getAllByRole("button", { name: /Nova campanha/ });
    fireEvent.click(botoes[botoes.length - 1]);
    expect(await screen.findByLabelText("Pedido da campanha")).toBeTruthy();
    // Referências ficam em "Mais opções".
    expect(screen.getByRole("button", { name: /Mais opções/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("tela menor: a lista vira seletor e o agente vira gaveta", async () => {
    mock.tabelas.mesa_campanhas = [campanha];
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(AbaCampanhas, { campanhaId: campanha.id }));
    expect(await screen.findByRole("heading", { name: "Promoção do amor" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Campanha aberta" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Campanhas do cliente" })).toBeNull();
    expect(screen.queryByLabelText("Pedido ao agente da campanha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Conversar com o agente/ }));
    expect(await screen.findByLabelText("Pedido ao agente da campanha")).toBeTruthy();
  });
});
