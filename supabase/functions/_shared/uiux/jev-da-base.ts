/**
 * O Jev escolhe na base UI UX Pro Max (frente UXM, 30/09/2026). Julgamento é
 * Jev, nunca prompt-e-parse; busca exata, contraste e gráfico ficam no código.
 *
 * Requisição 1 (sempre): Choices em lista completa sobre o mesmo estado, que
 * rodam em paralelo no Jev: produto (192 + nenhum), estilo da base (50 ativos
 * + nenhum), padrão de landing (34 + nenhum), par de fontes (74 + nenhum, só
 * quando o kit não tem fontes) e o preset da casa (11). O Choice aceita até
 * 255 opções (docs.typesafe.ai/api.md, conferido em 30/09/2026).
 *
 * Requisição 2 (só quando precisa): para até 4 estilos candidatos, um Score de
 * encaixe (5 níveis, 0 a 4) e um Noul de "não usar para". No máximo 2
 * requisições por sugestão.
 *
 * A política é código puro, com os pesos e limiares nomeados abaixo. As
 * probabilidades ficam guardadas na sugestão: mudar peso ou escolher o produto
 * à mão não refaz chamada ao Jev. Sem Jev, a pessoa escolhe o produto numa
 * lista com busca e o resto sai das buscas exatas (sugestaoSemJev).
 *
 * Instruções ao Jev em inglês (como as perguntas que já existem no painel); o
 * estado pode ir em português. Sem Deno, sem banco. Sem travessão.
 */

import { perguntaDoPreset, PRESETS_DE_ESTILO, type TipoDeSite } from "../site-biblioteca.ts";
import type { EstiloDeTipo } from "../tipografia-da-marca.ts";
import {
  type BaseParaConsulta,
  chaveDoPar,
  chaveDoProduto,
  estilosAtivos,
  estilosDoProduto,
  naoUsarParaDe,
  noDaChaveDoPar,
  noDaChaveDoProduto,
  padraoDoProduto,
  paresDoProduto,
  parDeOutraEscrita,
  produtoPorId,
} from "./consultas.ts";
import { estilosDeTipoDoHumor, PADROES_POR_TIPO, PRESET_DO_ESTILO } from "./mapeamentos.ts";

/** As formas do Jev (as mesmas de _shared/jev.ts, repetidas porque a tela importa este arquivo e jev.ts usa Deno). */
type PerguntaJev =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: string[] }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };
export type RespostaDoJev = { choice?: string; noul?: number; score?: number; confidence?: number; probabilities?: Record<string, number> };

// ------------------------------------------------------------------ pesos e limiares (ponto de partida; calibrar com 5 a 8 clientes reais)

export const MAX_OPCOES_DO_CHOICE = 255;
/** Tamanho previsto do pedido 1 com as listas completas (tokens), para o custo antes. Medir no uso real. */
export const TOKENS_DA_BASE = 18_000;
/** Pedido 2 (até 4 estilos, Score e Noul). */
export const TOKENS_DO_RERANK = 3_500;
export const NENHUM = "nenhum";
/** Produto: o mais provável entra sozinho a partir desta probabilidade; abaixo, a tela mostra os 3 mais prováveis. */
export const LIMIAR_DO_PRODUTO = 0.3;
/** Estilo: nota = 0,55 x prob + 0,25 se principal do produto + 0,10 se secundário + 0,10 x prob do preset ligado. */
export const PESO_DA_PROBABILIDADE = 0.55;
export const BONUS_DO_PRINCIPAL = 0.25;
export const BONUS_DO_SECUNDARIO = 0.1;
export const PESO_DO_PRESET_LIGADO = 0.1;
/** Rerank: pede a requisição 2 quando os 2 primeiros ficam a menos disto ou algum dos 4 primeiros tem "não usar para". */
export const DISTANCIA_PARA_RERANK = 0.1;
export const MAX_NO_RERANK = 4;
/** Depois do rerank: nota final = 0,4 x nota + 0,6 x (Score / 4); sai quem tem Noul de evitar a partir de 0,6. */
export const PESO_DA_NOTA = 0.4;
export const PESO_DO_SCORE = 0.6;
export const LIMIAR_DO_EVITAR = 0.6;
/** Padrão: prob + 0,20 se é o padrão do produto. Par: prob + 0,20 se o humor casa com o produto + 0,10 se casa com a personalidade. */
export const BONUS_DO_PADRAO_DO_PRODUTO = 0.2;
export const BONUS_DO_HUMOR_DO_PAR = 0.2;
export const BONUS_DO_ESTILO_DE_TIPO = 0.1;
export const QUANTOS_NA_TELA = 3;

