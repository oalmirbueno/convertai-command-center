/**
 * Julgamentos do "Editar com IA" (frente EDT, rodada 2). PURO: monta as
 * perguntas ao Jev e compõe as respostas; a função só chama (a chave fica no
 * servidor). Quem mede tempo, corta e põe na linha do tempo é o código da tela.
 *
 * - força de cada frase (Score, 5 níveis): zoom e punch-in nos momentos fortes;
 * - momento viral de cada janela de 15 a 60 s (Score + Noul "se sustenta
 *   sozinho"): marcadores e "Criar corte";
 * - capítulos: Noul "começa assunto novo" em cada fronteira e, depois, o
 *   título escolhido (Choice) entre trechos DITOS no capítulo (não inventa);
 * - B-roll do acervo: Choice por frase entre os vídeos do acervo (ou nenhum).
 *
 * Probabilidade é conselho: o código aplica limiar, espaço mínimo e teto.
 */

// Tipos no formato do _shared/jev.ts (copiados de propósito: este módulo também roda na tela, sem Deno).
export type PerguntaJev =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: string[] }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };
export type RespostaJev = { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number>; score?: number; legend?: Record<string, unknown>; noul?: number };

export interface FraseDita {
  k: string;
  inicio_s: number;
  fim_s: number;
  texto: string;
}

export const MAX_FRASES_JULGADAS = 60;
export const MAX_JANELAS = 20;
export const MAX_ITENS_DO_ACERVO = 24;

const limpo = (v: unknown, max: number) =>
  String(v === null || v === undefined ? "" : v)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Frases conferidas (texto curto, tempo válido, k no formato f1..fN). */
export function frasesConferidas(v: unknown, max = MAX_FRASES_JULGADAS): FraseDita[] {
  if (!Array.isArray(v)) return [];
  const saida: FraseDita[] = [];
  v.slice(0, max).forEach((x, i) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const texto = limpo(o.texto, 400);
    const ini = Number(o.inicio_s);
    const fim = Number(o.fim_s);
    if (!texto || !isFinite(ini) || !isFinite(fim) || fim < ini) return;
    saida.push({ k: /^[fj]\d{1,4}$/.test(String(o.k)) ? String(o.k) : `f${i + 1}`, inicio_s: ini, fim_s: fim, texto });
  });
  return saida;
}

/** Nota de 0 a 1 de um Score de n níveis (a posição do Jev começa em 0). */
export function notaDe0a1(r: RespostaJev | undefined, niveis: number): number | null {
  const s = r && typeof r.score === "number" && isFinite(r.score) ? r.score : null;
  if (s === null) return null;
  return Math.round(Math.max(0, Math.min(1, s / Math.max(1, niveis - 1))) * 1000) / 1000;
}

const probNoul = (r: RespostaJev | undefined) => (r && typeof r.noul === "number" && isFinite(r.noul) ? r.noul : null);

// ------------------------------------------------------------------ força das frases

export const NIVEIS_DA_FORCA = [
  "frase de passagem: liga ideias, dá contexto ou repete o que já foi dito",
  "informa algo útil, mas comum, sem peso especial",
  "ideia importante do vídeo, que o público precisa entender",
  "frase de impacto: um dado, uma virada, uma promessa ou uma emoção forte",
  "o ponto alto do vídeo: a frase que o público vai lembrar ou repetir",
];

