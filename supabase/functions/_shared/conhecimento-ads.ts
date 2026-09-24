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
 * Versão 2 (24/09/2026, docs/mesa-ads/pesquisa/PESQUISA-V2.md): estilos
 * visuais de estático, níveis de parada, diferenciação e força da oferta para
 * o Jev, objetivos de campanha da Meta, nichos da agência, montagem de oferta,
 * criativo agressivo dentro da política, leitura de conta (era Andromeda) e
 * pacote de copy. Contrato: docs/mesa-ads/v2/CONTRATO-V2.md.
 *
 * Sem travessão nos textos (regra do dono).
 */

export const VERSAO_CONHECIMENTO_ADS = "2026-09-24.2";

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

// ═══════════════════════════════════════════════════════════════════════
// v2 (2026-09-24.2): estilos visuais, níveis novos do Jev, objetivos,
// nichos, oferta, agressivo, conta e pacote de copy.
// ═══════════════════════════════════════════════════════════════════════

/** Estilo visual de criativo estático (cada um com risco de política honesto). */
export type EstiloVisual = {
  id: string;
  nome: string;
  quando_usar: string;
  como_fazer: string;
  risco_politica: "baixo" | "medio" | "alto";
};

export const ESTILOS_VISUAIS: EstiloVisual[] = [
  {
    id: "oferta_direta",
    nome: "Oferta direta",
    quando_usar: "Público morno ou quente (já conhece a categoria ou a marca), oferta real e forte (condição, bônus, garantia) e objetivo de venda, mensagem ou agendamento.",
    como_fazer: "A oferta é a protagonista: manchete com a condição real em tipografia pesada ocupando a metade de cima, produto ou serviço recortado em escala grande, um selo na cor de destaque da marca com o elemento mais forte (bônus, garantia ou prazo real) e o CTA escrito. Fundo em cor chapada ou foto clara e nítida. Só preço, prazo e condição que estão no briefing.",
    risco_politica: "baixo",
  },
  {
    id: "tipografia_gigante",
    nome: "Manchete gigante",
    quando_usar: "Quando a ideia cabe em 3 a 6 palavras fortes: objeção, afirmação contraintuitiva, oferta simples ou quando não há foto boa.",
    como_fazer: "A frase é a imagem: letras enormes ocupando de 60% a 80% do quadro, uma palavra-chave em cor de destaque ou sublinhada, fundo chapado saturado da marca ou contraste máximo (preto no amarelo, branco no vermelho). Um elemento real pequeno (produto, mão, objeto) quebra a grade e dá profundidade. Nada de parágrafo na arte.",
    risco_politica: "baixo",
  },
  {
    id: "close_extremo",
    nome: "Close extremo",
    quando_usar: "Produto ou serviço cuja textura, acabamento ou detalhe prova qualidade (comida, tecido, peça, acabamento de obra, grama, costura, solda).",
    como_fazer: "Macro do detalhe preenchendo o quadro inteiro, foco cravado, luz lateral que revela a textura, cores vivas e naturais. Manchete curta num canto, sobre bloco de cor sólida ou área limpa da própria foto, sem véu escuro. O detalhe é do cliente (foto própria), nunca de banco de imagem.",
    risco_politica: "baixo",
  },
  {
    id: "objeto_inesperado",
    nome: "Objeto inesperado",
    quando_usar: "Categoria saturada em que todo mundo mostra a mesma foto, e a dor ou o benefício podem ser ditos por um objeto fora do lugar.",
    como_fazer: "Um objeto comum em lugar, escala ou condição impossível (conta de luz dentro da geladeira, mangueira dando nó, relógio parado em cima do balcão), fotografado de forma realista, grande e centralizado, fundo limpo. A manchete liga o objeto à oferta em até 7 palavras. Teste: alguém de fora entende a relação em 2 segundos; surpresa sem ligação com a oferta traz clique ruim.",
    risco_politica: "baixo",
  },
  {
    id: "metafora_visual",
    nome: "Metáfora literalizada",
    quando_usar: "Serviço abstrato (tempo, organização, segurança, atendimento, tranquilidade) que precisa virar coisa visível.",
    como_fazer: "Transformar a expressão em cena literal e única: caixa de entrada transbordando papéis, porta fechando no cliente que foi embora, placas apontando para todo lado. A cena ocupa o quadro, com a cor de destaque no elemento que carrega a ideia. A manchete conecta a metáfora ao benefício real.",
    risco_politica: "baixo",
  },
  {
    id: "comparacao_lado_a_lado",
    nome: "Comparação lado a lado",
    quando_usar: "Quando o cliente compara opções (processo, material, prazo, o que está incluso) e a diferença é demonstrável.",
    como_fazer: "Quadro dividido ao meio: de um lado o jeito comum (sem marca de concorrente, sem ridicularizar), do outro o jeito do cliente, com mesmo enquadramento e mesma luz. Cor neutra no lado comum e cor da marca no lado do cliente; rótulos curtos e grandes. Critério claro e verdadeiro (tempo, etapas, material, garantia).",
    risco_politica: "medio",
  },
  {
    id: "nos_contra_eles",
    nome: "Nós contra o jeito comum (tabela)",
    quando_usar: "Público consciente da solução escolhendo fornecedor; oferta com diferenciais objetivos.",
    como_fazer: "Tabela grande de 3 a 5 linhas com check na coluna da marca e x na coluna do jeito comum, títulos das colunas em caixa alta, coluna da marca em cor de destaque e um pouco maior. Produto ou foto real no topo. Só diferenciais verificáveis; nunca nomear, mostrar ou imitar concorrente.",
    risco_politica: "medio",
  },
  {
    id: "depoimento_citacao",
    nome: "Depoimento em citação",
    quando_usar: "Há depoimento real, autorizado e específico no briefing (com nome ou iniciais e permissão de uso).",
    como_fazer: "Aspas gigantes na cor de destaque, trecho curto e específico do depoimento real em tipografia grande, nome ou iniciais e contexto (bairro, tipo de cliente) embaixo, foto real do cliente ou do trabalho ao lado. Estrelas só se a nota vier de avaliação pública real. Nunca escrever depoimento, nunca usar foto de banco como se fosse o cliente; em saúde e estética, sem promessa de resultado no trecho.",
    risco_politica: "medio",
  },
  {
    id: "lista_checklist",
    nome: "Lista ou checklist",
    quando_usar: "Oferta com várias partes (o que está incluso), motivos para escolher, erros comuns ou sinais de que é hora do serviço (sem rotular a pessoa).",
    como_fazer: "Título forte no topo e 3 a 5 itens curtos (até 5 palavras cada) com checks grandes na cor de destaque, alinhados à esquerda; produto ou foto real ocupando um terço do quadro. Se o título diz um número de itens, a lista tem exatamente esse número.",
    risco_politica: "baixo",
  },
  {
    id: "ugc_nativo",
    nome: "Foto nativa de celular",
    quando_usar: "Público frio que ignora anúncio com cara de anúncio; serviços locais e e-commerce com cliente ou equipe reais.",
    como_fazer: "Foto com cara de feita no celular: luz natural, enquadramento imperfeito, ambiente real, pessoa real autorizada usando ou mostrando o produto. Texto curto como legenda nativa (faixa branca arredondada) no terço de cima. Parece post, mas não imita botão, interface nem perfil de outra pessoa, e não finge ser avaliação espontânea.",
    risco_politica: "baixo",
  },
  {
    id: "bastidor_real",
    nome: "Bastidor real",
    quando_usar: "Quando o processo, a equipe ou o cuidado são o diferencial (cozinha, oficina, obra, laboratório, estoque, montagem).",
    como_fazer: "Foto real do bastidor no momento da ação (mãos trabalhando, equipe montando, pedido sendo embalado), cores naturais e vivas, um detalhe em foco. Manchete no tom de mostrar como é feito, sobre bloco de cor. É prova porque é real: nada de encenar com banco de imagem.",
    risco_politica: "baixo",
  },
  {
    id: "demonstracao_etapas",
    nome: "Demonstração em etapas",
    quando_usar: "Produto ou serviço cuja facilidade ou método é a venda (como funciona, do pedido à entrega, 3 passos).",
    como_fazer: "Três quadros numerados grandes (1, 2, 3) em linha ou em Z, cada um com foto ou ícone real e 2 a 4 palavras; o último é o resultado ou o próximo passo, na cor de destaque. Setas grossas guiam o olho. As etapas são as reais do atendimento.",
    risco_politica: "baixo",
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    quando_usar: "Transformação visível e verificável fora de corpo e saúde (reforma, limpeza, jardim, funilaria, organização, conserto). Em estética, saúde, emagrecimento e odontologia só com todas as regras do conselho profissional e da Meta; por isso o risco é alto.",
    como_fazer: "Quadro dividido com mesmo ângulo, mesma luz e mesmo enquadramento nos dois lados, rótulos grandes de antes e depois, foto real de trabalho do próprio cliente com autorização. Nada de piorar o antes com filtro ou escurecimento; nada de corpo, pele ou rosto com expectativa de resultado; nunca prometer o mesmo resultado para todos.",
    risco_politica: "alto",
  },
  {
    id: "moldura_de_app",
    nome: "Moldura de app (nota, conversa, post)",
    quando_usar: "Raramente. Só quando a anotação ou a conversa é a própria ideia (lista de tarefas, pergunta que o cliente manda) e dá para estilizar sem parecer a interface real.",
    como_fazer: "Se usar, estilizar claramente como ilustração da marca: cores da marca, sem barra de status, sem ícones reais do sistema, sem notificação, botão de play, cursor, contador, mensagem não lida ou botão clicável falso, sem nome ou foto de pessoa real. Na dúvida, trocar por manchete gigante ou lista.",
    risco_politica: "alto",
  },
  {
    id: "objecao_na_manchete",
    nome: "Objeção na manchete",
    quando_usar: "Existe uma dúvida ou trava de compra que o comercial ouve toda semana (preço, prazo, confiança, se serve para o caso da pessoa).",
    como_fazer: "A pergunta do comprador em tipografia grande no topo, entre aspas e sem atribuir a pessoa real; resposta direta e específica embaixo na cor de destaque; prova real ou foto do serviço ao lado. A resposta é verdade operacional do cliente.",
    risco_politica: "baixo",
  },
  {
    id: "numero_em_destaque",
    nome: "Número em destaque",
    quando_usar: "Há um número real e específico no briefing (anos de mercado, clientes atendidos, prazo, garantia, nota média com fonte).",
    como_fazer: "O número em escala gigante (cerca de metade do quadro), na cor de destaque, com o rótulo do que significa e o período ou a fonte em letra menor e legível; produto ou foto real no canto. Só número verdadeiro, com período e condição.",
    risco_politica: "medio",
  },
  {
    id: "produto_heroi_cor",
    nome: "Produto herói em cor chapada",
    quando_usar: "Produto físico com foto boa: e-commerce, lançamento, reposição, item mais vendido.",
    como_fazer: "Produto recortado e grande (50% a 70% do quadro), em ângulo heroico ou levemente inclinado, sobre fundo de cor sólida saturada que contrasta com ele (cor complementar), sombra de contato curta, um ou dois selos de benefício real e manchete curta. Nada de fundo branco de catálogo.",
    risco_politica: "baixo",
  },
  {
    id: "editorial_manchete",
    nome: "Manchete editorial",
    quando_usar: "Informação nova ou curiosa com entrega real (lançamento, mudança de regra, guia, dado do setor com fonte) para público consciente do problema.",
    como_fazer: "Composição de revista própria: manchete serifada grande, linha fina explicativa, foto real forte ocupando metade do quadro. A identidade é da marca: nunca imitar logo, nome, layout ou selo de jornal, revista ou portal real e nunca simular notícia.",
    risco_politica: "medio",
  },
  {
    id: "humor_situacao",
    nome: "Humor com a situação",
    quando_usar: "Marca com tom leve e situação cotidiana que o público reconhece e acha graça (a espera, a gambiarra, o improviso).",
    como_fazer: "Cena própria (foto encenada ou ilustração) com exagero visível e um detalhe engraçado; a manchete vira a piada para o benefício. Rir da situação, nunca da pessoa, do corpo ou da condição dela. Sem template de meme com imagem de terceiros.",
    risco_politica: "medio",
  },
  {
    id: "local_e_bairro",
    nome: "Local e bairro",
    quando_usar: "Negócio local que atende uma região (delivery, clínica, oficina, salão, imobiliária, assistência técnica).",
    como_fazer: "Elemento reconhecível da região (rua, fachada real, mapa estilizado com pino grande na cor da marca, ponto de referência) e manchete citando a cidade ou o bairro atendido com o benefício (perto, entrega, atendimento no dia). Dizer a região atendida, nunca afirmar onde a pessoa mora.",
    risco_politica: "baixo",
  },
  {
    id: "pilha_de_oferta",
    nome: "Pilha de oferta",
    quando_usar: "Oferta com bônus, kit ou pacote para público quente pronto para decidir.",
    como_fazer: "Todos os itens inclusos juntos numa pilha ou grade organizada (o principal maior), cada um com rótulo curto, selo da garantia real e da condição real, CTA grande. Valor separado de cada item só se esse preço é praticado de verdade.",
    risco_politica: "medio",
  },
  {
    id: "rosto_e_olhar",
    nome: "Rosto e olhar",
    quando_usar: "Serviço de confiança em que a pessoa por trás importa (profissional, dono, equipe) ou produto usado por gente real.",
    como_fazer: "Rosto real e autorizado em close médio, expressão clara (surpresa, alívio, foco), olhar e gesto apontando para a manchete ou o produto; fundo de cor sólida ou ambiente real claro. Sem sugerir que quem vê tem algum atributo pessoal; sem expressão de dor ou vergonha ligada ao corpo.",
    risco_politica: "baixo",
  },
];

