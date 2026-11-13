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
 *
 * 13/11/2026: a mesma máquina serve o CRM que as empresas assinam. Com `escopo: "conta"` quem chama é uma
 * pessoa da empresa (produto_membros): a busca fica marcada com a conta, só ela enxerga, o plano diz quantas
 * buscas cabem no mês e se o Google Maps entra, e os escolhidos viram crm_leads. A nota do Jev fica só na casa.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cobrarJev } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import {
  type CandidatoParaImportar,
  chavesDoContato,
  estadoDoJev,
  fatosDoCandidato,
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
const COLUNAS_DA_BUSCA = "id, nicho, cidade, uf, fontes, limite, situacao, erro, encontrados, progresso, campanha_id, entregar_ao_mercurio, criado_por, pego_em, terminado_em, created_at, urls, conta_id, crm_campanha_id";
const COLUNAS_DO_CANDIDATO = "id, busca_id, nome, categoria, site, telefone, whatsapp, email, instagram, endereco, cidade, fonte, fonte_url, evidencias, nota, porque, situacao, lead_id, crm_lead_id, created_at";

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

type ContaDoChamador = { id: string; buscasNoMes: number; googleMaps: boolean; limitePorBusca: number; lugarUsd: number; dolar: number };
type Chamador = { userId: string; conta: ContaDoChamador | null };

/** A pessoa de uma empresa que assina o CRM: a conta dela, em dia, e o que o plano libera. */
async function contaDoChamador(userId: string): Promise<ContaDoChamador> {
  const { data: membro } = await servico().from("produto_membros").select("conta_id").eq("user_id", userId).eq("estado", "ativo").maybeSingle();
  const contaId = (membro as { conta_id?: string } | null)?.conta_id;
  if (!contaId) throw new ErroHttp(403, "sem_conta", "Você ainda não faz parte de uma empresa no CRM.");
  const [{ data: conta }, { data: liberada }, { data: cfg }] = await Promise.all([
    servico().from("produto_contas").select("id, crm_ativo, plano_id").eq("id", contaId).maybeSingle(),
    servico().rpc("produto_conta_liberada", { _conta: contaId }),
    servico().from("produto_config").select("custo_lugar_google_usd, dolar").maybeSingle(),
  ]);
  const c = conta as { id: string; crm_ativo: boolean; plano_id: string } | null;
  if (!c || !c.crm_ativo || liberada !== true) throw new ErroHttp(402, "conta_bloqueada", "O acesso da empresa ao CRM não está liberado. Veja a assinatura.");
  const { data: plano } = await servico().from("produto_planos").select("limites").eq("id", c.plano_id).maybeSingle();
  const l = ((plano as { limites?: Record<string, unknown> } | null)?.limites || {}) as Record<string, unknown>;
  const g = (cfg || {}) as { custo_lugar_google_usd?: number; dolar?: number };
  return {
    id: c.id,
    buscasNoMes: Math.max(0, Math.floor(Number(l.maquina_buscas_mes) || 0)),
    googleMaps: l.maquina_google_maps === true,
    limitePorBusca: Math.max(1, Math.min(300, Math.floor(Number(l.maquina_limite_por_busca) || 50))),
    lugarUsd: Number(g.custo_lugar_google_usd) || 0,
    dolar: Number(g.dolar) || 0,
  };
}

async function identificar(req: Request, escopo: unknown): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  if (escopo === "conta") return { userId, conta: await contaDoChamador(userId) };
  const { data: papeis, error } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  const ok = ((papeis || []) as { role: string }[]).some((p) => p.role === "admin" || p.role === "manager");
  if (!ok) throw new ErroHttp(403, "sem_permissao", "Só o admin e o gestor usam a Máquina de leads.");
  return { userId, conta: null };
}

