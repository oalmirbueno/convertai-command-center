/**
 * Base "criativo que converte" da Mesa Ads (frente CR, pedido do dono em 27/09/2026):
 * "aumentar a inteligência do estúdio do criativo, a base por baixo, repositório,
 * estilos do que mais converte e sempre trazer os melhores; e a copy também".
 *
 * O que mora aqui (puro, só constantes e funções de texto, sem Deno e sem banco):
 * - FORMATOS_QUE_CONVERTEM: os formatos de anúncio que mais convertem para
 *   negócio local e prestador de serviço (problema e solução, antes e depois,
 *   prova social, oferta empilhada, comparação, demonstração, número no gancho,
 *   história do dono, foto nativa, lista, objeção e quebra, local e bairro,
 *   editorial, produto herói), cada um ligado aos ESTILOS_VISUAIS de
 *   conhecimento-ads.ts pelo id (texto, sem import, para não criar ciclo).
 * - REQUISITOS_DO_ESTILO: o que o estilo exige de verdade (depoimento
 *   autorizado, número real, transformação visível, itens da oferta). Sem o
 *   requisito no briefing, o estilo desce na ordem (nunca se inventa a prova).
 * - LAYOUT_QUE_CONVERTE, GANCHOS_DO_PRIMEIRO_SEGUNDO, SINAIS_DE_FADIGA,
 *   FRAMEWORKS_DE_COPY e TAMANHOS_DA_COPY: o método em português, resumido.
 * - CONHECIMENTO_CRIATIVO_QUE_CONVERTE: o bloco que entra no conhecimento do
 *   estrategista (CONHECIMENTO_ESTRATEGISTA_ADS).
 *
 * A ordem por resultado real (dados da conta e da carteira) é calculada em
 * mesa-ads/melhores-criativos.ts, que usa estas constantes.
 *
 * Fontes pesquisadas em 27/09/2026 (resumo com palavras nossas; nenhum texto
 * copiado; números de mercado ficam marcados como leitura de mercado, não
 * regra da Meta):
 * - Formatos estáticos que convertem (problema e solução, antes e depois,
 *   depoimento, comparação, ponto de vista do dono, oferta empilhada,
 *   advertorial): https://adrio.ai/blog/best-meta-ad-formats
 * - Negócio de serviço na Meta em 2026 (fala do dono sem vender nos primeiros
 *   segundos, carrossel de prova social, isca específica, oferta com cliente
 *   específico + problema nomeado + resultado concreto + âncora de prova; CTR
 *   de referência 0,8% a 2%; troca de criativo perto de frequência 3 em 7 dias):
 *   https://adlibrary.com/posts/meta-ads-for-service-based-business
 * - Zona segura unificada de Stories e Reels (março de 2026): topo 14%, base
 *   de 20% a 35% (o Reels cobre mais), laterais 6%; CTA no miolo; 4:5 para
 *   imagem e 9:16 para vertical: https://blog.adnabu.com/meta-ads/meta-safe-zones/
 *   e a página oficial https://www.facebook.com/business/help/980593475366490/
 * - Pouco texto na imagem entrega melhor (a regra dos 20% saiu, a orientação de
 *   texto curto ficou): https://leadenforce.com/blog/how-to-use-text-overlays-effectively-for-meta-ads
 * - Fadiga (queda de CTR de 15% a 20% contra a base de 7 dias, CPM subindo,
 *   frequência acima de 2,5 a 3,5 em público frio, "Creative Fatigue" na coluna
 *   de veiculação): https://www.tryatria.com/blog/meta-creative-fatigue-diagnose-and-fix-2026
 *   e https://adlibrary.com/posts/ad-fatigue
 * - Taxa de gancho (3 s / impressões): 25% é a base, 30% ou mais é bom:
 *   https://adlibrary.com/posts/hook-rate e https://skaler.app/blog/hook-rate-benchmarks-2026
 * - Clique para WhatsApp no Brasil (botão coerente com o destino, sem "Saiba
 *   mais" quando abre conversa; conversa qualifica e fecha):
 *   https://www.messagecentral.com/blog/click-to-whatsapp-ads-brasil
 * - Repositórios e skills (MIT, método resumido, sem texto copiado):
 *   https://github.com/coreyhaines31/marketingskills (skills ad-creative e
 *   copywriting: 3 a 5 ângulos, várias execuções por ângulo, escrever a mais e
 *   escolher, ancorar tudo em prova real, clareza vence esperteza, CTA com verbo
 *   e o que a pessoa ganha), https://github.com/AgriciDaniel/claude-ads
 *   (pontuação determinística com "sem dado" explícito em vez de palpite) e
 *   https://github.com/OpenClaudia/openclaudia-skills (facebook-ads, copywriting).
 * - Estruturas clássicas de resposta direta: PAS (popularizada por Dan
 *   Kennedy), AIDA (E. St. Elmo Lewis), 4U (Michael Masterson, AWAI), antes,
 *   depois e ponte (BAB) e gancho, história e oferta (Russell Brunson, DotCom
 *   Secrets).
 *
 * Regras da casa: sem travessão, sem número inventado (todo número da peça vem
 * do cliente), política da Meta, nunca escurecer foto, kit da marca manda.
 */

