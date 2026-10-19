import { Panel, useReactFlow } from "@xyflow/react";
import { Lock, LockOpen, Map as IconeDoMapa, Minus, Plus, Scan } from "lucide-react";
import { botao, juntar } from "@/components/sistema";

/**
 * Controles do quadro numa pílula vertical flutuante: aumentar, diminuir,
 * ajustar à tela, travar (não move nem liga) e mini-mapa. Cores do tema
 * (fundo do popover, borda e texto do sistema): aparece no claro e no escuro.
 */
export default function ControlesDoQuadro({ travado, onTravar, mapa, onMapa }: { travado: boolean; onTravar: (v: boolean) => void; mapa: boolean; onMapa: (v: boolean) => void }) {
  const rf = useReactFlow();
  const acao = juntar(botao.icone, "h-8 w-8 rounded-full");
  const tentar = (fn: () => unknown) => {
    try {
      void fn();
    } catch {
      /* quadro ainda sem medida */
    }
  };
  return (
    <Panel position="bottom-left" className="!m-3">
      <div
        role="toolbar"
        aria-label="Controles do quadro"
        aria-orientation="vertical"
        className="nodrag nopan flex flex-col items-center rounded-full border border-border bg-popover p-1 text-popover-foreground"
        style={{ boxShadow: "0 6px 20px -8px rgba(0,0,0,0.35)" }}
        data-controles-do-quadro=""
      >
        <button type="button" className={acao} onClick={() => tentar(() => rf.zoomIn({ duration: 200 }))} aria-label="Aumentar" title="Aumentar">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={acao} onClick={() => tentar(() => rf.zoomOut({ duration: 200 }))} aria-label="Diminuir" title="Diminuir">
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={acao} onClick={() => tentar(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }))} aria-label="Ajustar à tela" title="Ajustar à tela">
          <Scan className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="my-0.5 h-px w-4 bg-border" aria-hidden="true" />
        <button
          type="button"
          className={juntar(acao, travado && "bg-muted text-foreground")}
          onClick={() => onTravar(!travado)}
          aria-pressed={travado}
          aria-label={travado ? "Destravar o quadro" : "Travar o quadro"}
          title={travado ? "Destravar o quadro (mover e ligar de novo)" : "Travar o quadro (não move nem liga)"}
        >
          {travado ? <Lock className="h-4 w-4" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={juntar(acao, mapa && "bg-muted text-foreground")}
          onClick={() => onMapa(!mapa)}
          aria-pressed={mapa}
          aria-label={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
          title={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
        >
          <IconeDoMapa className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </Panel>
  );
}
