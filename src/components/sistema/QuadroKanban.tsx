import type { ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import Etapas, { type ItemDeEtapa } from "./Etapas";
import RegiaoRolavel from "./RegiaoRolavel";
import { foco, juntar, texto } from "./estilos";

/**
 * O quadro do painel (04/11/2026, dono: "os kanban do freela e do crm idênticos, sem o espaço vazio embaixo").
 * Colunas, rolagem, arrasto e celular moram aqui; cada funil só diz o que vai dentro do cartão.
 * No computador as colunas vão até o pé da área; no celular é uma etapa por vez.
 */

/** O cartão: mesma moldura, mesmo arrasto e o mesmo aviso nos dois funis. */
export const classesDoCartao = (arrastando: boolean, alerta = false) =>
  juntar(
    "w-full cursor-grab rounded-md border bg-card p-2.5 text-left transition-colors active:cursor-grabbing max-sm:rounded-lg max-sm:p-3",
    foco,
    arrastando && "opacity-40",
    alerta ? "border-warning/50" : "border-border hover:border-muted-foreground/30",
  );

export default function QuadroKanban({
  aoIniciar, aoTerminar, aoCancelar, etapas, etapaNoCelular, aoEscolherEtapa, fantasma, children,
}: {
  aoIniciar: (evento: DragStartEvent) => void;
  aoTerminar: (evento: DragEndEvent) => void;
  aoCancelar?: () => void;
  etapas: ItemDeEtapa[];
  etapaNoCelular: string;
  aoEscolherEtapa: (etapa: string) => void;
  /** O cartão na mão enquanto arrasta. */
  fantasma?: { titulo: string; apoio?: string | null } | null;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DndContext sensors={sensors} onDragStart={aoIniciar} onDragEnd={aoTerminar} onDragCancel={aoCancelar}>
      <div data-quadro-kanban="" className="relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        {/* Celular: a faixa gruda no topo enquanto a lista rola, de ponta a ponta e com toque de 44 px. */}
        <Etapas
          className="sticky top-0 z-10 -mx-4 mb-2 border-b border-border bg-background px-4 sm:hidden [&_button]:h-11"
          rotulo="Etapas do funil"
          itens={etapas}
          valor={etapaNoCelular}
          onEscolher={aoEscolherEtapa}
        />
        <div className="min-w-0 sm:-mx-1 sm:flex sm:overflow-x-auto sm:px-1 lg:min-h-0 lg:flex-1 sm:[&>*+*]:ml-3 [scrollbar-width:thin]">
          {children}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {fantasma && (
          <div className="w-[230px] rotate-2 rounded-md border border-primary bg-card p-2.5 shadow-sm">
            <p className="truncate text-[13px] font-medium text-foreground">{fantasma.titulo}</p>
            {fantasma.apoio && <p className={juntar(texto.auxiliar, "truncate")}>{fantasma.apoio}</p>}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export function ColunaDoQuadro({
  id, rotulo, ajuda, contagem, resumo, visivelNoCelular, arrastandoAlgo, memoria, vazio, children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  contagem: number;
  /** A linha de valores embaixo do nome. */
  resumo: string;
  visivelNoCelular: boolean;
  arrastandoAlgo: boolean;
  /** Chave da posição da rolagem desta coluna. */
  memoria: string;
  vazio?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={rotulo}
      data-coluna-do-quadro={id}
      className={juntar(
        visivelNoCelular ? "flex" : "hidden",
        "min-h-[12rem] w-full min-w-0 flex-col rounded-lg border p-1.5 transition-colors sm:flex sm:w-[260px] sm:shrink-0 lg:min-h-0 lg:w-auto lg:min-w-[232px] lg:flex-1 lg:basis-0",
        "max-sm:min-h-0 max-sm:p-0",
        isOver ? "border-primary bg-primary/[0.06]" : arrastandoAlgo ? "border-dashed border-border" : "border-transparent",
      )}
    >
      {/* No celular o nome e a contagem já estão nas Etapas logo acima. */}
      <div className="hidden h-7 shrink-0 items-center px-1 sm:flex">
        <h3 title={ajuda} className={juntar(texto.rotulo, "min-w-0 truncate text-foreground")}>{rotulo}</h3>
        <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{contagem}</span>
      </div>
      <p className={juntar(texto.auxiliar, "shrink-0 truncate px-1 tabular-nums max-sm:hidden")}>{resumo}</p>
      {contagem === 0 && <p className={juntar(texto.auxiliar, "py-8 text-center sm:hidden")}>{vazio || "Nada nesta etapa."}</p>}
      {/* lg:pb-12: só existe no fim da rolagem, para o botão flutuante do painel não cobrir o último cartão. */}
      <RegiaoRolavel rotulo={`${rotulo}: lista`} memoria={memoria} className="mt-2 space-y-1.5 lg:pb-12 lg:pr-1 max-sm:mt-0 max-sm:space-y-2">
        {children}
      </RegiaoRolavel>
    </section>
  );
}
