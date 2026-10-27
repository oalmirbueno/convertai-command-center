import { supabase } from "@/integrations/supabase/client";
import { subirQuadro } from "@/lib/mesa-videos/quadros";

/**
 * A foto do Workspace ou de Arquivos (outro bucket) vira um quadro na pasta do cliente no bucket mesa, que é de
 * onde o gerador de vídeo assina o link para o provedor (o mesmo do Escolher do gerador livre). Já na Mesa,
 * volta o mesmo caminho. Até 20 MB.
 */
export async function imagemParaAMesa(clientId: string, img: { bucket: string; caminho: string; nome: string }): Promise<string> {
  if ((img.bucket || "mesa") === "mesa" && img.caminho.indexOf(`${clientId}/`) === 0) return img.caminho;
  const { data, error } = await supabase.storage.from(img.bucket || "mesa").download(img.caminho);
  if (error || !data) throw new Error(`A imagem "${img.nome}" não pôde ser carregada.`);
  if (data.size > 20 * 1024 * 1024) throw new Error(`A imagem "${img.nome}" passa de 20 MB.`);
  return subirQuadro(clientId, data, img.nome);
}
