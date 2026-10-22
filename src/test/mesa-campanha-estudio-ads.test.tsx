import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Campanha completa (21/10/2026): a semente do Mês vira a campanha nova preenchida; "Gerar campanha
 * completa" mostra o custo TOTAL antes e só gasta no segundo clique; roda campanha, selo e peças em
 * sequência (pausar, continuar, cancelar); falha numa peça não perde as outras; reabrir continua de onde
 * parou; e cada peça sai do gerador do Estúdio, sem colagem de imagem.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "gte", "lte"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaCampanhas from "@/components/mesa/AbaCampanhas";
import { guardarSementeDaCampanha, type SementeDaCampanha } from "@/components/mesa/sementeDaCampanha";
import {
  arquivosDaPeca,
  campanhaDaSemente,
  corpoDaPeca,
  datasDoQuando,
  faseDaPeca,
  passosQueFaltam,
  pedidoDaPeca,
  REGRA_SEM_COLAGEM,
  semColagem,
  situacaoDaPeca,
  sugestoesDaSemente,
  trabalhoDaPeca,
  versaoComColagem,
  type TrabalhoDaPeca,
} from "@/components/mesa/regrasDaCampanha";
import { cancelar, continuar, executarCampanha, limparExecucoes, pausar, type DepsDaExecucao } from "@/components/mesa/execucaoDaCampanha";
import { hojeIso, somarDiasIso, type Campanha, type ItemProposto } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA_ID = "44444444-4444-4444-4444-444444444444";
const FOTO_KIT = "55555555-5555-4555-8555-555555555555";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadas = (funcao: string, acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

const itens: ItemProposto[] = [
  { tema_id: "c1", data: "2026-11-16", formato: "carrossel", etapa: "aquecimento", tema: "Vem aí", gancho: "Guarde a data", cards: [{ ordem: 1, texto: "Capa" }, { ordem: 2, texto: "Data" }, { ordem: 3, texto: "CTA" }] },
  { tema_id: "c2", data: "2026-11-27", formato: "estatico", etapa: "lançamento", tema: "Abriu", gancho: "30% hoje", cards: [{ ordem: 1, texto: "30% OFF" }] },
  { tema_id: "c3", data: "2026-11-28", formato: "estatico", etapa: "último chamado", tema: "Último dia", gancho: "Acaba hoje", cards: [{ ordem: 1, texto: "Acaba hoje" }] },
];

const campanha: Campanha = {
  id: CAMPANHA_ID, client_id: CLIENTE, nome: "Black Friday", pedido: "Black Friday com 30%", objetivo: "Vender", periodo_inicio: "2026-11-14", periodo_fim: "2026-11-29",
  conceito: "A maior do ano.", identidade: { tema_visual: "Preto e neon", paleta_apoio: [{ nome: "Neon", hex: "#39FF14" }], selo: { texto: "BF 30%" } },
  referencias_ids: [], selo_path: null, proposta_id: "22222222-2222-4222-8222-222222222222", status: "planejada", custo_usd: 0, criado_em: "2026-10-21T12:00:00Z",
  briefing: { produtos: [{ nome: "Plano anual", por_que: "Mais margem" }], oferta: "30% no plano anual", mensagem_central: "Só uma vez por ano", publico: "Donos de loja", provas: [], tom: "Direto", cta: "Assine" },
  imagens: [{ imagem_id: FOTO_KIT, papel: "heroi", nota: "" }],
};

const proposta = { id: campanha.proposta_id, client_id: CLIENTE, project_id: "p", periodo_inicio: "2026-11-14", periodo_fim: "2026-11-29", itens, status: "pronta", task_ids: [] };

const semente: SementeDaCampanha = {
  hypes: [{ titulo: "Black Friday", quando: "27/11", por_que_agora: "Todo mundo compra", como_usar: "Oferta única do ano no plano anual" }],
  trends: [{ titulo: "Compras parceladas em alta", fonte: "G1", data: "2026-10-20", resumo: "Parcelamento cresce 20%." }],
  pedido: "Black Friday com 30% no plano anual",
  criada_em: "2026-10-21T10:00:00Z",
};

beforeEach(() => {
  window.localStorage.removeItem("mesa:campanha:aba");
  window.sessionStorage.clear();
  vi.clearAllMocks();
  limparExecucoes();
  mock.tabelas = {};
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
    if (body.acao === "campanha_criar") {
      mock.tabelas.mesa_campanhas = [campanha];
      mock.tabelas.calendario_propostas = [proposta];
      return { data: { campanha, proposta, project_id: "p", custo_usd: 0.1 }, error: null };
    }
    if (body.acao === "selo_gerar") return { data: { versao: { id: "66666666-6666-4666-8666-666666666666" }, custo_usd: 0.04 }, error: null };
    if (body.acao === "rapida_preparar") return { data: { trabalho: { id: `t-${body.peca_da_campanha.tema_id}`, direcao: { cards: [{ ordem: 1 }] } } }, error: null };
    return { data: {}, error: null };
  });
});

