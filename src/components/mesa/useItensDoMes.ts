import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { somarMeses } from "@/lib/mesa/api";
import type { BlocoTexto, LayoutLamina } from "@/lib/mesa/layout";
import { mediaKindFromFile } from "@/lib/fileUrls";
import { ordenarLaminasDoCarrossel } from "@/components/shared/CarouselSlider";

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
  /** Decisão da autocorreção gravada pela conferência (estudio-arte/autocorrecao.ts). */
  autocorrecao?: { precisa: boolean; motivos: string[]; instrucao: string | null } | null;
}

export interface CardGerado {
  ordem: number;
  versao: number;
  storage_path: string;
  origem?: "gerar" | "ajuste";
  instrucao?: string | null;
  verificacao?: Verificacao | null;
  /** Versão feita pela autocorreção (corrigir_card): a rodada e os motivos. */
  autocorrecao?: { rodada: number; motivos: string[]; pedido_da_equipe?: boolean } | null;
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
  /** Fotos reais trazidas pela equipe para compor a lâmina (contrato V5): até 1 fundo e 2 elementos. */
  fotos_livres?: FotoLivre[];
}

/** Foto real composta na lâmina: fica como é; o design e o texto vêm em volta ou por cima. */
export interface FotoLivre {
  /** Arquivo no bucket `mesa` em `<client_id>/estudio/fotos/<uuid>.<ext>`. */
  caminho: string;
  /** "fundo": a foto é o fundo da lâmina. "elemento": pessoa, rosto ou objeto que entra na composição. */
  papel: "fundo" | "elemento";
  /** Como usar (até 200 caracteres). */
  nota?: string;
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
  /**
   * De onde a arte veio: o post editorial ligado à tarefa (arquivo principal
   * ou, sem ele, o arquivo da publicação) ou uma imagem anexada à própria
   * tarefa. Anexo não tem post: post_id fica vazio.
   */
  origem?: "post" | "anexo";
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
/**
 * Nos próximos 60 dias a leitura também olha 45 dias para trás, para trazer
 * as artes que já estão na Agenda (pedido do dono em 23/09: "tem que puxar
 * da agenda as artes antigas"). Do passado só fica o item que tem arte ou
 * trabalho do estúdio; pauta vencida e vazia não volta para "A fazer".
 */
export const DIAS_ATRAS = 45;

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

/** O que a consulta lê: a janela da lista e, nos próximos 60 dias, também 45 dias para trás. */
export function janelaDeLeitura(mes: string, agora = new Date()): { inicio: string; fimExclusivo: string } {
  const lista = janelaDaLista(mes, agora);
  if (mes !== PROXIMOS_DIAS) return lista;
  const antes = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - DIAS_ATRAS);
  return { inicio: dataLocal(antes), fimExclusivo: lista.fimExclusivo };
}

/**
 * Do passado (antes de hoje) só fica o item com arte na Agenda ou trabalho
 * no estúdio. O resto dos dados não muda (JSON puro, vai para o cache).
 */
export function semPassadoVazio(dados: DadosDosItens, hoje: string): DadosDosItens {
  const tem = Object.prototype.hasOwnProperty;
  return {
    ...dados,
    itens: dados.itens.filter(
      (i) => !i.due_date || i.due_date.slice(0, 10) >= hoje || tem.call(dados.trabalhos, i.id) || tem.call(dados.artes, i.id),
    ),
  };
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
  mime_type?: string | null;
  extension?: string | null;
  created_at?: string | null;
}

const COLUNAS_DO_ARQUIVO = "id, file_name, file_url, storage_bucket, storage_path, mime_type, extension, created_at";

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

/** Arquivo que não é imagem (vídeo, áudio, PDF, documento) não vale como arte da lâmina. */
export function arquivoEhImagem(f: { file_name?: string | null; file_url?: string | null; mime_type?: string | null; extension?: string | null; file_type?: string | null }): boolean {
  const tipo = mediaKindFromFile(f.file_name, f.file_url, f.mime_type || f.file_type, f.extension);
  return tipo === "image" || tipo === "other";
}

interface PostDaAgenda {
  id: string;
  title: string | null;
  default_caption: string | null;
  production_status: string | null;
  primary_file_id: string | null;
}