export const VERSAO_CONHECIMENTO_CRIATIVO = "2026-09-27.1";

// ------------------------------------------------------------------ formatos que convertem

/** O que um estilo exige de verdade para não virar promessa sem prova. */
export type RequisitoDoEstilo = "depoimento_autorizado" | "numero_real" | "transformacao_visivel" | "itens_da_oferta";

export const ROTULO_DO_REQUISITO: Record<RequisitoDoEstilo, string> = {
  depoimento_autorizado: "depoimento real e autorizado",
  numero_real: "número real (preço, prazo, anos, clientes, garantia)",
  transformacao_visivel: "transformação visível com foto real do trabalho",
  itens_da_oferta: "oferta com itens, bônus ou kit",
};

/** Requisitos por id de ESTILOS_VISUAIS (os demais estilos não exigem nada além do briefing). */
export const REQUISITOS_DO_ESTILO: Record<string, RequisitoDoEstilo[]> = {
  depoimento_citacao: ["depoimento_autorizado"],
  numero_em_destaque: ["numero_real"],
  antes_depois: ["transformacao_visivel"],
  pilha_de_oferta: ["itens_da_oferta"],
};

export type PublicoDoFormato = "frio" | "morno" | "quente" | "todos";

export type FormatoQueConverte = {
  id: string;
  nome: string;
  /** Ids de ESTILOS_VISUAIS (conhecimento-ads.ts) que executam o formato, do mais típico ao menos. */
  estilos: string[];
  quando: string;
  /** O que a peça faz no primeiro segundo (estático) ou nos 3 primeiros (vídeo). */
  gancho: string;
  /** Como montar a peça (composição e texto). */
  layout: string;
  /** Ids de OBJETIVOS_DE_CAMPANHA em que o formato costuma render. */
  objetivos: string[];
  publico: PublicoDoFormato;
};

