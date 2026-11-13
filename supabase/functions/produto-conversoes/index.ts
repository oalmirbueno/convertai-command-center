/**
 * Envio das conversões do CRM da empresa para a Meta (13/11/2026).
 *
 * Robô do cron (a cada 2 minutos, só quando há evento esperando; x-cron-secret
 * ou a chave de serviço). Lê a fila crm_conversoes (negócio que entrou por
 * formulário = Lead; negócio ganho = Purchase), monta o evento no formato da
 * API de Conversões (_shared/conversoes-da-meta.ts: e-mail, telefone e nome com
 * SHA-256, fbc a partir do fbclid, event_source_url) e envia para o Pixel da
 * empresa com o token dela, que mora no Vault e só chega aqui por
 * crm_rastreamento_token (chave de serviço).
 *
 * Nova tentativa: falha passageira volta para a fila com espera crescente
 * (5, 15, 45 e 135 minutos) e vira erro na quinta; token ou pixel recusado
 * vira erro na hora, e o gestor manda tentar de novo pela tela depois de
 * corrigir. Evento com mais de 7 dias não é enviado (a Meta recusa).
 *
 * O token nunca vai para o registro, para a resposta nem para o endereço da
 * chamada (vai no corpo).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { corpoDoEnvio, enderecoDosEventos, lerRespostaDaMeta, montarEventoDaMeta, semSegredo, VERSAO_DA_GRAPH, type ConversaoDaFila, type ResultadoDaMeta } from "../_shared/conversoes-da-meta.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** A rodada cabe longe do prazo do cron (60 s): o que não der tempo fica reservado e volta em 10 minutos. */
const PRAZO_DA_RODADA_MS = 45_000;
const PRAZO_DA_CHAMADA_MS = 12_000;

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

/** Só o cron (x-cron-secret) ou a chave de serviço. Ninguém dispara o envio pela tela. */
function autorizado(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  return !!token && !!chave && token === chave;
}

interface Conexao {
  pixel: string;
  token: string;
  codigo_de_teste: string | null;
  eventos: string[];
}

async function conexaoDaConta(db: SupabaseClient, contaId: string): Promise<Conexao | null> {
  const { data, error } = await db.rpc("crm_rastreamento_token", { _conta: contaId });
  if (error) throw new Error("leitura da conexao");
  const r = (data || null) as { pixel?: string; token?: string; codigo_de_teste?: string | null; eventos?: string[] } | null;
  if (!r || !r.pixel || !r.token) return null;
  return { pixel: r.pixel, token: r.token, codigo_de_teste: r.codigo_de_teste || null, eventos: Array.isArray(r.eventos) ? r.eventos : [] };
}

/** Uma chamada à Meta. Nunca lança: rede caída e prazo estourado viram "tentar de novo". */
export async function enviarParaAMeta(c: ConversaoDaFila, conexao: Conexao, buscar: typeof fetch = fetch): Promise<ResultadoDaMeta> {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), PRAZO_DA_CHAMADA_MS);
  try {
    const evento = await montarEventoDaMeta(c);
    const resposta = await buscar(enderecoDosEventos(conexao.pixel, Deno.env.get("META_GRAPH_VERSION")?.trim() || VERSAO_DA_GRAPH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpoDoEnvio([evento], conexao.token, conexao.codigo_de_teste)),
      signal: controle.signal,
    });
    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      /* resposta sem JSON: o status decide */
    }
    return lerRespostaDaMeta(resposta.status, corpo, conexao.token);
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    return { ok: false, definitivo: false, erro: abortou ? "A Meta demorou para responder." : semSegredo("Não foi possível falar com a Meta agora.", conexao.token) };
  } finally {
    clearTimeout(prazo);
  }
}

async function rodar(db: SupabaseClient, limite: number) {
  const inicio = Date.now();
  const { data, error } = await db.rpc("crm_conversoes_pegar", { _limite: limite });
  if (error) throw new Error("leitura da fila");
  const fila = (Array.isArray(data) ? data : []) as ConversaoDaFila[];
  const conexoes = new Map<string, Conexao | null>();
  const resumo = { pegos: fila.length, enviados: 0, de_novo: 0, erros: 0, sem_tempo: 0 };

  const anotar = async (id: string, r: ResultadoDaMeta) => {
    const { error: falha } = await db.rpc("crm_conversao_resultado", { _id: id, _ok: r.ok, _erro: r.ok ? null : r.erro, _definitivo: r.definitivo });
    if (falha) console.error("[produto-conversoes] resultado nao anotado", id);
    if (r.ok) resumo.enviados += 1;
    else if (r.definitivo) resumo.erros += 1;
    else resumo.de_novo += 1;
  };

  for (const c of fila) {
    if (Date.now() - inicio > PRAZO_DA_RODADA_MS) {
      resumo.sem_tempo += 1;
      continue;
    }
    try {
      if (!conexoes.has(c.conta_id)) conexoes.set(c.conta_id, await conexaoDaConta(db, c.conta_id));
      const conexao = conexoes.get(c.conta_id) || null;
      if (!conexao) {
        await anotar(c.id, { ok: false, definitivo: true, erro: "A empresa está sem Pixel ou sem token da Meta." });
        continue;
      }
      if (conexao.eventos.indexOf(c.evento) < 0) {
        await anotar(c.id, { ok: false, definitivo: true, erro: "Esse tipo de evento foi desligado na empresa." });
        continue;
      }
      await anotar(c.id, await enviarParaAMeta(c, conexao));
    } catch (e) {
      // Falha nossa (banco): o evento continua reservado e volta sozinho em 10 minutos.
      console.error("[produto-conversoes] evento", c.id, e instanceof Error ? e.message.slice(0, 80) : "");
      resumo.sem_tempo += 1;
    }
  }
  return resumo;
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
      return json({ ok: true, ...(await rodar(servico(), limite)) });
    } catch (e) {
      console.error("[produto-conversoes] rodada", e instanceof Error ? e.message.slice(0, 120) : "");
      return json({ error: "erro_interno" }, 500);
    }
  });
}
