/**
 * Impressão digital da imagem (dHash de 64 bits) para o vínculo automático.
 *
 * O recorte é o quadrado do centro: a miniatura da Meta costuma vir quadrada
 * e a arte do Estúdio é 4:5 ou 9:16; o miolo das duas é o mesmo. Depois o
 * quadrado vira 9x8 em tons de cinza e cada bit compara um pixel com o
 * vizinho (vinculo.dHashDeCinzas). Falha ao decodificar = null, nunca erro.
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { dimensoesDoCabecalho } from "../_shared/imagem-local.ts";
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

/**
 * CPU das impressões numa chamada (anti-bug 26/09: "CPU Time exceeded" no
 * vinculos_automaticos, que abria até 90 imagens por chamada; cada foto de
 * 1 MP custa perto de 0,1 s de CPU na função e o limite é 2 s). Abrir fica
 * uma imagem por vez, e o que passar do orçamento volta PENDENTE: a tela já
 * diz "reconheça de novo para continuar" e o cache guarda o que foi feito.
 */
export const ORCAMENTO_DAS_IMPRESSOES_MS = 900;
/** Acima disto nem abre (6 MP já custam perto de 0,5 s): fica sem impressão, como imagem grande demais. */
export const MAX_PIXELS_NA_IMPRESSAO = 6_000_000;
export const PENDENTE = "pendente" as const;

export type OrcamentoDasImpressoes = { gastoMs: number; limiteMs: number; fila: Promise<unknown> };

export const novoOrcamentoDasImpressoes = (limiteMs = ORCAMENTO_DAS_IMPRESSOES_MS): OrcamentoDasImpressoes => ({
  gastoMs: 0,
  limiteMs,
  fila: Promise.resolve(),
});

/**
 * Impressão dentro do orçamento: uma imagem aberta por vez (a conta do gasto
 * não se perde com as tarefas em paralelo); orçamento gasto = PENDENTE.
 */
export function impressaoNoOrcamento(
  bytes: Uint8Array,
  orcamento: OrcamentoDasImpressoes,
  calcular: (b: Uint8Array) => Promise<string | null> = impressaoDaImagem,
): Promise<string | null | typeof PENDENTE> {
  const d = dimensoesDoCabecalho(bytes);
  if (d && d.largura * d.altura > MAX_PIXELS_NA_IMPRESSAO) return Promise.resolve(null);
  const vez = orcamento.fila.then(async () => {
    if (orcamento.gastoMs >= orcamento.limiteMs) return PENDENTE;
    const inicio = performance.now();
    try {
      return await calcular(bytes);
    } finally {
      orcamento.gastoMs += performance.now() - inicio;
    }
  });
  orcamento.fila = vez.catch(() => undefined);
  return vez;
}
