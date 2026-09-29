/**
 * Ações do diretor de marca (agente da Mesa Identidade, papel `identidade`),
 * no contrato comum (_shared/acoes-do-agente.ts): apelidos, cartão com
 * Confirmar e custo antes, item a item, Desfazer.
 *
 * - Na hora, com Desfazer (ordem clara e sem custo): concluir etapa, escolher
 *   nome, escolher caminho, montar o brandbook.
 * - Com Confirmar: gerar nomes e gerar caminhos (IA, custo no cartão), enviar
 *   o brandbook para aprovação (vai para Arquivos, sem Desfazer) e levar ao
 *   kit da marca (muda o kit; o Desfazer volta o valor de antes).
 *
 * Puro: sem Deno, sem banco (vitest lê o mesmo arquivo).
 */

import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { ehEtapaDaIdentidade, rotuloDaEtapa } from "../_shared/identidade-etapas.ts";

export const OPERACOES_DO_DIRETOR = [
  "concluir_etapa",
  "gerar_nomes",
  "escolher_nome",
  "gerar_conceitos",
  "escolher_caminho",
  "montar_brandbook",
  "enviar_para_aprovacao",
  "aplicar_no_kit",
] as const;

export type OperacaoDoDiretor = (typeof OPERACOES_DO_DIRETOR)[number];

export function regrasDoDiretor(): Record<string, RegraDaOperacao<Alvo>> {
  return {
    concluir_etapa: {
      rotulo: "concluir a etapa",
      alvos: ["p"],
      para: (v) => (ehEtapaDaIdentidade(v) && v !== "inicio" ? v : null),
      direta: true,
    },
    gerar_nomes: {
      rotulo: "gerar nomes",
      alvos: ["p"],
      para: (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 600) || "sem pedido extra",
    },
    escolher_nome: { rotulo: "escolher o nome", alvos: ["n"], direta: true },
    gerar_conceitos: {
      rotulo: "gerar caminhos criativos",
      alvos: ["p"],
      para: (v) => (String(v).trim() === "2" ? "2" : "3"),
    },
    escolher_caminho: { rotulo: "escolher o caminho", alvos: ["c"], direta: true },
    montar_brandbook: {
      rotulo: "montar o brandbook",
      alvos: ["p"],
      para: (v) => (String(v).trim() === "prancha" ? "prancha" : "paginado"),
      direta: true,
    },
    enviar_para_aprovacao: {
      rotulo: "enviar para aprovação",
      alvos: ["b"],
      trava: (a) => (a.dados && a.dados.tem_logo === false ? "O brandbook ainda não tem a logo principal (arquivo real)." : null),
    },
    aplicar_no_kit: { rotulo: "levar ao kit da marca", alvos: ["b", "p"] },
  };
}

export const DESCRICOES_DAS_OPERACOES: Record<OperacaoDoDiretor, string> = {
  concluir_etapa: "fecha a etapa do projeto p1 (para: a etapa, ex.: briefing, pesquisa, naming, conceito, sistema, mockups, guideline, entrega). Só fecha se o mínimo da etapa estiver feito.",
  gerar_nomes: "gera uma rodada de nomes para o projeto p1 (para: o pedido da equipe em uma frase, ou vazio). Usa IA: custo no cartão.",
  escolher_nome: "escolhe o nome nX da última rodada como nome do projeto.",
  gerar_conceitos: "gera os caminhos criativos do projeto p1 (para: 2 ou 3). Usa IA: custo no cartão. Substitui os caminhos atuais (o Desfazer volta os anteriores).",
  escolher_caminho: "escolhe o caminho cX.",
  montar_brandbook: "monta uma versão nova do brandbook do projeto p1 (para: prancha ou paginado).",
  enviar_para_aprovacao: "manda o brandbook b1 em PDF para Arquivos com a revisão da agência (aprovação no painel). Não tem Desfazer.",
  aplicar_no_kit: "leva ao kit da marca a paleta, a tipografia e a logo (prévia PNG) do brandbook b1 (ou do projeto p1).",
};

export const ESQUEMA_DAS_ACOES_DO_DIRETOR = esquemaDasAcoes(OPERACOES_DO_DIRETOR as unknown as string[]);

/** Operações que usam IA (o cartão mostra o custo antes). */
export const OPERACOES_COM_IA: OperacaoDoDiretor[] = ["gerar_nomes", "gerar_conceitos"];

