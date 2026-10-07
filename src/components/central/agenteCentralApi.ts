/**
 * O painel do agente da Central fala com o servidor por aqui.
 *
 * O servidor (função agente-central) trata UM cliente por chamada; quem
 * conduz a fila é o painel, em lotes pequenos, com progresso na tela.
 *
 * A publicação do ritual no portal segue o fluxo de sempre da Central:
 * rascunho conferido pela fonte do dossiê (persistCentralReviewDraft),
 * publicação por quem tem a carteira, aviso ao cliente, diário, avanços do
 * dossiê e marca no Ciclo. A diferença é o registro de aprovação: a
 * resposta do dono no agente É a aprovação (aprovado_por, aprovado_via).
 */

import { supabase } from "@/integrations/supabase/client";
import { persistCentralReviewDraft, readCentralReviewSource } from "@/lib/centralReviewSource";
import { completarProximoPasso } from "@/lib/ritualTexto";
import { notifyUser } from "@/lib/notifyHelpers";
import { recordMemory } from "@/lib/clientMemory";
import { RITUAL_DA_CENTRAL, atualizarAvancosDoDossie, marcarRitual } from "@/lib/esteira/esteiraAcoes";
import { addDays, localIso, mondayOf } from "@/lib/cycleWeek";
import { avisosDoRitual, resumoDaRepeticao, tarefasSugeridas, type TarefaSugerida } from "./ritualAvisos";
import { corpoDoModelo, escolhaGuardada } from "./modeloDaCentral";

export interface ClienteDoAgente {
  id: string;
  nome: string;
  contato: string;
  dossie_versao: number | null;
  dossie_em: string | null;
}

export interface LeituraDaSemana {
  onde_estamos: string;
  fase: { nome: string; motivo: string; proximo_degrau: string };
  o_que_andou: string[];
  pendencias: string[];
  proximos: Array<{ frente: "social" | "trafego" | "geral"; passo: string }>;
  lacunas: string[];
}

export interface PerguntaDoAgente {
  pergunta: string;
  por_que: string;
}

export interface Preparo {
  client_id: string;
  nome: string;
  contato: string;
  fase: string;
  motivo_da_fase: string;
  leitura: LeituraDaSemana;
  perguntas: PerguntaDoAgente[];
  dossie_versao: number | null;
  dossie_aviso: string | null;
  /** Frente AG3: "Segui: ..." (regras do dono que pesaram na leitura). */
  aprendizado?: unknown[];
}

export interface RitualDoAgente {
  tipo: string;
  title: string | null;
  body: string;
  next_steps: string;
  alertas: string[];
  tarefas_sugeridas: TarefaSugerida[];
  model: string | null;
  repeticao: unknown;
  fase: string | null;
}

export interface Aplicado {
  leitura?: LeituraDaSemana;
  avisos?: string[];
  client_id: string;
  nome: string;
  dossie_versao: number | null;
  dossie_aviso: string | null;
  confirmacoes: string[];
  aprovacao: { por: string; em: string; via: string };
  ritual: RitualDoAgente | null;
  /** Frente LR: motivo quando a IA não escreveu o ritual (null quando escreveu ou não havia ritual). */
  ritual_erro?: string | null;
  /** Frente FS: motivo quando a IA não organizou as respostas (elas entraram como o dono escreveu). */
  ia_erro?: string | null;
  /** Frente AG3: "Aprendi: ..." (com Esquecer ou Guardar) e "Segui: ...". */
  aprendizado?: unknown[];
}

export interface Reescrito {
  ritual: RitualDoAgente | null;
  ritual_erro: string | null;
  aprendizado?: unknown[];
}

async function chamar<T>(body: Record<string, unknown>): Promise<T> {
  // O modelo escolhido na Central (GPT-6 Luna, raciocínio máximo, por padrão) vale também para o agente.
  const { data, error } = await supabase.functions.invoke("agente-central", { body: { ...body, ...corpoDoModelo(escolhaGuardada()) } });
  if (error) {
    // Frente AG3: o motivo do servidor (403, 400 com mensagem) aparece em vez da frase genérica.
    let mensagem = "";
    try {
      const ctx = (error as { context?: { clone?: () => Response } }).context;
      const j = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : null;
      mensagem = j && typeof j.mensagem === "string" ? j.mensagem : j && typeof j.error === "string" ? j.error : "";
    } catch {
      mensagem = "";
    }
    throw new Error(mensagem || "O agente não respondeu agora. Tente de novo.");
  }
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") throw new Error("Resposta vazia do agente.");
  if (typeof d.error === "string") throw new Error(String(d.mensagem || d.error));
  return d as unknown as T;
}

export async function listarClientesDoAgente(): Promise<ClienteDoAgente[]> {
  const r = await chamar<{ clientes: ClienteDoAgente[] }>({ action: "clientes" });
  return Array.isArray(r.clientes) ? r.clientes : [];
}

export function prepararCliente(clientId: string, ritual: string): Promise<Preparo> {
  return chamar<Preparo>({ action: "preparar", client_id: clientId, ritual });
}

