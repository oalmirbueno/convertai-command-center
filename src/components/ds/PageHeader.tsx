import type { ReactNode } from "react";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import { juntar } from "@/components/sistema/estilos";

/**
 * Topo de toda página: título, no máximo UMA linha curta de apoio, o "?" para
 * a explicação longa e, à direita, a ação principal. A barra de ferramentas
 * (busca, filtros, visões) entra logo abaixo, em `toolbar`.
 */
export default function PageHeader({
  title,
  subtitle,
  help,
  actions,
  back,
  toolbar,
  beside,
  level,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  help?: ReactNode;
  /** Ações à direita: uma principal; o resto num OverflowMenu. */
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** Toolbar da página (use o componente Toolbar). */
  toolbar?: ReactNode;
  /** Na linha do título, depois do "?" (abas pequenas). */
  beside?: ReactNode;
  level?: 1 | 2;
  className?: string;
}) {
  return (
    <div className={juntar("min-w-0", className)} data-page-header="">
      <CabecalhoDePagina titulo={title} descricao={subtitle} ajuda={help} acoes={actions} voltar={back ? { para: back.to, rotulo: back.label } : undefined} aoLado={beside} nivel={level} />
      {toolbar && <div className="mt-4 min-w-0">{toolbar}</div>}
    </div>
  );
}
