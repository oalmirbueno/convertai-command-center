import { memo, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Code2, Database, GitBranch, Globe, MousePointerClick, Reply, Rows3, Sparkles, Timer, Workflow, X, Zap, CircleDot, type LucideIcon } from "lucide-react";
import { Chip } from "@/components/ds";
import { botao, juntar, texto } from "@/components/sistema";
import {
  CATEGORIAS,
  ROTULO_DO_STATUS,
  caminhoPorNo,
  categoriaDoNo,
  tomDoStatus,
  type CategoriaDoNo,
  type DetalheDoFluxo,
  type Execucao,
} from "@/lib/centralDeAutomacoes";

/*
 * Canvas do fluxo (19/11/2026). Dono: "quando abro o fluxo, ter um canvas mais fluido: está ruim de mover, e
 * poder clicar nos nodes e entender de forma clara o que é". React Flow (o mesmo do Laboratório): arrastar o
 * fundo move, a roda ou a pinça dá zoom, o mapinha mostra onde se está. Clicar num nó abre ao lado o que ele é,
 * o que faz (resumo do coletor, sem segredo), o que aconteceu com ele na execução escolhida e o código próprio.
 * Mover um nó é só para olhar: nada volta para o n8n.
 */

const ICONE: Record<CategoriaDoNo, LucideIcon> = {
  gatilho: Zap, codigo: Code2, chamada: Globe, banco: Database, decisao: GitBranch, subfluxo: Workflow,
  resposta: Reply, dados: Rows3, espera: Timer, passagem: CircleDot, ia: Sparkles, outro: Box,
};

type DadosDoNo = {
  nome: string;
  tipo: string;
  categoria: CategoriaDoNo;
  desligado: boolean;
  passo: { estado: string; ordem: number; vezes: number } | null;
  temExecucao: boolean;
  erro: boolean;
  escolhido: boolean;
};

