import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import {
  collectSocialMetricsNow,
  formatMetricNumber,
  useSocialMetricsWeekly,
  weekDeltaPct,
  type SocialMetricsWeek,
} from "@/hooks/useSocialMetrics";

const fmtWeek = (row: SocialMetricsWeek) => {
  const d = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  return `${d(row.week_start)} a ${d(row.week_end)}`;
};

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {`${up ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}

export default function AdminMetricas() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const { data: rows, isLoading } = useSocialMetricsWeekly();
  const queryClient = useQueryClient();
  const [collecting, setCollecting] = useState(false);

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of (clients || []) as any[]) {
      map.set(String(client.id), client.company_name || client.full_name || "Cliente");
    }
    return map;
  }, [clients]);

  const byClient = useMemo(() => {
    const map = new Map<string, SocialMetricsWeek[]>();
    for (const row of rows || []) {
      const list = map.get(row.client_id) || [];
      list.push(row);
      map.set(row.client_id, list);
    }
    // Dentro de cada cliente já vem ordenado da semana mais nova para a antiga.
    return [...map.entries()].sort((a, b) =>
      (clientNames.get(a[0]) || "").localeCompare(clientNames.get(b[0]) || "", "pt-BR"),
    );
  }, [rows, clientNames]);

  const refreshNow = async () => {
    setCollecting(true);
    try {
      const result = await collectSocialMetricsNow();
      toast.success(
        result.dispatched > 0
          ? `Coleta disparada para a Meta (${result.dispatched} chamadas). Os números chegam em alguns minutos.`
          : "Tudo em dia: a última semana fechada já está coletada.",
      );
      await queryClient.invalidateQueries({ queryKey: ["social-metrics-weekly"] });
    } catch (error: unknown) {
      toast.error(
        (error as { message?: string })?.message || "Não foi possível atualizar agora.",
      );
    } finally {
      setCollecting(false);
    }
  };

  if (!isStaff) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Esta área é da equipe.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <BarChart3 className="h-5 w-5 text-primary" />
            Métricas · Instagram real
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Números coletados direto da Meta, toda semana fechada (segunda a
            domingo), pelas contas conectadas no painel. O cliente vê os dele em
            Onde Estamos; aqui a equipe vê todos.
          </p>
        </div>
        <Button size="sm" onClick={refreshNow} disabled={collecting} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${collecting ? "animate-spin" : ""}`} />
          {collecting ? "Atualizando..." : "Atualizar agora"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando métricas...</p>
      ) : byClient.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma métrica coletada ainda. Clique em "Atualizar agora": a coleta
          é disparada para todas as contas Instagram conectadas e os números da
          última semana fechada chegam em alguns minutos. Depois disso, o robô
          coleta sozinho toda semana.
        </div>
      ) : (
        byClient.map(([clientId, list]) => {
          const latest = list[0];
          const maxReach = Math.max(...list.map((row) => row.reach || 0), 1);
          return (
            <div key={clientId} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link
                    to={`/clientes?client=${clientId}`}
                    className="text-sm font-semibold text-foreground hover:text-primary"
                  >
                    {clientNames.get(clientId) || "Cliente"}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    Última semana coletada: {fmtWeek(latest)}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {[
                  { label: "Seguidores", value: latest.followers, delta: weekDeltaPct(list, "followers") },
                  { label: "Alcance na semana", value: latest.reach, delta: weekDeltaPct(list, "reach") },
                  { label: "Interações", value: latest.total_interactions, delta: weekDeltaPct(list, "total_interactions") },
                  { label: "Visitas ao perfil", value: latest.profile_views, delta: weekDeltaPct(list, "profile_views") },
                  { label: "Contas engajadas", value: latest.accounts_engaged, delta: weekDeltaPct(list, "accounts_engaged") },
                  { label: "Publicações no perfil", value: latest.media_count, delta: null },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border bg-secondary/25 p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {item.label}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <p className="font-mono text-sm font-semibold text-foreground">
                        {formatMetricNumber(item.value)}
                      </p>
                      <DeltaBadge pct={item.delta} />
                    </div>
                  </div>
                ))}
              </div>

              {list.length > 1 && (
                <div className="mt-4">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Histórico semanal (alcance)
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {list.slice(0, 12).map((row) => (
                      <div key={row.id} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                          {fmtWeek(row)}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-[10px] text-foreground">
                          {formatMetricNumber(row.reach)}
                        </span>
                        <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground sm:block">
                          {formatMetricNumber(row.followers)} seg.
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
