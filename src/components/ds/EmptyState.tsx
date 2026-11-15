import type { ReactNode } from "react";
import { EstadoVazio } from "@/components/sistema/Estados";

/** Vazio: ícone discreto num círculo, título curto, uma linha e a ação que resolve. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Versão de uma linha, para dentro de lista e cartão. */
  compact?: boolean;
  className?: string;
}) {
  return <EstadoVazio icone={icon} titulo={title} descricao={description} acao={action} compacto={compact} className={className} />;
}
