import type { Node, NodeChange } from "@xyflow/react";
import type { NoDoLab } from "@/lib/laboratorio/nos";

/**
 * Os nós do quadro do Laboratório para o @xyflow/react, em funções puras.
 *
 * Bug de 19/10 (arrastar um nó deixava o quadro branco): o quadro recriava os
 * objetos `nodes` a cada mudança SEM `measured`. No xyflow 12, um nó do
 * usuário sem `measured` zera os handleBounds (parseHandles em
 * @xyflow/system) e fica escondido (visibility: hidden) até ser medido de
 * novo; arrastando, isso acontece a cada quadro e os nós e as ligações somem.
 * Agora a memória do quadro guarda as medidas (mudanças "dimensions") e o
 * "dragging" de cada nó, e todo nó remontado leva `measured`, `width` e o
 * `dragging` de volta.
 *
 * A altura NÃO vai em `height`: ela vira estilo fixo no xyflow e o nó parava
 * de crescer (expandir, resultado chegando). A altura medida vai em `measured`.
 */

export const LARGURA_DO_NO = 336;
export const LARGURA_EXPANDIDA = 448;

export type Medida = { width: number; height: number };

export interface MemoriaDoQuadro {
  medidas: Record<string, Medida>;
  arrastando: Record<string, boolean>;
}

export const memoriaVazia = (): MemoriaDoQuadro => ({ medidas: {}, arrastando: {} });

export interface LeituraDasMudancas {
  posicoes: Record<string, { x: number; y: number }>;
  remover: string[];
  selecionar: string | null;
  /** Alguma medida nova (o quadro remonta os nós com ela). */
  mediu: boolean;
  /** Algum nó começou ou terminou de ser arrastado. */
  arrasto: boolean;
}

/** Lê as mudanças do xyflow e atualiza a memória (medidas e arrasto) no lugar. */
export function lerMudancas(mudancas: NodeChange[], memoria: MemoriaDoQuadro): LeituraDasMudancas {
  const saida: LeituraDasMudancas = { posicoes: {}, remover: [], selecionar: null, mediu: false, arrasto: false };
  mudancas.forEach((m) => {
    if (m.type === "dimensions") {
      const d = m.dimensions;
      if (!d) return;
      const antes = memoria.medidas[m.id];
      if (!antes || antes.width !== d.width || antes.height !== d.height) {
        memoria.medidas[m.id] = { width: d.width, height: d.height };
        saida.mediu = true;
      }
    } else if (m.type === "position") {
      if (m.position) saida.posicoes[m.id] = m.position;
      if (typeof m.dragging === "boolean" && !!memoria.arrastando[m.id] !== m.dragging) {
        memoria.arrastando[m.id] = m.dragging;
        saida.arrasto = true;
      }
    } else if (m.type === "remove") {
      saida.remover.push(m.id);
      delete memoria.medidas[m.id];
      delete memoria.arrastando[m.id];
    } else if (m.type === "select" && m.selected) {
      saida.selecionar = m.id;
    }
  });
  return saida;
}

/** Um nó do quadro, sempre com a medida que já se sabe dele (nunca volta a "não medido"). */
export function montarNo<D extends Record<string, unknown>>(n: NoDoLab, o: { selecionado: boolean; largura: number; memoria: MemoriaDoQuadro; data: D }): Node<D> {
  const medida = o.memoria.medidas[n.id];
  const no: Node<D> = {
    id: n.id,
    type: n.tipo,
    position: { x: n.x, y: n.y },
    selected: o.selecionado,
    width: o.largura,
    dragging: !!o.memoria.arrastando[n.id],
    data: o.data,
  };
  if (medida) no.measured = { width: medida.width, height: medida.height };
  return no;
}