export const FORMATOS_QUE_CONVERTEM: FormatoQueConverte[] = [
  {
    id: "problema_solucao",
    nome: "Problema e solução",
    estilos: ["objeto_inesperado", "metafora_visual", "tipografia_gigante"],
    quando: "Público frio que sente o incômodo e ainda não conhece a saída; serviço que resolve uma dor concreta do dia a dia.",
    gancho: "A situação ruim dita com as palavras do cliente (sem rotular a pessoa) ou mostrada num objeto fora do lugar.",
    layout: "Metade de cima a dor (imagem ou manchete), metade de baixo a saída com o produto ou o serviço e o CTA.",
    objetivos: ["mensagens", "leads", "agendamento", "vendas"],
    publico: "frio",
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    estilos: ["antes_depois"],
    quando: "Transformação visível e verificável fora de corpo e saúde (obra, limpeza, jardim, funilaria, organização, conserto).",
    gancho: "O contraste dos dois lados no mesmo ângulo e na mesma luz; o olho entende a mudança antes de ler.",
    layout: "Quadro dividido com rótulos grandes de antes e depois, foto real do cliente, CTA na faixa de baixo do lado do depois.",
    objetivos: ["mensagens", "leads", "agendamento", "vendas"],
    publico: "todos",
  },
  {
    id: "prova_social",
    nome: "Prova social (depoimento e avaliação)",
    estilos: ["depoimento_citacao", "numero_em_destaque"],
    quando: "Existe depoimento real, específico e autorizado, ou avaliação pública com fonte. Converte quem já considera.",
    gancho: "Um trecho específico do cliente real (o detalhe concreto, não o elogio genérico) em letra grande.",
    layout: "Aspas grandes na cor de destaque, trecho curto, nome ou iniciais com contexto, foto real do trabalho ao lado.",
    objetivos: ["mensagens", "leads", "agendamento", "vendas"],
    publico: "morno",
  },
  {
    id: "oferta_empilhada",
    nome: "Oferta empilhada",
    estilos: ["pilha_de_oferta", "oferta_direta"],
    quando: "Oferta com itens, bônus, kit ou garantia real para público morno ou quente pronto para decidir.",
    gancho: "A condição real e o item principal grandes; o resto empilhado mostra o quanto a pessoa leva.",
    layout: "Item principal maior, 3 a 5 itens com rótulo curto, selo da garantia ou da condição real, CTA em faixa sólida.",
    objetivos: ["vendas", "mensagens", "agendamento"],
    publico: "quente",
  },
  {
    id: "comparacao",
    nome: "Comparação com o jeito comum",
    estilos: ["comparacao_lado_a_lado", "nos_contra_eles"],
    quando: "O cliente compara opções (processo, material, prazo, o que está incluso) e a diferença é verdadeira e demonstrável.",
    gancho: "Dois lados com o mesmo enquadramento: o jeito comum neutro e o jeito do cliente na cor da marca.",
    layout: "Quadro dividido ou tabela de 3 a 5 linhas com check e x; critério claro; nunca nomear concorrente.",
    objetivos: ["mensagens", "leads", "vendas"],
    publico: "morno",
  },
  {
    id: "demonstracao",
    nome: "Demonstração e bastidor",
    estilos: ["demonstracao_etapas", "bastidor_real", "close_extremo"],
    quando: "O processo, o cuidado ou o detalhe provam a qualidade; o método ou a facilidade são a venda.",
    gancho: "Mãos trabalhando, o detalhe em macro ou o passo 1 de 3; algo acontecendo, não pose.",
    layout: "Três etapas numeradas grandes ou uma foto real de bastidor dominante; manchete curta sobre bloco de cor.",
    objetivos: ["mensagens", "leads", "agendamento", "vendas", "reconhecimento"],
    publico: "todos",
  },
  {
    id: "numero_no_gancho",
    nome: "Número no gancho",
    estilos: ["numero_em_destaque"],
    quando: "Há um número real e específico no briefing (anos, clientes atendidos, prazo, garantia, nota com fonte, preço).",
    gancho: "O número enorme na cor de destaque, lido antes de qualquer palavra.",
    layout: "Número em cerca de metade do quadro, rótulo do que significa, período ou fonte legível, foto real no canto.",
    objetivos: ["mensagens", "leads", "vendas", "agendamento"],
    publico: "todos",
  },
  {
    id: "historia_do_dono",
    nome: "História do dono",
    estilos: ["rosto_e_olhar", "bastidor_real"],
    quando: "Serviço de confiança em que quem faz importa. Para prestador de serviço costuma ser o primeiro vencedor com público frio.",
    gancho: "O rosto real e autorizado do dono ou da equipe com uma frase de ponto de vista sobre o problema do cliente, sem vender no começo.",
    layout: "Close médio do rosto olhando para a manchete, frase curta de opinião, prova ou credencial pequena, CTA de conversa.",
    objetivos: ["mensagens", "agendamento", "leads", "reconhecimento"],
    publico: "frio",
  },
  {
    id: "foto_nativa",
    nome: "Foto nativa de celular",
    estilos: ["ugc_nativo"],
    quando: "Público frio que pula o que tem cara de anúncio; cliente ou equipe reais usando o produto ou o serviço.",
    gancho: "Parece post de gente, não propaganda: luz natural, ambiente real, legenda curta no terço de cima.",
    layout: "Foto real com enquadramento de celular e faixa de legenda nativa; sem imitar botão, interface ou perfil de terceiros.",
    objetivos: ["mensagens", "vendas", "leads", "seguidores"],
    publico: "frio",
  },
  {
    id: "lista",
    nome: "Lista e checklist",
    estilos: ["lista_checklist"],
    quando: "Oferta com várias partes, motivos para escolher, erros comuns ou sinais de que é hora do serviço.",
    gancho: "Título com a promessa da lista; o primeiro item já entrega algo útil.",
    layout: "3 a 5 itens curtos com checks grandes, alinhados à esquerda; foto real num terço do quadro.",
    objetivos: ["leads", "mensagens", "seguidores"],
    publico: "morno",
  },
  {
    id: "objecao_e_quebra",
    nome: "Objeção e quebra",
    estilos: ["objecao_na_manchete"],
    quando: "Existe uma trava de compra que o comercial ouve toda semana (preço, prazo, confiança, se serve para o caso).",
    gancho: "A pergunta do comprador entre aspas no topo, a resposta direta e específica logo abaixo.",
    layout: "Pergunta grande, resposta na cor de destaque, prova real ou foto do serviço ao lado, CTA de conversa.",
    objetivos: ["mensagens", "agendamento", "leads", "vendas"],
    publico: "morno",
  },
  {
    id: "local_e_bairro",
    nome: "Local e bairro",
    estilos: ["local_e_bairro"],
    quando: "Negócio que atende uma região: a proximidade e o atendimento no dia são a vantagem.",
    gancho: "O nome da cidade ou do bairro atendido e um elemento que o morador reconhece.",
    layout: "Mapa estilizado com pino na cor da marca ou fachada real, manchete com a região e o benefício, CTA de conversa.",
    objetivos: ["mensagens", "agendamento", "vendas", "reconhecimento"],
    publico: "frio",
  },
  {
    id: "editorial",
    nome: "Manchete editorial",
    estilos: ["editorial_manchete"],
    quando: "Informação nova ou mecanismo que precisa ser entendido antes da compra (guia, mudança de regra, dado com fonte).",
    gancho: "Manchete de revista própria com a novidade; a curiosidade tem entrega no próprio anúncio ou no destino.",
    layout: "Manchete serifada grande, linha fina, foto real forte em metade do quadro, 2 ou 3 pontos curtos; nunca imitar veículo real.",
    objetivos: ["leads", "trafego", "mensagens"],
    publico: "morno",
  },
  {
    id: "produto_heroi",
    nome: "Produto herói",
    estilos: ["produto_heroi_cor", "oferta_direta"],
    quando: "Produto físico com foto boa: loja, lançamento, item mais vendido, reposição.",
    gancho: "O produto grande e recortado sobre cor chapada que contrasta com ele.",
    layout: "Produto em 50% a 70% do quadro, ângulo heroico, um ou dois selos de benefício real e CTA de compra.",
    objetivos: ["vendas", "mensagens"],
    publico: "quente",
  },
];

