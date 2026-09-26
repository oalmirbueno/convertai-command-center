import type { ReactNode } from "react";
import { juntar } from "./estilos";

/**
 * Barra de ações: o que está selecionado ou o resumo à esquerda, os botões à
 * direita (um primário no máximo, e ele fica por último). No celular, com
 * `fixa`, gruda no pé da tela para o botão principal nunca sumir.
 */
export default function BarraDeAcoes({
  inicio,
  fixa = false,
  className = "",
  children,
}: {
  /** Resumo ou filtros à esquerda. */
  inicio?: ReactNode;
  /** Gruda no pé da área que rola (útil em formulário longo). */
  fixa?: boolean;
  className?: string;
  /** Os botões. */
  children?: ReactNode;
}) {
  return (
    <div
      className={juntar(
        "flex min-w-0 flex-wrap items-center justify-between",
        fixa && "sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 md:mx-0 md:px-0",
        className,
      )}
      data-barra-de-acoes=""
    >
      <div className="mr-3 min-w-0 flex-1 text-[12px] text-muted-foreground">{inicio}</div>
      <div className="-m-1 flex shrink-0 flex-wrap items-center justify-end [&>*]:m-1">{children}</div>
    </div>
  );
}
