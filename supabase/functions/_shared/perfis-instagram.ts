/**
 * Perfis do Instagram do cliente (frente P, 26/09/2026): referências de estilo
 * e editorial e concorrentes monitorados. Regras e números em código; os
 * julgamentos (formato editorial, pilar, quanto combina com o cliente e a
 * anti-cópia do plano) são perguntas ao Jev montadas aqui. Documento:
 * docs/estudio/PERFIS-DO-INSTAGRAM.md.
 *
 * Puro: sem Deno, sem banco, sem IA. A função perfis-instagram, a tela
 * (src/components/perfis) e os testes (vitest) leem o mesmo arquivo. Sem
 * lookbehind, grupo nomeado nem classe Unicode (a tela roda no Safari 11). Sem travessão.
 */

import { apelidoDoTipo, type AlvoComApelido, type RegraDaOperacao, type ValorPara } from "./acoes-do-agente.ts";

// ------------------------------------------------------------------ limites

export const PAPEIS_DO_PERFIL = ["referencia", "concorrente"] as const;
export type PapelDoPerfil = (typeof PAPEIS_DO_PERFIL)[number];

/** Por cliente: 6 referências e 6 concorrentes (arquivados não contam). */
export const LIMITE_POR_PAPEL = 6;
/** Primeira captura pela API: até 24 posts. */
export const POSTS_NA_PRIMEIRA_CAPTURA = 24;
/** Monitoramento e recaptura: só os novos, até 12 por rodada. */
export const POSTS_POR_RODADA = 12;
/** Leitura por visão e Jev: até 12 posts por chamada (só os sem leitura). */
export const POSTS_POR_LEITURA = 12;
/** Fora da curva: engajamento >= 2x a mediana do perfil. */
export const FATOR_FORA_DA_CURVA = 2;
/** Mediana só vale com pelo menos 4 posts com número. */
export const MIN_POSTS_PARA_CURVA = 4;
/** Uma rodada por perfil por semana. */
export const DIAS_ENTRE_RODADAS = 7;
/** Teto de custo de IA de uma rodada de monitoramento (US$). */
export const TETO_DE_CUSTO_DA_RODADA_USD = 0.3;
/** Perfis por chamada do cron (o resto fica para a próxima chamada da janela). */
export const PERFIS_POR_CHAMADA_DO_CRON = 4;
/** Levar ao estilo: o agente de estilo aceita até 6 imagens por mensagem. */
export const MAX_POSTS_NO_ESTILO = 6;
/** Plano "igual a esse perfil": de 4 a 12 pautas; gera 2 a mais e escolhe. */
export const MIN_PAUTAS = 4;
export const MAX_PAUTAS = 12;
export const PAUTAS_A_MAIS = 2;
/** Anti-cópia: a pauta sai do plano com probabilidade de cópia a partir disto. */
export const LIMIAR_DA_COPIA = 0.4;
/** Ideias de resposta a concorrente: 1 a 3 por rodada. */
export const MAX_IDEIAS_DE_RESPOSTA = 3;

export const ROTULO_DO_PAPEL: Record<PapelDoPerfil, string> = { referencia: "Referências", concorrente: "Concorrentes" };

export const ehPapel = (v: unknown): v is PapelDoPerfil => v === "referencia" || v === "concorrente";

export function podeAdicionar(ativosNoPapel: number): boolean {
  return ativosNoPapel < LIMITE_POR_PAPEL;
}

// ------------------------------------------------------------------ @ e links

/** "@Fulano", "fulano", "instagram.com/fulano/?hl=pt" ou o link completo viram "fulano". Null quando não é um @ válido. */
export function normalizarHandle(bruto: unknown): string | null {
  let s = String(bruto == null ? "" : bruto).trim();
  if (!s) return null;
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (m) {
    s = m[1];
    if (["p", "reel", "reels", "tv", "stories", "explore"].indexOf(s.toLowerCase()) >= 0) return null;
  }
  s = s.replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  if (s.charAt(0) === "." || s.charAt(s.length - 1) === ".") return null;
  return s;
}

