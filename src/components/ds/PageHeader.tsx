import type { ReactNode } from "react";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import { juntar } from "@/components/sistema/estilos";

/**
 * Topo de toda página: título grande (32 px; 24 px no celular), no máximo UMA
 * linha curta de apoio, o "?" para a explicação longa e, à direita, a ação
 * principal. A barra de ferramentas (busca, filtros, visões) entra logo
 * abaixo, em `toolbar`.
 *
 * `greeting`: saudação na MESMA linha do título, com o nome apagado
 * ("Bom dia," em `title` e o nome em `greeting`), como nas referências.
 */
export default function PageHeader({
  title,
  eyebrow,
  stats,
  greeting,
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
  /** Sobretítulo miúdo e apagado em cima do título ("Operação / Semana"). */
  eyebrow?: ReactNode;
  /** Números-resumo sem cartão, logo abaixo do título (use o StatTrio). */
  stats?: ReactNode;
  /** Segunda parte do título, apagada, na mesma linha (o nome na saudação). */
  greeting?: ReactNode;
  /** Uma linha curta de apoio embaixo do título (some no celular). */
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
      {eyebrow && <p className="mb-1 min-w-0 truncate text-[12px] font-medium leading-4 text-muted-foreground">{eyebrow}</p>}
      <CabecalhoDePagina titulo={greeting ? <>{title} <span className="font-normal text-muted-foreground">{greeting}</span></> : title} descricao={subtitle} ajuda={help} acoes={actions} voltar={back ? { para: back.to, rotulo: back.label } : undefined} aoLado={beside} nivel={level} />
      {stats && <div className="mt-4 min-w-0 sm:mt-5">{stats}</div>}
      {toolbar && <div className="mt-5 min-w-0 sm:mt-6">{toolbar}</div>}
    </div>
  );
}
