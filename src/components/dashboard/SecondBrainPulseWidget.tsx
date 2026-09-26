import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { GitCommit, Inbox, RefreshCw } from "lucide-react";
import { EstadoDeErro, Secao, botao, juntar, superficie, texto } from "@/components/sistema";
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
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["second-brain-pulse"],
    queryFn: fetchPulse,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  // O ícone só gira quando a pessoa pede: a releitura de 15 em 15 s acontece
  // quieta (tela parada = nada se mexe).
  const [atualizando, setAtualizando] = useState(false);
  const atualizar = () => {
    setAtualizando(true);
    void refetch().finally(() => setAtualizando(false));
  };
  const horario = data?.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  const commits = data?.commits || [];
  const inbox = data?.inbox || [];

  return (
    <Secao
      titulo="Segundo Cérebro"
      ajuda="O que entrou no repositório de memória: último registro, commits recentes e propostas esperando revisão. Atualiza sozinho a cada 15 segundos."
      descricao={data?.configured && data.pulse ? `${data.pulse.inbox_pending} ${data.pulse.inbox_pending === 1 ? "proposta" : "propostas"} na inbox` : undefined}
      acao={
        <button
          type="button"
          onClick={atualizar}
          disabled={atualizando}
          className={botao.icone}
          aria-label="Atualizar Segundo Cérebro"
          title={horario ? `Lido às ${horario}` : "Atualizar"}
        >
          <RefreshCw className={juntar("h-4 w-4", atualizando && "animate-spin motion-reduce:animate-none")} />
        </button>
      }
    >
      {isLoading && <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Carregando Segundo Cérebro" />}

      {error && !data && (
        <EstadoDeErro
          titulo="Não foi possível ler o Segundo Cérebro."
          descricao={(error as Error).message}
          acao={<button type="button" onClick={atualizar} className={botao.discreto}>Tentar de novo</button>}
        />
      )}

      {data && !data.configured && (
        <p className={texto.auxiliar}>
          Bridge não configurado. Defina os segredos <code className="font-mono">SECOND_BRAIN_GITHUB_*</code>.
        </p>
      )}

      {data?.configured && data.error === "bridge_unavailable" && (
        <p className={juntar(texto.auxiliar, "leading-5")}>Segundo Cérebro indisponível agora. O painel tenta de novo sozinho.</p>
      )}

      {data?.configured && data.pulse && (
        <div className={juntar(superficie.painel, "divide-y divide-border")}>
          <div className="px-4 py-3">
            <p className={juntar(texto.rotulo, "mb-1")}>Último registro</p>
            {data.pulse.head ? (
              <>
                <p className="truncate text-[13px] text-foreground" title={data.pulse.head.message}>
                  <span className="mr-1.5 font-mono text-primary/80">{data.pulse.head.short}</span>
                  {data.pulse.head.message}
                </p>
                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                  {data.pulse.head.author ?? "-"} · {relTime(data.pulse.head.committed_at)} · <span className="font-mono">{data.pulse.branch}</span>
                </p>
              </>
            ) : (
              <p className={texto.auxiliar}>Sem commits.</p>
            )}
          </div>

          <div className="px-4 py-3">
            <p className={juntar(texto.rotulo, "mb-1 flex items-center")}>
              <GitCommit className="mr-1 h-3 w-3" aria-hidden="true" /> Commits recentes
            </p>
            {commits.length === 0 ? (
              <p className={texto.auxiliar}>Nenhum.</p>
            ) : (
              <ul className="-mx-1.5">
                {commits.slice(0, 5).map((c) => (
                  <li key={c.sha}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded px-1.5 py-1 text-[12px] transition-colors hover:bg-muted/60"
                      title={c.message}
                    >
                      <span className="block truncate">
                        <span className="mr-1.5 font-mono text-primary/80">{c.short}</span>
                        <span className="text-foreground">{c.message}</span>
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.author ?? "-"} · {relTime(c.committed_at)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {commits.length > 5 && <p className={juntar(texto.auxiliar, "mt-1")}>e mais {commits.length - 5}</p>}
          </div>

          <div className="px-4 py-3">
            <p className={juntar(texto.rotulo, "mb-1 flex items-center")}>
              <Inbox className="mr-1 h-3 w-3" aria-hidden="true" /> Inbox pendente
              <span className="ml-auto tabular-nums text-foreground">{data.pulse.inbox_pending}</span>
            </p>
            {inbox.length === 0 ? (
              <p className={texto.auxiliar}>Nenhuma proposta aguardando.</p>
            ) : (
              <ul>
                {inbox.slice(0, 5).map((i) => (
                  <li key={i.sha} className="truncate font-mono text-[11px] text-muted-foreground" title={i.path}>
                    {i.path.split("/").slice(-1)[0]}
                  </li>
                ))}
              </ul>
            )}
            {inbox.length > 5 && <p className={juntar(texto.auxiliar, "mt-1")}>e mais {inbox.length - 5}</p>}
          </div>
        </div>
      )}
    </Secao>
  );
}
