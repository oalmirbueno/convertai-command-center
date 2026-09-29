/**
 * Estúdio de mockups: leitura do catálogo, camadas, logos do kit, escolhas do cliente e envio
 * para Arquivos e aprovação. O que exige chave (Jev, gerador de cena) passa pela função
 * mesa-mockups; o resto vai direto, com a RLS da equipe.
 */
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { createFileRecord, confirmStoredObject } from "@/lib/fileRecordActions";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { normalizarMockup, normalizarTextura, ordenarNaSequencia, type ConjuntoDeCamadas, type MockupDoCatalogo, type TexturaDoCatalogo } from "./catalogo";
import type { CamadasCarregadas } from "./webgl";

export const BUCKET_MOCKUPS = "mockups";
const db = supabase as any;

/** A tabela ainda não existe (migration 20260930070000 não aplicada)? */
export function semCatalogo(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /mockup_catalogo|textura_catalogo|mockup_aplicacoes/.test(String(error.message || ""));
}

export async function lerCatalogoDeMockups(): Promise<{ itens: MockupDoCatalogo[]; semBanco: boolean }> {
  const { data, error } = await db.from("mockup_catalogo").select("*").eq("ativo", true).limit(1000);
  if (error) {
    if (semCatalogo(error)) return { itens: [], semBanco: true };
    throw error;
  }
  const itens = ((data as unknown[]) || []).map(normalizarMockup).filter((m): m is MockupDoCatalogo => !!m);
  return { itens: ordenarNaSequencia(itens), semBanco: false };
}

export async function lerTexturas(): Promise<TexturaDoCatalogo[]> {
  const { data, error } = await db.from("textura_catalogo").select("*").eq("ativo", true).limit(500);
  if (error) {
    if (semCatalogo(error)) return [];
    throw error;
  }
  return ((data as unknown[]) || []).map(normalizarTextura).filter((t): t is TexturaDoCatalogo => !!t);
}

// ------------------------------------------------------------------ imagens

const urls = new Map<string, Promise<string>>();

/** URL assinada (1 h) de um caminho do bucket; mesma promessa para o mesmo caminho. */
export function urlAssinada(caminho: string, bucket = BUCKET_MOCKUPS): Promise<string> {
  const chave = `${bucket}:${caminho}`;
  const ja = urls.get(chave);
  if (ja) return ja;
  const p = supabase.storage
    .from(bucket)
    .createSignedUrl(caminho, 3600)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) throw error || new Error("Imagem indisponível");
      return data.signedUrl;
    });
  p.catch(() => urls.delete(chave));
  urls.set(chave, p);
  // A assinatura vence em 1 h: esquece aos 50 min.
  setTimeout(() => urls.delete(chave), 50 * 60_000);
  return p;
}

/**
 * Baixa a imagem e abre por URL local (blob): o canvas não fica "sujo" e o WebGL pode ler.
 * Fica na memória da página enquanto ela estiver aberta.
 */
const imagens = new Map<string, Promise<HTMLImageElement>>();
export function carregarImagem(caminho: string, bucket = BUCKET_MOCKUPS): Promise<HTMLImageElement> {
  const chave = `${bucket}:${caminho}`;
  const ja = imagens.get(chave);
  if (ja) return ja;
  const p = (async () => {
    const { data, error } = await supabase.storage.from(bucket).download(caminho);
    if (error || !data) throw error || new Error("Imagem indisponível");
    const url = URL.createObjectURL(data);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Imagem não abriu"));
      img.src = url;
    });
  })();
  p.catch(() => imagens.delete(chave));
  imagens.set(chave, p);
  return p;
}

export async function carregarCamadas(conjunto: ConjuntoDeCamadas, largura: number, altura: number): Promise<CamadasCarregadas> {
  const [base, vazio, ganho, uv, mapa] = await Promise.all([
    carregarImagem(conjunto.base),
    carregarImagem(conjunto.vazio),
    carregarImagem(conjunto.ganho),
    carregarImagem(conjunto.uv),
    carregarImagem(conjunto.mapa),
  ]);
  return { largura, altura, base, vazio, ganho, uv, mapa };
}