/** Link de post, reel ou IGTV. Devolve o link limpo e o código curto. */
export function normalizarLinkDePost(bruto: unknown): { permalink: string; codigo: string } | null {
  const s = String(bruto == null ? "" : bruto).trim();
  const m = /instagram\.com\/(?:[a-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/i.exec(s);
  if (!m) return null;
  const tipo = m[1].toLowerCase() === "reels" ? "reel" : m[1].toLowerCase();
  return { permalink: `https://www.instagram.com/${tipo}/${m[2]}/`, codigo: m[2] };
}

// ------------------------------------------------------------------ formato do post

export const FORMATOS_DO_POST = ["reel", "carrossel", "foto", "video", "print", "link"] as const;
export type FormatoDoPost = (typeof FORMATOS_DO_POST)[number];

export const ROTULO_DO_FORMATO: Record<FormatoDoPost, string> = {
  reel: "Reels",
  carrossel: "Carrossel",
  foto: "Foto",
  video: "Vídeo",
  print: "Print",
  link: "Link",
};

/** media_type e media_product_type da Graph API viram o formato do painel. */
export function formatoDaMidia(mediaType: unknown, produto: unknown): FormatoDoPost {
  const t = String(mediaType || "").toUpperCase();
  const p = String(produto || "").toUpperCase();
  if (p === "REELS") return "reel";
  if (t === "CAROUSEL_ALBUM") return "carrossel";
  if (t === "VIDEO") return "video";
  return "foto";
}

// ------------------------------------------------------------------ números

export type PostParaMetrica = {
  id: string;
  curtidas: number | null;
  comentarios: number | null;
  publicado_em?: string | null;
  formato?: FormatoDoPost | string | null;
};

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** (curtidas + comentários) / seguidores. Null sem seguidores ou sem nenhum número. */
export function engajamentoDoPost(curtidas: unknown, comentarios: unknown, seguidores: unknown): number | null {
  const s = numero(seguidores);
  const c = numero(curtidas);
  const k = numero(comentarios);
  if (!s || s <= 0 || (c === null && k === null)) return null;
  return ((c || 0) + (k || 0)) / s;
}

export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => typeof x === "number" && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export type MetricaDoPost = { engajamento: number | null; fora_da_curva: boolean; vezes_a_mediana: number | null };

/**
 * Engajamento de cada post e quem está fora da curva (>= 2x a mediana do
 * perfil). Sem mediana confiável (poucos posts com número, ou mediana zero),
 * ninguém é marcado.
 */
export function metricasDoPerfil(posts: PostParaMetrica[], seguidores: unknown): { mediana: number | null; porPost: Record<string, MetricaDoPost>; fora: string[] } {
  const porPost: Record<string, MetricaDoPost> = {};
  const valores: number[] = [];
  for (const p of posts) {
    const e = engajamentoDoPost(p.curtidas, p.comentarios, seguidores);
    porPost[p.id] = { engajamento: e, fora_da_curva: false, vezes_a_mediana: null };
    if (e !== null) valores.push(e);
  }
  const m = valores.length >= MIN_POSTS_PARA_CURVA ? mediana(valores) : null;
  const fora: string[] = [];
  if (m !== null && m > 0) {
    for (const p of posts) {
      const x = porPost[p.id];
      if (x.engajamento === null) continue;
      x.vezes_a_mediana = Math.round((x.engajamento / m) * 10) / 10;
      if (x.engajamento >= FATOR_FORA_DA_CURVA * m) {
        x.fora_da_curva = true;
        fora.push(p.id);
      }
    }
  }
  return { mediana: m, porPost, fora };
}

/** Hora e dia da semana em São Paulo (UTC-3 fixo desde 2019, sem horário de verão). */
export function horaEDiaEmSaoPaulo(iso: string | null | undefined): { hora: number; dia: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - 3 * 3600 * 1000);
  return { hora: d.getUTCHours(), dia: d.getUTCDay() };
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export type ResumoNumerico = {
  posts: number;
  por_semana: number | null;
  mix: Record<string, number>;
  horas_mais_usadas: number[];
  dias_mais_usados: string[];
  engajamento_mediano: number | null;
  fora_da_curva: number;
};

/** Frequência, mix de formatos e horários, só com os posts que têm data. */
export function resumoNumerico(posts: PostParaMetrica[], seguidores: unknown): ResumoNumerico {
  const m = metricasDoPerfil(posts, seguidores);
  const datas = posts.map((p) => (p.publicado_em ? Date.parse(p.publicado_em) : NaN)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let porSemana: number | null = null;
  if (datas.length >= 2) {
    const semanas = Math.max(1, (datas[datas.length - 1] - datas[0]) / (7 * 24 * 3600 * 1000));
    porSemana = Math.round((datas.length / semanas) * 10) / 10;
  }
  const mix: Record<string, number> = {};
  for (const p of posts) {
    const f = String(p.formato || "foto");
    mix[f] = (mix[f] || 0) + 1;
  }
  const horas: Record<number, number> = {};
  const dias: Record<number, number> = {};
  for (const p of posts) {
    const hd = horaEDiaEmSaoPaulo(p.publicado_em);
    if (!hd) continue;
    horas[hd.hora] = (horas[hd.hora] || 0) + 1;
    dias[hd.dia] = (dias[hd.dia] || 0) + 1;
  }
  const topo = (o: Record<number, number>, n: number) =>
    Object.keys(o).map(Number).sort((a, b) => o[b] - o[a] || a - b).slice(0, n);
  return {
    posts: posts.length,
    por_semana: porSemana,
    mix,
    horas_mais_usadas: topo(horas, 3),
    dias_mais_usados: topo(dias, 2).map((d) => DIAS[d]),
    engajamento_mediano: m.mediana,
    fora_da_curva: m.fora.length,
  };
}

/** Engajamento em porcentagem para a tela ("3,4%"). */
export function emPorcentagem(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sem número";
  const p = v * 100;
  return `${p.toLocaleString("pt-BR", { maximumFractionDigits: p < 1 ? 2 : 1 })}%`;
}

/**
 * Posts novos de uma leitura da API (mais novo primeiro): para no primeiro já
 * conhecido e não passa do máximo.
 */
export function postsNovos<T extends { id: string }>(recebidos: T[], conhecidos: string[], max: number): T[] {
  const ja = new Set(conhecidos);
  const saida: T[] = [];
  for (const r of recebidos) {
    if (ja.has(r.id)) break;
    saida.push(r);
    if (saida.length >= max) break;
  }
  return saida;
}

// ------------------------------------------------------------------ rodada semanal (sem laço)

export type PerfilParaRodada = {
  papel: string;
  monitorar: boolean;
  arquivado_em: string | null;
  proxima_rodada_em: string | null;
};

/** A rodada só roda para concorrente monitorado, não arquivado e com a semana vencida. */
export function podeRodar(p: PerfilParaRodada, agora: Date = new Date()): boolean {
  if (p.papel !== "concorrente" || !p.monitorar || p.arquivado_em) return false;
  if (!p.proxima_rodada_em) return true;
  const t = Date.parse(p.proxima_rodada_em);
  return !Number.isFinite(t) || t <= agora.getTime();
}

/** A próxima rodada: sempre uma semana depois, dê certo ou dê erro (sem nova tentativa imediata). */
export function proximaRodadaEm(agora: Date = new Date()): string {
  return new Date(agora.getTime() + DIAS_ENTRE_RODADAS * 24 * 3600 * 1000).toISOString();
}

/** Com o teto, a rodada ainda pode gastar isto? */
export function cabeNoTeto(gastoAteAgora: number, estimativa: number, teto = TETO_DE_CUSTO_DA_RODADA_USD): boolean {
  return gastoAteAgora + Math.max(0, estimativa) <= teto + 1e-9;
}

// ------------------------------------------------------------------ Jev: leitura dos posts

/** Pergunta do Jev no formato do _shared/jev.ts (sem importar o arquivo, que usa Deno). */
export type PerguntaDoPerfil =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: string[] }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };

export type RespostaDoJev = { choice?: string; confidence?: number; score?: number; noul?: number };

export const FORMATOS_EDITORIAIS: Record<string, string> = {
  educativo_lista: "Ensina algo em passos, dicas ou lista (carrossel de dicas, erros comuns, checklist).",
  bastidor: "Mostra o dia a dia, a equipe, o processo ou como algo é feito por dentro.",
  prova_social: "Depoimento, avaliação, resultado de cliente, antes da compra contado por quem comprou.",
  oferta_promo: "Anuncia preço, promoção, lançamento, cupom ou chamada direta para comprar.",
  antes_e_depois: "Compara o antes e o depois de um trabalho, transformação ou resultado.",
  tendencia_meme: "Usa uma trend, meme, áudio do momento ou humor do nicho.",
  institucional: "Fala da marca, valores, data comemorativa, aviso ou posicionamento.",
  pergunta_enquete: "Chama a audiência a responder, votar, opinar ou comentar.",
  nenhum: "Nenhum destes descreve o post.",
};

export const ROTULO_DO_FORMATO_EDITORIAL: Record<string, string> = {
  educativo_lista: "Educativo",
  bastidor: "Bastidor",
  prova_social: "Prova social",
  oferta_promo: "Oferta",
  antes_e_depois: "Antes e depois",
  tendencia_meme: "Tendência",
  institucional: "Institucional",
  pergunta_enquete: "Pergunta",
  nenhum: "Outro",
};

export const PILARES_PADRAO = ["educar", "inspirar", "provar", "vender", "conectar", "entreter"];

/** Pilares do cliente (das propostas do Mês) ou a lista padrão; sempre com "nenhum". */
export function pilaresParaAPergunta(doCliente: string[]): string[] {
  const vistos: string[] = [];
  for (const p of doCliente) {
    const t = String(p || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (t && vistos.map((x) => x.toLowerCase()).indexOf(t.toLowerCase()) < 0) vistos.push(t);
    if (vistos.length >= 8) break;
  }
  const base = vistos.length >= 2 ? vistos : PILARES_PADRAO.slice();
  return base.concat(["nenhum"]);
}

/** Do pior para o melhor (Score precisa da lista ordenada). */
export const NIVEIS_DE_COMBINA = [
  "O post fala com outro público ou de outro assunto: adaptar para o cliente não faria sentido.",
  "Algo do post serve de ideia distante, mas o assunto, o público ou o tom pedem muita mudança.",
  "O formato serve e o assunto conversa com o cliente, com ajustes de tom ou de oferta.",
  "Assunto, público e tom combinam com o posicionamento do cliente; adaptar é direto.",
  "O post parece feito para o público do cliente: forte candidato a adaptar primeiro.",
];

/** Nota de 0 a 10 de um Score com n níveis. */
export function notaDe0a10(score: number | null | undefined, niveis: number): number | null {
  if (typeof score !== "number" || !Number.isFinite(score) || niveis < 2) return null;
  return Math.round((score / (niveis - 1)) * 100) / 10;
}

/**
 * Perguntas da leitura de N posts sobre um estado só (`posts[i]` e `cliente`):
 * formato editorial (Choice), pilar (Choice) e o quanto combina com o cliente
 * (Score). Independentes: vão juntas na mesma chamada.
 */
export function perguntasDaLeitura(n: number, pilares: string[]): Record<string, PerguntaDoPerfil> {
  const q: Record<string, PerguntaDoPerfil> = {};
  const criteriosDoPilar: Record<string, unknown> = {};
  for (const p of pilares) criteriosDoPilar[p] = p === "nenhum" ? "Nenhum destes pilares descreve o post." : null;
  for (let i = 0; i < n; i++) {
    q[`formato_${i}`] = {
      type: "choice",
      instructions: `Pela legenda e pela descrição da imagem de \`posts[${i}]\`, qual é o formato editorial deste post do Instagram?`,
      criteria: FORMATOS_EDITORIAIS,
    };
    q[`pilar_${i}`] = {
      type: "choice",
      instructions: `Em qual pilar de conteúdo o post \`posts[${i}]\` se encaixa melhor?`,
      criteria: criteriosDoPilar,
    };
    q[`combina_${i}`] = {
      type: "score",
      instructions: `Quanto o post \`posts[${i}]\` combina com o posicionamento e o público do cliente descrito em \`cliente\`, pensando em adaptar a ideia (não copiar) para ele?`,
      criteria: NIVEIS_DE_COMBINA,
    };
  }
  return q;
}

export type LeituraDoJev = { formato_editorial: string | null; pilar: string | null; combina: number | null };

export function lerRespostasDaLeitura(answers: Record<string, RespostaDoJev | undefined>, n: number, pilares: string[]): LeituraDoJev[] {
  const saida: LeituraDoJev[] = [];
  for (let i = 0; i < n; i++) {
    const f = answers[`formato_${i}`];
    const p = answers[`pilar_${i}`];
    const c = answers[`combina_${i}`];
    const formato = f && typeof f.choice === "string" && Object.prototype.hasOwnProperty.call(FORMATOS_EDITORIAIS, f.choice) ? f.choice : null;
    const pilar = p && typeof p.choice === "string" && pilares.indexOf(p.choice) >= 0 && p.choice !== "nenhum" ? p.choice : null;
    saida.push({ formato_editorial: formato, pilar, combina: notaDe0a10(c ? c.score : null, NIVEIS_DE_COMBINA.length) });
  }
  return saida;
}

// ------------------------------------------------------------------ plano igual e anti-cópia

export type CardDaPauta = { ordem: number; funcao: string; texto: string };

export type PautaDoPerfil = {
  id: string;
  tema: string;
  formato: "carrossel" | "estatico";
  pilar: string;
  gancho: string;
  legenda_base: string;
  cta: string;
  /** Apelido do post de origem no perfil (p1, p2...), quando houver. */
  referencia: string | null;
  formato_editorial: string | null;
  cards: CardDaPauta[];
};

/** Travessão e meia-risca viram vírgula (texto de tela sem travessão). */
export const TRAVESSOES = new RegExp("[" + String.fromCharCode(8212, 8211) + "]", "g");
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(TRAVESSOES, ",").replace(/\s+/g, " ").trim().slice(0, max);
const bloco = (v: unknown, max: number) => String(v == null ? "" : v).replace(TRAVESSOES, ",").trim().slice(0, max);

/** Lê a pauta que o modelo escreveu. Null quando falta tema ou gancho. */
export function normalizarPauta(bruto: unknown, indice: number, apelidosDosPosts: string[]): PautaDoPerfil | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const tema = linha(o.tema, 160);
  const gancho = linha(o.gancho, 220);
  if (!tema || !gancho) return null;
  const ref = linha(o.referencia, 8).toLowerCase();
  const formatoEd = linha(o.formato_editorial, 40);
  const cards = (Array.isArray(o.cards) ? o.cards : []).slice(0, 10).map((c, k) => {
    const x = (c || {}) as Record<string, unknown>;
    return { ordem: k + 1, funcao: linha(x.funcao, 60), texto: linha(x.texto, 400) };
  }).filter((c) => c.texto);
  const formato = String(o.formato || "").toLowerCase().indexOf("carros") >= 0 ? "carrossel" : "estatico";
  return {
    id: `q${indice + 1}`,
    tema,
    formato,
    pilar: linha(o.pilar, 60) || "sem pilar",
    gancho,
    legenda_base: bloco(o.legenda_base, 1500),
    cta: linha(o.cta, 160),
    referencia: apelidosDosPosts.indexOf(ref) >= 0 ? ref : null,
    formato_editorial: Object.prototype.hasOwnProperty.call(FORMATOS_EDITORIAIS, formatoEd) ? formatoEd : null,
    cards: cards.length ? cards : [{ ordem: 1, funcao: "capa", texto: gancho }],
  };
}

/**
 * Anti-cópia sobre um estado só (`perfil_de_referencia`, `cliente`,
 * `pautas[i]`): duas perguntas Noul por pauta, na mesma chamada.
 */
export function perguntasDaAntiCopia(n: number): Record<string, PerguntaDoPerfil> {
  const q: Record<string, PerguntaDoPerfil> = {};
  for (let i = 0; i < n; i++) {
    q[`copia_${i}`] = {
      type: "noul",
      instructions: `A pauta \`pautas[${i}]\` copia o texto, a promessa ou a identidade do \`perfil_de_referencia\` (frases iguais ou quase iguais às legendas dele, a mesma promessa de outro negócio, o nome, o bordão ou a marca dele) em vez de adaptar a ideia ao \`cliente\`?`,
      criteria: {
        true: "Repete frase, promessa, nome, bordão ou identidade do perfil de referência, ou fala como se fosse aquele negócio.",
        false: "Usa só o formato, o ritmo ou o tipo de assunto e fala do negócio, do público e da oferta do cliente com palavras próprias.",
      },
    };
    q[`ritmo_${i}`] = {
      type: "noul",
      instructions: `A pauta \`pautas[${i}]\` mantém o formato e o ritmo do padrão do \`perfil_de_referencia\` (tipo de post, estrutura do gancho, jeito de montar a sequência)?`,
    };
  }
  return q;
}

export type DecisaoDasPautas = {
  aprovadas: Array<PautaDoPerfil & { copia: number | null; ritmo: number | null }>;
  bloqueadas: Array<{ pauta: PautaDoPerfil; motivo: string }>;
};

/**
 * Escolhe as pautas do plano (sem laço de correção: gerou a mais, escolhe).
 * Cópia >= LIMIAR_DA_COPIA sai com aviso. Sem resposta do Jev a pauta também
 * sai: a anti-cópia não pode ser pulada. Entre as aprovadas, as que mais
 * mantêm o ritmo do perfil vêm primeiro, até `quantas`.
 */
export function decidirPautas(pautas: PautaDoPerfil[], answers: Record<string, RespostaDoJev | undefined>, quantas: number): DecisaoDasPautas {
  const aprovadas: DecisaoDasPautas["aprovadas"] = [];
  const bloqueadas: DecisaoDasPautas["bloqueadas"] = [];
  pautas.forEach((p, i) => {
    const c = answers[`copia_${i}`];
    const r = answers[`ritmo_${i}`];
    const copia = c && typeof c.noul === "number" && Number.isFinite(c.noul) ? c.noul : null;
    const ritmo = r && typeof r.noul === "number" && Number.isFinite(r.noul) ? r.noul : null;
    if (copia === null) {
      bloqueadas.push({ pauta: p, motivo: "A conferência de cópia não respondeu para esta pauta." });
      return;
    }
    if (copia >= LIMIAR_DA_COPIA) {
      bloqueadas.push({ pauta: p, motivo: "Parece cópia do perfil de referência (texto, promessa ou identidade)." });
      return;
    }
    aprovadas.push({ ...p, copia, ritmo });
  });
  const ordenadas = aprovadas
    .map((p, k) => ({ p, k }))
    .sort((a, b) => (b.p.ritmo === null ? -1 : b.p.ritmo) - (a.p.ritmo === null ? -1 : a.p.ritmo) || a.k - b.k)
    .map((x) => x.p);
  const escolhidas = ordenadas.slice(0, Math.max(0, quantas));
  // Ordem original de volta (a sequência do plano faz sentido na ordem escrita).
  const posicao = (id: string) => pautas.findIndex((x) => x.id === id);
  escolhidas.sort((a, b) => posicao(a.id) - posicao(b.id));
  return { aprovadas: escolhidas, bloqueadas };
}

export function quantasPautas(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 8;
  return Math.max(MIN_PAUTAS, Math.min(MAX_PAUTAS, n));
}

/** Dias úteis (segunda a sexta) do mês YYYY-MM, a partir de amanhã quando o mês é o atual. */
export function diasUteisDoMes(mes: string, hoje: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(mes)) return [];
  const [a, m] = mes.split("-").map(Number);
  const dias: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(a, m - 1, d, 12));
    if (dt.getUTCMonth() !== m - 1) break;
    const iso = dt.toISOString().slice(0, 10);
    const semana = dt.getUTCDay();
    if (semana === 0 || semana === 6) continue;
    if (iso <= hoje) continue;
    dias.push(iso);
  }
  return dias;
}

