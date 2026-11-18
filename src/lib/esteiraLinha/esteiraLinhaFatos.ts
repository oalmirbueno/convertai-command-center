/**
 * Leitura da Esteira em linha do tempo: poucas consultas em lote para a
 * carteira inteira (nunca uma por cliente), recortadas pela semana visível.
 * Só leitura: nada aqui grava.
 *
 * Caminho: as publicações e as tarefas de conteúdo que caem na semana dizem
 * quais peças interessam; a partir delas vêm os posts, as outras publicações
 * desses posts, os trabalhos do Estúdio e a aprovação dos arquivos.
 */

import { supabase } from "@/integrations/supabase/client";
import { contentTypeForDeliveryType, isPublishableTask } from "@/lib/taskDeliveryTypes";
import { janelaDeLeitura, type ArquivoDaPeca, type DiasDoPeriodo, type PecaFato, type RevisaoInterna } from "./esteiraLinha";

export interface LinhaDePost {
  id: string;
  client_id: string;
  title: string | null;
  content_type: string | null;
  production_status: string | null;
  primary_file_id: string | null;
  archived_at: string | null;
}

export interface LinhaDePublicacao {
  id: string;
  post_id: string;
  client_id: string;
  file_id: string | null;
  status: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  permalink: string | null;
}

export interface LinhaDeTarefa {
  id: string;
  client_id: string;
  title: string | null;
  status: string | null;
  due_date: string | null;
  delivery_type: string | null;
  source: string | null;
}

export interface LinhaDeVinculo {
  post_id: string;
  task_id: string | null;
}

export interface LinhaDeTrabalho {
  id?: string;
  task_id: string | null;
  post_id: string | null;
  client_id: string;
  status: string | null;
  entrega_status: string | null;
  file_ids: string[] | null;
  atualizado_em?: string | null;
  /** Carimbo da revisão interna (fase 2). Ausente enquanto a migration não estiver no banco. */
  revisado_por?: string | null;
  revisado_em?: string | null;
  revisao_decisao?: string | null;
  revisao_arquivo_id?: string | null;
}

/** As colunas do carimbo, lidas à parte (ver `lerCarimbos`). */
export interface LinhaDeCarimbo {
  id: string;
  revisado_por: string | null;
  revisado_em: string | null;
  revisao_decisao: string | null;
  revisao_arquivo_id: string | null;
}

export interface LinhaDeRevisor {
  id: string;
  full_name: string | null;
}

export interface LinhaDeArquivo extends ArquivoDaPeca {
  id: string;
}

export interface LinhasDaEsteiraLinha {
  posts: LinhaDePost[];
  publicacoes: LinhaDePublicacao[];
  tarefas: LinhaDeTarefa[];
  vinculos: LinhaDeVinculo[];
  trabalhos: LinhaDeTrabalho[];
  arquivos: LinhaDeArquivo[];
  /** Nome de quem carimbou a revisão interna (para o `title` do cartão). */
  revisores?: LinhaDeRevisor[];
}

const POST_ATIVO = new Set(["draft", "production", "ready"]);
const postAtivo = (p: LinhaDePost) => !p.archived_at && POST_ATIVO.has(String(p.production_status));
const temArquivos = (t: LinhaDeTrabalho) => Array.isArray(t.file_ids) && t.file_ids.length > 0;

/** Entre dois trabalhos da mesma peça vale o que tem arte e, entre esses, o mais recente. */
function melhorTrabalho(atual: LinhaDeTrabalho | undefined, novo: LinhaDeTrabalho): LinhaDeTrabalho {
  if (!atual) return novo;
  if (temArquivos(novo) !== temArquivos(atual)) return temArquivos(novo) ? novo : atual;
  return String(novo.atualizado_em || "") > String(atual.atualizado_em || "") ? novo : atual;
}

/**
 * O carimbo da revisão interna, só quando vale para a arte atual: se o
 * arquivo principal mudou depois da revisão, o carimbo é de uma arte antiga
 * e não conta.
 */
