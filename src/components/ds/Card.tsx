import type { ReactNode } from "react";
import Painel from "@/components/sistema/Painel";
import { juntar, superficie } from "@/components/sistema/estilos";
import OverflowMenu, { type OverflowItem } from "./OverflowMenu";

/**
 * Cartão do painel: canto de 24 px, superfície sólida, bastante ar por dentro.
 * Cabeçalho com título curto, o "?" (`help`) para a explicação longa, UMA ação
 * principal (`action`) e o resto das ações no "…" (`menu`).
 *
 * `collapsible`: o cartão recolhe pelo título e lembra a escolha (passe uma
 * chave para escolher onde lembrar). Sem título, é só a superfície.
 *
 * `variant`: `accent` é o cartão sólido na cor da marca (texto quase preto) e
 * `ink` o cartão de tinta (preto no tema claro, claro no escuro). Quem está
 * dentro continua usando as mesmas classes (text-muted-foreground, bg-muted,
 * Chip, gráficos): os tokens trocam sozinhos. Um de cada por seção, no máximo.
 */
export default function Card({
  title,
  icon,
  subtitle,
  help,
  action,
  menu,
  menuLabel,
  footer,
  flush = false,
  variant = "default",
  collapsible = false,
  summary,
  as,
  className = "",
  children,
  ...rest
}: {
  title?: ReactNode;
  /** Ícone num círculo antes do título (cabeçalho padrão de cartão das referências). */
  icon?: ReactNode;
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
  variant?: "default" | "accent" | "ink";
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
      titulo={title && icon ? (
        <span className="flex min-w-0 items-center">
          <span aria-hidden="true" className="mr-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">{icon}</span>
          <span className="min-w-0 line-clamp-2 break-words [text-wrap:balance]">{title}</span>
        </span>
      ) : title}
      descricao={subtitle}
      ajuda={help}
      acao={direita}
      rodape={footer}
      semEspaco={flush}
      as={as}
      // Com ícone o título deixa de ser texto puro: a chave de lembrar o recolhido sai do próprio título.
      recolher={collapsible === true ? (icon && typeof title === "string" ? `card:${title}` : undefined) : collapsible === false ? false : collapsible}
      resumo={summary}
      className={juntar(variant === "accent" && superficie.destaque, variant === "ink" && superficie.tinta, className)}
      data-card={variant}
      {...rest}
    >
      {children}
    </Painel>
  );
}

/** Só a superfície do cartão, para quem monta o miolo à mão (item de grade, mídia). */
export function CardSurface({ className = "", children, as: Tag = "div", variant = "default", padded = false, ...rest }: { className?: string; children?: ReactNode; as?: "div" | "section" | "article" | "li"; variant?: "default" | "accent" | "ink"; /** Com o respiro padrão do cartão (20 px no celular, 24 px de 640 para cima). */ padded?: boolean } & Record<`data-${string}`, string | undefined>) {
  return (
    <Tag className={juntar(superficie.painel, "min-w-0", padded && "p-5 sm:p-6", variant === "accent" && superficie.destaque, variant === "ink" && superficie.tinta, className)} data-card={variant} {...rest}>
      {children}
    </Tag>
  );
}