/** Espalha n pautas pelos dias úteis, com o mesmo espaço entre elas. */
export function datasDasPautas(mes: string, hoje: string, n: number): string[] {
  const dias = diasUteisDoMes(mes, hoje);
  if (!dias.length || n <= 0) return [];
  if (n >= dias.length) return dias.slice(0, n);
  const passo = dias.length / n;
  const saida: string[] = [];
  for (let i = 0; i < n; i++) saida.push(dias[Math.min(dias.length - 1, Math.floor(i * passo))]);
  return saida;
}

const mesSeguinte = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
};

/**
 * Datas para n pautas a partir do mês; o que não cabe nos dias úteis que
 * sobram passa para o mês seguinte (até 3 meses à frente). Anti-bug 26/09:
 * no fim do mês as pautas extras caíam todas no último dia útil, ou a
 * proposta sumia calada quando o mês já não tinha dia útil.
 */
export function datasComMesSeguinte(mes: string, hoje: string, n: number): string[] {
  let datas = datasDasPautas(mes, hoje, n);
  let atual = mes;
  for (let volta = 0; datas.length < n && volta < 3; volta++) {
    atual = mesSeguinte(atual);
    datas = datas.concat(datasDasPautas(atual, hoje, n - datas.length));
  }
  return datas;
}

