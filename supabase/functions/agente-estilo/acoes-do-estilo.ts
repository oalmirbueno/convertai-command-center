/**
 * Ações que o agente de estilo PROPÕE e a equipe CONFIRMA (contrato comum:
 * _shared/acoes-do-agente.ts). Apelidos: e1 é o estilo do cliente; r1..rN são
 * imagens que podem entrar no estilo (anexadas agora, artes aprovadas,
 * referências do cliente); s1..sN são as referências que já estão no estilo.
 *
 * - gravar_estilo (e1): grava a proposta do agente como versão nova (a
 *   proposta vai no contexto da ação; sem proposta, o item é ignorado).
 * - registrar_aprendizado (e1): "gostou: ..." ou "não gostou: ...".
 * - ligar_estilo / desligar_estilo (e1): o estilo pode ou não ser usado nas gerações.
 * - gerar_teste (e1): 1 a 4 imagens de teste (custo antes, sem desfazer).
 * - usar_referencia (r*) / tirar_referencia (s*): versão nova com a lista trocada.
 *
 * Puro (a tela e o vitest leem). Sem travessão.
 */

import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  type CaminhoDoAgente,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../_shared/mapa-do-painel.ts";
import {
  CAMPOS_DAS_REGRAS,
  type EstiloDoCliente,
  guiaAtual,
  guiaTemConteudo,
  lerAprendizado,
  MAX_TESTES_POR_VEZ,
  normalizarGuia,
  type GuiaDoEstilo,
} from "../_shared/estilo-do-cliente.ts";

export const AGENTE_DO_ESTILO = "estilo";

/** Operações que só mudam o que o painel do estilo já mostra (teste, gosto): sem "Ir para". */
const SO_NO_PAINEL = ["gerar_teste", "registrar_aprendizado", "gerar_teste_template", "registrar_gosto_template"];

/**
 * O "Ir para" do estilo e dos templates (dono, 27/09: "quando termina ele dá
 * o caminho pra mim apertar e ir"): o estilo e os templates são usados no
 * Estúdio (o interruptor "Usar estilo do cliente" e o seletor de template
 * ficam lá), então o caminho é o Estúdio da Mesa do cliente. Teste e gosto
 * aparecem no próprio painel: sem caminho. Conta só o que deu certo.
 */
export function caminhoDoEstilo(clientId: string, acao: Pick<AcaoDoAgente, "itens" | "resultados">, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  const feitos = acao.resultados && acao.resultados.length ? acao.resultados.filter((r) => r.ok) : null;
  const ops = acao.itens.filter((i) => !feitos || feitos.some((r) => r.ref === i.ref && r.operacao === i.operacao)).map((i) => i.operacao);
  if (!ops.some((op) => SO_NO_PAINEL.indexOf(op) < 0)) return null;
  const rotulo = ops.some((op) => op.indexOf("template") >= 0) && !ops.some((op) => op.indexOf("estilo") >= 0) ? "Usar o template no Estúdio" : "Usar no Estúdio";
  return caminhoNaArea("mesa", { clientId, etapa: "estudio", rotulo, abrirSozinho: opcoes.abrirSozinho });
}

export const OPERACOES_DO_ESTILO = ["gravar_estilo", "registrar_aprendizado", "ligar_estilo", "desligar_estilo", "gerar_teste", "usar_referencia", "tirar_referencia"] as const;
export type OperacaoDoEstilo = (typeof OPERACOES_DO_ESTILO)[number];

export const DESCRICOES_DAS_OPERACOES: Record<OperacaoDoEstilo, string> = {
  gravar_estilo: "e1. Grava a sua proposta_de_estilo como versão nova do estilo. Só com proposta_de_estilo preenchida. para: uma frase do que muda.",
  registrar_aprendizado: "e1. Registra o que o cliente gostou ou não. para: \"gostou: ...\" ou \"não gostou: ...\" (várias separadas por |).",
  ligar_estilo: "e1. Deixa o estilo pronto para ser usado nas gerações (a equipe ainda liga o interruptor no Estúdio). para vazio.",
  desligar_estilo: "e1. Tira o estilo das gerações. para vazio.",
  gerar_teste: "e1. Gera imagens de teste do estilo atual com o gerador do Estúdio. para: quantas (1 a 4) e, depois de dois pontos, o tema (ex.: \"2: promoção de outubro\").",
  usar_referencia: "r*. Põe a imagem como referência de acabamento do estilo. para vazio.",
  tirar_referencia: "s*. Tira a referência do estilo. para vazio.",
};