export const ESTILOS_VISUAIS_IDS: readonly string[] = ESTILOS_VISUAIS.map((e) => e.id);

/** Estilos em texto corrido para o estrategista e o diretor. */
export const ESTILOS_VISUAIS_RESUMO = [
  "ESTILOS VISUAIS DE ESTÁTICO (use o id no campo estilo_visual; varie o estilo entre os ângulos)",
  ...ESTILOS_VISUAIS.map((e) => `- ${e.id} (${e.nome}, risco de política ${e.risco_politica}): quando usar: ${e.quando_usar} Como fazer: ${e.como_fazer}`),
].join("\n");

/** Níveis do Jev (0 a 4, do pior ao melhor): poder de parar a rolagem no feed. */
export const NIVEIS_PARADA = [
  "Some no feed: parece post comum da categoria, sem ponto focal, texto pequeno ou foto genérica de banco de imagem.",
  "Chama pouca atenção: tem um elemento visível, mas o conjunto repete o padrão da categoria e o olho não sabe onde pousar.",
  "Para quem já está procurando: ponto focal claro e manchete legível, mas nada inesperado em escala, cor ou ideia.",
  "Para a maioria do público certo: contraste forte (escala, cor, recorte ou objeto) e manchete que se lê em 1 segundo no celular.",
  "Impossível passar sem olhar: um elemento inesperado e relevante domina o quadro, a manchete completa a ideia em 1 segundo e tudo aponta para a oferta.",
];

