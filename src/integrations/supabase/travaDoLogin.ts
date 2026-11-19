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
 *
 * 19/11/2026 (painel lento): com outra aba segurando a trava, CADA chamada ao
 * banco desta aba (o supabase-js passa pelo getSession antes de toda consulta)
 * esperava até 8 s, mesmo com o access token valendo por mais uma hora. Agora,
 * quando a sessão guardada vale por mais que FOLGA_PARA_LER_SEM_ESPERAR_MS, a
 * trava é tentada uma vez sem fila: livre, roda dentro dela; ocupada, segue na
 * hora como LEITURA, pelo mesmo caminho seguro de quando a espera esgota
 * (rodarSemRenovar). Nada muda para a renovação: com o token valendo tanto, o
 * supabase-js não renova (ele só renova a menos de 90 s do fim), e se algo ali
 * dentro pedir renovação ela continua só saindo com a trava (renovarDentroDaTrava).
 * Perto de vencer, com renovação no ar ou com retorno de login no endereço, vale
 * a espera de sempre.
 */
import type { PreviewAuthStorage } from "./previewAuthStorage";
import {
  haRenovacaoEmVoo,
  lerSessaoGuardada,
  outraAbaRenovando,
  rodarSemRenovar,
  sessaoEstaViva,
  tokenAindaVale,
  tokenJaFoiTrocado,
} from "./renovacaoSegura";

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

/**
 * Quanto o access token guardado ainda precisa valer para a leitura não esperar
 * a trava. O supabase-js renova a menos de 90 s do fim (EXPIRY_MARGIN_MS); com
 * 3 minutos de folga, nenhuma operação dele renova enquanto roda.
 */
export const FOLGA_PARA_LER_SEM_ESPERAR_MS = 180_000;

/** O endereço traz retorno de login (código, token, recuperação de senha)? Aí a operação grava a sessão. */
function enderecoComRetornoDeLogin(): boolean {
  try {
    if (typeof window === "undefined" || !window.location) return false;
    const texto = `${window.location.search || ""}&${(window.location.hash || "").replace(/^#/, "")}`;
    return /(^|[?&])(code|access_token|refresh_token|token_hash|error_description)=/.test(texto);
  } catch {
    return true;
  }
}

/**
 * A operação pode rodar sem esperar a fila da trava? Só quando ela, com certeza,
 * só vai LER: sessão guardada viva, com usuário, access token valendo com folga
 * e nenhuma renovação no ar (nesta aba ou marcada por outra).
 */
async function podeLerSemEsperar(nome: string, storage: PreviewAuthStorage | null | undefined): Promise<boolean> {
  if (haRenovacaoEmVoo() || enderecoComRetornoDeLogin()) return false;
  const sessao = await lerSessaoGuardada(storage, nome.replace(/^lock:/, ""));
  if (!sessao || !sessao.user || !sessao.access_token || !sessaoEstaViva(sessao)) return false;
  if (tokenJaFoiTrocado(sessao.refresh_token) || outraAbaRenovando(sessao.refresh_token || "")) return false;
  return tokenAindaVale(sessao, FOLGA_PARA_LER_SEM_ESPERAR_MS);
}

const OCUPADA = { ocupada: true } as const;

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

    // Token valendo com folga: tenta a trava uma vez, sem fila. Ocupada, lê na hora (ver cabeçalho, 19/11).
    if (await podeLerSemEsperar(nome, storage)) {
      const r = (await locks.request(nome, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) return OCUPADA;
        return { valor: await fn() };
      })) as typeof OCUPADA | { valor: R };
      if (!("ocupada" in r)) return r.valor;
      return rodarSemRenovar({ nome, storage }, fn);
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
