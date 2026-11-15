import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { foco, juntar, superficie } from "@/components/sistema/estilos";
import HelpTooltip from "./HelpTooltip";
import { DeltaChip } from "./Chip";
import { RingIcon } from "./charts";

export { Sparkline } from "./charts";

export interface StatCardProps {
  /** Rótulo pequeno e apagado em cima do número. */
  label: ReactNode;
  /** O número, grande e direto. Texto ou número cabe sempre numa linha (a letra se ajusta ao cartão). */
  value: ReactNode;
  /** Variação em % (vira a pílula com seta). */
  delta?: number;
  /** Texto da pílula quando não é "%"; ou uma linha curta ao lado dela. */
  deltaLabel?: ReactNode;
  /** Custo que cai é bom: inverte as cores da variação. */
  invertDelta?: boolean;
  /** Linha curta de apoio embaixo ("este mês", "de R$ 12 mil"). */
  hint?: ReactNode;
  /** Ícone num círculo, à esquerda do rótulo. */
  icon?: ReactNode;
  /**
   * Meta do indicador (feito de total): o círculo do ícone vira um anel de
   * progresso. Só com número que a tela já tem.
   */
  progress?: { value: number; max: number };
  /** Unidade em pílula ao lado do número ("R$", "peças", "h"). */
  unit?: ReactNode;
  /** Faixa no pé do cartão que leva ao detalhe ("Ver detalhes"). Sem `to` no cartão inteiro. */
  footer?: { label: ReactNode; to?: string; onClick?: () => void };
  /** Explicação longa: vira o "?". */
  help?: ReactNode;
  /**
   * Minigráfico de `ds/charts` com dado que a tela já tem (Sparkline,
   * MiniBars, ProgressBar, Donut). Sem dado, não passe nada.
   */
  chart?: ReactNode;
  /** Onde o gráfico fica: embaixo do número (padrão) ou à direita dele. */
  chartPosition?: "bottom" | "side";
  /**
   * `accent`: o cartão sólido na cor da marca, com texto quase preto.
   * `ink`: o cartão de tinta (preto no tema claro, claro no tema escuro).
   * No máximo um de cada por fileira.
   */
  variant?: "default" | "accent" | "ink";
  /** O mesmo que `variant` (nome da rodada de 14/11; continua valendo). */
  tone?: "default" | "accent" | "ink";
  /** Teto do número: `md` 28 px, `lg` 40 px (padrão), `xl` 48 px e `hero` 64 px, leve (o número herói do cartão de destaque). No celular: 24, 32, 36 e 44 px. */
  size?: "md" | "lg" | "xl" | "hero";
  /** Canto de cima à direita (um "…", uma seta, uma etiqueta). */
  corner?: ReactNode;
  /** Número que leva a outra tela. */
  to?: string;
  onClick?: () => void;
  className?: string;
}

const TETO: Record<NonNullable<StatCardProps["size"]>, { celular: string; tela: string }> = {
  md: { celular: "24px", tela: "28px" },
  lg: { celular: "32px", tela: "40px" },
  xl: { celular: "36px", tela: "48px" },
  hero: { celular: "44px", tela: "64px" },
};

/** "R$ 5.200,00" vira "R$ 5.200" forte e ",00" apagado (como nas referências). Só em valor de dinheiro. */
function comCentavosApagados(valor: string): ReactNode {
  const m = /^(.*R\$\s?[\d.]+)(,\d{2})$/.exec(valor);
  if (!m) return valor;
  return (
    <>
      {m[1]}
      <span className="ds-stat-centavos">{m[2]}</span>
    </>
  );
}

/**
 * Cartão de indicador (rodada ousada, 15/11/2026): rótulo pequeno e apagado,
 * número GRANDE com algarismos da mesma largura, variação em pílula com seta
 * e, se a tela tiver o dado, um minigráfico. Três variantes: branco/escuro do
 * tema, sólido na cor da marca e tinta. Com `to` ou `onClick` o cartão inteiro
 * é o link/botão.
 */
