import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import { juntar } from "@/components/sistema";
import type { VozDoChat } from "@/lib/voz/useGravadorDeVoz";

/**
 * Peças de voz para qualquer chat de agente (09/10/2026), em cima do
 * useGravadorDeVoz:
 * - BotaoDeVoz: o microfone do campo;
 * - PilulaDeGravacao: a faixa enquanto grava (tempo, aviso do teto, Cancelar, Parar);
 * - EstadoDaVoz: "Transcrevendo…" ou o erro com Tentar de novo e Descartar.
 * Nada aqui envia mensagem: o texto vai para quem usa, pelo aoTranscrever.
 */

export const tempoDaVoz = (s: number) => {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Gravando, pedindo o microfone ou fechando o áudio: a faixa ocupa o lugar do campo. */
export const vozEmCurso = (v: Pick<VozDoChat, "estado">) => v.estado === "pedindo_permissao" || v.estado === "gravando" || v.estado === "finalizando";

export function BotaoDeVoz({ voz, desabilitado, className }: { voz: VozDoChat; desabilitado?: boolean; className?: string }) {
  if (!voz.possivel) return null;
  const ocupada = voz.estado === "pedindo_permissao" || voz.estado === "finalizando" || voz.estado === "transcrevendo";
  return (
    <button
      type="button"
      onClick={() => voz.comecar()}
      disabled={desabilitado || ocupada || voz.estado === "gravando"}
      className={juntar("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40", className)}
      aria-label="Gravar áudio"
      title="Gravar áudio (o texto vem para o campo antes de enviar)"
    >
      {ocupada ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}

export function PilulaDeGravacao({ voz, className }: { voz: VozDoChat; className?: string }) {
  if (!vozEmCurso(voz)) return null;
  const rotulo = voz.estado === "pedindo_permissao" ? "Liberando o microfone…" : voz.estado === "finalizando" ? `Fechando o áudio ${tempoDaVoz(voz.segundos)}` : `Gravando ${tempoDaVoz(voz.segundos)}`;
  return (
    <div className={juntar("flex items-center gap-2 rounded-[26px] border border-destructive/40 bg-background py-1.5 pl-4 pr-1.5 shadow-sm", className)} role="group" aria-label="Gravação de áudio">
      <span className={juntar("h-2.5 w-2.5 shrink-0 rounded-full", voz.estado === "gravando" ? "animate-pulse bg-destructive" : "bg-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[14px] tabular-nums text-foreground" aria-live="polite">
        {rotulo}
        {voz.estado === "gravando" && voz.perto_do_teto && (
          <span className="ml-2 text-[12px] font-medium text-warning">Para em {tempoDaVoz(voz.restante)}</span>
        )}
      </span>
      <button type="button" onClick={() => voz.cancelar()} className="flex h-9 items-center rounded-full px-3 text-[13px] text-muted-foreground hover:bg-muted" aria-label="Cancelar a gravação">
        Cancelar
      </button>
      <button
        type="button"
        onClick={() => voz.parar()}
        disabled={voz.estado !== "gravando"}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        aria-label="Parar e transcrever"
        title="Parar e transcrever (o texto vem para o campo)"
      >
        {voz.estado === "gravando" ? <Square className="h-3.5 w-3.5 fill-current" /> : <Loader2 className="h-4 w-4 animate-spin" />}
      </button>
    </div>
  );
}

/** Transcrevendo ou com erro (o áudio que falhou fica guardado para tentar de novo). */
export function EstadoDaVoz({ voz, className }: { voz: VozDoChat; className?: string }) {
  if (voz.estado === "transcrevendo") {
    return (
      <div className={juntar("inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] text-primary", className)} role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />Transcrevendo o áudio{voz.segundos ? ` de ${tempoDaVoz(voz.segundos)}` : ""}…
        <button type="button" onClick={() => voz.cancelar()} className="ml-1 rounded-full px-1.5 hover:bg-primary/10" aria-label="Cancelar a transcrição">Cancelar</button>
      </div>
    );
  }
  if (voz.estado !== "erro" || !voz.erro) return null;
  return (
    <div className={juntar("flex flex-wrap items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-1.5 text-[12px] text-warning", className)} role="alert">
      <span className="min-w-0 flex-1">{voz.erro}{voz.audio_guardado ? " O áudio continua guardado." : ""}</span>
      {voz.audio_guardado && (
        <button type="button" onClick={() => voz.tentarDeNovo()} className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 font-medium text-foreground hover:bg-muted">
          <RotateCcw className="h-3 w-3" />Tentar transcrever de novo
        </button>
      )}
      <button type="button" onClick={() => voz.descartar()} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground hover:bg-muted" aria-label={voz.audio_guardado ? "Descartar o áudio" : "Fechar o aviso"}>
        <X className="h-3 w-3" />{voz.audio_guardado ? "Descartar" : "Fechar"}
      </button>
    </div>
  );
}

export default BotaoDeVoz;
