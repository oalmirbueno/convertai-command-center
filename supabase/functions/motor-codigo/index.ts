/**
 * motor-codigo: a porta da fila do motor de código (frente SIT, 30/09/2026).
 * Desenho em plano/p4-motores.md §10. NUNCA roda o agente: valida o acesso,
 * estima pelo catálogo, reserva o teto na carteira (motor_reservado_usd) e
 * grava o pedido na fila. O worker da agência (workers/motor-codigo/) faz o
 * resto e registra o custo real.
 *
 * POST { acao, ... }, só equipe com acesso ao cliente.
 * - estimar { client_id, tipo, secoes?, modelo_id? } -> { estimativa_usd, teto_sugerido_usd, passos, saldo_usd, reservado_usd, livre_usd, modelo }
 * - pedir { client_id, site_id, tipo, secoes?, secao?, instrucao?, teto_usd, modelo_id?, alvo_trabalho_id? } -> { trabalho, estimativa_usd }
 * - parar { trabalho_id } -> { trabalho }
 * - listar { client_id, site_id } -> { trabalhos, executor }
 * - eventos { trabalho_id, desde? } -> { eventos, trabalho }
 * - executor {} -> { executor, vivo }
 *
 * Sem travessão. Erro sai como { error, mensagem }.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { executorVivo } from "../_shared/motor-codigo.ts";
import { criarTrabalho, ErroDoMotor, eventosDoTrabalho, executorDoMotor, lerTrabalho, orcar, pararTrabalho, trabalhosDoProjeto, ultimoConteudo } from "../_shared/motor-fila.ts";
import { type LinhaDoSite, montarPacoteDoSite } from "../_shared/pacote-do-site.ts";
import { resolverMarca } from "../_shared/marca.ts";
import { regrasDaMesa } from "../_shared/aprendizado-das-mesas.ts";
import { contextoCompletoParaPrompt } from "../_shared/contexto-completo-da-marca.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Chamador = { userId: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroDoMotor(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroDoMotor(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroDoMotor(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroDoMotor(403, "somente_equipe", "Somente a equipe usa o motor de código.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroDoMotor(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroDoMotor(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroDoMotor(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const idDe = (v: unknown, nome: string) => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDoMotor(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

async function lerSite(clientId: string, siteId: string): Promise<LinhaDoSite> {
  const { data, error } = await servico().from("sites").select("*").eq("id", siteId).maybeSingle();
  if (error) throw new ErroDoMotor(503, "site_indisponivel", "Não foi possível ler o site agora (a migration da Mesa Site já foi aplicada?).");
  const s = data as LinhaDoSite | null;
  if (!s || s.client_id !== clientId) throw new ErroDoMotor(404, "site_inexistente", "Site não encontrado neste cliente.");
  if (s.arquivado_em) throw new ErroDoMotor(409, "site_arquivado", "Este site está arquivado. Desarquive para mexer.");
  return s;
}

async function estimar(ch: Chamador, c: Record<string, unknown>) {
  const clientId = idDe(c.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const o = await orcar(servico(), clientId, c, typeof c.modelo_id === "string" ? c.modelo_id : null);
  return json({
    estimativa_usd: o.estimativa_usd,
    teto_sugerido_usd: o.teto_sugerido_usd,
    passos: o.passos,
    saldo_usd: o.saldo_usd,
    reservado_usd: o.reservado_usd,
    livre_usd: o.livre_usd,
    modelo: o.modelo ? { id: o.modelo.id, modelo_api: o.modelo.modelo_api } : null,
    custo_usd: 0,
  });
}

async function pedir(ch: Chamador, c: Record<string, unknown>) {
  const clientId = idDe(c.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  // Publicar sai só pela Mesa Site (publicar, com Confirmar e a conferência do que falta).
  if (c.tipo === "publicar") throw new ErroDoMotor(400, "publicar_pela_mesa", "Publicar é pela etapa Publicação da Mesa Site, com Confirmar.");
  const site = await lerSite(clientId, idDe(c.site_id, "site_id"));
  const marca = await resolverMarca(servico(), clientId, { marca_id: site.marca_id });
  const secoes = Array.isArray(c.secoes) ? (c.secoes as string[]) : undefined;
  // Frente SYNC: o agente do worker também lê as regras ensinadas na Mesa Site e o contexto completo da marca
  // (estratégia aprovada com tom e tagline, briefing mais novo, decisões do conselho e cérebro).
  const [{ pacote, arquivos }, regras, contextoDaMarca] = await Promise.all([
    montarPacoteDoSite(servico(), site, marca, secoes),
    regrasDaMesa(servico(), { clientId, mesa: "site", marcaId: site.marca_id }),
    contextoCompletoParaPrompt(servico(), clientId, marca, { area: "site", partes: ["estrategia", "briefing", "decisoes", "cerebro"], semTitulo: true, teto: 6000 })
      .then((x) => x.bloco, (e) => (registrarFalha("motor-codigo: contexto completo não lido", e), "")),
  ]);
  const { trabalho, orcamento } = await criarTrabalho(servico(), {
    clientId,
    marcaId: site.marca_id,
    mesa: "site",
    projeto: site.projeto,
    referencia: { tipo: "site", id: site.id },
    pedidoBruto: c,
    modeloId: typeof c.modelo_id === "string" && c.modelo_id ? c.modelo_id : site.modelo,
    pacote: {
      ...pacote,
      arquivos,
      regras_da_equipe: regras.regras.map((r) => `${r.tipo === "evitar" ? "EVITAR" : "PREFERIR"}: ${r.texto}`),
      contexto_da_marca: contextoDaMarca || null,
    } as unknown as Record<string, unknown>,
    pacoteDe: site.pacote_mudou_em || null,
    userId: ch.userId,
  });
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "motor_codigo_pedir", origin: "mesa:motor-codigo", keyId: `mesa:motor-codigo:${ch.userId}`, scopes: ["mesa:write"],
    input: { client_id: clientId, site_id: site.id, tipo: trabalho.tipo, teto_usd: trabalho.teto_usd }, success: true, statusCode: 200, durationMs: 0, resultRef: trabalho.id,
  }).catch((e: unknown) => registrarFalha("motor-codigo: auditoria do pedido", e));
  return json({ trabalho, estimativa_usd: orcamento.estimativa_usd, livre_usd: orcamento.livre_usd, custo_usd: 0 });
}

async function parar(ch: Chamador, c: Record<string, unknown>) {
  const t = await lerTrabalho(servico(), idDe(c.trabalho_id, "trabalho_id"));
  await garantirAcesso(ch, t.client_id);
  return json({ trabalho: await pararTrabalho(servico(), t, ch.userId), custo_usd: 0 });
}

async function listar(ch: Chamador, c: Record<string, unknown>) {
  const clientId = idDe(c.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const siteId = idDe(c.site_id, "site_id");
  // SPV: os trabalhos de código vêm sem o "conteudo" (a edição da prévia); o último deles vai à parte (estado e prévia).
  const [trabalhos, conteudo, executor] = await Promise.all([trabalhosDoProjeto(servico(), clientId, siteId), ultimoConteudo(servico(), clientId, siteId), executorDoMotor(servico())]);
  return json({ trabalhos, conteudo, executor, executor_vivo: executorVivo(executor ? executor.visto_em : null), custo_usd: 0 });
}

async function eventos(ch: Chamador, c: Record<string, unknown>) {
  const t = await lerTrabalho(servico(), idDe(c.trabalho_id, "trabalho_id"));
  await garantirAcesso(ch, t.client_id);
  const desde = Math.max(0, Math.floor(Number(c.desde) || 0));
  return json({ trabalho: t, eventos: await eventosDoTrabalho(servico(), t.id, desde), custo_usd: 0 });
}

async function executor() {
  const e = await executorDoMotor(servico());
  return json({ executor: e, vivo: executorVivo(e ? e.visto_em : null), custo_usd: 0 });
}

const ACOES: Record<string, (ch: Chamador, c: Record<string, unknown>) => Promise<Response>> = {
  estimar,
  pedir,
  parar,
  listar,
  eventos,
  executor: () => executor(),
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroDoMotor) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  registrarFalha("motor-codigo: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada no motor de código." }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const ch = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const fn = ACOES[String(corpo.acao ?? "")];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    return await fn(ch, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
