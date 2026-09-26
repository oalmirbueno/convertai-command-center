import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ErroDaMesa, mensagemDoCodigo } from "@/lib/mesa/api";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { acervoDaMesaDeVideos, type GrupoDoAcervoDeVideo } from "@/components/mesa-foto/canvas/historia";
import { normalizarVersoes, type VersaoDeVideo } from "../../../supabase/functions/_shared/memoria-de-video";
import { normalizarRoteirosAprovados, type RoteiroAprovado, VIEW_DOS_ROTEIROS, viewAindaNaoExiste } from "../../../supabase/functions/_shared/roteiros-para-video";
import type { EstadoDoPedido, EstimativaDoPedido, TipoDePedido } from "../../../supabase/functions/_shared/pedidos-de-video";
import type { EstadoDaTarefa } from "../../../supabase/functions/_shared/computador-do-agente";

/**
 * Leitura e chamadas da Mesa Vídeos (Frente V2, 25/09/2026). A tela lê direto
 * das tabelas (RLS: equipe lê) e escreve só pela função mesa-videos. Sem o SQL
 * V2-01, o acervo de vídeo cai para a pasta do Storage (modo degradado) e as
 * demais listas avisam que falta ativar o banco. Nada aqui gasta.
 */

export const BUCKET_DOS_VIDEOS = "mesa";
export const pastaDosBrutos = (clientId: string) => `${clientId}/video/brutos`;
export const MAX_BYTES_DO_VIDEO = 4 * 1024 * 1024 * 1024;
/** Hash exato só até 256 MB (o navegador lê o arquivo inteiro na memória). */
export const MAX_BYTES_DO_HASH = 256 * 1024 * 1024;
export const LOTE_DO_REGISTRO = 20;
const SUBIDAS_AO_MESMO_TEMPO = 2;

const EXTENSOES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mts: "video/mp2t",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

export interface ArquivoDeVideo {
  id: string;
  client_id: string;
  nome: string;
  nome_original: string;
  storage_bucket: string;
  storage_path: string;
  tipo: string;
  mime: string | null;
  bytes: number | null;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  sha256: string | null;
  gravado_em: string | null;
  roteiro_id: string | null;
  cena_ref: string | null;
  grupo: string | null;
  melhor: boolean;
  nota: string | null;
  estado: string;
  criado_em: string;
  /** Veio só da pasta do Storage (sem o SQL V2-01): não dá para organizar. */
  so_no_storage?: boolean;
}

export interface CenaDaHistoriaNoBanco {
  canvas_id: string;
  client_id: string;
  canvas_nome: string;
  no_id: string;
  numero: number;
  titulo: string;
  acao: string;
  enquadramento: string;
  cenario: string;
  narrativa: string;
  imagem_id: string | null;
  /** Foto mais nova gerada no Resultado (quando a cena não fixou uma). */
  foto_do_resultado: { storage_bucket: string; storage_path: string } | null;
}

export interface HistoriaNoBanco {
  canvas_id: string;
  nome: string;
  sinopse: string;
  cenas: CenaDaHistoriaNoBanco[];
}

export interface PedidoDeVideo {
  id: string;
  client_id: string;
  tipo: TipoDePedido;
  alvo: Record<string, unknown>;
  parametros: Record<string, unknown>;
  custo_estimado: Partial<EstimativaDoPedido> & { modelo_texto?: string };
  executor: string;
  estado: EstadoDoPedido;
  criado_em: string;
}

export interface VinculoDeRoteiro {
  id: string;
  client_id: string;
  roteiro_id: string;
  cena_ref: string;
  canvas_id: string;
  no_id: string;
  estado: string;
}

export interface TarefaNaFila {
  id: string;
  client_id: string | null;
  titulo: string;
  app: string;
  passos: string[];
  irreversivel: boolean;
  estado: EstadoDaTarefa;
  provas: unknown[];
  criado_em: string;
}

