import { X, ChevronDown, ChevronUp, RotateCw, CheckCircle2, AlertCircle, Loader2, Upload as UploadIcon, XCircle } from "lucide-react";
import type { UploadItem } from "@/hooks/useWorkspaceUploads";
import { botao, foco, juntar, rolagem, texto, useEstadoDaTela } from "@/components/sistema";

const fmtBytes = (n: number) => {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};
const fmtEta = (s?: number) => {
  if (!s || !isFinite(s)) return "";
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

type Props = {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearDone: () => void;
};

/**
 * Janela flutuante dos envios do Workspace (fila com recuperação em
 * useWorkspaceUploads). Sistema de design: uma janela só, lista com
 * divisória, ícones com aria-label. Recolhida ou aberta fica lembrado.
 */
export function UploadProgressPanel({ items, onCancel, onRetry, onDismiss, onClearDone }: Props) {
  const [collapsed, setCollapsed] = useEstadoDaTela<boolean>("workspace:envios:recolhido", false, {
    validar: (v) => typeof v === "boolean",
  });
  if (!items.length) return null;

  const active = items.filter(i => i.status === "uploading" || i.status === "queued").length;
  const done = items.filter(i => i.status === "done").length;
  const errored = items.filter(i => i.status === "error").length;
  const totalPct = items.length
    ? items.reduce((a, x) => a + (x.status === "done" ? 100 : x.progress), 0) / items.length
    : 0;
  const titulo = active > 0
    ? `Enviando ${active} arquivo(s)`
    : errored > 0
      ? `${errored} com erro`
      : `${done} concluído(s)`;

  return (
    <div
      role="region"
      aria-label="Envios"
      className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card shadow-xl
        left-2 right-2 w-auto bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]
        sm:left-auto sm:right-4 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:bottom-4"
    >
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        className={juntar("flex w-full min-w-0 items-center border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/50", foco)}
      >
        <UploadIcon className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.tituloSecao, "block truncate text-[13px]")}>{titulo}</span>
          {active > 0 && (
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full bg-primary transition-all" style={{ width: `${totalPct}%` }} />
            </span>
          )}
        </span>
        {collapsed
          ? <ChevronUp className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          : <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="sr-only">{collapsed ? "Mostrar envios" : "Recolher envios"}</span>
      </button>

      {!collapsed && (
        <>
          <ul className={juntar(rolagem.janela, "max-h-[45vh] divide-y divide-border sm:max-h-[320px]")}>
            {items.map(item => (
              <li key={item.id} className="px-3 py-2.5">
                <div className="flex min-w-0 items-start">
                  <StatusIcon status={item.status} />
                  <div className="ml-2 min-w-0 flex-1">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>{item.name}</p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={juntar(
                          "h-full transition-all",
                          item.status === "error" ? "bg-destructive" :
                          item.status === "done" ? "bg-primary" :
                          item.status === "canceled" ? "bg-muted-foreground" : "bg-primary/80",
                        )}
                        style={{ width: `${item.status === "done" ? 100 : item.progress}%` }}
                      />
                    </div>
                    <p className={juntar(texto.auxiliar, "mt-1 truncate text-[11px] tabular-nums")}>
                      {fmtBytes(item.size)}
                      {item.status === "uploading" && (
                        <>
                          {` · ${item.progress.toFixed(0)}%`}
                          {item.speed ? ` · ${fmtBytes(item.speed)}/s` : ""}
                          {item.eta ? ` · ${fmtEta(item.eta)} restantes` : ""}
                        </>
                      )}
                      {item.status === "error" && <span className="text-destructive"> · {item.error}</span>}
                      {item.status === "done" && <span className="text-primary"> · Concluído</span>}
                      {item.status === "canceled" && " · Cancelado"}
                      {item.status === "queued" && " · Na fila"}
                    </p>
                  </div>
                  <div className="ml-1 flex shrink-0 items-center">
                    {item.status === "error" && (
                      <button
                        type="button"
                        onClick={() => onRetry(item.id)}
                        title="Tentar de novo"
                        aria-label={`Tentar de novo: ${item.name}`}
                        className={juntar(botao.icone, "h-7 w-7")}
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                    {(item.status === "uploading" || item.status === "queued") && item.cancelable ? (
                      <button
                        type="button"
                        onClick={() => onCancel(item.id)}
                        title="Cancelar"
                        aria-label={`Cancelar envio: ${item.name}`}
                        className={juntar(botao.icone, "h-7 w-7 hover:text-destructive")}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : item.status !== "uploading" && item.status !== "queued" ? (
                      <button
                        type="button"
                        onClick={() => onDismiss(item.id)}
                        title="Remover"
                        aria-label={`Remover da lista: ${item.name}`}
                        className={juntar(botao.icone, "h-7 w-7")}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {(done > 0 || errored > 0) && active === 0 && (
            <div className="flex justify-end border-t border-border px-2 py-1.5">
              <button type="button" onClick={onClearDone} className={juntar(botao.discreto, "h-8 text-[12px]")}>
                Limpar concluídos
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "done") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Concluído" />;
  if (status === "error") return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Erro" />;
  if (status === "canceled") return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Cancelado" />;
  if (status === "uploading") return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-label="Enviando" />;
  return <UploadIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Na fila" />;
}