/** Níveis do Jev (0 a 4, do pior ao melhor): quanto foge do "mais do mesmo" do nicho. */
export const NIVEIS_DIFERENCIACAO = [
  "Cópia do clichê: mesma foto, mesma frase e mesma composição que todo concorrente do nicho usa.",
  "Variação cosmética do padrão do nicho: muda cor ou palavra, mas seria confundida com qualquer outra peça da categoria.",
  "Um ponto diferente (ângulo, prova ou imagem), mas o resto segue o padrão da categoria.",
  "Rompe o clichê do nicho num ponto importante (situação, metáfora, estilo visual ou argumento) e continua fácil de entender.",
  "Conceito próprio: situação, forma visual e argumento que a categoria não usa, ligados à oferta real; seria reconhecido como desta marca mesmo sem logo.",
];

/** Níveis do Jev (0 a 4, do pior ao melhor): força da oferta (valor percebido x risco x esforço). */
export const NIVEIS_FORCA_OFERTA = [
  "Não há oferta: só o nome do produto ou um convite para conhecer, sem motivo para agir.",
  "Oferta genérica: diz o que é, mas sem para quem, sem condição e sem redução de risco; qualquer concorrente diria o mesmo.",
  "Oferta clara com um motivo para agir (condição, benefício específico ou facilidade), mas sem reversão de risco nem prova.",
  "Oferta específica para um público, com resultado desejado claro, menos esforço ou prazo e um elemento real de segurança (garantia, prova ou teste).",
  "Oferta difícil de recusar e verdadeira: resultado desejado específico, prova real, garantia ou reversão de risco, bônus que resolvem objeções, motivo real para agir agora e próximo passo simples.",
];

/** Objetivo de campanha da agência mapeado para o Gerenciador de Anúncios da Meta. */
export type ObjetivoCampanha = {
  id: "vendas" | "mensagens" | "leads" | "seguidores" | "agendamento" | "trafego" | "reconhecimento";
  nome: string;
  objetivo_meta: string;
  evento_otimizacao: string;
  metrica_que_decide: string;
  ctas: string[];
  como_o_criativo_muda: string;
};

export const OBJETIVOS_DE_CAMPANHA: ObjetivoCampanha[] = [
  {
    id: "vendas",
    nome: "Vendas",
    objetivo_meta: "Vendas (local de conversão: site, app ou catálogo)",
    evento_otimizacao: "Maximizar o número de conversões no evento Compra (pixel e API de Conversões); sem volume de compras (cerca de 50 por semana por conjunto), otimizar para um evento anterior como Adicionar ao carrinho ou Iniciar finalização.",
    metrica_que_decide: "Custo por compra e ROAS (receita atribuída dividida pelo gasto), conferidos com a venda real e a margem.",
    ctas: ["Comprar agora", "Obter oferta", "Saiba mais"],
    como_o_criativo_muda: "Produto e oferta aparecem na primeira leitura: preço ou condição real, benefício principal, prova e CTA de compra. Público frio pede problema e demonstração antes do preço; remarketing pede oferta direta, garantia e objeção respondida.",
  },
  {
    id: "mensagens",
    nome: "Mensagens (WhatsApp, Direct, Messenger)",
    objetivo_meta: "Engajamento com local de conversão Apps de mensagem (também disponível em Vendas e Cadastros)",
    evento_otimizacao: "Maximizar o número de conversas (conversa por mensagem iniciada).",
    metrica_que_decide: "Custo por conversa iniciada e, acima de tudo, quantas conversas viram orçamento, agendamento ou venda (conferir com o atendimento).",
    ctas: ["Enviar mensagem", "Fale conosco", "Solicitar orçamento"],
    como_o_criativo_muda: "O criativo prepara a conversa: diz o que a pessoa vai receber ao chamar (orçamento, horário, preço, catálogo) e a primeira mensagem pronta continua a mesma promessa. Qualifica na arte (região atendida, tipo de serviço) para não lotar o WhatsApp de curioso.",
  },
  {
    id: "leads",
    nome: "Cadastros (leads)",
    objetivo_meta: "Cadastros (local de conversão: formulário instantâneo, site ou mensagens)",
    evento_otimizacao: "Maximizar o número de cadastros; com CRM integrado, otimizar para lead qualificado (conversões de leads).",
    metrica_que_decide: "Custo por lead qualificado e taxa de lead que vira reunião ou venda, não o custo do cadastro sozinho.",
    ctas: ["Cadastre-se", "Solicitar orçamento", "Saiba mais"],
    como_o_criativo_muda: "Troca clara: o que a pessoa ganha ao deixar o contato (diagnóstico, orçamento, material, condição) e para quem é. Formulário com pergunta de qualificação quando o volume vem ruim.",
  },
  {
    id: "seguidores",
    nome: "Seguidores do perfil",
    objetivo_meta: "Tráfego com local de conversão Perfil do Instagram",
    evento_otimizacao: "Maximizar visitas ao perfil do Instagram. Não existe otimização por seguir: desde julho de 2025 a Meta mostra seguidores atribuídos só como métrica de relatório, em contas selecionadas.",
    metrica_que_decide: "Custo por visita ao perfil e custo por seguidor (seguidores atribuídos ou ganho no período dividido pelo gasto), com qualidade: seguidores que interagem depois.",
    ctas: ["Saiba mais"],
    como_o_criativo_muda: "Vende o perfil, não o produto: promessa do conteúdo que a pessoa vai receber ao seguir (série, dica, bastidor), identidade forte e prova de que o perfil entrega (grade bonita, tema claro). O botão no Gerenciador é o de visitar o perfil.",
  },
  {
    id: "agendamento",
    nome: "Agendamento",
    objetivo_meta: "Cadastros ou Vendas com evento Agendar (Schedule) no site, ou Engajamento com mensagens quando a agenda é feita no WhatsApp",
    evento_otimizacao: "Maximizar conversões no evento Agendar (pixel e API de Conversões); sem agenda online, maximizar conversas e medir o agendamento no atendimento.",
    metrica_que_decide: "Custo por agendamento confirmado e taxa de comparecimento.",
    ctas: ["Agendar", "Enviar mensagem", "Ligar agora"],
    como_o_criativo_muda: "Mostra o próximo horário ou a facilidade real de marcar, o que acontece na primeira visita e o que a pessoa leva; reduz o risco percebido (avaliação, orçamento sem compromisso, se for verdade).",
  },
  {
    id: "trafego",
    nome: "Tráfego para página",
    objetivo_meta: "Tráfego (local de conversão: site ou app)",
    evento_otimizacao: "Maximizar visualizações da página de destino (não cliques no link, que trazem clique acidental).",
    metrica_que_decide: "Custo por visualização da página e o que acontece depois (tempo, rolagem, conversões secundárias); usar só quando a conversão não tem volume para otimizar.",
    ctas: ["Saiba mais", "Ver menu", "Comprar agora"],
    como_o_criativo_muda: "A curiosidade tem que ter entrega na página: a peça promete uma informação ou um catálogo que a página mostra logo no topo.",
  },
  {
    id: "reconhecimento",
    nome: "Reconhecimento",
    objetivo_meta: "Reconhecimento (alcance ou lembrança do anúncio)",
    evento_otimizacao: "Maximizar alcance (com limite de frequência) ou lembrança do anúncio.",
    metrica_que_decide: "Alcance único na praça, CPM e frequência controlada; efeito medido depois em busca pela marca, visitas ao perfil e mensagens.",
    ctas: ["Saiba mais"],
    como_o_criativo_muda: "Marca e ideia memoráveis em 1 segundo: identidade visual forte, uma frase de posicionamento e a imagem mais característica do negócio. Serve para abrir praça ou lançamento, não para cobrar venda.",
  },
];

