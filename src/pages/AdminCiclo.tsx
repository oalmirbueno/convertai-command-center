import { useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, HelpCircle, ListChecks, RefreshCw, Sparkles, Star,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { isInternalClient } from "@/lib/clientFlags";

// O checklist de bolso do dono: ciclo semanal 1..6 por cliente, com
// estrelas de progresso. Mobile-first, um toque por etapa, sincronizado
// com o painel (a marcacao vive no banco). Instale o painel como PWA e
// abra /ciclo direto: e o controle remoto na mao.

const CYCLES: Record<
  "social" | "trafego",
  { label: string; steps: string[] }
> = {
  social: {
    label: "Social Media",
    steps: [
      "Conteúdo da semana criado (artes e legendas)",
      "Subir no painel (Arquivos, pasta certa)",
      "Conectar e conferir a conta no painel",
      "Painel atualizado (agenda, métricas, diário)",
      "Aprovação no grupo + ritual enviado",
      "Posts agendados (publicação automática armada)",
    ],
  },
  trafego: {
    label: "Tráfego Pago",
    steps: [
      "Campanhas ativas revisadas",
      "Criativos da semana prontos",
      "Anúncios subidos ou atualizados",
      "Verba e orçamento conferidos",
      "Métricas lidas e leitura anotada",
      "Registro no painel para o cliente ver",
    ],
  },
};

// Cliente NOVO (entrou ha menos de 45 dias) ganha o trilho de onboarding:
// etapas 7 a 10 por cima do ciclo normal, ate a rotina rodar sozinha.
const ONBOARDING_STEPS = [
  "Acessos e briefing completos",
  "Contas conectadas no painel",
  "Estratégia e primeiro calendário aprovados",
  "Rotina semanal rodando (vira cliente ativo)",
];
const NEW_CLIENT_DAYS = 45;

interface CycleRow {
  id: string;
  client_id: string;
  area: string;
  week_start: string;
  step: number;
}

const mondayOf = (base: Date) => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};
// Quantas semanas de história alimentam a linha do tempo e a continuidade.
const HISTORY_WEEKS = 8;
const fmt = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function AdminCiclo() {
  const { user, profile } = useAuth();
  const canWrite = ["admin", "manager"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const [area, setArea] = useState<"social" | "trafego">("social");
  const [weekOffset, setWeekOffset] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const weekStart = useMemo(() => {
    const d = mondayOf(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);
  const weekKey = isoDate(weekStart);

  // Carteira viva: recorrentes + hibridos ativos (os avulsos entram quando
  // tiverem ciclo proprio, niveis 7 a 10).
  const activeClients = useMemo(
    () =>
      ((clients || []) as any[])
        .filter(
          (c) =>
            !isInternalClient(c) &&
            (c.plan_status || "active") === "active" &&
            (c.client_type || "recurring") !== "one_off",
        )
        .sort((a, b) =>
          (a.company_name || a.full_name || "").localeCompare(
            b.company_name || b.full_name || "",
            "pt-BR",
          ),
        ),
    [clients],
  );

  const { data: rows } = useQuery({
    queryKey: ["weekly-cycle", user?.id, weekKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("id, client_id, area, week_start, step")
        .eq("week_start", weekKey);
      if (error) throw error;
      return (data || []) as CycleRow[];
    },
    enabled: !!user,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const doneMap = useMemo(() => {
    const map = new Map<string, CycleRow>();
    for (const row of rows || []) {
      map.set(`${row.client_id}:${row.area}:${row.step}`, row);
    }
    return map;
  }, [rows]);

  // Historia das ultimas semanas: alimenta a linha do tempo da carteira, o
  // sparkline por cliente e a deteccao de pendencia herdada.
  const realMonday = useMemo(() => mondayOf(new Date()), []);
  const { data: historyRows } = useQuery({
    queryKey: ["weekly-cycle-history", area],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("client_id, week_start, step")
        .eq("area", area)
        .gte("week_start", isoDate(addDays(realMonday, -(HISTORY_WEEKS - 1) * 7)));
      if (error) throw error;
      return (data || []) as Array<{ client_id: string; week_start: string; step: number }>;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  // Conjunto de etapas 1..6 feitas por cliente em cada semana da historia.
  const historySets = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const row of historyRows || []) {
      if (row.step > 6) continue;
      const key = `${row.client_id}:${row.week_start}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(row.step);
    }
    return map;
  }, [historyRows]);

  // Linha do tempo da carteira: % das etapas 1..6 fechadas em cada semana.
  const timeline = useMemo(() => {
    const weeks: Array<{ key: string; label: string; pct: number; offset: number }> = [];
    const clientCount = activeClients.length;
    for (let offset = -(HISTORY_WEEKS - 1); offset <= 0; offset += 1) {
      const key = isoDate(addDays(realMonday, offset * 7));
      let done = 0;
      for (const client of activeClients) {
        done += historySets.get(`${client.id}:${key}`)?.size || 0;
      }
      weeks.push({
        key,
        label: fmt(addDays(realMonday, offset * 7)),
        pct: clientCount > 0 ? done / (clientCount * 6) : 0,
        offset,
      });
    }
    return weeks;
  }, [activeClients, historySets, realMonday]);

  // Coach da semana: a IA le o checklist real e diz onde focar. Cache local de
  // 6 horas por semana e area; falha nunca aparece para o usuario, so some.
  const coachCacheKey = `aceleriq-coach-${area}-${weekKey}`;
  const { data: coach, isFetching: coachLoading, refetch: refetchCoach } = useQuery({
    queryKey: ["cycle-coach", area, weekKey],
    queryFn: async (): Promise<{ coach: string | null; closed?: number; total_clients?: number } | null> => {
      try {
        const cached = localStorage.getItem(coachCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - (parsed.at || 0) < 6 * 3600_000) return parsed.value;
        }
      } catch { /* cache corrompido: gera de novo */ }
      const { data, error } = await supabase.functions.invoke("cycle-coach", {
        body: { week_start: weekKey, area },
      });
      if (error || data?.error || !data?.coach) return null;
      const value = {
        coach: data.coach as string,
        closed: data.closed as number | undefined,
        total_clients: data.total_clients as number | undefined,
      };
      try {
        localStorage.setItem(coachCacheKey, JSON.stringify({ at: Date.now(), value }));
      } catch { /* armazenamento cheio: segue sem cache */ }
      return value;
    },
    enabled: !!user && weekOffset <= 0,
    staleTime: 6 * 3600_000,
    retry: 0,
  });

  const refreshCoach = () => {
    try { localStorage.removeItem(coachCacheKey); } catch { /* sem cache */ }
    void refetchCoach();
  };

  const toggle = async (clientId: string, step: number) => {
    if (!canWrite) return;
    const key = `${clientId}:${area}:${step}`;
    if (pendingKey === key) return;
    setPendingKey(key);
    try {
      const existing = doneMap.get(key);
      if (existing) {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress")
          .insert({
            client_id: clientId,
            area,
            week_start: weekKey,
            step,
            done_by: user?.id || null,
          });
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle"] });
    } catch (error: unknown) {
      toast.error(
        (error as { message?: string })?.message ||
          "Não foi possível marcar. Tente de novo.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <ListChecks className="h-5 w-5 text-primary" />
          Ciclo da Semana
        </h1>
        <button
          type="button"
          onClick={() => setShowLegend((current) => !current)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" /> Legenda
        </button>
      </div>

      {/* Semana */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setWeekOffset((w) => w - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            {fmt(weekStart)} a {fmt(weekEnd)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {weekOffset === 0 ? "Semana atual" : weekOffset < 0 ? "Semana passada" : "Próxima semana"}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setWeekOffset((w) => w + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Area */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(CYCLES) as Array<"social" | "trafego">).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setArea(key)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
              area === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {CYCLES[key].label}
          </button>
        ))}
      </div>

      {/* Linha do tempo: as ultimas semanas da carteira, tocavel */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Linha do tempo · {HISTORY_WEEKS} semanas
          </p>
          {timeline.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              hoje: {Math.round((timeline[timeline.length - 1]?.pct || 0) * 100)}%
            </p>
          )}
        </div>
        <div className="mt-2 flex items-end gap-1.5">
          {timeline.map((week) => {
            const selected = week.offset === weekOffset;
            return (
              <button
                key={week.key}
                type="button"
                onClick={() => setWeekOffset(week.offset)}
                className="group flex flex-1 flex-col items-center gap-1"
                aria-label={`Semana de ${week.label}: ${Math.round(week.pct * 100)}%`}
              >
                <span className="flex h-14 w-full items-end overflow-hidden rounded-md bg-secondary/40">
                  <span
                    className={`block w-full rounded-md transition-all ${
                      selected ? "bg-primary" : week.pct >= 1 ? "bg-success/70" : "bg-primary/40 group-hover:bg-primary/60"
                    }`}
                    style={{ height: `${Math.max(week.pct * 100, week.pct > 0 ? 8 : 3)}%` }}
                  />
                </span>
                <span className={`text-[9px] ${selected ? "font-bold text-primary" : "text-muted-foreground"}`}>
                  {week.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Coach da semana: IA lendo o checklist real */}
      {(coach?.coach || coachLoading) && (
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Coach da semana
              {typeof coach?.closed === "number" && typeof coach?.total_clients === "number" && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal">
                  {coach.closed}/{coach.total_clients} fechados
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={refreshCoach}
              disabled={coachLoading}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Atualizar coach"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${coachLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">
            {coach?.coach || "Lendo a semana da carteira…"}
          </p>
        </div>
      )}

      {/* Legenda */}
      {showLegend && (
        <div className="rounded-2xl border border-primary/25 bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            O ciclo · {cycle.label}
          </p>
          <ol className="mt-2 space-y-1.5">
            {cycle.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Cliente novo · etapas 7 a 10 (onboarding)
          </p>
          <ol className="mt-1 space-y-1.5">
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-info/15 text-[10px] font-bold text-info">
                  {index + 7}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Cada etapa concluída vira uma estrela. Cliente ativo fecha com {totalSteps}; cliente novo fecha com {totalSteps + ONBOARDING_STEPS.length}.
          </p>
        </div>
      )}

      {/* Clientes */}
      <div className="space-y-2.5">
        {activeClients.map((client: any) => {
          const isNew =
            client.created_at &&
            Date.now() - new Date(client.created_at).getTime() <
              NEW_CLIENT_DAYS * 86400000;
          const clientTotal = totalSteps + (isNew ? ONBOARDING_STEPS.length : 0);
          const doneCount = Array.from({ length: clientTotal }, (_, index) =>
            doneMap.has(`${client.id}:${area}:${index + 1}`) ? 1 : 0,
          ).reduce((sum: number, value) => sum + value, 0);
          const complete = doneCount === clientTotal;

          // Continuidade: o que a semana anterior deixou em aberto.
          const prevKey = isoDate(addDays(weekStart, -7));
          const prevSet = historySets.get(`${client.id}:${prevKey}`);
          const prevIncomplete =
            addDays(weekStart, -7) < realMonday && (prevSet?.size || 0) < totalSteps;
          const inheritedStep = prevIncomplete
            ? Array.from({ length: totalSteps }, (_, i) => i + 1).find(
                (step) => !prevSet?.has(step),
              ) || null
            : null;

          // Proximo passo desta semana: a primeira etapa ainda nao marcada.
          const nextStep = complete
            ? null
            : Array.from({ length: clientTotal }, (_, i) => i + 1).find(
                (step) => !doneMap.has(`${client.id}:${area}:${step}`),
              ) || null;
          const nextLabel = nextStep
            ? nextStep <= totalSteps
              ? cycle.steps[nextStep - 1]
              : ONBOARDING_STEPS[nextStep - totalSteps - 1]
            : null;
          return (
            <div
              key={client.id}
              className={`rounded-2xl border p-3.5 transition-colors ${
                complete
                  ? "border-success/40 bg-success/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                  <span className="truncate">{client.company_name || client.full_name}</span>
                  {isNew && (
                    <span className="shrink-0 rounded-md bg-info/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-info">
                      Novo
                    </span>
                  )}
                </p>
                <span className="flex shrink-0 items-center gap-0.5" aria-label={`${doneCount} de ${clientTotal} etapas`}>
                  {Array.from({ length: clientTotal }, (_, index) => (
                    <Star
                      key={index}
                      className={`h-3.5 w-3.5 ${
                        index < doneCount
                          ? "fill-amber-400 text-amber-400"
                          : "text-border"
                      }`}
                    />
                  ))}
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-6 gap-1.5">
                {cycle.steps.map((step, index) => {
                  const stepNumber = index + 1;
                  const key = `${client.id}:${area}:${stepNumber}`;
                  const done = doneMap.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      title={step}
                      disabled={!canWrite || pendingKey === key}
                      onClick={() => void toggle(client.id, stepNumber)}
                      className={`flex h-11 items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
                        done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      } ${pendingKey === key ? "opacity-50" : ""}`}
                    >
                      {stepNumber}
                    </button>
                  );
                })}
              </div>
              {inheritedStep !== null && (prevSet?.size || 0) > 0 && (
                <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
                  Semana passada fechou {prevSet?.size || 0}/{totalSteps}, parou na etapa {inheritedStep}
                </p>
              )}
              {isNew && (
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {ONBOARDING_STEPS.map((step, index) => {
                    const stepNumber = totalSteps + index + 1;
                    const key = `${client.id}:${area}:${stepNumber}`;
                    const done = doneMap.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        title={step}
                        disabled={!canWrite || pendingKey === key}
                        onClick={() => void toggle(client.id, stepNumber)}
                        className={`flex h-11 items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
                          done
                            ? "border-info bg-info text-white"
                            : "border-info/30 bg-info/5 text-info hover:border-info/60"
                        } ${pendingKey === key ? "opacity-50" : ""}`}
                      >
                        {stepNumber}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {complete ? (
                    <span className="font-medium text-success">Semana fechada ✦</span>
                  ) : nextLabel ? (
                    <>
                      <span className="font-semibold text-foreground">Próximo:</span>{" "}
                      {nextStep}. {nextLabel}
                    </>
                  ) : null}
                </p>
                <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
                  {timeline.map((week) => {
                    const fill =
                      (historySets.get(`${client.id}:${week.key}`)?.size || 0) / totalSteps;
                    return (
                      <span
                        key={week.key}
                        className={`h-2 w-1.5 rounded-sm ${
                          fill >= 1
                            ? "bg-success/80"
                            : fill > 0
                              ? "bg-primary/50"
                              : "bg-secondary"
                        }`}
                        style={fill > 0 && fill < 1 ? { opacity: 0.35 + fill * 0.65 } : undefined}
                      />
                    );
                  })}
                </span>
              </div>
            </div>
          );
        })}
        {activeClients.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum cliente ativo na carteira.</p>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Dica: instale o painel como aplicativo (PWA) e salve esta tela na home
        do celular. Tudo o que você marca aqui fica gravado e sincronizado com
        o painel na hora.
      </p>
    </div>
  );
}