afterEach(() => limparExecucoes());

import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import CampanhaPecas from "@/components/mesa/CampanhaPecas";
import CampanhaAds from "@/components/mesa/CampanhaAds";
import VoltarACampanha from "@/components/mesa/VoltarACampanha";
import { usePecasDaCampanha } from "@/components/mesa/CampanhaCompleta";
import { moldeDaCampanha, progressoDaCampanha, prontasPorCampanha } from "@/components/mesa/regrasDaCampanha";
import { numerosDoAds, vincularAds } from "@/components/mesa/campanhaAdsApi";

// 22/10/2026: abrir a peça no Estúdio (pronta, sem gerar), voltar e ver o estado, vínculo opcional com Ads,
// "Nova campanha a partir desta" e as laterais da aba Campanhas recolhendo para o lado.

function Endereco() {
  const l = useLocation();
  return h("output", { "data-testid": "endereco" }, `${l.pathname}${l.search}`);
}

function montarComRota(filho: any, inicial = "/mesa", qc?: QueryClient) {
  const cliente = qc || new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [inicial] },
      h(QueryClientProvider, { client: cliente },
        h(TooltipProvider, null,
          h(MesaProvider, { valor: valorDaMesa(), children: h(Routes, null, h(Route, { path: "*", element: h("div", null, filho, h(Endereco)) })) })))),
  );
}

const trabalhoPronto = (id: string, tema: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "pronto",
  direcao: { cards: [{ ordem: 1 }], arte_rapida: { pedido: "x", titulo: "x", peca: "unica", campanha_id: CAMPANHA_ID, peca_da_campanha: { campanha_id: CAMPANHA_ID, tema_id: tema }, arquivos: [], ...extra } },
  cards: [{ ordem: 1, versao: 1, storage_path: `${CLIENTE}/arte/${tema}.png` }],
  legenda: "",
  task_id: null,
  aprovado_em: null,
  atualizado_em: "2026-10-22T10:00:00Z",
});

