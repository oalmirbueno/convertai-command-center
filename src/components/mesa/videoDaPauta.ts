import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { chamarMesaVideos, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { handoffWorkspaceFileToFiles, type WorkspaceFileForHandoff } from "@/lib/workspaceFileHandoff";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { loadEditorialPostForMutation } from "@/hooks/useEditorialCalendar";
import { EDITORIAL_DEFAULT_TIME_ZONE, zonedDateTimeLocalToIso } from "@/lib/editorialDate";
import { fonteDoArquivo, type ArteNaAgenda, type ItemDoMes } from "./useItensDoMes";
import type { VideoEscolhido } from "./VideoProntoDaPeca";
import type { VideoProntoDaPeca } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * O vídeo da peça de vídeo do Mês (24/10/2026). Dono: "quando está com vídeo, ele pode ter Por fazer e Pronto
 * também. O botão já vai automaticamente lá para o Workspace, e também já aparece ali para eu ver todo o vídeo
 * depois que o vídeo estiver pronto ... quando eu gravar o vídeo e estiver pronto, já subir, já deixar tudo
 * prontinho, já gerar legenda e já agendar para publicar."
 *
 * - Estado: "pronto" quando a peça tem vídeo final (o guardado no plano, o que já está no post da Agenda ou a
 *   última geração da IA ligada à pauta); senão "a_fazer".
 * - Subir: o envio de sempre (TrazerVideo: Mesa Vídeos ou Workspace) vai para o Workspace do cliente pelo
 *   final_para_workspace da Mesa Vídeos e fica na peça (agente-calendario pauta_video_pronto, sem custo).
 * - Preparar para publicar: Workspace -> Arquivos (o handoff de sempre) -> legenda da casa (estudio-arte
 *   legenda_do_video, custo antes na tela) -> post de Reels na Agenda na data da peça, com a publicação
 *   PLANEJADA (o banco só agenda e o motor só publica com a aprovação) -> pedido de revisão da agência.
 *   Nada vai para a rede sem aprovação. Desfazer arquiva o post que o preparo criou.
 */

export type EstadoDoVideo = "a_fazer" | "pronto";

export interface VideoDaPauta {
  bucket: string;
  caminho: string;
  nome: string;
  duracao_s?: number;
  /** De onde veio: guardado na peça, a geração da IA da pauta ou o post que já está na Agenda. */
  fonte: "peca" | "ia" | "agenda";
  /** Geração da IA: o arquivo da Mesa Vídeos (vai ao Workspace pelo final_para_workspace). */
  arquivo_id?: string;
}

export interface SituacaoDoVideo {
  estado: EstadoDoVideo;
  video: VideoDaPauta | null;
}

/** A Mesa Vídeos guarda no bucket mesa; o Workspace no bucket workspace. */
const BUCKETS = ["mesa", "workspace", "files"];

/** Pronto ou A fazer, e qual vídeo a peça mostra. A peça guardada manda; depois a Agenda; depois a IA. */
export function situacaoDoVideo(item: Pick<ItemDoMes, "video_pronto">, arte: ArteNaAgenda | null | undefined, geracoes: ArquivoDeVideo[] = [], local: VideoProntoDaPeca | null = null): SituacaoDoVideo {
  const guardado = item.video_pronto || local;
  if (guardado && guardado.caminho) {
    return { estado: "pronto", video: { bucket: guardado.bucket, caminho: guardado.caminho, nome: guardado.nome, ...(guardado.duracao_s ? { duracao_s: guardado.duracao_s } : {}), fonte: "peca" } };
  }
  if (arte && arte.capa && arte.capa.tipo_midia === "video") {
    const f = fonteDoArquivo(arte.capa);
    if (f.caminho) return { estado: "pronto", video: { bucket: f.bucket, caminho: f.caminho, nome: arte.capa.nome || arte.titulo || "Vídeo na Agenda", fonte: "agenda" } };
  }
  const ia = geracoes.find((a) => a.estado !== "arquivado" && BUCKETS.indexOf(a.storage_bucket) >= 0 && !!a.storage_path);
  if (ia) return { estado: "pronto", video: { bucket: ia.storage_bucket, caminho: ia.storage_path, nome: ia.nome || ia.nome_original, ...(ia.duracao_s ? { duracao_s: ia.duracao_s } : {}), fonte: "ia", arquivo_id: ia.id } };
  return { estado: "a_fazer", video: null };
}

export const ROTULO_DO_ESTADO: Record<EstadoDoVideo, string> = { a_fazer: "A fazer", pronto: "Pronto" };

/** Só o texto: as falas em ordem, uma por parágrafo (teleprompter); sem fala, o texto na tela. */
export function textoCorrido(r: { blocos: { fala?: string; texto_na_tela?: string }[] } | null | undefined): string {
  if (!r) return "";
  return r.blocos
    .map((b) => String(b.fala || b.texto_na_tela || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ------------------------------------------------------------------ Workspace

const COLUNAS_DO_NO = "id, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id";

async function noPeloId(clientId: string, id: string): Promise<WorkspaceFileForHandoff> {
  const { data, error } = await (supabase as any).from("workspace_nodes").select(COLUNAS_DO_NO).eq("id", id).eq("client_id", clientId).single();
  if (error || !data) throw new Error("Não foi possível conferir o vídeo salvo no Workspace.");
  return data as WorkspaceFileForHandoff;
}

async function noPeloCaminho(clientId: string, caminho: string): Promise<WorkspaceFileForHandoff> {
  const { data, error } = await (supabase as any).from("workspace_nodes").select(COLUNAS_DO_NO).eq("client_id", clientId).eq("storage_path", caminho).limit(1).maybeSingle();
  if (error || !data) throw new Error("O vídeo não está mais no Workspace do cliente.");
  return data as WorkspaceFileForHandoff;
}

/** O vídeo do acervo da Mesa Vídeos vai para o Workspace do cliente (a mesma ação do Entregar de sempre). */
async function arquivoParaOWorkspace(clientId: string, arquivoId: string): Promise<WorkspaceFileForHandoff> {
  const r = await chamarMesaVideos<{ client_id: string; workspace: { node_id: string | null } }>({ acao: "final_para_workspace", arquivo_id: arquivoId });
  if (!r || r.client_id !== clientId || !r.workspace || !r.workspace.node_id) throw new Error("O vídeo ainda não foi confirmado no Workspace.");
  return noPeloId(clientId, r.workspace.node_id);
}

/**
 * Subir: o vídeo escolhido (enviado agora ou do Workspace) fica no Workspace do cliente e vira o vídeo pronto
 * da peça. Devolve o que a peça guarda (sempre bucket workspace quando deu para levar).
 */
export async function levarAoWorkspace(clientId: string, v: VideoEscolhido): Promise<VideoProntoDaPeca> {
  if (v.bucket === "workspace") return { bucket: "workspace", caminho: v.caminho, nome: v.nome, ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}), em: new Date().toISOString() };
  if (!v.arquivo_id) throw new Error("O vídeo subiu, mas o registro no acervo não voltou. Tente enviar de novo.");
  const no = await arquivoParaOWorkspace(clientId, v.arquivo_id);
  return { bucket: "workspace", caminho: String(no.storage_path), nome: v.nome || no.name, ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}), em: new Date().toISOString() };
}

