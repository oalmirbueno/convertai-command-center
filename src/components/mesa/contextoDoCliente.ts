import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Dados da aba Contexto, vindos da função "agente-contexto".
 * "ler" não gasta IA: sincroniza as referências e devolve o que o painel já
 * tem do cliente. "montar" e "conversar" gastam e devolvem o custo real.
 */

export interface CorDoKit {
  nome: string;
  hex: string;
  papel: string;
}

export interface ContextoConsolidado {
  negocio?: string | null;
  publico?: string | null;
  oferta?: string | null;
  tom_de_voz?: string | null;
  diferenciais?: string[] | null;
  tipografia?: { titulo?: string | null; texto?: string | null; observacao?: string | null } | null;
  logo?: { descricao?: string | null } | null;
  lacunas?: string[] | null;
  fontes_lidas?: string[] | null;
}

export interface KitDoContexto {
  client_id: string;
  paleta: CorDoKit[] | null;
  logo_file_id: string | null;
  /** Logo copiada para o bucket mesa (definir_logo), de qualquer pasta. */
  logo_path?: string | null;
  logo_alt_path?: string | null;
  logo_alt_file_id?: string | null;
  estilo: string | null;
  regras: string | null;
  contexto: ContextoConsolidado | null;
  contexto_atualizado_em: string | null;
}

export interface FonteDoCliente {
  nome: string;
  papel: string;
  origem: string;
}

export interface DocumentoEncontrado {
  file_id: string;
  nome: string;
  prioridade: boolean;
  caracteres: number;
}

export interface CandidatoALogo {
  origem: "arquivo" | "workspace";
  id: string;
  nome: string;
}

export interface LeituraDoContexto {
  kit: KitDoContexto | null;
  fontes: FonteDoCliente[];
  encontrado: {
    documentos: DocumentoEncontrado[];
    tem_dossie: boolean;
    artes_aprovadas: number;
    referencias: { total: number; identidade: number; tecnica: number; sem_leitura: number };
    sincronizadas_agora: number;
  };
  candidatos_a_logo: CandidatoALogo[];
  lacunas: string[];
}

export interface SugestoesDoContexto {
  paleta?: CorDoKit[];
  estilo?: string;
  regras?: string;
}

export interface RespostaDoMontar {
  kit: KitDoContexto | null;
  sugestoes: SugestoesDoContexto | null;
  fontes_escolhidas: { titulo: string; texto: string; porque?: string | null } | null;
  referencias_lidas: number;
  custo_usd: number | null;
  saldo_usd: number | null;
  reserva_usada: string | null;
}

export interface RespostaDaConversa {
  resposta: string;
  mudou: string[];
  memorias: number;
  kit: KitDoContexto | null;
  custo_usd: number | null;
  saldo_usd: number | null;
}

export interface MensagemDoContexto {
  papel: "usuario" | "agente";
  conteudo: string;
  criado_em: string;
}

export const chaveDoContexto = (clientId: string) => ["mesa", "contexto", clientId];
export const chaveDoHistorico = (clientId: string) => ["mesa", "contexto-historico", clientId];

/** Normaliza a resposta de "ler" para a tela nunca quebrar com campo faltando. */
function normalizar(d: any): LeituraDoContexto {
  const e = d?.encontrado || {};
  const r = e.referencias || {};
  return {
    kit: d?.kit || null,
    fontes: Array.isArray(d?.fontes) ? d.fontes : [],
    encontrado: {
      documentos: Array.isArray(e.documentos) ? e.documentos : [],
      tem_dossie: !!e.tem_dossie,
      artes_aprovadas: Number(e.artes_aprovadas || 0),
      referencias: {
        total: Number(r.total || 0),
        identidade: Number(r.identidade || 0),
        tecnica: Number(r.tecnica || 0),
        sem_leitura: Number(r.sem_leitura || 0),
      },
      sincronizadas_agora: Number(e.sincronizadas_agora || 0),
    },
    candidatos_a_logo: Array.isArray(d?.candidatos_a_logo) ? d.candidatos_a_logo : [],
    lacunas: Array.isArray(d?.lacunas) ? d.lacunas : [],
  };
}