/**
 * Artes que já estão na Agenda, por tarefa, inclusive as de antes do Estúdio
 * existir (leitura tolerante: sem permissão, some só o aviso). Vale o post
 * editorial ligado à tarefa, vivo e não revisado por outro: o arquivo
 * principal ou, sem ele, o arquivo da publicação (mesma regra da miniatura
 * da Agenda). Tarefa sem post com arte: a imagem anexada à própria tarefa.
 */
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
  const linhas = (error || !vinculos ? [] : vinculos) as { post_id: string; task_id: string | null; revision_of_post_id: string | null }[];

  if (linhas.length) {
    // Post revisado por outro mais novo não vale (mesma regra do estúdio).
    const revisados = unicos(linhas.map((l) => l.revision_of_post_id));
    const { data: posts, error: erroPosts } = await sb
      .from("editorial_posts")
      .select("id, title, default_caption, production_status, primary_file_id, created_at")
      .in("id", unicos(linhas.map((l) => l.post_id)))
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    const listaDePosts = ((erroPosts || !posts ? [] : posts) as PostDaAgenda[]).filter(
      (p) => revisados.indexOf(p.id) < 0 && p.production_status !== "archived",
    );

    // Post sem arquivo principal: a arte pode estar presa só na publicação.
    const semPrincipal = listaDePosts.filter((p) => !p.primary_file_id).map((p) => p.id);
    const arquivoDaPublicacao: Record<string, string> = {};
    if (semPrincipal.length) {
      const { data: pubs } = await sb
        .from("editorial_publications")
        .select("post_id, file_id, status")
        .in("post_id", semPrincipal)
        .neq("status", "cancelled");
      for (const pb of (pubs || []) as { post_id: string; file_id: string | null }[]) {
        if (pb.file_id && !arquivoDaPublicacao[pb.post_id]) arquivoDaPublicacao[pb.post_id] = pb.file_id;
      }
    }
    const arquivoDoPost = (p: PostDaAgenda) => p.primary_file_id || arquivoDaPublicacao[p.id] || null;
    const comArquivo = listaDePosts.filter((p) => !!arquivoDoPost(p));

    const arquivoPorId: Record<string, ArquivoDaAgenda> = {};
    const naoImagem: Record<string, boolean> = {};
    const ids = unicos(comArquivo.map(arquivoDoPost));
    if (ids.length) {
      const { data: arquivos } = await sb.from("staff_files_secure").select(COLUNAS_DO_ARQUIVO).in("id", ids);
      for (const f of (arquivos || []) as LinhaDoArquivo[]) {
        if (arquivoEhImagem(f)) arquivoPorId[f.id] = paraArquivo(f);
        else naoImagem[f.id] = true;
      }
    }

    const tarefaDoPost: Record<string, string> = {};
    for (const l of linhas) if (l.task_id) tarefaDoPost[l.post_id] = l.task_id;
    // Mais recente primeiro: o primeiro post de cada tarefa é o que vale.
    for (const p of comArquivo) {
      const taskId = tarefaDoPost[p.id];
      const arquivoId = arquivoDoPost(p) as string;
      if (!taskId || artes[taskId] || naoImagem[arquivoId]) continue;
      const t = trabalhos[taskId];
      artes[taskId] = {
        post_id: p.id,
        titulo: p.title || null,
        legenda: p.default_caption || null,
        status: p.production_status || null,
        capa: arquivoPorId[arquivoId] || null,
        do_estudio: !!t && ((t.file_ids || []).indexOf(arquivoId) >= 0 || t.post_id === p.id),
        origem: "post",
      };
    }
  }

  // Tarefa sem post com arte: imagem anexada à própria tarefa (artes antigas).
  const faltam = taskIds.filter((id) => !artes[id]);
  if (faltam.length) {
    const { data: anexos, error: erroAnexos } = await sb
      .from("task_attachments")
      .select("id, task_id, file_name, file_url, file_type, created_at")
      .in("task_id", faltam)
      .order("created_at", { ascending: false });
    if (!erroAnexos) {
      for (const a of (anexos || []) as { id: string; task_id: string; file_name: string | null; file_url: string | null; file_type: string | null }[]) {
        if (!a.task_id || artes[a.task_id] || !a.file_url) continue;
        if (mediaKindFromFile(a.file_name, a.file_url, a.file_type) !== "image") continue;
        artes[a.task_id] = {
          post_id: "",
          titulo: a.file_name || null,
          legenda: null,
          status: null,
          capa: { id: a.id, nome: a.file_name || null, bucket: null, caminho: null, url: a.file_url },
          do_estudio: false,
          origem: "anexo",
        };
      }
    }
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
  const agora = new Date();
  const janela = janelaDeLeitura(mes, agora);
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
  const dados = await lerDetalhesDosItens(clientId, (data || []) as ItemDoMes[]);
  return mes === PROXIMOS_DIAS ? semPassadoVazio(dados, dataLocal(agora)) : dados;
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

interface LaminaDoCarrossel {
  id: string;
  file_name: string;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  extension: string | null;
  created_at: string | null;
}

/**
 * Ordem das lâminas da arte da Agenda: a capa e as filhas pela ordem real do
 * carrossel (a mesma do slider da Agenda: ordenarLaminasDoCarrossel). Anexo
 * sem caminho no Storage é uma lâmina só.
 */
export function laminasNaOrdem(capa: ArquivoDaAgenda, filhas: LinhaDoArquivo[]): ArquivoDaAgenda[] {
  const paraLamina = (f: LinhaDoArquivo): LaminaDoCarrossel => ({
    id: f.id,
    file_name: f.file_name || "",
    file_url: f.file_url || "",
    storage_bucket: f.storage_bucket || null,
    storage_path: f.storage_path || null,
    mime_type: f.mime_type || null,
    extension: f.extension || null,
    created_at: f.created_at || null,
  });
  const raiz = paraLamina({ id: capa.id, file_name: capa.nome, file_url: capa.url, storage_bucket: capa.bucket, storage_path: capa.caminho });
  const ordenadas = ordenarLaminasDoCarrossel<LaminaDoCarrossel>(raiz, filhas.filter(arquivoEhImagem).map(paraLamina));
  const saida = ordenadas.map((f) =>
    f.id === capa.id
      ? capa
      : paraArquivo({ id: f.id, file_name: f.file_name || null, file_url: f.file_url || null, storage_bucket: f.storage_bucket, storage_path: f.storage_path }),
  );
  return saida.length ? saida : [capa];
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
      // Anexo da tarefa (sem arquivo em Arquivos): não tem filhas.
      if (!capa.caminho && !capa.bucket) return [capa];
      const { data, error } = await (supabase as any)
        .from("staff_files_secure")
        .select(COLUNAS_DO_ARQUIVO)
        .eq("parent_file_id", capa.id)
        .is("archived_at", null);
      if (error) throw error;
      return laminasNaOrdem(capa, (data || []) as LinhaDoArquivo[]);
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
