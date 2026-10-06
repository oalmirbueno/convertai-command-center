/** Contrato compartilhado: Agenda → Estúdio. Não classifica pelo tema nem gera mídia. */
export const ESTILOS_DE_VIDEO_DA_PAUTA = [
  { id: "produto", nome: "Produto elegante", texto: "Apresente o produto das fotos com movimento de câmera suave, iluminação de estúdio e acabamento realista. Preserve o produto e seus materiais." },
  { id: "imovel", nome: "Apresentação de imóvel", texto: "Apresente este imóvel a partir das fotos reais. Travelling suave, luz natural e proporções fiéis. Não invente cômodos, móveis ou características." },
  { id: "jardim", nome: "Jardim: antes e depois", texto: "Mostre a transformação do jardim, do quadro inicial antes ao quadro final depois. Câmera estável, mesmo ponto de vista, resultado fiel às fotos." },
  { id: "moveis", nome: "Móveis: antes e depois", texto: "Mostre a transformação dos móveis e do ambiente do quadro inicial ao final, preservando medidas, texturas e acabamento das referências." },
  { id: "materiais", nome: "Mármore e sob medida", texto: "Apresente os detalhes reais de acabamento, veios e materiais das fotos, com câmera lenta, luz lateral e aparência elegante." },
] as const;
export type EstiloDeVideoDaPauta = typeof ESTILOS_DE_VIDEO_DA_PAUTA[number]["id"];
export interface DirecaoDeVideoDaPauta { estilo: EstiloDeVideoDaPauta; prompt: string; referencias: string[]; narracao: string; formato: "4:5" | "9:16" | "16:9" | "1:1" }
export function normalizarVideoDaPauta(v: unknown): DirecaoDeVideoDaPauta {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const estilo = ESTILOS_DE_VIDEO_DA_PAUTA.find((e) => e.id === o.estilo) || ESTILOS_DE_VIDEO_DA_PAUTA[0];
  return { estilo: estilo.id, prompt: typeof o.prompt === "string" && o.prompt.trim() ? o.prompt.trim().slice(0, 3000) : estilo.texto,
    referencias: Array.isArray(o.referencias) ? o.referencias.filter((r): r is string => typeof r === "string" && !!r.trim()).slice(0, 10) : [],
    narracao: typeof o.narracao === "string" ? o.narracao.slice(0, 1500) : "",
    formato: ["4:5", "9:16", "16:9", "1:1"].includes(String(o.formato)) ? o.formato as DirecaoDeVideoDaPauta["formato"] : "9:16" };
}
export const ESQUEMA_VIDEO_DA_PAUTA = { type: ["object", "null"], additionalProperties: false, properties: {
  estilo: { type: "string", enum: ESTILOS_DE_VIDEO_DA_PAUTA.map((e) => e.id) }, prompt: { type: "string" },
  referencias: { type: "array", items: { type: "string" } }, narracao: { type: "string" }, formato: { type: "string", enum: ["4:5", "9:16", "16:9", "1:1"] },
}, required: ["estilo", "prompt", "referencias", "narracao", "formato"] };
export const ORIENTACAO_VIDEO_DA_PAUTA = `Vídeo rápido (formato video) é geração a partir de fotos reais no próprio Estúdio, sem Motion ou edição de vídeo. Nunca converta vídeo pedido em carrossel. Preencha video: estilo (${ESTILOS_DE_VIDEO_DA_PAUTA.map((e) => `${e.id} = ${e.nome}`).join("; ")}), prompt com a direção concreta, referencias com IDs reais fornecidos pelo Workspace/acervo (não invente IDs), narracao (texto exato, ou vazio) e formato. Antes/depois usa duas referências em ordem: antes, depois. Foto tem formato foto e direção foto; vídeo tem formato video e direção video. Nos outros formatos video é null. Não afirme ter escolhido arquivos quando não há referências verificadas.`;
