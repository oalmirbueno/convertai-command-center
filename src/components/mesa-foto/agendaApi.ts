import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, enviarParaAprovacao } from "@/lib/mesa/api";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import {
  ehPostDeFotos,
  formatoDoPerfil,
  formatoDoPostDeFotos,
  type FormatoDoPerfil,
  type FormatoDoPostDeFotos,
} from "../../../supabase/functions/_shared/post-de-fotos";

/**
 * Post de fotos na Agenda, na tela (frente MF, 27/09; regras em
 * supabase/functions/_shared/post-de-fotos.ts). O post é um trabalho do
 * Estúdio marcado "só fotos": as ações são as de sempre da estudio-arte
 * (fotos_preparar, legenda, entregar) e a aprovação é a da Mesa
 * (mesa_enviar_para_aprovacao). A lista vem direto do banco (a equipe lê
 * estudio_trabalhos, tasks e as publicações do post pela RLS de sempre).
 */

export interface PublicacaoDoPostDeFotos {
  id: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  permalink: string | null;
  platform: string | null;
}

export interface PostDeFotos {
  id: string;
  client_id: string;
  task_id: string | null;
  status: string;
  direcao: Record<string, unknown>;
  cards: Array<{ ordem: number; versao: number; storage_path: string; imagem_id?: string | null; formato_post?: string | null }>;
  file_ids: string[];
  legenda: string | null;
  hashtags: string[];
  entrega_status: string | null;
  entrega_aviso: string | null;
  entrega_rodada: number | null;
  post_id: string | null;
  aprovado_em: string | null;
  publicar_em: string | null;
  publicar_em_confirmado_em: string | null;
  publicar_ao_aprovar: boolean | null;
  agenda_aviso: string | null;
  ajustes_do_cliente: unknown;
  atualizado_em: string;
  /** O item da Agenda (tasks). */
  item: { id: string; title: string; due_date: string | null; delivery_type: string | null } | null;
  /** A publicação do post (Instagram), quando já está na Agenda. */
  publicacao: PublicacaoDoPostDeFotos | null;
  formato: FormatoDoPostDeFotos;
  imagem_ids: string[];
}

export interface ItemDaAgendaParaFotos {
  id: string;
  title: string;
  due_date: string | null;
  delivery_type: string | null;
  /** O trabalho do item no Estúdio: post de fotos, arte em andamento ou nenhum. */
  situacao: "livre" | "post_de_fotos" | "arte";
  trabalho_id: string | null;
}

const CAMPOS_DO_POST =
  "id, client_id, task_id, status, direcao, cards, file_ids, legenda, hashtags, entrega_status, entrega_aviso, entrega_rodada, post_id, aprovado_em, publicar_em, publicar_em_confirmado_em, publicar_ao_aprovar, agenda_aviso, ajustes_do_cliente, atualizado_em";

export const chaveDosPostsDeFotos = (clientId: string) => ["mesa-foto", "posts-de-fotos", clientId];
export const chaveDosItensParaFotos = (clientId: string) => ["mesa-foto", "itens-para-fotos", clientId];
export const chaveDoFormatoDoPerfil = (clientId: string) => ["mesa", "formato-do-perfil", clientId];

