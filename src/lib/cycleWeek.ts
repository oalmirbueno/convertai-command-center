/**
 * Datas do Ciclo da Semana, sempre no fuso de quem está olhando.
 *
 * A tela é usada no celular, de segunda a domingo, e o dia mostrado tem que
 * ser o dia real do usuário. Converter para UTC (toISOString) desloca a data
 * em parte do mundo e faz a semana aparecer errada, então toda chave de
 * semana aqui é montada com os componentes locais da data.
 */

/** Chave de data (yyyy-mm-dd) no fuso local, nunca em UTC. */
export function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Segunda-feira da semana da data informada (semana de segunda a domingo). */
export function mondayOf(base: Date): Date {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

export function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

/** Os sete dias da semana que começa na segunda informada. */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function isSameDay(a: Date, b: Date): boolean {
  return localIso(a) === localIso(b);
}

/** "10 a 16 de agosto" — e com os dois meses quando a semana vira o mês. */
export function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const startDay = weekStart.getDate();
  const endDay = end.getDate();
  const monthOf = (date: Date) =>
    date.toLocaleDateString("pt-BR", { month: "long" });
  return weekStart.getMonth() === end.getMonth()
    ? `${startDay} a ${endDay} de ${monthOf(weekStart)}`
    : `${startDay} de ${monthOf(weekStart)} a ${endDay} de ${monthOf(end)}`;
}

/** Iniciais dos dias, na ordem da semana (segunda primeiro). */
export const WEEKDAY_INITIALS = ["S", "T", "Q", "Q", "S", "S", "D"] as const;

/**
 * Quantas semanas seguidas, contando da mais recente fechada para trás, o
 * cliente (ou a carteira) fechou por completo. É o que dá a sensação de
 * avanço: a sequência só quebra quando uma semana fica incompleta.
 */
export function closedStreak(
  weekKeys: readonly string[],
  isClosed: (weekKey: string) => boolean,
): number {
  let streak = 0;
  for (let index = weekKeys.length - 1; index >= 0; index -= 1) {
    if (!isClosed(weekKeys[index])) break;
    streak += 1;
  }
  return streak;
}
