import type { MetricaSemanaFato } from "./esteiraTipos";

const DIA = 86_400_000;
const dataBrasil = (data: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(data);
const deslocar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Semanas consecutivas encerradas no calendário brasileiro. Uma coleta
 * feita antes do encerramento não prova uma semana completa, mesmo depois.
 * Isso não atesta a completude da API de origem; preserva a evidência disponível. */
export function periodoSocial(metricas: readonly MetricaSemanaFato[], hoje: Date) {
  const dia = dataBrasil(hoje);
  const diaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  const corrente = deslocar(dia, -((diaSemana + 6) % 7));
  const inicio = deslocar(corrente, -7);
  const inicioAnterior = deslocar(corrente, -14);
  const fim = deslocar(inicio, 6);
  const de = (semana: string) => metricas.find((m) => m.weekStart === semana);
  const completa = (m: MetricaSemanaFato | undefined) => {
    if (!m || m.weekEnd !== deslocar(m.weekStart, 6) || !m.capturedAt) return false;
    const coleta = new Date(m.capturedAt);
    return Number.isFinite(coleta.getTime()) && coleta <= hoje && dataBrasil(coleta) > m.weekEnd;
  };
  const registro = de(inicio);
  const registroAnterior = de(inicioAnterior);
  const atual = completa(registro) ? registro : undefined;
  const anterior = completa(registroAnterior) ? registroAnterior : undefined;
  const parcial = de(corrente);
  let descricao = `semana encerrada de ${curta(inicio)} a ${curta(fim)}`;
  if (atual) descricao += ` · coleta ${curta(dataBrasil(new Date(atual.capturedAt!)))}`;
  else descricao += registro ? " · coleta completa não confirmada" : " · dados ausentes";
  descricao += anterior ? ` · comparação com ${curta(inicioAnterior)} a ${curta(deslocar(inicioAnterior, 6))}` : " · sem base anterior completa";
  if (parcial) descricao += ` · semana de ${curta(corrente)} parcial, fora da comparação`;
  return { atual, anterior, inicio, descricao };
}
