/**
 * Anexos do Gestor Aceleriq (08/10/2026): o dono manda arquivos, imagens e
 * áudios na conversa.
 *
 * - Documentos (PDF, Word, planilha, apresentação, texto, ZIP): lidos AQUI,
 *   pelo mesmo leitor do agente do Mês; o servidor recebe só o texto.
 * - Imagens: reduzidas aqui para até 1600 px (JPEG) e enviadas em base64; o
 *   modelo vê a imagem. Até 4 por mensagem. Nada fica guardado no banco.
 * - Áudio (gravado ou anexado): vai em bytes para transcrever e vira o texto
 *   da mensagem.
 */

export const MAX_IMAGENS_DO_GESTOR = 4;
export const LADO_MAXIMO_DA_IMAGEM = 1600;
export const MAX_BYTES_DO_AUDIO = 24 * 1024 * 1024;

export type ImagemDoGestor = { id: string; nome: string; mime: string; base64: string; previa: string; bytes: number };

const EXT_DE_AUDIO = /\.(mp3|m4a|ogg|oga|opus|wav|webm|aac|mp4a)$/i;

export function ehAudio(f: { name: string; type: string }): boolean {
  return /^audio\//i.test(f.type || "") || EXT_DE_AUDIO.test(f.name || "");
}

export function ehImagem(f: { name: string; type: string }): boolean {
  return /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type || "") || /\.(jpe?g|png|webp|gif)$/i.test(f.name || "");
}

/** O tipo que o servidor aceita para o áudio (o navegador às vezes manda vazio ou com codecs). */
export function tipoDoAudioParaEnvio(f: { name: string; type: string }): string {
  const base = String(f.type || "").split(";")[0].trim().toLowerCase();
  if (["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/aac"].indexOf(base) >= 0) return base;
  const ext = (String(f.name || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const porExt: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/x-m4a", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", webm: "audio/webm", aac: "audio/aac", mp4a: "audio/mp4" };
  return (ext && porExt[ext]) || "audio/webm";
}

const lerComoDataUrl = (f: Blob) => new Promise<string>((ok, falha) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result || ""));
  r.onerror = () => falha(new Error("leitura"));
  r.readAsDataURL(f);
});

/** Reduz a imagem para até 1600 px no lado maior (JPEG 0,85); GIF e PNG pequenos seguem como estão. */
export async function prepararImagem(f: File): Promise<ImagemDoGestor> {
  const original = await lerComoDataUrl(f);
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const img = await new Promise<HTMLImageElement>((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error("imagem"));
    i.src = original;
  });
  const maior = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const mimeOriginal = (f.type || "image/jpeg").toLowerCase();
  if (maior <= LADO_MAXIMO_DA_IMAGEM && f.size <= 1_500_000 && ["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(mimeOriginal) >= 0) {
    return { id, nome: f.name || "imagem", mime: mimeOriginal, base64: original.split(",")[1] || "", previa: original, bytes: f.size };
  }
  const escala = Math.min(1, LADO_MAXIMO_DA_IMAGEM / maior);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * escala));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * escala));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const reduzida = c.toDataURL("image/jpeg", 0.85);
  const base64 = reduzida.split(",")[1] || "";
  return { id, nome: f.name || "imagem", mime: "image/jpeg", base64, previa: reduzida, bytes: Math.round(base64.length * 0.75) };
}

export const tempoDoAudio = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Duração de um arquivo de áudio (para o teto e o custo); 0 quando o navegador não sabe. */
export function duracaoDoAudio(f: Blob): Promise<number> {
  return new Promise((ok) => {
    try {
      const url = URL.createObjectURL(f);
      const a = document.createElement("audio");
      const fim = (v: number) => { URL.revokeObjectURL(url); ok(Number.isFinite(v) && v > 0 ? v : 0); };
      a.preload = "metadata";
      a.onloadedmetadata = () => fim(a.duration);
      a.onerror = () => fim(0);
      setTimeout(() => fim(0), 4000);
      a.src = url;
    } catch {
      ok(0);
    }
  });
}