export function revisaoDoTrabalho(t: LinhaDeTrabalho, nomeDe: (id: string) => string | null = () => null): RevisaoInterna | null {
  if (t.revisao_decisao !== "aprovado" && t.revisao_decisao !== "ajuste") return null;
  const arquivoAtual = Array.isArray(t.file_ids) && t.file_ids.length > 0 ? t.file_ids[0] : null;
  if ((t.revisao_arquivo_id ?? null) !== arquivoAtual) return null;
  const por = t.revisado_por ?? null;
  return { decisao: t.revisao_decisao, em: t.revisado_em ?? null, por, porNome: por ? nomeDe(por) : null };
}

const semExtensao = (titulo: string) => titulo.replace(/\.(png|jpe?g|webp|mp4|mov)$/i, "");

/**
 * Junta as linhas das tabelas em peças (pura). Um post é uma peça; a tarefa
 * de conteúdo que ainda não virou post ativo é outra. Tarefa que já tem post
 * ativo não aparece duas vezes: ela só empresta o prazo e o trabalho do
 * Estúdio ao post.
 */
export function juntarPecas(linhas: LinhasDaEsteiraLinha): PecaFato[] {
  const tarefaPorId = new Map(linhas.tarefas.map((t) => [t.id, t]));
  const arquivoPorId = new Map(linhas.arquivos.map((a) => [a.id, a]));
  const trabalhoPorTarefa = new Map<string, LinhaDeTrabalho>();
  const trabalhoPorPost = new Map<string, LinhaDeTrabalho>();
  for (const t of linhas.trabalhos) {
    if (t.task_id) trabalhoPorTarefa.set(t.task_id, melhorTrabalho(trabalhoPorTarefa.get(t.task_id), t));
    if (t.post_id) trabalhoPorPost.set(t.post_id, melhorTrabalho(trabalhoPorPost.get(t.post_id), t));
  }
  const tarefaDoPost = new Map<string, string>();
  for (const v of linhas.vinculos) if (v.task_id && !tarefaDoPost.has(v.post_id)) tarefaDoPost.set(v.post_id, v.task_id);
  const publicacoesDoPost = new Map<string, LinhaDePublicacao[]>();
  for (const p of linhas.publicacoes) {
    const lista = publicacoesDoPost.get(p.post_id) ?? [];
    lista.push(p);
    publicacoesDoPost.set(p.post_id, lista);
  }

  const arquivosDe = (ids: Array<string | null | undefined>): ArquivoDaPeca[] => {
    const vistos = new Set<string>();
    const saida: ArquivoDaPeca[] = [];
    for (const id of ids) {
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const arquivo = arquivoPorId.get(id);
      if (arquivo) {
        saida.push({
          approval_status: arquivo.approval_status,
          agency_approval_status: arquivo.agency_approval_status,
          agency_reviewed_by: arquivo.agency_reviewed_by ?? null,
          agency_reviewed_at: arquivo.agency_reviewed_at ?? null,
        });
      }
    }
    return saida;
  };
  const nomeDoRevisor = new Map((linhas.revisores ?? []).map((r) => [r.id, r.full_name]));
  const trabalhoDaPeca = (t: LinhaDeTrabalho | undefined) =>
    t
      ? {
          status: t.status ?? null,
          entrega_status: t.entrega_status ?? null,
          temArquivo: temArquivos(t),
          revisao: revisaoDoTrabalho(t, (id) => nomeDoRevisor.get(id) ?? null),
        }
      : null;

  const pecas: PecaFato[] = [];
  const tarefasComPost = new Set<string>();

  for (const post of linhas.posts) {
    const taskId = tarefaDoPost.get(post.id) ?? null;
    if (taskId && postAtivo(post)) tarefasComPost.add(taskId);
    const tarefa = taskId ? tarefaPorId.get(taskId) : undefined;
    const trabalho = trabalhoPorPost.get(post.id) ?? (taskId ? trabalhoPorTarefa.get(taskId) : undefined);
    if (trabalho?.task_id && postAtivo(post)) tarefasComPost.add(trabalho.task_id);
    const publicacoes = (publicacoesDoPost.get(post.id) ?? []).filter((p) => p.status !== "cancelled");
    pecas.push({
      chave: `post:${post.id}`,
      clientId: post.client_id,
      titulo: semExtensao(String(post.title || "Post sem título")),
      contentType: post.content_type,
      post: {
        id: post.id,
        production_status: post.production_status,
        archived_at: post.archived_at,
        temArquivo: Boolean(post.primary_file_id) || publicacoes.some((p) => Boolean(p.file_id)),
      },
      publicacoes: publicacoes.map((p) => ({ status: p.status, scheduled_at: p.scheduled_at, published_at: p.published_at, permalink: p.permalink })),
      tarefa: tarefa ? { id: tarefa.id, status: tarefa.status, due_date: tarefa.due_date } : null,
      trabalho: trabalhoDaPeca(trabalho),
      arquivos: arquivosDe([post.primary_file_id, ...publicacoes.map((p) => p.file_id), trabalho?.file_ids?.[0]]),
    });
  }

  for (const tarefa of linhas.tarefas) {
    if (tarefasComPost.has(tarefa.id)) continue;
    if (!isPublishableTask(tarefa)) continue;
    const trabalho = trabalhoPorTarefa.get(tarefa.id);
    pecas.push({
      chave: `task:${tarefa.id}`,
      clientId: tarefa.client_id,
      titulo: String(tarefa.title || "Tarefa sem título"),
      contentType: contentTypeForDeliveryType(tarefa.delivery_type?.toLocaleLowerCase("pt-BR")),
      post: null,
      publicacoes: [],
      tarefa: { id: tarefa.id, status: tarefa.status, due_date: tarefa.due_date },
      trabalho: trabalhoDaPeca(trabalho),
      arquivos: arquivosDe([trabalho?.file_ids?.[0]]),
    });
  }
  return pecas;
}

