/**
 * Segunda-feira 00:00 (hora local) da semana de `agora`.
 *
 * Mora sozinha (19/11/2026) porque o contador do menu (useMensagensDaSemana,
 * na casca do painel) só precisa disto. Importada de mensagensDaSemana.ts, ela
 * levava para o primeiro arquivo do painel a Central inteira (esteira, ritual,
 * revisão): cerca de 80 KB de código que a abertura não usa.
 */
export function inicioDaSemana(agora: number): number {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
