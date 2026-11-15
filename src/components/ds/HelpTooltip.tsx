import type { ReactNode } from "react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * O "?" do painel: guarda a explicação longa fora da tela. Passa o mouse no
 * computador, toca no celular. É o AjudaRecolhida do sistema com nome curto.
 */
export default function HelpTooltip({
  children,
  label,
  title,
  className,
}: {
  /** O texto da explicação. */
  children: ReactNode;
  /** Nome do botão para leitor de tela (padrão "O que é isto?"). */
  label?: string;
  /** Título opcional dentro do balão. */
  title?: string;
  className?: string;
}) {
  return (
    <AjudaRecolhida rotulo={label} titulo={title} className={className}>
      {children}
    </AjudaRecolhida>
  );
}
