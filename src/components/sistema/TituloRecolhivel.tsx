import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useEstadoDaTela } from "./useEstadoDaTela";
import { foco, juntar } from "./estilos";

/**
 * Recolher um bloco para ganhar espaço (pedido do dono, 28/09: "tudo que não
 * tem negócio de recolher, para a gente sempre organizar espaço quando
 * precisar"). A escolha fica guardada por `chave` (sair e voltar mantém).
 * Começou na Mesa Foto; serve para qualquer bloco do painel.
 */
export function useRecolhido(chave: string, inicial = false): [boolean, (v: boolean) => void] {
  const [recolhido, setRecolhido] = useEstadoDaTela<boolean>(chave, inicial, { validar: (v) => typeof v === "boolean" });
  return [recolhido, setRecolhido];
}

/** O título do bloco vira o botão de recolher: seta que gira e, recolhido, um resumo curto ao lado. */
export default function TituloRecolhivel({
  titulo,
  recolhido,
  onAlternar,
  resumo,
  className = "",
}: {
  titulo: ReactNode;
  recolhido: boolean;
  onAlternar: () => void;
  /** Uma linha que fica à vista com o bloco recolhido (ex.: "35 fotos"). */
  resumo?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={!recolhido}
      title={recolhido ? "Mostrar" : "Recolher"}
      className={juntar("relative -left-1 flex min-w-0 items-center rounded-md px-1 py-0.5 text-left hover:bg-muted", foco, className)}
      data-titulo-recolhivel=""
    >
      <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", recolhido ? "-rotate-90" : "")} aria-hidden="true" />
      {/* 28/09: título numa linha só; quem encolhe primeiro é o resumo (shrink-[4]).
          Deslocado com relative -left-1: margem negativa encolhia a largura medida
          e cortava o título com espaço sobrando. */}
      <span className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">{titulo}</span>
      {recolhido && resumo ? <span className="ml-2 min-w-0 shrink-[4] truncate text-[12px] font-normal text-muted-foreground">{resumo}</span> : null}
    </button>
  );
}