/** Formato que usa o estilo (o primeiro em que ele aparece como típico). */
export function formatoDoEstilo(estiloId: string | null | undefined): FormatoQueConverte | null {
  if (!estiloId) return null;
  return FORMATOS_QUE_CONVERTEM.find((f) => f.estilos[0] === estiloId) ?? FORMATOS_QUE_CONVERTEM.find((f) => f.estilos.includes(estiloId)) ?? null;
}

// ------------------------------------------------------------------ layout, ganchos e fadiga

/**
 * Formatos de peça que a Mesa produz sem pedir nada: 4:5 no feed e 9:16 em
 * Stories e Reels cobrem quase toda a entrega (a Meta passou a recomendar 4:5
 * para imagem e 9:16 para vertical em março de 2026). Carrossel quando o
 * ângulo pediu (sequência que explica melhor).
 */
export const FORMATOS_PADRAO = ["feed_4x5", "stories_9x16"] as const;

export const LAYOUT_QUE_CONVERTE = `LAYOUT QUE CONVERTE (por formato)
- Feed 4:5 (1080 x 1350): o formato que mais ocupa a tela no celular. Margem de cerca de 6% em volta; manchete no terço de cima, elemento dominante no centro, CTA escrito no terço de baixo.
- Quadrado 1:1 (1080 x 1080): para carrossel e posicionamentos de loja; mesma hierarquia, menos texto ainda.
- Stories e Reels 9:16 (1080 x 1920): zona segura única desde março de 2026. Nada importante nos 14% de cima (perfil), nos 20% de baixo em Stories e até 35% de baixo em Reels (legenda e botões), nem nos 6% das laterais. Manchete e CTA ficam no miolo, entre cerca de 15% e 65% da altura.
- Densidade: uma manchete (até 7 palavras) e no máximo uma linha de apoio. O texto ocupa pouco da arte; a copy longa vai no texto do anúncio. Pouco texto na imagem entrega melhor e mais barato.
- Contraste: manchete legível na miniatura do feed; bloco de cor sólida, recorte ou área limpa da foto atrás do texto. Nunca véu escuro, gradiente preto ou foto apagada.
- CTA: o verbo do próximo passo coerente com o botão e o destino ("Chame no WhatsApp", "Veja os horários"). No WhatsApp o botão é de mensagem, nunca "Saiba mais".
- Marca: logo pequena num canto dentro da margem, cores da marca; o produto, a situação e a oferta são os protagonistas.`;

