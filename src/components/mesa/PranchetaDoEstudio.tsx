import { useEffect, useState, type ReactNode } from "react";
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
import { Clock, GripVertical, Loader2 } from "lucide-react";
import { blocosDoTexto, caixaDaZona, ESCALA_DO_PAPEL, zonaPadrao } from "@/lib/mesa/layout";
import { ImagemDaMesa } from "./MesaContexto";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * Prancheta do Estúdio: todas as lâminas do item lado a lado, no tamanho
 * real de 4:5 (altura calculada, sem aspect-ratio). Lâmina sem arte mostra o
 * esqueleto do layout (zona do texto, hierarquia e margens de segurança), com
 * as mesmas posições que o gerador recebe. A capa leva o selo "Capa".
 * Carrossel contínuo aparece colado, como panorama, numa faixa só.
 *
 * Passar o mouse numa lâmina a eleva e mostra as ações rápidas (gerar ou
 * refazer, ajustar, versões); no toque, as ações aparecem na lâmina
 * escolhida. Gerando, a lâmina mostra o cronômetro no lugar, sem travar as
 * outras. Dá para arrastar pela alça para mudar a ordem (a tela confirma).
 */

type Props = {
  cards: CardDaDirecao[];
  ultimas: Map<number, CardGerado>;
  selecionado: number | null;
  onSelecionar: (ordem: number) => void;
  /** ordem -> momento em que a geração começou (para o cronômetro). */
  gerando: Record<number, number>;
  /** Lâminas esperando a vez no "Gerar todas". */
  fila?: number[];
  infinito: boolean;
  largura: number;
  podeReordenar: boolean;
  onReordenar: (ordens: number[]) => void;
  /** Ações rápidas da lâmina (aparecem no hover ou na lâmina escolhida). */
  acoes?: (card: CardDaDirecao, versao: CardGerado | undefined) => ReactNode;
};

