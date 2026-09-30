/**
 * Memória editorial do cliente (frente AP, 27/09/2026).
 *
 * Pedido do dono: "memória de conteúdos no mês para NUNCA repetir, mas
 * podendo criar ÂNGULOS diferentes depois, sempre em SEQUÊNCIA de evolução,
 * entendendo os NÚMEROS da vida real e os MELHORES posts".
 *
 * PURO (sem Deno, sem banco, sem IA): o agente do Mês, a tela do Mês e o
 * Vitest usam as mesmas regras.
 *
 * - montarMemoriaEditorial: todos os temas do cliente (planejados nas
 *   propostas, gravados na agenda e publicados, com os números reais), com
 *   apelidos E1..En (E1 o mais recente).
 * - blocoDaMemoriaEditorial: o texto que o agente do Mês recebe, com teto,
 *   as regras (não repetir, ângulo novo com a relação marcada, priorizar o
 *   que funcionou, dizendo por quê com o número).
 * - candidatosParecidos + perguntasDeRepeticao + decidirEvolucao: a checagem
 *   de repetição em código e, quando há parecido, um Choice do Jev
 *   (repetição / mesmo tema com ângulo novo / tema diferente) e outro que diz
 *   de qual post. Sem laço: a pauta repetida volta marcada, com o aviso, e a
 *   equipe troca o ângulo só dela.
 * - linhasDeEvolucao: as pautas ligadas, por pilar (tela do Mês).
 *
 * Sem travessão, sem lookbehind, sem \p{}: o painel importa este arquivo.
 */

import { medirPosts, normalizado, pctBr, type PostComNumeros, type PosicaoNoPerfil } from "../../_shared/aprendizado-continuo.ts";

// ------------------------------------------------------------------ tipos

export type OrigemEditorial = "planejado" | "gravado" | "publicado";

export type NumerosDoPost = {
  alcance: number;
  salvos: number;
  compartilhamentos: number;
  comentarios: number;
  /** (salvamentos + compartilhamentos) / alcance, em %. */
  taxa: number;
  posicao: PosicaoNoPerfil;
};

export type TemaDaMemoria = {
  apelido: string;
  /** Chave principal (task:<id>, prop:<proposta>:<tema>, post:<mídia>). */
  chave: string;
  /** Todas as chaves que apontam para este tema (a pauta gravada tem a da proposta e a da agenda). */
  chaves: string[];
  origem: OrigemEditorial;
  data: string | null;
  formato: string;
  pilar: string;
  tema: string;
  angulo: string;
  gancho: string;
  task_id: string | null;
  numeros: NumerosDoPost | null;
  /** Chave do tema que este continua (sequência de evolução). */
  continua: string | null;
};

export type MemoriaEditorial = {
  temas: TemaDaMemoria[];
  melhores: TemaDaMemoria[];
  /** "estático: média 0,8% contra 3,2% do carrossel (6 e 9 posts)". */
  formatosAbaixo: string[];
};

export type TipoDeEvolucao = "tema_novo" | "novo_angulo" | "repeticao";

export type EvolucaoDaPauta = {
  tipo: TipoDeEvolucao;
  angulo: string | null;
  de: { chave: string; data: string | null; tema: string; angulo: string | null; origem: OrigemEditorial } | null;
  frase: string;
  aviso: string | null;
  jev: { checado: boolean; probabilidade: number | null };
};

// ------------------------------------------------------------------ utilidades