const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const textoOuNulo = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Normaliza a linha do banco (JSON lido com cuidado). */
export function normalizarPostDeFotos(t: any, item: PostDeFotos["item"], publicacao: PublicacaoDoPostDeFotos | null): PostDeFotos {
  const direcao = t && t.direcao && typeof t.direcao === "object" ? (t.direcao as Record<string, unknown>) : {};
  const fotos = direcao.fotos && typeof direcao.fotos === "object" ? lista<string>((direcao.fotos as Record<string, unknown>).imagem_ids) : [];
  return {
    id: String(t.id),
    client_id: String(t.client_id),
    task_id: textoOuNulo(t.task_id),
    status: String(t.status || "rascunho"),
    direcao,
    cards: lista<PostDeFotos["cards"][number]>(t.cards).slice().sort((a, b) => a.ordem - b.ordem),
    file_ids: lista<string>(t.file_ids),
    legenda: textoOuNulo(t.legenda),
    hashtags: lista<string>(t.hashtags),
    entrega_status: textoOuNulo(t.entrega_status),
    entrega_aviso: textoOuNulo(t.entrega_aviso),
    entrega_rodada: typeof t.entrega_rodada === "number" ? t.entrega_rodada : null,
    post_id: textoOuNulo(t.post_id),
    aprovado_em: textoOuNulo(t.aprovado_em),
    publicar_em: textoOuNulo(t.publicar_em),
    publicar_em_confirmado_em: textoOuNulo(t.publicar_em_confirmado_em),
    publicar_ao_aprovar: typeof t.publicar_ao_aprovar === "boolean" ? t.publicar_ao_aprovar : null,
    agenda_aviso: textoOuNulo(t.agenda_aviso),
    ajustes_do_cliente: t.ajustes_do_cliente ?? null,
    atualizado_em: String(t.atualizado_em || ""),
    item,
    publicacao,
    formato: formatoDoPostDeFotos(direcao.formato),
    imagem_ids: fotos,
  };
}

/** Publicação do Instagram entre as do post (a que vale para a peça). */
function publicacaoDoInstagram(pubs: PublicacaoDoPostDeFotos[]): PublicacaoDoPostDeFotos | null {
  const doInstagram = pubs.filter((p) => !p.platform || p.platform === "instagram");
  const vivas = doInstagram.filter((p) => p.status !== "cancelled");
  return vivas[0] || doInstagram[0] || null;
}

