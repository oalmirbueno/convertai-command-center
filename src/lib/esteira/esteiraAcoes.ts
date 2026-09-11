/**
 * Acoes sobre a esteira. Toda acao humana grava em dois lugares: no estado
 * da semana (cycle_item_state / cycle_rituals / cycle_client_prefs) e no
 * diario do cliente (project_memory), para a historia e o dossie verem.
 * Nada aqui inventa fato: o item continua derivado do estado real.
 */

import { supabase } from "@/integrations/supabase/client";
import { recordMemory } from "@/lib/clientMemory";
import type { EstadoHumano, EsteiraItem, RitualKey } from "./esteiraTipos";
import { ONBOARDING, RITUAIS } from "./esteiraMontar";

async function quemSou(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const ROTULO_ESTADO: Record<EstadoHumano, string> = {
  done: "Feito",
  snoozed: "Adiado para a próxima semana",
  ignored: "Ignorado",
};

/** Marca um item da esteira. `undefined` em status desfaz a marcacao. */
export async function marcarItem(input: {
  item: EsteiraItem;
  weekStart: string;
  status: EstadoHumano | undefined;
  note?: string | null;
}): Promise<boolean> {
  const { item, weekStart, status, note } = input;
  const db = supabase as any;
  if (!status) {
    const { error } = await db
      .from("cycle_item_state")
      .delete()
      .eq("client_id", item.clientId)
      .eq("week_start", weekStart)
      .eq("item_key", item.key);
    if (error) return false;
    await recordMemory({
      clientId: item.clientId,
      kind: "ciclo",
      title: `Desfeito · ${item.titulo}`,
      content: `${item.passo}. Marcação desfeita.`,
      source: "esteira",
      metadata: { item_key: item.key, week_start: weekStart, acao: "undo" },
    });
    return true;
  }
  const uid = await quemSou();
  const { error } = await db.from("cycle_item_state").upsert(
    { client_id: item.clientId, week_start: weekStart, item_key: item.key, status, note: note ?? null, done_by: uid, done_at: new Date().toISOString() },
    { onConflict: "client_id,week_start,item_key" },
  );
  if (error) return false;

  // O diario recebe o fato com o nome do item; o dossie le o diario.
  await recordMemory({
    clientId: item.clientId,
    kind: status === "done" ? (item.fonte === "onboarding" ? "marco" : "ciclo") : "ciclo",
    title: `${ROTULO_ESTADO[status]} · ${item.titulo}`,
    content: [item.passo, ...item.fatos, note ? `Obs: ${note}` : ""].filter(Boolean).join(" · "),
    source: "esteira",
    metadata: { item_key: item.key, week_start: weekStart, fonte: item.fonte, acao: status },
  });

  // Passo de onboarding feito e para sempre: guarda em "ja tem".
  if (status === "done" && item.fonte === "onboarding") {
    await marcarJaTem(item.clientId, item.key.replace(/^onb:/, ""), true);
  }
  // Item de checklist feito marca o proprio checklist tambem.
  if (status === "done" && item.fonte === "checklist" && item.key.startsWith("check:")) {
    await concluirItemDeChecklist(item.key);
  }
  // Todo feito e progressao: o dossie reescreve os avancos na hora, para a
  // Central e a proxima leitura da IA partirem do ponto novo.
  if (status === "done") await atualizarAvancosDoDossie(item.clientId);
  return true;
}

async function concluirItemDeChecklist(key: string): Promise<void> {
  const [, memId, idxStr] = key.split(":");
  const idx = Number(idxStr);
  if (!memId || Number.isNaN(idx)) return;
  const db = supabase as any;
  const { data } = await db.from("project_memory").select("id, metadata").eq("id", memId).maybeSingle();
  const itens = Array.isArray(data?.metadata?.items) ? [...data.metadata.items] : [];
  if (!itens[idx]) return;
  itens[idx] = { ...itens[idx], done: true, done_at: new Date().toISOString() };
  await db.from("project_memory").update({ metadata: { ...(data.metadata ?? {}), items: itens } }).eq("id", memId);
}

/** "Ja tem": o cliente ja possui este passo de onboarding (ou nao). Vai para
    o diario como marco e pede ao dossie para reescrever os avancos, para a
    Central enxergar sem ninguem digitar. */
export async function marcarJaTem(clientId: string, passo: string, tem: boolean): Promise<boolean> {
  const db = supabase as any;
  const uid = await quemSou();
  const { data } = await db.from("cycle_client_prefs").select("onboarding_has").eq("client_id", clientId).maybeSingle();
  const atual = (data?.onboarding_has && typeof data.onboarding_has === "object") ? { ...data.onboarding_has } : {};
  const antes = atual[passo];
  atual[passo] = tem;
  const { error } = await db.from("cycle_client_prefs").upsert(
    { client_id: clientId, onboarding_has: atual, updated_by: uid, updated_at: new Date().toISOString() },
    { onConflict: "client_id" },
  );
  if (error) return false;
  if (antes !== tem) {
    const rotulo = ONBOARDING.find((p) => p.key === passo)?.rotulo ?? passo;
    await recordMemory({
      clientId,
      kind: "marco",
      title: tem ? `Já tem · ${rotulo}` : `Ainda não tem · ${rotulo}`,
      content: tem ? `${rotulo} confirmado como existente.` : `${rotulo} marcado como pendente.`,
      source: "esteira",
      metadata: { onboarding: passo, tem },
    });
    await atualizarAvancosDoDossie(clientId);
  }
  return true;
}

/** Pede ao banco para reescrever a secao automatica de avancos do dossie.
    Best-effort: se a funcao nao existir ou falhar, nada quebra. */
export async function atualizarAvancosDoDossie(clientId: string): Promise<void> {
  try { await (supabase as any).rpc("dossie_registrar_avancos", { _client_id: clientId }); } catch { /* silencioso */ }
}

export interface PlanoDaSemana {
  foco: string;
  feito: string[];
  proximos: Array<{ titulo: string; passo: string; motivo: string; frente?: "social" | "trafego" | "geral" }>;
  /** O que o dossie ou o painel nao dizem e a esteira precisaria (para a equipe). */
  lacunas: string[];
  source: string;
  cached: boolean;
  generated_at?: string;
}

/** Plano da semana lido do dossie e da historia (funcao esteira-semana). */
export async function lerPlanoDaSemana(clientId: string, weekStart: string, refresh = false): Promise<PlanoDaSemana | null> {
  const { data, error } = await supabase.functions.invoke("esteira-semana", { body: { client_id: clientId, week_start: weekStart, refresh } });
  if (error || !data || (data as any).error) return null;
  const d = data as any;
  return { foco: String(d.foco ?? ""), feito: Array.isArray(d.feito) ? d.feito : [], proximos: Array.isArray(d.proximos) ? d.proximos : [], lacunas: Array.isArray(d.lacunas) ? d.lacunas.map((x: unknown) => String(x)) : [], source: String(d.source ?? ""), cached: Boolean(d.cached), generated_at: d.generated_at };
}

/** Item da esteira nascido do plano do dossie (chave estavel pelo titulo). */
export function itemDoPlano(clientId: string, p: { titulo: string; passo: string; motivo: string; frente?: "social" | "trafego" | "geral" }): EsteiraItem {
  const slug = p.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
  // A frente vem do plano: passo de trafego nao aparece na aba Social, e vice-versa.
  const frente = p.frente === "social" || p.frente === "trafego" ? p.frente : "geral";
  return { key: `dossie:${slug}`, clientId, frente, fonte: "checklist", titulo: p.titulo, passo: p.passo, gravidade: "normal", fatos: p.motivo ? [p.motivo] : [] };
}

/** Oculta ou volta a mostrar o cliente numa frente. `ateQuando` null = sempre. */
export async function ocultarCliente(input: { clientId: string; area: "social" | "trafego"; ocultar: boolean; ateQuando?: string | null }): Promise<boolean> {
  const db = supabase as any;
  const uid = await quemSou();
  const { data } = await db.from("cycle_client_prefs").select("hidden_areas, hidden_until").eq("client_id", input.clientId).maybeSingle();
  const areas = new Set<string>(Array.isArray(data?.hidden_areas) ? data.hidden_areas : []);
  if (input.ocultar) areas.add(input.area); else areas.delete(input.area);
  const { error } = await db.from("cycle_client_prefs").upsert(
    { client_id: input.clientId, hidden_areas: Array.from(areas), hidden_until: input.ocultar ? (input.ateQuando ?? null) : (areas.size ? data?.hidden_until ?? null : null), updated_by: uid, updated_at: new Date().toISOString() },
    { onConflict: "client_id" },
  );
  return !error;
}

/** Ritual da semana marcado (ou desmarcado) para um cliente. */
export async function marcarRitual(input: { clientId: string; weekStart: string; ritual: RitualKey; feito: boolean; source?: "manual" | "central"; semDiario?: boolean }): Promise<boolean> {
  const db = supabase as any;
  const rotulo = RITUAIS.find((r) => r.key === input.ritual)?.rotulo ?? input.ritual;
  if (!input.feito) {
    const { error } = await db.from("cycle_rituals").delete().eq("client_id", input.clientId).eq("week_start", input.weekStart).eq("ritual_key", input.ritual);
    return !error;
  }
  const uid = await quemSou();
  const { error } = await db.from("cycle_rituals").upsert(
    { client_id: input.clientId, week_start: input.weekStart, ritual_key: input.ritual, source: input.source ?? "manual", done_by: uid, done_at: new Date().toISOString() },
    { onConflict: "client_id,week_start,ritual_key" },
  );
  if (error) return false;
  // A Central ja grava o ritual no diario com o texto enviado; nao duplicar.
  if (input.semDiario) return true;
  await recordMemory({
    clientId: input.clientId,
    kind: "ritual",
    title: `Ritual · ${rotulo}`,
    content: input.source === "central" ? "Gerado na Central." : "Marcado no Ciclo.",
    source: "esteira",
    metadata: { ritual: input.ritual, week_start: input.weekStart },
  });
  return true;
}

/** Nota livre no diario do cliente a partir de um item. */
export async function anotarNoDiario(item: EsteiraItem, texto: string): Promise<boolean> {
  const t = texto.trim();
  if (!t) return false;
  return recordMemory({
    clientId: item.clientId,
    kind: "nota",
    title: item.titulo,
    content: t,
    source: "esteira",
    metadata: { item_key: item.key, fonte: item.fonte },
  });
}

/** Tipo de ritual da Central -> chave do Ciclo. */
export const RITUAL_DA_CENTRAL: Record<string, RitualKey> = {
  rota_semana: "segunda",
  meio_semana: "quarta",
  prova_movimento: "sexta",
};

/** Texto pronto para copiar (WhatsApp / mensagem ao cliente). */
export function textoDoItem(item: EsteiraItem): string {
  const linhas = [`${item.titulo}: ${item.passo}`, ...item.fatos];
  return linhas.join("\n");
}