// ------------------------------------------------------------------ banco (só leitura)

const PAGINA = 1000;
const LOTE = 100;
const ERRO_DE_LEITURA = "Não foi possível ler todos os dados da Esteira. Tente atualizar de novo.";

type Consulta = {
  order: (coluna: string) => { range: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> };
};

/** Lê todas as páginas de uma consulta (o servidor devolve no máximo 1000 linhas por vez). */
async function lerTudo<T>(montar: () => Consulta, ordem: string): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar().order(ordem).range(de, de + PAGINA - 1);
    if (error) throw new Error(ERRO_DE_LEITURA);
    linhas.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGINA) return linhas;
  }
}

/** Lista longa de ids vai em lotes, para a URL da consulta não estourar. */
async function lerEmLotes<T>(ids: string[], montar: (lote: string[]) => Consulta, ordem: string): Promise<T[]> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += LOTE) lotes.push(unicos.slice(i, i + LOTE));
  const partes = await Promise.all(lotes.map((lote) => lerTudo<T>(() => montar(lote), ordem)));
  return partes.flat();
}

/**
 * O carimbo da revisão interna e o nome de quem revisou são lidos à parte e
 * com tolerância: o painel publica antes de a migration da fase 2 chegar ao
 * banco, e pedir uma coluna que ainda não existe derrubaria a Esteira
 * inteira. Se esta leitura falhar, a grade segue sem o carimbo.
 */