export const ORDEM_DE_EXECUCAO: OperacaoDoEstilo[] = ["gravar_estilo", "usar_referencia", "tirar_referencia", "registrar_aprendizado", "desligar_estilo", "ligar_estilo", "gerar_teste"];

/** Candidata a referência (r*): de onde vem e onde está o arquivo. */
export type CandidataDeReferencia = Alvo & { dados: { origem: "referencia" | "acervo"; bucket: string; caminho: string; leitura?: string | null } };

export type AlvosDoEstilo = {
  estilo: Array<AlvoComApelido>;
  candidatas: Array<AlvoComApelido<CandidataDeReferencia>>;
  noEstilo: Array<AlvoComApelido>;
  todos: Array<AlvoComApelido>;
};

/** Monta os apelidos: e1, r1..rN (candidatas, as anexadas agora primeiro) e s1..sN. */
export function alvosDoEstilo(estilo: EstiloDoCliente, candidatas: CandidataDeReferencia[]): AlvosDoEstilo {
  const g = guiaAtual(estilo);
  const noEstiloIds = new Set((g ? g.referencias : []).map((r) => r.id));
  const alvoEstilo: Alvo = {
    id: estilo.id || estilo.client_id,
    titulo: "Estilo do cliente",
    detalhe: estilo.versao_atual ? `versão ${estilo.versao_atual}, ${estilo.ativo ? "ligado" : "desligado"}` : "ainda sem versão",
    dados: { ativo: estilo.ativo, tem_guia: guiaTemConteudo(g) },
  };
  const e = comApelido([alvoEstilo], "e");
  const r = comApelido(candidatas.filter((c) => !noEstiloIds.has(c.id)).slice(0, 40), "r");
  const s = comApelido(
    (g ? g.referencias : []).map((x) => ({ id: x.id, titulo: x.nome, detalhe: x.leitura ? x.leitura.slice(0, 140) : x.origem })),
    "s",
  );
  return { estilo: e, candidatas: r, noEstilo: s, todos: [...e, ...r, ...s] };
}

export function blocoDosAlvosDoEstilo(a: AlvosDoEstilo): string {
  return [
    blocoDosAlvos("ESTILO", a.estilo),
    blocoDosAlvos("IMAGENS QUE PODEM ENTRAR NO ESTILO", a.candidatas, "nenhuma."),
    blocoDosAlvos("REFERÊNCIAS QUE JÁ ESTÃO NO ESTILO", a.noEstilo, "nenhuma."),
    regraDasAcoes(DESCRICOES_DAS_OPERACOES),
  ].join("");
}

/** Esquema da proposta de estilo (blocos claros). Null quando o agente não propõe. */
export const ESQUEMA_DA_PROPOSTA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["resumo", "regras"],
  properties: {
    resumo: { type: "string" },
    regras: {
      type: "object",
      additionalProperties: false,
      required: [...CAMPOS_DAS_REGRAS],
      properties: Object.fromEntries(CAMPOS_DAS_REGRAS.map((c) => [c, { type: "array", items: { type: "string" } }])),
    },
  },
};

export const ESQUEMA_DO_AGENTE_DE_ESTILO = {
  nome: "resposta_do_agente_de_estilo",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "sugestoes", "leitura_das_referencias", "proposta_de_estilo", "acoes"],
    properties: {
      resposta: { type: "string" },
      sugestoes: { type: "array", items: { type: "string" } },
      leitura_das_referencias: { type: "string" },
      proposta_de_estilo: ESQUEMA_DA_PROPOSTA,
      acoes: esquemaDasAcoes([...OPERACOES_DO_ESTILO]),
    },
  },
};

/** "2: promoção de outubro" -> { n: 2, tema }. Fora de 1..4: null. */
export function lerPedidoDeTeste(bruto: unknown): { n: number; tema: string } | null {
  const s = String(bruto ?? "").trim();
  const m = /^(\d+)\s*(?::\s*(.*))?$/.exec(s);
  const n = m ? Number(m[1]) : 1;
  if (!Number.isInteger(n) || n < 1 || n > MAX_TESTES_POR_VEZ) return null;
  const tema = (m ? m[2] || "" : s).replace(/\s+/g, " ").trim().slice(0, 200);
  return { n, tema };
}

/** Normaliza o que o modelo pediu em "|" para a lista de aprendizados. */
export function aprendizadosDoPara(bruto: unknown): Array<{ tipo: "gostou" | "nao_gostou"; texto: string }> {
  return String(bruto ?? "")
    .split("|")
    .map(lerAprendizado)
    .filter((x): x is { tipo: "gostou" | "nao_gostou"; texto: string } => !!x)
    .slice(0, 6);
}

