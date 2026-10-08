import { ContainerDaArea } from "./ContainerDaArea";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, MessageSquare, PanelRightOpen } from "lucide-react";
import RegiaoRolavel from "./RegiaoRolavel";
import { useReservaFlutuante } from "./useReservaFlutuante";
import { botao, foco, juntar } from "./estilos";

/**
 * Área de trabalho (docs/design/SISTEMA.md, "Área de trabalho e rolagem").
 *
 * Dono, 26/09: "o agente tem que ficar fixo; quando eu rolo, o agente rola
 * junto. A caixa que conversa tem que ficar fixa; o resto só ajusta. Scroll
 * certinho: sem rolar um lugar e rolar tudo."
 *
 * De 1024 px para cima a área ocupa a altura da janela abaixo do cabeçalho da
 * mesa (medida em px por JavaScript, porque o Safari 11 não tem dvh/svh e o
 * cabeçalho muda de altura), e cada região rola por conta própria:
 * - principal: rola por dentro (ou, com `principalRolavel={false}`, vira uma
 *   coluna de altura fixa e a própria aba põe RegiaoRolavel na lista longa);
 * - lateral (o agente): fica parada; a conversa rola dentro do PainelDoAgente
 *   e o campo de digitar fica sempre à vista. Recolhível (lembrado no
 *   navegador).
 * A página não rola junto: enquanto a área está na tela, o body ganha
 * data-area-de-trabalho e o CSS (src/index.css) tira o recuo de baixo.
 *
 * Abaixo de 1024 px a página rola normal (sem caixa com rolagem própria, que
 * prende o dedo no celular) e a lateral vira um botão flutuante que abre o
 * agente em tela cheia, como uma gaveta. A gaveta fica montada depois de
 * aberta (a conversa não se perde ao fechar).
 *
 * Abrir a lateral de fora ("pedir ao diretor", "pedir ao agente"):
 * `abrirLateralDaArea()` (em qualquer lugar) ou a prop `pedidoDeAbrir` (um
 * número ou texto que muda a cada pedido). No computador tira do recolhido;
 * no celular abre a gaveta. `nasceRecolhida`: a lateral começa recolhida
 * enquanto a pessoa não escolheu (ex.: o Canvas, que pede a largura toda);
 * depois vale o que ela escolheu (mesma chave `area:<memoria>:recolhida`).
 */

const LARGO = 1024;
/**
 * Respiro embaixo da área (28/09, dono: "a área vai até o fim da janela; nada
 * vazio embaixo, nada cortado"). Só o respiro: o lançador mora nas barras e
 * não há mais botão flutuante no computador para reservar espaço.
 */
const FOLGA_EMBAIXO = 12;
// Piso baixo (28/09): com 440 px, uma janela de 1345x602 com o cabeçalho da
// mesa em duas linhas forçava a área a passar do fim e a página cortava embaixo.
const ALTURA_MINIMA = 300;

interface AreaCtx {
  /** A área está no modo de colunas (>= 1024 px). */
  largo: boolean;
  recolhido: boolean;
  alternarRecolhido: () => void;
  /** No celular: fechar a gaveta do agente. */
  fecharGaveta: (() => void) | null;
}

const ContextoDaArea = createContext<AreaCtx | null>(null);

/** Para o PainelDoAgente saber se mostra "recolher" (computador) ou "fechar" (gaveta do celular). */
export const useAreaDeTrabalho = () => useContext(ContextoDaArea);

function larguraAgora(): number {
  if (typeof window === "undefined") return LARGO;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || LARGO;
}