/**
 * O que a Mesa já encontrou do cliente (sem custo de IA). O "ler" responde em
 * até ~1,5 s e termina a sincronização em segundo plano; a leitura vale por
 * 5 minutos (cada mudança na aba invalida e relê na hora).
 */
export function useLeituraDoContexto(clientId: string) {
  return useQuery({
    queryKey: chaveDoContexto(clientId),
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => normalizar(await chamarFuncao("agente-contexto", { acao: "ler", client_id: clientId })),
  });
}

/** Histórico da conversa com o agente de contexto (sem custo de IA). */
export function useHistoricoDoContexto(clientId: string) {
  return useQuery({
    queryKey: chaveDoHistorico(clientId),
    enabled: !!clientId,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<MensagemDoContexto[]> => {
      const d = await chamarFuncao<{ mensagens?: MensagemDoContexto[] }>("agente-contexto", { acao: "historico", client_id: clientId });
      return Array.isArray(d?.mensagens) ? d.mensagens : [];
    },
  });
}

/**
 * Tudo que o agente pode ter mudado: a leitura desta aba e as consultas dos
 * componentes de detalhe (Marca, Fontes, Referências, Prompt e Memória).
 */
export function useInvalidarContexto() {
  const queryClient = useQueryClient();
  return (clientId: string, opcoes: { historico?: boolean } = {}) => {
    const chaves: unknown[][] = [
      chaveDoContexto(clientId),
      ["mesa", "kit", clientId],
      ["mesa", "fontes", clientId],
      ["mesa", "referencias", clientId],
      ["mesa", "memoria", clientId],
      ["mesa", "prompts", clientId],
      // As duas leituras do acervo: a desta aba e a do Estúdio (SeletorDoAcervo).
      chaveDoAcervo(clientId),
      chaveDoAcervoDoEstudio(clientId),
    ];
    if (opcoes.historico) chaves.push(chaveDoHistorico(clientId));
    for (const queryKey of chaves) void queryClient.invalidateQueries({ queryKey });
  };
}

export const ROTULOS_DO_QUE_MUDOU: Record<string, string> = {
  estilo: "estilo",
  regras: "regras",
  paleta: "paleta",
  negocio: "negócio",
  publico: "público",
  oferta: "oferta",
  tom_de_voz: "tom de voz",
};

export const temTexto = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

// ------------------------------------------------------------------ acervo

/** Foto real do cliente (tabela cliente_imagens). */
export interface ImagemDoAcervo {
  id: string;
  client_id: string;
  origem: "workspace" | "arquivo" | "upload";
  workspace_node_id: string | null;
  file_id: string | null;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
  ativa: boolean;
  criado_em: string;
  atualizado_em: string;
}

/**
 * Chave própria do acervo nesta aba. O Estúdio (SeletorDoAcervo) guarda só as
 * ativas, com menos colunas, em ["mesa", "acervo", clientId]; dividir a mesma
 * chave fazia o checklist contar 0 fotos quando o Estúdio enchia o cache antes.
 */
export const chaveDoAcervo = (clientId: string) => ["mesa", "acervo-contexto", clientId];
/** Chave do acervo no Estúdio (SeletorDoAcervo): só para invalidar junto. */
export const chaveDoAcervoDoEstudio = (clientId: string) => ["mesa", "acervo", clientId];

/** Invalida o acervo nas duas telas (Contexto e Estúdio). */
export function invalidarAcervo(queryClient: QueryClient, clientId: string) {
  void queryClient.invalidateQueries({ queryKey: chaveDoAcervo(clientId) });
  void queryClient.invalidateQueries({ queryKey: chaveDoAcervoDoEstudio(clientId) });
}

