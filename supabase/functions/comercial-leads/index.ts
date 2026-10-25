/**
 * Máquina de leads (25/10/2026). Contrato: supabase/migrations/20261025130000_comercial_mercurio_e_maquina_de_leads.sql
 * e 20261025140000_motor_de_leads.sql. Quem busca é o worker "leads" desta casa (workers/leads, Python com
 * Scrapling: OpenStreetMap e o site da própria empresa, robots.txt respeitado, sem disfarce). Aqui:
 *
 *   listar_buscas {}                                   -> { buscas }
 *   criar_busca { nicho, cidade, uf?, fontes?, limite?, campanha_id?, entregar_ao_mercurio?, urls? } -> { busca }
 *   cancelar_busca { busca_id }                        -> { busca }
 *   candidatos { busca_id }                            -> { busca, candidatos }
 *   avaliar { busca_id, candidato_ids?, perfil? }      -> { avaliados, custo_usd }  Jev (Score), cobrado da carteira da agência
 *   importar { busca_id, candidato_ids, mercurio? }    -> { importados, repetidos }  viram commercial_leads (origin maquina_de_leads)
 *   descartar { busca_id, candidato_ids, voltar? }     -> { candidatos }
 *
 * Só admin e manager (o comercial é da casa). Toda pergunta ao Jev é cobrada (cobrarJev).
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cobrarJev } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import {
  type CandidatoParaImportar,
  chavesDoContato,
  estadoDoJev,
  leadDoCandidato,
  normalizarBusca,
  notaDoEncaixe,
  PERFIL_IDEAL_PADRAO,
  perguntasDoJev,
} from "./regras.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...PREFLIGHT_CACHE,
};

/** Candidatos por chamada ao Jev (uma pergunta Score por candidato). */
const JEV_POR_LOTE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUNAS_DA_BUSCA = "id, nicho, cidade, uf, fontes, limite, situacao, erro, encontrados, progresso, campanha_id, entregar_ao_mercurio, criado_por, pego_em, terminado_em, created_at, urls";
const COLUNAS_DO_CANDIDATO = "id, busca_id, nome, categoria, site, telefone, whatsapp, email, instagram, endereco, cidade, fonte, fonte_url, evidencias, nota, porque, situacao, lead_id, created_at";

class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

type Chamador = { userId: string };

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: papeis, error } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  const ok = ((papeis || []) as { role: string }[]).some((p) => p.role === "admin" || p.role === "manager");
  if (!ok) throw new ErroHttp(403, "sem_permissao", "Só o admin e o gestor usam a Máquina de leads.");
  return { userId };
}

/** A carteira que paga o uso da casa: a da agência (empresa interna com mais saldo), como a base dos agentes. */
async function carteiraDaAgencia(): Promise<string | null> {
  const { data } = await servico().from("profiles").select("id").eq("services_config->>internal_company", "true").limit(5);
  const ids = ((data || []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return null;
  const { data: carteiras } = await servico().from("ia_carteiras").select("client_id, saldo_usd").in("client_id", ids).order("saldo_usd", { ascending: false }).limit(1);
  const c = ((carteiras || []) as { client_id: string }[])[0];
  return c ? c.client_id : ids[0];
}

const uuidDe = (v: unknown, nome: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroHttp(400, `${nome}_invalido`, "Escolha a busca de novo.");
  return v;
};
const listaDeIds = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 300) : []);

async function lerBusca(id: string) {
  const { data, error } = await servico().from("leads_buscas").select(COLUNAS_DA_BUSCA).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler a busca agora.");
  if (!data) throw new ErroHttp(404, "busca_inexistente", "Esta busca não existe mais.");
  return data as Record<string, unknown>;
}

async function lerCandidatos(buscaId: string, ids?: string[]) {
  let q = servico().from("leads_candidatos").select(COLUNAS_DO_CANDIDATO).eq("busca_id", buscaId);
  if (ids && ids.length) q = q.in("id", ids);
  const { data, error } = await q.order("nota", { ascending: false, nullsFirst: false }).order("created_at", { ascending: true }).limit(400);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler os candidatos agora.");
  return (data || []) as Array<Record<string, unknown>>;
}

// ------------------------------------------------------------------ ações