/** Guarda (ou tira) o vídeo pronto na peça. sem_plano: a pauta não veio do Mês e a tela guarda só aqui. */
export async function guardarVideoDaPauta(clientId: string, taskId: string, video: VideoProntoDaPeca | null): Promise<{ guardado: boolean }> {
  try {
    await chamarFuncao("agente-calendario", { acao: "pauta_video_pronto", client_id: clientId, task_id: taskId, video: video ? { bucket: video.bucket, caminho: video.caminho, nome: video.nome, ...(video.duracao_s ? { duracao_s: video.duracao_s } : {}) } : null });
    return { guardado: true };
  } catch (e) {
    const codigo = e && typeof e === "object" ? (e as { codigo?: string; code?: string }).codigo || (e as { code?: string }).code : "";
    if (codigo === "sem_plano" || /plano do Mês/.test(e instanceof Error ? e.message : "")) return { guardado: false };
    throw e;
  }
}

// ------------------------------------------------------------------ preparar para publicar

export interface LegendaDoVideo {
  legenda: string;
  hashtags: string[];
  custo_usd?: number;
  com_roteiro?: boolean;
}

/** A legenda da casa para o Reels da peça (estudio-arte legenda_do_video, com o roteiro da tarefa). */
export const legendaDoVideo = (clientId: string, taskId: string) => chamarFuncao<LegendaDoVideo>("estudio-arte", { acao: "legenda_do_video", client_id: clientId, task_id: taskId });

/** Legenda pronta para o post: o texto e as hashtags no fim (como a entrega do Estúdio). */
export function legendaComHashtags(l: Pick<LegendaDoVideo, "legenda" | "hashtags">): string {
  const tags = (l.hashtags || []).filter(Boolean).join(" ");
  return [String(l.legenda || "").trim(), tags].filter(Boolean).join("\n\n");
}