export const GANCHOS_DO_PRIMEIRO_SEGUNDO = `GANCHO DO PRIMEIRO SEGUNDO (no estático) E DOS 3 PRIMEIROS SEGUNDOS (no vídeo)
- A Meta decide cedo se a peça merece entrega: o que prende no começo pesa mais que o resto. Leitura de mercado: taxa de gancho (visualizações de 3 s dividido por impressões) de 25% é a base; 30% ou mais é bom.
- Um gancho só por peça, forte e específico: situação reconhecível, pergunta do comprador, número real, contraste visual, objeção, demonstração em ação ou ponto de vista do dono.
- O gancho verbal e o visual se completam: se a imagem mostra o produto, a frase diz o que a pessoa ganha; se a frase promete, a imagem prova.
- Vídeo: ação visual já no primeiro quadro, texto na tela nos 3 primeiros segundos e a primeira fala sem apresentar a empresa. Fala do dono: problema, custo escondido, uma ideia que mostra domínio, CTA leve.
- Proibido no gancho: pergunta sobre atributo pessoal, susto falso, imitar notificação ou botão, promessa que o destino não cumpre.`;

export const SINAIS_DE_FADIGA = `SINAIS DE FADIGA DO CRIATIVO (leitura de mercado 2026; a régua do cliente manda)
- Frequência: a partir de cerca de 2,5 por semana em público frio acende o alerta; acima de 3,5 costuma cansar. Remarketing aguenta mais.
- CTR de saída caindo 15% a 20% ou mais contra a base dos últimos 7 dias (ou vários dias seguidos caindo com a frequência subindo).
- CPM subindo 10% a 20% sem mudança de leilão e custo por resultado subindo sem mudança de público.
- Taxa de gancho caindo 20% ou mais, comentários negativos e "ocultar" subindo, ou a coluna de veiculação mostrando "Creative Limited" ou "Creative Fatigue".
- Resposta: primeiro uma execução nova do mesmo ângulo vencedor (outra imagem, outro estilo visual, outro gancho); ângulo novo quando a execução nova também cansar. Manter o antigo até o novo pegar e ter sempre 2 ou 3 criativos novos prontos por conjunto.`;