async function listarBuscas() {
  const { data, error } = await servico().from("leads_buscas").select(COLUNAS_DA_BUSCA).order("created_at", { ascending: false }).limit(60);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler as buscas agora.");
  return json({ buscas: data || [] });
}

async function criarBusca(ch: Chamador, corpo: Record<string, unknown>) {
  const r = normalizarBusca(corpo);
  if ("erro" in r) throw new ErroHttp(400, "busca_invalida", r.erro);
  const b = r.busca;
  // Uma fila educada: no máximo 3 buscas esperando ao mesmo tempo.
  const { count } = await servico().from("leads_buscas").select("id", { count: "exact", head: true }).in("situacao", ["na_fila", "rodando"]);
  if ((count || 0) >= 3) throw new ErroHttp(409, "fila_cheia", "Já há 3 buscas na fila. Espere uma terminar.");
  const { data, error } = await servico()
    .from("leads_buscas")
    .insert({ ...b, criado_por: ch.userId })
    .select(COLUNAS_DA_BUSCA)
    .single();
  if (error) throw new ErroHttp(500, "busca_nao_criada", `A busca não foi criada (${error.message.slice(0, 120)}).`);
  return json({ busca: data });
}

async function cancelarBusca(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const { data, error } = await servico()
    .from("leads_buscas")
    .update({ situacao: "cancelada", terminado_em: new Date().toISOString() })
    .eq("id", id)
    .in("situacao", ["na_fila", "rodando"])
    .select(COLUNAS_DA_BUSCA)
    .maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui cancelar agora.");
  return json({ busca: data || (await lerBusca(id)) });
}

async function candidatos(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const [busca, lista] = await Promise.all([lerBusca(id), lerCandidatos(id)]);
  return json({ busca, candidatos: lista });
}

async function avaliar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const busca = await lerBusca(id);
  const ids = listaDeIds(corpo.candidato_ids);
  const lista = (await lerCandidatos(id, ids.length ? ids : undefined)).filter((c) => c.situacao !== "descartado").slice(0, 100);
  if (!lista.length) throw new ErroHttp(400, "nada_a_avaliar", "Escolha os candidatos para o Jev avaliar.");
  const pagador = await carteiraDaAgencia();
  if (!pagador) throw new ErroHttp(409, "sem_carteira", "A carteira de IA da agência não foi encontrada.");
  const perfil = typeof corpo.perfil === "string" && corpo.perfil.trim().length > 20 ? corpo.perfil.trim().slice(0, 1500) : PERFIL_IDEAL_PADRAO;
  let custo = 0;
  const avaliados: Array<{ id: string; nota: number | null; porque: string | null }> = [];
  for (let i = 0; i < lista.length; i += JEV_POR_LOTE) {
    const lote = lista.slice(i, i + JEV_POR_LOTE);
    let r;
    try {
      r = await jevPerguntar({
        state: estadoDoJev(perfil, { nicho: String(busca.nicho), cidade: String(busca.cidade) }, lote as never),
        questions: perguntasDoJev(lote.length) as unknown as Record<string, PerguntaJev>,
      });
    } catch (err) {
      const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
      if (!avaliados.length) throw new ErroHttp(502, codigo, "O Jev não respondeu agora. Tente de novo em instantes.");
      break;
    }
    const cobrado = await cobrarJev(r, { clientId: pagador, tarefa: "verificacao", referencia: { tipo: "leads_busca", id }, criadoPor: ch.userId }).catch(() => null);
    custo += cobrado?.custoUsd ?? 0;
    for (let k = 0; k < lote.length; k++) {
      const n = notaDoEncaixe(notaScore(r.answers[`encaixe_${k}`]));
      const cid = String(lote[k].id);
      avaliados.push({ id: cid, nota: n.nota, porque: n.porque });
      if (n.nota != null) await servico().from("leads_candidatos").update({ nota: n.nota, porque: n.porque }).eq("id", cid);
    }
  }
  return json({ avaliados, custo_usd: custo });
}

