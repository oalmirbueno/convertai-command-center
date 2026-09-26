/**
 * fetch com prazo para as chamadas de login (/auth/v1/).
 *
 * 26/09: com o gateway do Supabase lento, um pedido de renovação do login
 * ficou pendurado sem resposta. A biblioteca de login guarda uma trava
 * compartilhada entre as abas enquanto renova; com o pedido preso, a trava
 * nunca soltava e toda aba nova do painel parava na logo. Com prazo, o pedido
 * é cancelado, a biblioteca trata como falha de rede (tenta de novo depois) e
 * o painel segue com a sessão guardada.
 *
 * Só as chamadas de login ganham prazo; banco, storage e funções seguem como
 * estão (funções longas usam a resposta com fôlego). Pedido que já tem sinal
 * de cancelamento próprio não é tocado. Navegador sem AbortController (Safari
 * 11.0) usa o fetch normal.
 */
export const PRAZO_DO_LOGIN_MS = 10_000;

function urlDo(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return (input as Request).url || "";
}

export function criarFetchComPrazo(base: typeof fetch = (input, init) => fetch(input, init), prazoMs = PRAZO_DO_LOGIN_MS): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlDo(input);
    if (url.indexOf("/auth/v1/") < 0 || (init && init.signal) || typeof AbortController === "undefined") {
      return base(input, init);
    }
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), prazoMs);
    return base(input, { ...(init || {}), signal: controle.signal }).then(
      (resposta) => {
        clearTimeout(relogio);
        return resposta;
      },
      (erro) => {
        clearTimeout(relogio);
        throw erro;
      },
    );
  };
}
