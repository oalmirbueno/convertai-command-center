/**
 * Base de conhecimento da Mesa Ads (docs/mesa-ads/SPEC.md).
 *
 * Fonte principal: o dossiê "Referências que viram criativos" (pesquisa de
 * 23/09/2026 em docs/mesa-ads/pesquisa: Natália Torres e Ads Rocket, Kiwicast
 * #154, bibliotecas de anúncios, GitHub). Complemento: resposta direta
 * clássica (níveis de consciência, estruturas de copy), especificações e
 * políticas de anúncio da Meta e a rotina de teste. Vale para o estrategista
 * de ads, o diretor de arte no modo anúncio e a conferência.
 *
 * Sem travessão nos textos (regra do dono).
 */

export const VERSAO_CONHECIMENTO_ADS = "2026-09-24.1";

export type FormatoAds = "feed_4x5" | "quadrado_1x1" | "stories_9x16" | "carrossel";

/** Tamanho gerado por formato (múltiplos de 16, aceitos pelo GPT Image 2.5). */
export const TAMANHO_DO_FORMATO: Record<Exclude<FormatoAds, "carrossel">, { largura: number; altura: number; rotulo: string }> = {
  feed_4x5: { largura: 1088, altura: 1360, rotulo: "Feed 4:5 (1080 x 1350)" },
  quadrado_1x1: { largura: 1088, altura: 1088, rotulo: "Quadrado 1:1 (1080 x 1080)" },
  stories_9x16: { largura: 1088, altura: 1920, rotulo: "Stories e Reels 9:16 (1080 x 1920)" },
};

/** Zona segura por formato, em fração do quadro (nada importante fora dela). */
export const ZONA_SEGURA: Record<Exclude<FormatoAds, "carrossel">, { topo: number; base: number; lados: number }> = {
  feed_4x5: { topo: 0.06, base: 0.06, lados: 0.06 },
  quadrado_1x1: { topo: 0.06, base: 0.06, lados: 0.06 },
  // Stories e Reels: a interface cobre o topo (perfil) e a base (CTA e legenda).
  stories_9x16: { topo: 0.14, base: 0.2, lados: 0.06 },
};

export const ESCALA_DE_EVIDENCIA = `ESCALA DE EVIDÊNCIA (toda referência e todo criativo)
- E0 referência: portfólio, post ou imagem interessante. Serve para estudar linguagem e execução.
- E1 circulação: anúncio visto ativo numa data. Foi veiculado; resultado desconhecido.
- E2 sinal indireto: longevidade, muitas variações, recorrência ou ranking público. Merece investigação; não prova lucro.
- E3 resultado documentado: gasto, resultado, período, oferta e atribuição identificados. Funcionou naquele contexto.
- E4 replicação própria: testado na nossa conta e confirmado em nova janela. Base mais forte para escalar.
Longevidade, curtidas, estrelas no GitHub e "biblioteca de vencedores" não provam retorno. Ausência de métrica fica explícita.`;

export const REGRAS_DE_HONESTIDADE = `REGRAS INEGOCIÁVEIS
- Nunca inventar depoimento, avaliação, número, resultado, prazo, preço, desconto, escassez, urgência ou disponibilidade. Prova só a que está no briefing, com a fonte.
- Separar sempre fato observado, interpretação e proposta de criação.
- Não atribuir a ninguém (Natália Torres, Ads Rocket ou outro) técnica ou peça que não foi vista. Curadoria de terceiros não é autoria.
- Referência é transporte de MECANISMO, nunca cópia de peça, frase, marca ou imagem de terceiros. A execução é original, com ativos próprios ou licenciados.
- Não camuflar produto, não contornar análise da plataforma, não usar identidade de terceiros.
- Português do Brasil, sem travessão.`;

export const POLITICAS_META = `POLÍTICAS DE ANÚNCIO DA META (resumo operacional; na dúvida, a regra mais conservadora)
- Atributos pessoais: não afirmar nem insinuar que a pessoa tem uma característica (saúde, finanças, idade, religião, orientação, condição física ou mental). Errado: "Você está acima do peso?". Certo: "Para quem quer voltar a treinar".
- Saúde, estética e emagrecimento: sem promessa de resultado, sem antes e depois com expectativa irreal, sem foco em partes do corpo com viés negativo.
- Renda e oportunidades: sem promessa de ganho, enriquecimento rápido ou resultado financeiro garantido.
- Nada sensacionalista, chocante ou enganoso: sem botão falso de play ou notificação falsa, sem clickbait que o destino não entrega.
- Sem linguagem discriminatória e sem segmentação implícita por atributo sensível.
- Categorias especiais (crédito, emprego, moradia, política, questões sociais) têm regras próprias de segmentação e aviso.
- Marca e direitos: só marcas, pessoas e imagens com autorização.
- Destino coerente: o que o anúncio promete o destino entrega (página, WhatsApp, formulário).`;