async function importar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const busca = await lerBusca(id);
  const ids = listaDeIds(corpo.candidato_ids);
  if (!ids.length) throw new ErroHttp(400, "nada_a_importar", "Escolha os candidatos para levar ao CRM.");
  const lista = (await lerCandidatos(id, ids)).filter((c) => c.situacao === "novo");
  const mercurio = typeof corpo.mercurio === "boolean" ? corpo.mercurio : busca.entregar_ao_mercurio === true;
  // Os leads que já estão no CRM (não arquivados): WhatsApp, e-mail ou nome da empresa iguais.
  const { data: existentes } = await servico().from("commercial_leads").select("id, name, company, email, whatsapp").is("archived_at", null).limit(5000);
  const porFone = new Map<string, string>();
  const porEmail = new Map<string, string>();
  const porNome = new Map<string, string>();
  for (const l of (existentes || []) as Array<Record<string, string | null>>) {
    const k = chavesDoContato({ whatsapp: l.whatsapp, email: l.email, company: l.company || l.name });
    if (k.fone) porFone.set(k.fone, String(l.id));
    if (k.email) porEmail.set(k.email, String(l.id));
    if (k.nome.length >= 5) porNome.set(k.nome, String(l.id));
  }
  const importados: Array<{ candidato_id: string; lead_id: string }> = [];
  const repetidos: Array<{ candidato_id: string; lead_id: string }> = [];
  for (const c of lista) {
    const k = chavesDoContato(c as never);
    const ja = (k.fone && porFone.get(k.fone)) || (k.email && porEmail.get(k.email)) || (k.nome.length >= 5 && porNome.get(k.nome)) || null;
    if (ja) {
      await servico().from("leads_candidatos").update({ situacao: "importado", lead_id: ja }).eq("id", String(c.id));
      repetidos.push({ candidato_id: String(c.id), lead_id: ja });
      continue;
    }
    const novo = leadDoCandidato(c as unknown as CandidatoParaImportar, { id, nicho: String(busca.nicho), cidade: String(busca.cidade), uf: (busca.uf as string) || null, campanha_id: (busca.campanha_id as string) || null }, { mercurio, criadoPor: ch.userId });
    const { data, error } = await servico().from("commercial_leads").insert(novo).select("id").single();
    if (error || !data) {
      console.error("[comercial-leads] lead não criado", error?.message?.slice(0, 160));
      continue;
    }
    const leadId = String((data as { id: string }).id);
    await servico().from("leads_candidatos").update({ situacao: "importado", lead_id: leadId }).eq("id", String(c.id));
    await servico().from("commercial_lead_events").insert({ lead_id: leadId, kind: "nota", note: `Entrou pela Máquina de leads (${busca.nicho} em ${busca.cidade}).${mercurio ? " O Mercúrio faz o primeiro contato." : ""}`, created_by: ch.userId });
    const kk = chavesDoContato({ whatsapp: novo.whatsapp, email: novo.email, company: novo.company });
    if (kk.fone) porFone.set(kk.fone, leadId);
    if (kk.email) porEmail.set(kk.email, leadId);
    if (kk.nome.length >= 5) porNome.set(kk.nome, leadId);
    importados.push({ candidato_id: String(c.id), lead_id: leadId });
  }
  return json({ importados, repetidos });
}

async function descartar(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const ids = listaDeIds(corpo.candidato_ids);
  if (!ids.length) throw new ErroHttp(400, "nada_a_descartar", "Escolha os candidatos.");
  const voltar = corpo.voltar === true;
  const { error } = await servico()
    .from("leads_candidatos")
    .update({ situacao: voltar ? "novo" : "descartado" })
    .eq("busca_id", id)
    .in("id", ids)
    .neq("situacao", "importado");
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui mudar os candidatos agora.");
  return json({ candidatos: await lerCandidatos(id) });
}

type Acao = (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  listar_buscas: () => listarBuscas(),
  criar_busca: criarBusca,
  cancelar_busca: cancelarBusca,
  candidatos,
  avaliar,
  importar,
  descartar,
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
  console.error("[comercial-leads] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Máquina de leads." }, 500);
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      let corpo: Record<string, unknown> = {};
      try {
        corpo = await req.json();
      } catch {
        /* corpo vazio */
      }
      const ch = await identificar(req);
      const fn = ACOES[String(corpo.acao ?? "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
      return await fn(ch, corpo);
    } catch (err) {
      return respostaDeErro(err);
    }
  });
}