/** Está em 1024 px ou mais? Atualiza ao redimensionar e ao girar o aparelho. */
export function useLargo(): boolean {
  const [largo, setLargo] = useState(() => larguraAgora() >= LARGO);
  useEffect(() => {
    const medir = () => setLargo(larguraAgora() >= LARGO);
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);
  return largo;
}

let areasNaTela = 0;
function marcarBody(delta: number) {
  areasNaTela = Math.max(0, areasNaTela + delta);
  try {
    if (areasNaTela > 0) document.body.setAttribute("data-area-de-trabalho", "");
    else document.body.removeAttribute("data-area-de-trabalho");
  } catch {
    /* sem documento */
  }
}

/** Altura (px) da área para caber na janela a partir de onde ela começa; null abaixo de 1024 px. */
export function alturaDaArea(alturaDaJanela: number, topoNaPagina: number, minima = ALTURA_MINIMA): number {
  return Math.max(minima, Math.round(alturaDaJanela - topoNaPagina - FOLGA_EMBAIXO));
}

/**
 * Dentro da Central (página embutida num quadro, 09/10/2026) a janela é o
 * quadro, que pode ser baixo: o mínimo de 300 px empurrava a área para baixo
 * do fim do quadro e cortava o fim (a rolagem parecia travada). Embutido, a
 * área cabe no quadro; o mínimo só evita área de altura zero.
 */
const ALTURA_MINIMA_EMBUTIDA = 160;
const embutida = () => typeof document !== "undefined" && !!document.body && document.body.hasAttribute("data-embutido");

function useAlturaDaArea(largo: boolean): { ref: RefObject<HTMLDivElement>; altura: number | null; medir: () => void } {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);
  const container = useContext(ContainerDaArea);
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el || larguraAgora() < LARGO) {
      setAltura(null);
      return;
    }
    // Dentro de uma ferramenta da Central: mede pela caixa dela (a janela é maior que a caixa).
    const caixa = container && container.current;
    if (caixa) {
      const fundo = caixa.getBoundingClientRect().bottom;
      const topoNaCaixa = el.getBoundingClientRect().top;
      const nova = alturaDaArea(fundo, topoNaCaixa, ALTURA_MINIMA_EMBUTIDA);
      setAltura((a) => (a !== null && Math.abs(a - nova) < 2 ? a : nova));
      return;
    }
    // Topo da área com a página no início: na tela cheia da mesa quem rola é a raiz da mesa.
    const rolador = typeof el.closest === "function" ? (el.closest(".mesa-tela-cheia") as HTMLElement | null) : null;
    const rolado = rolador ? rolador.scrollTop : window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    const topo = el.getBoundingClientRect().top + rolado;
    const nova = alturaDaArea(window.innerHeight || 800, topo, embutida() ? ALTURA_MINIMA_EMBUTIDA : ALTURA_MINIMA);
    // Só muda quando a medida muda de verdade (tela parada = nada se mexe).
    setAltura((a) => (a !== null && Math.abs(a - nova) < 2 ? a : nova));
  }, [container]);

  // Primeira medida antes da pintura: a área já nasce na altura certa (nada pula na tela).
  useLayoutEffect(() => {
    if (!largo) return;
    marcarBody(1);
    medir();
    return () => marcarBody(-1);
  }, [largo, medir]);

  useEffect(() => {
    if (!largo) {
      setAltura(null);
      return;
    }
    // Depois das fontes e do cabeçalho assentarem (a barra da mesa pode quebrar em duas linhas).
    const t1 = window.setTimeout(medir, 250);
    const t2 = window.setTimeout(medir, 900);
    const t3 = window.setTimeout(medir, 2000);
    // O cabeçalho da mesa muda de altura depois de montar (cliente chegou, a
    // barra quebrou em duas linhas, faixa do ensaio): a página muda de altura e
    // a área mede de novo. Com ResizeObserver quando o navegador tem (Safari 11
    // não tem: ficam os tempos acima e o resize).
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    let obsDoCorpo: ResizeObserver | null = null;
    if (RO) {
      obsDoCorpo = new RO(() => medir());
      obsDoCorpo.observe(document.body);
      const cabecalho = ref.current && typeof ref.current.closest === "function" ? ref.current.closest("[data-casca-da-mesa]") : null;
      const topoDaMesa = cabecalho ? cabecalho.querySelector("header[data-cabecalho-da-mesa]") : null;
      if (topoDaMesa) obsDoCorpo.observe(topoDaMesa);
    }
    let vivo = true;
    try {
      const fontes = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fontes && fontes.ready) fontes.ready.then(() => { if (vivo) medir(); }, () => undefined);
    } catch {
      /* sem API de fontes (Safari antigo): os dois tempos acima cobrem */
    }
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    // Tela cheia liga e desliga: o cabeçalho do painel some e a área cresce.
    let obs: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      obs = new MutationObserver(() => window.setTimeout(medir, 30));
      obs.observe(document.body, { attributes: true, attributeFilter: ["data-tela-cheia-da-mesa", "data-modo-foco"] });
    }
    return () => {
      vivo = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      if (obsDoCorpo) obsDoCorpo.disconnect();
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      if (obs) obs.disconnect();
    };
  }, [largo, medir]);

  return { ref, altura, medir };
}

