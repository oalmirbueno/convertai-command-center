import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import { juntar } from "./estilos";
import { gravarEstadoDaTela, lerEstadoDaTela } from "./useEstadoDaTela";

/** Posições guardadas (por chave de memória): em memória e no navegador (sair e voltar mantém). */
const posicoes: Record<string, number> = {};
export const posicaoGuardada = (chave: string) => {
  if (!(chave in posicoes)) {
    const v = lerEstadoDaTela<number>(`rolagem:${chave}`, 0, (x) => typeof x === "number" && x >= 0);
    posicoes[chave] = v;
  }
  return posicoes[chave] || 0;
};
let gravacaoPendente: number | null = null;
function guardarPosicao(chave: string, valor: number) {
  posicoes[chave] = valor;
  if (gravacaoPendente !== null) window.clearTimeout(gravacaoPendente);
  gravacaoPendente = window.setTimeout(() => {
    gravacaoPendente = null;
    gravarEstadoDaTela(`rolagem:${chave}`, Math.round(valor));
  }, 250);
}

/**
 * Região que rola por conta própria (docs/design/SISTEMA.md, "Rolagem").
 *
 * - `modo="lg"` (padrão): rola por dentro só de 1024 px para cima, onde a
 *   área de trabalho tem a altura da janela. No celular e no tablet vira
 *   conteúdo normal da página: nada de rolagem dentro de rolagem prendendo o
 *   dedo (armadilha 3 do painel).
 * - `modo="sempre"`: rola por dentro em qualquer largura. Só para o que já
 *   está numa caixa de altura fixa em todas as larguras (a conversa de um
 *   agente, uma gaveta, uma janela).
 *
 * Com `memoria` (ex.: "mesa:contexto:<cliente>"), a posição da rolagem é
 * guardada: trocar de etapa e voltar, reabrir o painel ou chegar dado novo
 * (esqueleto que encolhe e cresce de novo) não joga a região para o topo.
 * Rolagem feita pela própria tela (ir até uma seção) conta como posição nova.
 * Trocar de `memoria` para uma chave sem posição guardada (outra etapa, outro
 * cliente, mesma região) volta ao topo antes da pintura.
 *
 * O elemento que rola é `relative`: prende nele o que é absoluto lá dentro
 * (o select escondido do Radix, por exemplo). Sem isso, o absoluto se media
 * pela página e esticava a página inteira no computador.
 *
 * Mostra uma sombra sutil no topo e na base quando há mais conteúdo para
 * aquele lado. Rolar até o fim não arrasta a página junto (overscroll
 * contido). Com `rotulo`, vira uma região navegável pelo teclado.
 */
const RegiaoRolavel = forwardRef<
  HTMLDivElement,
  {
    children?: ReactNode;
    modo?: "lg" | "sempre";
    /** Nome da região para leitor de tela (e foco pelo teclado). */
    rotulo?: string;
    /** Sombras de "tem mais" no topo e na base. */
    sombras?: boolean;
    className?: string;
    /** Classes da caixa de fora (a que ocupa o espaço no layout). */
    classeDeFora?: string;
    onScroll?: (e: UIEvent<HTMLDivElement>) => void;
    /** Cor por trás (a sombra funde com ela): o fundo da página ou um cartão. */
    sobre?: "fundo" | "cartao";
    /** Chave para guardar a posição da rolagem (trocar de etapa e voltar mantém onde estava). */
    memoria?: string;
    "aria-live"?: "polite" | "off" | "assertive";
  } & Record<`data-${string}`, string | undefined>
