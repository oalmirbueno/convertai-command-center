import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { foco, juntar, texto } from "@/components/sistema/estilos";

/**
 * "Mais opções" da Mesa Proposta (frente PRS, 30/09): o avançado mora
 * recolhido embaixo do essencial, com uma linha de estado curta ao lado
 * ("3 pacotes · horas por item"). Nada some: um clique abre e a escolha fica
 * guardada por pessoa (useRecolhido). Recolhido, o conteúdo só fica escondido
 * (continua montado): o que foi digitado lá dentro segue no Salvar da barra.
 */
export default function MaisOpcoes({
  chave,
  rotulo = "Mais opções",
  resumo,
  abertoDeInicio = false,
  children,
  className = "",
}: {
  /** Chave da memória do recolher (ponha o id da proposta quando for dela). */
  chave: string;
  rotulo?: string;
  /** Estado curto do que está lá dentro (aparece fechado e aberto). */
  resumo?: ReactNode;
  abertoDeInicio?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [recolhido, setRecolhido] = useRecolhido(chave, !abertoDeInicio);
  return (
    <div className={juntar("min-w-0", className)} data-mais-opcoes={chave}>
      <button
        type="button"
        onClick={() => setRecolhido(!recolhido)}
        aria-expanded={!recolhido}
        className={juntar("relative -left-1 flex min-w-0 max-w-full items-center rounded-md px-1 py-1 text-left hover:bg-muted", foco)}
      >
        <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", recolhido ? "-rotate-90" : "")} aria-hidden="true" />
        <span className={juntar(texto.corpo, "shrink-0 font-medium")}>{rotulo}</span>
        {resumo ? <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{resumo}</span> : null}
      </button>
      {/* Recolhido só esconde: o que está dentro continua montado (edição não salva não se perde). */}
      <div className="mt-2 min-w-0 space-y-4" hidden={recolhido}>
        {children}
      </div>
    </div>
  );
}
