/**
 * fetch das chamadas de login (/auth/v1/).
 *
 * 26/09: com o gateway do Supabase lento, um pedido do login ficou pendurado
 * sem resposta e toda aba nova do painel parava na logo. Desde então as
 * chamadas de login ganham prazo: o pedido é cancelado, a biblioteca trata
 * como falha de rede (tenta de novo depois) e o painel segue com a sessão
 * guardada.
 *
 * 14/11: EXCETO a renovação do token. Com a rotação de refresh token ligada,
 * cancelar uma renovação que o servidor já fez deixa o navegador com o token
 * velho, já trocado ("error finding refresh token: context canceled" às
 * 19:53:58Z). A próxima renovação vira "refresh_token_not_found" e a sessão
 * cai. Por isso a renovação:
 *  - nunca é cancelada por prazo (a trava do login não fica presa por ela:
 *    quem espera a trava desiste sozinho, ver travaDoLogin.ts);
 *  - pedida por uma operação que seguiu sem a trava, espera a trava de verdade
 *    e relê o storage antes de sair (renovacaoSegura.ts), para nunca sair
 *    duas renovações do mesmo token juntas;
 *  - não reenvia token que o servidor já recusou neste navegador.
 *
 * Banco, storage e funções seguem sem prazo (funções longas usam a resposta
 * com fôlego). Pedido que já tem sinal de cancelamento próprio não ganha
 * prazo. Navegador sem AbortController (Safari 11.0) usa o fetch normal.
 */
import {
  contextoSemTrava,
  ehPedidoDeRenovacao,
  observarRespostaDeRenovacao,
  renovarDentroDaTrava,
  respostaDeTokenMorto,
  tokenDoPedido,
  tokenEstaMorto,
} from "./renovacaoSegura";

export const PRAZO_DO_LOGIN_MS = 10_000;

function urlDo(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return (input as Request).url || "";
}

export function criarFetchComPrazo(base: typeof fetch = (input, init) => fetch(input, init), prazoMs = PRAZO_DO_LOGIN_MS): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlDo(input);
    if (url.indexOf("/auth/v1/") < 0) return base(input, init);

    if (ehPedidoDeRenovacao(input, init)) {
      const token = tokenDoPedido(init);
      if (tokenEstaMorto(token)) return Promise.resolve(respostaDeTokenMorto());
      // Sem prazo e sem sinal novo: a resposta da renovação sempre é lida.
      const enviar = (tokenParaUsar: string) =>
        base(input, tokenParaUsar && tokenParaUsar !== token ? { ...(init || {}), body: JSON.stringify({ refresh_token: tokenParaUsar }) } : init).then(
          async (resposta) => {
            await observarRespostaDeRenovacao(tokenParaUsar || token, resposta);
            return resposta;
          },
        );
      // Pedida de dentro de uma operação que seguiu sem a trava: só sai com a trava.
      const ctx = contextoSemTrava();
      if (ctx) return renovarDentroDaTrava(ctx, token, enviar);
      return enviar(token);
    }

    if ((init && init.signal) || typeof AbortController === "undefined") return base(input, init);
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
