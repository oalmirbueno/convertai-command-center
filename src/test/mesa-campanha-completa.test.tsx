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

describe("semente do Mês vira campanha", () => {
  it("hype com data: aquecimento de 14 dias antes, fecha um dia depois; trending sozinho: agora + 7", () => {
    const c = campanhaDaSemente(semente, "2026-10-21");
    expect(c.titulo).toBe("Black Friday + 1 tema");
    expect(c.inicio).toBe("2026-11-13");
    expect(c.fim).toBe("2026-11-28");
    expect(c.pedido).toContain("Black Friday com 30% no plano anual");
    expect(c.pedido).toContain("Em alta: Compras parceladas em alta (G1, 2026-10-20)");
    expect(c.briefing.mensagem_central).toBe("Oferta única do ano no plano anual");
    expect(c.hype.titulo).toBe("Black Friday + 1 tema");
    const so = campanhaDaSemente({ hypes: [], trends: [semente.trends[0]], criada_em: "x" }, "2026-10-21");
    expect([so.inicio, so.fim]).toEqual(["2026-10-21", "2026-10-28"]);
  });

  it("sugere quando começar e entende datas em vários formatos", () => {
    expect(sugestoesDaSemente(semente, "2026-10-21")[0]).toBe("Black Friday em 37 dias: comece o aquecimento dia 13/11.");
    expect(datasDoQuando("24/11 a 01/12", "2026-10-21")).toEqual(["2026-11-24", "2026-12-01"]);
    expect(datasDoQuando("05/01", "2026-10-21")).toEqual(["2027-01-05"]);
    expect(datasDoQuando("2026-11-27", "2026-10-21")).toEqual(["2026-11-27"]);
  });

  it("a aba Campanhas lê a semente uma vez e a campanha nova nasce preenchida (nome, período, pedido, briefing)", async () => {
    guardarSementeDaCampanha(CLIENTE, semente);
    montar(h(AbaCampanhas, {}));
    const nome = (await screen.findByLabelText("Nome da campanha")) as HTMLInputElement;
    expect(nome.value).toBe("Black Friday + 1 tema");
    expect((screen.getByLabelText("Pedido da campanha") as HTMLTextAreaElement).value).toContain("Data/evento: Black Friday (27/11)");
    expect(screen.getByRole("list", { name: "Sugestões do Mês" })).toBeTruthy();
    const hoje = hojeIso();
    // 22/10/2026: o início sai da linha do tempo (data do evento e dias antes); a prévia mostra a data.
    const inicio = (document.querySelector("[data-inicio]") as HTMLElement).getAttribute("data-inicio") as string;
    expect(inicio >= hoje).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Criar campanha/ }));
    await waitFor(() => expect(chamadas("agente-calendario", "campanha_criar").length).toBe(1));
    const corpo = chamadas("agente-calendario", "campanha_criar")[0];
    expect(corpo).toMatchObject({ nome: "Black Friday + 1 tema", periodo_inicio: inicio, briefing: { mensagem_central: "Oferta única do ano no plano anual" } });
    expect(corpo.hype.titulo).toBe("Black Friday + 1 tema");
    // Lida uma vez: não volta ao remontar.
    expect(window.sessionStorage.getItem(`mesa:semente-da-campanha:${CLIENTE}`)).toBeNull();
  });
});