async function lerCarimbos(db: { from: (tabela: string) => { select: (colunas: string) => { in: (coluna: string, valores: string[]) => Consulta } } }, trabalhoIds: string[]): Promise<{ carimbos: LinhaDeCarimbo[]; revisores: LinhaDeRevisor[] }> {
  try {
    const carimbos = (await lerEmLotes<LinhaDeCarimbo>(trabalhoIds, (lote) =>
      db.from("estudio_trabalhos").select("id, revisado_por, revisado_em, revisao_decisao, revisao_arquivo_id").in("id", lote), "id"))
      .filter((c) => Boolean(c.revisao_decisao));
    let revisores: LinhaDeRevisor[] = [];
    try {
      revisores = await lerEmLotes<LinhaDeRevisor>(carimbos.map((c) => c.revisado_por || ""), (lote) =>
        db.from("profiles").select("id, full_name").in("id", lote), "id");
    } catch {
      revisores = [];
    }
    return { carimbos, revisores };
  } catch {
    return { carimbos: [], revisores: [] };
  }
}

/**
 * Lê as linhas do período que começa em `segunda` (YYYY-MM-DD, São Paulo)
 * para os clientes dados: 7 dias (padrão) ou 14. A janela do banco tem um
 * dia de folga de cada lado; quem decide o dia certo é a regra pura, no fuso
 * de São Paulo.
 */
