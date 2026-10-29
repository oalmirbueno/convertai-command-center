import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { chamarMesaVideos, hashDoArquivo, subirVideos, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { handoffWorkspaceFileToFiles, type WorkspaceFileForHandoff } from "@/lib/workspaceFileHandoff";
import { aprovarPeloCliente, NOTA_DO_AVAL, requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { loadEditorialPostForMutation } from "@/hooks/useEditorialCalendar";
import { entregaDaArteAprovada } from "@/lib/editorialEntregaAprovada";
import type { ModoDeEntrega } from "@/lib/mesa/entregaComOpcoes";
import { EDITORIAL_DEFAULT_TIME_ZONE, zonedDateTimeLocalToIso } from "@/lib/editorialDate";
import { fonteDoArquivo, type ArteNaAgenda, type ItemDoMes } from "./useItensDoMes";
import { extrairQuadrosNasFracoes, subirQuadro } from "@/lib/mesa-videos/quadros";
import { transcreverMidia } from "@/lib/editor/fala";
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
  if (v.bucket === "workspace") return { bucket: "workspace", caminho: v.caminho, nome: v.nome, ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}), ...(v.arquivo_id ? { arquivo_id: v.arquivo_id } : {}), em: new Date().toISOString() };
  if (!v.arquivo_id) throw new Error("O vídeo subiu, mas o registro no acervo não voltou. Tente enviar de novo.");
  const no = await arquivoParaOWorkspace(clientId, v.arquivo_id);
  return { bucket: "workspace", caminho: String(no.storage_path), nome: v.nome || no.name, ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}), arquivo_id: v.arquivo_id, em: new Date().toISOString() };
}

/**
 * 27/10/2026 (dono: "o vídeo está Pronto e a aba Legendar diz que a legenda fica disponível quando o vídeo estiver
 * pronto"): legendar, trilha, cortar e a entrega da prancheta trabalham pelo registro no acervo da Mesa Vídeos.
 * O vídeo Pronto da peça que mora só no Workspace ganha esse registro: primeiro procura o que já existe (o final
 * que a Mesa Vídeos levou a este caminho do Workspace, ou o mesmo conteúdo pelo SHA-256); sem nada, copia o
 * arquivo para o acervo pelo envio de sempre (Storage da Mesa + arquivo_registrar). Devolve o id do acervo.
 */
export async function garantirVideoNoAcervo(clientId: string, pronto: Pick<VideoProntoDaPeca, "bucket" | "caminho" | "nome">): Promise<string> {
  const db = supabase as any;
  const ativo = (q: any) => q.eq("client_id", clientId).eq("estado", "ativo").order("criado_em", { ascending: false }).limit(1);
  const { data: final } = await ativo(db.from("video_arquivos").select("id").eq("origem->workspace->>storage_path", pronto.caminho));
  const achado = ((final || []) as { id: string }[])[0];
  if (achado) return achado.id;
  const { data: blob, error } = await supabase.storage.from(pronto.bucket).download(pronto.caminho);
  if (error || !blob) throw new Error("Não foi possível ler o vídeo da peça no Workspace.");
  const arquivo = new File([blob], pronto.nome || pronto.caminho.split("/").pop() || "video.mp4", { type: blob.type || "video/mp4" });
  const sha = await hashDoArquivo(arquivo);
  const pelaHash = async () => {
    if (!sha) return null;
    const { data } = await ativo(db.from("video_arquivos").select("id").eq("sha256", sha));
    return ((data || []) as { id: string }[])[0] || null;
  };
  const igual = await pelaHash();
  if (igual) return igual.id;
  const r = await subirVideos(clientId, [arquivo], () => undefined);
  if (r.registrados[0]) return r.registrados[0].id;
  const repetido = r.duplicados.length ? await pelaHash() : null;
  if (repetido) return repetido.id;
  throw new Error((r.recusados[0] && r.recusados[0].motivo) || r.aviso || "O vídeo não entrou no acervo da Mesa Vídeos.");
}