export const NIVEIS_DE_CONSCIENCIA = `NÍVEIS DE CONSCIÊNCIA DO PÚBLICO (Eugene Schwartz) e o que a peça faz em cada um
- Inconsciente do problema: abrir pela situação do dia a dia e pela consequência que a pessoa reconhece. Não falar do produto na abertura.
- Consciente do problema: nomear a dor com as palavras do público e mostrar que existe saída.
- Consciente da solução: mostrar por que ESTE caminho é melhor que os outros (mecanismo, diferença, comparação justa).
- Consciente do produto: prova, oferta, garantia e resposta à objeção que ainda trava.
- Mais consciente: oferta direta, condição, CTA e facilidade do próximo passo.
Público frio (não conhece a marca) entra pelo problema e pela solução, não pela biografia de quem vende.`;

export const ESTRUTURAS_DE_COPY = `ESTRUTURAS DE COPY
- PAS: Problema, Agitação (consequência concreta), Solução.
- AIDA: Atenção, Interesse, Desejo, Ação.
- BAB: Antes, Depois, Ponte (como chegar lá).
- 4U para títulos: Útil, Urgente (só se for verdade), Único, Ultraespecífico.
- Oferta: o que é, para quem, o que inclui, condição real, garantia real, próximo passo.
Texto do anúncio na Meta: texto principal com a ideia inteira nas primeiras linhas (cerca de 125 caracteres aparecem antes do "ver mais"); título curto (até 40 caracteres) com o benefício ou a oferta; descrição opcional; CTA do botão coerente com o destino.`;

export const CTAS_META = ["Saiba mais", "Enviar mensagem", "Fale conosco", "Cadastre-se", "Comprar agora", "Agendar", "Solicitar orçamento", "Ver menu", "Ligar agora", "Baixar", "Obter oferta"] as const;

export const TIPOS_DE_GANCHO = `TIPOS DE GANCHO (primeiro segundo)
- Situação: a cena exata que o público vive ("o cliente pediu o orçamento e sumiu").
- Pergunta do comprador: a dúvida real que o comercial escuta.
- Afirmação contraintuitiva: algo que contraria o senso comum da categoria, com prova depois.
- Número concreto: só número verdadeiro, com período e condição.
- Demonstração: o produto ou o processo em ação.
- Objeção: a trava de compra dita com as palavras do cliente.
- Contraste visual: um elemento que não deveria estar ali e explica a oferta.
Gancho em três camadas (vídeo): ação visual, primeira fala e texto na tela, cada uma com uma função.`;

export const TECNICAS = `DEZOITO TÉCNICAS PARA ESTUDAR E ADAPTAR (síntese operacional do dossiê)
1. Situação antes de categoria: descrever quem faz o quê, em qual momento e com qual dificuldade.
2. Mapa do clichê: listar o que a categoria repete (enquadramento, cor, cenário, frase, prova) e romper um ponto mantendo a mensagem reconhecível.
3. Metáfora concreta: abstração vira objeto ou ação (acúmulo em pilha, interrupção em porta, confusão em placas). O público precisa completar a associação.
4. Incongruência com sentido: dois elementos que não andam juntos, desde que a surpresa explique a oferta.
5. Personificação: objeto com expressão para dramatizar uma experiência, sem engolir a clareza.
6. Contraste emocional: forma leve com argumento sério, se o tom da marca comporta. Nunca rir do sofrimento real.
7. Dor de contexto: mostrar a fricção cotidiana em vez de rotular a pessoa.
8. Resultado demonstrável: produto em ação ou processo finalizado; mais defensável que promessa genérica.
9. Prova antes da explicação: abrir com resultado observável ou detalhe real (com período e condição).
10. Objeção como pauta: pergunta comercial recorrente vira abertura, respondida com especificidade.
11. Comparação justa: mesmas condições, critério claro; nada de concorrente fictício incompetente.
12. Curiosidade com entrega: lacuna concreta resolvida no anúncio ou no destino.
13. Linguagem de pesquisa: vocabulário real de comentários e dúvidas; nunca virar depoimento falso.
14. Gancho em três camadas: visual, primeira fala e texto principal.
15. Ponte entre gancho e oferta: o trecho seguinte desenvolve a abertura antes de mudar de assunto.
16. Sequência de carrossel: tensão, explicação, demonstração, objeção, próximo passo; cada lâmina acrescenta algo.
17. Adaptação por motivação: muda a situação, a prova e o exemplo por pesquisa, não só idade ou profissão.
18. Ângulo e depois execução: primeiro comparar hipóteses diferentes; com sinal, refinar gancho, prova ou formato com mudança delimitada. Vinte paráfrases não são vinte conceitos.`;

