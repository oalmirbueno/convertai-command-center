import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { confirmStoredObject, createFileRecord } from "@/lib/fileRecordActions";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";

/**
 * Os vídeos da marca na Mesa Identidade (frente IDV3, adendo do dono: "o
 * Motion também se complementa no final da identidade visual"). O filme mora
 * na Mesa Motion (motion_filmes); aqui só a leitura do andamento, os pedidos
 * de render com as ações que já existem (cena_pedir, montar, entregar), o
 * vídeo pronto no pacote e o envio para aprovação (Arquivos + revisão da
 * agência, o mesmo caminho do brandbook). Nada vai ao cliente por aqui.
 */

export type FilmeResumo = {
  id: string;
  nome: string;
  tipo: string;
  etapa: string;
  formatos: string[];
  cenas: Array<{ id: string; tipo_plano?: string }>;
  renders: Array<{ cena_id: string; modo: string; formato: string; estado: string; saida_path: string | null }>;
  montagem: Record<string, unknown>;
  entrega: { renders?: Array<{ formato: string; saida_path: string | null; duracao_s?: number | null }>; em?: string } & Record<string, unknown>;
  arquivado_em: string | null;
};

export async function lerFilme(filmeId: string): Promise<{ filme: FilmeResumo; links: Record<string, string> }> {
  return await chamarFuncao<{ filme: FilmeResumo; links: Record<string, string> }>("mesa-motion", { acao: "filme_ler", filme_id: filmeId });
}

