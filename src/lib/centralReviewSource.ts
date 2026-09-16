import { supabase } from "@/integrations/supabase/client";
import { lerDossieDoCliente, type DossieDoCliente } from "@/lib/dossieGeral";
import type { Database } from "@/integrations/supabase/types";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { completarProximoPasso } from "@/lib/ritualTexto";

/** Public-safe provenance only. Never put dossier, memory or brain text in reports.metrics. */
export interface CentralReviewSource {
  dossier_id: string | null;
  dossier_version: number | null;
  dossier_updated_at: string | null;
  scope_hash: string;
}

export type CentralGenerationClient = Pick<Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "company_name" | "created_at" | "plan_name" | "plan_status" | "services_config" | "deleted_at">;
export type CentralGenerationProject = Pick<Database["public"]["Tables"]["projects"]["Row"],
  "id" | "client_id" | "name" | "status" | "project_type" | "scope" | "objectives" | "description" | "updated_at" | "deleted_at">;
export interface CentralGenerationScope {
  client: CentralGenerationClient;
  projects: CentralGenerationProject[];
}
export interface CentralGenerationContext extends CentralGenerationScope {
  source: CentralReviewSource;
  dossier: DossieDoCliente;
}

const SOURCE_CHANGED = "O contexto do cliente mudou. Gere uma nova prévia antes de salvar.";
export const CENTRAL_FACTS_LIMIT = 12_000;

/** Keep the legacy feed readable during rollout; new review still requires its RPC/version. */
export async function readCentralReportPage<T>(load: (withReviewVersion: boolean) => PromiseLike<{
  data: T[] | null;
  error: { code?: string; message?: string } | null;
}>) {
  const result = await load(true);
  const missingReviewColumn = ["42703", "PGRST204"].includes(result.error?.code ?? "")
    && /\breview_version\b/i.test(result.error?.message ?? "");
  return missingReviewColumn ? load(false) : result;
}

export function parseCentralReviewSource(value: unknown): CentralReviewSource {
  if (!value || typeof value !== "object") throw new Error("A fonte de revisão não está disponível. Atualize o painel após a implantação do fluxo de revisão.");
  const row = value as Record<string, unknown>;
  if (typeof row.scope_hash !== "string" || !/^[a-f0-9]{64}$/i.test(row.scope_hash)
    || !(row.dossier_id === null || typeof row.dossier_id === "string")
    || !(row.dossier_version === null || (Number.isInteger(row.dossier_version) && Number(row.dossier_version) > 0))
    || !(row.dossier_updated_at === null || (typeof row.dossier_updated_at === "string" && Number.isFinite(Date.parse(row.dossier_updated_at))))) {
    throw new Error("A fonte de revisão retornou dados incompletos. Recarregue antes de gerar.");
  }
  return {
    dossier_id: row.dossier_id as string | null,
    dossier_version: row.dossier_version as number | null,
    dossier_updated_at: row.dossier_updated_at as string | null,
    scope_hash: row.scope_hash,
  };
}

export async function readCentralReviewSource(clientId: string): Promise<CentralReviewSource> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, string>) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc("central_review_source", { _client_id: clientId });
  if (error) throw new Error("Não foi possível conferir a fonte de revisão. Verifique a implantação do fluxo e tente novamente.");
  return parseCentralReviewSource(data);
}

export function sameCentralReviewSource(a: CentralReviewSource, b: CentralReviewSource): boolean {
  return a.scope_hash === b.scope_hash && a.dossier_id === b.dossier_id
    && a.dossier_version === b.dossier_version
    && (a.dossier_updated_at === b.dossier_updated_at || (
      a.dossier_updated_at !== null && b.dossier_updated_at !== null
      && Date.parse(a.dossier_updated_at) === Date.parse(b.dossier_updated_at)
    ));
}

export async function assertCentralReviewSource(
  clientId: string,
  expected: CentralReviewSource,
  readSource = readCentralReviewSource,
): Promise<void> {
  if (!sameCentralReviewSource(expected, await readSource(clientId))) throw new Error(SOURCE_CHANGED);
}

/** Read fresh data directly, then ensure that it belongs to the same source revision. */
export async function captureCentralReviewSource(clientId: string, dependencies = {
  readSource: readCentralReviewSource,
  readDossier: lerDossieDoCliente,
}): Promise<{ source: CentralReviewSource; dossier: DossieDoCliente }> {
  const source = await dependencies.readSource(clientId);
  const dossier = await dependencies.readDossier(clientId);
  const row = dossier.geral;
  if ((row?.id ?? null) !== source.dossier_id || (row?.version ?? null) !== source.dossier_version
    || (row !== null && row.client_id !== clientId)
    || (row?.updated_at ?? null) !== source.dossier_updated_at && !(
      row?.updated_at && source.dossier_updated_at
      && Date.parse(row.updated_at) === Date.parse(source.dossier_updated_at)
    )) throw new Error(SOURCE_CHANGED);
  if (row?.prior_version_id && (!dossier.anterior || dossier.anterior.id !== row.prior_version_id
    || dossier.anterior.client_id !== clientId)) {
    throw new Error("Não foi possível ler a versão anterior do dossiê. Tente novamente antes de gerar a progressão.");
  }
  await assertCentralReviewSource(clientId, source, dependencies.readSource);
  return { source, dossier };
}

