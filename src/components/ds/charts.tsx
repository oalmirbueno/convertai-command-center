import type { CSSProperties, ReactNode } from "react";
import { juntar } from "@/components/sistema/estilos";

/**
 * Gráficos pequenos do painel (rodada ousada, 15/11/2026): SVG puro, sem
 * biblioteca, para morar DENTRO de cartão (StatCard `chart`, Card, linha).
 *
 * Regras:
 * - Só dado que a tela já tem. Sem série, não desenha (devolve null): nada de
 *   número inventado para enfeitar.
 * - A cor vem do token (--chart-1 a --chart-5) e acompanha o cartão: dentro do
 *   cartão verde (.ds-accent) ou de tinta (.ds-ink) o mesmo gráfico sai certo.
 * - O desenho some para leitor de tela (aria-hidden) e o resumo em texto
 *   (`label`, ou um automático) fica em sr-only.
 */

/** Cor de gráfico: os cinco tons do tema, a cor do texto em volta ou o apagado. */
export type ChartTone = 1 | 2 | 3 | 4 | 5 | "current" | "muted";

const COR: Record<string, string> = {
  1: "hsl(var(--chart-1))",
  2: "hsl(var(--chart-2))",
  3: "hsl(var(--chart-3))",
  4: "hsl(var(--chart-4))",
  5: "hsl(var(--chart-5))",
  current: "currentColor",
  muted: "hsl(var(--muted-foreground))",
};