const umaLinha = (v: unknown, max: number): string => {
  const s = String(v == null ? "" : v).replace(/[—–]/g, ",").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataIso = (v: unknown): string | null => {
  const s = String(v == null ? "" : v).slice(0, 10);
  return DATA.test(s) ? s : null;
};
export const dataCurtaBr = (iso: string | null | undefined) => (iso && DATA.test(iso.slice(0, 10)) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

const FORMATO_DA_MIDIA: Record<string, string> = { CAROUSEL_ALBUM: "carrossel", IMAGE: "estático", VIDEO: "reels", REELS: "reels" };
const FORMATO_DA_TAREFA: Record<string, string> = { carousel: "carrossel", static: "estático", design: "estático", reel: "reels", video: "vídeo", story: "story", short: "reels" };
const formatoLegivel = (f: unknown) => {
  const s = String(f || "").trim();
  if (!s) return "";
  if (s === "estatico") return "estático";
  return FORMATO_DA_MIDIA[s.toUpperCase()] || FORMATO_DA_TAREFA[s] || s;
};

/** Primeira frase da legenda como tema do post publicado fora do painel. */
function temaDaLegenda(caption: string | null | undefined): string {
  const s = String(caption || "").replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const corte = s.search(/[.!?\n]/);
  return umaLinha(corte > 12 ? s.slice(0, corte) : s, 110);
}

// ------------------------------------------------------------------ montar a memória

export type PropostaParaMemoria = { id: string; status?: string | null; criado_em?: string | null; itens?: unknown };
export type TarefaParaMemoria = { id: string; title?: string | null; due_date?: string | null; delivery_type?: string | null; status?: string | null };
/** Publicação ligada à tarefa (editorial_post_internal.task_id). */
export type PublicacaoParaMemoria = { task_id?: string | null; external_post_id?: string | null; permalink?: string | null; published_at?: string | null };

export const MAX_TEMAS_NA_MEMORIA = 150;

/** Chaves de uma pauta da proposta (a da proposta e, gravada, a da agenda). */
export function chavesDaPauta(propostaId: string, item: { tema_id?: unknown; task_id?: unknown }): string[] {
  const c: string[] = [];
  if (typeof item.task_id === "string" && item.task_id) c.push(`task:${item.task_id}`);
  if (item.tema_id != null && String(item.tema_id)) c.push(`prop:${propostaId}:${String(item.tema_id)}`);
  return c;
}

/**
 * Todos os temas do cliente, de todos os meses: pautas das propostas (menos
 * as descartadas), itens da agenda que não vieram de proposta, e os posts
 * publicados com os números (os da agenda e os publicados fora do painel).
 */
export function montarMemoriaEditorial(e: {
  propostas?: PropostaParaMemoria[] | null;
  tarefas?: TarefaParaMemoria[] | null;
  publicacoes?: PublicacaoParaMemoria[] | null;
  posts?: PostComNumeros[] | null;
  /** Itens da agenda apagados (arquivados): a pauta deles não conta (o refazer tira a peça antes de gerar a nova). */
  tarefasArquivadas?: string[] | null;
  agora?: Date;
  max?: number;
}): MemoriaEditorial {
  const agora = e.agora ?? new Date();
  const medidos = medirPosts(e.posts || [], agora);
  const numerosPorMidia = new Map<string, NumerosDoPost>();
  const numerosPorLink = new Map<string, NumerosDoPost>();
  for (const p of medidos) {
    const n: NumerosDoPost = { alcance: p.alcance, salvos: p.salvos, compartilhamentos: p.compartilhamentos, comentarios: p.comentarios, taxa: Math.round(p.taxa * 1000) / 1000, posicao: p.posicao };
    numerosPorMidia.set(p.media_id, n);
    if (p.permalink) numerosPorLink.set(p.permalink.replace(/\/+$/, ""), n);
  }
  const temas: TemaDaMemoria[] = [];
  const porChave = new Map<string, TemaDaMemoria>();
  const guardar = (t: TemaDaMemoria) => {
    if (t.chaves.some((c) => porChave.has(c))) return;
    temas.push(t);
    for (const c of t.chaves) porChave.set(c, t);
  };

  const arquivadas = new Set(e.tarefasArquivadas || []);
  for (const p of e.propostas || []) {
    if (!p || !p.id || p.status === "descartada") continue;
    for (const bruto of Array.isArray(p.itens) ? p.itens : []) {
      const it = obj(bruto);
      const tema = umaLinha(it.tema, 160);
      if (!tema) continue;
      if (typeof it.task_id === "string" && arquivadas.has(it.task_id)) continue;
      const chaves = chavesDaPauta(p.id, it);
      if (!chaves.length) continue;
      const ev = obj(it.evolucao);
      const de = obj(ev.de);
      guardar({
        apelido: "",
        chave: chaves[0],
        chaves,
        origem: typeof it.task_id === "string" && it.task_id ? "gravado" : "planejado",
        data: dataIso(it.data),
        formato: formatoLegivel(it.formato),
        pilar: umaLinha(it.pilar, 80),
        tema,
        angulo: umaLinha(it.angulo || ev.angulo, 80),
        gancho: umaLinha(it.gancho, 140),
        task_id: typeof it.task_id === "string" && it.task_id ? it.task_id : null,
        numeros: null,
        continua: typeof de.chave === "string" && de.chave ? de.chave : null,
      });
    }
  }
  for (const t of e.tarefas || []) {
    if (!t || !t.id) continue;
    const tema = umaLinha(t.title, 160);
    if (!tema) continue;
    guardar({
      apelido: "", chave: `task:${t.id}`, chaves: [`task:${t.id}`], origem: "gravado", data: dataIso(t.due_date), formato: formatoLegivel(t.delivery_type),
      pilar: "", tema, angulo: "", gancho: "", task_id: t.id, numeros: null, continua: null,
    });
  }
  // Publicadas pelo painel: o tema da agenda ganha os números e a data do ar.
  const midiasLigadas = new Set<string>();
  for (const pub of e.publicacoes || []) {
    if (!pub || !pub.task_id) continue;
    const t = porChave.get(`task:${pub.task_id}`);
    if (!t) continue;
    const n = (pub.external_post_id && numerosPorMidia.get(String(pub.external_post_id))) || (pub.permalink && numerosPorLink.get(String(pub.permalink).replace(/\/+$/, ""))) || null;
    t.origem = "publicado";
    if (pub.published_at) t.data = dataIso(pub.published_at) || t.data;
    if (n) t.numeros = n;
    if (pub.external_post_id) midiasLigadas.add(String(pub.external_post_id));
    if (pub.permalink) midiasLigadas.add(String(pub.permalink).replace(/\/+$/, ""));
  }
  // Publicadas fora do painel (ou sem vínculo): entram pela legenda, com os números.
  for (const p of e.posts || []) {
    if (!p || !p.media_id) continue;
    const link = p.permalink ? String(p.permalink).replace(/\/+$/, "") : "";
    if (midiasLigadas.has(String(p.media_id)) || (link && midiasLigadas.has(link))) continue;
    const tema = temaDaLegenda(p.caption);
    if (!tema) continue;
    guardar({
      apelido: "", chave: `post:${p.media_id}`, chaves: [`post:${p.media_id}`], origem: "publicado", data: dataIso(p.posted_at), formato: formatoLegivel(p.media_type),
      pilar: "", tema, angulo: "", gancho: "", task_id: null, numeros: numerosPorMidia.get(String(p.media_id)) || null, continua: null,
    });
  }
  const ordenados = temas
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))
    .slice(0, Math.max(1, e.max ?? MAX_TEMAS_NA_MEMORIA));
  ordenados.forEach((t, i) => (t.apelido = `E${i + 1}`));
  const melhores = ordenados.filter((t) => t.numeros && t.numeros.posicao === "topo").sort((a, b) => b.numeros!.taxa - a.numeros!.taxa).slice(0, 3);
  return { temas: ordenados, melhores, formatosAbaixo: formatosQueRendemAbaixo(medidos.map((p) => ({ formato: formatoLegivel(p.media_type), taxa: p.taxa }))) };
}

