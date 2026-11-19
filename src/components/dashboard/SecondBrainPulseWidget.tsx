import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { AlertCircle, GitCommit, Inbox, RefreshCw } from "lucide-react";
import { Card, StatusPill } from "@/components/ds";
import { Button } from "@/components/ui/button";

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

const ha = (iso?: string) => { const c = curto(iso); return c === "agora" || c === "-" || c.includes("/") ? c : `há ${c}`; };

/** Tempo curto para linhas estreitas: "agora", "12 min", "3 h", "2 d", depois "15/11". */
function curto(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso); const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "-";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`;
  if (min < 60 * 24 * 7) return `${Math.floor(min / 1440)} d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Nome da proposta sem a data do começo (a data vira um rótulo curto ao lado). */
function nomeDaProposta(caminho: string): { nome: string; data: string | null } {
  const arquivo = caminho.split("/").slice(-1)[0].replace(/\.md$/i, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})[-_T ]?(.*)$/.exec(arquivo);
  if (!m) return { nome: arquivo, data: null };
  return { nome: (m[4] || arquivo).replace(/[-_]+/g, " ").trim() || arquivo, data: `${m[3]}/${m[2]}` };
}

export default function SecondBrainPulseWidget() {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["second-brain-pulse"],
    queryFn: fetchPulse,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  const [todosCommits, setTodosCommits] = useState(false);
  const [todasPropostas, setTodasPropostas] = useState(false);

  const poco = "min-w-0 rounded-2xl bg-muted/60 p-4";
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
            Atualizado {ha(data.fetched_at)}
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
          <AlertCircle className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-foreground">Segundo Cérebro temporariamente indisponível.</p>
            <p className="mt-0.5">O painel continua ativo e tentará sincronizar novamente automaticamente.</p>
          </div>
        </div>
      )}

      {data?.configured && data.pulse && (
        // Hotfix 15/11: o cartão fica na coluna estreita do Dashboard. As três partes
        // empilham em linhas quando falta largura (auto-fit) e nada rola por dentro.
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
          {/* HEAD */}
          <div className={poco}>
            <p className={rotulo}>
              <GitCommit className="mr-1.5 h-3 w-3" /> Último commit
            </p>
            {data.pulse.head ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[12px] font-semibold text-primary-foreground">{data.pulse.head.short}</span>
                  <span className="min-w-0 truncate text-[12px] text-muted-foreground">{ha(data.pulse.head.committed_at)}</span>
                </div>
                <p className="mt-2 line-clamp-2 break-words text-[13px] leading-5 text-foreground">{data.pulse.head.message}</p>
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={`${data.pulse.latency_ms}ms${data.pulse.cached ? " · cache" : ""}`}>
                  {data.pulse.head.author ?? "-"} · <span className="font-mono">{data.pulse.branch}</span>
                </p>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Sem commits.</p>
            )}
          </div>

          {/* Recent commits */}
          <div className={poco}>
            <p className={rotulo}>Commits recentes</p>
            {data.commits.length === 0 && <p className="text-[12px] text-muted-foreground">-</p>}
            <ul className="min-w-0 space-y-1">
              {(todosCommits ? data.commits : data.commits.slice(0, 3)).map((c) => (
                <li key={c.sha} className="min-w-0">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block min-w-0 rounded-lg px-2 py-1.5 text-[12px] leading-[18px] transition-colors hover:bg-card"
                  >
                    <span className="block truncate text-foreground" title={c.message}>{c.message}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{c.short}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{curto(c.committed_at)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {data.commits.length > 3 && (
              <button type="button" onClick={() => setTodosCommits((v) => !v)} className="mt-1 px-2 text-[12px] font-medium text-foreground underline-offset-2 hover:underline">
                {todosCommits ? "Ver menos" : `Ver mais ${data.commits.length - 3}`}
              </button>
            )}
          </div>

          {/* Inbox */}
          <div className={poco}>
            <p className={rotulo}>
              <Inbox className="mr-1.5 h-3 w-3" /> Inbox pendente
              <span className="ml-auto text-[20px] font-semibold leading-6 tabular-nums text-foreground">{data.pulse.inbox_pending}</span>
            </p>
            {data.inbox.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhuma proposta aguardando.</p>}
            <ul className="min-w-0 space-y-1">
              {(todasPropostas ? data.inbox : data.inbox.slice(0, 3)).map((i) => {
                const { nome, data: quando } = nomeDaProposta(i.path);
                return (
                  <li key={i.sha} className="flex min-w-0 items-center gap-2 px-2 py-1 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-foreground" title={i.path}>{nome}</span>
                    {quando && <span className="shrink-0 text-[11px] text-muted-foreground">{quando}</span>}
                  </li>
                );
              })}
            </ul>
            {data.inbox.length > 3 && (
              <button type="button" onClick={() => setTodasPropostas((v) => !v)} className="mt-1 px-2 text-[12px] font-medium text-foreground underline-offset-2 hover:underline">
                {todasPropostas ? "Ver menos" : `Ver mais ${data.inbox.length - 3}`}
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
