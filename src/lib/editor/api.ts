import { supabase } from "@/integrations/supabase/client";
import { ErroDaMesa, mensagemDoCodigo } from "@/lib/mesa/api";
import { novoIdDoArquivo } from "@/components/mesa-videos/videosApi";

/**
 * Chamadas da tela do editor (frente V-B): a função editor-video (timestamp,
 * agente editor, visão) e a subida de arquivos de trabalho do editor
 * (quadros e partes de áudio) em <cliente>/video/editor/ no bucket mesa.
 * Função não publicada vira ErroDaMesa("funcao_indisponivel"): a tela mostra
 * "em preparação" sem quebrar.
 */

export const BUCKET_DO_EDITOR = "mesa";

export async function chamarEditorVideo<T = any>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("editor-video", { body: corpo });
  if (error) {
    const ctx = (error as any).context;
    let det: Record<string, unknown> | null = null;
    try {
      if (ctx && typeof ctx.clone === "function") det = await ctx.clone().json();
      else if (ctx && typeof ctx.json === "function") det = await ctx.json();
    } catch {
      det = null;
    }
    if (det && typeof det.error === "string") throw new ErroDaMesa(String(det.error), typeof det.mensagem === "string" ? det.mensagem : mensagemDoCodigo(String(det.error), det), det);
    // AG2: as rotas comuns do aprendizado respondem { erro: "texto" } (sem código): o motivo aparece, não "função indisponível".
    if (det && typeof det.erro === "string") throw new ErroDaMesa("erro_do_servidor", det.erro, det);
    const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
    if (status === 404 || !ctx) throw new ErroDaMesa("funcao_indisponivel", "O editor ainda não tem a função editor-video publicada.");
    throw new ErroDaMesa("erro_desconhecido", String((error as any).message || "Não foi possível concluir. Tente de novo."));
  }
  if (data && typeof data === "object" && typeof (data as any).error === "string") {
    const codigo = String((data as any).error);
    throw new ErroDaMesa(codigo, typeof (data as any).mensagem === "string" ? (data as any).mensagem : mensagemDoCodigo(codigo, data as any), data as any);
  }
  return data as T;
}

export const emPreparacao = (e: unknown) => e instanceof ErroDaMesa && ["funcao_indisponivel", "acao_desconhecida", "servico_indisponivel"].indexOf(e.codigo) >= 0;

export const novoId = () => novoIdDoArquivo();

/** Sobe um arquivo de trabalho do editor e devolve o caminho no bucket. */
export async function subirDoEditor(clientId: string, pasta: "quadros" | "audio" | "referencias", blob: Blob, extensao: string): Promise<string> {
  const caminho = `${clientId}/video/editor/${pasta}/${novoIdDoArquivo()}.${extensao}`;
  const { error } = await supabase.storage.from(BUCKET_DO_EDITOR).upload(caminho, blob, { contentType: blob.type || undefined, upsert: false });
  if (error) throw new ErroDaMesa("envio_falhou", "Não foi possível subir o arquivo para o editor.", { detalhe: error.message });
  return caminho;
}
