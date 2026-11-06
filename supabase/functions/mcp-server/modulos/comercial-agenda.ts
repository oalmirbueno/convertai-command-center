/**
 * Os horários de reunião do Almir (05/11/2026, dono): uma por dia. Terça e quinta às 11h, ou às 16h se as 11h estiverem
 * ocupadas. Quarta só às 11h. Puro: sem Deno e sem banco. Horário de São Paulo (UTC-3, sem horário de verão).
 */

const SP_MS = 3 * 3600000;
const GRADE: Record<number, number[]> = { 2: [11, 16], 3: [11], 4: [11, 16] };
const DURACAO_MS = 3600000;
const ANTECEDENCIA_MS = 3 * 3600000;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export interface Intervalo { inicio: string; fim: string }
export interface Horario { inicio: string; rotulo: string }

const diaDeSP = (ms: number) => new Date(ms - SP_MS).toISOString().slice(0, 10);

export function rotuloDoHorario(iso: string): string {
  const d = new Date(Date.parse(iso) - SP_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${DIAS[d.getUTCDay()]}, ${dd}/${mm}, às ${d.getUTCHours()}h`;
}

/** Os próximos horários livres: no máximo um por dia, que é o primeiro livre da grade daquele dia. */
export function horariosLivres(agoraMs: number, ocupados: Intervalo[], diasComReuniao: string[], maximo = 4, janelaDias = 21): Horario[] {
  const out: Horario[] = [];
  const blocos = (ocupados || []).map((o) => [Date.parse(o.inicio), Date.parse(o.fim)]).filter((b) => isFinite(b[0]) && isFinite(b[1]));
  const base = Date.parse(diaDeSP(agoraMs) + "T00:00:00Z");
  for (let i = 0; i <= janelaDias && out.length < maximo; i++) {
    const dia = new Date(base + i * 86400000);
    const horas = GRADE[dia.getUTCDay()];
    const chave = dia.toISOString().slice(0, 10);
    if (!horas || diasComReuniao.indexOf(chave) >= 0) continue;
    for (const h of horas) {
      const ini = Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h) + SP_MS;
      const fim = ini + DURACAO_MS;
      if (ini - agoraMs < ANTECEDENCIA_MS) continue;
      if (blocos.some((b) => b[0] < fim && b[1] > ini)) continue;
      const iso = new Date(ini).toISOString();
      out.push({ inicio: iso, rotulo: rotuloDoHorario(iso) });
      break;
    }
  }
  return out;
}

/** O horário é da grade do Almir? O banco garante o resto: uma reunião por dia. */
export function horarioDaGrade(iso: string): boolean {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return false;
  const d = new Date(ms - SP_MS);
  return (GRADE[d.getUTCDay()] || []).indexOf(d.getUTCHours()) >= 0 && d.getUTCMinutes() === 0;
}

export const diaDoHorario = (iso: string) => diaDeSP(Date.parse(iso));