export type DatasDoPlano = { datas: string[]; noMes: number; foraDoMes: number };

/**
 * Datas do plano de um mês pedido (plano_igual). Anti-bug AB2 (26/09): com
 * mais pautas do que dias úteis livres no mês pedido, as extras caíam todas
 * no último dia útil. Agora cada pauta ganha um dia útil só dela: primeiro
 * os do mês pedido (espalhados), o resto no mês seguinte; `foraDoMes` diz
 * quantas saíram do mês pedido, para a resposta avisar.
 */
export function datasDoPlanoDoMes(mes: string, hoje: string, n: number): DatasDoPlano {
  const datas = datasComMesSeguinte(mes, hoje, n);
  const noMes = datas.filter((d) => d.slice(0, 7) === mes).length;
  return { datas, noMes, foraDoMes: datas.length - noMes };
}

/** Aviso da resposta quando o plano não coube no mês pedido (vazio quando coube). */
export function avisoDoPlanoForaDoMes(mes: string, plano: DatasDoPlano): string {
  if (!plano.foraDoMes) return "";
  const meses = plano.datas.map((d) => d.slice(0, 7)).filter((m, i, a) => m !== mes && a.indexOf(m) === i);
  const dias = `${plano.noMes} ${plano.noMes === 1 ? "dia útil livre" : "dias úteis livres"}`;
  const pautas = plano.foraDoMes === 1 ? "1 pauta passou" : `${plano.foraDoMes} pautas passaram`;
  return `O mês ${mes} só tem ${dias}: ${pautas} para ${meses.join(" e ")}, uma por dia, sem repetir data.`;
}

