import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agente de roteiro unificado da peça de vídeo (23/10/2026). O dono: "pode juntar os dois em um só, e teste
 * completo": um único agente, agêntico, que conversa, dá ideias e altera o roteiro de verdade; escolha de
 * modelo; Gerar (IA) ou Gravar (o roteiro certinho do tema para baixar). Antes eram dois (aba Roteiro com o
 * roteiro no item e aba Gravar com a tabela roteiros). Agora: um roteiro (tabela roteiros), sempre à vista,
 * o agente ao lado e o seletor só com Gravar e Gerar. Banco e função simulados; no fim, o contrato do servidor.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  montarPdf: vi.fn(),
  baixarBytes: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-roteiros/pdfNoNavegador", () => ({
  itemSolto: (r: unknown) => ({ roteiro: r, versao: 1, hash: "h", status: "rascunho" }),
  itemDoPdf: (l: any) => ({ roteiro: l.versoes[l.versoes.length - 1].conteudo, versao: l.versao_atual, hash: "h", status: l.status }),
  montarPdf: (...a: unknown[]) => {
    mock.montarPdf(...a);
    return { bytes: new Uint8Array([37, 80, 68, 70]), nome: "roteiros-cliente-teste.pdf" };
  },
  baixarBytes: (...a: unknown[]) => mock.baixarBytes(...a),
}));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, usePedidos: () => ({ data: { itens: [], disponivel: true } }) };
});
// O Gerar tem teste próprio (campanha-gerar-video); aqui só importa que recebe o MESMO roteiro da peça.
vi.mock("@/components/mesa/GerarVideoDaCampanha", () => ({ default: (p: { item: { tema: string }; roteiroId?: string | null }) => h("div", { "data-testid": "gerar-video" }, `Gerar ${p.item.tema} com ${p.roteiroId || "sem roteiro"}`) }));
// O seletor de modelo da casa é um Select do Radix; aqui um select simples com o mesmo contrato (valor e onChange).
vi.mock("@/components/mesa/Seletores", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    SeletorDeModelo: (p: { catalogo: Array<{ id: string; rotulo: string; tipo: string }>; valor: string; onChange: (v: string) => void; rotulo?: string }) =>
      h("select", { "aria-label": p.rotulo, value: p.valor, onChange: (e: any) => p.onChange(e.target.value) }, p.catalogo.filter((m) => m.tipo === "texto").map((m) => h("option", { key: m.id, value: m.id }, m.rotulo))),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaVideos from "@/components/mesa/CampanhaVideos";
import GravarDaPauta from "@/components/mesa/GravarDaPauta";
import { escolhaDaVersao, nomeDoWord } from "@/components/mesa/roteiroDaPeca";
import { partesDasCenasDaPeca } from "@/components/mesa-roteiros/cenasDaPeca";
import { chaves, type Campanha, type ItemProposto } from "@/components/mesa/mesaV4Api";
import { hashDoRoteiro, normalizarLinhaDoRoteiro, normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import {
  cenasDaIaPelaDuracao,
  dadosDaDirecaoCriativa,
  duracaoDoPedido,
  escolherPelaViralidade,
  ESQUEMA_DAS_CENAS_VIRAIS,
  ESQUEMA_DAS_DUAS_VERSOES,
  estadoDaEscolhaViral,
  falaDoRoteiro,
  instrucaoDasCenas,
  lerDirecaoCriativa,
  linhaDaPeca,
  pedidoDaReescrita,
  roteiroReescrito,
  tamanhoDasDuasVersoes,
  tipoDoEstilo,
  versoesAntigasDaPeca,
  versoesDaSaida,
} from "../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";
import { normalizarAcoesDosRoteiros, OPERACOES_COM_IA, regrasDosRoteiros, type RoteiroParaAcao } from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { escolherModeloDoEscopo } from "../../supabase/functions/estudio-arte/modulos/copy-viral";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CAMPANHA = "22222222-2222-4222-8222-222222222222";
const PROPOSTA = "33333333-3333-4333-8333-333333333333";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";
const MODELO = "openai/gpt-teste";
const OUTRO = "anthropic/claude-teste";

const nota = (n: number | null) => ({ gancho: n, clareza: n, nicho: n, utilidade: n, compartilhar: n, nota: n });

const CONTEUDO = {
  titulo: "Bastidor do kit de inverno",
  subtitulo: "O que vem no kit",
  tipo: "fala_camera",
  duracao_alvo_s: 30,
  ganchos: [{ texto: "Você está jogando dinheiro fora no inverno", mecanismo: "erro", promessa: "mostrar o kit", motivo: "" }],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Gancho", fala: "Você está jogando dinheiro fora no inverno", segundos: 4, visual: "Close na etiqueta", texto_na_tela: "Erro de inverno", broll: "" },
    { id: "b2", funcao: "Virada", fala: "Três peças por um preço só", segundos: 8, visual: "Peças na mesa", texto_na_tela: "Kit inverno", broll: "" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Loja", figurino: "", objetos: "", luz: "Janela", camera: "Celular", orientacoes: [] },
  broll: [],
  cta: "Chama no direct",
  legenda: "O kit chegou",
  hashtags: ["inverno"],
  pendencias: [],
  sugestoes: ["Abra com a etiqueta rasgando"],
};

const versao = (numero: number, conteudo: unknown, notaDaVersao: string) => ({ numero, origem: "ia", conteudo, nota: notaDaVersao, criado_em: "2026-10-23T10:00:00Z", custo_usd: 0.05 });

const linhaComDuas = () => ({
  id: ROTEIRO,
  client_id: CLIENTE,
  task_id: null,
  proposta_id: PROPOSTA,
  campanha_id: CAMPANHA,
  titulo: "Bastidor do kit de inverno",
  tipo: "fala_camera",
  status: "rascunho",
  versao_atual: 2,
  versao_aprovada: null,
  versoes: [
    versao(1, { ...CONTEUDO, sugestoes: [], ganchos: [{ texto: "Sabe o que vem no kit?", mecanismo: "curiosidade", promessa: "", motivo: "" }] }, "Versão 1 (o Jev escolheu a outra): gancho de curiosidade"),
    versao(2, CONTEUDO, "Escolhida pelo Jev. Versão 2 (gancho de erro), viral 78 contra 64."),
  ],
  comentarios: [],
  custo_usd: 0.05,
  criado_em: "2026-10-23T10:00:00Z",
  atualizado_em: "2026-10-23T10:00:00Z",
});

const campanha = {
  id: CAMPANHA, client_id: CLIENTE, nome: "Black Friday da loja", pedido: "BF", objetivo: "Vender o kit", periodo_inicio: "2026-11-01", periodo_fim: "2026-11-28",
  conceito: null, identidade: null, referencias_ids: null, selo_path: null, proposta_id: PROPOSTA, status: "ativa", custo_usd: 0, criado_em: "2026-10-20T10:00:00Z",
  briefing: { oferta: "Kit inverno com 30% de desconto", publico: "Mães de Curitiba" },
} as unknown as Campanha;

const item = { tema_id: "t-video-1", tema: "Bastidor do kit de inverno", data: "2026-11-10", formato: "video", etapa: "sustentacao", gancho: "Você sabe o que vem no kit?", cta: "Chama no direct", task_id: null, cards: [] } as unknown as ItemProposto;

const CATALOGO = [
  { id: MODELO, nome: "Modelo de teste", rotulo: "Modelo de teste", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, padrao_para: ["estrategista"] },
  { id: OUTRO, nome: "Outro modelo", rotulo: "Outro modelo", tipo: "texto", provedor: "anthropic", ativo: true, preco_entrada_1m: 5, preco_saida_1m: 25, padrao_para: ["copy"] },
];

let respostas: Record<string, unknown> = {};
const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-roteiros" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
const ordemDasAcoes = () => mock.invoke.mock.calls.map((c: any[]) => (c[1] && c[1].body ? c[1].body.acao : ""));

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  respostas = { estimar: { estimativa_usd: 0.08, modelo_id: MODELO, custo_usd: 0 }, agente_historico: { conversa_id: null, mensagens: [], custo_usd: 0 } };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: null, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (acao === "peca_gerar" && respostas.peca_gerar) mock.tabelas.roteiros = [linhaComDuas()];
    const r = respostas[acao];
    if (typeof r === "function") return { data: (r as (b: unknown) => unknown)(opcoes.body), error: null };
    if (r !== undefined) return { data: r, error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

function mesa(): MesaValor {
  return {
    clientId: CLIENTE, clientName: "Cliente Teste", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
    catalogo: CATALOGO, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as unknown as MesaValor;
}

/** A peça de vídeo dentro da campanha (a tela de verdade: CampanhaVideos). */
function montarPeca(peca: ItemProposto = item) {
  const proposta = { id: PROPOSTA, client_id: CLIENTE, project_id: "p", periodo_inicio: "2026-11-01", periodo_fim: "2026-11-28", itens: [peca], status: "pronta", task_ids: [] };
  mock.tabelas.calendario_propostas = [proposta];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(chaves.proposta(PROPOSTA), proposta);
  render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: h(CampanhaVideos, { campanha }) })))));
  return qc;
}