/** Objetivos em texto corrido para o estrategista. */
export const OBJETIVOS_RESUMO = [
  "OBJETIVOS DE CAMPANHA (use o id no campo objetivo; o criativo muda com o objetivo)",
  ...OBJETIVOS_DE_CAMPANHA.map((o) => `- ${o.id}: Meta ${o.objetivo_meta}. Otimização: ${o.evento_otimizacao} Decide: ${o.metrica_que_decide} CTAs: ${o.ctas.join(", ")}. Criativo: ${o.como_o_criativo_muda}`),
].join("\n");

/** Nicho típico de agência brasileira (dores, desejos, ganchos, provas e riscos). */
export type Nicho = {
  id: string;
  nome: string;
  dores: string[];
  desejos: string[];
  ganchos: string[];
  provas_tipicas: string[];
  riscos_de_politica: string[];
  estilos_que_funcionam: string[];
};

export const NICHOS: Nicho[] = [
  {
    id: "estetica",
    nome: "Estética (clínicas e procedimentos estéticos)",
    dores: ["medo de ficar artificial", "não saber qual procedimento serve para o caso", "desconfiança de preço baixo demais", "experiência ruim anterior"],
    desejos: ["resultado natural", "segurança com profissional habilitado", "saber exatamente o que vai ser feito", "caber na agenda"],
    ganchos: ["Natural é técnica, não sorte", "O que ninguém explica antes do procedimento", "Avaliação antes de qualquer agulha", "Quem aplica faz diferença"],
    provas_tipicas: ["registro profissional do responsável", "estrutura e protocolo de segurança reais", "depoimento autorizado sem promessa", "anos de atuação"],
    riscos_de_politica: ["Antes e depois só para público 18+, com autorização expressa e sem expectativa irreal; se o anúncio é de médico, a Resolução CFM 2.336/2023 exige caráter educativo e mostrar também evoluções insatisfatórias e complicações possíveis", "Proibido afirmar atributo físico da pessoa ou falar mal da aparência (rugas, flacidez em 'você')", "Sem promessa de resultado nem prazo de resultado", "Segmentar 18+"],
    estilos_que_funcionam: ["objecao_na_manchete", "rosto_e_olhar", "bastidor_real", "lista_checklist", "tipografia_gigante"],
  },
  {
    id: "odontologia",
    nome: "Odontologia",
    dores: ["medo de dor e de dentista", "orçamento que parece caro sem explicação", "vergonha de sorrir (sem afirmar isso da pessoa no anúncio)", "tratamento que nunca termina"],
    desejos: ["atendimento sem dor e sem susto", "plano de tratamento claro com etapas", "sorriso bonito e natural", "facilidade de pagamento real"],
    ganchos: ["Plano de tratamento antes do primeiro dente", "Pergunte tudo antes de sentar na cadeira", "Sem susto no orçamento", "Do diagnóstico ao sorriso em etapas"],
    provas_tipicas: ["CRO do responsável", "casos próprios com TCLE", "tecnologia e estrutura reais", "avaliações públicas reais"],
    riscos_de_politica: ["Resolução CFO 196/2019: antes e depois só de caso próprio, com consentimento do paciente, e nome e CRO do profissional na peça", "Conferir no Código de Ética Odontológica as regras de divulgação de preço e promoção antes de anunciar valor (não verificado nesta pesquisa)", "Sem promessa de resultado e sem atributo pessoal ('seus dentes amarelados')"],
    estilos_que_funcionam: ["demonstracao_etapas", "objecao_na_manchete", "rosto_e_olhar", "bastidor_real", "lista_checklist"],
  },
  {
    id: "advocacia",
    nome: "Advocacia",
    dores: ["não saber se tem direito", "medo de custo e de processo longo", "desconfiança de advogado", "prazo correndo sem saber"],
    desejos: ["entender o próprio direito em linguagem simples", "orientação segura", "resolver sem dor de cabeça"],
    ganchos: ["Prazo para pedir isso existe", "O que muda com a nova regra", "3 documentos para separar antes", "Direito que pouca gente conhece"],
    provas_tipicas: ["inscrição na OAB", "conteúdo informativo com base legal citada", "área de atuação clara"],
    riscos_de_politica: ["Provimento 205/2021 da OAB: publicidade só informativa e discreta; anúncio pago permitido sem captação de clientela, sem promessa de resultado, sem preço e sem ostentação", "Agressivo aqui é clareza e contraste, não oferta: nada de 'ganhe sua causa'", "Sem atributo pessoal ('você foi demitido?') e sem usar caso concreto de cliente"],
    estilos_que_funcionam: ["tipografia_gigante", "lista_checklist", "objecao_na_manchete", "editorial_manchete", "metafora_visual"],
  },
  {
    id: "imobiliaria",
    nome: "Imobiliária e lançamentos",
    dores: ["medo de fazer mau negócio", "burocracia de financiamento", "visitar imóvel que não era como na foto", "não saber quanto consegue financiar"],
    desejos: ["imóvel certo no bairro certo", "entrada e parcela que cabem no bolso", "segurança jurídica", "ver antes de ir"],
    ganchos: ["Planta que cabe a sua rotina", "Quanto custa morar aqui de verdade", "A 5 minutos de onde você trabalha, se for verdade", "Visita virtual antes da visita"],
    provas_tipicas: ["fotos reais do imóvel", "localização e distâncias reais", "CRECI", "condições reais de pagamento da construtora"],
    riscos_de_politica: ["Moradia pode exigir categoria especial de anúncio com segmentação restrita (conferir no Gerenciador para o Brasil)", "Sem afirmar situação financeira da pessoa ('saia do aluguel que te sufoca')", "Preço, entrada e parcela só com condição completa e real"],
    estilos_que_funcionam: ["local_e_bairro", "close_extremo", "numero_em_destaque", "lista_checklist", "ugc_nativo"],
  },
  {
    id: "restaurante_delivery",
    nome: "Restaurante e delivery",
    dores: ["não saber o que pedir hoje", "comida que chega fria ou diferente da foto", "taxa e demora", "sempre o mesmo lugar"],
    desejos: ["comer bem sem esforço", "chegar quente e rápido", "novidade", "preço justo e combo que vale"],
    ganchos: ["Sai do forno às 19h, chega quente", "O combo que resolve a sexta", "Feito agora, não requentado", "Hoje tem"],
    provas_tipicas: ["foto real do prato", "nota pública em app de delivery", "bastidor da cozinha", "tempo médio real de entrega"],
    riscos_de_politica: ["Bebida alcoólica exige público 18+ e cuidado com lei local", "Foto do prato tem que ser do prato real (sem banco de imagem)", "Promoção só com dia e condição reais"],
    estilos_que_funcionam: ["close_extremo", "oferta_direta", "bastidor_real", "local_e_bairro", "humor_situacao", "produto_heroi_cor"],
  },
  {
    id: "academia",
    nome: "Academia e estúdios de treino",
    dores: ["começar e desistir", "vergonha de não saber usar os aparelhos (sem afirmar isso da pessoa)", "falta de tempo", "lotação e fila"],
    desejos: ["rotina que cabe no dia", "acompanhamento de verdade", "ambiente acolhedor", "voltar a treinar"],
    ganchos: ["Treino de 40 minutos cabe no almoço", "Primeira semana com acompanhamento", "Para quem quer voltar a treinar", "Horário vazio existe"],
    provas_tipicas: ["estrutura e horários reais", "profissionais com CREF", "aula experimental real", "depoimento autorizado sem promessa de corpo"],
    riscos_de_politica: ["Sem promessa de perda de peso ou de corpo, sem antes e depois de corpo, sem foco negativo em parte do corpo", "Sem atributo pessoal ('você está acima do peso?'); usar 'para quem quer'", "Suplemento e emagrecimento só 18+"],
    estilos_que_funcionam: ["tipografia_gigante", "ugc_nativo", "oferta_direta", "humor_situacao", "local_e_bairro"],
  },
  {
    id: "moda",
    nome: "Moda e vestuário",
    dores: ["roupa que não veste como na foto", "não saber combinar", "troca difícil", "qualidade que some na lavagem"],
    desejos: ["peça que valoriza e dura", "look pronto", "novidade antes de todo mundo", "compra sem risco de troca"],
    ganchos: ["A peça que vira três looks", "Tecido que aguenta a lavagem", "Chegou a coleção, poucas grades de verdade", "Troca fácil, sem pergunta"],
    provas_tipicas: ["foto real vestida em pessoas diferentes", "detalhe do tecido e costura", "política de troca real", "avaliações reais"],
    riscos_de_politica: ["Sem imagem que reforce padrão de corpo negativo ou foco em parte do corpo", "Escassez só com estoque real", "Sem atributo pessoal sobre corpo"],
    estilos_que_funcionam: ["produto_heroi_cor", "close_extremo", "ugc_nativo", "lista_checklist", "pilha_de_oferta"],
  },
  {
    id: "pet",
    nome: "Pet shop e veterinária",
    dores: ["pet estressado no banho", "não confiar em quem cuida", "buscar e levar", "ração e remédio que acabam"],
    desejos: ["pet bem cuidado e tranquilo", "ver como foi o atendimento", "conveniência (leva e traz, entrega)", "cuidado com carinho"],
    ganchos: ["Ele volta cheiroso e calmo", "Leva e traz no mesmo dia", "Veja como é o banho aqui", "A ração acaba antes de você lembrar"],
    provas_tipicas: ["fotos e vídeos reais de pets atendidos com autorização do tutor", "profissionais e estrutura", "avaliações públicas"],
    riscos_de_politica: ["Medicamento veterinário e alegação de cura exigem cuidado", "Sem imagem de animal machucado ou sofrendo para chocar", "Promoção com condição real"],
    estilos_que_funcionam: ["bastidor_real", "ugc_nativo", "rosto_e_olhar", "humor_situacao", "local_e_bairro"],
  },
  {
    id: "automotivo_oficina",
    nome: "Automotivo e oficina",
    dores: ["medo de ser enganado no orçamento", "barulho que ninguém descobre", "carro parado dias", "revisão cara na concessionária"],
    desejos: ["orçamento claro com foto da peça", "carro pronto no prazo", "confiança no mecânico", "viajar tranquilo"],
    ganchos: ["Orçamento com foto da peça trocada", "Aquele barulho na subida tem nome", "Revisão antes de pegar a estrada", "Carro pronto no dia combinado"],
    provas_tipicas: ["foto real da peça antes da troca", "garantia do serviço real", "tempo de mercado", "avaliações públicas"],
    riscos_de_politica: ["Sem urgência falsa de segurança ('seu freio vai falhar')", "Sem imitar recall ou aviso oficial", "Preço de revisão só com o que inclui"],
    estilos_que_funcionam: ["close_extremo", "comparacao_lado_a_lado", "objecao_na_manchete", "bastidor_real", "antes_depois", "demonstracao_etapas"],
  },
  {
    id: "cursos_infoproduto",
    nome: "Cursos e infoprodutos",
    dores: ["já comprou curso e não terminou", "medo de não conseguir aplicar", "excesso de informação solta", "falta de tempo"],
    desejos: ["caminho claro passo a passo", "aplicar rápido", "suporte para dúvidas", "certificado ou resultado de aprendizado"],
    ganchos: ["O módulo 1 já é prático", "Aula curta para quem trabalha", "O erro que trava quem começa", "Veja uma aula antes de comprar"],
    provas_tipicas: ["amostra real da aula", "ementa completa", "garantia de 7 dias do Código de Defesa do Consumidor ou maior", "depoimentos reais sem promessa de renda"],
    riscos_de_politica: ["Sem promessa de ganho, renda ou enriquecimento; nada de print de faturamento", "Sem atributo pessoal ('está desempregado?')", "Urgência só com data real de turma ou condição"],
    estilos_que_funcionam: ["tipografia_gigante", "lista_checklist", "pilha_de_oferta", "objecao_na_manchete", "demonstracao_etapas", "rosto_e_olhar"],
  },
  {
    id: "saude_clinica",
    nome: "Saúde e clínicas (médicas, fisioterapia, psicologia, exames)",
    dores: ["demora para conseguir horário", "não saber qual especialista procurar", "atendimento corrido", "custo sem saber o que inclui"],
    desejos: ["ser ouvido com calma", "horário rápido e perto", "explicação clara", "cuidado contínuo"],
    ganchos: ["Consulta com tempo para perguntar", "Horário esta semana, se houver", "Qual especialista procurar para isso", "O que acontece na primeira consulta"],
    provas_tipicas: ["CRM, CRP ou CREFITO do responsável", "estrutura e convênios reais", "conteúdo informativo com base"],
    riscos_de_politica: ["Sem atributo de saúde da pessoa ('você tem ansiedade?'); falar do serviço ('atendimento para ansiedade')", "Sem promessa de cura ou resultado; CFM 2.336/2023 e conselhos da área valem", "Público 18+ quando envolver procedimentos e emagrecimento"],
    estilos_que_funcionam: ["objecao_na_manchete", "rosto_e_olhar", "demonstracao_etapas", "lista_checklist", "local_e_bairro"],
  },
  {
    id: "paisagismo_jardim",
    nome: "Paisagismo e jardinagem",
    dores: ["jardim que morre depois de pronto", "falta de tempo para cuidar", "orçamento sem projeto", "planta errada para o lugar"],
    desejos: ["jardim bonito o ano inteiro", "manutenção sem dor de cabeça", "ver o projeto antes", "valorizar a casa"],
    ganchos: ["Planta certa para a sua sombra", "Jardim que sobrevive ao verão", "Veja o projeto antes de plantar", "Manutenção mensal, você só aproveita"],
    provas_tipicas: ["fotos reais de jardins feitos", "antes e depois de área própria", "projeto em 3D real", "garantia de pega das mudas se houver"],
    riscos_de_politica: ["Antes e depois de jardim é permitido; manter mesmo ângulo e foto real", "Sem prometer prazo de crescimento que depende do clima", "Sem foto de banco como se fosse trabalho próprio"],
    estilos_que_funcionam: ["antes_depois", "close_extremo", "objeto_inesperado", "demonstracao_etapas", "metafora_visual"],
  },
  {
    id: "informatica_assistencia",
    nome: "Informática e assistência técnica",
    dores: ["computador lento na hora do trabalho", "medo de perder arquivos", "orçamento sem explicação", "ficar dias sem o aparelho"],
    desejos: ["aparelho rápido de novo", "dados seguros", "diagnóstico claro antes de pagar", "conserto no prazo"],
    ganchos: ["Diagnóstico antes de qualquer troca", "Seus arquivos saem com você", "Lento não é normal", "Pronto no prazo combinado"],
    provas_tipicas: ["bastidor da bancada", "garantia do serviço", "tempo de mercado e avaliações", "fotos reais das peças"],
    riscos_de_politica: ["Proibido imitar alerta de vírus, erro do sistema, janela de aviso ou notificação", "Sem susto falso ('seu computador está infectado')", "Preço só com o que inclui"],
    estilos_que_funcionam: ["bastidor_real", "objeto_inesperado", "objecao_na_manchete", "local_e_bairro", "close_extremo"],
  },
  {
    id: "ecommerce_geral",
    nome: "E-commerce geral",
    dores: ["medo de não receber ou de golpe", "frete caro", "produto diferente da foto", "troca complicada"],
    desejos: ["comprar com segurança", "chegar rápido", "preço justo", "ver o produto de verdade"],
    ganchos: ["Frete grátis acima de [valor real]", "O mais vendido tem motivo", "Veja de perto antes de comprar", "Chega em [prazo real]"],
    provas_tipicas: ["avaliações reais de compradores", "fotos reais do produto", "política de troca e prazo", "CNPJ e loja verificada"],
    riscos_de_politica: ["'De/por' só com preço anterior praticado de verdade (CDC)", "Escassez e contador só se reais", "Sem imitar selo de marketplace ou de marca de terceiros"],
    estilos_que_funcionam: ["produto_heroi_cor", "oferta_direta", "depoimento_citacao", "comparacao_lado_a_lado", "pilha_de_oferta", "ugc_nativo"],
  },
  {
    id: "eventos_festas",
    nome: "Eventos e festas (buffets, decoração, ingressos)",
    dores: ["medo de a festa dar errado", "orçamento que cresce no caminho", "data concorrida", "não conseguir visualizar como vai ficar"],
    desejos: ["festa sem estresse", "tudo incluso", "data garantida", "ver festas reais"],
    ganchos: ["Sua data ainda está livre?", "Tudo incluso, sem surpresa no final", "Veja uma festa montada de verdade", "Você só chega e aproveita"],
    provas_tipicas: ["fotos reais de eventos feitos", "lista do que está incluso", "agenda real de datas", "avaliações"],
    riscos_de_politica: ["Escassez de datas só com agenda real", "Bebida alcoólica exige 18+", "Ingresso e lote só com condição real"],
    estilos_que_funcionam: ["pilha_de_oferta", "bastidor_real", "lista_checklist", "oferta_direta", "close_extremo"],
  },
  {
    id: "b2b_servicos",
    nome: "B2B e serviços para empresas",
    dores: ["fornecedor que some depois de fechar", "processo manual que come o tempo da equipe", "não saber o retorno do que contrata", "orçamento difícil de comparar"],
    desejos: ["previsibilidade", "processo claro com responsável", "economia de tempo verificável", "parceiro que entende o negócio"],
    ganchos: ["O que acontece depois do contrato", "Compare o que está incluso", "Sua equipe sem retrabalho", "Diagnóstico antes da proposta"],
    provas_tipicas: ["casos reais com autorização", "processo documentado", "logos de clientes autorizados", "demonstração real"],
    riscos_de_politica: ["Sem promessa de faturamento ou resultado financeiro", "Logos de clientes só com autorização", "Sem dado de mercado sem fonte"],
    estilos_que_funcionam: ["comparacao_lado_a_lado", "nos_contra_eles", "metafora_visual", "demonstracao_etapas", "editorial_manchete"],
  },
  {
    id: "games_keys",
    nome: "Games e keys digitais",
    dores: ["medo de key que não funciona ou golpe", "preço cheio na loja oficial", "demora para receber", "região errada"],
    desejos: ["jogo mais barato com segurança", "entrega na hora", "suporte se der problema", "lançamento no dia"],
    ganchos: ["A key chega no seu e-mail na hora", "Mesmo jogo, preço de [valor real]", "Suporte se a key não ativar", "Lançamento sem pagar preço cheio"],
    provas_tipicas: ["avaliações reais de compradores", "garantia de ativação ou reembolso real", "tempo de entrega real", "tela gravada real da ativação"],
    riscos_de_politica: ["Arte, logo e personagem de jogo são de terceiros: usar só o que a licença permite ou material oficial de divulgação autorizado", "Nada de hack, cheat, conta compartilhada ou key de origem duvidosa", "Preço 'de/por' só com referência real"],
    estilos_que_funcionam: ["oferta_direta", "comparacao_lado_a_lado", "demonstracao_etapas", "depoimento_citacao", "tipografia_gigante"],
  },
  {
    id: "beleza_salao",
    nome: "Beleza e salão (cabelo, unhas, sobrancelha, barbearia)",
    dores: ["sair diferente do que pediu", "demora e atraso", "cabelo danificado por química", "não achar horário"],
    desejos: ["sair como imaginou", "horário no dia que precisa", "profissional que entende o cabelo", "cuidar sem danificar"],
    ganchos: ["Sai do jeito que você mostrou na foto", "Horário ainda esta semana", "Cor que cuida do fio", "Consulta antes da química"],
    provas_tipicas: ["fotos reais de trabalhos com autorização", "avaliações públicas", "marcas de produto usadas", "profissional e formação"],
    riscos_de_politica: ["Antes e depois de cabelo e unhas é cosmético: sem expectativa irreal, 18+ quando for procedimento", "Sem falar mal da aparência da pessoa", "Horário escasso só se real"],
    estilos_que_funcionam: ["close_extremo", "ugc_nativo", "antes_depois", "rosto_e_olhar", "local_e_bairro"],
  },
  {
    id: "construcao_reforma",
    nome: "Construção e reforma",
    dores: ["obra que atrasa", "orçamento que dobra", "sujeira e bagunça", "prestador que some"],
    desejos: ["obra no prazo e no orçamento", "acompanhamento com foto", "acabamento bem feito", "limpeza no final"],
    ganchos: ["Orçamento fechado antes de quebrar", "Você acompanha a obra pelo celular", "Acabamento que aparece de perto", "Obra entregue limpa"],
    provas_tipicas: ["fotos reais de obras feitas", "antes e depois de ambientes", "cronograma real", "responsável técnico (CREA ou CAU)"],
    riscos_de_politica: ["Antes e depois de ambiente é permitido; mesma perspectiva e foto real", "Prazo só com cronograma real", "Sem imagem de acidente para assustar"],
    estilos_que_funcionam: ["antes_depois", "close_extremo", "comparacao_lado_a_lado", "demonstracao_etapas", "bastidor_real"],
  },
];

