import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, Loader2 } from "lucide-react";
import { blocosDoTexto, caixaDaZona, ESCALA_DO_PAPEL, zonaPadrao } from "@/lib/mesa/layout";
import { ImagemDaMesa } from "./MesaContexto";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * Prancheta do Estúdio: todas as lâminas do item lado a lado, no tamanho
 * real de 4:5. Lâmina sem arte mostra o esqueleto do layout (zona do texto,
 * hierarquia e margens de segurança), com as mesmas posições que o gerador
 * recebe. Carrossel contínuo aparece colado, como panorama. Dá para arrastar
 * para mudar a ordem (a tela confirma antes de gravar).
 */

type Props = {
  cards: CardDaDirecao[];
  ultimas: Map<number, CardGerado>;
  selecionado: number | null;
  onSelecionar: (ordem: number) => void;
  /** ordem -> momento em que a geração começou (para o cronômetro). */
  gerando: Record<number, number>;
  infinito: boolean;
  largura: number;
  podeReordenar: boolean;
  onReordenar: (ordens: number[]) => void;
};

function Cronometro({ desde }: { desde: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span>{Math.max(0, Math.round((agora - desde) / 1000))} s</span>;
}

function Esqueleto({ card, total, largura }: { card: CardDaDirecao; total: number; largura: number }) {
  const capa = card.funcao === "capa" || card.ordem === 1;
  const zona = (card.layout && card.layout.zona_texto) || zonaPadrao(card.funcao, card.ordem, total);
  const caixa = caixaDaZona(zona, capa);
  const blocos = card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato || "", card.funcao);
  const alinhamento = (card.layout && card.layout.alinhamento) || (zona === "centro" ? "centro" : "esquerda");
  const alinhar = alinhamento === "centro" ? "items-center text-center" : alinhamento === "direita" ? "items-end text-right" : "items-start text-left";
  return (
    <div className="absolute inset-0 bg-secondary/40">
      {/* margens de segurança */}
      <div className="absolute border border-dashed border-border" style={{ left: "8.3%", right: "8.3%", top: "7.4%", bottom: "7.9%" }} />
      <div
        className={`absolute flex flex-col justify-center gap-[3%] overflow-hidden rounded-sm bg-primary/[0.06] p-[2%] ${alinhar}`}
        style={{ left: `${caixa.x0}%`, width: `${caixa.x1 - caixa.x0}%`, top: `${caixa.y0}%`, height: `${caixa.y1 - caixa.y0}%` }}
      >
        {blocos.slice(0, 5).map((b, i) => {
          const escala = ESCALA_DO_PAPEL[b.papel] || 0.3;
          return (
            <span
              key={i}
              className={`block max-w-full leading-[1.05] text-foreground/80 [overflow-wrap:anywhere] ${b.papel === "headline" || b.papel === "numero" ? "font-bold" : ""}`}
              style={{ fontSize: Math.max(6, Math.round(largura * 0.11 * escala)) }}
            >
              {b.texto.split("\n").join(" ")}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Lamina({
  card,
  total,
  versao,
  ativo,
  desde,
  onSelecionar,
  largura,
  arrastavel,
  colado,
}: {
  card: CardDaDirecao;
  total: number;
  versao: CardGerado | undefined;
  ativo: boolean;
  desde: number | undefined;
  onSelecionar: () => void;
  largura: number;
  arrastavel: boolean;
  colado: boolean;
}) {
  const id = String(card.ordem);
  const arrasto = useDraggable({ id, disabled: !arrastavel });
  const alvo = useDroppable({ id });
  const deslocamento = arrasto.transform ? `translate3d(${arrasto.transform.x}px, ${arrasto.transform.y}px, 0)` : undefined;
  return (
    <div
      ref={alvo.setNodeRef}
      className={`relative shrink-0 ${colado ? "" : "mr-3 rounded-lg"} ${alvo.isOver && !arrasto.isDragging ? "ring-2 ring-primary/60" : ""}`}
      style={{ width: largura }}
    >
      <div
        ref={arrasto.setNodeRef}
        style={{ transform: deslocamento, zIndex: arrasto.isDragging ? 20 : undefined }}
        className={`relative ${arrasto.isDragging ? "opacity-80 shadow-xl" : ""}`}
      >
        <button
          type="button"
          onClick={onSelecionar}
          aria-label={`Lâmina ${card.ordem}`}
          aria-pressed={ativo}
          style={{ height: Math.round(largura * 1.25) }}
          className={`relative block w-full overflow-hidden border bg-card text-left ${
            colado ? "" : "rounded-lg"
          } ${ativo ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40"}`}
        >
          {versao ? (
            <ImagemDaMesa caminho={versao.storage_path} alt={`Lâmina ${card.ordem}`} className="absolute inset-0 h-full w-full" />
          ) : (
            <Esqueleto card={card} total={total} largura={largura} />
          )}
          {desde !== undefined && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 text-[11px] font-medium backdrop-blur-[2px]">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              gerando <Cronometro desde={desde} />
            </span>
          )}
        </button>
        <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {card.ordem}. {card.funcao || "conteúdo"}
            {versao ? ` · v${versao.versao}` : " · sem arte"}
          </span>
          {arrastavel && (
            <span
              {...arrasto.listeners}
              {...arrasto.attributes}
              className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary active:cursor-grabbing"
              aria-label={`Arrastar a lâmina ${card.ordem}`}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PranchetaDoEstudio({ cards, ultimas, selecionado, onSelecionar, gerando, infinito, largura, podeReordenar, onReordenar }: Props) {
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const aoSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ordens = cards.map((c) => c.ordem);
    const de = ordens.indexOf(Number(e.active.id));
    const para = ordens.indexOf(Number(e.over.id));
    if (de < 0 || para < 0) return;
    const nova = ordens.slice();
    const movido = nova.splice(de, 1)[0];
    nova.splice(para, 0, movido);
    onReordenar(nova);
  };

  return (
    <DndContext sensors={sensores} onDragEnd={aoSoltar}>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex">
          {cards.map((c) => (
            <Lamina
              key={c.ordem}
              card={c}
              total={cards.length}
              versao={ultimas.get(c.ordem)}
              ativo={selecionado === c.ordem}
              desde={gerando[c.ordem]}
              onSelecionar={() => onSelecionar(c.ordem)}
              largura={largura}
              arrastavel={podeReordenar}
              colado={infinito}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}