/** Custo antes: o primeiro clique mostra o custo (ou roda direto, se for centavos); o segundo confirma. */
const confirmarCusto = async (botao: HTMLElement, acao: string) => {
  fireEvent.click(botao);
  await new Promise((r) => setTimeout(r, 400));
  if (!chamadasDe(acao).length) fireEvent.click(botao);
};

// ------------------------------------------------------------------ puro

describe("roteiro da peça: duas versões e o Jev escolhe (puro)", () => {
  it("a maior nota viral fica; aviso da casa perde para a versão limpa; sem o Jev, a regra; uma só, sem escolha", () => {
    const e = escolherPelaViralidade([nota(6.4), nota(7.8)], [false, false], ["curiosidade", "erro"]);
    expect(e.indice).toBe(1);
    expect(e.como).toBe("jev");
    expect(e.porque).toMatch(/^Versão 2 \(gancho de erro\), viral 7,8 contra 6,4\./);
    const comAviso = escolherPelaViralidade([nota(6), nota(9)], [false, true]);
    expect(comAviso.indice).toBe(0);
    expect(comAviso.porque).toContain("A outra tinha aviso da conferência da casa.");
    const semJev = escolherPelaViralidade([nota(null), nota(null)], [true, false]);
    expect(semJev).toEqual(expect.objectContaining({ indice: 1, como: "regra" }));
    expect(escolherPelaViralidade([nota(5)], [false]).como).toBe("unica");
    // Empate fica com a versão 1.
    expect(escolherPelaViralidade([nota(7), nota(7)], [false, false]).indice).toBe(0);
  });

  it("a duração do pedido ao agente: 15 s, segundos, minuto e minuto com segundos; sem duração, null; entre 10 e 300", () => {
    expect(duracaoDoPedido("faz versão de 15 s")).toBe(15);
    expect(duracaoDoPedido("deixa com 30 segundos")).toBe(30);
    expect(duracaoDoPedido("um roteiro de 1 minuto")).toBe(60);
    expect(duracaoDoPedido("1min30")).toBe(90);
    expect(duracaoDoPedido("encurta o gancho")).toBeNull();
    expect(duracaoDoPedido("versão de 5s")).toBe(10);
    expect(pedidoDaReescrita("  ")).toBeNull();
    expect(pedidoDaReescrita("troca a cena 2 por um antes e depois")).toBe("troca a cena 2 por um antes e depois");
  });

  it("as versões da saída (até 2, com a fórmula), o estado do Jev e a fala que ele lê", () => {
    const vs = versoesDaSaida({ versoes: [{ titulo: "A", formula_do_gancho: "erro" }, { titulo: "B" }, { titulo: "C" }] });
    expect(vs.map((v) => v.formula)).toEqual(["erro", ""]);
    expect(versoesDaSaida(null)).toEqual([]);
    const fala = falaDoRoteiro(normalizarRoteiro(CONTEUDO));
    expect(fala).toContain("Gancho: Você está jogando dinheiro fora no inverno");
    expect(fala).toContain("2. Virada: Três peças por um preço só [tela: Kit inverno]");
    expect(estadoDaEscolhaViral(["a", "b"], { nicho: "moda", publico: null })).toEqual({ copies: { c0: "a", c1: "b" }, nicho: "moda", publico: "o público da marca" });
    // O esquema das duas versões é o do roteirista mais a fórmula do gancho (a das cenas também).
    const item2 = (ESQUEMA_DAS_DUAS_VERSOES.schema.properties.versoes as any).items;
    expect(item2.required).toEqual(expect.arrayContaining(["ganchos", "blocos", "cta", "formula_do_gancho"]));
    expect((ESQUEMA_DAS_CENAS_VIRAIS.schema.properties.versoes as any).items.required).toEqual(expect.arrayContaining(["gancho", "cenas", "formula_do_gancho"]));
  });

  it("o roteiro reescrito guarda título, tipo e base do atual e muda a duração pedida", () => {
    const atual = { ...normalizarRoteiro(CONTEUDO), base: { id: "casa-x", nome: "Erro comum", objetivo: "autoridade", origem: "casa", como: "jev", confianca: null, alternativas: [] } } as any;
    const novo = roteiroReescrito({ ...normalizarRoteiro({ ...CONTEUDO, titulo: "Outro título" }), tipo: "ugc" } as any, atual, 15);
    expect(novo.titulo).toBe("Bastidor do kit de inverno");
    expect(novo.tipo).toBe("fala_camera");
    expect(novo.duracao_alvo_s).toBe(15);
    expect(novo.base!.id).toBe("casa-x");
    expect(roteiroReescrito(normalizarRoteiro(CONTEUDO), atual, null).duracao_alvo_s).toBe(30);
  });

  it("o escopo roteiro segue o padrão do estrategista e lembra o escolhido", () => {
    expect(escolherModeloDoEscopo(CATALOGO as any, "", "roteiro").modelo!.id).toBe(MODELO);
    expect(escolherModeloDoEscopo(CATALOGO as any, OUTRO, "roteiro")).toEqual(expect.objectContaining({ motivo: "escolhido" }));
    expect(partesDasCenasDaPeca(CATALOGO as any, OUTRO)[0].modeloId).toBe(OUTRO);
    expect(partesDasCenasDaPeca(CATALOGO as any, null)[0].modeloId).toBe(MODELO);
  });
});