/** Texto de um nicho para mandar ao estrategista junto do briefing. */
export function textoDoNicho(nicho: Nicho): string {
  return [
    `NICHO: ${nicho.nome} (id ${nicho.id})`,
    `- Dores comuns (confirmar com o cliente): ${nicho.dores.join("; ")}.`,
    `- Desejos: ${nicho.desejos.join("; ")}.`,
    `- Ganchos de partida (reescrever, nunca copiar): ${nicho.ganchos.join("; ")}.`,
    `- Provas típicas (usar só as que o cliente tem): ${nicho.provas_tipicas.join("; ")}.`,
    `- Riscos de política e de conselho: ${nicho.riscos_de_politica.join("; ")}.`,
    `- Estilos visuais que costumam encaixar: ${nicho.estilos_que_funcionam.join(", ")}.`,
  ].join("\n");
}

export const CONHECIMENTO_OFERTA = `MONTAGEM DE OFERTA (a oferta vende antes da arte)
Equação de valor (Alex Hormozi, livro $100M Offers): valor percebido = (resultado desejado x probabilidade percebida de conseguir) / (tempo até o resultado x esforço e sacrifício). Para subir o valor sem baixar o preço: deixar o resultado mais concreto e desejável, aumentar a confiança com prova real e garantia, encurtar o tempo até o primeiro ganho e tirar trabalho do cliente (a empresa faz, entrega, instala, busca, agenda).
Peças de uma oferta completa:
1. Para quem: público específico numa situação específica ("para quem tem jardim e não tem tempo", não "para todos").
2. Promessa: o resultado desejado dito de forma concreta e verificável; nunca garantir resultado que depende do corpo, da saúde ou do dinheiro da pessoa.
3. Mecanismo: por que funciona e por que é diferente (método, material, processo, equipe). Dar nome ao mecanismo ajuda a lembrar.
4. Entregáveis: tudo o que a pessoa recebe, listado; o invisível vira visível (diagnóstico, visita, relatório, suporte, acompanhamento).
5. Bônus: itens que resolvem uma objeção ou o próximo problema da pessoa, não brindes aleatórios. Bônus com valor inflado derruba a confiança.
6. Garantia ou reversão de risco: só a que o cliente cumpre de verdade (satisfação, refazer sem custo, prazo, devolução). Sem garantia real, reduzir o risco com teste, primeira visita, orçamento sem compromisso ou pagamento na entrega, se for verdade.
7. Urgência e escassez reais: data de fim da condição, vagas pela agenda real, estoque real, sazonalidade (antes do verão, Dia das Mães, volta às aulas) e custo de esperar (o problema piora). Nunca contador falso, "últimas vagas" sem limite real ou prazo que se renova.
8. Nome da oferta: curto e com o resultado, o público ou o mecanismo ("Revisão Pré-Viagem", "Kit Primeira Consulta", "Jardim Pronto" com prazo só se real). O nome diferencia de "promoção".
9. Ancoragem: comparar com referência verdadeira (soma dos itens vendidos separados, custo de não resolver, preço da alternativa com fonte). "De R$ X por R$ Y" só com preço anterior praticado de verdade (Código de Defesa do Consumidor proíbe publicidade enganosa).
10. CTA e próximo passo: uma ação só, fácil e coerente com o destino (mensagem com texto pronto, agendar, comprar).
Diagnóstico rápido: dar nota de 1 a 10 a cada alavanca (resultado, confiança, tempo, esforço); a mais baixa é a que a próxima versão melhora. Mudar uma alavanca por rodada.
Honestidade na oferta: preço, desconto, prazo, estoque, vagas, garantia, bônus e resultados só os que estão no briefing ou que a equipe confirmou. O que faltar vira pergunta para a equipe ou fica entre colchetes ([preço confirmado]), nunca suposição. Evitar palavras com cara de golpe ("segredo", "método escondido", "dinheiro fácil", "garantido" para saúde ou renda).`;

