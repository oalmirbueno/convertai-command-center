import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** Segundos desde `desde` (ms), atualizado a cada segundo; null parado. */
export function useSegundos(desde: number | null): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (desde === null) return;
    setAgora(Date.now());
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [desde]);
  return desde === null ? 0 : Math.max(0, Math.floor((agora - desde) / 1000));
}

export const tempoCurto = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60 < 10 ? "0" : ""}${s % 60}s`);

/** Andamento discreto de uma ação de IA: rótulo e cronômetro, sem travar a tela. */
export function Cronometro({ desde, rotulo, previsao }: { desde: number | null; rotulo: string; previsao?: string }) {
  const s = useSegundos(desde);
  if (desde === null) return null;
  return (
    <span role="status" className="inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground">
      <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">{rotulo}</span>
      <span className="ml-1.5 shrink-0 tabular-nums">{tempoCurto(s)}{previsao ? ` de ${previsao}` : ""}</span>
    </span>
  );
}
