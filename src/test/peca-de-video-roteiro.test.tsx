import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente B (23/10/2026): a peça de vídeo com Gravar e Gerar e o agente de roteiro ao lado. O dono: "no
 * Gravar eu pego o roteiro certinho do assunto e do tema e posso baixar; o agente de roteiro ele faz as
 * coisas de fato e altera conforme eu peço". Banco e função simulados; no fim, o contrato do servidor.
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

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import GravarVideoDaCampanha, { escolhaDaVersao, nomeDoWord } from "@/components/mesa/GravarVideoDaCampanha";
import AgenteDoRoteiroDaPeca from "@/components/mesa-roteiros/AgenteDoRoteiroDaPeca";
import { partesDasCenasDaPeca } from "@/components/mesa-roteiros/cenasDaPeca";
import type { Campanha, ItemProposto } from "@/components/mesa/mesaV4Api";
import { normalizarLinhaDoRoteiro, normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import {
  duracaoDoPedido,
  escolherPelaViralidade,
  ESQUEMA_DAS_CENAS_VIRAIS,
  ESQUEMA_DAS_DUAS_VERSOES,
  estadoDaEscolhaViral,
  falaDoRoteiro,
  pedidoDaReescrita,
  roteiroReescrito,
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
    versao(1, { ...CONTEUDO, ganchos: [{ texto: "Sabe o que vem no kit?", mecanismo: "curiosidade", promessa: "", motivo: "" }] }, "Versão 1 (o Jev escolheu a outra): gancho de curiosidade"),
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

const item = { tema_id: "t-video-1", tema: "Bastidor do kit de inverno", data: "2026-11-10", formato: "video", etapa: "sustentacao", gancho: "Você sabe o que vem no kit?", cta: "Chama no direct", task_id: null } as unknown as ItemProposto;

const CATALOGO = [
  { id: MODELO, nome: "Modelo de teste", rotulo: "Modelo de teste", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, padrao_para: ["estrategista"] },
  { id: OUTRO, nome: "Outro modelo", rotulo: "Outro modelo", tipo: "texto", provedor: "anthropic", ativo: true, preco_entrada_1m: 5, preco_saida_1m: 25, padrao_para: ["copy"] },
];

let respostas: Record<string, unknown> = {};
const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-roteiros" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

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

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: filho })))));
  return qc;
}

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

// ------------------------------------------------------------------ tela

describe("Gravar da peça de vídeo (tela)", () => {
  it("gera 2 versões pelo motor (peca_gerar) com o custo antes, mostra a escolha do Jev e o agente ao lado", async () => {
    respostas.peca_gerar = { roteiro: linhaComDuas(), versao: { numero: 2 }, escolha: { indice: 1, como: "jev" }, alternativa: 1, custo_usd: 0.08, saldo_usd: 10 };
    montar(h(GravarVideoDaCampanha, { clientId: CLIENTE, campanha, propostaId: PROPOSTA, item }));
    await waitFor(() => expect(chamadasDe("estimar").some((c) => c.acao_alvo === "peca")).toBe(true));
    const gerar = await screen.findByRole("button", { name: /Gerar roteiro/ });
    // 0,08 do motor mais as 3 conferências do Jev.
    await waitFor(() => expect(gerar.textContent).toMatch(/US\$ 0,08/));
    await waitFor(() => expect(gerar).not.toBeDisabled());
    fireEvent.click(gerar);
    if (!chamadasDe("peca_gerar").length) {
      await new Promise((r) => setTimeout(r, 400));
      if (!chamadasDe("peca_gerar").length) fireEvent.click(gerar);
    }
    await waitFor(() => expect(chamadasDe("peca_gerar")).toHaveLength(1));
    expect(chamadasDe("peca_gerar")[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "t-video-1", tipo: "fala_camera", modelo_id: MODELO }));
    expect(chamadasDe("gerar")).toHaveLength(0);
    expect(await screen.findByText(/Jev: Versão 2 \(gancho de erro\), viral 78 contra 64\./)).toBeTruthy();
    expect(screen.getByText(/A outra é a v1, no histórico\./)).toBeTruthy();
    expect((await screen.findAllByText("Você está jogando dinheiro fora no inverno")).length).toBeGreaterThan(0);
    // O agente de roteiro abre a conversa DESTE roteiro, sem custo.
    await waitFor(() => expect(chamadasDe("agente_historico")[0]).toEqual(expect.objectContaining({ escopo: "peca", roteiro_id: ROTEIRO })));
    expect(screen.getByRole("region", { name: /Agente de roteiro/ })).toBeTruthy();
  });

  it("Gravar baixa o PDF do roteiro (e o Word sai com nome sem acento)", async () => {
    mock.tabelas.roteiros = [linhaComDuas()];
    montar(h(GravarVideoDaCampanha, { clientId: CLIENTE, campanha, propostaId: PROPOSTA, item }));
    const pdf = await screen.findByRole("button", { name: /em PDF/ });
    expect(pdf.getAttribute("title")).toBe("Baixar o roteiro em PDF");
    expect(pdf.textContent).toBe("");
    fireEvent.click(pdf);
    await waitFor(() => expect(mock.baixarBytes).toHaveBeenCalledTimes(1));
    expect(mock.montarPdf).toHaveBeenCalledWith("Cliente Teste", [expect.objectContaining({ versao: 2 })]);
    expect(mock.baixarBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "roteiros-cliente-teste.pdf");
    expect(chamadasDe("peca_gerar")).toHaveLength(0);
    expect(nomeDoWord("Promoção de Inverno: 30%!")).toBe("roteiro-promocao-de-inverno-30");
    expect(escolhaDaVersao(normalizarLinhaDoRoteiro(linhaComDuas()))).toEqual({ porque: "Versão 2 (gancho de erro), viral 78 contra 64.", outra: 1 });
  });
});

