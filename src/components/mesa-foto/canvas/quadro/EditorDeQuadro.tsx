import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Circle,
  Clapperboard,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Film,
  Group,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Lock,
  Minus,
  Pause,
  Play,
  Redo2,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { modeloDoPapel, usd } from "@/lib/mesa/api";
import { uidDoClique } from "@/lib/editor/render";
import { subirQuadro } from "@/lib/mesa-videos/quadros";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import {
  agrupar,
  alinhar,
  aplicarModelo,
  aplicarMovimentoPronto,
  conteudoDoQuadro,
  desagrupar,
  distribuir,
  duplicarCamadas,
  ENTRADAS,
  estadoNoTempo,
  FONTES_DO_QUADRO,
  FORMAS,
  LISTA_DE_FORMATOS_DO_QUADRO,
  FORMATOS_DO_QUADRO,
  MAX_CAMADAS,
  MODELOS_DO_QUADRO,
  MOVIMENTOS_PRONTOS,
  mudarOrdem,
  novaCamada,
  novoIdDaCamada,
  porChave,
  quadroNoFormato,
  ROTULO_DA_ENTRADA,
  ROTULO_DA_SAIDA,
  SAIDAS,
  textoSobre,
  tirarChave,
  type Alinhamento,
  type CamadaDoQuadro,
  type FormaDaCamada,
  type FormatoDoQuadro,
  type MarcaDoQuadro,
  type MidiaDaCamada,
  type QuadroAnimado,
  type TipoDeCamada,
} from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import PalcoDoQuadro from "./PalcoDoQuadro";
import EscolherMidia from "./EscolherMidia";
import { nomeDeArquivo, useFontesDoQuadro, useQuadroComDesfazer, useUrlsDasMidias } from "./apoio";
import { baixarBlob, exportarQuadroPng } from "./exportarQuadro";
import { enderecoDoEditor, mandarQuadroParaORender } from "./quadroParaEdicao";
import { estimativaDoOrdenar, montarQuadroComIA, opcoesDaMontagem, ordenarLayoutsPeloJev, partesDaMontagem, type OpcaoDeLayout } from "./quadroApi";

/**
 * Editor do Quadro animado (frente CNV, 30/09). Pedido do dono: "deixe o
 * canvas melhorado, mais inteligente e mais completinho".
 *
 * - Camadas: texto, imagem, vídeo, forma e logo; ver, travar, renomear,
 *   subir, descer, duplicar, apagar; grupos (Ctrl+G) e seleção múltipla.
 * - Palco com encaixe e guias (centro, bordas, margem de 6% e as outras
 *   camadas; Alt solta o encaixe), alças de tamanho e de giro, zoom.
 * - Alinhar e distribuir; proporções 9:16, 4:5, 1:1 e 16:9.
 * - Animação por camada: entrada, saída, movimento pronto e chaves simples no
 *   tempo (posição, escala, opacidade, giro), com linha do tempo e play.
 * - Modelos da marca (cores, fontes e logo reais) e sugestões de layout com o
 *   mesmo conteúdo, ordenadas pelo Jev.
 * - Montar com IA pelo pedido (conteúdo pela IA, posição pelo código), com o
 *   custo antes, a prévia das opções e o Desfazer.
 * - Trocar mídia pelo acervo, exportar o quadro (PNG), salvar no acervo de
 *   vídeo e mandar para o render (Mesa Edição).
 * Desfazer e refazer em tudo (Ctrl+Z, Ctrl+Shift+Z). Nada de gasto sem clique.
 */

const ROTULO_DO_TIPO: Record<TipoDeCamada, string> = { texto: "Texto", imagem: "Imagem", video: "Vídeo", forma: "Forma", logo: "Logo" };
const ICONE_DO_TIPO: Record<TipoDeCamada, ReactNode> = {
  texto: <Type className="h-3.5 w-3.5" />,
  imagem: <ImageIcon className="h-3.5 w-3.5" />,
  video: <Film className="h-3.5 w-3.5" />,
  forma: <Square className="h-3.5 w-3.5" />,
  logo: <Sparkles className="h-3.5 w-3.5" />,
};
const ROTULO_DA_FORMA: Record<FormaDaCamada, string> = { retangulo: "Retângulo", pilula: "Pílula", circulo: "Círculo", linha: "Linha" };
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => Math.round(n * 1000) / 10;

type AbaLateral = "camadas" | "modelos" | "ia";
type PedidoDeMidia = { para: "nova"; tipo: "imagem" | "video" } | { para: "trocar"; id: string; somente: "imagem" | "video" | null };

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="mb-2 block min-w-0">
      <span className={juntar(texto.rotulo, "mb-1 block")}>{rotulo}</span>
      {children}
    </label>
  );
}

function Numero({ valor, onMudar, rotulo, passo = 1, min, max }: { valor: number; onMudar: (n: number) => void; rotulo: string; passo?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      className={juntar(campo, "h-8 px-2")}
      value={Number.isFinite(valor) ? valor : 0}
      step={passo}
      min={min}
      max={max}
      aria-label={rotulo}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onMudar(n);
      }}
    />
  );
}