// ------------------------------------------------------------------ normalizadores

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numeroOuNulo = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export function normalizarArquivo(v: unknown): ArquivoDeVideo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!o.id || !o.storage_path) return null;
  return {
    id: String(o.id),
    client_id: texto(o.client_id),
    nome: texto(o.nome) || texto(o.nome_original) || "video",
    nome_original: texto(o.nome_original) || texto(o.nome),
    storage_bucket: texto(o.storage_bucket) || BUCKET_DOS_VIDEOS,
    storage_path: String(o.storage_path),
    tipo: texto(o.tipo) || "bruto",
    mime: o.mime ? String(o.mime) : null,
    bytes: numeroOuNulo(o.bytes),
    duracao_s: numeroOuNulo(o.duracao_s),
    largura: numeroOuNulo(o.largura),
    altura: numeroOuNulo(o.altura),
    sha256: o.sha256 ? String(o.sha256) : null,
    gravado_em: o.gravado_em ? String(o.gravado_em) : null,
    roteiro_id: o.roteiro_id ? String(o.roteiro_id) : null,
    cena_ref: o.cena_ref ? String(o.cena_ref) : null,
    grupo: o.grupo ? String(o.grupo) : null,
    melhor: o.melhor === true,
    nota: o.nota ? String(o.nota) : null,
    estado: texto(o.estado) || "ativo",
    criado_em: texto(o.criado_em),
    so_no_storage: o.so_no_storage === true ? true : undefined,
  };
}

export const normalizarArquivos = (lista: unknown): ArquivoDeVideo[] =>
  (Array.isArray(lista) ? lista : []).map(normalizarArquivo).filter((a): a is ArquivoDeVideo => !!a);

/** Linhas da view foto_cenas_da_historia agrupadas por canvas, na ordem da história. */
export function historiasDasLinhas(linhas: unknown): HistoriaNoBanco[] {
  const saida: HistoriaNoBanco[] = [];
  const porCanvas: Record<string, HistoriaNoBanco> = {};
  (Array.isArray(linhas) ? linhas : []).forEach((l) => {
    if (!l || typeof l !== "object") return;
    const o = l as Record<string, unknown>;
    const canvasId = texto(o.canvas_id);
    const noId = texto(o.no_id);
    if (!canvasId || !noId) return;
    if (!porCanvas[canvasId]) {
      const h = o.historia && typeof o.historia === "object" ? (o.historia as Record<string, unknown>) : {};
      porCanvas[canvasId] = { canvas_id: canvasId, nome: texto(o.canvas_nome) || "História", sinopse: texto(h.sinopse), cenas: [] };
      saida.push(porCanvas[canvasId]);
    }
    const resultados = Array.isArray(o.resultados) ? (o.resultados as Record<string, unknown>[]) : [];
    const geradas = resultados.filter((r) => r && r.status === "gerada" && r.storage_path);
    const ultima = geradas.length ? geradas[geradas.length - 1] : null;
    porCanvas[canvasId].cenas.push({
      canvas_id: canvasId,
      client_id: texto(o.client_id),
      canvas_nome: texto(o.canvas_nome),
      no_id: noId,
      numero: Number(o.numero) || porCanvas[canvasId].cenas.length + 1,
      titulo: texto(o.titulo),
      acao: texto(o.acao),
      enquadramento: texto(o.enquadramento) || "livre",
      cenario: texto(o.cenario),
      narrativa: texto(o.narrativa),
      imagem_id: o.imagem_id ? String(o.imagem_id) : null,
      foto_do_resultado: ultima ? { storage_bucket: texto(ultima.storage_bucket) || "mesa", storage_path: String(ultima.storage_path) } : null,
    });
  });
  saida.forEach((h) => h.cenas.sort((a, b) => a.numero - b.numero));
  return saida;
}