describe("Gerar campanha completa", () => {
  it("mostra o custo TOTAL antes, gasta só no segundo clique e roda campanha, selo e peças pelo Estúdio", async () => {
    guardarSementeDaCampanha(CLIENTE, semente);
    montar(h(AbaCampanhas, {}));
    const botao = await screen.findByRole("button", { name: /Gerar campanha completa/ });
    expect(botao.textContent).toMatch(/~US\$/);
    // A mistura sugerida para ~15 dias: 3 posts (1 lâmina), 3 carrosséis (5 lâminas), 4 stories e 2 vídeos (roteiro na série).
    expect(botao.getAttribute("title")).toMatch(/selo, 6 peças, 4 sequências de stories, 18 lâminas/);
    fireEvent.click(botao);
    expect(await screen.findByText(/Clique de novo para confirmar/)).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
    // O segundo clique colado ao primeiro (duplo clique) não confirma: espera o respiro do botão.
    await new Promise((ok) => setTimeout(ok, 450));
    fireEvent.click(screen.getByRole("button", { name: /Clique de novo para confirmar/ }));
    await waitFor(() => expect(chamadas("estudio-arte", "rapida_preparar").length).toBe(3), { timeout: 5000 });
    expect(chamadas("agente-calendario", "campanha_criar").length).toBe(1);
    expect(chamadas("agente-calendario", "selo_gerar").length).toBe(1);
    expect(chamadas("agente-calendario", "selo_escolher")[0]).toMatchObject({ campanha_id: CAMPANHA_ID, selo_id: "66666666-6666-4666-8666-666666666666" });
    const pecas = chamadas("estudio-arte", "rapida_preparar");
    expect(pecas.map((p) => p.peca_da_campanha.tema_id)).toEqual(["c1", "c2", "c3"]);
    expect(pecas[0]).toMatchObject({ campanha_id: CAMPANHA_ID, peca: "carrossel", laminas: 3, fidelidade: "criativo" });
    await waitFor(() => expect(chamadas("estudio-arte", "enfileirar").length).toBe(3));
  });

  it("falha numa peça não perde as outras; pausar segura e continuar segue; cancelar pula o resto", async () => {
    const ordem: string[] = [];
    let soltar: () => void = () => {};
    const deps: DepsDaExecucao = {
      criarCampanha: async () => ({ campanhaId: "c", passos: [] }),
      gerarSelo: async () => {
        ordem.push("selo");
      },
      prepararPeca: async (_c, p) => {
        ordem.push(p.id);
        if (p.id === "p2") throw new Error("O diretor não respondeu.");
        if (p.id === "p3") await new Promise<void>((ok) => { soltar = ok; });
      },
      gerarPeca: async () => {},
    };
    const passos = [
      { id: "selo", tipo: "selo" as const, rotulo: "Selo", laminas: 0 },
      { id: "p1", tipo: "preparar" as const, rotulo: "1", temaId: "c1", laminas: 1 },
      { id: "p2", tipo: "preparar" as const, rotulo: "2", temaId: "c2", laminas: 1 },
      { id: "p3", tipo: "preparar" as const, rotulo: "3", temaId: "c3", laminas: 1 },
      { id: "p4", tipo: "preparar" as const, rotulo: "4", temaId: "c4", laminas: 1 },
      { id: "p5", tipo: "preparar" as const, rotulo: "5", temaId: "c5", laminas: 1 },
    ];
    const rodando = executarCampanha("k", "c", passos, deps);
    await waitFor(() => expect(ordem).toContain("p3"));
    pausar("k");
    soltar();
    await new Promise((ok) => setTimeout(ok, 20));
    // Pausada: o passo em curso termina, o próximo espera.
    expect(ordem).not.toContain("p4");
    continuar("k");
    await waitFor(() => expect(ordem).toContain("p4"));
    const fim = await rodando;
    expect(fim.situacao).toBe("concluida");
    expect(fim.passos.filter((p) => p.situacao === "erro").map((p) => p.id)).toEqual(["p2"]);
    expect(fim.passos.filter((p) => p.situacao === "feito").map((p) => p.id)).toEqual(["selo", "p1", "p3", "p4", "p5"]);

    limparExecucoes();
    const cancelaveis: DepsDaExecucao = { ...deps, prepararPeca: async (_c, p) => { ordem.push(`x-${p.id}`); if (p.id === "p1") cancelar("k2"); } };
    const r = await executarCampanha("k2", "c", passos.slice(1), cancelaveis);
    expect(r.situacao).toBe("cancelada");
    expect(r.passos.filter((p) => p.situacao === "pulado").length).toBe(4);
  });

  it("reabrir a campanha continua de onde parou: só o que falta (peça nova, lâminas que faltam), nada do que está pronto", () => {
    const comArte = (id: string, temaId: string, ordens: number[], feitas: number[]): TrabalhoDaPeca => ({
      id,
      status: "pronto",
      direcao: { cards: ordens.map((o) => ({ ordem: o })), arte_rapida: { pedido: "x", titulo: "x", peca: "carrossel", campanha_id: CAMPANHA_ID, peca_da_campanha: { campanha_id: CAMPANHA_ID, tema_id: temaId }, arquivos: [] } },
      cards: feitas.map((o) => ({ ordem: o, versao: 1, storage_path: `${id}/${o}.png` })),
    });
    const trabalhos = [comArte("t1", "c1", [1, 2, 3], [1]), comArte("t2", "c2", [1], [1])];
    const pecas = itens.map((it) => situacaoDaPeca(campanha, it, trabalhoDaPeca(trabalhos, it)));
    expect(pecas.map((p) => p.estado)).toEqual(["a_gerar", "pronta", "a_fazer"]);
    const passos = passosQueFaltam({ temCampanha: true, temSelo: true, pecas });
    expect(passos.map((p) => [p.tipo, p.temaId, p.ordens || null])).toEqual([
      ["gerar", "c1", [2, 3]],
      ["preparar", "c3", null],
    ]);
    // Sem o selo, ele entra primeiro.
    expect(passosQueFaltam({ temCampanha: false, temSelo: false, pecas: [], quantidadePrevista: 2 }).map((p) => p.tipo)).toEqual(["campanha", "selo", "preparar", "preparar"]);
  });
});

