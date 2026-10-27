/**
 * meta-usuario-do-sistema (27/10/2026): Configurações › Meta pelo usuário do sistema.
 * Só o admin, pela sessão. O token nunca volta para o navegador, nunca vai
 * para log nem para mensagem de erro: entra no POST "guardar", passa pelo
 * debug_token e vai direto para o Vault (meta_usuario_do_sistema_guardar).
 *
 * POST { acao: "estado" }
 *   -> o que está guardado (ids, escopos, prazos) e os últimos lotes aplicados.
 * POST { acao: "guardar", token }
 *   -> confere (debug_token: válido, nosso app, SYSTEM_USER, sem prazo,
 *      permissões) e só então guarda. Recusado, não grava nada.
 * POST { acao: "conferir" }
 *   -> debug_token do token guardado e as páginas que ele enxerga
 *      (/me/accounts, /{bm}/owned_pages e /{bm}/client_pages), com o
 *      instagram_business_account de cada uma.
 * POST { acao: "casar" }
 *   -> prévia: cada perfil/página do painel, se o token acha, se a conexão
 *      atual vence e quando.
 * POST { acao: "aplicar", external_account_ids? }
 *   -> para as contas casadas (ou só as escolhidas), concessão nova
 *      "usuario_do_sistema" sem prazo e o token de página no Vault
 *      (meta_usuario_do_sistema_aplicar). Devolve o lote_id para desfazer.
 * POST { acao: "desfazer", lote_id?, external_account_ids? }
 *   -> volta as contas para a concessão anterior (se ela ainda vale).
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import {
  BM_ACELERIQ,
  casarContas,
  conferirDebugToken,
  type ConferenciaDoToken,
  type ContaDoPainel,
  contasParaAplicar,
  formatoDoToken,
  juntarPaginas,
  type OrigemDaPagina,
  type PaginaDoToken,
  paginaSemToken,
} from "./regras.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPO_DA_META_MS = 20_000;
const MAX_RESPOSTA_DA_META = 1024 * 1024;
const MAX_CORPO = 32 * 1024;

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra?: Record<string, unknown>) {
    super(mensagem);
  }
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

async function identificarAdmin(req: Request): Promise<string> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(jwt);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const admin = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (admin.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (admin.data !== true) throw new ErroHttp(403, "somente_admin", "Só o admin mexe no token do usuário do sistema.");
  return userId;
}

interface ConfigDaMeta {
  appId: string;
  appSecret: string;
  graphVersion: string;
}

function configDaMeta(): ConfigDaMeta {
  const appId = (Deno.env.get("META_APP_ID") || "").trim();
  const appSecret = (Deno.env.get("META_APP_SECRET") || "").trim();
  const graphVersion = (Deno.env.get("META_GRAPH_VERSION") || "v26.0").trim();
  if (!appId || !appSecret || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new ErroHttp(503, "meta_nao_configurada", "A conexão com a Meta ainda não está configurada no servidor.");
  }
  return { appId, appSecret, graphVersion };
}

async function provaDoSegredo(token: string, segredo: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(token));
  return Array.from(new Uint8Array(assinatura)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Registro = Record<string, unknown>;
const registro = (v: unknown): Registro | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : null;

/**
 * GET na Graph com o token no cabeçalho e appsecret_proof. Erro da Meta vira
 * só o código numérico: o corpo pode ecoar parâmetros e nunca é repassado.
 */