/** Foto da cena: a escolhida (imagem_id, pelo acervo) senão a mais nova gerada no Resultado. */
export function fotoDaCenaNoAcervo(c: CenaDaHistoriaNoBanco, fotos: FotoDoAcervo[]): { storage_bucket: string; storage_path: string } | null {
  if (c.imagem_id) {
    const f = fotos.find((x) => x.id === c.imagem_id);
    if (f) return { storage_bucket: f.storage_bucket || "mesa", storage_path: f.storage_path };
  }
  return c.foto_do_resultado;
}

/** Acervo de fotos que serve à Mesa Vídeos (filtro grupoNaMesaDeVideos da Mesa Foto). */
export function fotosParaVideo(fotos: FotoDoAcervo[]): Record<GrupoDoAcervoDeVideo, FotoDoAcervo[]> {
  return acervoDaMesaDeVideos(fotos.filter((f) => !f.referencia_web));
}

export const tabelaAusente = (e: unknown) => {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message || "") : String(e || "");
  const c = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code || "") : "";
  return viewAindaNaoExiste(m) || c === "42P01" || c === "PGRST205";
};

// ------------------------------------------------------------------ chaves e hooks

export const chaveDosArquivos = (c: string) => ["mesa-videos", "arquivos", c];
export const chaveDaHistoria = (c: string) => ["mesa-videos", "historia", c];
export const chaveDosRoteiros = (c: string) => ["mesa-videos", "roteiros", c];
export const chaveDosVinculos = (c: string) => ["mesa-videos", "vinculos", c];
export const chaveDosPedidos = (c: string) => ["mesa-videos", "pedidos", c];
export const chaveDasVersoes = (c: string) => ["mesa-videos", "versoes", c];
export const chaveDaFila = (c: string) => ["mesa-videos", "computador", c];

/** Nome do arquivo no Storage vira linha "só no Storage" (modo degradado). */
export function arquivoDoStorage(clientId: string, item: { name: string; created_at?: string | null; metadata?: Record<string, unknown> | null }): ArquivoDeVideo {
  const meta = item.metadata || {};
  return {
    id: `storage:${item.name}`,
    client_id: clientId,
    nome: item.name,
    nome_original: item.name,
    storage_bucket: BUCKET_DOS_VIDEOS,
    storage_path: `${pastaDosBrutos(clientId)}/${item.name}`,
    tipo: "bruto",
    mime: meta.mimetype ? String(meta.mimetype) : null,
    bytes: numeroOuNulo(meta.size),
    duracao_s: null,
    largura: null,
    altura: null,
    sha256: null,
    gravado_em: null,
    roteiro_id: null,
    cena_ref: null,
    grupo: null,
    melhor: false,
    nota: null,
    estado: "ativo",
    criado_em: texto(item.created_at),
    so_no_storage: true,
  };
}

