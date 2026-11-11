/**
 * Frente EA (27/09): a peça entregue pelo Estúdio entra e fica certa na
 * Agenda, e a data de publicação é confirmada na própria Entrega.
 *
 * Tudo passa pelas RPCs que a Agenda já usa (save_editorial_post,
 * transition_editorial_publication, archive_editorial_post), com o JWT de
 * quem chamou: as regras do banco valem (acesso, aprovação, quem pode
 * agendar) e cada evento fica com o autor certo. A leitura é pela chave de
 * serviço (a função já conferiu o acesso ao cliente), menos as conexões das
 * contas, que só quem chamou lê (ver conexoesDasContas).
 *
 * Publicação: nada aqui publica. O post fica "planejado" com a data
 * confirmada; o ciclo do banco (promotor + motor do Instagram, um minuto)
 * agenda quando o cliente aprova e publica no horário, uma vez por
 * publicação, sem retry automático depois de falhar.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  FUSO_PADRAO,
  PUBLICAR_AGORA_EM_MIN,
  arquivoEditavel,
  contaTravadaNaCadeia,
  payloadComData,
  payloadComPerfis,
  perfisValidos,
  planoDaSincronizacao,
  problemaNoHorario,
  publicacaoDaPeca,
  type AcaoDaSincronizacao,
  type ContaDoProjeto,
  type PerfilDaPeca,
  type PostExistente,
  type PublicacaoExistente,
} from "./modulos/entrega-na-agenda.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";

export class ErroDaAgenda extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export interface ContextoDaAgenda {
  /** Chave de serviço: só leitura. */
  db: SupabaseClient;
  /** JWT de quem chamou: toda escrita na Agenda. */
  doChamador: SupabaseClient;
  userId: string;
}

