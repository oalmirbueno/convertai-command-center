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
 * 14/11 (revisão do Codex): sem prazo nenhum, uma renovação pendurada prendia
 * o getSession() seguinte da MESMA aba na fila interna do supabase-js (que não
 * passa pela trava) e o envio de arquivo travava, mesmo com o access token
 * valendo. Agora (renovacaoSegura.ts, renovarSemDuplicar):
 *  - a renovação continua SEM abort;
 *  - no ar há mais de PRAZO_PARA_SOLTAR_RENOVACAO_MS (8 s), quem espera é solto
 *    com falha de rede ("Failed to fetch"); a nova tentativa do supabase-js
 *    recebe a sessão gravada, se o access token ainda vale, sem rede;
 *  - o pedido segue em segundo plano; quando a resposta chega, o par novo é
 *    gravado e o token velho não é renovado de novo;
 *  - nunca saem duas renovações juntas deste navegador.
 *
 * Banco, storage e funções seguem sem prazo (funções longas usam a resposta
 * com fôlego). Pedido que já tem sinal de cancelamento próprio não ganha
 * prazo. Navegador sem AbortController (Safari 11.0) usa o fetch normal.
 */
import type { PreviewAuthStorage } from "./previewAuthStorage";
import {
  PRAZO_PARA_SOLTAR_RENOVACAO_MS,
  contextoSemTrava,
  ehPedidoDeRenovacao,
  renovarDentroDaTrava,
  renovarSemDuplicar,
  respostaDeTokenMorto,
  tokenDoPedido,
  tokenEstaMorto,
} from "./renovacaoSegura";

export const PRAZO_DO_LOGIN_MS = 10_000;

export type OpcoesDoFetchDoLogin = {
  /** Storage da sessão (o mesmo do createClient). Sem ele, localStorage. */
  storage?: PreviewAuthStorage | null;
  /** Chave da sessão no storage. Padrão: a mesma que o supabase-js deriva da URL. */
  chave?: string;
  /** Prazo para soltar quem espera uma renovação pendurada (a renovação segue). */
  soltarRenovacaoEmMs?: number;
};

/** Mesma chave que o supabase-js usa quando o createClient não passa storageKey. */
function chavePadraoDaSessao(url: string): string {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "";
  }
}

function urlDo(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return (input as Request).url || "";
}

export function criarFetchComPrazo(
  base: typeof fetch = (input, init) => fetch(input, init),
  prazoMs = PRAZO_DO_LOGIN_MS,
  opcoes: OpcoesDoFetchDoLogin = {},
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlDo(input);
    if (url.indexOf("/auth/v1/") < 0) return base(input, init);

    if (ehPedidoDeRenovacao(input, init)) {
      const token = tokenDoPedido(init);
      if (tokenEstaMorto(token)) return Promise.resolve(respostaDeTokenMorto());
      // Sem prazo de abort e sem sinal novo: a resposta da renovação sempre é lida.
      const mandar = (tokenParaUsar: string) =>
        base(input, tokenParaUsar && tokenParaUsar !== token ? { ...(init || {}), body: JSON.stringify({ refresh_token: tokenParaUsar }) } : init);
      const renovar = (tokenParaUsar: string) =>
        renovarSemDuplicar({
          token: tokenParaUsar || token,
          mandar,
          storage: opcoes.storage,
          chave: opcoes.chave || chavePadraoDaSessao(url),
          soltarEmMs: opcoes.soltarRenovacaoEmMs ?? PRAZO_PARA_SOLTAR_RENOVACAO_MS,
        });
      // Pedida de dentro de uma operação que seguiu sem a trava: só sai com a trava.
      const ctx = contextoSemTrava();
      if (ctx) return renovarDentroDaTrava(ctx, token, renovar);
      return renovar(token);
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