/** Data e hora da publicação planejada: o dia da peça no horário do cliente; dia que já passou fica sem data. */
export function horarioDaPeca(dia: string | null | undefined, hora: string, hoje: string): string | null {
  const d = String(dia || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < hoje) return null;
  const h = /^\d{2}:\d{2}/.test(hora) ? hora.slice(0, 5) : "18:00";
  return zonedDateTimeLocalToIso(`${d}T${h}`, EDITORIAL_DEFAULT_TIME_ZONE);
}

const hojeLocal = () => {
  const d = new Date();
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
};

async function horaDoCliente(clientId: string): Promise<string> {
  try {
    const { data } = await (supabase as any).from("mesa_cliente_config").select("hora_publicacao").eq("client_id", clientId).maybeSingle();
    return data && data.hora_publicacao ? String(data.hora_publicacao).slice(0, 5) : "18:00";
  } catch {
    return "18:00";
  }
}

/** A conta do Instagram do projeto (a que o motor publica); sem ela, o post fica sem plano de publicação. */
async function contaDoInstagram(clientId: string, projectId: string): Promise<string | null> {
  const db = supabase as any;
  const { data: ligadas } = await db.from("project_external_accounts").select("external_account_id").eq("client_id", clientId).eq("project_id", projectId);
  const ids = ((ligadas || []) as { external_account_id: string }[]).map((l) => l.external_account_id);
  if (!ids.length) return null;
  const { data: contas } = await db.from("external_accounts").select("id, platform, status").eq("client_id", clientId).in("id", ids).eq("status", "active");
  const ig = ((contas || []) as { id: string; platform: string }[]).find((c) => c.platform === "instagram");
  return ig ? ig.id : null;
}

/** O post vivo da tarefa na Agenda (o mais novo, não arquivado). */
async function postDaTarefa(clientId: string, taskId: string) {
  const { data, error } = await (supabase as any).from("editorial_post_internal").select("post_id").eq("task_id", taskId);
  if (error) throw error;
  const posts = await Promise.all(((data || []) as { post_id: string }[]).map((v) => loadEditorialPostForMutation(v.post_id, clientId).catch(() => null)));
  return posts.filter((p): p is NonNullable<typeof p> => !!p && !p.post.archived_at).sort((a, b) => b.post.created_at.localeCompare(a.post.created_at))[0] || null;
}

export interface ResultadoDoPreparo {
  post_id: string;
  versao: number;
  /** O preparo criou o post (o Desfazer arquiva); false: atualizou o que já existia. */
  criado: boolean;
  file_id: string;
  /** ISO da publicação planejada; null: sem data (dia passado) ou sem conta do Instagram. */
  agendado_para: string | null;
  sem_conta: boolean;
  revisao_pedida: boolean;
  legenda: string;
}

/**
 * Workspace -> Arquivos -> post de Reels na Agenda com a legenda e a data da peça, publicação planejada (o
 * banco agenda quando a aprovação chegar) e o pedido de revisão da agência. Nunca publica.
 */
