/**
 * Arquivo de imagem quebrado, pego sem abrir a imagem (frente LR, 29/09/2026).
 *
 * Um PNG cortado no envio (a assinatura e o cabeçalho existem, o fim não) passa
 * pelo teste de "é imagem?" e o provedor recusa o pedido INTEIRO ("The image
 * data you provided does not represent a valid image"). Aqui só se olha o
 * começo e o fim do arquivo: sem custo de CPU. Módulo puro (vitest e Deno).
 */

function formato(b: Uint8Array): "png" | "jpeg" | "webp" | "gif" | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  return null;
}

/** Procura a sequência nos últimos `janela` bytes (aceita enchimento depois do fim). */
function terminaCom(b: Uint8Array, seq: number[], janela = 64): boolean {
  const inicio = Math.max(0, b.length - janela - seq.length);
  for (let i = b.length - seq.length; i >= inicio; i--) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/**
 * Defeito que faz o provedor recusar a imagem, pego sem abrir a imagem (só o
 * começo e o fim do arquivo, sem custo de CPU). null: pode mandar.
 */
export function defeitoDaImagem(b: Uint8Array | null | undefined, maxBytes = 20 * 1024 * 1024): string | null {
  if (!b || b.byteLength < 32) return "arquivo_vazio";
  if (b.byteLength > maxBytes) return "grande_demais";
  const f = formato(b);
  if (!f || f === "gif") return "formato_nao_suportado";
  // PNG termina no bloco IEND ("IEND" + CRC).
  if (f === "png" && !terminaCom(b, [0x49, 0x45, 0x4e, 0x44])) return "png_truncado";
  // JPEG termina no marcador EOI (FF D9).
  if (f === "jpeg" && !terminaCom(b, [0xff, 0xd9])) return "jpeg_truncado";
  // WebP diz o próprio tamanho no cabeçalho RIFF.
  if (f === "webp") {
    const declarado = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
    if (declarado + 8 > b.byteLength) return "webp_truncado";
  }
  return null;
}