export const CONHECIMENTO_AGRESSIVO = `AGRESSIVO E VENDEDOR DENTRO DA POLÍTICA
Agressivo é ser direto, específico e impossível de ignorar. Não é mentir, assustar nem expor a pessoa.
O que é permitido e vende:
- Dizer a oferta e o preço real sem rodeio, com a condição inteira.
- Nomear a situação ruim do dia a dia com as palavras do público ("o carro fazendo barulho na subida"), sem dizer que a pessoa tem um problema pessoal.
- Consequência concreta de não agir, verdadeira e proporcional: custo de esperar, retrabalho, tempo perdido.
- Afirmação contraintuitiva ou provocativa sobre a categoria ("Grama bonita não é regar todo dia"), com a explicação logo depois.
- Comparação com o jeito comum, com critério verificável e sem nomear concorrente.
- Desafiar o costume da categoria ("Pare de pagar orçamento sem saber o que inclui"), desde que a solução entregue.
- CTA imperativo e claro ("Chame no WhatsApp", "Garanta sua data").
O que parece agressivo mas derruba a conta ou a confiança (não fazer):
- Pergunta ou afirmação sobre atributo pessoal ("Você está endividado?", "Cansada das suas rugas?"). Trocar por "para quem" ou pela situação.
- Promessa de resultado em saúde, estética, peso ou renda; "garantido", "definitivo" ou "em X dias" sem base.
- Antes e depois de corpo ou pele fora das regras; foco negativo em parte do corpo.
- Imitar interface (notificação, botão de play, mensagem não lida, alerta de vírus, barra de busca), notícia falsa, selo ou logo de terceiros, famoso sem autorização.
- Urgência ou escassez inventada, contador que reinicia, "só hoje" que continua amanhã.
- Choque, medo exagerado, imagem sangrenta ou nojenta, palavrão, humilhação.
- Gancho que o destino não entrega.
Destaque visual sem escurecer a foto:
- Escala: um elemento dominante ocupa boa parte do quadro; o resto é bem menor.
- Cor: fundo chapado saturado, bloco de cor sob o texto, uma cor de destaque aplicada em um só lugar (palavra-chave, selo ou produto).
- Contraste de valor: texto escuro em área clara e texto claro em bloco sólido; contorno ou sombra curta na letra quando precisar.
- Composição: diagonal, corte ousado (produto saindo do quadro), recorte, sobreposição, respiro em volta do foco.
- Tipografia: peso pesado, poucas palavras, palavra-chave em cor ou sublinhada, tamanho gigante quando a frase é a ideia.
- Nunca: véu preto, gradiente escuro sobre a foto, vinheta pesada, foto dessaturada ou apagada para o texto aparecer. A foto e a capa ficam com a luz e as cores originais.
Fugir do "mais do mesmo": listar o que o nicho repete (foto, cor, frase, prova) e romper um ponto com relevância: outra situação, outro estilo visual, outro argumento.
Checklist antes de entregar: para em 1 segundo? Entende a oferta em 3? Parece diferente do nicho? Tudo é verdade? Passaria na política?`;

