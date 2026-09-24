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
import { Clock, GripVertical, MessageSquare } from "lucide-react";
import { blocosDoTexto, caixaDaZona, ESCALA_DO_PAPEL, zonaPadrao, type Caixa } from "@/lib/mesa/layout";
import { ImagemDaMesa } from "./MesaContexto";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * Prancheta do Estúdio: as lâminas do item em 4:5 (altura calculada pela
 * largura, sem aspect-ratio). Na horizontal, uma faixa que rola para o lado
 * por dentro; na vertical (computador), uma coluna ao lado da lâmina grande.
 * Lâmina sem arte mostra o esboço do layout (zona do texto, hierarquia e
 * margens de segurança), nas mesmas posições que o gerador recebe. O
 * carrossel contínuo aparece colado, como panorama (só na horizontal), e
 * com a ordem travada: a alça fica apagada e o tooltip explica por quê.
 *
 * Sob cada lâmina, sempre visíveis (não só no hover): número e função, o
 * ajuste, a versão (abre as versões) e a barrinha com gerar ou refazer e o
 * preço. Com a lâmina em andamento, a barrinha vira O indicador dela (um só
 * por lâmina, em toda a tela): a etapa e um cronômetro discreto que corre
 * da fila até o fim da conferência, sem recomeçar nem piscar. Clique
 * seleciona; duplo clique abre a lâmina grande (Ampliar). Nada sobe nem
 * desce no hover.
 */

/** Aviso da ordem travada: no carrossel contínuo o panorama foi cortado nesta ordem. */
export const AVISO_DA_ORDEM_NO_CONTINUO =
  "No carrossel contínuo a ordem faz parte da cena. Desligue o contínuo ou use Refazer o fundo para reordenar.";

export type EtapaDaLamina ="fila" | "gerando" | "ajustando" | "conferindo";

/** O que está acontecendo com a lâmina agora e desde quando (o cronômetro não recomeça entre etapas). */
export interface AndamentoDaLamina {
  etapa: EtapaDaLamina;
  desde: number;
}

export const ROTULO_DA_ETAPA: Record<EtapaDaLamina, string> = {
  fila: "na fila",
  gerando: "gerando",
  ajustando: "ajustando",
  conferindo: "conferindo",
};