export function aplicarRespostas(input: {
  clientId: string; ritual: string; leitura: LeituraDaSemana; perguntas: PerguntaDoAgente[];
  respostas: string[]; contextoExtra: string; envioId?: string; pesquisar?: boolean; dossieVersao?: number | null;
}): Promise<Aplicado> {
  return chamar<Aplicado>({
    action: "aplicar", client_id: input.clientId, ritual: input.ritual, leitura: input.leitura,
    perguntas: input.perguntas, respostas: input.respostas, contexto_extra: input.contextoExtra, envio_id: input.envioId,
    pesquisar: input.pesquisar === true,
    dossie_versao: input.dossieVersao,
  });
}

/**
 * Frente AG3: reescreve o ritual de UM cliente com o dossiê de agora, sem
 * reaplicar as respostas. A instrução do dono manda (e pode virar regra).
 */
export function reescreverRitual(input: { clientId: string; ritual: string; instrucao?: string; anterior?: string }): Promise<Reescrito> {
  return chamar<Reescrito>({
    action: "reescrever", client_id: input.clientId, ritual: input.ritual,
    instrucao: (input.instrucao || "").slice(0, 1500), anterior: (input.anterior || "").slice(0, 4000),
  });
}

const NOME_DO_RITUAL: Record<string, string> = {
  rota_semana: "Rota da semana",
  meio_semana: "Meio da semana",
  prova_movimento: "Prova de movimento",
  radar_aceleriq: "Radar Aceleriq",
  marco_90: "Marco 90",
};

async function projetoDoCliente(clientId: string): Promise<string> {
  const { data, error } = await supabase.from("projects").select("id, status, created_at")
    .eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: true });
  if (error) throw new Error("Não consegui ler os projetos do cliente.");
  const lista = (data ?? []) as Array<{ id: string; status: string | null }>;
  const escolhido = lista.find((p) => p.status !== "done") ?? lista[0];
  if (!escolhido) throw new Error("Cliente sem projeto: crie um projeto para publicar o ritual.");
  return escolhido.id;
}

/**
 * Cria o rascunho (conferido pela fonte) e, se pedido, publica no portal
 * com o fluxo da Central. Devolve o id do relatório e se foi publicado.
 */
export async function salvarEPublicarRitual(input: {
  clientId: string;
  ritual: RitualDoAgente;
  publicar: boolean;
  userId: string;
  /**
   * Frente AG3: rascunho já salvo numa tentativa anterior. Com ele, não nasce
   * outro rascunho: só publica (ou registra o envio no grupo).
   */
  reportId?: string | null;
  /** "grupo" = "Enviei no grupo": registra o envio (Ciclo, diário, dossiê) sem aviso no portal. */
  canal?: "portal" | "grupo";
}): Promise<{ reportId: string; publicado: boolean; avisos: string[] }> {
  const { clientId, ritual, userId } = input;
  const canal = input.canal === "grupo" ? "grupo" : "portal";
  const avisos: string[] = [];
  const projectId = await projetoDoCliente(clientId);
  const agora = new Date();
  const titulo = (ritual.title || `${NOME_DO_RITUAL[ritual.tipo] ?? "Atualização"} · ${agora.toLocaleDateString("pt-BR")}`).slice(0, 80);
  const proximo = completarProximoPasso(ritual.next_steps, ritual.body);
  if (input.reportId) {
    if (!input.publicar) return { reportId: input.reportId, publicado: false, avisos };
    return await publicarRascunho({ id: input.reportId, clientId, projectId, ritual, titulo, proximo, userId, canal, avisos, metrics: null });
  }
  const source = await readCentralReviewSource(clientId);
  const dadosDaIA = ritual as unknown as Record<string, unknown>;
  const metrics: Record<string, unknown> = {
    ritual_type: ritual.tipo,
    written_by: "ai",
    model: ritual.model,
    alertas: avisosDoRitual(dadosDaIA),
    tarefas_sugeridas: tarefasSugeridas(dadosDaIA),
    repeticao: resumoDaRepeticao(dadosDaIA),
    fase_acelera: ritual.fase,
    central_review_source: source,
    central_review_generated_at: agora.toISOString(),
    gerado_por: "agente_central",
    // A resposta do dono no agente é a aprovação: fica registrado quem aprovou.
    aprovado_por: userId,
    aprovado_via: "agente_central",
    aprovado_em: agora.toISOString(),
  };
  const id = crypto.randomUUID();
  await persistCentralReviewDraft({
    id,
    client_id: clientId,
    project_id: projectId,
    status: "draft",
    created_by: userId,
    title: titulo,
    summary: ritual.body,
    next_steps: proximo,
    period_start: localIso(addDays(agora, -7)),
    period_end: localIso(agora),
    metrics: metrics as never,
    internal_notes: "Gerado pelo agente da Central depois das respostas do dono. A resposta no agente é a aprovação.",
  } as never);

  if (!input.publicar) return { reportId: id, publicado: false, avisos };
  return await publicarRascunho({ id, clientId, projectId, ritual, titulo, proximo, userId, canal, avisos, metrics });
}