export async function lerLinhasDaEsteiraLinha(clientIds: string[], segunda: string, dias: DiasDoPeriodo = 7): Promise<LinhasDaEsteiraLinha> {
  const vazio: LinhasDaEsteiraLinha = { posts: [], publicacoes: [], tarefas: [], vinculos: [], trabalhos: [], arquivos: [] };
  if (!clientIds.length) return vazio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { de, ate } = janelaDeLeitura(segunda, dias);
  const deInstante = `${de}T00:00:00Z`;
  const ateInstante = `${ate}T00:00:00Z`;
  const COLUNAS_DA_PUBLICACAO = "id, post_id, client_id, file_id, status, scheduled_at, published_at, permalink";

  // 1) O que cai na semana: publicações e tarefas com prazo.
  const [publicacoesDaSemana, tarefasBrutas] = await Promise.all([
    lerEmLotes<LinhaDePublicacao>(clientIds, (lote) =>
      db.from("editorial_publications").select(COLUNAS_DA_PUBLICACAO).in("client_id", lote).neq("status", "cancelled")
        .or(`and(scheduled_at.gte.${deInstante},scheduled_at.lt.${ateInstante}),and(published_at.gte.${deInstante},published_at.lt.${ateInstante})`), "id"),
    lerEmLotes<Record<string, unknown>>(clientIds, (lote) =>
      db.from("tasks").select("id, title, status, due_date, delivery_type, source, projects!inner(client_id, deleted_at)")
        .is("deleted_at", null).is("projects.deleted_at", null).in("projects.client_id", lote).gte("due_date", de).lte("due_date", ate), "id"),
  ]);
  const tarefas: LinhaDeTarefa[] = tarefasBrutas.map((t) => {
    const projeto = t.projects as { client_id?: string } | Array<{ client_id?: string }> | null;
    const clientId = Array.isArray(projeto) ? projeto[0]?.client_id : projeto?.client_id;
    return {
      id: String(t.id),
      client_id: String(clientId || ""),
      title: (t.title as string) ?? null,
      status: (t.status as string) ?? null,
      due_date: (t.due_date as string) ?? null,
      delivery_type: (t.delivery_type as string) ?? null,
      source: (t.source as string) ?? null,
    };
  }).filter((t) => Boolean(t.client_id));
  const taskIds = tarefas.map((t) => t.id);

  // 2) O que as tarefas da semana já têm: post e trabalho do Estúdio.
  const COLUNAS_DO_TRABALHO = "task_id, post_id, client_id, status, entrega_status, file_ids, atualizado_em";
  const [vinculos, trabalhosDasTarefas] = await Promise.all([
    lerEmLotes<LinhaDeVinculo>(taskIds, (lote) => db.from("editorial_post_internal").select("post_id, task_id").in("task_id", lote), "post_id"),
    lerEmLotes<LinhaDeTrabalho & { id?: string }>(taskIds, (lote) => db.from("estudio_trabalhos").select(`id, ${COLUNAS_DO_TRABALHO}`).in("task_id", lote), "id"),
  ]);

  // 3) Os posts dessas peças, todas as publicações deles e o trabalho ligado ao post.
  const postIds = Array.from(new Set([...publicacoesDaSemana.map((p) => p.post_id), ...vinculos.map((v) => v.post_id), ...trabalhosDasTarefas.map((t) => t.post_id || "")].filter(Boolean)));
  const [posts, publicacoes, trabalhosDosPosts] = await Promise.all([
    lerEmLotes<LinhaDePost>(postIds, (lote) =>
      db.from("editorial_posts").select("id, client_id, title, content_type, production_status, primary_file_id, archived_at").in("id", lote).in("client_id", clientIds), "id"),
    lerEmLotes<LinhaDePublicacao>(postIds, (lote) => db.from("editorial_publications").select(COLUNAS_DA_PUBLICACAO).in("post_id", lote).neq("status", "cancelled"), "id"),
    lerEmLotes<LinhaDeTrabalho & { id?: string }>(postIds, (lote) => db.from("estudio_trabalhos").select(`id, ${COLUNAS_DO_TRABALHO}`).in("post_id", lote), "id"),
  ]);
  const trabalhoPorId = new Map<string, LinhaDeTrabalho>();
  for (const t of [...trabalhosDasTarefas, ...trabalhosDosPosts]) trabalhoPorId.set(String(t.id), t);
  const { carimbos, revisores } = await lerCarimbos(db, Array.from(trabalhoPorId.keys()));
  for (const c of carimbos) {
    const t = trabalhoPorId.get(String(c.id));
    if (t) Object.assign(t, { revisado_por: c.revisado_por, revisado_em: c.revisado_em, revisao_decisao: c.revisao_decisao, revisao_arquivo_id: c.revisao_arquivo_id });
  }
  const trabalhos = Array.from(trabalhoPorId.values());

  // 4) A aprovação dos arquivos dessas peças (arte do post, da publicação e capa do Estúdio).
  const fileIds = [
    ...posts.map((p) => p.primary_file_id || ""),
    ...publicacoes.map((p) => p.file_id || ""),
    ...trabalhos.map((t) => (Array.isArray(t.file_ids) ? t.file_ids[0] || "" : "")),
  ];
  const arquivos = await lerEmLotes<LinhaDeArquivo>(fileIds, (lote) =>
    db.from("staff_files_secure").select("id, approval_status, agency_approval_status, agency_reviewed_by, agency_reviewed_at").in("id", lote), "id");

  return { posts, publicacoes, tarefas, vinculos, trabalhos, arquivos, revisores };
}

/** As peças do período, prontas para `montarGrade`. */
export async function lerPecasDaEsteiraLinha(clientIds: string[], segunda: string, dias: DiasDoPeriodo = 7): Promise<PecaFato[]> {
  return juntarPecas(await lerLinhasDaEsteiraLinha(clientIds, segunda, dias));
}

/**
 * A regra de aprovação do cliente que está no cadastro
 * (profiles.modo_aprovacao_do_cliente), por id. Leitura à parte e tolerante,
 * pelo mesmo motivo do carimbo: sem a coluna no banco, ou com erro, todo
 * mundo vale `portal` (o caminho normal, com aprovação do cliente).
 */
export async function lerModosDeAprovacao(clientIds: string[]): Promise<Record<string, string>> {
  if (!clientIds.length) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const linhas = await lerEmLotes<{ id: string; modo_aprovacao_do_cliente: string | null }>(clientIds, (lote) =>
      db.from("profiles").select("id, modo_aprovacao_do_cliente").in("id", lote), "id");
    return Object.fromEntries(linhas.filter((l) => l.modo_aprovacao_do_cliente).map((l) => [l.id, String(l.modo_aprovacao_do_cliente)]));
  } catch {
    return {};
  }
}