export function useArquivosDeVideo(clientId: string) {
  return useQuery({
    queryKey: chaveDosArquivos(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ arquivos: ArquivoDeVideo[]; degradado: boolean }> => {
      const { data, error } = await (supabase as any)
        .from("video_arquivos")
        .select("*")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(2000);
      if (!error) return { arquivos: normalizarArquivos(data), degradado: false };
      if (!tabelaAusente(error)) throw error;
      // Sem o SQL V2-01: o que já subiu aparece pela pasta do Storage.
      const lista = await supabase.storage.from(BUCKET_DOS_VIDEOS).list(pastaDosBrutos(clientId), { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
      const itens = ((lista && lista.data) || []) as { name: string; created_at?: string | null; metadata?: Record<string, unknown> | null }[];
      return { arquivos: itens.filter((i) => i && i.name && i.name.indexOf(".") > 0).map((i) => arquivoDoStorage(clientId, i)), degradado: true };
    },
  });
}

export function useHistorias(clientId: string) {
  return useQuery({
    queryKey: chaveDaHistoria(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ historias: HistoriaNoBanco[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any)
        .from("foto_cenas_da_historia")
        .select("canvas_id, client_id, canvas_nome, historia, no_id, numero, titulo, acao, enquadramento, cenario, narrativa, imagem_id, resultados")
        .eq("client_id", clientId)
        .order("canvas_id", { ascending: true })
        .order("numero", { ascending: true })
        .limit(600);
      if (error) {
        if (tabelaAusente(error)) return { historias: [], disponivel: false };
        throw error;
      }
      return { historias: historiasDasLinhas(data), disponivel: true };
    },
  });
}

export function useRoteirosAprovados(clientId: string) {
  return useQuery({
    queryKey: chaveDosRoteiros(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ roteiros: RoteiroAprovado[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any).from(VIEW_DOS_ROTEIROS).select("id, client_id, titulo, aprovado_em, cenas").eq("client_id", clientId).limit(200);
      if (error) {
        if (tabelaAusente(error)) return { roteiros: [], disponivel: false };
        throw error;
      }
      return { roteiros: normalizarRoteirosAprovados(data), disponivel: true };
    },
  });
}

function useTabelaDaMesa<T>(chave: unknown[], clientId: string, tabela: string, normalizar: (d: unknown) => T[], ordem = "criado_em") {
  return useQuery({
    queryKey: chave,
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ itens: T[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any).from(tabela).select("*").eq("client_id", clientId).order(ordem, { ascending: false }).limit(1000);
      if (error) {
        if (tabelaAusente(error)) return { itens: [], disponivel: false };
        throw error;
      }
      return { itens: normalizar(data), disponivel: true };
    },
  });
}

const comoLista = <T>(d: unknown) => (Array.isArray(d) ? (d as T[]) : []);

export const useVinculos = (clientId: string) => useTabelaDaMesa<VinculoDeRoteiro>(chaveDosVinculos(clientId), clientId, "video_vinculos", comoLista);
export const usePedidos = (clientId: string) => useTabelaDaMesa<PedidoDeVideo>(chaveDosPedidos(clientId), clientId, "video_pedidos", comoLista);
export const useVersoes = (clientId: string) => useTabelaDaMesa<VersaoDeVideo>(chaveDasVersoes(clientId), clientId, "video_versoes", normalizarVersoes);
export const useFilaDoComputador = (clientId: string) =>
  useTabelaDaMesa<TarefaNaFila>(chaveDaFila(clientId), clientId, "agente_computador_tarefas", (d) =>
    comoLista<TarefaNaFila>(d).map((t) => ({ ...t, passos: Array.isArray(t.passos) ? t.passos.map(String) : [] })),
  );

export function invalidarMesaDeVideos(queryClient: QueryClient, clientId: string) {
  for (const chave of [chaveDosArquivos, chaveDosVinculos, chaveDosPedidos, chaveDasVersoes, chaveDaFila]) {
    void queryClient.invalidateQueries({ queryKey: chave(clientId) });
  }
}

// ------------------------------------------------------------------ função mesa-videos

async function erroDaChamada(error: any): Promise<ErroDaMesa> {
  const ctx = error && error.context;
  let corpo: Record<string, unknown> | null = null;
  try {
    if (ctx && typeof ctx.clone === "function") corpo = await ctx.clone().json();
    else if (ctx && typeof ctx.json === "function") corpo = await ctx.json();
  } catch {
    corpo = null;
  }
  if (corpo && typeof corpo.error === "string") {
    const codigo = String(corpo.error);
    return new ErroDaMesa(codigo, typeof corpo.mensagem === "string" ? corpo.mensagem : mensagemDoCodigo(codigo, corpo), corpo);
  }
  const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
  if (status === 404 || /Failed to send|not found|FunctionsFetchError/i.test(String((error && error.message) || ""))) {
    return new ErroDaMesa("funcao_indisponivel", "A função da Mesa Vídeos ainda não foi publicada. Peça a publicação da função mesa-videos.");
  }
  return new ErroDaMesa("erro_desconhecido", String((error && error.message) || "Não foi possível concluir. Tente de novo."));
}

export async function chamarMesaVideos<T = any>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mesa-videos", { body: corpo });
  if (error) throw await erroDaChamada(error);
  if (data && typeof data === "object" && typeof (data as any).error === "string") {
    const codigo = String((data as any).error);
    throw new ErroDaMesa(codigo, typeof (data as any).mensagem === "string" ? (data as any).mensagem : mensagemDoCodigo(codigo, data as any), data as any);
  }
  return data as T;
}

