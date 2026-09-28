import { useSyncExternalStore } from "react";

/**
 * Campanha em uso nas mesas (frente AE, 28/09). Pedido do dono: "quando
 * seleciono a campanha, todas as mesas puxam o contexto dela (Estúdio, Mesa
 * Foto, Mesa Ads, Mês), com botão de selecionar".
 *
 * Uma escolha por cliente, guardada no navegador (localStorage, sai e volta
 * mantém; outra aba escuta pelo evento "storage"). Quem seleciona: o botão
 * "Usar nas mesas" da campanha e a escolha da campanha na Mesa Foto. Quem lê:
 * a arte rápida do Estúdio (campanha já marcada), a Mesa Foto (antes da do
 * mês) e, pela mesma chave, qualquer outra mesa.
 *
 * Nada aqui vai ao servidor: a mesa manda o campanha_id no pedido, como já
 * fazia. Sem armazenamento (aba anônima, bloqueio): vale só nesta tela.
 */

const PREFIXO = "mesa:campanha-em-uso:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const chaveDaCampanhaEmUso = (clientId: string) => `${PREFIXO}${clientId}`;

const naMemoria: Record<string, string | null> = {};
const ouvintes: (() => void)[] = [];

function avisar() {
  ouvintes.slice().forEach((f) => f());
}

/** A campanha em uso nas mesas deste cliente (id) ou null. */
export function lerCampanhaEmUso(clientId: string | null | undefined): string | null {
  if (!clientId) return null;
  const chave = chaveDaCampanhaEmUso(clientId);
  if (Object.prototype.hasOwnProperty.call(naMemoria, chave)) return naMemoria[chave];
  let valor: string | null = null;
  try {
    const bruto = window.localStorage.getItem(chave);
    const o = bruto ? JSON.parse(bruto) : null;
    valor = o && typeof o.id === "string" && UUID.test(o.id) ? o.id : null;
  } catch {
    valor = null;
  }
  naMemoria[chave] = valor;
  return valor;
}

/** Seleciona (ou tira, com null) a campanha em uso nas mesas deste cliente. */
export function definirCampanhaEmUso(clientId: string, id: string | null) {
  if (!clientId) return;
  const chave = chaveDaCampanhaEmUso(clientId);
  const valor = id && UUID.test(id) ? id : null;
  naMemoria[chave] = valor;
  try {
    if (valor) window.localStorage.setItem(chave, JSON.stringify({ id: valor, em: Date.now() }));
    else window.localStorage.removeItem(chave);
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
  avisar();
}

function ouvir(f: () => void) {
  ouvintes.push(f);
  const doOutroLado = (e: StorageEvent) => {
    if (!e.key || e.key.indexOf(PREFIXO) !== 0) return;
    delete naMemoria[e.key];
    f();
  };
  try {
    window.addEventListener("storage", doOutroLado);
  } catch {
    /* sem janela (teste) */
  }
  return () => {
    const i = ouvintes.indexOf(f);
    if (i >= 0) ouvintes.splice(i, 1);
    try {
      window.removeEventListener("storage", doOutroLado);
    } catch {
      /* sem janela */
    }
  };
}

/** A campanha em uso nas mesas deste cliente, que acompanha a troca em qualquer mesa ou aba. */
export function useCampanhaEmUso(clientId: string | null | undefined): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(ouvir, () => lerCampanhaEmUso(clientId), () => null);
  return [id, (novo: string | null) => (clientId ? definirCampanhaEmUso(clientId, novo) : undefined)];
}
