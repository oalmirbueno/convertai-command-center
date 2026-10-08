import { supabase } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

/**
 * Áudio vira texto no servidor (whisper pela carteira da agência, função
 * gestor-aceleriq, x-gestor-acao: transcrever). Compartilhado pelos chats da
 * Central (Gestor e Hermes): o Hermes recebe o TEXTO, revisado pelo dono.
 */
export async function transcreverNoServidor(audio: Blob, mime: string, segundos: number): Promise<{ texto: string; segundos?: number }> {
  const { data, error } = await supabase.functions.invoke("gestor-aceleriq", {
    body: audio,
    headers: { "Content-Type": mime, "x-gestor-acao": "transcrever", "x-gestor-duracao": String(Math.round(segundos) || 0) },
  });
  if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, "Não deu para transcrever o áudio."));
  const r = data as { texto?: string; segundos?: number; mensagem?: string; error?: string };
  if (!r || r.error || !r.texto) throw new Error((r && r.mensagem) || "Não deu para entender o áudio.");
  return { texto: r.texto, segundos: r.segundos };
}
