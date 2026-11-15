import type { ReactNode } from "react";
import Painel from "@/components/sistema/Painel";
import { juntar, superficie } from "@/components/sistema/estilos";
import OverflowMenu, { type OverflowItem } from "./OverflowMenu";

/**
 * Cartão do painel: canto grande, superfície sólida, sombra quase nenhuma.
 * Cabeçalho com título curto, o "?" (`help`) para a explicação longa, UMA ação
 * principal (`action`) e o resto das ações no "…" (`menu`).
 *
 * `collapsible`: o cartão recolhe pelo título e lembra a escolha (passe uma
 * chave para escolher onde lembrar). Sem título, é só a superfície.
 */
export default function Card({
  title,
  subtitle,
  help,
  action,
  menu,
  menuLabel,
  footer,
  flush = false,
  collapsible = false,
  summary,
  as,
  className = "",
  children,
  ...rest
}: {
  title?: ReactNode;
  /** Uma linha curta de estado. Explicação vai em `help`. */
  subtitle?: ReactNode;
  help?: ReactNode;
  /** A ação principal do cartão (uma só). */
  action?: ReactNode;
  /** Ações secundárias: vão para o "…". */
  menu?: Array<OverflowItem | false | null | undefined>;
  menuLabel?: string;
  footer?: ReactNode;
  /** Sem espaço interno (tabela ou lista que encosta nas bordas). */
  flush?: boolean;
  collapsible?: boolean | string;
  /** Linha à vista com o cartão recolhido. */
  summary?: ReactNode;
  as?: "div" | "section" | "article" | "aside";
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined> & { "aria-label"?: string }) {
  const temMenu = !!menu && menu.some(Boolean);
  const direita =
    action || temMenu ? (
      <>
        {action}
        {temMenu && <OverflowMenu items={menu!} label={menuLabel} />}
      </>
    ) : undefined;
  return (
    <Painel
      titulo={title}
      descricao={subtitle}
      ajuda={help}
      acao={direita}
      rodape={footer}
      semEspaco={flush}
      as={as}
      recolher={collapsible === true ? undefined : collapsible === false ? false : collapsible}
      resumo={summary}
      className={className}
      {...rest}
    >
      {children}
    </Painel>
  );
}

/** Só a superfície do cartão, para quem monta o miolo à mão (item de grade, mídia). */
export function CardSurface({ className = "", children, as: Tag = "div", ...rest }: { className?: string; children?: ReactNode; as?: "div" | "section" | "article" | "li" } & Record<`data-${string}`, string | undefined>) {
  return (
    <Tag className={juntar(superficie.painel, "min-w-0", className)} {...rest}>
      {children}
    </Tag>
  );
}
