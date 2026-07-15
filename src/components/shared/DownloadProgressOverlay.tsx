import { useEffect, useState } from "react";
import { Download, CheckCircle2, AlertCircle } from "lucide-react";

type Item = {
  id: string;
  name: string;
  total: number;
  loaded: number;
  status: "downloading" | "done" | "error";
  message?: string;
};

export default function DownloadProgressOverlay() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const upsert = (id: string, patch: Partial<Item>) =>
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === id);
        if (idx === -1) {
          return [
            ...prev,
            { id, name: patch.name || "Arquivo", total: 0, loaded: 0, status: "downloading", ...patch } as Item,
          ];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });

    const remove = (id: string, delay = 2500) =>
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), delay);

    const onStart = (e: any) => upsert(e.detail.id, { name: e.detail.name, total: e.detail.total || 0, status: "downloading" });
    const onProgress = (e: any) => upsert(e.detail.id, { loaded: e.detail.loaded, total: e.detail.total || 0 });
    const onDone = (e: any) => { upsert(e.detail.id, { status: "done" }); remove(e.detail.id); };
    const onError = (e: any) => { upsert(e.detail.id, { status: "error", message: e.detail.message }); remove(e.detail.id, 4000); };

    window.addEventListener("file-download:start", onStart as any);
    window.addEventListener("file-download:progress", onProgress as any);
    window.addEventListener("file-download:done", onDone as any);
    window.addEventListener("file-download:error", onError as any);
    return () => {
      window.removeEventListener("file-download:start", onStart as any);
      window.removeEventListener("file-download:progress", onProgress as any);
      window.removeEventListener("file-download:done", onDone as any);
      window.removeEventListener("file-download:error", onError as any);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed z-[9999] flex flex-col gap-2 w-[min(360px,calc(100vw-24px))]"
      style={{
        right: "max(12px, env(safe-area-inset-right))",
        bottom: "max(12px, env(safe-area-inset-bottom))",
      }}
    >
      {items.map((it) => {
        const pct = it.total > 0 ? Math.min(100, Math.round((it.loaded / it.total) * 100)) : null;
        const kb = it.loaded / 1024;
        const size = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
        return (
          <div
            key={it.id}
            className="rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              {it.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : it.status === "error" ? (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <Download className="h-4 w-4 text-primary shrink-0 animate-pulse" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{it.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {it.status === "done" && "Concluído"}
                  {it.status === "error" && (it.message || "Falha no download")}
                  {it.status === "downloading" && (pct !== null ? `${pct}% • ${size}` : `Baixando... ${size}`)}
                </div>
              </div>
            </div>
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${it.status === "error" ? "bg-destructive" : "bg-primary"}`}
                style={{
                  width:
                    it.status === "done"
                      ? "100%"
                      : pct !== null
                      ? `${pct}%`
                      : "35%",
                  animation: it.status === "downloading" && pct === null ? "indeterminate 1.2s ease-in-out infinite" : undefined,
                }}
              />
            </div>
          </div>
        );
      })}
      <style>{`@keyframes indeterminate { 0%{margin-left:-35%} 100%{margin-left:100%} }`}</style>
    </div>
  );
}
