import type { ReactNode } from "react";
import { juntar } from "@/components/sistema/estilos";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const FUNDO: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  accent: "bg-accent-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  info: "bg-info-soft text-info",
};

const PONTO: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/** Bolinha de estado (tabela, lista, cabeçalho de coluna). */
export function StatusDot({ tone = "neutral", pulse = false, className = "" }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={juntar("inline-block h-1.5 w-1.5 shrink-0 rounded-full", PONTO[tone], pulse && "pulse-dot", className)} />;
}

/**
 * Etiqueta em pílula: estado, contagem, categoria. `dot` põe a bolinha de
 * estado antes do texto; `outline` tira o fundo (só a borda fina).
 */
export default function Chip({
  children,
  tone = "neutral",
  dot = false,
  outline = false,
  icon,
  size = "sm",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  outline?: boolean;
  icon?: ReactNode;
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={juntar(
        "inline-flex min-w-0 max-w-full shrink-0 items-center whitespace-nowrap rounded-full font-medium leading-none tabular-nums",
        size === "md" ? "h-7 px-3 text-[12px]" : "h-[22px] px-2 text-[11px]",
        outline ? "border border-border bg-card text-foreground" : FUNDO[tone],
        className,
      )}
    >
      {dot && <StatusDot tone={tone} className="mr-1.5" />}
      {icon && <span aria-hidden="true" className="mr-1 inline-flex shrink-0">{icon}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * Estado em pílula: fundo suave no tom e a bolinha antes do texto ("Ativo",
 * "Pendente", "Atrasado"). É a etiqueta de estado de linha de lista e de
 * tabela. `pulse` faz a bolinha pulsar (algo acontecendo agora).
 */
export function StatusPill({ children, tone = "neutral", pulse = false, className = "", title }: { children: ReactNode; tone?: Tone; pulse?: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      data-status-pill={tone}
      className={juntar("inline-flex h-6 min-w-0 max-w-full shrink-0 items-center whitespace-nowrap rounded-full pl-2 pr-2.5 text-[12px] font-medium leading-none", FUNDO[tone], tone === "neutral" && "text-muted-foreground", className)}
    >
      <StatusDot tone={tone} pulse={pulse} className="mr-1.5" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * Variação em pílula pequena ao lado de um número ("+12%", "-3"): seta para
 * cima em verde quando melhora, para baixo em vermelho quando piora, neutro
 * quando não mudou. `invert` troca o sentido (custo que cai é bom).
 */
export function DeltaChip({ value, label, invert = false, className = "" }: { value: number; label?: ReactNode; invert?: boolean; className?: string }) {
  const sobe = value > 0;
  const cai = value < 0;
  const bom = invert ? cai : sobe;
  const ruim = invert ? sobe : cai;
  const tone: Tone = bom ? "success" : ruim ? "danger" : "neutral";
  const texto = label !== undefined ? label : `${sobe ? "+" : ""}${String(value).replace(".", ",")}%`;
  return (
    <Chip tone={tone} className={className}>
      <svg aria-hidden="true" viewBox="0 0 10 10" className={juntar("mr-1 inline-block h-2.5 w-2.5 shrink-0", cai && "rotate-180", !sobe && !cai && "hidden")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8.5v-7M2 4.5l3-3 3 3" />
      </svg>
      {texto}
    </Chip>
  );
}
