/** Valores comerciais em centavos inteiros. Nunca usados para autorizar uma compra. */
export const reais = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );
export function centavosDoCampo(valor: string): number | null {
  const s = valor.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return null;
  const [inteiro, fracao = ""] = s.split(/[.,]/);
  const n = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export const quantidadePossivel = (creditos: number, tarifa: number) =>
  tarifa > 0 ? Math.floor(creditos / tarifa) : 0;
