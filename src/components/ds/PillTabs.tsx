import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { foco, juntar } from "@/components/sistema/estilos";

export interface PillTab<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

/**
 * Abas em pílula (visões de uma tela, períodos, modos). A aba aberta é a
 * pílula escura; as outras são texto. Setas andam entre as abas, Home e End
 * vão para as pontas. No celular a faixa rola para o lado por dentro, nunca
 * empurra a tela.
 *
 * `variant="soft"`: faixa cinza com a aba aberta em cartão (para ficar dentro
 * de um cartão ou de uma barra de controles).
 */
export default function PillTabs<V extends string = string>({
  tabs,
  value,
  onChange,
  label,
  variant = "ink",
  size = "md",
  className = "",
}: {
  tabs: PillTab<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Nome do grupo para leitor de tela. */
  label: string;
  variant?: "ink" | "soft";
  size?: "sm" | "md";
  className?: string;
}) {
  const trilho = useRef<HTMLDivElement>(null);
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0) return;
    const botoes = Array.from(trilho.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') || []);
    if (botoes.length === 0) return;
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    let alvo = atual;
    if (e.key === "ArrowRight") alvo = atual < 0 ? 0 : (atual + 1) % botoes.length;
    if (e.key === "ArrowLeft") alvo = atual <= 0 ? botoes.length - 1 : atual - 1;
    if (e.key === "Home") alvo = 0;
    if (e.key === "End") alvo = botoes.length - 1;
    e.preventDefault();
    botoes[alvo].focus();
    botoes[alvo].click();
  };
  const altura = size === "sm" ? "h-7 px-3 text-[12px]" : "h-8 px-3.5 text-[13px]";
  return (
    <div
      ref={trilho}
      role="tablist"
      aria-label={label}
      onKeyDown={teclas}
      data-pill-tabs={variant}
      className={juntar(
        "scrollbar-hidden inline-flex min-w-0 max-w-full items-center overflow-x-auto overscroll-x-contain",
        variant === "soft" ? "rounded-full bg-muted p-0.5" : "[&>*+*]:ml-1",
        className,
      )}
    >
      {tabs.map((t) => {
        const aberta = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={aberta}
            tabIndex={aberta ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={juntar(
              "toque-compacto inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium transition-all duration-200 disabled:opacity-50",
              altura,
              foco,
              variant === "soft"
                ? aberta
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                : aberta
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.icon && <span aria-hidden="true" className="mr-1.5 inline-flex shrink-0">{t.icon}</span>}
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={juntar(
                  "ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
                  aberta && variant === "ink" ? "bg-black/15 text-primary-foreground" : "bg-muted text-muted-foreground",
                  aberta && variant === "soft" && "bg-muted text-foreground",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
