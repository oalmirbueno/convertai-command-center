import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, GitCommit, Inbox, RefreshCw } from "lucide-react";
import { Card, StatusPill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PulseResponse {
  configured: boolean;
  pulse: {
    branch: string | null;
    head: { short: string; message: string; author: string | null; committed_at: string } | null;
    inbox_pending: number;
    latency_ms: number;
    fetched_at: string;
    cached: boolean;
  } | null;
  commits: Array<{ sha: string; short: string; message: string; author: string | null; committed_at: string; url: string }>;
  inbox: Array<{ path: string; sha: string; size: number }>;
  fetched_at: string;
  error?: string;
  detail?: unknown;
}

function softBridgeFallback(detail?: unknown): PulseResponse {
  return {
    configured: true,
    pulse: null,
    commits: [],
    inbox: [],
    fetched_at: new Date().toISOString(),
    error: "bridge_unavailable",
    detail,
  };
}

async function fetchPulse(): Promise<PulseResponse> {
  const { data, error } = await supabase.functions.invoke("second-brain-pulse", {
    method: "GET",
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const details = await error.context.clone().json();
        const status = Number(details?.detail?.status ?? details?.status ?? 0);
        const isBridgeUpstreamError = details?.error === "bridge_error" && status >= 500;
        if (isBridgeUpstreamError) return softBridgeFallback(details.detail);
      } catch {
        const status = Number(error.context?.status ?? 0);
        if (status >= 500) return softBridgeFallback({ kind: "upstream", status });
      }
    }
    throw error;
  }
  return data as PulseResponse;
}

function relTime(iso?: string): string {
  if (!iso) return "-";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR }); }
  catch { return "-"; }
}

export default function SecondBrainPulseWidget() {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["second-brain-pulse"],
    queryFn: fetchPulse,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const poco = "min-w-0 rounded-md bg-muted/60 p-4 sm:p-5";
  const rotulo = "mb-3 flex items-center text-[12px] font-medium text-muted-foreground";

  return (
    <Card
      title="Segundo Cérebro"
      collapsible="dashboard:segundo-cerebro"
      subtitle={
        data && !data.configured ? (
          "Bridge não configurado"
        ) : data ? (
          <span className="inline-flex items-center">
            {data.configured && <StatusPill tone="success" pulse className="mr-2">ao vivo</StatusPill>}
            Atualizado {relTime(data.fetched_at)}
          </span>
        ) : undefined
      }
      action={
        <Button size="icon" variant="ghost" onClick={() => refetch()} disabled={isFetching} aria-label="Atualizar" title="Atualizar" className="h-9 w-9 rounded-full">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      {isLoading && <p className="text-[12px] text-muted-foreground">Sincronizando…</p>}

      {error && (
        <p className="text-[12px] text-destructive">
          Falha ao consultar o bridge: {(error as Error).message}
        </p>
      )}

      {data && !data.configured && (
        <p className="text-[12px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
          Defina os segredos <code className="font-mono">SECOND_BRAIN_GITHUB_*</code>.
        </p>
      )}

      {data?.configured && data.error === "bridge_unavailable" && (
        <div className={`${poco} flex items-start text-[12px] text-muted-foreground`}>
          <AlertCircle className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div>
            <p className="text-foreground">Segundo Cérebro temporariamente indisponível.</p>
            <p className="mt-0.5">O painel continua ativo e tentará sincronizar novamente automaticamente.</p>
          </div>
        </div>
      )}

      {data?.configured && data.pulse && (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
          {/* HEAD */}
          <div className={poco}>
            <p className={rotulo}>HEAD</p>
            {data.pulse.head ? (
              <>
                <p className="font-mono text-[24px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{data.pulse.head.short}</p>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-foreground">{data.pulse.head.message}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {data.pulse.head.author ?? "-"} · {relTime(data.pulse.head.committed_at)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  branch <span className="font-mono">{data.pulse.branch}</span> · {data.pulse.latency_ms}ms {data.pulse.cached ? "· cache" : ""}
                </p>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Sem commits.</p>
            )}
          </div>

          {/* Recent commits */}
          <div className={poco}>
            <p className={rotulo}>
              <GitCommit className="mr-1.5 h-3 w-3" /> Commits recentes
            </p>
            <div className="space-y-1 pr-1 lg:max-h-40 lg:overflow-auto">
              {data.commits.length === 0 && <p className="text-[12px] text-muted-foreground">-</p>}
              {data.commits.map((c) => (
                <a
                  key={c.sha}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-sm px-2 py-1.5 text-[12px] leading-[18px] transition-colors hover:bg-card"
                >
                  <span className="font-mono text-muted-foreground">{c.short}</span>{" "}
                  <span className="text-foreground line-clamp-1">{c.message}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {c.author ?? "-"} · {relTime(c.committed_at)}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Inbox */}
          <div className={poco}>
            <p className={rotulo}>
              <Inbox className="mr-1.5 h-3 w-3" /> Inbox pendente
            </p>
            <p className="mb-2 text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">{data.pulse.inbox_pending}</p>
            <div className="space-y-1 pr-1 lg:max-h-40 lg:overflow-auto">
              {data.inbox.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhuma proposta aguardando.</p>}
              {data.inbox.map((i) => (
                <p key={i.sha} className="truncate font-mono text-[11px] text-muted-foreground">
                  {i.path.split("/").slice(-1)[0]}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