/**
 * Publica (portal) ou registra o envio (grupo) de um rascunho do agente.
 * Frente AG3: falhar aqui não perde o rascunho: volta publicado=false com o
 * motivo nos avisos e o id, para o "Publicar no portal" tentar só isto de novo.
 */
async function publicarRascunho(p: {
  id: string; clientId: string; projectId: string; ritual: RitualDoAgente; titulo: string; proximo: string;
  userId: string; canal: "portal" | "grupo"; avisos: string[]; metrics: Record<string, unknown> | null;
}): Promise<{ reportId: string; publicado: boolean; avisos: string[] }> {
  const { id, clientId, projectId, ritual, titulo, proximo, userId, canal, avisos } = p;
  let metrics = p.metrics;
  if (!metrics) {
    const { data: atual } = await supabase.from("reports").select("metrics").eq("id", id).maybeSingle();
    metrics = ((atual as { metrics?: Record<string, unknown> } | null)?.metrics ?? {}) as Record<string, unknown>;
  }
  const { error } = await supabase.from("reports").update({
    status: "published",
    summary: ritual.body,
    next_steps: proximo,
    metrics: { ...metrics, sent_channel: canal === "grupo" ? "whatsapp_group" : "portal", sent_at: new Date().toISOString() } as never,
  }).eq("id", id);
  if (error) {
    avisos.push(`Rascunho salvo, mas não ${canal === "grupo" ? "registrado" : "publicado"}: ${error.message}`);
    return { reportId: id, publicado: false, avisos };
  }

  if (canal === "portal") await notifyUser(clientId, `Nova atualização disponível: ${titulo}`, "report", "/onde-estamos");
  const registrou = await recordMemory({
    clientId,
    projectId,
    kind: "ritual",
    title: titulo,
    content: [ritual.body, proximo ? `Próximo passo combinado: ${proximo}` : ""].filter(Boolean).join("\n\n"),
    source: "central",
    tags: [ritual.tipo || "ritual", "agente-central"],
    metadata: { report_id: id, ritual_type: ritual.tipo, written_by: "ai", sent_channel: canal === "grupo" ? "whatsapp_group" : "portal", aprovado_por: userId, aprovado_via: "agente_central" },
    clientVisible: true,
  });
  if (!registrou) avisos.push("Publicado, mas o diário não registrou.");
  await atualizarAvancosDoDossie(clientId);
  const chaveCiclo = RITUAL_DA_CENTRAL[ritual.tipo];
  if (chaveCiclo) {
    await marcarRitual({ clientId, weekStart: localIso(mondayOf(new Date())), ritual: chaveCiclo, feito: true, source: "central", semDiario: true });
  }
  // O combinado vai para o cérebro do cliente (melhor esforço).
  void supabase.functions.invoke("ritual-writer", { body: { action: "memorizar", report_id: id } }).catch(() => undefined);
  return { reportId: id, publicado: true, avisos };
}

/**
 * Tarefa sugerida pelo ritual vira tarefa de verdade só quando alguém da
 * equipe toca em "Criar tarefa": esse toque é a aprovação. Idempotente pela
 * origem (ritual:<relatório>:<n>), nasce com dono, prazo e marco.
 */
export async function criarTarefaDoRitual(input: {
  clientId: string; reportId: string; indice: number; tarefa: TarefaSugerida; userId: string;
}): Promise<"criada" | "ja_existia"> {
  const origem = `ritual:${input.reportId}:${input.indice}`;
  const projectId = await projetoDoCliente(input.clientId);
  const { data: existente } = await supabase.from("tasks").select("id")
    .eq("project_id", projectId).eq("source", origem).is("deleted_at", null).limit(1).maybeSingle();
  if (existente) return "ja_existia";
  const { data: marco } = await supabase.from("milestones").select("id").eq("project_id", projectId)
    .is("deleted_at", null).neq("status", "completed").order("target_date", { ascending: true, nullsFirst: false })
    .limit(1).maybeSingle();
  const t = input.tarefa;
  const { error } = await supabase.from("tasks").insert({
    project_id: projectId,
    milestone_id: (marco as { id?: string } | null)?.id ?? null,
    title: t.titulo,
    description: [t.passo, t.promessa ? `Cumpre o que o ritual combinou: "${t.promessa}"` : ""].filter(Boolean).join("\n\n"),
    status: "backlog",
    kanban_status: "backlog",
    priority: t.prazo_dias <= 2 ? "high" : "medium",
    assigned_to: input.userId,
    due_date: localIso(addDays(new Date(), t.prazo_dias)),
    source: origem,
  } as never);
  if (error) throw new Error("Não foi possível criar a tarefa.");
  await recordMemory({
    clientId: input.clientId,
    kind: "ciclo",
    title: `Ritual virou tarefa: ${t.titulo}`,
    content: `${t.passo}${t.promessa ? ` Cumpre: ${t.promessa}` : ""}`,
    source: "central",
    tags: ["tarefa-do-ritual", t.frente],
    metadata: { report_id: input.reportId, origem, registro: "tarefa_do_ritual", aprovado_por: input.userId },
  });
  return "criada";
}