describe("agente de roteiro ao lado da peça (tela)", () => {
  it("pedido ao agente grava nova versão do roteiro: cartão com custo, Confirmar executa, o roteiro relê e o Desfazer fica", async () => {
    const acao = {
      tipo: "acao_agente", agente: "roteiros", id: "roteiros-1", resumo: "Reescrever: versão de 15 s", ignorados: [], recusados: [], custo_estimado_usd: 0.03,
      contexto: { client_id: CLIENTE, modelo_id: OUTRO },
      itens: [{ ref: "r1", alvo_id: ROTEIRO, titulo: "Bastidor do kit de inverno", operacao: "reescrever_roteiro", rotulo: "reescrever", para: "versão de 15 s", detalhe: null }],
    };
    respostas.agente_conversar = { conversa_id: "c-1", mensagem_id: MENSAGEM, resposta: "A lista está pronta para confirmar.", sugestoes: [], anexos: [acao], custo_usd: 0.004 };
    respostas.executar_acao_agente = {
      anexo: { ...acao, executada_em: "2026-10-23T12:00:00Z", resultados: [{ ref: "r1", alvo_id: ROTEIRO, operacao: "reescrever_roteiro", titulo: "Bastidor do kit de inverno", ok: true, aviso: "versão 3", desfazer: { tipo: "voltar_versao", roteiro_id: ROTEIRO, versao_anterior: 2, versao_nova: 3, status_anterior: "rascunho" } }] },
      feitos: 1, falhas: 0, custo_usd: 0.03,
    };
    // O modelo do roteiro lembrado para o cliente (mesa_cliente_config.modelo_roteiro_id) vale na conversa.
    mock.tabelas.mesa_cliente_config = [{ modelo_roteiro_id: OUTRO }];
    const aoMudar = vi.fn();
    const qc = montar(h(AgenteDoRoteiroDaPeca, { roteiroId: ROTEIRO, titulo: "Bastidor", aoMudarRoteiro: aoMudar }));
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    expect(await screen.findByText(/Lembrado para este cliente: Outro modelo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Versão de 15 s" }));
    const campo = screen.getByLabelText("Pedido ao agente de roteiro") as HTMLTextAreaElement;
    expect(campo.value).toBe("Faz uma versão de 15 s deste roteiro.");
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente de roteiro" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("agente_conversar")[0]).toEqual(expect.objectContaining({ escopo: "peca", roteiro_id: ROTEIRO, client_id: CLIENTE, mensagem: "Faz uma versão de 15 s deste roteiro.", modelo_id: OUTRO }));
    expect(await screen.findByText("A lista está pronta para confirmar.")).toBeTruthy();
    // O cartão mostra o pedido e o custo antes; nada muda até Confirmar.
    expect(screen.getAllByText(/versão de 15 s/).length).toBeGreaterThan(1);
    expect(screen.getByText(/Custo estimado: US\$ 0,03 da carteira\./)).toBeTruthy();
    expect(chamadasDe("executar_acao_agente")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar/ }));
    await waitFor(() => expect(chamadasDe("executar_acao_agente")).toHaveLength(1));
    expect(chamadasDe("executar_acao_agente")[0]).toEqual(expect.objectContaining({ mensagem_id: MENSAGEM, acao_id: "roteiros-1" }));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["mesa-roteiros", "roteiros", CLIENTE] });
    expect(await screen.findByRole("button", { name: /Desfazer/ })).toBeTruthy();
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
