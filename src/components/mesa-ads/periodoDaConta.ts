/**
 * Período da aba Conta (frente AD3, 28/09). Pedido do dono: "filtros por data:
 * hoje, ontem, 7, 14 e 30 dias, este mês, mês passado e período livre",
 * valendo para tudo da aba (gerenciador, resultados, evolução, desempenho,
 * análise e relatório).
 *
 * Os "últimos N dias" (7, 14, 30, 90) terminam hoje e vão ao servidor como
 * { dias } (o formato de sempre). Os outros vão com { dias, inicio, fim }: o
 * servidor (periodoDoPedido) usa inicio e fim quando vêm, até 180 dias.
 * Datas em AAAA-MM-DD, no dia de Brasília.
 */

export type PresetDoPeriodo = "hoje" | "ontem" | "7" | "14" | "30" | "90" | "este_mes" | "mes_passado" | "livre";

export interface EscolhaDoPeriodo {
  preset: PresetDoPeriodo;
  inicio?: string;
  fim?: string;
}

export interface PeriodoResolvido {
  preset: PresetDoPeriodo;
  inicio: string;
  fim: string;
  dias: number;
  /** Últimos N dias até hoje (vai ao servidor só como { dias }). */
  ultimos: boolean;
  rotulo: string;
}

/** Aceita o número de dias de sempre (quem ainda chama assim) ou o período resolvido. */
export type PeriodoDaConsulta = number | PeriodoResolvido;

export const PRESETS_DO_PERIODO: { valor: PresetDoPeriodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "ontem", rotulo: "Ontem" },
  { valor: "7", rotulo: "7 dias" },
  { valor: "14", rotulo: "14 dias" },
  { valor: "30", rotulo: "30 dias" },
  { valor: "90", rotulo: "90 dias" },
  { valor: "este_mes", rotulo: "Este mês" },
  { valor: "mes_passado", rotulo: "Mês passado" },
  { valor: "livre", rotulo: "Período livre" },
];

export const PERIODO_PADRAO: EscolhaDoPeriodo = { preset: "14" };
/** O servidor aceita até 180 dias num período livre. */
export const MAXIMO_DE_DIAS = 180;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje em Brasília (AAAA-MM-DD). */
export function hojeEmBrasilia(agoraMs = Date.now()): string {
  return new Date(agoraMs - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Soma dias numa data AAAA-MM-DD (meio-dia em UTC, sem escorregar de fuso). */
export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias corridos entre duas datas, contando as duas pontas. */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86400_000) + 1;
}

/** "28/09" (ou "28/09/2026" com o ano). */
export function dataBr(iso: string, comAno = false): string {
  const p = iso.split("-");
  return p.length === 3 ? (comAno ? `${p[2]}/${p[1]}/${p[0]}` : `${p[2]}/${p[1]}`) : iso;
}

export const ehEscolhaDoPeriodo = (v: unknown): v is EscolhaDoPeriodo =>
  !!v && typeof v === "object" && PRESETS_DO_PERIODO.some((p) => p.valor === (v as EscolhaDoPeriodo).preset);

/** A escolha vira datas de verdade (período livre inválido cai nos 14 dias). */
export function resolverPeriodo(e: EscolhaDoPeriodo, hoje = hojeEmBrasilia()): PeriodoResolvido {
  const rotuloDe = (p: PresetDoPeriodo) => (PRESETS_DO_PERIODO.filter((x) => x.valor === p)[0] || { rotulo: "" }).rotulo;
  if (e.preset === "7" || e.preset === "14" || e.preset === "30" || e.preset === "90") {
    const n = Number(e.preset);
    return { preset: e.preset, inicio: somarDias(hoje, -(n - 1)), fim: hoje, dias: n, ultimos: true, rotulo: rotuloDe(e.preset) };
  }
  if (e.preset === "hoje") return { preset: "hoje", inicio: hoje, fim: hoje, dias: 1, ultimos: false, rotulo: "Hoje" };
  if (e.preset === "ontem") {
    const ontem = somarDias(hoje, -1);
    return { preset: "ontem", inicio: ontem, fim: ontem, dias: 1, ultimos: false, rotulo: "Ontem" };
  }
  if (e.preset === "este_mes") {
    const inicio = `${hoje.slice(0, 7)}-01`;
    return { preset: "este_mes", inicio, fim: hoje, dias: diasEntre(inicio, hoje), ultimos: false, rotulo: "Este mês" };
  }
  if (e.preset === "mes_passado") {
    const fim = somarDias(`${hoje.slice(0, 7)}-01`, -1);
    const inicio = `${fim.slice(0, 7)}-01`;
    return { preset: "mes_passado", inicio, fim, dias: diasEntre(inicio, fim), ultimos: false, rotulo: "Mês passado" };
  }
  // Período livre: datas válidas, fim até hoje, no máximo 180 dias.
  const ini = e.inicio && ISO.test(e.inicio) ? e.inicio : null;
  let fim = e.fim && ISO.test(e.fim) ? e.fim : null;
  if (!ini || !fim || ini > fim) return resolverPeriodo(PERIODO_PADRAO, hoje);
  if (fim > hoje) fim = hoje;
  if (ini > fim) return resolverPeriodo(PERIODO_PADRAO, hoje);
  const inicio = diasEntre(ini, fim) > MAXIMO_DE_DIAS ? somarDias(fim, -(MAXIMO_DE_DIAS - 1)) : ini;
  return { preset: "livre", inicio, fim, dias: diasEntre(inicio, fim), ultimos: false, rotulo: `${dataBr(inicio)} a ${dataBr(fim)}` };
}

/** O que vai no corpo da chamada: { dias } nos últimos N dias; { dias, inicio, fim } nos outros. */
export function corpoDoPeriodo(p: PeriodoDaConsulta): { dias: number; inicio?: string; fim?: string } {
  if (typeof p === "number") return { dias: p };
  return p.ultimos ? { dias: p.dias } : { dias: p.dias, inicio: p.inicio, fim: p.fim };
}

/** Parte da chave do cache: o número de dias nos últimos N (como antes) ou as datas. */
export function chaveDoPeriodo(p: PeriodoDaConsulta): number | string {
  if (typeof p === "number") return p;
  return p.ultimos ? p.dias : `${p.inicio}_${p.fim}`;
}

export const diasDoPeriodo = (p: PeriodoDaConsulta): number => (typeof p === "number" ? p : p.dias);

/** "de 01/09 a 28/09" para as frases da tela. */
export function trechoDoPeriodo(p: PeriodoResolvido): string {
  if (p.preset === "hoje") return "de hoje";
  if (p.preset === "ontem") return "de ontem";
  return p.inicio === p.fim ? `de ${dataBr(p.inicio)}` : `de ${dataBr(p.inicio)} a ${dataBr(p.fim)}`;
}