/** Formatos com taxa média bem menor que o melhor (2 posts ou mais de cada), com o número. */
export function formatosQueRendemAbaixo(l: Array<{ formato: string; taxa: number }>): string[] {
  const g = new Map<string, number[]>();
  for (const x of l) if (x.formato) g.set(x.formato, (g.get(x.formato) || []).concat([x.taxa]));
  const medias = Array.from(g.entries()).filter(([, v]) => v.length >= 2).map(([f, v]) => ({ f, n: v.length, m: v.reduce((s, y) => s + y, 0) / v.length })).sort((a, b) => b.m - a.m);
  if (medias.length < 2) return [];
  const melhor = medias[0];
  return medias.slice(1).filter((x) => melhor.m > 0 && melhor.m / Math.max(x.m, 0.0001) >= 1.5).map((x) =>
    `${x.f}: média de ${pctBr(x.m, 1)} de salvamentos e compartilhamentos por alcance, contra ${pctBr(melhor.m, 1)} de ${melhor.f} (${x.n} e ${melhor.n} posts)`
  );
}

// ------------------------------------------------------------------ bloco do prompt

export const TETO_DA_MEMORIA_EDITORIAL = 12_000;
export const TETO_DA_MEMORIA_EDITORIAL_ENXUTA = 5_000;

export const REGRAS_DA_MEMORIA_EDITORIAL = [
  "Regras da memória editorial:",
  "(a) NUNCA repita um tema com o mesmo ângulo de um item da memória.",
  "(b) Pode voltar a um tema com ÂNGULO NOVO quando fizer sentido: preencha continua_de com o apelido do item (ex.: E7) e angulo com o passo novo (o passo seguinte, o erro comum, o caso real, a objeção, a prova, o aprofundamento), formando uma sequência de evolução (do básico ao avançado, do problema à solução, da dúvida à prova). Tema novo: continua_de null.",
  "(c) Priorize temas e ângulos parecidos com os MELHORES POSTS REAIS e evite os FORMATOS QUE RENDEM ABAIXO; quando isso guiar a escolha, diga em 1 frase por quê, com o número (em por_que ou resumo).",
].join("\n");

