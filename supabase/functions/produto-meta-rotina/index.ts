/**
 * Rotina do robô de WhatsApp do CRM da empresa (14/11/2026).
 *
 * Robô do cron (a cada 2 minutos, só quando há o que fazer; x-cron-secret ou a chave de serviço).
 * A cada rodada:
 *   1. roda crm_fila_distribuir() e avisa o vendedor de cada lead que saiu da fila (se as perguntas já acabaram);
 *   2. dispara os follow-ups vencidos (template de retomada) ou encerra a conversa de quem não respondeu;
 *   3. envia a fila pendente (crm_whats_envios), com nova tentativa limitada e espera crescente
 *      (2, 6, 18 e 54 minutos; erro na quinta), anotando o resultado de cada envio.
 *
 * Empresa em modo teste, ou sem número ou token do WhatsApp: o envio vira "simulado" e nada sai.
 * O token de cada empresa só chega aqui por crm_integracao_da_conta (chave de serviço) e nunca vai
 * para registro, erro ou resposta.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { VERSAO_DA_GRAPH_DO_WHATSAPP } from "../_shared/whatsapp-do-crm.ts";
import { lerIntegracao, type Contexto, type Integracao } from "../produto-meta/modulos/tipos.ts";
import { aoDistribuir, aoVencerPrazo, despachar, type Banco, type ResumoDoDespacho } from "../produto-meta/modulos/whatsapp.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** A rodada cabe longe do prazo do cron (60 s): o que não der tempo fica reservado e volta em 10 minutos. */
const PRAZO_DA_RODADA_MS = 45_000;

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

/** Só o cron (x-cron-secret) ou a chave de serviço. Ninguém dispara a rotina pela tela. */
export function autorizado(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  return !!token && !!chave && token === chave;
}

export interface ResumoDaRodada extends ResumoDoDespacho {
  distribuidos: number;
  followups: number;
  falhas: number;
}

export interface OpcoesDaRodada {
  limite?: number;
  agora?: Date;
  buscar?: typeof fetch;
  versao?: string;
}

/** Uma rodada inteira. Recebe o banco (só RPC) para o ensaio poder trocar por um falso. */
export async function rodar(db: Banco, opcoes: OpcoesDaRodada = {}): Promise<ResumoDaRodada> {
  const inicio = Date.now();
  const agora = opcoes.agora || new Date();
  const conexoes = new Map<string, Integracao | null>();
  const integracaoDa = async (conta: string): Promise<Integracao | null> => {
    if (!conexoes.has(conta)) {
      const { data, error } = await db.rpc("crm_integracao_da_conta", { _conta: conta });
      if (error) throw new Error("banco: crm_integracao_da_conta");
      conexoes.set(conta, lerIntegracao(data));
    }
    return conexoes.get(conta) || null;
  };
  const contextoDa = async (conta: string): Promise<Contexto | null> => {
    const integracao = await integracaoDa(conta);
    return integracao && integracao.ativo ? { servico: db as unknown as SupabaseClient, integracao, agora } : null;
  };
  const lista = async (nome: string, argumentos: Record<string, unknown>): Promise<Array<Record<string, unknown>>> => {
    const { data, error } = await db.rpc(nome, argumentos);
    if (error) throw new Error(`banco: ${nome}`);
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  };
  let distribuidos = 0;
  let followups = 0;
  let falhas = 0;

  // 1. Quem estava na fila ganha vendedor, e o vendedor é avisado.
  for (const d of await lista("crm_fila_distribuir", {})) {
    try {
      const ctx = await contextoDa(String(d.conta_id));
      if (ctx) await aoDistribuir(ctx, String(d.lead_id));
      distribuidos += 1;
    } catch (e) {
      falhas += 1;
      console.error("[produto-meta-rotina] fila", String(d.lead_id).slice(0, 36), e instanceof Error ? e.message.slice(0, 80) : "");
    }
  }

  // 2. Follow-ups vencidos.
  for (const f of await lista("crm_whats_followups_pegar", { _limite: 50 })) {
    if (Date.now() - inicio > PRAZO_DA_RODADA_MS) break;
    try {
      const ctx = await contextoDa(String(f.conta_id));
      if (ctx) await aoVencerPrazo(ctx, String(f.lead_id), typeof f.vencia_em === "string" ? f.vencia_em : null);
      followups += 1;
    } catch (e) {
      // A conversa continua reservada e volta sozinha em 10 minutos.
      falhas += 1;
      console.error("[produto-meta-rotina] follow-up", String(f.lead_id).slice(0, 36), e instanceof Error ? e.message.slice(0, 80) : "");
    }
  }

  // 3. A fila de envios (inclui o que os passos acima acabaram de enfileirar).
  const envio = await despachar(db, integracaoDa, { limite: opcoes.limite || 40, buscar: opcoes.buscar, versao: opcoes.versao, ateMs: inicio + PRAZO_DA_RODADA_MS });
  return { distribuidos, followups, falhas, ...envio };
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo" }, 405);
    if (!autorizado(req)) return json({ error: "Unauthorized" }, 401);
    let limite = 40;
    try {
      const corpo = await req.json();
      const n = Math.floor(Number(corpo && corpo.limite));
      if (isFinite(n) && n >= 1) limite = Math.min(n, 100);
    } catch {
      /* corpo vazio: usa o padrão */
    }
    try {
      const versao = Deno.env.get("META_GRAPH_VERSION")?.trim() || VERSAO_DA_GRAPH_DO_WHATSAPP;
      return json({ ok: true, ...(await rodar(servico() as unknown as Banco, { limite, versao })) });
    } catch (e) {
      console.error("[produto-meta-rotina] rodada", e instanceof Error ? e.message.slice(0, 120) : "");
      return json({ error: "erro_interno" }, 500);
    }
  });
}