/** O que a Agenda precisa do trabalho do estúdio. */
export interface TrabalhoParaAgenda {
  id: string;
  client_id: string;
  task_id: string | null;
  status: string;
  file_ids: string[];
  legenda: string | null;
  hashtags?: string[] | null;
  entrega_rodada?: number | null;
  post_id?: string | null;
  /** 20/10 (Stories): a direção da peça; o formato stories_9x16 entra na Agenda como story. */
  direcao?: { formato?: unknown } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erro do banco em frase de gente (os mais comuns da Agenda). */
export function traduzirErroDaAgenda(bruto: unknown): string {
  const m = String((bruto as { message?: string })?.message || bruto || "");
  if (/idempotency key was reused/i.test(m)) return "A Agenda já tem outra versão desta peça. Atualize a tela e tente de novo.";
  if (/refresh before saving|post changed|publication changed/i.test(m)) return "O post mudou na Agenda enquanto isso. Tente de novo.";
  if (/client access denied|access denied/i.test(m)) return "Você não tem permissão para mexer na Agenda deste cliente.";
  if (/only an assigned manager or admin can schedule/i.test(m)) return "Só admin ou gestor do cliente agenda publicação.";
  if (/not linked to the project|account is inactive/i.test(m)) return "A conta do Instagram não está ligada a este projeto. Ligue a conta na Agenda.";
  if (/scheduled time cannot be in the past/i.test(m)) return "O horário já passou. Escolha outro.";
  if (/requires ready content and approved/i.test(m)) return "A arte ainda não está aprovada pelo cliente.";
  if (/cancelled publication stays cancelled|only a cancelled publication can be rescheduled/i.test(m)) return "A publicação foi cancelada de propósito. Um admin ou gestor marca a conta de novo para agendar.";
  if (/only an assigned manager or admin can reopen/i.test(m)) return "Só admin ou gestor reabre uma publicação cancelada.";
  if (/cancelled plan was not approved/i.test(m)) return "A publicação cancelada não reabriu: a arte não está aprovada para publicar.";
  if (/immutable|create a revision/i.test(m)) return "A arte aprovada não muda no mesmo post. Entregue de novo para nascer a revisão.";
  if (/scheduled or terminal publications cannot be edited|failed or published/i.test(m)) return "A publicação já está agendada ou saiu. Mude pela Agenda.";
  if (/files must be readable|files are unavailable|file is unavailable/i.test(m)) return "Os arquivos da entrega não estão disponíveis para a Agenda.";
  return m ? `A Agenda recusou: ${m.slice(0, 240)}` : "A Agenda não respondeu. Tente de novo.";
}

// ------------------------------------------------------------------ leitura

/** Post da Agenda com o que o save precisa (chaves de idempotência inclusive). */
export async function lerPostDaAgenda(db: SupabaseClient, postId: string): Promise<PostExistente | null> {
  if (!UUID.test(postId)) return null;
  const [postRes, internoRes, pubsRes] = await Promise.all([
    db.from("editorial_posts")
      .select("id, version, client_id, project_id, primary_file_id, title, content_type, objective, default_caption, production_status, archived_at")
      .eq("id", postId)
      .maybeSingle(),
    db.from("editorial_post_internal")
      .select("post_id, idempotency_key, task_id, responsible_id, internal_notes, revision_of_post_id")
      .eq("post_id", postId)
      .maybeSingle(),
    db.from("editorial_publications")
      .select("id, version, status, platform, external_account_id, file_id, caption, first_comment, alt_text, scheduled_at, scheduled_timezone, published_at, permalink")
      .eq("post_id", postId),
  ]);
  if (postRes.error) throw new ErroDaAgenda(503, "agenda_indisponivel", "Não foi possível ler o post da Agenda.");
  if (!postRes.data) return null;
  const pubs = ((pubsRes.data as Omit<PublicacaoExistente, "idempotency_key">[] | null) ?? []);
  const chaves: Record<string, string> = {};
  if (pubs.length) {
    const { data } = await db
      .from("editorial_publication_internal")
      .select("publication_id, idempotency_key")
      .in("publication_id", pubs.map((p) => p.id));
    for (const l of (data as { publication_id: string; idempotency_key: string }[] | null) ?? []) chaves[l.publication_id] = l.idempotency_key;
  }
  const p = postRes.data as Omit<PostExistente, "internal" | "publications">;
  const internal = (internoRes.data as PostExistente["internal"]) ?? null;
  const naCadeia = await contasCanceladasPorPessoa(db, p.id, internal?.revision_of_post_id || null);
  return {
    ...p,
    internal,
    publications: pubs.map((x) => ({ ...x, idempotency_key: chaves[x.id] ?? null })),
    ...(naCadeia
      ? {
        contas_canceladas_por_pessoa: naCadeia.canceladas,
        contas_livres_na_cadeia: naCadeia.livres,
        ...(naCadeia.incompleta ? { cadeia_incompleta: true } : {}),
      }
      : {}),
  };
}

/** Motivos da limpeza automática do plano: não são cancelamento de pessoa. */
const MOTIVOS_DA_LIMPEZA = ["removed_from_plan", "removed_from_approved_media_plan"];
/** Teto de segurança da cadeia; o mesmo de editorial_conta_cancelada_por_pessoa. */
export const MAX_CADEIA_DE_REVISOES = 256;

export interface CanceladasNaCadeia {
  /** Contas canceladas por pessoa no post mais novo da cadeia que tem linha nelas. */
  canceladas: string[];
  /** Contas decididas como livres na parte lida da cadeia. */
  livres: string[];
  /** A busca parou no teto com post anterior ainda por ler (falha fechada). */
  incompleta: boolean;
}

/**
 * Contas canceladas por pessoa no post ou nas revisões anteriores. A mesma
 * regra de editorial_conta_cancelada_por_pessoa no banco: em cada conta decide
 * o post mais novo da cadeia que tem linha nela; conta como pessoa o último
 * publication_cancelled sem motivo de limpeza (cancelada sem evento também).
 * Percorre a cadeia inteira (ciclo encerra a busca); se bater no teto, marca
 * incompleta e quem usa trata a conta não decidida como travada.
 * Falha de leitura: null (o plano usa só as canceladas do próprio post).
 */
export async function contasCanceladasPorPessoa(
  db: SupabaseClient,
  postId: string,
  revisaoDe: string | null,
  maxNivel: number = MAX_CADEIA_DE_REVISOES,
): Promise<CanceladasNaCadeia | null> {
  const cadeia = [postId];
  let anterior = revisaoDe;
  let incompleta = false;
  while (anterior && UUID.test(anterior) && !cadeia.includes(anterior)) {
    // Nível 0 é o próprio post: lê até o nível maxNivel, como o banco.
    if (cadeia.length > Math.max(1, maxNivel)) {
      incompleta = true;
      break;
    }
    cadeia.push(anterior);
    const { data, error } = await db.from("editorial_post_internal")
      .select("post_id, revision_of_post_id")
      .eq("post_id", anterior)
      .maybeSingle();
    if (error) return null;
    anterior = (data as { revision_of_post_id: string | null } | null)?.revision_of_post_id || null;
  }
  const { data: pubs, error: erroPubs } = await db.from("editorial_publications")
    .select("id, post_id, status, external_account_id")
    .in("post_id", cadeia);
  if (erroPubs) return null;
  type Linha = { id: string; post_id: string; status: string; external_account_id: string | null };
  const linhas = (pubs as Linha[] | null) ?? [];
  const decide = new Map<string, Linha>();
  for (const id of cadeia) {
    for (const l of linhas) {
      if (l.post_id === id && l.external_account_id && !decide.has(l.external_account_id)) decide.set(l.external_account_id, l);
    }
  }
  const canceladas = [...decide.values()].filter((l) => l.status === "cancelled");
  const resultado = (travadas: string[]): CanceladasNaCadeia => ({
    canceladas: travadas,
    livres: [...decide.keys()].filter((id) => !travadas.includes(id)),
    incompleta,
  });
  if (!canceladas.length) return resultado([]);
  const { data: eventos, error: erroEventos } = await db.from("editorial_events")
    .select("publication_id, metadata, created_at")
    .eq("event_type", "publication_cancelled")
    .in("publication_id", canceladas.map((l) => l.id));
  if (erroEventos) return null;
  type Evento = { publication_id: string; metadata: { reason?: unknown } | null; created_at: string };
  const daLimpeza = (e: Evento) => MOTIVOS_DA_LIMPEZA.includes(String(e.metadata?.reason ?? ""));
  const ultimo: Record<string, Evento> = {};
  for (const e of (eventos as Evento[] | null) ?? []) {
    const atual = ultimo[e.publication_id];
    const maisNovo = !atual || e.created_at > atual.created_at || (e.created_at === atual.created_at && !daLimpeza(e));
    if (maisNovo) ultimo[e.publication_id] = e;
  }
  return resultado(
    canceladas
      .filter((l) => !ultimo[l.id] || !daLimpeza(ultimo[l.id]))
      .map((l) => l.external_account_id as string),
  );
}

/**
 * O post atual da peça: o que a entrega já ligou (post_id), quando ainda é o
 * atual do item; senão o post atual do item na Agenda (mesma regra de
 * editorial_current_post_id_for_task: ligado pela tarefa, não arquivado, sem
 * revisão mais nova).
 */
export async function postAtualDaPeca(db: SupabaseClient, t: Pick<TrabalhoParaAgenda, "post_id" | "task_id">): Promise<PostExistente | null> {
  if (!t.task_id) return t.post_id ? await lerPostDaAgenda(db, t.post_id) : null;
  const { data: ligacoes } = await db
    .from("editorial_post_internal")
    .select("post_id, revision_of_post_id")
    .eq("task_id", t.task_id);
  const links = (ligacoes as { post_id: string; revision_of_post_id: string | null }[] | null) ?? [];
  const revisados = new Set(links.map((l) => l.revision_of_post_id).filter(Boolean) as string[]);
  let candidatos: { id: string }[] = [];
  if (links.length) {
    const { data: posts } = await db
      .from("editorial_posts")
      .select("id, created_at")
      .in("id", links.map((l) => l.post_id))
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    candidatos = ((posts as { id: string }[] | null) ?? []).filter((p) => !revisados.has(p.id));
  }
  // O da entrega vale enquanto for um dos atuais do item.
  const escolhido = (t.post_id && candidatos.find((c) => c.id === t.post_id)) || candidatos[0] || null;
  return escolhido ? await lerPostDaAgenda(db, escolhido.id) : null;
}

/**
 * Conexões das contas (external_account_connections) lidas com o JWT de quem
 * chamou. A tabela nega tudo ao service_role de propósito (migration
 * 20260731175633_meta_oauth_foundation.sql) e a RLS can_access_client vale
 * para quem chamou, que a ação já conferiu. Pela chave de serviço a leitura
 * dava "permission denied" (42501) calada e a entrega saía sempre "manual"
 * (achado E06, 30/09). Falha fica no log e segue sem conexões (manual), como
 * antes: a entrega não trava por isso.
 */
type ConexaoDaConta = { external_account_id: string; connection_status: string | null; automation_enabled: boolean | null; expires_at?: string | null };

async function conexoesDasContas(leitor: SupabaseClient, ids: string[], colunas: string, onde: string): Promise<ConexaoDaConta[]> {
  const { data, error } = await leitor
    .from("external_account_connections")
    .select(colunas)
    .in("external_account_id", ids);
  if (error) {
    registrarFalha(`estudio-arte: conexões da conta não lidas (${onde})`, error, { ids });
    return [];
  }
  return (data as unknown as ConexaoDaConta[] | null) ?? [];
}

/** Conta do Instagram ligada ao projeto (a primeira conectada). `leitorDasConexoes`: o cliente com o JWT de quem chamou. */
export async function contaDoProjeto(db: SupabaseClient, leitorDasConexoes: SupabaseClient, projectId: string, clientId: string): Promise<(ContaDoProjeto & { automatica: boolean }) | null> {
  const { data: links } = await db
    .from("project_external_accounts")
    .select("external_account_id")
    .eq("project_id", projectId)
    .eq("client_id", clientId);
  const ids = ((links as { external_account_id: string }[] | null) ?? []).map((l) => l.external_account_id);
  if (!ids.length) return null;
  const [contasRes, conexoes] = await Promise.all([
    db.from("external_accounts")
      .select("id, platform, status, created_at")
      .in("id", ids)
      .eq("client_id", clientId)
      .eq("platform", "instagram")
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    conexoesDasContas(leitorDasConexoes, ids, "external_account_id, connection_status, automation_enabled", "conta do projeto"),
  ]);
  const contas = (contasRes.data as { id: string; platform: string }[] | null) ?? [];
  const conexao: Record<string, { connection_status: string | null; automation_enabled: boolean | null }> = {};
  for (const c of conexoes) {
    conexao[c.external_account_id] = c;
  }
  if (!contas.length) return null;
  const conectadas = contas.filter((c) => conexao[c.id]?.connection_status === "connected");
  const escolhida = conectadas[0] || contas[0];
  const cx = conexao[escolhida.id];
  return { id: escolhida.id, platform: escolhida.platform, automatica: cx?.connection_status === "connected" && cx?.automation_enabled === true };
}

interface ArquivoRaiz {
  id: string;
  file_name: string | null;
  caption: string | null;
  description: string | null;
  visibility: string | null;
  approval_status: string | null;
  agency_approval_status: string | null;
  locked_at: string | null;
  client_decided_at: string | null;
  parent_file_id: string | null;
  archived_at: string | null;
  status: string | null;
}

async function lerArquivo(db: SupabaseClient, id: string | null): Promise<ArquivoRaiz | null> {
  if (!id || !UUID.test(id)) return null;
  const { data } = await db
    .from("files")
    .select("id, file_name, caption, description, visibility, approval_status, agency_approval_status, locked_at, client_decided_at, parent_file_id, archived_at, status")
    .eq("id", id)
    .maybeSingle();
  return (data as ArquivoRaiz | null) ?? null;
}

/** Mesma regra de editorial_file_is_publishable (sem projeto: o save confere de novo). */
export function arquivoAprovado(f: Pick<ArquivoRaiz, "parent_file_id" | "archived_at" | "status" | "agency_approval_status" | "locked_at" | "visibility" | "approval_status"> | null): boolean {
  if (!f || f.parent_file_id || f.archived_at) return false;
  if ((f.status || "ready") !== "ready" || f.agency_approval_status !== "approved" || !f.locked_at) return false;
  return (f.visibility === "approval" && f.approval_status === "approved") || f.visibility === "client_shared";
}

// ------------------------------------------------------------------ entrega → agenda

export interface ResultadoDaSincronizacao {
  acao: AcaoDaSincronizacao;
  post_id: string | null;
  aviso: string | null;
}

/**
 * Leva a entrega para a Agenda: cria, atualiza ou abre a revisão do post do
 * item (planoDaSincronizacao decide). Idempotente: a mesma entrega não
 * duplica nem regrava. Lança ErroDaAgenda com a frase do motivo.
 */
export async function sincronizarPecaNaAgenda(
  ctx: ContextoDaAgenda,
  t: TrabalhoParaAgenda,
  opcoes: { quando?: string | null } = {},
): Promise<ResultadoDaSincronizacao> {
  if (t.status !== "entregue" || !t.file_ids?.length) {
    throw new ErroDaAgenda(409, "sem_entrega", "Entregue a arte em Arquivos antes de levar para a Agenda.");
  }
  if (!t.task_id) throw new ErroDaAgenda(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const { data: tarefa } = await ctx.db
    .from("tasks")
    .select("id, project_id, title, deleted_at")
    .eq("id", t.task_id)
    .maybeSingle();
  const item = tarefa as { id: string; project_id: string; title: string | null; deleted_at: string | null } | null;
  if (!item || item.deleted_at) throw new ErroDaAgenda(404, "item_inexistente", "O item da agenda foi apagado. A arte está em Arquivos.");

  const [raiz, existente, conta] = await Promise.all([
    lerArquivo(ctx.db, t.file_ids[0]),
    postAtualDaPeca(ctx.db, t),
    contaDoProjeto(ctx.db, ctx.doChamador, item.project_id, t.client_id),
  ]);
  if (!raiz) throw new ErroDaAgenda(409, "arquivo_inexistente", "O arquivo da entrega não existe mais em Arquivos.");
  const arquivoAtual = existente?.primary_file_id && existente.primary_file_id !== raiz.id ? await lerArquivo(ctx.db, existente.primary_file_id) : null;

  const plano = await planoDaSincronizacao(
    {
      trabalhoId: t.id,
      clientId: t.client_id,
      projectId: item.project_id,
      taskId: item.id,
      // A Agenda aprovada usa o nome, a descrição e a legenda do arquivo raiz
      // como o texto do post: iguais aqui, o post aprovado depois não trava.
      titulo: (raiz.file_name || item.title || "").trim(),
      fileIds: t.file_ids,
      legenda: raiz.caption ?? t.legenda,
      hashtags: raiz.caption ? [] : t.hashtags ?? [],
      objetivo: raiz.description,
      rodada: Math.max(1, Number(t.entrega_rodada) || 1),
      formato: typeof t.direcao?.formato === "string" ? t.direcao.formato : null,
    },
    existente,
    { conta, arquivoAtualEditavel: arquivoEditavel(arquivoAtual), quando: opcoes.quando ?? null },
  );

  if (plano.acao === "bloqueado") throw new ErroDaAgenda(409, "agenda_bloqueada", plano.motivo || "A Agenda não aceitou esta entrega.");
  if (plano.acao === "nada") return { acao: "nada", post_id: existente?.id ?? null, aviso: null };

  // Revisão: antes de nascer o post novo, o plano do anterior sai (as
  // publicações planejadas são canceladas pelo caminho comum da Agenda). Sem
  // isso o anterior, com a data confirmada, apareceria duplicado na Agenda e
  // o banco não deixa cancelar pela transição enquanto a arte está em ajuste.
  if (plano.acao === "revisao" && existente && existente.publications.some((p) => p.status === "planned")) {
    const limpar = await ctx.doChamador.rpc("save_editorial_post", {
      p_payload: {
        ...payloadComData(existente, "", null, crypto.randomUUID()),
        publications: [],
      },
      p_expected_version: existente.version,
    });
    if (limpar.error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(limpar.error));
  }

  const { data, error } = await ctx.doChamador.rpc("save_editorial_post", {
    p_payload: plano.payload,
    p_expected_version: plano.expectedVersion ?? null,
  });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  const postId = String((data as { post_id?: string } | null)?.post_id || "");
  if (!UUID.test(postId)) throw new ErroDaAgenda(502, "agenda_sem_post", "A Agenda não devolveu o post.");

  // Revisão: o post anterior vira histórico (arquivar, nunca apagar). Se o
  // banco não deixar, fica como está: a Agenda já trata a revisão como a atual.
  if (plano.acao === "revisao" && plano.postAnteriorId) {
    const anterior = await lerPostDaAgenda(ctx.db, plano.postAnteriorId).catch((e) => (registrarFalha("estudio-arte: lerPostDaAgenda falhou", e), null));
    if (anterior && !anterior.archived_at) {
      await ctx.doChamador.rpc("archive_editorial_post", { p_post_id: anterior.id, p_expected_version: anterior.version }).then(() => null, () => null);
    }
  }
  return { acao: plano.acao, post_id: postId, aviso: plano.aviso ?? null };
}

// ------------------------------------------------------------------ data de publicação

export interface ResultadoDaData {
  post_id: string;
  publicacao_id: string;
  quando: string | null;
  status: string;
}

async function postEPublicacao(ctx: ContextoDaAgenda, t: TrabalhoParaAgenda) {
  const post = await postAtualDaPeca(ctx.db, t);
  if (!post) throw new ErroDaAgenda(409, "fora_da_agenda", "Esta peça ainda não está na Agenda. Use Levar para a Agenda.");
  const pub = publicacaoDaPeca(post.publications);
  if (!pub) {
    const cancelada = (post.publications || []).some((p) => p.status === "cancelled");
    if (cancelada) {
      throw new ErroDaAgenda(409, "publicacao_cancelada", "A publicação no Instagram foi cancelada. Escolha a conta de novo para agendar.");
    }
    throw new ErroDaAgenda(409, "sem_conta", "O post não tem publicação no Instagram. Ligue a conta do projeto na Agenda.");
  }
  return { post, pub };
}

/** Reabre e grava a data na mesma função do banco. Sem estado parcial. */
async function reagendarCanceladas(
  ctx: ContextoDaAgenda,
  post: PostExistente,
  contas: string[],
  quando: string,
  versaoInicial: number,
): Promise<{ post_version: number; publicacao_id: string; status: string }> {
  let versao = versaoInicial;
  let ultimo = { publicacao_id: "", status: "scheduled" };
  for (const pub of post.publications) {
    if (pub.status !== "cancelled") continue;
    if (!contas.includes(pub.external_account_id || "") && !contas.includes(pub.id)) continue;
    const r = await ctx.doChamador.rpc("reagendar_publicacao_cancelada", {
      p_publication_id: pub.id,
      p_expected_post_version: versao,
      p_scheduled_at: quando,
      p_timezone: pub.scheduled_timezone || FUSO_PADRAO,
    });
    if (r.error) {
      throw new ErroDaAgenda(409, "publicacao_cancelada", `A publicação cancelada não voltou a ser agendável. ${traduzirErroDaAgenda(r.error)}`);
    }
    const data = r.data as { post_version?: number; publication_id?: string; status?: string } | null;
    versao = Number(data?.post_version) || versao;
    ultimo = { publicacao_id: String(data?.publication_id || pub.id), status: String(data?.status || "scheduled") };
  }
  return { post_version: versao, ...ultimo };
}

/**
 * Confirma (ou muda) a data e hora da publicação da peça. `agoraMesmo`:
 * "Publicar agora", só com a arte aprovada, para daqui a 1 minuto.
 * - planejada: o save grava a data (sem aprovação, continua planejada e o
 *   banco agenda quando o cliente aprovar; com aprovação, o caminho aprovado
 *   da Agenda já agenda na hora);
 * - agendada: a transição oficial reagenda no mesmo card;
 * - publicada ou com falha: recusa (falha usa Tentar de novo).
 */
export async function confirmarDataDaPeca(
  ctx: ContextoDaAgenda,
  t: TrabalhoParaAgenda,
  pedido: { quando: string | null; agoraMesmo?: boolean; mutationId: string; perfis?: string[] | null },
  agora = new Date(),
): Promise<ResultadoDaData> {
  if (Array.isArray(pedido.perfis)) {
    const comPerfis = await confirmarComPerfis(ctx, t, { ...pedido, perfis: pedido.perfis }, agora);
    if (comPerfis) return comPerfis;
  }
  const { post, pub } = await postEPublicacao(ctx, t);
  if (pub.status === "cancelled") {
    throw new ErroDaAgenda(409, "publicacao_cancelada", "A publicação desta conta foi cancelada. Marque a conta de novo para agendar.");
  }
  if (pub.status === "published") throw new ErroDaAgenda(409, "ja_publicado", "Esta peça já foi publicada.");
  if (pub.status === "failed") throw new ErroDaAgenda(409, "publicacao_falhou", "A publicação falhou. Use Tentar de novo.");
  const raiz = await lerArquivo(ctx.db, post.primary_file_id);
  const aprovado = arquivoAprovado(raiz);
  let quando = pedido.quando;
  if (pedido.agoraMesmo) {
    if (!aprovado) throw new ErroDaAgenda(409, "sem_aprovacao", "Sem a aprovação do cliente não publica.");
    quando = new Date(agora.getTime() + PUBLICAR_AGORA_EM_MIN * 60_000).toISOString();
  }
  const problema = problemaNoHorario(quando, agora, { agoraMesmo: !!pedido.agoraMesmo });
  if (problema) throw new ErroDaAgenda(400, "horario_invalido", problema);

  if (pub.status === "scheduled") {
    const { error } = await ctx.doChamador.rpc("transition_editorial_publication", {
      p_publication_id: pub.id,
      p_action: "schedule",
      p_expected_version: pub.version,
      p_scheduled_at: quando,
      p_timezone: pub.scheduled_timezone || FUSO_PADRAO,
    });
    if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
    return { post_id: post.id, publicacao_id: pub.id, quando, status: "scheduled" };
  }

  // Aprovada: vai com as lâminas na ordem para o caminho aprovado congelar e agendar.
  let entrega: { delivery_mode: "manual" | "automatic"; asset_file_ids: string[] } | null = null;
  if (aprovado) {
    const conta = pub.external_account_id ? await contaPorId(ctx.doChamador, pub.external_account_id) : null;
    entrega = { delivery_mode: conta?.automatica ? "automatic" : "manual", asset_file_ids: t.file_ids.slice() };
  }
  const { error } = await ctx.doChamador.rpc("save_editorial_post", {
    p_payload: payloadComData(post, pub.id, quando, pedido.mutationId, entrega),
    p_expected_version: post.version,
  });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  return { post_id: post.id, publicacao_id: pub.id, quando, status: aprovado ? "scheduled" : "planned" };
}

/** `leitorDasConexoes`: o cliente com o JWT de quem chamou (ver conexoesDasContas). */
async function contaPorId(leitorDasConexoes: SupabaseClient, id: string): Promise<{ automatica: boolean } | null> {
  const [c] = await conexoesDasContas(leitorDasConexoes, [id], "external_account_id, connection_status, automation_enabled", "conta da publicação");
  return { automatica: !!c && c.connection_status === "connected" && c.automation_enabled === true };
}

/**
 * Desfaz o agendamento: a publicação volta a planejada, sem data. Agendada
 * ou com falha passa por cancelar e reabrir (transições oficiais) antes de
 * tirar a data; o banco segura a promoção enquanto isso
 * (mesa_publicacao_segurada, pelo publicar_em_desfeito_em do trabalho).
 */
export async function desfazerDataDaPeca(ctx: ContextoDaAgenda, t: TrabalhoParaAgenda, mutationId: string): Promise<ResultadoDaData> {
  const lido = await postEPublicacao(ctx, t);
  let post = lido.post;
  let pub = lido.pub;
  if (pub.status === "published") throw new ErroDaAgenda(409, "ja_publicado", "Esta peça já foi publicada. Não há agendamento para desfazer.");
  if (pub.status === "scheduled") {
    const cancelar = await ctx.doChamador.rpc("transition_editorial_publication", {
      p_publication_id: pub.id, p_action: "cancel", p_expected_version: pub.version,
    });
    if (cancelar.error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(cancelar.error));
    const v = Number((cancelar.data as { version?: number } | null)?.version) || pub.version + 1;
    const reabrir = await ctx.doChamador.rpc("transition_editorial_publication", {
      p_publication_id: pub.id, p_action: "reopen", p_expected_version: v,
    });
    if (reabrir.error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(reabrir.error));
  } else if (pub.status === "failed") {
    const reabrir = await ctx.doChamador.rpc("transition_editorial_publication", {
      p_publication_id: pub.id, p_action: "reopen", p_expected_version: pub.version,
    });
    if (reabrir.error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(reabrir.error));
  }
  if (pub.status !== "planned") {
    const relido = await lerPostDaAgenda(ctx.db, post.id);
    if (!relido) throw new ErroDaAgenda(409, "fora_da_agenda", "O post saiu da Agenda.");
    post = relido;
    pub = post.publications.find((p) => p.id === pub.id) || pub;
  }
  if (!pub.scheduled_at) return { post_id: post.id, publicacao_id: pub.id, quando: null, status: pub.status };
  const { error } = await ctx.doChamador.rpc("save_editorial_post", {
    p_payload: payloadComData(post, pub.id, null, mutationId),
    p_expected_version: post.version,
  });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  return { post_id: post.id, publicacao_id: pub.id, quando: null, status: "planned" };
}

// ------------------------------------------------------------------ perfis (frente AP, 28/09)

const PLATAFORMAS_DA_PECA = ["instagram", "facebook"];

/**
 * Onde a peça pode sair: os perfis do Instagram e as páginas do Facebook
 * ligados ao projeto do item (o projeto é a marca: Acerbi e CME ficam
 * separadas). `escolhido`: já tem publicação viva no post da peça.
 */
export async function perfisDaPeca(
  db: SupabaseClient,
  t: Pick<TrabalhoParaAgenda, "client_id" | "task_id" | "post_id">,
  /** O cliente com o JWT de quem chamou, para as conexões (ver conexoesDasContas). */
  leitorDasConexoes: SupabaseClient = db,
): Promise<{ projectId: string | null; perfis: PerfilDaPeca[]; post: PostExistente | null }> {
  const post = await postAtualDaPeca(db, t);
  let projectId = post?.project_id || null;
  if (!projectId && t.task_id) {
    const { data } = await db.from("tasks").select("project_id").eq("id", t.task_id).maybeSingle();
    projectId = (data as { project_id: string | null } | null)?.project_id || null;
  }
  if (!projectId) return { projectId: null, perfis: [], post };
  const { data: links } = await db
    .from("project_external_accounts")
    .select("external_account_id")
    .eq("project_id", projectId)
    .eq("client_id", t.client_id);
  const ids = ((links as { external_account_id: string }[] | null) ?? []).map((l) => l.external_account_id);
  if (!ids.length) return { projectId, perfis: [], post };
  const [contasRes, conexoes] = await Promise.all([
    db.from("external_accounts")
      .select("id, platform, status, display_name, handle, created_at")
      .in("id", ids)
      .eq("client_id", t.client_id)
      .in("platform", PLATAFORMAS_DA_PECA)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    conexoesDasContas(leitorDasConexoes, ids, "external_account_id, connection_status, automation_enabled, expires_at", "perfis da peça"),
  ]);
  const conexao: Record<string, ConexaoDaConta> = {};
  for (const c of conexoes) conexao[c.external_account_id] = c;
  const canceladas = (post?.publications || []).filter((p) => p.status === "cancelled");
  const vivas = new Set((post?.publications || []).filter((p) => p.status !== "cancelled").map((p) => p.external_account_id || ""));
  const motivoPorConta: Record<string, string> = {};
  if (canceladas.length) {
    const { data } = await db.from("editorial_publication_internal")
      .select("publication_id, failure_reason")
      .in("publication_id", canceladas.map((p) => p.id));
    const porId: Record<string, string> = {};
    for (const linha of (data as { publication_id: string; failure_reason: string | null }[] | null) ?? []) {
      if (linha.failure_reason) porId[linha.publication_id] = linha.failure_reason;
    }
    for (const pub of canceladas) {
      if (pub.external_account_id && porId[pub.id]) motivoPorConta[pub.external_account_id] = porId[pub.id];
    }
  }
  type Conta = { id: string; platform: string; display_name: string | null; handle: string | null };
  const perfis: PerfilDaPeca[] = ((contasRes.data as Conta[] | null) ?? []).map((c) => {
    const cx = conexao[c.id];
    const automatico = c.platform === "instagram" && cx?.connection_status === "connected" && cx?.automation_enabled === true &&
      (!cx.expires_at || Date.parse(cx.expires_at) > Date.now());
    return {
      id: c.id,
      platform: c.platform === "facebook" ? "facebook" : "instagram",
      nome: (c.display_name || "").trim() || (c.platform === "facebook" ? "Página do Facebook" : "Instagram"),
      handle: c.handle ? String(c.handle) : null,
      automatico,
      escolhido: vivas.has(c.id),
      // Cancelada aqui ou numa revisão anterior (sem linha viva neste post).
      cancelada: canceladas.some((p) => p.external_account_id === c.id) ||
        (!vivas.has(c.id) && !!post && contaTravadaNaCadeia(post, c.id)),
      motivoCancelamento: motivoPorConta[c.id] || null,
    };
  });
  // Instagram primeiro (é o que o painel publica sozinho), depois as páginas.
  perfis.sort((a, b) => (a.platform === b.platform ? 0 : a.platform === "instagram" ? -1 : 1));
  return { projectId, perfis, post };
}

/** Toda lâmina tem o sha256 que o envio automático exige (mesma regra do agendador da Mesa). */
async function laminasComAssinatura(db: SupabaseClient, raizId: string): Promise<boolean> {
  if (!UUID.test(raizId)) return false;
  const { data } = await db.from("files").select("id, sha256").or(`id.eq.${raizId},parent_file_id.eq.${raizId}`);
  const lista = (data as { sha256: string | null }[] | null) ?? [];
  return lista.length > 0 && lista.every((f) => !!f.sha256 && /^[0-9a-f]{64}$/i.test(f.sha256));
}

/**
 * Confirmar com os perfis escolhidos: o post fica com exatamente esses
 * perfis, todos na data. Só enquanto nenhuma publicação saiu do plano
 * (agendada, publicada ou em falha): nesse caso devolve null quando o
 * conjunto é o mesmo (segue o reagendar de sempre) e recusa quando mudou.
 */
async function confirmarComPerfis(
  ctx: ContextoDaAgenda,
  t: TrabalhoParaAgenda,
  pedido: { quando: string | null; agoraMesmo?: boolean; mutationId: string; perfis: string[] },
  agora: Date,
): Promise<ResultadoDaData | null> {
  const lidos = await perfisDaPeca(ctx.db, t, ctx.doChamador);
  const perfis = lidos.perfis;
  let post = lidos.post;
  if (!post) throw new ErroDaAgenda(409, "fora_da_agenda", "Esta peça ainda não está na Agenda. Use Levar para a Agenda.");
  const ids = perfisValidos(pedido.perfis, perfis);
  if (!ids.length) {
    throw new ErroDaAgenda(
      400,
      "sem_perfil",
      perfis.length ? "Escolha ao menos um perfil, ou marque que não vai postar." : "O projeto não tem perfil ligado. Ligue o Instagram na Agenda.",
    );
  }
  const vivas = post.publications.filter((p) => p.status !== "cancelled");
  const foraDoPlano = vivas.filter((p) => p.status !== "planned");
  const atuais = vivas.map((p) => p.external_account_id || "").sort().join(",");
  if (foraDoPlano.length) {
    if (foraDoPlano.some((p) => p.status === "published")) throw new ErroDaAgenda(409, "ja_publicado", "Esta peça já foi publicada.");
    if (atuais === ids.slice().sort().join(",")) return null;
    throw new ErroDaAgenda(409, "perfis_agendados", "A publicação já está agendada. Desfaça o agendamento para trocar os perfis.");
  }
  const raiz = await lerArquivo(ctx.db, post.primary_file_id);
  const aprovado = arquivoAprovado(raiz);
  let quando = pedido.quando;
  if (pedido.agoraMesmo) {
    if (!aprovado) throw new ErroDaAgenda(409, "sem_aprovacao", "Sem a aprovação do cliente não publica.");
    quando = new Date(agora.getTime() + PUBLICAR_AGORA_EM_MIN * 60_000).toISOString();
  }
  const problema = problemaNoHorario(quando, agora, { agoraMesmo: !!pedido.agoraMesmo });
  if (problema) throw new ErroDaAgenda(400, "horario_invalido", problema);
  const assinadas = aprovado && raiz ? await laminasComAssinatura(ctx.db, raiz.id) : false;
  const escolhidos = ids.map((id) => {
    const p = perfis.find((x) => x.id === id) as PerfilDaPeca;
    return { id: p.id, platform: p.platform, automatico: p.automatico && assinadas && t.file_ids.length <= 10 };
  });
  const canceladasEscolhidas = post.publications.filter((p) => p.status === "cancelled" && ids.includes(p.external_account_id || ""));
  // Cancelada numa revisão anterior, sem linha neste post: o admin/gestor que
  // marca a conta aqui é a marca explícita (o banco confere o papel).
  // Cadeia incompleta: conta não decidida também conta como travada.
  const reabrir = ids.filter(
    (id) => !post!.publications.some((p) => p.external_account_id === id) && contaTravadaNaCadeia(post!, id),
  );
  if (canceladasEscolhidas.length) {
    if (!quando) throw new ErroDaAgenda(400, "horario_invalido", "Escolha data e hora para reabrir a publicação cancelada.");
    let versao = post.version;
    const restamPlanejadas = post.publications.some((p) => p.status === "planned");
    if (restamPlanejadas || reabrir.length) {
      const payloadPlanejado = await payloadComPerfis(post, {
        trabalhoId: t.id,
        rodada: Math.max(1, Number(t.entrega_rodada) || 1),
        perfis: escolhidos.filter((p) => !canceladasEscolhidas.some((c) => c.external_account_id === p.id)),
        quando,
        mutationId: pedido.mutationId,
        assetFileIds: aprovado ? t.file_ids.slice() : null,
        reabrir,
      });
      const salvo = await ctx.doChamador.rpc("save_editorial_post", { p_payload: payloadPlanejado, p_expected_version: versao });
      if (salvo.error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(salvo.error));
      versao = Number((salvo.data as { version?: number } | null)?.version) || versao;
    }
    const reaberto = await reagendarCanceladas(ctx, post, ids, quando, versao);
    return { post_id: post.id, publicacao_id: reaberto.publicacao_id, quando, status: reaberto.status };
  }
  const payload = await payloadComPerfis(post, {
    trabalhoId: t.id,
    rodada: Math.max(1, Number(t.entrega_rodada) || 1),
    perfis: escolhidos,
    quando,
    mutationId: pedido.mutationId,
    assetFileIds: aprovado ? t.file_ids.slice() : null,
    reabrir,
  });
  const { error } = await ctx.doChamador.rpc("save_editorial_post", { p_payload: payload, p_expected_version: post.version });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  const relido = await lerPostDaAgenda(ctx.db, post.id);
  const pub = publicacaoDaPeca(relido?.publications || []);
  return { post_id: post.id, publicacao_id: pub?.id || "", quando, status: pub?.status || (aprovado ? "scheduled" : "planned") };
}

