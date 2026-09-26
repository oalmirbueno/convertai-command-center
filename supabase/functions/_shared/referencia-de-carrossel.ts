/**
 * Referências de carrossel (frente T, 26/09/2026). Puro. Sem travessão.
 *
 * Pedido do dono: uma área por cliente (e da agência) para guardar carrosséis
 * de referência com as lâminas NA ORDEM (ordenar arrastando, reordenar,
 * arquivar). Gerando um carrossel no Estúdio com uma referência escolhida, a
 * lâmina 1 segue a lâmina 1 da referência (capa), a 2 segue a 2 e assim por
 * diante. Com número de lâminas diferente, o mapa é por papel (mapaDasLaminas):
 * capa na capa, miolos pela ordem repetindo o molde do miolo, fechamento no
 * fechamento. O agente entende as PARTES de cada lâmina (título, apoio,
 * imagem, elementos, CTA, continuidade) e aplica conforme o nível de
 * fidelidade do Estúdio (Idêntica, Próxima, Inspirada, Criativa), sempre com
 * o texto desta lâmina: nunca a mesma coisa copiada. A marca é travada
 * (trava-da-marca.ts): letra, cores e logo são sempre os do cliente.
 *
 * Guardada na mesma tabela dos templates (tipo referencia_carrossel), com as
 * lâminas em corpo.laminas_referencia (versões: reordenar vira versão nova).
 */

import { type FidelidadeDaReferencia, fidelidadeDaReferencia, FIDELIDADE_PADRAO, ROTULO_DA_FIDELIDADE } from "./fidelidade-da-referencia.ts";
import { papelPelaOrdem, type PapelDaLamina } from "./continuidade-do-carrossel.ts";
import { blocoDaMarcaTravada, type KitDaTrava, neutralizarMarcaDaReferencia } from "./trava-da-marca.ts";

export const PARTES_DA_LAMINA = ["titulo", "apoio", "imagem", "elementos", "cta", "continuidade"] as const;
export type ParteDaLamina = (typeof PARTES_DA_LAMINA)[number];
export const ROTULOS_DAS_PARTES: Record<ParteDaLamina, string> = {
  titulo: "Título",
  apoio: "Apoio",
  imagem: "Imagem",
  elementos: "Elementos",
  cta: "CTA",
  continuidade: "Continuidade",
};

/** Uma lâmina da referência: o arquivo e a leitura das partes. */
export type LaminaDeReferencia = {
  id: string;
  bucket: string;
  caminho: string;
  nome: string;
  papel: PapelDaLamina;
  partes: Partial<Record<ParteDaLamina, string>>;
};

export const MAX_LAMINAS_DA_REFERENCIA = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const umaLinha = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u2014\u2013]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

/** Lista crua vira lâminas na ordem recebida (papel refeito pela posição). Sem arquivo válido: sai. */
export function normalizarLaminasDeReferencia(v: unknown): LaminaDeReferencia[] {
  const saida: LaminaDeReferencia[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const bucket = umaLinha(o.bucket, 40);
    const caminho = String(o.caminho ?? "").trim().slice(0, 500);
    if (!UUID.test(String(o.id || "")) || !bucket || !caminho || caminho.indexOf("..") >= 0) continue;
    if (saida.some((l) => l.id === o.id)) continue;
    const bruto = o.partes && typeof o.partes === "object" ? (o.partes as Record<string, unknown>) : {};
    const partes: Partial<Record<ParteDaLamina, string>> = {};
    for (const p of PARTES_DA_LAMINA) {
      const t = umaLinha(bruto[p], 240);
      if (t) partes[p] = t;
    }
    saida.push({ id: String(o.id), bucket, caminho, nome: umaLinha(o.nome, 120) || `lâmina ${saida.length + 1}`, papel: "miolo", partes });
    if (saida.length >= MAX_LAMINAS_DA_REFERENCIA) break;
  }
  return saida.map((l, i) => ({ ...l, papel: papelPelaOrdem(i + 1, saida.length) }));
}

