/**
 * Cadência e mistura do Mês (02/10).
 *
 * Dono (Para Si Ótica): pediu "3 posts por semana, 2 de foto e 1 carrossel" e
 * o agente devolveu 9 conteúdos em 4 semanas, nenhum de foto e vários com cara
 * de tutorial. Aqui, em código e sem rede:
 * - lerCadencia: "3 por semana", "3x na semana", "três posts semanais",
 *   "2 fotos e 1 carrossel", "segunda, quarta e sexta" viram números.
 *   Números são trabalho do código (o Jev julga sentido, não conta); o modelo
 *   ainda devolve frequencia_semanal e a mistura no plano, que valem quando o
 *   texto não diz.
 * - gradeDoMes: as vagas do mês (data e formato) por semana ISO, espalhadas
 *   (3 por semana: segunda, quarta e sexta).
 * - encaixarNaGrade: o que o modelo devolveu entra nas vagas (mesma semana e
 *   formato primeiro); sobra sai, vaga vazia vai para o modelo preencher.
 * - conferirPlano: a conta por semana e a frase "12 posts: 8 fotos e 4
 *   carrosséis, 3 por semana".
 * - pareceTutorial e temasRepetidos: o que volta para o modelo reescrever.
 *
 * Sem import de Deno nem de npm: a função, a tela e os testes leem este arquivo.
 */

import { faltasDaDirecao, type DirecaoDeFoto, type FormatoDoMes, normalizarDirecaoDeFoto, PLURAL_DO_FORMATO } from "./peca-de-foto.ts";

// ------------------------------------------------------------------ leitura da cadência

export type MixDaSemana = { foto: number; carrossel: number; estatico: number; arte: number };

export type CadenciaDoMes = {
  /** Posts por semana (1 a 5: o Mês publica de segunda a sexta, um por dia). */
  por_semana: number;
  /** Quantos de cada formato por semana; "arte" é carrossel ou estático (Estúdio). Null: formato livre. */
  mix: MixDaSemana | null;
  /** Dias pedidos (1 segunda ... 5 sexta); vazio: o padrão espalhado. */
  dias: number[];
  /** De onde veio (pedido, plano ou modelo). */
  fonte: string;
};

export const MAX_POR_SEMANA = 5;

const NUMEROS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

const DIAS: Record<string, number> = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5 };

/** Minúsculo, sem acento, números por extenso viram dígitos. */
export function textoParaCadencia(t: unknown): string {
  return String(t == null ? "" : t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/g, (m) => String(NUMEROS[m]))
    .replace(/\s+/g, " ");
}

const QUALIFICADOR = "(?:posts?|postagens?|publicacoes|publicacao|conteudos?|pecas?|vezes|x)";
const POR_SEMANA = new RegExp(`(\\d{1,2})\\s*${QUALIFICADOR}?\\s*(?:no feed\\s*)?(?:por|na|da|a cada|cada|\\/)\\s*semana`, "g");
const SEMANAIS = new RegExp(`(\\d{1,2})\\s*${QUALIFICADOR}?\\s*semanais`, "g");
const MIX = /(\d{1,2})\s+(?:(?:posts?|postagens?|pecas?|conteudos?|publicacoes|publicacao)\s+)?(?:(?:de|em|com|do tipo)\s+)?(fotos?|fotografias?|ensaios?|carross\w*|carrocel\w*|carousel\w*|estatic\w*|artes?)\b(?!\s*(?:por|em cada|cada|no|na|dentro)\s+(?:post|carrossel|peca|publicacao))/g;
const LISTA_DE_DIAS = /\b(segunda|terca|quarta|quinta|sexta)(?:-feira)?s?(?:\s*(?:,|e|\/)\s*(?:a\s+)?(?:segunda|terca|quarta|quinta|sexta)(?:-feira)?s?)+/;

function categoria(palavra: string): keyof MixDaSemana {
  if (/^fot|^ensai/.test(palavra)) return "foto";
  if (/^carro|^carou/.test(palavra)) return "carrossel";
  if (/^estat/.test(palavra)) return "estatico";
  return "arte";
}

const somaDoMix = (m: MixDaSemana) => m.foto + m.carrossel + m.estatico + m.arte;