/** Guarda (ou tira) o vídeo pronto na peça. sem_plano: a pauta não veio do Mês e a tela guarda só aqui. */
export async function guardarVideoDaPauta(clientId: string, taskId: string, video: VideoProntoDaPeca | null): Promise<{ guardado: boolean }> {
  try {
    await chamarFuncao("agente-calendario", { acao: "pauta_video_pronto", client_id: clientId, task_id: taskId, video: video ? { bucket: video.bucket, caminho: video.caminho, nome: video.nome, ...(video.duracao_s ? { duracao_s: video.duracao_s } : {}), ...(video.arquivo_id ? { arquivo_id: video.arquivo_id } : {}) } : null });
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
  /** 29/10/2026: a legenda saiu do que o vídeo mostra (quadros e fala assistidos). */
  pelo_video?: boolean;
  o_que_o_video_mostra?: string;
}

/**
 * A legenda da casa para o Reels da peça (estudio-arte legenda_do_video). 29/10/2026 (dono: "tem vídeo que não está
 * no roteiro; ele tem que assistir o vídeo e entender para gerar a legenda"): com `assistido`, o servidor lê os
 * quadros e a fala do próprio vídeo e o vídeo manda na legenda; sem ele, segue pelo roteiro da tarefa.
 */
export const legendaDoVideo = (clientId: string, taskId: string, assistido?: VideoAssistidoNaTela | null) =>
  chamarFuncao<LegendaDoVideo>("estudio-arte", { acao: "legenda_do_video", client_id: clientId, task_id: taskId, ...(assistido && assistido.quadros.length ? { video: assistido } : {}) });

export interface VideoAssistidoNaTela {
  /** Caminhos dos quadros no bucket mesa (<cliente>/video/quadros/...), em ordem de tempo. */
  quadros: string[];
  /** A fala transcrita (vazia quando o vídeo não tem fala ou a transcrição não saiu). */
  fala: string;
}

/** Frações da duração de onde saem os quadros que a legenda assiste. */
export const FRACOES_DO_VIDEO = [0.08, 0.32, 0.56, 0.82];

/**
 * Assiste o vídeo na tela: 4 quadros ao longo dele (sobem para a pasta de quadros do cliente) e a fala transcrita
 * (Whisper do editor, centavos por minuto). Fala que não sai vira vazia; quadro que não sai fica de fora.
 */
export async function assistirOVideo(clientId: string, video: Pick<VideoDaPauta, "bucket" | "caminho">, aoAndar?: (t: string) => void): Promise<VideoAssistidoNaTela> {
  // Navegador que não toca MP4 (ou ambiente sem vídeo): desiste na hora e a legenda segue pelo roteiro.
  if (typeof document === "undefined" || !document.createElement("video").canPlayType("video/mp4")) throw new Error("Este navegador não assiste o vídeo.");
  const { data, error } = await supabase.storage.from(video.bucket).createSignedUrl(video.caminho, 900);
  if (error || !data || !data.signedUrl) throw new Error("Não foi possível abrir o vídeo para assistir.");
  if (aoAndar) aoAndar("Assistindo o vídeo");
  const blobs = await extrairQuadrosNasFracoes(data.signedUrl, FRACOES_DO_VIDEO, { lado: 640 });
  const quadros: string[] = [];
  for (let i = 0; i < blobs.length; i++) quadros.push(await subirQuadro(clientId, blobs[i], `legenda-${i + 1}`));
  let fala = "";
  try {
    if (aoAndar) aoAndar("Ouvindo a fala do vídeo");
    const t = await transcreverMidia({ clientId, url: data.signedUrl, aoAndar });
    fala = t.palavras.map((p) => p.t).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
  } catch {
    fala = "";
  }
  return { quadros, fala };
}

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
  /** Como foi entregue (as três opções do carrossel). */
  modo: ModoDeEntrega;
  /** null em "Só Arquivos" (sem post na Agenda). */
  post_id: string | null;
  versao: number;
  /** O preparo criou o post (o Desfazer arquiva); false: atualizou o que já existia. */
  criado: boolean;
  file_id: string;
  /** ISO da publicação planejada; null: sem data (dia passado) ou sem conta do Instagram. */
  agendado_para: string | null;
  sem_conta: boolean;
  revisao_pedida: boolean;
  legenda: string;
  /** pronto: aprovado em nome do cliente, mas falta a data (ou a conta) para agendar. */
  precisa_data?: boolean;
  /** pronto: a aprovação ou o agendamento não fechou (o post ficou na Agenda). */
  aviso?: string | null;
}