export default function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  invertDelta,
  hint,
  icon,
  progress,
  unit,
  footer,
  help,
  chart,
  chartPosition = "bottom",
  variant,
  tone,
  size = "lg",
  corner,
  to,
  onClick,
  className = "",
}: StatCardProps) {
  const tipo = variant || tone || "default";
  const destaque = tipo !== "default";
  const base = juntar(
    "group relative flex min-w-0 flex-col p-4 text-left sm:p-6",
    superficie.painel,
    tipo === "accent" && superficie.destaque,
    tipo === "ink" && superficie.tinta,
    (to || onClick) && juntar("transition-transform duration-200 [@media(hover:hover)]:hover:-translate-y-0.5 active:translate-y-0", foco),
    className,
  );
  // Texto e número cabem numa linha: a letra sai da largura do cartão dividida
  // pela quantidade de caracteres (ver .ds-stat-valor em index.css).
  const simples = typeof value === "string" || typeof value === "number";
  const caracteres = simples ? Math.max(3, String(value).length) : 0;
  const estiloDoValor = {
    "--ds-chars": simples ? caracteres : undefined,
    "--ds-valor-max-celular": TETO[size].celular,
    "--ds-valor-max-tela": TETO[size].tela,
  } as CSSProperties;
  const numero = (
    <span className="ds-stat-caixa block min-w-0 flex-1">
      <span className={juntar("ds-stat-valor text-foreground", !simples && "break-words")} data-cabe={simples ? "" : undefined} data-heroi={size === "hero" ? "" : undefined} style={estiloDoValor} title={typeof value === "string" ? value : undefined}>
        {typeof value === "string" ? comCentavosApagados(value) : value}
      </span>
    </span>
  );
  const temLinhaDeBaixo = typeof delta === "number" || !!hint || !!deltaLabel;
  const miolo = (
    <>
      <span className="flex min-w-0 items-center">
        {icon && progress ? (
          <RingIcon value={progress.value} max={progress.max} size={40} className="mr-3 max-sm:mr-2">{icon}</RingIcon>
        ) : icon ? (
          <span aria-hidden="true" className={juntar("mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground max-sm:mr-2 max-sm:h-8 max-sm:w-8", destaque ? "bg-foreground/10" : "bg-muted")}>
            {icon}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 items-center text-[13px] font-medium leading-5 text-muted-foreground max-sm:leading-4">
          {/* Celular: o rótulo quebra em até 2 linhas em vez de cortar ("Precisa de vo…"). */}
          <span className="min-w-0 sm:truncate max-sm:line-clamp-2">{label}</span>
          {help && <HelpTooltip className="ml-1">{help}</HelpTooltip>}
        </span>
        {corner && <span className="ml-2 flex shrink-0 items-center">{corner}</span>}
      </span>
      <span className={juntar("flex min-w-0 items-end", icon ? "mt-5" : "mt-4")}>
        {numero}
        {unit && <span className="mb-1.5 ml-2 inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-[11px] font-medium leading-none text-muted-foreground">{unit}</span>}
        {chart && chartPosition === "side" && <span className="ml-4 block w-[38%] min-w-[64px] max-w-[140px] shrink-0 pb-1">{chart}</span>}
      </span>
      {temLinhaDeBaixo && (
        <span className="mt-2.5 flex min-w-0 items-center">
          {typeof delta === "number" && <DeltaChip value={delta} invert={invertDelta} label={typeof deltaLabel === "string" ? deltaLabel : undefined} />}
          {(hint || (deltaLabel && typeof delta !== "number")) && (
            <span className={juntar("min-w-0 text-[12px] leading-4 text-muted-foreground line-clamp-2", typeof delta === "number" && "ml-2")}>{hint || deltaLabel}</span>
          )}
        </span>
      )}
      {chart && chartPosition === "bottom" && <span className="mt-auto block min-w-0 pt-5">{chart}</span>}
    </>
  );
  // Faixa de ação no pé (v4): o cartão não é link inteiro; a faixa é o alvo.
  if (footer && !to && !onClick) {
    const classeDoPe = juntar("mt-auto flex h-10 w-full min-w-0 items-center justify-between rounded-b-[inherit] bg-foreground/[0.04] px-4 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.08] sm:px-6", foco);
    const seta = (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="ml-2 h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" /></svg>
    );
    return (
      <div className={juntar(base, "p-0 sm:p-0")} data-stat-card={tipo}>
        <div className="flex min-w-0 flex-1 flex-col p-4 pb-4 sm:p-6 sm:pb-5">{miolo}</div>
        {footer.to ? (
          <Link to={footer.to} className={classeDoPe}><span className="min-w-0 truncate">{footer.label}</span>{seta}</Link>
        ) : (
          <button type="button" onClick={footer.onClick} className={classeDoPe}><span className="min-w-0 truncate">{footer.label}</span>{seta}</button>
        )}
      </div>
    );
  }
  if (to) return <Link to={to} className={base} data-stat-card={tipo}>{miolo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={juntar(base, "w-full")} data-stat-card={tipo}>{miolo}</button>;
  return <div className={base} data-stat-card={tipo}>{miolo}</div>;
}

/**
 * Fileira de cartões de indicador. Menos coisa por linha (rodada ousada):
 * 2 colunas no celular e no tablet, e só chega a `cols` quando há largura
 * para o número grande respirar (4 a partir de 1280 px; 5 e 6 de 1440 px).
 */
export function StatGrid({ cols = 4, className = "", children, label }: { cols?: 2 | 3 | 4 | 5 | 6; className?: string; children: ReactNode; label?: string }) {
  const classes: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 xl:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-3 desk:grid-cols-5",
    6: "grid-cols-2 lg:grid-cols-3 desk:grid-cols-6",
  };
  return (
    <div role={label ? "group" : undefined} aria-label={label} className={juntar("grid min-w-0 gap-2.5 sm:gap-4", classes[cols], className)}>
      {children}
    </div>
  );
}

/**
 * Números-resumo SEM cartão (v4, como nas referências): rótulo miúdo apagado em
 * cima, número leve embaixo, lado a lado no cabeçalho da tela. Alternativa à
 * fileira de cartões em tela de trabalho (Kanban, Esteira, Estúdio). No celular
 * rola por dentro, nunca empurra a página.
 */
export function StatTrio({ items, label, className = "" }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode; to?: string } | false | null | undefined>; label?: string; className?: string }) {
  const lista = items.filter(Boolean) as Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode; to?: string }>;
  if (lista.length === 0) return null;
  return (
    <div role="group" aria-label={label} data-stat-trio="" className={juntar("scrollbar-hidden flex min-w-0 max-w-full items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain", className)}>
      {lista.map((item, i) => {
        const corpo = (
          <>
            <span className="block whitespace-nowrap text-[11px] font-medium leading-4 text-muted-foreground">{item.label}</span>
            <span className="mt-0.5 flex items-baseline whitespace-nowrap text-[24px] font-medium leading-8 tracking-[-0.03em] tabular-nums text-foreground">
              {item.value}
              {item.hint && <span className="ml-1.5 text-[12px] font-normal leading-4 tracking-normal text-muted-foreground">{item.hint}</span>}
            </span>
          </>
        );
        return (
          <div key={i} className={juntar("flex shrink-0 flex-col justify-center", i > 0 && "ml-6 border-l border-border pl-6 sm:ml-8 sm:pl-8")}>
            {item.to ? <Link to={item.to} className={juntar("toque-compacto block rounded-md", foco)}>{corpo}</Link> : corpo}
          </div>
        );
      })}
    </div>
  );
}