/**
 * A cadência pedida no texto, ou null quando ele não fala de cadência.
 * Mistura que não fecha com a frequência (ex.: "4 fotos" quando são 3 por
 * semana) fica de fora: vale só a frequência. "1 arte, um carrossel normal"
 * conta uma vez (a arte é o carrossel).
 */
export function lerCadencia(texto: unknown, fonte = "pedido"): CadenciaDoMes | null {
  const t = textoParaCadencia(texto);
  if (!t.trim()) return null;
  let porSemana: number | null = null;
  for (const re of [POR_SEMANA, SEMANAIS]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 14) porSemana = n;
    }
  }
  const mix: MixDaSemana = { foto: 0, carrossel: 0, estatico: 0, arte: 0 };
  MIX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let achou = false;
  while ((m = MIX.exec(t))) {
    const n = Number(m[1]);
    if (n < 1 || n > 14) continue;
    mix[categoria(m[2])] += n;
    achou = true;
  }
  const lista = LISTA_DE_DIAS.exec(t);
  const dias = lista ? Array.from(new Set((lista[0].match(/segunda|terca|quarta|quinta|sexta/g) || []).map((d) => DIAS[d]))).sort() : [];

  let mixFinal: MixDaSemana | null = achou ? mix : null;
  if (mixFinal) {
    const semArte = mixFinal.foto + mixFinal.carrossel + mixFinal.estatico;
    // "1 arte, um carrossel normal": a arte é o carrossel (aposto), conta uma vez.
    if (mixFinal.arte > 0 && mixFinal.carrossel + mixFinal.estatico > 0 && (porSemana === semArte || (porSemana === null && mixFinal.arte === mixFinal.carrossel + mixFinal.estatico))) {
      mixFinal = { ...mixFinal, arte: 0 };
    }
    if (porSemana === null) porSemana = somaDoMix(mixFinal);
    const soma = somaDoMix(mixFinal);
    if (soma > porSemana) mixFinal = null;
    else if (soma < porSemana) mixFinal = { ...mixFinal, arte: mixFinal.arte + (porSemana - soma) };
  }
  if (porSemana === null && dias.length >= 2) porSemana = dias.length;
  if (porSemana === null) return null;
  // Mais de 5 por semana (mais de um por dia útil) não vira grade: o Mês segue a frequência como antes.
  if (porSemana > MAX_POR_SEMANA) return null;
  const limitado = Math.max(1, porSemana);
  if (mixFinal && limitado < porSemana) mixFinal = escalarMix(mixFinal, limitado);
  return { por_semana: limitado, mix: mixFinal, dias, fonte };
}

/** A primeira fonte que fala de cadência (passe da mais forte para a mais fraca). */
export function cadenciaDasFontes(fontes: Array<{ texto: unknown; fonte: string } | null | undefined>): CadenciaDoMes | null {
  for (const f of fontes) {
    if (!f) continue;
    const c = lerCadencia(f.texto, f.fonte);
    if (c) return c;
  }
  return null;
}

/** Cadência a partir de números do modelo (plano do mês): por semana e quantos de cada. */
export function cadenciaDosNumeros(o: { por_semana?: unknown; fotos?: unknown; carrosseis?: unknown; estaticos?: unknown }, fonte = "modelo"): CadenciaDoMes | null {
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);
  const mix: MixDaSemana = { foto: n(o.fotos), carrossel: n(o.carrosseis), estatico: n(o.estaticos), arte: 0 };
  let ps = n(o.por_semana);
  const soma = somaDoMix(mix);
  if (!ps && !soma) return null;
  if (!ps) ps = soma;
  if (ps > MAX_POR_SEMANA) return null;
  const limitado = Math.max(1, ps);
  let mixFinal: MixDaSemana | null = soma ? mix : null;
  if (mixFinal && soma > ps) mixFinal = null;
  else if (mixFinal && soma < ps) mixFinal = { ...mixFinal, arte: ps - soma };
  if (mixFinal && limitado < ps) mixFinal = escalarMix(mixFinal, limitado);
  return { por_semana: limitado, mix: mixFinal, dias: [], fonte };
}