/** Os posts de fotos do cliente (os mais novos primeiro), com o item e a publicação. */
export async function lerPostsDeFotos(clientId: string): Promise<PostDeFotos[]> {
  const { data, error } = await (supabase as any)
    .from("estudio_trabalhos")
    .select(CAMPOS_DO_POST)
    .eq("client_id", clientId)
    .eq("direcao->>so_fotos", "true")
    .order("atualizado_em", { ascending: false })
    .limit(60);
  if (error) throw error;
  const trabalhos = lista<any>(data).filter((t) => ehPostDeFotos(t.direcao) && t.task_id);
  if (!trabalhos.length) return [];
  const taskIds = trabalhos.map((t) => String(t.task_id));
  const postIds = trabalhos.map((t) => t.post_id).filter((x) => typeof x === "string" && x) as string[];
  const [tarefas, pubs] = await Promise.all([
    (supabase as any).from("tasks").select("id, title, due_date, delivery_type, deleted_at").in("id", taskIds),
    postIds.length
      ? (supabase as any).from("editorial_publications").select("id, post_id, status, scheduled_at, published_at, permalink, platform").in("post_id", postIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const porTarefa = new Map(lista<any>(tarefas.data).filter((t) => !t.deleted_at).map((t) => [String(t.id), t]));
  const porPost = new Map<string, PublicacaoDoPostDeFotos[]>();
  lista<any>(pubs.data).forEach((p) => {
    const k = String(p.post_id);
    porPost.set(k, (porPost.get(k) || []).concat([{ id: String(p.id), status: String(p.status || ""), scheduled_at: textoOuNulo(p.scheduled_at), published_at: textoOuNulo(p.published_at), permalink: textoOuNulo(p.permalink), platform: textoOuNulo(p.platform) }]));
  });
  return trabalhos
    .filter((t) => porTarefa.has(String(t.task_id)))
    .map((t) => {
      const tarefa = porTarefa.get(String(t.task_id));
      const item = tarefa ? { id: String(tarefa.id), title: String(tarefa.title || "Post de fotos"), due_date: textoOuNulo(tarefa.due_date), delivery_type: textoOuNulo(tarefa.delivery_type) } : null;
      return normalizarPostDeFotos(t, item, t.post_id ? publicacaoDoInstagram(porPost.get(String(t.post_id)) || []) : null);
    })
    .sort((a, b) => String((a.item && a.item.due_date) || "9999").localeCompare(String((b.item && b.item.due_date) || "9999")));
}

export function usePostsDeFotos(clientId: string) {
  return useQuery({ queryKey: chaveDosPostsDeFotos(clientId), enabled: !!clientId, staleTime: 20_000, queryFn: () => lerPostsDeFotos(clientId) });
}

const hojeISO = () => {
  const d = new Date();
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
};

/** Itens de post da Agenda dos próximos 60 dias (e dos 7 anteriores), com o que o Estúdio já tem em cada um. */
export async function lerItensParaFotos(clientId: string): Promise<ItemDaAgendaParaFotos[]> {
  const { data: projetos, error: e1 } = await (supabase as any).from("projects").select("id").eq("client_id", clientId).is("deleted_at", null).limit(200);
  if (e1) throw e1;
  const ids = lista<any>(projetos).map((p) => String(p.id));
  if (!ids.length) return [];
  const inicio = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const fim = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const { data: tarefas, error: e2 } = await (supabase as any)
    .from("tasks")
    .select("id, title, due_date, delivery_type")
    .in("project_id", ids)
    .in("delivery_type", ["carousel", "static", "design"])
    .is("deleted_at", null)
    .gte("due_date", inicio)
    .lte("due_date", fim)
    .order("due_date", { ascending: true })
    .limit(120);
  if (e2) throw e2;
  const lidas = lista<any>(tarefas);
  if (!lidas.length) return [];
  const { data: trabalhos } = await (supabase as any)
    .from("estudio_trabalhos")
    .select("id, task_id, status, direcao, cards, file_ids, entrega_status")
    .eq("client_id", clientId)
    .in("task_id", lidas.map((t) => String(t.id)));
  const porTarefa = new Map<string, any[]>();
  lista<any>(trabalhos).forEach((t) => porTarefa.set(String(t.task_id), (porTarefa.get(String(t.task_id)) || []).concat([t])));
  return lidas.map((t) => {
    const doItem = porTarefa.get(String(t.id)) || [];
    const deFotos = doItem.find((x) => ehPostDeFotos(x.direcao));
    const arte = doItem.find((x) => !ehPostDeFotos(x.direcao) && (lista(x.cards).length || lista(x.file_ids).length || x.entrega_status));
    return {
      id: String(t.id),
      title: String(t.title || "Post"),
      due_date: textoOuNulo(t.due_date),
      delivery_type: textoOuNulo(t.delivery_type),
      situacao: deFotos ? "post_de_fotos" : arte ? "arte" : "livre",
      trabalho_id: deFotos ? String(deFotos.id) : arte ? String(arte.id) : null,
    } as ItemDaAgendaParaFotos;
  });
}

export function useItensParaFotos(clientId: string, ligado = true) {
  return useQuery({ queryKey: chaveDosItensParaFotos(clientId), enabled: !!clientId && ligado, staleTime: 30_000, queryFn: () => lerItensParaFotos(clientId) });
}

export const DATA_DE_HOJE = hojeISO;

// ------------------------------------------------------------------ ações

export interface RespostaDoPreparo {
  trabalho: any;
  task: { id: string; title: string | null; due_date: string | null; delivery_type: string | null } | null;
  criado: boolean;
  convertido: boolean;
  item_criado: boolean;
  recusadas: { id: string; nome: string; motivo: string }[];
  avisos: string[];
  sem_aprovacao_da_equipe: number;
}

/** Cria ou atualiza o post de fotos (sem custo: nada é gerado). */
export async function prepararPostDeFotos(p: {
  clientId: string;
  imagemIds: string[];
  formato: FormatoDoPostDeFotos;
  taskId?: string | null;
  trabalhoId?: string | null;
  novoItem?: { titulo: string; data: string } | null;
  pedidoId?: string;
}): Promise<RespostaDoPreparo> {
  const corpo: Record<string, unknown> = { acao: "fotos_preparar", client_id: p.clientId, imagem_ids: p.imagemIds.slice(0, 40), formato: p.formato };
  if (p.taskId) corpo.task_id = p.taskId;
  if (p.trabalhoId) corpo.trabalho_id = p.trabalhoId;
  if (!p.taskId && p.novoItem) corpo.novo_item = p.novoItem;
  if (p.pedidoId) corpo.pedido_id = p.pedidoId;
  const data = await chamarFuncao<any>("estudio-arte", corpo);
  return {
    trabalho: data && data.trabalho,
    task: data && data.task ? data.task : null,
    criado: !!(data && data.criado),
    convertido: !!(data && data.convertido),
    item_criado: !!(data && data.item_criado),
    recusadas: lista(data && data.recusadas),
    avisos: lista<string>(data && data.avisos).filter((x) => typeof x === "string"),
    sem_aprovacao_da_equipe: Number(data && data.sem_aprovacao_da_equipe) || 0,
  };
}

/** Legenda do post pelo diretor do Estúdio (a mesma ferramenta das artes). */
export function escreverLegenda(trabalhoId: string): Promise<{ legenda?: string; hashtags?: string[]; custo_usd?: number }> {
  return chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalhoId });
}

/** Grava a legenda e as hashtags editadas à mão (o mesmo caminho do Estúdio). */
export async function salvarLegendaDoPost(trabalhoId: string, legenda: string, hashtags: string[]): Promise<void> {
  const { error } = await (supabase as any).from("estudio_trabalhos").update({ legenda: legenda.trim() || null, hashtags }).eq("id", trabalhoId);
  if (error) throw error;
}

/**
 * Enviar para o cliente aprovar: entrega em Arquivos (e na Agenda, sem data;
 * em partes quando precisa) e o envio da Mesa (revisão da agência, depois o
 * cliente). A publicação só sai com a aprovação e a data confirmada.
 */
export async function entregarEEnviar(post: Pick<PostDeFotos, "id" | "status" | "file_ids" | "entrega_status">): Promise<{ entregue: boolean; enviado: boolean; resultado: unknown }> {
  let entregue = post.status === "entregue" && post.file_ids.length > 0;
  if (!entregue) {
    await repetirEntregaEmPartes(() => chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: post.id }));
    entregue = true;
  }
  const r = await enviarParaAprovacao([post.id]);
  return { entregue, enviado: true, resultado: r && r[0] ? r[0] : null };
}

