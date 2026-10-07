import { supabase } from "@/integrations/supabase/client";

type Linha = Record<string, any>;
export function completarContextoAntigo(runs: Linha[], eventos: Linha[]): Linha[] {
  return runs.map(r => {
    if (r.detail?.title || r.detail?.action) return r;
    const e = eventos.find(e => e.operator_id === r.operator_id && e.run_key === r.run_key && e.action && !/^(heartbeat|progress|started|done|failed|review)$/i.test(e.action.trim()));
    if (!e) return r;
    return { ...r, detail: { ...r.detail, title: e.action, action: e.action, evidence: r.detail?.evidence || e.evidence } };
  });
}
/** Compatibilidade com relatos anteriores a detail, sem reescrever sua auditoria. */
export async function contextoDasExecucoes(runs: Linha[]): Promise<Linha[]> {
  const keys = [...new Set(runs.filter(r => !r.detail?.title && !r.detail?.action).map(r => r.run_key))];
  if (!keys.length) return runs;
  const { data, error } = await (supabase as any).from("operator_audit_log")
    .select("operator_id,run_key,action,evidence").in("run_key", keys)
    .order("occurred_at", { ascending: false }).limit(1000);
  if (error) return runs; // A execução principal continua visível; nada é marcado como concluído.
  return completarContextoAntigo(runs, data || []);
}
