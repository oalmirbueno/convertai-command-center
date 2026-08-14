import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, HelpCircle, ListChecks, Star } from "lucide-react";
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
          <p className="mt-2 text-[10px] text-muted-foreground">
            Cada etapa concluída vira uma estrela. {totalSteps} estrelas = semana fechada para o cliente.
          </p>
        </div>
      )}

      {/* Clientes */}
      <div className="space-y-2.5">
        {activeClients.map((client: any) => {
          const doneCount = cycle.steps.reduce(
            (sum, _step, index) =>
              sum + (doneMap.has(`${client.id}:${area}:${index + 1}`) ? 1 : 0),
            0,
          );
          const complete = doneCount === totalSteps;
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
                <p className="truncate text-sm font-semibold text-foreground">
                  {client.company_name || client.full_name}
                </p>
                <span className="flex shrink-0 items-center gap-0.5" aria-label={`${doneCount} de ${totalSteps} etapas`}>
                  {Array.from({ length: totalSteps }, (_, index) => (
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