/**
 * 26/10/2026 (dono: "tem que ter o mesmo fluxo do carrossel, pronto para agendar, mandar para aprovação ou só
 * arquivos ... e não recriar outro"). As três opções do Estúdio, no vídeo:
 * - aprovacao: Workspace -> Arquivos -> post de Reels na Agenda com a legenda e a data da peça, publicação
 *   planejada (o banco agenda quando a aprovação chegar) e o pedido de revisão da agência.
 * - pronto (admin e gestor): o mesmo post, aprovado em nome do cliente (aprovar_pelo_cliente) e agendado na data
 *   da peça pelo caminho do "Programar" da Agenda. Sem data à frente, fica aprovado e a peça pede a data.
 * - arquivos: só leva o vídeo para Arquivos (sem post, sem aprovação, sem legenda).
 * O post vivo da tarefa é sempre reaproveitado. Nunca publica na hora: o motor publica no horário.
 */
/** Formato do post de vídeo na Agenda: o da tarefa quando ela já é de vídeo; senão, Reels. Pura. */
export function formatoDoVideoNaAgenda(tipoDaTarefa: string | null | undefined): "reel" | "short" | "video" | "story" {
  return tipoDaTarefa === "short" || tipoDaTarefa === "video" || tipoDaTarefa === "story" || tipoDaTarefa === "reel" ? tipoDaTarefa : "reel";
}