// ------------------------------------------------------------------ subir vídeos

export function extensaoDoVideo(arquivo: { name?: string; type?: string }): string | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(arquivo.name || ""));
  const ext = m ? m[1].toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(EXTENSOES, ext)) return ext;
  const tipo = String(arquivo.type || "").toLowerCase();
  const achada = Object.keys(EXTENSOES).find((k) => EXTENSOES[k] === tipo);
  return achada || null;
}

/** UUID v4 sem randomUUID, que o Safari 11 não tem. */
export function novoIdDoArquivo(): string {
  const b = new Uint8Array(16);
  const c = typeof window !== "undefined" ? window.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

function lerComoBuffer(arquivo: Blob): Promise<ArrayBuffer> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as ArrayBuffer);
    r.onerror = () => falha(r.error || new Error("Não foi possível ler o arquivo."));
    r.readAsArrayBuffer(arquivo);
  });
}

/** SHA-256 em hexadecimal (null quando o arquivo é grande demais ou o navegador não tem crypto.subtle). */
export async function hashDoArquivo(arquivo: Blob): Promise<string | null> {
  const c = typeof window !== "undefined" ? window.crypto : undefined;
  if (!c || !c.subtle || arquivo.size > MAX_BYTES_DO_HASH) return null;
  try {
    const d = await c.subtle.digest("SHA-256", await lerComoBuffer(arquivo));
    const bytes = new Uint8Array(d);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] + 0x100).toString(16).slice(1);
    return s;
  } catch {
    return null;
  }
}

/** Duração e tamanho do quadro lidos pelo próprio navegador (sem baixar nada). Null quando não dá. */
export function metadadosDoVideo(arquivo: Blob, esperaMs = 8000): Promise<{ duracao_s: number | null; largura: number | null; altura: number | null }> {
  const vazio = { duracao_s: null, largura: null, altura: null };
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(vazio);
  return new Promise((ok) => {
    const tipo = String((arquivo as File).type || "");
    const el = document.createElement(tipo.indexOf("audio/") === 0 ? "audio" : "video") as HTMLVideoElement;
    let url = "";
    try {
      url = URL.createObjectURL(arquivo);
    } catch {
      ok(vazio);
      return;
    }
    const fim = (v: typeof vazio) => {
      window.clearTimeout(t);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* nada */
      }
      ok(v);
    };
    const t = window.setTimeout(() => fim(vazio), esperaMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 100) / 100 : null;
      fim({ duracao_s: d, largura: el.videoWidth || null, altura: el.videoHeight || null });
    };
    el.onerror = () => fim(vazio);
    el.src = url;
  });
}

export interface ResultadoDoEnvioDeVideo {
  registrados: ArquivoDeVideo[];
  duplicados: { nome: string; igual_a: string }[];
  recusados: { nome: string; motivo: string }[];
  /** Subiram, mas o registro no acervo espera a função ou o banco. */
  sem_registro: number;
  aviso: string | null;
}

/**
 * Sobe gravações brutas (duas de cada vez) para <cliente>/video/brutos/ e
 * registra no acervo pela função (lotes de 20). O arquivo vai como veio.
 */
