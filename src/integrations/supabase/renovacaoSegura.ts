/**
 * Renovação do login sem corrida entre abas (14/11/2026).
 *
 * A conta do painel é usada ao mesmo tempo por várias pessoas e agentes, e o
 * Supabase troca o refresh token a cada renovação (rotação ligada). Se duas
 * renovações do MESMO token saem juntas, ou se o painel cancela uma renovação
 * que o servidor já fez, o navegador fica com um token já trocado; a próxima
 * renovação volta "refresh_token_not_found" e o supabase-js apaga a sessão
 * guardada (inclusive a que outra aba acabou de gravar). Foi assim que a
 * sessão caiu em 14/11 às 17:23 (America/Sao_Paulo).
 *
 * Este módulo guarda o estado que a trava (travaDoLogin.ts), o fetch
 * (fetchComPrazo.ts) e o storage da sessão compartilham:
 *
 * - "sem trava": a trava deixou uma leitura seguir sem ela (token ainda vale).
 *   Enquanto isso, nenhuma renovação sai deste navegador; o fetch recusa como
 *   falha de rede e o supabase-js tenta de novo depois, já com a trava.
 * - tokens mortos: refresh token que o servidor recusou não é reenviado, para
 *   não virar a rajada de "refresh_token_not_found" que vimos nos logs.
 * - proteção do storage: se o token que morreu não é mais o que está gravado
 *   (outra aba gravou um novo), o pedido de apagar a sessão é ignorado.
 */

import type { PreviewAuthStorage } from "./previewAuthStorage";

// ---------------------------------------------------------------- sem trava

/** Onde a operação sem trava estaria travada: nome da trava e storage da sessão. */
export type ContextoDaTrava = { nome: string; storage: PreviewAuthStorage | null | undefined };

const semTrava: ContextoDaTrava[] = [];

/** Há uma operação do login rodando sem a trava agora (só leitura permitida)? */
export function estaSemTrava(): boolean {
  return semTrava.length > 0;
}

/** Contexto da operação sem trava em curso, se houver. */
export function contextoSemTrava(): ContextoDaTrava | null {
  return semTrava.length ? semTrava[semTrava.length - 1] : null;
}

/**
 * Roda `fn` sem a trava, como LEITURA. Se algo ali dentro pedir renovação, o
 * fetch do login (fetchComPrazo.ts) não manda direto: espera a trava de
 * verdade e relê o storage antes (renovarDentroDaTrava).
 */
export async function rodarSemRenovar<R>(ctx: ContextoDaTrava, fn: () => Promise<R>): Promise<R> {
  semTrava.push(ctx);
  try {
    return await fn();
  } finally {
    const i = semTrava.lastIndexOf(ctx);
    if (i >= 0) semTrava.splice(i, 1);
  }
}

// ------------------------------------------------------------- tokens mortos

/** Códigos do servidor que dizem "esse refresh token não serve mais". */
export const CODIGOS_DE_TOKEN_MORTO = ["refresh_token_not_found", "refresh_token_already_used"];

const tokensMortos = new Set<string>();
let ultimaMorte: { token: string; quando: number } | null = null;

/** Quanto tempo depois da recusa a proteção do storage ainda vale. */
export const JANELA_DA_PROTECAO_MS = 30_000;

export function registrarTokenMorto(token: string): void {
  if (!token) return;
  tokensMortos.add(token);
  ultimaMorte = { token, quando: Date.now() };
}

export function tokenEstaMorto(token: string | null | undefined): boolean {
  return !!token && tokensMortos.has(token);
}

/** Saída de propósito (botão sair): a proteção do storage não pode segurar a sessão. */
export function esquecerTokensMortos(): void {
  tokensMortos.clear();
  ultimaMorte = null;
}

// --------------------------------------------------------- pedido de renovação

function urlDo(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return (input as Request).url || "";
}

function textoDoCorpo(init?: RequestInit): string {
  const corpo = init?.body;
  if (typeof corpo === "string") return corpo;
  if (typeof URLSearchParams !== "undefined" && corpo instanceof URLSearchParams) return corpo.toString();
  return "";
}