async function readCentralGenerationScope(clientId: string): Promise<CentralGenerationScope> {
  const [profile, projects] = await Promise.all([
    supabase.from("profiles").select("id, full_name, company_name, created_at, plan_name, plan_status, services_config, deleted_at")
      .eq("id", clientId).is("deleted_at", null).maybeSingle(),
    supabase.from("projects").select("id, client_id, name, status, project_type, scope, objectives, description, updated_at, deleted_at")
      .eq("client_id", clientId).is("deleted_at", null).order("id"),
  ]);
  if (profile.error || !profile.data || projects.error) {
    throw new Error("Não foi possível ler o escopo atual do cliente. Tente novamente antes de gerar.");
  }
  return { client: profile.data, projects: projects.data ?? [] };
}

/** Scope and complementary dossiers must be read inside the same stable source window. */
export async function captureCentralGenerationContext(clientId: string, dependencies = {
  readSource: readCentralReviewSource, readDossier: lerDossieDoCliente, readScope: readCentralGenerationScope,
}): Promise<CentralGenerationContext> {
  const captured = await captureCentralReviewSource(clientId, dependencies);
  const scope = await dependencies.readScope(clientId);
  if (scope.client.id !== clientId || scope.client.deleted_at
    || scope.projects.some(project => project.client_id !== clientId || project.deleted_at)
    || captured.dossier.outros.some(dossier => dossier.client_id !== clientId)) {
    throw new Error("O contexto retornou dados fora do cliente atual. Recarregue antes de gerar.");
  }
  await assertCentralReviewSource(clientId, captured.source, dependencies.readSource);
  return { ...captured, ...scope };
}