export const NIVEIS_DO_ENCAIXE = [
  "contradicts the brand: clashes with its tone, audience or offer",
  "weak fit: more wrong than right for this brand",
  "neutral: could work, but says little about this brand",
  "good fit: matches the brand's tone and audience",
  "signature fit: looks made for this brand",
];

// ------------------------------------------------------------------ estado

export type EstadoDaBase = {
  marca: { nome: string; negocio?: string | null; publico?: string | null; oferta?: string | null; tom?: string | null; diferenciais?: string[]; arquetipo?: string | null; eixos?: Record<string, number> | null };
  site?: { tipo?: string | null; nicho?: string | null; objetivo?: string | null; evitar?: string | null } | null;
  briefing?: Record<string, string> | null;
  referencias?: string | null;
  kit: { tem_paleta: boolean; tem_fontes: boolean };
};

const corta = (s: unknown, n: number) => {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/[\s,;:]+$/, "")}…` : t;
};

// ------------------------------------------------------------------ requisição 1

export type OpcoesDasPerguntas = { produto?: boolean; estilo?: boolean; padrao?: boolean; par?: boolean; preset?: boolean };

/**
 * As perguntas da requisição 1, sobre o mesmo estado. `par` sai quando o kit
 * já tem fontes (não sugere o que a marca já decidiu); a Identidade pede só
 * produto e par.
 */
export function perguntasDaBase(base: BaseParaConsulta & { pares?: NonNullable<BaseParaConsulta["pares"]> }, opcoes: OpcoesDasPerguntas = {}): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  const quer = (k: keyof OpcoesDasPerguntas) => opcoes[k] !== false;
  if (quer("produto")) {
    const criteria: Record<string, string> = {};
    for (const p of base.produtos) {
      const palavras = (p as { palavras?: string }).palavras;
      criteria[chaveDoProduto(p.no)] = corta(palavras ? `${p.nome}: ${palavras}` : p.nome, 140);
    }
    criteria[NENHUM] = "none of these product or business types fits";
    q.produto = {
      type: "choice",
      instructions: "Which product or business type from the list best describes this client's business (state.marca, state.briefing, state.site)? Judge the business itself, not the style it wants. Choose nenhum if none fits.",
      criteria,
    };
  }
  if (quer("estilo")) {
    const criteria: Record<string, string> = {};
    for (const e of estilosAtivos(base)) {
      const nao = naoUsarParaDe(e);
      criteria[e.id] = corta(`${e.nome}. Best for: ${e.melhorPara}${nao ? `. Not for: ${nao}` : ""}`, 200);
    }
    criteria[NENHUM] = "none of these visual styles fits";
    q.estilo_da_base = {
      type: "choice",
      instructions: "Which visual style from the list best fits this brand's personality and audience for its website (state.marca, state.briefing, state.referencias)? The brand palette, fonts and logo are kept either way: judge only the style. Choose nenhum if none fits.",
      criteria,
    };
  }
  if (quer("padrao")) {
    const criteria: Record<string, string> = {};
    for (const p of base.padroes) criteria[p.id] = corta(`${p.nome}: ${p.ordem} (CTA: ${p.cta})`, 200);
    criteria[NENHUM] = "none of these page structures fits";
    q.padrao = {
      type: "choice",
      instructions: "Which landing page structure from the list best serves this website's goal and the visitor's next step (state.site, state.briefing)? Choose nenhum if none fits.",
      criteria,
    };
  }
  if (quer("par") && base.pares) {
    const criteria: Record<string, string> = {};
    for (const p of base.pares) criteria[chaveDoPar(p.no)] = corta(`${p.nome}: ${p.titulo} + ${p.texto}. Mood: ${p.humor}. Best for: ${p.melhorPara}`, 200);
    criteria[NENHUM] = "none of these font pairings fits";
    q.par = {
      type: "choice",
      instructions: "Which font pairing (heading + body) best fits this brand's tone, personality and audience (state.marca, state.briefing)? The site is written in Brazilian Portuguese. Choose nenhum if none fits.",
      criteria,
    };
  }
  if (quer("preset")) {
    const p = perguntaDoPreset().preset;
    q.preset = {
      type: "choice",
      instructions: "Which visual style preset best fits this brand (state.marca), its website (state.site) and what the reference websites show (state.referencias)? The brand palette is kept either way.",
      criteria: p.type === "choice" ? p.criteria : Object.fromEntries(PRESETS_DE_ESTILO.map((x) => [x.id, x.descricao])),
    };
  }
  return q;
}

/** Quantas opções cada pergunta leva (o teste confere o teto de 255). */
export const opcoesDasPerguntas = (q: Record<string, PerguntaJev>) =>
  Object.keys(q).reduce((o: Record<string, number>, k) => {
    const x = q[k];
    o[k] = x.type === "choice" ? Object.keys(x.criteria).length : 0;
    return o;
  }, {});

/** As probabilidades que ficam guardadas na sugestão (por pergunta). */
export function probabilidadesDasRespostas(answers: Record<string, RespostaDoJev>): Record<string, Record<string, number>> {
  const saida: Record<string, Record<string, number>> = {};
  for (const k of Object.keys(answers || {})) {
    const r = answers[k];
    if (r && r.probabilities && typeof r.probabilities === "object") {
      const m: Record<string, number> = {};
      for (const o of Object.keys(r.probabilities)) {
        const n = r.probabilities[o];
        if (typeof n === "number" && isFinite(n)) m[o] = Math.round(n * 10000) / 10000;
      }
      saida[k] = m;
    } else if (r && typeof r.choice === "string") saida[k] = { [r.choice]: typeof r.confidence === "number" ? r.confidence : 1 };
    if (r && typeof r.score === "number") saida[k] = { ...(saida[k] || {}), score: r.score };
    if (r && typeof r.noul === "number") saida[k] = { ...(saida[k] || {}), noul: r.noul };
  }
  return saida;
}

// ------------------------------------------------------------------ política

export type CandidatoDeEstilo = { id: string; nota: number; prob: number; principal: boolean; secundario: boolean; preset: string | null };
export type CandidatoSimples = { id: string; nota: number; prob: number };

export type SugestaoDaBase = {
  produto: { escolhido: { id: string; prob: number } | null; top: Array<{ id: string; prob: number }>; escolher_a_mao: boolean };
  estilos: CandidatoDeEstilo[];
  padroes: CandidatoSimples[];
  pares: CandidatoSimples[] | null;
  preset: { id: string; prob: number } | null;
  rerank: boolean;
};

const top = (m: Record<string, number> | undefined, n: number, filtro?: (k: string) => boolean) =>
  Object.keys(m || {})
    .filter((k) => k !== NENHUM && k !== "score" && k !== "noul" && (!filtro || filtro(k)))
    .map((k) => ({ id: k, prob: (m as Record<string, number>)[k] }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, n);

export type ContextoDaPolitica = {
  /** Produto escolhido à mão (vence o Jev). */
  produtoDaEquipe?: string | null;
  tipo?: TipoDeSite | string | null;
  kitTemFontes?: boolean;
  /** Estilos de tipo da personalidade (arquétipo e eixos da Identidade). */
  estilosDaPersonalidade?: EstiloDeTipo[];
};

/** O produto que manda nos bônus: o da equipe, senão o do Jev acima do limiar. */
export function produtoDaSugestao(probs: Record<string, Record<string, number>>, ctx: ContextoDaPolitica): SugestaoDaBase["produto"] {
  const lista = top(probs.produto, QUANTOS_NA_TELA).map((x) => ({ id: noDaChaveDoProduto(x.id) || x.id, prob: x.prob }));
  if (ctx.produtoDaEquipe) return { escolhido: { id: ctx.produtoDaEquipe, prob: 1 }, top: lista, escolher_a_mao: false };
  const pNenhum = probs.produto ? probs.produto[NENHUM] || 0 : 0;
  const primeiro = lista[0];
  const escolhido = primeiro && primeiro.prob >= LIMIAR_DO_PRODUTO && primeiro.prob > pNenhum ? primeiro : null;
  return { escolhido, top: lista, escolher_a_mao: !escolhido };
}

/** Estilos com a nota da política (todos os ativos, da maior para a menor). */
export function notasDosEstilos(base: BaseParaConsulta, probs: Record<string, Record<string, number>>, produtoNo: string | null): CandidatoDeEstilo[] {
  const produto = produtoNo ? produtoPorId(base, produtoNo) : null;
  const { principais, secundarios } = estilosDoProduto(base, produto);
  const pEstilo = probs.estilo_da_base || {};
  const pPreset = probs.preset || {};
  return estilosAtivos(base)
    .map((e) => {
      const prob = pEstilo[e.id] || 0;
      const lig = PRESET_DO_ESTILO[e.id];
      const principal = principais.indexOf(e.id) >= 0;
      const secundario = !principal && secundarios.indexOf(e.id) >= 0;
      const nota = PESO_DA_PROBABILIDADE * prob + (principal ? BONUS_DO_PRINCIPAL : 0) + (secundario ? BONUS_DO_SECUNDARIO : 0) + PESO_DO_PRESET_LIGADO * (lig ? pPreset[lig.preset] || 0 : 0);
      return { id: e.id, nota: Math.round(nota * 10000) / 10000, prob, principal, secundario, preset: lig ? lig.preset : null };
    })
    .sort((a, b) => b.nota - a.nota);
}

/** Os candidatos que pedem a requisição 2 (vazio = não precisa). */
export function candidatosDoRerank(base: BaseParaConsulta, estilos: CandidatoDeEstilo[]): string[] {
  const primeiros = estilos.slice(0, MAX_NO_RERANK);
  if (!primeiros.length) return [];
  const perto = primeiros.length > 1 && primeiros[0].nota - primeiros[1].nota < DISTANCIA_PARA_RERANK;
  const comNao = primeiros.some((c) => !!naoUsarParaDe(base.estilos.filter((e) => e.id === c.id)[0] || null));
  return perto || comNao ? primeiros.map((c) => c.id) : [];
}

/** Perguntas da requisição 2: Score de encaixe e Noul de evitar por candidato. */
export function perguntasDoRerank(base: BaseParaConsulta, ids: string[]): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const id of ids.slice(0, MAX_NO_RERANK)) {
    const e = base.estilos.filter((x) => x.id === id)[0];
    if (!e) continue;
    const nao = naoUsarParaDe(e);
    q[`encaixe_${id}`] = {
      type: "score",
      instructions: `How well does the website style "${e.nome}" (best for: ${corta(e.melhorPara, 160)}) fit this brand (state.marca), its audience and its briefing (state.briefing)?`,
      criteria: NIVEIS_DO_ENCAIXE.slice(),
    };
    q[`evitar_${id}`] = {
      type: "noul",
      instructions: `This brand falls into a case where the style "${e.nome}" should not be used${nao ? ` (not for: ${corta(nao, 200)})` : ""}, or the style conflicts with what the briefing says to avoid (state.briefing.evitar, state.site.evitar).`,
      criteria: { true: "the brand falls into a case to avoid", false: "no conflict with the cases to avoid" },
    };
  }
  return q;
}

/** Aplica o rerank guardado (encaixe_<id> com score, evitar_<id> com noul) sobre as notas. */
export function aplicarRerank(estilos: CandidatoDeEstilo[], probs: Record<string, Record<string, number>>): CandidatoDeEstilo[] {
  return estilos
    .map((c) => {
      const s = probs[`encaixe_${c.id}`];
      const ev = probs[`evitar_${c.id}`];
      if (ev && typeof ev.noul === "number" && ev.noul >= LIMIAR_DO_EVITAR) return null;
      if (!s || typeof s.score !== "number") return c;
      const nota = PESO_DA_NOTA * c.nota + PESO_DO_SCORE * (Math.max(0, Math.min(4, s.score)) / 4);
      return { ...c, nota: Math.round(nota * 10000) / 10000 };
    })
    .filter((c): c is CandidatoDeEstilo => !!c)
    .sort((a, b) => b.nota - a.nota);
}

export function notasDosPadroes(base: BaseParaConsulta, probs: Record<string, Record<string, number>>, produtoNo: string | null, tipo?: string | null): CandidatoSimples[] {
  const produto = produtoNo ? produtoPorId(base, produtoNo) : null;
  const doProduto = padraoDoProduto(base, produto);
  const permitidos = tipo && (PADROES_POR_TIPO as Record<string, string[]>)[tipo] ? (PADROES_POR_TIPO as Record<string, string[]>)[tipo] : null;
  const p = probs.padrao || {};
  return base.padroes
    .filter((x) => !permitidos || permitidos.indexOf(x.id) >= 0)
    .map((x) => {
      const prob = p[x.id] || 0;
      const nota = prob + (doProduto && doProduto.id === x.id ? BONUS_DO_PADRAO_DO_PRODUTO : 0);
      return { id: x.id, nota: Math.round(nota * 10000) / 10000, prob };
    })
    .sort((a, b) => b.nota - a.nota);
}

export function notasDosPares(base: BaseParaConsulta, probs: Record<string, Record<string, number>>, produtoNo: string | null, estilosDaPersonalidade: EstiloDeTipo[] = []): CandidatoSimples[] {
  const produto = produtoNo ? produtoPorId(base, produtoNo) : null;
  const r = produto ? base.raciocinio.filter((x) => x.no === produto.no)[0] : null;
  const doProduto = r ? estilosDeTipoDoHumor(r.humorDeTipo) : [];
  const p = probs.par || {};
  return (base.pares || [])
    .filter((x) => !parDeOutraEscrita(x))
    .map((x) => {
      const prob = p[chaveDoPar(x.no)] || 0;
      const humor = estilosDeTipoDoHumor(`${x.humor} ${x.melhorPara}`);
      const casaProduto = humor.some((h) => doProduto.indexOf(h) >= 0);
      const casaPersonalidade = humor.some((h) => estilosDaPersonalidade.indexOf(h) >= 0);
      const nota = prob + (casaProduto ? BONUS_DO_HUMOR_DO_PAR : 0) + (casaPersonalidade ? BONUS_DO_ESTILO_DE_TIPO : 0);
      return { id: x.no, nota: Math.round(nota * 10000) / 10000, prob };
    })
    .sort((a, b) => b.nota - a.nota);
}

/**
 * A sugestão pela política, a partir das probabilidades guardadas (da
 * requisição 1 e, se houve, da 2). Os 3 primeiros de cada; o primeiro já
 * marcado na tela.
 */
export function sugestaoDaBase(base: BaseParaConsulta, probs: Record<string, Record<string, number>>, ctx: ContextoDaPolitica = {}): SugestaoDaBase {
  const produto = produtoDaSugestao(probs, ctx);
  const produtoNo = produto.escolhido ? produto.escolhido.id : null;
  let estilos = notasDosEstilos(base, probs, produtoNo);
  const houveRerank = Object.keys(probs).some((k) => k.indexOf("encaixe_") === 0 || k.indexOf("evitar_") === 0);
  if (houveRerank) estilos = aplicarRerank(estilos, probs);
  const presetTop = top(probs.preset, 1, (k) => PRESETS_DE_ESTILO.some((p) => p.id === k))[0] || null;
  return {
    produto,
    estilos: estilos.slice(0, QUANTOS_NA_TELA),
    padroes: notasDosPadroes(base, probs, produtoNo, ctx.tipo).slice(0, QUANTOS_NA_TELA),
    pares: ctx.kitTemFontes ? null : notasDosPares(base, probs, produtoNo, ctx.estilosDaPersonalidade || []).slice(0, QUANTOS_NA_TELA),
    preset: presetTop ? { id: presetTop.id, prob: presetTop.prob } : null,
    rerank: houveRerank,
  };
}

/**
 * Sem o Jev (sem chave ou com erro): a pessoa escolheu o produto na lista e o
 * resto sai das buscas exatas (estilos do produto, padrão do produto, pares
 * pelo humor, preset ligado ao primeiro estilo).
 */
export function sugestaoSemJev(base: BaseParaConsulta, produtoNo: string | null, ctx: ContextoDaPolitica = {}): SugestaoDaBase {
  const produto = produtoNo ? produtoPorId(base, produtoNo) : null;
  const { principais, secundarios } = estilosDoProduto(base, produto);
  const estilos: CandidatoDeEstilo[] = principais
    .map((id) => ({ id, nota: BONUS_DO_PRINCIPAL, prob: 0, principal: true, secundario: false, preset: PRESET_DO_ESTILO[id] ? PRESET_DO_ESTILO[id].preset : null }))
    .concat(secundarios.map((id) => ({ id, nota: BONUS_DO_SECUNDARIO, prob: 0, principal: false, secundario: true, preset: PRESET_DO_ESTILO[id] ? PRESET_DO_ESTILO[id].preset : null })))
    .slice(0, QUANTOS_NA_TELA);
  const padrao = padraoDoProduto(base, produto);
  const permitidos = ctx.tipo && (PADROES_POR_TIPO as Record<string, string[]>)[ctx.tipo] ? (PADROES_POR_TIPO as Record<string, string[]>)[ctx.tipo] : null;
  const pares = ctx.kitTemFontes ? null : paresDoProduto(base, produto, ctx.estilosDaPersonalidade || []).slice(0, QUANTOS_NA_TELA).map((x) => ({ id: x.par.no, nota: x.encaixe, prob: 0 }));
  const presetId = estilos[0] && estilos[0].preset;
  return {
    produto: { escolhido: produto ? { id: produto.no, prob: 1 } : null, top: [], escolher_a_mao: !produto },
    estilos,
    padroes: padrao && (!permitidos || permitidos.indexOf(padrao.id) >= 0) ? [{ id: padrao.id, nota: BONUS_DO_PADRAO_DO_PRODUTO, prob: 0 }] : [],
    pares,
    preset: presetId ? { id: presetId, prob: 0 } : null,
    rerank: false,
  };
}

export const MENSAGEM_SEM_JEV = "Escolha à mão: o Jev não respondeu.";
