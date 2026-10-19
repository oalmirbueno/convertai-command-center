import { Check, Circle, Loader2, X } from "lucide-react";
import { juntar, texto } from "@/components/sistema/estilos";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { type EventoDaFase, fasesDoTrabalho, TIPOS_COM_FASES } from "../../../supabase/functions/mesa-site/modulos/obra-do-site";

/**
 * As fases do trabalho do motor à vista (Gravyx, 19/10/2026): entendendo o
 * pedido, escrevendo, compilando, conferindo, pronto. Lidas dos eventos do
 * motor-codigo (o worker marca a fase); sem eventos, pelo estado. Uma linha
 * que quebra no celular (sem rolagem para o lado), sem caixa.
 */
export default function FasesDoTrabalho({ trabalho, eventos }: { trabalho: Pick<TrabalhoDoMotor, "tipo" | "estado">; eventos: EventoDaFase[] }) {
  if (TIPOS_COM_FASES.indexOf(trabalho.tipo) < 0) return null;
  const f = fasesDoTrabalho(trabalho, eventos);
  return (
    <ol className="flex min-w-0 flex-wrap items-center" aria-label="Fases do trabalho" data-fases-do-trabalho={f.naFila ? "na_fila" : f.atual}>
      {f.naFila && <li className={juntar(texto.etiqueta, "mr-3 py-0.5 text-muted-foreground")}>Na fila</li>}
      {f.passos.map((p) => (
        <li
          key={p.id}
          className={juntar(
            texto.etiqueta,
            "mr-3 flex items-center py-0.5",
            p.estado === "agora" ? "text-primary" : p.estado === "feita" ? "text-foreground" : p.estado === "parou" ? "text-destructive" : "text-muted-foreground",
          )}
          data-fase={p.id}
          data-estado={p.estado}
          aria-current={p.estado === "agora" ? "step" : undefined}
        >
          {p.estado === "feita" ? (
            <Check className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : p.estado === "agora" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : p.estado === "parou" ? (
            <X className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Circle className="mr-1 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          )}
          {p.rotulo}
        </li>
      ))}
    </ol>
  );
}
