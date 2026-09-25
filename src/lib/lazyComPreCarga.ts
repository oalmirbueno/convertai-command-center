import { createElement, lazy, type ComponentType } from "react";

/**
 * Tela sob demanda que pode ser baixada ANTES do clique (dono, 25/09: "eu
 * clico, ele já aparece tudo").
 *
 * Igual ao lazy do React, com duas diferenças:
 * - `preCarregar()` baixa o código na hora que quisermos (mouse em cima do
 *   link, painel ocioso, rota abrindo a aba junto);
 * - depois de baixado, a tela aparece direto, sem passar pelo esqueleto (o
 *   lazy puro ainda suspende um quadro mesmo com o arquivo já na memória).
 *
 * A chave junta quem pede o mesmo arquivo em lugares diferentes: a rota do
 * painel (src/lib/mesa/preCarga.ts) e a página da Mesa pedem a aba pela
 * mesma chave e dividem o mesmo download e o mesmo módulo.
 */

type Modulo = { default: ComponentType<any> };

interface Entrada {
  promessa: Promise<Modulo> | null;
  modulo: Modulo | null;
}

const registro = new Map<string, Entrada>();

function entrada(chave: string): Entrada {
  let e = registro.get(chave);
  if (!e) {
    e = { promessa: null, modulo: null };
    registro.set(chave, e);
  }
  return e;
}

/** Baixa (uma vez só) o módulo desta chave. Falhou: a próxima chamada tenta de novo. */
export function preCarregarModulo(chave: string, carregar: () => Promise<unknown>): Promise<Modulo> {
  const e = entrada(chave);
  if (e.modulo) return Promise.resolve(e.modulo);
  if (!e.promessa) {
    e.promessa = (carregar() as Promise<Modulo>).then(
      (m) => {
        e.modulo = m;
        return m;
      },
      (erro) => {
        e.promessa = null;
        throw erro;
      },
    );
  }
  return e.promessa;
}

/** Já está na memória (aparece sem esqueleto)? */
export function moduloPronto(chave: string): boolean {
  const e = registro.get(chave);
  return !!(e && e.modulo);
}

/** Pré-carga que não derruba nada: sem rede agora, baixa quando a tela abrir. */
export function preCarregarEmSilencio(chave: string, carregar: () => Promise<unknown>) {
  preCarregarModulo(chave, carregar).catch(() => undefined);
}

export type ComponenteComPreCarga<P> = ComponentType<P> & { preCarregar: () => Promise<Modulo>; chave: string };

export function lazyComPreCarga<P = any>(chave: string, carregar: () => Promise<{ default: ComponentType<P> }>): ComponenteComPreCarga<P> {
  const baixar = () => preCarregarModulo(chave, carregar);
  const Preguicoso = lazy(baixar);
  function ComPreCarga(props: P) {
    const e = registro.get(chave);
    if (e && e.modulo) return createElement(e.modulo.default, props as any);
    return createElement(Preguicoso, props as any);
  }
  const c = ComPreCarga as unknown as ComponenteComPreCarga<P>;
  c.preCarregar = baixar;
  c.chave = chave;
  return c;
}

/** Roda quando o navegador estiver ocioso (setTimeout onde não há). Devolve o cancelamento. */
export function quandoOcioso(fn: () => void, prazoMs = 4000): () => void {
  const w = window as any;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: prazoMs });
    return () => {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

/** Rede econômica (economia de dados ligada ou 2G): não baixa nada por conta própria. */
export function redeEconomica(): boolean {
  try {
    const c = (navigator as any).connection;
    if (!c) return false;
    if (c.saveData) return true;
    return c.effectiveType === "slow-2g" || c.effectiveType === "2g";
  } catch {
    return false;
  }
}
