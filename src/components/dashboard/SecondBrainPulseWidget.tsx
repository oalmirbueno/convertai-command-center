import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Brain, GitCommit, Inbox, RefreshCw, Radio } from "lucide-react";
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

async function fetchPulse(): Promise<PulseResponse> {
  const { data, error } = await supabase.functions.invoke("second-brain-pulse", {
    method: "GET",
  });
  if (error) throw error;
  return data as PulseResponse;
}

function relTime(iso?: string): string {
  if (!iso) return "—";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR }); }
  catch { return "—"; }
}

export default function SecondBrainPulseWidget() {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["second-brain-pulse"],
    queryFn: fetchPulse,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <p className="label-sm">Segundo Cérebro — Pulse</p>
          {data?.configured && (
            <span className="flex items-center gap-1 text-[10px] text-success font-mono">
              <Radio className="w-3 h-3 animate-pulse" />
              ao vivo
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 px-2 text-[11px]"
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Sincronizando…</p>}

      {error && (
        <p className="text-xs text-destructive">
          Falha ao consultar o bridge: {(error as Error).message}
        </p>
      )}

      {data && !data.configured && (
        <p className="text-xs text-muted-foreground">
          Bridge não configurado. Defina os segredos <code className="font-mono">SECOND_BRAIN_GITHUB_*</code>.
        </p>
      )}

      {data?.configured && data.pulse && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* HEAD */}
          <div className="border border-border/60 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">HEAD</p>
            {data.pulse.head ? (
              <>
                <p className="font-mono text-sm text-foreground">{data.pulse.head.short}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{data.pulse.head.message}</p>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {data.pulse.head.author ?? "—"} · {relTime(data.pulse.head.committed_at)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  branch <span className="font-mono">{data.pulse.branch}</span> · {data.pulse.latency_ms}ms {data.pulse.cached ? "· cache" : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Sem commits.</p>
            )}
          </div>

          {/* Recent commits */}
          <div className="border border-border/60 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <GitCommit className="w-3 h-3" /> Commits recentes
            </p>
            <div className="space-y-1.5 max-h-40 overflow-auto pr-1">
              {data.commits.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
              {data.commits.map((c) => (
                <a
                  key={c.sha}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs hover:bg-muted/40 rounded px-1.5 py-1 transition-colors"
                >
                  <span className="font-mono text-primary/80">{c.short}</span>{" "}
                  <span className="text-foreground line-clamp-1">{c.message}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {c.author ?? "—"} · {relTime(c.committed_at)}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Inbox */}
          <div className="border border-border/60 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Inbox className="w-3 h-3" /> Inbox pendente
              <span className="ml-auto font-mono text-foreground">{data.pulse.inbox_pending}</span>
            </p>
            <div className="space-y-1 max-h-40 overflow-auto pr-1">
              {data.inbox.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma proposta aguardando.</p>}
              {data.inbox.map((i) => (
                <p key={i.sha} className="text-[11px] font-mono text-muted-foreground truncate">
                  {i.path.split("/").slice(-1)[0]}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground mt-3">
          Atualizado {relTime(data.fetched_at)}
        </p>
      )}
    </div>
  );
}
