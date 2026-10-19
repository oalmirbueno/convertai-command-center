import { memo, useCallback, useMemo, type CSSProperties, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Play } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema";
import { TIPOS_DE_NO, resumoDoNo, type CanvasDoLab, type NoDoLab, type TipoDeNo } from "@/lib/laboratorio/nos";
import type { ExecucaoDoLab } from "@/lib/laboratorio/api";
import ResultadoDoNo, { ESTADOS, EstadoDoNo, emAndamento } from "./ResultadoDoNo";
import { IconeDoNo } from "./icones";

/**
 * O quadro do projeto (@xyflow/react, como o Canvas da Mesa Foto): cartões
 * por tipo com o estado em cor, o resultado no próprio cartão e o "Rodar"
 * de cada um. Ligar arrastando: a validação é a mesma do inspetor, e a
 * mensagem do porquê aparece quando não pode ligar (não some calada).
 */

export const TIPO_ARRASTADO = "application/laboratorio-no";
const LARGURA = 248;

interface DadosDoCartao extends Record<string, unknown> {
  no: NoDoLab;
  execucao: ExecucaoDoLab | undefined;
  rodando: boolean;
  onRodar: (id: string) => void;
}

const CartaoDoNo = memo(function CartaoDoNo({ data, selected }: NodeProps<Node<DadosDoCartao>>) {
  const { no, execucao } = data;
  const def = TIPOS_DE_NO[no.tipo];
  const borda = execucao ? ESTADOS[execucao.status].borda : def.cor;
  const resumo = resumoDoNo(no);
  return (
    <div
      className={juntar("w-[248px] min-w-0 rounded-md border-2 bg-background p-2.5 text-left", selected && "ring-2 ring-primary/50", execucao && execucao.status === "rodando" && "animate-pulse")}
      style={{ borderColor: borda }}
      data-no-do-quadro={no.id}
      data-tipo-do-no={no.tipo}
    >
      {def.entradas.length > 0 ? <Handle type="target" position={Position.Left} id="entrada" style={{ width: 12, height: 12, background: "#fff", border: `2px solid ${def.cor}` }} /> : null}
      <div className="flex min-w-0 items-center">
        <span className="mr-1.5 inline-flex shrink-0" style={{ color: def.cor }}>
          <IconeDoNo tipo={no.tipo} className="h-4 w-4" />
        </span>
        <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{def.rotulo}</span>
        {execucao ? <EstadoDoNo status={execucao.status} /> : null}
        {def.roda && (
          <button
            type="button"
            className={juntar(botao.icone, "nodrag ml-1 h-7 w-7 text-primary")}
            onClick={(e) => {
              e.stopPropagation();
              data.onRodar(no.id);
            }}
            disabled={data.rodando || emAndamento(execucao && execucao.status)}
            aria-label={`Rodar ${def.rotulo}`}
            title={`Rodar ${def.rotulo} (mostra o custo antes)`}
          >
            {data.rodando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        )}
      </div>
      {resumo ? <p className={juntar(texto.auxiliar, "mt-1 line-clamp-2")}>{resumo}</p> : <p className={juntar(texto.auxiliar, "mt-1 italic")}>Toque para ajustar</p>}
      <ResultadoDoNo execucao={execucao} />
      <Handle type="source" position={Position.Right} id="saida" style={{ width: 12, height: 12, background: def.cor, border: "2px solid #fff" }} />
    </div>
  );
});

const TIPOS_NO_QUADRO = Object.keys(TIPOS_DE_NO).reduce((acc, t) => {
  acc[t] = CartaoDoNo;
  return acc;
}, {} as Record<string, typeof CartaoDoNo>);

export default function QuadroDoLab({
  canvas,
  execucoes,
  selecionado,
  rodandoNo,
  semTeclas,
  onSelecionar,
  onMudarCanvas,
  onTentarLigar,
  onRodar,
  onSoltar,
  onViewport,
}: {
  canvas: CanvasDoLab;
  execucoes: Record<string, ExecucaoDoLab>;
  selecionado: string | null;
  rodandoNo: string | null;
  semTeclas?: boolean;
  onSelecionar: (id: string | null) => void;
  onMudarCanvas: (fn: (c: CanvasDoLab) => CanvasDoLab) => void;
  onTentarLigar: (de: string, para: string) => string | null;
  onRodar: (id: string) => void;
  onSoltar: (tipo: TipoDeNo, pos: { x: number; y: number }) => void;
  onViewport: (v: Viewport) => void;
}) {
  const rf = useReactFlow();

  const nodes = useMemo(
    (): Node<DadosDoCartao>[] =>
      canvas.nos.map((n) => ({
        id: n.id,
        type: n.tipo,
        position: { x: n.x, y: n.y },
        selected: selecionado === n.id,
        data: { no: n, execucao: execucoes[n.id], rodando: rodandoNo === n.id, onRodar },
      })),
    [canvas.nos, execucoes, selecionado, rodandoNo, onRodar],
  );

  const edges = useMemo(
    (): Edge[] =>
      canvas.ligacoes.map((l) => {
        const origem = canvas.nos.find((n) => n.id === l.de);
        const destino = execucoes[l.para];
        return {
          id: l.id,
          source: l.de,
          target: l.para,
          sourceHandle: "saida",
          targetHandle: "entrada",
          animated: !!destino && emAndamento(destino.status),
          style: { stroke: origem ? TIPOS_DE_NO[origem.tipo].cor : "#71717a", strokeWidth: 2.5 },
        };
      }),
    [canvas, execucoes],
  );

  const aoMudarNos = useCallback(
    (mudancas: NodeChange[]) => {
      const pos: Record<string, { x: number; y: number }> = {};
      const remover: string[] = [];
      mudancas.forEach((m) => {
        if (m.type === "position" && m.position) pos[m.id] = m.position;
        if (m.type === "remove") remover.push(m.id);
        if (m.type === "select" && m.selected) onSelecionar(m.id);
      });
      if (!Object.keys(pos).length && !remover.length) return;
      onMudarCanvas((c) => ({
        ...c,
        nos: c.nos.filter((n) => remover.indexOf(n.id) < 0).map((n) => (pos[n.id] ? { ...n, x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) } : n)),
        ligacoes: remover.length ? c.ligacoes.filter((l) => remover.indexOf(l.de) < 0 && remover.indexOf(l.para) < 0) : c.ligacoes,
      }));
      if (remover.length) onSelecionar(null);
    },
    [onMudarCanvas, onSelecionar],
  );

  const aoMudarLigacoes = useCallback(
    (mudancas: EdgeChange[]) => {
      const remover = mudancas.filter((m) => m.type === "remove").map((m) => m.id);
      if (remover.length) onMudarCanvas((c) => ({ ...c, ligacoes: c.ligacoes.filter((l) => remover.indexOf(l.id) < 0) }));
    },
    [onMudarCanvas],
  );

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    const t = e.dataTransfer ? e.dataTransfer.getData(TIPO_ARRASTADO) : "";
    if (!t || !Object.prototype.hasOwnProperty.call(TIPOS_DE_NO, t)) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onSoltar(t as TipoDeNo, { x: p.x - LARGURA / 2, y: p.y - 24 });
  };

  const estilo = {
    "--xy-background-color": "hsl(var(--muted) / 0.35)",
    "--xy-edge-stroke-default": "#71717a",
    "--xy-connectionline-stroke-default": "#10b981",
    "--xy-connectionline-stroke-width-default": 2.5,
  } as CSSProperties;

  return (
    <div className="h-full w-full min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={soltar} data-quadro-do-lab="">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={TIPOS_NO_QUADRO}
        onNodesChange={aoMudarNos}
        onEdgesChange={aoMudarLigacoes}
        onNodeClick={(e, n) => {
          const alvo = e && e.target ? (e.target as HTMLElement) : null;
          if (alvo && typeof alvo.closest === "function" && alvo.closest("button,a")) return;
          onSelecionar(n.id);
        }}
        onConnect={(c: Connection) => {
          if (c.source && c.target) onTentarLigar(c.source, c.target);
        }}
        // Toda tentativa chega no onConnect: lá a regra decide e explica quando não pode.
        isValidConnection={(c) => c.source !== c.target}
        onPaneClick={() => onSelecionar(null)}
        onMoveEnd={(_e, v) => onViewport(v)}
        defaultViewport={canvas.viewport}
        fitView={canvas.nos.length > 0}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        connectOnClick
        panOnDrag
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        noWheelClassName="nowheel"
        noPanClassName="nopan"
        noDragClassName="nodrag"
        deleteKeyCode={semTeclas ? null : ["Delete"]}
        proOptions={{ hideAttribution: true }}
        style={estilo}
      >
        <Background id="lab" variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