/** Cadência guardada (parametros.cadencia) ou mandada pela tela, lida com cuidado; null quando não confere. */
export function normalizarCadencia(bruto: unknown): CadenciaDoMes | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const mix = (o.mix && typeof o.mix === "object" ? o.mix : null) as Record<string, unknown> | null;
  const base = cadenciaDosNumeros({ por_semana: o.por_semana, fotos: mix?.foto, carrosseis: mix?.carrossel, estaticos: mix?.estatico }, String(o.fonte || "pedido").slice(0, 20));
  if (!base) return null;
  if (base.mix && mix && Number(mix.arte) > 0) {
    const arte = Math.round(Number(mix.arte));
    const soma = base.mix.foto + base.mix.carrossel + base.mix.estatico;
    if (soma + arte === base.por_semana) base.mix = { ...base.mix, arte };
  }
  const dias = (Array.isArray(o.dias) ? o.dias : []).map(Number).filter((d) => d >= 1 && d <= 5);
  return { ...base, dias: Array.from(new Set(dias)).sort() };
}

/**
 * Temas nas vagas da grade (detalhar do gerador de meses): tema que sugere o
 * formato da vaga entra primeiro, na ordem; o resto ocupa as vagas que
 * sobram. Devolve o tema → vaga (tema sem vaga fica fora do mapa).
 */
export function temasNasVagas<T extends { id: string; formato_sugerido?: string | null }>(temas: T[], grade: VagaDoMes[]): Map<string, VagaDoMes> {
  const livres = grade.slice();
  const mapa = new Map<string, VagaDoMes>();
  const cabe = (t: T, v: VagaDoMes) => {
    const f = t.formato_sugerido === "foto" || t.formato_sugerido === "estatico" || t.formato_sugerido === "carrossel" ? t.formato_sugerido : "carrossel";
    return formatoCabeNaVaga(f, v.formato);
  };
  for (const exato of [true, false]) {
    for (const t of temas) {
      if (mapa.has(t.id)) continue;
      const k = livres.findIndex((v) => !exato || cabe(t, v));
      if (k < 0) continue;
      mapa.set(t.id, livres.splice(k, 1)[0]);
    }
  }
  return mapa;
}

/** Formato do item que ocupa a vaga ("arte" e livre ficam com o sugerido, se não for foto). */
export function formatoParaVaga(sugerido: unknown, vaga: VagaDoMes): FormatoDoMes {
  const f: FormatoDoMes = sugerido === "foto" || sugerido === "estatico" ? sugerido : "carrossel";
  return formatoNaVaga(f, vaga.formato);
}

/** Frase da cadência: "3 por semana: 2 fotos e 1 carrossel". */
export function fraseDaCadencia(c: CadenciaDoMes): string {
  const partes: string[] = [];
  if (c.mix) {
    for (const k of ["foto", "carrossel", "estatico"] as const) if (c.mix[k]) partes.push(contagem(c.mix[k], k));
    if (c.mix.arte) partes.push(`${c.mix.arte} ${c.mix.arte === 1 ? "arte" : "artes"}`);
  }
  return `${c.por_semana} por semana${partes.length ? `: ${juntarComE(partes)}` : ""}`;
}

