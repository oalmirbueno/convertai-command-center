import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { somarMeses } from "@/lib/mesa/api";
import type { BlocoTexto, LayoutLamina } from "@/lib/mesa/layout";
import { orderEditorialCarouselFiles, type EditorialMediaFile } from "@/lib/editorialMedia";

/** Item editorial da agenda (tarefa com entrega de arte) e o trabalho do estúdio dele. */
export interface ItemDoMes {
  id: string;
  title: string;
  due_date: string | null;
  delivery_type: string;
  status: string;
  project_id: string;
}

export interface Verificacao {
  pendente?: boolean;
  texto_lido?: string | null;
  ortografia_ok?: boolean | null;
  faltando?: string[];
  sobrando?: string[];
  logo_presente?: boolean | null;
  logo_ok?: boolean | null;
  identidade?: number | { score?: number; nota?: number | null; escala_max?: number; nivel?: string | null; motivo?: string } | { erro: string } | null;
  erro?: string;
  conferido_em?: string;
}

export interface CardGerado {
  ordem: number;
  versao: number;
  storage_path: string;
  origem?: "gerar" | "ajuste";
  instrucao?: string | null;
  verificacao?: Verificacao | null;
  criado_em?: string;
}

export interface CardDaDirecao {
  ordem: number;
  funcao?: string;
  texto_exato?: string;
  composicao?: string;
  ilustracao?: string;
  prompt_imagem?: string;
  /** Direção estruturada (diretor ou roteiro): texto por papel e layout da lâmina. */
  blocos?: BlocoTexto[];
  layout?: LayoutLamina;
  evitar?: string;
  /** Fotos reais do acervo (cliente_imagens) usadas como base desta lâmina. */
  imagens_ids?: string[];
  /** Referências só desta lâmina: sobrepõem as do conjunto ("g:" = banco da agência). */
  referencias_ids?: string[];
  /** Descrição da imagem da lâmina anterior (carrossel contínuo). */
  imagem_anterior?: string;
}

export interface Trabalho {
  id: string;
  task_id: string | null;
  status: "rascunho" | "dirigido" | "gerando" | "pronto" | "entregue" | "erro";
  direcao: {
    conceito?: string;
    /** O que se repete em todas as lâminas (protagonista, cenário, luz). */
    fio_visual?: string | null;
    carrossel_infinito?: boolean;
    cards?: CardDaDirecao[];
    origem?: "diretor" | "roteiro";
    /** Referências escolhidas para o conjunto (ids de cliente_referencias; "g:" + id para o banco da agência). */
    referencias_ids?: string[];
  };
  modelo_imagem_id: string | null;
  qualidade: string | null;
  cards: CardGerado[];
  legenda: string | null;
  hashtags?: string[] | null;
  file_ids: string[];
  custo_usd: number;
  conversa_id: string | null;
  atualizado_em: string;
  /** Entrega (etapa 3): o banco acompanha a aprovação e o agendamento. */
  entrega_status?: EntregaStatus | null;
  entrega_aviso?: string | null;
  entrega_rodada?: number | null;
  enviado_em?: string | null;
  aprovado_em?: string | null;
  post_id?: string | null;
  agendado_para?: string | null;
}

export type EntregaStatus =
  | "aguardando_agencia"
  | "aguardando_cliente"
  | "reprovado"
  | "aprovado"
  | "agendado"
  | "precisa_de_atencao";

/** Publicação do post criado na Agenda a partir da arte aprovada. */
export interface PublicacaoDoPost {
  post_id: string;
  status: string;
  scheduled_at: string | null;
  delivery_mode: string | null;
  published_at: string | null;
  permalink: string | null;
}

/** Arquivo de Arquivos (files) que a Agenda usa como arte do post. */
export interface ArquivoDaAgenda {
  id: string;
  nome: string | null;
  bucket: string | null;
  caminho: string | null;
  url: string | null;
}

/**
 * Arte que o item já tem na Agenda: post editorial ligado à tarefa, não
 * arquivado, com arquivo principal. Sem trabalho do estúdio, o item está
 * resolvido e não volta para "A fazer" (pedido do dono em 23/09: "não pode
 * repetir; eu vou acabar fazendo duas vezes").
 */
