import type { ReactNode } from "react";
import { EstadoVazio } from "@/components/sistema/Estados";

/** Vazio: ícone discreto num círculo, título curto, uma linha e a ação que resolve. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  plain,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Versão de uma linha, para dentro de lista e cartão. */
  compact?: boolean;
  /** Sem a zona hachurada em volta (quando já está dentro de um bloco com fundo). */
  plain?: boolean;
  className?: string;
}) {
  if (compact || plain) return <EstadoVazio icone={icon} titulo={title} descricao={description} acao={action} compacto={compact} className={className} />;
  // v4: o vazio é uma zona hachurada (como nas referências), com o ícone num círculo, a frase e UMA ação.
  return (
    <div data-empty-state="" className={["ds-hatch min-w-0 rounded-lg", className].filter(Boolean).join(" ")}>
      <EstadoVazio icone={icon} titulo={title} descricao={description} acao={action} className="py-10 [&>div:first-child]:bg-card [&>div:first-child]:text-foreground [&>div:first-child]:shadow-card" />
    </div>
  );
}