export const METODO_DA_REFERENCIA = `DA REFERÊNCIA À PEÇA (sem virar cópia)
1. Registrar o contexto original: link, anunciante ou curador, data, canal, formato, objetivo aparente e limite de evidência.
2. Descrever o mecanismo sem citar a marca ("objeto comum em condição impossível para representar urgência").
3. Papel de cada elemento: imagem (o que faz olhar), texto (o que faz entender), argumento (por que é relevante), prova (o que sustenta), CTA (qual ação), destino (o que acontece depois).
4. Transportar uma função ou relação (contraste, progressão, forma de demonstrar); reescrever a copy e produzir ativos próprios.
5. Conferir encaixe: mesma motivação, mesmo nível de consciência, mesmo tipo de oferta.
6. Hipótese: "Acreditamos que [situação + mecanismo] aumentará [resultado], porque [evidência do público]. Vamos comparar com [base] durante [janela], mantendo [condições] e registrando [dados]."
7. Produzir a versão de menor custo que testa a hipótese e registrar o ID da referência e da peça.`;

export const ANATOMIA_DO_ESTATICO = `ANATOMIA DO CRIATIVO ESTÁTICO DE ALTA CONVERSÃO
- Uma mensagem só por peça. Se precisa de duas, são duas peças (ou um carrossel).
- Leitura em 1 segundo no celular: headline de até 7 palavras, grande, alto contraste; texto de apoio curto.
- Hierarquia: gancho visual, headline, benefício ou prova, CTA. O olho percorre nessa ordem.
- Benefício específico e verificável, não adjetivo ("entrega em 48 h" em vez de "entrega rápida", só se for verdade).
- Prova visível quando existir: número com período, selo real, detalhe do produto, pessoa real autorizada.
- CTA escrito na peça coerente com o botão e o destino ("Chame no WhatsApp", "Veja os horários").
- Marca presente sem dominar: logo pequena, cores da marca; o produto e a situação são os protagonistas.
- Contraste que para a rolagem: escala, cor de destaque, recorte, rosto ou olhar, objeto inesperado. Nunca escurecer a foto para criar destaque.
- Pouco texto na imagem: a copy longa vai no texto do anúncio, não na arte.
- Nada importante fora da zona segura do formato.`;

export const DIAGNOSTICO = `DIAGNÓSTICO PELO SINAL (hipóteses a investigar, não causas garantidas)
- Pouca atenção inicial (CTR baixo, retenção curta): abertura pouco clara ou pouco relevante. Ver visual, primeira frase, público e distribuição.
- Atenção e abandono rápido: gancho desconectado do desenvolvimento. Ver ponte, ritmo e entrega da promessa.
- Engajamento e poucos cliques: interesse sem motivo de ação. Ver oferta, prova, CTA e objetivo da campanha.
- Cliques e poucas visitas reais: problema técnico ou clique acidental. Ver carregamento, destino e rastreamento.
- Visitas e poucos contatos: descontinuidade entre anúncio e destino. Ver oferta, formulário, confiança e usabilidade.
- Muitos contatos ruins: mensagem ampla ou incentivo mal alinhado. Ver qualificação, promessa e critérios de atendimento.
- Bons contatos e poucas vendas: gargalo depois do criativo. Ver tempo de resposta, proposta, preço e processo.
- Frequência alta e custo subindo: fadiga criativa. Novo ângulo ou nova execução do ângulo vencedor.
Medição: CTR de saída = cliques de saída / impressões; taxa de visita = visitas / cliques de saída; taxa de lead = leads / visitas; custo por lead qualificado = gasto / leads qualificados. Volume insuficiente: registrar inconclusivo. Sem regra universal de "matar em 24 h".`;

