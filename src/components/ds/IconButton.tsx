import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { foco, juntar } from "@/components/sistema/estilos";

const TAMANHO = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-11 w-11",
} as const;

const TOM = {
  /** Círculo suave (cinza do tema): busca, sino, ajustes, "abrir". */
  soft: "bg-muted text-foreground hover:bg-foreground hover:text-background",
  /** Círculo de tinta (preto no claro, claro no escuro): o ativo, o "+". */
  ink: "bg-foreground text-background hover:bg-foreground/85",
  /** Círculo na cor da marca, com o ícone quase preto. */
  accent: "bg-accent-solid text-on-accent hover:bg-accent-solid/85",
  /** Só o contorno. */
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  /** Sem fundo até passar o mouse. */
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

type Comum = {
  /** Nome do botão para leitor de tela e dica (obrigatório: o botão não tem texto). */
  label: string;
  icon: ReactNode;
  size?: keyof typeof TAMANHO;
  tone?: keyof typeof TOM;
  /** Bolinha de aviso no canto (algo novo). */
  dot?: boolean;
  className?: string;
};

/**
 * Botão só de ícone num círculo com fundo próprio (v4, como nas referências):
 * busca, sino, ajustes, a seta "abrir" do cartão, o par de setas do carrossel.
 * Com `to`, é um link. No celular mantém o tamanho desenhado e ganha a área de
 * toque de 44 px (toque-compacto).
 */
const IconButton = forwardRef<HTMLButtonElement, Comum & { to?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">>(function IconButton(
  { label, icon, size = "md", tone = "soft", dot = false, className = "", to, type, ...rest },
  ref,
) {
  const classe = juntar("toque-compacto relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50", TAMANHO[size], TOM[tone], foco, className);
  const miolo = (
    <>
      <span aria-hidden="true" className="inline-flex [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {dot && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />}
    </>
  );
  if (to) return <Link to={to} aria-label={label} title={label} className={classe} data-icon-button={tone}>{miolo}</Link>;
  return (
    <button ref={ref} type={type || "button"} aria-label={label} title={label} className={classe} data-icon-button={tone} {...rest}>
      {miolo}
    </button>
  );
});

export default IconButton;

/** A seta "abrir" (↗) do canto do cartão. Passe em `icon` do IconButton ou use solta. */
export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={juntar("h-4 w-4", className)} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 11l6-6M6 5h5v5" />
    </svg>
  );
}

/**
 * Barra de ferramentas flutuante (v4): pílula com botões de ícone; o ativo fica
 * no círculo de tinta. Para canvas, estúdio e quadro. Quem chama decide onde
 * ela fica (normalmente `absolute bottom-4 left-1/2 -translate-x-1/2`).
 */
export function FloatingToolbar({
  items,
  label,
  className = "",
}: {
  items: Array<{ key: string; label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onSelect: () => void; separatorBefore?: boolean } | false | null | undefined>;
  /** Nome do grupo para leitor de tela. */
  label: string;
  className?: string;
}) {
  const lista = items.filter(Boolean) as Array<{ key: string; label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onSelect: () => void; separatorBefore?: boolean }>;
  if (lista.length === 0) return null;
  return (
    <div role="toolbar" aria-label={label} data-floating-toolbar="" className={juntar("scrollbar-hidden inline-flex max-w-full items-center overflow-x-auto overflow-y-hidden rounded-full border border-border bg-card p-1 shadow-pop", className)}>
      {lista.map((item) => (
        <span key={item.key} className="flex shrink-0 items-center">
          {item.separatorBefore && <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />}
          <IconButton label={item.label} icon={item.icon} size="sm" tone={item.active ? "ink" : "ghost"} aria-pressed={item.active ? true : undefined} disabled={item.disabled} onClick={item.onSelect} className="h-9 w-9" />
        </span>
      ))}
    </div>
  );
}
