/**
 * Trava da sessão do login que nunca prende o painel e nunca deixa duas
 * renovações saírem juntas.
 *
 * O supabase-js usa `navigator.locks` para uma aba só mexer na sessão por vez.
 *
 * 26/09/2026: com várias abas abertas, uma renovação lenta segurava a trava e
 * o envio de arquivo falhava com "Acquiring an exclusive Navigator LockManager
 * lock ... timed out waiting 10000ms". A correção da época, quando a espera
 * passava do prazo, rodava a operação SEM a trava.
 *
 * 14/11/2026: rodar sem trava também liberava a RENOVAÇÃO sem trava. Com a
 * rotação de refresh token ligada, duas renovações do mesmo token fora da
 * janela de reuso derrubam a sessão (foi o que aconteceu). Agora, quando a
 * espera passa do prazo, a operação segue como LEITURA: ler a sessão, enviar
 * arquivo e abrir o painel não falham (o defeito de 26/09 não volta). Mas a
 * RENOVAÇÃO nunca sai sem a trava: se a operação precisar renovar, o fetch do
 * login espera a trava de verdade e relê o storage antes de mandar o pedido
 * (renovacaoSegura.ts, renovarDentroDaTrava). Se outra aba já renovou, usa o
 * token dela e não renova de novo.
 *
 * Por que não simplesmente falhar com `TravaOcupada` quando a espera esgota:
 * o supabase-js guarda a promessa do initialize(). Se a primeira trava da aba
 * falha, TODA chamada de login daquela aba (getSession, login por senha,
 * sair) falha até recarregar a página. Ver src/test/sessao-duas-abas.test.ts.
 *
 * O caso "só se estiver livre" (prazo 0, usado pela renovação automática para
 * pular a vez) continua igual: avisa com `TravaOcupada` (`isAcquireTimeout`).
 */
import type { PreviewAuthStorage } from "./previewAuthStorage";
import { rodarSemRenovar } from "./renovacaoSegura";

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

/** Espera máxima pela trava (quando o supabase-js pede "para sempre" ou mais que isto). */
export const ESPERA_MAXIMA_MS = 8_000;

export function criarTravaDoLogin(
  esperaMaxima = ESPERA_MAXIMA_MS,
  storage?: PreviewAuthStorage | null,
) {
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
      if (!(esgotou || (e && (e as { name?: string }).name === "AbortError"))) throw e;
      // A espera passou do prazo: segue como leitura; renovação ali dentro só sai com a trava.
      return rodarSemRenovar({ nome, storage }, fn);
    } finally {
      clearTimeout(relogio);
    }
  };
}
