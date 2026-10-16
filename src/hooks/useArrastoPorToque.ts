import { useCallback, useEffect, useMemo, useRef, type PointerEvent as EventoDePonteiro } from "react";

/**
 * Arrastar com o dedo (16/10/2026, dono: "clicar no card e arrastar, igual no
 * Notion", agora no celular e no tablet). O arrasto nativo do HTML5 não
 * funciona com toque; aqui é Pointer Events (iOS 13+, Chrome 55+). No iOS
 * mais antigo nada disto roda e o menu ⋮ "Mover para" continua igual.
 *
 * - Toque longo (ESPERA_DO_TOQUE_LONGO parado) pega o cartão; mexer o dedo
 *   antes disso é rolagem e cancela, sem brigar com a página.
 * - Pegou: vibra curto, um fantasma do cartão segue o dedo, a rolagem da
 *   página fica presa (touchmove cancelado no quadro, só durante o arrasto)
 *   e a área com rolagem sob o dedo (ou a página) rola sozinha perto das bordas.
 * - Quem usa decide o resto: o que fica destacado sob o dedo (aoMover) e o
 *   que acontece ao soltar (aoSoltar), com a mesma função do arrasto nativo.
 */

/** Tempo com o dedo parado para o toque virar arrasto. */
export const ESPERA_DO_TOQUE_LONGO = 300;
/** Quanto o dedo pode tremer antes do tempo sem cancelar (passou disso é rolagem). */
const TREMOR_MAXIMO = 8;
/** Faixa perto da borda que faz rolar sozinho, e o passo máximo por quadro. */
const BORDA_DE_ROLAGEM = 56;
const PASSO_MAXIMO = 14;

export interface RetornosDoArrastoPorToque {
  /** Pode começar a esperar o toque longo neste item? (ex.: não salvando). */
  podeComecar: (id: string) => boolean;
  /** O toque longo venceu: pega o item. false = não pegou (o gesto acaba). */
  aoPegar: (id: string) => boolean;
  /** O dedo andou (ou a página rolou sob ele): destacar o que está sob o ponto. */
  aoMover: (x: number, y: number) => void;
  /** Soltou durante o arrasto, no ponto (x, y). */
  aoSoltar: (x: number, y: number) => void;
  /** O arrasto foi interrompido (o navegador cancelou o toque). */
  aoCancelar: () => void;
}

interface Gesto {
  id: string;
  pointerId: number;
  inicioX: number;
  inicioY: number;
  x: number;
  y: number;
  elemento: HTMLElement;
  ativo: boolean;
  espera: number | null;
  quadro: number | null;
  fantasma: HTMLElement | null;
  toqueAntes: string;
}

const pedirQuadro = (f: () => void): number =>
  typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(f) : window.setTimeout(f, 16);
const cancelarQuadro = (q: number) => {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(q);
  else window.clearTimeout(q);
};

/** Passo de rolagem para o ponto y numa faixa [topo, base]: negativo sobe, positivo desce. */
function passoNaBorda(y: number, topo: number, base: number): number {
  if (base - topo < BORDA_DE_ROLAGEM * 2) return 0;
  if (y < topo + BORDA_DE_ROLAGEM) return -Math.ceil(PASSO_MAXIMO * Math.min(1, (topo + BORDA_DE_ROLAGEM - y) / BORDA_DE_ROLAGEM));
  if (y > base - BORDA_DE_ROLAGEM) return Math.ceil(PASSO_MAXIMO * Math.min(1, (y - (base - BORDA_DE_ROLAGEM)) / BORDA_DE_ROLAGEM));
  return 0;
}

/** Ancestrais que rolam de verdade (overflow-y auto/scroll com conteúdo sobrando). */
function juntarRolaveis(inicio: Element | null, lista: HTMLElement[]) {
  let n: Element | null = inicio;
  while (n && n !== document.body && n !== document.documentElement) {
    if (n instanceof HTMLElement && lista.indexOf(n) < 0 && n.scrollHeight > n.clientHeight + 1) {
      let s = "";
      try {
        s = window.getComputedStyle(n).overflowY;
      } catch {
        s = "";
      }
      if (s === "auto" || s === "scroll") lista.push(n);
    }
    n = n.parentElement;
  }
}

