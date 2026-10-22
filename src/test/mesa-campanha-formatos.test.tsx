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
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
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
vi.mock("@/components/mesa/stories/storiesApi", () => ({ gerarStoriesDaCampanha: mock.stories }));
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

import { SeletorDeFormatos, distribuirPorFase } from "@/components/mesa/CampanhaFormatos";
import { contarFormatos, formatosQueFaltam, normalizarFormatos, pecaDeStory, storiesComoItens, sugerirFormatos } from "@/components/mesa/regrasDaCampanha";
import { corpoDaCampanha } from "@/components/mesa/mesaV4Api";
import { geradorDeStoriesDisponivel, gerarStoryDaCampanha } from "@/components/mesa/campanhasApi";

// Formatos da campanha (21/10/2026, rodada 2): seletor de posts, carrosséis, stories e vídeos; a série respeita
// a mistura; o story vai pela aba Stories (contrato gerarStoriesDaCampanha); a campanha nova em 3 passos.

const comStories = (): Campanha =>
  ({
    ...campanha,
    briefing: { ...(campanha.briefing as object), stories: [{ tema_id: "s1", data: "2026-11-18", etapa: "aquecimento", tema: "Contagem", gancho: "Faltam 10 dias", telas: ["A", "B", "C"] }] },
  }) as Campanha;

describe("seletor de formatos", () => {
  it("cartões com stepper: mais e menos mudam a mistura, a sugestão volta pela duração", () => {
    const mudou = vi.fn();
    montar(h(SeletorDeFormatos, { valor: { posts: 1, carrosseis: 0, stories: 0, videos: 0 }, onChange: mudou, dias: 15 }));
    const cartoes = screen.getByRole("list", { name: "Formatos da campanha" });
    expect(cartoes.querySelectorAll("[data-formato]").length).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Mais vídeos e reels" }));
    expect(mudou).toHaveBeenLastCalledWith({ posts: 1, carrosseis: 0, stories: 0, videos: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Menos posts" }));
    expect(mudou).toHaveBeenLastCalledWith({ posts: 0, carrosseis: 0, stories: 0, videos: 0 });
    expect((screen.getByRole("button", { name: "Menos carrosséis" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Usar a sugestão" }));
    expect(mudou).toHaveBeenLastCalledWith(sugerirFormatos(15));
  });

  it("a sugestão cresce com a duração e a série de feed cabe em 12", () => {
    expect(sugerirFormatos(5)).toEqual({ posts: 2, carrosseis: 1, stories: 2, videos: 1 });
    expect(sugerirFormatos(45).stories).toBe(6);
    expect(normalizarFormatos({ posts: 8, carrosseis: 8, stories: 9, videos: 2 })).toEqual({ posts: 2, carrosseis: 8, stories: 8, videos: 2 });
    expect(normalizarFormatos({ posts: 0 })).toBeNull();
    const fases = distribuirPorFase({ posts: 4, carrosseis: 0, stories: 0, videos: 0 });
    expect(Object.keys(fases).map((k) => fases[k].posts).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe("série respeitando a mistura", () => {
  it("o corpo leva a mistura; contagem e falta por formato; vídeo é roteiro pronto e story vai para a aba Stories", () => {
    const corpo = corpoDaCampanha({ clientId: CLIENTE, pedido: "x", formatos: { posts: 2, carrosseis: 1, stories: 2, videos: 1 } });
    expect(corpo.formatos).toEqual({ posts: 2, carrosseis: 1, stories: 2, videos: 1 });
    const c = comStories();
    const serie = itens.concat([{ tema_id: "c9", data: "2026-11-25", formato: "video", tema: "Reels", gancho: "Bastidor" }]).concat(storiesComoItens(c));
    const pecas = serie.map((it) => situacaoDaPeca(c, it, null));
    expect(contarFormatos(pecas)).toEqual({ posts: 2, carrosseis: 1, stories: 1, videos: 1 });
    expect(formatosQueFaltam({ posts: 2, carrosseis: 2, stories: 2, videos: 1 }, contarFormatos(pecas))).toEqual({ posts: 0, carrosseis: 1, stories: 1, videos: 0 });
    expect(pecas.filter((p) => p.item.formato === "video")[0].estado).toBe("roteiro_pronto");
    expect(pecas.filter((p) => p.item.formato === "story")[0].estado).toBe("a_fazer");
    expect(passosQueFaltam({ temCampanha: true, temSelo: true, pecas }).map((p) => p.tipo)).toEqual(["preparar", "preparar", "preparar", "story"]);
    // Campanha nova: a mistura vira os passos (posts com 1 lâmina, carrosséis com 5, stories com 3 telas; vídeo sai na série).
    const nova = passosQueFaltam({ temCampanha: false, temSelo: false, pecas: [], formatos: { posts: 1, carrosseis: 1, stories: 1, videos: 2 } });
    expect(nova.map((p) => [p.tipo, p.laminas])).toEqual([["campanha", 0], ["selo", 0], ["preparar", 1], ["preparar", 5], ["story", 3]]);
  });
});

describe("story pelo contrato com a aba Stories", () => {
  it("chama gerarStoriesDaCampanha com o contrato e marca a sequência no briefing da campanha", async () => {
    mock.stories.mockResolvedValue({ sequencia_id: "seq-1" });
    expect(geradorDeStoriesDisponivel()).toBe(true);
    const c = comStories();
    const item = storiesComoItens(c)[0];
    expect(pecaDeStory(c, item)).toEqual({ campanha_id: CAMPANHA_ID, tema_id: "s1", formato: "story", fase: "aquecimento", data: "2026-11-18" });
    await gerarStoryDaCampanha(c, { clientId: CLIENTE, campanhaId: CAMPANHA_ID, temaId: "s1", briefing: c.briefing as any, identidade: c.identidade, fase: "aquecimento", quantidadeDeTelas: 3 });
    expect(mock.stories).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENTE, campanhaId: CAMPANHA_ID, temaId: "s1", fase: "aquecimento", quantidadeDeTelas: 3 }));
    const salvo = chamadas("agente-calendario", "campanha_salvar")[0];
    expect(salvo.briefing.stories[0]).toMatchObject({ tema_id: "s1", sequencia_id: "seq-1" });
    const depois = { ...c, briefing: salvo.briefing } as Campanha;
    expect(situacaoDaPeca(depois, storiesComoItens(depois)[0], null).estado).toBe("pronta");
  });
});

describe("campanha nova em 3 passos", () => {
  it("O que é, Formatos e Gerar, com a prévia ao lado e o avançado recolhido", async () => {
    montar(h(AbaCampanhas, { novaPedida: true }));
    const passos = await screen.findByRole("navigation", { name: "Passos da campanha nova" });
    expect(passos.querySelectorAll("[data-etapa]").length).toBe(3);
    expect(screen.getByLabelText("Pedido da campanha")).toBeTruthy();
    expect(screen.getByLabelText("Prévia da campanha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("list", { name: "Formatos da campanha" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mais stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText(/Campanha completa:/)).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Tipo da campanha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
    expect(screen.getByRole("radiogroup", { name: "Tipo da campanha" })).toBeTruthy();
    // Os botões de gerar ficam à mão em qualquer passo.
    expect(screen.getByRole("button", { name: /Gerar campanha completa/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Criar campanha/ })).toBeTruthy();
  });
});
