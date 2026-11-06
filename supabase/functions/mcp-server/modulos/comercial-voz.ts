/**
 * Como o executivo fala (05/11/2026, dono: "se fala Acelériq" e "deixe mais natural"). Puro.
 * O nome ganha o acento só na voz; a escrita segue Aceleriq. Estabilidade baixa e um pouco de estilo soltam a entonação.
 */
export const AJUSTES_DA_VOZ = { stability: 0.3, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true, speed: 1.0 };

export function textoFalado(texto: string): string {
  return String(texto || "")
    .replace(/acel[eé]riq/gi, "Acelériq")
    .replace(/\s+/g, " ")
    .trim();
}