// ------------------------------------------------------------------ copy

export type FrameworkDeCopy = {
  id: string;
  nome: string;
  estrutura: string;
  quando: string;
};

/**
 * Estruturas de copy de resposta direta. Cada variação de um ângulo usa uma
 * estrutura diferente (o Jev escolhe a melhor entre elas; diversidade de
 * conceito, não paráfrase).
 */
export const FRAMEWORKS_DE_COPY: FrameworkDeCopy[] = [
  { id: "pas", nome: "Problema, agitação e solução", estrutura: "A dor com as palavras do público, a consequência concreta e proporcional de deixar como está, a solução e o CTA.", quando: "Público que sente a dor; serviço que resolve um incômodo." },
  { id: "aida", nome: "Atenção, interesse, desejo e ação", estrutura: "Gancho que para, o dado ou detalhe que prende, o benefício que a pessoa quer para si e o próximo passo.", quando: "Oferta clara para público que ainda não decidiu." },
  { id: "bab", nome: "Antes, depois e ponte", estrutura: "Como é hoje, como fica depois (sem prometer resultado de corpo, saúde ou renda) e o caminho que leva até lá.", quando: "Transformação visível; combina com antes e depois." },
  { id: "gancho_historia_oferta", nome: "Gancho, história e oferta", estrutura: "Uma frase que prende, uma situação típica e verdadeira do público ou do dono (sem inventar cliente) e a oferta com o CTA.", quando: "Público frio; história do dono; negócio local com rosto." },
  { id: "objecao_e_quebra", nome: "Objeção e quebra", estrutura: "A trava de compra dita como o cliente fala, a resposta específica que desmonta a trava, a prova real e o CTA.", quando: "Quem já considerou e travou em preço, prazo ou confiança." },
  { id: "prova_primeiro", nome: "Prova primeiro", estrutura: "Abre com a prova real (número com período, depoimento autorizado, detalhe verificável), explica o porquê e chama para a ação.", quando: "Há prova forte no briefing." },
  { id: "oferta_direta", nome: "Oferta direta", estrutura: "O que é, para quem, a condição real, a reversão de risco e o próximo passo, sem rodeio.", quando: "Público quente e remarketing; oferta forte." },
];

export const FRAMEWORKS_IDS: readonly string[] = FRAMEWORKS_DE_COPY.map((f) => f.id);

export const nomeDoFramework = (id: unknown) => FRAMEWORKS_DE_COPY.find((f) => f.id === id)?.nome ?? null;

export const TAMANHOS_DA_COPY = `TAMANHOS DA COPY NA META
- Texto principal: a ideia inteira nos primeiros cerca de 125 caracteres (o resto fica atrás do "ver mais"); no Reels aparece bem menos, então a primeira frase funciona sozinha.
- Título: até 40 caracteres (no feed do Facebook cerca de 27 aparecem inteiros); benefício ou oferta, nunca o nome da empresa.
- Descrição: até 30 caracteres; complementa o título (condição, garantia, prova curta) e não repete.
- Botão: um da lista da Meta coerente com o destino.`;

export const REGRAS_DA_COPY_QUE_CONVERTE = `COPY DE RESPOSTA DIRETA QUE CONVERTE
- 4U em cada título e primeira linha: útil, urgente só se for verdade, único e ultraespecífico.
- Especificidade vence adjetivo: o quê, quanto, quando e para quem, com o número real do briefing. Sem número real, detalhe concreto (onde, como, em quanto tempo) e nunca número inventado.
- Clareza vence esperteza: a pessoa entende a oferta sem pensar; verbo de ação, voz ativa, palavras do público (tiradas das dúvidas e comentários reais).
- Prova: só a que está no briefing ou na oferta, dita com fonte ou período. Depoimento só autorizado.
- Reversão de risco: a garantia, o orçamento sem compromisso, a avaliação ou o pagar depois, só se o cliente cumpre.
- Objeção: responder a trava mais comum com a resposta operacional verdadeira.
- CTA: verbo e o que a pessoa ganha, ligado ao destino ("Mande a foto no WhatsApp e receba o orçamento hoje", se for verdade).
- Nunca prometer o que o cliente não entrega; dentro da política da Meta (sem atributo pessoal, sem resultado garantido, sem urgência falsa).`;