function Pilulas<T extends string>({ opcoes, valor, onEscolher, rotulo }: { opcoes: { valor: T; rotulo: string }[]; valor: T; onEscolher: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex min-w-0 flex-wrap">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => onEscolher(o.valor)}
          className={juntar("mb-1 mr-1 inline-flex h-7 items-center rounded-md border px-2 text-[12px]", valor === o.valor ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Miniatura de um quadro (mesmo desenho do palco). */
export function MiniaturaDoQuadro({ quadro, largura, urls, t }: { quadro: QuadroAnimado; largura: number; urls: Record<string, string>; t?: number }) {
  const tempo = typeof t === "number" ? t : Math.min(quadro.duracao_s, 2.4);
  return <PalcoDoQuadro quadro={quadro} t={tempo} urls={urls} largura={largura} soLeitura />;
}

/** Linha do tempo: uma faixa por camada (arrastar move; as pontas mudam início e fim), as chaves e a agulha. */
function LinhaDoTempo({
  quadro,
  t,
  onTempo,
  selecionadas,
  onSelecionar,
  onMudarCamada,
}: {
  quadro: QuadroAnimado;
  t: number;
  onTempo: (t: number) => void;
  selecionadas: string[];
  onSelecionar: (id: string) => void;
  onMudarCamada: (id: string, fn: (c: CamadaDoQuadro) => CamadaDoQuadro, juntar: string) => void;
}) {
  const regua = useRef<HTMLDivElement | null>(null);
  const gesto = useRef<{ id: string; modo: "mover" | "inicio" | "fim"; x0: number; inicio: number; fim: number } | null>(null);
  const d = quadro.duracao_s;
  const tempoNoPonto = (clientX: number) => {
    const r = regua.current ? regua.current.getBoundingClientRect() : null;
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(d, ((clientX - r.left) / r.width) * d));
  };
  useEffect(() => {
    const mover = (e: MouseEvent | TouchEvent) => {
      const g = gesto.current;
      if (!g) return;
      const x = (e as TouchEvent).touches && (e as TouchEvent).touches.length ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const r = regua.current ? regua.current.getBoundingClientRect() : null;
      if (!r || !r.width) return;
      const dt = ((x - g.x0) / r.width) * d;
      onMudarCamada(
        g.id,
        (c) => {
          if (g.modo === "inicio") return { ...c, inicio_s: r3(Math.max(0, Math.min(g.fim - 0.2, g.inicio + dt))) };
          if (g.modo === "fim") return { ...c, fim_s: r3(Math.min(d, Math.max(g.inicio + 0.2, g.fim + dt))) };
          const tam = g.fim - g.inicio;
          const ini = Math.max(0, Math.min(d - tam, g.inicio + dt));
          const passo = ini - c.inicio_s;
          return { ...c, inicio_s: r3(ini), fim_s: r3(ini + tam), chaves: c.chaves.map((k) => ({ ...k, t: r3(Math.max(0, Math.min(d, k.t + passo))) })) };
        },
        `tempo-${g.id}`,
      );
    };
    const soltar = () => {
      gesto.current = null;
    };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    window.addEventListener("touchmove", mover);
    window.addEventListener("touchend", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
      window.removeEventListener("touchmove", mover);
      window.removeEventListener("touchend", soltar);
    };
  }, [d, onMudarCamada]);
  const comecar = (e: { clientX?: number; touches?: { clientX: number }[]; stopPropagation: () => void }, c: CamadaDoQuadro, modo: "mover" | "inicio" | "fim") => {
    e.stopPropagation();
    const x = e.touches && e.touches.length ? e.touches[0].clientX : e.clientX || 0;
    onSelecionar(c.id);
    gesto.current = { id: c.id, modo, x0: x, inicio: c.inicio_s, fim: c.fim_s };
  };
  const marcas: number[] = [];
  const passo = d > 20 ? 5 : d > 8 ? 2 : 1;
  for (let s = 0; s <= d + 1e-6; s += passo) marcas.push(s);
  return (
    <div className="min-w-0 border-t border-border bg-card px-3 pb-2 pt-1.5" data-linha-do-tempo="">
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.etiqueta, "tabular-nums text-muted-foreground")}>{t.toFixed(2)} s</span>
        <div
          ref={regua}
          className="relative ml-2 h-5 min-w-0 flex-1 cursor-pointer rounded bg-muted"
          onMouseDown={(e) => onTempo(tempoNoPonto(e.clientX))}
          onTouchStart={(e) => e.touches.length && onTempo(tempoNoPonto(e.touches[0].clientX))}
          data-regua=""
        >
          {marcas.map((s) => (
            <span key={s} className="pointer-events-none absolute top-0 h-full border-l border-border text-[11px] leading-5 text-muted-foreground" style={{ left: `${(s / d) * 100}%`, paddingLeft: 2 }}>
              {s}
            </span>
          ))}
          <span className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 bg-primary" style={{ left: `${(t / d) * 100}%` }} data-agulha="" />
        </div>
      </div>
      <ol className="min-w-0 sm:max-h-[132px] sm:overflow-y-auto sm:overscroll-contain" aria-label="Camadas no tempo">
        {quadro.camadas
          .slice()
          .reverse()
          .map((c) => {
            const ativa = selecionadas.indexOf(c.id) >= 0;
            return (
              <li key={c.id} className="flex h-6 min-w-0 items-center" data-faixa-da-camada={c.id}>
                <button type="button" className={juntar("mr-2 w-[88px] shrink-0 truncate text-left text-[11px]", ativa ? "font-semibold text-foreground" : "text-muted-foreground")} onClick={() => onSelecionar(c.id)} title={c.nome}>
                  {c.nome}
                </button>
                <div className="relative h-4 min-w-0 flex-1">
                  <div
                    className={juntar("absolute top-0 h-4 cursor-grab rounded", ativa ? "bg-primary/70" : "bg-muted-foreground/40", !c.visivel && "opacity-40")}
                    style={{ left: `${(c.inicio_s / d) * 100}%`, width: `${Math.max(0.5, ((c.fim_s - c.inicio_s) / d) * 100)}%` }}
                    onMouseDown={(e) => comecar(e, c, "mover")}
                    onTouchStart={(e) => comecar({ touches: Array.from(e.touches), stopPropagation: () => e.stopPropagation() }, c, "mover")}
                  >
                    <span className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l bg-foreground/40" onMouseDown={(e) => comecar(e, c, "inicio")} onTouchStart={(e) => comecar({ touches: Array.from(e.touches), stopPropagation: () => e.stopPropagation() }, c, "inicio")} />
                    <span className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-foreground/40" onMouseDown={(e) => comecar(e, c, "fim")} onTouchStart={(e) => comecar({ touches: Array.from(e.touches), stopPropagation: () => e.stopPropagation() }, c, "fim")} />
                  </div>
                  {c.chaves.map((k, i) => (
                    <button
                      key={i}
                      type="button"
                      title={`Chave em ${k.t.toFixed(2)} s`}
                      onClick={() => {
                        onSelecionar(c.id);
                        onTempo(k.t);
                      }}
                      className="absolute top-0.5 -ml-1.5 flex h-3 w-3 items-center justify-center text-amber-400"
                      style={{ left: `${(k.t / d) * 100}%` }}
                      data-chave-no-tempo={k.t}
                    >
                      <Diamond className="h-3 w-3 fill-current" />
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
      </ol>
    </div>
  );
}

/** Painel de propriedades da camada escolhida. */
function Inspetor({
  camada,
  t,
  duracao,
  onMudar,
  onTrocarMidia,
  refDoTexto,
}: {
  camada: CamadaDoQuadro;
  t: number;
  duracao: number;
  onMudar: (fn: (c: CamadaDoQuadro) => CamadaDoQuadro, juntar?: string) => void;
  onTrocarMidia: () => void;
  refDoTexto: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const c = camada;
  const set = (m: Partial<CamadaDoQuadro>, juntar?: string) => onMudar((x) => ({ ...x, ...m }), juntar);
  const estado = estadoNoTempo(c, t);
  const chaveAqui = c.chaves.find((k) => Math.abs(k.t - t) <= 0.02) || null;
  return (
    <div className="min-w-0" data-inspetor={c.id}>
      <Linha rotulo="Nome">
        <input className={juntar(campo, "h-8")} value={c.nome} onChange={(e) => set({ nome: e.target.value.slice(0, 60) }, `nome-${c.id}`)} />
      </Linha>
      {c.tipo === "texto" && (
        <>
          <Linha rotulo="Texto">
            <textarea ref={refDoTexto} className={juntar(campoTexto, "min-h-[72px]")} value={c.texto} onChange={(e) => set({ texto: e.target.value.slice(0, 400) }, `texto-${c.id}`)} data-campo-texto-da-camada="" />
          </Linha>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Linha rotulo="Fonte">
              <select className={juntar(campo, "h-8 px-2")} value={c.fonte} onChange={(e) => set({ fonte: e.target.value })}>
                {FONTES_DO_QUADRO.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </Linha>
            <Linha rotulo="Peso">
              <select className={juntar(campo, "h-8 px-2")} value={String(c.peso)} onChange={(e) => set({ peso: Number(e.target.value) })}>
                {[300, 400, 500, 600, 700, 800, 900].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Linha>
          </div>
          <Linha rotulo={`Tamanho (${pct(c.tamanho)}% da largura)`}>
            <input type="range" min={1} max={30} step={0.5} className="w-full" value={pct(c.tamanho)} onChange={(e) => set({ tamanho: Number(e.target.value) / 100 }, `tam-${c.id}`)} />
          </Linha>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Linha rotulo="Cor">
              <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-input bg-background" value={c.cor} onChange={(e) => set({ cor: e.target.value }, `cor-${c.id}`)} />
            </Linha>
            <Linha rotulo="Fundo">
              <div className="flex min-w-0 items-center">
                <input type="color" className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-input bg-background" value={c.fundo || "#000000"} onChange={(e) => set({ fundo: e.target.value }, `fundo-${c.id}`)} />
                {c.fundo && (
                  <button type="button" className={juntar(botao.icone, "ml-1 h-8 w-8")} onClick={() => set({ fundo: null })} aria-label="Sem fundo">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </Linha>
          </div>
          <Linha rotulo="Alinhamento">
            <Pilulas rotulo="Alinhamento do texto" opcoes={[{ valor: "esquerda", rotulo: "Esquerda" }, { valor: "centro", rotulo: "Centro" }, { valor: "direita", rotulo: "Direita" }]} valor={c.alinhamento} onEscolher={(v) => set({ alinhamento: v })} />
          </Linha>
          <div className="mb-2 flex min-w-0 flex-wrap">
            <label className={juntar(texto.auxiliar, "mb-1 mr-3 inline-flex items-center")}>
              <input type="checkbox" className="mr-1.5" checked={c.maiusculas} onChange={(e) => set({ maiusculas: e.target.checked })} /> Maiúsculas
            </label>
            <label className={juntar(texto.auxiliar, "mb-1 inline-flex items-center")}>
              <input type="checkbox" className="mr-1.5" checked={c.sombra} onChange={(e) => set({ sombra: e.target.checked })} /> Sombra
            </label>
          </div>
        </>
      )}
      {(c.tipo === "imagem" || c.tipo === "video" || c.tipo === "logo") && (
        <>
          <Linha rotulo="Mídia">
            <div className="flex min-w-0 items-center">
              <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{c.midia ? c.midia.nome : "Sem mídia"}</span>
              <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-2")} onClick={onTrocarMidia} data-trocar-midia="">
                Trocar pelo acervo
              </button>
            </div>
          </Linha>
          <Linha rotulo="Ajuste">
            <Pilulas rotulo="Ajuste da mídia" opcoes={[{ valor: "cobrir", rotulo: "Cobrir" }, { valor: "conter", rotulo: "Caber inteira" }]} valor={c.ajuste} onEscolher={(v) => set({ ajuste: v })} />
          </Linha>
        </>
      )}
      {c.tipo === "forma" && (
        <>
          <Linha rotulo="Forma">
            <Pilulas rotulo="Tipo da forma" opcoes={FORMAS.map((f) => ({ valor: f, rotulo: ROTULO_DA_FORMA[f] }))} valor={c.forma} onEscolher={(v) => set({ forma: v, ...(v === "linha" ? { a: Math.min(c.a, 0.006) } : {}) })} />
          </Linha>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Linha rotulo="Cor">
              <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-input bg-background" value={c.cor} onChange={(e) => set({ cor: e.target.value }, `cor-${c.id}`)} />
            </Linha>
            <Linha rotulo="Borda">
              <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-input bg-background" value={c.borda_cor || "#ffffff"} onChange={(e) => set({ borda_cor: e.target.value, borda: c.borda || 0.004 }, `borda-${c.id}`)} />
            </Linha>
          </div>
        </>
      )}
      {c.tipo !== "texto" && (
        <Linha rotulo={`Canto (${pct(c.canto)}%)`}>
          <input type="range" min={0} max={50} step={0.5} className="w-full" value={pct(c.canto)} onChange={(e) => set({ canto: Number(e.target.value) / 100 }, `canto-${c.id}`)} />
        </Linha>
      )}
      <p className={juntar(texto.rotulo, "mb-1 mt-3")}>Posição e tamanho (% do quadro)</p>
      <div className="grid min-w-0 grid-cols-4 gap-1.5">
        <Numero rotulo="X" valor={pct(c.x)} onMudar={(n) => set({ x: n / 100 }, `x-${c.id}`)} passo={0.5} />
        <Numero rotulo="Y" valor={pct(c.y)} onMudar={(n) => set({ y: n / 100 }, `y-${c.id}`)} passo={0.5} />
        <Numero rotulo="Largura" valor={pct(c.l)} onMudar={(n) => set({ l: Math.max(0.5, n) / 100 }, `l-${c.id}`)} passo={0.5} />
        <Numero rotulo="Altura" valor={pct(c.a)} onMudar={(n) => set({ a: Math.max(0.2, n) / 100 }, `a-${c.id}`)} passo={0.5} />
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
        <Linha rotulo={`Giro (${Math.round(c.rotacao)}°)`}>
          <input type="range" min={-180} max={180} step={1} className="w-full" value={c.rotacao} onChange={(e) => set({ rotacao: Number(e.target.value) }, `giro-${c.id}`)} />
        </Linha>
        <Linha rotulo={`Opacidade (${Math.round(c.opacidade * 100)}%)`}>
          <input type="range" min={0} max={100} step={1} className="w-full" value={Math.round(c.opacidade * 100)} onChange={(e) => set({ opacidade: Number(e.target.value) / 100 }, `opac-${c.id}`)} />
        </Linha>
      </div>
      <p className={juntar(texto.rotulo, "mb-1 mt-3")}>Tempo (s)</p>
      <div className="grid min-w-0 grid-cols-2 gap-1.5">
        <Numero rotulo="Início" valor={c.inicio_s} passo={0.1} min={0} max={duracao} onMudar={(n) => set({ inicio_s: r3(Math.max(0, Math.min(c.fim_s - 0.1, n))) }, `ini-${c.id}`)} />
        <Numero rotulo="Fim" valor={c.fim_s} passo={0.1} min={0} max={duracao} onMudar={(n) => set({ fim_s: r3(Math.min(duracao, Math.max(c.inicio_s + 0.1, n))) }, `fim-${c.id}`)} />
      </div>
      <p className={juntar(texto.rotulo, "mb-1 mt-3")}>Animação</p>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <Linha rotulo="Entrada">
          <select className={juntar(campo, "h-8 px-2")} value={c.entrada} onChange={(e) => set({ entrada: e.target.value as CamadaDoQuadro["entrada"] })} data-entrada-da-camada="">
            {ENTRADAS.map((x) => (
              <option key={x} value={x}>
                {ROTULO_DA_ENTRADA[x]}
              </option>
            ))}
          </select>
        </Linha>
        <Linha rotulo="Saída">
          <select className={juntar(campo, "h-8 px-2")} value={c.saida} onChange={(e) => set({ saida: e.target.value as CamadaDoQuadro["saida"] })}>
            {SAIDAS.map((x) => (
              <option key={x} value={x}>
                {ROTULO_DA_SAIDA[x]}
              </option>
            ))}
          </select>
        </Linha>
      </div>
      <Linha rotulo="Movimento pronto">
        <select className={juntar(campo, "h-8 px-2")} value="" onChange={(e) => e.target.value && onMudar((x) => aplicarMovimentoPronto(x, e.target.value))} aria-label="Aplicar um movimento pronto">
          <option value="">Escolher (troca as chaves)</option>
          {MOVIMENTOS_PRONTOS.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </Linha>
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "flex-1")}>Chaves ({c.chaves.length})</span>
        <button
          type="button"
          className={juntar(botao.secundario, "h-7 px-2")}
          onClick={() => onMudar((x) => porChave(x, t, { x: r3(estado.x), y: r3(estado.y), escala: r3(estado.escala / 1), opacidade: r3(x.opacidade), rotacao: r3(estado.rotacao) }))}
          title="Grava a posição, a escala, a opacidade e o giro de agora neste tempo"
          data-marcar-chave=""
        >
          <Diamond className="mr-1 h-3 w-3" /> {chaveAqui ? "Atualizar chave" : `Chave em ${t.toFixed(1)} s`}
        </button>
      </div>
      {c.chaves.length > 0 && (
        <ul className="mb-2 flex min-w-0 flex-wrap">
          {c.chaves.map((k, i) => (
            <li key={i} className="mb-1 mr-1 inline-flex h-6 items-center rounded border border-border px-1.5 text-[11px] tabular-nums">
              {k.t.toFixed(2)} s
              <button type="button" className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => onMudar((x) => tirarChave(x, k.t))} aria-label={`Tirar a chave de ${k.t.toFixed(2)} s`}>
                <Minus className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.chaves.length > 0 && <p className={texto.auxiliar}>Com chave, arraste no palco num tempo e toque em Chave para gravar ali.</p>}
    </div>
  );
}

export default function EditorDeQuadro({
  aberto,
  onFechar,
  inicial,
  titulo,
  canvasId,
  ligadas,
  marca,
  onGravar,
  abaInicial,
}: {
  aberto: boolean;
  abaInicial?: AbaLateral;
  onFechar: () => void;
  inicial: QuadroAnimado;
  titulo: string;
  canvasId: string | null;
  /** Mídias que chegam ao Quadro pelas ligações do Canvas. */
  ligadas: MidiaDaCamada[];
  marca: MarcaDoQuadro;
  /** Grava o quadro no cartão (o Canvas salva sozinho em seguida). */
  onGravar: (q: QuadroAnimado) => void;
}) {
  const mesa = useMesa();
  const { clientId, catalogo, atualizarCusto } = mesa;
  const avisarErro = useAvisarErro();
  const { quadro, mudar, trocar, desfazer, refazer, podeDesfazer, podeRefazer } = useQuadroComDesfazer(inicial);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [t, setT] = useState(Math.min(inicial.duracao_s, 1.5));
  const [tocando, setTocando] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [aba, setAba] = useState<AbaLateral>(abaInicial || (inicial.camadas.length ? "camadas" : "modelos"));
  const [midia, setMidia] = useState<PedidoDeMidia | null>(null);
  const [pedido, setPedido] = useState("");
  const [modeloIa, setModeloIa] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoDeLayout[]>([]);
  const [respostaIa, setRespostaIa] = useState<string>("");
  const [ordem, setOrdem] = useState<Record<string, number | null> | null>(null);
  const [ocupado, setOcupado] = useState<"" | "png" | "acervo" | "render" | "ordenar">("");
  const [area, setArea] = useState({ l: 640, a: 560 });
  const refArea = useRef<HTMLDivElement | null>(null);
  const refDoTexto = useRef<HTMLTextAreaElement | null>(null);
  useFontesDoQuadro();
  const urls = useUrlsDasMidias(quadro.camadas.map((c) => c.midia).concat(ligadas, marca.logo ? [marca.logo] : []));
  const papelPadrao = modeloDoPapel(catalogo, "motion");
  const modeloDaIa = modeloIa || (papelPadrao ? papelPadrao.id : "");

  // Grava no cartão (400 ms depois da última mudança; ao fechar, na hora).
  const ultimo = useRef(quadro);
  ultimo.current = quadro;
  useEffect(() => {
    if (quadro === inicial) return;
    const id = window.setTimeout(() => onGravar(quadro), 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadro]);
  const fechar = () => {
    setTocando(false);
    if (ultimo.current !== inicial) onGravar(ultimo.current);
    onFechar();
  };

  // Tamanho do palco: cabe na área, vezes o zoom.
  useEffect(() => {
    if (!aberto) return;
    const medir = () => {
      const el = refArea.current;
      if (el && el.clientWidth > 0) setArea({ l: el.clientWidth, a: el.clientHeight });
    };
    medir();
    const t1 = window.setTimeout(medir, 120);
    const t2 = window.setTimeout(medir, 500);
    window.addEventListener("resize", medir);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", medir);
    };
  }, [aberto]);
  const f = FORMATOS_DO_QUADRO[quadro.formato];
  const cabe = Math.max(160, Math.min(area.l - 32, ((Math.max(200, area.a) - 32) * f.largura) / f.altura));
  const largura = Math.round(cabe * zoom);

  // Play: o tempo anda pelo relógio do navegador; no fim, volta ao começo e para.
  useEffect(() => {
    if (!tocando) return;
    let id = 0;
    let antes = 0;
    const passo = (agora: number) => {
      if (!antes) antes = agora;
      const dt = (agora - antes) / 1000;
      antes = agora;
      let parar = false;
      setT((x) => {
        const n = x + dt;
        if (n >= quadro.duracao_s) {
          parar = true;
          return quadro.duracao_s;
        }
        return n;
      });
      if (parar) setTocando(false);
      else id = window.requestAnimationFrame(passo);
    };
    id = window.requestAnimationFrame(passo);
    return () => window.cancelAnimationFrame(id);
  }, [tocando, quadro.duracao_s]);

  const mudarCamadas = useCallback((fn: (l: CamadaDoQuadro[]) => CamadaDoQuadro[], juntar?: string) => mudar((q) => ({ ...q, camadas: fn(q.camadas) }), juntar), [mudar]);
  const mudarCamada = useCallback((id: string, fn: (c: CamadaDoQuadro) => CamadaDoQuadro, juntar?: string) => mudarCamadas((l) => l.map((c) => (c.id === id ? fn(c) : c)), juntar), [mudarCamadas]);

  const unica = selecionadas.length === 1 ? quadro.camadas.find((c) => c.id === selecionadas[0]) || null : null;

  const por = (c: CamadaDoQuadro) => {
    if (quadro.camadas.length >= MAX_CAMADAS) {
      toast.error("O quadro chegou a 40 camadas", { description: "Apague ou junte alguma antes." });
      return;
    }
    mudar((q) => ({ ...q, camadas: q.camadas.concat([{ ...c, fim_s: q.duracao_s }]) }));
    setSelecionadas([c.id]);
    setAba("camadas");
  };
  const porTexto = () => por(novaCamada("texto", quadro, { cor: textoSobre(quadro.fundo), fonte: "montserrat", peso: 800 }));
  const porForma = (forma: FormaDaCamada) => por(novaCamada("forma", quadro, { forma, cor: marca.primaria, ...(forma === "circulo" ? { l: 0.3, a: (0.3 * f.largura) / f.altura } : forma === "linha" ? { a: 0.004, l: 0.6, x: 0.2 } : {}) }));
  const porLogo = () => {
    if (!marca.logo) {
      toast.info("A marca ainda não tem logo no kit", { description: "Suba a logo no Contexto da marca e ela entra aqui pelo código." });
      return;
    }
    por(novaCamada("logo", quadro, { midia: marca.logo, nome: "Logo" }));
  };
  const aoEscolherMidia = (m: MidiaDaCamada) => {
    if (!midia) return;
    const video = /\.(mp4|mov|webm|m4v)$/i.test(m.caminho);
    if (midia.para === "nova") {
      const c = novaCamada(video ? "video" : "imagem", quadro, { midia: m, nome: m.nome.slice(0, 60), ajuste: "cobrir", x: 0, y: 0, l: 1, a: 1 });
      mudar((q) => ({ ...q, camadas: [c].concat(q.camadas) }));
      setSelecionadas([c.id]);
      return;
    }
    const alvo = midia.id;
    mudarCamada(alvo, (c) => ({ ...c, midia: m, tipo: c.tipo === "logo" ? "logo" : video ? "video" : "imagem" }));
  };

  const apagar = (ids: string[]) => {
    if (!ids.length) return;
    mudarCamadas((l) => l.filter((c) => ids.indexOf(c.id) < 0));
    setSelecionadas([]);
  };
  const duplicar = () => {
    const r = duplicarCamadas(quadro.camadas, selecionadas);
    if (!r.novos.length) return;
    mudarCamadas(() => r.camadas);
    setSelecionadas(r.novos);
  };
  const alinharSel = (como: Alinhamento) => mudarCamadas((l) => alinhar(l, selecionadas, como));

  // Teclado: apagar, desfazer, refazer, duplicar, agrupar, setas (fora de campo de texto).
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const escrevendo = !!alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT" || alvo.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z") && !escrevendo) {
        e.preventDefault();
        if (e.shiftKey) refazer();
        else desfazer();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y") && !escrevendo) {
        e.preventDefault();
        refazer();
        return;
      }
      if (escrevendo) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selecionadas.length) {
        e.preventDefault();
        apagar(selecionadas);
      } else if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicar();
      } else if (mod && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) mudarCamadas((l) => desagrupar(l, selecionadas));
        else mudarCamadas((l) => agrupar(l, selecionadas, novoIdDaCamada("g")));
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setTocando((v) => !v);
      } else if (e.key.indexOf("Arrow") === 0 && selecionadas.length) {
        e.preventDefault();
        const passo = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowLeft" ? -passo : e.key === "ArrowRight" ? passo : 0;
        const dy = e.key === "ArrowUp" ? -passo : e.key === "ArrowDown" ? passo : 0;
        mudarCamadas((l) => l.map((c) => (selecionadas.indexOf(c.id) >= 0 && !c.travada ? { ...c, x: r3(c.x + dx), y: r3(c.y + dy) } : c)), "setas");
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, selecionadas, quadro]);

  const trocarFormato = (formato: FormatoDoQuadro) => {
    if (formato === quadro.formato) return;
    // Com modelo da marca, remonta no formato novo; feito à mão, as frações ficam (a pessoa ajusta).
    const r = quadroNoFormato(quadro, formato, marca);
    if (r.remontado) {
      trocar(r.quadro);
      toast.info(`Remontado em ${formato}`, { description: "O modelo da marca refez as posições para a proporção nova.", action: { label: "Desfazer", onClick: () => desfazer() } });
    } else mudar((q) => ({ ...q, formato }));
  };

  const trocarDuracao = (s: number) => {
    const d = Math.max(1, Math.min(60, Math.round(s * 10) / 10));
    mudar((q) => ({ ...q, duracao_s: d, camadas: q.camadas.map((c) => (c.fim_s >= q.duracao_s - 0.05 || c.fim_s > d ? { ...c, fim_s: d, inicio_s: Math.min(c.inicio_s, d - 0.1) } : c)) }), "duracao");
    setT((x) => Math.min(x, d));
  };

  // ---------------------------------------------------------------- IA e sugestões

  const conteudo = useMemo(() => conteudoDoQuadro(quadro), [quadro]);
  const midiasParaModelos = conteudo.midias.length ? conteudo.midias : ligadas;
  // Sugestões: o MESMO conteúdo (texto e mídias do quadro, ou as ligadas) em outros modelos da marca.
  const sugestoes = useMemo(() => {
    const com = { ...conteudo, midias: midiasParaModelos };
    const lista = MODELOS_DO_QUADRO.filter(
      (m) => m.id !== quadro.modelo && (!m.pedeMidia || com.midias.length > 0) && (m.id !== "antes_depois" || com.midias.length >= 2) && (m.id !== "lista_tres" || com.topicos.length >= 2),
    ).map((m) => ({ modelo: m, quadro: aplicarModelo(m.id, com, marca, quadro.formato, quadro.duracao_s) }));
    if (!ordem) return lista;
    return lista.slice().sort((a, b) => (ordem[b.modelo.id] ?? -1) - (ordem[a.modelo.id] ?? -1));
  }, [quadro.modelo, quadro.formato, quadro.duracao_s, conteudo, midiasParaModelos, marca, ordem]);

  const montar = async () => {
    const r = await montarQuadroComIA({ clientId, canvasId, pedido, formato: quadro.formato, midias: midiasParaModelos, modeloId: modeloDaIa || null, conteudoAtual: quadro.camadas.length ? { titulo: conteudo.titulo, subtitulo: conteudo.subtitulo, cta: conteudo.cta, selo: conteudo.selo } : null });
    setOpcoes(opcoesDaMontagem(r, marca, midiasParaModelos, quadro.formato));
    setRespostaIa(r.resposta);
    r.avisos.forEach((a) => toast.info(a));
    atualizarCusto();
    return { custo_usd: r.custo_usd };
  };

  const aplicarOpcao = (q: QuadroAnimado, rotulo: string) => {
    trocar(q);
    setSelecionadas([]);
    setT(Math.min(q.duracao_s, 1.5));
    toast.success(`${rotulo} aplicado`, { action: { label: "Desfazer", onClick: () => desfazer() } });
  };

  const custoDoOrdenar = estimativaDoOrdenar({ pedido, conteudo, modelos: sugestoes.map((x) => x.modelo.id) });
  const ordenarPeloJev = async () => {
    if (mesa.saldoUsd !== null && mesa.saldoUsd < custoDoOrdenar) {
      toast.error("Saldo insuficiente para o Jev", { description: `O Ordenar custa ~${usd(custoDoOrdenar)}; a carteira tem ${usd(mesa.saldoUsd)}.` });
      return;
    }
    setOcupado("ordenar");
    try {
      const r = await ordenarLayoutsPeloJev({ clientId, pedido, conteudo, modelos: sugestoes.map((s) => s.modelo.id), midias: conteudo.midias.length });
      const mapa: Record<string, number | null> = {};
      r.opcoes.forEach((o) => (mapa[o.modelo] = o.probabilidade));
      setOrdem(mapa);
      r.avisos.forEach((a) => toast.info(a));
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "Não deu para ordenar as sugestões");
    } finally {
      setOcupado("");
    }
  };

  // ---------------------------------------------------------------- exportar e render

  const exportar = async (salvarNoAcervo: boolean) => {
    setOcupado(salvarNoAcervo ? "acervo" : "png");
    try {
      const r = await exportarQuadroPng(quadro, t, urls);
      if (r.faltaram.length) toast.warning("Parte da mídia não entrou na imagem", { description: r.faltaram.slice(0, 3).join(", ") });
      if (!salvarNoAcervo) {
        baixarBlob(r.blob, nomeDeArquivo(`${titulo || "quadro"}-${t.toFixed(1)}s`, "png"));
        toast.success("Quadro exportado", { description: `${r.largura} x ${r.altura} px, no tempo ${t.toFixed(1)} s.` });
        return;
      }
      const caminho = await subirQuadro(clientId, r.blob, `quadro-${titulo || "canvas"}`);
      await chamarMesaVideos({ acao: "quadro_registrar", client_id: clientId, storage_path: caminho, posicao: "primeiro" });
      toast.success("Quadro salvo no acervo de vídeo", { description: "Ele aparece na Mesa Vídeos como quadro e serve de 1º quadro para gerar vídeo." });
    } catch (e) {
      avisarErro(e, salvarNoAcervo ? "Quadro não salvo no acervo" : "Quadro não exportado");
    } finally {
      setOcupado("");
    }
  };

  const mandarParaORender = async () => {
    if (!quadro.camadas.length) {
      toast.info("O quadro está vazio", { description: "Ponha camadas ou aplique um modelo antes." });
      return;
    }
    setOcupado("render");
    try {
      onGravar(quadro);
      const r = await mandarQuadroParaORender(clientId, quadro, titulo || "Quadro do Canvas", uidDoClique());
      const link = enderecoDoEditor(clientId, r.versao_id);
      if (r.aviso) toast.warning("Versão salva na Mesa Edição", { description: r.aviso, action: { label: "Abrir", onClick: () => window.open(link, "_blank", "noopener") } });
      else toast.success(r.ja_existia ? "Já estava na fila do render" : "Na fila do render", { description: "A máquina da agência renderiza o MP4. O andamento fica na Mesa Edição.", action: { label: "Abrir no editor", onClick: () => window.open(link, "_blank", "noopener") } });
    } catch (e) {
      avisarErro(e, "Não foi para o render");
    } finally {
      setOcupado("");
    }
  };

  // ---------------------------------------------------------------- partes da tela

  const camadasPorCima = quadro.camadas.slice().reverse();
  const listaDeCamadas = (
    <div className="min-w-0" data-lista-de-camadas="">
      {camadasPorCima.length === 0 && <p className={juntar(texto.auxiliar, "py-2")}>Sem camadas. Use Adicionar ou um modelo da marca.</p>}
      <ol className="min-w-0">
        {camadasPorCima.map((c) => {
          const ativa = selecionadas.indexOf(c.id) >= 0;
          return (
            <li key={c.id} className={juntar("mb-0.5 flex h-8 min-w-0 items-center rounded-md px-1.5", ativa ? "bg-primary/10" : "hover:bg-muted")} data-camada-na-lista={c.id}>
              <button type="button" className="flex min-w-0 flex-1 items-center text-left" onClick={(e) => setSelecionadas(e.shiftKey ? (ativa ? selecionadas.filter((x) => x !== c.id) : selecionadas.concat([c.id])) : [c.id])}>
                <span className="mr-1.5 shrink-0 text-muted-foreground">{ICONE_DO_TIPO[c.tipo]}</span>
                <span className={juntar("min-w-0 flex-1 truncate text-[12px]", !c.visivel && "text-muted-foreground line-through")}>{c.nome}</span>
                {c.grupo && <span className="ml-1 shrink-0 rounded bg-muted px-1 text-[11px] text-muted-foreground">grupo</span>}
              </button>
              <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => mudarCamada(c.id, (x) => ({ ...x, visivel: !x.visivel }))} aria-label={c.visivel ? `Esconder ${c.nome}` : `Mostrar ${c.nome}`}>
                {c.visivel ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button type="button" className={juntar(botao.icone, "h-7 w-7", c.travada && "text-amber-500")} onClick={() => mudarCamada(c.id, (x) => ({ ...x, travada: !x.travada }))} aria-label={c.travada ? `Destravar ${c.nome}` : `Travar ${c.nome}`}>
                <Lock className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const miniatura = Math.min(132, Math.round(((f.largura / f.altura) * 150)));
  const gradeDeOpcoes = (lista: { chave: string; rotulo: string; quadro: QuadroAnimado; selo?: string | null; destaque?: boolean }[]) => (
    <ul className="grid min-w-0 grid-cols-2 gap-2">
      {lista.map((o) => (
        <li key={o.chave} className="min-w-0">
          <button type="button" className={juntar("block w-full min-w-0 rounded-md border p-1 text-left hover:border-primary", o.destaque ? "border-primary" : "border-border")} onClick={() => aplicarOpcao(o.quadro, o.rotulo)} data-opcao-de-layout={o.chave}>
            <span className="flex justify-center overflow-hidden rounded bg-muted">
              <MiniaturaDoQuadro quadro={o.quadro} largura={miniatura} urls={urls} />
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium" title={o.rotulo}>
              {o.rotulo}
            </span>
            {o.selo && <span className="mt-0.5 inline-block rounded bg-primary/15 px-1 text-[11px] text-primary">{o.selo}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  const painelModelos = (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0">
        <p className={juntar(texto.rotulo, "mb-1.5")}>Modelos da marca</p>
        {gradeDeOpcoes(
          MODELOS_DO_QUADRO.filter((m) => (!m.pedeMidia || midiasParaModelos.length) && (m.id !== "antes_depois" || midiasParaModelos.length >= 2)).map((m) => ({
            chave: `modelo-${m.id}`,
            rotulo: m.rotulo,
            quadro: aplicarModelo(m.id, { ...conteudo, titulo: conteudo.titulo || marca.nome || "Seu título aqui", subtitulo: conteudo.subtitulo || "Uma frase curta que explica", cta: conteudo.cta || "Saiba mais", topicos: conteudo.topicos.length ? conteudo.topicos : ["Primeiro ponto", "Segundo ponto", "Terceiro ponto"], midias: midiasParaModelos }, marca, quadro.formato, quadro.duracao_s),
            destaque: quadro.modelo === m.id,
          })),
        )}
      </div>
      {quadro.camadas.length > 0 && sugestoes.length > 0 && (
        <div className="min-w-0 border-t border-border pt-3">
          <div className="mb-1.5 flex min-w-0 items-center">
            <p className={juntar(texto.rotulo, "flex-1")}>Sugestões com o seu conteúdo</p>
            <button
              type="button"
              className={juntar(botao.barra, "h-7")}
              disabled={ocupado === "ordenar"}
              onClick={() => void ordenarPeloJev()}
              title={`O Jev ordena as sugestões pelo pedido escrito na aba IA. Custo estimado ~${usd(custoDoOrdenar)}, cobrado da carteira do cliente.`}
              data-ordenar-pelo-jev=""
            >
              {ocupado === "ordenar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />} Ordenar
              <span className="ml-1 text-[11px] font-normal opacity-80" data-custo-do-ordenar="">~{usd(custoDoOrdenar)}</span>
            </button>
          </div>
          {gradeDeOpcoes(sugestoes.map((s, i) => ({ chave: `sugestao-${s.modelo.id}`, rotulo: s.modelo.rotulo, quadro: s.quadro, selo: ordem && i === 0 && ordem[s.modelo.id] !== null && ordem[s.modelo.id] !== undefined ? "Recomendado" : null, destaque: false })))}
        </div>
      )}
    </div>
  );

  const painelIa = (
    <div className="min-w-0 space-y-2" data-montar-com-ia="">
      <Linha rotulo="O que o quadro precisa dizer">
        <textarea className={juntar(campoTexto, "min-h-[88px]")} value={pedido} onChange={(e) => setPedido(e.target.value.slice(0, 1500))} placeholder="Ex.: chamada para a avaliação gratuita de outubro, com a foto do consultório e o botão para o WhatsApp" />
      </Linha>
      <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modeloDaIa} onChange={setModeloIa} rotulo="Modelo (papel motion)" />
      <p className={texto.auxiliar}>Usa a marca, o contexto e as mídias ligadas. Nada muda sem você escolher.</p>
      <BotaoComCusto
        rotulo={
          <>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Montar com IA
          </>
        }
        titulo="Montar o quadro com IA"
        descricao="A IA escreve o texto e escolhe o layout; o código posiciona com as cores, as fontes e a logo reais. O Jev ordena as opções."
        partes={() => partesDaMontagem(modeloDaIa || null)}
        executar={montar}
        className="w-full"
      />
      {respostaIa && <p className={juntar(texto.auxiliar, "pt-1")}>{respostaIa}</p>}
      {opcoes.length > 0 &&
        gradeDeOpcoes(
          opcoes.map((o) => ({
            chave: `ia-${o.modelo.id}`,
            rotulo: o.modelo.rotulo,
            quadro: o.quadro,
            selo: o.recomendado ? "Recomendado" : o.probabilidade !== null ? `${Math.round(o.probabilidade * 100)}%` : null,
            destaque: o.recomendado,
          })),
        )}
    </div>
  );

  const ferramentasDaSelecao = selecionadas.length > 0 && (
    <div className="mb-3 min-w-0 border-b border-border pb-3" data-ferramentas-da-selecao="">
      <p className={juntar(texto.rotulo, "mb-1")}>{selecionadas.length > 1 ? `${selecionadas.length} camadas` : "Alinhar no quadro"}</p>
      <div className="flex min-w-0 flex-wrap">
        {(
          [
            ["esquerda", <AlignStartVertical key="a" className="h-3.5 w-3.5" />, "Alinhar à esquerda"],
            ["centro_h", <AlignCenterVertical key="b" className="h-3.5 w-3.5" />, "Centralizar na horizontal"],
            ["direita", <AlignEndVertical key="c" className="h-3.5 w-3.5" />, "Alinhar à direita"],
            ["topo", <AlignStartHorizontal key="d" className="h-3.5 w-3.5" />, "Alinhar no topo"],
            ["meio", <AlignCenterHorizontal key="e" className="h-3.5 w-3.5" />, "Centralizar na vertical"],
            ["base", <AlignEndHorizontal key="f" className="h-3.5 w-3.5" />, "Alinhar na base"],
          ] as [Alinhamento, ReactNode, string][]
        ).map(([como, icone, rotulo]) => (
          <button key={como} type="button" className={juntar(botao.icone, "mb-1 mr-0.5 h-8 w-8")} onClick={() => alinharSel(como)} aria-label={rotulo} title={rotulo} data-alinhar={como}>
            {icone}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap">
        {selecionadas.length >= 3 && (
          <>
            <button type="button" className={juntar(botao.barra, "mb-1 mr-1")} onClick={() => mudarCamadas((l) => distribuir(l, selecionadas, "h"))}>
              Distribuir na horizontal
            </button>
            <button type="button" className={juntar(botao.barra, "mb-1 mr-1")} onClick={() => mudarCamadas((l) => distribuir(l, selecionadas, "v"))}>
              Distribuir na vertical
            </button>
          </>
        )}
        {selecionadas.length >= 2 && (
          <button type="button" className={juntar(botao.barra, "mb-1 mr-1")} onClick={() => mudarCamadas((l) => agrupar(l, selecionadas, novoIdDaCamada("g")))} title="Ctrl+G" data-agrupar="">
            <Group className="mr-1 h-3.5 w-3.5" /> Agrupar
          </button>
        )}
        {quadro.camadas.some((c) => selecionadas.indexOf(c.id) >= 0 && !!c.grupo) && (
          <button type="button" className={juntar(botao.barra, "mb-1 mr-1")} onClick={() => mudarCamadas((l) => desagrupar(l, selecionadas))} title="Ctrl+Shift+G">
            <Ungroup className="mr-1 h-3.5 w-3.5" /> Desagrupar
          </button>
        )}
        {unica && (
          <>
            <button type="button" className={juntar(botao.icone, "mb-1 mr-0.5")} onClick={() => mudarCamadas((l) => mudarOrdem(l, unica.id, "frente"))} aria-label="Trazer para a frente" title="Trazer para a frente">
              <ArrowUpToLine className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={juntar(botao.icone, "mb-1 mr-0.5")} onClick={() => mudarCamadas((l) => mudarOrdem(l, unica.id, "fundo"))} aria-label="Mandar para o fundo" title="Mandar para o fundo">
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button type="button" className={juntar(botao.icone, "mb-1 mr-0.5")} onClick={duplicar} aria-label="Duplicar" title="Duplicar (Ctrl+D)">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={juntar(botao.icone, "mb-1 text-destructive")} onClick={() => apagar(selecionadas)} aria-label="Apagar" title="Apagar (Delete)" data-apagar-camada="">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  const barraDeFerramentas = (
    <div className="flex min-w-0 flex-wrap items-center" data-barra-do-quadro="">
      <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={porTexto} data-por-camada="texto">
        <Type className="mr-1 h-3.5 w-3.5" /> Texto
      </button>
      <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={() => setMidia({ para: "nova", tipo: "imagem" })} data-por-camada="imagem">
        <ImageIcon className="mr-1 h-3.5 w-3.5" /> Imagem
      </button>
      <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={() => setMidia({ para: "nova", tipo: "video" })} data-por-camada="video">
        <Film className="mr-1 h-3.5 w-3.5" /> Vídeo
      </button>
      <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={() => porForma("retangulo")} data-por-camada="forma">
        <Square className="mr-1 h-3.5 w-3.5" /> Forma
      </button>
      <button type="button" className={juntar(botao.icone, "mr-0.5")} onClick={() => porForma("circulo")} aria-label="Círculo" title="Círculo">
        <Circle className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={juntar(botao.barra, "mr-2")} onClick={porLogo} data-por-camada="logo">
        <Sparkles className="mr-1 h-3.5 w-3.5" /> Logo
      </button>
      <span className="mr-2 h-5 w-px bg-border" />
      <button type="button" className={juntar(botao.icone, "mr-0.5")} onClick={desfazer} disabled={!podeDesfazer} aria-label="Desfazer" title="Desfazer (Ctrl+Z)" data-desfazer="">
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" className={juntar(botao.icone, "mr-2")} onClick={refazer} disabled={!podeRefazer} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" data-refazer="">
        <Redo2 className="h-4 w-4" />
      </button>
      <SeletorCompacto rotulo="Proporção" opcoes={LISTA_DE_FORMATOS_DO_QUADRO.map((x) => ({ valor: x, rotulo: x }))} valor={quadro.formato} onEscolher={(v) => trocarFormato(v as FormatoDoQuadro)} />
      <label className={juntar(texto.auxiliar, "ml-2 mr-2 inline-flex items-center")}>
        Duração
        <input type="number" min={1} max={60} step={0.5} className={juntar(campo, "ml-1.5 h-8 w-16 px-2")} value={quadro.duracao_s} onChange={(e) => trocarDuracao(Number(e.target.value) || quadro.duracao_s)} aria-label="Duração do quadro em segundos" />
        <span className="ml-1">s</span>
      </label>
      <span className="flex-1" />
      <button type="button" className={juntar(botao.icone, "mr-0.5")} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)] || 0.5)} aria-label="Diminuir o zoom">
        <ZoomOut className="h-4 w-4" />
      </button>
      <button type="button" className={juntar(botao.barra, "w-14 tabular-nums")} onClick={() => setZoom(1)} title="Caber na tela">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={botao.icone} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)] || 2)} aria-label="Aumentar o zoom">
        <ZoomIn className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <JanelaCentral
        aberta={aberto}
        onFechar={fechar}
        titulo={titulo || "Quadro animado"}
        icone={<LayoutTemplate className="h-4 w-4" />}
        descricao={`${quadro.formato} · ${quadro.duracao_s} s · ${quadro.camadas.length} ${quadro.camadas.length === 1 ? "camada" : "camadas"}`}
        ajuda="Monte o quadro em camadas. Arraste no palco (Alt solta o encaixe), use as alças para o tamanho e o giro, e a linha do tempo para quando cada camada entra e sai. Ctrl+Z desfaz, Ctrl+D duplica, Ctrl+G agrupa, espaço toca. Tudo fica salvo no cartão do Canvas."
        largura="tela"
        corpo="fixo"
        semEspaco
        fecharNoFundo={false}
        abaixoDoTitulo={barraDeFerramentas}
        acoes={
          <>
            <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={() => void exportar(false)} disabled={!!ocupado} title="Baixa o quadro deste tempo em PNG (1080 px)" data-exportar-png="">
              {ocupado === "png" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />} PNG
            </button>
            <button type="button" className={juntar(botao.barra, "mr-0.5")} onClick={() => void exportar(true)} disabled={!!ocupado} title="Guarda este quadro no acervo de vídeo (serve de 1º quadro para gerar)">
              {ocupado === "acervo" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />} Acervo
            </button>
            <button type="button" className={juntar(botao.primario, "mr-1 h-8 px-2.5")} onClick={() => void mandarParaORender()} disabled={!!ocupado} title="Cria a versão na Mesa Edição e pede o MP4 à fila do render" data-mandar-para-o-render="">
              {ocupado === "render" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-1 h-3.5 w-3.5" />} Render
            </button>
          </>
        }
        data-editor-de-quadro=""
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col max-lg:overflow-y-auto lg:flex-row">
          <aside className="min-w-0 shrink-0 border-border p-3 lg:w-[268px] lg:overflow-y-auto lg:border-r" aria-label="Camadas, modelos e IA">
            <SeletorCompacto
              rotulo="Painel"
              larguraTotal
              opcoes={[
                { valor: "camadas", rotulo: "Camadas" },
                { valor: "modelos", rotulo: "Modelos" },
                { valor: "ia", rotulo: "IA" },
              ]}
              valor={aba}
              onEscolher={(v) => setAba(v as AbaLateral)}
            />
            <div className="mt-3 min-w-0">{aba === "camadas" ? listaDeCamadas : aba === "modelos" ? painelModelos : painelIa}</div>
          </aside>
          <section className="flex min-h-[420px] min-w-0 flex-1 flex-col" aria-label="Palco do quadro">
            <div ref={refArea} className="relative min-h-0 flex-1 overflow-auto bg-zinc-900" data-area-do-palco="">
              <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: largura + 32 > area.l ? largura + 32 : undefined }}>
                <PalcoDoQuadro
                  quadro={quadro}
                  t={t}
                  urls={urls}
                  largura={largura}
                  selecionadas={selecionadas}
                  onSelecionar={(ids) => setSelecionadas(ids)}
                  onMudarCamadas={mudarCamadas}
                  onEditarTexto={(id) => {
                    setSelecionadas([id]);
                    window.setTimeout(() => refDoTexto.current && refDoTexto.current.focus(), 30);
                  }}
                  tocando={tocando}
                />
              </div>
            </div>
            <div className="flex min-w-0 items-center border-t border-border bg-card px-3 pt-1.5">
              <button type="button" className={juntar(botao.icone, "mr-1")} onClick={() => {
                if (!tocando && t >= quadro.duracao_s - 0.01) setT(0);
                setTocando(!tocando);
              }} aria-label={tocando ? "Pausar" : "Tocar"} data-tocar-quadro="">
                {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button type="button" className={juntar(botao.barra, "mr-2")} onClick={() => setT(0)}>
                Início
              </button>
              <span className={texto.auxiliar}>Espaço toca e pausa</span>
            </div>
            <LinhaDoTempo quadro={quadro} t={t} onTempo={(x) => { setTocando(false); setT(x); }} selecionadas={selecionadas} onSelecionar={(id) => setSelecionadas([id])} onMudarCamada={mudarCamada} />
          </section>
          <aside className="min-w-0 shrink-0 border-border p-3 lg:w-[292px] lg:overflow-y-auto lg:border-l" aria-label="Propriedades">
            {ferramentasDaSelecao}
            {unica ? (
              <Inspetor
                key={unica.id}
                camada={unica}
                t={t}
                duracao={quadro.duracao_s}
                onMudar={(fn, j) => mudarCamada(unica.id, fn, j)}
                onTrocarMidia={() => setMidia({ para: "trocar", id: unica.id, somente: unica.tipo === "logo" ? "imagem" : null })}
                refDoTexto={refDoTexto}
              />
            ) : (
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1")}>Fundo do quadro</p>
                <input type="color" className="mb-3 h-8 w-full cursor-pointer rounded-md border border-input bg-background" value={quadro.fundo} onChange={(e) => mudar((q) => ({ ...q, fundo: e.target.value }), "fundo")} aria-label="Cor do fundo" />
                <p className={texto.auxiliar}>Toque numa camada para editar. Shift soma à seleção.</p>
                <div className="mt-3 flex min-w-0 flex-wrap">
                  {[marca.primaria, marca.fundo, marca.apoio, marca.claro, "#000000", "#ffffff"].map((cor, i) => (
                    <button key={`${cor}-${i}`} type="button" className="mb-1 mr-1 h-7 w-7 rounded-md border border-border" style={{ background: cor }} onClick={() => mudar((q) => ({ ...q, fundo: cor }))} aria-label={`Fundo ${cor}`} title={i < 4 ? "Cor da marca" : cor} />
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </JanelaCentral>
      {midia && (
        <EscolherMidia
          aberta={!!midia}
          clientId={clientId}
          ligadas={ligadas}
          somente={midia.para === "nova" ? midia.tipo : midia.somente}
          onFechar={() => setMidia(null)}
          onEscolher={aoEscolherMidia}
        />
      )}
    </>
  );
}