/** Marca do clique (a fila recusa pedido repetido com o mesmo uid). */
export const uidDoPedido = (base: string) => `idv-${base}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

/** Andamento do filme: cenas com render final em cada formato, montagem pedida e entrega. */
export function andamentoDoFilme(f: FilmeResumo): { cenas: number; comFinal: number; montado: boolean; entregue: number; faltaFinal: string[] } {
  const cenas = (f.cenas || []).filter((c) => !c.tipo_plano || c.tipo_plano === "hf");
  const faltaFinal: string[] = [];
  let comFinal = 0;
  for (const c of cenas) {
    const todas = (f.formatos || []).every((fmt) => (f.renders || []).some((r) => r.cena_id === c.id && r.modo === "final" && r.formato === fmt && r.estado === "pronto"));
    if (todas) comFinal += 1;
    else faltaFinal.push(c.id);
  }
  const pedidos = (f.montagem && typeof f.montagem.pedidos === "object" && f.montagem.pedidos) || {};
  return { cenas: cenas.length, comFinal, montado: Object.keys(pedidos as Record<string, unknown>).length > 0, entregue: Array.isArray(f.entrega && f.entrega.renders) ? f.entrega.renders!.length : 0, faltaFinal };
}

/** Pede o render final das cenas que faltam, em todos os formatos do filme (fila do worker, sem custo de IA). */
export async function pedirRenderDasCenas(f: FilmeResumo): Promise<number> {
  const { faltaFinal } = andamentoDoFilme(f);
  for (const cenaId of faltaFinal) {
    await chamarFuncao("mesa-motion", { acao: "cena_pedir", filme_id: f.id, cena_id: cenaId, modo: "final", formatos: f.formatos, uid: uidDoPedido(cenaId.slice(0, 12)) });
  }
  return faltaFinal.length;
}

export async function montarFilme(f: FilmeResumo) {
  return await chamarFuncao("mesa-motion", { acao: "montar", filme_id: f.id, uid: uidDoPedido("montar") });
}

export async function registrarEntregaDoFilme(f: FilmeResumo) {
  return await chamarFuncao<{ filme: FilmeResumo; links: Record<string, string> }>("mesa-motion", { acao: "entregar", filme_id: f.id, nota: "Vídeo da marca criado pela Mesa Identidade." });
}

/** Os vídeos prontos (entregues) do filme, com o link de 1 h e o nome do arquivo no pacote. */
export function videosProntos(f: FilmeResumo, links: Record<string, string>): Array<{ formato: string; url: string; arquivo: string; titulo: string }> {
  const nome = (f.nome || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "video";
  return (Array.isArray(f.entrega && f.entrega.renders) ? f.entrega.renders! : [])
    .filter((r) => r.saida_path && links[r.saida_path])
    .map((r) => ({ formato: r.formato, url: links[r.saida_path as string], arquivo: `videos/${nome}-${String(r.formato).replace(":", "x")}.mp4`, titulo: `${f.nome} (${r.formato})` }));
}

/**
 * Vídeo pronto para Arquivos com a revisão da agência (mesma dupla aprovação
 * do brandbook: agência e depois o cliente). Idempotente pela chave.
 */
export async function videoParaAprovacao(p: { clientId: string; filmeId: string; formato: string; url: string; nome: string }): Promise<{ fileId: string; revisaoPedida: boolean; aviso: string | null }> {
  const chave = `idv-video:${p.filmeId}:${p.formato}`;
  const db = supabase as any;
  const { data: existente } = await db.from("files").select("id, client_id").eq("idempotency_key", chave).maybeSingle();
  let fileId: string;
  if (existente && existente.client_id === p.clientId) fileId = existente.id;
  else {
    const resposta = await fetch(p.url);
    if (!resposta.ok) throw new Error("O vídeo não baixou da Mesa Motion. Abra o filme e tente de novo.");
    const blob = await resposta.blob();
    fileId = crypto.randomUUID();
    const arquivo = `${p.nome.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "video-da-marca"}-${p.formato.replace(":", "x")}.mp4`;
    const caminho = `${p.clientId}/${fileId}/v1/${arquivo}`;
    const { error } = await supabase.storage.from("files").upload(caminho, blob, { contentType: "video/mp4", upsert: false });
    if (error) {
      const estado = await confirmStoredObject("files", caminho);
      if (estado !== "exists") throw error;
    }
    const { data: auth } = await supabase.auth.getUser();
    const registro = await createFileRecord({
      id: fileId,
      client_id: p.clientId,
      file_name: arquivo,
      file_url: `files://${caminho}`,
      file_type: "video",
      mime_type: "video/mp4",
      extension: "mp4",
      storage_bucket: "files",
      storage_path: caminho,
      size_bytes: blob.size,
      folder: "identidade",
      tags: ["mesa_identidade", "video_da_marca"],
      uploaded_by: auth && auth.user ? auth.user.id : null,
      approval_status: "none",
      agency_approval_status: "not_requested",
      visibility: "internal",
      requires_approval: false,
      status: "ready",
      version: 1,
      description: `Vídeo da marca (${p.formato}), feito na Mesa Motion a partir da Mesa Identidade.`,
      idempotency_key: chave,
    } as never);
    fileId = registro.id;
  }
  try {
    await requestFileAgencyReview(fileId);
    return { fileId, revisaoPedida: true, aviso: null };
  } catch (e) {
    const msg = (e as { message?: string }).message || "falha";
    return { fileId, revisaoPedida: false, aviso: `O vídeo foi para Arquivos, mas a revisão não foi pedida: ${msg}` };
  }
}

/** Os vídeos prontos em bytes para o pacote (teto de 180 MB somados; o que passa fica como link no LEIA). */
export async function videosParaOPacote(itens: Array<{ url: string; arquivo: string; titulo: string }>): Promise<{ arquivos: Array<{ caminho: string; dados: Blob; titulo: string }>; fora: string[] }> {
  const arquivos: Array<{ caminho: string; dados: Blob; titulo: string }> = [];
  const fora: string[] = [];
  let total = 0;
  for (const v of itens) {
    try {
      const r = await fetch(v.url);
      if (!r.ok) throw new Error("sem vídeo");
      const b = await r.blob();
      if (total + b.size > 180 * 1024 * 1024) {
        fora.push(v.titulo);
        continue;
      }
      total += b.size;
      arquivos.push({ caminho: v.arquivo, dados: b, titulo: v.titulo });
    } catch {
      fora.push(v.titulo);
    }
  }
  return { arquivos, fora };
}
