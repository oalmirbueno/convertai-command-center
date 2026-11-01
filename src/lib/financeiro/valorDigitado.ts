/**
 * Valor em reais digitado num campo de texto livre (ex.: o simulador do Limite do mês, na Área do CFO).
 *
 * Antes o campo tirava todos os pontos e trocava a vírgula: "1500.50" (ponto decimal, como o teclado
 * numérico do celular e o copiar-colar de planilha entregam) virava 150050, e o CFO avaliava um gasto
 * cem vezes maior. Agora:
 * - com vírgula, ela é o decimal e os pontos são milhar ("1.500,50" = 1500,5), como em MemoriaDaConta;
 * - sem vírgula, ponto só é milhar quando separa grupos de três dígitos ("1.500" e "12.345.678"), que é
 *   o formato do placeholder do campo; qualquer outro ponto é decimal ("1500.50" = 1500,5, "1.5" = 1,5).
 *
 * Vazio ou inválido devolve null.
 */
export function valorDigitadoEmReais(digitado: string): number | null {
  const s = digitado.trim();
  if (!s) return null;
  let normalizado: string;
  if (s.includes(",")) normalizado = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normalizado = s.replace(/\./g, "");
  else normalizado = s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