/** Canonical context precedes operational caches/history, before the writer's 12k cut. */
export function centralGenerationFacts(context: CentralGenerationContext, panelFacts: string, history = "", brain = ""): string {
  const services = context.client.services_config;
  const enabled = services && typeof services === "object" && !Array.isArray(services) ? services : {};
  const serviceNames = Object.entries(SERVICE_LABELS).filter(([key]) => enabled[key] === true).map(([, label]) => label);
  const dossier = context.dossier;
  const general = dossier.geral;
  return [
    "BASE ATUAL CAPTURADA PARA ESTE RITUAL: o dossiê geral e o escopo contratado abaixo prevalecem sobre registros anteriores. Projetos complementam o contexto, sem substituir o geral nem criar frentes contratadas. Histórico e segundo cérebro dão continuidade, não redefinem o escopo atual. Não acrescente compromissos de planos antigos sem confirmar nesta base.",
    `Cliente: ${context.client.company_name || context.client.full_name}`,
    `Serviços contratados atuais: ${serviceNames.join(", ") || "nenhuma frente identificada no cadastro; não presumir contratação"}`,
    context.client.plan_name ? `Plano contratado atual: ${context.client.plan_name}` : "",
    general ? `DOSSIÊ ${dossier.substituto ? "DE PROJETO (sem geral cadastrado)" : "GERAL ATUAL"} v${general.version ?? "?"} (${general.updated_at ?? "data não registrada"}):\n${general.content || general.summary || ""}` : "DOSSIÊ: não cadastrado.",
    dossier.mudancas.length ? `O QUE MUDOU DESDE A VERSÃO ANTERIOR (v${dossier.anterior?.version ?? "?"} -> v${general?.version ?? "?"}):\n${dossier.mudancas.map(line => `- ${line}`).join("\n")}` : "",
    dossier.outros.length ? `DOSSIÊS COMPLEMENTARES ATUAIS (não substituem o geral):\n${dossier.outros.map(row => `- Projeto ${row.project_id ?? "geral"}, v${row.version ?? "?"}: ${row.content || row.summary || ""}`).join("\n")}` : "",
    context.projects.length ? `PROJETOS ATUAIS (complemento do escopo contratado, não prova isolada de campanha em operação):\n${context.projects.map(project => [
      `- ${project.name} (${project.project_type}; situação: ${project.status})`,
      project.scope ? `Escopo: ${project.scope}` : "", project.objectives ? `Objetivos: ${project.objectives}` : "",
      project.description ? `Contexto: ${project.description}` : "",
    ].filter(Boolean).join("\n")).join("\n")}` : "",
    panelFacts ? `FATOS OPERACIONAIS DO PAINEL (complemento; não substituem o dossiê e o escopo atuais):\n${panelFacts}` : "",
    history ? `HISTÓRICO RECENTE DESTE CLIENTE (o que já foi dito e decidido; retome somente o que continua válido na base atual):\n${history}` : "",
    brain ? `CONTEXTO DO SEGUNDO CÉREBRO (complemento histórico; não substitui a base atual e nunca cite a fonte ao cliente):\n${brain}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Existing Esteira plans have no source binding. Never carry their promises into a new snapshot. */
export function centralCachedPlanFacts(plan: {
  foco: string; feito: string[]; proximos: Array<{ titulo: string; passo: string }>;
} | null, capturedSource?: CentralReviewSource): string {
  if (capturedSource || !plan) return "";
  return [
    plan.foco ? `PLANO DA SEMANA PELA ESTEIRA — foco: ${plan.foco}` : "",
    plan.feito.length ? `Esteira provou como feito nesta semana: ${plan.feito.join("; ")}` : "",
    plan.proximos.length ? `Próximos passos combinados (traduza para a língua do cliente, nunca como pendência): ${plan.proximos.map(item => `${item.titulo}: ${item.passo}`).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

export async function centralFactsProvenance(facts: string) {
  // Mirror ritual-writer's current JS slice exactly. This hash attests only those facts,
  // not the system prompt, output quality or the freshness of other cached metrics.
  const sent = facts.slice(0, CENTRAL_FACTS_LIMIT);
  const bytes = new TextEncoder().encode(sent);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    facts: sent,
    metadata: {
      facts_sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      facts_characters: sent.length,
      facts_original_characters: facts.length,
      facts_truncated: facts.length > sent.length,
      writer_contract: "ritual-writer:facts-12000:v1",
    },
  };
}

export function applyCentralAiDraft<T extends { summary: string; next_steps: string; title: string; metrics?: Record<string, unknown> }>(
  draft: T, response: { body?: unknown; title?: unknown; next_steps?: unknown; model?: unknown; alertas?: unknown },
): T {
  if (typeof response.body !== "string" || !response.body.trim()) return draft;
  // O proximo passo vem separado quando a IA manda; senao sai do proprio
  // texto (*O que vem agora* / *Precisamos de voce*). Campo vazio travava a
  // aprovacao com "Proximo passo ausente" sem motivo.
  const nextSteps = completarProximoPasso(typeof response.next_steps === "string" ? response.next_steps : "", response.body);
  return {
    ...draft,
    summary: response.body,
    title: typeof response.title === "string" && response.title.trim() ? response.title.slice(0, 80) : draft.title,
    next_steps: nextSteps,
    metrics: {
      ...(draft.metrics || {}), written_by: "ai", model: typeof response.model === "string" ? response.model : null,
      alertas: Array.isArray(response.alertas) ? response.alertas.filter((item): item is string => typeof item === "string").slice(0, 4) : [],
      central_review_next_steps_required: !nextSteps,
    },
  };
}

type DraftInsert = Database["public"]["Tables"]["reports"]["Insert"] & { id: string };
type SavedDraft = Pick<DraftInsert, "id" | "client_id" | "title" | "summary" | "next_steps" | "metrics">;
type WriteError = { code?: string; message?: string } | null;

const draftStorage = {
  insert: async (draft: DraftInsert): Promise<{ error: WriteError }> => supabase.from("reports").insert(draft),
  find: async (id: string): Promise<{ data: SavedDraft | null; error: WriteError }> => supabase.from("reports")
    .select("id, client_id, title, summary, next_steps, metrics").eq("id", id).maybeSingle(),
};

/** A retry reuses the preview UUID; only the exact prior write counts as success. */
export async function persistCentralReviewDraft(draft: DraftInsert, dependencies = {
  readSource: readCentralReviewSource, storage: draftStorage,
}): Promise<void> {
  const metrics = draft.metrics as Record<string, unknown> | null;
  const source = parseCentralReviewSource(metrics?.central_review_source);
  await assertCentralReviewSource(draft.client_id, source, dependencies.readSource);
  const { error } = await dependencies.storage.insert(draft);
  if (error?.code === "23505") {
    const { data: existing, error: readError } = await dependencies.storage.find(draft.id);
    const existingSource = (existing?.metrics as Record<string, unknown> | null)?.central_review_source;
    if (readError || !existing || existing.client_id !== draft.client_id || existing.title !== draft.title
      || existing.summary !== draft.summary || existing.next_steps !== draft.next_steps
      || !sameCentralReviewSource(parseCentralReviewSource(existingSource), source)) {
      throw new Error("A prévia já foi registrada com outra edição. Atualize a fila de revisão.");
    }
  } else if (error) throw new Error("Não foi possível salvar. A prévia foi preservada para tentar novamente.");
}
