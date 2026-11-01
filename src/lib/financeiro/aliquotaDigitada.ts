/**
 * Alíquota digitada em Planos e preços (campos "Alíquota (%)") para a fração que o resto do cálculo usa.
 *
 * O campo é sempre em porcentagem: o modal de novo preço preenche com a alíquota salva já multiplicada
 * por 100 (0,06 vira "6") e o simulador começa em "6". Antes a conversão adivinhava a unidade (`v > 1 ?
 * v / 100 : v`): "0,5" (meio por cento) virava 50% e "1" virava 100%, que o salvar recusa. E uma alíquota
 * salva de 0,5% reaparecia como "0.5" no modal e, salva de novo, passava a valer 50%.
 *
 * Aceita vírgula ou ponto decimal. Vazio ou inválido devolve null ("sem alíquota").
 */
export function aliquotaDigitadaEmFracao(digitado: string): number | null {
  if (!digitado.trim()) return null;
  const v = parseFloat(digitado.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  return v / 100;
}
