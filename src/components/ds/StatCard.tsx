import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import HelpTooltip from "./HelpTooltip";
import { DeltaChip } from "./Chip";

/**
 * Minigráfico de linha para o cartão de indicador. Sem eixo e sem legenda: só
 * a forma da tendência. Some para leitor de tela (o número já diz o valor).
 */
export function Sparkline({ values, className = "", height = 36 }: { values: number[]; className?: string; height?: number }) {
  const pontos = values.filter((v) => typeof v === "number" && isFinite(v));
  if (pontos.length < 2) return null;
  const min = Math.min.apply(null, pontos);
  const max = Math.max.apply(null, pontos);
  const faixa = max - min || 1;
  const largura = 120;
  const passo = largura / (pontos.length - 1);
  const xy = pontos.map((v, i) => [i * passo, height - 3 - ((v - min) / faixa) * (height - 6)] as const);
  const linha = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linha} L${largura},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${largura} ${height}`} preserveAspectRatio="none" aria-hidden="true" className={juntar("block w-full text-primary", className)} style={{ height }}>
      <path d={area} fill="currentColor" opacity={0.1} />
      <path d={linha} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface StatCardProps {
  /** Rótulo pequeno e apagado em cima do número. */
  label: ReactNode;
  /** O número, grande e direto. */
  value: ReactNode;
  /** Variação em % (vira a pílula verde/vermelha). */
  delta?: number;
  /** Texto da pílula quando não é "%"; ou uma linha curta ao lado dela. */
  deltaLabel?: ReactNode;
  /** Custo que cai é bom: inverte as cores da variação. */
  invertDelta?: boolean;
  /** Linha curta de apoio embaixo ("este mês", "de R$ 12 mil"). */
  hint?: ReactNode;
  /** Ícone num círculo suave, à direita do rótulo. */
  icon?: ReactNode;
  /** Explicação longa: vira o "?". */
  help?: ReactNode;
  /** Minigráfico ou barra embaixo do número. */
  chart?: ReactNode;
  /** `accent`: o cartão de destaque da fileira (um só), na cor da marca. `ink`: escuro. */
  tone?: "default" | "accent" | "ink";
  /** Número que leva a outra tela. */
  to?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Cartão de indicador: rótulo pequeno, número grande com algarismos da mesma
 * largura, variação em pílula e, se quiser, ícone e minigráfico. Com `to` ou
 * `onClick` o cartão inteiro é o link/botão.
 */
export default function StatCard({ label, value, delta, deltaLabel, invertDelta, hint, icon, help, chart, tone = "default", to, onClick, className = "" }: StatCardProps) {
  const destaque = tone !== "default";
  const base = juntar(
    "group relative block min-w-0 p-4 text-left sm:p-5",
    tone === "default" && superficie.painel,
    tone === "accent" && "rounded-lg bg-primary text-primary-foreground",
    tone === "ink" && "rounded-lg bg-foreground text-background",
    (to || onClick) && juntar("transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5", foco),
    className,
  );
  const miolo = (
    <>
      <span className="flex min-w-0 items-center justify-between">
        <span className={juntar("flex min-w-0 items-center text-[12px] font-medium leading-4", destaque ? "opacity-80" : "text-muted-foreground")}>
          <span className="truncate">{label}</span>
          {help && !destaque && <HelpTooltip className="ml-1">{help}</HelpTooltip>}
        </span>
        {icon && (
          <span aria-hidden="true" className={juntar("ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full", destaque ? "bg-black/10" : "bg-muted text-foreground")}>
            {icon}
          </span>
        )}
      </span>
      <span className="mt-2 flex min-w-0 items-end">
        <span className={juntar(texto.numeroGrande, "min-w-0 truncate", destaque && "text-current", "max-sm:text-[24px] max-sm:leading-8")}>{value}</span>
      </span>
      {(typeof delta === "number" || hint || deltaLabel) && (
        <span className="mt-1.5 flex min-w-0 items-center">
          {typeof delta === "number" && <DeltaChip value={delta} invert={invertDelta} label={typeof deltaLabel === "string" ? deltaLabel : undefined} className={destaque ? "bg-black/10 text-current" : ""} />}
          {(hint || (deltaLabel && typeof delta !== "number")) && (
            <span className={juntar("min-w-0 text-[12px] leading-4 line-clamp-2", typeof delta === "number" && "ml-2", destaque ? "opacity-75" : "text-muted-foreground")}>{hint || deltaLabel}</span>
          )}
        </span>
      )}
      {chart && <span className="mt-3 block min-w-0">{chart}</span>}
    </>
  );
  if (to) return <Link to={to} className={base} data-stat-card={tone}>{miolo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={juntar(base, "w-full")} data-stat-card={tone}>{miolo}</button>;
  return <div className={base} data-stat-card={tone}>{miolo}</div>;
}

/** Fileira de cartões de indicador: 2 colunas no celular, até `cols` no computador. */
export function StatGrid({ cols = 4, className = "", children, label }: { cols?: 2 | 3 | 4 | 5 | 6; className?: string; children: ReactNode; label?: string }) {
  const classes: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  };
  return (
    <div role={label ? "group" : undefined} aria-label={label} className={juntar("grid min-w-0 gap-3 sm:gap-4", classes[cols], className)}>
      {children}
    </div>
  );
}