export interface ArteNaAgenda {
  post_id: string;
  titulo: string | null;
  legenda: string | null;
  status: string | null;
  capa: ArquivoDaAgenda | null;
  /** A arte do post é a que o Estúdio entregou (file_ids ou post do trabalho). */
  do_estudio: boolean;
}

/** Roteiro do estrategista (proposta gravada) do item. */
export interface InfoDoRoteiro {
  /** Lâminas detalhadas no roteiro; 0 = só o tema, a direção sai do diretor. */
  laminas: number;
  /** Contínuo pedido pelo estrategista (null = não disse). */
  continuo: boolean | null;
}

/**
 * O que a consulta guarda no cache: só JSON puro (objetos e listas), porque o
 * cache da Mesa é persistido no localStorage. Mapas e conjuntos são montados
 * depois, no `select`.
 */
export interface DadosDosItens {
  itens: ItemDoMes[];
  trabalhos: Record<string, Trabalho>;
  publicacoes: Record<string, PublicacaoDoPost>;
  roteiros: Record<string, InfoDoRoteiro>;
  artes: Record<string, ArteNaAgenda>;
}

/** Forma que as telas usam (Estúdio e Entrega): mapas montados do JSON do cache. */
export interface ItensDoMes {
  itens: ItemDoMes[];
  trabalhos: Map<string, Trabalho>;
  publicacoes: Map<string, PublicacaoDoPost>;
  /** Itens com roteiro detalhado do estrategista: a direção sai dele, sem custo. */
  roteiros: Set<string>;
  infoDoRoteiro: Map<string, InfoDoRoteiro>;
  artes: Map<string, ArteNaAgenda>;
}

export const ROTULO_DO_TRABALHO: Record<string, string> = {
  rascunho: "rascunho",
  dirigido: "direção pronta",
  gerando: "gerando",
  pronto: "arte pronta",
  entregue: "entregue em Arquivos",
  erro: "com erro",
};

export const FORMATOS_DE_ARTE = ["carousel", "static", "design"];
/** Formatos de uma lâmina só (sem quantidade nem contínuo). */
export const FORMATOS_POST_UNICO = ["static", "design", "google_post"];

/** Modo da lista do Estúdio: de hoje até 60 dias para frente, sem olhar o mês. */
export const PROXIMOS_DIAS = "proximos";
export const DIAS_A_FRENTE = 60;

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Data local em AAAA-MM-DD (sem passar por UTC). */
export function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/**
 * Janela de datas da lista: um mês (início incluído, fim excluído) ou, no modo
 * "proximos", de hoje até hoje + 60 dias (fim excluído, então o 60º dia entra).
 */
export function janelaDaLista(mes: string, agora = new Date()): { inicio: string; fimExclusivo: string } {
  if (mes === PROXIMOS_DIAS) {
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + DIAS_A_FRENTE + 1);
    return { inicio: dataLocal(hoje), fimExclusivo: dataLocal(fim) };
  }
  return { inicio: mes, fimExclusivo: somarMeses(mes, 1) };
}

/**
 * Chave da lista: cliente e janela, nunca o item aberto. Com o item aberto na
 * chave, cada clique na lista trocava a chave, a lista inteira sumia e
 * recarregava, e às vezes o clique não abria o item (bug de 23/09). A Entrega
 * usa a mesma chave por mês e divide o cache com o Estúdio.
 */
export function chaveDosItens(clientId: string, mes: string) {
  return ["mesa", "itens-do-mes", clientId, mes] as const;
}

export const chaveDoItemAvulso = (clientId: string, tarefaId: string) => ["mesa", "item-avulso", clientId, tarefaId] as const;

const COLUNAS_DA_TAREFA = "id, title, due_date, delivery_type, status, project_id";

const unicos = (lista: (string | null | undefined)[]): string[] => {
  const saida: string[] = [];
  for (const v of lista) if (v && saida.indexOf(v) < 0) saida.push(v);
  return saida;
};