/** Onde está a logo do kit: caminho no bucket mesa ou arquivo em Arquivos. */
export async function ondeEstaALogo(logoPath: string | null | undefined, logoFileId: string | null | undefined): Promise<{ bucket: string; caminho: string } | null> {
  if (logoPath) return { bucket: "mesa", caminho: logoPath };
  if (!logoFileId) return null;
  const { data, error } = await db.from("files").select("storage_bucket, storage_path").eq("id", logoFileId).maybeSingle();
  if (error || !data || !data.storage_path) return null;
  return { bucket: data.storage_bucket || "files", caminho: data.storage_path };
}

// ------------------------------------------------------------------ escolhas do cliente

export interface AplicacaoDeMockup {
  id: string;
  client_id: string;
  marca_id: string | null;
  origem: "catalogo" | "cena";
  mockup_id: string | null;
  cena_caminho: string | null;
  config: Record<string, unknown>;
  status: "escolhido" | "enviado";
  file_id: string | null;
  no_brandbook: boolean;
  criado_em: string;
}

export async function lerAplicacoes(clientId: string, marcaId: string | null): Promise<AplicacaoDeMockup[]> {
  let q = db.from("mockup_aplicacoes").select("*").eq("client_id", clientId).is("arquivado_em", null).order("criado_em", { ascending: false }).limit(200);
  q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
  const { data, error } = await q;
  if (error) {
    if (semCatalogo(error)) return [];
    throw error;
  }
  return (data as AplicacaoDeMockup[]) || [];
}

export async function salvarAplicacao(p: {
  clientId: string;
  marcaId: string | null;
  origem: "catalogo" | "cena";
  mockupId?: string | null;
  cenaCaminho?: string | null;
  config: Record<string, unknown>;
  fileId?: string | null;
  noBrandbook?: boolean;
  id?: string | null;
}): Promise<AplicacaoDeMockup> {
  const { data, error } = await db.rpc("mockup_aplicacao_salvar", {
    _client_id: p.clientId,
    _marca_id: p.marcaId,
    _origem: p.origem,
    _mockup_id: p.mockupId ?? null,
    _cena_caminho: p.cenaCaminho ?? null,
    _config: p.config,
    _file_id: p.fileId ?? null,
    _no_brandbook: !!p.noBrandbook,
    _id: p.id ?? null,
  });
  if (error) throw error;
  return data as AplicacaoDeMockup;
}

export async function arquivarAplicacao(id: string, arquivar = true): Promise<void> {
  const { error } = await db.rpc("mockup_aplicacao_arquivar", { _id: id, _arquivar: arquivar });
  if (error) throw error;
}

// ------------------------------------------------------------------ envio

function nomeSeguro(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (base || "mockup").slice(0, 80);
}

/**
 * PNG exportado -> Arquivos > Identidade visual e revisão da agência (mesmo caminho da tela de
 * Arquivos). Idempotente pela chave: reenviar a mesma imagem não duplica.
 */
