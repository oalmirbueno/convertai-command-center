import type { ReactNode } from "react";
import MenuMais, { type ItemDoMenu } from "@/components/sistema/MenuMais";

/** Uma ação do menu "…". */
export interface OverflowItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Ação que apaga ou desfaz: vai por último, em vermelho. */
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  hint?: string;
}

/**
 * Menu "…": o lugar das ações secundárias de um cartão, de uma linha ou de uma
 * barra. Uma ação principal fica à vista; o resto mora aqui. Sem item, não
 * desenha nada.
 */
export default function OverflowMenu({
  items,
  label = "Mais ações",
  vertical,
  align,
  className,
  disabled,
}: {
  items: Array<OverflowItem | false | null | undefined>;
  label?: string;
  vertical?: boolean;
  align?: "start" | "end";
  className?: string;
  disabled?: boolean;
}) {
  const itens: ItemDoMenu[] = (items.filter(Boolean) as OverflowItem[]).map((i) => ({
    rotulo: i.label,
    icone: i.icon,
    aoEscolher: i.onSelect,
    perigo: i.danger,
    desativado: i.disabled,
    separadorAntes: i.separatorBefore,
    dica: i.hint,
  }));
  return <MenuMais itens={itens} rotulo={label} vertical={vertical} alinhar={align} className={className} desativado={disabled} />;
}
