import { supabase } from "@/integrations/supabase/client";
import type { IdDoMetodo, LinhaDaChave } from "../../../supabase/functions/_shared/superpoderes-catalogo";

/**
 * Superpoderes das mesas na tela (frente SPP, 30/09/2026): a chave de liga e
 * desliga de cada método por mesa e o uso dos últimos dias. A RLS garante que
 * a equipe só lê e que só o admin grava; a prova nunca desliga (CHECK no banco).
 * Tabela superpoderes_das_mesas e RPC superpoderes_resumo: migration
 * 20260930295000_superpoderes_das_mesas.sql.
 */

export const CHAVE_DOS_SUPERPODERES = ["config", "superpoderes", "chaves"] as const;
export const chaveDoResumo = (dias: number) => ["config", "superpoderes", "resumo", dias] as const;

export interface LinhaDoUso {
  agente: string;
  metodo: IdDoMetodo | string;
  vezes: number;
  pelo_jev: number;
  pela_regra: number;
  pelo_codigo: number;
  provas_ok: number;
  provas_faltaram: number;
}

// Tabela e RPC novas ainda fora dos tipos gerados do banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

/** As linhas de liga e desliga (sem linha = ligado). */
export async function lerSuperpoderes(): Promise<LinhaDaChave[]> {
  const { data, error } = await db().from("superpoderes_das_mesas").select("mesa, metodo, ligado");
  if (error) throw error;
  return ((data || []) as LinhaDaChave[]).map((l) => ({ mesa: String(l.mesa), metodo: String(l.metodo), ligado: l.ligado !== false }));
}

/** Liga ou desliga um método numa mesa ("*" = todas). Só o admin consegue (RLS). */
export async function gravarChave(mesa: string, metodo: IdDoMetodo, ligado: boolean): Promise<void> {
  if (metodo === "prova" && !ligado) throw new Error("A verificação nunca desliga: é regra da casa.");
  const { error } = await db().from("superpoderes_das_mesas").upsert({ mesa, metodo, ligado }, { onConflict: "mesa,metodo" });
  if (error) throw error;
}

/** Uso de cada método por agente nos últimos dias (auditoria do método). */
export async function resumoDoUso(dias = 30): Promise<LinhaDoUso[]> {
  const { data, error } = await db().rpc("superpoderes_resumo", { p_dias: dias });
  if (error) throw error;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return ((data || []) as Array<Record<string, unknown>>).map((l) => ({
    agente: String(l.agente || ""),
    metodo: String(l.metodo || ""),
    vezes: n(l.vezes),
    pelo_jev: n(l.pelo_jev),
    pela_regra: n(l.pela_regra),
    pelo_codigo: n(l.pelo_codigo),
    provas_ok: n(l.provas_ok),
    provas_faltaram: n(l.provas_faltaram),
  }));
}
