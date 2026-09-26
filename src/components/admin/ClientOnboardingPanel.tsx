import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2, RotateCcw, EyeOff,
  FileSignature, ClipboardList, ExternalLink, Ban,
} from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoVazio, botao, campo, etiqueta, foco, juntar, texto } from "@/components/sistema";

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
      for (const list of (catalog.lists as any[])) {
        for (const it of (catalog.items as any[]).filter((x: any) => x.checklist_id === list.id)) {
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
    return <Carregando linhas={4} rotulo="Carregando a esteira" />;
  }

  if (!catalog?.items?.length) {
    return <EstadoVazio compacto titulo="Sem checklist." descricao="Nenhum item para os serviços ativos deste cliente." />;
  }

  const allPhasesCollapsed = PHASE_ORDER.filter((p) => grouped[p]).every((p) => collapsed[p]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    PHASE_ORDER.filter((p) => grouped[p]).forEach((p) => {
      next[p] = !allPhasesCollapsed;
    });
    setCollapsed(next);
  };
  const pendentes = totalCount - doneCount;

  return (
    <div className="min-w-0">
      {/* Progresso: estado em uma linha, ações à direita, barra fina embaixo */}
      <div className="flex min-w-0 items-center justify-between">
        <p className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate tabular-nums")}>
          <span className="font-medium text-foreground">
            {doneCount} de {totalCount}
          </span>
          {` · ${percent}%`}
          {pendentes > 0 && <span className="text-warning">{` · ${pendentes} ${pendentes === 1 ? "pendente" : "pendentes"}`}</span>}
          {(contract || briefing) && (
            <span className="text-primary" title="Contrato assinado e briefing entregue marcam os itens sozinhos.">
              {" · auto-preenchido"}
            </span>
          )}
        </p>
        <div className="flex shrink-0 items-center [&>*+*]:ml-1">
          {skippedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowSkipped((s) => !s)}
              aria-pressed={showSkipped}
              aria-label={showSkipped ? "Ocultar removidos" : `Ver ${skippedCount} removido(s)`}
              className={juntar(botao.discreto, "h-8")}
            >
              <EyeOff className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">{showSkipped ? "Ocultar removidos" : `Ver ${skippedCount} removido(s)`}</span>
            </button>
          )}
          <button
            type="button"
            onClick={toggleAll}
            aria-label={allPhasesCollapsed ? "Expandir tudo" : "Recolher tudo"}
            title={allPhasesCollapsed ? "Expandir tudo" : "Recolher tudo"}
            className={juntar(botao.discreto, "h-8")}
          >
            {allPhasesCollapsed ? <ChevronsUpDown className="h-4 w-4" aria-hidden="true" /> : <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-1.5 hidden sm:inline">{allPhasesCollapsed ? "Expandir" : "Recolher"}</span>
          </button>
        </div>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progresso do onboarding"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>

      {/* Fases: lista com divisória, cada uma recolhível */}
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {PHASE_ORDER.filter((p) => grouped[p]).map((phase) => {
          const phaseLists = grouped[phase];
          const phaseItems = phaseLists.flatMap((g) => g.items);
          const phaseDone = phaseItems.filter((i) => stateMap.get(i.id)?.is_done).length;
          const phasePct =
            phaseItems.length > 0 ? Math.round((phaseDone / phaseItems.length) * 100) : 0;
          const isCollapsed = !!collapsed[phase];
          return (
            <li key={phase} className="min-w-0">
              <button
                type="button"
                onClick={() => togglePhase(phase)}
                className={juntar("flex w-full min-w-0 items-center py-3 text-left hover:bg-muted/40", foco)}
                aria-expanded={!isCollapsed}
              >
                <ChevronRight
                  className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", !isCollapsed && "rotate-90")}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">{PHASE_LABEL[phase]}</span>
                {phasePct === 100 && phaseItems.length > 0 && (
                  <Check className="ml-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Fase completa" />
                )}
                <span className={juntar(texto.auxiliar, "ml-auto shrink-0 pl-3 tabular-nums")}>
                  {phaseDone} de {phaseItems.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="space-y-3 pb-3 pl-5">
                  {phaseLists.map((g) => {
                    const mostrarRotulo =
                      phaseLists.length > 1 ||
                      g.list.title !== PHASE_LABEL[phase] ||
                      g.list.service_type !== "geral" ||
                      (g.hiddenCount > 0 && !showSkipped);
                    return (
                      <div key={g.list.id} className="min-w-0">
                        {mostrarRotulo && (
                          <p className={juntar(texto.rotulo, "mb-1 flex min-w-0 items-center")}>
                            <span className="min-w-0 truncate">{g.list.title}</span>
                            {g.list.service_type !== "geral" && (
                              <span className={juntar(etiqueta, "ml-2 bg-muted font-normal text-muted-foreground")}>
                                {g.list.service_type}
                              </span>
                            )}
                            {g.hiddenCount > 0 && !showSkipped && (
                              <span className="ml-2 shrink-0 font-normal">{g.hiddenCount} N/A</span>
                            )}
                          </p>
                        )}
                        {g.items.length === 0 ? (
                          <p className={juntar(texto.auxiliar, "py-1")}>Nenhum item ativo para este cliente.</p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {g.items.map((it: any) => {
                              const s = stateMap.get(it.id);
                              const checked = !!s?.is_done;
                              const skipped = !!s?.is_skipped;
                              const auto = autoSourceFor(it, g.list);
                              return (
                                <li
                                  key={it.id}
                                  className={juntar("flex min-w-0 items-start py-2.5", skipped && "opacity-60")}
                                >
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    aria-label={it.label}
                                    onClick={() => toggleItem(it.id, !checked)}
                                    disabled={saving === it.id || skipped}
                                    className={juntar(
                                      "group/caixa -my-1.5 -ml-2 mr-0.5 flex h-8 min-h-0 w-8 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed",
                                      foco,
                                    )}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={juntar(
                                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                                        checked
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "border-muted-foreground/50 bg-background group-hover/caixa:border-primary",
                                      )}
                                    >
                                      {checked && <Check className="h-3 w-3" />}
                                    </span>
                                  </button>
                                  <div className="min-w-0 flex-1 sm:flex sm:items-start">
                                    <div className="min-w-0 sm:mr-4 sm:flex-1">
                                      <p
                                        className={juntar(
                                          texto.corpo,
                                          "flex min-w-0 flex-wrap items-center",
                                          (checked || skipped) && "text-muted-foreground",
                                        )}
                                      >
                                        {auto?.kind === "contract" && (
                                          <FileSignature className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                        )}
                                        {auto?.kind === "briefing" && (
                                          <ClipboardList className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                        )}
                                        <span className={juntar("min-w-0", (checked || skipped) && "line-through")}>{it.label}</span>
                                        {it.is_required && !skipped && (
                                          <span className="ml-0.5 text-destructive" aria-label="obrigatório">*</span>
                                        )}
                                        {auto && !skipped && (
                                          <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>Auto</span>
                                        )}
                                        {skipped && (
                                          <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Não necessário</span>
                                        )}
                                      </p>
                                      {it.hint && !skipped && (
                                        <p className={juntar(texto.auxiliar, "mt-0.5")}>{it.hint}</p>
                                      )}
                                      {auto && !skipped && (
                                        <Link
                                          to={auto.href}
                                          className={juntar("mt-1 inline-flex items-center rounded-sm text-[12px] text-primary hover:underline", foco)}
                                        >
                                          <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
                                          {auto.label}
                                        </Link>
                                      )}
                                    </div>
                                    {!skipped && (
                                      <input
                                        type="text"
                                        defaultValue={s?.value || ""}
                                        onBlur={(e) => {
                                          if (e.target.value !== (s?.value || "")) {
                                            updateValue(it.id, e.target.value);
                                          }
                                        }}
                                        placeholder="Link ou observação"
                                        aria-label={`Link ou observação: ${it.label}`}
                                        className={juntar(campo, "mt-2 h-8 sm:mt-0 sm:w-64 sm:shrink-0")}
                                      />
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setSkipped(it.id, !skipped)}
                                    disabled={saving === it.id}
                                    title={skipped ? "Marcar como necessário" : "Marcar como não necessário"}
                                    aria-label={skipped ? `Restaurar ${it.label}` : `Marcar ${it.label} como não necessário`}
                                    className={juntar(botao.discreto, "-my-1 ml-2 h-8 min-h-0 px-2 text-[12px]", skipped ? "hover:text-primary" : "hover:text-destructive")}
                                  >
                                    {saving === it.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                    ) : skipped ? (
                                      <>
                                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="ml-1 hidden sm:inline">Restaurar</span>
                                      </>
                                    ) : (
                                      <>
                                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="ml-1 hidden sm:inline">N/A</span>
                                      </>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
