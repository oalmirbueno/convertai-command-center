/** Curadoria própria a partir do guia VK Metrics consultado em 06/10/2026.
 * Referência de mecanismo (E0), não evidência de conversão. Sem copiar os vídeos. */
export const FONTE_FORMATOS_VIDEO = "https://creative-formats-vault.lovable.app/";
export const FORMATOS_VIDEO_ADS = [
  { id: "narrado", nome: "Demonstração narrada", conceito: "demonstracao", estrutura: "Abra com a situação do comprador; mostre um detalhe do serviço ou produto; conclua com um convite simples.", requisito: "Use imagens coerentes com o serviço e narração curta em português brasileiro." },
  { id: "passos", nome: "Passo a passo", conceito: "bastidores", estrutura: "Mostre uma sequência curta de ações visíveis, do início ao acabamento. Uma ideia por etapa.", requisito: "Mostre apenas etapas tecnicamente corretas e sustentadas pelo briefing." },
  { id: "duvida", nome: "Pergunta e resposta", conceito: "objecao", estrutura: "Abra com uma dúvida real da copy. Mostre o detalhe que esclarece e indique como pedir orientação.", requisito: "Não invente uma pergunta recebida de um cliente; apresente como dúvida comum." },
  { id: "comparacao", nome: "Comparação de opções", conceito: "objecao", estrutura: "Compare duas opções pelo mesmo critério visível. Explique para qual situação cada opção faz sentido.", requisito: "Sem inferiorizar concorrentes nem inventar testes ou resultados." },
  { id: "pov", nome: "Ponto de vista do cliente", conceito: "lifestyle", estrutura: "Mostre a necessidade pelo olhar de quem contrata. Revele o próximo passo concreto com o produto ou serviço.", requisito: "Cena ilustrativa; não simular depoimento de cliente real." },
  { id: "bastidores", nome: "Bastidores do cuidado", conceito: "bastidores", estrutura: "Comece pelo detalhe que costuma passar despercebido. Revele processo, cuidado e acabamento.", requisito: "Não apresentar cena gerada como registro de uma obra ou atendimento real." },
  { id: "lista", nome: "Lista útil", conceito: "demonstracao", estrutura: "Organize poucas informações úteis para decidir ou pedir orçamento. Termine com uma ação fácil.", requisito: "Cada item deve vir da oferta ou do contexto confirmado." },
  { id: "cotidiano", nome: "Cena do cotidiano", conceito: "lifestyle", estrutura: "Uma situação reconhecível abre a cena; o produto ou serviço entra naturalmente; a solução fecha a história.", requisito: "Sem testemunhos fictícios ou promessas de resultado." },
  { id: "detalhe", nome: "Detalhe em destaque", conceito: "produto", estrutura: "Aproxime de uma característica concreta, revele o conjunto e mostre a utilidade.", requisito: "Preserve geometria, marca e material das referências." },
  { id: "convite", nome: "Oferta com convite", conceito: "oferta", estrutura: "Uma oferta, uma condição confirmada e um próximo passo. A imagem sustenta a mensagem.", requisito: "Não combinar descontos e preços de ofertas diferentes; sem escassez inventada." },
] as const;
export const formatoVideoAds = (id: string) => FORMATOS_VIDEO_ADS.find((f) => f.id === id) || FORMATOS_VIDEO_ADS[0];
export const CONHECIMENTO_FORMATOS_VIDEO_ADS = [
  "FORMATOS DE VÍDEO PARA TESTAR (curadoria E0 inspirada no guia VK Metrics; sem resultados de conversão auditados)",
  ...FORMATOS_VIDEO_ADS.map((f) => `${f.nome}: ${f.estrutura} ${f.requisito}`),
  "Adapte o mecanismo ao briefing, oferta, público, objeções e objetivo do plano. Priorize evidências da própria conta. Curtidas e formato popular não comprovam vendas. Todo roteiro, fala e CTA em português brasileiro. Não copiar rostos, depoimentos ou vídeos de terceiros. Compare custo por conversa qualificada/orçamento/venda após veiculação; nota da IA não é resultado comercial.",
].join("\n");
