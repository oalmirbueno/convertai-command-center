import type { Angulo, CriativoAds, PlanoAds } from "./adsApi";
import { formatoVideoAds } from "../../../supabase/functions/mesa-ads/modulos/formatos-video-ads";
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

export interface ContextoVideoAds { plano?: PlanoAds | null; angulo?: Angulo | null; formatoId?: string }
const curta = (v: string | undefined | null, n = 230) => v?.trim().slice(0, n);
export function direcaoDoVideoAds(criativo: CriativoAds, marca: string, conceitoId: string, contexto: ContextoVideoAds = {}): string {
  const conceito = conceitoDeVideo(conceitoId);
  const a = contexto.angulo;
  const formato = contexto.formatoId ? formatoVideoAds(contexto.formatoId) : null;
  return [
    `Filme publicitário para ${marca}. Conceito: ${conceito.nome}. Tudo em português brasileiro.`,
    `Criativo de origem: ${curta(criativo.copy.titulo || criativo.nome || "Anúncio", 100)}.`,
    criativo.copy.angulo_de_venda && `Ângulo de venda: ${criativo.copy.angulo_de_venda}.`,
    criativo.copy.texto_principal && `Mensagem confirmada: ${curta(criativo.copy.texto_principal, 420)}`,
    a?.objetivo && `Objetivo do plano: ${curta(a.objetivo, 120)}.`,
    a?.gancho_visual && `Gancho visual: ${curta(a.gancho_visual, 150)}.`,
    a?.gancho_verbal && `Gancho falado: ${curta(a.gancho_verbal, 130)}.`,
    a?.prova && `Prova informada no plano (não inventar): ${curta(a.prova, 160)}.`,
    a?.mecanismo && `Mecanismo: ${curta(a.mecanismo, 140)}.`,
    criativo.copy.cta_meta && `Convite final: ${criativo.copy.cta_meta}.`,
    formato ? `${formato.nome}: ${formato.estrutura} ${formato.requisito}` : conceito.texto,
    "Gancho no começo, demonstração no meio e convite no final. Luz natural, texturas realistas, movimento controlado. Uma oferta apenas. Não invente preço, desconto, depoimento ou resultado. Sem texto na imagem, sem legendas em inglês. Cena gerada não é prova de serviço real. Preserve as referências. Sem garantias de resultados comerciais.",
  ].filter(Boolean).join("\n");
}

export const ESTADOS_VIDEO_ADS = [
  { id: "sem_video", nome: "Para criar" }, { id: "gerando", nome: "Em geração" },
  { id: "gerado", nome: "Para revisar" }, { id: "erro", nome: "Verificar" },
] as const;
export type EstadoVideoAds = typeof ESTADOS_VIDEO_ADS[number]["id"];
export function resumoVideoAds(clientId: string, criativoId: string, arquivos: ArquivoDeVideo[], pedidos: PedidoDeVideo[]) {
  const vinculados = pedidos.filter((p) => p.client_id === clientId && p.parametros?.ads_criativo_id === criativoId).sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  const ultimo = vinculados[0];
  const videos = resultadosDoVideoAds(clientId, criativoId, arquivos, vinculados);
  const pendente = vinculados.some((p) => ["enviado", "gerando", "baixando"].includes(String(p.estado)));
  const estado: EstadoVideoAds = pendente ? "gerando" : String(ultimo?.estado) === "erro" ? "erro" : videos.length ? "gerado" : "sem_video";
  return { estado, nome: ESTADOS_VIDEO_ADS.find((s) => s.id === estado)!.nome, quantidade: videos.length, formato: String(ultimo?.parametros?.formato || "9:16"), video: videos[0] };
}

/** Nome da base sem carregar o formato de imagem para a lista de vídeos. */
export const nomeBaseVideo = (c: CriativoAds) => (c.copy.titulo || c.nome || "Anúncio").replace(/\s*[|·]\s*(feed_4x5|stories_9x16|quadrado_1x1)\s*$/i, "");

/** Persisted server link: results cannot leak from another creative/client. */
export function resultadosDoVideoAds(clientId: string, criativoId: string, arquivos: ArquivoDeVideo[], pedidos: PedidoDeVideo[]): ArquivoDeVideo[] {
  const ids = new Set(pedidos.filter((p) => p.client_id === clientId && p.parametros.ads_criativo_id === criativoId).map((p) => p.id));
  return arquivos.filter((a) => a.client_id === clientId && a.estado !== "arquivado" && !!a.pedido_id && ids.has(a.pedido_id) && (a.mime || "").startsWith("video/"))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