async function graph(cfg: ConfigDaMeta, caminho: string, token: string, params: Record<string, string> = {}): Promise<Registro> {
  const url = new URL(`https://graph.facebook.com/${cfg.graphVersion}/${caminho.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("appsecret_proof", await provaDoSegredo(token, cfg.appSecret));
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_DA_META_MS);
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: controle.signal,
    });
  } catch {
    throw new ErroHttp(502, "meta_indisponivel", "Não foi possível falar com a Meta agora. Tente de novo.");
  } finally {
    clearTimeout(relogio);
  }
  const texto = await resposta.text();
  if (new TextEncoder().encode(texto).byteLength > MAX_RESPOSTA_DA_META) {
    throw new ErroHttp(502, "meta_resposta_invalida", "A Meta devolveu uma resposta grande demais.");
  }
  let corpo: Registro | null = null;
  try {
    corpo = registro(JSON.parse(texto));
  } catch {
    corpo = null;
  }
  if (!resposta.ok || !corpo) {
    const erro = registro(corpo?.error);
    const codigo = typeof erro?.code === "number" ? erro.code : null;
    throw new ErroHttp(
      resposta.status === 400 || resposta.status === 401 || resposta.status === 403 ? 422 : 502,
      "meta_recusou",
      codigo === 190
        ? "A Meta recusou o token (código 190): ele foi revogado ou não vale mais."
        : `A Meta recusou a consulta${codigo ? ` (código ${codigo})` : ""}.`,
      { codigo_da_meta: codigo },
    );
  }
  return corpo;
}

async function debugToken(cfg: ConfigDaMeta, token: string): Promise<ConferenciaDoToken> {
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const corpo = await graph(cfg, "debug_token", appToken, { input_token: token });
  return conferirDebugToken(corpo.data, cfg.appId);
}

async function listaPaginada(cfg: ConfigDaMeta, caminho: string, token: string): Promise<unknown[]> {
  const saida: unknown[] = [];
  let after = "";
  for (let pagina = 0; pagina < 10 && saida.length < 1000; pagina++) {
    const corpo = await graph(cfg, caminho, token, {
      fields: "id,name,access_token,instagram_business_account{id,username,name}",
      limit: "100",
      ...(after ? { after } : {}),
    });
    if (Array.isArray(corpo.data)) saida.push(...corpo.data);
    const paging = registro(corpo.paging);
    const proximo = registro(paging?.cursors)?.after;
    if (typeof proximo !== "string" || !proximo || proximo === after || !paging?.next) break;
    after = proximo;
  }
  return saida;
}

async function carregarPaginas(cfg: ConfigDaMeta, token: string, businessId: string): Promise<{ paginas: PaginaDoToken[]; avisos: string[] }> {
  const avisos: string[] = [];
  const listas: Array<{ origem: OrigemDaPagina; paginas: unknown[] }> = [];
  listas.push({ origem: "me_accounts", paginas: await listaPaginada(cfg, "me/accounts", token) });
  for (const [origem, caminho] of [["owned_pages", `${businessId}/owned_pages`], ["client_pages", `${businessId}/client_pages`]] as const) {
    try {
      listas.push({ origem, paginas: await listaPaginada(cfg, caminho, token) });
    } catch (e) {
      const codigo = e instanceof ErroHttp ? e.extra?.codigo_da_meta : null;
      avisos.push(`Não deu para ler ${origem} da BM${codigo ? ` (código ${codigo})` : ""}; seguem só as páginas atribuídas ao usuário do sistema.`);
    }
  }
  const paginas = juntarPaginas(listas);
  // Página vista pela BM sem token na lista: pede o token da página direto.
  let pedidas = 0;
  for (const p of paginas) {
    if (p.token || pedidas >= 100) continue;
    pedidas += 1;
    try {
      const corpo = await graph(cfg, p.pageId, token, { fields: "access_token" });
      const t = corpo.access_token;
      if (typeof t === "string" && t.length >= 16 && t.length <= 8192) p.token = t;
    } catch {
      /* sem token de página: a prévia marca "sem_token_de_pagina" */
    }
  }
  return { paginas, avisos };
}

async function rpc<T = unknown>(nome: string, args: Record<string, unknown>, mensagem: string): Promise<T> {
  const { data, error } = await servico().rpc(nome, args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new ErroHttp(503, "migration_ausente", "O banco ainda não tem a migration do usuário do sistema (20261027235000).");
    }
    throw new ErroHttp(422, "banco_recusou", mensagem, { codigo_do_banco: error.code || "desconhecido" });
  }
  return data as T;
}

interface TokenGuardado {
  access_token: string;
  meta_user_id: string;
  app_id: string;
  business_id: string | null;
}

async function tokenGuardado(): Promise<TokenGuardado> {
  const linhas = await rpc<TokenGuardado[] | null>("meta_usuario_do_sistema_token", {}, "Não foi possível ler o token guardado.");
  const linha = Array.isArray(linhas) ? linhas[0] : null;
  if (!linha?.access_token) throw new ErroHttp(409, "sem_token", "Ainda não há token do usuário do sistema guardado.");
  return linha;
}

/** Conferência para a tela: tudo menos o token. */
function conferenciaPublica(c: ConferenciaDoToken) {
  return {
    valido: c.valido,
    tipo: c.tipo,
    usuario_do_sistema: c.usuarioDoSistema,
    app_id: c.appId,
    app_confere: c.appConfere,
    meta_user_id: c.metaUserId,
    expira_em: c.expiraEm,
    acesso_aos_dados_expira_em: c.acessoAosDadosExpiraEm,
    nunca_vence: c.nuncaVence,
    escopos: c.escopos,
    faltando: c.faltando,
    recomendados_faltando: c.recomendadosFaltando,
    aprovado: c.aprovado,
    problemas: c.problemas,
  };
}

async function lerCorpo(req: Request): Promise<Registro> {
  const texto = await req.text();
  if (texto.length > MAX_CORPO) throw new ErroHttp(413, "corpo_grande", "Requisição muito grande.");
  try {
    const corpo = registro(JSON.parse(texto || "{}"));
    if (corpo) return corpo;
  } catch {
    /* cai no erro abaixo */
  }
  throw new ErroHttp(400, "corpo_invalido", "Dados inválidos.");
}

function idsEscolhidos(valor: unknown): string[] | null {
  if (valor == null) return null;
  if (!Array.isArray(valor) || valor.length > 200) throw new ErroHttp(400, "contas_invalidas", "Lista de contas inválida.");
  const ids = valor.filter((v): v is string => typeof v === "string" && UUID.test(v));
  if (ids.length !== valor.length) throw new ErroHttp(400, "contas_invalidas", "Lista de contas inválida.");
  return ids;
}

async function prepararCasamento(cfg: ConfigDaMeta) {
  const guardado = await tokenGuardado();
  const conferencia = await debugToken(cfg, guardado.access_token);
  if (!conferencia.aprovado) {
    throw new ErroHttp(422, "token_recusado", "O token guardado não passa na conferência.", { conferencia: conferenciaPublica(conferencia) });
  }
  const { paginas, avisos } = await carregarPaginas(cfg, guardado.access_token, guardado.business_id || BM_ACELERIQ);
  const contas = await rpc<ContaDoPainel[]>("meta_usuario_do_sistema_contas", {}, "Não foi possível ler as contas do painel.");
  const itens = casarContas(paginas, Array.isArray(contas) ? contas : []);
  return { guardado, conferencia, paginas, avisos, contas: Array.isArray(contas) ? contas : [], itens };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo", mensagem: "Use POST." }, 405);
  let acao = "";
  try {
    const userId = await identificarAdmin(req);
    const corpo = await lerCorpo(req);
    acao = typeof corpo.acao === "string" ? corpo.acao : "";

    if (acao === "estado") {
      return json({ estado: await rpc("meta_usuario_do_sistema_estado", {}, "Não foi possível ler o estado.") });
    }

    const cfg = configDaMeta();

    if (acao === "guardar") {
      const token = formatoDoToken(corpo.token);
      if (!token) throw new ErroHttp(400, "token_invalido", "Cole o token inteiro, sem espaços.");
      const conferencia = await debugToken(cfg, token);
      if (!conferencia.aprovado || !conferencia.metaUserId || !conferencia.appId) {
        return json({ guardado: false, conferencia: conferenciaPublica(conferencia) }, 422);
      }
      await rpc("meta_usuario_do_sistema_guardar", {
        _actor_id: userId,
        _token: token,
        _meta_user_id: conferencia.metaUserId,
        _app_id: conferencia.appId,
        _business_id: BM_ACELERIQ,
        _escopos: conferencia.escopos,
        _token_expira_em: conferencia.expiraEm,
        _acesso_aos_dados_expira_em: conferencia.acessoAosDadosExpiraEm,
      }, "Não foi possível guardar o token.");
      return json({
        guardado: true,
        conferencia: conferenciaPublica(conferencia),
        estado: await rpc("meta_usuario_do_sistema_estado", {}, "Não foi possível ler o estado."),
      });
    }

    if (acao === "conferir") {
      const guardado = await tokenGuardado();
      const conferencia = await debugToken(cfg, guardado.access_token);
      const { paginas, avisos } = conferencia.valido
        ? await carregarPaginas(cfg, guardado.access_token, guardado.business_id || BM_ACELERIQ)
        : { paginas: [] as PaginaDoToken[], avisos: [] as string[] };
      if (conferencia.valido) {
        await rpc("meta_usuario_do_sistema_marcar_conferido", { _escopos: conferencia.escopos }, "Não foi possível marcar a conferência.");
      }
      return json({ conferencia: conferenciaPublica(conferencia), paginas: paginas.map(paginaSemToken), avisos });
    }

    if (acao === "casar") {
      const { conferencia, itens, avisos } = await prepararCasamento(cfg);
      return json({
        conferencia: conferenciaPublica(conferencia),
        itens,
        resumo: {
          contas: itens.length,
          casadas: itens.filter((i) => i.pode_aplicar).length,
          ja_no_usuario_do_sistema: itens.filter((i) => i.motivo === "ja_no_usuario_do_sistema").length,
          nao_encontradas: itens.filter((i) => i.motivo === "nao_encontrada").length,
        },
        avisos,
      });
    }

    if (acao === "aplicar") {
      const escolhidas = idsEscolhidos(corpo.external_account_ids);
      const { conferencia, paginas, contas, itens } = await prepararCasamento(cfg);
      const lote = contasParaAplicar(itens, paginas, contas, escolhidas);
      if (!lote.length) throw new ErroHttp(409, "nada_para_aplicar", "Nenhuma conta casada para aplicar.");
      const resultado = await rpc("meta_usuario_do_sistema_aplicar", {
        _actor_id: userId,
        _contas: lote,
        _graph_version: cfg.graphVersion,
        _escopos: conferencia.escopos,
      }, "O banco não aceitou aplicar o usuário do sistema.");
      return json({ resultado });
    }

    if (acao === "desfazer") {
      const loteId = typeof corpo.lote_id === "string" && UUID.test(corpo.lote_id) ? corpo.lote_id : null;
      const contas = idsEscolhidos(corpo.external_account_ids);
      if (!loteId && !(contas && contas.length)) throw new ErroHttp(400, "nada_para_desfazer", "Diga o lote ou as contas para desfazer.");
      const resultado = await rpc("meta_usuario_do_sistema_desfazer", {
        _actor_id: userId,
        _lote_id: loteId,
        _external_account_ids: contas && contas.length ? contas : null,
      }, "O banco não aceitou desfazer.");
      return json({ resultado });
    }

    throw new ErroHttp(400, "acao_invalida", "Ação inválida.");
  } catch (e) {
    const erro = e instanceof ErroHttp ? e : new ErroHttp(500, "erro_interno", "Erro interno.");
    // Só ação e código: nada de token, corpo da Meta ou mensagem do banco.
    console.error("meta-usuario-do-sistema", JSON.stringify({ acao, codigo: erro.codigo, status: erro.status }));
    return json({ error: erro.codigo, mensagem: erro.message, ...(erro.extra || {}) }, erro.status);
  }
});