// ------------------------------------------------------------------ ações do agente do perfil

/** Post do perfil como alvo do agente (apelido p1..pN). */
export type AlvoPost = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };
/** Pauta proposta como alvo (apelido q1..qN; id = id da pauta dentro da proposta). */
export type AlvoPauta = AlvoPost;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Operações que o agente do perfil propõe e a equipe confirma. */
export const REGRAS_DO_PERFIL: Record<string, RegraDaOperacao> = {
  levar_ao_estilo: {
    rotulo: "Levar ao estilo",
    alvos: ["p"],
    trava: (alvo: AlvoComApelido) => (alvo.dados && alvo.dados.tem_imagem === false ? "Post sem imagem guardada (só o link)." : null),
  },
  agendar: {
    rotulo: "Pôr na agenda",
    alvos: ["q"],
    para: (bruto: unknown): ValorPara | undefined => {
      const s = String(bruto == null ? "" : bruto).trim().slice(0, 10);
      return DATA.test(s) ? s : null;
    },
  },
};

export const DESCRICOES_DAS_OPERACOES: Record<string, string> = {
  levar_ao_estilo: "manda o post (apelido p) como referência ao agente de estilo do cliente, que propõe o estilo com a confirmação dele. Até 6 posts. para vazio.",
  agendar: "põe a pauta proposta (apelido q) na agenda do mês, pelo caminho do agente do Mês. para = a data YYYY-MM-DD.",
};

/** Apelido de post (p) ou de pauta (q)? */
export const ehApelidoDePost = (ref: string) => apelidoDoTipo(ref, ["p"]);
export const ehApelidoDePauta = (ref: string) => apelidoDoTipo(ref, ["q"]);

/** Alvos das pautas com apelido igual ao id (q1..qN), para a proposta de agenda. */
export function alvosDasPautas(pautas: Array<PautaDoPerfil & { data?: string }>): Array<AlvoComApelido<AlvoPauta>> {
  return pautas.map((p) => ({
    id: p.id,
    ref: p.id,
    titulo: p.tema,
    detalhe: [p.formato === "carrossel" ? "carrossel" : "estático", p.pilar, p.referencia ? `inspirado em ${p.referencia}` : ""].filter(Boolean).join(" · "),
    dados: {},
  }));
}
