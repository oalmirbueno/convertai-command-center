/**
 * Frente EA (27/09): a peça entregue pelo Estúdio entra e fica certa na
 * Agenda, e a data de publicação é confirmada na própria Entrega.
 *
 * Tudo passa pelas RPCs que a Agenda já usa (save_editorial_post,
 * transition_editorial_publication, archive_editorial_post), com o JWT de
 * quem chamou: as regras do banco valem (acesso, aprovação, quem pode
 * agendar) e cada evento fica com o autor certo. A leitura é pela chave de
 * serviço (a função já conferiu o acesso ao cliente).
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
} from "../_shared/entrega-na-agenda.ts";

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
  return {
    ...p,
    internal: (internoRes.data as PostExistente["internal"]) ?? null,
    publications: pubs.map((x) => ({ ...x, idempotency_key: chaves[x.id] ?? null })),
  };
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

/** Conta do Instagram ligada ao projeto (a primeira conectada). */
export async function contaDoProjeto(db: SupabaseClient, projectId: string, clientId: string): Promise<(ContaDoProjeto & { automatica: boolean }) | null> {
  const { data: links } = await db
    .from("project_external_accounts")
    .select("external_account_id")
    .eq("project_id", projectId)
    .eq("client_id", clientId);
  const ids = ((links as { external_account_id: string }[] | null) ?? []).map((l) => l.external_account_id);
  if (!ids.length) return null;
  const [contasRes, conexoesRes] = await Promise.all([
    db.from("external_accounts")
      .select("id, platform, status, created_at")
      .in("id", ids)
      .eq("client_id", clientId)
      .eq("platform", "instagram")
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    db.from("external_account_connections")
      .select("external_account_id, connection_status, automation_enabled")
      .in("external_account_id", ids),
  ]);
  const contas = (contasRes.data as { id: string; platform: string }[] | null) ?? [];
  const conexao: Record<string, { connection_status: string | null; automation_enabled: boolean | null }> = {};
  for (const c of (conexoesRes.data as { external_account_id: string; connection_status: string | null; automation_enabled: boolean | null }[] | null) ?? []) {
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
    contaDoProjeto(ctx.db, item.project_id, t.client_id),
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
    const anterior = await lerPostDaAgenda(ctx.db, plano.postAnteriorId).catch(() => null);
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
  if (!pub) throw new ErroDaAgenda(409, "sem_conta", "O post não tem publicação no Instagram. Ligue a conta do projeto na Agenda.");
  return { post, pub };
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
    const conta = pub.external_account_id ? await contaPorId(ctx.db, pub.external_account_id) : null;
    entrega = { delivery_mode: conta?.automatica ? "automatic" : "manual", asset_file_ids: t.file_ids.slice() };
  }
  const { error } = await ctx.doChamador.rpc("save_editorial_post", {
    p_payload: payloadComData(post, pub.id, quando, pedido.mutationId, entrega),
    p_expected_version: post.version,
  });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  return { post_id: post.id, publicacao_id: pub.id, quando, status: aprovado ? "scheduled" : "planned" };
}

async function contaPorId(db: SupabaseClient, id: string): Promise<{ automatica: boolean } | null> {
  const { data } = await db
    .from("external_account_connections")
    .select("connection_status, automation_enabled")
    .eq("external_account_id", id)
    .maybeSingle();
  const c = data as { connection_status: string | null; automation_enabled: boolean | null } | null;
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
  const [contasRes, conexoesRes] = await Promise.all([
    db.from("external_accounts")
      .select("id, platform, status, display_name, handle, created_at")
      .in("id", ids)
      .eq("client_id", t.client_id)
      .in("platform", PLATAFORMAS_DA_PECA)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    db.from("external_account_connections")
      .select("external_account_id, connection_status, automation_enabled, expires_at")
      .in("external_account_id", ids),
  ]);
  type Conexao = { external_account_id: string; connection_status: string | null; automation_enabled: boolean | null; expires_at: string | null };
  const conexao: Record<string, Conexao> = {};
  for (const c of (conexoesRes.data as Conexao[] | null) ?? []) conexao[c.external_account_id] = c;
  const vivas = new Set((post?.publications || []).filter((p) => p.status !== "cancelled").map((p) => p.external_account_id || ""));
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
  const { perfis, post } = await perfisDaPeca(ctx.db, t);
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
  const payload = await payloadComPerfis(post, {
    trabalhoId: t.id,
    rodada: Math.max(1, Number(t.entrega_rodada) || 1),
    perfis: escolhidos,
    quando,
    mutationId: pedido.mutationId,
    assetFileIds: aprovado ? t.file_ids.slice() : null,
  });
  const { error } = await ctx.doChamador.rpc("save_editorial_post", { p_payload: payload, p_expected_version: post.version });
  if (error) throw new ErroDaAgenda(409, "agenda_recusou", traduzirErroDaAgenda(error));
  const relido = await lerPostDaAgenda(ctx.db, post.id);
  const pub = publicacaoDaPeca(relido?.publications || []);
  return { post_id: post.id, publicacao_id: pub?.id || "", quando, status: pub?.status || (aprovado ? "scheduled" : "planned") };
}