describe("abrir a peça no Estúdio", () => {
  it("peça a criar: prepara a direção SEM enfileirar e abre o trabalho no Estúdio", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "rapida_preparar") return { data: { trabalho: { id: "t-novo", direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] } } }, error: null };
      return { data: {}, error: null };
    });
    const abrir = vi.fn();
    const pecas = itens.map((it) => situacaoDaPeca(campanha, it, null));
    montarComRota(h(CampanhaPecas, { campanha, pecas, carregando: false, onAbrirArteRapida: abrir }));
    const botoes = screen.getAllByRole("button", { name: /Abrir no Estúdio/ });
    fireEvent.click(botoes[0]);
    await waitFor(() => expect(abrir).toHaveBeenCalledWith("t-novo"));
    const corpo = chamadas("estudio-arte", "rapida_preparar")[0];
    expect(corpo).toMatchObject({ campanha_id: CAMPANHA_ID, peca_da_campanha: { campanha_id: CAMPANHA_ID, tema_id: "c1" } });
    expect(String(corpo.pedido)).toContain("Guarde a data");
    expect(chamadas("estudio-arte", "enfileirar").length).toBe(0);
  });

  it("peça já criada: abre o trabalho existente, sem gastar", () => {
    const abrir = vi.fn();
    const pecas = [situacaoDaPeca(campanha, itens[1], trabalhoPronto("t-2", "c2") as any)];
    montarComRota(h(CampanhaPecas, { campanha, pecas, carregando: false, onAbrirArteRapida: abrir }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir no Estúdio" }));
    expect(abrir).toHaveBeenCalledWith("t-2");
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("voltar à campanha relê do servidor: a peça gerada no Estúdio aparece pronta", async () => {
    mock.tabelas.estudio_trabalhos = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Pecas() {
      const { pecas, carregando } = usePecasDaCampanha(campanha, proposta as any);
      return h(CampanhaPecas, { campanha, pecas, carregando, onAbrirArteRapida: vi.fn() });
    }
    const primeira = montarComRota(h(Pecas), "/mesa", qc);
    await waitFor(() => expect(document.querySelector('[data-peca="c2"]')!.getAttribute("data-estado")).toBe("a_fazer"));
    primeira.unmount();
    // No Estúdio, a equipe gerou a peça c2.
    mock.tabelas.estudio_trabalhos = [trabalhoPronto("t-2", "c2")];
    montarComRota(h(Pecas), "/mesa", qc);
    await waitFor(() => expect(document.querySelector('[data-peca="c2"]')!.getAttribute("data-estado")).toBe("pronta"));
  });

  it("no Estúdio, a arte da campanha tem Voltar à campanha (aba e campanha no endereço, sem a arte rápida)", async () => {
    const TRAB = "77777777-7777-4777-8777-777777777777";
    mock.tabelas.estudio_trabalhos = [{ ...trabalhoPronto(TRAB, "c1"), client_id: CLIENTE }];
    montarComRota(h(VoltarACampanha, { trabalhoId: TRAB }), `/mesa?client=${CLIENTE}&aba=estudio&rapida=${TRAB}`);
    fireEvent.click(await screen.findByRole("button", { name: "Voltar à campanha" }));
    const endereco = screen.getByTestId("endereco").textContent || "";
    expect(endereco).toContain("aba=campanhas");
    expect(endereco).toContain(`campanha=${CAMPANHA_ID}`);
    expect(endereco).not.toContain("rapida=");
  });
});

describe("vínculo opcional com Ads", () => {
  it("vincular grava no briefing; desvincular tira; os números vêm das tabelas já sincronizadas", async () => {
    await vincularAds(campanha, { campaign_id: "120", name: "BF Leads", effective_status: "PAUSED", objective: null, updated_at: null });
    const vinculo = chamadas("agente-calendario", "campanha_salvar")[0];
    expect(vinculo.briefing.ads).toMatchObject({ campaign_id: "120", nome: "BF Leads" });
    expect(vinculo.briefing.oferta).toBe("30% no plano anual");

    const vinculada = { ...campanha, briefing: vinculo.briefing } as Campanha;
    mock.tabelas.ads_campaign_daily = [
      { day: "2026-10-20", spend: 12.5, actions: [{ action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "lead", value: "3" }], captured_at: "2026-10-21T10:00:00Z" },
      { day: "2026-10-21", spend: 7.5, actions: [{ action_type: "lead", value: "2" }], captured_at: "2026-10-22T09:00:00Z" },
    ];
    expect(numerosDoAds(mock.tabelas.ads_campaign_daily as any)).toEqual({ gasto: 20, leads: 5, dias: 2, lidoEm: "2026-10-22T09:00:00Z" });
    montarComRota(h(CampanhaAds, { campanha: vinculada }));
    expect(await screen.findByText(/20,00 gastos · 5 leads/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir na Mesa Ads" }).getAttribute("href")).toContain(`campanha_mesa=${CAMPANHA_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Desvincular a campanha de anúncios" }));
    await waitFor(() => expect(chamadas("agente-calendario", "campanha_salvar").length).toBe(2));
    expect(chamadas("agente-calendario", "campanha_salvar")[1].briefing.ads).toBeUndefined();
    // Nada vai para a Meta: nenhuma função de anúncio foi chamada.
    expect(mock.invoke.mock.calls.filter((c) => String(c[0]).indexOf("ads") >= 0).length).toBe(0);
  });
});

describe("várias campanhas por cliente", () => {
  it("o molde leva a estrutura (formatos, duração, tipo, público, tom, canais, CTA) e não o tema", () => {
    const c = { ...campanha, identidade: { ...campanha.identidade, tipo: "promocao" }, briefing: { ...(campanha.briefing as object), canais: ["Stories"], formatos: { posts: 2, carrosseis: 1, stories: 3, videos: 1 } } } as Campanha;
    const m = moldeDaCampanha(c);
    expect(m).toMatchObject({ origemId: CAMPANHA_ID, dias: 15, tipo: "promocao", formatos: { posts: 2, carrosseis: 1, stories: 3, videos: 1 } });
    expect(m.briefing).toEqual({ publico: "Donos de loja", tom: "Direto", cta: "Assine", canais: ["Stories"] });
    expect((m.briefing as any).oferta).toBeUndefined();
    expect(progressoDaCampanha(c, 3, prontasPorCampanha([trabalhoPronto("t1", "c1") as any]))).toEqual({ prontas: 1, total: 3 });
  });

  it("na lista: progresso e Nova campanha a partir desta; as laterais recolhem e a escolha fica lembrada", async () => {
    telaLarga();
    mock.tabelas.mesa_campanhas = [{ ...campanha, briefing: { ...(campanha.briefing as object), formatos: { posts: 2, carrosseis: 1, stories: 0, videos: 0 } } }];
    mock.tabelas.calendario_propostas = [proposta];
    mock.tabelas.estudio_trabalhos = [trabalhoPronto("t1", "c1")];
    const tela = montarComRota(h(AbaCampanhas, { campanhaId: CAMPANHA_ID }));
    const lista = await screen.findByRole("navigation", { name: "Campanhas do cliente" });
    await waitFor(() => expect(lista.querySelector("[data-progresso]")!.getAttribute("data-progresso")).toBe("1/3"));

    fireEvent.click(screen.getByRole("button", { name: "Recolher o agente" }));
    expect(document.querySelector("[data-agente-recolhido]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recolher as campanhas" }));
    expect(document.querySelector("[data-lista-recolhida]")).toBeTruthy();
    tela.unmount();
    montarComRota(h(AbaCampanhas, { campanhaId: CAMPANHA_ID }));
    await waitFor(() => expect(document.querySelector("[data-agente-recolhido]")).toBeTruthy());
    expect(document.querySelector("[data-lista-recolhida]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir as campanhas" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o agente da campanha" }));
    expect(screen.getByRole("navigation", { name: "Campanhas do cliente" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Nova campanha a partir de ${campanha.nome}` }));
    expect(await screen.findByText(/A partir de:/)).toBeTruthy();
    expect((screen.getByLabelText("Fim da campanha") as HTMLInputElement).value).toBe(somarDiasIso(hojeIso(), 15));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const posts = screen.getByRole("list", { name: "Formatos da campanha" }).querySelector('[data-formato="posts"]') as HTMLElement;
    expect(posts.textContent).toContain("2");
  });
});

const matchMediaOriginal = window.matchMedia;
function telaLarga() {
  (window as any).matchMedia = (query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} });
}
afterEach(() => {
  (window as any).matchMedia = matchMediaOriginal;
  window.localStorage.clear();
});
