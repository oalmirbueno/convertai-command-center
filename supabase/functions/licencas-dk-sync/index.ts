/**
 * Licenças da plataforma DK Sorteios no Financeiro (19/11/2026, interno, só admin).
 *
 * A DK confere as faturas por consulta e não cadastra webhook na conta da Aceleriq, então o painel também consulta:
 * a rotina (pg_cron, a cada 10 min) lê no Asaas as faturas de licença pagas dos últimos 120 dias e grava cada
 * pagamento uma vez só em public.licencas_dk_pagamentos (upsert pelo id do pagamento no Asaas).
 *
 *   POST { acao: "sincronizar" }                 rotina (x-cron-secret ou service role) ou admin
 *   POST { acao: "sincronizar", completo: true } admin: relê todo o histórico do Asaas
 *
 * A chave é a ASAAS_API_KEY do cofre (chaves_cofre), a mesma do Comercial e do produto. Nada aqui é do cliente DK.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chave } from "../_shared/chaves.ts";
import { desdeDias, ErroDoAsaas, sincronizarLicencas, type Lancamento } from "../_shared/licencas-dk.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "7200",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const amb = (n: string) => String(Deno.env.get(n) || "").trim();
const JANELA_DA_ROTINA_DIAS = 120;

let cache: SupabaseClient | null = null;
const servico = () => (cache ||= createClient(amb("SUPABASE_URL"), amb("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }));

function iguais(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const tokenDe = (req: Request) => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

function daRotina(req: Request): boolean {
  const segredo = amb("CRON_SECRET");
  if (segredo && iguais((req.headers.get("x-cron-secret") || "").trim(), segredo)) return true;
  return iguais(tokenDe(req), amb("SUPABASE_SERVICE_ROLE_KEY"));
}

async function ehAdmin(req: Request): Promise<boolean> {
  const token = tokenDe(req);
  if (!token) return false;
  const { data } = await servico().auth.getUser(token);
  if (!data?.user) return false;
  const { data: papeis } = await servico().from("user_roles").select("role").eq("user_id", data.user.id);
  return ((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  const rotina = daRotina(req);
  if (!rotina && !(await ehAdmin(req))) return json({ error: "sem_permissao" }, 403);
  const corpo = ((await req.json().catch(() => ({}))) || {}) as { acao?: string; completo?: boolean };
  if (corpo.acao !== "sincronizar") return json({ error: "acao_invalida" }, 400);

  const token = await chave("ASAAS_API_KEY").catch(() => "");
  if (!token) return json({ error: "configuracao_pendente", mensagem: "Falta a ASAAS_API_KEY no cofre." }, 503);

  const db = servico();
  const { data: ajuste } = await db.from("licencas_dk_ajuste").select("cliente_id").eq("id", true).maybeSingle();
  const clienteId = (ajuste as { cliente_id?: string | null } | null)?.cliente_id || null;
  const completo = corpo.completo === true && !rotina;

  try {
    const resumo = await sincronizarLicencas({
      token,
      buscar: fetch,
      clienteId,
      desde: completo ? null : desdeDias(JANELA_DA_ROTINA_DIAS),
      gravar: async (linhas: Lancamento[]) => {
        const agora = new Date().toISOString();
        const { error } = await db.from("licencas_dk_pagamentos").upsert(linhas.map((l) => ({ ...l, sincronizado_em: agora })), { onConflict: "asaas_pagamento_id" });
        if (error) throw new Error(`gravar: ${error.message}`);
      },
    });
    await db.from("licencas_dk_ajuste").update({ ultima_sincronizacao: new Date().toISOString(), ultimo_erro: null }).eq("id", true);
    return json({ ok: true, completo, ...resumo });
  } catch (e) {
    const motivo = (e instanceof ErroDoAsaas ? e.message : `falha: ${(e as Error).message}`).slice(0, 300);
    console.error("[licencas-dk-sync]", motivo);
    await db.from("licencas_dk_ajuste").update({ ultimo_erro: motivo }).eq("id", true);
    return json({ error: "sincronizacao_falhou", mensagem: motivo }, 502);
  }
});
