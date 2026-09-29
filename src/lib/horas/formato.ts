/** Formatos de tempo e dinheiro da central de horas (frente CR). */

const dois = (n: number) => (n < 10 ? "0" : "") + n;

/** Relógio "H:MM:SS" (horas sem teto: 132:04:09). */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${dois(m)}:${dois(s % 60)}`;
}

/** Relógio curto "H:MM" (celular). */
export function formatarRelogioCurto(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos || 0));
  return `${Math.floor(s / 3600)}:${dois(Math.floor((s % 3600) / 60))}`;
}

/** Duração legível: "12h 05m", "45m", "0m". */
export function formatarDuracao(segundos: number): string {
  const s = Math.max(0, Math.round(segundos || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${dois(m)}m`;
}

/** Horas com uma casa ("12,5 h"). */
export function formatarHoras(horas: number | null, casas = 1): string {
  if (horas === null || !isFinite(horas)) return "sem base";
  return `${horas.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas })} h`;
}

/** Dólar com 2 casas (ou 3 quando é centavo). */
export function formatarUsd(valor: number | null): string {
  if (valor === null || !isFinite(valor)) return "sem base";
  const casas = Math.abs(valor) > 0 && Math.abs(valor) < 0.1 ? 3 : 2;
  return `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

/** Variação em %, com sinal ("+12%", "-8%"). */
export function formatarVariacao(pct: number | null): string {
  if (pct === null || !isFinite(pct)) return "sem base";
  const r = Math.round(pct);
  return `${r > 0 ? "+" : ""}${r}%`;
}

/** Número com até uma casa. */
export function formatarNumero(n: number | null, casas = 1): string {
  if (n === null || !isFinite(n)) return "sem base";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09-01" -> "setembro de 2026". */
export function rotuloDoMes(mes: string): string {
  const [a, m] = mes.split("-");
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${MESES[i]} de ${a}` : mes;
}

/** "2026-09-01" -> "set". */
export function rotuloCurtoDoMes(mes: string): string {
  const i = Number(mes.split("-")[1]) - 1;
  return i >= 0 && i < 12 ? MESES_CURTOS[i] : mes;
}