/** A foto da persona (aba Modelos) vira foto do acervo: é o que liga Ampliar fiel, Estúdio, Mesa e Agenda. */
export async function levarFotoDaPersonaAoAcervo(p: { clientId: string; modeloId: string; imagemId: string }): Promise<{ imagem: any; ja_existia: boolean }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "modelo_imagem_para_acervo", client_id: p.clientId, modelo_id: p.modeloId, imagem_id: p.imagemId });
  return { imagem: data && data.imagem, ja_existia: !!(data && data.ja_existia) };
}

// ------------------------------------------------------------------ formato do perfil

/** Formato do perfil gravado (sem o SQL MF-01, a leitura falha: "artes" e o seletor avisa). */
export async function lerFormatoDoPerfil(clientId: string): Promise<{ formato: FormatoDoPerfil; disponivel: boolean }> {
  const { data, error } = await (supabase as any).from("mesa_cliente_config").select("formato_do_perfil").eq("client_id", clientId).maybeSingle();
  if (error) return { formato: "artes", disponivel: false };
  return { formato: formatoDoPerfil(data && data.formato_do_perfil), disponivel: true };
}

export function useFormatoDoPerfil(clientId: string) {
  return useQuery({ queryKey: chaveDoFormatoDoPerfil(clientId), enabled: !!clientId, staleTime: 60_000, retry: false, queryFn: () => lerFormatoDoPerfil(clientId) });
}

export async function salvarFormatoDoPerfil(clientId: string, formato: FormatoDoPerfil): Promise<void> {
  const { error } = await (supabase as any).rpc("mesa_config_formato_do_perfil", { _client_id: clientId, _formato: formato });
  if (error) throw error;
}

/** Depois de mexer num post: relê a lista, os itens e a Entrega da Mesa. */
export function invalidarPostsDeFotos(queryClient: QueryClient, clientId: string) {
  void queryClient.invalidateQueries({ queryKey: chaveDosPostsDeFotos(clientId) });
  void queryClient.invalidateQueries({ queryKey: chaveDosItensParaFotos(clientId) });
  void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
  void queryClient.invalidateQueries({ queryKey: ["mesa", "peca-do-post"] });
  void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
}

/** Sessão: as fotos escolhidas em qualquer etapa chegam ao post (Preparar na Agenda). */
export const CHAVE_DAS_FOTOS_DO_POST = "fotos-do-post";
