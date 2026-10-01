/**
 * motores-estado (frente MTR, 30/09/2026): o "Estado dos motores" das
 * Configurações. Só leitura e sem custo.
 *
 * POST {} (só a equipe) -> { motores, geral, conferido_em }
 *
 * Para cada motor (site, render do Motion, render da Mesa Edição, imagem,
 * vídeo e as chaves/crédito da IA): ligado ou não, último sinal do worker, a
 * fila, o último erro legível e o que falta. Lê as filas e as batidas com a
 * service_role DEPOIS de conferir que quem chama é da equipe; dos segredos, só
 * a PRESENÇA (o valor nunca sai do servidor; ambiente ou cofre do painel); do OpenRouter, o crédito pelas
 * rotas de consulta (/key e /credits), que não gastam nada.
 *
 * Nomes de cliente (carteiras vazias) e números de crédito só para o admin.
 * Nenhuma falha de leitura derruba a resposta: vira aviso no quadro e log.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { carregarChaves, chaveCarregada } from "../_shared/chaves.ts";
import {
  type EntradaDoEstado,
  erroDoPedidoDeVideo,
  lerChaveDoOpenrouter,
  lerCreditosDoOpenrouter,
  montarEstado,
  resumoGeral,
  SEGREDOS_CONFERIDOS,
} from "./modulos/estado.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function identificar(req: Request): Promise<{ userId: string; admin: boolean }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const [staff, admin] = await Promise.all([
    servico().rpc("is_staff", { _user_id: userId }),
    servico().rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (staff.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff.data !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe vê o estado dos motores.");
  return { userId, admin: admin.data === true };
}

/**
 * Ambiente da função primeiro; sem ele, o cofre do painel (Configurações ›
 * Chaves e custos), carregado no começo de `estado` (frente CHV).
 */
const segredo = (nome: string) => chaveCarregada(nome);

/** Linhas de uma consulta; falha vira aviso (nunca derruba o quadro). */
async function linhas<T>(onde: string, avisos: string[], consulta: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
  try {
    const { data, error } = await consulta;
    if (error) {
      avisos.push(`${onde}: ${String(error.message || "sem leitura").slice(0, 120)}`);
      registrarFalha(`motores-estado: ${onde}`, error);
      return [];
    }
    return (Array.isArray(data) ? data : []) as T[];
  } catch (e) {
    avisos.push(`${onde}: ${registrarFalha(`motores-estado: ${onde}`, e).slice(0, 120)}`);
    return [];
  }
}

async function contar(onde: string, avisos: string[], consulta: PromiseLike<{ count: number | null; error: { message?: string } | null }>): Promise<number> {
  try {
    const { count, error } = await consulta;
    if (error) {
      avisos.push(`${onde}: ${String(error.message || "sem leitura").slice(0, 120)}`);
      return 0;
    }
    return count || 0;
  } catch (e) {
    avisos.push(`${onde}: ${registrarFalha(`motores-estado: ${onde}`, e).slice(0, 120)}`);
    return 0;
  }
}

/** Crédito do OpenRouter pelas rotas de consulta (não gastam). */
async function lerOpenrouter(): Promise<EntradaDoEstado["openrouter"]> {
  const chave = segredo("OPENROUTER_API_KEY");
  if (!chave) return null;
  const pedir = async (rota: string) => {
    const r = await fetch(`https://openrouter.ai/api/v1/${rota}`, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`${rota} respondeu ${r.status}`);
    return await r.json();
  };
  const [k, c] = await Promise.allSettled([pedir("key"), pedir("credits")]);
  const erros = [k, c].filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => (x.reason instanceof Error ? x.reason.message : String(x.reason)));
  if (erros.length) registrarFalha("motores-estado: crédito do OpenRouter", new Error(erros.join("; ")));
  return {
    chave: k.status === "fulfilled" ? lerChaveDoOpenrouter(k.value) : null,
    creditos: c.status === "fulfilled" ? lerCreditosDoOpenrouter(c.value) : null,
    erro: erros.length === 2 ? erros.join("; ") : null,
  };
}

