/**
 * A imagem que vai para o OCR do Estúdio (workspace-ocr).
 *
 * O provedor lê PNG, JPG, WEBP e GIF. Foto de iPhone vem em HEIC e o
 * servidor recusava sem dizer por quê. Agora:
 * - formato aceito: vai como está (o mesmo de antes);
 * - HEIC ou outro formato: o navegador tenta converter para JPG desenhando
 *   num canvas por <img> (o Safari abre HEIC; Chrome e Firefox em geral não);
 * - não conseguiu: erro com a frase que diz o que fazer.
 *
 * Sem createImageBitmap (Safari 11) e sem escurecer: a foto só é redesenhada
 * no tamanho máximo de 2048 px, com fundo branco onde houver transparência.
 */

export const FRASE_HEIC = "Foto em HEIC: exporte como JPG ou PNG e envie de novo.";
export const FRASE_FORMATO = "Formato de imagem não suportado. Envie JPG, PNG, WEBP ou GIF.";

const TIPOS_ACEITOS = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const LADO_MAXIMO = 2048;

export function tipoAceitoNoOcr(tipo: string | null | undefined): boolean {
  return TIPOS_ACEITOS.indexOf(String(tipo || "").toLowerCase()) >= 0;
}

/** HEIC/HEIF pelo tipo ou, quando o navegador não diz o tipo, pelo nome. */
export function ehHeic(arquivo: { type?: string; name?: string }): boolean {
  const tipo = String(arquivo.type || "").toLowerCase();
  if (tipo.indexOf("image/heic") === 0 || tipo.indexOf("image/heif") === 0) return true;
  return /\.(heic|heif)$/i.test(String(arquivo.name || ""));
}

/** Imagem que o painel tenta mandar ao OCR (inclui HEIC sem tipo, que o Windows às vezes entrega vazio). */
export function pareceImagem(arquivo: { type?: string; name?: string }): boolean {
  return String(arquivo.type || "").toLowerCase().indexOf("image/") === 0 || ehHeic(arquivo);
}

function lerComoDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result || ""));
    leitor.onerror = () => rejeitar(leitor.error || new Error("Não foi possível ler a imagem."));
    leitor.readAsDataURL(arquivo);
  });
}

/** Converte para JPG pelo navegador (<img> + canvas). Rejeita se o navegador não abrir o formato. */
export function converterPorCanvas(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    const limpar = () => { try { URL.revokeObjectURL(url); } catch { /* nada */ } };
    img.onload = () => {
      try {
        const largura = img.naturalWidth || img.width;
        const altura = img.naturalHeight || img.height;
        if (!largura || !altura) throw new Error("imagem vazia");
        const escala = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(largura * escala));
        canvas.height = Math.max(1, Math.round(altura * escala));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas indisponível");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        limpar();
        if (dataUrl.indexOf("data:image/jpeg") !== 0) throw new Error("conversão falhou");
        resolver(dataUrl);
      } catch (e) {
        limpar();
        rejeitar(e);
      }
    };
    img.onerror = () => { limpar(); rejeitar(new Error("formato não aberto pelo navegador")); };
    img.src = url;
  });
}

/**
 * O data URL que o workspace-ocr aceita, ou erro com a frase para a tela.
 * `converter` só é trocado nos testes (jsdom não desenha em canvas).
 */
export async function imagemParaOcr(
  arquivo: File,
  converter: (arquivo: Blob) => Promise<string> = converterPorCanvas,
): Promise<string> {
  if (tipoAceitoNoOcr(arquivo.type) && !ehHeic(arquivo)) return lerComoDataUrl(arquivo);
  try {
    return await converter(arquivo);
  } catch {
    throw new Error(ehHeic(arquivo) ? FRASE_HEIC : FRASE_FORMATO);
  }
}
