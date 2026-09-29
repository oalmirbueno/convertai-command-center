import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { botao, foco, juntar, texto, toqueCompacto } from "@/components/sistema";

/**
 * Coluna lateral à ESQUERDA que recolhe para o lado (docs/design/SISTEMA.md 4.3,
 * dono 28/09: "laterais recolhem para o lado"). A AreaDeTrabalho só tem lateral
 * à direita (o agente); a árvore de pastas do Workspace e a lista de clientes do
 * Cofre ficam à esquerda, então repetem aqui a mesma tirinha de 32 px: ícone,
 * nome em pé, sem caixa, só um traço fino do lado do conteúdo.
 *
 * Só aparece de 1024 px para cima (no celular quem faz o papel é o caminho ou o
 * seletor do cabeçalho). Quem chama guarda a escolha (useEstadoDaTela) e troca
 * a coluna da grade: 32 px recolhida.
 */
export function LateralEsquerda({
  rotulo,
  icone,
  recolhida,
  onAlternar,
  acao,
  children,
}: {
  /** Nome da lateral ("Pastas", "Clientes"): título, tirinha e nome dos botões. */
  rotulo: string;
  icone: ReactNode;
  recolhida: boolean;
  onAlternar: () => void;
  /** Algo pequeno à direita do título (antes do botão de recolher). */
  acao?: ReactNode;
  children: ReactNode;
}) {
  const nome = rotulo.toLowerCase();
  if (recolhida) {
    return (
      <aside aria-label={rotulo} className="hidden min-h-0 lg:flex lg:flex-col lg:items-center" data-lateral-recolhida="">
        <button
          type="button"
          onClick={onAlternar}
          aria-label={`Abrir ${nome}`}
          title={`Abrir ${nome}`}
          className={juntar(
            toqueCompacto,
            "flex h-full w-8 flex-col items-center rounded-md border-r border-border/60 pt-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            foco,
          )}
        >
          <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
            {icone}
          </span>
          <span className="mt-3 text-[11px] font-medium" style={{ writingMode: "vertical-rl" }}>
            {rotulo}
          </span>
        </button>
      </aside>
    );
  }
  return (
    <aside aria-label={rotulo} className="hidden min-h-0 min-w-0 border-r border-border pr-3 lg:flex lg:flex-col" data-lateral="">
      <div className="mb-2 flex min-w-0 shrink-0 items-center pl-2">
        <p className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</p>
        {acao}
        <button
          type="button"
          onClick={onAlternar}
          aria-label={`Recolher ${nome}`}
          title={`Recolher ${nome}`}
          className={juntar(botao.icone, "ml-1 h-6 w-6")}
          data-recolher-lateral=""
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}
