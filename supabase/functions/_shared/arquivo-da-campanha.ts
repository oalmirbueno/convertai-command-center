/**
 * 16/11/2026: arquivar campanha e editar o período, sem IA e sem custo.
 *
 * Regras puras, usadas pelo agente-calendario (campanha_arquivar e
 * campanha_periodo), pela listagem da Mesa Foto, pelo MCP e pela tela:
 * - arquivada é a campanha com `arquivada_em`; o status não muda, então
 *   desarquivar volta ao que era;
 * - arquivada sai da lista padrão e nunca é "a campanha do mês";
 * - período em AAAA-MM-DD, fim no mesmo dia ou depois do início, até 62 dias
 *   (contando os dois dias), a mesma regra do campanha_salvar.
 */

export const MAX_DIAS_DA_CAMPANHA = 62;

export const AVISO_DA_LINHA_DO_TEMPO =
  "A linha do tempo das peças continua com as datas antigas. Use Reorganizar para redistribuir as peças no período novo.";

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

/** Data AAAA-MM-DD que existe no calendário (31/02 não passa). */
export function dataDaCampanhaValida(v: unknown): v is string {
  if (typeof v !== "string" || !FORMATO.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Dias corridos com os dois dias contados (01 a 01 = 1). */
export function diasDoPeriodo(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}

export type PeriodoDaCampanha =
  | { ok: true; inicio: string; fim: string; dias: number }
  | { ok: false; codigo: "periodo_incompleto" | "data_invalida" | "periodo_invalido" | "periodo_longo"; mensagem: string };

export function validarPeriodoDaCampanha(inicio: unknown, fim: unknown): PeriodoDaCampanha {
  if (inicio === undefined || inicio === null || inicio === "" || fim === undefined || fim === null || fim === "") {
    return { ok: false, codigo: "periodo_incompleto", mensagem: "Informe o início e o fim da campanha." };
  }
  if (!dataDaCampanhaValida(inicio) || !dataDaCampanhaValida(fim)) {
    return { ok: false, codigo: "data_invalida", mensagem: "Use datas válidas no formato AAAA-MM-DD." };
  }
  if (fim < inicio) return { ok: false, codigo: "periodo_invalido", mensagem: "O fim da campanha vem antes do início." };
  const dias = diasDoPeriodo(inicio, fim);
  if (dias > MAX_DIAS_DA_CAMPANHA) {
    return { ok: false, codigo: "periodo_longo", mensagem: `Campanha de até ${MAX_DIAS_DA_CAMPANHA} dias por vez.` };
  }
  return { ok: true, inicio, fim, dias };
}

export function campanhaArquivada(c: { arquivada_em?: string | null } | null | undefined): boolean {
  return !!(c && typeof c.arquivada_em === "string" && c.arquivada_em);
}

/** O que gravar ao arquivar (data e quem) ou ao desarquivar (limpa os dois). */
export function camposDoArquivo(arquivar: boolean, userId: string | null, agora: Date = new Date()) {
  return arquivar
    ? { arquivada_em: agora.toISOString(), arquivada_por: userId || null }
    : { arquivada_em: null, arquivada_por: null };
}

/** A campanha tem linha do tempo gravada (o período novo não recalcula as fases). */
export function temLinhaDoTempo(briefing: unknown): boolean {
  const b = briefing && typeof briefing === "object" ? (briefing as Record<string, unknown>) : {};
  const l = b.linha_do_tempo;
  return !!l && typeof l === "object";
}

/** Erro do banco por coluna do arquivo que ainda não existe (migration 20261116120000 não aplicada). */
export function faltaColunaDoArquivo(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42703" || e.code === "PGRST204" || /arquivada_(em|por)/.test(String(e.message ?? "")));
}