const linhaDoTema = (t: TemaDaMemoria, enxuto: boolean): string => {
  const partes = [
    t.apelido,
    t.data || "sem data",
    t.formato || "",
    t.origem,
    t.pilar ? `pilar ${t.pilar}` : "",
    umaLinha(t.tema, enxuto ? 80 : 110),
    t.angulo ? `ângulo ${t.angulo}` : "",
    !enxuto && t.gancho ? `gancho ${umaLinha(t.gancho, 90)}` : "",
    t.numeros ? `${pctBr(t.numeros.taxa, 1)} salvos e compart., ${Math.round(t.numeros.alcance)} de alcance${t.numeros.posicao !== "meio" ? ` (${t.numeros.posicao})` : ""}` : "",
  ].filter(Boolean);
  return partes.join(" | ");
};

/**
 * O bloco da memória editorial para o agente do Mês, com teto (corta os
 * temas mais antigos, sempre em linha inteira). Sem tema nenhum: "" (o pedido
 * fica como antes).
 */
export function blocoDaMemoriaEditorial(m: MemoriaEditorial | null | undefined, opcoes: { teto?: number; enxuto?: boolean } = {}): string {
  if (!m || !m.temas.length) return "";
  const enxuto = opcoes.enxuto === true;
  const teto = Math.max(1_000, opcoes.teto ?? (enxuto ? TETO_DA_MEMORIA_EDITORIAL_ENXUTA : TETO_DA_MEMORIA_EDITORIAL));
  const cabeca = [
    "MEMÓRIA EDITORIAL DO CLIENTE (todos os temas já planejados, gravados e publicados; E1 é o mais recente; números reais quando publicado)",
    REGRAS_DA_MEMORIA_EDITORIAL,
    m.melhores.length
      ? `MELHORES POSTS REAIS: ${m.melhores.map((t) => `${t.apelido} "${umaLinha(t.tema, 70)}" (${pctBr(t.numeros!.taxa, 1)} de salvamentos e compartilhamentos por alcance, ${Math.round(t.numeros!.alcance)} de alcance)`).join("; ")}`
      : "",
    m.formatosAbaixo.length ? `FORMATOS QUE RENDEM ABAIXO: ${m.formatosAbaixo.join("; ")}` : "",
    "TEMAS:",
  ].filter(Boolean).join("\n");
  const linhas: string[] = [];
  let tamanho = cabeca.length;
  const reserva = 70;
  let fora = 0;
  for (const t of m.temas) {
    const l = linhaDoTema(t, enxuto);
    if (tamanho + 1 + l.length > teto - reserva) {
      fora++;
      continue;
    }
    linhas.push(l);
    tamanho += 1 + l.length;
  }
  return [cabeca, ...linhas, fora ? `(+${fora} temas mais antigos fora por espaço)` : ""].filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ parecidos (em código)

const PALAVRAS_VAZIAS = new Set(
  ("a o as os um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem que se ao aos sua seu suas seus " +
    "como mais menos muito muita voce voces nao sim ja e ou mas porque quando qual quais isso esse essa este esta aqui ali la " +
    "tem ter ser estar faz fazer pode podem vai vao seu sobre entre ate apos antes depois nosso nossa nossos nossas cada tudo todo toda todos todas " +
    "dia dias hoje agora sempre nunca vez vezes coisa coisas jeito forma melhor melhores dica dicas post posts conteudo")
    .split(" "),
);

/** Palavras que carregam o tema (sem acento, sem as vazias, singular simples). */
export function palavrasDoTema(s: string): string[] {
  const saida: string[] = [];
  for (const p0 of normalizado(s).split(" ")) {
    if (p0.length < 3 || PALAVRAS_VAZIAS.has(p0)) continue;
    const p = p0.length > 4 && p0.charAt(p0.length - 1) === "s" ? p0.slice(0, -1) : p0;
    if (saida.indexOf(p) < 0) saida.push(p);
  }
  return saida;
}

/** Sobreposição de palavras do tema (0 a 1) e quantas em comum. */
export function semelhanca(a: string, b: string): { indice: number; comuns: number } {
  const A = palavrasDoTema(a);
  const B = palavrasDoTema(b);
  if (!A.length || !B.length) return { indice: 0, comuns: 0 };
  const comuns = A.filter((p) => B.indexOf(p) >= 0).length;
  return { indice: comuns / Math.min(A.length, B.length), comuns };
}

export type PautaParaChecar = {
  tema: string;
  gancho?: string | null;
  angulo?: string | null;
  pilar?: string | null;
  formato?: string | null;
  /** Apelido que o modelo marcou (E7) em continua_de. */
  continua_de?: string | null;
  /** Chaves da própria pauta (não compara consigo mesma). */
  chaves?: string[];
};

export type Parecido = { tema: TemaDaMemoria; indice: number; comuns: number; declarado: boolean };

export const CORTE_DE_PARECIDO = 0.34;
export const MAX_PARECIDOS = 4;

/**
 * Temas da memória parecidos com a pauta (palavras do tema e do gancho em
 * comum), os mais parecidos primeiro. O tema que o modelo marcou em
 * continua_de entra sempre (mesmo sem palavra em comum).
 */
export function candidatosParecidos(p: PautaParaChecar, memoria: MemoriaEditorial | null | undefined, opcoes: { max?: number; corte?: number } = {}): Parecido[] {
  if (!memoria || !memoria.temas.length) return [];
  const proprias = new Set(p.chaves || []);
  const texto = `${p.tema} ${p.gancho || ""}`;
  const corte = opcoes.corte ?? CORTE_DE_PARECIDO;
  const lista: Parecido[] = [];
  const declarado = p.continua_de ? memoria.temas.find((t) => t.apelido === String(p.continua_de).trim().toUpperCase()) || null : null;
  for (const t of memoria.temas) {
    if (t.chaves.some((c) => proprias.has(c))) continue;
    const s1 = semelhanca(texto, `${t.tema} ${t.gancho}`);
    const s2 = semelhanca(p.tema, t.tema);
    const s = s2.indice >= s1.indice ? s2 : s1;
    const eDeclarado = !!declarado && declarado === t;
    if (eDeclarado || (s.comuns >= 2 && s.indice >= corte)) lista.push({ tema: t, indice: Math.round(s.indice * 1000) / 1000, comuns: s.comuns, declarado: eDeclarado });
  }
  return lista
    .sort((a, b) => (b.declarado ? 1 : 0) - (a.declarado ? 1 : 0) || b.indice - a.indice || String(b.tema.data || "").localeCompare(String(a.tema.data || "")))
    .slice(0, opcoes.max ?? MAX_PARECIDOS);
}

// ------------------------------------------------------------------ Jev (Choice)

export type PerguntaDeChoice = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };

