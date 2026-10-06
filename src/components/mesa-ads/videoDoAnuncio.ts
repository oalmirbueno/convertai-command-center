import type { CriativoAds } from "./adsApi";
import type { ArquivoDeVideo, PedidoDeVideo } from "../mesa-videos/videosApi";

/** Different selling narratives, not cosmetic variants. No provider call on selection. */
export const CONCEITOS_DE_VIDEO_ADS = [
  { id: "produto", nome: "Produto em destaque", camera: "slow-zoom-in", texto: "Apresente o produto com um detalhe que chama atenção, revele sua utilidade e termine com uma composição limpa. Preserve material, proporções, embalagem e identidade das referências." },
  { id: "demonstracao", nome: "Demonstração de uso", camera: "tracking", texto: "Mostre uma ação concreta de uso, o funcionamento e o benefício observável. O produto deve aparecer em uso realista, com começo, meio e conclusão." },
  { id: "problema", nome: "Problema e solução", camera: "static-shot", texto: "Comece pela situação incômoda descrita na oferta e mostre como o produto ou serviço ajuda. Não invente resultados, estatísticas, depoimentos nem promessas." },
  { id: "bastidores", nome: "Bastidores e processo", camera: "side-tracking", texto: "Mostre cuidado, materiais e etapas reais do serviço ou fabricação. Valorize os detalhes que sustentam a confiança na oferta, sem inventar instalações ou certificações." },
  { id: "lifestyle", nome: "Produto no cotidiano", camera: "handheld", texto: "Insira o produto em uma situação cotidiana coerente com o público e contexto da marca. Linguagem natural brasileira, movimento discreto, sem depoimento fictício." },
  { id: "objecao", nome: "Resposta a uma dúvida", camera: "rack-focus", texto: "Transforme uma dúvida ou objeção já descrita na copy em demonstração visual. Mostre o detalhe que responde à dúvida, sem prometer o que as fontes não sustentam." },
  { id: "oferta", nome: "Oferta e convite", camera: "dolly-in", texto: "Apresente o benefício principal com clareza, destaque a condição confirmada e conclua com um convite coerente com a chamada para ação. Nunca invente preço, desconto ou escassez." },
  { id: "ambiente", nome: "Apresentação de ambiente", camera: "slider-right", texto: "Apresente o ambiente real das referências em um percurso elegante, começando pelo plano geral e chegando aos detalhes. Preserve geometria, materiais e contexto do negócio." },
] as const;

export function conceitoDeVideo(id: string) {
  return CONCEITOS_DE_VIDEO_ADS.find((c) => c.id === id) || CONCEITOS_DE_VIDEO_ADS[0];
}

export function direcaoDoVideoAds(criativo: CriativoAds, marca: string, conceitoId: string): string {
  const conceito = conceitoDeVideo(conceitoId);
  return [
    `Filme publicitário para ${marca}. Conceito: ${conceito.nome}.`,
    `Criativo de origem: ${criativo.nome || criativo.copy.titulo || "Anúncio"}.`,
    criativo.copy.angulo_de_venda && `Ângulo de venda: ${criativo.copy.angulo_de_venda}.`,
    criativo.copy.texto_principal && `Mensagem confirmada: ${criativo.copy.texto_principal}`,
    criativo.copy.descricao && `Contexto: ${criativo.copy.descricao}`,
    criativo.copy.cta_meta && `Convite final: ${criativo.copy.cta_meta}.`,
    conceito.texto,
    "Gancho visual no começo, demonstração no meio e respiro no final. Qualidade publicitária, luz natural, texturas realistas e movimento controlado. Use apenas a oferta e as referências fornecidas. Não acrescente preços, números, marcas, legendas ou textos na imagem. Sem garantias de resultados comerciais.",
  ].filter(Boolean).join("\n");
}

/** Persisted server link: results cannot leak from another creative/client. */
export function resultadosDoVideoAds(clientId: string, criativoId: string, arquivos: ArquivoDeVideo[], pedidos: PedidoDeVideo[]): ArquivoDeVideo[] {
  const ids = new Set(pedidos.filter((p) => p.client_id === clientId && p.parametros.ads_criativo_id === criativoId).map((p) => p.id));
  return arquivos.filter((a) => a.client_id === clientId && a.estado !== "arquivado" && !!a.pedido_id && ids.has(a.pedido_id) && (a.mime || "").startsWith("video/"))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
