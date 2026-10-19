/**
 * ab-contar (Laboratório v4, nó `teste_ab`, 19/10/2026): conta visitas e
 * conversões de cada variante de um teste A/B. verify_jwt = false.
 *
 * Público (o script de _shared/ab-divisao.ts, sem login):
 *   POST { teste_id, variante, tipo: 'visita' | 'conversao' }
 *   O corpo chega como text/plain (sendBeacon sem preflight) ou JSON.
 *   teste_id e variante só no formato seguro; limite por IP no banco
 *   (lab_ab_registrar: 30 contagens em 10 min por IP, 5 variantes por teste).
 *   O IP nunca é gravado: só um hash com sal, como no site-formulario.
 *
 * Equipe (admin, gestor ou design, com o JWT do painel):
 *   POST { acao: 'totais', teste_id } → { teste_id, variantes, por_dia }
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { TESTE_ID } from "../_shared/ab-divisao.ts";
import { contar, type LinhaDeContagem, type PortaDoAb, somarPorVariante } from "./nucleo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PAPEIS = ["admin", "manager", "design"];

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function hashDoIp(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "desconhecido").trim().slice(0, 80);
  const sal = Deno.env.get("SITE_FORMULARIO_SAL") || Deno.env.get("SUPABASE_URL") || "aceleriq";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ab|${sal}|${ip}`)));
  return Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const porta: PortaDoAb = {
  async registrar(c, ipHash) {
    const { data, error } = await servico().rpc("lab_ab_registrar", { _teste_id: c.teste_id, _variante: c.variante, _tipo: c.tipo, _ip_hash: ipHash });
    if (error) throw error;
    return (data || { ok: false, codigo: "sem_resposta" }) as { ok: boolean; codigo?: string };
  },
  falha: (onde, erro) => registrarFalha(onde, erro),
};

async function totais(req: Request, corpo: Record<string, unknown>): Promise<Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "sessao_expirada", mensagem: "Sessão expirada. Entre de novo no painel." }, 401);
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return json({ error: "sessao_expirada", mensagem: "Sessão expirada. Entre de novo no painel." }, 401);
  const { data: papeis, error: erroPapeis } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (erroPapeis) return json({ error: "autorizacao_indisponivel", mensagem: "Não foi possível conferir a permissão agora." }, 503);
  if (!((papeis || []) as Array<{ role: string }>).some((p) => PAPEIS.indexOf(String(p.role)) >= 0)) {
    return json({ error: "somente_equipe", mensagem: "Os números do teste são da equipe." }, 403);
  }
  const testeId = typeof corpo.teste_id === "string" ? corpo.teste_id : "";
  if (!TESTE_ID.test(testeId)) return json({ error: "teste_invalido", mensagem: "Id do teste inválido." }, 400);
  const { data, error } = await servico().from("lab_ab_contagem").select("variante, tipo, dia, total").eq("teste_id", testeId).order("dia", { ascending: true }).limit(2000);
  if (error) {
    registrarFalha("ab-contar: totais não lidos", error);
    return json({ error: "banco_indisponivel", mensagem: "Não foi possível ler os números agora." }, 503);
  }
  const linhas = (data || []) as LinhaDeContagem[];
  return json({ teste_id: testeId, variantes: somarPorVariante(linhas), por_dia: linhas });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, codigo: "metodo_nao_permitido" }, 405);
  let corpo: unknown;
  try {
    const texto = await req.text();
    if (texto.length > 2_000) return json({ ok: false, codigo: "grande_demais" }, 413);
    corpo = JSON.parse(texto);
  } catch {
    return json({ ok: false, codigo: "pedido_invalido" }, 400);
  }
  try {
    if (corpo && typeof corpo === "object" && (corpo as Record<string, unknown>).acao === "totais") return await totais(req, corpo as Record<string, unknown>);
    const r = await contar(porta, corpo, await hashDoIp(req));
    return json(r.corpo, r.status);
  } catch (e) {
    registrarFalha("ab-contar: erro inesperado", e);
    return json({ ok: false, codigo: "erro_interno" }, 500);
  }
});