const CRITERIOS_DA_RELACAO = {
  repeticao: "Repete: é o mesmo tema com o mesmo ângulo (ou quase) de um post já feito; quem acompanha o perfil sentiria que já viu este conteúdo.",
  angulo_novo: "Mesmo tema de um post já feito, mas com um ângulo novo que avança a conversa (o passo seguinte, o erro comum, o caso real, a objeção, a prova, o aprofundamento); não repete o que o outro já disse.",
  tema_diferente: "Tema diferente dos posts listados: as palavras parecem, mas o assunto e a promessa são outros.",
};

/**
 * As perguntas ao Jev para as pautas que têm parecido, todas numa chamada só
 * (rodam em paralelo). Por pauta i: `relacao_i` (repetição, ângulo novo ou
 * tema diferente) e `base_i` (de qual post já feito, ou nenhum). As opções dos
 * posts são curtas (c1..c4) e o código traduz de volta.
 */
export function perguntasDeRepeticao(itens: Array<{ pauta: PautaParaChecar; parecidos: Parecido[] }>): {
  state: Record<string, unknown>;
  questions: Record<string, PerguntaDeChoice>;
  mapas: Array<Map<string, TemaDaMemoria>>;
  indices: number[];
} {
  const state: { pautas: unknown[] } = { pautas: [] };
  const questions: Record<string, PerguntaDeChoice> = {};
  const mapas: Array<Map<string, TemaDaMemoria>> = [];
  const indices: number[] = [];
  itens.forEach((x, i) => {
    if (!x.parecidos.length) return;
    const k = state.pautas.length;
    const mapa = new Map<string, TemaDaMemoria>();
    const criteria: Record<string, string> = {};
    const parecidos = x.parecidos.map((c, j) => {
      const op = `c${j + 1}`;
      mapa.set(op, c.tema);
      criteria[op] = `${c.tema.data || "sem data"}: ${umaLinha(c.tema.tema, 110)}${c.tema.angulo ? ` (ângulo ${c.tema.angulo})` : ""}`;
      return { opcao: op, data: c.tema.data, tema: c.tema.tema, angulo: c.tema.angulo || null, gancho: c.tema.gancho || null, situacao: c.tema.origem };
    });
    state.pautas.push({
      nova: { tema: x.pauta.tema, gancho: x.pauta.gancho || null, angulo: x.pauta.angulo || null, pilar: x.pauta.pilar || null, formato: x.pauta.formato || null },
      ja_feitos: parecidos,
    });
    questions[`relacao_${k}`] = {
      type: "choice",
      instructions: `Um cliente de agência publica conteúdo no Instagram. Compare a pauta nova em \`pautas[${k}].nova\` com os posts do mesmo cliente já feitos ou planejados em \`pautas[${k}].ja_feitos\`. A pauta nova repete um deles, volta a um mesmo tema com um ângulo novo, ou é outro tema?`,
      criteria: CRITERIOS_DA_RELACAO,
    };
    questions[`base_${k}`] = {
      type: "choice",
      instructions: `Qual post em \`pautas[${k}].ja_feitos\` trata do MESMO tema da pauta nova em \`pautas[${k}].nova\` (mesmo assunto, mesmo problema ou mesma promessa, mesmo que com outro ângulo)? Se nenhum trata do mesmo tema, escolha nenhum.`,
      criteria: { ...criteria, nenhum: "Nenhum trata do mesmo tema da pauta nova." },
    };
    mapas.push(mapa);
    indices.push(i);
  });
  return { state, questions, mapas, indices };
}