export function perguntasDeForca(titulo: string, frases: FraseDita[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  frases.forEach((_, i) => {
    questions[`forca_${i}`] = {
      type: "score",
      instructions: `Vídeo curto de rede social com uma pessoa falando para a câmera. Quanto a frase \`frases[${i}].texto\` pede ênfase na edição (um zoom rápido na pessoa) pelo peso do que diz, comparada com o resto da fala em \`frases\`?`,
      criteria: NIVEIS_DA_FORCA,
    };
  });
  return { state: { video: { titulo: limpo(titulo, 120) }, frases: frases.map((f) => ({ texto: f.texto })) }, questions };
}

export function notasDeForca(frases: FraseDita[], respostas: Record<string, RespostaJev>): { k: string; nota: number }[] {
  const saida: { k: string; nota: number }[] = [];
  frases.forEach((f, i) => {
    const n = notaDe0a1(respostas[`forca_${i}`], NIVEIS_DA_FORCA.length);
    if (n !== null) saida.push({ k: f.k, nota: n });
  });
  return saida;
}

// ------------------------------------------------------------------ momentos virais

export const NIVEIS_DO_VIRAL = [
  "não funciona sozinho: depende do resto do vídeo ou é só contexto",
  "interessante, mas sem gancho no começo nem fechamento",
  "bom trecho: uma ideia clara, com começo e fim",
  "forte: começa prendendo e fecha uma ideia completa que vale compartilhar",
  "muito forte: gancho imediato, revelação ou virada e um fim que dá vontade de mandar para alguém",
];

/**
 * Janelas candidatas (código): frases seguidas que somam 15 a 60 s, começando
 * em começo de frase; uma nova janela a cada ~20 s de fala.
 */
export function janelasCandidatas(frases: FraseDita[], min = 15, max = 60, passo = 20): FraseDita[] {
  const janelas: FraseDita[] = [];
  let ultimoInicio = -Infinity;
  for (let i = 0; i < frases.length && janelas.length < MAX_JANELAS; i++) {
    if (frases[i].inicio_s - ultimoInicio < passo) continue;
    let j = i;
    let texto = frases[i].texto;
    while (j + 1 < frases.length && frases[j + 1].fim_s - frases[i].inicio_s <= max && (frases[j].fim_s - frases[i].inicio_s < min || /[^.!?]$/.test(frases[j].texto))) {
      j++;
      texto += ` ${frases[j].texto}`;
    }
    const dur = frases[j].fim_s - frases[i].inicio_s;
    if (dur < min) continue;
    janelas.push({ k: `j${janelas.length + 1}`, inicio_s: frases[i].inicio_s, fim_s: frases[j].fim_s, texto: texto.slice(0, 1800) });
    ultimoInicio = frases[i].inicio_s;
  }
  return janelas;
}

export function perguntasDeViral(titulo: string, janelas: FraseDita[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  janelas.forEach((_, i) => {
    questions[`viral_${i}`] = {
      type: "score",
      instructions: `O trecho \`trechos[${i}].texto\` foi tirado de um vídeo mais longo. Postado sozinho como um corte curto (Reels, Shorts, TikTok), quanto ele tem para prender e ser compartilhado?`,
      criteria: NIVEIS_DO_VIRAL,
    };
    questions[`sozinho_${i}`] = {
      type: "noul",
      instructions: `Quem nunca viu o vídeo inteiro entende o trecho \`trechos[${i}].texto\` do começo ao fim, sem precisar do que veio antes?`,
      criteria: { true: "entende sozinho", false: "precisa do contexto de antes" },
    };
  });
  return { state: { video: { titulo: limpo(titulo, 120) }, trechos: janelas.map((j) => ({ texto: j.texto })) }, questions };
}

export interface MomentoViral {
  k: string;
  inicio_s: number;
  fim_s: number;
  nota: number;
  texto: string;
}

/** Nota final = 70% do Score + 30% do "entende sozinho"; fica o que passa de 0,55, sem se sobrepor, até 5. */
export function escolherVirais(janelas: FraseDita[], respostas: Record<string, RespostaJev>, limiar = 0.55, maximo = 5): MomentoViral[] {
  const notas: MomentoViral[] = [];
  janelas.forEach((j, i) => {
    const s = notaDe0a1(respostas[`viral_${i}`], NIVEIS_DO_VIRAL.length);
    const n = probNoul(respostas[`sozinho_${i}`]);
    if (s === null) return;
    const nota = Math.round((0.7 * s + 0.3 * (n === null ? 0.5 : n)) * 1000) / 1000;
    if (nota >= limiar) notas.push({ k: j.k, inicio_s: j.inicio_s, fim_s: j.fim_s, nota, texto: j.texto });
  });
  const ficam: MomentoViral[] = [];
  notas
    .sort((a, b) => b.nota - a.nota || a.inicio_s - b.inicio_s)
    .forEach((m) => {
      if (ficam.length >= maximo) return;
      if (ficam.some((x) => m.inicio_s < x.fim_s && m.fim_s > x.inicio_s)) return;
      ficam.push(m);
    });
  return ficam.sort((a, b) => a.inicio_s - b.inicio_s);
}

// ------------------------------------------------------------------ capítulos

export function perguntasDeFronteira(frases: FraseDita[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  frases.forEach((_, i) => {
    if (i === 0) return;
    questions[`novo_${i}`] = {
      type: "noul",
      instructions: `Na fala em \`frases\` (em ordem), a frase \`frases[${i}].texto\` começa um assunto novo em relação ao que vinha sendo dito até \`frases[${i - 1}].texto\`? Mudar de exemplo dentro do mesmo assunto não conta.`,
      criteria: { true: "começa assunto novo (vira um capítulo)", false: "continua o mesmo assunto" },
    };
  });
  return { state: { frases: frases.map((f) => ({ texto: f.texto })) }, questions };
}

/** Começos de capítulo: a primeira frase e cada fronteira com Noul >= 0,6, com pelo menos `minimo_s` desde o anterior. */
export function comecosDeCapitulo(frases: FraseDita[], respostas: Record<string, RespostaJev>, minimo_s = 20, limiar = 0.6): number[] {
  if (!frases.length) return [];
  const comecos = [0];
  frases.forEach((f, i) => {
    if (i === 0) return;
    const p = probNoul(respostas[`novo_${i}`]);
    if (p === null || p < limiar) return;
    if (f.inicio_s - frases[comecos[comecos.length - 1]].inicio_s < minimo_s) return;
    comecos.push(i);
  });
  return comecos;
}

/** Trechos ditos que podem virar título (até 6 por capítulo, de 2 a 7 palavras). */
export function candidatosDeTitulo(frases: FraseDita[]): string[] {
  const vistos: Record<string, boolean> = {};
  const saida: string[] = [];
  frases.forEach((f) => {
    f.texto
      .split(/[.!?;:,]+/)
      .map((s) => s.trim())
      .forEach((s) => {
        const palavras = s.split(" ").filter(Boolean);
        if (palavras.length < 2) return;
        const t = palavras.slice(0, 7).join(" ");
        const chave = t.toLowerCase();
        if (vistos[chave] || saida.length >= 6) return;
        vistos[chave] = true;
        saida.push(t);
      });
  });
  return saida;
}

export function perguntasDeTitulo(capitulos: { frases: FraseDita[]; candidatos: string[] }[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  capitulos.forEach((c, i) => {
    if (c.candidatos.length < 1) return;
    const criteria: Record<string, string> = {};
    c.candidatos.forEach((t, k) => (criteria[`t${k + 1}`] = t));
    criteria.nenhum = "nenhum desses trechos resume o assunto";
    questions[`titulo_${i}`] = {
      type: "choice",
      instructions: `Qual destes trechos, ditos no capítulo \`capitulos[${i}].texto\`, funciona melhor como título curto do assunto desse capítulo?`,
      criteria,
    };
  });
  return { state: { capitulos: capitulos.map((c) => ({ texto: c.frases.map((f) => f.texto).join(" ").slice(0, 1500) })) }, questions };
}

const capitalizar = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function titulosEscolhidos(capitulos: { candidatos: string[] }[], respostas: Record<string, RespostaJev>): string[] {
  return capitulos.map((c, i) => {
    const r = respostas[`titulo_${i}`];
    const escolha = r && typeof r.choice === "string" ? r.choice : "nenhum";
    const k = /^t(\d+)$/.exec(escolha);
    const t = k ? c.candidatos[Number(k[1]) - 1] : null;
    return t ? capitalizar(t.replace(/[.,;:!?]+$/, "")) : `Parte ${i + 1}`;
  });
}

// ------------------------------------------------------------------ B-roll do acervo

export interface ItemDoAcervo {
  id: string;
  descricao: string;
}

export function itensConferidos(v: unknown): ItemDoAcervo[] {
  if (!Array.isArray(v)) return [];
  const saida: ItemDoAcervo[] = [];
  v.slice(0, MAX_ITENS_DO_ACERVO).forEach((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const id = limpo(o.id, 60);
    const descricao = limpo(o.descricao, 300);
    if (id && descricao && !saida.some((i) => i.id === id)) saida.push({ id, descricao });
  });
  return saida;
}

export function perguntasDeBroll(frases: FraseDita[], itens: ItemDoAcervo[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = {};
  const criteria: Record<string, string> = {};
  itens.forEach((it, k) => (criteria[`i${k + 1}`] = it.descricao));
  criteria.nenhum = "nenhum vídeo do acervo mostra o que a frase diz";
  frases.forEach((_, i) => {
    questions[`broll_${i}`] = {
      type: "choice",
      instructions: `Enquanto a pessoa diz \`frases[${i}].texto\`, qual vídeo do acervo (em \`acervo\`) mostra na tela o que ela está falando, como B-roll? Só vale se mostrar mesmo o assunto da frase.`,
      criteria,
    };
  });
  return { state: { frases: frases.map((f) => ({ texto: f.texto })), acervo: itens.map((it, k) => ({ opcao: `i${k + 1}`, descricao: it.descricao })) }, questions };
}

export interface EscolhaDeBroll {
  k: string;
  item: string;
  inicio_s: number;
  fim_s: number;
  probabilidade: number;
}

/** Fica o que o Jev escolheu com probabilidade >= 0,5; um vídeo por vez, 6 s entre B-rolls, até `maximo`. */
export function escolherBroll(frases: FraseDita[], itens: ItemDoAcervo[], respostas: Record<string, RespostaJev>, maximo: number, limiar = 0.5): EscolhaDeBroll[] {
  const candidatas: EscolhaDeBroll[] = [];
  frases.forEach((f, i) => {
    const r = respostas[`broll_${i}`];
    const c = r && typeof r.choice === "string" ? r.choice : "nenhum";
    const m = /^i(\d+)$/.exec(c);
    if (!m) return;
    const item = itens[Number(m[1]) - 1];
    const p = r && r.probabilities && typeof r.probabilities[c] === "number" ? r.probabilities[c] : r && typeof r.confidence === "number" ? r.confidence : 0;
    if (!item || p < limiar) return;
    candidatas.push({ k: f.k, item: item.id, inicio_s: f.inicio_s, fim_s: f.fim_s, probabilidade: Math.round(p * 1000) / 1000 });
  });
  const ficam: EscolhaDeBroll[] = [];
  candidatas
    .sort((a, b) => b.probabilidade - a.probabilidade || a.inicio_s - b.inicio_s)
    .forEach((c) => {
      if (ficam.length >= maximo) return;
      if (ficam.some((x) => x.item === c.item || Math.abs(x.inicio_s - c.inicio_s) < 6)) return;
      ficam.push(c);
    });
  return ficam.sort((a, b) => a.inicio_s - b.inicio_s);
}

// ------------------------------------------------------------------ rosto (visão)

export const ESQUEMA_DO_ROSTO = {
  nome: "rosto_por_quadro",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["quadros"],
    properties: {
      quadros: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["n", "tem_rosto", "x", "y", "largura"],
          properties: { n: { type: "number" }, tem_rosto: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, largura: { type: "number" } },
        },
      },
    },
  },
};

export function sistemaDoRosto(): string {
  return [
    "Você recebe quadros de um vídeo, numerados na ordem (1, 2, 3...).",
    "Para cada quadro, diga onde está o rosto da pessoa principal (a que fala ou a maior): x e y do CENTRO do rosto e a largura do rosto, tudo como fração da imagem (0 a 1; x da esquerda, y do alto).",
    "Sem rosto visível: tem_rosto false e x, y, largura 0. Não chute: só o que está na imagem.",
  ].join("\n");
}

/** Custo de um lote do rosto ANTES (a tela e a função usam a mesma conta; arredonda para cima). */
export function estimativaDoRostoUsd(precoEntrada1m: number | null, precoSaida1m: number | null, quadros: number, caracteres: number): number {
  const entrada = Math.ceil(Math.max(0, caracteres) / 3.5) + Math.max(0, quadros) * 900;
  return Math.ceil((((Number(precoEntrada1m) || 0) * entrada + (Number(precoSaida1m) || 0) * 900) / 1e6) * 10000) / 10000;
}

/** Leituras conferidas: n do quadro enviado, números entre 0 e 1. */
export function leiturasDoRosto(bruto: unknown, tempos: number[]): { t: number; x: number | null; y: number | null; w: number | null }[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { quadros?: unknown }).quadros) ? ((bruto as { quadros: Record<string, unknown>[] }).quadros) : [];
  const saida: { t: number; x: number | null; y: number | null; w: number | null }[] = [];
  lista.forEach((q) => {
    const n = Math.round(Number(q.n));
    if (!(n >= 1 && n <= tempos.length) || saida.some((s) => s.t === tempos[n - 1])) return;
    const ok = q.tem_rosto === true && [q.x, q.y, q.largura].every((v) => isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1);
    saida.push({ t: tempos[n - 1], x: ok ? Number(q.x) : null, y: ok ? Number(q.y) : null, w: ok ? Number(q.largura) : null });
  });
  return saida.sort((a, b) => a.t - b.t);
}
