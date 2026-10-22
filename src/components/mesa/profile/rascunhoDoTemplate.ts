import { useCallback, useSyncExternalStore } from "react";

/**
 * Rascunho do Template dividido entre o centro do Estúdio (o post grande) e o
 * painel de ajustes (rodada 2, 21/10): os dois leem e gravam o MESMO valor, e
 * a prévia muda ao vivo quando o painel mexe. Fica na sessionStorage, como o
 * useEstadoGuardado, e um sessionStorage limpo volta ao valor inicial.
 */
const cache = new Map<string, { bruto: string | null; valor: unknown }>();
const ouvintes = new Map<string, Set<() => void>>();

function bruto(chave: string): string | null {
  try {
    return window.sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

function ler<T>(chave: string, inicial: T): T {
  const atual = bruto(chave);
  const guardado = cache.get(chave);
  if (guardado && guardado.bruto === atual) return guardado.valor as T;
  let valor: T = inicial;
  let guardar = atual;
  if (atual !== null) {
    try {
      const v = JSON.parse(atual);
      if (v !== null && v !== undefined) valor = v as T;
    } catch {
      valor = inicial;
    }
  } else {
    // Sem nada guardado: o inicial vira o guardado, para o mesmo valor valer no centro e no painel.
    try { guardar = JSON.stringify(inicial); window.sessionStorage.setItem(chave, guardar); } catch { guardar = null; }
  }
  cache.set(chave, { bruto: guardar, valor });
  return valor;
}

export function useRascunhoCompartilhado<T>(chave: string, inicial: T): [T, (v: T | ((anterior: T) => T)) => void] {
  const assinar = useCallback((avisar: () => void) => {
    let lista = ouvintes.get(chave);
    if (!lista) { lista = new Set(); ouvintes.set(chave, lista); }
    lista.add(avisar);
    return () => { lista!.delete(avisar); };
  }, [chave]);
  // O inicial só vale enquanto nada foi gravado; a referência guardada é estável entre renders.
  const valor = useSyncExternalStore(assinar, () => ler(chave, inicial), () => inicial);
  const mudar = useCallback((v: T | ((anterior: T) => T)) => {
    const anterior = ler(chave, inicial);
    const novo = typeof v === "function" ? (v as (a: T) => T)(anterior) : v;
    let texto: string | null = null;
    try { texto = JSON.stringify(novo); window.sessionStorage.setItem(chave, texto); } catch { texto = null; }
    cache.set(chave, { bruto: texto ?? bruto(chave), valor: novo });
    ouvintes.get(chave)?.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return [valor, mudar];
}
