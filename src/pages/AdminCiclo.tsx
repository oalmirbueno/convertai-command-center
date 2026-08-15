import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, Check, ChevronLeft, ChevronRight, HelpCircle, LayoutDashboard,
  ListChecks, RefreshCw, Sparkles, Star,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { isInternalClient } from "@/lib/clientFlags";
import { usePwaProfile, useStandalone } from "@/hooks/usePwaProfile";
import {
  WEEKDAY_INITIALS, addDays, closedStreak, isSameDay, localIso, mondayOf,
  weekDays, weekLabel,
} from "@/lib/cycleWeek";

// O checklist de bolso do dono: o ciclo semanal de cada cliente, uma etapa
// por toque. Esta tela é um aplicativo à parte (manifest próprio em
// /ciclo.webmanifest): instala na tela inicial com ícone e nome próprios,
// abre direto aqui em tela cheia e não se mistura com o painel completo.
//
// A leitura é sempre a mesma: onde a carteira está hoje, o que ficou da
// semana passada e qual é o próximo toque. Tudo gravado no banco na hora.

const CYCLES: Record<
  "social" | "trafego",
  { label: string; short: string; steps: string[] }
> = {
  social: {
    label: "Social Media",
    short: "Social",
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
    short: "Tráfego",
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

// Trilho de entrada, só para quem ainda não terminou o onboarding. Quem já
// roda em rotina nunca vê estas etapas, mesmo que o cadastro seja recente.
const ONBOARDING_STEPS = [
  "Acessos e briefing completos",
  "Contas conectadas no painel",
  "Estratégia e primeiro calendário aprovados",
  "Rotina semanal rodando (conclui o onboarding)",
];

// Semanas de história que alimentam a linha do tempo e a continuidade.
const HISTORY_WEEKS = 8;

interface CycleRow {
  id: string;
  client_id: string;
  area: string;
  week_start: string;
  step: number;
}

const shortDate = (date: Date) =>
  date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function AdminCiclo() {
  const { user, profile } = useAuth();
  const canWrite = ["admin", "manager"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const standalone = useStandalone();
  const [area, setArea] = useState<"social" | "trafego">("social");
  const [weekOffset, setWeekOffset] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Instalável como aplicativo próprio enquanto esta tela estiver aberta.
  usePwaProfile("/ciclo.webmanifest", "Ciclo");

  const today = useMemo(() => new Date(), []);
  const realMonday = useMemo(() => mondayOf(today), [today]);
  const weekStart = useMemo(
    () => addDays(realMonday, weekOffset * 7),
    [realMonday, weekOffset],
  );
  const weekKey = localIso(weekStart);
  const isCurrentWeek = weekOffset === 0;

  // Carteira viva: recorrentes e híbridos ativos.
  const activeClients = useMemo(
    () =>
      ((clients || []) as any[]).filter(
        (client) =>
          !isInternalClient(client) &&
          (client.plan_status || "active") === "active" &&
          (client.client_type || "recurring") !== "one_off",
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

  // História das últimas semanas: linha do tempo, sequência e pendência
  // herdada saem toda daqui.
  const { data: historyRows } = useQuery({
    queryKey: ["weekly-cycle-history", area],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("client_id, week_start, step")
        .eq("area", area)
        .gte("week_start", localIso(addDays(realMonday, -(HISTORY_WEEKS - 1) * 7)));
      if (error) throw error;
      return (data || []) as Array<{ client_id: string; week_start: string; step: number }>;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

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

  const historyWeekKeys = useMemo(
    () =>
      Array.from({ length: HISTORY_WEEKS }, (_, index) =>
        localIso(addDays(realMonday, (index - (HISTORY_WEEKS - 1)) * 7)),
      ),
    [realMonday],
  );

  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;

  // Quem ainda está em onboarding: o campo do cadastro manda, não a data de
  // criação. Cliente que já roda em rotina não volta a ser "novo".
  const isOnboarding = (client: any) => client.onboarding_done === false;
  const totalFor = (client: any) =>
    totalSteps + (isOnboarding(client) ? ONBOARDING_STEPS.length : 0);
  const doneCountFor = (client: any) => {
    let count = 0;
    for (let step = 1; step <= totalFor(client); step += 1) {
      if (doneMap.has(`${client.id}:${area}:${step}`)) count += 1;
    }
    return count;
  };

  // Ordem de trabalho: quem está mais atrasado primeiro, fechados por último.
  const orderedClients = useMemo(() => {
    return [...activeClients].sort((a, b) => {
      const aTotal = totalFor(a), bTotal = totalFor(b);
      const aDone = doneCountFor(a), bDone = doneCountFor(b);
      const aClosed = aDone >= aTotal ? 1 : 0;
      const bClosed = bDone >= bTotal ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;
      if (aDone !== bDone) return aDone - bDone;
      return (a.company_name || a.full_name || "").localeCompare(
        b.company_name || b.full_name || "",
        "pt-BR",
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClients, doneMap, area]);

  const openClients = orderedClients.filter((c) => doneCountFor(c) < totalFor(c));
  const closedClients = orderedClients.filter((c) => doneCountFor(c) >= totalFor(c));

  // Progresso da semana inteira: o número que resume o esforço da carteira.
  const weekTotals = useMemo(() => {
    let done = 0, total = 0;
    for (const client of activeClients) {
      total += totalFor(client);
      done += doneCountFor(client);
    }
    return { done, total, pct: total > 0 ? done / total : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClients, doneMap, area]);

  // Sequência de semanas fechadas pela carteira: o avanço que não se perde.
  const carteiraStreak = useMemo(() => {
    if (activeClients.length === 0) return 0;
    const pastKeys = historyWeekKeys.slice(0, HISTORY_WEEKS - 1);
    return closedStreak(pastKeys, (key) =>
      activeClients.every(
        (client) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
      ),
    );
  }, [activeClients, historySets, historyWeekKeys, totalSteps]);

  const timeline = useMemo(
    () =>
      historyWeekKeys.map((key, index) => {
        const offset = index - (HISTORY_WEEKS - 1);
        let done = 0;
        for (const client of activeClients) {
          done += historySets.get(`${client.id}:${key}`)?.size || 0;
        }
        return {
          key,
          offset,
          label: shortDate(addDays(realMonday, offset * 7)),
          pct: activeClients.length > 0 ? done / (activeClients.length * totalSteps) : 0,
        };
      }),
    [activeClients, historySets, historyWeekKeys, realMonday, totalSteps],
  );

  // Continuar de onde parou: o próximo toque da carteira, sempre visível.
  const nextUp = useMemo(() => {
    const client = openClients[0];
    if (!client) return null;
    const total = totalFor(client);
    const step = Array.from({ length: total }, (_, i) => i + 1).find(
      (candidate) => !doneMap.has(`${client.id}:${area}:${candidate}`),
    );
    if (!step) return null;
    return {
      client,
      step,
      label: step <= totalSteps ? cycle.steps[step - 1] : ONBOARDING_STEPS[step - totalSteps - 1],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClients, doneMap, area]);

  const jumpToNext = () => {
    if (!nextUp) return;
    cardRefs.current[nextUp.client.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(nextUp.client.id);
  };

  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);

  // Coach da semana: a IA lê o checklist real e diz onde focar.
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

  const toggle = async (client: any, step: number) => {
    if (!canWrite) return;
    const key = `${client.id}:${area}:${step}`;
    if (pendingKey === key) return;
    setPendingKey(key);
    const existing = doneMap.get(key);

    // Resposta imediata ao toque: a marca aparece antes da ida ao banco e só
    // volta atrás se o banco recusar.
    queryClient.setQueryData<CycleRow[]>(["weekly-cycle", user?.id, weekKey], (current) => {
      const list = current || [];
      return existing
        ? list.filter((row) => row.id !== existing.id)
        : [...list, {
            id: `otimista-${key}`, client_id: client.id, area,
            week_start: weekKey, step,
          }];
    });

    try {
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
            client_id: client.id, area, week_start: weekKey, step,
            done_by: user?.id || null,
          });
        if (error) throw error;

        // Última etapa do onboarding marcada: o cliente gradua de vez e o
        // trilho de entrada some da tela nas próximas semanas.
        if (isOnboarding(client) && step === totalSteps + ONBOARDING_STEPS.length) {
          const { error: graduateError } = await supabase
            .from("profiles")
            .update({ onboarding_done: true })
            .eq("id", client.id);
          if (!graduateError) {
            toast.success(`${client.company_name || client.full_name} concluiu o onboarding.`);
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle"] });
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle-history"] });
    } catch (error: unknown) {
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle"] });
      toast.error(
        (error as { message?: string })?.message || "Não foi possível marcar. Tente de novo.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  const renderClientCard = (client: any) => {
    const onboarding = isOnboarding(client);
    const clientTotal = totalFor(client);
    const doneCount = doneCountFor(client);
    const complete = doneCount >= clientTotal;

    const prevKey = localIso(addDays(weekStart, -7));
    const prevSet = historySets.get(`${client.id}:${prevKey}`);
    const prevIsPast = addDays(weekStart, -7) < realMonday;
    const inheritedStep = prevIsPast && (prevSet?.size || 0) < totalSteps
      ? Array.from({ length: totalSteps }, (_, i) => i + 1).find((step) => !prevSet?.has(step)) || null
      : null;

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

    const streak = closedStreak(
      historyWeekKeys.slice(0, HISTORY_WEEKS - 1),
      (key) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
    );

    const stepButton = (step: number, onboardingTrack: boolean) => {
      const key = `${client.id}:${area}:${step}`;
      const done = doneMap.has(key);
      const isNext = step === nextStep;
      const label = onboardingTrack
        ? ONBOARDING_STEPS[step - totalSteps - 1]
        : cycle.steps[step - 1];
      return (
        <button
          key={key}
          type="button"
          title={label}
          disabled={!canWrite || pendingKey === key}
          onClick={() => void toggle(client, step)}
          className={`flex h-12 items-center justify-center rounded-xl border text-sm font-bold transition-all active:scale-95 ${
            done
              ? onboardingTrack
                ? "border-info bg-info text-white"
                : "border-primary bg-primary text-primary-foreground"
              : isNext
                ? "border-primary/70 bg-primary/10 text-primary ring-2 ring-primary/25"
                : onboardingTrack
                  ? "border-info/30 bg-info/5 text-info"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
          } ${pendingKey === key ? "opacity-50" : ""}`}
        >
          {done ? <Check className="h-4 w-4" /> : step}
        </button>
      );
    };

    return (
      <div
        key={client.id}
        ref={(node) => { cardRefs.current[client.id] = node; }}
        className={`rounded-2xl border p-4 transition-all ${
          complete ? "border-success/40 bg-success/5" : "border-border bg-card"
        } ${highlighted === client.id ? "ring-2 ring-primary" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              <span className="truncate">{client.company_name || client.full_name}</span>
              {onboarding && (
                <span className="shrink-0 rounded-md bg-info/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-info">
                  Onboarding
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {doneCount} de {clientTotal} etapas
              {streak > 0 && ` · ${streak} ${streak === 1 ? "semana seguida" : "semanas seguidas"}`}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-0.5" aria-label={`${doneCount} de ${clientTotal} etapas`}>
            {Array.from({ length: clientTotal }, (_, index) => (
              <Star
                key={index}
                className={`h-3.5 w-3.5 ${index < doneCount ? "fill-amber-400 text-amber-400" : "text-border"}`}
              />
            ))}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {cycle.steps.map((_, index) => stepButton(index + 1, false))}
        </div>
        {onboarding && (
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {ONBOARDING_STEPS.map((_, index) => stepButton(totalSteps + index + 1, true))}
          </div>
        )}

        {inheritedStep !== null && (prevSet?.size || 0) > 0 && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Ficou da semana passada: {prevSet?.size}/{totalSteps}, parou na etapa {inheritedStep}
          </p>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[12px]">
            {complete ? (
              <span className="font-medium text-success">Semana fechada</span>
            ) : nextLabel ? (
              <>
                <span className="font-semibold text-foreground">Próximo:</span>{" "}
                <span className="text-muted-foreground">{nextStep}. {nextLabel}</span>
              </>
            ) : null}
          </p>
          <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
            {historyWeekKeys.map((key) => {
              const fill = (historySets.get(`${client.id}:${key}`)?.size || 0) / totalSteps;
              return (
                <span
                  key={key}
                  className={`h-2.5 w-1.5 rounded-sm ${
                    fill >= 1 ? "bg-success/80" : fill > 0 ? "bg-primary/50" : "bg-secondary"
                  }`}
                  style={fill > 0 && fill < 1 ? { opacity: 0.35 + fill * 0.65 } : undefined}
                />
              );
            })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-3 p-4 pb-16 sm:p-6">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <ListChecks className="h-5 w-5 text-primary" />
            Ciclo da Semana
          </h1>
          <div className="flex items-center gap-1.5">
            {!standalone && (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <LayoutDashboard className="h-3.5 w-3.5" /> Painel
              </Link>
            )}
            <button
              type="button"
              onClick={() => setShowLegend((current) => !current)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" /> Legenda
            </button>
          </div>
        </div>

        {/* Semana, com os dias reais e hoje em destaque */}
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setWeekOffset((current) => current - 1)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-foreground">
                {weekLabel(weekStart)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {isCurrentWeek
                  ? `Semana atual · hoje é ${today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}`
                  : weekOffset < 0
                    ? `${Math.abs(weekOffset)} ${Math.abs(weekOffset) === 1 ? "semana atrás" : "semanas atrás"}`
                    : `Daqui a ${weekOffset} ${weekOffset === 1 ? "semana" : "semanas"}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWeekOffset((current) => current + 1)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {weekDays(weekStart).map((day, index) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={localIso(day)}
                  className={`rounded-lg py-1 text-center ${
                    isToday ? "bg-primary/15 ring-1 ring-primary/40" : ""
                  }`}
                >
                  <p className={`text-[9px] uppercase ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                    {WEEKDAY_INITIALS[index]}
                  </p>
                  <p className={`text-[13px] font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                    {day.getDate()}
                  </p>
                </div>
              );
            })}
          </div>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="mt-2 w-full rounded-lg border border-primary/30 bg-primary/5 py-1.5 text-[11px] font-semibold text-primary"
            >
              Voltar para a semana atual
            </button>
          )}
        </div>

        {/* Área */}
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

        {/* Progresso da semana */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Progresso da semana
              </p>
              <p className="mt-0.5 text-2xl font-bold text-foreground">
                {weekTotals.done}
                <span className="text-base font-medium text-muted-foreground">/{weekTotals.total}</span>
                <span className="ml-2 text-sm font-semibold text-primary">
                  {Math.round(weekTotals.pct * 100)}%
                </span>
              </p>
            </div>
            <p className="text-right text-[11px] text-muted-foreground">
              {closedClients.length} de {activeClients.length} clientes fechados
              {carteiraStreak > 0 && (
                <>
                  <br />
                  <span className="font-semibold text-success">
                    {carteiraStreak} {carteiraStreak === 1 ? "semana seguida" : "semanas seguidas"} 100%
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(weekTotals.pct * 100)}%` }}
            />
          </div>
        </div>

        {/* Continuar de onde parou */}
        {nextUp && canWrite && (
          <button
            type="button"
            onClick={jumpToNext}
            className="flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 text-left transition-colors hover:bg-primary/[0.1]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
              {nextUp.step}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Continuar de onde parou
              </span>
              <span className="block truncate text-sm font-semibold text-foreground">
                {nextUp.client.company_name || nextUp.client.full_name}
              </span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{nextUp.label}</span>
            </span>
            <ArrowDown className="h-4 w-4 shrink-0 text-primary" />
          </button>
        )}

        {/* Linha do tempo */}
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Linha do tempo · {HISTORY_WEEKS} semanas
          </p>
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
                  <span className="flex h-16 w-full items-end overflow-hidden rounded-md bg-secondary/40">
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

        {/* Coach da semana */}
        {(coach?.coach || coachLoading) && (
          <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Coach da semana
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
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Onboarding · etapas 7 a 10
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
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Só aparecem para quem ainda não concluiu o onboarding. Marcar a
              etapa 10 conclui o onboarding do cliente e o trilho some.
            </p>
          </div>
        )}

        {/* Clientes em aberto */}
        <div className="grid gap-2.5 md:grid-cols-2">
          {openClients.map(renderClientCard)}
        </div>
        {activeClients.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum cliente ativo na carteira.</p>
        )}

        {/* Fechados, fora do caminho */}
        {closedClients.length > 0 && (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setShowClosed((current) => !current)}
              className="flex w-full items-center justify-between rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-left"
            >
              <span className="text-[12px] font-semibold text-success">
                {closedClients.length} {closedClients.length === 1 ? "cliente fechado" : "clientes fechados"} nesta semana
              </span>
              <span className="text-[11px] text-muted-foreground">
                {showClosed ? "esconder" : "ver"}
              </span>
            </button>
            {showClosed && (
              <div className="grid gap-2.5 md:grid-cols-2">
                {closedClients.map(renderClientCard)}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Dica: instale esta tela como aplicativo próprio. No celular, abra o
          menu do navegador e escolha "Adicionar à tela inicial": o Ciclo entra
          como app separado, com ícone próprio, e abre direto aqui.
        </p>
      </div>
    </div>
  );
}
