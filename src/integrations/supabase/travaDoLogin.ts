/**
 * Trava da sessão do login que nunca prende o painel (26/09/2026).
 *
 * O supabase-js usa `navigator.locks` para uma aba só renovar a sessão por vez.
 * Com várias abas abertas, uma renovação lenta segurava a trava e qualquer
 * envio de arquivo falhava com "Acquiring an exclusive Navigator LockManager
 * lock ... timed out waiting 10000ms" (o print não entrava no diretor).
 *
 * Esta trava faz o mesmo que a do supabase-js, com uma diferença: quando a
 * espera passa do prazo, a operação segue SEM a trava em vez de falhar. Duas
 * renovações ao mesmo tempo são toleradas pelo servidor (janela de reuso do
 * refresh token). O caso "só se estiver livre" (prazo 0, usado pela renovação
 * automática para pular a vez) continua igual: avisa com `isAcquireTimeout`.
 */

export class TravaOcupada extends Error {
  readonly isAcquireTimeout = true;
  constructor(nome: string) {
    super(`Trava ${nome} ocupada.`);
    this.name = "NavigatorLockAcquireTimeoutError";
  }
}

type Locks = {
  request: (nome: string, opcoes: Record<string, unknown>, fn: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
};

/** Espera máxima pela trava antes de seguir sem ela (quando o supabase-js pede "para sempre"). */
export const ESPERA_MAXIMA_MS = 8_000;

export function criarTravaDoLogin(esperaMaxima = ESPERA_MAXIMA_MS) {
  return async function trava<R>(nome: string, prazo: number, fn: () => Promise<R>): Promise<R> {
    const locks = (typeof navigator !== "undefined" ? (navigator as unknown as { locks?: Locks }).locks : undefined) || null;
    // Navegador sem LockManager (Safari 11 e outros): o supabase-js também roda sem trava.
    if (!locks || typeof locks.request !== "function") return fn();

    if (prazo === 0) {
      return (await locks.request(nome, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) throw new TravaOcupada(nome);
        return fn();
      })) as R;
    }

    const espera = prazo > 0 ? Math.min(prazo, esperaMaxima) : esperaMaxima;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let esgotou = false;
    const relogio = setTimeout(() => {
      esgotou = true;
      if (ctrl) ctrl.abort();
    }, espera);
    try {
      return (await locks.request(nome, ctrl ? { mode: "exclusive", signal: ctrl.signal } : { mode: "exclusive" }, async () => {
        clearTimeout(relogio);
        return fn();
      })) as R;
    } catch (e) {
      // A espera passou do prazo: segue sem a trava em vez de derrubar o envio.
      if (esgotou || (e && (e as { name?: string }).name === "AbortError")) return fn();
      throw e;
    } finally {
      clearTimeout(relogio);
    }
  };
}
