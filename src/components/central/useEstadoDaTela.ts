import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

/**
 * Estado da tela que sobrevive a sair e voltar (pedido do dono, 26/09: "quando
 * eu saio e volto, tudo fica gravado, sem apagar, sem refazer").
 *
 * Versão local e simples da Central. Quando o sistema de design ganhar um
 * useEstadoDaTela próprio, esta troca de import sem mudar quem usa.
 *
 * - Guarda no localStorage deste navegador, por chave (a tela põe o id do
 *   usuário na chave, então cada pessoa tem o seu).
 * - Toda leitura e escrita fica em try/catch: aba privada, cota cheia ou
 *   navegador que bloqueia armazenamento só fazem o estado não persistir.
 * - Chave nula desliga a persistência (ex.: usuário ainda carregando). Quando
 *   a chave chega, o valor guardado é lido e aplicado.
 * - `validar` descarta valor guardado que não serve mais (aba que sumiu).
 */

const PREFIXO = "tela:v1:";

function ler<T>(chave: string | null): { ok: true; valor: T } | { ok: false } {
  if (!chave || typeof window === "undefined") return { ok: false };
  try {
    const bruto = window.localStorage.getItem(PREFIXO + chave);
    if (bruto === null) return { ok: false };
    return { ok: true, valor: JSON.parse(bruto) as T };
  } catch {
    return { ok: false };
  }
}

function gravar(chave: string, valor: unknown) {
  try {
    window.localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: o estado vale só nesta visita */
  }
}

export function useEstadoDaTela<T>(
  chave: string | null,
  inicial: T | (() => T),
  validar?: (valor: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const aceita = (r: { ok: true; valor: T } | { ok: false }): r is { ok: true; valor: T } => r.ok && (!validar || validar(r.valor));
  const [valor, setValor] = useState<T>(() => {
    const guardado = ler<T>(chave);
    if (aceita(guardado)) return guardado.valor;
    return typeof inicial === "function" ? (inicial as () => T)() : inicial;
  });
  const chaveLida = useRef<string | null>(chave);
  const ultimo = useRef<T>(valor);
  ultimo.current = valor;

  // A chave chegou ou mudou (usuário carregou): traz o que estava guardado.
  useEffect(() => {
    if (chave === chaveLida.current) return;
    chaveLida.current = chave;
    const guardado = ler<T>(chave);
    if (aceita(guardado)) setValor(guardado.valor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  // Grava com um respiro curto (digitação não escreve a cada tecla).
  useEffect(() => {
    if (!chave || chaveLida.current !== chave) return;
    const t = window.setTimeout(() => gravar(chave, valor), 250);
    return () => window.clearTimeout(t);
  }, [chave, valor]);

  // Sair da tela no meio do respiro não perde a última mudança.
  useEffect(() => {
    if (!chave) return;
    const salvarAgora = () => gravar(chave, ultimo.current);
    window.addEventListener("pagehide", salvarAgora);
    return () => {
      window.removeEventListener("pagehide", salvarAgora);
      salvarAgora();
    };
  }, [chave]);

  return [valor, setValor];
}

/** Quem rola a tela: a caixa de conteúdo do painel (celular) ou a janela (computador). */
function quemRola(el: HTMLElement | null): HTMLElement | null {
  const casca = el ? (el.closest('[data-casca="conteudo"]') as HTMLElement | null) : null;
  if (!casca) return null;
  try {
    const s = window.getComputedStyle(casca).overflowY;
    return s === "auto" || s === "scroll" ? casca : null;
  } catch {
    return null;
  }
}

/**
 * Guarda a rolagem da tela e devolve ao voltar. Tenta algumas vezes enquanto
 * os dados chegam (a página ainda não tem a altura toda na primeira pintura)
 * e para assim que a pessoa mexe.
 */
export function useRolagemDaTela(chave: string | null, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!chave || typeof window === "undefined") return;
    const el = ref.current;
    const caixa = quemRola(el);
    const posicao = () => (caixa ? caixa.scrollTop : window.pageYOffset || document.documentElement.scrollTop || 0);
    const rolarPara = (y: number) => {
      if (caixa) caixa.scrollTop = y;
      else window.scrollTo(0, y);
    };
    const alvo = ler<number>(chave);
    let mexeu = false;
    const tentativas: number[] = [];
    if (alvo.ok && typeof alvo.valor === "number" && alvo.valor > 0) {
      for (const ms of [0, 150, 400, 900, 1600]) {
        tentativas.push(window.setTimeout(() => {
          if (!mexeu && Math.abs(posicao() - alvo.valor) > 2) rolarPara(alvo.valor);
        }, ms));
      }
    }
    const tocou = () => { mexeu = true; };
    let espera = 0;
    const aoRolar = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(() => gravar(chave, Math.round(posicao())), 200);
    };
    const alvoDoEvento: HTMLElement | Window = caixa || window;
    alvoDoEvento.addEventListener("scroll", aoRolar, { passive: true } as AddEventListenerOptions);
    for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, tocou, { passive: true } as AddEventListenerOptions);
    return () => {
      for (const t of tentativas) window.clearTimeout(t);
      window.clearTimeout(espera);
      alvoDoEvento.removeEventListener("scroll", aoRolar);
      for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(ev, tocou);
    };
  }, [chave, ref]);
}