export async function subirVideos(clientId: string, arquivos: File[], aoAvancar: (feitos: number, total: number) => void): Promise<ResultadoDoEnvioDeVideo> {
  const recusados: { nome: string; motivo: string }[] = [];
  const validos: { arquivo: File; ext: string }[] = [];
  for (const a of arquivos) {
    const ext = extensaoDoVideo(a);
    if (!ext) recusados.push({ nome: a.name || "arquivo", motivo: "formato não aceito (MP4, MOV, WEBM, MKV, WAV, MP3...)" });
    else if (a.size > MAX_BYTES_DO_VIDEO) recusados.push({ nome: a.name || "arquivo", motivo: "acima de 4 GB" });
    else validos.push({ arquivo: a, ext });
  }
  const subidos: Record<string, unknown>[] = [];
  let feitos = 0;
  let proximo = 0;
  aoAvancar(0, validos.length);
  const trabalhar = async () => {
    while (proximo < validos.length) {
      const item = validos[proximo++];
      const caminho = `${pastaDosBrutos(clientId)}/${novoIdDoArquivo()}.${item.ext}`;
      try {
        const [meta, sha] = await Promise.all([metadadosDoVideo(item.arquivo), hashDoArquivo(item.arquivo)]);
        const { error } = await supabase.storage.from(BUCKET_DOS_VIDEOS).upload(caminho, item.arquivo, { contentType: item.arquivo.type || EXTENSOES[item.ext], upsert: false });
        if (error) throw error;
        subidos.push({
          storage_path: caminho,
          nome_original: item.arquivo.name || caminho.split("/").pop(),
          mime: item.arquivo.type || EXTENSOES[item.ext],
          bytes: item.arquivo.size,
          duracao_s: meta.duracao_s,
          largura: meta.largura,
          altura: meta.altura,
          sha256: sha,
          gravado_em: item.arquivo.lastModified ? new Date(item.arquivo.lastModified).toISOString() : null,
        });
      } catch (e: any) {
        const m = (e && e.message) || "";
        recusados.push({ nome: item.arquivo.name || "arquivo", motivo: /size|large|413|limit/i.test(m) ? "o armazenamento recusou pelo tamanho" : m || "não subiu" });
      }
      feitos++;
      aoAvancar(feitos, validos.length);
    }
  };
  const trabalhadores: Promise<void>[] = [];
  for (let i = 0; i < Math.min(SUBIDAS_AO_MESMO_TEMPO, validos.length); i++) trabalhadores.push(trabalhar());
  await Promise.all(trabalhadores);

  const registrados: ArquivoDeVideo[] = [];
  const duplicados: { nome: string; igual_a: string }[] = [];
  let semRegistro = 0;
  let aviso: string | null = null;
  for (let i = 0; i < subidos.length; i += LOTE_DO_REGISTRO) {
    const lote = subidos.slice(i, i + LOTE_DO_REGISTRO);
    try {
      const r = await chamarMesaVideos<{ arquivos: unknown[]; duplicados: { nome: string; igual_a: string }[]; recusados: { nome: string; motivo: string }[] }>({
        acao: "arquivo_registrar",
        client_id: clientId,
        arquivos: lote,
      });
      normalizarArquivos(r.arquivos).forEach((a) => registrados.push(a));
      (r.duplicados || []).forEach((d) => duplicados.push(d));
      (r.recusados || []).forEach((x) => recusados.push(x));
    } catch (e) {
      semRegistro += lote.length;
      aviso = e instanceof ErroDaMesa ? e.message : "O registro no acervo não respondeu.";
    }
  }
  if (semRegistro) aviso = `${semRegistro} ${semRegistro === 1 ? "arquivo subiu" : "arquivos subiram"}, mas o registro no acervo espera a ativação da Mesa Vídeos. ${aviso || ""}`.trim();
  return { registrados, duplicados, recusados, sem_registro: semRegistro, aviso };
}

// ------------------------------------------------------------------ textos curtos

export function duracaoCurta(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s) || s <= 0) return "";
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  const seg = t % 60;
  return `${m}:${seg < 10 ? `0${seg}` : seg}`;
}

export function tamanhoCurto(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
