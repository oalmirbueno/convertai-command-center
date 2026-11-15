import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { foco, juntar, superficie } from "@/components/sistema/estilos";
import HelpTooltip from "./HelpTooltip";

/**
 * Seção que recolhe, do jeito leve: a linha do título inteira é o botão, a
 * seta gira, a contagem fica numa pílula e o conteúdo abre e fecha com a
 * altura deslizando (sem pulo). Fechado, o conteúdo sai da navegação por
 * teclado e do leitor de tela.
 *
 * `storageKey`: lembra aberto/fechado por pessoa e rota (sair e voltar mantém).
 * Sem ela, o estado vive só enquanto a tela está aberta. Controlado: passe
 * `open` e `onOpenChange`.
 */
export default function Collapsible({
  title,
  count,
  summary,
  help,
  actions,
  icon,
  defaultOpen = true,
  open,
  onOpenChange,
  storageKey,
  divider = false,
  card = false,
  className = "",
  bodyClassName = "",
  children,
  ...rest
}: {
  title: ReactNode;
  /** Contagem na pílula ao lado do título. */
  count?: number;
  /** Linha curta que aparece ao lado do título só quando está fechado. */
  summary?: ReactNode;
  help?: ReactNode;
  /** Ações à direita (ficam fora do botão; somem quando fechado). */
  actions?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  storageKey?: string;
  /** Linha fina em cima (entre seções vizinhas). */
  divider?: boolean;
  /** Dentro de um cartão próprio. */
  card?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const id = useId();
  const [fechadoGuardado, setFechadoGuardado] = useRecolhido(storageKey || `ds-collapsible:${id}`, !defaultOpen);
  const [abertoLocal, setAbertoLocal] = useState(defaultOpen);
  const aberto = open !== undefined ? open : storageKey ? !fechadoGuardado : abertoLocal;
  const alternar = () => {
    const novo = !aberto;
    if (open === undefined) {
      if (storageKey) setFechadoGuardado(!novo);
      else setAbertoLocal(novo);
    }
    if (onOpenChange) onOpenChange(novo);
  };
  // Aberto e parado: nada cortado (anel de foco, sombra, menu). Durante o movimento e fechado: cortado.
  const [assentado, setAssentado] = useState(aberto);
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    setAssentado(false);
    if (!aberto) return;
    const t = window.setTimeout(() => setAssentado(true), 300);
    return () => window.clearTimeout(t);
  }, [aberto]);

  return (
    <section
      className={juntar("min-w-0", card && superficie.painel, divider && !card && "border-t border-border pt-4", className)}
      data-collapsible={aberto ? "open" : "closed"}
      {...rest}
    >
      <div className={juntar("flex min-w-0 items-center", card && "px-4 py-3 sm:px-5")}>
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          aria-controls={`${id}-corpo`}
          className={juntar("group relative -left-1.5 flex min-w-0 flex-1 items-center rounded-full py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-muted", foco)}
        >
          <ChevronDown className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out", aberto ? "" : "-rotate-90")} aria-hidden="true" />
          {icon && <span aria-hidden="true" className="mr-1.5 inline-flex shrink-0 text-muted-foreground">{icon}</span>}
          <span className="min-w-0 truncate text-[15px] font-semibold leading-[22px] tracking-[-0.01em] text-foreground">{title}</span>
          {typeof count === "number" && (
            <span className="ml-2 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground group-hover:bg-background">{count}</span>
          )}
          {!aberto && summary ? <span className="ml-2 min-w-0 shrink-[4] truncate text-[12px] text-muted-foreground">{summary}</span> : null}
        </button>
        {help && aberto && <HelpTooltip className="ml-1 shrink-0">{help}</HelpTooltip>}
        {actions && aberto && <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-2">{actions}</div>}
      </div>
      <div
        id={`${id}-corpo`}
        className="grid min-w-0 transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ gridTemplateRows: aberto ? "1fr" : "0fr", opacity: aberto ? 1 : 0 }}
        aria-hidden={aberto ? undefined : true}
        {...(aberto ? {} : ({ inert: "" } as Record<string, string>))}
      >
        <div className={juntar("min-h-0 min-w-0", assentado && aberto ? "" : "overflow-hidden", !aberto && "invisible")}>
          <div className={juntar("min-w-0", card ? "px-4 pb-4 sm:px-5 sm:pb-5" : "pt-2 sm:pt-3", bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}
