import type { ReactNode } from "react";
import { juntar } from "@/components/sistema/estilos";
import OverflowMenu, { type OverflowItem } from "./OverflowMenu";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  /** O conteúdo da célula. */
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Classe de largura da coluna (ex.: "w-[120px]"). */
  width?: string;
  /** Some no celular (a tabela continua cabendo). */
  hideOnMobile?: boolean;
  /** Número: algarismos da mesma largura, alinhado à direita. */
  numeric?: boolean;
}

const LADO = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Célula de identidade (a primeira coluna): avatar ou ícone, nome e uma linha
 * apagada embaixo. O mesmo desenho da ListRow, para dentro de tabela.
 */
export function CellIdentity({ leading, title, subtitle, className = "" }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; className?: string }) {
  return (
    <span className={juntar("flex min-w-0 items-center", className)}>
      {leading && <span className="mr-3 flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{title}</span>
        {subtitle && <span className="mt-0.5 min-w-0 truncate text-[12px] leading-4 text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

/**
 * Tabela limpa (rodada ousada, 15/11/2026): cabeçalho pequeno numa faixa suave
 * arredondada, linhas altas separadas por um traço fino, fundo suave ao passar
 * o mouse, números alinhados à direita e as ações da linha no "…" (`rowMenu`).
 * Rola para o lado DENTRO da própria caixa (a página nunca rola junto) e, no
 * celular, as colunas marcadas com `hideOnMobile` somem.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowMenu,
  rowMenuLabel,
  isHighlighted,
  empty,
  caption,
  dense = false,
  className = "",
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Ações da linha: viram o "…" na última coluna. Sem item, a célula fica vazia. */
  rowMenu?: (row: T, index: number) => Array<OverflowItem | false | null | undefined>;
  rowMenuLabel?: string;
  /** Linha em destaque (a escolhida, a de hoje). */
  isHighlighted?: (row: T, index: number) => boolean;
  /** O que mostrar sem linhas (use EmptyState compact). */
  empty?: ReactNode;
  /** Nome da tabela para leitor de tela. */
  caption: string;
  dense?: boolean;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const celula = dense ? "py-2.5" : "py-4";
  return (
    <div className={juntar("min-w-0 overflow-x-auto overscroll-x-contain", className)} data-data-table="">
      <table className="w-full min-w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={juntar(
                  "whitespace-nowrap bg-muted/70 px-3 py-2.5 sm:px-4 text-[12px] font-medium text-muted-foreground first:rounded-l-full last:rounded-r-full",
                  LADO[c.align || (c.numeric ? "right" : "left")],
                  c.width,
                  c.hideOnMobile && "max-sm:hidden",
                )}
              >
                {c.header}
              </th>
            ))}
            {rowMenu && (
              <th scope="col" className="w-10 bg-muted/70 px-1 py-2.5 last:rounded-r-full sm:w-12 sm:px-2">
                <span className="sr-only">Ações</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const destaque = !!isHighlighted && isHighlighted(row, i);
            return (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-highlight={destaque ? "" : undefined}
                className={juntar("group transition-colors", destaque ? "bg-primary/10" : "hover:bg-muted/50", onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={juntar(
                      "border-b border-border/70 px-3 align-middle text-foreground group-last:border-b-0 sm:px-4",
                      celula,
                      LADO[c.align || (c.numeric ? "right" : "left")],
                      c.numeric && "whitespace-nowrap font-medium tabular-nums",
                      c.hideOnMobile && "max-sm:hidden",
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
                {rowMenu && (
                  <td className={juntar("border-b border-border/70 px-1 text-right align-middle group-last:border-b-0 sm:px-2", celula)} onClick={(e) => e.stopPropagation()}>
                    <OverflowMenu items={rowMenu(row, i)} label={rowMenuLabel} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