export type RespostaDeChoice = { choice?: string; probabilities?: Record<string, number>; confidence?: number };

/** Probabilidade de repetição a partir da qual a pauta volta marcada. */
export const CORTE_DE_REPETICAO = 0.5;
/** Probabilidade mínima para aceitar o post escolhido como base. */
export const CORTE_DA_BASE = 0.4;
/** Sem o Jev: semelhança de palavras que já avisa repetição. */
export const CORTE_SEM_JEV = 0.8;

const prob = (r: RespostaDeChoice | undefined, op: string): number | null => (r && r.probabilities && typeof r.probabilities[op] === "number" ? r.probabilities[op] : r && r.choice === op && typeof r.confidence === "number" ? r.confidence : null);

function deDoTema(t: TemaDaMemoria): EvolucaoDaPauta["de"] {
  return { chave: t.chave, data: t.data, tema: t.tema, angulo: t.angulo || null, origem: t.origem };
}

function fraseDa(tipo: TipoDeEvolucao, de: EvolucaoDaPauta["de"], angulo: string | null): string {
  if (tipo === "tema_novo" || !de) return "tema novo";
  const quando = dataCurtaBr(de.data);
  const onde = `${quando ? `o post de ${quando}` : "um post anterior"} sobre "${umaLinha(de.tema, 60)}"`;
  if (tipo === "repeticao") return `repete ${onde}`;
  return `continua ${onde}: agora ${angulo ? umaLinha(angulo, 60) : "um ângulo novo"}`;
}

/**
 * A decisão da pauta (política explícita, em código):
 * - sem parecido: tema novo (sem Jev);
 * - com o Jev: repetição acima do corte volta marcada com aviso; ângulo novo
 *   (ou o modelo marcou continua_de e o Jev não vê tema diferente) liga à base;
 *   o resto é tema novo;
 * - Jev fora do ar: vale o que o modelo marcou; semelhança de palavras muito
 *   alta no mesmo pilar ainda avisa (sem ter certeza).
 */
