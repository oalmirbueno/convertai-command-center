import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Peças de layout compartilhadas por TODAS as telas (cliente, equipe, admin).
 *
 * A identidade continua a mesma: mesmas cores, mesma marca, mesmo clima. O que
 * muda é o esqueleto. Antes cada página inventava seu próprio título, seu
 * próprio respiro e seu próprio card, e o resultado era buraco branco, cartão
 * mais alto que o outro e nada alinhado. Aqui ficam as regras únicas:
 *
 * - PageHeader: todo topo de página igual (título, explicação, ações).
 * - PageSection: bloco com título curto e o mesmo respiro em todo lugar.
 * - CardGrid: grade que estica os cards para a MESMA altura (fim do buraco).
 * - SurfaceCard: o cartão padrão, sempre ocupando a altura toda da célula.
 */

/** Respiro vertical único entre os blocos de uma página. */
export const PAGE_STACK = "space-y-6";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="truncate text-xl font-semibold leading-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function PageSection({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {title}
              </h2>
            )}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground/80">{hint}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Grade de cards. `auto-rows-fr` + `items-stretch` fazem toda a linha ter a
 * mesma altura: é isso que acaba com o card menor que o outro e o espaço
 * branco sobrando embaixo.
 */
const GRID_COLUMNS: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
};

export function CardGrid({
  columns = 3,
  children,
  className,
}: {
  columns?: 2 | 3 | 4 | 5;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid auto-rows-fr items-stretch gap-3",
        GRID_COLUMNS[columns] || GRID_COLUMNS[3],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Cartão padrão: mesma borda, mesmo raio, mesma altura da célula. */
export const SurfaceCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }
>(({ className, padded = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex h-full min-w-0 flex-col rounded-xl border border-border bg-card",
      padded && "p-5",
      className,
    )}
    {...props}
  />
));
SurfaceCard.displayName = "SurfaceCard";

/** Vazio explicado, no lugar de um buraco branco sem resposta. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.FC<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && <Icon className="h-6 w-6 text-muted-foreground/60" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
