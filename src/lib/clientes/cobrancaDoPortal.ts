import { formatBRDate, todayBR } from "@/lib/dateBR";

/**
 * Datas da cobrança no Financeiro do cliente (portal).
 *
 * `due_date` e `plan_renewal_date` são colunas DATE ("AAAA-MM-DD"). `new Date("2026-11-10")` é meia-noite UTC,
 * ou seja 09/11 às 21h em São Paulo: o cliente via o vencimento um dia antes e a cobrança ficava "Atrasado"
 * desde a noite da véspera e o dia inteiro do vencimento. Aqui o dia é lido como dia de calendário e comparado
 * com o hoje de São Paulo. Puro (Safari 11: sem lookbehind, sem grupo nomeado).
 */

/** dd/mm/aaaa no dia certo, para DATE ou timestamp; vazio quando não há data. */
export function dataDoPortal(valor?: string | null): string {
  if (!valor) return "";
  const s = formatBRDate(valor);
  return s === "-" ? "" : s;
}

/** Atrasada só depois do dia do vencimento (no próprio dia ainda está em dia). `hoje` em AAAA-MM-DD. */
export function cobrancaAtrasada(status: string | null | undefined, vencimento: string | null | undefined, hoje: string = todayBR()): boolean {
  if (status !== "pending") return false;
  const dia = typeof vencimento === "string" ? vencimento.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  return dia < hoje;
}