// ------------------------------------------------------------------ semanas e grade

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00.000Z`).getUTCDay();
}

export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana da data. */
export function segundaDaSemana(data: string): string {
  const d = diaDaSemana(data);
  return somarDias(data, d === 0 ? -6 : 1 - d);
}

/** Semana ISO 8601: "2026-W41". */
export function semanaIso(data: string): string {
  const quinta = somarDias(segundaDaSemana(data), 3);
  const ano = Number(quinta.slice(0, 4));
  const primeiraQuinta = somarDias(segundaDaSemana(`${ano}-01-04`), 3);
  const n = Math.round((Date.parse(`${quinta}T12:00:00Z`) - Date.parse(`${primeiraQuinta}T12:00:00Z`)) / (7 * 86_400_000)) + 1;
  return `${ano}-W${String(n).padStart(2, "0")}`;
}

/** Dias espalhados por quantidade na semana (1 segunda ... 5 sexta). */
export function diasPadrao(n: number): number[] {
  if (n <= 1) return [3];
  if (n === 2) return [2, 4];
  if (n === 3) return [1, 3, 5];
  if (n === 4) return [1, 2, 4, 5];
  return [1, 2, 3, 4, 5];
}

export type FormatoDaVaga = FormatoDoMes | "arte" | null;

export type VagaDoMes = { data: string; semana: string; formato: FormatoDaVaga };

const ORDEM_DO_MIX: Array<keyof MixDaSemana> = ["foto", "carrossel", "estatico", "arte"];

/** Mix escalado para n posts (maior resto), na proporção do pedido. */
export function escalarMix(mix: MixDaSemana, n: number): MixDaSemana {
  const soma = somaDoMix(mix);
  if (!soma || n === soma) return { ...mix };
  const exatos = ORDEM_DO_MIX.map((k) => (mix[k] * n) / soma);
  const base = exatos.map(Math.floor);
  let resto = n - base.reduce((a, b) => a + b, 0);
  const ordem = exatos.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of ordem) {
    if (resto <= 0) break;
    base[o.i]++;
    resto--;
  }
  return { foto: base[0], carrossel: base[1], estatico: base[2], arte: base[3] };
}

/** Formatos das vagas da semana, intercalados (2 fotos e 1 carrossel: foto, carrossel, foto). */
export function formatosDaSemana(mix: MixDaSemana | null, n: number, porSemana: number): FormatoDaVaga[] {
  if (!mix || n <= 0) return new Array(Math.max(0, n)).fill(null);
  const alvo = n === porSemana ? mix : escalarMix(mix, n);
  const restante = { ...alvo };
  const saida: FormatoDaVaga[] = [];
  for (let i = 0; i < n; i++) {
    let melhor: keyof MixDaSemana | null = null;
    let nota = -1;
    for (const k of ORDEM_DO_MIX) {
      if (!alvo[k] || !restante[k]) continue;
      const r = restante[k] / alvo[k];
      if (r > nota || (r === nota && melhor !== null && alvo[k] > alvo[melhor])) {
        melhor = k;
        nota = r;
      }
    }
    if (!melhor) {
      saida.push(null);
      continue;
    }
    restante[melhor]--;
    saida.push(melhor);
  }
  return saida;
}

/**
 * As vagas do período pela cadência: semana com 3 ou mais dias úteis no
 * período (de `hoje` em diante) recebe a cadência inteira (no máximo um post
 * por dia); semana com 1 ou 2 dias úteis fica livre (ponta do mês).
 */
export function gradeDoMes(cad: CadenciaDoMes, inicio: string, fim: string, hoje?: string | null): VagaDoMes[] {
  if (!DATA.test(inicio) || !DATA.test(fim) || fim < inicio) return [];
  const desde = hoje && DATA.test(hoje) && hoje > inicio ? hoje : inicio;
  const vagas: VagaDoMes[] = [];
  for (let seg = segundaDaSemana(desde), guarda = 0; seg <= fim && guarda < 60; seg = somarDias(seg, 7), guarda++) {
    const disponiveis: number[] = [];
    for (let d = 1; d <= 5; d++) {
      const data = somarDias(seg, d - 1);
      if (data >= desde && data <= fim) disponiveis.push(d);
    }
    if (disponiveis.length < 3) continue;
    const n = Math.min(cad.por_semana, disponiveis.length);
    const preferidos = (cad.dias.length ? cad.dias : diasPadrao(n)).filter((d) => disponiveis.indexOf(d) >= 0);
    const resto = [3, 1, 5, 2, 4].filter((d) => disponiveis.indexOf(d) >= 0 && preferidos.indexOf(d) < 0);
    const dias = preferidos.concat(resto).slice(0, n).sort();
    const formatos = formatosDaSemana(cad.mix, n, cad.por_semana);
    const semana = semanaIso(seg);
    dias.forEach((d, i) => vagas.push({ data: somarDias(seg, d - 1), semana, formato: formatos[i] ?? null }));
  }
  return vagas;
}

// ------------------------------------------------------------------ encaixe

export const formatoCabeNaVaga = (formato: FormatoDoMes, vaga: FormatoDaVaga) =>
  vaga === null || formato === vaga || (vaga === "arte" && formato !== "foto");

/** O formato que o item fica ao ocupar a vaga (vaga "arte" com item de foto vira carrossel). */
export function formatoNaVaga(formato: FormatoDoMes, vaga: FormatoDaVaga): FormatoDoMes {
  if (formatoCabeNaVaga(formato, vaga)) return formato;
  return vaga === "arte" || vaga === null ? "carrossel" : vaga;
}

export type ItemNaGrade<T> = { item: T; vaga: VagaDoMes; formato: FormatoDoMes; trocou_data: boolean; trocou_formato: boolean };
export type Encaixe<T> = { itens: Array<ItemNaGrade<T>>; sobras: T[]; vagas_livres: VagaDoMes[] };

const distancia = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/**
 * Põe os itens nas vagas: primeiro mesma semana e formato que cabe, depois
 * mesma semana trocando o formato, depois outra semana (formato que cabe,
 * senão trocando). Sem vaga: sobra. Vaga sem item: livre (o modelo preenche).
 */
export function encaixarNaGrade<T extends { data: string; formato: FormatoDoMes }>(itens: T[], grade: VagaDoMes[]): Encaixe<T> {
  const livres = grade.slice();
  const pendentes = itens.map((item, i) => ({ item, i })).sort((a, b) => String(a.item.data).localeCompare(String(b.item.data)) || a.i - b.i);
  const saida: Array<ItemNaGrade<T>> = [];
  const passos: Array<(x: T, v: VagaDoMes) => boolean> = [
    (x, v) => semanaIso(x.data) === v.semana && formatoCabeNaVaga(x.formato, v.formato),
    (x, v) => semanaIso(x.data) === v.semana,
    (x, v) => formatoCabeNaVaga(x.formato, v.formato),
    () => true,
  ];
  for (const passo of passos) {
    for (let k = 0; k < pendentes.length; k++) {
      const { item } = pendentes[k];
      if (!DATA.test(String(item.data))) continue;
      let melhor = -1;
      for (let j = 0; j < livres.length; j++) {
        if (!passo(item, livres[j])) continue;
        if (melhor < 0 || distancia(item.data, livres[j].data) < distancia(item.data, livres[melhor].data)) melhor = j;
      }
      if (melhor < 0) continue;
      const vaga = livres.splice(melhor, 1)[0];
      const formato = formatoNaVaga(item.formato, vaga.formato);
      saida.push({ item, vaga, formato, trocou_data: vaga.data !== item.data, trocou_formato: formato !== item.formato });
      pendentes.splice(k, 1);
      k--;
    }
  }
  saida.sort((a, b) => a.vaga.data.localeCompare(b.vaga.data));
  return { itens: saida, sobras: pendentes.map((p) => p.item), vagas_livres: livres };
}

// ------------------------------------------------------------------ conferência

export type SemanaConferida = {
  semana: string;
  inicio: string;
  esperado: number;
  total: number;
  foto: number;
  carrossel: number;
  estatico: number;
  ok: boolean;
};

export type ConferenciaDoMes = {
  ok: boolean;
  total: number;
  esperado: number;
  por_semana: number | null;
  formatos: Record<FormatoDoMes, number>;
  semanas: SemanaConferida[];
  problemas: string[];
  frase: string;
};

export function contagem(n: number, f: FormatoDoMes): string {
  return `${n} ${PLURAL_DO_FORMATO[f][n === 1 ? 0 : 1]}`;
}

export function juntarComE(partes: string[]): string {
  if (partes.length <= 1) return partes[0] || "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * A conta do plano por semana ISO contra a grade da cadência (sem cadência:
 * só a contagem). Frase: "12 posts: 8 fotos e 4 carrosséis, 3 por semana".
 */
export function conferirPlano(itens: Array<{ data: string; formato: FormatoDoMes }>, cad: CadenciaDoMes | null, grade: VagaDoMes[] | null): ConferenciaDoMes {
  const formatos: Record<FormatoDoMes, number> = { foto: 0, carrossel: 0, estatico: 0 };
  for (const i of itens) if (formatos[i.formato] !== undefined) formatos[i.formato]++;
  const porSemana = new Map<string, SemanaConferida>();
  const pegar = (data: string) => {
    const s = semanaIso(data);
    let x = porSemana.get(s);
    if (!x) {
      x = { semana: s, inicio: segundaDaSemana(data), esperado: 0, total: 0, foto: 0, carrossel: 0, estatico: 0, ok: true };
      porSemana.set(s, x);
    }
    return x;
  };
  const esperadoPorFormato = new Map<string, Record<string, number>>();
  for (const v of grade || []) {
    const x = pegar(v.data);
    x.esperado++;
    const e = esperadoPorFormato.get(x.semana) || { foto: 0, carrossel: 0, estatico: 0, arte: 0, livre: 0 };
    e[v.formato || "livre"]++;
    esperadoPorFormato.set(x.semana, e);
  }
  for (const i of itens) {
    if (!DATA.test(String(i.data))) continue;
    const x = pegar(i.data);
    x.total++;
    if (i.formato === "foto" || i.formato === "carrossel" || i.formato === "estatico") x[i.formato]++;
  }
  const semanas = Array.from(porSemana.values()).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const problemas: string[] = [];
  if (cad && grade) {
    for (const s of semanas) {
      const e = esperadoPorFormato.get(s.semana);
      if (!e) {
        // Ponta do mês sem vaga: aceita até um por dia útil, sem passar da cadência.
        if (s.total > cad.por_semana) {
          s.ok = false;
          problemas.push(`semana de ${dataCurta(s.inicio)} com ${s.total} (máximo ${cad.por_semana})`);
        }
        continue;
      }
      const okTotal = s.total === s.esperado;
      // Vaga livre aceita qualquer formato; "arte" aceita carrossel ou estático.
      const okMix = s.foto >= e.foto && s.foto <= e.foto + e.livre && s.carrossel >= e.carrossel && s.estatico >= e.estatico;
      if (!okTotal) problemas.push(`semana de ${dataCurta(s.inicio)} com ${s.total} de ${s.esperado}`);
      else if (!okMix) problemas.push(`semana de ${dataCurta(s.inicio)} fora da mistura (${resumoDaSemana(s)})`);
      s.ok = okTotal && okMix;
    }
  }
  const esperado = grade ? grade.length : itens.length;
  const ok = problemas.length === 0 && (!grade || itens.length === grade.length);
  const partes = (["foto", "carrossel", "estatico"] as const).filter((f) => formatos[f] > 0).map((f) => contagem(formatos[f], f));
  const total = itens.length;
  let frase = `${total} ${total === 1 ? "post" : "posts"}${partes.length ? `: ${juntarComE(partes)}` : ""}${cad ? `, ${cad.por_semana} por semana` : ""}`;
  if (grade && total !== esperado) frase += ` (o pedido dá ${esperado})`;
  if (problemas.length) frase += `. Conferir: ${problemas.slice(0, 3).join("; ")}`;
  return { ok, total, esperado, por_semana: cad ? cad.por_semana : null, formatos, semanas, problemas, frase: `${frase}.` };
}

export function resumoDaSemana(s: Pick<SemanaConferida, "foto" | "carrossel" | "estatico">): string {
  const partes = (["foto", "carrossel", "estatico"] as const).filter((f) => s[f] > 0).map((f) => contagem(s[f], f));
  return partes.length ? juntarComE(partes) : "nada";
}

// ------------------------------------------------------------------ conteúdo: tutorial e repetição

/**
 * Título com cara de tutorial (o dono: "não coisas de tutorial; mais direto,
 * linguagem clara para o cliente"). Confere no título e no tema.
 */
export const PADRAO_DE_TUTORIAL =
  /\b(entenda|entender|o que (e|sao|significa|significam)|como funciona\w*|saiba|aprenda|tutorial|passo a passo|guia (completo|definitivo|pratico|rapido)|explicamos|descomplicando)\b/;

export function pareceTutorial(titulo: unknown): boolean {
  const s = String(titulo == null ? "" : titulo).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return PADRAO_DE_TUTORIAL.test(s);
}

const PALAVRAS_VAZIAS = new Set(
  "a o as os um uma uns umas de do da dos das no na nos nas em por para pra com sem e ou que se seu sua seus suas voce voces mais menos como qual quais quando onde porque ja nao sim ao aos isso esse essa este esta muito pouco sobre ate".split(" "),
);

function palavrasDoTema(t: string): string[] {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p))
    .map((p) => p.replace(/(oes|aes|ais|eis|s)$/, ""));
}

/** Pares de temas parecidos demais (mesmas palavras de conteúdo em 60% ou mais). */
export function temasRepetidos(temas: string[], limiar = 0.6): Array<[number, number]> {
  const conjuntos = temas.map((t) => new Set(palavrasDoTema(t)));
  const pares: Array<[number, number]> = [];
  for (let i = 0; i < conjuntos.length; i++) {
    for (let j = i + 1; j < conjuntos.length; j++) {
      const a = conjuntos[i];
      const b = conjuntos[j];
      if (!a.size || !b.size) continue;
      let comum = 0;
      a.forEach((p) => {
        if (b.has(p)) comum++;
      });
      const uniao = a.size + b.size - comum;
      if (comum / uniao >= limiar) pares.push([i, j]);
    }
  }
  return pares;
}

/** Regras de conteúdo do dono para o Mês (entram nos pedidos ao modelo). */
export const REGRAS_DE_CONTEUDO_DO_MES = `CONTEÚDO DO MÊS (regras do dono):
- Linguagem direta e clara para o cliente final, como quem atende no balcão: frases curtas, sem jargão. Direto é mais conexão.
- Temas sobre o que o cliente deste nicho de fato procura e quer: desejo (o que ele quer ter ou parecer), decisão (escolher, comparar, quanto custa, onde comprar), objeção (medo, dúvida, preço, tempo) e ocasião (momento de vida, data, uso). Nada de tutorial nem de explicar conceito: proibido "entenda", "o que é", "o que significa", "como funciona", "saiba", "aprenda", "passo a passo", "guia".
- Nenhum tema, gancho ou ângulo se repete no mês.
- Peça de foto (formato foto): foto real de produto, pessoa ou ambiente feita na Mesa Foto. Direção concreta em foto: assunto (o produto exato), objetivo, ângulos (2 a 6, ex.: frontal, 3/4, lateral, detalhe, no rosto), cenário, luz, pessoa (ou null), quantidade (padrão 4), texto_na_foto (ou null) e referencias.`;

// ------------------------------------------------------------------ ajuste do plano

export type ItemDoPlano = { data: string; formato: FormatoDoMes; tema: string; foto?: DirecaoDeFoto | null };

export type PendenciaDoItem = { n: number; motivos: Array<"direcao_da_foto" | "tutorial" | "repetido" | "formato_trocado"> };

/** O que o modelo precisa refazer nos itens (direção da foto incompleta, tutorial, repetição, formato trocado para foto). */
export function pendenciasDosItens(itens: Array<ItemDoPlano & { trocou_formato?: boolean }>): PendenciaDoItem[] {
  const pend = new Map<number, PendenciaDoItem>();
  const add = (n: number, m: PendenciaDoItem["motivos"][number]) => {
    const p = pend.get(n) || { n, motivos: [] };
    if (p.motivos.indexOf(m) < 0) p.motivos.push(m);
    pend.set(n, p);
  };
  itens.forEach((i, n) => {
    if (i.formato === "foto" && faltasDaDirecao(i.foto || null).length) add(n, "direcao_da_foto");
    if (i.formato === "foto" && i.trocou_formato) add(n, "formato_trocado");
    if (pareceTutorial(i.tema)) add(n, "tutorial");
  });
  for (const [, j] of temasRepetidos(itens.map((i) => i.tema))) add(j, "repetido");
  return Array.from(pend.values()).sort((a, b) => a.n - b.n);
}

const MOTIVO: Record<PendenciaDoItem["motivos"][number], string> = {
  direcao_da_foto: "complete a direção da foto (assunto, ângulos, cenário, luz)",
  formato_trocado: "virou peça de foto: escreva a direção da foto e ajuste o tema para foto real",
  tutorial: "tema com cara de tutorial: reescreva direto, no desejo, decisão, objeção ou ocasião do cliente",
  repetido: "tema repetido no mês: troque por outro assunto ou ângulo",
};

/** Texto do pedido de ajuste: vagas para preencher e itens para refazer. */
export function textoDoAjuste(
  vagas: Array<{ data: string; formato: FormatoDoMes }>,
  itens: Array<ItemDoPlano>,
  pendencias: PendenciaDoItem[],
): string {
  const linhas: string[] = [];
  if (vagas.length) {
    linhas.push(`VAGAS PARA PREENCHER (um conteúdo novo em cada, exatamente nesta data e neste formato; responda em novos, com o número da vaga):`);
    vagas.forEach((v, k) => linhas.push(`- vaga ${k + 1}: ${v.data} · ${v.formato}`));
  }
  if (pendencias.length) {
    linhas.push(`ITENS PARA REFAZER (mantenha data e formato; responda em ajustes, com o número do item):`);
    for (const p of pendencias) {
      const i = itens[p.n];
      linhas.push(`- item ${p.n + 1}: ${i.data} · ${i.formato} · "${i.tema}" → ${p.motivos.map((m) => MOTIVO[m]).join("; ")}`);
    }
  }
  if (itens.length) {
    linhas.push(`TEMAS JÁ NO PLANO (não repita):`);
    itens.forEach((i, k) => linhas.push(`${k + 1}. ${i.tema}`));
  }
  return linhas.join("\n");
}

/** Item da criação que passa pelo ajuste (data, formato, tema, referência e a direção da foto). */
export type ItemDoAjuste = {
  data: string;
  formato: FormatoDoMes;
  formato_pedido: string | null;
  tema: string;
  referencia: string;
  foto?: DirecaoDeFoto | null;
  trocou_formato?: boolean;
};

/** Formato da vaga vazia para o modelo preencher ("arte" e livre viram carrossel). */
export const formatoDaVaga = (v: VagaDoMes): FormatoDoMes => (v.formato === "foto" || v.formato === "estatico" || v.formato === "carrossel" ? v.formato : "carrossel");

const textoCurto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Aplica a resposta do ajuste (novos por vaga, ajustes por item; números a
 * partir de 1). Vaga preenchida vira item novo na data e no formato da vaga;
 * ajuste troca tema, referência e a direção da foto (a mais completa fica).
 */
export function aplicarAjusteDoPlano<T extends ItemDoAjuste>(itens: T[], vagas: VagaDoMes[], bruto: unknown): { itens: ItemDoAjuste[]; preenchidas: number; refeitos: number } {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const saida: ItemDoAjuste[] = itens.map((i) => ({ ...i }));
  let refeitos = 0;
  for (const a of Array.isArray(o.ajustes) ? o.ajustes : []) {
    const x = (a ?? {}) as Record<string, unknown>;
    const k = Math.round(Number(x.item)) - 1;
    if (!(k >= 0 && k < saida.length)) continue;
    const alvo = saida[k];
    const tema = textoCurto(x.tema, 200);
    if (tema) alvo.tema = tema;
    const ref = textoCurto(x.referencia, 1500);
    if (ref) alvo.referencia = ref;
    if (alvo.formato === "foto" && x.foto && typeof x.foto === "object") {
      const nova = normalizarDirecaoDeFoto(x.foto, { tema: alvo.tema });
      alvo.foto = faltasDaDirecao(nova).length <= faltasDaDirecao(alvo.foto ?? null).length ? nova : alvo.foto;
    }
    refeitos++;
  }
  let preenchidas = 0;
  const usadas = new Set<number>();
  for (const n of Array.isArray(o.novos) ? o.novos : []) {
    const x = (n ?? {}) as Record<string, unknown>;
    const k = Math.round(Number(x.vaga)) - 1;
    const tema = textoCurto(x.tema, 200);
    if (!(k >= 0 && k < vagas.length) || usadas.has(k) || !tema) continue;
    usadas.add(k);
    const formato = formatoDaVaga(vagas[k]);
    const item: ItemDoAjuste = { data: vagas[k].data, formato, formato_pedido: null, tema, referencia: textoCurto(x.referencia, 1500) };
    if (formato === "foto") item.foto = normalizarDirecaoDeFoto(x.foto, { tema });
    saida.push(item);
    preenchidas++;
  }
  saida.sort((a, b) => a.data.localeCompare(b.data));
  return { itens: saida, preenchidas, refeitos };
}