export async function enviarParaArquivos(p: { clientId: string; nome: string; png: Blob; chave: string; descricao: string }): Promise<{ fileId: string; revisaoPedida: boolean; aviso: string | null }> {
  const { data: existente } = await db.from("files").select("id, client_id").eq("idempotency_key", p.chave).maybeSingle();
  let fileId: string;
  if (existente && existente.client_id === p.clientId) {
    fileId = existente.id;
  } else {
    fileId = crypto.randomUUID();
    const arquivo = `${nomeSeguro(p.nome)}.png`;
    const caminho = `${p.clientId}/${fileId}/v1/${arquivo}`;
    const { error: erroUpload } = await supabase.storage.from("files").upload(caminho, p.png, { contentType: "image/png", upsert: false });
    if (erroUpload) {
      const estado = await confirmStoredObject("files", caminho);
      if (estado !== "exists") throw erroUpload;
    }
    const { data: auth } = await supabase.auth.getUser();
    const registro = await createFileRecord({
      id: fileId,
      client_id: p.clientId,
      file_name: arquivo,
      file_url: `files://${caminho}`,
      file_type: "foto",
      mime_type: "image/png",
      extension: "png",
      storage_bucket: "files",
      storage_path: caminho,
      size_bytes: p.png.size,
      folder: "identidade",
      tags: ["mesa_identidade", "mockup"],
      uploaded_by: auth?.user?.id ?? null,
      approval_status: "none",
      agency_approval_status: "not_requested",
      visibility: "internal",
      requires_approval: false,
      status: "ready",
      version: 1,
      description: p.descricao.slice(0, 1000),
      idempotency_key: p.chave,
    } as never);
    fileId = registro.id;
  }
  try {
    await requestFileAgencyReview(fileId);
    return { fileId, revisaoPedida: true, aviso: null };
  } catch (e) {
    const msg = (e as { message?: string })?.message || "falha";
    return { fileId, revisaoPedida: false, aviso: `O mockup foi para Arquivos, mas a revisão não foi pedida: ${msg}` };
  }
}

/**
 * Cópia do mockup para o brandbook: JPEG de até 1600 px em mesa/<cliente>/mockups/brandbook/,
 * o bucket de onde a Mesa Identidade tira as imagens do PDF e da página pública (até 4 MB).
 */
export async function copiaParaBrandbook(clientId: string, fileId: string, png: Blob): Promise<string> {
  const url = URL.createObjectURL(png);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("Imagem não abriu"));
      i.src = url;
    });
    const f = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * f));
    c.height = Math.max(1, Math.round(img.naturalHeight * f));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const jpg = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error("Imagem não gerada"))), "image/jpeg", 0.86));
    const caminho = `${clientId}/mockups/brandbook/${fileId}.jpg`;
    const { error } = await supabase.storage.from("mesa").upload(caminho, jpg, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return caminho;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------------ função mesa-mockups

export interface SugestaoDoJev {
  mockup_id: string;
  nota: number;
  confianca: number | null;
}

export async function sugerirMockups(p: { clientId: string; marcaId: string | null; candidatos: Array<Pick<MockupDoCatalogo, "id" | "nome" | "categoria" | "tags">>; quantos: number }) {
  return chamarFuncao<{ sugestoes: SugestaoDoJev[]; segmento: string | null; aviso: string | null; custo_usd: number }>("mesa-mockups", {
    acao: "sugerir",
    client_id: p.clientId,
    marca_id: p.marcaId,
    candidatos: p.candidatos.map((c) => ({ id: c.id, nome: c.nome, categoria: c.categoria, tags: c.tags })),
    quantos: p.quantos,
  });
}

export type TipoDeCena = "fachada" | "social";

export async function estimarCena(p: { clientId: string; tipo: TipoDeCena; modeloId?: string | null }) {
  return chamarFuncao<{ estimativa_usd: number; modelo_id: string; modelo_nome: string }>("mesa-mockups", { acao: "cena_estimar", client_id: p.clientId, tipo: p.tipo, modelo_id: p.modeloId ?? null });
}

export async function gerarCena(p: { clientId: string; marcaId: string | null; tipo: TipoDeCena; pedido?: string; modeloId?: string | null }) {
  return chamarFuncao<{ caminho: string; largura: number | null; altura: number | null; custo_usd: number; saldo_usd: number; modelo_id: string }>("mesa-mockups", {
    acao: "cena_gerar",
    client_id: p.clientId,
    marca_id: p.marcaId,
    tipo: p.tipo,
    pedido: p.pedido || "",
    modelo_id: p.modeloId ?? null,
  });
}