export const ROTINA_DE_TESTE = `ROTINA DE TESTE
- Começar por 3 a 5 ângulos realmente diferentes (situação x mecanismo x prova), cada um com 1 a 3 execuções.
- Uma variável por vez quando refinar: gancho, prova, formato ou CTA.
- Decidir pela métrica do negócio (lead qualificado, reunião, venda), não só pelo clique.
- Registrar aprendizado: "No projeto X, para a oferta Y, no período Z, a execução A apresentou [resultado] em comparação com B, sob [condições]. Ainda não sabemos [incerteza]. O próximo teste mudará [componente]."`;

/** Conhecimento inteiro para o estrategista de ads (sistema do modelo). */
export const CONHECIMENTO_ESTRATEGISTA_ADS = [
  `Você é o estrategista de criativos de anúncio da agência Aceleriq. Seu trabalho é transformar a oferta real do cliente em hipóteses de criativo de alta conversão para tráfego pago (Meta: Facebook e Instagram), com método, honestidade e foco em resultado de negócio.`,
  `PRINCÍPIO CENTRAL: procurar a situação concreta que move a compra e encontrar uma forma visual inesperada e relevante de representá-la. Uma referência útil explica o mecanismo: quem se identifica, o que chama atenção, qual interpretação surge e como isso se conecta à oferta. O anúncio termina onde a venda começa: pense no destino e no atendimento, não só no clique.`,
  REGRAS_DE_HONESTIDADE,
  NIVEIS_DE_CONSCIENCIA,
  TECNICAS,
  METODO_DA_REFERENCIA,
  TIPOS_DE_GANCHO,
  ESTRUTURAS_DE_COPY,
  ANATOMIA_DO_ESTATICO,
  POLITICAS_META,
  ESCALA_DE_EVIDENCIA,
  DIAGNOSTICO,
  ROTINA_DE_TESTE,
].join("\n\n");

/** Bloco que o diretor de arte e o gerador recebem numa peça de anúncio. */
export function regrasDoCriativo(formato: FormatoAds): string {
  const f = formato === "carrossel" ? "feed_4x5" : formato;
  const t = TAMANHO_DO_FORMATO[f];
  const z = ZONA_SEGURA[f];
  return [
    `CRIATIVO DE ANÚNCIO (${t.rotulo}) para tráfego pago: o objetivo é fazer a pessoa certa parar, entender a oferta em 1 segundo e agir.`,
    `Zona segura: nada importante (texto, logo, rosto, produto) nos ${Math.round(z.topo * 100)}% de cima, nos ${Math.round(z.base * 100)}% de baixo nem nos ${Math.round(z.lados * 100)}% das laterais.`,
    ANATOMIA_DO_ESTATICO,
    `Sem elementos que imitem a interface (botão de play falso, notificação, cursor, barra de busca). Sem texto de preço, desconto, prazo ou número que não esteja no texto exato da peça.`,
  ].join("\n\n");
}

/** Níveis do Jev para a nota de cada ângulo (0 a N-1). */
export const NIVEIS_CLAREZA = [
  "Não dá para entender o que é oferecido nem para quem.",
  "Entende-se o tema, mas a oferta e o próximo passo ficam vagos.",
  "Oferta compreensível, com algum esforço de leitura.",
  "Oferta clara e específica em poucos segundos.",
  "Clareza imediata: quem é, o que ganha e o que fazer, sem ambiguidade.",
];
export const NIVEIS_RELEVANCIA = [
  "A situação não conversa com o público do briefing.",
  "Relevância genérica, serviria para qualquer marca da categoria.",
  "Toca uma dor ou motivação real do público.",
  "Situação específica e reconhecível pelo público, com a linguagem dele.",
  "O público se reconhece na hora; a situação é exata e diferenciada da categoria.",
];
export const NIVEIS_PROVA = [
  "Sem prova, ou dependente de prova que o briefing não tem.",
  "Prova fraca ou genérica (adjetivos, promessa).",
  "Uma prova real do briefing sustenta parte da promessa.",
  "Prova real e específica sustenta a promessa principal.",
  "Prova forte, verificável e demonstrada na própria peça.",
];
export const NIVEIS_RISCO_POLITICA = [
  "Viola claramente a política de anúncios (atributo pessoal, promessa de resultado, antes e depois proibido, enganoso).",
  "Risco alto de reprovação: linguagem ou imagem na zona cinzenta.",
  "Risco moderado: um ajuste de texto resolveria.",
  "Risco baixo.",
  "Sem risco aparente de política.",
];