export async function prepararParaPublicar(p: {
  clientId: string;
  userId: string;
  item: Pick<ItemDoMes, "id" | "title" | "due_date" | "project_id" | "delivery_type">;
  video: VideoDaPauta;
  legenda: string;
}): Promise<ResultadoDoPreparo> {
  const { clientId, userId, item, video } = p;
  let no: WorkspaceFileForHandoff;
  if (video.bucket === "workspace") no = await noPeloCaminho(clientId, video.caminho);
  else if (video.arquivo_id) no = await arquivoParaOWorkspace(clientId, video.arquivo_id);
  else if (video.fonte === "agenda") throw new Error("Este vídeo já está na Agenda. Para trocar, suba o vídeo novo na peça.");
  else throw new Error("O vídeo não está no acervo nem no Workspace. Suba de novo na peça.");
  const arquivo = await handoffWorkspaceFileToFiles({ node: no, clientId, userId, fileName: item.title, folder: "materiais", fileType: "creative", projectId: item.project_id });
  const [atual, hora, conta] = await Promise.all([postDaTarefa(clientId, item.id), horaDoCliente(clientId), contaDoInstagram(clientId, item.project_id)]);
  const quando = horarioDaPeca(item.due_date, hora, hojeLocal());
  // Post da tarefa com outro arquivo vira revisão (nunca sobrescreve um material já aprovado).
  const revisar = !!atual && !!atual.post.primary_file_id && atual.post.primary_file_id !== arquivo.fileId;
  const mesmo = atual && !revisar ? atual : null;
  const tipo = item.delivery_type === "short" ? "short" : "reel";
  const planejadas = mesmo ? mesmo.publications.filter((x) => x.publication.status === "planned") : [];
  const publicacoes: Record<string, unknown>[] = planejadas.map(({ publication, internal }) => ({
    id: publication.id,
    idempotency_key: (internal && internal.idempotency_key) || crypto.randomUUID(),
    external_account_id: publication.external_account_id,
    file_id: publication.file_id,
    caption: p.legenda,
    first_comment: publication.first_comment,
    alt_text: publication.alt_text,
    scheduled_at: publication.scheduled_at || quando,
    scheduled_timezone: publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
  }));
  const vivas = mesmo ? mesmo.publications.filter((x) => ["planned", "scheduled", "failed", "published"].indexOf(x.publication.status) >= 0) : [];
  if (!vivas.length && conta) {
    publicacoes.push({
      id: null,
      idempotency_key: crypto.randomUUID(),
      external_account_id: conta,
      file_id: null,
      caption: p.legenda,
      first_comment: null,
      alt_text: null,
      asset_file_ids: [],
      // Sem aprovação a publicação fica planejada com a data; o banco só agenda quando o material é aprovado.
      delivery_mode: "manual",
      scheduled_at: quando,
      scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
    });
  }
  const { data, error } = await (supabase as any).rpc("save_editorial_post", {
    p_payload: {
      id: mesmo ? mesmo.post.id : null,
      idempotency_key: (mesmo && mesmo.internal && mesmo.internal.idempotency_key) || `mesa-video:${item.id}:${arquivo.fileId}`,
      mutation_id: crypto.randomUUID(),
      client_id: clientId,
      project_id: item.project_id,
      primary_file_id: arquivo.fileId,
      title: item.title,
      content_type: mesmo ? mesmo.post.content_type : tipo,
      objective: mesmo ? mesmo.post.objective : null,
      default_caption: p.legenda,
      production_status: mesmo ? mesmo.post.production_status : "draft",
      task_id: item.id,
      responsible_id: mesmo && mesmo.internal ? mesmo.internal.responsible_id : null,
      internal_notes: mesmo && mesmo.internal ? mesmo.internal.internal_notes : null,
      revision_of_post_id: revisar && atual ? atual.post.id : mesmo && mesmo.internal ? mesmo.internal.revision_of_post_id : null,
      publications: publicacoes,
    },
    p_expected_version: mesmo ? mesmo.post.version : null,
  });
  if (error || !data) throw new Error((error && error.message) || "Não foi possível criar o post na Agenda.");
  const salvo = data as { post_id: string; version: number };
  let revisao = false;
  try {
    await requestFileAgencyReview(arquivo.fileId);
    revisao = true;
  } catch {
    // Já em revisão ou aprovado: segue como está (a aprovação continua sendo a do fluxo de sempre).
  }
  const agendada = publicacoes.length ? (publicacoes[publicacoes.length - 1].scheduled_at as string | null) : vivas.length ? vivas[0].publication.scheduled_at : null;
  return { post_id: salvo.post_id, versao: salvo.version, criado: !mesmo, file_id: arquivo.fileId, agendado_para: agendada || null, sem_conta: !conta && !vivas.length, revisao_pedida: revisao, legenda: p.legenda };
}

/** Desfazer o preparo: arquiva o post que ele criou (o vídeo continua no Workspace e em Arquivos). */
export async function desfazerPreparo(r: Pick<ResultadoDoPreparo, "post_id" | "versao" | "criado">): Promise<void> {
  if (!r.criado) throw new Error("O post já existia antes: mude pela Agenda.");
  const { error } = await (supabase as any).rpc("archive_editorial_post", { p_post_id: r.post_id, p_expected_version: r.versao });
  if (error) throw new Error(error.message || "Não foi possível desfazer.");
}

/** Uma frase do estado depois do preparo. */
export function textoDoPreparo(r: Pick<ResultadoDoPreparo, "agendado_para" | "sem_conta">): string {
  if (r.sem_conta) return "Na Agenda, sem conta do Instagram no projeto: ligue a conta pelo card para agendar.";
  if (!r.agendado_para) return "Na Agenda, sem data (o dia da peça já passou): escolha o horário pelo card.";
  const d = new Date(r.agendado_para);
  const quando = d.toLocaleString("pt-BR", { timeZone: EDITORIAL_DEFAULT_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Agendado para ${quando}, aguardando aprovação.`;
}
