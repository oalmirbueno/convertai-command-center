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
 *   (outra aba gravou um novo), o pedido de apagar a sessão é ignorado. Vale
 *   para TODOS os pedidos de apagar dentro da janela: com autoRefreshToken o
 *   supabase-js apaga duas vezes seguidas (revisão do Codex, 14/11).
 * - renovação em voo: só uma por vez neste navegador. Se ela passa do prazo,
 *   quem espera é solto (falha de rede, ou o token que ainda vale) e o pedido
 *   continua em segundo plano, sem abort; quando a resposta chega, o par novo
 *   é gravado e o token velho nunca mais é enviado (revisão do Codex, 14/11).
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
  trocados.clear();
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

/** Sessão (com expires_at) a partir da resposta de renovação bem-sucedida. */
async function sessaoDaResposta(resposta: Response): Promise<SessaoGuardada | null> {
  try {
    const dados = (await resposta.clone().json()) as SessaoGuardada & { expires_in?: number };
    if (!dados?.access_token || !dados?.refresh_token) return null;
    const expires_at = dados.expires_at || (dados.expires_in ? Math.floor(Date.now() / 1000) + dados.expires_in : undefined);
    return { ...dados, expires_at };
  } catch {
    return null;
  }
}

async function gravarSessaoDaResposta(storage: PreviewAuthStorage, chave: string, resposta: Response): Promise<void> {
  const sessao = await sessaoDaResposta(resposta);
  if (!sessao) return; // o supabase-js grava logo em seguida de qualquer jeito
  try {
    await storage.setItem(chave, JSON.stringify(sessao));
  } catch {
    // idem
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

// --------------------------------------------------------- renovação em voo

/**
 * Quanto uma renovação pode ficar no ar antes de soltar quem espera por ela.
 * Mesma ordem da espera da trava (ESPERA_MAXIMA_MS, 8 s). O pedido NÃO é
 * abortado: só deixa de segurar a fila do supabase-js.
 */
export const PRAZO_PARA_SOLTAR_RENOVACAO_MS = 8_000;

/** Marca para as outras abas: renovação solta por prazo e ainda no ar. */
export const CHAVE_DA_MARCA_EM_VOO = "aceleriq-auth-renovacao-em-voo";
/** Validade da marca (se a aba que renovava fechar, as outras voltam a renovar). */
export const VALIDADE_DA_MARCA_MS = 60_000;
/** Enquanto o HTTP segue no ar, a marca é regravada neste intervalo para não expirar. */
export const INTERVALO_DA_MARCA_MS = 20_000;
/** Impressões de tokens já trocados, compartilhadas entre abas (nunca o token em si). */
export const CHAVE_DOS_TROCADOS = "aceleriq-auth-tokens-trocados";
/** Depois disso, a impressão some; se a aba morreu, as outras voltam a poder gravar. */
export const VALIDADE_DO_TROCADO_MS = 10 * 60 * 1000;
/** Trava só da renovação HTTP: fica presa até a resposta, mesmo depois de soltar a trava do login. */
export const NOME_DA_TRAVA_DE_RENOVACAO = "aceleriq-auth-renovacao-em-voo";
/** Folga mínima do access token para responder com ele sem ir ao servidor. */
const FOLGA_DO_TOKEN_MS = 10_000;

type Voo = { token: string; desde: number; fim: Promise<void>; soltou: boolean };
let vooAtual: Voo | null = null;

/** Token velho -> par novo que a renovação devolveu (neste navegador). */
const trocados = new Map<string, SessaoGuardada>();
const MAXIMO_DE_TROCAS = 20;

function registrarTroca(velho: string, nova: SessaoGuardada): void {
  if (!velho || !nova.refresh_token || velho === nova.refresh_token) return;
  trocados.delete(velho);
  trocados.set(velho, nova);
  while (trocados.size > MAXIMO_DE_TROCAS) trocados.delete(trocados.keys().next().value as string);
  registrarTrocaCompartilhada(velho);
}

export function tokenJaFoiTrocado(token: string | null | undefined): boolean {
  if (!token) return false;
  if (trocados.has(token)) return true;
  const imp = impressao(token);
  return lerTrocadosCompartilhados().some((item) => item.impressao === imp);
}

/** Par mais novo da corrente de trocas que começa em `token`. */
function sessaoQueSubstituiu(token: string): SessaoGuardada | null {
  let atual = trocados.get(token) || null;
  for (let passos = 0; atual?.refresh_token && trocados.has(atual.refresh_token) && passos < MAXIMO_DE_TROCAS; passos++) {
    atual = trocados.get(atual.refresh_token) || atual;
  }
  return atual;
}

function refreshTokenDoValor(valor: string): string {
  try {
    const v = JSON.parse(valor) as { refresh_token?: unknown };
    return typeof v?.refresh_token === "string" ? v.refresh_token : "";
  } catch {
    return "";
  }
}

/** Impressão curta do token (a marca entre abas não guarda o token). */
function impressao(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${token.length}`;
}

function localStorageOuNada(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

type LocksDoNavegador = {
  request: (
    nome: string,
    opcoes: Record<string, unknown>,
    fn: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};

function locksDoNavegador(): LocksDoNavegador | null {
  const locks = typeof navigator !== "undefined" ? (navigator as unknown as { locks?: LocksDoNavegador }).locks : undefined;
  return locks && typeof locks.request === "function" ? locks : null;
}

/** Outra aba (ou esta, em outro fluxo) ainda segura a trava da renovação HTTP? */
async function travaDeRenovacaoOcupada(): Promise<boolean> {
  const locks = locksDoNavegador();
  if (!locks) return false;
  let ocupada = false;
  await locks.request(NOME_DA_TRAVA_DE_RENOVACAO, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    ocupada = !lock;
  });
  return ocupada;
}

function sessaoDoValor(valor: string): SessaoGuardada | null {
  try {
    const v = JSON.parse(valor) as SessaoGuardada;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function marcarParaOutrasAbas(token: string): void {
  try {
    localStorageOuNada()?.setItem(CHAVE_DA_MARCA_EM_VOO, JSON.stringify({ impressao: impressao(token), ate: Date.now() + VALIDADE_DA_MARCA_MS }));
  } catch {
    // sem localStorage: só a proteção desta aba
  }
}

let pulsoDaMarca: ReturnType<typeof setInterval> | null = null;

function pararPulsoDaMarca(): void {
  if (pulsoDaMarca) {
    clearInterval(pulsoDaMarca);
    pulsoDaMarca = null;
  }
}

/** Regrava a marca enquanto o HTTP segue, para ela não expirar aos 60 s com o pedido ainda no ar. */
function iniciarPulsoDaMarca(token: string): void {
  pararPulsoDaMarca();
  marcarParaOutrasAbas(token);
  pulsoDaMarca = setInterval(() => marcarParaOutrasAbas(token), INTERVALO_DA_MARCA_MS);
}

function limparMarca(token: string): void {
  pararPulsoDaMarca();
  try {
    const ls = localStorageOuNada();
    const marca = ls?.getItem(CHAVE_DA_MARCA_EM_VOO);
    if (marca && (JSON.parse(marca) as { impressao?: string }).impressao === impressao(token)) ls?.removeItem(CHAVE_DA_MARCA_EM_VOO);
  } catch {
    // idem
  }
}

type ItemTrocado = { impressao: string; ate: number };

function lerTrocadosCompartilhados(): ItemTrocado[] {
  try {
    const bruto = localStorageOuNada()?.getItem(CHAVE_DOS_TROCADOS);
    if (!bruto) return [];
    const v = JSON.parse(bruto) as { itens?: { impressao?: unknown; ate?: unknown }[] };
    const agora = Date.now();
    return (Array.isArray(v?.itens) ? v.itens : []).filter(
      (item): item is ItemTrocado =>
        !!item && typeof item.impressao === "string" && typeof item.ate === "number" && item.ate > agora,
    );
  } catch {
    return [];
  }
}

function registrarTrocaCompartilhada(velho: string): void {
  try {
    const ls = localStorageOuNada();
    if (!ls || !velho) return;
    const imp = impressao(velho);
    const itens = lerTrocadosCompartilhados().filter((item) => item.impressao !== imp);
    itens.push({ impressao: imp, ate: Date.now() + VALIDADE_DO_TROCADO_MS });
    while (itens.length > MAXIMO_DE_TROCAS) itens.shift();
    ls.setItem(CHAVE_DOS_TROCADOS, JSON.stringify({ itens }));
  } catch {
    // sem localStorage: só o mapa desta aba
  }
}

/** Só para testes: esquece o mapa desta aba, mas deixa a lista compartilhada (simula outra aba). */
export function esquecerMapaDeTrocasParaTeste(): void {
  trocados.clear();
}

/** Outra aba soltou a trava com uma renovação deste mesmo token ainda no ar? */
export function outraAbaRenovando(token: string): boolean {
  try {
    const marca = localStorageOuNada()?.getItem(CHAVE_DA_MARCA_EM_VOO);
    if (!marca) return false;
    const m = JSON.parse(marca) as { impressao?: string; ate?: number };
    return m.impressao === impressao(token) && typeof m.ate === "number" && m.ate > Date.now();
  } catch {
    return false;
  }
}

/** Há uma renovação no ar neste navegador agora? */
export function haRenovacaoEmVoo(): boolean {
  return !!vooAtual;
}

/** Só para testes: esquece a renovação em voo (o pedido em si segue como estiver). */
export function esquecerRenovacaoEmVooParaTeste(): void {
  pararPulsoDaMarca();
  vooAtual = null;
  trocados.clear();
  try {
    const ls = localStorageOuNada();
    ls?.removeItem(CHAVE_DA_MARCA_EM_VOO);
    ls?.removeItem(CHAVE_DOS_TROCADOS);
  } catch {
    // idem
  }
}

async function gravarSeAindaForOVelho(storage: PreviewAuthStorage | null | undefined, chave: string, velho: string, nova: SessaoGuardada): Promise<void> {
  const fonte = storage || localStorageOuNada();
  if (!fonte || !chave) return;
  try {
    const atual = await lerSessaoGuardada(fonte, chave);
    // Só troca se o gravado ainda é o token que foi enviado. Sem sessão (saiu)
    // ou com outro token (outra aba renovou), não mexe.
    if (atual?.refresh_token === velho) await fonte.setItem(chave, JSON.stringify(nova));
  } catch {
    // a próxima renovação do supabase-js recebe o par novo de qualquer jeito (sessaoQueSubstituiu)
  }
}

/**
 * Enquanto outra renovação está no ar: nada de segundo pedido. Se o access
 * token gravado ainda vale, devolve a sessão gravada (sem rede) para o
 * supabase-js soltar a fila e o envio seguir com ela. Senão, falha como rede
 * (o supabase-js mantém a sessão e tenta de novo depois).
 */
async function responderSemRede(storage: PreviewAuthStorage | null | undefined, chave: string): Promise<Response> {
  const atual = await lerSessaoGuardada(storage, chave);
  if (atual?.access_token && sessaoEstaViva(atual) && !tokenJaFoiTrocado(atual.refresh_token) && tokenAindaVale(atual, FOLGA_DO_TOKEN_MS)) {
    return respostaComSessao(atual);
  }
  throw new TypeError("Failed to fetch: renovação anterior ainda no ar; tenta de novo depois");
}

export type PedidoDeRenovacao = {
  token: string;
  /** Manda o POST de verdade (sem prazo e sem sinal de abort). */
  mandar: (token: string) => Promise<Response>;
  storage?: PreviewAuthStorage | null;
  chave: string;
  /** Prazo para soltar quem espera; 0 ou menos = espera a resposta. */
  soltarEmMs?: number;
};

/**
 * Renovação sem duplicar e sem prender a aba:
 *  - token recusado: resposta local de token morto;
 *  - token já trocado neste navegador: devolve o par novo, sem rede;
 *  - outra renovação no ar (esta aba): espera ela até o prazo e decide de
 *    novo; passou do prazo, responde sem rede (responderSemRede);
 *  - outra aba soltou a trava com este token no ar (marca ou trava HTTP): responde sem rede;
 *  - senão manda, segurando a trava da renovação até o HTTP terminar (não depende do pulso);
 *    se passar do prazo, solta quem espera com falha de rede e
 *    o pedido continua; quando a resposta chegar, grava o par novo (se o
 *    storage ainda tiver o token velho) e registra a troca.
 */
export async function renovarSemDuplicar(p: PedidoDeRenovacao): Promise<Response> {
  const prazo = p.soltarEmMs ?? PRAZO_PARA_SOLTAR_RENOVACAO_MS;
  for (;;) {
    if (tokenEstaMorto(p.token)) return respostaDeTokenMorto();
    const nova = sessaoQueSubstituiu(p.token);
    if (nova) return respostaComSessao(nova);
    const voo = vooAtual;
    if (voo) {
      const restante = prazo > 0 ? voo.desde + prazo - Date.now() : Infinity;
      if (restante > 0) {
        let relogio: ReturnType<typeof setTimeout> | undefined;
        const terminou = await Promise.race([
          voo.fim.then(() => true),
          new Promise<boolean>((ok) => {
            if (restante !== Infinity) relogio = setTimeout(() => ok(false), restante);
          }),
        ]);
        if (relogio) clearTimeout(relogio);
        if (terminou) continue;
      }
      return responderSemRede(p.storage, p.chave);
    }
    if (outraAbaRenovando(p.token) || (await travaDeRenovacaoOcupada())) return responderSemRede(p.storage, p.chave);
    // Depois do await, outra renovação desta aba pode ter começado.
    if (vooAtual) continue;
    return enviarUmaRenovacao(p, prazo);
  }
}

function enviarUmaRenovacao(p: PedidoDeRenovacao, prazo: number): Promise<Response> {
  let terminar: () => void = () => undefined;
  const voo: Voo = { token: p.token, desde: Date.now(), fim: new Promise<void>((ok) => (terminar = ok)), soltou: false };
  vooAtual = voo;
  const observarEGravar = async (resposta: Response) => {
    await observarRespostaDeRenovacao(p.token, resposta);
    if (resposta.ok) {
      const nova = await sessaoDaResposta(resposta);
      if (nova) {
        registrarTroca(p.token, nova);
        if (voo.soltou) await gravarSeAindaForOVelho(p.storage, p.chave, p.token, nova);
      }
    }
    return resposta;
  };

  const mandarComTrava = async (): Promise<Response | "ocupada"> => {
    const locks = locksDoNavegador();
    const mandar = () => p.mandar(p.token).then(observarEGravar);
    if (!locks) return mandar();
    // Segura a trava até o HTTP terminar (mesmo depois de soltar a trava do login e com a aba suspensa, sem pulso).
    const resultado = await locks.request(
      NOME_DA_TRAVA_DE_RENOVACAO,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return "ocupada" as const;
        return mandar();
      },
    );
    return (resultado as Response | "ocupada" | undefined) ?? "ocupada";
  };

  const pedido = Promise.resolve()
    .then(mandarComTrava)
    .then((resposta) => {
      if (resposta === "ocupada") return responderSemRede(p.storage, p.chave);
      return resposta;
    })
    .finally(() => {
      if (vooAtual === voo) vooAtual = null;
      if (voo.soltou) limparMarca(p.token);
      terminar();
    });
  if (!(prazo > 0)) return pedido;
  return new Promise<Response>((ok, falha) => {
    const relogio = setTimeout(() => {
      voo.soltou = true;
      iniciarPulsoDaMarca(p.token);
      console.warn("[Auth] renovação no ar há mais que o prazo; segue em segundo plano e a aba usa o token que ainda vale.");
      falha(new TypeError("Failed to fetch: renovação demorando; segue em segundo plano"));
    }, prazo);
    pedido.then(
      (r) => {
        clearTimeout(relogio);
        ok(r);
      },
      (e) => {
        clearTimeout(relogio);
        falha(e);
      },
    );
  });
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
 * Storage do login com duas proteções:
 *  - depois de um "refresh_token_not_found", o supabase-js apaga a sessão
 *    guardada (com autoRefreshToken, duas vezes seguidas). Se o que está
 *    gravado já é OUTRO token, vivo (outra aba renovou antes), apagar
 *    derrubaria todas as abas por causa de um token velho. Enquanto a janela
 *    (JANELA_DA_PROTECAO_MS) valer, todos esses pedidos são ignorados. Apaga de
 *    verdade se o gravado for o próprio token morto, se a janela passou ou se
 *    for saída de propósito (esquecerTokensMortos, botão sair);
 *  - nunca volta a gravar um refresh token que este navegador já viu ser
 *    trocado por um novo (resposta atrasada ou outra aba gravou o par novo).
 *    A lista de impressões é compartilhada no localStorage, para a aba que
 *    recebeu a sessão antiga sem rede não sobrescrever o par novo.
 */
export function protegerSessaoGuardada(storage: PreviewAuthStorage | undefined): PreviewAuthStorage | undefined {
  if (!storage) return storage;
  let filaDeGravacao: Promise<unknown> = Promise.resolve();
  const enfileirar = <T,>(trabalho: () => Promise<T>): Promise<T> => {
    const vez = filaDeGravacao.then(trabalho, trabalho);
    filaDeGravacao = vez.catch(() => undefined);
    return vez;
  };
  const protegido: PreviewAuthStorage = {
    getItem: (chave) => storage.getItem(chave),
    setItem: (chave, valor) => enfileirar(async () => {
      if (/-auth-token$/.test(chave)) {
        const nova = sessaoDoValor(valor);
        const tokenNovo = nova?.refresh_token || refreshTokenDoValor(valor);
        if (tokenJaFoiTrocado(tokenNovo)) {
          console.warn("[Auth] gravação de token já trocado ignorada; o par novo continua no storage.");
          return;
        }
        const atual = await lerSessaoGuardada(storage, chave);
        if (
          atual?.refresh_token &&
          tokenNovo &&
          atual.refresh_token !== tokenNovo &&
          sessaoEstaViva(atual) &&
          typeof nova?.expires_at === "number" &&
          typeof atual.expires_at === "number" &&
          nova.expires_at < atual.expires_at
        ) {
          console.warn("[Auth] par velho não sobrescreve a sessão mais nova no storage.");
          return;
        }
      }
      return storage.setItem(chave, valor);
    }),
    removeItem: async (chave) => {
      const morte = ultimaMorte;
      if (morte && /-auth-token$/.test(chave) && Date.now() - morte.quando < JANELA_DA_PROTECAO_MS) {
        const atual = await lerSessaoGuardada(storage, chave);
        if (atual?.refresh_token && atual.refresh_token !== morte.token && sessaoEstaViva(atual)) {
          // NÃO zera ultimaMorte: o supabase-js pede para apagar de novo logo em
          // seguida (_callRefreshToken e depois _recoverAndRefresh). Todas as
          // remoções da janela são ignoradas enquanto o gravado for outro e vivo.
          console.warn("[Auth] token recusado era velho; outra aba já gravou um novo. Sessão mantida.");
          return;
        }
      }
      await storage.removeItem(chave);
    },
  };
  return protegido;
}
