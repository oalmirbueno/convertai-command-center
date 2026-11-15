import type { ReactNode } from "react";
import { juntar } from "@/components/sistema/estilos";

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
  /** Número: algarismos da mesma largura. */
  numeric?: boolean;
}

const LADO = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Tabela limpa: cabeçalho pequeno e apagado, linhas separadas por um traço
 * leve, fundo suave ao passar o mouse, números alinhados à direita. Rola para
 * o lado DENTRO da própria caixa (a página nunca rola junto) e, no celular,
 * as colunas marcadas com `hideOnMobile` somem.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  caption,
  dense = false,
  className = "",
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** O que mostrar sem linhas (use EmptyState compact). */
  empty?: ReactNode;
  /** Nome da tabela para leitor de tela. */
  caption: string;
  dense?: boolean;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
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
                  "whitespace-nowrap border-b border-border px-3 pb-2.5 pt-1 text-[12px] font-medium text-muted-foreground first:pl-0 last:pr-0",
                  LADO[c.align || (c.numeric ? "right" : "left")],
                  c.width,
                  c.hideOnMobile && "max-sm:hidden",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={juntar("group transition-colors hover:bg-muted/50", onRowClick && "cursor-pointer")}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={juntar(
                    "border-b border-border/60 px-3 align-middle text-foreground first:pl-0 last:pr-0 group-last:border-b-0",
                    dense ? "py-2" : "py-3",
                    LADO[c.align || (c.numeric ? "right" : "left")],
                    c.numeric && "tabular-nums",
                    c.hideOnMobile && "max-sm:hidden",
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
