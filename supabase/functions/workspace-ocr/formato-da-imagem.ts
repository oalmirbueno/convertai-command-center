/**
 * Formato da imagem que o OCR aceita.
 *
 * O provedor lê PNG, JPG, WEBP e GIF. Foto de iPhone vem em HEIC e caía no
 * mesmo "image (data URL base64) obrigatório" de quando não vinha imagem
 * nenhuma: a pessoa não sabia o que fazer. Agora cada caso tem código e
 * frase própria. O navegador converte o HEIC antes de enviar quando consegue
 * (src/lib/imagemParaOcr.ts); este é o aviso de quando não conseguiu.
 */
export type ConferenciaDaImagem =
  | { ok: true }
  | { ok: false; status: 400 | 415; code: string; error: string };

const TIPOS_HEIC = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export const FRASE_HEIC = "Foto em HEIC: exporte como JPG ou PNG e envie de novo.";

export function conferirImagemDoOcr(image: unknown): ConferenciaDaImagem {
  if (typeof image !== "string" || !/^data:/i.test(image)) {
    return { ok: false, status: 400, code: "imagem_ausente", error: "Envie a imagem para ler o texto." };
  }
  const tipo = ((/^data:([^;,]*)/i.exec(image) || [])[1] || "").trim().toLowerCase();
  if (TIPOS_HEIC.has(tipo)) {
    return { ok: false, status: 415, code: "formato_heic", error: FRASE_HEIC };
  }
  if (!/^image\/(?:png|jpe?g|webp|gif)$/.test(tipo) || !/;base64,/i.test(image)) {
    return {
      ok: false,
      status: 415,
      code: "formato_nao_suportado",
      error: "Formato de imagem não suportado. Envie JPG, PNG, WEBP ou GIF.",
    };
  }
  return { ok: true };
}