/** Reordenar: a nova ordem pelos ids (todos e sem repetir); qualquer outra coisa é recusada (null). */
export function reordenarLaminas(laminas: LaminaDeReferencia[], ordemDosIds: unknown): LaminaDeReferencia[] | null {
  const ids = Array.isArray(ordemDosIds) ? ordemDosIds.map(String) : [];
  if (ids.length !== laminas.length || new Set(ids).size !== ids.length) return null;
  const nova: LaminaDeReferencia[] = [];
  for (const id of ids) {
    const l = laminas.find((x) => x.id === id);
    if (!l) return null;
    nova.push(l);
  }
  return nova.map((l, i) => ({ ...l, papel: papelPelaOrdem(i + 1, nova.length) }));
}

/**
 * Mapa determinístico: para cada lâmina gerada (1..total), qual lâmina da
 * referência (1..deRef) ela segue.
 * - Mesmo número: 1 com 1, 2 com 2...
 * - Capa com capa (1) e fechamento com fechamento (a última).
 * - Miolos pela ordem (2, 3...) e, quando faltam miolos na referência, o
 *   molde do miolo repete (ciclo 2..deRef-1).
 * - Referência sem miolo (2 lâminas): o miolo segue a capa.
 * - Referência de 1 lâmina: tudo segue a 1.
 */
export function mapaDasLaminas(deRef: number, total: number): number[] {
  const R = Math.floor(deRef);
  const G = Math.floor(total);
  if (!(R >= 1) || !(G >= 1)) return [];
  if (R === G) return Array.from({ length: G }, (_, i) => i + 1);
  if (R === 1) return Array.from({ length: G }, () => 1);
  const miolosDaRef = R - 2;
  return Array.from({ length: G }, (_, i) => {
    const ordem = i + 1;
    if (ordem === 1) return 1;
    if (G >= 2 && ordem === G) return R;
    if (miolosDaRef <= 0) return 1;
    return 2 + ((ordem - 2) % miolosDaRef);
  });
}

export const INSTRUCAO_DA_FIDELIDADE: Record<FidelidadeDaReferencia, string> = {
  identica: "quase idêntica: a mesma grade, a posição e a escala de cada parte, o mesmo recorte e tratamento; mudam o texto, o assunto e a marca (a do cliente)",
  proxima: "próxima: o mesmo layout e a mesma grade; pose, enquadramento, elementos secundários e detalhes livres",
  inspirada: "inspirada: a lâmina da referência guia a hierarquia e o sistema gráfico; a composição é nova",
  criativa: "criativa: só o clima, o ritmo e a energia dela; composição e ideia novas",
};

/** O nível que vale: o escolhido com a referência, senão o do trabalho, senão o padrão do Estúdio. */
export function fidelidadeDaReferenciaDeCarrossel(escolha: unknown, direcao: unknown): FidelidadeDaReferencia {
  const d = direcao && typeof direcao === "object" ? (direcao as Record<string, unknown>) : {};
  return fidelidadeDaReferencia(escolha) || fidelidadeDaReferencia(d.fidelidade_referencia) || FIDELIDADE_PADRAO;
}

export const ROTULO_DA_LAMINA_DE_REFERENCIA =
  "lâmina da REFERÊNCIA DE CARROSSEL que esta lâmina segue: empresta layout, hierarquia e tratamento; não copie o texto, a pessoa, o produto, a letra, as cores nem a marca dela";

export const TETO_DO_BLOCO_DA_REFERENCIA = 1_400;

/**
 * Bloco "REFERÊNCIA DE CARROSSEL" da lâmina: qual lâmina da referência ela
 * segue, as partes, o nível e a trava da marca. Todo o texto que veio da
 * referência passa pela neutralização (fonte, hex e cor dela saem).
 */