export function decidirEvolucao(
  pauta: PautaParaChecar,
  parecidos: Parecido[],
  respostas: { relacao?: RespostaDeChoice; base?: RespostaDeChoice } | null,
  mapa?: Map<string, TemaDaMemoria> | null,
): EvolucaoDaPauta {
  const angulo = pauta.angulo ? umaLinha(pauta.angulo, 80) : null;
  const declarado = parecidos.find((p) => p.declarado) || null;
  if (!parecidos.length) {
    return { tipo: "tema_novo", angulo, de: null, frase: "tema novo", aviso: null, jev: { checado: false, probabilidade: null } };
  }
  if (respostas && respostas.relacao) {
    const r = respostas.relacao;
    const pRep = prob(r, "repeticao") ?? 0;
    const pAng = prob(r, "angulo_novo") ?? 0;
    const pDif = prob(r, "tema_diferente") ?? 0;
    const b = respostas.base;
    const escolhida = b && b.choice && b.choice !== "nenhum" && mapa ? mapa.get(b.choice) || null : null;
    const pBase = b && b.choice ? prob(b, b.choice) ?? 0 : 0;
    const base = escolhida && pBase >= CORTE_DA_BASE ? escolhida : declarado ? declarado.tema : parecidos[0].tema;
    if (pRep >= CORTE_DE_REPETICAO && pRep >= pAng && pRep >= pDif) {
      const de = deDoTema(base);
      return {
        tipo: "repeticao",
        angulo,
        de,
        frase: fraseDa("repeticao", de, angulo),
        aviso: `Parece repetir ${de && de.data ? `o post de ${dataCurtaBr(de.data)}` : "um post anterior"} (mesmo tema e ângulo). Troque o ângulo desta pauta.`,
        jev: { checado: true, probabilidade: Math.round(pRep * 1000) / 1000 },
      };
    }
    if (pAng >= pDif || (declarado && pDif < 0.6)) {
      const de = deDoTema(base);
      return { tipo: "novo_angulo", angulo, de, frase: fraseDa("novo_angulo", de, angulo), aviso: null, jev: { checado: true, probabilidade: Math.round(pAng * 1000) / 1000 } };
    }
    return { tipo: "tema_novo", angulo, de: null, frase: "tema novo", aviso: null, jev: { checado: true, probabilidade: Math.round(pDif * 1000) / 1000 } };
  }
  // Sem o Jev.
  if (declarado) {
    const de = deDoTema(declarado.tema);
    return { tipo: "novo_angulo", angulo, de, frase: fraseDa("novo_angulo", de, angulo), aviso: null, jev: { checado: false, probabilidade: null } };
  }
  const topo = parecidos[0];
  const mesmoPilar = !pauta.pilar || !topo.tema.pilar || normalizado(pauta.pilar) === normalizado(topo.tema.pilar);
  if (topo.indice >= CORTE_SEM_JEV && mesmoPilar) {
    const de = deDoTema(topo.tema);
    return {
      tipo: "repeticao",
      angulo,
      de,
      frase: fraseDa("repeticao", de, angulo),
      aviso: `Pode repetir ${de && de.data ? `o post de ${dataCurtaBr(de.data)}` : "um post anterior"} (palavras quase iguais; a conferência automática não respondeu).`,
      jev: { checado: false, probabilidade: null },
    };
  }
  return { tipo: "tema_novo", angulo, de: null, frase: "tema novo", aviso: null, jev: { checado: false, probabilidade: null } };
}

/** Normaliza a evolução guardada no item (vinda do banco). Inválida: null. */
export function normalizarEvolucao(v: unknown): EvolucaoDaPauta | null {
  const o = obj(v);
  const tipo = o.tipo === "novo_angulo" || o.tipo === "repeticao" || o.tipo === "tema_novo" ? (o.tipo as TipoDeEvolucao) : null;
  if (!tipo) return null;
  const d = obj(o.de);
  const de = typeof d.chave === "string" && d.chave
    ? { chave: d.chave, data: dataIso(d.data), tema: umaLinha(d.tema, 160), angulo: umaLinha(d.angulo, 80) || null, origem: (d.origem === "publicado" || d.origem === "gravado" ? d.origem : "planejado") as OrigemEditorial }
    : null;
  const j = obj(o.jev);
  return {
    tipo,
    angulo: umaLinha(o.angulo, 80) || null,
    de: tipo === "tema_novo" ? null : de,
    frase: umaLinha(o.frase, 200) || fraseDa(tipo, de, umaLinha(o.angulo, 80) || null),
    aviso: umaLinha(o.aviso, 240) || null,
    jev: { checado: j.checado === true, probabilidade: typeof j.probabilidade === "number" ? j.probabilidade : null },
  };
}

// ------------------------------------------------------------------ tela: selo e linha de evolução

export type SeloDaEvolucao = { rotulo: string; tom: "neutro" | "novo" | "aviso"; dica: string };

/** O selo discreto do cartão da pauta. Sem evolução: null (o cartão fica como antes). */
export function seloDaEvolucao(e: EvolucaoDaPauta | null | undefined): SeloDaEvolucao | null {
  if (!e) return null;
  if (e.tipo === "tema_novo") return { rotulo: "tema novo", tom: "novo", dica: "Nenhum post parecido na memória do cliente." };
  const quando = e.de ? dataCurtaBr(e.de.data) : "";
  if (e.tipo === "repeticao") return { rotulo: quando ? `repete ${quando}` : "repete", tom: "aviso", dica: e.aviso || e.frase };
  return { rotulo: quando ? `novo ângulo de ${quando}` : "novo ângulo", tom: "neutro", dica: e.frase };
}

