import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import {
  TIPOS_DE_NO,
  criarNo,
  definirGatilho,
  desligar,
  ehTipoDeNo,
  gatilhosDe,
  rotuloDoGatilho,
  mudarDados,
  removerNo,
  tiposQueEntram,
  tiposQueRecebem,
  type CanvasDoLab,
  type TipoDeNo,
} from "@/lib/laboratorio/nos";
import type { ExecucaoDoLab } from "@/lib/laboratorio/api";
import CartaoDoNo, { type DadosDoCartao } from "./no/CartaoDoNo";
import { LigacaoDoLab, LinhaDeConexao, type DadosDaLigacao } from "./no/LigacaoDoLab";
import ControlesDoQuadro from "./no/ControlesDoQuadro";
import MenuRapido from "./no/MenuRapido";
import { ContextoDoQuadro, type AcoesDoQuadro } from "./no/contexto";
import { LARGURA_DO_NO, LARGURA_EXPANDIDA, lerMudancas, memoriaVazia, montarNo, type MemoriaDoQuadro } from "./no/montar";

/**
 * O quadro do projeto (@xyflow/react): cartões por tipo com os campos e o
 * resultado no próprio nó, barra de ações no nó selecionado, ligações curvas
 * na cor da origem (com o ponto correndo quando o destino roda e o botão de
 * tirar no meio), controles próprios (zoom, ajustar, travar, mini-mapa) e o
 * menu rápido: soltar uma ligação no vazio (ou tocar no "+" da saída) mostra
 * os tipos que ligam ali, cria o nó e já liga. A validação da ligação é a do
 * inspetor, e o porquê aparece quando não pode ligar.
 *
 * Medidas: ver no/montar.ts (o bug do quadro branco ao arrastar, 19/10).
 */

export const TIPO_ARRASTADO = "application/laboratorio-no";

const TIPOS_NO_QUADRO = Object.keys(TIPOS_DE_NO).reduce((acc, t) => {
  acc[t] = CartaoDoNo;
  return acc;
}, {} as Record<string, typeof CartaoDoNo>);

const TIPOS_DE_LIGACAO = { lab: LigacaoDoLab };

/** Raio (px) em que a ponta da ligação "gruda" na alça mais perto. */
const RAIO_DE_LIGACAO = 40;
const LARGURA_DO_MENU = 232;
const ALTURA_DO_MENU = 320;