const NoDoFluxo = memo(function NoDoFluxo({ data }: NodeProps<Node<DadosDoNo>>) {
  const Icone = ICONE[data.categoria];
  const passou = Boolean(data.passo);
  const deuErro = data.erro || data.passo?.estado === "error";
  return (
    <div
      className={juntar(
        "relative w-[208px] rounded-md border bg-card px-3 py-2.5 shadow-sm transition-[box-shadow,opacity]",
        deuErro ? "border-destructive" : passou ? "border-success" : "border-border",
        data.escolhido && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        (data.desligado || (data.temExecucao && !passou)) && "opacity-50",
      )}
      title={`${data.nome}: clique para entender`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50" />
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className={juntar("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full", deuErro ? "bg-danger-soft text-destructive" : passou ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
          <Icone className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium leading-4 text-foreground">{data.nome}</span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">{CATEGORIAS[data.categoria].rotulo}{data.desligado ? " · desligado" : ""}</span>
        </span>
        {data.passo && (
          <span className={juntar("inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-medium tabular-nums text-white", deuErro ? "bg-destructive" : "bg-success")} title={`Passo ${data.passo.ordem}${data.passo.vezes > 1 ? `, rodou ${data.passo.vezes} vezes` : ""}`}>
            {data.passo.ordem}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50" />
    </div>
  );
});

const TIPOS_DE_NO = { no: NoDoFluxo };

function PainelDoNo({ detalhe, nome, execucao, aoFechar }: { detalhe: DetalheDoFluxo; nome: string; execucao: Execucao | null; aoFechar: () => void }) {
  const no = detalhe.desenho.nos.find((n) => n.nome === nome);
  const passos = useMemo(() => caminhoPorNo(execucao?.caminho ?? []), [execucao]);
  if (!no) return null;
  const categoria = categoriaDoNo(no.tipo);
  const Icone = ICONE[categoria];
  const passo = passos.get(no.nome);
  const vemDe = detalhe.desenho.ligacoes.filter((l) => l.para === no.nome).map((l) => l.de);
  const vaiPara = detalhe.desenho.ligacoes.filter((l) => l.de === no.nome).map((l) => l.para);
  const erroAqui = execucao?.erroNo === no.nome ? execucao.erro : null;
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rolagem-fina rounded-md border border-border/60 bg-card p-4" aria-label={`O que é o nó ${no.nome}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><Icone className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className={juntar(texto.corpo, "font-medium [overflow-wrap:anywhere]")}>{no.nome}</p>
          <p className={texto.auxiliar}>{CATEGORIAS[categoria].rotulo} · <code className="text-[11px]">{no.tipo}</code>{no.desligado ? " · desligado" : ""}</p>
        </div>
        <button type="button" className={botao.icone} onClick={aoFechar} aria-label="Fechar" title="Fechar"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <p className={juntar(texto.auxiliar, "leading-5")}>{CATEGORIAS[categoria].explica}</p>

      {no.resumo.length > 0 && (
        <section aria-label="O que este nó faz">
          <h4 className={juntar(texto.rotulo, "mb-1")}>O que faz</h4>
          <ul className="space-y-1">{no.resumo.map((r, i) => <li key={i} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{r}</li>)}</ul>
        </section>
      )}

      {execucao && (
        <section aria-label="Nesta execução">
          <h4 className={juntar(texto.rotulo, "mb-1")}>Na execução nº {execucao.id}</h4>
          {passo ? (
            <p className={texto.corpo}>
              <Chip tone={tomDoStatus(passo.estado)} dot className="mr-2">{ROTULO_DO_STATUS[passo.estado] ?? passo.estado}</Chip>
              passo {passo.ordem}{passo.vezes > 1 ? `, rodou ${passo.vezes} vezes` : ""}{execucao.parouEm === no.nome ? " · foi o último" : ""}
            </p>
          ) : <p className={texto.auxiliar}>Não passou por aqui nesta execução.</p>}
          {erroAqui && <p className={juntar(texto.corpo, "mt-2 text-destructive [overflow-wrap:anywhere]")}>{erroAqui}</p>}
        </section>
      )}

      {(vemDe.length > 0 || vaiPara.length > 0) && (
        <section aria-label="Ligações">
          <h4 className={juntar(texto.rotulo, "mb-1")}>Ligações</h4>
          {vemDe.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Vem de: {[...new Set(vemDe)].join(", ")}</p>}
          {vaiPara.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Vai para: {[...new Set(vaiPara)].join(", ")}</p>}
        </section>
      )}

      {no.codigo && (
        <details className="min-w-0">
          <summary className={juntar(texto.rotulo, "cursor-pointer")}>Código deste nó</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-[11px] leading-4 [overflow-wrap:anywhere]">{no.codigo}</pre>
        </details>
      )}
    </aside>
  );
}

function Quadro({ detalhe, execucao, escolhido, aoEscolher }: { detalhe: DetalheDoFluxo; execucao: Execucao | null; escolhido: string | null; aoEscolher: (nome: string | null) => void }) {
  const passos = useMemo(() => caminhoPorNo(execucao?.caminho ?? []), [execucao]);
  const { fitView } = useReactFlow();
  const nos = useMemo<Node<DadosDoNo>[]>(() => detalhe.desenho.nos.map((n) => ({
    id: n.nome,
    type: "no",
    position: { x: n.x, y: n.y },
    data: {
      nome: n.nome,
      tipo: n.tipo,
      categoria: categoriaDoNo(n.tipo),
      desligado: n.desligado,
      passo: passos.get(n.nome) ?? null,
      temExecucao: Boolean(execucao),
      erro: execucao?.erroNo === n.nome,
      escolhido: escolhido === n.nome,
    },
  })), [detalhe.desenho.nos, passos, execucao, escolhido]);
  const [posicoes, setPosicoes] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => setPosicoes({}), [detalhe.id]);
  const nosComPosicao = useMemo(() => nos.map((n) => (posicoes[n.id] ? { ...n, position: posicoes[n.id] } : n)), [nos, posicoes]);
  const ligacoes = useMemo<Edge[]>(() => detalhe.desenho.ligacoes
    .filter((l) => l.de && l.para)
    .map((l, i) => {
      const passou = passos.has(l.de) && passos.has(l.para);
      return {
        id: `${i}-${l.de}-${l.para}`,
        source: l.de,
        target: l.para,
        type: "smoothstep",
        animated: passou,
        label: l.saida > 0 ? `saída ${l.saida + 1}` : undefined,
        style: { strokeWidth: passou ? 2.25 : 1.25, stroke: passou ? "hsl(var(--success))" : "hsl(var(--muted-foreground) / 0.45)" },
        labelStyle: { fontSize: 11 },
      };
    }), [detalhe.desenho.ligacoes, passos]);
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [detalhe.id, fitView]);
  return (
    <ReactFlow
      nodes={nosComPosicao}
      edges={ligacoes}
      nodeTypes={TIPOS_DE_NO}
      onNodeClick={(_, n) => aoEscolher(n.id)}
      onPaneClick={() => aoEscolher(null)}
      onNodeDragStop={(_, n) => setPosicoes((p) => ({ ...p, [n.id]: n.position }))}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      selectionOnDrag={false}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      deleteKeyCode={null}
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      minZoom={0.15}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" className="!hidden sm:!block" nodeStrokeWidth={2} maskColor="hsl(var(--background) / 0.6)" />
    </ReactFlow>
  );
}

export default function CanvasDoFluxo({ detalhe, execucao }: { detalhe: DetalheDoFluxo; execucao: Execucao | null }) {
  const [escolhido, setEscolhido] = useState<string | null>(null);
  useEffect(() => setEscolhido(null), [detalhe.id]);
  if (!detalhe.desenho.nos.length) return <p className={texto.auxiliar}>O desenho chega na próxima coleta.</p>;
  return (
    <div className="min-w-0">
      <p className={juntar(texto.auxiliar, "mb-2 flex items-center gap-1.5")}>
        <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {execucao ? `Execução nº ${execucao.id}: o caminho dela está em verde, com a ordem dos passos.` : `${detalhe.desenho.nos.length} nós.`} Arraste para mover, use a roda para o zoom e clique num nó para entender.
      </p>
      <div className={juntar("grid min-w-0 gap-3", escolhido ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "")}>
        <div className="h-[56vh] min-h-[320px] min-w-0 overflow-hidden rounded-md border border-border/60 bg-muted/20" data-canvas-do-fluxo="">
          <ReactFlowProvider>
            <Quadro detalhe={detalhe} execucao={execucao} escolhido={escolhido} aoEscolher={setEscolhido} />
          </ReactFlowProvider>
        </div>
        {escolhido && (
          <div className="min-w-0 lg:h-[56vh] lg:min-h-[320px]">
            <PainelDoNo detalhe={detalhe} nome={escolhido} execucao={execucao} aoFechar={() => setEscolhido(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