function cor(tone: ChartTone | undefined): string | undefined {
  return tone === undefined ? undefined : COR[String(tone)];
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const fmt = (v: number) => numero.format(v);

function finitos(values: readonly number[]): number[] {
  return (values || []).filter((v) => typeof v === "number" && isFinite(v));
}

function Resumo({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/**
 * Linha de tendência, sem eixo e sem legenda. Ocupa a largura toda de onde
 * estiver. Com menos de dois pontos não desenha.
 */
export function Sparkline({
  values,
  height = 44,
  tone,
  area = true,
  strokeWidth = 2,
  label,
  className = "",
}: {
  values: number[];
  height?: number;
  tone?: ChartTone;
  /** Preenchimento suave embaixo da linha. */
  area?: boolean;
  strokeWidth?: number;
  /** Resumo para leitor de tela. Sem ele: "Tendência de A a B em N pontos". */
  label?: string;
  className?: string;
}) {
  const pontos = finitos(values);
  if (pontos.length < 2) return null;
  const min = Math.min.apply(null, pontos);
  const max = Math.max.apply(null, pontos);
  const faixa = max - min || 1;
  const largura = 120;
  const folga = strokeWidth + 1;
  const passo = largura / (pontos.length - 1);
  const xy = pontos.map((v, i) => [i * passo, height - folga - ((v - min) / faixa) * (height - folga * 2)] as const);
  // Curva suave: cada trecho passa pelo ponto médio (sem ultrapassar os valores).
  let linha = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i += 1) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const meio = (x0 + x1) / 2;
    linha += ` C${meio.toFixed(1)},${y0.toFixed(1)} ${meio.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const fundo = `${linha} L${largura},${height} L0,${height} Z`;
  return (
    <span className={juntar("block min-w-0", className)} data-ds-chart="sparkline" style={{ color: cor(tone) }}>
      <svg viewBox={`0 0 ${largura} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" className="block w-full" style={{ height }}>
        {area && <path d={fundo} fill="currentColor" opacity={0.14} />}
        <path d={linha} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <Resumo>{label || `Tendência de ${fmt(pontos[0])} a ${fmt(pontos[pontos.length - 1])} em ${pontos.length} pontos`}</Resumo>
    </span>
  );
}

/**
 * Barrinhas arredondadas. A barra `highlightIndex` sai cheia e as outras
 * apagadas (sem índice, todas cheias). `labels` nomeia cada barra no resumo
 * e, com `showLabels`, embaixo dela.
 */
export function MiniBars({
  values,
  highlightIndex,
  labels,
  showLabels = false,
  height = 56,
  tone,
  label,
  className = "",
}: {
  values: number[];
  highlightIndex?: number;
  labels?: string[];
  showLabels?: boolean;
  height?: number;
  tone?: ChartTone;
  /** Resumo para leitor de tela. Sem ele, a lista dos valores. */
  label?: string;
  className?: string;
}) {
  const barras = (values || []).map((v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0));
  if (barras.length === 0) return null;
  const max = Math.max.apply(null, barras) || 1;
  const n = barras.length;
  const fatia = 100 / n;
  // Barra ocupa 68% da fatia; o resto é o respiro entre elas.
  const larguraDaBarra = fatia * 0.68;
  const temDestaque = typeof highlightIndex === "number" && highlightIndex >= 0 && highlightIndex < n;
  const raio = Math.min(8, height / 4);
  return (
    <span className={juntar("block min-w-0", className)} data-ds-chart="bars" style={{ color: cor(tone) }}>
      <svg width="100%" height={height} aria-hidden="true" focusable="false" className="block overflow-visible">
        {barras.map((v, i) => {
          // Valor zero vira um traço baixo (a barra existe, só está vazia).
          const h = v > 0 ? Math.max(6, (v / max) * height) : 3;
          return (
            <rect
              key={i}
              x={`${(i * fatia + (fatia - larguraDaBarra) / 2).toFixed(3)}%`}
              y={height - h}
              width={`${larguraDaBarra.toFixed(3)}%`}
              height={h}
              rx={Math.min(raio, h / 2)}
              fill="currentColor"
              opacity={!temDestaque || i === highlightIndex ? 1 : 0.28}
            />
          );
        })}
      </svg>
      {showLabels && labels && labels.length === n && (
        <span aria-hidden="true" className="mt-1.5 grid text-center text-[11px] leading-4 text-muted-foreground" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {labels.map((l, i) => (
            <span key={i} className={juntar("truncate", temDestaque && i === highlightIndex && "font-medium text-foreground")}>{l}</span>
          ))}
        </span>
      )}
      <Resumo>{label || barras.map((v, i) => `${labels && labels[i] ? `${labels[i]}: ` : ""}${fmt(v)}`).join(", ")}</Resumo>
    </span>
  );
}

/**
 * Barra de progresso de uma razão que já existe (recebido de previsto, feito
 * de total). Sem `max` válido, não desenha.
 */
export function ProgressBar({
  value,
  max = 100,
  height = 8,
  tone,
  striped = false,
  label,
  className = "",
}: {
  value: number;
  max?: number;
  height?: number;
  tone?: ChartTone;
  /** Trilho listrado (o que falta aparece hachurado, como nas referências). */
  striped?: boolean;
  /** Resumo para leitor de tela. Sem ele: "X de Y (Z%)". */
  label?: string;
  className?: string;
}) {
  if (!(typeof max === "number" && isFinite(max) && max > 0) || !(typeof value === "number" && isFinite(value))) return null;
  const parte = Math.max(0, Math.min(1, value / max));
  const pct = Math.round(parte * 100);
  const trilho: CSSProperties = striped
    ? { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0, currentColor 2px, transparent 2px, transparent 6px)", opacity: 0.22 }
    : { backgroundColor: "currentColor", opacity: 0.14 };
  return (
    <span
      className={juntar("relative block w-full min-w-0 overflow-hidden rounded-full", className)}
      data-ds-chart="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label || `${fmt(value)} de ${fmt(max)} (${pct}%)`}
      style={{ height, color: cor(tone) }}
    >
      <span aria-hidden="true" className="absolute inset-0 rounded-full" style={trilho} />
      {parte > 0 && <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full bg-current transition-[width] duration-500" style={{ width: `${Math.max(pct, 2)}%`, minWidth: height }} />}
    </span>
  );
}

export interface DonutSegment {
  value: number;
  label: string;
  /** Sem tom, os cinco tons do tema em ordem. */
  tone?: ChartTone;
}

/**
 * Rosca: partes de um total que já existe. O miolo (`children`) leva o número
 * ou o nome do total. Parte com valor zero ou negativo fica de fora; sem
 * nenhuma parte, desenha só o trilho.
 */
export function Donut({
  segments,
  size = 120,
  thickness = 14,
  children,
  label,
  className = "",
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** Miolo da rosca (número, rótulo curto). */
  children?: ReactNode;
  /** Resumo para leitor de tela. Sem ele, cada parte com a sua porcentagem. */
  label?: string;
  className?: string;
}) {
  const partes = (segments || []).filter((s) => typeof s.value === "number" && isFinite(s.value) && s.value > 0);
  const total = partes.reduce((soma, s) => soma + s.value, 0);
  const raio = 50 - (thickness / size) * 50;
  const tracoSvg = (thickness / size) * 100;
  const volta = 2 * Math.PI * raio;
  // Respiro entre as partes (em unidades do traçado); some quando só há uma.
  const respiro = partes.length > 1 ? Math.min(2.5, volta / partes.length / 4) : 0;
  let andado = 0;
  return (
    <span className={juntar("relative inline-block shrink-0", className)} data-ds-chart="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false" className="block -rotate-90">
        <circle cx={50} cy={50} r={raio} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={tracoSvg} opacity={0.16} />
        {total > 0 &&
          partes.map((s, i) => {
            const arco = (s.value / total) * volta;
            const desenhado = Math.max(0.5, arco - respiro);
            const inicio = andado + respiro / 2;
            andado += arco;
            return (
              <circle
                key={`${s.label}-${i}`}
                cx={50}
                cy={50}
                r={raio}
                fill="none"
                stroke={cor(s.tone) || COR[String((i % 5) + 1)]}
                strokeWidth={tracoSvg}
                strokeDasharray={`${desenhado.toFixed(3)} ${(volta - desenhado).toFixed(3)}`}
                strokeDashoffset={(-inicio).toFixed(3)}
              />
            );
          })}
      </svg>
      {children !== undefined && children !== null && (
        <span className="absolute inset-0 flex min-w-0 flex-col items-center justify-center text-center text-foreground" style={{ padding: thickness + 4 }}>
          {children}
        </span>
      )}
      <Resumo>{label || (total > 0 ? partes.map((s) => `${s.label}: ${fmt(s.value)} (${Math.round((s.value / total) * 100)}%)`).join(", ") : "Sem dados")}</Resumo>
    </span>
  );
}

/** A cor de uma parte da rosca, para a bolinha da legenda ficar igual ao desenho. */
export function chartColor(tone: ChartTone | undefined, index = 0): string {
  return cor(tone) || COR[String((index % 5) + 1)];
}

/** Legenda em lista: bolinha, nome e, à direita, o valor. Use ao lado da Donut. */
export function ChartLegend({ items, className = "" }: { items: Array<{ label: ReactNode; value?: ReactNode; tone?: ChartTone }>; className?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className={juntar("min-w-0 divide-y divide-border/60", className)} data-ds-chart-legend="">
      {items.map((item, i) => (
        <li key={i} className="flex min-w-0 items-center py-2 text-[13px] leading-5">
          <span aria-hidden="true" className="mr-2.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chartColor(item.tone, i) }} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.label}</span>
          {item.value !== undefined && <span className="ml-3 shrink-0 font-medium tabular-nums text-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
