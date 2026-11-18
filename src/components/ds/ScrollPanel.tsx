import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { juntar } from "@/components/sistema/estilos";

/**
 * Painel com rolagem própria, como nas referências (B3, 15/11/2026, dono:
 * "rolagem organizada; no computador só a área de conteúdo rola").
 *
 * - Computador (1024 px+): o painel tem a altura da janela menos o topo
 *   (`--altura-do-topo`) e menos `offset` (o que a tela põe acima dele:
 *   cabeçalho da página, faixa de números, abas) e rola por dentro, com barra
 *   fina e sem arrastar a página no fim (overscroll contido).
 * - Celular e tablet: bloco normal, a página rola. Nada de rolagem dentro de
 *   rolagem prendendo o dedo.
 *
 * `fit="max"`: em vez de altura fixa, cresce até o limite e só então rola
 * (listas curtas não deixam buraco). Em grade/flex, use `className="min-h-0"`
 * no pai quando o painel for item de flex.
 *
 *   <ScrollPanel offset={120} label="Fila de peças">…</ScrollPanel>
 *
 * Para colunas lado a lado (kanban, lista + detalhe), dê o MESMO `offset` às
 * colunas: elas ficam com a mesma altura e a grade alinhada.
 */
const ScrollPanel = forwardRef<
  HTMLDivElement,
  {
    children?: ReactNode;
    /** Altura (px ou valor CSS) do que fica acima do painel, abaixo do topo. */
    offset?: number | string;
    fit?: "fixed" | "max";
    /** Nome da região (leitor de tela e foco pelo teclado). */
    label?: string;
    className?: string;
    style?: CSSProperties;
  } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">
>(function ScrollPanel({ children, offset = 0, fit = "fixed", label, className, style, ...resto }, ref) {
  const desconto = typeof offset === "number" ? `${offset}px` : offset;
  return (
    <div
      ref={ref}
      role={label ? "region" : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      data-painel-rolavel=""
      className={juntar(
        "relative min-w-0",
        fit === "max" ? "painel-rolavel-max" : "painel-rolavel",
        label && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      style={{ ["--painel-desconto" as string]: desconto, ...style }}
      {...resto}
    >
      {children}
    </div>
  );
});

export default ScrollPanel;
