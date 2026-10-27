/**
 * Núcleo criativo de Mesa Ads e Aceleriq de Bolso. Puro: não lê dados, não
 * escolhe provedor e não concede acesso. Cada adaptador fornece só seu contexto.
 * Síntese da pesquisa versionada em docs/conhecimento/natalia-torres.md e
 * docs/mesa-ads/pesquisa/, sem copiar peças ou tratar aparência como desempenho.
 */
export const METODO_CRIATIVO_DA_CAMPANHA = [
  "CAMPANHA ANTES DA ARTE",
  "Parta de uma necessidade concreta do público informado e de um benefício sustentado pela oferta. Ligue situação, benefício, motivo para acreditar e próximo passo; se faltar prova, não a invente.",
  "Escolha uma ideia central. A imagem interrompe com relevância, a headline explica por que olhar e o CTA conduz ao destino da campanha. Curiosidade precisa de resposta na oferta, não de clickbait desconectado.",
  "Procure o detalhe da situação que os anúncios óbvios da categoria ignoram. Crie um objeto protagonista, uma metáfora visual clara, um contraste inesperado ou uma demonstração pertinente. A imagem deve se entender em um olhar.",
  "Ousadia pode exagerar a escala ou a metáfora, nunca o resultado do produto. Não invente prova, depoimento, urgência, desconto, estatística ou transformação. Não atribua condição pessoal sensível a quem vê.",
  "A direção deve descrever o que aparece, o que acontece, enquadramento, luz, contraste, área para texto e a ligação com a oferta. Evite 'imagem impactante' sem uma cena concreta. Fundo preto, neon e 3D não são um estilo obrigatório; o contexto e a identidade da marca decidem.",
  "Antes de entregar, confira ligação imagem–oferta, entendimento imediato, especificidade, verdade dos argumentos e ação coerente. Revisão criativa não mede conversão: só resultados reais de campanha podem validar desempenho.",
].join("\n");

const ROTAS_VISUAIS = [
  ["metáfora visual", "cruze um objeto reconhecível da situação com uma ação inesperada que explique o benefício"],
  ["detalhe cotidiano", "aproxime um detalhe concreto do contexto do público, sem recorrer ao clichê da categoria"],
  ["escala inesperada", "mude a escala de um objeto ligado à oferta; a hipérbole é visual, não uma promessa de resultado"],
  ["demonstração", "mostre o produto ou o mecanismo em uso, somente com atributos e materiais confirmados"],
  ["contraste de contexto", "oponha organização e ruído, movimento e pausa ou excesso e foco, conforme a ideia da campanha"],
] as const;

/** Diversifica a ideia de cada execução, não só cor, fonte ou posição. */
export function rotasVisuaisParaOPrompt(quantidade: number, opcoes: { sobrio?: boolean; preservarPrimeira?: boolean } = {}): string {
  const total = Number.isFinite(quantidade) ? Math.max(1, Math.min(8, Math.floor(quantidade))) : 1;
  const rotas = opcoes.sobrio ? [ROTAS_VISUAIS[3], ROTAS_VISUAIS[1], ROTAS_VISUAIS[4]] : ROTAS_VISUAIS;
  return [
    "EXECUÇÕES VISUAIS DISTINTAS (aplique ao mesmo argumento; não copie uma peça de referência)",
    ...Array.from({ length: total }, (_, i) => {
      if (i === 0 && opcoes.preservarPrimeira) return "Variação 1: desenvolva o gancho e a direção já escolhidos; preserve as restrições da referência autorizada.";
      const [nome, instrucao] = rotas[(i - (opcoes.preservarPrimeira ? 1 : 0) + rotas.length) % rotas.length];
      return `Variação ${i + 1}: ${nome}; ${instrucao}.${i >= rotas.length ? " Use outro objeto ou outra situação, sem repetir a primeira execução." : ""}`;
    }),
    "Se uma rota exigir um fato ou material ausente, escolha outra que use os dados disponíveis. Mantenha o tom pedido. Não force surrealismo numa peça sóbria nem mude a oferta para acomodar a imagem.",
  ].join("\n");
}