const vazio = (): DadosDosItens => ({ itens: [], trabalhos: {}, publicacoes: {}, roteiros: {}, artes: {} });

interface LinhaDoArquivo {
  id: string;
  file_name: string | null;
  file_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at?: string | null;
}

const paraArquivo = (f: LinhaDoArquivo): ArquivoDaAgenda => ({
  id: f.id,
  nome: f.file_name || null,
  bucket: f.storage_bucket || null,
  caminho: f.storage_path || null,
  url: f.file_url || null,
});

/** Caminho e bucket para ImagemDaMesa e Ampliar (URL pronta ou files:// também servem). */
export function fonteDoArquivo(a: ArquivoDaAgenda | null | undefined): { caminho: string | null; bucket: string } {
  if (!a) return { caminho: null, bucket: "mesa" };
  if (a.caminho && a.bucket) return { caminho: a.caminho, bucket: a.bucket };
  return { caminho: a.url || null, bucket: "mesa" };
}

/** Artes que já estão na Agenda, por tarefa (leitura tolerante: sem permissão, some só o aviso). */
async function lerArtesDaAgenda(
  taskIds: string[],
  trabalhos: Record<string, Trabalho>,
): Promise<Record<string, ArteNaAgenda>> {
  const artes: Record<string, ArteNaAgenda> = {};
  if (!taskIds.length) return artes;
  const sb = supabase as any;
  const { data: vinculos, error } = await sb
    .from("editorial_post_internal")
    .select("post_id, task_id, revision_of_post_id")
    .in("task_id", taskIds);
  if (error || !vinculos || !vinculos.length) return artes;
  const linhas = vinculos as { post_id: string; task_id: string | null; revision_of_post_id: string | null }[];
  // Post revisado por outro mais novo não vale (mesma regra do estúdio).
  const revisados = unicos(linhas.map((l) => l.revision_of_post_id));
  const { data: posts, error: erroPosts } = await sb
    .from("editorial_posts")
    .select("id, title, default_caption, production_status, primary_file_id, created_at")
    .in("id", unicos(linhas.map((l) => l.post_id)))
    .is("archived_at", null)
    .not("primary_file_id", "is", null)
    .order("created_at", { ascending: false });
  if (erroPosts || !posts || !posts.length) return artes;
  const listaDePosts = (posts as { id: string; title: string | null; default_caption: string | null; production_status: string | null; primary_file_id: string }[])
    .filter((p) => revisados.indexOf(p.id) < 0);
  if (!listaDePosts.length) return artes;
  const tarefaDoPost: Record<string, string> = {};
  for (const l of linhas) if (l.task_id) tarefaDoPost[l.post_id] = l.task_id;

  const { data: arquivos } = await sb
    .from("staff_files_secure")
    .select("id, file_name, file_url, storage_bucket, storage_path")
    .in("id", unicos(listaDePosts.map((p) => p.primary_file_id)));
  const arquivoPorId: Record<string, ArquivoDaAgenda> = {};
  for (const f of (arquivos || []) as LinhaDoArquivo[]) arquivoPorId[f.id] = paraArquivo(f);

  // Mais recente primeiro: o primeiro post de cada tarefa é o que vale.
  for (const p of listaDePosts) {
    const taskId = tarefaDoPost[p.id];
    if (!taskId || artes[taskId]) continue;
    const t = trabalhos[taskId];
    artes[taskId] = {
      post_id: p.id,
      titulo: p.title || null,
      legenda: p.default_caption || null,
      status: p.production_status || null,
      capa: arquivoPorId[p.primary_file_id] || null,
      do_estudio: !!t && ((t.file_ids || []).indexOf(p.primary_file_id) >= 0 || t.post_id === p.id),
    };
  }
  return artes;
}