/** O primeiro dia do mês em São Paulo, para contar as buscas do plano. */
function inicioDoMesEmSaoPaulo(): string {
  const mes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
  return `${mes}-01T00:00:00-03:00`;
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

/** A busca, só se for de quem chama: a da casa para a casa, a da conta para a conta. */
async function lerBusca(id: string, ch: Chamador) {
  const { data, error } = await servico().from("leads_buscas").select(COLUNAS_DA_BUSCA).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler a busca agora.");
  const dona = data ? ((data as Record<string, unknown>).conta_id as string | null) || null : null;
  if (!data || dona !== (ch.conta ? ch.conta.id : null)) throw new ErroHttp(404, "busca_inexistente", "Esta busca não existe mais.");
  return data as Record<string, unknown>;
}

/** Na conta, o lead do candidato é o do CRM da empresa. */
const paraATela = (ch: Chamador, lista: Array<Record<string, unknown>>) =>
  ch.conta ? lista.map((c) => ({ ...c, lead_id: c.crm_lead_id || null })) : lista;

async function lerCandidatos(buscaId: string, ids?: string[]) {
  let q = servico().from("leads_candidatos").select(COLUNAS_DO_CANDIDATO).eq("busca_id", buscaId);
  if (ids && ids.length) q = q.in("id", ids);
  const { data, error } = await q.order("nota", { ascending: false, nullsFirst: false }).order("created_at", { ascending: true }).limit(400);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler os candidatos agora.");
  return (data || []) as Array<Record<string, unknown>>;
}

// ------------------------------------------------------------------ ações

async function listarBuscas(ch: Chamador) {
  const q = servico().from("leads_buscas").select(COLUNAS_DA_BUSCA);
  const { data, error } = await (ch.conta ? q.eq("conta_id", ch.conta.id) : q.is("conta_id", null)).order("created_at", { ascending: false }).limit(60);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui ler as buscas agora.");
  return json({ buscas: data || [] });
}

async function criarBusca(ch: Chamador, corpo: Record<string, unknown>) {
  const r = normalizarBusca(corpo);
  if ("erro" in r) throw new ErroHttp(400, "busca_invalida", r.erro);
  const b = r.busca;
  if (ch.conta) return await criarBuscaDaConta(ch, ch.conta, b);
  // Uma fila educada: no máximo 3 buscas esperando ao mesmo tempo.
  const { count } = await servico().from("leads_buscas").select("id", { count: "exact", head: true }).is("conta_id", null).in("situacao", ["na_fila", "rodando"]);
  if ((count || 0) >= 3) throw new ErroHttp(409, "fila_cheia", "Já há 3 buscas na fila. Espere uma terminar.");
  const { data, error } = await servico()
    .from("leads_buscas")
    .insert({ ...b, criado_por: ch.userId })
    .select(COLUNAS_DA_BUSCA)
    .single();
  if (error) throw new ErroHttp(500, "busca_nao_criada", `A busca não foi criada (${error.message.slice(0, 120)}).`);
  return json({ busca: data });
}

type BuscaNormalizada = Extract<ReturnType<typeof normalizarBusca>, { busca: unknown }>["busca"];

/** A busca de uma empresa: dentro do que o plano dela libera, e com o custo da casa anotado. */
async function criarBuscaDaConta(ch: Chamador, conta: ContaDoChamador, b: BuscaNormalizada) {
  if (conta.buscasNoMes <= 0) throw new ErroHttp(402, "plano_sem_maquina", "O plano da empresa não inclui a Máquina de leads.");
  if (b.fontes.indexOf("google_maps") >= 0 && !conta.googleMaps) throw new ErroHttp(402, "plano_sem_google", "A busca no Google Maps faz parte do plano Pro.");
  const [{ count: noMes }, { count: andando }] = await Promise.all([
    servico().from("leads_buscas").select("id", { count: "exact", head: true }).eq("conta_id", conta.id).neq("situacao", "cancelada").gte("created_at", inicioDoMesEmSaoPaulo()),
    servico().from("leads_buscas").select("id", { count: "exact", head: true }).eq("conta_id", conta.id).in("situacao", ["na_fila", "rodando"]),
  ]);
  if ((noMes || 0) >= conta.buscasNoMes) throw new ErroHttp(402, "limite_do_mes", `As ${conta.buscasNoMes} buscas do mês já foram usadas. O contador zera no dia 1.`);
  if ((andando || 0) >= 1) throw new ErroHttp(409, "fila_cheia", "Já há uma busca em andamento. Espere ela terminar.");
  const limite = Math.min(b.limite, conta.limitePorBusca);
  let campanha: string | null = null;
  if (b.campanha_id) {
    const { data: c } = await servico().from("crm_campaigns").select("id").eq("id", b.campanha_id).eq("conta_id", conta.id).maybeSingle();
    campanha = c ? b.campanha_id : null;
  }
  const { data, error } = await servico()
    .from("leads_buscas")
    .insert({ ...b, limite, campanha_id: null, crm_campanha_id: campanha, entregar_ao_mercurio: false, criado_por: ch.userId, conta_id: conta.id })
    .select(COLUNAS_DA_BUSCA)
    .single();
  if (error) throw new ErroHttp(500, "busca_nao_criada", `A busca não foi criada (${error.message.slice(0, 120)}).`);
  if (b.fontes.indexOf("google_maps") >= 0 && conta.lugarUsd > 0 && conta.dolar > 0) {
    const id = String((data as { id: string }).id);
    const { error: erroDoCusto } = await servico().from("produto_custos").insert({
      conta_id: conta.id,
      competencia: inicioDoMesEmSaoPaulo().slice(0, 10),
      tipo: "maquina_de_leads",
      valor: Math.round(limite * conta.lugarUsd * conta.dolar * 100) / 100,
      descricao: `Google Maps: até ${limite} lugares (${b.nicho} em ${b.cidade})`,
      estimado: true,
      origem_ref: `leads_busca:${id}`,
    });
    if (erroDoCusto) console.error("[comercial-leads] custo não anotado", erroDoCusto.message.slice(0, 160));
  }
  return json({ busca: data });
}

async function cancelarBusca(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  await lerBusca(id, ch);
  const { data, error } = await servico()
    .from("leads_buscas")
    .update({ situacao: "cancelada", terminado_em: new Date().toISOString() })
    .eq("id", id)
    .in("situacao", ["na_fila", "rodando"])
    .select(COLUNAS_DA_BUSCA)
    .maybeSingle();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "Não consegui cancelar agora.");
  return json({ busca: data || (await lerBusca(id, ch)) });
}