/** Direção comum que chega à geração de imagem nos dois estúdios. */
export function direcaoCriativaParaImagem(opcoes: { formato: string; sobrio?: boolean; semTipografia?: boolean; fotoFixa?: boolean; referencia?: boolean }): string {
  return [
    "DIREÇÃO CRIATIVA DA CAMPANHA",
    "Uma ideia e um foco visual dominante. Faça a cena concreta da direção escolhida comunicar o argumento da campanha; não acrescente objetos aleatórios só para chamar atenção.",
    opcoes.fotoFixa
      ? "Foto real fixa: preserve pessoas, produto, cenário, luz, cores, escala e enquadramento da base autorizada. A força criativa vem da relação com o texto e da hierarquia tipográfica; não introduza uma metáfora, objeto ou encenação nova na foto."
      : opcoes.referencia
      ? "Aplique a direção criativa dentro do nível de fidelidade escolhido para a referência: a composição e o assunto seguem as instruções desse modo. Não imponha outra cena, metáfora ou escala onde a referência precisa ser preservada."
      : opcoes.sobrio
      ? "Tom sóbrio: contraste de escala, espaço e enquadramento, com naturalidade. Preserve a demonstração real do produto."
      : "Impacto com intenção: metáfora compreensível, escala inesperada ou detalhe cotidiano expressivo. Exagere a encenação visual, nunca a eficácia, a transformação ou o resultado vendido.",
    opcoes.fotoFixa
      ? "Contraste pela cor e pelo peso das letras, sem alterar ou encobrir a foto. Preserve a identidade da marca e os detalhes do produto."
      : "Contraste pela composição, cor e iluminação. Preserve os detalhes do produto e a identidade da marca. Evite o acabamento genérico de banco de imagens; não imponha preto, neon, 3D ou uma estética alheia ao negócio.",
    opcoes.sobrio && (opcoes.fotoFixa || opcoes.referencia) ? "Tom sóbrio: preserve a naturalidade, o assunto autorizado e o estilo escolhido; sem efeitos exagerados." : "",
    opcoes.semTipografia
      ? "Componha uma imagem-base completa sem tipografia, letras, selos ou números. Não tente resumir ou substituir o texto da campanha dentro da imagem."
      : "Use apenas os textos exatos autorizados: headline dominante, CTA legível e respiro. Não reescreva, abrevie, complete ou acrescente preço e promessa. Não transforme o corpo da legenda em um bloco na imagem.",
    opcoes.formato === "stories_9x16"
      ? "Formato vertical: mantenha texto e conteúdo essencial no miolo, fora dos 14% superiores, 20% inferiores e 6% laterais; adapte a composição, sem cortar o protagonista."
      : "Mantenha texto e elementos essenciais afastados das bordas, com respiro; adapte a composição ao formato sem cortar o protagonista.",
    "A metáfora não é prova: não simule depoimento, captura de resultado ou transformação corporal. Preserve a foto e a identidade de uma pessoa real somente quando uma referência autorizada for fornecida; sem ela, não invente uma identidade reconhecível. Nunca atribua endosso ou depoimento à pessoa pela simples presença na imagem. A arte precisa combinar com a oferta e continuar clara no celular.",
  ].filter(Boolean).join("\n");
}

/** Versões antigas longas continuam utilizáveis como imagem-base, sem cortar copy. */
export const LIMITES_TEXTO_NA_ARTE = { mensagem: 80, cta: 50 } as const;

export function textosExatosParaArte(versao: { mensagem?: string; cta?: string } | null): { headline: string; cta: string } | null {
  const headline = typeof versao?.mensagem === "string" ? versao.mensagem.trim() : "";
  const cta = typeof versao?.cta === "string" ? versao.cta.trim() : "";
  if (!headline || headline.length > LIMITES_TEXTO_NA_ARTE.mensagem || cta.length > LIMITES_TEXTO_NA_ARTE.cta) return null;
  return { headline, cta };
}
