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
  stories: vi.fn(),
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "gte", "lte", "insert", "upsert"]) b[m] = () => b;
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
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: {}, error: null }),
          remove: () => Promise.resolve({ data: {}, error: null }),
          download: () => Promise.resolve({ data: new Blob(["png"], { type: "image/png" }), error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("@/components/mesa/stories/storiesApi", () => ({ gerarStoriesDaCampanha: mock.stories }));
vi.mock("@/lib/miniaturas", () => ({ gravarCopiasSemEsperar: () => undefined }));
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

import CampanhaReferenciaPadrao from "@/components/mesa/CampanhaReferenciaPadrao";
import { storiesComoItens } from "@/components/mesa/regrasDaCampanha";
import { definirPadraoDaCampanha, gerarSeloDaCampanha, MODELOS_DO_SELO, modeloDoSelo } from "@/components/mesa/campanhasApi";
import {
  blocoDoPadrao,
  idsDoPadrao,
  normalizarPadrao,
  pedidoDoSeloPeloPadrao,
  referenciasDaPecaComPadrao,
  resumoDoPadraoParaAPeca,
} from "../../supabase/functions/_shared/padrao-da-campanha";
import { ESQUEMA_DO_PADRAO } from "../../supabase/functions/_shared/padrao-da-campanha";

// 22/10/2026: a referência da campanha vira o padrão visual dela (lido uma vez); posts, carrosséis, stories e o
// selo seguem o padrão com as referências anexadas como estilo, sem colagem; o selo no GPT Image 2.5 do catálogo.

const REF_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REF_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const padraoLido = {
  referencias_ids: [REF_1, REF_2],
  caminhos: [`${CLIENTE}/referencias/upload-1.png`],
  resumo: "Fundo preto, título condensado gigante em neon e foto recortada à direita.",
  layout: "Título no terço de cima, foto à direita, faixa diagonal embaixo.",
  hierarquia: "Número da oferta, título, chamada.",
  tipografia: "Sem serifa condensada, caixa alta, peso black.",
  paleta: [{ nome: "Preto", hex: "#0b0b0b" }, { nome: "Neon", hex: "#39FF14" }],
  tratamento_de_foto: "Produto recortado com sombra dura.",
  elementos: "Faixa diagonal e selo circular.",
  para_o_selo: "Selo circular com borda neon e número grande.",
  nao_copiar: "O logo e o texto da loja de referência.",
  lido_em: "2026-10-22T10:00:00Z",
  modelo: "openai:gpt-texto",
};
const comPadrao = { ...campanha, briefing: { ...(campanha.briefing as object), padrao: padraoLido } } as Campanha;

describe("referência da campanha vira o padrão", () => {
  it("o padrão é guardado em forma fixa (1 a 3 referências, paleta em hex) e o esquema da leitura é estrito", () => {
    const p = normalizarPadrao(padraoLido)!;
    expect(p.referencias_ids).toEqual([REF_1, REF_2]);
    expect(p.paleta.map((c) => c.hex)).toEqual(["#0B0B0B", "#39FF14"]);
    expect(idsDoPadrao([REF_1, REF_1, "x", `g:${REF_2}`, REF_2, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"])).toEqual([REF_1, `g:${REF_2}`, REF_2]);
    expect(normalizarPadrao({ referencias_ids: [], resumo: "x" })).toBeNull();
    expect(ESQUEMA_DO_PADRAO.schema.required.length).toBe(Object.keys(ESQUEMA_DO_PADRAO.schema.properties).length);
  });

  it("escolher de uma peça já gerada e ler: grava o padrão pela campanha_padrao com as referências", async () => {
    mock.tabelas.cliente_referencias = [{ id: REF_1 }];
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "campanha_padrao") return { data: { campanha: comPadrao, padrao: padraoLido, custo_usd: 0.01 }, error: null };
      return { data: {}, error: null };
    });
    const pronta = situacaoDaPeca(campanha, itens[1], trabalhoPronto("t-2", "c2") as any);
    montarComRota(h(CampanhaReferenciaPadrao, { campanha, pecas: [pronta] }));
    fireEvent.click(screen.getByRole("button", { name: /Usar Abriu como referência/ }));
    await waitFor(() => expect(screen.getByText(/1 de 3/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Ler o padrão da referência/ }));
    await waitFor(() => expect(chamadas("estudio-arte", "campanha_padrao").length).toBe(1));
    expect(chamadas("estudio-arte", "campanha_padrao")[0]).toEqual({ acao: "campanha_padrao", campanha_id: CAMPANHA_ID, referencias_ids: [REF_1] });
  });

  it("com padrão: a visão mostra o estilo e a paleta; tirar manda a lista vazia (sem custo)", async () => {
    await definirPadraoDaCampanha(CAMPANHA_ID, [REF_1, REF_2, REF_1, REF_2]);
    expect(chamadas("estudio-arte", "campanha_padrao")[0].referencias_ids.length).toBe(3);
    montarComRota(h(CampanhaReferenciaPadrao, { campanha: comPadrao }));
    expect(screen.getByText(padraoLido.resumo)).toBeTruthy();
    expect(screen.getByLabelText("Paleta do padrão").querySelectorAll("span").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Tirar o padrão" }));
    await waitFor(() => expect(chamadas("estudio-arte", "campanha_padrao").length).toBe(2));
    expect(chamadas("estudio-arte", "campanha_padrao")[1].referencias_ids).toEqual([]);
  });
});

describe("as peças levam o padrão e a referência, sem colagem", () => {
  it("post e carrossel: as referências do padrão na frente, fidelidade inspirada e o bloco no prompt", () => {
    const p = normalizarPadrao(padraoLido);
    expect(referenciasDaPecaComPadrao(p, ["x-1", REF_2], null)).toEqual({ referencias_ids: [REF_1, REF_2, "x-1"], fidelidade_referencia: "inspirada" });
    expect(referenciasDaPecaComPadrao(null, ["x-1"], null)).toEqual({ referencias_ids: ["x-1"], fidelidade_referencia: null });
    const bloco = blocoDoPadrao(p);
    expect(bloco).toContain("PADRÃO VISUAL DA CAMPANHA");
    expect(bloco).toContain("#39FF14");
    expect(bloco).toContain("Nunca copie textos, logos, marcas, pessoas nem produtos delas");
    expect(bloco).toContain("Nada colado");
    // A peça continua mandando a foto real só como referência inteira.
    expect(semColagem(arquivosDaPeca(comPadrao, itens[0]))).toBe(true);
  });

  it("story: a sequência pela aba Stories leva o padrão no briefing e no pedido", async () => {
    mock.stories.mockResolvedValue({ situacao: "pronta", sequencia: { id: "seq-9" } });
    const comStory = { ...comPadrao, briefing: { ...(comPadrao.briefing as object), stories: [{ tema_id: "s1", data: "2026-11-18", etapa: "aquecimento", tema: "Contagem", gancho: "Faltam 10 dias", telas: ["A", "B", "C"] }] } } as Campanha;
    const story = situacaoDaPeca(comStory, storiesComoItens(comStory)[0], null);
    montarComRota(h(CampanhaPecas, { campanha: comStory, pecas: [story], carregando: false, onAbrirArteRapida: vi.fn(), onAbrirStories: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: /Criar e abrir nos Stories/ }));
    await waitFor(() => expect(mock.stories).toHaveBeenCalled());
    const pedido = mock.stories.mock.calls[0][0];
    expect(pedido.briefing.padrao.resumo).toBe(padraoLido.resumo);
    expect(pedido.pedido).toContain(resumoDoPadraoParaAPeca(normalizarPadrao(padraoLido)));
  });
});

describe("selo pela referência, no GPT Image 2.5", () => {
  it("o modelo do selo é o GPT Image 2.5 do catálogo; sem ele, o padrão de imagem (nunca um id inventado)", () => {
    expect(MODELOS_DO_SELO[0]).toBe("openai:gpt-image-2.5-sunburst");
    const comGpt25 = catalogo.concat([{ ...catalogo[1], id: "openai:gpt-image-2.5-sunburst", modelo_api: "gpt-image-2.5-sunburst", padrao_para: [] }]);
    expect(modeloDoSelo(comGpt25)).toBe("openai:gpt-image-2.5-sunburst");
    expect(modeloDoSelo(catalogo)).toBe("openai:gpt-image-2");
    expect(modeloDoSelo([])).toBeNull();
  });

  it("gerar o selo manda o modelo escolhido e o pedido pelo padrão (o servidor anexa as referências como estilo)", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "selo_gerar") return { data: { versao: { id: "66666666-6666-4666-8666-666666666666" } }, error: null };
      return { data: {}, error: null };
    });
    await gerarSeloDaCampanha(comPadrao, "openai:gpt-image-2.5-sunburst");
    const corpo = chamadas("agente-calendario", "selo_gerar")[0];
    expect(corpo.modelo_id).toBe("openai:gpt-image-2.5-sunburst");
    expect(corpo.pedido).toBe(pedidoDoSeloPeloPadrao(normalizarPadrao(padraoLido)));
    expect(corpo.pedido).toContain("Selo circular com borda neon");
    expect(corpo.pedido).toContain("não copie textos, logos nem marcas");
  });
});