describe("agente de roteiro: reescrever_roteiro (contrato das ações)", () => {
  const roteiros: RoteiroParaAcao[] = [
    { id: ROTEIRO, titulo: "Bastidor do kit", tipo: "fala_camera", status: "rascunho", versao_atual: 2, arquivado: false },
    { id: "66666666-6666-4666-8666-666666666666", titulo: "Já gravado", tipo: "fala_camera", status: "gravado", versao_atual: 1, arquivado: false },
  ];

  it("o pedido livre vira item no roteiro r1 com custo no cartão; IA pede Confirmar; gravado é recusado", () => {
    expect(OPERACOES_COM_IA).toContain("reescrever_roteiro");
    const a = normalizarAcoesDosRoteiros({ resumo: "Trocar a cena 2", itens: [{ operacao: "reescrever_roteiro", ref: "r1", para: "troca a cena 2 por um antes e depois" }, { operacao: "reescrever_roteiro", ref: "r2", para: "versão de 15 s" }] }, roteiros, [], CLIENTE, 0.03)!;
    expect(a.itens).toHaveLength(1);
    expect(a.itens[0]).toEqual(expect.objectContaining({ alvo_id: ROTEIRO, operacao: "reescrever_roteiro", para: "troca a cena 2 por um antes e depois" }));
    expect(a.recusados[0].motivo).toMatch(/já gravado/);
    expect(a.custo_estimado_usd).toBe(0.03);
    expect(podeExecutarDireto(a, regrasDosRoteiros(), { pedidoClaro: true }).direto).toBe(false);
    // Pedido vazio não vira cartão.
    const vazio = normalizarAcoesDosRoteiros({ resumo: "", itens: [{ operacao: "reescrever_roteiro", ref: "r1", para: " " }] }, roteiros, [], CLIENTE, 0.03);
    expect(vazio ? vazio.itens : []).toHaveLength(0);
  });
});