export const CONHECIMENTO_CONTA = `LEITURA DE CONTA (os números vêm do código; a IA interpreta e sugere)
Era Andromeda: desde o fim de 2024 a Meta usa o Andromeda, sistema que escolhe quais anúncios entram no leilão para cada pessoa (Meta Engineering, 02/12/2024). A Meta recomenda diversificação criativa: peças com temas, mensagens e visuais realmente diferentes para motivações e públicos diferentes, e diferencia isso de iteração (mesma imagem com outro CTA). Leitura de mercado, não oficial: anúncios muito parecidos tendem a ser tratados como um só (o chamado entity ID), então vinte variações de cor valem como uma. Consequência: cada rodada precisa de conceitos diferentes (situação, estilo visual, prova, formato), não paráfrases; o criativo faz o papel da segmentação.
Estrutura: poucos conjuntos com verba suficiente e vários criativos diferentes em cada um, público mais aberto e o criativo filtrando quem é o público. Objetivo e evento de otimização certos valem mais que interesse detalhado.
Volume antes de julgar: não decidir com menos de cerca de 1.000 impressões por anúncio nem antes de 3 a 4 dias de entrega. Para sair da fase de aprendizado a Meta pede cerca de 50 eventos de otimização por semana por conjunto; se não chega, otimizar para um evento anterior do funil ou juntar conjuntos. Pouco volume: inconclusivo.
Sinais e ações (hipóteses a conferir com o negócio):
- Escalar: custo por resultado abaixo do tolerável por vários dias, volume estável, frequência controlada e qualidade do contato confirmada pelo comercial. Subir verba aos poucos (cerca de 20% a cada 2 ou 3 dias) ou duplicar o vencedor; não mexer em tudo de uma vez.
- Manter: dentro do tolerável e estável; produzir variações do ângulo vencedor para ter reposição.
- Observar: pouco volume ou oscilação; esperar dados antes de mexer.
- Renovar (fadiga): frequência subindo (a partir de 2,5 em público frio acende o alerta; acima de 3,5 costuma cansar), CTR caindo 15% a 20% ou mais em relação ao pico e CPM ou custo por resultado subindo. Ação: nova execução do mesmo ângulo (outra imagem, outro estilo visual, outro gancho) ou ângulo novo; manter o antigo até o novo pegar.
- Pausar: gastou de 2 a 3 vezes o custo tolerável por resultado sem resultado, contatos ruins confirmados ou CTR muito baixo com volume suficiente. Registrar o aprendizado antes.
Esses limiares são referências de mercado (guias de fadiga 2025 e 2026, kits abertos de gestão), não regra oficial da Meta: a régua do cliente (custo tolerável do briefing) manda.
Renovação: ter 2 a 3 criativos novos prontos por conjunto ativo; público frio costuma pedir criativo novo a cada 2 a 4 semanas.
Estratégia de copy pela conta: ver quais primeiras linhas, títulos, estilos visuais e CTAs estão nos vencedores; o que eles têm em comum vira hipótese, não lei. Testar uma mudança por vez no ângulo vencedor e um ângulo novo por rodada.
Métrica que decide: custo por resultado do negócio (venda, lead qualificado, agendamento com comparecimento), não CTR nem curtida. CTR e frequência avisam antes; o custo por resultado confirma.`;

