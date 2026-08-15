import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, BarChart3, CalendarDays, Check, ChevronLeft, ChevronRight,
  Columns3, DollarSign, FileArchive, HeartPulse, LayoutDashboard, ListChecks,
  Megaphone, Menu, RefreshCw, Share2, Sparkles, TrendingUp, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService, isInternalClient } from "@/lib/clientFlags";
import { usePwaProfile } from "@/hooks/usePwaProfile";
import { useNow } from "@/hooks/useNow";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  WEEKDAY_INITIALS, addDays, closedStreak, isSameDay, localIso, mondayOf,
  weekDays, weekLabel,
} from "@/lib/cycleWeek";

// O Ciclo é um aplicativo à parte, instalável pelo próprio /ciclo. A tela
// ocupa a altura exata do aparelho: topo fixo com a semana, uma única área
// que rola (a carteira) e a barra de baixo com as duas frentes. Nada de
// rolar a página inteira para achar o que fazer.

const CYCLES: Record<
  "social" | "trafego",
  { label: string; short: string; icon: typeof Share2; steps: string[] }
> = {
  social: {
    label: "Social Media",
    short: "Social",
    icon: Share2,
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
    icon: Megaphone,
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

const ONBOARDING_STEPS = [
  "Acessos e briefing completos",
  "Contas conectadas no painel",
  "Estratégia e primeiro calendário aprovados",
  "Rotina semanal rodando (conclui o onboarding)",
];

const HISTORY_WEEKS = 8;
const AREA_STORAGE_KEY = "aceleriq-ciclo-area";

// Atalhos do painel dentro do menu: o Ciclo abre sozinho, mas o resto do
// sistema continua a um toque de distância.
const MENU_LINKS = [
  { title: "Painel", url: "/dashboard", icon: LayoutDashboard },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Central de Experiência", url: "/central", icon: HeartPulse },
  { title: "Métricas", url: "/metricas", icon: BarChart3 },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Arquivos", url: "/arquivos", icon: FileArchive },
];

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

  usePwaProfile("/ciclo.webmanifest", "Ciclo");

  // A data se mantém viva: virar o dia ou a semana com o app aberto atualiza
  // a tela sem precisar recarregar.
  const today = useNow();

  const [area, setArea] = useState<"social" | "trafego">(() => {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem(AREA_STORAGE_KEY);
    return saved === "trafego" ? "trafego" : "social";
  });
  const [weekOffset, setWeekOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(AREA_STORAGE_KEY, area); } catch { /* sem cache */ }
  }, [area]);

  const realMonday = useMemo(() => mondayOf(today), [today]);
  const weekStart = useMemo(
    () => addDays(realMonday, weekOffset * 7),
    [realMonday, weekOffset],
  );
  const weekKey = localIso(weekStart);
  const isCurrentWeek = weekOffset === 0;

  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;

  // A carteira de cada frente: só quem contratou aquele serviço no cadastro.
  const activeClients = useMemo(() => {
    return ((clients || []) as any[]).filter(
      (client) =>
        !isInternalClient(client) &&
        (client.plan_status || "active") === "active" &&
        (client.client_type || "recurring") !== "one_off" &&
        hasService(client, area),
    );
  }, [clients, area]);

  // Cliente ativo sem nenhuma das duas frentes marcadas some das listas, e
  // sumir em silêncio é pior do que avisar: o cadastro precisa de ajuste.
  const unassignedCount = useMemo(() => {
    return ((clients || []) as any[]).filter(
      (client) =>
        !isInternalClient(client) &&
        (client.plan_status || "active") === "active" &&
        (client.client_type || "recurring") !== "one_off" &&
        !hasService(client, "social") &&
        !hasService(client, "trafego"),
    ).length;
  }, [clients]);

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

  const { data: historyRows } = useQuery({
    queryKey: ["weekly-cycle-history", area, localIso(realMonday)],
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

  const orderedClients = useMemo(() => {
    return [...activeClients].sort((a, b) => {
      const aDone = doneCountFor(a), bDone = doneCountFor(b);
      const aClosed = aDone >= totalFor(a) ? 1 : 0;
      const bClosed = bDone >= totalFor(b) ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;
      if (aDone !== bDone) return aDone - bDone;
      return (a.company_name || a.full_name || "").localeCompare(
        b.company_name || b.full_name || "", "pt-BR",
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClients, doneMap, area]);

  const openClients = orderedClients.filter((c) => doneCountFor(c) < totalFor(c));
  const closedClients = orderedClients.filter((c) => doneCountFor(c) >= totalFor(c));

  const totalsFor = (list: any[]) => {
    let done = 0, total = 0;
    for (const client of list) {
      total += totalFor(client);
      done += doneCountFor(client);
    }
    return { done, total, pct: total > 0 ? done / total : 0 };
  };
  const weekTotals = useMemo(
    () => totalsFor(activeClients),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeClients, doneMap, area],
  );

  // Contador da outra frente, para a barra de baixo mostrar as duas de relance.
  const otherArea: "social" | "trafego" = area === "social" ? "trafego" : "social";
  const otherAreaTotals = useMemo(() => {
    const list = ((clients || []) as any[]).filter(
      (client) =>
        !isInternalClient(client) &&
        (client.plan_status || "active") === "active" &&
        (client.client_type || "recurring") !== "one_off" &&
        hasService(client, otherArea),
    );
    let done = 0, total = 0;
    for (const client of list) {
      const clientTotal =
        CYCLES[otherArea].steps.length + (isOnboarding(client) ? ONBOARDING_STEPS.length : 0);
      total += clientTotal;
      for (let step = 1; step <= clientTotal; step += 1) {
        if (doneMap.has(`${client.id}:${otherArea}:${step}`)) done += 1;
      }
    }
    return { done, total };
  }, [clients, otherArea, doneMap]);

  const carteiraStreak = useMemo(() => {
    if (activeClients.length === 0) return 0;
    return closedStreak(historyWeekKeys.slice(0, HISTORY_WEEKS - 1), (key) =>
      activeClients.every(
        (client) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
      ),
    );
  }, [activeClients, historySets, historyWeekKeys, totalSteps]);

  const timeline = useMemo(
    () =>
      historyWeekKeys.map((key, index) => {
        const offset = index - (HISTORY_WEEKS - 1);
        const start = addDays(realMonday, offset * 7);
        let done = 0;
        for (const client of activeClients) {
          done += historySets.get(`${client.id}:${key}`)?.size || 0;
        }
        return {
          key,
          offset,
          start,
          label: shortDate(start),
          range: `${start.getDate()} a ${addDays(start, 6).getDate()}`,
          pct: activeClients.length > 0 ? done / (activeClients.length * totalSteps) : 0,
        };
      }),
    [activeClients, historySets, historyWeekKeys, realMonday, totalSteps],
  );

  const nextUp = useMemo(() => {
    const client = openClients[0];
    if (!client) return null;
    const step = Array.from({ length: totalFor(client) }, (_, i) => i + 1).find(
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
    const card = cardRefs.current[nextUp.client.id];
    card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlighted(nextUp.client.id);
  };

  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);

  // Trocar de frente volta ao topo: cada aba começa do começo.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [area]);

  const coachCacheKey = `aceleriq-coach-${area}-${weekKey}`;
  const { data: coach, isFetching: coachLoading, refetch: refetchCoach } = useQuery({
    queryKey: ["cycle-coach", area, weekKey],
    queryFn: async (): Promise<{ coach: string | null } | null> => {
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
      const value = { coach: data.coach as string };
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

    queryClient.setQueryData<CycleRow[]>(["weekly-cycle", user?.id, weekKey], (current) => {
      const list = current || [];
      return existing
        ? list.filter((row) => row.id !== existing.id)
        : [...list, { id: `otimista-${key}`, client_id: client.id, area, week_start: weekKey, step }];
    });

    try {
      if (existing) {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress").delete().eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress")
          .insert({ client_id: client.id, area, week_start: weekKey, step, done_by: user?.id || null });
        if (error) throw error;

        if (isOnboarding(client) && step === totalSteps + ONBOARDING_STEPS.length) {
          const { error: graduateError } = await supabase
            .from("profiles").update({ onboarding_done: true }).eq("id", client.id);
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
    const inheritedStep =
      addDays(weekStart, -7) < realMonday && (prevSet?.size || 0) > 0 && (prevSet?.size || 0) < totalSteps
        ? Array.from({ length: totalSteps }, (_, i) => i + 1).find((step) => !prevSet?.has(step)) || null
        : null;

    const nextStep = complete
      ? null
      : Array.from({ length: clientTotal }, (_, i) => i + 1).find(
          (step) => !doneMap.has(`${client.id}:${area}:${step}`),
        ) || null;
    const nextLabel = nextStep
      ? nextStep <= totalSteps ? cycle.steps[nextStep - 1] : ONBOARDING_STEPS[nextStep - totalSteps - 1]
      : null;

    const stepButton = (step: number, onboardingTrack: boolean) => {
      const key = `${client.id}:${area}:${step}`;
      const done = doneMap.has(key);
      const isNext = step === nextStep;
      return (
        <button
          key={key}
          type="button"
          title={onboardingTrack ? ONBOARDING_STEPS[step - totalSteps - 1] : cycle.steps[step - 1]}
          disabled={!canWrite || pendingKey === key}
          onClick={() => void toggle(client, step)}
          className={`flex h-11 items-center justify-center rounded-lg border text-[13px] font-bold transition-all active:scale-90 ${
            done
              ? onboardingTrack
                ? "border-info bg-info text-white"
                : "border-primary bg-primary text-primary-foreground"
              : isNext
                ? "border-primary/70 bg-primary/10 text-primary ring-2 ring-primary/25"
                : onboardingTrack
                  ? "border-info/30 bg-info/5 text-info"
                  : "border-border bg-secondary/30 text-muted-foreground"
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
        className={`rounded-2xl border p-3 transition-all ${
          complete ? "border-success/40 bg-success/5" : "border-border bg-card"
        } ${highlighted === client.id ? "ring-2 ring-primary" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-foreground">
            <span className="truncate">{client.company_name || client.full_name}</span>
            {onboarding && (
              <span className="shrink-0 rounded bg-info/15 px-1 py-0.5 text-[8.5px] font-bold uppercase text-info">
                Onboarding
              </span>
            )}
          </p>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {doneCount}/{clientTotal}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {cycle.steps.map((_, index) => stepButton(index + 1, false))}
        </div>
        {onboarding && (
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {ONBOARDING_STEPS.map((_, index) => stepButton(totalSteps + index + 1, true))}
          </div>
        )}

        {inheritedStep !== null && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
            Semana passada: {prevSet?.size}/{totalSteps}, parou na {inheritedStep}
          </p>
        )}

        <p className="mt-2 truncate text-[11.5px]">
          {complete ? (
            <span className="font-medium text-success">Semana fechada</span>
          ) : nextLabel ? (
            <>
              <span className="font-semibold text-foreground">Agora:</span>{" "}
              <span className="text-muted-foreground">{nextStep}. {nextLabel}</span>
            </>
          ) : null}
        </p>
      </div>
    );
  };

  const AreaTab = ({ target }: { target: "social" | "trafego" }) => {
    const config = CYCLES[target];
    const Icon = config.icon;
    const selected = area === target;
    const totals = selected
      ? { done: weekTotals.done, total: weekTotals.total }
      : otherAreaTotals;
    return (
      <button
        type="button"
        onClick={() => setArea(target)}
        className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 transition-colors ${
          selected ? "bg-primary/10 text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
        <span className="text-[11px] font-semibold">{config.short}</span>
        <span className="text-[9.5px] tabular-nums opacity-80">
          {totals.total > 0 ? `${totals.done}/${totals.total}` : "sem clientes"}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Topo fixo: identidade, semana e os dias reais */}
      <header className="shrink-0 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[15px] font-bold text-foreground">
              <ListChecks className="h-4 w-4 text-primary" /> Ciclo da Semana
            </p>
            <p className="truncate text-[10px] text-muted-foreground">{cycle.label}</p>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Ver histórico"
            >
              <TrendingUp className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1 px-2 pb-1">
          <button
            type="button"
            onClick={() => setWeekOffset((current) => current - 1)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/60"
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="min-w-0 flex-1 text-center"
          >
            <span className="block truncate text-[12.5px] font-semibold capitalize text-foreground">
              {weekLabel(weekStart)}
            </span>
            <span className="block text-[9.5px] text-muted-foreground">
              {isCurrentWeek
                ? "toque nos números para marcar"
                : weekOffset < 0
                  ? `${Math.abs(weekOffset)} ${Math.abs(weekOffset) === 1 ? "semana atrás" : "semanas atrás"} · voltar para hoje`
                  : `próxima semana · voltar para hoje`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((current) => current + 1)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/60"
            aria-label="Próxima semana"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 px-2 pb-1.5">
          {weekDays(weekStart).map((day, index) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={localIso(day)}
                className={`rounded-md py-0.5 text-center ${isToday ? "bg-primary/15" : ""}`}
              >
                <p className={`text-[8.5px] uppercase ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                  {WEEKDAY_INITIALS[index]}
                </p>
                <p className={`text-[12px] font-semibold tabular-nums ${isToday ? "text-primary" : "text-foreground"}`}>
                  {day.getDate()}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(weekTotals.pct * 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {weekTotals.done}/{weekTotals.total}
            {closedClients.length > 0 && ` · ${closedClients.length} ok`}
          </span>
        </div>
      </header>

      {/* Única área que rola: a carteira */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div className="mx-auto w-full max-w-3xl space-y-2.5">
          {nextUp && canWrite && (
            <button
              type="button"
              onClick={jumpToNext}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold text-primary">
                {nextUp.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                  Continuar de onde parou
                </span>
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {nextUp.client.company_name || nextUp.client.full_name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{nextUp.label}</span>
              </span>
              <ArrowDown className="h-4 w-4 shrink-0 text-primary" />
            </button>
          )}

          {coach?.coach && (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <Sparkles className="h-3 w-3" /> Coach da semana
                </p>
                <button
                  type="button"
                  onClick={refreshCoach}
                  disabled={coachLoading}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Atualizar coach"
                >
                  <RefreshCw className={`h-3 w-3 ${coachLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/90">{coach.coach}</p>
            </div>
          )}

          {openClients.map(renderClientCard)}

          {activeClients.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Nenhum cliente de {cycle.label.toLowerCase()}
              </p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                A lista usa o serviço marcado no cadastro do cliente. Marque
                "{area === "social" ? "Social" : "Tráfego"}" em Clientes para ele aparecer aqui.
              </p>
            </div>
          )}

          {openClients.length === 0 && activeClients.length > 0 && (
            <div className="rounded-2xl border border-success/40 bg-success/5 p-5 text-center">
              <p className="text-sm font-semibold text-success">Semana fechada em {cycle.label}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Os {activeClients.length} clientes desta frente estão em dia.
              </p>
            </div>
          )}

          {closedClients.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowClosed((current) => !current)}
                className="flex w-full items-center justify-between rounded-xl border border-success/25 bg-success/5 px-3 py-2 text-left"
              >
                <span className="text-[11.5px] font-semibold text-success">
                  {closedClients.length} {closedClients.length === 1 ? "cliente fechado" : "clientes fechados"}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  {showClosed ? "esconder" : "ver"}
                </span>
              </button>
              {showClosed && closedClients.map(renderClientCard)}
            </div>
          )}

          {unassignedCount > 0 && (
            <p className="px-1 pb-2 text-[10px] leading-relaxed text-muted-foreground">
              {unassignedCount} {unassignedCount === 1 ? "cliente ativo não tem" : "clientes ativos não têm"} Social
              nem Tráfego marcado no cadastro, então {unassignedCount === 1 ? "não aparece" : "não aparecem"} em nenhuma
              das frentes.
            </p>
          )}
        </div>
      </div>

      {/* Barra de baixo: as duas frentes, sempre no polegar */}
      <nav className="shrink-0 border-t border-border bg-card px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-md items-stretch gap-2 py-1.5">
          <AreaTab target="social" />
          <AreaTab target="trafego" />
        </div>
      </nav>

      {/* Menu do painel */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" /> Ciclo Aceleriq
            </SheetTitle>
          </SheetHeader>
          <div className="p-2">
            <button
              type="button"
              onClick={() => { setLegendOpen(true); setMenuOpen(false); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:bg-secondary/60"
            >
              <ListChecks className="h-4 w-4 text-primary" /> Como funciona o ciclo
            </button>
            <div className="my-2 border-t border-border" />
            <p className="px-3 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ir para o painel
            </p>
            {MENU_LINKS.map((link) => (
              <Link
                key={link.url}
                to={link.url}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <link.icon className="h-4 w-4" /> {link.title}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Histórico: linha do tempo das semanas */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Histórico · {cycle.label}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="flex items-end gap-1.5">
              {timeline.map((week) => {
                const selected = week.offset === weekOffset;
                return (
                  <button
                    key={week.key}
                    type="button"
                    onClick={() => { setWeekOffset(week.offset); setHistoryOpen(false); }}
                    className="flex flex-1 flex-col items-center gap-1"
                    aria-label={`Semana de ${week.range}: ${Math.round(week.pct * 100)}%`}
                  >
                    <span className="text-[9px] font-semibold tabular-nums text-muted-foreground">
                      {Math.round(week.pct * 100)}%
                    </span>
                    <span className="flex h-24 w-full items-end overflow-hidden rounded-md bg-secondary/40">
                      <span
                        className={`block w-full rounded-md ${
                          selected ? "bg-primary" : week.pct >= 1 ? "bg-success/70" : "bg-primary/40"
                        }`}
                        style={{ height: `${Math.max(week.pct * 100, week.pct > 0 ? 8 : 3)}%` }}
                      />
                    </span>
                    <span className={`text-[9px] tabular-nums ${selected ? "font-bold text-primary" : "text-muted-foreground"}`}>
                      {week.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Sequência
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  {carteiraStreak}{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {carteiraStreak === 1 ? "semana 100%" : "semanas 100%"}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Esta semana
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  {Math.round(weekTotals.pct * 100)}%{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">
                    de {weekTotals.total} etapas
                  </span>
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {activeClients.map((client: any) => (
                <div key={client.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                    {client.company_name || client.full_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-[3px]">
                    {historyWeekKeys.map((key) => {
                      const fill = (historySets.get(`${client.id}:${key}`)?.size || 0) / totalSteps;
                      return (
                        <span
                          key={key}
                          className={`h-3 w-2 rounded-sm ${
                            fill >= 1 ? "bg-success/80" : fill > 0 ? "bg-primary/50" : "bg-secondary"
                          }`}
                          style={fill > 0 && fill < 1 ? { opacity: 0.35 + fill * 0.65 } : undefined}
                        />
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Legenda do ciclo */}
      <Sheet open={legendOpen} onOpenChange={setLegendOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between text-base">
              O ciclo · {cycle.label}
              <button type="button" onClick={() => setLegendOpen(false)} aria-label="Fechar">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </SheetTitle>
          </SheetHeader>
          <ol className="mt-4 space-y-2">
            {cycle.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Onboarding · etapas 7 a 10
          </p>
          <ol className="mt-2 space-y-2">
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/15 text-[11px] font-bold text-info">
                  {index + 7}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 pb-4 text-[11px] leading-relaxed text-muted-foreground">
            Só aparecem para quem ainda não concluiu o onboarding. Marcar a
            etapa 10 conclui o onboarding do cliente e o trilho some. Cada
            frente mostra apenas os clientes com aquele serviço no cadastro.
          </p>
        </SheetContent>
      </Sheet>
    </div>
  );
}
