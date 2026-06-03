import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Check, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

/** Maps service_config keys (from EditClientDrawer) → service_checklists.service_type */
const SERVICE_TYPE_MAP: Record<string, string[]> = {
  trafego: ["meta_ads", "google_ads"],
  social: ["social_media"],
  videos_ia: ["video"],
  edicao_video: ["video"],
  site: ["site"],
  automacao: ["automation"],
};

const PHASE_ORDER = ["contrato", "briefing", "acessos", "kickoff"];
const PHASE_LABEL: Record<string, string> = {
  contrato: "Contrato",
  briefing: "Briefing",
  acessos: "Acessos",
  kickoff: "Kickoff",
  producao: "Produção",
};

interface Props {
  clientId: string;
  servicesConfig?: Record<string, boolean>;
}

export default function ClientOnboardingPanel({ clientId, servicesConfig }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  // Derive relevant service_types from client's active services + always include "geral"
  const serviceTypes = useMemo(() => {
    const set = new Set<string>(["geral"]);
    Object.entries(servicesConfig || {}).forEach(([k, v]) => {
      if (!v) return;
      (SERVICE_TYPE_MAP[k] || []).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [servicesConfig]);

  // Catalog
  const { data: catalog, isLoading } = useQuery({
    queryKey: ["service-checklists", serviceTypes.join(",")],
    queryFn: async () => {
      const { data: lists } = await supabase
        .from("service_checklists" as any)
        .select("*")
        .in("service_type", serviceTypes)
        .order("order_index", { ascending: true });
      const ids = (lists || []).map((l: any) => l.id);
      if (!ids.length) return { lists: [], items: [] };
      const { data: items } = await supabase
        .from("service_checklist_items" as any)
        .select("*")
        .in("checklist_id", ids)
        .order("order_index", { ascending: true });
      return { lists: lists || [], items: items || [] };
    },
  });

  // Client onboarding state
  const { data: clientState, refetch } = useQuery({
    queryKey: ["client-onboarding-items", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_onboarding_items" as any)
        .select("*")
        .eq("client_id", clientId);
      return (data || []) as any[];
    },
    enabled: !!clientId,
  });

  const stateMap = useMemo(() => {
    const m = new Map<string, any>();
    (clientState || []).forEach((row: any) => m.set(row.template_item_id, row));
    return m;
  }, [clientState]);

  // Group by phase
  const grouped = useMemo(() => {
    const out: Record<string, { list: any; items: any[] }[]> = {};
    (catalog?.lists || []).forEach((l: any) => {
      const items = (catalog?.items || []).filter((i: any) => i.checklist_id === l.id);
      (out[l.phase] = out[l.phase] || []).push({ list: l, items });
    });
    return out;
  }, [catalog]);

  const allItems = catalog?.items || [];
  const doneCount = allItems.filter((i: any) => stateMap.get(i.id)?.is_done).length;
  const totalCount = allItems.length;
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const toggleItem = async (itemId: string, next: boolean, value?: string) => {
    if (!user) return;
    setSaving(itemId);
    const existing = stateMap.get(itemId);
    try {
      if (existing) {
        await supabase
          .from("client_onboarding_items" as any)
          .update({
            is_done: next,
            value: value ?? existing.value ?? null,
            completed_by: next ? user.id : null,
            completed_at: next ? new Date().toISOString() : null,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("client_onboarding_items" as any).insert({
          client_id: clientId,
          template_item_id: itemId,
          is_done: next,
          value: value ?? null,
          completed_by: next ? user.id : null,
          completed_at: next ? new Date().toISOString() : null,
        });
      }
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["client-onboarding-summary"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    } finally {
      setSaving(null);
    }
  };

  const updateValue = async (itemId: string, value: string) => {
    const existing = stateMap.get(itemId);
    if (!existing) {
      await supabase.from("client_onboarding_items" as any).insert({
        client_id: clientId, template_item_id: itemId, is_done: false, value,
      });
    } else {
      await supabase
        .from("client_onboarding_items" as any)
        .update({ value })
        .eq("id", existing.id);
    }
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando esteira…
      </div>
    );
  }

  if (!totalCount) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-xl">
        Nenhum checklist disponível para os serviços ativos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress banner */}
      <div className="rounded-xl border border-border bg-secondary/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Esteira de Onboarding
          </p>
          <p className="font-mono text-sm text-foreground">
            {doneCount}/{totalCount} · {percent}%
          </p>
        </div>
        <div className="h-2 rounded-full bg-background overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        {percent < 100 && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="w-3 h-3" />
            Onboarding incompleto — {totalCount - doneCount} item(ns) pendente(s)
          </p>
        )}
      </div>

      {/* Phases */}
      {PHASE_ORDER.filter((p) => grouped[p]).map((phase) => {
        const phaseLists = grouped[phase];
        const phaseItems = phaseLists.flatMap((g) => g.items);
        const phaseDone = phaseItems.filter((i) => stateMap.get(i.id)?.is_done).length;
        const phasePct =
          phaseItems.length > 0 ? Math.round((phaseDone / phaseItems.length) * 100) : 0;
        return (
          <div key={phase} className="rounded-xl border border-border bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChevronRight className="w-3.5 h-3.5 text-primary" />
                <h4 className="text-sm font-semibold text-foreground">{PHASE_LABEL[phase]}</h4>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                {phaseDone}/{phaseItems.length} · {phasePct}%
              </span>
            </div>
            <div className="divide-y divide-border">
              {phaseLists.map((g) => (
                <div key={g.list.id} className="px-4 py-3">
                  <p className="text-xs font-medium text-foreground mb-2">
                    {g.list.title}
                    {g.list.service_type !== "geral" && (
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                        {g.list.service_type}
                      </span>
                    )}
                  </p>
                  <ul className="space-y-2">
                    {g.items.map((it: any) => {
                      const s = stateMap.get(it.id);
                      const checked = !!s?.is_done;
                      return (
                        <li key={it.id} className="flex items-start gap-2">
                          <button
                            onClick={() => toggleItem(it.id, !checked)}
                            disabled={saving === it.id}
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              checked
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-border bg-background hover:border-primary"
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-xs ${
                                checked ? "line-through text-muted-foreground" : "text-foreground"
                              }`}
                            >
                              {it.label}
                              {it.is_required && (
                                <span className="text-destructive ml-1">*</span>
                              )}
                            </p>
                            {it.hint && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {it.hint}
                              </p>
                            )}
                            <input
                              type="text"
                              defaultValue={s?.value || ""}
                              onBlur={(e) => {
                                if (e.target.value !== (s?.value || "")) {
                                  updateValue(it.id, e.target.value);
                                }
                              }}
                              placeholder="Link / observação (opcional)"
                              className="mt-1 w-full text-[11px] bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
