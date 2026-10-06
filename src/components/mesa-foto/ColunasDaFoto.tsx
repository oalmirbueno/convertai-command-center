import type { ReactNode } from "react";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import "./espacoDaFoto.css";

/** Cada coluna rola na área disponível; a faixa de versões continua acessível. */
export default function ColunasDaFoto({ children, rodape, foco }: { children: ReactNode; rodape?: ReactNode; foco?: string }) {
  const { ref, altura } = useAlturaQueCabe(true);
  return <div ref={ref} style={altura ? { height: altura } : undefined} className="foto-area flex min-h-0 flex-col gap-3 lg:overflow-hidden" data-colunas-da-foto="">
    <div className="foto-colunas" data-foco={foco}>{children}</div>
    {rodape && <div className="foto-rodape">{rodape}</div>}
  </div>;
}
