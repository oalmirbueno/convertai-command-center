import { memo, useEffect, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type ConnectionLineComponentProps, type Edge, type EdgeProps } from "@xyflow/react";
import { X, Zap } from "lucide-react";
import { TIPOS_DE_NO, ehTipoDeNo, type Gatilho, type TipoDeNo } from "@/lib/laboratorio/nos";
import SeletorDeGatilho from "../SeletorDeGatilho";
import { useAcoesDoQuadro } from "./contexto";
import { caminhoArredondado, rotaSemCartoes, type ObstaculoDoQuadro } from "./visualDoQuadro";

/**
 * A ligação do quadro: curva suave na cor do nó de origem; com o destino
 * rodando, um ponto corre pela linha. Passando o mouse (ou com a ligação
 * selecionada), aparece no meio o botão de tirar a ligação.
 *
 * Funil (v4): com gatilho, uma etiqueta pequena no meio do fio diz o
 * "quando" ("Enviou o formulário", "Compra aprovada"). Tocar na etiqueta, ou
 * no meio do fio de uma origem que tem gatilho (o raio que aparece ali), abre
 * o seletor ali mesmo. Duplo clique no fio também abre.
 */

export interface DadosDaLigacao extends Record<string, unknown> {
  cor: string;
  /** O nó de destino está rodando (ou na fila): o ponto corre. */
  rodando: boolean;
  /** Gatilho do funil no fio (null = sem gatilho). */
  gatilho?: string | null;
  rotuloDoGatilho?: string;
  tipoDaOrigem?: TipoDeNo | null;
  /** A origem tem gatilhos (página, checkout, quiz, webinar, teste A/B). */
  aceitaGatilho?: boolean;
  opacidade?: number;
  destacada?: boolean;
  obstaculos?: ObstaculoDoQuadro[];
}

const CURVA = 0.32;
const SOMBRA = "0 4px 12px -4px rgba(0,0,0,0.35)";

