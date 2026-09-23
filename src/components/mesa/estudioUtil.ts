import { useEffect, useRef, useState } from "react";

/**
 * Pequenas utilidades do Estúdio: estado que sobrevive à troca de aba da Mesa
 * (sessionStorage, sempre dentro de try/catch porque o Safari em modo privado
 * recusa gravar) e cópia de texto com reserva para navegador antigo.
 */

function lerDaSessao<T>(chave: string, inicial: T): T {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (bruto === null) return inicial;
    const valor = JSON.parse(bruto);
    return valor === null || valor === undefined ? inicial : (valor as T);
  } catch {
    return inicial;
  }
}

function gravarNaSessao(chave: string, valor: unknown) {
  try {
    window.sessionStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem sessionStorage: o estado vale só enquanto a tela estiver aberta */
  }
}

/**
 * useState que também guarda o valor na sessão do navegador, pela chave.
 * Trocar de aba da Mesa desmonta o Estúdio; na volta, o valor é relido.
 */
export function useEstadoGuardado<T>(chave: string, inicial: T): [T, (v: T | ((anterior: T) => T)) => void] {
  const [valor, setValor] = useState<T>(() => lerDaSessao(chave, inicial));
  const chaveAtual = useRef(chave);
  useEffect(() => {
    if (chaveAtual.current !== chave) {
      chaveAtual.current = chave;
      setValor(lerDaSessao(chave, inicial));
    }
    // a chave muda quando muda o item; o inicial é só o padrão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const definir = (v: T | ((anterior: T) => T)) => {
    setValor((anterior) => {
      const novo = typeof v === "function" ? (v as (a: T) => T)(anterior) : v;
      gravarNaSessao(chaveAtual.current, novo);
      return novo;
    });
  };
  return [valor, definir];
}

/** Copia texto: API moderna quando existe, senão textarea escondido e execCommand. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai na reserva */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Hashtags limpas, cada uma com um # só. */
export function normalizarHashtags(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const saida: string[] = [];
  for (const bruto of lista) {
    let t = String(bruto || "").trim();
    while (t.charAt(0) === "#") t = t.slice(1);
    t = t.split(" ").join("");
    if (t && saida.indexOf(`#${t}`) < 0) saida.push(`#${t}`);
  }
  return saida;
}

/** Legenda pronta para colar: legenda, uma linha em branco e as hashtags. */
export function legendaParaCopiar(legenda: string, hashtags: string[]): string {
  const corpo = (legenda || "").trim();
  const tags = hashtags.join(" ").trim();
  if (!tags) return corpo;
  if (!corpo) return tags;
  return `${corpo}\n\n${tags}`;
}

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const limitar = (v: number) => Math.max(0, Math.min(1, v));
const tres = (v: number) => Math.round(v * 1000) / 1000;

/** Retângulo normalizado (x0 < x1, y0 < y1), dentro de 0 a 1, com 3 casas. */
export function normalizarArea(a: Area): Area {
  return {
    x0: tres(limitar(Math.min(a.x0, a.x1))),
    y0: tres(limitar(Math.min(a.y0, a.y1))),
    x1: tres(limitar(Math.max(a.x0, a.x1))),
    y1: tres(limitar(Math.max(a.y0, a.y1))),
  };
}