type Props = {
  cards: CardDaDirecao[];
  ultimas: Map<number, CardGerado>;
  selecionado: number | null;
  onSelecionar: (ordem: number) => void;
  /** Duplo clique numa lâmina com arte. */
  onAmpliar?: (ordem: number) => void;
  /** ordem -> etapa e início (fila, geração, ajuste, conferência). */
  andamento: Record<number, AndamentoDaLamina>;
  infinito: boolean;
  /** Largura de cada lâmina em px (a altura é 1,25 vez). */
  largura: number;
  /** "vertical": coluna ao lado da lâmina grande (computador). */
  orientacao?: "horizontal" | "vertical";
  podeReordenar: boolean;
  /**
   * Motivo de a ordem estar travada (carrossel contínuo): a alça aparece
   * apagada, sem arrastar, com este aviso no tooltip. Vence o podeReordenar.
   */
  avisoDaOrdem?: string;
  onReordenar: (ordens: number[]) => void;
  /** Barrinha de ações sob a lâmina (sempre visível). */
  acoes?: (card: CardDaDirecao, versao: CardGerado | undefined) => ReactNode;
  /** Versão sob a lâmina, clicável (abre as versões na ferramenta Lâmina). */
  onVersoes?: (ordem: number) => void;
  /** Ícone de ajuste sob a lâmina com arte (abre o ajuste na ferramenta Lâmina). */
  onAjustar?: (ordem: number) => void;
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

/** O indicador único da lâmina em andamento: a etapa e o tempo, discretos. */
export function ProgressoDaLamina({ ordem, andamento }: { ordem: number; andamento: AndamentoDaLamina }) {
  const naFila = andamento.etapa === "fila";
  return (
    <span
      role="status"
      aria-label={`Lâmina ${ordem}: ${ROTULO_DA_ETAPA[andamento.etapa]}`}
      data-progresso-da-lamina={ordem}
      className="inline-flex h-7 min-w-0 max-w-full items-center rounded-full bg-secondary px-2.5 text-[11px]"
    >
      {naFila ? (
        <Clock className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span className="mr-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
      )}
      <span className={`truncate ${naFila ? "text-muted-foreground" : "font-medium text-foreground"}`}>{ROTULO_DA_ETAPA[andamento.etapa]}</span>
      {!naFila && (
        <span className="ml-1 shrink-0 tabular-nums text-muted-foreground">
          <Cronometro desde={andamento.desde} />
        </span>
      )}
    </span>
  );
}

export const funcaoDaLamina = (card: CardDaDirecao) =>
  card.ordem === 1 || card.funcao === "capa" ? "capa" : card.funcao === "cta" ? "fechamento" : "conteúdo";

export interface MedidaDoBloco {
  texto: string;
  negrito: boolean;
  /** Tamanho da letra em px, proporcional à largura da lâmina desenhada. */
  fonte: number;
  /** Máximo de linhas (line-clamp); 0 esconde o bloco que não cabe. */
  linhas: number;
  /** Espaço acima do bloco (px), a partir do segundo. */
  espaco: number;
}

const ALTURA_DA_LINHA = 1.12;
const LARGURA_DO_CARACTERE = 0.56;

/** Respiro interno da caixa do texto (px), proporcional à largura da lâmina. */
export const respiroDoEsboco = (largura: number) => Math.max(1, Math.round(largura * 0.015));

/**
 * Tamanho da letra e linhas de cada bloco do esboço para caber na caixa do
 * texto: a letra escala pela largura da lâmina (px calculado), encolhe até
 * caber e, se ainda sobrar texto, cada bloco é cortado por line-clamp (e os
 * que não cabem somem, na ordem de leitura). A conta já usa a letra
 * arredondada e o respiro da caixa: nada vaza (antes o texto saía pela borda
 * da miniatura).
 */
export function medidasDoEsboco(blocos: { papel: string; texto: string }[], largura: number, caixa: Caixa): MedidaDoBloco[] {
  const lista = blocos.slice(0, 5).map((b) => ({ papel: b.papel, texto: (b.texto || "").split("\n").join(" ").trim() })).filter((b) => b.texto);
  if (!lista.length || largura <= 0) return [];
  const respiro = respiroDoEsboco(largura);
  const larguraUtil = Math.max(1, ((caixa.x1 - caixa.x0) / 100) * largura - 2 * respiro);
  const alturaUtil = Math.max(1, ((caixa.y1 - caixa.y0) / 100) * largura * 1.25 - 2 * respiro - 1);
  const medir = (k: number) =>
    lista.map((b) => {
      const fonte = Math.max(4, Math.round(largura * 0.11 * (ESCALA_DO_PAPEL[b.papel] || 0.3) * k * 2) / 2);
      const porLinha = Math.max(1, Math.floor(larguraUtil / (fonte * LARGURA_DO_CARACTERE)));
      return { papel: b.papel, texto: b.texto, fonte, espaco: Math.round(fonte * 0.3), linhas: Math.max(1, Math.ceil(b.texto.length / porLinha)) };
    });
  const alturaTotal = (m: { fonte: number; linhas: number; espaco: number }[]) =>
    m.reduce((s, x, i) => s + x.fonte * ALTURA_DA_LINHA * x.linhas + (i ? x.espaco : 0), 0);
  let k = 1;
  let medidas = medir(k);
  while (alturaTotal(medidas) > alturaUtil && k > 0.45) {
    k = k * 0.88;
    medidas = medir(k);
  }
  // Ainda não coube: corta as linhas de cima para baixo pelo espaço que sobra.
  let resta = alturaUtil;
  let acabou = false;
  return medidas.map((m, i) => {
    const espaco = i ? m.espaco : 0;
    const porLinha = m.fonte * ALTURA_DA_LINHA;
    const cabem = acabou ? 0 : Math.floor((resta - espaco) / porLinha);
    const linhas = Math.max(0, Math.min(m.linhas, cabem));
    if (linhas > 0) resta -= espaco + linhas * porLinha;
    else acabou = true;
    return { texto: m.texto, negrito: m.papel === "headline" || m.papel === "numero", fonte: m.fonte, linhas, espaco };
  });
}

/** Esboço do layout de uma lâmina sem arte, na largura dada (px). */
export function Esboco({ card, total, largura }: { card: CardDaDirecao; total: number; largura: number }) {
  const capa = card.funcao === "capa" || card.ordem === 1;
  const zona = (card.layout && card.layout.zona_texto) || zonaPadrao(card.funcao, card.ordem, total);
  const caixa = caixaDaZona(zona, capa);
  const blocos = card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato || "", card.funcao);
  const alinhamento = (card.layout && card.layout.alinhamento) || (zona === "centro" ? "centro" : "esquerda");
  const alinhar = alinhamento === "centro" ? "items-center text-center" : alinhamento === "direita" ? "items-end text-right" : "items-start text-left";
  const medidas = medidasDoEsboco(blocos, largura, caixa);
  return (
    <div className="absolute inset-0 overflow-hidden bg-secondary">
      {/* margens de segurança */}
      <div className="absolute border border-dashed border-muted-foreground/30" style={{ left: "8.3%", right: "8.3%", top: "7.4%", bottom: "7.9%" }} />
      <div
        className={`absolute flex flex-col justify-center overflow-hidden rounded-sm bg-background ${alinhar}`}
        style={{
          left: `${caixa.x0}%`,
          width: `${caixa.x1 - caixa.x0}%`,
          top: `${caixa.y0}%`,
          height: `${caixa.y1 - caixa.y0}%`,
          padding: respiroDoEsboco(largura),
        }}
      >
        {medidas.map((m, i) =>
          m.linhas > 0 ? (
            <span
              key={i}
              className={`block max-w-full shrink-0 overflow-hidden text-foreground/80 [overflow-wrap:anywhere] ${m.negrito ? "font-bold" : ""}`}
              style={{
                fontSize: m.fonte,
                lineHeight: ALTURA_DA_LINHA,
                marginTop: m.espaco,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: m.linhas,
              }}
            >
              {m.texto}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Lamina({
  card,
  total,
  versao,
  ativo,
  andamento,
  onSelecionar,
  onAmpliar,
  onVersoes,
  onAjustar,
  largura,
  arrastavel,
  avisoDaOrdem,
  colado,
  vertical,
  primeira,
  ultima,
  acoes,
}: {
  card: CardDaDirecao;
  total: number;
  versao: CardGerado | undefined;
  ativo: boolean;
  andamento: AndamentoDaLamina | undefined;
  onSelecionar: () => void;
  onAmpliar?: () => void;
  onVersoes?: () => void;
  onAjustar?: () => void;
  largura: number;
  arrastavel: boolean;
  avisoDaOrdem?: string;
  colado: boolean;
  vertical: boolean;
  primeira: boolean;
  ultima: boolean;
  acoes?: ReactNode;
}) {
  const id = String(card.ordem);
  const arrasto = useDraggable({ id, disabled: !arrastavel });
  const alvo = useDroppable({ id });
  const deslocamento = arrasto.transform ? `translate3d(${arrasto.transform.x}px, ${arrasto.transform.y}px, 0)` : undefined;
  const funcao = funcaoDaLamina(card);
  const altura = Math.round(largura * 1.25);
  const cantos = colado ? `${primeira ? "rounded-l-lg" : ""} ${ultima ? "rounded-r-lg" : ""}` : "rounded-lg border";
  const trabalhando = !!andamento && andamento.etapa !== "fila";
  const espaco = colado ? "" : vertical ? (ultima ? "" : "mb-3") : "mr-3";

  return (
    <li
      ref={alvo.setNodeRef}
      className={`relative shrink-0 list-none ${espaco} ${alvo.isOver && !arrasto.isDragging ? "rounded-lg ring-2 ring-primary" : ""}`}
      style={{ width: largura }}
    >
      <div
        ref={arrasto.setNodeRef}
        style={{ transform: deslocamento, zIndex: arrasto.isDragging ? 30 : undefined }}
        className={arrasto.isDragging ? "opacity-90" : ""}
      >
        <button
          type="button"
          onClick={onSelecionar}
          onDoubleClick={() => { if (versao && onAmpliar) onAmpliar(); }}
          aria-label={`Lâmina ${card.ordem}, ${funcao}${versao ? "" : ", sem arte"}`}
          aria-pressed={ativo}
          title={versao ? "Clique para escolher; duplo clique para ver grande" : "Clique para escolher"}
          style={{ height: altura }}
          className={`relative block w-full overflow-hidden bg-card text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cantos} ${ativo ? (colado ? "ring-[3px] ring-inset ring-primary" : "border-primary ring-2 ring-primary") : colado ? "" : "border-border hover:border-primary/60"}`}
        >
          {versao ? (
            <ImagemDaMesa caminho={versao.storage_path} alt={`Lâmina ${card.ordem}`} className={`absolute inset-0 h-full w-full transition-opacity ${trabalhando ? "opacity-50" : ""}`} />
          ) : (
            <Esboco card={card} total={total} largura={largura} />
          )}
        </button>
        <div className="mt-1.5 flex h-5 min-w-0 items-center px-0.5">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-none">
            <span className={`font-semibold tabular-nums ${ativo ? "text-primary" : "text-foreground"}`}>{card.ordem}</span>
            <span className={funcao === "capa" ? "font-medium text-primary" : "text-muted-foreground"}> {funcao}</span>
          </span>
          {versao && onAjustar && !andamento && (
            <button
              type="button"
              onClick={onAjustar}
              className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Ajustar esta lâmina"
              aria-label={`Ajustar a lâmina ${card.ordem}`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          )}
          {versao && onVersoes ? (
            <button
              type="button"
              onClick={onVersoes}
              className="ml-1 shrink-0 rounded px-1 text-[11px] leading-5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Ver as versões desta lâmina"
              aria-label={`Versões da lâmina ${card.ordem}`}
            >
              v{versao.versao}
            </button>
          ) : (
            !versao && <span className="ml-1 shrink-0 text-[10.5px] text-muted-foreground">sem arte</span>
          )}
          {arrastavel && (
            <span
              {...arrasto.listeners}
              {...arrasto.attributes}
              className="ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
              aria-label={`Arrastar a lâmina ${card.ordem}`}
              title="Arraste para mudar a ordem"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          {!arrastavel && avisoDaOrdem && (
            <span
              className="ml-0.5 shrink-0 cursor-not-allowed rounded p-0.5 text-muted-foreground/40"
              role="img"
              aria-disabled="true"
              aria-label={`Ordem da lâmina ${card.ordem} travada. ${avisoDaOrdem}`}
              title={avisoDaOrdem}
              data-ordem-travada={card.ordem}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        {/* Barrinha: as ações, ou o indicador único da lâmina enquanto ela está em andamento. */}
        <div className="mt-1 flex h-8 min-w-0 items-center justify-center">
          {andamento ? <ProgressoDaLamina ordem={card.ordem} andamento={andamento} /> : acoes}
        </div>
      </div>
    </li>
  );
}

export default function PranchetaDoEstudio({
  cards,
  ultimas,
  selecionado,
  onSelecionar,
  onAmpliar,
  andamento,
  infinito,
  largura,
  orientacao = "horizontal",
  podeReordenar,
  avisoDaOrdem,
  onReordenar,
  acoes,
  onVersoes,
  onAjustar,
}: Props) {
  // Ordem travada (contínuo): ninguém arrasta, nem pelo teclado.
  const podeArrastar = podeReordenar && !avisoDaOrdem;
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const vertical = orientacao === "vertical";
  const colado = infinito && !vertical;
  const aoSoltar = (e: DragEndEvent) => {
    if (!podeArrastar || !e.over || e.active.id === e.over.id) return;
    const ordens = cards.map((c) => c.ordem);
    const de = ordens.indexOf(Number(e.active.id));
    const para = ordens.indexOf(Number(e.over.id));
    if (de < 0 || para < 0) return;
    const nova = ordens.slice();
    const movido = nova.splice(de, 1)[0];
    nova.splice(para, 0, movido);
    onReordenar(nova);
  };

  const lista = (
    <ul className={vertical ? "flex flex-col items-center" : "inline-flex items-start"} aria-label="Lâminas do item">
      {cards.map((c, i) => (
        <Lamina
          key={c.ordem}
          card={c}
          total={cards.length}
          versao={ultimas.get(c.ordem)}
          ativo={selecionado === c.ordem}
          andamento={andamento[c.ordem]}
          onSelecionar={() => onSelecionar(c.ordem)}
          onAmpliar={onAmpliar ? () => onAmpliar(c.ordem) : undefined}
          onVersoes={onVersoes ? () => onVersoes(c.ordem) : undefined}
          onAjustar={onAjustar ? () => onAjustar(c.ordem) : undefined}
          largura={largura}
          arrastavel={podeArrastar}
          avisoDaOrdem={avisoDaOrdem}
          colado={colado}
          vertical={vertical}
          primeira={i === 0}
          ultima={i === cards.length - 1}
          acoes={acoes ? acoes(c, ultimas.get(c.ordem)) : undefined}
        />
      ))}
    </ul>
  );

  return (
    <DndContext sensors={sensores} onDragEnd={aoSoltar}>
      {/* Na horizontal, rola dentro da própria faixa: a página nunca rola para o lado. Na vertical, quem rola é a coluna. */}
      {vertical ? lista : <div className="min-w-0 overflow-x-auto pb-1">{lista}</div>}
    </DndContext>
  );
}
