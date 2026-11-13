/**
 * API do CRM da empresa (13/11/2026). verify_jwt = false: quem chama é o site, a automação ou o
 * assistente do cliente, com uma chave de API criada em Conta, Conexões (tabela produto_chaves_api;
 * no banco fica só o resumo sha256 da chave).
 *
 * REST (cabeçalho Authorization: Bearer acq_... ou x-api-key):
 *   GET    /v1/eu                         a empresa, o plano e as etapas do funil
 *   GET    /v1/funil                      negócios e valor por etapa
 *   GET    /v1/negocios                   ?etapa= &busca= &abertos=true &limite= &pagina=
 *   POST   /v1/negocios                   { nome, empresa?, email?, whatsapp?, etapa?, valor_mensal?, ... }
 *   GET    /v1/negocios/:id
 *   PATCH  /v1/negocios/:id               só o que for enviado muda; etapa move (perdido pede motivo)
 *   POST   /v1/negocios/:id/notas         { texto }
 *   GET    /v1/empresas                   ?busca= &limite=
 *   GET    /v1/compromissos               ?negocio_id= &todos=true
 *   POST   /v1/compromissos               { negocio_id, titulo, quando, tipo?, notas? }
 *   POST   /v1/compromissos/:id/concluir
 *
 * MCP (Claude, ChatGPT): POST /mcp com a chave no cabeçalho, ou POST /mcp/<chave> para os conectores
 * que só aceitam um endereço. As ferramentas chamam as mesmas operações do REST.
 *
 * Cada chave pode fazer 120 chamadas por minuto. Tudo é filtrado pela empresa da chave.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { criarOperacoes, ErroDaApi, type Operacoes } from "./modulos/operacoes.ts";
import { responderMcp } from "./modulos/mcp.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, mcp-protocol-version, mcp-session-id, accept",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

const FORMATO_DA_CHAVE = /^acq_[0-9a-f]{64}$/;

async function resumoDaChave(chave: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chave));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 120 chamadas por minuto por chave, contadas na memória desta instância. */
const LIMITE_POR_MINUTO = 120;
const janelas = new Map<string, { inicio: number; quantas: number }>();
export function dentroDoLimite(id: string, agora = Date.now()): boolean {
  const j = janelas.get(id);
  if (!j || agora - j.inicio >= 60_000) {
    if (janelas.size > 5000) janelas.clear();
    janelas.set(id, { inicio: agora, quantas: 1 });
    return true;
  }
  j.quantas += 1;
  return j.quantas <= LIMITE_POR_MINUTO;
}

interface Acesso {
  operacoes: Operacoes;
  empresa: string;
  chaveId: string;
}

async function autenticar(chave: string): Promise<Acesso> {
  if (!FORMATO_DA_CHAVE.test(chave)) throw new ErroDaApi(401, "chave_invalida", "Chave de API ausente ou inválida. Crie uma em Conta, Conexões.");
  const { data, error } = await servico().rpc("produto_chave_usar", { _hash: await resumoDaChave(chave) });
  if (error) throw new ErroDaApi(503, "indisponivel", "Não foi possível conferir a chave agora. Tente de novo.");
  const r = (data || {}) as { ok?: boolean; motivo?: string; conta_id?: string; conta?: string; chave_id?: string; criado_por?: string | null; etapas?: Record<string, string> };
  if (!r.ok || !r.conta_id) {
    if (r.motivo === "conta_bloqueada") throw new ErroDaApi(402, "conta_bloqueada", "O acesso da empresa ao CRM não está liberado. Veja a assinatura.");
    throw new ErroDaApi(401, "chave_invalida", "Chave de API inválida ou revogada.");
  }
  if (!dentroDoLimite(String(r.chave_id))) throw new ErroDaApi(429, "muitas_chamadas", "Muitas chamadas em pouco tempo. Espere um minuto.");
  return {
    operacoes: criarOperacoes(servico(), { contaId: r.conta_id, autor: r.criado_por || null, etapas: r.etapas || {} }),
    empresa: r.conta || "",
    chaveId: String(r.chave_id),
  };
}

function chaveDoCabecalho(req: Request): string {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return bearer || (req.headers.get("x-api-key") || "").trim();
}

