/**
 * Limites reais das redes simuladas no Template (21/10/2026). O mesmo código
 * conta na tela (aviso no campo) e no servidor (texto gerado), sem Deno.
 * Compatível com Safari 11: nada de lookbehind, \p{} ou grupo nomeado.
 */

/** Limite de um post do X sem assinatura. */
export const LIMITE_DO_X = 280;
/** Legenda do Instagram: limite do app e quantas hashtags ele aceita. */
export const LIMITE_DA_LEGENDA = 2200;
export const MAX_HASHTAGS = 30;
/** Os primeiros caracteres que aparecem antes do "mais" (o gancho). */
export const GANCHO_DA_LEGENDA = 125;
/** Texto curto de um Story (mais que isso não cabe legível na tela). */
export const LIMITE_DO_STORY = 160;
/** Um link no X sempre conta 23, qualquer que seja o tamanho. */
const PESO_DO_LINK = 23;

const LINK = /https?:\/\/[^\s]+/g;

/** Peso 1 só nas faixas latinas e de pontuação comum; o resto (emoji, CJK) conta 2, como no X. */
function pesoDoCaractere(codigo: number): number {
  if (codigo <= 4351) return 1;
  if (codigo >= 8192 && codigo <= 8205) return 1;
  if (codigo >= 8208 && codigo <= 8223) return 1;
  if (codigo >= 8242 && codigo <= 8247) return 1;
  return 2;
}

/** Caracteres do post como o X conta (links 23, emoji 2). */
export function caracteresDoX(texto: string): number {
  let total = 0;
  const semLinks = String(texto || "").replace(LINK, () => {
    total += PESO_DO_LINK;
    return "";
  });
  for (const c of Array.from(semLinks.normalize("NFC"))) total += pesoDoCaractere(c.codePointAt(0) || 0);
  return total;
}

export function hashtagsDoTexto(texto: string): string[] {
  return String(texto || "").match(/#[0-9A-Za-zÀ-ÖØ-öø-ÿ_]+/g) || [];
}

export type RedeDoTemplate = "twitter" | "instagram" | "story";

export interface AvisoDoLimite {
  usado: number;
  limite: number;
  passou: boolean;
  texto: string;
}

/** Contagem e aviso do campo de texto, por rede. */
export function limiteDoTexto(rede: RedeDoTemplate, texto: string): AvisoDoLimite {
  if (rede === "twitter") {
    const usado = caracteresDoX(texto);
    return { usado, limite: LIMITE_DO_X, passou: usado > LIMITE_DO_X, texto: usado > LIMITE_DO_X ? `Passou ${usado - LIMITE_DO_X} do limite de ${LIMITE_DO_X} do X` : `${usado} de ${LIMITE_DO_X}` };
  }
  const usado = Array.from(String(texto || "")).length;
  if (rede === "story") return { usado, limite: LIMITE_DO_STORY, passou: usado > LIMITE_DO_STORY, texto: usado > LIMITE_DO_STORY ? `Passou ${usado - LIMITE_DO_STORY} do limite de ${LIMITE_DO_STORY} do Story` : `${usado} de ${LIMITE_DO_STORY}` };
  const tags = hashtagsDoTexto(texto).length;
  if (usado > LIMITE_DA_LEGENDA) return { usado, limite: LIMITE_DA_LEGENDA, passou: true, texto: `Passou ${usado - LIMITE_DA_LEGENDA} do limite de ${LIMITE_DA_LEGENDA} da legenda` };
  if (tags > MAX_HASHTAGS) return { usado, limite: LIMITE_DA_LEGENDA, passou: true, texto: `${tags} hashtags: o Instagram aceita até ${MAX_HASHTAGS}` };
  return { usado, limite: LIMITE_DA_LEGENDA, passou: false, texto: `${usado} de ${LIMITE_DA_LEGENDA}${tags ? ` · ${tags} hashtag${tags === 1 ? "" : "s"}` : ""}` };
}
