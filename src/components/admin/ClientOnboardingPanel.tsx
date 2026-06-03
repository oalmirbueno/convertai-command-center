import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Check, ChevronRight, Loader2, AlertTriangle, RotateCcw, EyeOff,
  FileSignature, ClipboardList, Sparkles, ExternalLink, Ban,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showSkipped, setShowSkipped] = useState(false);

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

  // Latest signed contract for this client (auto-fill source)
  const { data: contract } = useQuery({
    queryKey: ["client-onboarding-contract", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("contracts")
        .select("id, title, status, client_signed_at, admin_signed_at, sign_token, updated_at")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(5);
      const signed = (data || []).find(
        (c: any) => !!c.client_signed_at && (c.status === "signed" || !!c.admin_signed_at),
      );
      return signed || null;
    },
    enabled: !!clientId,
  });

  // Latest submitted briefing for this client (auto-fill source)
  const { data: briefing } = useQuery({
    queryKey: ["client-onboarding-briefing", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("briefings")
        .select("id, token, submitted, project_id, created_at")
        .eq("client_id", clientId)
        .eq("submitted", true)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
    enabled: !!clientId,
  });

  const stateMap = useMemo(() => {
    const m = new Map<string, any>();
    (clientState || []).forEach((row: any) => m.set(row.template_item_id, row));
    return m;
  }, [clientState]);

  /** Identifies the auto-fill source for a checklist item, if any */
  const autoSourceFor = (item: any, list: any): null | {
    kind: "contract" | "briefing";
    label: string;
    href: string;
  } => {
    if (list?.phase === "contrato" && list?.service_type === "geral" && contract) {
      return {
        kind: "contract",
        label: "Abrir contrato assinado",
        href: `/contratos?contract=${contract.id}`,
      };
    }
    if (list?.phase === "briefing" && list?.service_type === "geral" && briefing) {
      return {
        kind: "briefing",
        label: "Abrir briefing entregue",
        href: briefing.project_id ? `/briefings?id=${briefing.id}` : `/briefings`,
      };
    }
    return null;
  };

  // Group by phase (excluding skipped unless showSkipped)
  const grouped = useMemo(() => {
    const out: Record<string, { list: any; items: any[]; hiddenCount: number }[]> = {};
    (catalog?.lists || []).forEach((l: any) => {
      const allItems = (catalog?.items || []).filter((i: any) => i.checklist_id === l.id);
      const visible = showSkipped
        ? allItems
        : allItems.filter((i: any) => !stateMap.get(i.id)?.is_skipped);
      const hiddenCount = allItems.length - visible.length;
      (out[l.phase] = out[l.phase] || []).push({ list: l, items: visible, hiddenCount });
    });
    return out;
  }, [catalog, stateMap, showSkipped]);

  // Aggregate counts ignore skipped items
  const activeItems = useMemo(
    () => (catalog?.items || []).filter((i: any) => !stateMap.get(i.id)?.is_skipped),
    [catalog, stateMap],
  );
  const doneCount = activeItems.filter((i: any) => stateMap.get(i.id)?.is_done).length;
  const totalCount = activeItems.length;
  const skippedCount = (catalog?.items?.length || 0) - totalCount;
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const upsertItem = async (itemId: string, patch: Record<string, any>) => {
    const existing = stateMap.get(itemId);
    if (existing) {
      await supabase.from("client_onboarding_items" as any).update(patch).eq("id", existing.id);
    } else {
      await supabase.from("client_onboarding_items" as any).insert({
        client_id: clientId, template_item_id: itemId, is_done: false, ...patch,
      });
    }
  };

  // 🔮 Auto-fill: when a signed contract / submitted briefing is found
  // and the corresponding checklist row is not yet marked done, mark it
  // and store a direct link in `value`.
  useEffect(() => {
    if (!user || !catalog?.items?.length) return;
    (async () => {
      const tasks: Promise<any>[] = [];
      for (const list of catalog.lists) {
        for (const it of catalog.items.filter((x: any) => x.checklist_id === list.id)) {
          const src = autoSourceFor(it, list);
          if (!src) continue;
          const s = stateMap.get(it.id);
          if (s?.is_done || s?.is_skipped) continue;
          tasks.push(
            upsertItem(it.id, {
              is_done: true,
              value: src.href,
              completed_by: user.id,
              completed_at: new Date().toISOString(),
            }),
          );
        }
      }
      if (tasks.length) {
        await Promise.all(tasks);
        await refetch();
        queryClient.invalidateQueries({ queryKey: ["client-onboarding-summary"] });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.id, briefing?.id, catalog?.items?.length, clientState?.length]);

  const toggleItem = async (itemId: string, next: boolean, value?: string) => {
    if (!user) return;
    setSaving(itemId);
    const existing = stateMap.get(itemId);
    try {
      await upsertItem(itemId, {
        is_done: next,
        value: value ?? existing?.value ?? null,
        completed_by: next ? user.id : null,
        completed_at: next ? new Date().toISOString() : null,
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["client-onboarding-summary"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    } finally {
      setSaving(null);
    }
  };

  const setSkipped = async (itemId: string, next: boolean) => {
    setSaving(itemId);
    try {
      await upsertItem(itemId, { is_skipped: next, is_done: false });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["client-onboarding-summary"] });
      toast.success(next ? "Marcado como não necessário" : "Item restaurado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar");
    } finally {
      setSaving(null);
    }
  };

  const updateValue = async (itemId: string, value: string) => {
    await upsertItem(itemId, { value });
    refetch();
  };

  const togglePhase = (phase: string) =>
    setCollapsed((c) => ({ ...c, [phase]: !c[phase] }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando esteira…
      </div>
    );
  }

  if (!catalog?.items?.length) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-xl">
        Nenhum checklist disponível para os serviços ativos.
      </div>
    );
  }

  const allPhasesCollapsed = PHASE_ORDER.filter((p) => grouped[p]).every((p) => collapsed[p]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    PHASE_ORDER.filter((p) => grouped[p]).forEach((p) => {
      next[p] = !allPhasesCollapsed;
    });
    setCollapsed(next);
  };

  return (
    <div className="space-y-4">
      {/* Progress banner */}
      <div className="rounded-xl border border-border bg-secondary/40 p-4">
        <div className="flex items-center justify-between mb-2 gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Esteira de Onboarding
          </p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm text-foreground shrink-0">
              {doneCount}/{totalCount} · {percent}%
            </p>
            <button
              onClick={toggleAll}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
              title={allPhasesCollapsed ? "Expandir tudo" : "Recolher tudo"}
            >
              {allPhasesCollapsed ? "Expandir" : "Recolher"}
            </button>
          </div>
        </div>
        <div className="h-2 rounded-full bg-background overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
          {percent < 100 ? (
            <p className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="w-3 h-3" />
              {totalCount - doneCount} item(ns) pendente(s)
            </p>
          ) : <span />}
          <div className="flex items-center gap-3">
            {(contract || briefing) && (
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary">
                <Sparkles className="w-3 h-3" />
                Auto-preenchido
              </p>
            )}
            {skippedCount > 0 && (
              <button
                onClick={() => setShowSkipped((s) => !s)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <EyeOff className="w-3 h-3" />
                {showSkipped ? "Ocultar removidos" : `Ver ${skippedCount} removido(s)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phases */}
      {PHASE_ORDER.filter((p) => grouped[p]).map((phase) => {
        const phaseLists = grouped[phase];
        const phaseItems = phaseLists.flatMap((g) => g.items);
        const phaseDone = phaseItems.filter((i) => stateMap.get(i.id)?.is_done).length;
        const phasePct =
          phaseItems.length > 0 ? Math.round((phaseDone / phaseItems.length) * 100) : 0;
        const isCollapsed = !!collapsed[phase];
        return (
          <div key={phase} className="rounded-xl border border-border bg-card overflow-hidden">
            <button
              onClick={() => togglePhase(phase)}
              className="w-full px-4 py-3 border-b border-border flex items-center justify-between hover:bg-secondary/40 transition-colors text-left"
              aria-expanded={!isCollapsed}
            >
              <div className="flex items-center gap-2">
                <motion.div animate={{ rotate: isCollapsed ? 0 : 90 }} transition={{ duration: 0.2 }}>
                  <ChevronRight className="w-3.5 h-3.5 text-primary" />
                </motion.div>
                <h4 className="text-sm font-semibold text-foreground">{PHASE_LABEL[phase]}</h4>
                {phasePct === 100 && phaseItems.length > 0 && (
                  <Check className="w-3.5 h-3.5 text-primary" />
                )}
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                {phaseDone}/{phaseItems.length} · {phasePct}%
              </span>
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                >
                  <div className="divide-y divide-border">
                    {phaseLists.map((g) => (
                      <div key={g.list.id} className="px-4 py-3">
                        <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-2">
                          {g.list.title}
                          {g.list.service_type !== "geral" && (
                            <span className="text-[10px] uppercase text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                              {g.list.service_type}
                            </span>
                          )}
                          {g.hiddenCount > 0 && !showSkipped && (
                            <span className="text-[10px] text-muted-foreground italic">
                              · {g.hiddenCount} N/A
                            </span>
                          )}
                        </p>
                        {g.items.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">
                            Nenhum item ativo para este cliente.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {g.items.map((it: any) => {
                              const s = stateMap.get(it.id);
                              const checked = !!s?.is_done;
                              const skipped = !!s?.is_skipped;
                              const auto = autoSourceFor(it, g.list);
                              return (
                                <li
                                  key={it.id}
                                  className={`group flex items-start gap-2 rounded-md -mx-2 px-2 py-1.5 transition-colors ${
                                    skipped
                                      ? "opacity-60 bg-secondary/20"
                                      : auto && checked
                                        ? "bg-primary/5 hover:bg-primary/10"
                                        : "hover:bg-secondary/30"
                                  }`}
                                >
                                  <button
                                    onClick={() => toggleItem(it.id, !checked)}
                                    disabled={saving === it.id || skipped}
                                    className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                      checked
                                        ? "bg-primary border-primary text-primary-foreground"
                                        : "border-border bg-background hover:border-primary"
                                    } disabled:cursor-not-allowed`}
                                  >
                                    {checked && <Check className="w-3 h-3" />}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-xs flex items-center gap-1.5 flex-wrap ${
                                        checked || skipped
                                          ? "line-through text-muted-foreground"
                                          : "text-foreground"
                                      }`}
                                    >
                                      {auto?.kind === "contract" && (
                                        <FileSignature className="w-3 h-3 text-primary shrink-0" />
                                      )}
                                      {auto?.kind === "briefing" && (
                                        <ClipboardList className="w-3 h-3 text-primary shrink-0" />
                                      )}
                                      <span>{it.label}</span>
                                      {it.is_required && !skipped && (
                                        <span className="text-destructive">*</span>
                                      )}
                                      {auto && !skipped && (
                                        <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                          Auto
                                        </span>
                                      )}
                                      {skipped && (
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary px-1.5 py-0.5 rounded no-underline">
                                          Não necessário
                                        </span>
                                      )}
                                    </p>
                                    {it.hint && !skipped && (
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {it.hint}
                                      </p>
                                    )}
                                    {auto && !skipped && (
                                      <Link
                                        to={auto.href}
                                        className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary hover:underline"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        {auto.label}
                                      </Link>
                                    )}
                                    {!skipped && (
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
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setSkipped(it.id, !skipped)}
                                    disabled={saving === it.id}
                                    title={skipped ? "Marcar como necessário" : "Marcar como não necessário"}
                                    className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-all ${
                                      skipped
                                        ? "border-border text-muted-foreground hover:text-primary hover:border-primary opacity-100"
                                        : "border-transparent text-muted-foreground hover:text-destructive hover:border-destructive/40 opacity-40 group-hover:opacity-100"
                                    }`}
                                  >
                                    {saving === it.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : skipped ? (
                                      <>
                                        <RotateCcw className="w-3 h-3" />
                                        Restaurar
                                      </>
                                    ) : (
                                      <>
                                        <Ban className="w-3 h-3" />
                                        N/A
                                      </>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
