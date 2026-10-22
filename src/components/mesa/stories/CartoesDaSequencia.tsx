import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Copy, Download, GripVertical, Plus, Trash2 } from "lucide-react";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { noFuso } from "../instagram/calendario-da-grade";
import PreviaDoStory, { IconeDoAdesivo } from "./PreviaDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import {
  filaDoStory,
  imagemDesatualizada,
  imagemDoStory,
  moverNaLista,
  ROTULO_DO_PAPEL,
  SITUACOES,
  type LaminasDoTrabalho,
  type Story,
} from "./storiesApi";

/**
 * As telas da sequência como cartões na lateral (21/10/2026), no padrão do
 * carrossel do Estúdio (PranchetaDoEstudio): a miniatura 9:16, o número e o
 * papel na estrutura (gancho, prova, oferta...), a situação e a hora, a alça
 * de arrastar (mouse, toque ou teclado), duplicar e remover. Coluna ao lado do
 * celular no computador; faixa que rola para o lado por dentro no celular.
 */

const MINIATURA = 54;

/** O estado curto do cartão: a imagem manda enquanto não há arte registrada. */
export function estadoDoCartao(s: Story, laminas: Record<string, LaminasDoTrabalho> | undefined, emAndamento?: boolean): { rotulo: string; tom: string } {
  if (emAndamento) return { rotulo: "Gerando", tom: "bg-primary/10 text-primary" };
  if (s.fundo.tipo === "natural" && !s.fundo.caminho && s.situacao === "rascunho") return { rotulo: "Sem foto", tom: SITUACOES.rascunho.tom };
  const fila = filaDoStory(s, laminas);
  if (fila === "fila" || fila === "rodando") return { rotulo: fila === "fila" ? "Na fila" : "Gerando", tom: "bg-primary/10 text-primary" };
  if (fila === "erro" && !s.file_id) return { rotulo: "Imagem falhou", tom: SITUACOES.falhou.tom };
  if (imagemDesatualizada(s) && !s.publicacao_id) return { rotulo: "Texto mudou", tom: "bg-warning/15 text-warning" };
  if (s.fundo.tipo === "gerada" && !imagemDoStory(s, laminas) && s.situacao === "rascunho") return { rotulo: "Sem imagem", tom: SITUACOES.rascunho.tom };
  return SITUACOES[s.situacao];
}