describe("agente unificado: direção criativa, roteiro antigo do item e qual roteiro é o da peça (puro)", () => {
  it("o estilo diz o tipo do roteiro; a direção criativa vai aos dados com a ideia, a criatividade e o tamanho", () => {
    expect(tipoDoEstilo("cinematografico")).toBe("cinema");
    expect(tipoDoEstilo("tutorial")).toBe("tutorial");
    expect(tipoDoEstilo("depoimento")).toBe("ugc");
    expect(tipoDoEstilo("humor")).toBe("fala_camera");
    expect(tipoDoEstilo("inventado")).toBe("fala_camera");
    expect(lerDirecaoCriativa({})).toBeNull();
    const d = lerDirecaoCriativa({ ideia: "  PC   com poeira ", estilo: "humor", criatividade: "nada" })!;
    expect(d).toEqual({ ideia: "PC com poeira", estilo: "humor", criatividade: "ultra" });
    const dados = dadosDaDirecaoCriativa(d, 300);
    expect(dados.ideia_da_equipe).toBe("PC com poeira");
    expect(dados.estilo).toMatch(/^Humor\. Esquete curta/);
    expect(dados.criatividade).toMatch(/^Ultra\. Ultra criatividade/);
    expect(dados.tamanho).toMatch(/^5 min no total \(300 s somando os blocos\), em cerca de 14 blocos \(no máximo 14\)/);
    expect(dadosDaDirecaoCriativa({ ideia: "", estilo: "viral", criatividade: "segura" }, 15).ideia_da_equipe).toMatch(/sem ideia/);
  });

  it("o tamanho das duas versões cresce com a duração (30 s igual ao de sempre, 5 min perto de 16 mil) e as cenas de IA acompanham", () => {
    expect(tamanhoDasDuasVersoes(30)).toEqual({ entrada: 18_000, saida: 9_000 });
    expect(tamanhoDasDuasVersoes(15).saida).toBe(9_000);
    expect(tamanhoDasDuasVersoes(300).saida).toBe(15_750);
    expect(tamanhoDasDuasVersoes(9999).saida).toBe(15_750);
    expect(cenasDaIaPelaDuracao(30)).toEqual({ min: 3, max: 6 });
    expect(cenasDaIaPelaDuracao(300)).toEqual({ min: 12, max: 24 });
    expect(instrucaoDasCenas({ trilha: null, duracaoS: 120 })).toContain("cenas: de 8 a 15");
    expect(instrucaoDasCenas({ trilha: null, duracaoS: 25 })).toContain("roteiro_da_peca");
  });

  it("as sugestões do roteirista ficam na versão só quando existem (o hash das versões antigas não muda)", () => {
    const semSugestao = normalizarRoteiro({ ...CONTEUDO, sugestoes: undefined });
    expect("sugestoes" in semSugestao).toBe(false);
    expect(hashDoRoteiro(semSugestao)).toBe(hashDoRoteiro(normalizarRoteiro({ ...CONTEUDO, sugestoes: [] })));
    expect(normalizarRoteiro({ ...CONTEUDO, sugestoes: ["a", "", "b", "c", "d"] }).sugestoes).toEqual(["a", "b", "c"]);
    const versao2 = (ESQUEMA_DAS_DUAS_VERSOES.schema.properties.versoes as any).items;
    expect(versao2.required).toEqual(expect.arrayContaining(["sugestoes", "formula_do_gancho"]));
    expect(versao2.properties.sugestoes).toEqual({ type: "array", items: { type: "string" } });
  });

  it("o roteiro antigo do item vira versões da tabela: as opções antes, o escolhido por último, sem repetir; sem roteiro escolhido, a recomendada fica atual", () => {
    const cena = (n: number) => ({ descricao: `Cena ${n}`, plano: "close", fala: `Fala ${n}`, texto_na_tela: "", som: "batida", segundos: 5 });
    const v = (t: string) => ({ titulo: t, conceito: `Conceito ${t}`, gancho: `Gancho ${t}`, cenas: [cena(1), cena(2)], trilha: "Suspense", cta: "Chame", sugestoes: [`Ideia ${t}`] });
    const opcoes = { versoes: [v("A"), v("B")], recomendada: 1, porque: "", ideia: "x", duracao: 15, estilo: "cinematografico", criatividade: "ultra", em: "x" };
    const comItem = versoesAntigasDaPeca({ tema: "Reels do kit", roteiro_video: v("B"), roteiro_opcoes: opcoes });
    expect(comItem.map((x) => x.nota)).toEqual(["Versão 1 do agente de roteiro", "Roteiro que estava na peça"]);
    expect(comItem[1].conteudo.titulo).toBe("Reels do kit");
    expect(comItem[1].conteudo.tipo).toBe("cinema");
    expect(comItem[1].conteudo.ganchos[0].texto).toBe("Gancho B");
    expect(comItem[1].conteudo.blocos[0].visual).toBe("Cena 1. Câmera: close");
    expect(comItem[1].conteudo.sugestoes).toEqual(["Ideia B"]);
    const soOpcoes = versoesAntigasDaPeca({ tema: "Reels do kit", roteiro_opcoes: opcoes });
    expect(soOpcoes.map((x) => [x.opcao, x.recomendada])).toEqual([[0, false], [1, true]]);
    expect(versoesAntigasDaPeca({ tema: "Sem nada" })).toEqual([]);
    expect(versoesAntigasDaPeca(null)).toEqual([]);
  });

  it("o roteiro da peça: pela tarefa; fora dela, pela campanha e o tema, mesmo depois de o agente trocar o título; arquivado não conta", () => {
    const base = normalizarLinhaDoRoteiro(linhaComDuas())!;
    const renomeado = { ...base, titulo: "Título novo pelo agente" };
    expect(linhaDaPeca([renomeado], { campanhaId: CAMPANHA, tema: "Bastidor do kit de inverno" })!.id).toBe(ROTEIRO);
    expect(linhaDaPeca([{ ...renomeado, campanha_id: "outra", proposta_id: null }], { campanhaId: CAMPANHA, tema: "Bastidor do kit de inverno" })).toBeNull();
    expect(linhaDaPeca([{ ...base, arquivado_em: "2026-10-01" }], { campanhaId: CAMPANHA, tema: "Bastidor do kit de inverno" })).toBeNull();
    expect(linhaDaPeca([base, { ...base, id: "da-tarefa", task_id: "t-1", campanha_id: null }], { taskId: "t-1", campanhaId: CAMPANHA, tema: "x" })!.id).toBe("da-tarefa");
  });
});

// ------------------------------------------------------------------ tela: a peça de vídeo com um só agente