/** Acervo de imagens reais do cliente (leitura direta, RLS da equipe). */
export function useAcervo(clientId: string) {
  return useQuery({
    queryKey: chaveDoAcervo(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ImagemDoAcervo[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_imagens")
        .select("*")
        .eq("client_id", clientId)
        .order("pasta", { ascending: true, nullsFirst: false })
        .order("nome", { ascending: true })
        .limit(3000);
      if (error) throw error;
      return ((data || []) as ImagemDoAcervo[]).map((i) => ({ ...i, tags: Array.isArray(i.tags) ? i.tags : [] }));
    },
  });
}

// ------------------------------------------------------------------ kit

/**
 * Kit de marca lido direto da tabela (RLS da equipe): responde na hora, sem
 * esperar o "ler". Mesma chave e mesmo formato do editor de Marca.
 */
export function useKitDoCliente(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "kit", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<KitDoContexto | null> => {
      const { data, error } = await (supabase as any).from("cliente_kit_marca").select("*").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return (data as KitDoContexto) || null;
    },
  });
}

// ------------------------------------------------------------------ fontes

/** Fonte do cliente (tabela cliente_fontes), enviada ou vinda da biblioteca. */
export interface FonteDoClienteLinha {
  id: string;
  nome: string;
  papel: string;
  storage_path: string;
  amostra_path: string | null;
  origem: string;
  biblioteca_id: string | null;
}

export const chaveDasFontes = (clientId: string) => ["mesa", "fontes", clientId];

