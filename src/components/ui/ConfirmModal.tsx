import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export default function ConfirmModal({ open, title, description, confirmLabel = "Excluir", onConfirm, onCancel }: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => !loading && onCancel()}>
      <div className="bg-card border border-border rounded-xl p-6 w-[340px] space-y-4 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <div className="flex gap-2 justify-end">
          <button disabled={loading} onClick={onCancel}
            className="px-4 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground bg-transparent cursor-pointer transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button disabled={loading} onClick={handleConfirm}
            className="px-4 py-2 text-xs rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 cursor-pointer transition-opacity disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            {loading ? "Processando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