function Cartao({
  s,
  ativo,
  marca,
  laminas,
  onSelecionar,
  onDuplicar,
  onRemover,
  onBaixar,
  emAndamento,
  arrastavel,
}: {
  s: Story;
  ativo: boolean;
  marca: MarcaDosStories;
  laminas?: Record<string, LaminasDoTrabalho>;
  onSelecionar: () => void;
  onDuplicar: () => void;
  onRemover: () => void;
  onBaixar?: () => void;
  emAndamento?: boolean;
  arrastavel: boolean;
}) {
  const arrasto = useDraggable({ id: s.id, disabled: !arrastavel });
  const alvo = useDroppable({ id: s.id });
  const deslocamento = arrasto.transform ? `translate3d(${arrasto.transform.x}px, ${arrasto.transform.y}px, 0)` : undefined;
  const estado = estadoDoCartao(s, laminas, emAndamento);
  const temImagem = s.fundo.tipo === "natural" ? !!s.fundo.caminho : !!imagemDoStory(s, laminas) || !!s.file_id || s.fundo.tipo === "cor";
  const papel = s.fundo.papel ? ROTULO_DO_PAPEL[s.fundo.papel] || s.fundo.papel : s.titulo || "Story";
  const travado = !!s.publicacao_id || s.situacao === "publicado" || s.situacao === "agendado";
  return (
    <li
      ref={alvo.setNodeRef}
      className={juntar("w-[236px] shrink-0 list-none lg:w-auto", "mr-2 lg:mb-1 lg:mr-0", alvo.isOver && !arrasto.isDragging ? "rounded-lg ring-2 ring-primary" : "")}
      data-story={s.id}
      data-papel={s.fundo.papel || ""}
    >
      <div
        ref={arrasto.setNodeRef}
        style={{ transform: deslocamento, zIndex: arrasto.isDragging ? 30 : undefined }}
        className={juntar("flex min-w-0 items-center rounded-lg px-1.5 py-1.5 transition-colors", ativo ? "bg-primary/[0.07]" : "hover:bg-muted/40", arrasto.isDragging ? "opacity-90" : "")}
      >
        <button
          type="button"
          onClick={onSelecionar}
          className="flex min-w-0 flex-1 items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={ativo}
          aria-label={`Story ${s.ordem}, ${papel}`}
        >
          <span className={juntar("block shrink-0 overflow-hidden rounded-md", ativo ? "ring-2 ring-primary" : "")} style={{ width: MINIATURA }}>
            <PreviaDoStory
              story={s}
              largura={MINIATURA}
              paleta={marca.paleta}
              familia={marca.familia}
              foto={marca.foto(s.fundo.imagem_id)}
              semSelo
              imagem={imagemDoStory(s, laminas)}
              estado={emAndamento ? "rodando" : filaDoStory(s, laminas)}
            />
          </span>
          <span className="ml-2.5 min-w-0 flex-1">
            <span className="flex min-w-0 items-center">
              <span className={juntar(texto.etiqueta, "mr-1.5 tabular-nums", ativo ? "text-primary" : "text-muted-foreground")}>{s.ordem}</span>
              <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{papel}</span>
              {s.adesivo.tipo !== "nenhum" ? <IconeDoAdesivo tipo={s.adesivo.tipo} className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
            </span>
            <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")} title={s.texto_na_tela}>
              {s.texto_na_tela || "Sem texto"}
            </span>
            <span className="mt-1 flex min-w-0 items-center">
              <span className={juntar(etiqueta, "mr-1.5 min-w-0 truncate", estado.tom)} title={s.motivo || undefined}>
                {estado.rotulo}
              </span>
              <span className={juntar(texto.etiqueta, "shrink-0 tabular-nums text-muted-foreground")}>{s.horario ? noFuso(s.horario).hora : "sem hora"}</span>
            </span>
          </span>
        </button>
        <span className="ml-1 flex shrink-0 flex-col items-center">
          {arrastavel ? (
            <span
              {...arrasto.listeners}
              {...arrasto.attributes}
              className="toque-compacto inline-flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
              aria-label={`Arrastar o story ${s.ordem}`}
              title="Arraste para mudar a ordem"
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}
          {onBaixar ? (
            <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={onBaixar} disabled={!temImagem} aria-label={`Baixar o story ${s.ordem}`} title={temImagem ? "Baixar o PNG para postar" : "Gere a imagem antes"}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={onDuplicar} aria-label={`Duplicar o story ${s.ordem}`} title="Duplicar">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={juntar(botao.icone, "h-7 w-7 hover:text-destructive")} onClick={onRemover} disabled={travado} aria-label={`Remover o story ${s.ordem}`} title={travado ? "Na Agenda: cancele pela Agenda" : "Remover"}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    </li>
  );
}

export default function CartoesDaSequencia({
  stories,
  selecionado,
  marca,
  laminas,
  ocupado,
  onSelecionar,
  onReordenar,
  onDuplicar,
  onRemover,
  onNovo,
  onBaixar,
  emAndamento,
}: {
  stories: Story[];
  selecionado: string | null;
  marca: MarcaDosStories;
  laminas?: Record<string, LaminasDoTrabalho>;
  /** Uma ordem nova está sendo gravada: ninguém arrasta. */
  ocupado?: boolean;
  onSelecionar: (s: Story) => void;
  onReordenar: (ids: string[]) => void;
  onDuplicar: (s: Story) => void;
  onRemover: (s: Story) => void;
  onNovo: () => void;
  onBaixar?: (s: Story) => void;
  /** Telas com a foto natural sendo gerada agora. */
  emAndamento?: Record<string, boolean>;
}) {
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const ids = stories.map((s) => s.id);
  const aoSoltar = (e: DragEndEvent) => {
    if (ocupado || !e.over || e.active.id === e.over.id) return;
    const nova = moverNaLista(ids, String(e.active.id), String(e.over.id));
    if (nova.join(",") !== ids.join(",")) onReordenar(nova);
  };
  return (
    <DndContext sensors={sensores} onDragEnd={aoSoltar}>
      <div className="min-w-0 overflow-x-auto pb-1 lg:overflow-visible lg:pb-0">
        <ol className="flex min-w-0 lg:flex-col" aria-label="Telas da sequência" data-fila-de-stories="">
          {stories.map((s) => (
            <Cartao
              key={s.id}
              s={s}
              ativo={selecionado === s.id}
              marca={marca}
              laminas={laminas}
              onSelecionar={() => onSelecionar(s)}
              onDuplicar={() => onDuplicar(s)}
              onRemover={() => onRemover(s)}
              onBaixar={onBaixar ? () => onBaixar(s) : undefined}
              emAndamento={!!(emAndamento && emAndamento[s.id])}
              arrastavel={!ocupado && stories.length > 1}
            />
          ))}
          <li className="w-[160px] shrink-0 list-none lg:w-auto">
            <button
              type="button"
              onClick={onNovo}
              className="flex h-full min-h-[48px] w-full items-center justify-center rounded-lg border border-dashed border-border px-3 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span className={texto.auxiliar}>Nova tela</span>
              <span className="sr-only">Adicionar um story na sequência</span>
            </button>
          </li>
        </ol>
      </div>
    </DndContext>
  );
}
