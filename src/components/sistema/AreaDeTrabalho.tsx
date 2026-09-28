import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, PanelRightOpen } from "lucide-react";
import RegiaoRolavel from "./RegiaoRolavel";
import { useReservaFlutuante } from "./useReservaFlutuante";
import { foco, juntar } from "./estilos";

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
/** Espaço livre embaixo da área (respiro e botões flutuantes do painel). */
const FOLGA_EMBAIXO = 16;
const ALTURA_MINIMA = 440;

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
export function alturaDaArea(alturaDaJanela: number, topoNaPagina: number): number {
  return Math.max(ALTURA_MINIMA, Math.round(alturaDaJanela - topoNaPagina - FOLGA_EMBAIXO));
}

function useAlturaDaArea(largo: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el || larguraAgora() < LARGO) {
      setAltura(null);
      return;
    }
    // Topo da área com a página no início: na tela cheia da mesa quem rola é a raiz da mesa.
    const rolador = typeof el.closest === "function" ? (el.closest(".mesa-tela-cheia") as HTMLElement | null) : null;
    const rolado = rolador ? rolador.scrollTop : window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    const topo = el.getBoundingClientRect().top + rolado;
    const nova = alturaDaArea(window.innerHeight || 800, topo);
    // Só muda quando a medida muda de verdade (tela parada = nada se mexe).
    setAltura((a) => (a !== null && Math.abs(a - nova) < 2 ? a : nova));
  }, []);

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
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    // Tela cheia liga e desliga: o cabeçalho do painel some e a área cresce.
    let obs: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      obs = new MutationObserver(() => window.setTimeout(medir, 30));
      obs.observe(document.body, { attributes: true, attributeFilter: ["data-tela-cheia-da-mesa", "data-modo-foco"] });
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      if (obs) obs.disconnect();
    };
  }, [largo, medir]);

  return { ref, altura, medir };
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
/**
 * Altura que cabe da área até o fim da janela, para telas que não usam a
 * AreaDeTrabalho mas têm colunas de altura da janela (28/09: nada de
 * `calc(100vh-Npx)` fixo, que sobrava na tela cheia e cortava no normal).
 * null abaixo de 1024 px ou com ativo=false. Uso:
 * <div ref={ref} style={altura ? { height: `${altura}px` } : undefined}>.
 */
export function useAlturaQueCabe(ativo: boolean) {
  const largo = useLargo();
  return useAlturaDaArea(ativo && largo);
}

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
      ? "lg:grid-cols-[minmax(0,1fr)_44px]"
      : larguraDaLateral === "larga"
        ? "lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] desk:grid-cols-[minmax(0,1fr)_440px]"
        : "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] desk:grid-cols-[minmax(0,1fr)_400px]";

  const estilo: CSSProperties | undefined = largo && altura ? { height: `${altura}px` } : undefined;
  const principal = principalRolavel ? (
    <RegiaoRolavel modo="lg" rotulo={rotuloDoPrincipal} memoria={memoriaDaRolagem} className="lg:pb-24 lg:pr-1" data-regiao-principal="">
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
      className={juntar("min-w-0", lateral ? "lg:grid lg:gap-5" : "lg:flex lg:flex-col", colunas, "lg:min-h-0", className)}
    >
      {principal}
      {lateral && largo && (
        <ContextoDaArea.Provider value={ctxLargo}>
          {recolhido ? (
            <aside aria-label={rotuloDaLateral} className="hidden min-h-0 lg:flex lg:flex-col lg:items-center lg:pb-14" data-lateral-recolhida="">
              <button
                type="button"
                onClick={alternarRecolhido}
                aria-label={`Abrir ${rotuloDaLateral.toLowerCase()}`}
                title={`Abrir ${rotuloDaLateral.toLowerCase()}`}
                className={juntar("flex h-full w-11 flex-col items-center rounded-lg border border-border bg-card pt-3 text-muted-foreground transition-colors hover:text-foreground", foco)}
              >
                <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                <span className="mt-3 text-[12px] font-medium" style={{ writingMode: "vertical-rl" }}>
                  {rotuloDaLateral}
                </span>
              </button>
            </aside>
          ) : (
            // pb-14: o botão flutuante do painel (lançador, canto direito de baixo) não cobre o campo do agente.
            <aside aria-label={rotuloDaLateral} className="hidden min-h-0 min-w-0 lg:flex lg:flex-col lg:pb-14" data-lateral="">
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
                  "pointer-events-auto inline-flex h-11 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background",
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
