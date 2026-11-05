/**
 * GIF da lâmina (05/11/2026; dono: "se eu quiser animar ou fazer um GIF na arte para chamar mais atenção").
 *
 * Testado de verdade no OpenRouter em 05/11, GPT Image 2.6 com output_format "gif":
 * - sem imagem de base: GIF real de 9 quadros e 1,8 s (o gerador monta uma folha 3x3), texto com acento correto;
 * - com imagem de base: 512 é recusado e 832, 768x960 e 1024 devolvem PNG de um quadro, cobrado. Por isso NÃO se manda a arte;
 * - 1024x1024 sem base: erro 400, a folha de 3072x3072 passa do limite de pixels. Testados: 512x512, 640x800, 576x1024.
 *
 * O GIF é uma peça nova feita com o texto e a direção da lâmina, parecida com a arte, não a mesma. A lâmina não muda.
 * Custo medido na qualidade baixa: de US$ 0,034 a 0,044.
 */
export const MODELO_DO_GIF = "openrouter:openai/gpt-image-2.6-sunburst";

/** O maior valor medido nos testes; o custo real vem do provedor. */
export const CUSTO_ESTIMADO_DO_GIF_USD = 0.05;

/** Tamanho de cada quadro pela proporção da lâmina (a folha de 3x3 precisa caber no limite do gerador). */
export function tamanhoDoGif(tamanhoDaLamina: string): string {
  const [l, a] = String(tamanhoDaLamina).split("x").map(Number);
  const razao = l > 0 && a > 0 ? a / l : 1.25;
  if (razao >= 1.5) return "576x1024";
  if (razao > 1.1) return "640x800";
  if (razao < 0.75) return "1024x576";
  if (razao < 0.9) return "800x640";
  return "640x640";
}

/** Quantos GIFs ficam guardados por trabalho, os mais novos. */
export const MAX_GIFS_POR_TRABALHO = 12;

export type GifDaLamina = {
  ordem: number;
  versao: number | null;
  storage_path: string;
  quadros: number;
  movimento: string | null;
  custo_usd: number;
  criado_em: string;
};

const MOVIMENTO_PADRAO = "uma luz passa pelo título e o fundo respira devagar";

/** O pedido ao gerador, com o que a lâmina já decidiu: o texto exato, a cena, a composição e as cores da marca. */
export function promptDoGif(d: { texto?: string | null; cena?: string | null; composicao?: string | null; conceito?: string | null; cores?: string | null; movimento?: string | null }): string {
  const linha = (rotulo: string, v?: string | null) => (String(v || "").trim() ? `${rotulo}: ${String(v).trim()}` : "");
  return [
    "GIF animado em loop perfeito para post de Instagram: o último quadro emenda no primeiro.",
    linha("Conceito", d.conceito),
    linha("Cena", d.cena),
    linha("Composição", d.composicao),
    linha("Cores da marca", d.cores),
    String(d.texto || "").trim() ? `Texto na peça, escrito exatamente assim, grande e nítido: "${String(d.texto).trim()}"` : "Sem texto na peça.",
    `Movimento: ${String(d.movimento || "").trim() || MOVIMENTO_PADRAO}.`,
    "O layout fica parado e só o movimento pedido muda. Todo texto continua idêntico e legível, letra por letra, em todos os quadros.",
  ].filter(Boolean).join("\n");
}

/** Quadros de um GIF pelos blocos do próprio arquivo; 0 quando os bytes não são um GIF. */
export function quadrosDoGif(b: Uint8Array): number {
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1));
  const pularSubblocos = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i += 1;
  };
  let quadros = 0;
  while (i < b.length) {
    const bloco = b[i];
    if (bloco === 0x3b) break;
    if (bloco === 0x21) {
      i += 2;
      pularSubblocos();
    } else if (bloco === 0x2c) {
      quadros += 1;
      const pacote = b[i + 9];
      i += 10;
      if (pacote & 0x80) i += 3 * (1 << ((pacote & 0x07) + 1));
      i += 1;
      pularSubblocos();
    } else {
      break;
    }
  }
  return quadros;
}