describe("regra sem colagem", () => {
  it("a foto real vai só como referência inteira ao gerador; o pedido leva a regra; colagem é detectada", () => {
    const comPlano = {
      ...campanha,
      plano_imagens: { pecas: [{ tema_id: "c1", ordem: 1, imagem_id: FOTO_KIT, candidatas: [], uso: "elemento", por_que: "", escolha: "estrategista", confianca: null, aviso: null }] },
    } as unknown as Campanha;
    const arquivos = arquivosDaPeca(comPlano, itens[0]);
    expect(arquivos).toEqual([{ imagem_id: FOTO_KIT, nome: "Foto da campanha 1", papel: "referencia" }]);
    expect(semColagem(arquivos)).toBe(true);
    expect(semColagem([{ papel: "foto" }])).toBe(false);
    expect(semColagem([{ papel: "logo" }])).toBe(false);
    const corpo = corpoDaPeca({ clientId: CLIENTE, campanha: comPlano, item: itens[0], posicao: { i: 1, total: 3 }, marcaId: null, modeloImagemId: "openai:gpt-image-2" });
    expect((corpo.arquivos as { papel: string }[]).every((a) => a.papel === "referencia")).toBe(true);
    expect(String(corpo.pedido)).toContain(REGRA_SEM_COLAGEM);
    // Pedido enorme: a regra nunca é a parte cortada.
    const longo = pedidoDaPeca(campanha, { ...itens[0], cards: Array.from({ length: 10 }, (_, i) => ({ ordem: i + 1, texto: "x".repeat(400) })) }, { i: 1, total: 3 });
    expect(longo.length).toBeLessThanOrEqual(3000);
    expect(longo.endsWith(REGRA_SEM_COLAGEM)).toBe(true);
    expect(versaoComColagem({ modo: "foto_composta" })).toBe(true);
    expect(versaoComColagem({ template_profile: {} })).toBe(true);
    expect(versaoComColagem({ modo: "normal" })).toBe(false);
  });

  it("a fase sai da etapa do estrategista e, sem palavra conhecida, da data na janela", () => {
    expect(faseDaPeca({ etapa: "Último chamado" }, null, null)).toBe("encerramento");
    expect(faseDaPeca({ etapa: "Urgência" }, null, null)).toBe("urgencia");
    expect(faseDaPeca({ etapa: "prova social" }, null, null)).toBe("lancamento");
    const ini = "2026-11-01";
    const fim = somarDiasIso(ini, 20);
    expect(faseDaPeca({ etapa: "", data: "2026-11-02" }, ini, fim)).toBe("aquecimento");
    expect(faseDaPeca({ etapa: "", data: "2026-11-20" }, ini, fim)).toBe("encerramento");
  });
});

describe("conferência da série pelo Jev (servidor, puro)", () => {
  it("um Score por peça e um Choice do melhor gancho; a leitura vira nota, nível e o tema do gancho", async () => {
    const { perguntasDaConferencia, lerConferencia } = await import("../../supabase/functions/agente-calendario/modulos/conferencia-da-campanha");
    const p = perguntasDaConferencia(
      { nome: "BF", briefing: { oferta: "30%" } },
      [
        { tema_id: "c1", gancho: "Guarde a data" },
        { tema_id: "c2", gancho: "30% hoje" },
      ],
    );
    // 22/10/2026: mais um Score por peça para o tom comercial (CTA de ação e oferta).
    expect(Object.keys(p.questions)).toEqual(["peca_0", "peca_1", "comercial_0", "comercial_1", "melhor_gancho"]);
    expect((p.questions.peca_0 as { type: string; criteria: string[] }).criteria.length).toBe(4);
    expect(Object.keys((p.questions.melhor_gancho as { criteria: Record<string, string> }).criteria)).toEqual(["p0", "p1", "nenhum"]);
    const lida = lerConferencia({ peca_0: { score: 3, confidence: 0.9 }, peca_1: { score: 1 }, melhor_gancho: { choice: "p1", confidence: 0.7 } }, p.pecas);
    expect(lida.pecas.map((x) => x.nivel)).toEqual(["forte", "fraca"]);
    expect(lida.melhor_gancho).toBe("c2");
    expect(lerConferencia({ melhor_gancho: { choice: "nenhum" } }, p.pecas).melhor_gancho).toBeNull();
  });
});

describe("conflito com a agenda", () => {
  it("avisa o dia cheio e sugere o dia livre mais perto dentro da janela, contando a própria série", async () => {
    const { conflitosDaSerie } = await import("@/components/mesa/regrasDaCampanha");
    const agenda = { ocupacao: [{ data: "2026-11-27", hora: null, hype: false }], regra: { porDia: 1, hypesPorDia: 1, horasEntre: 2, fimDeSemana: false } };
    const c = conflitosDaSerie(
      [
        { tema_id: "a", data: "2026-11-27", formato: "estatico" },
        { tema_id: "b", data: "2026-11-26", formato: "estatico" },
      ],
      agenda,
      "2026-10-21",
      { inicio: "2026-11-13", fim: "2026-11-28" },
    );
    expect(c.map((x) => x.temaId)).toEqual(["a"]);
    expect(c[0].aviso).toMatch(/27\/11 já tem 1 post/);
    // 26/11 é da própria série; 28/11 é sábado; o mais perto livre é 25/11.
    expect(c[0].sugestao).toBe("2026-11-25");
  });
});

describe("nova=1 vindo do Mês", () => {
  it("abre a campanha nova mesmo sem semente; com hype antigo, segue o caminho de sempre", async () => {
    montar(h(AbaCampanhas, { novaPedida: true }));
    expect(await screen.findByLabelText("Pedido da campanha")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Sugestões do Mês" })).toBeNull();
  });
});