/** Rola um passo a área sob o dedo (ou a página) se o dedo está perto da borda. true = rolou. */
function rolarPertoDaBorda(g: Gesto): boolean {
  const altura = window.innerHeight || document.documentElement.clientHeight;
  const rolaveis: HTMLElement[] = [];
  const sob = typeof document.elementFromPoint === "function" ? document.elementFromPoint(g.x, g.y) : null;
  juntarRolaveis(sob, rolaveis);
  juntarRolaveis(g.elemento, rolaveis);
  for (let i = 0; i < rolaveis.length; i++) {
    const el = rolaveis[i];
    const r = el.getBoundingClientRect();
    if (g.x < r.left || g.x > r.right || g.y < r.top || g.y > r.bottom) continue;
    const passo = passoNaBorda(g.y, Math.max(r.top, 0), Math.min(r.bottom, altura));
    if (passo < 0 && el.scrollTop > 0) {
      el.scrollTop += passo;
      return true;
    }
    if (passo > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
      el.scrollTop += passo;
      return true;
    }
  }
  const passo = passoNaBorda(g.y, 0, altura);
  if (passo === 0) return false;
  const antes = window.pageYOffset;
  try {
    window.scrollBy(0, passo);
  } catch {
    return false;
  }
  return window.pageYOffset !== antes;
}

function criarFantasma(origem: HTMLElement): HTMLElement {
  const r = origem.getBoundingClientRect();
  const f = origem.cloneNode(true) as HTMLElement;
  f.setAttribute("aria-hidden", "true");
  f.setAttribute("data-fantasma-do-arrasto", "");
  f.removeAttribute("tabindex");
  f.removeAttribute("role");
  f.style.position = "fixed";
  f.style.left = `${r.left}px`;
  f.style.top = `${r.top}px`;
  f.style.width = `${r.width}px`;
  f.style.margin = "0";
  f.style.zIndex = "9999";
  f.style.pointerEvents = "none";
  f.style.opacity = "0.95";
  f.style.boxShadow = "0 12px 28px rgba(0,0,0,0.22)";
  f.style.transition = "none";
  f.style.transform = "rotate(1.5deg) scale(1.02)";
  document.body.appendChild(f);
  return f;
}

