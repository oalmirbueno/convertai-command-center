import type { QueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import { aplicarRespostaDaCampanha } from "./campanhasApi";
import type { Campanha } from "./mesaV4Api";
import {
  AVISO_DA_LINHA_DO_TEMPO,
  campanhaArquivada,
  MAX_DIAS_DA_CAMPANHA,
  validarPeriodoDaCampanha,
} from "../../../supabase/functions/_shared/arquivo-da-campanha";

/**
 * 16/11/2026: arquivar/desarquivar e editar o período da campanha (sem IA, custo zero).
 * As regras moram em supabase/functions/_shared/arquivo-da-campanha.ts (as mesmas do servidor);
 * a gravação é pelo agente-calendario (campanha_arquivar e campanha_periodo).
 */

export { AVISO_DA_LINHA_DO_TEMPO, campanhaArquivada, MAX_DIAS_DA_CAMPANHA, validarPeriodoDaCampanha };

export type FiltroDoArquivo = "ativas" | "arquivadas";

/** A lista padrão (sem arquivadas) e a aba Arquivadas (a mais recente arquivada antes). */
export function separarPorArquivo<T extends { arquivada_em?: string | null }>(lista: T[]): { ativas: T[]; arquivadas: T[] } {
  const ativas: T[] = [];
  const arquivadas: T[] = [];
  for (const c of lista) (campanhaArquivada(c) ? arquivadas : ativas).push(c);
  arquivadas.sort((a, b) => String(b.arquivada_em || "").localeCompare(String(a.arquivada_em || "")));
  return { ativas, arquivadas };
}

export const corpoDoArquivar = (campanhaId: string, arquivar: boolean) => ({ acao: "campanha_arquivar", campanha_id: campanhaId, arquivar });

export const corpoDoPeriodo = (campanhaId: string, inicio: string, fim: string) => ({
  acao: "campanha_periodo",
  campanha_id: campanhaId,
  periodo_inicio: inicio,
  periodo_fim: fim,
});

export interface RespostaDoArquivo {
  campanha: Campanha;
  arquivada: boolean;
  sem_mudanca?: boolean;
  custo_usd: number;
}

export interface RespostaDoPeriodo {
  campanha: Campanha;
  avisos: string[];
  linha_do_tempo_desatualizada: boolean;
  sem_mudanca?: boolean;
  custo_usd: number;
}

export async function arquivarCampanha(qc: QueryClient, clientId: string, campanhaId: string, arquivar: boolean): Promise<RespostaDoArquivo> {
  const r = await chamarFuncao<RespostaDoArquivo>("agente-calendario", corpoDoArquivar(campanhaId, arquivar));
  aplicarRespostaDaCampanha(qc, clientId, r);
  return r;
}

export async function salvarPeriodoDaCampanha(qc: QueryClient, clientId: string, campanhaId: string, inicio: string, fim: string): Promise<RespostaDoPeriodo> {
  const p = validarPeriodoDaCampanha(inicio, fim);
  if (p.ok === false) throw new Error(p.mensagem);
  const r = await chamarFuncao<RespostaDoPeriodo>("agente-calendario", corpoDoPeriodo(campanhaId, p.inicio, p.fim));
  aplicarRespostaDaCampanha(qc, clientId, r);
  return r;
}