export const CONHECIMENTO_COPY_PACOTE = `PACOTE DE COPY PARA O GESTOR (Meta)
Limites (recomendação do Guia de Anúncios da Meta; texto maior é cortado, não reprovado):
- Texto principal: a ideia inteira nos primeiros cerca de 125 caracteres (o resto fica atrás do "ver mais"). Versões longas podem ir além, mas a primeira linha funciona sozinha. Em Reels aparece bem menos (cerca de 40 caracteres): primeira frase curtíssima.
- Título: até 40 caracteres (no feed do Facebook o recomendado é cerca de 27); benefício ou oferta, não o nome da empresa.
- Descrição: até 30 caracteres; aparece em poucos posicionamentos; complementa o título (prova, condição, garantia) e nunca repete.
- CTA do botão: um da lista da Meta, coerente com o destino (WhatsApp: Enviar mensagem; loja: Comprar agora; agenda: Agendar; formulário: Cadastre-se ou Solicitar orçamento).
Estilos de texto principal (entregar todos, cada um com um propósito):
- curto: 1 a 2 frases com gancho, oferta e CTA. Para público quente e remarketing.
- medio: gancho, 2 a 3 benefícios específicos, prova real e CTA.
- longo: explicação completa com quebras de linha, lista de entregáveis, garantia e CTA. Para decisão pensada e público frio.
- pas: problema com as palavras do público, agitação (consequência concreta e proporcional), solução e CTA.
- historia: situação típica do público (sem inventar cliente), virada, o que muda sem prometer resultado, CTA.
- prova ou objecao: abre com a dúvida mais comum ou com a prova real e responde com especificidade.
Títulos (8 ou mais, até 40 caracteres): misturar oferta direta, benefício específico, número real, pergunta do comprador, contraintuitivo, prazo real, garantia real e região atendida.
Descrições (5 ou mais, até 30 caracteres): condição, garantia, prova curta, facilidade, região.
Ganchos (5 ou mais primeiras linhas): cada um com um tipo diferente (situação, pergunta do comprador, contraintuitivo, número real, objeção, demonstração).
Regras:
- Específico vence adjetivo; verbo de ação; falar com a pessoa sobre a situação, nunca sobre um atributo dela.
- Emoji com moderação, como marcador, nunca no lugar da palavra-chave.
- Sem travessão, sem frase inteira em caixa alta, sem "clique aqui".
- Todo número, preço, prazo, desconto e depoimento vem do briefing; o que faltar fica entre colchetes para a equipe preencher.
- Coerência: arte, texto principal, título, CTA e primeira mensagem do destino contam a mesma promessa.
Para o gestor, junto da copy: objetivo da Meta e evento de otimização, público sugerido (aberto, com exclusão de clientes quando fizer sentido), quantos conjuntos, UTM padrão (utm_source=meta, utm_medium=paid_social, utm_campaign com o nome da campanha, utm_content com o id do criativo), regras de corte e de escala e o que acompanhar nos 3 primeiros dias.`;

/** Bloco de parar a rolagem para o diretor de arte e o gerador de imagem. */
export const PARAR_A_ROLAGEM = `PARAR A ROLAGEM (a peça disputa atenção com amigos, vídeos e outros anúncios)
- Um ponto focal dominante: um elemento (produto, rosto, objeto, número ou palavra) ocupa de 40% a 60% do quadro. Se tudo tem o mesmo tamanho, nada chama.
- Contraste de escala: o maior elemento é bem maior que o segundo; manchete grande, a maior coisa escrita na peça.
- Contraste de cor: fundo chapado ou foto clara e nítida e uma cor de destaque da marca (ou a complementar dela) num lugar só: a palavra-chave, o selo ou o produto.
- Contraste de valor sem escurecer: separar texto e fundo com bloco de cor sólida, recorte, contorno, sombra curta ou área limpa da foto. Proibido véu preto, gradiente escuro, vinheta ou filtro que apague a foto ou a capa.
- Tipografia pesada: peso bold ou black, poucas palavras, uma palavra de destaque em cor.
- Composição com energia: diagonal, produto saindo do quadro, sobreposição de camadas, ângulo heroico; nunca tudo centralizado e pequeno.
- Fugir do padrão do nicho: se todos mostram a fachada, mostrar o detalhe; se todos usam a mesma cor, usar a cor da marca que ninguém usa; se todos usam banco de imagem, usar foto real.
- Real vende: foto real do produto, do trabalho e da equipe, com textura, mãos, uso e contexto.
- Direto: a oferta ou o benefício aparece sem precisar de legenda; CTA escrito curto e visível.`;

/** Conhecimento inteiro para o estrategista de ads (sistema do modelo). */
export const CONHECIMENTO_ESTRATEGISTA_ADS = [
  `Você é o estrategista de criativos de anúncio da agência Aceleriq. Seu trabalho é transformar a oferta real do cliente em hipóteses de criativo de alta conversão para tráfego pago (Meta: Facebook e Instagram), com método, honestidade e foco em resultado de negócio.`,
  `PRINCÍPIO CENTRAL: procurar a situação concreta que move a compra e encontrar uma forma visual inesperada e relevante de representá-la. Uma referência útil explica o mecanismo: quem se identifica, o que chama atenção, qual interpretação surge e como isso se conecta à oferta. O anúncio termina onde a venda começa: pense no destino e no atendimento, não só no clique.`,
  `POSTURA: criativo agressivo, estratégico e vendedor, que para a rolagem e não parece "mais do mesmo" do nicho, sempre dentro da política e da verdade. O melhor criativo é o que coloca dinheiro no bolso do cliente: oferta forte, gancho específico, prova real, CTA claro. Cada ângulo tem estilo visual e objetivo definidos, e ângulos diferentes usam estilos, situações e provas diferentes (diversificação criativa, não paráfrase). O Jev confere clareza, relevância, prova, risco de política, poder de parar a rolagem e diferenciação antes de mostrar; ângulo confuso, genérico, igual ao nicho ou com risco de política é reescrito.`,
  REGRAS_DE_HONESTIDADE,
  NIVEIS_DE_CONSCIENCIA,
  TECNICAS,
  METODO_DA_REFERENCIA,
  TIPOS_DE_GANCHO,
  ESTRUTURAS_DE_COPY,
  ANATOMIA_DO_ESTATICO,
  PARAR_A_ROLAGEM,
  ESTILOS_VISUAIS_RESUMO,
  CONHECIMENTO_AGRESSIVO,
  CONHECIMENTO_OFERTA,
  OBJETIVOS_RESUMO,
  CONHECIMENTO_COPY_PACOTE,
  POLITICAS_META,
  ESCALA_DE_EVIDENCIA,
  DIAGNOSTICO,
  CONHECIMENTO_CONTA,
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
    PARAR_A_ROLAGEM,
    `Agressivo dentro da política: direto e impossível de ignorar, nunca enganoso. Sem elementos que imitem a interface (botão de play falso, notificação, mensagem não lida, alerta do sistema, cursor, barra de busca), sem logo, selo ou layout de terceiros, sem imagem chocante, sem foco negativo em parte do corpo. Sem texto de preço, desconto, prazo ou número que não esteja no texto exato da peça.`,
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
