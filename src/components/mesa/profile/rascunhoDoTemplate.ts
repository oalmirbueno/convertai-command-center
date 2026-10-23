import { useCallback, useMemo, useSyncExternalStore } from "react";

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

/**
 * Rodada 3 (21/10): o desenho da lâmina aberta (perfil, tema, cores, tamanhos) vale para as miniaturas da
 * prancheta no modo Template, ao vivo e antes de guardar. Só memória: some ao recarregar.
 */
export interface BaseDoTemplate {
  template: import("../../../../supabase/functions/estudio-arte/modulos/template-profile").TemplateProfile;
  avatarUrl: string | null;
  formato: import("./renderProfile").FormatoProfile;
}
const bases = new Map<string, BaseDoTemplate>();
const ouvintesDaBase = new Map<string, Set<() => void>>();

export function publicarBaseDoTemplate(trabalhoId: string, base: BaseDoTemplate) {
  const antes = bases.get(trabalhoId);
  if (antes && JSON.stringify(antes) === JSON.stringify(base)) return;
  bases.set(trabalhoId, base);
  ouvintesDaBase.get(trabalhoId)?.forEach((f) => f());
}

export function useBaseDoTemplate(trabalhoId: string): BaseDoTemplate | null {
  const assinar = useCallback((avisar: () => void) => {
    let lista = ouvintesDaBase.get(trabalhoId);
    if (!lista) { lista = new Set(); ouvintesDaBase.set(trabalhoId, lista); }
    lista.add(avisar);
    return () => { lista!.delete(avisar); };
  }, [trabalhoId]);
  return useSyncExternalStore(assinar, () => bases.get(trabalhoId) || null, () => null);
}

/**
 * Carrossel estilo X (22/10): depois do "Gerar o carrossel", os rascunhos das lâminas são esquecidos para
 * cada uma abrir com o texto novo e a mídia sugerida (o valor inicial volta a valer). Avisa quem está aberto.
 */
export function esquecerRascunhos(prefixo: string) {
  const chaves: string[] = [];
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.indexOf(prefixo) === 0) chaves.push(k);
    }
    chaves.forEach((k) => window.sessionStorage.removeItem(k));
  } catch { /* sem sessionStorage: só a memória */ }
  for (const k of Array.from(cache.keys())) if (k.indexOf(prefixo) === 0) { cache.delete(k); if (chaves.indexOf(k) < 0) chaves.push(k); }
  chaves.forEach((k) => ouvintes.get(k)?.forEach((f) => f()));
}

/** O rascunho guardado de outra lâmina (fora de componente), ou null; usado ao montar todas as lâminas. */
export function lerRascunhoGuardado<T>(chave: string): T | null {
  const guardado = cache.get(chave);
  if (guardado) return guardado.valor as T;
  const texto = bruto(chave);
  if (texto === null) return null;
  try { return JSON.parse(texto) as T; } catch { return null; }
}

/** A chave do rascunho de uma lâmina no Template (a mesma no centro, no painel e na miniatura). */
export const chaveDoRascunho = (clientId: string, marcaId: string | null | undefined, trabalhoId: string, ordem: number) => `mesa:profile:v1:${clientId}:${marcaId || "-"}:${trabalhoId}:${ordem}`;

/** Grava o rascunho de outra lâmina (o "Aplicar a todas" e o selo) e avisa quem está aberto nela. */
export function gravarRascunho<T>(chave: string, valor: T) {
  let texto: string | null = null;
  try { texto = JSON.stringify(valor); window.sessionStorage.setItem(chave, texto); } catch { texto = null; }
  cache.set(chave, { bruto: texto ?? bruto(chave), valor });
  ouvintes.get(chave)?.forEach((f) => f());
}

/**
 * 23/10: o rascunho de uma lâmina só para LER e acompanhar ao vivo (a miniatura da prancheta), sem gravar o
 * inicial como o useRascunhoCompartilhado faz. Sem rascunho, null.
 */
export function useRascunhoSoLeitura<T>(chave: string): T | null {
  const assinar = useCallback((avisar: () => void) => {
    let lista = ouvintes.get(chave);
    if (!lista) { lista = new Set(); ouvintes.set(chave, lista); }
    lista.add(avisar);
    return () => { lista!.delete(avisar); };
  }, [chave]);
  const texto = useSyncExternalStore(assinar, () => { const g = cache.get(chave); return g ? g.bruto ?? JSON.stringify(g.valor) : bruto(chave); }, () => null);
  return useMemo(() => {
    if (!texto) return null;
    try { return JSON.parse(texto) as T; } catch { return null; }
  }, [texto]);
}