async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  const bruto = await req.text();
  if (bruto.length > 64_000) throw new ErroDaApi(413, "corpo_grande", "O pedido é grande demais.");
  if (!bruto.trim()) return {};
  try {
    const v = JSON.parse(bruto);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* cai no erro abaixo */
  }
  throw new ErroDaApi(400, "json_invalido", "O corpo precisa ser um objeto JSON.");
}

async function rest(req: Request, partes: string[], busca: URLSearchParams): Promise<Response> {
  const { operacoes: o } = await autenticar(chaveDoCabecalho(req));
  const filtros: Record<string, unknown> = {};
  busca.forEach((v, k) => {
    filtros[k] = v;
  });
  const [recurso, id, acao] = partes;
  const m = req.method;
  if (recurso === "eu" && m === "GET") return json(await o.eu());
  if (recurso === "funil" && m === "GET") return json(await o.resumoDoFunil());
  if (recurso === "empresas" && m === "GET") return json(await o.listarEmpresas(filtros));
  if (recurso === "negocios") {
    if (!id && m === "GET") return json(await o.listarNegocios(filtros));
    if (!id && m === "POST") {
      const r = await o.criarNegocio(await corpoJson(req));
      return json(r, r.repetido ? 200 : 201);
    }
    if (id && !acao && m === "GET") return json(await o.lerNegocio({ id }));
    if (id && !acao && m === "PATCH") return json(await o.atualizarNegocio({ ...(await corpoJson(req)), id }));
    if (id && acao === "notas" && m === "POST") return json(await o.anotar({ ...(await corpoJson(req)), id }), 201);
  }
  if (recurso === "compromissos") {
    if (!id && m === "GET") return json(await o.listarCompromissos(filtros));
    if (!id && m === "POST") return json(await o.criarCompromisso(await corpoJson(req)), 201);
    if (id && acao === "concluir" && m === "POST") return json(await o.concluirCompromisso({ id }));
  }
  throw new ErroDaApi(404, "rota_inexistente", "Esse endereço não existe na API. Veja a lista em Conta, Conexões.");
}

async function mcp(req: Request, chaveDoEndereco: string | undefined): Promise<Response> {
  if (req.method === "GET") return json({ error: "use_post", mensagem: "Esta porta responde a POST (MCP por HTTP)." }, 405, { Allow: "POST" });
  if (req.method !== "POST") return json({ error: "metodo" }, 405, { Allow: "POST" });
  let acesso: Acesso;
  try {
    acesso = await autenticar(chaveDoEndereco || chaveDoCabecalho(req));
  } catch (e) {
    const err = e instanceof ErroDaApi ? e : new ErroDaApi(500, "erro", "Falha inesperada.");
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: err.message } }, err.status);
  }
  let pedido: unknown;
  try {
    pedido = JSON.parse(await req.text());
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } }, 400);
  }
  if (Array.isArray(pedido)) {
    const respostas = (await Promise.all(pedido.slice(0, 20).map((p) => responderMcp(p, acesso.operacoes, acesso.empresa)))).filter(Boolean);
    return respostas.length ? json(respostas) : new Response(null, { status: 202, headers: corsHeaders });
  }
  const r = await responderMcp(pedido as Record<string, unknown>, acesso.operacoes, acesso.empresa);
  return r ? json(r) : new Response(null, { status: 202, headers: corsHeaders });
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(req.url);
    // O caminho chega como /produto-api/... (ou /functions/v1/produto-api/...).
    const depois = url.pathname.split("/produto-api")[1] || "";
    const partes = depois.split("/").filter(Boolean);
    try {
      if (partes[0] === "mcp") return await mcp(req, partes[1]);
      if (partes[0] === "v1") return await rest(req, partes.slice(1), url.searchParams);
      if (!partes.length) return json({ api: "Aceleriq CRM", versao: "v1", documentacao: "Conta, Conexões, dentro do produto." });
      throw new ErroDaApi(404, "rota_inexistente", "Esse endereço não existe na API.");
    } catch (e) {
      if (e instanceof ErroDaApi) return json({ error: e.codigo, mensagem: e.message }, e.status);
      console.error("[produto-api] erro inesperado", e instanceof Error ? e.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
