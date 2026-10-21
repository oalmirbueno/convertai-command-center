import type { CorpoDoPedido } from "./mesaV4Api";

export const TIPOS_DO_PERIODO = [
  { valor: "educativo", rotulo: "Educativo" },
  { valor: "engajamento", rotulo: "Engajamento" },
  { valor: "vendas", rotulo: "Vendas" },
  { valor: "dica_rapida", rotulo: "Dica rápida" },
  { valor: "storytelling", rotulo: "Storytelling" },
  { valor: "motivacional", rotulo: "Motivacional" },
  { valor: "bastidores", rotulo: "Bastidores" },
  { valor: "tutorial", rotulo: "Tutorial" },
  { valor: "prova_social", rotulo: "Prova social" },
  { valor: "tendencia", rotulo: "Tendência" },
  { valor: "comparacao", rotulo: "Comparação" },
  { valor: "cases", rotulo: "Cases" },
] as const;
export type TipoDoPeriodo = (typeof TIPOS_DO_PERIODO)[number]["valor"];
export const TIPOS_INICIAIS_DO_PERIODO: TipoDoPeriodo[] = ["educativo", "engajamento", "vendas", "dica_rapida"];
export const PERIODOS_DO_CALENDARIO = [7, 14, 30] as const;
export type DiasDoPeriodo = (typeof PERIODOS_DO_CALENDARIO)[number];

function dataReal(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function fimDoMesDoPeriodo(mes: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(mes) || !dataReal(mes)) throw new Error("Escolha um mês válido na Agenda.");
  const d = new Date(`${mes}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export function inicioPadraoDoPeriodo(mes: string, hoje: string): string {
  fimDoMesDoPeriodo(mes);
  return dataReal(hoje) && hoje.slice(0, 7) === mes.slice(0, 7) ? hoje : mes;
}

/** Datas civis em UTC ao meio-dia evitam mudança de dia por fuso ou horário de verão. */
export function intervaloDoCalendario(mes: string, inicio: string, dias: number) {
  const fimDoMes = fimDoMesDoPeriodo(mes);
  if (!dataReal(inicio) || inicio.slice(0, 7) !== mes.slice(0, 7)) throw new Error("A data de início precisa estar dentro do mês selecionado.");
  if (!PERIODOS_DO_CALENDARIO.includes(dias as DiasDoPeriodo)) throw new Error("Escolha um período de 7, 14 ou 30 dias.");
  const d = new Date(`${inicio}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias - 1);
  const fimEmMs = new Date(`${fimDoMes}T12:00:00Z`).getTime();
  const fim = d.getTime() > fimEmMs ? fimDoMes : d.toISOString().slice(0, 10);
  const diasReais = Math.round((new Date(`${fim}T12:00:00Z`).getTime() - new Date(`${inicio}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  const cursor = new Date(`${inicio}T12:00:00Z`);
  let temDiaUtil = false;
  while (cursor.getTime() <= new Date(`${fim}T12:00:00Z`).getTime()) {
    if (cursor.getUTCDay() >= 1 && cursor.getUTCDay() <= 5) { temDiaUtil = true; break; }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (!temDiaUtil) throw new Error("Este período não tem dias úteis. Escolha outro início.");
  return { inicio, fim, dias: diasReais, limitadoAoMes: diasReais < dias };
}

export function pedidoDoCalendario(p: { clientId: string; mes: string; inicio: string; dias: number; tema: string; tipos: readonly string[] }): CorpoDoPedido {
  if (!p.clientId) throw new Error("Escolha o cliente antes de planejar o calendário.");
  if (typeof p.tema !== "string" || p.tema.length > 500) throw new Error("Use um tema com até 500 caracteres.");
  const tipos = [...new Set(p.tipos)];
  if (!tipos.length || tipos.some((v) => !TIPOS_DO_PERIODO.some((t) => t.valor === v))) throw new Error("Escolha pelo menos um tipo de conteúdo válido.");
  const periodo = intervaloDoCalendario(p.mes, p.inicio, p.dias);
  const rotulos = TIPOS_DO_PERIODO.filter((t) => tipos.includes(t.valor)).map((t) => t.rotulo);
  const mensagem = [
    `Prepare uma NOVA PROPOSTA de calendário editorial de ${periodo.inicio} até ${periodo.fim}, inclusive, somente no mês ${p.mes.slice(0, 7)}.`,
    p.tema.trim() ? `Nicho/tema solicitado: ${p.tema.trim()}.` : "Use o nicho, o público e o contexto real do cliente e da marca aberta.",
    `Tipos de conteúdo: ${rotulos.join(", ")}. Varie entre os tipos escolhidos quando fizer sentido para o cliente.`,
    "Escolha a quantidade de conteúdos pela frequência e pelo plano real do cliente, no máximo 12 nesta proposta, distribuídos nos dias úteis livres deste período. Não force um post por dia.",
    "Leia a agenda existente, o plano combinado do mês, as campanhas e as referências reais. Complemente as lacunas; preserve integralmente pautas, datas, arquivos e aprovações que já existem.",
    "Entregue somente a proposta para revisão na conversa do Agente do mês. Não grave tarefas na agenda, não altere nem substitua conteúdos existentes, não aprove, agende ou publique. A equipe escolherá os itens e confirmará a gravação pelo fluxo atual.",
    "Cada data proposta deve ficar entre o início e o fim informados. Se não houver espaço na frequência contratada, explique a limitação na proposta.",
  ].join("\n");
  return { clientId: p.clientId, mes: p.mes.slice(0, 7), dataInicio: periodo.inicio, dataFim: periodo.fim, mensagem };
}