// ------------------------------------------------------------------ bloco do estrategista

/** Formatos em texto corrido para o estrategista. */
export const FORMATOS_RESUMO = [
  "FORMATOS DE ANÚNCIO QUE MAIS CONVERTEM PARA NEGÓCIO LOCAL E PRESTADOR DE SERVIÇO (cada um com os ids de estilo visual que o executam; varie o formato entre os ângulos)",
  ...FORMATOS_QUE_CONVERTEM.map((f) => `- ${f.nome} (estilos ${f.estilos.join(", ")}; público ${f.publico}): ${f.quando} Gancho: ${f.gancho} Layout: ${f.layout}`),
  `Exigem prova real: ${Object.keys(REQUISITOS_DO_ESTILO).map((k) => `${k} precisa de ${REQUISITOS_DO_ESTILO[k].map((r) => ROTULO_DO_REQUISITO[r]).join(" e ")}`).join("; ")}. Sem isso no briefing, escolha outro formato.`,
].join("\n");

export const FRAMEWORKS_RESUMO = [
  "ESTRUTURAS DE COPY (use o id no campo framework; variações do mesmo ângulo usam estruturas diferentes)",
  ...FRAMEWORKS_DE_COPY.map((f) => `- ${f.id} (${f.nome}): ${f.estrutura} Quando: ${f.quando}`),
].join("\n");

/** Bloco inteiro que entra no conhecimento do estrategista de ads. */
export const CONHECIMENTO_CRIATIVO_QUE_CONVERTE = [
  FORMATOS_RESUMO,
  GANCHOS_DO_PRIMEIRO_SEGUNDO,
  LAYOUT_QUE_CONVERTE,
  REGRAS_DA_COPY_QUE_CONVERTE,
  FRAMEWORKS_RESUMO,
  TAMANHOS_DA_COPY,
  SINAIS_DE_FADIGA,
].join("\n\n");

/**
 * Blocos por ação (vão no pedido, não no sistema: o sistema do estrategista já
 * está no teto de 58 mil caracteres). Plano: formatos em versão curta e
 * ganchos. Copy: estruturas, regras e tamanhos, mais o layout. Pacote: regras
 * e tamanhos.
 */
export function formatosParaOPlano(): string {
  return [
    "FORMATOS QUE MAIS CONVERTEM PARA NEGÓCIO LOCAL E PRESTADOR DE SERVIÇO (base; a ordem por resultado vem abaixo)",
    ...FORMATOS_QUE_CONVERTEM.map((f) => `- ${f.nome} [${f.estilos.join(", ")}], público ${f.publico}: ${f.quando} Gancho: ${f.gancho}`),
    `Exigem prova real: ${Object.keys(REQUISITOS_DO_ESTILO).map((k) => `${k} (${REQUISITOS_DO_ESTILO[k].map((r) => ROTULO_DO_REQUISITO[r]).join(" e ")})`).join("; ")}.`,
    GANCHOS_DO_PRIMEIRO_SEGUNDO,
  ].join("\n");
}

export function copyQueConverteParaOPrompt(opcoes: { comLayout?: boolean } = {}): string {
  return [REGRAS_DA_COPY_QUE_CONVERTE, FRAMEWORKS_RESUMO, TAMANHOS_DA_COPY, opcoes.comLayout ? LAYOUT_QUE_CONVERTE : ""].filter(Boolean).join("\n\n");
}

/** O formato que converte do estilo, em duas linhas para o pedido da copy e da arte. */
export function formatoDoEstiloParaOPrompt(estiloId: string | null | undefined): string {
  const f = formatoDoEstilo(estiloId);
  return f ? `FORMATO DA PEÇA: ${f.nome}. Gancho: ${f.gancho} Layout: ${f.layout}` : "";
}