export function useArrastoPorToque(retornos: RetornosDoArrastoPorToque) {
  const retornosRef = useRef(retornos);
  retornosRef.current = retornos;
  const gestoRef = useRef<Gesto | null>(null);
  const ignorarCliqueAte = useRef(0);
  const gestoArrastou = useRef(false);

  const api = useMemo(() => {
    const encerrar = () => {
      const g = gestoRef.current;
      gestoRef.current = null;
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", cancelar);
      if (!g) return;
      if (g.espera !== null) window.clearTimeout(g.espera);
      if (g.quadro !== null) cancelarQuadro(g.quadro);
      if (g.fantasma && g.fantasma.parentNode) g.fantasma.parentNode.removeChild(g.fantasma);
      if (g.ativo) {
        g.elemento.style.touchAction = g.toqueAntes;
        // O clique que o navegador manda depois de soltar não abre o cartão.
        ignorarCliqueAte.current = Date.now() + 500;
      }
    };

    const rolar = () => {
      const g = gestoRef.current;
      if (!g || !g.ativo) return;
      g.quadro = null;
      if (rolarPertoDaBorda(g)) retornosRef.current.aoMover(g.x, g.y);
      if (gestoRef.current === g) g.quadro = pedirQuadro(rolar);
    };

    const ativar = () => {
      const g = gestoRef.current;
      if (!g) return;
      g.espera = null;
      if (!retornosRef.current.aoPegar(g.id)) {
        encerrar();
        return;
      }
      g.ativo = true;
      gestoArrastou.current = true;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(15);
      } catch {
        /* sem vibração */
      }
      g.fantasma = criarFantasma(g.elemento);
      g.toqueAntes = g.elemento.style.touchAction;
      g.elemento.style.touchAction = "none";
      retornosRef.current.aoMover(g.x, g.y);
      g.quadro = pedirQuadro(rolar);
    };

    function mover(e: PointerEvent) {
      const g = gestoRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (!g.ativo) {
        // Andou antes do tempo: é rolagem (ou deslize de coluna), não arrasto.
        if (Math.abs(g.x - g.inicioX) > TREMOR_MAXIMO || Math.abs(g.y - g.inicioY) > TREMOR_MAXIMO) encerrar();
        return;
      }
      if (e.cancelable) e.preventDefault();
      if (g.fantasma) {
        g.fantasma.style.transform = `translate3d(${g.x - g.inicioX}px, ${g.y - g.inicioY}px, 0) rotate(1.5deg) scale(1.02)`;
      }
      retornosRef.current.aoMover(g.x, g.y);
    }

    function soltar(e: PointerEvent) {
      const g = gestoRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const ativo = g.ativo;
      const x = typeof e.clientX === "number" ? e.clientX : g.x;
      const y = typeof e.clientY === "number" ? e.clientY : g.y;
      encerrar();
      if (ativo) retornosRef.current.aoSoltar(x, y);
    }

    function cancelar(e: PointerEvent) {
      const g = gestoRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const ativo = g.ativo;
      encerrar();
      if (ativo) retornosRef.current.aoCancelar();
    }

    /** No onPointerDown do item. Mouse fica com o arrasto nativo. */
    const tocar = (e: EventoDePonteiro<HTMLElement>, id: string) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (e.isPrimary === false || gestoRef.current) return;
      if (!retornosRef.current.podeComecar(id)) return;
      gestoArrastou.current = false;
      const g: Gesto = {
        id,
        pointerId: e.pointerId,
        inicioX: e.clientX,
        inicioY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        elemento: e.currentTarget,
        ativo: false,
        espera: null,
        quadro: null,
        fantasma: null,
        toqueAntes: "",
      };
      gestoRef.current = g;
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
      window.addEventListener("pointercancel", cancelar);
      g.espera = window.setTimeout(ativar, ESPERA_DO_TOQUE_LONGO);
    };

    /**
     * Prende a rolagem só durante o arrasto. Precisa estar no quadro ANTES do
     * toque começar (o Chrome decide no touchstart se o toque pode ser
     * cancelado), por isso fica ligado sempre e só age com arrasto ativo.
     */
    const segurarRolagem = (e: TouchEvent) => {
      const g = gestoRef.current;
      if (g && g.ativo && e.cancelable) e.preventDefault();
    };

    return { encerrar, tocar, segurarRolagem };
  }, []);

  useEffect(() => () => api.encerrar(), [api]);

  // Ref de callback do quadro (a raiz da tela): liga o touchmove não passivo.
  const quadroRef = useRef<HTMLElement | null>(null);
  const ligarQuadro = useCallback(
    (el: HTMLElement | null) => {
      if (quadroRef.current) quadroRef.current.removeEventListener("touchmove", api.segurarRolagem);
      quadroRef.current = el;
      if (el) el.addEventListener("touchmove", api.segurarRolagem, { passive: false } as AddEventListenerOptions);
    },
    [api],
  );

  return {
    tocar: api.tocar,
    ligarQuadro,
    /** Há um toque esperando ou arrastando (o arrasto nativo e o menu do toque longo ficam de fora). */
    emAndamento: () => gestoRef.current !== null,
    /** O clique que chega logo depois de soltar um arrasto não abre o item. */
    ignorarClique: () => Date.now() < ignorarCliqueAte.current,
    /** O último gesto virou arrasto (o deslize de coluna do celular não vale). */
    gestoArrastou: () => gestoArrastou.current,
  };
}