/**
 * Lê as ações do modelo. A proposta de estilo (quando houver e disser algo)
 * vai no contexto da ação para o executor gravar. Custo: imagens de teste x
 * custo por imagem (mostrado no cartão antes de confirmar).
 */
export function normalizarAcoesDoEstilo(
  bruto: unknown,
  alvos: AlvosDoEstilo,
  opcoes: { proposta: unknown; clientId: string; marcaId: string | null; custoPorImagem: number; id?: string },
): AcaoDoAgente | null {
  const propostaNorm: GuiaDoEstilo | null = opcoes.proposta ? normalizarGuia(opcoes.proposta) : null;
  const proposta = propostaNorm && guiaTemConteudo(propostaNorm) ? propostaNorm : null;
  const ativo = (a: AlvoComApelido) => !!(a.dados && (a.dados as Record<string, unknown>).ativo);
  const temGuia = (a: AlvoComApelido) => !!(a.dados && (a.dados as Record<string, unknown>).tem_guia);
  const regras: Record<OperacaoDoEstilo, RegraDaOperacao> = {
    gravar_estilo: {
      rotulo: "gravar o estilo novo",
      alvos: ["e"],
      combina: true,
      para: (v) => (proposta ? String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "estilo proposto na conversa" : null),
    },
    registrar_aprendizado: {
      rotulo: "registrar aprendizado",
      alvos: ["e"],
      combina: true,
      para: (v) => {
        const l = aprendizadosDoPara(v);
        return l.length ? l.map((x) => `${x.tipo === "gostou" ? "gostou" : "não gostou"}: ${x.texto}`).join(" | ") : null;
      },
    },
    ligar_estilo: {
      rotulo: "ligar o estilo",
      alvos: ["e"],
      combina: true,
      trava: (a) => (ativo(a) ? "O estilo já está ligado." : !temGuia(a) && !proposta ? "Ainda não há estilo gravado para ligar." : null),
    },
    desligar_estilo: { rotulo: "desligar o estilo", alvos: ["e"], combina: true, trava: (a) => (ativo(a) ? null : "O estilo já está desligado.") },
    gerar_teste: {
      rotulo: "gerar imagens de teste",
      alvos: ["e"],
      combina: true,
      para: (v) => {
        const p = lerPedidoDeTeste(v);
        return p ? (p.tema ? `${p.n}: ${p.tema}` : String(p.n)) : null;
      },
      trava: (a) => (!temGuia(a) && !proposta ? "Ainda não há estilo para testar." : null),
    },
    usar_referencia: { rotulo: "pôr no estilo", alvos: ["r"] },
    tirar_referencia: { rotulo: "tirar do estilo", alvos: ["s"] },
  };
  const acao = normalizarAcaoDoAgente(bruto, alvos.todos, regras, {
    agente: AGENTE_DO_ESTILO,
    id: opcoes.id,
    contexto: { client_id: opcoes.clientId, marca_id: opcoes.marcaId, ...(proposta ? { proposta } : {}) },
    semDesfazer: (itens) => itens.every((i) => i.operacao === "gerar_teste"),
  });
  if (!acao) return null;
  // Ordem de execução (um item por vez): grava o guia, troca referências, aprende, liga e só então testa.
  const ordem = (op: string) => ORDEM_DE_EXECUCAO.indexOf(op as OperacaoDoEstilo);
  acao.itens.sort((a, b) => ordem(a.operacao) - ordem(b.operacao));
  // Dados da candidata (bucket e caminho) viajam no contexto: o executor não depende do modelo.
  const refs: Record<string, unknown> = {};
  for (const i of acao.itens) {
    if (i.operacao !== "usar_referencia") continue;
    const c = alvos.candidatas.find((x) => x.ref === i.ref);
    if (c) refs[c.id] = { origem: c.dados.origem, bucket: c.dados.bucket, caminho: c.dados.caminho, nome: c.titulo, leitura: c.dados.leitura ?? null };
  }
  if (Object.keys(refs).length) acao.contexto = { ...(acao.contexto || {}), referencias: refs };
  const imagens = acao.itens.filter((i) => i.operacao === "gerar_teste").reduce((s, i) => s + (lerPedidoDeTeste(String(i.para || "1").split(":")[0])?.n || 1), 0);
  if (imagens > 0 && opcoes.custoPorImagem > 0) acao.custo_estimado_usd = Math.round(imagens * opcoes.custoPorImagem * 1e4) / 1e4;
  return acao;
}