export function blocoDaReferenciaDeCarrossel(
  nome: string,
  laminas: LaminaDeReferencia[],
  e: { ordem: number; total: number; fidelidade: FidelidadeDaReferencia; indice: number | null; kit?: KitDaTrava; continuidade?: string[] },
): string {
  if (!laminas.length) return "";
  const mapa = mapaDasLaminas(laminas.length, e.total);
  const k = mapa[e.ordem - 1];
  const ref = k ? laminas[k - 1] : null;
  if (!ref) return "";
  const kit = e.kit || null;
  const papel = papelPelaOrdem(e.ordem, e.total);
  const cabeca = `REFERÊNCIA DE CARROSSEL "${umaLinha(nome, 60) || "escolhida"}": esta lâmina (${e.ordem} de ${e.total}, ${papel}) segue a lâmina ${k} de ${laminas.length} da referência (${ref.papel}). O texto exato desta lâmina, a logo e as referências da lâmina valem sobre ela.`;
  const linhas: string[] = [];
  if (e.indice) linhas.push(`- Imagem ${e.indice}: essa lâmina da referência.`);
  linhas.push(`- Nível ${ROTULO_DA_FIDELIDADE[e.fidelidade]}: ${INSTRUCAO_DA_FIDELIDADE[e.fidelidade]}.`);
  const partes = PARTES_DA_LAMINA.filter((p) => ref.partes[p]).map((p) => `${ROTULOS_DAS_PARTES[p].toLowerCase()}: ${ref.partes[p]}`);
  if (partes.length) linhas.push(`- PARTES DA LÂMINA ${k}: ${partes.join("; ")}.`);
  linhas.push("- Adapte cada parte ao conteúdo desta lâmina: o título dela no lugar do título, o apoio dela no lugar do apoio, a imagem do assunto dela. Nunca repita o texto nem a imagem da referência.");
  const continuidade = (e.continuidade || []).map((l) => umaLinha(l, 320));
  const vindoDaReferencia = neutralizarMarcaDaReferencia([cabeca, ...linhas, ...continuidade].join("\n"), kit);
  const saida = `${vindoDaReferencia}\n${blocoDaMarcaTravada(kit)}`;
  return saida.length > TETO_DO_BLOCO_DA_REFERENCIA ? cortarNoTeto(vindoDaReferencia, blocoDaMarcaTravada(kit)) : saida;
}

/** Cabe no teto: corta o texto da referência, nunca a trava da marca. */
function cortarNoTeto(daReferencia: string, trava: string): string {
  const vaga = Math.max(0, TETO_DO_BLOCO_DA_REFERENCIA - trava.length - 1);
  return `${daReferencia.slice(0, vaga).trim()}\n${trava}`;
}

// ------------------------------------------------------------------ leitura das partes (visão)

export const SISTEMA_DAS_PARTES = `Você lê as lâminas de um carrossel de referência, na ordem (imagem 1 é a primeira lâmina), para a equipe reaproveitar o molde com outro conteúdo e outra marca. Para cada lâmina descreva em poucas palavras cada parte: titulo (posição, tamanho relativo, peso, caixa, quantas linhas), apoio (idem), imagem (o que ocupa, recorte, tratamento), elementos (formas, linhas, ícones, selos), cta (onde e como; vazio quando não há) e continuidade (o que liga esta lâmina à próxima; vazio quando nada). Não cite a fonte pelo nome, nem cores pelo nome ou código: diga a função (dominante, destaque, neutro). Não copie o texto. Português, sem travessão. Responda só com o JSON pedido.`;

export const ESQUEMA_DAS_PARTES = {
  nome: "partes_das_laminas",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["laminas"],
    properties: {
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem_n", ...PARTES_DA_LAMINA],
          properties: { imagem_n: { type: "integer" }, ...Object.fromEntries(PARTES_DA_LAMINA.map((p) => [p, { type: "string" }])) },
        },
      },
    },
  },
};

/** Leitura crua das partes vira o mapa por posição (1..n). A trava tira fonte e cor que o leitor deixou escapar. */
export function partesLidas(bruto: unknown, n: number): Array<Partial<Record<ParteDaLamina, string>>> {
  const saida: Array<Partial<Record<ParteDaLamina, string>>> = Array.from({ length: Math.max(0, n) }, () => ({}));
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  for (const x of Array.isArray(o.laminas) ? o.laminas : []) {
    if (!x || typeof x !== "object") continue;
    const l = x as Record<string, unknown>;
    const i = Number(l.imagem_n) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    for (const p of PARTES_DA_LAMINA) {
      const t = neutralizarMarcaDaReferencia(umaLinha(l[p], 240));
      if (t) saida[i][p] = t;
    }
  }
  return saida;
}