export const LigacaoDoLab = memo(function LigacaoDoLab({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<DadosDaLigacao>>) {
  const a = useAcoesDoQuadro();
  const [caminho, meioX, meioY] = useMemo(() => {
    const rota = rotaSemCartoes({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, data?.obstaculos || []);
    return rota ? [caminhoArredondado(rota), (rota[2].x + rota[3].x) / 2, rota[2].y] as const : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: CURVA });
  }, [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data?.obstaculos]);
  const [perto, setPerto] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  const relogio = useRef<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => () => {
    if (relogio.current) window.clearTimeout(relogio.current);
  }, []);
  // Seletor aberto: Esc ou tocar fora fecha; o foco vai para a escolha.
  useEffect(() => {
    if (!escolhendo) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEscolhendo(false);
    };
    const fora = (e: MouseEvent | TouchEvent) => {
      if (caixa.current && e.target instanceof Node && !caixa.current.contains(e.target)) setEscolhendo(false);
    };
    window.addEventListener("keydown", tecla);
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    const campo = caixa.current ? (caixa.current.querySelector("select") as HTMLSelectElement | null) : null;
    if (campo) campo.focus();
    return () => {
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
    };
  }, [escolhendo]);
  const entrar = () => {
    if (relogio.current) window.clearTimeout(relogio.current);
    relogio.current = null;
    setPerto(true);
  };
  // Sai devagar: dá tempo de levar o mouse da linha até o botão.
  const sair = () => {
    if (relogio.current) window.clearTimeout(relogio.current);
    relogio.current = window.setTimeout(() => setPerto(false), 220);
  };
  const cor = (data && data.cor) || "hsl(var(--muted-foreground))";
  const ativa = perto || !!selected;
  const opacidade = ativa ? 0.95 : data?.destacada ? Math.max(0.55, data?.opacidade || 0.24) : data?.opacidade ?? 0.24;
  const gatilho = data && data.gatilho ? data.gatilho : null;
  const rotulo = (data && data.rotuloDoGatilho) || "";
  const tipoDaOrigem = data && data.tipoDaOrigem ? data.tipoDaOrigem : null;
  const podeGatilho = !!(data && data.aceitaGatilho && tipoDaOrigem) && !a.travado;
  const mostraBotoes = ativa && !a.travado;
  const abrirSeletor = () => {
    if (podeGatilho) setEscolhendo(true);
  };
  return (
    <>
      <BaseEdge id={id} path={caminho} interactionWidth={0} style={{ stroke: cor, strokeWidth: ativa ? 2.25 : 1.5, strokeLinecap: "round", opacity: opacidade, transition: "stroke-width 150ms, opacity 150ms" }} />
      {/* Faixa invisível e larga: o mouse acha a linha sem precisar mirar. */}
      <path
        d={caminho}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="react-flow__edge-interaction"
        onMouseEnter={entrar}
        onMouseLeave={sair}
        onDoubleClick={abrirSeletor}
        data-faixa-da-ligacao={id}
      />
      {data && data.rodando ? (
        <circle r={4.5} fill={cor} data-ponto-correndo={id}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={caminho} />
        </circle>
      ) : null}
      {(gatilho && (ativa || data?.destacada)) || mostraBotoes || escolhendo ? (
        <EdgeLabelRenderer>
          <div
            ref={caixa}
            className="nodrag nopan nowheel absolute flex flex-col items-center"
            style={{ transform: `translate(-50%, -50%) translate(${meioX}px, ${meioY}px)`, pointerEvents: "all", zIndex: escolhendo ? 20 : undefined }}
            onMouseEnter={entrar}
            onMouseLeave={sair}
            data-meio-da-ligacao={id}
          >
            <div className="flex items-center">
              {gatilho && rotulo ? (
                <button
                  type="button"
                  className="inline-flex h-7 max-w-[220px] items-center rounded-full border bg-popover px-2 text-[12px] font-medium leading-none text-foreground transition-colors hover:bg-muted disabled:cursor-default"
                  style={{ borderColor: cor, boxShadow: SOMBRA }}
                  onClick={(e) => {
                    e.stopPropagation();
                    abrirSeletor();
                  }}
                  disabled={!podeGatilho}
                  aria-label={`Gatilho: ${rotulo}. Trocar o gatilho`}
                  title={`Quando: ${rotulo}. Toque para trocar`}
                  data-etiqueta-do-gatilho={id}
                >
                  <Zap className="mr-1 h-3 w-3 shrink-0" style={{ color: cor }} aria-hidden="true" />
                  <span className="truncate">{rotulo}</span>
                </button>
              ) : mostraBotoes && podeGatilho ? (
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground transition-colors hover:text-foreground"
                  style={{ boxShadow: SOMBRA }}
                  onClick={(e) => {
                    e.stopPropagation();
                    abrirSeletor();
                  }}
                  aria-label="Pôr gatilho no fio"
                  title="Pôr gatilho no fio (quando a pessoa passa por aqui)"
                  data-por-gatilho={id}
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {mostraBotoes ? (
                <button
                  type="button"
                  className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                  style={{ boxShadow: SOMBRA }}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.desligar(id);
                  }}
                  aria-label="Tirar a ligação"
                  title="Tirar a ligação"
                  data-tirar-ligacao={id}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {escolhendo && tipoDaOrigem ? (
              <div className="mt-1 w-[220px] rounded-lg border border-border bg-popover px-2 pb-2 pt-1" style={{ boxShadow: "0 12px 32px -10px rgba(0,0,0,0.45)" }} data-seletor-no-fio={id}>
                <SeletorDeGatilho
                  ligacao={{ id, de: "", para: "", ...(gatilho ? { gatilho: gatilho as Gatilho } : {}) }}
                  tipoDaOrigem={tipoDaOrigem}
                  id={`gatilho-no-fio-${id}`}
                  onMudar={(g) => {
                    a.mudarGatilho(id, g);
                    setEscolhendo(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

/** A linha enquanto se arrasta uma ligação: tracejada na cor da origem, com a ponta que acende quando pode ligar. */
export function LinhaDeConexao({ fromX, fromY, toX, toY, fromPosition, toPosition, fromNode, connectionStatus }: ConnectionLineComponentProps) {
  const tipo = fromNode && fromNode.type;
  const cor = tipo && ehTipoDeNo(tipo) ? TIPOS_DE_NO[tipo].cor : "hsl(var(--primary))";
  const [caminho] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition, curvature: CURVA });
  const pode = connectionStatus === "valid";
  return (
    <g data-linha-de-conexao="">
      <path d={caminho} fill="none" stroke={cor} strokeOpacity={0.18} strokeWidth={9} strokeLinecap="round" />
      <path d={caminho} fill="none" stroke={cor} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="7 6" />
      <circle cx={toX} cy={toY} r={pode ? 7 : 5} fill={pode ? cor : "hsl(var(--card))"} stroke={cor} strokeWidth={2} />
    </g>
  );
}
