import { supabase } from "@/integrations/supabase/client";

/** Decodifica e reencoda a capa. Não envia SVG, HTML nem o nome original. */
export async function enviarCapa(
  arquivo: File,
  produto: string,
): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(produto)) throw Error("Produto inválido.");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(arquivo.type) ||
    arquivo.size > 5 * 1024 * 1024 ||
    arquivo.size === 0
  )
    throw Error("Escolha uma imagem JPG, PNG ou WebP de até 5 MB.");
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    throw Error("Este arquivo não é uma imagem válida.");
  }
  try {
    if (imagem.width * imagem.height > 24_000_000)
      throw Error("Escolha uma imagem de até 24 megapixels.");
    const escala = Math.min(1, 1920 / Math.max(imagem.width, imagem.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagem.width * escala));
    canvas.height = Math.max(1, Math.round(imagem.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Não foi possível preparar a imagem.");
    ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(Error("Não foi possível preparar a capa.")),
        "image/webp",
        0.88,
      ),
    );
    const caminho = `${produto}/${crypto.randomUUID()}.webp`;
    const { error } = await supabase.storage
      .from("membros-capas")
      .upload(caminho, blob, { contentType: "image/webp", upsert: false });
    if (error) throw error;
    return supabase.storage.from("membros-capas").getPublicUrl(caminho).data
      .publicUrl;
  } finally {
    imagem.close();
  }
}