/** Roteiros gravados pelo estrategista: quantas lâminas e se pediu contínuo. */
async function lerRoteiros(clientId: string, taskIds: string[]): Promise<Record<string, InfoDoRoteiro>> {
  const roteiros: Record<string, InfoDoRoteiro> = {};
  if (!taskIds.length) return roteiros;
  const { data, error } = await (supabase as any)
    .from("calendario_propostas")
    .select("task_ids, itens")
    .eq("client_id", clientId)
    .eq("status", "gravada")
    .overlaps("task_ids", taskIds)
    .order("criado_em", { ascending: false });
  if (error) return roteiros;
  for (const p of (data || []) as { task_ids: string[] | null; itens: unknown }[]) {
    const itens = Array.isArray(p.itens) ? (p.itens as Record<string, unknown>[]) : [];
    for (const id of p.task_ids || []) {
      if (taskIds.indexOf(id) < 0 || roteiros[id]) continue;
      const doItem = itens.find((i) => !!i && typeof i === "object" && i.task_id === id) || null;
      const cards = doItem && Array.isArray(doItem.cards) ? (doItem.cards as unknown[]) : [];
      const continuo = doItem && typeof doItem.carrossel_infinito === "boolean" ? (doItem.carrossel_infinito as boolean) : null;
      roteiros[id] = { laminas: cards.length, continuo };
    }
  }
  return roteiros;
}

/**
 * Tudo o que a tela precisa dos itens: o trabalho mais recente do estúdio,
 * a arte que já está na Agenda, o roteiro do estrategista e a publicação dos
 * posts. Devolve JSON puro (vai para o cache persistido).
 */
export async function lerDetalhesDosItens(clientId: string, itens: ItemDoMes[]): Promise<DadosDosItens> {
  const dados = vazio();
  dados.itens = itens;
  if (!itens.length) return dados;
  const ids = itens.map((i) => i.id);
  const sb = supabase as any;

  const [trabalhosRes, roteiros] = await Promise.all([
    sb
      .from("estudio_trabalhos")
      .select("*")
      .eq("client_id", clientId)
      .in("task_id", ids)
      .order("criado_em", { ascending: false }),
    lerRoteiros(clientId, ids).catch(() => ({} as Record<string, InfoDoRoteiro>)),
  ]);
  if (trabalhosRes.error) throw trabalhosRes.error;
  for (const t of (trabalhosRes.data || []) as Trabalho[]) {
    if (t.task_id && !dados.trabalhos[t.task_id]) dados.trabalhos[t.task_id] = t;
  }
  dados.roteiros = roteiros;
  dados.artes = await lerArtesDaAgenda(ids, dados.trabalhos).catch(() => ({} as Record<string, ArteNaAgenda>));

  // Estado da publicação na Agenda (agendado, publicado, falhou) dos posts
  // que nasceram das artes aprovadas e dos que já tinham arte na Agenda.
  const postIds = unicos(
    Object.keys(dados.trabalhos).map((k) => dados.trabalhos[k].post_id).concat(Object.keys(dados.artes).map((k) => dados.artes[k].post_id)),
  );
  if (postIds.length) {
    const { data } = await sb
      .from("editorial_publications")
      .select("post_id, status, scheduled_at, delivery_mode, published_at, permalink")
      .in("post_id", postIds)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    for (const p of (data || []) as PublicacaoDoPost[]) {
      if (!dados.publicacoes[p.post_id]) dados.publicacoes[p.post_id] = p;
    }
  }
  return dados;
}

/** Monta os mapas a partir do JSON do cache. Função fixa: o React Query memoriza o resultado. */
export function paraMapas(d: DadosDosItens): ItensDoMes {
  const mapa = <T,>(r: Record<string, T> | undefined) => {
    const m = new Map<string, T>();
    const o = r || {};
    for (const k of Object.keys(o)) m.set(k, o[k]);
    return m;
  };
  const infoDoRoteiro = mapa(d.roteiros);
  const roteiros = new Set<string>();
  infoDoRoteiro.forEach((info, id) => {
    if (info.laminas > 0) roteiros.add(id);
  });
  return {
    itens: d.itens || [],
    trabalhos: mapa(d.trabalhos),
    publicacoes: mapa(d.publicacoes),
    roteiros,
    infoDoRoteiro,
    artes: mapa(d.artes),
  };
}

