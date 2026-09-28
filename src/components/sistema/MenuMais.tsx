import { Fragment, type ReactNode } from "react";
import { MoreHorizontal, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { botao, juntar } from "./estilos";

/** Uma ação do menu "...". */
export interface ItemDoMenu {
  rotulo: string;
  icone?: ReactNode;
  aoEscolher: () => void;
  /** Ação que apaga ou desfaz: vai por último, em vermelho, com um traço antes. */
  perigo?: boolean;
  desativado?: boolean;
  /** Traço fino antes deste item (separa grupos). */
  separadorAntes?: boolean;
  /** Linha de apoio (aparece no title do item). */
  dica?: string;
}

/**
 * Menu "..." (docs/design/SISTEMA.md, seção 15): o secundário de uma barra,
 * de um grupo ou de uma linha, num lugar só. Botão de ícone (32 px) com
 * aria-label, lista alinhada à direita, itens de perigo por último.
 *
 * `itens` aceita `false`/`null` para item condicional
 * (`[podeApagar && {...}]`). Sem item nenhum, não desenha nada.
 */
export default function MenuMais({
  itens,
  rotulo = "Mais ações",
  vertical = false,
  alinhar = "end",
  className = "",
  desativado = false,
}: {
  itens: Array<ItemDoMenu | false | null | undefined>;
  /** Nome do botão para leitor de tela. */
  rotulo?: string;
  /** Três pontos em pé (linha de lista estreita). */
  vertical?: boolean;
  alinhar?: "start" | "end";
  className?: string;
  desativado?: boolean;
}) {
  const validos = itens.filter(Boolean) as ItemDoMenu[];
  if (validos.length === 0) return null;
  // Perigo sempre por último, com um traço antes do primeiro.
  const comuns = validos.filter((i) => !i.perigo);
  const perigosos = validos.filter((i) => i.perigo);
  const ordenados = comuns.concat(perigosos);
  const Icone = vertical ? MoreVertical : MoreHorizontal;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={desativado}>
        <button type="button" aria-label={rotulo} title={rotulo} className={juntar(botao.icone, className)} data-menu-mais="">
          <Icone className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={alinhar} sideOffset={6} className="min-w-[180px] max-w-[calc(100vw-24px)] p-1">
        {ordenados.map((item, i) => {
          const traco = i > 0 && (item.separadorAntes || (item.perigo && i === comuns.length));
          return (
            <Fragment key={`${item.rotulo}-${i}`}>
              {traco && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.desativado}
                title={item.dica}
                onSelect={() => item.aoEscolher()}
                className={juntar("min-h-8 cursor-pointer rounded px-2 py-1.5 text-[13px]", item.perigo && "text-destructive focus:text-destructive")}
              >
                {item.icone && (
                  <span className={juntar("mr-2 inline-flex shrink-0", item.perigo ? "text-destructive" : "text-muted-foreground")} aria-hidden="true">
                    {item.icone}
                  </span>
                )}
                <span className="min-w-0 truncate">{item.rotulo}</span>
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