export async function prepararParaPublicar(p: {
  clientId: string;
  userId: string;
  item: Pick<ItemDoMes, "id" | "title" | "due_date" | "project_id" | "delivery_type">;
  video: VideoDaPauta;
  legenda: string;
  modo?: ModoDeEntrega;
}): Promise<ResultadoDoPreparo> {
  const { clientId, userId, item, video } = p;
  const modo: ModoDeEntrega = p.modo || "aprovacao";
  let no: WorkspaceFileForHandoff;
  if (video.bucket === "workspace") no = await noPeloCaminho(clientId, video.caminho);
  else if (video.arquivo_id) no = await arquivoParaOWorkspace(clientId, video.arquivo_id);
  else if (video.fonte === "agenda") throw new Error("Este vídeo já está na Agenda. Para trocar, suba o vídeo novo na peça.");
  else throw new Error("O vídeo não está no acervo nem no Workspace. Suba de novo na peça.");
  const arquivo = await handoffWorkspaceFileToFiles({ node: no, clientId, userId, fileName: item.title, folder: "materiais", fileType: "creative", projectId: item.project_id });
  if (modo === "arquivos") {
    return { modo, post_id: null, versao: 0, criado: false, file_id: arquivo.fileId, agendado_para: null, sem_conta: false, revisao_pedida: false, legenda: "" };
  }
  const [atual, hora, conta] = await Promise.all([postDaTarefa(clientId, item.id), horaDoCliente(clientId), contaDoInstagram(clientId, item.project_id)]);
  const quando = horarioDaPeca(item.due_date, hora, hojeLocal());
  // Post da tarefa com outro arquivo vira revisão (nunca sobrescreve um material já aprovado).
  const revisar = !!atual && !!atual.post.primary_file_id && atual.post.primary_file_id !== arquivo.fileId;
  const mesmo = atual && !revisar ? atual : null;
  // 27/10 (dono: "não está agendando"): o banco exige o formato do post igual ao tipo de entrega da tarefa
  // ("O tipo da tarefa não corresponde ao formato do conteúdo editorial"). Tarefa de vídeo mantém o tipo dela;
  // pauta planejada em outro formato que virou vídeo passa a Reels antes de salvar o post.
  const tipo = formatoDoVideoNaAgenda(item.delivery_type);
  if (tipo !== item.delivery_type) {
    const { error: erroDoTipo } = await supabase.from("tasks").update({ delivery_type: tipo }).eq("id", item.id);
    if (erroDoTipo) throw new Error("Não foi possível marcar esta pauta como Reels para ir à Agenda. Tente de novo.");
  }
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
  // Já aprovado: o texto aprovado não muda (o banco recusa "approved editorial copy is immutable"); só agenda.
  const jaAprovado = !!mesmo && !!mesmo.internal && !!mesmo.internal.approval_fingerprint;
  let salvo: { post_id: string; version: number };
  if (jaAprovado && mesmo) {
    salvo = { post_id: mesmo.post.id, version: mesmo.post.version };
  } else {
    const { data, error } = await (supabase as any).rpc("save_editorial_post", {
      p_payload: {
        id: mesmo ? mesmo.post.id : null,
        // A chave de idempotência do post é uuid no banco (save_editorial_post faz ::uuid). 27/10: a chave
        // composta "mesa-video:<tarefa>:<arquivo>" derrubava todo Entregar com "invalid input syntax for type uuid".
        idempotency_key: (mesmo && mesmo.internal && mesmo.internal.idempotency_key) || crypto.randomUUID(),
        mutation_id: crypto.randomUUID(),
        client_id: clientId,
        project_id: item.project_id,
        primary_file_id: arquivo.fileId,
        title: item.title,
        content_type: mesmo ? mesmo.post.content_type : tipo,
        objective: mesmo ? mesmo.post.objective : null,
        default_caption: p.legenda,
        // 26/10/2026: o vídeo final já é o material pronto (a aprovação decide a publicação). Nascer como
        // "draft" travava o Programar do post aprovado ("approved editorial copy is immutable").
        production_status: mesmo && mesmo.post.production_status !== "draft" ? mesmo.post.production_status : "ready",
        task_id: item.id,
        responsible_id: mesmo && mesmo.internal ? mesmo.internal.responsible_id : null,
        internal_notes: mesmo && mesmo.internal ? mesmo.internal.internal_notes : null,
        revision_of_post_id: revisar && atual ? atual.post.id : mesmo && mesmo.internal ? mesmo.internal.revision_of_post_id : null,
        publications: publicacoes,
      },
      p_expected_version: mesmo ? mesmo.post.version : null,
    });
    if (error || !data) throw new Error((error && error.message) || "Não foi possível criar o post na Agenda.");
    salvo = data as { post_id: string; version: number };
  }
  const viva = vivas.length ? vivas[0].publication : null;
  const agendada = !jaAprovado && publicacoes.length ? (publicacoes[publicacoes.length - 1].scheduled_at as string | null) : viva ? viva.scheduled_at : quando;
  const base = { modo, post_id: salvo.post_id, versao: salvo.version, criado: !mesmo, file_id: arquivo.fileId, agendado_para: agendada || null, sem_conta: !conta && !vivas.length, legenda: jaAprovado && mesmo ? mesmo.post.default_caption || "" : p.legenda };
  if (modo === "pronto" || jaAprovado) {
    if (!jaAprovado) {
      try {
        await aprovarPeloCliente(arquivo.fileId, NOTA_DO_AVAL);
      } catch (e) {
        return { ...base, revisao_pedida: false, aviso: `Ficou na Agenda, mas a aprovação pelo cliente não fechou: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    const futuro = !!agendada && new Date(agendada).getTime() > Date.now() + 2 * 60 * 1000;
    // Já agendada à frente: nada a fazer.
    if (viva && viva.status === "scheduled" && futuro) return { ...base, modo: "pronto", revisao_pedida: false };
    // Aprovado: agenda pelo caminho do "Programar". Sem data à frente ou sem conta, a peça pede a data.
    if (!futuro || base.sem_conta) return { ...base, modo: "pronto", agendado_para: null, revisao_pedida: false, precisa_data: true };
    try {
      const r = await agendarVideoNaAgenda({ clientId, postId: salvo.post_id, quando: agendada as string });
      return { ...base, modo: "pronto", versao: r.versao, revisao_pedida: false };
    } catch (e) {
      return { ...base, modo: "pronto", agendado_para: null, revisao_pedida: false, precisa_data: true, aviso: `Aprovado, mas a Agenda não agendou: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  let revisao = false;
  try {
    await requestFileAgencyReview(arquivo.fileId);
    revisao = true;
  } catch {
    // Já em revisão ou aprovado: segue como está (a aprovação continua sendo a do fluxo de sempre).
  }
  return { ...base, revisao_pedida: revisao };
}

/**
 * Agendar ou reagendar o post do vídeo (26/10/2026, dono: "não dá pra reprogramar, está preso ... deixe mais
 * simples se quiser agendar ou reagendar se caso der erros"). O mesmo caminho do "Programar" da Agenda, no mesmo
 * card (nunca cria outro):
 * - publicação agendada ou que falhou: a transição oficial move a data (vale para horário que já passou);
 * - planejada ou nenhuma: salva o plano com a conta e a data; com o vídeo aprovado vai congelado e agendado na
 *   hora, sem aprovação fica planejado e o banco agenda quando aprovar.
 */
export async function agendarVideoNaAgenda(p: { clientId: string; postId: string; quando: string }): Promise<{ versao: number; aprovado: boolean }> {
  const { clientId, postId, quando } = p;
  if (!quando || !(new Date(quando).getTime() > Date.now() + 60 * 1000)) throw new Error("Escolha um dia e horário à frente.");
  const fresh = await loadEditorialPostForMutation(postId, clientId);
  const ativa = fresh.publications.find(({ publication }) => ["planned", "scheduled", "failed"].indexOf(publication.status) >= 0);
  const db = supabase as any;
  if (ativa && ativa.publication.status !== "planned") {
    const { error } = await db.rpc("transition_editorial_publication", {
      p_publication_id: ativa.publication.id,
      p_action: "schedule",
      p_expected_version: ativa.publication.version,
      p_scheduled_at: quando,
      p_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
      p_permalink: null,
      p_external_post_id: null,
      p_failure_code: null,
      p_failure_reason: null,
      p_published_at: null,
    });
    if (error) throw new Error(error.message || "A Agenda não aceitou a nova data.");
    return { versao: fresh.post.version, aprovado: true };
  }
  if (!ativa && fresh.publications.some(({ publication }) => publication.status === "published")) throw new Error("Este vídeo já foi publicado.");
  const conta = (ativa && ativa.publication.external_account_id) || (fresh.post.project_id ? await contaDoInstagram(clientId, fresh.post.project_id) : null);
  if (!conta) throw new Error("O projeto não tem conta do Instagram ligada. Ligue a conta pelo card da Agenda.");
  const { data: conexao } = await db.from("external_account_connections").select("connection_status, automation_enabled").eq("external_account_id", conta).maybeSingle();
  const entrega = await entregaDaArteAprovada(fresh, conta, [{ id: conta, connection_status: conexao ? conexao.connection_status : null, automation_enabled: conexao ? conexao.automation_enabled : null }]);
  const publicacoes: Record<string, unknown>[] = fresh.publications
    .filter(({ publication }) => publication.status === "planned")
    .map(({ publication, internal }) => {
      const alvo = !!ativa && ativa.publication.id === publication.id;
      return {
        ...(alvo && entrega ? entrega : {}),
        id: publication.id,
        idempotency_key: (internal && internal.idempotency_key) || crypto.randomUUID(),
        external_account_id: alvo ? conta : publication.external_account_id,
        file_id: publication.file_id,
        caption: publication.caption,
        first_comment: publication.first_comment,
        alt_text: publication.alt_text,
        scheduled_at: alvo ? quando : publication.scheduled_at,
        scheduled_timezone: alvo ? EDITORIAL_DEFAULT_TIME_ZONE : publication.scheduled_timezone || EDITORIAL_DEFAULT_TIME_ZONE,
      };
    });
  if (!ativa) {
    publicacoes.push({
      ...(entrega || { delivery_mode: "manual", asset_file_ids: [] }),
      id: null,
      idempotency_key: crypto.randomUUID(),
      external_account_id: conta,
      file_id: null,
      caption: fresh.post.default_caption,
      first_comment: null,
      alt_text: null,
      scheduled_at: quando,
      scheduled_timezone: EDITORIAL_DEFAULT_TIME_ZONE,
    });
  }
  const { data, error } = await db.rpc("save_editorial_post", {
    p_payload: {
      id: fresh.post.id,
      idempotency_key: (fresh.internal && fresh.internal.idempotency_key) || crypto.randomUUID(),
      mutation_id: crypto.randomUUID(),
      client_id: fresh.post.client_id,
      project_id: fresh.post.project_id,
      primary_file_id: fresh.post.primary_file_id,
      title: fresh.post.title,
      content_type: fresh.post.content_type,
      objective: fresh.post.objective,
      default_caption: fresh.post.default_caption,
      production_status: fresh.post.production_status,
      task_id: (fresh.internal && fresh.internal.task_id) || null,
      responsible_id: (fresh.internal && fresh.internal.responsible_id) || null,
      internal_notes: (fresh.internal && fresh.internal.internal_notes) || null,
      revision_of_post_id: fresh.internal ? fresh.internal.revision_of_post_id ?? null : null,
      publications: publicacoes,
    },
    p_expected_version: fresh.post.version,
  });
  if (error || !data) throw new Error((error && error.message) || "A Agenda não aceitou a data.");
  return { versao: (data as { version: number }).version, aprovado: !!entrega };
}

/** Desfazer o preparo: arquiva o post que ele criou (o vídeo continua no Workspace e em Arquivos). */
export async function desfazerPreparo(r: Pick<ResultadoDoPreparo, "post_id" | "versao" | "criado">): Promise<void> {
  if (!r.criado || !r.post_id) throw new Error("O post já existia antes: mude pela Agenda.");
  const { error } = await (supabase as any).rpc("archive_editorial_post", { p_post_id: r.post_id, p_expected_version: r.versao });
  if (error) throw new Error(error.message || "Não foi possível desfazer.");
}

/** Uma frase do estado depois do preparo. */
export function textoDoPreparo(r: Pick<ResultadoDoPreparo, "agendado_para" | "sem_conta"> & Partial<Pick<ResultadoDoPreparo, "modo" | "aviso" | "precisa_data">>): string {
  if (r.modo === "arquivos") return "Em Arquivos, sem post na Agenda.";
  if (r.aviso) return r.aviso;
  if (r.sem_conta) return "Na Agenda, sem conta do Instagram no projeto: ligue a conta pelo card para agendar.";
  if (!r.agendado_para) return r.modo === "pronto" ? "Aprovado. Escolha o dia e o horário para agendar." : "Na Agenda, sem data: escolha o dia e o horário.";
  const d = new Date(r.agendado_para);
  const quando = d.toLocaleString("pt-BR", { timeZone: EDITORIAL_DEFAULT_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return r.modo === "pronto" ? `Aprovado e agendado para ${quando}.` : `Agendado para ${quando}, aguardando aprovação.`;
}