/**
 * Altura que cabe na janela a partir de onde o elemento começa (28/09, dono:
 * "nenhum espaço sobrando e nada cortado"). É a mesma medida da
 * AreaDeTrabalho, para qualquer área de altura da janela que não usa a área:
 * ponha `ref` no elemento e `style={{ height: altura }}` quando não for null.
 * - null abaixo de 1024 px (celular e tablet: a página rola normal) ou com
 *   `ativo` falso;
 * - mede antes da pintura, de novo ao redimensionar, girar, ligar a tela cheia
 *   ou o modo foco, e depois das fontes;
 * - enquanto ativa, liga `data-area-de-trabalho` no body (a página não rola
 *   junto e sai o recuo de baixo), como a AreaDeTrabalho.
 * Nunca `h-[calc(100vh-Npx)]` fixo: sobra faixa na tela cheia e corta no normal.
 */
export function useAlturaQueCabe(ativo: boolean): { ref: RefObject<HTMLDivElement>; altura: number | null; medir: () => void } {
  const largo = useLargo();
  return useAlturaDaArea(ativo && largo);
}

function lerRecolhido(chave: string | undefined, inicial = false): boolean {
  if (!chave) return inicial;
  try {
    const v = window.localStorage.getItem(`area:${chave}:recolhida`);
    return v === null ? inicial : v === "1";
  } catch {
    return inicial;
  }
}

/** Áreas com lateral na tela (a mais recente atende o pedido de abrir). */
const abridores: Array<() => void> = [];

/**
 * Abre a lateral (o agente) da área de trabalho na tela, de qualquer lugar:
 * no computador tira do recolhido, no celular abre a gaveta. Devolve false
 * quando não há área com lateral montada.
 */
export function abrirLateralDaArea(): boolean {
  const abrir = abridores[abridores.length - 1];
  if (!abrir) return false;
  abrir();
  return true;
}