/**
 * É pedido de renovação do login? O supabase-js usa
 * /auth/v1/token?grant_type=refresh_token. O /auth/v1/oauth/token é do
 * servidor OAuth (conectores MCP); o painel não chama, mas se um dia chamar
 * com grant_type=refresh_token recebe o mesmo cuidado.
 */
export function ehPedidoDeRenovacao(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = urlDo(input);
  if (url.indexOf("/auth/v1/") < 0) return false;
  if (/\/auth\/v1\/token\b/.test(url) && /[?&]grant_type=refresh_token\b/.test(url)) return true;
  if (/\/auth\/v1\/oauth\/token\b/.test(url)) {
    return /[?&]grant_type=refresh_token\b/.test(url) || /grant_type["=:\s]*"?refresh_token/.test(textoDoCorpo(init));
  }
  return false;
}

/** Refresh token que vai no pedido (corpo JSON do supabase-js ou formulário OAuth). */
export function tokenDoPedido(init?: RequestInit): string {
  const texto = textoDoCorpo(init);
  if (!texto) return "";
  try {
    const json = JSON.parse(texto) as { refresh_token?: unknown };
    if (typeof json?.refresh_token === "string") return json.refresh_token;
  } catch {
    // não é JSON: tenta formulário
  }
  try {
    return new URLSearchParams(texto).get("refresh_token") || "";
  } catch {
    return "";
  }
}

/** Resposta igual à do servidor para token recusado, sem gastar rede. */
export function respostaDeTokenMorto(): Response {
  return new Response(
    JSON.stringify({
      code: 400,
      error_code: "refresh_token_not_found",
      msg: "Invalid Refresh Token: Refresh Token Not Found (já recusado neste navegador)",
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

/** Lê a resposta de renovação e marca o token se o servidor disse que ele morreu. */
export async function observarRespostaDeRenovacao(token: string, resposta: Response): Promise<void> {
  if (!token || resposta.status < 400 || resposta.status >= 500) return;
  try {
    const corpo = (await resposta.clone().json()) as { code?: unknown; error_code?: unknown };
    const codigo = typeof corpo?.error_code === "string" ? corpo.error_code : typeof corpo?.code === "string" ? corpo.code : "";
    if (CODIGOS_DE_TOKEN_MORTO.includes(codigo)) registrarTokenMorto(token);
  } catch {
    // corpo ilegível: não marca nada
  }
}

// ------------------------------------------------- renovação dentro da trava

/** Quanto a renovação pedida fora da trava espera a trava soltar antes de desistir (falha de rede). */
export const ESPERA_DA_RENOVACAO_MS = 20_000;

type Locks = {
  request: (nome: string, opcoes: Record<string, unknown>, fn: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
};

function respostaComSessao(sessao: SessaoGuardada): Response {
  const agora = Math.floor(Date.now() / 1000);
  return new Response(
    JSON.stringify({
      ...sessao,
      token_type: (sessao as { token_type?: string }).token_type || "bearer",
      expires_in: Math.max(1, (sessao.expires_at || agora) - agora),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function gravarSessaoDaResposta(storage: PreviewAuthStorage, chave: string, resposta: Response): Promise<void> {
  try {
    const dados = (await resposta.clone().json()) as SessaoGuardada & { expires_in?: number };
    if (!dados?.access_token || !dados?.refresh_token) return;
    const expires_at = dados.expires_at || (dados.expires_in ? Math.floor(Date.now() / 1000) + dados.expires_in : undefined);
    await storage.setItem(chave, JSON.stringify({ ...dados, expires_at }));
  } catch {
    // o supabase-js grava logo em seguida de qualquer jeito
  }
}

/**
 * Renovação pedida por uma operação que seguiu sem a trava: espera a trava de
 * verdade (no máximo ESPERA_DA_RENOVACAO_MS) e, já com ela:
 *  - se outra aba gravou um token novo e válido, devolve esse (não renova);
 *  - se outra aba gravou um token novo mas vencido, renova com ELE, não com o velho;
 *  - senão renova com o token do pedido.
 * Grava o par novo no storage ANTES de soltar a trava, para a próxima aba já
 * ler o token novo. Se a trava não soltar a tempo, falha como rede (o
 * supabase-js mantém a sessão e tenta de novo).
 */
export async function renovarDentroDaTrava(
  ctx: ContextoDaTrava,
  token: string,
  enviar: (tokenParaUsar: string) => Promise<Response>,
  esperaMs = ESPERA_DA_RENOVACAO_MS,
): Promise<Response> {
  const locks = (typeof navigator !== "undefined" ? (navigator as unknown as { locks?: Locks }).locks : undefined) || null;
  if (!locks || typeof locks.request !== "function" || typeof AbortController === "undefined") {
    throw new TypeError("Failed to fetch: renovação adiada até a trava do login soltar");
  }
  const chave = ctx.nome.replace(/^lock:/, "");
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), esperaMs);
  try {
    return (await locks.request(ctx.nome, { mode: "exclusive", signal: ctrl.signal }, async () => {
      clearTimeout(relogio);
      const atual = await lerSessaoGuardada(ctx.storage, chave);
      const outro = atual?.refresh_token && atual.refresh_token !== token && sessaoEstaViva(atual) ? atual : null;
      if (outro && tokenAindaVale(outro, 0)) return respostaComSessao(outro);
      const resposta = await enviar(outro?.refresh_token || token);
      if (resposta.ok && ctx.storage) await gravarSessaoDaResposta(ctx.storage, chave, resposta);
      return resposta;
    })) as Response;
  } catch (e) {
    if (e && (e as { name?: string }).name === "AbortError") {
      throw new TypeError("Failed to fetch: trava do login não soltou a tempo para renovar");
    }
    throw e;
  } finally {
    clearTimeout(relogio);
  }
}

// ----------------------------------------------------------- sessão guardada

export type SessaoGuardada = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id: string } & Record<string, unknown>;
};

/** Lê a sessão gravada no storage do login, sem passar pela trava (só leitura). */
export async function lerSessaoGuardada(
  storage: Pick<PreviewAuthStorage, "getItem"> | undefined | null,
  chave: string,
): Promise<SessaoGuardada | null> {
  try {
    const fonte = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!fonte || !chave) return null;
    const bruto = await fonte.getItem(chave);
    if (!bruto) return null;
    const sessao = JSON.parse(bruto) as SessaoGuardada;
    return sessao && typeof sessao === "object" ? sessao : null;
  } catch {
    return null;
  }
}

/** Sessão viva: tem refresh token que o servidor não recusou neste navegador. */
export function sessaoEstaViva(sessao: SessaoGuardada | null | undefined): boolean {
  return !!sessao?.refresh_token && !tokenEstaMorto(sessao.refresh_token);
}

/** O access token ainda vale por mais que `folgaMs`? */
export function tokenAindaVale(sessao: SessaoGuardada | null | undefined, folgaMs: number): boolean {
  return !!sessao?.expires_at && sessao.expires_at * 1000 - Date.now() > folgaMs;
}

/**
 * Storage do login com uma proteção: depois de um "refresh_token_not_found",
 * o supabase-js apaga a sessão guardada. Se o que está gravado já é OUTRO
 * token, vivo (outra aba renovou antes), apagar derrubaria todas as abas por
 * causa de um token velho. Nesse caso o pedido de apagar é ignorado.
 * Fora dessa janela (saída normal, botão sair) o storage apaga como sempre.
 */
export function protegerSessaoGuardada(storage: PreviewAuthStorage | undefined): PreviewAuthStorage | undefined {
  if (!storage) return storage;
  const protegido: PreviewAuthStorage = {
    getItem: (chave) => storage.getItem(chave),
    setItem: (chave, valor) => storage.setItem(chave, valor),
    removeItem: async (chave) => {
      const morte = ultimaMorte;
      if (morte && /-auth-token$/.test(chave) && Date.now() - morte.quando < JANELA_DA_PROTECAO_MS) {
        const atual = await lerSessaoGuardada(storage, chave);
        if (atual?.refresh_token && atual.refresh_token !== morte.token && sessaoEstaViva(atual)) {
          ultimaMorte = null;
          console.warn("[Auth] token recusado era velho; outra aba já gravou um novo. Sessão mantida.");
          return;
        }
      }
      await storage.removeItem(chave);
    },
  };
  return protegido;
}