export function useFontesDoCliente(clientId: string) {
  return useQuery({
    queryKey: chaveDasFontes(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<FonteDoClienteLinha[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_fontes")
        .select("id, nome, papel, storage_path, amostra_path, origem, biblioteca_id")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return ((data || []) as FonteDoClienteLinha[]).map((f) => ({ ...f, origem: f.origem || "upload", biblioteca_id: f.biblioteca_id || null }));
    },
  });
}

/** Família da biblioteca global de fontes da agência (tabela fontes_biblioteca). */
export interface FonteDaBiblioteca {
  id: string;
  familia: string;
  slug: string | null;
  categoria: string | null;
  personalidade: string[];
  usos: string[];
  nichos: string[];
  pareamentos: { com?: string; papel_desta?: string; papel_da_outra?: string; porque?: string }[];
  amostra_path: string | null;
  suporta_portugues: boolean;
  arquivos: { arquivo?: string; estilo?: string; peso?: number | string; italico?: boolean }[];
}

function comoLista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Biblioteca de fontes (leitura da equipe), só as ativas. */
export function useBibliotecaDeFontes(ativo = true) {
  return useQuery({
    queryKey: ["mesa", "fontes-biblioteca"],
    enabled: ativo,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<FonteDaBiblioteca[]> => {
      const { data, error } = await (supabase as any)
        .from("fontes_biblioteca")
        .select("id, familia, slug, categoria, personalidade, usos, nichos, pareamentos, amostra_path, suporta_portugues, arquivos")
        .eq("ativa", true)
        .order("familia", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return ((data || []) as FonteDaBiblioteca[]).map((f) => ({
        ...f,
        personalidade: comoLista<string>(f.personalidade),
        usos: comoLista<string>(f.usos),
        nichos: comoLista<string>(f.nichos),
        pareamentos: comoLista<FonteDaBiblioteca["pareamentos"][number]>(f.pareamentos),
        arquivos: comoLista<FonteDaBiblioteca["arquivos"][number]>(f.arquivos),
        suporta_portugues: f.suporta_portugues !== false,
      }));
    },
  });
}

const PESO_POR_NOME: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** Peso numérico do arquivo (campo peso ou, sem ele, o nome do estilo). */
export function pesoDoArquivo(a: { peso?: number | string; estilo?: string }): number {
  const n = Number(a.peso);
  if (Number.isFinite(n) && n > 0) return n;
  const nome = String(a.estilo || a.peso || "").toLowerCase().replace(/[^a-z]/g, "");
  return PESO_POR_NOME[nome] || 400;
}

/**
 * Caminho do arquivo da família para cliente_fontes.storage_path (a coluna
 * não aceita nulo). Título: o não itálico de peso mais próximo de 800 sem
 * passar dele. Texto: o não itálico mais próximo de 400. Sem arquivo, a
 * amostra.
 */
export function caminhoDaFonteDaBiblioteca(f: FonteDaBiblioteca, papel: "titulo" | "texto"): string {
  const comArquivo = f.arquivos.filter((a) => typeof a.arquivo === "string" && !!a.arquivo);
  const retos = comArquivo.filter((a) => !a.italico);
  const base = retos.length ? retos : comArquivo;
  let escolhido: FonteDaBiblioteca["arquivos"][number] | null = null;
  if (papel === "titulo") {
    const ate800 = base.filter((a) => pesoDoArquivo(a) <= 800);
    for (const a of ate800) if (!escolhido || pesoDoArquivo(a) > pesoDoArquivo(escolhido)) escolhido = a;
    if (!escolhido) for (const a of base) if (!escolhido || pesoDoArquivo(a) < pesoDoArquivo(escolhido)) escolhido = a;
  } else {
    for (const a of base) {
      if (!escolhido) {
        escolhido = a;
        continue;
      }
      const d = Math.abs(pesoDoArquivo(a) - 400);
      const dAtual = Math.abs(pesoDoArquivo(escolhido) - 400);
      // Empate: fica o mais leve (400 antes de 500 quando falta o 400 exato).
      if (d < dAtual || (d === dAtual && pesoDoArquivo(a) < pesoDoArquivo(escolhido))) escolhido = a;
    }
  }
  if (escolhido && escolhido.arquivo) return escolhido.arquivo;
  return f.amostra_path || `biblioteca/fontes/${f.slug || f.id}`;
}

/** Famílias (em minúsculas) que a biblioteca indica para parear com esta. */
export function paresDaFonte(f: FonteDaBiblioteca | null | undefined): string[] {
  if (!f) return [];
  const nomes: string[] = [];
  for (const p of f.pareamentos) {
    const nome = typeof p.com === "string" ? p.com.trim().toLowerCase() : "";
    if (nome && nomes.indexOf(nome) < 0) nomes.push(nome);
  }
  return nomes;
}

// ------------------------------------------------------------------ referências

/**
 * Referência do cliente com a imagem já resolvida. A linha guarda a imagem de
 * três jeitos: storage_path no bucket mesa (Pinterest e envio), o nó do
 * Workspace (bucket workspace) ou o arquivo de Arquivos (artes aprovadas).
 * Antes a tela só lia storage_path, e as referências do Workspace e as artes
 * aprovadas apareciam sem imagem.
 */
export interface ReferenciaDoCliente {
  id: string;
  origem: string;
  papel: "identidade" | "tecnica";
  url_origem: string | null;
  storage_path: string | null;
  workspace_node_id: string | null;
  file_id: string | null;
  leitura: string | null;
  tags: string[];
  ativa: boolean;
  criado_em: string | null;
  nome: string;
  imagem: { bucket: string; caminho: string } | null;
}

type LinhaDeReferencia = Omit<ReferenciaDoCliente, "nome" | "imagem">;
type NoDaReferencia = { id: string; name: string; storage_path: string | null };
type ArquivoDaReferencia = { id: string; file_name: string; file_url: string | null; storage_bucket: string | null; storage_path: string | null };

export const chaveDasReferencias = (clientId: string) => ["mesa", "referencias", clientId];

const POR_LOTE = 150;

async function emLotes<T>(ids: string[], lerLote: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += POR_LOTE) {
    const parte = await lerLote(ids.slice(i, i + POR_LOTE));
    for (const item of parte) saida.push(item);
  }
  return saida;
}

const ROTULO_DA_ORIGEM: Record<string, string> = {
  workspace: "Workspace",
  pinterest: "Pinterest",
  upload: "Enviada",
  arquivo: "Arte aprovada",
};

export function rotuloDaOrigemDaReferencia(origem: string): string {
  return ROTULO_DA_ORIGEM[origem] || origem;
}

/** Junta a linha com o nó do Workspace ou o arquivo de onde a imagem vem. */
export function resolverReferencia(
  r: LinhaDeReferencia,
  noPorId: Record<string, NoDaReferencia>,
  arquivoPorId: Record<string, ArquivoDaReferencia>,
): ReferenciaDoCliente {
  let imagem: ReferenciaDoCliente["imagem"] = null;
  let nome = "";
  if (r.storage_path) {
    imagem = { bucket: "mesa", caminho: r.storage_path };
  } else if (r.workspace_node_id && noPorId[r.workspace_node_id]) {
    const n = noPorId[r.workspace_node_id];
    nome = n.name || "";
    if (n.storage_path) imagem = { bucket: "workspace", caminho: n.storage_path };
  } else if (r.file_id && arquivoPorId[r.file_id]) {
    const a = arquivoPorId[r.file_id];
    nome = a.file_name || "";
    if (a.storage_bucket && a.storage_path) imagem = { bucket: a.storage_bucket, caminho: a.storage_path };
    else if (a.file_url && a.file_url.indexOf("://") > 0) imagem = { bucket: "files", caminho: a.file_url };
  }
  return {
    ...r,
    papel: r.papel === "identidade" ? "identidade" : "tecnica",
    tags: Array.isArray(r.tags) ? r.tags : [],
    ativa: r.ativa !== false,
    nome: nome || rotuloDaOrigemDaReferencia(r.origem),
    imagem,
  };
}

/** Todas as referências do cliente, com a imagem resolvida (JSON puro). */
export function useReferenciasDoCliente(clientId: string) {
  return useQuery({
    queryKey: chaveDasReferencias(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ReferenciaDoCliente[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_referencias")
        .select("id, origem, papel, url_origem, storage_path, workspace_node_id, file_id, leitura, tags, ativa, criado_em")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const linhas = (data || []) as LinhaDeReferencia[];
      const idsDeNos: string[] = [];
      const idsDeArquivos: string[] = [];
      for (const r of linhas) {
        if (r.storage_path) continue;
        if (r.workspace_node_id && idsDeNos.indexOf(r.workspace_node_id) < 0) idsDeNos.push(r.workspace_node_id);
        if (r.file_id && idsDeArquivos.indexOf(r.file_id) < 0) idsDeArquivos.push(r.file_id);
      }
      const [nos, arquivos] = await Promise.all([
        emLotes<NoDaReferencia>(idsDeNos, async (lote) => {
          const { data: d, error: e } = await (supabase as any).from("workspace_nodes").select("id, name, storage_path").in("id", lote);
          if (e) throw e;
          return (d || []) as NoDaReferencia[];
        }),
        emLotes<ArquivoDaReferencia>(idsDeArquivos, async (lote) => {
          const { data: d, error: e } = await (supabase as any)
            .from("files")
            .select("id, file_name, file_url, storage_bucket, storage_path")
            .in("id", lote);
          if (e) throw e;
          return (d || []) as ArquivoDaReferencia[];
        }),
      ]);
      const noPorId: Record<string, NoDaReferencia> = {};
      for (const n of nos) noPorId[n.id] = n;
      const arquivoPorId: Record<string, ArquivoDaReferencia> = {};
      for (const a of arquivos) arquivoPorId[a.id] = a;
      return linhas.map((r) => resolverReferencia(r, noPorId, arquivoPorId));
    },
  });
}