export type AlvosDoDiretor = {
  projeto: Array<AlvoComApelido<Alvo>>;
  caminhos: Array<AlvoComApelido<Alvo>>;
  nomes: Array<AlvoComApelido<Alvo>>;
  brandbook: Array<AlvoComApelido<Alvo>>;
};

/** Os alvos com apelido: p1 (projeto), c1..c3 (caminhos), n1.. (nomes da última rodada), b1 (brandbook atual). */
export function alvosDoDiretor(e: {
  projeto: { id: string; titulo: string; etapa: string } | null;
  caminhos: Array<{ id: string; nome: string; ideia?: string }>;
  rodada: { id: string; candidatos: Array<{ id: string; nome: string; finalista?: boolean; nota?: number | null }> } | null;
  brandbook: { id: string; versao: number; modelo: string; status: string; tem_logo: boolean } | null;
}): AlvosDoDiretor {
  const projeto = e.projeto ? comApelido([{ id: e.projeto.id, titulo: e.projeto.titulo, detalhe: `etapa: ${rotuloDaEtapa(e.projeto.etapa as never)}` }], "p") : [];
  const caminhos = e.projeto ? comApelido(e.caminhos.map((c) => ({ id: `${e.projeto!.id}:${c.id}`, titulo: c.nome, detalhe: (c.ideia || "").slice(0, 140) })), "c") : [];
  const ordenados = e.rodada ? e.rodada.candidatos.slice().sort((a, b) => Number(!!b.finalista) - Number(!!a.finalista)) : [];
  const nomes = e.rodada ? comApelido(ordenados.slice(0, 20).map((c) => ({ id: `${e.rodada!.id}:${c.id}`, titulo: c.nome, detalhe: `${c.finalista ? "finalista" : "candidato"}${typeof c.nota === "number" ? `, nota ${Math.round(c.nota * 100)}` : ""}` })), "n") : [];
  const brandbook = e.brandbook ? comApelido([{ id: e.brandbook.id, titulo: `Brandbook v${e.brandbook.versao}`, detalhe: `${e.brandbook.modelo}, ${e.brandbook.status}`, dados: { tem_logo: e.brandbook.tem_logo } }], "b") : [];
  return { projeto, caminhos, nomes, brandbook };
}

export function blocoDasAcoesDoDiretor(a: AlvosDoDiretor): string {
  return [
    blocoDosAlvos("PROJETO ABERTO", a.projeto, "nenhum projeto aberto; peça para a equipe criar um no Início."),
    blocoDosAlvos("CAMINHOS CRIATIVOS", a.caminhos, "nenhum ainda."),
    blocoDosAlvos("NOMES DA ÚLTIMA RODADA", a.nomes, "nenhuma rodada ainda."),
    blocoDosAlvos("BRANDBOOK ATUAL", a.brandbook, "nenhum ainda."),
    regraDasAcoes(DESCRICOES_DAS_OPERACOES),
  ].join("\n");
}

export function normalizarAcoesDoDiretor(bruto: unknown, a: AlvosDoDiretor, custoPorOperacao: Partial<Record<OperacaoDoDiretor, number>>): AcaoDoAgente | null {
  const todos = ([] as Array<AlvoComApelido<Alvo>>).concat(a.projeto, a.caminhos, a.nomes, a.brandbook);
  const acao = normalizarAcaoDoAgente(bruto, todos, regrasDoDiretor(), {
    agente: "identidade",
    semDesfazer: (itens) => itens.some((i) => i.operacao === "enviar_para_aprovacao"),
    rotuloDoPara: (op, para) => (op === "concluir_etapa" && typeof para === "string" ? rotuloDaEtapa(para as never) : null),
  });
  if (!acao) return null;
  const custo = acao.itens.reduce((s, i) => s + (custoPorOperacao[i.operacao as OperacaoDoDiretor] || 0), 0);
  return { ...acao, custo_estimado_usd: Math.round(custo * 1e6) / 1e6 };
}

/** "Vou gerar", "vou preparar" sem trazer a lista: a resposta não pode prometer sem ação. */
export function respostaPromete(texto: string): boolean {
  return /\b(vou|irei|vamos) (gerar|criar|preparar|montar|fazer|enviar|mandar|escolher|concluir|levar)\b/i.test(String(texto || ""));
}

/** O pedido é sobre nome (a regra aprendida vai para o naming) ou sobre a identidade? */
export function pedidoSobreNome(texto: string): boolean {
  return /\b(nome|nomes|naming|batiz|chamar a marca|dominio|arroba)\b/i.test(String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
}
