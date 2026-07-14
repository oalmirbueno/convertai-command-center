import { useState } from "react";
import { cn } from "@/lib/utils";
import { X, ChevronDown, ChevronUp, RotateCw, CheckCircle2, AlertCircle, Loader2, Upload as UploadIcon, XCircle } from "lucide-react";
import type { UploadItem } from "@/hooks/useWorkspaceUploads";

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

export function UploadProgressPanel({ items, onCancel, onRetry, onDismiss, onClearDone }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;

  const active = items.filter(i => i.status === "uploading" || i.status === "queued").length;
  const done = items.filter(i => i.status === "done").length;
  const errored = items.filter(i => i.status === "error").length;
  const totalPct = items.length
    ? items.reduce((a, x) => a + (x.status === "done" ? 100 : x.progress), 0) / items.length
    : 0;

  return (
    <div
      className="fixed z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-fade-in
        left-2 right-2 w-auto bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]
        sm:left-auto sm:right-4 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:bottom-4"
    >


      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/40 text-left"
      >
        <UploadIcon className="w-4 h-4 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate">
            {active > 0 ? `Enviando ${active} arquivo(s)` : errored > 0 ? `${errored} com erro` : `${done} concluído(s)`}
          </p>
          {active > 0 && (
            <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${totalPct}%` }} />
            </div>
          )}
        </div>
        {collapsed ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <>
          <ul className="max-h-[45vh] sm:max-h-[320px] overflow-y-auto overscroll-contain divide-y divide-border">
            {items.map(item => (
              <li key={item.id} className="px-3 py-2.5 hover:bg-secondary/30">
                <div className="flex items-start gap-2">
                  <StatusIcon status={item.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{item.name}</p>
                    <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all",
                          item.status === "error" ? "bg-destructive" :
                          item.status === "done" ? "bg-primary" :
                          item.status === "canceled" ? "bg-muted-foreground" : "bg-primary/80"
                        )}
                        style={{ width: `${item.status === "done" ? 100 : item.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                      <span>{fmtBytes(item.size)}</span>
                      {item.status === "uploading" && (
                        <>
                          <span>· {item.progress.toFixed(0)}%</span>
                          {item.speed ? <span>· {fmtBytes(item.speed)}/s</span> : null}
                          {item.eta ? <span>· {fmtEta(item.eta)} restantes</span> : null}
                        </>
                      )}
                      {item.status === "error" && <span className="text-destructive truncate">· {item.error}</span>}
                      {item.status === "done" && <span className="text-primary">· Concluído</span>}
                      {item.status === "canceled" && <span>· Cancelado</span>}
                      {item.status === "queued" && <span>· Na fila</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === "error" && (
                      <button onClick={() => onRetry(item.id)} title="Tentar novamente"
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(item.status === "uploading" || item.status === "queued") ? (
                      <button onClick={() => onCancel(item.id)} title="Cancelar"
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => onDismiss(item.id)} title="Remover"
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {(done > 0 || errored > 0) && active === 0 && (
            <div className="p-2 border-t border-border flex justify-end">
              <button onClick={onClearDone}
                className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded">
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
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />;
  if (status === "error") return <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />;
  if (status === "canceled") return <XCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />;
  if (status === "uploading") return <Loader2 className="w-4 h-4 text-primary shrink-0 mt-0.5 animate-spin" />;
  return <UploadIcon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />;
}
