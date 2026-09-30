import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type TextareaHTMLAttributes } from "react";
import { campoTexto, juntar } from "./estilos";

/**
 * Campo de mensagem dos agentes das mesas (frente UXS, 30/09): uma peça só
 * no lugar do textarea que cada compositor repetia (rows 2, min-h 60 px).
 *
 * - Abaixo de 768 px (o corte do src/styles/responsive.css): nasce com 1
 *   linha e cresce até 4, medindo o scrollHeight a cada mudança do valor
 *   (digitado, atalho ou rascunho que volta quando o envio falha). Sem
 *   field-sizing, que o Safari 11 não tem. Com o teclado aberto, a conversa
 *   continua à vista.
 * - De 768 px para cima: 2 linhas e 60 px, como sempre.
 * - Enter envia; Shift+Enter quebra a linha.
 */

const LINHAS_NO_CELULAR = 4;

/** Abaixo de 768 px. */
function ehCelular(): boolean {
  try {
    if (typeof window.matchMedia === "function") return window.matchMedia("(max-width: 767px)").matches;
    return window.innerWidth < 768;
  } catch {
    return false;
  }
}

/** Largura de celular, relida quando a janela muda de tamanho. */
export function useCelular(): boolean {
  const [celular, setCelular] = useState(ehCelular);
  useEffect(() => {
    const ver = () => setCelular(ehCelular());
    window.addEventListener("resize", ver);
    return () => window.removeEventListener("resize", ver);
  }, []);
  return celular;
}

const px = (v: string | null | undefined) => {
  const n = parseFloat(String(v || ""));
  return isFinite(n) ? n : 0;
};

/** Altura do campo: no celular, o texto até 4 linhas (depois rola por dentro); no computador, a do CSS. */
export function ajustarAlturaDoCampo(el: HTMLTextAreaElement | null, celular: boolean) {
  if (!el) return;
  if (!celular) {
    el.style.height = "";
    el.style.overflowY = "";
    return;
  }
  el.style.height = "auto";
  const cs = window.getComputedStyle(el);
  const linha = px(cs.lineHeight) || px(cs.fontSize) * 1.55 || 24;
  const borda = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  const recheio = px(cs.paddingTop) + px(cs.paddingBottom);
  const teto = linha * LINHAS_NO_CELULAR + recheio + borda;
  // scrollHeight tem o recheio e não a borda (a caixa mede com a borda: border-box).
  const alvo = el.scrollHeight + borda;
  if (alvo <= borda) {
    el.style.height = "";
    return;
  }
  el.style.height = `${Math.min(alvo, teto)}px`;
  el.style.overflowY = alvo > teto ? "auto" : "hidden";
}

/** Aparelho de toque (sem mouse de verdade). */
function ehToque(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(hover: none), (pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Depois de um atalho preencher o campo: foco e cursor no fim, para o Enter
 * mandar. Roda no quadro seguinte, quando o texto novo já está na tela (o
 * rascunho pode morar na página) e o menu "..." já fechou. No toque, só
 * quando o pedido ainda precisa ser completado (texto que termina em espaço,
 * como "pelo CNPJ "): senão o teclado subiria por cima da conversa à toa.
 */
export function focarNoFim(campo: MutableRefObject<HTMLTextAreaElement | null>, texto: string) {
  if (ehToque() && !/\s$/.test(texto)) return;
  const quadro = (f: () => void) => {
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(f);
    else window.setTimeout(f, 16);
  };
  quadro(() =>
    quadro(() => {
      const el = campo.current;
      if (!el || el.disabled) return;
      el.focus();
      const fim = el.value.length;
      try {
        el.setSelectionRange(fim, fim);
      } catch {
        /* campo sem seleção */
      }
    }),
  );
}

export interface PropsDoCampoDoAgente extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows"> {
  valor: string;
  aoMudar: (v: string) => void;
  /** Enter sem Shift. */
  aoEnviar: () => void;
}

const CampoDoAgente = forwardRef<HTMLTextAreaElement, PropsDoCampoDoAgente>(function CampoDoAgente({ valor, aoMudar, aoEnviar, className = "", onKeyDown, ...resto }, ref) {
  const celular = useCelular();
  const interno = useRef<HTMLTextAreaElement | null>(null);
  const guardar = useCallback(
    (el: HTMLTextAreaElement | null) => {
      interno.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as MutableRefObject<HTMLTextAreaElement | null>).current = el;
    },
    [ref],
  );
  useLayoutEffect(() => {
    ajustarAlturaDoCampo(interno.current, celular);
  }, [valor, celular]);
  const teclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onKeyDown) onKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      aoEnviar();
    }
  };
  return (
    <textarea
      ref={guardar}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      onKeyDown={teclar}
      rows={celular ? 1 : 2}
      className={juntar(campoTexto, celular ? "min-h-0" : "min-h-[60px]", "resize-none", className)}
      data-campo-do-agente=""
      {...resto}
    />
  );
});

export default CampoDoAgente;
