import { useEffect, useState } from "react";

/**
 * Medidas da esteira do Estúdio (pedido do dono em 23/09: "a sensação de
 * que precisa ficar rolando lá infinito").
 *
 * No computador a aba ocupa a altura da janela abaixo do cabeçalho fixo da
 * Mesa, e cada coluna rola por dentro. A altura é calculada em px (sem
 * container queries, que o Safari 11 não conhece). No celular e no tablet
 * em pé, a página rola normalmente.
 */

export type Faixa = "celular" | "tablet" | "compacto" | "mesa";

/** celular < 768 ≤ tablet < 1024 ≤ compacto < 1280 ≤ mesa. */
export function faixaDaLargura(w: number): Faixa {
  if (w >= 1280) return "mesa";
  if (w >= 1024) return "compacto";
  if (w >= 768) return "tablet";
  return "celular";
}

/** As faixas em que a aba vira colunas com altura fixa e rolagem própria. */
export const emColunas = (f: Faixa) => f === "mesa" || f === "compacto";

const larguraDaJanela = () => {
  if (typeof window === "undefined") return 1280;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1280;
};

export function useFaixa(): Faixa {
  const [faixa, setFaixa] = useState<Faixa>(() => faixaDaLargura(larguraDaJanela()));
  useEffect(() => {
    const medir = () => setFaixa(faixaDaLargura(larguraDaJanela()));
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);
  return faixa;
}

/** Espaço entre o cabeçalho fixo da Mesa e o conteúdo da aba (space-y-5 da página). */
const ESPACO_ABAIXO_DO_CABECALHO = 20;
const MARGEM_DE_BAIXO = 12;
// O estúdio (sem a faixa de pautas) tem sempre a altura de uma tela: abaixo
// disso a lâmina grande ficava pequena e cortada (dono, 23/09 noite).
const ALTURA_MINIMA = 620;

function cabecalhoDaMesa(): HTMLElement | null {
  try {
    const nav = document.querySelector('nav[aria-label="Etapas da Mesa"]');
    if (!nav || typeof (nav as any).closest !== "function") return null;
    return (nav as HTMLElement).closest("header") as HTMLElement | null;
  } catch {
    return null;
  }
}

/** Onde termina o cabeçalho fixo da Mesa quando ele gruda no topo (px da janela). */
export function fimDoCabecalhoFixo(): number {
  const cab = cabecalhoDaMesa();
  if (!cab) return 200;
  let topo = 0;
  try {
    topo = parseFloat(window.getComputedStyle(cab).top || "0") || 0;
  } catch {
    topo = 0;
  }
  return topo + cab.offsetHeight;
}

/** Altura da esteira para a janela e o cabeçalho medidos. */
export function alturaDaEsteira(alturaDaJanela: number, fimDoCabecalho: number): number {
  return Math.max(ALTURA_MINIMA, Math.round(alturaDaJanela - fimDoCabecalho - ESPACO_ABAIXO_DO_CABECALHO - MARGEM_DE_BAIXO));
}

/** Altura (px) da esteira no computador; null quando a página rola normalmente. */
export function useAlturaDaEsteira(ativo: boolean): number | null {
  // Já nasce com uma conta (sem o pulo de altura no primeiro desenho); o efeito corrige.
  const [altura, setAltura] = useState<number | null>(() =>
    ativo && typeof window !== "undefined" ? alturaDaEsteira(window.innerHeight || 800, fimDoCabecalhoFixo()) : null,
  );
  useEffect(() => {
    if (!ativo) {
      setAltura(null);
      return;
    }
    const medir = () => setAltura(alturaDaEsteira(window.innerHeight || 800, fimDoCabecalhoFixo()));
    medir();
    window.addEventListener("resize", medir);
    // A barra de custo termina de carregar depois e pode mudar de altura.
    const cab = cabecalhoDaMesa();
    let observador: ResizeObserver | null = null;
    if (cab && typeof ResizeObserver !== "undefined") {
      try {
        observador = new ResizeObserver(() => medir());
        observador.observe(cab);
      } catch {
        observador = null;
      }
    }
    const depois = window.setTimeout(medir, 600);
    return () => {
      window.removeEventListener("resize", medir);
      window.clearTimeout(depois);
      if (observador) observador.disconnect();
    };
  }, [ativo]);
  return altura;
}

/** Leva um elemento para a vista (Safari antigo só aceita o booleano). */
export function rolarAte(el: HTMLElement | null | undefined, bloco: "start" | "nearest" = "start") {
  if (!el || typeof el.scrollIntoView !== "function") return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: bloco });
  } catch {
    try {
      el.scrollIntoView(bloco === "start");
    } catch {
      /* sem rolagem: segue como está */
    }
  }
}

/**
 * Rola a janela até o cabeçalho da Mesa grudar no topo, para a esteira caber
 * inteira na tela. Só desce (nunca sobe o que a pessoa já rolou).
 */
export function encaixarNaJanela(el: HTMLElement | null) {
  if (!el) return;
  try {
    const atual = window.pageYOffset || document.documentElement.scrollTop || 0;
    const alvo = Math.round(el.getBoundingClientRect().top + atual - fimDoCabecalhoFixo() - ESPACO_ABAIXO_DO_CABECALHO);
    if (alvo <= atual + 2 || typeof window.scrollTo !== "function") return;
    try {
      window.scrollTo({ top: alvo, behavior: "smooth" });
    } catch {
      window.scrollTo(0, alvo);
    }
  } catch {
    /* sem rolagem: segue como está */
  }
}

/**
 * Largura e altura de um elemento, atualizadas quando ele muda de tamanho.
 * Devolve o ref de função (estável) para pôr no elemento.
 */
export function useTamanho<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, { largura: number; altura: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [tamanho, setTamanho] = useState({ largura: 0, altura: 0 });
  useEffect(() => {
    if (!el) return;
    const medir = () => {
      const largura = el.clientWidth;
      const altura = el.clientHeight;
      setTamanho((t) => (t.largura === largura && t.altura === altura ? t : { largura, altura }));
    };
    medir();
    let observador: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      try {
        observador = new ResizeObserver(() => medir());
        observador.observe(el);
      } catch {
        observador = null;
      }
    }
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("resize", medir);
      if (observador) observador.disconnect();
    };
  }, [el]);
  return [setEl, tamanho];
}
