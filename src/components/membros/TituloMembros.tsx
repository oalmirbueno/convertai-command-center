import type { ReactNode } from "react";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";

export default function TituloMembros({
  titulo,
  children,
  acoes,
  icone,
  principal = false,
}: {
  titulo: string;
  children?: ReactNode;
  acoes?: ReactNode;
  icone?: ReactNode;
  principal?: boolean;
}) {
  return (
    <CabecalhoDePagina
      className="membros-titulo"
      nivel={principal ? 1 : 2}
      titulo={
        icone ? (
          <span className="inline-flex items-center gap-2">
            {icone}
            {titulo}
          </span>
        ) : (
          titulo
        )
      }
      ajuda={children}
      acoes={acoes}
    />
  );
}