describe("peça de vídeo com um só agente de roteiro (tela)", () => {
  it("um só agente e Gravar por padrão; cria com ideia, duração, estilo e criatividade; 2 versões, o Jev escolhe e a outra pode ser usada", async () => {
    respostas.peca_gerar = { roteiro: linhaComDuas(), versao: { numero: 2 }, escolha: { indice: 1, como: "jev" }, alternativa: 1, custo_usd: 0.08, saldo_usd: 10 };
    respostas.versao_restaurar = { roteiro: { ...linhaComDuas(), versao_atual: 3, versoes: linhaComDuas().versoes.concat([versao(3, linhaComDuas().versoes[0].conteudo, "Restaurada da versão 1")]) }, custo_usd: 0 };
    montarPeca();
    // Um só agente de roteiro na peça, e o seletor só tem os caminhos.
    const agente = await screen.findByRole("region", { name: /Agente de roteiro de Bastidor do kit de inverno/ });
    expect(screen.getAllByRole("region", { name: /Agente de roteiro/ })).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Gravar", "Gerar"]);
    expect(screen.getByRole("tab", { name: /Gravar/ }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText(/Sem roteiro para gravar: crie com o agente acima\./)).toBeTruthy();
    expect(screen.getByText("Sem roteiro ainda: dê a ideia ao agente.")).toBeTruthy();
    // O criar mora no agente: ideia, duração até 5 min, estilo e criatividade.
    fireEvent.change(within(agente).getByLabelText(/Ideia do roteiro/), { target: { value: "O técnico abre a caixa e o frio some" } });
    fireEvent.click(within(agente).getByRole("button", { name: "3 min" }));
    fireEvent.click(within(agente).getByRole("button", { name: "Cinematográfico" }));
    expect(within(agente).getByRole("button", { name: /Ultra/ }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(chamadasDe("estimar").some((c) => c.acao_alvo === "peca" && c.duracao_s === 180)).toBe(true));
    const criar = within(agente).getByRole("button", { name: /Criar roteiro/ });
    await waitFor(() => expect(criar).not.toBeDisabled());
    await confirmarCusto(criar, "peca_gerar");
    await waitFor(() => expect(chamadasDe("peca_gerar")).toHaveLength(1));
    expect(chamadasDe("peca_gerar")[0]).toEqual(expect.objectContaining({
      client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "t-video-1", tema: "Bastidor do kit de inverno", modelo_id: MODELO,
      ideia: "O técnico abre a caixa e o frio some", duracao_s: 180, estilo: "cinematografico", criatividade: "ultra", tipo: "cinema",
    }));
    expect(chamadasDe("peca_gerar")[0].roteiro_id).toBeUndefined();
    expect(chamadasDe("campanha_roteiro_agente")).toHaveLength(0);
    // O roteiro fica à vista com a escolha do Jev; a conversa deste roteiro abre ao lado, sem custo.
    expect(await screen.findByText(/Jev: Versão 2 \(gancho de erro\), viral 78 contra 64\. A outra é a v1\./)).toBeTruthy();
    expect(screen.getAllByText("Você está jogando dinheiro fora no inverno").length).toBeGreaterThan(0);
    await waitFor(() => expect(chamadasDe("agente_historico")[0]).toEqual(expect.objectContaining({ escopo: "peca", roteiro_id: ROTEIRO })));
    // A sugestão do roteirista vira pedido num toque.
    fireEvent.click(await screen.findByRole("button", { name: "Abra com a etiqueta rasgando" }));
    expect((screen.getByLabelText("Pedido ao agente de roteiro") as HTMLTextAreaElement).value).toBe("Abra com a etiqueta rasgando");
    // "Usar a outra": a versão que o Jev não escolheu vira a atual, sem custo.
    fireEvent.click(screen.getByRole("button", { name: "Usar a outra" }));
    await waitFor(() => expect(chamadasDe("versao_restaurar")[0]).toEqual(expect.objectContaining({ roteiro_id: ROTEIRO, versao: 1 })));
    // O Gerar usa o mesmo roteiro da peça.
    fireEvent.click(screen.getByRole("tab", { name: /Gerar/ }));
    expect((await screen.findByTestId("gerar-video")).textContent).toBe(`Gerar Bastidor do kit de inverno com ${ROTEIRO}`);
  });

  it("a conversa grava versão nova só com Confirmar, o Desfazer volta, e a troca de modelo vale na conversa (lembrada por cliente)", async () => {
    mock.tabelas.roteiros = [linhaComDuas()];
    mock.rpc.mockImplementation(async (_nome: string, args: any) => {
      mock.tabelas.mesa_cliente_config = [{ modelo_roteiro_id: args._modelo_id }];
      return { data: args._modelo_id, error: null };
    });
    const acao = {
      tipo: "acao_agente", agente: "roteiros", id: "roteiros-1", resumo: "Reescrever: versão de 15 s", ignorados: [], recusados: [], custo_estimado_usd: 0.03,
      contexto: { client_id: CLIENTE, modelo_id: OUTRO },
      itens: [{ ref: "r1", alvo_id: ROTEIRO, titulo: "Bastidor do kit de inverno", operacao: "reescrever_roteiro", rotulo: "reescrever", para: "versão de 15 s", detalhe: null }],
    };
    const resultado = { ref: "r1", alvo_id: ROTEIRO, operacao: "reescrever_roteiro", titulo: "Bastidor do kit de inverno", ok: true, aviso: "versão 3", desfazer: { tipo: "voltar_versao", roteiro_id: ROTEIRO, versao_anterior: 2, versao_nova: 3, status_anterior: "rascunho" } };
    respostas.agente_conversar = { conversa_id: "c-1", mensagem_id: MENSAGEM, resposta: "A lista está pronta para confirmar.", sugestoes: ["Feche com o cliente vestindo o kit"], anexos: [acao], custo_usd: 0.004 };
    respostas.executar_acao_agente = { anexo: { ...acao, executada_em: "2026-10-23T12:00:00Z", resultados: [resultado] }, feitos: 1, falhas: 0, custo_usd: 0.03 };
    respostas.desfazer_acao_agente = { anexo: { ...acao, executada_em: "2026-10-23T12:00:00Z", desfeita_em: "2026-10-23T12:01:00Z", resultados: [resultado] }, voltaram: 1, custo_usd: 0 };
    montarPeca();
    const agente = await screen.findByRole("region", { name: /Agente de roteiro de Bastidor/ });
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    // Troca de modelo: o escopo "roteiro" fica lembrado para o cliente e a conversa usa o novo.
    fireEvent.change(within(agente).getByLabelText("Modelo do roteiro"), { target: { value: OUTRO } });
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("definir_modelo_do_cliente", { _client_id: CLIENTE, _escopo: "roteiro", _modelo_id: OUTRO }));
    expect(await within(agente).findByText(/Lembrado para este cliente: Outro modelo/)).toBeTruthy();
    fireEvent.click(within(agente).getByRole("button", { name: "Versão de 15 s" }));
    fireEvent.click(within(agente).getByRole("button", { name: "Enviar ao agente de roteiro" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("agente_conversar")[0]).toEqual(expect.objectContaining({ escopo: "peca", roteiro_id: ROTEIRO, client_id: CLIENTE, mensagem: "Faz uma versão de 15 s deste roteiro.", modelo_id: OUTRO }));
    expect(await screen.findByText("A lista está pronta para confirmar.")).toBeTruthy();
    // A ideia da resposta vira pedido num toque.
    expect(within(agente).getByRole("button", { name: "Feche com o cliente vestindo o kit" })).toBeTruthy();
    // Nada muda até o Confirmar; o cartão mostra o custo antes.
    expect(screen.getByText(/Custo estimado: US\$ 0,03 da carteira\./)).toBeTruthy();
    expect(chamadasDe("executar_acao_agente")).toHaveLength(0);
    fireEvent.click(within(agente).getByRole("button", { name: /^Confirmar/ }));
    await waitFor(() => expect(chamadasDe("executar_acao_agente")).toHaveLength(1));
    expect(chamadasDe("executar_acao_agente")[0]).toEqual(expect.objectContaining({ mensagem_id: MENSAGEM, acao_id: "roteiros-1" }));
    // O Desfazer volta a versão anterior.
    fireEvent.click(await within(agente).findByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadasDe("desfazer_acao_agente")).toHaveLength(1));
    expect(chamadasDe("desfazer_acao_agente")[0]).toEqual(expect.objectContaining({ mensagem_id: MENSAGEM, acao_id: "roteiros-1" }));
  });

  it("escolher uma versão guardada (sem custo) e baixar o PDF pelo Gravar", async () => {
    mock.tabelas.roteiros = [linhaComDuas()];
    respostas.versao_restaurar = { roteiro: linhaComDuas(), custo_usd: 0 };
    montarPeca();
    fireEvent.click(await screen.findByRole("button", { name: /Versões do roteiro de Bastidor do kit de inverno \(2\)/ }));
    const lista = screen.getByRole("list", { name: /Versões do roteiro de Bastidor/ });
    const itens = within(lista).getAllByRole("listitem").filter((li) => li.getAttribute("data-versao"));
    expect(itens.map((li) => [li.getAttribute("data-versao"), li.getAttribute("data-atual")])).toEqual([["2", "sim"], ["1", "nao"]]);
    expect(within(itens[0]).queryByRole("button", { name: /Usar a versão/ })).toBeNull();
    fireEvent.click(within(itens[1]).getByRole("button", { name: "Ver a versão 1" }));
    // Aberta: o roteiro da versão aparece (o gancho está no título da linha e no texto).
    expect(within(itens[1]).getAllByText("Sabe o que vem no kit?").length).toBe(2);
    expect(within(itens[1]).getByText("Três peças por um preço só")).toBeTruthy();
    fireEvent.click(within(itens[1]).getByRole("button", { name: "Usar a versão 1" }));
    await waitFor(() => expect(chamadasDe("versao_restaurar")[0]).toEqual(expect.objectContaining({ roteiro_id: ROTEIRO, versao: 1 })));
    // Gravar: o roteiro certinho da peça para baixar.
    const pdf = await screen.findByRole("button", { name: /em PDF/ });
    expect(pdf.getAttribute("title")).toBe("Baixar o roteiro em PDF");
    fireEvent.click(pdf);
    await waitFor(() => expect(mock.baixarBytes).toHaveBeenCalledTimes(1));
    expect(mock.montarPdf).toHaveBeenCalledWith("Cliente Teste", [expect.objectContaining({ versao: 2 })]);
    expect(screen.getByText("Peito para cima")).toBeTruthy();
    expect(chamadasDe("peca_gerar")).toHaveLength(0);
    expect(nomeDoWord("Promoção de Inverno: 30%!")).toBe("roteiro-promocao-de-inverno-30");
    expect(escolhaDaVersao(normalizarLinhaDoRoteiro(linhaComDuas()))).toEqual({ porque: "Versão 2 (gancho de erro), viral 78 contra 64.", outra: 1 });
  });

  const cenaAntiga = (n: number) => ({ descricao: `Caixa abrindo ${n}`, plano: "close", fala: `Fala antiga ${n}`, texto_na_tela: "", som: "", segundos: 5 });
  const rvAntigo = (t: string) => ({ titulo: t, conceito: "", gancho: `Gancho ${t}`, cenas: [cenaAntiga(1), cenaAntiga(2)], duracao: 10, trilha: "", cta: "Chame" });
  const pecaAntiga = () => ({ ...item, roteiro_video: rvAntigo("Escolhido"), roteiro_opcoes: { versoes: [rvAntigo("Opção A"), rvAntigo("Opção B")], recomendada: 0, porque: "", ideia: "", duracao: 15, estilo: "viral", criatividade: "ultra", em: "x" } }) as unknown as ItemProposto;
  const importada = () => ({ ...linhaComDuas(), versoes: [versao(1, CONTEUDO, "Roteiro que estava na peça")], versao_atual: 1 });

  it("o roteiro antigo guardado no item aparece e baixa; a primeira conversa leva ele para a tabela (sem IA) e conversa sobre ele", async () => {
    respostas.peca_importar = () => {
      // Como o servidor: depois de importar, a lista de roteiros do cliente já traz a linha.
      mock.tabelas.roteiros = [importada()];
      return { roteiro: importada(), importado: true, custo_usd: 0 };
    };
    respostas.agente_conversar = { conversa_id: "c-1", mensagem_id: MENSAGEM, resposta: "Três ideias para este roteiro.", sugestoes: [], anexos: [], custo_usd: 0.004 };
    montarPeca(pecaAntiga());
    const regiao = await screen.findByRole("region", { name: "Roteiro de Bastidor do kit de inverno" });
    expect(regiao.closest("[data-fonte-do-roteiro]")!.getAttribute("data-fonte-do-roteiro")).toBe("item");
    expect(within(regiao).getAllByText("Gancho Escolhido").length).toBeGreaterThan(0);
    expect(within(regiao).getByText("Fala antiga 1")).toBeTruthy();
    expect(within(regiao).getByText(/Roteiro guardado na peça/)).toBeTruthy();
    // Baixa como está (sem ir ao servidor).
    fireEvent.click(await screen.findByRole("button", { name: /em PDF/ }));
    await waitFor(() => expect(mock.baixarBytes).toHaveBeenCalledTimes(1));
    expect(mock.montarPdf.mock.calls[0][1][0].roteiro.ganchos[0].texto).toBe("Gancho Escolhido");
    // Sem roteiro na tabela, a conversa não foi lida (nada a ler) e nada foi importado ainda.
    expect(chamadasDe("agente_historico")).toHaveLength(0);
    expect(chamadasDe("peca_importar")).toHaveLength(0);
    const agente = screen.getByRole("region", { name: /Agente de roteiro de Bastidor/ });
    fireEvent.change(within(agente).getByLabelText("Pedido ao agente de roteiro"), { target: { value: "Me dá ideias" } });
    fireEvent.click(within(agente).getByRole("button", { name: "Enviar ao agente de roteiro" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("peca_importar")[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "t-video-1", usar: null }));
    expect(chamadasDe("agente_conversar")[0]).toEqual(expect.objectContaining({ roteiro_id: ROTEIRO, escopo: "peca", mensagem: "Me dá ideias" }));
    expect(ordemDasAcoes().filter((a) => a === "peca_importar" || a === "agente_conversar")).toEqual(["peca_importar", "agente_conversar"]);
    expect(await screen.findByText("Três ideias para este roteiro.")).toBeTruthy();
    // A mensagem da pessoa não some quando o roteiro passa a existir na tabela.
    expect(within(screen.getByLabelText("Conversa com o agente de roteiro")).getByText("Me dá ideias")).toBeTruthy();
    await waitFor(() => expect(document.querySelector("[data-fonte-do-roteiro]")!.getAttribute("data-fonte-do-roteiro")).toBe("tabela"));
  });

  it("as versões do agente antigo aparecem; usar uma leva o roteiro para a tabela com ela como atual", async () => {
    respostas.peca_importar = { roteiro: importada(), importado: true, custo_usd: 0 };
    montarPeca(pecaAntiga());
    const regiao = await screen.findByRole("region", { name: "Roteiro de Bastidor do kit de inverno" });
    fireEvent.click(within(regiao).getByRole("button", { name: /Versões do roteiro de Bastidor do kit de inverno \(3\)/ }));
    const lista = within(regiao).getByRole("list", { name: /Versões do roteiro/ });
    const itens = within(lista).getAllByRole("listitem").filter((li) => li.getAttribute("data-versao"));
    expect(itens.map((li) => li.getAttribute("data-versao"))).toEqual(["item", "2", "1"]);
    fireEvent.click(within(regiao).getByRole("button", { name: "Usar a versão 2" }));
    await waitFor(() => expect(chamadasDe("peca_importar")[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "t-video-1", usar: 1 })));
  });
});

// ------------------------------------------------------------------ contrato do servidor

describe("contrato do servidor (mesa-roteiros)", () => {
  const fonte = readFileSync(resolve(process.cwd(), "supabase/functions/mesa-roteiros/index.ts"), "utf8").replace(/\r\n/g, "\n");
  const trecho = (de: string, ate: string) => fonte.slice(fonte.indexOf(de), fonte.indexOf(ate, fonte.indexOf(de) + 1));

  it("pedido ao agente grava nova versão do roteiro: reescrever_roteiro chama o roteirista, guarda a versão e o Desfazer volta a anterior", () => {
    const reescrever = trecho("async function reescreverRoteiro(", "// ------------------------------------------------------------------ cenas da peça");
    expect(reescrever).toContain("instrucaoDaReescrita(pedido, duracao)");
    expect(reescrever).toContain("viralDoRoteiro(linha.client_id, 1,");
    expect(reescrever).toContain("guardarVersao(ch, { clientId: linha.client_id, linha,");
    expect(reescrever).toContain("nota: `Pedido ao agente: ${pedido}`");
    const executar = trecho("async function executarItem(", "async function reverterItem(");
    expect(executar).toContain('if (item.operacao === "reescrever_roteiro") {');
    expect(executar).toContain('const r = await reescreverRoteiro(ch, linha, pedido, modeloDaProposta, "agente");');
    expect(executar).toContain('desfazer: { tipo: "voltar_versao", roteiro_id: linha.id, versao_anterior: linha.versao_atual, versao_nova: r.versao.numero');
    // O Confirmar usa o modelo do seletor (o mesmo do custo no cartão).
    expect(fonte).toContain("if (acao) acao = { ...acao, contexto: { ...(acao.contexto || {}), modelo_id: modelo.id } };");
    // Conversa própria do roteiro da peça.
    expect(fonte).toContain('const REF_DA_PECA = "roteiro_da_peca";');
    expect(fonte).toContain("naPeca && aberto ? aberto.id : null");
  });

  it("peca_gerar: duas versões, o Jev escolhe pelas notas virais, a outra fica no histórico; o modelo lembrado do escopo roteiro", () => {
    expect(fonte).toContain("peca_gerar: (ch, corpo) => gerar(ch, corpo, { duasVersoes: true }),");
    expect(fonte).toContain("esquemaJson: duas ? ESQUEMA_DAS_DUAS_VERSOES : ESQUEMA_DO_ROTEIRO,");
    expect(fonte).toContain("questions: perguntasDaViralidade(textos.length),");
    expect(fonte).toContain("nota: `Versão ${k + 1} (o Jev escolheu a outra)");
    expect(fonte).toContain('const lembrado = await modeloDoEscopo(servico(), clientId, "roteiro");');
    expect(fonte).toContain("peca_cenas_gerar: pecaCenasGerar,");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261023180000_modelo_do_roteiro.sql"), "utf8");
    expect(migration).toContain("add column if not exists modelo_roteiro_id text");
    expect(migration).toContain("_escopo not in ('copy', 'refino', 'estrategista', 'roteiro')");
  });
});

describe("contrato do servidor: agente unificado (mesa-roteiros)", () => {
  const fonte = readFileSync(resolve(process.cwd(), "supabase/functions/mesa-roteiros/index.ts"), "utf8").replace(/\r\n/g, "\n");
  const trecho = (de: string, ate: string) => fonte.slice(fonte.indexOf(de), fonte.indexOf(ate, fonte.indexOf(de) + 1));

  it("peca_gerar leva a direção criativa e, sem roteiro_id, usa o roteiro da peça (o antigo do item entra antes)", () => {
    const gerar = trecho("async function gerar(", "// ------------------------------------------------------------------ roteiro de anúncio");
    expect(gerar).toContain("daPeca = (await importarDaPeca(ch, clientId, idDe(corpo.campanha_id, \"campanha_id\"), limpo(corpo.tema_id, 80), null)).linha;");
    expect(gerar).toContain("direcaoCriativa: opcoes.duasVersoes ? lerDirecaoCriativa(corpo) : null,");
    expect(fonte).toContain("direcao_criativa: p.direcaoCriativa && !p.tom ? dadosDaDirecaoCriativa(p.direcaoCriativa, p.duracaoS) : null,");
    expect(fonte).toContain("maxTokensSaida: duas ? Math.max(12_000, tamanhoDasDuasVersoes(p.duracaoS).saida + 3_000) : 7_000,");
    // O estimar usa a mesma conta da duração.
    expect(fonte).toContain("const tamanhoDaPeca = tamanhoDasDuasVersoes(Number(corpo.duracao_s) || 30);");
  });

  it("peca_importar: sem IA, acha o roteiro da peça pela mesma conta da tela e leva as versões do item, a escolhida por último", () => {
    expect(fonte).toContain("peca_importar: pecaImportar,");
    const importar = trecho("async function importarDaPeca(", "async function pecaImportar(");
    expect(importar).toContain("let linha = linhaDaPeca(linhas, { taskId, campanhaId, propostaId: serie, tema });");
    expect(importar).toContain("const antigas = versoesAntigasDaPeca(item);");
    expect(importar).toContain("const ordem = escolhida ? antigas.filter((v) => v !== escolhida).concat([escolhida]) : antigas;");
    expect(importar).not.toContain("chamarTexto");
    expect(importar).not.toContain("jevPerguntar");
  });

  it("as cenas do Gerar saem do roteiro da peça; na peça o agente só age com Confirmar", () => {
    const cenas = trecho("async function pecaCenasGerar(", "// ------------------------------------------------------------------ o roteiro da peça na tabela");
    expect(cenas).toContain("const daPeca = corpo.roteiro_id ? await lerLinha(ch, corpo.roteiro_id) : null;");
    expect(cenas).toContain("JSON.stringify(conteudoDaPeca ? { ...ctx.dados, roteiro_da_peca: conteudoDaPeca } : ctx.dados)");
    expect(fonte).toContain("if (acao && !naPeca && podeExecutarDireto(acao, regrasDosRoteiros(), { pedidoClaro: true }).direto) {");
  });

  it("a tela não chama mais o agente antigo (campanha_roteiro_agente) e os arquivos dele saíram", () => {
    const tela = ["src/components/mesa/CampanhaVideos.tsx", "src/components/mesa/RoteiroDaPecaDeVideo.tsx", "src/components/mesa/roteiroDaPeca.ts", "src/components/mesa/GravarVideoDaCampanha.tsx"]
      .map((f) => readFileSync(resolve(process.cwd(), f), "utf8")).join("\n");
    expect(tela).not.toContain("campanha_roteiro_agente");
    expect(tela).not.toContain("AgenteDeRoteiro\"");
    for (const f of ["src/components/mesa/AgenteDeRoteiro.tsx", "src/components/mesa/agenteDeRoteiroApi.ts", "src/components/mesa/documentoDoRoteiroDeVideo.ts"]) {
      expect(() => readFileSync(resolve(process.cwd(), f), "utf8")).toThrow();
    }
  });
});

// ------------------------------------------------------------------ o mesmo agente na peça de vídeo do Mês


describe("peça de vídeo do Mês: Gravar com roteiro usa o mesmo agente (tela)", () => {
  const TAREFA = "66666666-6666-4666-8666-666666666666";
  const pauta = { id: TAREFA, title: "Bastidor do kit de inverno", due_date: "2026-11-10", delivery_type: "reels", status: "todo", project_id: "p", midia: { gancho: "Erro de inverno", cenas: ["Etiqueta"], narracao: "" } } as any;
  const montarPauta = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: h(GravarDaPauta, { item: pauta }) })))));
  };

  it("sem roteiro: o agente cria pela tarefa da agenda (2 versões, o Jev escolhe), com ideia, estilo e o modelo do roteiro", async () => {
    respostas.peca_gerar = { roteiro: { ...linhaComDuas(), task_id: TAREFA, campanha_id: null, proposta_id: null }, versao: { numero: 2 }, custo_usd: 0.08 };
    montarPauta();
    const agente = await screen.findByRole("region", { name: /Agente de roteiro de Bastidor do kit de inverno/ });
    expect(screen.getAllByRole("region", { name: /Agente de roteiro/ })).toHaveLength(1);
    expect(within(agente).getByLabelText("Modelo do roteiro")).toBeTruthy();
    fireEvent.change(within(agente).getByLabelText(/Ideia do roteiro/), { target: { value: "Abrir a caixa na frente da câmera" } });
    fireEvent.click(within(agente).getByRole("button", { name: "Tutorial" }));
    const criar = within(agente).getByRole("button", { name: /Criar roteiro/ });
    await waitFor(() => expect(criar).not.toBeDisabled());
    await confirmarCusto(criar, "peca_gerar");
    await waitFor(() => expect(chamadasDe("peca_gerar")).toHaveLength(1));
    const corpo = chamadasDe("peca_gerar")[0];
    expect(corpo).toEqual(expect.objectContaining({ client_id: CLIENTE, task_id: TAREFA, tipo: "tutorial", duracao_s: 30, ideia: "Abrir a caixa na frente da câmera", estilo: "tutorial", criatividade: "ultra", modelo_id: MODELO }));
    expect(corpo.campanha_id).toBeUndefined();
    expect(corpo.pedido).toContain("Gancho pensado: Erro de inverno");
  });

  it("com roteiro na tarefa: o roteiro à vista, a conversa deste roteiro ao lado e o PDF para gravar", async () => {
    mock.tabelas.roteiros = [{ ...linhaComDuas(), task_id: TAREFA, campanha_id: null, proposta_id: null, titulo: "Outro título" }];
    montarPauta();
    expect((await screen.findAllByText("Você está jogando dinheiro fora no inverno")).length).toBeGreaterThan(0);
    await waitFor(() => expect(chamadasDe("agente_historico")[0]).toEqual(expect.objectContaining({ escopo: "peca", roteiro_id: ROTEIRO })));
    fireEvent.click(await screen.findByRole("button", { name: /em PDF/ }));
    await waitFor(() => expect(mock.baixarBytes).toHaveBeenCalledTimes(1));
  });
});