async function lerItensDaJanela(clientId: string, mes: string): Promise<DadosDosItens> {
  const { data: projetos, error: erroProjetos } = await (supabase as any)
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (erroProjetos) throw erroProjetos;
  const ids = ((projetos || []) as { id: string }[]).map((p) => p.id);
  if (!ids.length) return vazio();
  const janela = janelaDaLista(mes);
  const { data, error } = await (supabase as any)
    .from("tasks")
    .select(COLUNAS_DA_TAREFA)
    .in("project_id", ids)
    .in("delivery_type", FORMATOS_DE_ARTE)
    .is("deleted_at", null)
    .gte("due_date", janela.inicio)
    .lt("due_date", janela.fimExclusivo)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return lerDetalhesDosItens(clientId, (data || []) as ItemDoMes[]);
}

/**
 * Itens da agenda com arte (carrossel e estático) dos projetos do cliente,
 * com o trabalho mais recente do estúdio de cada um e a arte que já está na
 * Agenda. `mes` é o primeiro dia do mês (AAAA-MM-01) ou "proximos" (hoje até
 * 60 dias). Trocar a janela mantém a lista anterior na tela até a nova chegar.
 */
export function useItensDoMes(clientId: string, mes: string) {
  return useQuery({
    queryKey: chaveDosItens(clientId, mes),
    enabled: !!clientId,
    placeholderData: keepPreviousData,
    queryFn: () => lerItensDaJanela(clientId, mes),
    select: paraMapas,
  });
}

/**
 * Item aberto pela URL que está fora da janela da lista: consulta pequena, à
 * parte, só quando ele não veio na lista. Mesma forma de dados da lista.
 */
export function useItemAvulso(clientId: string, tarefaId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: chaveDoItemAvulso(clientId, tarefaId || ""),
    enabled: ativo && !!clientId && !!tarefaId,
    queryFn: async (): Promise<DadosDosItens> => {
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select(COLUNAS_DA_TAREFA)
        .eq("id", tarefaId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return vazio();
      const { data: projeto } = await (supabase as any)
        .from("projects")
        .select("id")
        .eq("id", (data as ItemDoMes).project_id)
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!projeto) return vazio();
      return lerDetalhesDosItens(clientId, [data as ItemDoMes]);
    },
    select: paraMapas,
  });
}

/**
 * Lâminas da arte que já está na Agenda: o arquivo principal e os filhos do
 * carrossel (files.parent_file_id), na ordem do carrossel da Agenda.
 */
export function useLaminasDaAgenda(capa: ArquivoDaAgenda | null) {
  return useQuery({
    queryKey: ["mesa", "laminas-da-agenda", capa ? capa.id : ""],
    enabled: !!capa,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ArquivoDaAgenda[]> => {
      if (!capa) return [];
      const { data, error } = await (supabase as any)
        .from("staff_files_secure")
        .select("id, file_name, file_url, storage_bucket, storage_path, created_at")
        .eq("parent_file_id", capa.id)
        .is("archived_at", null);
      if (error) throw error;
      const raiz: EditorialMediaFile = { id: capa.id, file_name: capa.nome || "", file_url: capa.url, storage_bucket: capa.bucket, storage_path: capa.caminho };
      const filhos: EditorialMediaFile[] = ((data || []) as LinhaDoArquivo[]).map((f) => ({
        id: f.id,
        file_name: f.file_name || "",
        file_url: f.file_url,
        storage_bucket: f.storage_bucket,
        storage_path: f.storage_path,
        created_at: f.created_at || null,
      }));
      return orderEditorialCarouselFiles(raiz, filhos).map((f) =>
        paraArquivo({ id: f.id, file_name: f.file_name, file_url: f.file_url || null, storage_bucket: f.storage_bucket || null, storage_path: f.storage_path || null }),
      );
    },
  });
}

/** Versão mais recente de cada card, na ordem. */
export function ultimasVersoes(cards: CardGerado[] = []): Map<number, CardGerado> {
  const m = new Map<number, CardGerado>();
  for (const c of cards) {
    const atual = m.get(c.ordem);
    if (!atual || c.versao > atual.versao) m.set(c.ordem, c);
  }
  return m;
}
