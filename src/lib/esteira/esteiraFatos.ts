/**
 * Carrega os fatos da esteira para a carteira inteira: uma consulta por
 * tabela, nunca por cliente. Devolve um mapa clientId -> FatosDoCliente
 * pronto para `montarEsteira`.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  CampanhaFato,
  ChecklistFato,
  EstadoHumano,
  FatosDoCliente,
  MarcoFato,
  PostFato,
  RitualKey,
  TarefaFato,
} from "./esteiraTipos";

interface ClienteBasico {
  id: string;
  created_at?: string | null;
  services_config?: Record<string, unknown> | null;
}

function vazio(c: ClienteBasico): FatosDoCliente {
  const sc = (c.services_config ?? {}) as Record<string, unknown>;
  return {
    clientId: c.id,
    criadoEm: c.created_at ?? null,
    servicos: { social: sc.social === true, trafego: sc.trafego === true },
    posts: [],
    tarefas: [],
    campanhas: [],
    saldoVerba: null,
    checklists: [],
    marcos: [],
    conexoes: [],
    metricas: [],
    briefingRespondido: false,
    dossieResumo: null,
    onboardingHas: {},
    estados: {},
    rituais: [],
    oculto: { areas: [], ate: null },
  };
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

// Mesma regra do Ciclo antigo: lead + conversa iniciada.
function contarLeads(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions as Array<{ action_type?: string; value?: unknown }>) {
    const tipo = String(a?.action_type ?? "").toLowerCase();
    if (tipo.includes("lead") || tipo.includes("messaging_conversation_started")) total += num(a.value);
  }
  return total;
}

export async function lerFatosDaEsteira(
  clientes: ClienteBasico[],
  weekStart: string,
): Promise<Map<string, FatosDoCliente>> {
  const mapa = new Map<string, FatosDoCliente>();
  for (const c of clientes) mapa.set(c.id, vazio(c));
  const ids = clientes.map((c) => c.id);
  if (!ids.length) return mapa;

  const desde14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const desde5sem = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  const db = supabase as any;

  const [posts, projetos, marcos, campanhas, carteira, adsDiario, conexoes, metricas, briefings, dossies, checklists, estados, rituais, prefs] = await Promise.all([
    db.from("editorial_posts").select("id, client_id, title, production_status, primary_file_id, default_caption, created_at, editorial_publications(status, scheduled_at, published_at)").in("client_id", ids).is("archived_at", null),
    db.from("projects").select("id, client_id, tasks(id, status, due_date, assigned_to, title, source)").in("client_id", ids).is("deleted_at", null).is("tasks.deleted_at", null),
    db.from("projects").select("id, client_id, milestones(id, title, status, target_date)").in("client_id", ids).is("deleted_at", null).is("milestones.deleted_at", null),
    db.from("ads_campaigns").select("id, campaign_id, client_id, name, effective_status, status").in("client_id", ids),
    db.from("ads_wallet").select("client_id, balance").in("client_id", ids),
    db.from("ads_campaign_daily").select("client_id, campaign_id, campaign_name, day, spend, actions, frequency").in("client_id", ids).gte("day", desde14),
    db.from("external_account_connections").select("client_id, provider, connection_status").in("client_id", ids),
    db.from("social_metrics_weekly").select("client_id, external_account_id, week_start, reach, followers, total_interactions").in("client_id", ids).gte("week_start", desde5sem),
    db.from("briefings").select("client_id").in("client_id", ids).eq("submitted", true),
    db.from("client_dossiers").select("client_id, summary").in("client_id", ids).eq("is_current", true),
    db.from("project_memory").select("id, client_id, title, metadata").in("client_id", ids).eq("kind", "checklist").order("created_at", { ascending: false }),
    db.from("cycle_item_state").select("client_id, item_key, status, note, done_at").in("client_id", ids).eq("week_start", weekStart),
    db.from("cycle_rituals").select("client_id, ritual_key, source, done_at").in("client_id", ids).eq("week_start", weekStart),
    db.from("cycle_client_prefs").select("client_id, onboarding_has, hidden_areas, hidden_until").in("client_id", ids),
  ]);

  // Aprovacao da arte vive em files; buscamos so os arquivos que sao arte de post.
  const fileIds = Array.from(new Set(((posts.data ?? []) as Array<{ primary_file_id?: string | null }>).map((p) => p.primary_file_id).filter((x): x is string => Boolean(x))));
  const arquivos = fileIds.length
    ? await db.from("files").select("id, approval_status, agency_approval_status, approval_requested_at").in("id", fileIds)
    : { data: [] };
  const arquivoPorId = new Map<string, { approval_status?: string | null; agency_approval_status?: string | null; approval_requested_at?: string | null }>();
  for (const f of (arquivos.data ?? []) as Array<{ id: string }>) arquivoPorId.set(f.id, f as any);

  for (const p of (posts.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(p.client_id));
    if (!s) continue;
    const arq = p.primary_file_id ? arquivoPorId.get(String(p.primary_file_id)) : undefined;
    const post: PostFato = {
      id: String(p.id),
      titulo: String(p.title ?? "Post sem título").replace(/\.(png|jpe?g|mp4|mov)$/i, ""),
      productionStatus: p.production_status ?? null,
      criadoEm: p.created_at ?? null,
      temArte: Boolean(p.primary_file_id),
      aprovCliente: arq?.approval_status ?? null,
      aprovAgencia: arq?.agency_approval_status ?? null,
      aprovPedidaEm: arq?.approval_requested_at ?? null,
      temLegenda: typeof p.default_caption === "string" && p.default_caption.trim().length > 0,
      publicacoes: ((p.editorial_publications ?? []) as Array<Record<string, any>>).filter((x) => x.status !== "cancelled").map((x) => ({ status: String(x.status ?? ""), scheduledAt: x.scheduled_at ?? null, publishedAt: x.published_at ?? null })),
    };
    s.posts.push(post);
  }

  for (const pj of (projetos.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(pj.client_id));
    if (!s) continue;
    for (const t of (pj.tasks ?? []) as Array<Record<string, any>>) {
      const tarefa: TarefaFato = { id: String(t.id), titulo: String(t.title ?? "Tarefa"), status: t.status ?? null, dueDate: t.due_date ?? null, assignedTo: t.assigned_to ?? null, source: t.source ?? null };
      s.tarefas.push(tarefa);
    }
  }

  for (const pj of (marcos.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(pj.client_id));
    if (!s) continue;
    for (const m of (pj.milestones ?? []) as Array<Record<string, any>>) {
      const marco: MarcoFato = { id: String(m.id), titulo: String(m.title ?? "Marco"), status: m.status ?? null, targetDate: m.target_date ?? null };
      s.marcos.push(marco);
    }
  }

  const campPorChave = new Map<string, CampanhaFato>();
  for (const c of (campanhas.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(c.client_id));
    if (!s) continue;
    const idExterno = String(c.campaign_id ?? c.id);
    const camp: CampanhaFato = { id: idExterno, nome: String(c.name ?? "Campanha"), ativa: String(c.effective_status ?? c.status ?? "").toUpperCase() === "ACTIVE", diario: [] };
    s.campanhas.push(camp);
    campPorChave.set(`${c.client_id}:${idExterno}`, camp);
    campPorChave.set(`${c.client_id}:nome:${camp.nome}`, camp);
  }
  for (const d of (adsDiario.data ?? []) as Array<Record<string, any>>) {
    const camp = campPorChave.get(`${d.client_id}:${d.campaign_id}`) ?? campPorChave.get(`${d.client_id}:nome:${d.campaign_name}`);
    if (!camp) continue;
    camp.diario.push({ day: String(d.day), spend: num(d.spend), leads: contarLeads(d.actions), frequency: d.frequency == null ? null : num(d.frequency) });
  }
  for (const w of (carteira.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(w.client_id));
    if (s) s.saldoVerba = w.balance == null ? null : num(w.balance);
  }

  for (const c of (conexoes.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(c.client_id));
    if (s) s.conexoes.push({ provider: String(c.provider ?? ""), status: c.connection_status ?? null });
  }
  for (const m of (metricas.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(m.client_id));
    if (s) s.metricas.push({ accountId: String(m.external_account_id ?? "conta"), weekStart: String(m.week_start), reach: m.reach == null ? null : num(m.reach), followers: m.followers == null ? null : num(m.followers), interactions: m.total_interactions == null ? null : num(m.total_interactions) });
  }
  for (const b of (briefings.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(b.client_id));
    if (s) s.briefingRespondido = true;
  }
  for (const d of (dossies.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(d.client_id));
    if (s && !s.dossieResumo && typeof d.summary === "string") s.dossieResumo = d.summary;
  }
  for (const c of (checklists.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(c.client_id));
    if (!s) continue;
    const itens = Array.isArray(c.metadata?.items) ? (c.metadata.items as Array<{ text?: string; done?: boolean }>) : [];
    if (!itens.length) continue;
    const lista: ChecklistFato = { memId: String(c.id), titulo: String(c.title ?? "Lista"), itens: itens.map((it, idx) => ({ idx, texto: String(it.text ?? ""), done: Boolean(it.done) })) };
    s.checklists.push(lista);
  }
  for (const e of (estados.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(e.client_id));
    if (s) s.estados[String(e.item_key)] = { status: e.status as EstadoHumano, note: e.note ?? null, doneAt: e.done_at ?? null };
  }
  for (const r of (rituais.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(r.client_id));
    if (s) s.rituais.push({ key: r.ritual_key as RitualKey, source: (r.source === "central" ? "central" : "manual"), doneAt: r.done_at ?? null });
  }
  for (const p of (prefs.data ?? []) as Array<Record<string, any>>) {
    const s = mapa.get(String(p.client_id));
    if (!s) continue;
    if (p.onboarding_has && typeof p.onboarding_has === "object") s.onboardingHas = p.onboarding_has as Record<string, boolean>;
    const areas = Array.isArray(p.hidden_areas) ? (p.hidden_areas as string[]) : [];
    const ate = typeof p.hidden_until === "string" ? p.hidden_until : null;
    // Ocultacao "esta semana" vence sozinha quando a data passa.
    const vencida = ate !== null && ate < new Date().toISOString().slice(0, 10);
    s.oculto = vencida ? { areas: [], ate: null } : { areas, ate };
  }

  return mapa;
}