async function candidatos(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  const busca = await lerBusca(id, ch);
  return json({ busca, candidatos: paraATela(ch, await lerCandidatos(id)) });
}

async function avaliar(ch: Chamador, corpo: Record<string, unknown>) {
  // A régua de encaixe é a do cliente ideal da casa; não serve para a empresa de outro ramo.
  if (ch.conta) throw new ErroHttp(400, "so_na_casa", "A nota de encaixe ainda não está disponível no CRM da empresa.");
  const id = uuidDe(corpo.busca_id, "busca");
  const busca = await lerBusca(id, ch);
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
  const busca = await lerBusca(id, ch);
  const ids = listaDeIds(corpo.candidato_ids);
  if (!ids.length) throw new ErroHttp(400, "nada_a_importar", "Escolha os candidatos para levar ao CRM.");
  const lista = (await lerCandidatos(id, ids)).filter((c) => c.situacao === "novo");
  const conta = ch.conta;
  const mercurio = conta ? false : typeof corpo.mercurio === "boolean" ? corpo.mercurio : busca.entregar_ao_mercurio === true;
  const tabelaDeLeads = conta ? "crm_leads" : "commercial_leads";
  const colunaDoLead = conta ? "crm_lead_id" : "lead_id";
  // Os leads que já estão no CRM (não arquivados): WhatsApp, e-mail ou nome da empresa iguais.
  const leitura = servico().from(tabelaDeLeads).select("id, name, company, email, whatsapp").is("archived_at", null);
  const { data: existentes } = await (conta ? leitura.eq("conta_id", conta.id) : leitura).limit(5000);
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
      await servico().from("leads_candidatos").update({ situacao: "importado", [colunaDoLead]: ja }).eq("id", String(c.id));
      repetidos.push({ candidato_id: String(c.id), lead_id: ja });
      continue;
    }
    const novo = leadDoCandidato(c as unknown as CandidatoParaImportar, { id, nicho: String(busca.nicho), cidade: String(busca.cidade), uf: (busca.uf as string) || null, campanha_id: ((conta ? busca.crm_campanha_id : busca.campanha_id) as string) || null }, { mercurio, criadoPor: ch.userId });
    // Na conta, o lead nasce com quem buscou como dono: é ele quem vai ligar.
    const { data, error } = await servico().from(tabelaDeLeads).insert(conta ? { ...novo, conta_id: conta.id, owner_id: ch.userId } : novo).select("id").single();
    if (error || !data) {
      console.error("[comercial-leads] lead não criado", error?.message?.slice(0, 160));
      continue;
    }
    const leadId = String((data as { id: string }).id);
    await servico().from("leads_candidatos").update({ situacao: "importado", [colunaDoLead]: leadId }).eq("id", String(c.id));
    const fatos = conta ? [] : fatosDoCandidato(c as unknown as CandidatoParaImportar, leadId);
    if (fatos.length) {
      const { error: erroDosFatos } = await servico().from("commercial_facts").insert(fatos);
      if (erroDosFatos) console.error("[comercial-leads] fatos não gravados", erroDosFatos.message.slice(0, 160));
    }
    await servico().from(conta ? "crm_lead_events" : "commercial_lead_events").insert({ ...(conta ? { conta_id: conta.id } : {}), lead_id: leadId, kind: "nota", note: `Entrou pela Máquina de leads (${busca.nicho} em ${busca.cidade}).${mercurio ? " O Mercúrio faz o primeiro contato." : ""}`, created_by: ch.userId });
    const kk = chavesDoContato({ whatsapp: novo.whatsapp, email: novo.email, company: novo.company });
    if (kk.fone) porFone.set(kk.fone, leadId);
    if (kk.email) porEmail.set(kk.email, leadId);
    if (kk.nome.length >= 5) porNome.set(kk.nome, leadId);
    importados.push({ candidato_id: String(c.id), lead_id: leadId });
  }
  return json({ importados, repetidos });
}

async function descartar(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.busca_id, "busca");
  await lerBusca(id, ch);
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
  return json({ candidatos: paraATela(ch, await lerCandidatos(id)) });
}

type Acao = (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  listar_buscas: (ch) => listarBuscas(ch),
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
      const ch = await identificar(req, corpo.escopo);
      const fn = ACOES[String(corpo.acao ?? "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
      return await fn(ch, corpo);
    } catch (err) {
      return respostaDeErro(err);
    }
  });
}
