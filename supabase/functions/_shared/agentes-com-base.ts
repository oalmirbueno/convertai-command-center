/**
 * Os agentes que têm BASE própria (17/10/2026, dono: "todos os que estão por
 * trás, como se fosse eles tendo uma base de aprendizado"). Módulo puro: o
 * painel (src/pages/BaseDosAgentes.tsx) e as funções leem a mesma lista.
 *
 * A chave segue "mesa.papel" e é a gravada em agente_base_fichas.agente
 * (CHECK ^[a-z]+\.[a-z_]+$). `tema` guia a pesquisa semanal na internet e a
 * leitura do que o dono manda: a ficha precisa servir a ESTE papel.
 * Foco comum (dono): arte e conteúdo que trazem venda para o cliente.
 */

export interface AgenteComBase {
  chave: string;
  nome: string;
  mesa: string;
  /** O que ele faz, em uma frase (vai para a tela e para o leitor das fontes). */
  papel: string;
  /** O assunto da pesquisa semanal e do filtro do que chega. */
  tema: string;
}

export const AGENTES_COM_BASE: AgenteComBase[] = [
  {
    chave: "estudio.diretor",
    nome: "Diretor de arte",
    mesa: "Estúdio",
    papel: "Decide a composição, a hierarquia, as cores e o texto de cada lâmina dos posts e carrosséis.",
    tema: "direção de arte, design e copy de posts e carrosséis de Instagram que geram venda, tendências visuais e formatos que estão viralizando",
  },
  {
    chave: "estudio.imagem",
    nome: "Gerador de imagem",
    mesa: "Estúdio",
    papel: "Escreve o pedido de imagem que o modelo gera (cena, luz, lente, estilo, tipografia na arte).",
    tema: "técnicas de prompt para gerar imagem publicitária com IA (gpt-image, Midjourney, Flux): fotografia de produto, luz, lente, estilo, texto dentro da imagem e consistência de série",
  },
  {
    chave: "mes.estrategista",
    nome: "Agente do Mês",
    mesa: "Mesa do cliente",
    papel: "Planeja o mês de conteúdo: temas, ganchos, formatos, datas, campanhas e hypes.",
    tema: "estratégia de conteúdo e calendário editorial para Instagram e TikTok que vende: ganchos, formatos em alta, frequência, funil e campanhas sazonais",
  },
  {
    chave: "contexto.agente",
    nome: "Motor de contexto",
    mesa: "Mesa do cliente",
    papel: "Monta o contexto do negócio: público, oferta, concorrência, referências e posicionamento.",
    tema: "pesquisa de mercado, análise de concorrência, posicionamento, proposta de valor e leitura de público para pequenas e médias empresas",
  },
  {
    chave: "ads.estatico",
    nome: "Criativo estático",
    mesa: "Mesa Ads",
    papel: "Cria os anúncios em imagem: ângulo, promessa, copy, oferta e arte do criativo.",
    tema: "criativos estáticos de anúncio para Meta Ads que convertem: ângulos, hooks visuais, copy de resposta direta, prova social e oferta",
  },
  {
    chave: "ads.video",
    nome: "Criativo em vídeo",
    mesa: "Mesa Ads",
    papel: "O gancho dos 3 primeiros segundos, o roteiro e a fala dos anúncios em vídeo (nascem no plano e nas copies da Mesa Ads).",
    tema: "criativos em vídeo para Meta Ads e TikTok Ads que convertem: ganchos, UGC, formatos que performam, estrutura de roteiro curto e chamada para ação",
  },
  {
    chave: "ads.gestor",
    nome: "Gestor de Ads",
    mesa: "Mesa Ads",
    papel: "Planeja e otimiza as campanhas: estrutura, público, verba, testes e leitura dos números.",
    tema: "gestão de tráfego pago em Meta Ads e Google Ads: estrutura de campanha, Advantage+, públicos, testes criativos, orçamento, otimização e diagnóstico de queda",
  },
  {
    chave: "videos.diretor",
    nome: "Diretor de vídeo",
    mesa: "Mesa Vídeos",
    papel: "Dirige os vídeos e Reels: gancho, roteiro de cenas, ritmo, edição, legenda e som.",
    tema: "Reels e vídeos curtos que viralizam e vendem: ganchos, retenção, ritmo de edição, legendas, trilha e tendências de formato",
  },
  {
    chave: "foto.diretor",
    nome: "Diretor de fotos",
    mesa: "Mesa Foto",
    papel: "Dirige as fotos de produto e de campanha geradas com IA: cena, luz, composição e estilo.",
    tema: "fotografia publicitária e de produto com IA: cenários, luz, composição, still, lifestyle e tendências estéticas que vendem",
  },
  {
    chave: "motion.agente",
    nome: "Motion",
    mesa: "Mesa Motion",
    papel: "Cria as animações e o motion design das peças: movimento, tipografia cinética e transições.",
    tema: "motion design para redes sociais e anúncios: tipografia cinética, transições, ritmo, animação de marca e tendências",
  },
  {
    chave: "roteiros.roteirista",
    nome: "Roteirista",
    mesa: "Mesa Roteiros",
    papel: "Escreve os roteiros de Reels, vídeos e anúncios: gancho, desenvolvimento e chamada.",
    tema: "roteiro de vídeo curto e de anúncio que vende: ganchos, storytelling, estruturas validadas, copy falada e chamada para ação",
  },
  // 17/10 (rodada 3): as mesas que ainda não liam base nenhuma.
  {
    chave: "publicidade.diretor",
    nome: "Diretor de publicidade",
    mesa: "Mesa Publicidade",
    papel: "Cria as campanhas publicitárias: a grande ideia, os títulos, as peças-chave e a direção de arte da campanha.",
    tema: "conceito criativo de campanha publicitária para marcas locais: grande ideia, títulos, peças-chave, direção de arte e campanhas premiadas recentes",
  },
  {
    chave: "identidade.diretor",
    nome: "Diretor de identidade",
    mesa: "Mesa Identidade",
    papel: "Cria a identidade visual da marca: conceito, logo, paleta, tipografia, sistema gráfico e aplicações.",
    tema: "identidade visual e branding para pequenas e médias empresas: logo, paleta, tipografia, sistema gráfico, aplicações e tendências de design de marca",
  },
  {
    chave: "site.agente",
    nome: "Agente do site",
    mesa: "Mesa Site",
    papel: "Planeja e escreve sites e landing pages: estrutura, copy, prova e design que convertem.",
    tema: "sites e landing pages que convertem para pequenos negócios: estrutura, copy, prova social, chamada, velocidade, SEO local e tendências de interface",
  },
  {
    chave: "proposta.redator",
    nome: "Redator de propostas",
    mesa: "Mesa Proposta",
    papel: "Escreve as propostas comerciais da agência: diagnóstico, solução, escopo, investimento e respostas às objeções.",
    tema: "propostas comerciais de agência de marketing que fecham: estrutura, diagnóstico, ancoragem de preço, prova, escopo, garantias e objeções",
  },
  // 20/10: a aba Stories da Mesa.
  {
    chave: "stories.roteirista",
    nome: "Roteirista de Stories",
    mesa: "Mesa do cliente",
    papel: "Escreve a sequência de stories do dia como capítulo de novela: gancho, interação com adesivo, prova, convite e gancho para amanhã.",
    tema: "stories do Instagram que prendem e vendem: sequências em formato de novela, ganchos, adesivos de interação (enquete, caixinha, quiz, link, contagem), stories virais e destaques",
  },
];

export const CHAVES_COM_BASE = AGENTES_COM_BASE.map((a) => a.chave);

export function agenteComBase(chave: string): AgenteComBase | null {
  return AGENTES_COM_BASE.find((a) => a.chave === chave) ?? null;
}

/**
 * 23/10: a Biblioteca da casa (documentos da agência carregados em todos os
 * agentes, seed da migration 20261023110000). A ficha da casa se reconhece pelo
 * fonte_url "biblioteca:<versão>/<agente>/<slug>": na geração entram só as mais
 * relevantes (MAX_DA_CASA), na tela ela aparece marcada e pode ser desligada por agente.
 */
export const PREFIXO_DA_CASA = "biblioteca:";

export function ehDaCasa(fonteUrl: string | null | undefined): boolean {
  return typeof fonteUrl === "string" && fonteUrl.indexOf(PREFIXO_DA_CASA) === 0;
}
