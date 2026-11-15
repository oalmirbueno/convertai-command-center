import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { foco, juntar } from "@/components/sistema/estilos";
import OverflowMenu, { type OverflowItem } from "./OverflowMenu";

/** As iniciais de um nome: primeira e última palavra ("Ana Paula Souza" vira "AS"). */
export function initialsOf(name: string | null | undefined): string {
  const palavras = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "?";
  const primeira = palavras[0].charAt(0);
  const ultima = palavras.length > 1 ? palavras[palavras.length - 1].charAt(0) : "";
  return (primeira + ultima).toUpperCase();
}

const TAMANHO = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-12 w-12 text-[15px]",
} as const;

const TOM = {
  neutral: "bg-muted text-foreground",
  accent: "bg-accent-soft text-primary",
  solid: "bg-accent-solid text-on-accent",
  ink: "bg-foreground text-background",
} as const;

/**
 * Círculo da linha: a foto (`src`), um ícone (`icon`) ou as iniciais do nome.
 * É decorativo: o nome já está escrito ao lado.
 */
export function Avatar({
  name,
  src,
  icon,
  size = "md",
  tone = "neutral",
  square = false,
  className = "",
}: {
  name?: string | null;
  src?: string | null;
  icon?: ReactNode;
  size?: keyof typeof TAMANHO;
  tone?: keyof typeof TOM;
  /** Quadrado de canto arredondado (logo de empresa, ícone de app). */
  square?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden="true" data-avatar="" className={juntar("inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold leading-none", square ? "rounded-md" : "rounded-full", TAMANHO[size], TOM[tone], className)}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : icon ? icon : initialsOf(name)}
    </span>
  );
}

export interface ListRowProps {
  /** Texto principal (uma linha, com reticências). */
  title: ReactNode;
  /** Linha de apoio apagada, embaixo do título. */
  subtitle?: ReactNode;
  /** O que vai antes do texto: um <Avatar />, um ícone num círculo, uma miniatura. */
  leading?: ReactNode;
  /** Atalho: desenha o <Avatar /> de iniciais deste nome (ignorado se houver `leading`). */
  avatar?: string;
  /** Estado da linha: use <StatusPill />. No celular desce para baixo do título. */
  status?: ReactNode;
  /** Valor à direita (número, data, total), alinhado e com algarismos da mesma largura. */
  value?: ReactNode;
  /** Linha apagada embaixo do valor. */
  valueHint?: ReactNode;
  /** UMA ação à vista (botão pequeno). */
  action?: ReactNode;
  /** As outras ações: vão para o "…". */
  menu?: Array<OverflowItem | false | null | undefined>;
  menuLabel?: string;
  /** A linha inteira leva a outra tela. */
  to?: string;
  onClick?: () => void;
  /** Linha em destaque (a de hoje, a escolhida): fundo no tom da marca. */
  highlight?: boolean;
  /** Linha mais baixa (lista longa dentro de cartão). */
  dense?: boolean;
  className?: string;
}

/**
 * Linha de lista limpa (rodada ousada, 15/11/2026): avatar ou ícone, nome com
 * uma linha apagada embaixo, estado em pílula, valor alinhado à direita e as
 * ações no "…". Fundo suave ao passar o mouse; o traço fino entre as linhas é
 * da <List>. Com `to` ou `onClick`, o texto é o alvo e cobre a linha inteira;
 * a ação e o "…" continuam clicáveis por cima.
 */
export default function ListRow({ title, subtitle, leading, avatar, status, value, valueHint, action, menu, menuLabel, to, onClick, highlight = false, dense = false, className = "" }: ListRowProps) {
  const temMenu = !!menu && menu.some(Boolean);
  const antes = leading !== undefined && leading !== null ? leading : avatar ? <Avatar name={avatar} /> : null;
  const alvo = "min-w-0 truncate text-left text-[13px] font-medium leading-5 text-foreground after:absolute after:inset-0 after:rounded-[inherit]";
  const titulo = to ? (
    <Link to={to} className={juntar(alvo, "rounded outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring")}>{title}</Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={juntar(alvo, "toque-compacto rounded outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring")}>{title}</button>
  ) : (
    <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{title}</span>
  );
  return (
    <li
      data-list-row=""
      data-highlight={highlight ? "" : undefined}
      className={juntar(
        "group relative flex min-w-0 items-center rounded-lg px-3 transition-colors",
        dense ? "py-2.5" : "py-3.5",
        highlight ? "bg-primary/10" : "hover:bg-muted/60",
        (to || onClick) && "cursor-pointer",
        className,
      )}
    >
      {antes && <span className="mr-3 flex shrink-0 items-center">{antes}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        {titulo}
        {subtitle && <span className="mt-0.5 min-w-0 truncate text-[12px] leading-4 text-muted-foreground">{subtitle}</span>}
        {status && <span className="mt-1.5 flex min-w-0 items-center sm:hidden">{status}</span>}
      </span>
      {status && <span className="ml-3 hidden shrink-0 items-center sm:flex">{status}</span>}
      {(value !== undefined && value !== null) && (
        <span className="ml-4 flex shrink-0 flex-col items-end text-right">
          <span className="text-[13px] font-semibold leading-5 tabular-nums text-foreground">{value}</span>
          {valueHint && <span className="mt-0.5 text-[12px] leading-4 tabular-nums text-muted-foreground">{valueHint}</span>}
        </span>
      )}
      {(action || temMenu) && (
        <span className="relative z-[1] ml-2 flex shrink-0 items-center [&>*+*]:ml-1">
          {action}
          {temMenu && <OverflowMenu items={menu!} label={menuLabel} />}
        </span>
      )}
    </li>
  );
}

/**
 * A lista das linhas: um traço fino entre elas e as linhas encostadas na
 * margem do cartão (o texto alinha com o título). `empty` aparece sem linha.
 */
export function List({ children, label, divided = true, empty, className = "" }: { children?: ReactNode; label?: string; divided?: boolean; empty?: ReactNode; className?: string }) {
  const vazia = children === undefined || children === null || children === false || (Array.isArray(children) && children.filter(Boolean).length === 0);
  if (vazia && empty) return <>{empty}</>;
  return (
    <ul aria-label={label} data-list="" className={juntar("-mx-3 min-w-0", divided && "[&>li+li]:before:absolute [&>li+li]:before:inset-x-3 [&>li+li]:before:top-0 [&>li+li]:before:h-px [&>li+li]:before:bg-border/70 [&>li+li]:before:content-['']", className)}>
      {children}
    </ul>
  );
}