type MenuAberto = { x: number; y: number; de: { no: string; lado: "saida" | "entrada" }; pos: { x: number; y: number } };

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
  revelar,
  ajustarVista = 0,
  escolhendo = null,
  onEscolherStoryboard = () => undefined,
  travas = {},
  projetoId = "",
  clienteId = null,
  onSincronizar,
  onAbrirDetalhes,
  onMudarGatilho,
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
  /** Construção (Canvas Studio): atraso de entrada de cada nó novo, coluna por coluna. */
  revelar?: Record<string, number> | null;
  /** Muda o número: o quadro se ajusta para caber tudo (depois de construir ou organizar). */
  ajustarVista?: number;
  escolhendo?: { no: string; indice: number } | null;
  onEscolherStoryboard?: (noId: string, indice: number) => void;
  /** Motivo da trava de cada Pôr no ar travado (por id). */
  travas?: Record<string, string>;
  /** Para os campos no próprio nó: envio de mídia e documentos e o Workspace do cliente. */
  projetoId?: string;
  clienteId?: string | null;
  /** Roda de novo o nó com o que vem antes dele (sempre pelo custo antes). */
  onSincronizar?: (id: string) => void;
  /** Abre o inspetor do nó (ligações e tudo do nó). */
  onAbrirDetalhes?: (id: string) => void;
  /** Gatilho do funil no fio (o mesmo do Inspetor); sem ele, o quadro muda o canvas direto. */
  onMudarGatilho?: (ligacaoId: string, gatilho: string | null) => void;
}) {
  const rf = useReactFlow();
  // O xyflow põe a classe do modo de cor na raiz do quadro; ".light" e ".dark" são os
  // tokens do painel. Sem isso ele punha "light" sempre e o quadro ficava claro no tema escuro.
  const { theme } = useTheme();
  const caixa = useRef<HTMLDivElement>(null);
  const memoria = useRef<MemoriaDoQuadro>(memoriaVazia());
  const [versaoDasMedidas, setVersaoDasMedidas] = useState(0);
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [travado, setTravado] = useState(false);
  const [mapa, setMapa] = useState(false);
  const [menu, setMenu] = useState<MenuAberto | null>(null);
  const [ligacaoSelecionada, setLigacaoSelecionada] = useState<string | null>(null);

  useEffect(() => {
    if (!ajustarVista) return;
    const id = window.setTimeout(() => {
      try {
        void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 400 });
      } catch {
        /* quadro ainda sem medida */
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [ajustarVista, rf]);

  // Nó novo (paleta, duplicar, menu rápido) fora da vista: a vista vai até ele.
  const conhecidos = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = canvas.nos.map((n) => n.id);
    const antes = conhecidos.current;
    conhecidos.current = ids;
    if (!antes || revelar || !selecionado || antes.indexOf(selecionado) >= 0) return;
    const novo = canvas.nos.find((n) => n.id === selecionado);
    const el = caixa.current;
    if (!novo || !el) return;
    try {
      const v = rf.getViewport();
      const r = el.getBoundingClientRect();
      const x = novo.x * v.zoom + v.x;
      const y = novo.y * v.zoom + v.y;
      if (r.width > 0 && (x < 0 || y < 0 || x + LARGURA_DO_NO * v.zoom > r.width || y + 160 * v.zoom > r.height)) {
        void rf.setCenter(novo.x + LARGURA_DO_NO / 2, novo.y + 120, { zoom: v.zoom, duration: 300 });
      }
    } catch {
      /* quadro ainda sem medida */
    }
  }, [canvas.nos, selecionado, revelar, rf]);

  const nodes = useMemo(
    (): Node<DadosDoCartao>[] =>
      canvas.nos.map((n) =>
        montarNo<DadosDoCartao>(n, {
          selecionado: selecionado === n.id,
          largura: expandidos[n.id] ? LARGURA_EXPANDIDA : LARGURA_DO_NO,
          memoria: memoria.current,
          data: {
            no: n,
            execucao: execucoes[n.id],
            rodando: rodandoNo === n.id,
            atraso: revelar ? revelar[n.id] : undefined,
            escolhendo: escolhendo && escolhendo.no === n.id ? escolhendo.indice : null,
            trava: travas[n.id] || null,
            expandido: !!expandidos[n.id],
          },
        }),
      ),
    // versaoDasMedidas: a memória mudou (medida nova ou arrasto) e os nós precisam levar isso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas.nos, execucoes, selecionado, rodandoNo, revelar, escolhendo, travas, expandidos, versaoDasMedidas],
  );

  const edges = useMemo(
    (): Edge<DadosDaLigacao>[] =>
      canvas.ligacoes.map((l) => {
        const origem = canvas.nos.find((n) => n.id === l.de);
        const destino = execucoes[l.para];
        return {
          id: l.id,
          source: l.de,
          target: l.para,
          sourceHandle: "saida",
          targetHandle: "entrada",
          type: "lab",
          selected: ligacaoSelecionada === l.id,
          data: {
            cor: origem ? TIPOS_DE_NO[origem.tipo].cor : "#71717a",
            rodando: !!destino && (destino.status === "rodando" || destino.status === "na_fila"),
            gatilho: l.gatilho || null,
            rotuloDoGatilho: l.gatilho ? rotuloDoGatilho(l.gatilho) : "",
            tipoDaOrigem: origem ? origem.tipo : null,
            aceitaGatilho: !!origem && gatilhosDe(origem.tipo).length > 0,
          },
        };
      }),
    [canvas, execucoes, ligacaoSelecionada],
  );

  const aoMudarNos = useCallback(
    (mudancas: NodeChange[]) => {
      const r = lerMudancas(mudancas, memoria.current);
      if (r.selecionar) onSelecionar(r.selecionar);
      if (r.mediu || r.arrasto) setVersaoDasMedidas((v) => v + 1);
      const pos = r.posicoes;
      const remover = r.remover;
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
      mudancas.forEach((m) => {
        if (m.type === "select") setLigacaoSelecionada((atual) => (m.selected ? m.id : atual === m.id ? null : atual));
      });
      const remover = mudancas.filter((m) => m.type === "remove").map((m) => m.id);
      if (remover.length) {
        onMudarCanvas((c) => ({ ...c, ligacoes: c.ligacoes.filter((l) => remover.indexOf(l.id) < 0) }));
        setLigacaoSelecionada(null);
      }
    },
    [onMudarCanvas],
  );

  /** Abre o menu rápido num ponto da tela; o nó novo nasce ali (à direita da saída, à esquerda da entrada). */
  const abrirMenu = useCallback(
    (de: { no: string; lado: "saida" | "entrada" }, ponto: { x: number; y: number }) => {
      const el = caixa.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let pos = { x: 0, y: 0 };
      try {
        const p = rf.screenToFlowPosition(ponto);
        pos = de.lado === "saida" ? { x: p.x + 12, y: p.y - 28 } : { x: p.x - LARGURA_DO_NO - 12, y: p.y - 28 };
      } catch {
        /* quadro ainda sem medida */
      }
      const x = Math.max(8, Math.min(ponto.x - r.left, r.width - LARGURA_DO_MENU - 8));
      const y = Math.max(8, Math.min(ponto.y - r.top, r.height - ALTURA_DO_MENU - 8));
      setMenu({ x, y, de, pos });
    },
    [rf],
  );

  const escolherDoMenu = (t: TipoDeNo) => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    // O updater roda na hora (mudar do editor): guarda o id do nó novo ou o erro.
    const feito = { novo: "", erro: "" };
    onMudarCanvas((c) => {
      const r = criarNo(c, t, m.pos);
      if (!r.no) {
        feito.erro = r.erro || "Não coube no quadro.";
        return c;
      }
      feito.novo = r.no.id;
      return r.canvas;
    });
    if (!feito.novo) {
      if (feito.erro) toast.warning("O quadro está cheio", { description: feito.erro });
      return;
    }
    // A regra (e a mensagem do porquê) é a mesma do inspetor.
    if (m.de.lado === "saida") onTentarLigar(m.de.no, feito.novo);
    else onTentarLigar(feito.novo, m.de.no);
    onSelecionar(feito.novo);
  };

  const aoTerminarLigacao = useCallback(
    (e: MouseEvent | TouchEvent, estado: FinalConnectionState) => {
      if (travado || !estado || estado.isValid || estado.toNode || !estado.fromNode || !estado.fromHandle) return;
      const alvo = e.target as Element | null;
      if (alvo && typeof alvo.closest === "function" && alvo.closest(".react-flow__node")) return;
      const toque = "changedTouches" in e && e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null;
      const ponto = toque ? { x: toque.clientX, y: toque.clientY } : { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
      abrirMenu({ no: estado.fromNode.id, lado: estado.fromHandle.type === "target" ? "entrada" : "saida" }, ponto);
    },
    [travado, abrirMenu],
  );

  const acoes = useMemo<AcoesDoQuadro>(
    () => ({
      projetoId,
      clienteId: clienteId || null,
      travado,
      mudarDados: (id, dados) => onMudarCanvas((c) => mudarDados(c, id, dados)),
      rodar: onRodar,
      duplicar: (id) => {
        const feito = { novo: "", erro: "" };
        onMudarCanvas((c) => {
          const n = c.nos.find((x) => x.id === id);
          if (!n) return c;
          const r = criarNo(c, n.tipo, { x: n.x + 40, y: n.y + 40 }, JSON.parse(JSON.stringify(n.dados || {})));
          if (!r.no) {
            feito.erro = r.erro || "";
            return c;
          }
          feito.novo = r.no.id;
          return r.canvas;
        });
        if (feito.novo) onSelecionar(feito.novo);
        else if (feito.erro) toast.warning("O quadro está cheio", { description: feito.erro });
      },
      sincronizar: onSincronizar || null,
      abrirDetalhes: onAbrirDetalhes || null,
      apagar: (id) => {
        onMudarCanvas((c) => removerNo(c, id));
        delete memoria.current.medidas[id];
        delete memoria.current.arrastando[id];
        onSelecionar(null);
      },
      alternarExpandido: (id) => setExpandidos((x) => ({ ...x, [id]: !x[id] })),
      abrirMenu,
      escolherStoryboard: onEscolherStoryboard,
      mudarGatilho: (ligacaoId, gatilho) => (onMudarGatilho ? onMudarGatilho(ligacaoId, gatilho) : onMudarCanvas((c) => definirGatilho(c, ligacaoId, gatilho))),
      desligar: (ligacaoId) => {
        onMudarCanvas((c) => desligar(c, ligacaoId));
        setLigacaoSelecionada(null);
      },
    }),
    [projetoId, clienteId, travado, onMudarCanvas, onRodar, onSelecionar, onSincronizar, onAbrirDetalhes, onMudarGatilho, abrirMenu, onEscolherStoryboard],
  );

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    const t = e.dataTransfer ? e.dataTransfer.getData(TIPO_ARRASTADO) : "";
    if (!t || !Object.prototype.hasOwnProperty.call(TIPOS_DE_NO, t)) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onSoltar(t as TipoDeNo, { x: p.x - LARGURA_DO_NO / 2, y: p.y - 24 });
  };

  const estilo = {
    "--xy-background-color": "hsl(var(--muted) / 0.35)",
    "--xy-edge-stroke-default": "hsl(var(--muted-foreground))",
    "--xy-connectionline-stroke-default": "hsl(var(--primary))",
    "--xy-connectionline-stroke-width-default": 2.5,
    "--xy-node-boxshadow-selected-default": "none",
    "--xy-node-border-radius-default": "12px",
  } as CSSProperties;

  const origemDoMenu = menu ? canvas.nos.find((n) => n.id === menu.de.no) : null;
  const tiposDoMenu = origemDoMenu ? (menu && menu.de.lado === "saida" ? tiposQueRecebem(origemDoMenu.tipo) : tiposQueEntram(origemDoMenu.tipo)) : [];
  const fecharMenu = useCallback(() => setMenu(null), []);

  return (
    <ContextoDoQuadro.Provider value={acoes}>
      <div ref={caixa} className="relative h-full w-full min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={soltar} data-quadro-do-lab="" data-travado={travado ? "" : undefined}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={TIPOS_NO_QUADRO}
          edgeTypes={TIPOS_DE_LIGACAO}
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
          onConnectEnd={aoTerminarLigacao}
          // Toda tentativa chega no onConnect: lá a regra decide e explica quando não pode.
          isValidConnection={(c) => c.source !== c.target}
          connectionRadius={RAIO_DE_LIGACAO}
          connectionLineComponent={LinhaDeConexao}
          onPaneClick={() => {
            onSelecionar(null);
            setLigacaoSelecionada(null);
            setMenu(null);
          }}
          onMoveEnd={(_e, v) => onViewport(v)}
          defaultViewport={canvas.viewport}
          fitView={canvas.nos.length > 0}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesDraggable={!travado}
          nodesConnectable={!travado}
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
          deleteKeyCode={semTeclas || travado ? null : ["Delete"]}
          proOptions={{ hideAttribution: true }}
          colorMode={theme === "light" ? "light" : "dark"}
          style={estilo}
        >
          <Background id="lab" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="hsl(var(--muted-foreground) / 0.35)" />
          <ControlesDoQuadro travado={travado} onTravar={setTravado} mapa={mapa} onMapa={setMapa} />
          {mapa ? (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Mini-mapa do quadro"
              nodeColor={(n) => (n.type && ehTipoDeNo(n.type) ? TIPOS_DE_NO[n.type].cor : "#71717a")}
              nodeBorderRadius={8}
              bgColor="hsl(var(--popover))"
              maskColor="hsl(var(--background) / 0.55)"
              className="!m-3 overflow-hidden rounded-lg border border-border"
            />
          ) : null}
        </ReactFlow>
        {menu ? (
          <MenuRapido
            x={menu.x}
            y={menu.y}
            titulo={origemDoMenu ? (menu.de.lado === "saida" ? `Ligar ${TIPOS_DE_NO[origemDoMenu.tipo].rotulo} a um nó novo` : `Nó novo que entra em ${TIPOS_DE_NO[origemDoMenu.tipo].rotulo}`) : "Nó novo"}
            tipos={tiposDoMenu}
            onEscolher={escolherDoMenu}
            onFechar={fecharMenu}
          />
        ) : null}
      </div>
    </ContextoDoQuadro.Provider>
  );
}