>(function RegiaoRolavel({ children, modo = "lg", rotulo, sombras = true, className = "", classeDeFora = "", onScroll, sobre = "fundo", memoria, ...resto }, refDeFora) {
  const interno = useRef<HTMLDivElement | null>(null);
  const [mais, setMais] = useState<{ cima: boolean; baixo: boolean }>({ cima: false, baixo: false });

  const ligar = useCallback(
    (el: HTMLDivElement | null) => {
      interno.current = el;
      if (typeof refDeFora === "function") refDeFora(el);
      else if (refDeFora) (refDeFora as { current: HTMLDivElement | null }).current = el;
    },
    [refDeFora],
  );

  // Guarda e devolve a posição (memoria). Encolher o conteúdo (esqueleto ao
  // reler) faz o navegador "prender" a rolagem no fim possível: isso não conta
  // como posição nova, e quando o conteúdo volta a crescer a posição volta.
  const ultimoToque = useRef(0);
  const guardar = useCallback(() => {
    const el = interno.current;
    if (!el || !memoria) return;
    const antes = posicaoGuardada(memoria);
    const agora = el.scrollTop;
    const presoNoFim = agora < antes && agora >= el.scrollHeight - el.clientHeight - 1;
    if (presoNoFim && Date.now() - ultimoToque.current > 800) return;
    guardarPosicao(memoria, agora);
  }, [memoria]);
  const devolver = useCallback(() => {
    const el = interno.current;
    if (!el || !memoria) return;
    const alvo = posicaoGuardada(memoria);
    if (alvo <= 0 || Math.abs(el.scrollTop - alvo) < 2) return;
    if (Date.now() - ultimoToque.current < 800) return;
    if (el.scrollHeight - el.clientHeight >= alvo - 1) el.scrollTop = alvo;
  }, [memoria]);
  // Chave nova sem posição guardada: começa no topo (a região é a mesma entre
  // etapas e clientes, então sem isto herdava a rolagem da chave anterior).
  // Antes da pintura, para não aparecer um quadro na posição velha.
  const chaveAnterior = useRef<string | undefined>(memoria);
  useLayoutEffect(() => {
    const el = interno.current;
    const antes = chaveAnterior.current;
    chaveAnterior.current = memoria;
    if (!el || !memoria || antes === memoria) return;
    if (posicaoGuardada(memoria) <= 0) el.scrollTop = 0;
  }, [memoria]);

  useEffect(() => {
    const el = interno.current;
    if (!el || !memoria) return;
    const tocou = () => {
      ultimoToque.current = Date.now();
    };
    devolver();
    const t = window.setTimeout(devolver, 120);
    el.addEventListener("wheel", tocou, { passive: true } as AddEventListenerOptions);
    el.addEventListener("touchstart", tocou, { passive: true } as AddEventListenerOptions);
    el.addEventListener("keydown", tocou);
    el.addEventListener("mousedown", tocou);
    let obs: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      obs = new MutationObserver(() => devolver());
      obs.observe(el, { childList: true, subtree: true });
    }
    return () => {
      window.clearTimeout(t);
      el.removeEventListener("wheel", tocou);
      el.removeEventListener("touchstart", tocou);
      el.removeEventListener("keydown", tocou);
      el.removeEventListener("mousedown", tocou);
      if (obs) obs.disconnect();
    };
  }, [memoria, devolver]);

  const medir = useCallback(() => {
    const el = interno.current;
    if (!el || !sombras) return;
    let rola = true;
    try {
      const s = window.getComputedStyle(el).overflowY;
      rola = s === "auto" || s === "scroll";
    } catch {
      rola = true;
    }
    const cima = rola && el.scrollTop > 2;
    const baixo = rola && el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setMais((m) => (m.cima === cima && m.baixo === baixo ? m : { cima, baixo }));
  }, [sombras]);

  // Sem ResizeObserver (Safari 11): mede ao montar, ao redimensionar e quando o conteúdo muda.
  useEffect(() => {
    if (!sombras) return;
    medir();
    window.addEventListener("resize", medir);
    let obs: MutationObserver | null = null;
    const el = interno.current;
    if (el && typeof MutationObserver !== "undefined") {
      obs = new MutationObserver(() => medir());
      obs.observe(el, { childList: true, subtree: true });
    }
    const t = window.setTimeout(medir, 400);
    return () => {
      window.removeEventListener("resize", medir);
      if (obs) obs.disconnect();
      window.clearTimeout(t);
    };
  }, [medir, sombras]);

  const cor = sobre === "cartao" ? "var(--card)" : "var(--background)";
  const rolagem =
    modo === "sempre"
      ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
      : "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain";

  return (
    <div className={juntar("relative flex min-w-0 flex-col", modo === "sempre" ? "min-h-0 flex-1" : "lg:min-h-0 lg:flex-1", classeDeFora)}>
      <div
        ref={ligar}
        onScroll={(e) => {
          medir();
          guardar();
          if (onScroll) onScroll(e);
        }}
        role={rotulo ? "region" : undefined}
        aria-label={rotulo}
        tabIndex={rotulo ? 0 : undefined}
        className={juntar("relative min-w-0", rolagem, rotulo && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className)}
        {...resto}
      >
        {children}
      </div>
      {sombras && (
        <>
          <div
            aria-hidden="true"
            className={juntar("pointer-events-none absolute inset-x-0 top-0 h-4 transition-opacity", mais.cima ? "opacity-100" : "opacity-0")}
            style={{ background: `linear-gradient(to bottom, hsl(${cor} / 0.9), hsl(${cor} / 0))` }}
          />
          <div
            aria-hidden="true"
            className={juntar("pointer-events-none absolute inset-x-0 bottom-0 h-4 transition-opacity", mais.baixo ? "opacity-100" : "opacity-0")}
            style={{ background: `linear-gradient(to top, hsl(${cor} / 0.9), hsl(${cor} / 0))` }}
          />
        </>
      )}
    </div>
  );
});

export default RegiaoRolavel;
