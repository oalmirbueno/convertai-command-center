import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, MoreHorizontal, PenLine, Undo2, Clock, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EsteiraItem, Gravidade } from "@/lib/esteira/esteiraTipos";
import { anotarNoDiario, marcarItem, textoDoItem } from "@/lib/esteira/esteiraAcoes";

const COR: Record<Gravidade, string> = {
  urgente: "bg-destructive",
  atencao: "bg-warning",
  normal: "bg-muted-foreground/50",
};

interface Props {
  item: EsteiraItem;
  weekStart: string;
  canWrite: boolean;
  onMudou: () => void;
  /** Modo compacto para o card da lista. */
  compacto?: boolean;
}

export default function EsteiraItemRow({ item, weekStart, canWrite, onMudou, compacto }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [anotando, setAnotando] = useState(false);
  const [nota, setNota] = useState("");
  const feito = item.estado?.status === "done";

  const agir = async (fn: () => Promise<boolean>, ok: string) => {
    if (!canWrite) { toast.error("Só admin ou manager marca a esteira."); return; }
    setOcupado(true);
    try {
      const r = await fn();
      if (r) { toast.success(ok); onMudou(); } else toast.error("Não foi possível gravar agora.");
    } finally { setOcupado(false); }
  };

  const bloqueado = Boolean(item.bloqueadoPor);

  return (
    <div className={`flex items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 ${feito ? "opacity-60" : ""} ${bloqueado ? "opacity-70" : ""}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${feito ? "bg-primary" : COR[item.gravidade]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-medium leading-tight text-foreground ${feito ? "line-through" : ""}`}>{item.titulo}</p>
        <p className="text-[12px] leading-snug text-muted-foreground">{item.passo}</p>
        {!compacto && item.fatos.length > 0 && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{item.fatos.join(" · ")}</p>
        )}
        {!compacto && item.estado?.note && (
          <p className="mt-0.5 text-[11px] italic text-muted-foreground/80">Obs: {item.estado.note}</p>
        )}
        {anotando && (
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Anotar no diário do cliente"
              className="min-w-0 flex-1 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50"
            />
            <button
              type="button"
              disabled={ocupado || !nota.trim()}
              onClick={() => void agir(async () => { const r = await anotarNoDiario(item, nota); if (r) { setNota(""); setAnotando(false); } return r; }, "Anotado no diário.")}
              className="rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
            >Salvar</button>
          </div>
        )}
      </div>
      {!compacto && !feito && !bloqueado && canWrite && (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void agir(() => marcarItem({ item, weekStart, status: "done" }), `Feito: ${item.titulo}`)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Feito</span>
        </button>
      )}
      {!compacto && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mais ações" className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {item.rota && (
              <DropdownMenuItem asChild>
                <Link to={item.rota} className="flex items-center gap-2"><ExternalLink className="h-4 w-4" />Abrir onde se resolve</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => { void navigator.clipboard?.writeText(textoDoItem(item)); toast.success("Copiado."); }} className="flex items-center gap-2">
              <Copy className="h-4 w-4" />Copiar texto
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAnotando((v) => !v)} className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />Anotar no diário
            </DropdownMenuItem>
            {canWrite && <DropdownMenuSeparator />}
            {canWrite && !feito && (
              <DropdownMenuItem onClick={() => void agir(() => marcarItem({ item, weekStart, status: "snoozed" }), "Adiado para a próxima semana.")} className="flex items-center gap-2">
                <Clock className="h-4 w-4" />Adiar para a próxima semana
              </DropdownMenuItem>
            )}
            {canWrite && !feito && (
              <DropdownMenuItem
                onClick={() => {
                  const motivo = window.prompt("Motivo para ignorar (fica no diário):") ?? "";
                  if (!motivo.trim()) return;
                  void agir(() => marcarItem({ item, weekStart, status: "ignored", note: motivo }), "Ignorado, com motivo no diário.");
                }}
                className="flex items-center gap-2"
              >
                <EyeOff className="h-4 w-4" />Ignorar (com motivo)
              </DropdownMenuItem>
            )}
            {canWrite && item.estado && (
              <DropdownMenuItem onClick={() => void agir(() => marcarItem({ item, weekStart, status: undefined }), "Marcação desfeita.")} className="flex items-center gap-2">
                <Undo2 className="h-4 w-4" />Desfazer marcação
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