export function Cronometro({ desde }: { desde: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((agora - desde) / 1000));
  return <span>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 < 10 ? "0" : ""}${s % 60} s`}</span>;
}

function Esqueleto({ card, total, largura }: { card: CardDaDirecao; total: number; largura: number }) {
  const capa = card.funcao === "capa" || card.ordem === 1;
  const zona = (card.layout && card.layout.zona_texto) || zonaPadrao(card.funcao, card.ordem, total);
  const caixa = caixaDaZona(zona, capa);
  const blocos = card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato || "", card.funcao);
  const alinhamento = (card.layout && card.layout.alinhamento) || (zona === "centro" ? "centro" : "esquerda");
  const alinhar = alinhamento === "centro" ? "items-center text-center" : alinhamento === "direita" ? "items-end text-right" : "items-start text-left";
  return (
    <div className="absolute inset-0 bg-secondary">
      {/* margens de segurança */}
      <div className="absolute border border-dashed border-muted-foreground/30" style={{ left: "8.3%", right: "8.3%", top: "7.4%", bottom: "7.9%" }} />
      <div
        className={`absolute flex flex-col justify-center overflow-hidden rounded-sm bg-background p-[2%] ${alinhar}`}
        style={{ left: `${caixa.x0}%`, width: `${caixa.x1 - caixa.x0}%`, top: `${caixa.y0}%`, height: `${caixa.y1 - caixa.y0}%` }}
      >
        {blocos.slice(0, 5).map((b, i) => {
          const escala = ESCALA_DO_PAPEL[b.papel] || 0.3;
          return (
            <span
              key={i}
              className={`block max-w-full leading-[1.05] text-foreground/80 [overflow-wrap:anywhere] ${b.papel === "headline" || b.papel === "numero" ? "font-bold" : ""}`}
              style={{ fontSize: Math.max(6, Math.round(largura * 0.11 * escala)), marginTop: i ? "3%" : 0 }}
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
  naFila,
  onSelecionar,
  largura,
  arrastavel,
  colado,
  primeira,
  ultima,
  acoes,
}: {
  card: CardDaDirecao;
  total: number;
  versao: CardGerado | undefined;
  ativo: boolean;
  desde: number | undefined;
  naFila: boolean;
  onSelecionar: () => void;
  largura: number;
  arrastavel: boolean;
  colado: boolean;
  primeira: boolean;
  ultima: boolean;
  acoes?: ReactNode;
}) {
  const id = String(card.ordem);
  const arrasto = useDraggable({ id, disabled: !arrastavel });
  const alvo = useDroppable({ id });
  const deslocamento = arrasto.transform ? `translate3d(${arrasto.transform.x}px, ${arrasto.transform.y}px, 0)` : undefined;
  const capa = card.ordem === 1 || card.funcao === "capa";
  const altura = Math.round(largura * 1.25);
  const cantos = colado ? `${primeira ? "rounded-l-xl" : ""} ${ultima ? "rounded-r-xl" : ""}` : "rounded-xl";

  return (
    <div
      ref={alvo.setNodeRef}
      className={`relative shrink-0 ${colado ? "" : "mr-5"} ${alvo.isOver && !arrasto.isDragging ? "rounded-xl ring-2 ring-primary" : ""}`}
      style={{ width: largura }}
    >
      <div
        ref={arrasto.setNodeRef}
        style={{ transform: deslocamento, zIndex: arrasto.isDragging ? 30 : undefined }}
        className={`group relative ${arrasto.isDragging ? "opacity-90" : ""}`}
      >
        {capa && (
          <span className="absolute -top-2.5 left-2.5 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-md">
            Capa
          </span>
        )}
        <div
          className={`relative overflow-hidden bg-card transition-all duration-200 ${cantos} ${
            colado
              ? ""
              : `border shadow-sm ${ativo ? "border-primary shadow-lg" : "border-border group-hover:-translate-y-1 group-hover:border-primary/60 group-hover:shadow-xl"}`
          } ${arrasto.isDragging ? "shadow-2xl" : ""}`}
        >
          <button
            type="button"
            onClick={onSelecionar}
            aria-label={`Lâmina ${card.ordem}${capa ? ", capa" : ""}`}
            aria-pressed={ativo}
            style={{ height: altura }}
            className="relative block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            {versao ? (
              <ImagemDaMesa caminho={versao.storage_path} alt={`Lâmina ${card.ordem}`} className="absolute inset-0 h-full w-full" />
            ) : (
              <Esqueleto card={card} total={total} largura={largura} />
            )}
            {/* moldura de destaque: borda, sem texto por cima da arte */}
            {(ativo || colado) && (
              <span
                className={`pointer-events-none absolute inset-0 ${cantos} ${
                  ativo ? "border-[3px] border-primary" : "border-2 border-transparent group-hover:border-primary/60"
                }`}
              />
            )}
            {desde !== undefined && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                <span className="flex items-center rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px] font-medium text-foreground shadow-lg">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-primary" />
                  gerando <span className="ml-1 tabular-nums"><Cronometro desde={desde} /></span>
                </span>
              </span>
            )}
            {desde === undefined && naFila && (
              <span className="absolute inset-x-0 top-0 flex justify-center pt-3">
                <span className="flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground shadow">
                  <Clock className="mr-1 h-3 w-3" /> na fila
                </span>
              </span>
            )}
          </button>
          {acoes && desde === undefined && (
            <div
              className={`absolute inset-x-0 bottom-0 z-10 flex justify-center p-2 transition-opacity duration-150 ${
                ativo ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
              }`}
            >
              <div className="flex max-w-full flex-wrap items-center justify-center rounded-xl border border-border bg-background p-1 shadow-xl">{acoes}</div>
            </div>
          )}
        </div>
        <div className={`mt-2 flex items-center px-0.5 ${colado ? "px-2" : ""}`}>
          <span className="min-w-0 flex-1 truncate text-[11.5px]">
            <span className={`font-semibold ${ativo ? "text-primary" : "text-foreground"}`}>{card.ordem}</span>
            <span className="text-muted-foreground">
              {" "}· {capa ? "capa" : card.funcao === "cta" ? "fechamento" : "conteúdo"}
              {versao ? ` · v${versao.versao}` : " · sem arte"}
            </span>
          </span>
          {arrastavel && (
            <span
              {...arrasto.listeners}
              {...arrasto.attributes}
              className="ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
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

export default function PranchetaDoEstudio({ cards, ultimas, selecionado, onSelecionar, gerando, fila = [], infinito, largura, podeReordenar, onReordenar, acoes }: Props) {
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
      {/* Rola dentro da própria caixa: a página nunca rola para o lado. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-4 pt-4">
        <div className={`inline-flex ${infinito ? "rounded-xl shadow-md" : ""}`}>
          {cards.map((c, i) => (
            <Lamina
              key={c.ordem}
              card={c}
              total={cards.length}
              versao={ultimas.get(c.ordem)}
              ativo={selecionado === c.ordem}
              desde={gerando[c.ordem]}
              naFila={fila.indexOf(c.ordem) >= 0}
              onSelecionar={() => onSelecionar(c.ordem)}
              largura={largura}
              arrastavel={podeReordenar}
              colado={infinito}
              primeira={i === 0}
              ultima={i === cards.length - 1}
              acoes={acoes ? acoes(c, ultimas.get(c.ordem)) : undefined}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}
