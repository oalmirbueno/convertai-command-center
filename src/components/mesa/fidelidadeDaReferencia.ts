/**
 * Fidelidade à referência e prancha no Estúdio (frente E, 25/09 à noite):
 * espelho do servidor (supabase/functions/_shared/fidelidade-da-referencia.ts
 * e prancha-de-referencias.ts) para a tela. Sem travessão.
 */

export type Fidelidade = "identica" | "proxima" | "inspirada" | "criativa";

export const FIDELIDADES: { valor: Fidelidade; rotulo: string; dica: string }[] = [
  { valor: "identica", rotulo: "Idêntica", dica: "Refaz a referência com a marca, o texto e a foto desta lâmina. É o padrão." },
  { valor: "proxima", rotulo: "Próxima", dica: "Mesmo layout e mesma grade; pose, enquadramento, elementos secundários e detalhes novos." },
  { valor: "inspirada", rotulo: "Inspirada", dica: "A referência vira guia de estilo e do sistema gráfico; a composição é nova." },
  { valor: "criativa", rotulo: "Criativa", dica: "Só o clima, a paleta e a energia da referência; composição e ideia novas." },
];

export const ROTULO_DA_FIDELIDADE: Record<Fidelidade, string> = { identica: "Idêntica", proxima: "Próxima", inspirada: "Inspirada", criativa: "Criativa" };

export function fidelidadeValida(v: unknown): Fidelidade | null {
  return v === "identica" || v === "proxima" || v === "inspirada" || v === "criativa" ? v : null;
}

/** O nível que vale na lâmina: o dela, senão o do trabalho, senão Idêntica (igual ao servidor). */
export function fidelidadeDaLamina(card: { fidelidade_referencia?: unknown } | null | undefined, direcao: { fidelidade_referencia?: unknown } | null | undefined): Fidelidade {
  return fidelidadeValida(card ? card.fidelidade_referencia : null) || fidelidadeValida(direcao ? direcao.fidelidade_referencia : null) || "identica";
}

/** Corpo do configurar: na lâmina, null volta para o padrão do trabalho; no conjunto, null volta para Idêntica. */
export function corpoDaFidelidade(alvo: "lamina" | "conjunto", valor: Fidelidade | null, ordem?: number): Record<string, unknown> {
  return alvo === "lamina" ? { card: { ordem, fidelidade_referencia: valor } } : { conjunto: { fidelidade_referencia: valor } };
}

/** Rótulo curto da versão que nasceu no modo replicar: "Ref. Próxima"; vazio fora dele ou sem o nível gravado. */
export function rotuloDaVersao(v: { modo?: string; fidelidade_referencia?: string } | null | undefined): string {
  if (!v || v.modo !== "replicar_referencia") return "";
  const f = fidelidadeValida(v.fidelidade_referencia);
  return f ? `Ref. ${ROTULO_DA_FIDELIDADE[f]}` : "";
}

/**
 * O selo da série nas lâminas 2..N (só informação, a regra é a do servidor):
 * sem referência a lâmina segue a capa (blocoDaSerie + capa anexada); com
 * referência (dela ou do conjunto) ela segue a referência.
 */
export function seloDaSerie(
  card: { ordem: number; referencias_ids?: string[] },
  total: number,
  refsDoConjunto: string[] | null | undefined,
): { tipo: "capa" | "referencia"; daLamina: boolean; referencia: string | null } | null {
  if (total < 2 || card.ordem < 2) return null;
  const proprias = card.referencias_ids || [];
  const refs = proprias.length ? proprias : refsDoConjunto || [];
  if (!refs.length) return { tipo: "capa", daLamina: false, referencia: null };
  return { tipo: "referencia", daLamina: proprias.length > 0, referencia: refs[0] };
}

// ------------------------------------------------------------------ prancha

export type PapelDoQuadro = "capa" | "sequencia" | "fora";
export const ROTULO_DO_PAPEL: Record<PapelDoQuadro, string> = { capa: "capa", sequencia: "sequência", fora: "fora" };

export interface QuadroDaPrancha {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  papel: PapelDoQuadro;
}

export interface PranchaLida {
  prancha: boolean;
  tipo: "perfil" | "carrossel" | "mosaico" | null;
  quadros: QuadroDaPrancha[];
  sistema: string;
}

export interface RespostaDaPrancha {
  referencia_id: string;
  lida: boolean;
  leu_agora?: boolean;
  prancha: PranchaLida | null;
  papeis_da_equipe?: PapelDoQuadro[] | null;
  parece_arte_unica?: boolean | null;
  dimensoes?: { largura: number; altura: number } | null;
  url?: string | null;
}

/** Clique no quadro: capa, sequência, fora e de volta a capa. */
export function proximoPapel(p: PapelDoQuadro): PapelDoQuadro {
  return p === "capa" ? "sequencia" : p === "sequencia" ? "fora" : "capa";
}

/** Corpo do configurar com os papéis de todos os quadros (null tira o ajuste da equipe). */
export function corpoDaPrancha(referenciaId: string, papeis: PapelDoQuadro[] | null): Record<string, unknown> {
  return { conjunto: { prancha: { referencia_id: referenciaId, papeis } } };
}

/**
 * Estilo que mostra só o quadro dentro da imagem inteira (sem recortar no
 * código): a caixa guarda a proporção do quadro e a imagem desloca e amplia.
 * Porcentagens de CSS: largura e esquerda pela largura da caixa, topo pela
 * altura da caixa (a imagem é absoluta).
 */
export function estiloDoQuadro(q: QuadroDaPrancha, dimensoes?: { largura: number; altura: number } | null): {
  caixa: { position: "relative"; overflow: "hidden"; width: string; paddingBottom: string };
  imagem: { position: "absolute"; maxWidth: "none"; width: string; left: string; top: string };
} {
  const l = Math.max(0.5, q.x1 - q.x0);
  const a = Math.max(0.5, q.y1 - q.y0);
  const proporcao = dimensoes && dimensoes.largura > 0 ? (a * dimensoes.altura) / (l * dimensoes.largura) : 1.25;
  const r = (n: number) => `${Math.round(n * 100) / 100}%`;
  return {
    caixa: { position: "relative", overflow: "hidden", width: "100%", paddingBottom: r(proporcao * 100) },
    // Com a caixa na proporção do quadro, o topo em % da altura da caixa é -(y0 / altura do quadro).
    imagem: { position: "absolute", maxWidth: "none", width: r((100 / l) * 100), left: r(-(q.x0 / l) * 100), top: r(-(q.y0 / a) * 100) },
  };
}
