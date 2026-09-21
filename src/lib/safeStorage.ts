/**
 * Acesso ao localStorage e ao sessionStorage que nunca derruba a tela.
 *
 * Safari em modo privado, página aberta dentro de outro app (WhatsApp,
 * Instagram), cota cheia ou armazenamento bloqueado fazem getItem/setItem
 * LANÇAR, e um throw no meio de um useState inicial vira tela branca. Aqui
 * toda falha cai numa memória em RAM da aba: a pessoa perde a persistência
 * entre recargas, mas nunca perde a tela.
 */

type Area = "local" | "session";

const memoria: Record<Area, Map<string, string>> = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
};

function area(kind: Area): Storage | null {
  try {
    const store = kind === "local" ? window.localStorage : window.sessionStorage;
    return store || null;
  } catch {
    return null;
  }
}

export function storageGet(key: string, kind: Area = "local"): string | null {
  try {
    const store = area(kind);
    if (store) {
      const value = store.getItem(key);
      if (value !== null) return value;
    }
  } catch {
    /* cai na memória */
  }
  const fallback = memoria[kind].get(key);
  return fallback === undefined ? null : fallback;
}

export function storageSet(key: string, value: string, kind: Area = "local"): void {
  // A memória recebe sempre: se o armazenamento real falhar (cota, modo
  // privado), a leitura seguinte ainda encontra o valor nesta aba.
  memoria[kind].set(key, value);
  try {
    const store = area(kind);
    if (store) store.setItem(key, value);
  } catch {
    /* sem armazenamento: fica só na memória */
  }
}

export function storageRemove(key: string, kind: Area = "local"): void {
  memoria[kind].delete(key);
  try {
    const store = area(kind);
    if (store) store.removeItem(key);
  } catch {
    /* idem */
  }
}

/** Atalhos com a área fixa, para ler como frase no código que usa. */
export const safeStorage = {
  get: (key: string) => storageGet(key, "local"),
  set: (key: string, value: string) => storageSet(key, value, "local"),
  remove: (key: string) => storageRemove(key, "local"),
};

export const safeSessionStorage = {
  get: (key: string) => storageGet(key, "session"),
  set: (key: string, value: string) => storageSet(key, value, "session"),
  remove: (key: string) => storageRemove(key, "session"),
};