async function estado(admin: boolean) {
  await carregarChaves(SEGREDOS_CONFERIDOS);
  const db = servico();
  const avisos: string[] = [];
  const agora = Date.now();
  const dia = new Date(agora - 24 * 60 * 60_000).toISOString();
  const semana = new Date(agora - 7 * 24 * 60 * 60_000).toISOString();
  type Linha = Record<string, unknown>;
  const [
    executores,
    trabalhosAbertos,
    falhaDoSite,
    feitoDoSite,
    workers,
    renderAbertos,
    renderErros,
    renderProntos,
    estudioAbertos,
    estudioErros,
    estudioFeitas,
    estudioUltima,
    videoAbertos,
    videoErros,
    videos7d,
    videosProntos7d,
    angulos7d,
    videoUltimoPronto,
    carteiras,
    openrouter,
  ] = await Promise.all([
    linhas<Linha>("motor_executores", avisos, db.from("motor_executores").select("nome, visto_em, versao, capacidades, trabalho_id").order("visto_em", { ascending: false }).limit(3)),
    linhas<Linha>("motor_trabalhos", avisos, db.from("motor_trabalhos").select("estado, criado_em, modelo").in("estado", ["na_fila", "executando", "parando"]).order("criado_em", { ascending: true }).limit(50)),
    linhas<Linha>("motor_trabalhos (falhas)", avisos, db.from("motor_trabalhos").select("erro, terminado_em, atualizado_em").eq("estado", "falhou").order("atualizado_em", { ascending: false }).limit(1)),
    linhas<Linha>("motor_trabalhos (feitos)", avisos, db.from("motor_trabalhos").select("terminado_em").eq("estado", "feito").order("terminado_em", { ascending: false }).limit(1)),
    linhas<Linha>("render_workers", avisos, db.from("render_workers").select("*").order("visto_em", { ascending: false }).limit(3)),
    linhas<Linha>("render_pedidos", avisos, db.from("render_pedidos").select("tipo, estado, criado_em, atualizado_em").in("estado", ["fila", "rodando"]).order("criado_em", { ascending: true }).limit(100)),
    linhas<Linha>("render_pedidos (erros)", avisos, db.from("render_pedidos").select("tipo, erro_codigo, erro_mensagem, concluido_em").eq("estado", "erro").order("concluido_em", { ascending: false }).limit(10)),
    linhas<Linha>("render_pedidos (prontos)", avisos, db.from("render_pedidos").select("tipo, concluido_em").eq("estado", "pronto").order("concluido_em", { ascending: false }).limit(10)),
    linhas<Linha>("estudio_fila", avisos, db.from("estudio_fila").select("status, criado_em").in("status", ["fila", "rodando"]).order("criado_em", { ascending: true }).limit(100)),
    linhas<Linha>("estudio_fila (erros)", avisos, db.from("estudio_fila").select("erro_codigo, erro_mensagem, atualizado_em, client_id").eq("status", "erro").order("atualizado_em", { ascending: false }).limit(5)),
    contar("estudio_fila (24 h)", avisos, db.from("estudio_fila").select("id", { count: "exact", head: true }).eq("status", "feito").gte("atualizado_em", dia)),
    linhas<Linha>("estudio_fila (última)", avisos, db.from("estudio_fila").select("atualizado_em").eq("status", "feito").order("atualizado_em", { ascending: false }).limit(1)),
    linhas<Linha>("video_pedidos", avisos, db.from("video_pedidos").select("estado, criado_em").in("estado", ["enviado", "gerando", "baixando"]).order("criado_em", { ascending: true }).limit(50)),
    linhas<Linha>("video_pedidos (erros)", avisos, db.from("video_pedidos").select("tipo, resultado, atualizado_em").eq("estado", "erro").order("atualizado_em", { ascending: false }).limit(3)),
    // Vídeo e troca de ângulo de FOTO contados à parte (o ângulo não prova o vídeo).
    contar("video_pedidos (7 dias)", avisos, db.from("video_pedidos").select("id", { count: "exact", head: true }).neq("tipo", "angulo").gte("criado_em", semana)),
    contar("video_pedidos (prontos)", avisos, db.from("video_pedidos").select("id", { count: "exact", head: true }).neq("tipo", "angulo").eq("estado", "pronto").gte("criado_em", semana)),
    contar("video_pedidos (ângulos)", avisos, db.from("video_pedidos").select("id", { count: "exact", head: true }).eq("tipo", "angulo").gte("criado_em", semana)),
    linhas<Linha>("video_pedidos (último pronto)", avisos, db.from("video_pedidos").select("atualizado_em").eq("estado", "pronto").order("atualizado_em", { ascending: false }).limit(1)),
    admin ? linhas<Linha>("ia_carteiras", avisos, db.from("ia_carteiras").select("client_id, saldo_usd").lt("saldo_usd", 0.1).order("saldo_usd", { ascending: true }).limit(12)) : Promise.resolve([] as Linha[]),
    lerOpenrouter().catch((e) => ({ chave: null, creditos: null, erro: registrarFalha("motores-estado: OpenRouter", e) })),
  ]);

  // Nomes de cliente só para o admin (carteiras e o cliente do último erro de imagem).
  const ids = admin ? Array.from(new Set(carteiras.map((c) => String(c.client_id)).concat(estudioErros.map((e) => String(e.client_id || ""))).filter(Boolean))) : [];
  const nomes: Record<string, string> = {};
  if (ids.length) {
    const perfis = await linhas<Linha>("profiles", avisos, db.from("profiles").select("id, full_name").in("id", ids));
    perfis.forEach((p) => {
      nomes[String(p.id)] = String(p.full_name || "cliente sem nome").slice(0, 60);
    });
  }
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const segredos: Record<string, boolean> = {};
  SEGREDOS_CONFERIDOS.forEach((n) => {
    segredos[n] = !!segredo(n);
  });

  const entrada: EntradaDoEstado = {
    agora,
    segredos,
    admin,
    openrouter,
    site: {
      executores: executores.map((x) => ({ nome: String(x.nome), visto_em: s(x.visto_em), versao: s(x.versao), capacidades: (x.capacidades as Record<string, unknown>) || null, trabalho_id: s(x.trabalho_id) })),
      abertos: trabalhosAbertos.map((x) => ({ estado: String(x.estado), criado_em: String(x.criado_em), modelo: s(x.modelo) })),
      ultimaFalha: falhaDoSite[0] ? { erro: s(falhaDoSite[0].erro), em: s(falhaDoSite[0].terminado_em) || s(falhaDoSite[0].atualizado_em) } : null,
      ultimoFeito: feitoDoSite[0] ? s(feitoDoSite[0].terminado_em) : null,
    },
    render: {
      workers: workers.map((x) => ({ nome: String(x.nome), visto_em: s(x.visto_em), versao: s(x.versao), capacidades: (x.capacidades as Record<string, unknown>) || null, pedido_id: s(x.pedido_id), iniciado_em: s(x.iniciado_em) })),
      abertos: renderAbertos.map((x) => ({ tipo: String(x.tipo), estado: String(x.estado), criado_em: String(x.criado_em), atualizado_em: s(x.atualizado_em) })),
      erros: renderErros.map((x) => ({ tipo: String(x.tipo), erro_codigo: s(x.erro_codigo), erro_mensagem: s(x.erro_mensagem), em: s(x.concluido_em) })),
      prontos: renderProntos.map((x) => ({ tipo: String(x.tipo), em: s(x.concluido_em) })),
    },
    imagem: {
      abertos: estudioAbertos.map((x) => ({ status: String(x.status), criado_em: String(x.criado_em) })),
      erros: estudioErros.map((x) => ({ erro_codigo: s(x.erro_codigo), erro_mensagem: s(x.erro_mensagem), em: s(x.atualizado_em), cliente: admin ? nomes[String(x.client_id || "")] || null : null })),
      feitas24h: estudioFeitas,
      ultimaFeita: estudioUltima[0] ? s(estudioUltima[0].atualizado_em) : null,
    },
    video: {
      abertos: videoAbertos.map((x) => ({ estado: String(x.estado), criado_em: String(x.criado_em) })),
      erros: videoErros.map((x) => ({ texto: erroDoPedidoDeVideo(x.resultado) || "O pedido de vídeo falhou.", em: s(x.atualizado_em), tipo: s(x.tipo) })),
      pedidos7d: videos7d,
      prontos7d: videosProntos7d,
      angulos7d,
      ultimoPronto: videoUltimoPronto[0] ? s(videoUltimoPronto[0].atualizado_em) : null,
    },
    carteirasBaixas: carteiras.map((c) => ({ cliente: nomes[String(c.client_id)] || "cliente", saldo: Number(c.saldo_usd) || 0 })),
  };
  const motores = montarEstado(entrada);
  return json({ motores, geral: resumoGeral(motores), avisos, conferido_em: new Date(agora).toISOString(), custo_usd: 0 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const ch = await identificar(req);
    return await estado(ch.admin);
  } catch (err) {
    if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
    registrarFalha("motores-estado: erro inesperado", err);
    return json({ error: "erro_interno", mensagem: "Não foi possível montar o estado dos motores agora." }, 500);
  }
});