export type NoDaEvolucao = {
  chaves: string[];
  data: string | null;
  tema: string;
  angulo: string | null;
  pilar: string;
  evolucao?: EvolucaoDaPauta | null;
};

export type LinhaDeEvolucao = { pilar: string; passos: Array<{ data: string | null; tema: string; angulo: string | null }> };

/**
 * As pautas ligadas (quem continua quem), por pilar, da mais antiga para a
 * mais nova. Só entra a linha com 2 passos ou mais. Nó citado só como base
 * (post antigo fora da lista) entra pelo que a pauta guardou dele.
 */
export function linhasDeEvolucao(nos: NoDaEvolucao[], max = 8): LinhaDeEvolucao[] {
  type No = { id: string; chaves: string[]; data: string | null; tema: string; angulo: string | null; pilar: string; pai: string | null };
  const porChave = new Map<string, No>();
  const lista: No[] = [];
  const achar = (c: string) => porChave.get(c) || null;
  for (const n of nos) {
    if (!n || !n.chaves || !n.chaves.length || !n.tema) continue;
    if (n.chaves.some((c) => porChave.has(c))) continue;
    const no: No = { id: n.chaves[0], chaves: n.chaves, data: n.data, tema: n.tema, angulo: n.angulo, pilar: n.pilar || "", pai: null };
    lista.push(no);
    for (const c of n.chaves) porChave.set(c, no);
  }
  for (const n of nos) {
    const e = n && n.evolucao;
    if (!e || e.tipo !== "novo_angulo" || !e.de) continue;
    const filho = achar(n.chaves[0]);
    if (!filho) continue;
    let pai = achar(e.de.chave);
    if (!pai) {
      pai = { id: e.de.chave, chaves: [e.de.chave], data: e.de.data, tema: e.de.tema, angulo: e.de.angulo, pilar: filho.pilar, pai: null };
      lista.push(pai);
      porChave.set(e.de.chave, pai);
    }
    if (pai !== filho) filho.pai = pai.id;
  }
  const porId = new Map(lista.map((n) => [n.id, n]));
  const filhos = new Map<string, No[]>();
  for (const n of lista) if (n.pai) filhos.set(n.pai, (filhos.get(n.pai) || []).concat([n]));
  const saida: LinhaDeEvolucao[] = [];
  const raizes = lista.filter((n) => !n.pai || !porId.has(n.pai));
  for (const r of raizes) {
    if (!filhos.has(r.id)) continue;
    const passos: No[] = [];
    const visitados = new Set<string>();
    // Caminho mais longo a partir da raiz (sem ciclo): segue o filho mais recente.
    let atual: No | null = r;
    while (atual && !visitados.has(atual.id) && passos.length < 6) {
      visitados.add(atual.id);
      passos.push(atual);
      const fs: No[] = (filhos.get(atual.id) || []).slice().sort((a: No, b: No) => String(a.data || "").localeCompare(String(b.data || "")));
      atual = fs.length ? fs[fs.length - 1] : null;
    }
    if (passos.length < 2) continue;
    const ultimo = passos[passos.length - 1];
    saida.push({ pilar: ultimo.pilar || r.pilar || "Sem pilar", passos: passos.map((p) => ({ data: p.data, tema: p.tema, angulo: p.angulo })) });
  }
  return saida
    .sort((a, b) => String(b.passos[b.passos.length - 1].data || "").localeCompare(String(a.passos[a.passos.length - 1].data || "")))
    .slice(0, max);
}

/** Nós da linha de evolução a partir das propostas (tela do Mês). */
export function nosDasPropostas(propostas: Array<{ id: string; status?: string | null; itens?: unknown }>): NoDaEvolucao[] {
  const nos: NoDaEvolucao[] = [];
  for (const p of propostas || []) {
    if (!p || !p.id || p.status === "descartada") continue;
    for (const b of Array.isArray(p.itens) ? p.itens : []) {
      const it = obj(b);
      const tema = umaLinha(it.tema, 160);
      if (!tema) continue;
      const ev = normalizarEvolucao(it.evolucao);
      nos.push({ chaves: chavesDaPauta(p.id, it), data: dataIso(it.data), tema, angulo: umaLinha(it.angulo || (ev && ev.angulo), 80) || null, pilar: umaLinha(it.pilar, 80), evolucao: ev });
    }
  }
  return nos;
}
