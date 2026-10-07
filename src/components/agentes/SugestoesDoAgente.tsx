import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Sugestões são opcionais; o campo e o envio continuam sempre visíveis. */
export default function SugestoesDoAgente({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0" data-sugestoes-do-agente="">
      <button type="button" aria-expanded={aberto} aria-controls={id}
        onClick={() => setAberto(v => !v)}
        className="flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform ${aberto ? "rotate-180" : ""}`} />
        {aberto ? "Recolher sugestões" : "Sugestões"}
      </button>
      {aberto && <div id={id} className="max-h-40 overflow-y-auto overscroll-contain pt-1">{children}</div>}
    </div>
  );
}
