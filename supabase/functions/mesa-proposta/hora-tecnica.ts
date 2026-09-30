/**
 * Hora técnica da agência no servidor (frente PRO2): os parâmetros de
 * proposta_calculadora e, com "usar o Financeiro" ligado, os custos fixos e o
 * pró-labore das regras recorrentes do Financeiro (financial_recurring_rules).
 * A conta mora em ../_shared/proposta-comercial.ts (a mesma da tela).
 * A mesa-proposta (ajuste pela margem) e a proposta-biblioteca (a tela da
 * calculadora) usam daqui.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { custosDoFinanceiro, normalizarParametros, parametrosComFinanceiro, type ParametrosDaHora, type RegraDoFinanceiro } from "../_shared/proposta-comercial.ts";
import { hojeEmSaoPaulo } from "../_shared/proposta-modelo.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";

export type HoraTecnica = {
  parametros: ParametrosDaHora;
  usar_financeiro: boolean;
  /** Os custos que o Financeiro deu (null quando não foi lido). */
  financeiro: { custos_fixos_mes: number; pro_labore_mes: number; regras: number } | null;
  aviso: string | null;
};

export async function lerHoraTecnica(db: SupabaseClient): Promise<HoraTecnica> {
  const { data, error } = await db.from("proposta_calculadora").select("usar_financeiro, custos_fixos_mes, pro_labore_mes, horas_produtivas_mes, impostos_pct, margem_pct").eq("id", 1).maybeSingle();
  if (error) registrarFalha("hora técnica: parâmetros não lidos (vale o padrão)", error);
  const linha = (data || {}) as Record<string, unknown>;
  const usar = linha.usar_financeiro !== false;
  let parametros = normalizarParametros(linha);
  let financeiro: HoraTecnica["financeiro"] = null;
  let aviso: string | null = error ? "Os parâmetros da hora técnica não foram lidos agora; valem os de partida." : null;
  if (usar) {
    const r = await db.from("financial_recurring_rules").select("direction, kind, amount, frequency, is_active, ends_on").eq("direction", "expense").eq("is_active", true).limit(500);
    if (r.error) {
      registrarFalha("hora técnica: regras do Financeiro não lidas", r.error);
      aviso = "O Financeiro não foi lido agora; a conta usa os custos digitados.";
    } else {
      financeiro = custosDoFinanceiro((r.data || []) as RegraDoFinanceiro[], hojeEmSaoPaulo());
      if (financeiro.regras > 0) parametros = parametrosComFinanceiro(parametros, financeiro);
      else aviso = "O Financeiro não tem custo recorrente ativo; a conta usa os custos digitados.";
    }
  }
  return { parametros, usar_financeiro: usar, financeiro, aviso };
}
