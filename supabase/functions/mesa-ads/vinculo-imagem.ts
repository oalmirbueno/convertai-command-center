/**
 * Impressão digital da imagem (dHash de 64 bits) para o vínculo automático.
 *
 * O recorte é o quadrado do centro: a miniatura da Meta costuma vir quadrada
 * e a arte do Estúdio é 4:5 ou 9:16; o miolo das duas é o mesmo. Depois o
 * quadrado vira 9x8 em tons de cinza e cada bit compara um pixel com o
 * vizinho (vinculo.dHashDeCinzas). Falha ao decodificar = null, nunca erro.
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { dHashDeCinzas } from "./vinculo.ts";

export async function impressaoDaImagem(bytes: Uint8Array): Promise<string | null> {
  try {
    const img = await Image.decode(bytes);
    const lado = Math.min(img.width, img.height);
    if (lado < 8) return null;
    const x = Math.floor((img.width - lado) / 2) + 1;
    const y = Math.floor((img.height - lado) / 2) + 1;
    const quadrado = img.crop(x - 1, y - 1, lado, lado);
    quadrado.resize(9, 8);
    const cinzas: number[] = [];
    for (let py = 1; py <= 8; py++) {
      for (let px = 1; px <= 9; px++) {
        const [r, g, b] = Image.colorToRGBA(quadrado.getPixelAt(px, py));
        cinzas.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    return dHashDeCinzas(cinzas);
  } catch {
    return null;
  }
}
