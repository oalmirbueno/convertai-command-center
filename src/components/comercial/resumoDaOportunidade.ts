import {
  CHANCE_POR_ESTAGIO,
  agendaDoLead,
  dinheiro,
  rotuloDaAtividade,
  rotuloDoEstagio,
  type Atividade,
  type Lead,
} from "@/lib/comercial";
import { entradaNaEtapa, type EventoDoLead } from "./temperatura";

/**
 * O resumo rápido de uma oportunidade: valor, chance, tempo na etapa e o
 * próximo passo com a data. Mesmo cálculo no cartão do funil e no topo da
 * janela do lead, para os dois nunca dizerem coisas diferentes.
 *
 * De onde vem cada dado (nada novo no banco):
 * - valor: commercial_leads.monthly_value e one_off_value;
 * - chance: CHANCE_POR_ESTAGIO da etapa (a mesma da previsão do mês);
 * - tempo na etapa: o último evento de etapa (commercial_lead_events) que
 *   levou o lead para a etapa atual; sem ele, a data de criação ("cerca de");
 * - próximo passo: a próxima atividade aberta (commercial_activities).
 */
export interface ResumoDaOportunidade {
  valor: string;
  chance: number;
  diasNaEtapa: number;
  /** "há 6 dias em Proposta" ("há cerca de 6 dias" quando a entrada é estimada). */
  tempoNaEtapa: string;
  proximoPasso: string | null;
  /** "hoje", "amanhã", "qui., 22/10" ou "atrasado desde 15/10". */
  quando: string | null;
  atrasado: boolean;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Meia-noite local do dia de uma data (para contar dias de calendário). */
const inicioDoDia = (data: Date) => new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();

const diaEMes = (data: Date) =>
  `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;

export function valorDaOportunidade(lead: Lead): string {
  if (lead.monthly_value === 0 && lead.one_off_value === 0) return "sem valor definido";
  return [
    lead.monthly_value > 0 ? `${dinheiro(lead.monthly_value)}/mês` : "",
    lead.one_off_value > 0 ? `${dinheiro(lead.one_off_value)} entrada` : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

/** Quando o próximo passo vence, em palavras curtas. */
export function quandoVence(dueIso: string, agoraIso: string): { texto: string; atrasado: boolean } {
  const vence = new Date(dueIso);
  const agora = new Date(agoraIso);
  if (Number.isNaN(vence.getTime()) || Number.isNaN(agora.getTime())) return { texto: "", atrasado: false };
  if (dueIso < agoraIso) return { texto: `atrasado desde ${diaEMes(vence)}`, atrasado: true };
  const dias = Math.round((inicioDoDia(vence) - inicioDoDia(agora)) / DIA_MS);
  if (dias <= 0) return { texto: "hoje", atrasado: false };
  if (dias === 1) return { texto: "amanhã", atrasado: false };
  const semana = vence.toLocaleDateString("pt-BR", { weekday: "short" });
  return { texto: `${semana}, ${diaEMes(vence)}`, atrasado: false };
}

export function resumoDaOportunidade(
  lead: Lead,
  atividades: Atividade[],
  eventos: EventoDoLead[],
  agoraIso: string,
): ResumoDaOportunidade {
  const entrada = entradaNaEtapa(lead, eventos);
  const agora = new Date(agoraIso);
  const desde = new Date(entrada.em);
  const dias =
    Number.isNaN(desde.getTime()) || Number.isNaN(agora.getTime())
      ? 0
      : Math.max(0, Math.round((inicioDoDia(agora) - inicioDoDia(desde)) / DIA_MS));
  const etapa = rotuloDoEstagio(lead.stage);
  const cerca = entrada.estimado ? "cerca de " : "";
  const quanto = dias === 0 ? "desde hoje" : dias === 1 ? `há ${cerca}1 dia` : `há ${cerca}${dias} dias`;
  const tempoNaEtapa = `${quanto} em ${etapa}`;

  const proxima = agendaDoLead(atividades, lead.id, agoraIso).proxima;
  const vence = proxima ? quandoVence(proxima.due_at, agoraIso) : null;
  return {
    valor: valorDaOportunidade(lead),
    chance: Math.round((CHANCE_POR_ESTAGIO[lead.stage] ?? 0) * 100),
    diasNaEtapa: dias,
    tempoNaEtapa,
    proximoPasso: proxima ? `${rotuloDaAtividade(proxima.kind)}: ${proxima.title}` : null,
    quando: vence ? vence.texto : null,
    atrasado: Boolean(vence?.atrasado),
  };
}
