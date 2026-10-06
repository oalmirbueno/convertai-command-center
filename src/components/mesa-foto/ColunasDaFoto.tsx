import type { ReactNode } from "react";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";

/** Cada coluna rola na área disponível; a faixa de versões continua acessível. */
export default function ColunasDaFoto({ children, rodape }: { children: ReactNode; rodape?: ReactNode }) {
  const { ref, altura } = useAlturaQueCabe(true);
  return <div ref={ref} style={altura ? { height: altura } : undefined} className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-hidden" data-colunas-da-foto="">
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:overflow-hidden">{children}</div>
    {rodape && <div className="min-h-0 shrink-0 overflow-y-auto lg:max-h-52">{rodape}</div>}
  </div>;
}