export default function AreaDeTrabalho({
  children,
  lateral,
  rotuloDaLateral = "Agente",
  iconeDaLateral,
  larguraDaLateral = "padrao",
  principalRolavel = true,
  rotuloDoPrincipal,
  memoria,
  memoriaDaRolagem,
  nasceRecolhida = false,
  pedidoDeAbrir,
  className = "",
}: {
  /** A região principal. */
  children: ReactNode;
  /** A coluna lateral (o PainelDoAgente). Sem ela, a área é só a principal. */
  lateral?: ReactNode;
  /** Nome da lateral (botão do celular e trilho recolhido). */
  rotuloDaLateral?: string;
  iconeDaLateral?: ReactNode;
  /** padrao: 320 px no notebook, 360 de 1280 e 400 de 1440. larga: 360/400/440. */
  larguraDaLateral?: "padrao" | "larga";
  /** false: a principal não rola; a aba organiza a coluna e põe RegiaoRolavel onde precisa. */
  principalRolavel?: boolean;
  /** Nome da região principal para leitor de tela. */
  rotuloDoPrincipal?: string;
  /** Chave para lembrar a lateral recolhida (ex.: "mesa-contexto"). */
  memoria?: string;
  /** Chave para guardar a posição da rolagem da principal (ex.: "mesa:contexto:<cliente>"). */
  memoriaDaRolagem?: string;
  /** A lateral começa recolhida enquanto a pessoa não escolheu (vale só sem nada guardado em `memoria`). */
  nasceRecolhida?: boolean;
  /** Muda a cada pedido de abrir a lateral de fora (ex.: Date.now()). Vazio/0 não abre. */
  pedidoDeAbrir?: number | string | null;
  className?: string;
}) {
  const largo = useLargo();
  const { ref, altura } = useAlturaDaArea(largo);
  const [recolhido, setRecolhido] = useState(() => lerRecolhido(memoria, nasceRecolhida));
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [gavetaUsada, setGavetaUsada] = useState(false);

  const alternarRecolhido = useCallback(() => {
    setRecolhido((r) => {
      const novo = !r;
      if (memoria) {
        try {
          window.localStorage.setItem(`area:${memoria}:recolhida`, novo ? "1" : "0");
        } catch {
          /* sem armazenamento: vale só agora */
        }
      }
      return novo;
    });
  }, [memoria]);

  // Abrir de fora: no computador sai do recolhido (e lembra, como o clique no
  // trilho); no celular abre a gaveta.
  const abrirLateral = useCallback(() => {
    if (larguraAgora() >= LARGO) {
      setRecolhido(false);
      if (memoria) {
        try {
          window.localStorage.setItem(`area:${memoria}:recolhida`, "0");
        } catch {
          /* sem armazenamento: vale só agora */
        }
      }
      return;
    }
    setGavetaUsada(true);
    setGavetaAberta(true);
  }, [memoria]);
  const temLateral = !!lateral;
  // Celular e tablet: o botão do agente flutua acima da barra de baixo. Uma
  // faixa reservada no fim do conteúdo deixa rolar tudo para cima dele.
  useReservaFlutuante(temLateral && !largo && !gavetaAberta, 72);
  useEffect(() => {
    if (!temLateral) return;
    abridores.push(abrirLateral);
    return () => {
      const i = abridores.lastIndexOf(abrirLateral);
      if (i >= 0) abridores.splice(i, 1);
    };
  }, [temLateral, abrirLateral]);
  const ultimoPedido = useRef(pedidoDeAbrir);
  useEffect(() => {
    if (ultimoPedido.current === pedidoDeAbrir) return;
    ultimoPedido.current = pedidoDeAbrir;
    if (pedidoDeAbrir) abrirLateral();
  }, [pedidoDeAbrir, abrirLateral]);

  // Gaveta aberta no celular: Esc fecha e a página por baixo não rola.
  useEffect(() => {
    if (!gavetaAberta || largo) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") setGavetaAberta(false);
    };
    window.addEventListener("keydown", tecla);
    try {
      document.body.setAttribute("data-gaveta-aberta", "");
    } catch {
      /* sem documento */
    }
    return () => {
      window.removeEventListener("keydown", tecla);
      try {
        document.body.removeAttribute("data-gaveta-aberta");
      } catch {
        /* sem documento */
      }
    };
  }, [gavetaAberta, largo]);

  const colunas = !lateral
    ? ""
    : recolhido
      ? "lg:grid-cols-[minmax(0,1fr)_32px]"
      : larguraDaLateral === "larga"
        ? "lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] desk:grid-cols-[minmax(0,1fr)_440px]"
        : "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] desk:grid-cols-[minmax(0,1fr)_400px]";

  // A lateral tem o próprio botão de recolher (CabecalhoDoAgente)? Sem ele, a
  // área põe um botão pequeno no canto da lateral, no vão entre as colunas.
  const refDaLateral = useRef<HTMLElement | null>(null);
  const [botaoProprio, setBotaoProprio] = useState(true);
  useLayoutEffect(() => {
    const el = refDaLateral.current;
    if (!el) return;
    const tem = !!el.querySelector("[data-recolher-lateral]:not([data-botao-da-area])");
    if (tem !== botaoProprio) setBotaoProprio(tem);
  });

  const estilo: CSSProperties | undefined = largo && altura ? { height: `${altura}px` } : undefined;
  const principal = principalRolavel ? (
    // Sem recuo embaixo (28/09): o lg:pb-24 antigo (para o lançador que flutuava) fazia a barra
    // sticky bottom-0 da aba parar 96 px acima do fim, flutuando por cima do texto.
    <RegiaoRolavel modo="lg" rotulo={rotuloDoPrincipal} memoria={memoriaDaRolagem} className="lg:pr-1" data-regiao-principal="">
      {children}
    </RegiaoRolavel>
  ) : (
    <div className="flex min-w-0 flex-col lg:h-full lg:min-h-0" data-regiao-principal="">
      {children}
    </div>
  );

  const ctxLargo: AreaCtx = { largo: true, recolhido, alternarRecolhido, fecharGaveta: null };
  const ctxGaveta: AreaCtx = { largo: false, recolhido: false, alternarRecolhido, fecharGaveta: () => setGavetaAberta(false) };

  return (
    <div
      ref={ref}
      style={estilo}
      data-area-de-trabalho=""
      className={juntar("min-w-0", lateral ? (recolhido ? "lg:grid lg:gap-3" : "lg:grid lg:gap-5") : "lg:flex lg:flex-col", colunas, "lg:min-h-0", className)}
    >
      {principal}
      {lateral && largo && (
        <ContextoDaArea.Provider value={ctxLargo}>
          {recolhido ? (
            // Tirinha de 32 px (28/09, dono: "laterais recolhem para o lado"): ícone,
            // nome em pé e a volta num toque só. Sem caixa: só um traço fino à esquerda.
            <aside aria-label={rotuloDaLateral} className="hidden min-h-0 lg:flex lg:flex-col lg:items-center" data-lateral-recolhida="">
              <button
                type="button"
                onClick={alternarRecolhido}
                aria-label={`Abrir ${rotuloDaLateral.toLowerCase()}`}
                title={`Abrir ${rotuloDaLateral.toLowerCase()}`}
                className={juntar("toque-compacto flex h-full w-8 flex-col items-center rounded-md border-l border-border/60 pt-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground", foco)}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                  {iconeDaLateral || <PanelRightOpen className="h-4 w-4" />}
                </span>
                <span className="mt-3 text-[11px] font-medium" style={{ writingMode: "vertical-rl" }}>
                  {rotuloDaLateral}
                </span>
              </button>
            </aside>
          ) : (
            // Até o fim da área (28/09): o lg:pb-14 antigo reservava lugar para o lançador que
            // flutuava no canto e deixava ~60 px vazios embaixo do agente. O lançador mora nas barras.
            <aside ref={refDaLateral} aria-label={rotuloDaLateral} className="relative hidden min-h-0 min-w-0 lg:flex lg:flex-col" data-lateral="">
              {!botaoProprio && (
                // No vão entre as colunas (20 px), nunca por cima do conteúdo da lateral.
                <button
                  type="button"
                  onClick={alternarRecolhido}
                  aria-label={`Recolher ${rotuloDaLateral.toLowerCase()}`}
                  title={`Recolher ${rotuloDaLateral.toLowerCase()}`}
                  className={juntar(botao.icone, "absolute -left-5 top-0 h-8 w-5")}
                  data-recolher-lateral=""
                  data-botao-da-area=""
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              {lateral}
            </aside>
          )}
        </ContextoDaArea.Provider>
      )}
      {lateral && !largo && (
        <>
          {!gavetaAberta && (
            <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 flex justify-center px-4 md:bottom-6" data-botao-da-lateral="">
              <button
                type="button"
                onClick={() => {
                  setGavetaUsada(true);
                  setGavetaAberta(true);
                }}
                className={juntar(
                  "pointer-events-auto inline-flex h-11 max-w-full items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background",
                  foco,
                )}
              >
                <span className="mr-2 inline-flex shrink-0" aria-hidden="true">
                  {iconeDaLateral || <MessageSquare className="h-4 w-4" />}
                </span>
                <span className="truncate">{rotuloDaLateral}</span>
              </button>
            </div>
          )}
          {/* Portal no body: dentro do conteúdo do painel (que no celular é uma
              camada fixa própria) a gaveta ficaria por baixo da barra do topo. */}
          {gavetaUsada && typeof document !== "undefined" && createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={rotuloDaLateral}
              className={juntar(
                "fixed inset-0 z-50 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
                gavetaAberta ? "" : "hidden",
              )}
              data-gaveta-da-lateral=""
            >
              <ContextoDaArea.Provider value={ctxGaveta}>
                <div className="flex min-h-0 flex-1 flex-col p-2">{lateral}</div>
              </ContextoDaArea.Provider>
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
