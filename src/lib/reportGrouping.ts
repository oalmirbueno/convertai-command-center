// Helpers para organizar relatórios em pastas (cliente → modelo de período)

export type PeriodModel = "Diário" | "Semanal" | "Quinzenal" | "Mensal" | "Trimestral" | "Personalizado";

export function getPeriodModel(period_start?: string | null, period_end?: string | null): PeriodModel {
  if (!period_start || !period_end) return "Personalizado";
  const start = new Date(period_start).getTime();
  const end = new Date(period_end).getTime();
  if (isNaN(start) || isNaN(end)) return "Personalizado";
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (days <= 1) return "Diário";
  if (days <= 9) return "Semanal";
  if (days <= 16) return "Quinzenal";
  if (days <= 45) return "Mensal";
  if (days <= 100) return "Trimestral";
  return "Personalizado";
}

export const PERIOD_ORDER: PeriodModel[] = [
  "Diário", "Semanal", "Quinzenal", "Mensal", "Trimestral", "Personalizado",
];

export function getClientName(r: any): string {
  return r.client?.company_name || r.client?.full_name || "Sem cliente";
}

/**
 * Groups: { [clientName]: { [periodModel]: Report[] } }
 */
export function groupReports<T extends { period_start?: string | null; period_end?: string | null }>(
  reports: T[],
  getClient: (r: T) => string,
): Record<string, Record<string, T[]>> {
  const out: Record<string, Record<string, T[]>> = {};
  for (const r of reports) {
    const c = getClient(r);
    const m = getPeriodModel(r.period_start, r.period_end);
    if (!out[c]) out[c] = {};
    if (!out[c][m]) out[c][m] = [];
    out[c][m].push(r);
  }
  return out;
}
