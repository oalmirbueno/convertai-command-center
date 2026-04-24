import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import ProjectView from "@/components/client/ProjectView";
import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";
import { AIFirstScoreCard, type AIFirstStatus } from "@/components/client/AIFirstScoreCard";
import { BeforeAfterPanel, type BeforeAfterMetric } from "@/components/client/BeforeAfterPanel";
import { JourneyProgress } from "@/components/client/JourneyProgress";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Sparkles, CloudOff } from "lucide-react";

interface ClientDashboardProps {
  /** When set, renders as if viewing a specific client (admin impersonation) */
  impersonateClientId?: string;
  impersonateClientName?: string;
}

interface OpsMetrics {
  client?: {
    ai_first_score?: number;
    ai_first_target?: number;
    total_nodes?: number;
    ai_nodes?: number;
    automation_nodes?: number;
    ai_first_status?: AIFirstStatus;
    current_stage?: string;
    stage_index?: number;
    total_stages?: number;
    journey_progress_pct?: number;
    delivered_count?: number;
  };
  metrics?: BeforeAfterMetric[];
  improved_count?: number;
  stable_count?: number;
  error?: string;
}

export default function ClientDashboard({ impersonateClientId, impersonateClientName }: ClientDashboardProps) {
  const { profile } = useAuth();
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [opsMetrics, setOpsMetrics] = useState<OpsMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [opsError, setOpsError] = useState<string | null>(null);

  const clientId = impersonateClientId || profile?.id;
  const clientName = impersonateClientName || profile?.company_name || profile?.full_name || "";

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("fetch-ops-metrics");
        // Try to extract error body even on HTTP error responses
        let payload: any = data;
        if (error && (error as any)?.context?.json) {
          try { payload = await (error as any).context.json(); } catch { /* ignore */ }
        }
        if (payload?.error) {
          setOpsError(String(payload.error));
        } else if (payload) {
          setOpsMetrics(payload);
        } else if (error) {
          setOpsError(error.message || "Falha ao buscar métricas");
        }
      } catch (err: any) {
        console.warn("fetch-ops-metrics:", err?.message ?? err);
        setOpsError(err?.message || "Falha ao buscar métricas");
      } finally {
        setLoadingMetrics(false);
      }
    })();
  }, [clientId]);

  if (selectedProject) {
    return <ProjectView project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  // Hide entirely if profile not linked to Ops yet
  const profileNotLinked = opsError?.toLowerCase().includes("não vinculado");
  const showSection = !profileNotLinked;
  const client = opsMetrics?.client;

  return (
    <div className="space-y-10">
      {showSection && (
        <section className="space-y-6 animate-fade-in">
          <header className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">
              Sua transformação Aceleriq
            </h2>
          </header>

          {loadingMetrics ? (
            <div className="space-y-4">
              <Skeleton className="h-44 w-full rounded-2xl" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Skeleton className="h-80 rounded-2xl" />
                <Skeleton className="h-80 rounded-2xl" />
              </div>
            </div>
          ) : !client ? (
            <Card className="p-8 bg-card border-border flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-secondary/60 border border-border flex items-center justify-center mb-4">
                <CloudOff className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Dados em sincronização com a operação. Aparecerá em breve.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              <JourneyProgress
                current_stage={client.current_stage ?? "Abertura"}
                stage_index={client.stage_index ?? 0}
                total_stages={client.total_stages ?? 8}
                progress_pct={client.journey_progress_pct ?? 0}
                delivered_count={client.delivered_count ?? 0}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AIFirstScoreCard
                  score={client.ai_first_score ?? 0}
                  target={client.ai_first_target ?? 60}
                  totalNodes={client.total_nodes ?? 0}
                  aiNodes={client.ai_nodes ?? 0}
                  automationNodes={client.automation_nodes ?? 0}
                  status={client.ai_first_status ?? "below"}
                />
                <BeforeAfterPanel
                  metrics={opsMetrics?.metrics ?? []}
                  improved_count={opsMetrics?.improved_count ?? 0}
                  stable_count={opsMetrics?.stable_count ?? 0}
                />
              </div>
            </div>
          )}
        </section>
      )}

      <ClientJourneyDashboard
        clientId={clientId!}
        clientName={clientName}
        onSelectProject={setSelectedProject}
        isImpersonation={!!impersonateClientId}
      />
    </div>
  );
}
