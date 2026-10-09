/**
 * navegador-remoto (Central de Autonomia, 09/10/2026, lote C).
 *
 * Um navegador de verdade, fora do computador do dono, que a Central mostra
 * ao vivo (Browserbase: sessão + Live View embutível com controle humano).
 *
 * - Um contexto por cliente (cookies e login cifrados no provedor), nunca
 *   compartilhado: o login de um cliente não aparece no navegador de outro.
 * - Senha não passa pelo painel: o dono entra no site dentro da sessão.
 * - Toda sessão aberta fica registrada (navegador_sessoes) com origem e
 *   pedido; "a página está aberta" só vale com sessão verificável no provedor.
 * - Sem BROWSERBASE_API_KEY: configurado = false (BROWSERBASE_PROJECT_ID é opcional; sem ele o
 *   provedor infere o projeto pela chave),
 *   nada é simulado.
 * Só admin.
 *
 * Ações: estado · abrir { cliente_id, url? (só anotado), origem?, pedido? } ·
 * ver { sessao_id } · listar { cliente_id? } · encerrar { sessao_id }
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ErroDoProvedor, provedorBrowserbase, type Provedor } from "./provedor.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", ...PREFLIGHT_CACHE };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error { constructor(public status: number, public codigo: string, m: string) { super(m); } }

let svc: SupabaseClient | null = null;
const servico = () => (svc ||= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } }));

async function identificar(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data } = token ? await servico().auth.getUser(token) : { data: null };
  const id = data?.user?.id;
  if (!id) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const r = await servico().rpc("has_role", { _user_id: id, _role: "admin" });
  if (r.data !== true) throw new ErroHttp(403, "somente_admin", "O navegador remoto é do admin.");
  return id;
}

function provedor(): Provedor | null {
  const chave = (Deno.env.get("BROWSERBASE_API_KEY") || "").trim();
  const projeto = (Deno.env.get("BROWSERBASE_PROJECT_ID") || "").trim();
  return chave ? provedorBrowserbase(chave, projeto || null) : null;
}

/** Endereço inicial aceito: só http/https, sem usuário e senha na URL. */
export function urlInicial(v: unknown): string | null {
  const t = String(v || "").trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

async function contextoDoCliente(p: Provedor, clientId: string, userId: string) {
  const { data } = await servico().from("navegador_contextos").select("id, contexto_externo").eq("client_id", clientId).eq("provedor", "browserbase").maybeSingle();
  if (data) return data as { id: string; contexto_externo: string };
  const { data: cli } = await servico().from("profiles").select("id, company_name, full_name").eq("id", clientId).maybeSingle();
  if (!cli) throw new ErroHttp(400, "cliente_invalido", "Esse cliente não existe no cadastro.");
  const externo = await p.criarContexto(`aceleriq-cliente-${clientId}`);
  const { data: novo, error } = await servico().from("navegador_contextos").insert({ client_id: clientId, provedor: "browserbase", contexto_externo: externo, criado_por: userId }).select("id, contexto_externo").single();
  if (error || !novo) throw new ErroHttp(503, "contexto_nao_gravado", "O navegador do cliente foi criado, mas o registro falhou. Tente de novo.");
  return novo as { id: string; contexto_externo: string };
}

async function acao(nome: string, corpo: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  const p = provedor();
  if (nome === "estado") return { configurado: !!p, provedor: "browserbase" };
  if (!p) throw new ErroHttp(409, "nao_configurado", "O navegador remoto ainda não foi ligado (falta a conta do provedor).");

  if (nome === "abrir") {
    const clientId = String(corpo.cliente_id || "");
    if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Escolha o cliente do navegador.");
    // Um navegador vivo por cliente: reaproveita a sessão aberta (o provedor não aceita duas no mesmo contexto).
    const { data: aberta } = await servico().from("navegador_sessoes").select("id, sessao_externa").eq("client_id", clientId).eq("estado", "aberta").order("aberta_em", { ascending: false }).limit(1).maybeSingle();
    if (aberta) {
      const viva = await p.verSessao((aberta as { sessao_externa: string }).sessao_externa).catch(() => null);
      if (viva && viva.rodando) return { sessao: { id: (aberta as { id: string }).id, ...viva }, reaproveitada: true };
      await servico().from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString() }).eq("id", (aberta as { id: string }).id);
    }
    const ctx = await contextoDoCliente(p, clientId, userId);
    const externa = await p.criarSessao(ctx.contexto_externo);
    // Endereço pedido fica anotado (o dono abre na barra do navegador; nada é dito "aberto" sem a sessão mostrar).
    const url = urlInicial(corpo.url);
    const origem = ["central", "gestor", "hermes"].includes(String(corpo.origem)) ? String(corpo.origem) : "central";
    const { data: reg, error } = await servico().from("navegador_sessoes").insert({ client_id: clientId, contexto_id: ctx.id, sessao_externa: externa, origem, pedido: corpo.pedido ? String(corpo.pedido).slice(0, 500) : null, aberta_por: userId, ultima_url: url }).select("id").single();
    if (error || !reg) { await p.encerrar(externa).catch(() => undefined); throw new ErroHttp(503, "sessao_nao_gravada", "Não consegui registrar a sessão: fechei para não ficar solta."); }
    await servico().from("navegador_contextos").update({ usado_em: new Date().toISOString() }).eq("id", ctx.id);
    const viva = await p.verSessao(externa);
    return { sessao: { id: (reg as { id: string }).id, ...viva }, reaproveitada: false };
  }

  if (nome === "ver" || nome === "encerrar") {
    const id = String(corpo.sessao_id || "");
    if (!UUID.test(id)) throw new ErroHttp(400, "sessao_invalida", "Sessão inválida.");
    const { data } = await servico().from("navegador_sessoes").select("id, sessao_externa, client_id, estado").eq("id", id).maybeSingle();
    const s = data as { id: string; sessao_externa: string; client_id: string; estado: string } | null;
    if (!s) throw new ErroHttp(404, "sessao_inexistente", "Sessão não encontrada.");
    if (nome === "encerrar") {
      await p.encerrar(s.sessao_externa).catch((e) => registrarFalha("navegador-remoto: encerrar", e));
      await servico().from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString() }).eq("id", s.id);
      return { encerrada: true };
    }
    const viva = await p.verSessao(s.sessao_externa).catch(() => null);
    if (!viva || !viva.rodando) {
      if (s.estado === "aberta") await servico().from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString() }).eq("id", s.id);
      return { sessao: { id: s.id, rodando: false } };
    }
    return { sessao: { id: s.id, ...viva } };
  }

  if (nome === "listar") {
    let q = servico().from("navegador_sessoes").select("id, client_id, origem, pedido, estado, aberta_em, encerrada_em, ultima_url").order("aberta_em", { ascending: false }).limit(30);
    if (typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id)) q = q.eq("client_id", corpo.cliente_id);
    const { data } = await q;
    return { sessoes: data || [] };
  }
  throw new ErroHttp(400, "acao_desconhecida", "Ação desconhecida.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const userId = await identificar(req);
    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    return json(await acao(String(corpo.acao || ""), corpo, userId));
  } catch (e) {
    if (e instanceof ErroHttp) return json({ error: e.codigo, mensagem: e.message }, e.status);
    if (e instanceof ErroDoProvedor) return json({ error: e.codigo, mensagem: e.message }, 502);
    registrarFalha("navegador-remoto: falha", e);
    return json({ error: "falha_interna", mensagem: "O navegador remoto falhou. Tente de novo." }, 500);
  }
});
