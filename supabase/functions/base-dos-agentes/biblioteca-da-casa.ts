/**
 * Biblioteca da casa (23/10/2026). Dono: "carregue de documentos e informações
 * relevantes todos os agentes para evoluir". Conteúdo humanizado, claro, com
 * contexto forte, gancho poderoso, mundo real e potencial viral; criativos que
 * vendem; campanhas comerciais; composição de imagem que chama atenção.
 *
 * Documentos curtos, originais e práticos, escritos pela casa (nada copiado de
 * terceiros, nenhum número sem fonte pública). Cada um vira uma ficha geral do
 * agente (fonte "Biblioteca da casa", fonte_url "biblioteca:<versão>/<agente>/<slug>").
 *
 * Este módulo NÃO entra no bundle da função (o index.ts não o importa): ele é a
 * fonte do seed. O SQL sai do gerador ao lado:
 *   deno run --allow-read --allow-write supabase/functions/base-dos-agentes/gerar-seed-da-biblioteca.ts
 * e grava supabase/migrations/20261023110000_biblioteca_da_casa.sql.
 * Módulo puro e sem import: a suíte do front também o lê.
 */

export const VERSAO_DA_BIBLIOTECA = "2026-10-23";

export interface DocumentoDaCasa {
  slug: string;
  titulo: string;
  tecnica: string;
  quando_usar: string;
  exemplo: string;
}

export const BIBLIOTECA_DA_CASA: Record<string, DocumentoDaCasa[]> = {
  // ---------------------------------------------------------------- Estúdio: diretor de arte
  "estudio.diretor": [
    {
      slug: "capa-uma-promessa",
      titulo: "Capa com uma promessa só",
      tecnica: "A capa carrega uma ideia e um benefício concreto, em poucas palavras que se leem de longe. Título grande, contraste alto e um elemento visual que prova o assunto (o produto, a pessoa, o lugar real). Logo pequena ou nenhuma, sem data, selo ou ícone competindo. Se a capa só faz sentido com subtítulo, o título está fraco: reescreva antes de mexer no visual.",
      quando_usar: "Capa de carrossel e post único de feed.",
      exemplo: "\"3 erros que deixam seu cardápio caro\" sobre a foto real do prato, com o 3 bem maior que o resto.",
    },
    {
      slug: "uma-ideia-por-lamina",
      titulo: "Uma ideia por lâmina",
      tecnica: "Cada lâmina responde uma pergunta só. Frase principal curta (até umas 15 palavras) e, se precisar, um apoio menor. Se o texto passa de três linhas na tela do celular, quebre em duas lâminas. Lâmina que só enfeita sai. A última lâmina retoma a promessa da capa já resolvida e pede uma ação.",
      quando_usar: "Todo carrossel educativo, lista ou passo a passo.",
      exemplo: "Lâmina 4: \"Responda em até 5 minutos\" (grande) + \"quem responde rápido fecha antes do concorrente\" (menor).",
    },
    {
      slug: "hierarquia-tres-niveis",
      titulo: "Hierarquia em três níveis e um ponto focal",
      tecnica: "Organize o texto em três níveis: título (o que se lê primeiro), apoio (o porquê) e detalhe (preço, condição, prazo). A diferença de tamanho entre os níveis precisa ser óbvia, com o título perto do dobro do apoio. Um só ponto focal por lâmina: o olho entra pelo maior contraste, então é ali que fica a informação que vende.",
      quando_usar: "Arte com oferta, comparação ou muita informação.",
      exemplo: "Oferta: \"Limpeza + clareamento\" (título), \"avaliação sem custo\" (apoio), \"até 30/11, agenda pelo WhatsApp\" (detalhe).",
    },
    {
      slug: "legivel-no-celular",
      titulo: "Legível na mão, sem zoom",
      tecnica: "O post é visto num celular, rolando rápido. No máximo duas famílias de fonte; nada de fonte fina ou script sobre foto; caixa alta só em títulos curtos; texto escuro em fundo claro ou o contrário, nunca cinza sobre imagem. Teste antes de entregar: reduza a arte ao tamanho do feed. Se não lê, aumente a letra ou corte palavra.",
      quando_usar: "Conferência final de qualquer arte com texto.",
      exemplo: "Trocar um parágrafo de 40 palavras por \"Seu site demora? Você perde o cliente no 1º clique\" em corpo grande.",
    },
    {
      slug: "foto-real-intacta",
      titulo: "Foto real primeiro, e intacta",
      tecnica: "Produto, equipe, loja e cliente reais (com autorização) passam mais confiança que ilustração genérica. Regra da casa: a foto real do cliente não é redesenhada (rosto, produto e logo ficam como são); o texto vai só na área livre; a logo entra pelo código, nunca pelo gerador de imagem. A imagem gerada serve para cenário e apoio, não para fingir o produto.",
      quando_usar: "Sempre que o cliente tiver foto própria no acervo.",
      exemplo: "Foto da fachada real com faixa escura no rodapé para o texto, em vez de uma fachada inventada.",
    },
    {
      slug: "carrossel-que-salva",
      titulo: "Estrutura de carrossel que a pessoa salva",
      tecnica: "Capa com promessa; lâmina 2 com o problema dito do jeito que o cliente fala; depois os passos práticos, cada um com um exemplo concreto (frase pronta, número, print); uma lâmina de resumo que dá vontade de salvar; e a chamada. Trate a lâmina 2 como uma segunda capa, porque nem todo mundo começa pela primeira. Carrossel útil é o que a pessoa volta para consultar.",
      quando_usar: "Conteúdo de autoridade e de topo de funil.",
      exemplo: "\"Como responder quem pergunta o preço no direct\": problema, 3 respostas prontas, resumo, \"salva pra usar hoje\".",
    },
    {
      slug: "cor-da-marca-com-funcao",
      titulo: "Cor da marca com função",
      tecnica: "A paleta do cliente manda. Fundo neutro e uma cor de destaque usada só no que vende: preço, palavra-chave, chamada. Uma marca nunca herda cor, logo ou foto de outra marca do mesmo cliente (marca vazia fica vazia, não pega emprestado). Evite gradiente, neon e brilho que não pertencem à marca: chamam atenção para o efeito, não para a oferta.",
      quando_usar: "Definir cor de fundo, destaque e chamada da peça.",
      exemplo: "Marca de cor vinho: fundo creme, preço em vinho, resto em grafite.",
    },
    {
      slug: "post-de-caso-voz-da-casa",
      titulo: "Post de caso de cliente na voz da agência",
      tecnica: "Quando a peça mostra um trabalho feito para cliente, quem fala é a Aceleriq, em \"a gente\": o problema que o cliente tinha, as decisões (\"a gente começou pelo nome\"), o porquê de cada uma e o resultado. Marque o @ do cliente e feche com um convite para quem tem negócio parecido. Dados só do material do próprio cliente. Na arte: processo e antes e depois reais.",
      quando_usar: "Portfólio, bastidor de projeto e prova social da agência.",
      exemplo: "\"A @padaria chegou com 3 logos diferentes na fachada. A gente começou pela pergunta: o que o bairro já chama de vocês?\"",
    },
    {
      slug: "anti-generico",
      titulo: "O que denuncia arte genérica",
      tecnica: "Sinais de arte feita no automático: pessoa sorrindo para a câmera sem contexto, aperto de mão, foguete, lâmpada, ícone 3D brilhante, gráfico subindo, mãos estranhas e frases vagas como \"transforme seu negócio\". Troque por uma cena específica do negócio, um objeto real e uma frase que nomeia o problema ou traz um número verdadeiro do cliente.",
      quando_usar: "Revisão de conceito antes de gerar a imagem.",
      exemplo: "Em vez de foguete para \"cresça nas vendas\", o balcão cheio numa sexta à noite.",
    },
  ],

  // ---------------------------------------------------------------- Estúdio: pedido de imagem
  "estudio.imagem": [
    {
      slug: "anatomia-do-pedido",
      titulo: "Anatomia de um pedido de imagem",
      tecnica: "Escreva na ordem: sujeito (o quê, com detalhe físico), ação, cenário, luz, lente e enquadramento, estilo fotográfico, paleta e onde fica a área livre para o texto. Uma cena por pedido. Detalhes concretos (\"xícara de louça branca lascada na borda\") rendem mais que adjetivos (\"linda, incrível\").",
      quando_usar: "Todo layout.imagem escrito pelo diretor.",
      exemplo: "\"Mão de barista servindo café coado numa xícara branca, balcão de madeira, luz de janela lateral, 50mm, foto documental, terço superior livre.\"",
    },
    {
      slug: "luz-que-vende",
      titulo: "Luz que vende por tipo de produto",
      tecnica: "Comida e produto artesanal: luz de janela lateral, suave, com sombra leve que mostra textura. Bebida e vidro: contraluz para o líquido brilhar. Moda e editorial: luz mais dura e direcional, sombra marcada. Serviço e ambiente: luz natural de dia, ambiente arrumado mas vivido. Peça a luz pelo nome da situação, não só \"bem iluminado\".",
      quando_usar: "Escolher a luz de qualquer cena.",
      exemplo: "\"Copo de suco de laranja em contraluz de fim de tarde, gotas na parede do copo.\"",
    },
    {
      slug: "lente-e-angulo",
      titulo: "Lente e ângulo com intenção",
      tecnica: "Lente normal (perto de 50mm) para cena natural; retrato (85mm) para pessoa com fundo desfocado; macro para textura de produto; plano aberto para mostrar o lugar. Comida: 45 graus ou de cima (flat lay). Produto de prateleira: na altura do olho. Pessoa trabalhando: por cima do ombro, como se o cliente estivesse ali.",
      quando_usar: "Definir enquadramento e ponto de vista.",
      exemplo: "\"Por cima do ombro da dentista mostrando o raio-x na tela ao paciente, 35mm.\"",
    },
    {
      slug: "area-livre-para-texto",
      titulo: "Espaço reservado para o texto",
      tecnica: "Se a arte leva título, o pedido precisa dizer onde fica o vazio: \"terço superior com parede lisa\", \"céu limpo à esquerda\", \"fundo desfocado à direita\". Sujeito do lado oposto ao texto. Sem isso o modelo enche a imagem e o texto briga com o detalhe.",
      quando_usar: "Capa, anúncio e qualquer lâmina com título sobre foto.",
      exemplo: "\"Produto no terço inferior direito, parede de cimento lisa ocupando a metade de cima.\"",
    },
    {
      slug: "realismo-de-mundo-real",
      titulo: "Realismo de mundo real",
      tecnica: "Peça imperfeição: textura de pele, fio solto, migalha, marca de uso, reflexo, objetos do dia a dia no fundo. Use \"foto documental\" ou \"foto de celular bem feita\" quando a peça precisa parecer feita pelo cliente (estética de criador), e \"still de estúdio\" só para catálogo. Evite plástico, pele lisa demais e simetria perfeita.",
      quando_usar: "Peças que precisam parecer reais e próximas.",
      exemplo: "\"Bancada de oficina com graxa, ferramenta gasta, luz fluorescente, foto de celular.\"",
    },
    {
      slug: "serie-consistente",
      titulo: "Consistência de série",
      tecnica: "Num carrossel ou campanha, repita entre as imagens: a mesma luz, o mesmo ângulo, o mesmo fundo e a mesma paleta. Mude só o que conta a história (o produto, o passo, a pessoa). Descreva os elementos fixos com as mesmas palavras em todos os pedidos.",
      quando_usar: "Carrossel com mais de uma imagem e campanha com várias peças.",
      exemplo: "Fixo: \"mesa de mármore branco, luz de janela à esquerda, 45 graus\"; muda: o doce de cada lâmina.",
    },
    {
      slug: "texto-e-logo-fora-do-modelo",
      titulo: "Texto e logo fora do modelo",
      tecnica: "Logo nunca vai no pedido de imagem: ela entra pelo código, com o arquivo oficial. Texto dentro da imagem só quando for parte da cena (placa, embalagem), curto, entre aspas e com a fonte descrita. Título, preço e chamada vão pelo layout. Nada de pessoa famosa, personagem ou marca de terceiro na cena.",
      quando_usar: "Toda vez que a peça tem marca, preço ou título.",
      exemplo: "\"Placa de giz escrita 'Pão quente às 17h' em letra cursiva branca\" é cena; o preço da promoção vai no layout.",
    },
  ],

  // ---------------------------------------------------------------- Mesa do cliente: Agente do Mês
  "mes.estrategista": [
    {
      slug: "mix-do-mes",
      titulo: "Mix do mês: útil, prova, bastidor, oferta e relação",
      tecnica: "Distribua o mês entre cinco funções: útil (ensina algo que o cliente salva e manda para alguém), prova (caso, avaliação, antes e depois real), bastidor (como é feito, quem faz), oferta (o que comprar, como e até quando) e relação (opinião, enquete, história do dono). Oferta sem útil e prova antes cansa; útil sem oferta não vende.",
      quando_usar: "Montar o calendário de qualquer cliente.",
      exemplo: "Semana: carrossel útil na segunda, Reel de bastidor na quarta, prova na quinta, oferta na sexta.",
    },
    {
      slug: "tema-de-demanda-real",
      titulo: "Tema nasce de demanda real",
      tecnica: "Antes de inventar tema, olhe o que o público pergunta: comentários e direct do cliente, perguntas no WhatsApp, avaliações do Google, buscas do Google na cidade, comentários dos maiores vídeos do nicho. Um tema bom é algo que o cliente final quer saber, dito nas palavras dele. Tema que só o dono acha interessante fica para depois.",
      quando_usar: "Escolha dos temas da semana.",
      exemplo: "Pergunta repetida no WhatsApp da pizzaria: \"qual é a mais pedida?\" vira Reel do ranking da casa.",
    },
    {
      slug: "util-que-salva",
      titulo: "Conteúdo útil que salva e compartilha",
      tecnica: "A linha da casa é marketing na prática: apontar erro comum, adiantar uma ideia, ensinar a se diferenciar, inspirar e dar autoridade, sempre num assunto que o cliente do cliente quer saber. O teste do tema: alguém mandaria para um amigo? alguém salvaria para usar depois? Se nenhum dos dois, troque.",
      quando_usar: "Filtrar a lista de temas do mês.",
      exemplo: "Ótica: \"como saber se a armação combina com seu rosto em 10 segundos\" (salva e manda).",
    },
    {
      slug: "datas-do-varejo",
      titulo: "Datas do varejo brasileiro",
      tecnica: "Calendário comercial fixo: volta às aulas (jan/fev), Carnaval e Páscoa (móveis), Dia da Mulher (8/3), Dia do Consumidor (15/3), Dia das Mães (2º domingo de maio), Dia dos Namorados (12/6), festas juninas, Dia dos Pais (2º domingo de agosto), Dia do Cliente (15/9), Dia das Crianças (12/10), Black Friday (última sexta de novembro) e Natal. Use só as que o negócio vende de verdade e comece o aquecimento semanas antes.",
      quando_usar: "Planejar mês com data comercial.",
      exemplo: "Ótica no Dia dos Pais: aquecimento duas semanas antes com \"ele ainda usa óculos de 2015?\".",
    },
    {
      slug: "campanha-por-fase",
      titulo: "Campanha comercial em fases",
      tecnica: "Toda campanha tem fases: aquecimento (problema e desejo, sem preço), abertura (oferta clara: o quê, quanto, até quando, como comprar), sustentação (prova, dúvidas, bastidor, quem já comprou) e última chamada (prazo real acabando). Cada fase tem peças próprias. A fase sai da data, nunca do humor do dia.",
      quando_usar: "Qualquer data comercial ou lançamento.",
      exemplo: "Black Friday: semana 1 aquece, semana 2 abre, semana 3 prova, dia final última chamada.",
    },
    {
      slug: "hype-responsavel",
      titulo: "Hype e assunto do momento com responsabilidade",
      tecnica: "Use o assunto do momento quando ele cabe no negócio em uma frase, sem forçar. Fuja de tragédia, política partidária, religião, doença e briga de famosos. Velocidade importa: hype vale enquanto as pessoas falam dele. A peça liga o assunto a uma dica ou oferta do cliente, nunca é só a piada.",
      quando_usar: "Encaixar tendência ou notícia no mês.",
      exemplo: "Lançamento de celular famoso: assistência técnica faz \"o que conferir antes de vender o seu usado\".",
    },
    {
      slug: "frequencia-sustentavel",
      titulo: "Frequência que o cliente sustenta",
      tecnica: "Melhor um ritmo menor feito todo mês do que muito em uma semana e nada na outra. Planeje o que a equipe consegue gravar e aprovar. Reels e carrosséis carregam o alcance e o salvamento; stories carregam a relação e a venda do dia. Deixe uma vaga por semana para assunto do momento.",
      quando_usar: "Definir quantidade e formatos do mês.",
      exemplo: "Cliente que grava pouco: 2 Reels com o dono por semana + 1 carrossel + stories diários de bastidor.",
    },
    {
      slug: "nicho-odontologia",
      titulo: "Nicho: odontologia",
      tecnica: "O medo e a vergonha travam a decisão (dor, preço, julgamento). Funciona: explicar procedimento em linguagem simples, desmontar mito (\"clareamento estraga o dente?\"), mostrar o ambiente e a equipe, rotina de cuidado em casa. Publicidade de saúde segue as regras do conselho da profissão (CFO): confira as normas vigentes sobre preço, promoção e imagem de paciente antes de publicar.",
      quando_usar: "Clientes de clínica odontológica e dentista.",
      exemplo: "Reel \"o que acontece na primeira consulta, passo a passo\" para tirar o medo.",
    },
    {
      slug: "nicho-advocacia-previdenciario",
      titulo: "Nicho: advocacia e previdenciário",
      tecnica: "A OAB permite conteúdo informativo e proíbe captação de clientela, promessa de resultado e mercantilização (Provimento 205/2021). Então: explicar direitos em linguagem simples, responder dúvidas reais (\"tenho direito ao auxílio se...\"), alertar sobre prazos e golpes. Nada de \"ganhe sua causa\", preço ou caso de cliente identificável. No previdenciário o público costuma ser mais velho: letra grande, fala calma, exemplo do dia a dia.",
      quando_usar: "Escritórios de advocacia, em especial previdenciário.",
      exemplo: "\"3 documentos que você precisa juntar antes de pedir a aposentadoria\".",
    },
    {
      slug: "nicho-informatica",
      titulo: "Nicho: informática e assistência técnica",
      tecnica: "O cliente chega com urgência e desconfiança (medo de ser enganado no orçamento). Funciona: diagnóstico na tela, \"vale a pena consertar ou trocar\", cuidados que evitam defeito, golpes comuns, bastidor da bancada. Prova é mostrar o defeito e a solução reais. Oferta forte: avaliação clara, prazo e garantia ditos sem letra miúda.",
      quando_usar: "Assistência técnica, loja de informática, celular.",
      exemplo: "\"Notebook esquentando: 3 sinais de que é só limpeza (e não placa)\".",
    },
    {
      slug: "nicho-alimentacao",
      titulo: "Nicho: alimentação",
      tecnica: "Comida vende pelo olho e pelo som: close, vapor, crocância, queijo puxando, gente comendo de verdade. Funciona: bastidor do preparo, o mais pedido, combo do dia, horário e como pedir em uma frase. Datas e clima mudam a vontade (frio pede caldo, calor pede açaí). Oferta simples: o quê, preço, até quando, link ou WhatsApp.",
      quando_usar: "Restaurante, lanchonete, padaria, delivery, doceria.",
      exemplo: "Reel de 10 segundos do corte da pizza com som do crocante e \"sexta tem rodízio, chama no zap\".",
    },
    {
      slug: "nicho-moda",
      titulo: "Nicho: moda",
      tecnica: "Moda vende pela pessoa vestindo, não pela peça no cabide. Funciona: provador real, \"3 jeitos de usar a mesma peça\", look para ocasião (trabalho, festa, fim de semana), tamanhos variados, chegou novidade. Mostre caimento em movimento e detalhe de tecido. Prova: cliente usando (com autorização). Oferta: estoque real e prazo de verdade.",
      quando_usar: "Loja de roupa, calçado, acessório.",
      exemplo: "\"Uma calça, três encontros: trabalho, almoço, barzinho\" em cortes rápidos.",
    },
    {
      slug: "nicho-estetica",
      titulo: "Nicho: estética e beleza",
      tecnica: "Desejo de autoestima com medo de resultado artificial ou de dor. Funciona: explicar o procedimento e o tempo de recuperação, desmontar mito, rotina de cuidado, ambiente e higiene, a profissional explicando. Antes e depois e promessa de resultado têm regras do conselho profissional e da política da Meta: confira antes de usar e nunca prometa resultado garantido.",
      quando_usar: "Clínica de estética, salão, sobrancelha, cílios, depilação.",
      exemplo: "\"O que ninguém te conta sobre o primeiro dia depois da limpeza de pele\".",
    },
    {
      slug: "nicho-imobiliario",
      titulo: "Nicho: imobiliário",
      tecnica: "Imóvel vende pela vida que cabe nele. Funciona: tour em vídeo como se a pessoa chegasse em casa, bairro (padaria, escola, trajeto), \"quanto custa morar aqui\" com dado verdadeiro, dúvidas de financiamento em linguagem simples, bastidor do corretor. Anúncio de imóvel pode cair em categoria especial da Meta, com público restrito: planeje o criativo para falar com todos.",
      quando_usar: "Corretor, imobiliária, construtora, aluguel.",
      exemplo: "\"Uma manhã de sábado neste apartamento\" mostrando luz, varanda e a feira da rua.",
    },
    {
      slug: "nicho-servicos-locais",
      titulo: "Nicho: serviços locais",
      tecnica: "Oficina, salão, pet shop, academia, eletricista: o cliente escolhe por confiança e proximidade. Funciona: o dono aparecendo, o serviço sendo feito, cliente real satisfeito, dica que evita prejuízo, preço justo explicado. Cuide do Perfil da Empresa no Google (fotos, horário, avaliações respondidas), porque é onde a busca local termina.",
      quando_usar: "Qualquer negócio de bairro que vende serviço.",
      exemplo: "Oficina: \"barulho no freio? 3 causas, da mais barata para a mais cara\".",
    },
  ],

  // ---------------------------------------------------------------- Mesa do cliente: motor de contexto
  "contexto.agente": [
    {
      slug: "mapa-do-publico",
      titulo: "Mapa do público em palavras reais",
      tecnica: "Para cada público, anote quatro coisas: a dor (o que incomoda hoje), o desejo (como fica quando resolve), a objeção (por que ainda não comprou) e a linguagem (as palavras que ele usa). A linguagem vem de avaliações do Google, comentários, direct e WhatsApp, não de suposição. Público é gente com situação, não faixa etária.",
      quando_usar: "Montar ou revisar o contexto de qualquer cliente.",
      exemplo: "\"Mãe que trabalha fora e chega às 19h sem tempo de cozinhar\" no lugar de \"mulheres de 25 a 45\".",
    },
    {
      slug: "proposta-de-valor",
      titulo: "Proposta de valor em uma frase",
      tecnica: "Escreva: para quem, o que resolve, por que diferente das alternativas e qual a prova. Se a frase serve para qualquer concorrente, ainda não é proposta. Diferença real costuma estar em um detalhe operacional (prazo, garantia, atendimento, especialidade, origem) que o dono acha óbvio e nunca conta.",
      quando_usar: "Posicionamento e briefing de campanha.",
      exemplo: "\"Conserto de notebook em Curitiba com orçamento na hora e o defeito mostrado na tela antes de você aprovar.\"",
    },
    {
      slug: "espaco-vazio-da-concorrencia",
      titulo: "Achar o espaço vazio da concorrência",
      tecnica: "Liste o que os concorrentes dizem. O que todos dizem (qualidade, atendimento, preço justo) é ruído e não diferencia. Procure o que ninguém fala, o formato que ninguém usa e a dúvida que ninguém responde. Olhe também as reclamações nas avaliações dos concorrentes: elas apontam a promessa que o cliente pode cumprir melhor.",
      quando_usar: "Análise de concorrência e definição de ângulo.",
      exemplo: "Todas as pizzarias falam de sabor; nenhuma mostra o tempo de entrega real. Esse vira o ângulo.",
    },
    {
      slug: "inventario-de-prova",
      titulo: "Inventário de prova",
      tecnica: "Levante o que o cliente pode provar: avaliações com texto, prints de conversa (com autorização), antes e depois reais, tempo de mercado, quantidade de atendimentos que ele mesmo registra, certificados, casos, rosto da equipe. Prova é o que separa promessa de fato. Sem prova, o contexto marca a lacuna e sugere como produzir.",
      quando_usar: "Contexto novo e preparação de anúncio.",
      exemplo: "\"Tem 180 avaliações no Google com média 4,9\" só entra se estiver no perfil; senão vira tarefa: pedir avaliações.",
    },
    {
      slug: "oferta-e-porta-de-entrada",
      titulo: "Oferta principal e porta de entrada",
      tecnica: "Separe o que dá lucro (oferta principal) do que traz o cliente pela primeira vez (porta de entrada: avaliação, aula experimental, combo, primeira visita). Para cada uma: o que é, preço ou condição, para quem, como comprar. Campanha boa leva para a porta de entrada e o atendimento leva para a principal.",
      quando_usar: "Contexto de oferta e planejamento de anúncios.",
      exemplo: "Estética: porta de entrada é avaliação de pele; principal é o pacote de 4 sessões.",
    },
    {
      slug: "tom-de-voz-faca-nao-faca",
      titulo: "Tom de voz em três adjetivos",
      tecnica: "Defina a voz da marca com três adjetivos e, para cada um, um faça e um não faça com frase de exemplo. Ex.: próximo (faça: \"você\"; não faça: \"prezado cliente\"). Inclua palavras proibidas e expressões que o dono usa de verdade. Voz é o que deixa o texto reconhecível sem a logo.",
      quando_usar: "Primeiro contexto e quando o cliente reclama que \"não parece a gente\".",
      exemplo: "Padaria de bairro: acolhedora, bem-humorada, simples. Nunca \"experiência gastronômica\".",
    },
    {
      slug: "lacuna-vira-pergunta",
      titulo: "Lacuna vira pergunta, não invenção",
      tecnica: "Quando falta dado (preço, prazo, diferencial, número), o contexto não inventa: registra a lacuna e gera a pergunta certa para o cliente, curta e fácil de responder. Número só com fonte (o próprio cliente ou fonte pública citada). Cada marca de um mesmo cliente tem contexto próprio: nada passa de uma marca para outra.",
      quando_usar: "Sempre que o material do cliente não responde algo.",
      exemplo: "\"Qual o prazo médio de entrega de vocês hoje?\" em vez de escrever \"entrega rápida\".",
    },
  ],

  // ---------------------------------------------------------------- Mesa Ads: estático
  "ads.estatico": [
    {
      slug: "pas",
      titulo: "PAS: problema, agitação, solução",
      tecnica: "Nomeie o problema como o cliente sente, agite com a consequência concreta (tempo, dinheiro, vergonha, risco) e apresente a solução com a oferta e o próximo passo. Funciona bem para serviço que resolve dor clara. Agitar é mostrar consequência real, não assustar nem exagerar.",
      quando_usar: "Anúncio de serviço que resolve um problema conhecido.",
      exemplo: "\"Celular desligando com 30% de bateria? Daqui a pouco ele não liga mais. Troca de bateria em 1 hora, com garantia.\"",
    },
    {
      slug: "aida",
      titulo: "AIDA: atenção, interesse, desejo, ação",
      tecnica: "Atenção com a imagem e a primeira linha; interesse com um detalhe específico; desejo com o benefício visto na vida da pessoa; ação com um pedido único e fácil. Use quando o produto vende por desejo (moda, comida, estética, viagem) mais do que por dor.",
      quando_usar: "Produto de desejo e oferta sazonal.",
      exemplo: "Foto da torta cortada; \"massa amanteigada feita às 6h\"; \"chega quentinha no café da tarde\"; \"peça até 14h pelo WhatsApp\".",
    },
    {
      slug: "angulos",
      titulo: "Ângulos para testar",
      tecnica: "Um mesmo produto rende anúncios diferentes por ângulo: dor, desejo, medo de perder, prova social, autoridade, comparação (antes e depois, nós e o jeito comum), novidade, objeção respondida e condição (preço, parcelamento, prazo). Teste ângulos diferentes antes de testar cor ou fonte: é o ângulo que muda o resultado.",
      quando_usar: "Planejar o conjunto de criativos de uma campanha.",
      exemplo: "Academia: dor (\"cansado de pagar e não ir\"), prova (aluno real), condição (\"primeira semana sem custo\").",
    },
    {
      slug: "para-o-dedo",
      titulo: "Criativo que para o dedo",
      tecnica: "Um elemento grande e claro (produto, rosto, resultado), contraste forte com o feed, texto curto na arte (uma frase), e algo que pareça real e não propaganda de banco de imagem. Peças com cara de post nativo costumam competir melhor no feed do que peças com cara de panfleto.",
      quando_usar: "Toda arte de anúncio estático.",
      exemplo: "Print real de conversa de WhatsApp com cliente elogiando, com uma frase grande por cima.",
    },
    {
      slug: "oferta-clara",
      titulo: "Oferta clara em quatro respostas",
      tecnica: "O anúncio responde: o que é, quanto custa (ou qual a condição), até quando e como comprar. Se falta uma resposta, a pessoa para no meio. Prazo e preço anunciados obrigam (o Código de Defesa do Consumidor vincula a oferta suficientemente precisa): só anuncie o que o cliente vai cumprir.",
      quando_usar: "Anúncio de oferta, promoção e data comercial.",
      exemplo: "\"Revisão completa por R$ 189 até sábado. Agende pelo WhatsApp.\" (com o preço confirmado pelo cliente).",
    },
    {
      slug: "politica-da-meta",
      titulo: "Política da Meta que derruba anúncio",
      tecnica: "Evite: afirmar ou sugerir atributo pessoal de quem vê (\"você está acima do peso?\", \"você tem dívidas?\"), antes e depois de corpo em saúde e emagrecimento, promessa de resultado garantido ou de renda, linguagem sensacionalista e prints falsos de interface. Imóvel, emprego e crédito podem cair em categoria especial de anúncio, com público restrito.",
      quando_usar: "Revisão de copy e arte antes de subir o anúncio.",
      exemplo: "Trocar \"Você tem manchas na pele?\" por \"Manchas na pele têm tratamento: veja como funciona\".",
    },
    {
      slug: "primeira-linha",
      titulo: "A primeira linha do texto principal",
      tecnica: "Só o começo do texto aparece antes do \"ver mais\". A primeira linha precisa funcionar sozinha: benefício, pergunta específica ou prova. Depois, frases curtas, um parágrafo por ideia e a chamada no fim. Título do anúncio curto e com a oferta.",
      quando_usar: "Escrever copy de anúncio de feed.",
      exemplo: "\"Seu ar-condicionado pinga? Em 90% dos casos é só limpeza\" só se o número vier do próprio técnico; senão: \"Na maioria das vezes é só limpeza\".",
    },
    {
      slug: "teste-uma-variavel",
      titulo: "Teste com uma variável por vez",
      tecnica: "Versão A e B mudam uma coisa só (o ângulo, a imagem ou a primeira linha) para o resultado ensinar algo. Comece pelo que mais pesa: ângulo, depois imagem, depois texto. Julgue pelo custo por resultado (mensagem, lead, venda), não por curtida. Gere opções a mais e escolha as melhores antes de subir, em vez de corrigir depois.",
      quando_usar: "Montar as versões A e B de cada ângulo.",
      exemplo: "A: foto do prato. B: foto do cliente comendo. Mesmo texto, mesma verba.",
    },
    {
      slug: "area-segura-vertical",
      titulo: "Área segura no vertical",
      tecnica: "Em Stories e Reels, a interface cobre o topo e a parte de baixo da tela (nome, legenda, botões). A Meta orienta deixar livres uma faixa no topo e uma faixa maior embaixo. Texto e produto no miolo; nada importante colado nas bordas. Faça a versão vertical própria, não um quadrado esticado.",
      quando_usar: "Toda peça 9:16 de anúncio.",
      exemplo: "Preço no centro da tela, chamada acima do botão, logo pequena no meio do topo, abaixo da faixa ocupada.",
    },
  ],

  // ---------------------------------------------------------------- Mesa Ads: vídeo
  "ads.video": [
    {
      slug: "tres-primeiros-segundos",
      titulo: "Os 3 primeiros segundos do anúncio",
      tecnica: "Abra com três ganchos juntos: visual (algo em movimento ou inesperado no primeiro quadro), falado (a dor ou o resultado na primeira frase) e escrito (a mesma ideia em texto grande). Nada de logo, vinheta ou \"oi, gente\" no começo: a marca aparece depois que a pessoa ficou.",
      quando_usar: "Todo anúncio em vídeo.",
      exemplo: "Primeiro quadro: tela de celular trincada caindo na mão; fala: \"Trincou? Não troca a tela inteira ainda.\"",
    },
    {
      slug: "estrutura-do-anuncio",
      titulo: "Estrutura de anúncio curto",
      tecnica: "Gancho, problema, demonstração (o produto funcionando ou o serviço sendo feito), prova (cliente real, avaliação, resultado), oferta e chamada. Cada parte em poucos segundos. Corte respiro e pausa: anúncio é mais denso que conteúdo orgânico.",
      quando_usar: "Roteiro de anúncio em vídeo.",
      exemplo: "Gancho com o problema, 5 s de antes e depois real, uma avaliação na tela, \"agenda pelo link\".",
    },
    {
      slug: "ugc-de-verdade",
      titulo: "UGC que parece de verdade",
      tecnica: "Gravado no celular, na vertical, com luz natural, em lugar real, por alguém falando como fala no dia a dia. Pode ter erro pequeno. Roteiro é guia, não texto decorado. O dono ou um cliente real costuma vender mais que ator perfeito. Nunca simule cliente que não existe.",
      quando_usar: "Anúncio de serviço local e produto de uso pessoal.",
      exemplo: "Dona da doceria no carro: \"acabei de entregar 40 brigadeiros e preciso te contar uma coisa\".",
    },
    {
      slug: "varios-ganchos-um-corpo",
      titulo: "Vários ganchos, um corpo",
      tecnica: "Grave o corpo do anúncio uma vez e de três a cinco ganchos diferentes. Cada gancho com ângulo próprio (dor, curiosidade, prova, preço). É o jeito mais barato de testar o que mais pesa no resultado: a abertura.",
      quando_usar: "Produção de anúncios para teste.",
      exemplo: "Ganchos: \"Pare de pagar caro em...\", \"Ninguém te conta isso sobre...\", \"Olha o que a Dona Lúcia achou...\".",
    },
    {
      slug: "legenda-e-som",
      titulo: "Legenda sempre, som pensado",
      tecnica: "Parte do público assiste sem som: legenda grande, com a palavra-chave destacada, dentro da área segura. Para quem está com som, a trilha fica bem abaixo da voz e o efeito sonoro marca a virada (não a frase inteira). Som vende: um bom áudio segura mais do que um efeito visual.",
      quando_usar: "Edição de qualquer anúncio em vídeo.",
      exemplo: "\"SEM fila\" com a palavra fila em destaque e um clique seco no corte.",
    },
    {
      slug: "demonstracao",
      titulo: "Demonstração vale mais que adjetivo",
      tecnica: "Mostre o produto resolvendo o problema na frente da câmera: a mancha saindo, o carro ficando pronto, a comida sendo montada, a tela do sistema funcionando. Se não dá para demonstrar, mostre o processo e a pessoa que faz. Adjetivo (\"o melhor\", \"incrível\") não convence ninguém.",
      quando_usar: "Produto com efeito visível e serviço com processo.",
      exemplo: "Lavagem de sofá: metade lavada, metade suja, e a escova passando na divisa.",
    },
    {
      slug: "chamada-unica",
      titulo: "Uma chamada só, dita e escrita",
      tecnica: "O final pede uma ação só: chamar no WhatsApp, agendar, comprar no link. Fale e escreva a mesma chamada, com o motivo para agir agora (vaga, prazo, estoque real). Duas chamadas diferentes dividem a atenção e derrubam a ação.",
      quando_usar: "Fechamento de todo anúncio em vídeo.",
      exemplo: "\"Chama no WhatsApp e fala 'quero a avaliação': só tem horário até quinta.\"",
    },
  ],

  // ---------------------------------------------------------------- Mesa Ads: gestor
  "ads.gestor": [
    {
      slug: "estrutura-enxuta",
      titulo: "Estrutura enxuta para aprender rápido",
      tecnica: "Poucas campanhas e poucos conjuntos, com verba concentrada, deixam o algoritmo aprender mais rápido do que muitos conjuntos pequenos. Separe por objetivo e por momento do funil, não por detalhe de público. Público amplo com criativos variados tende a funcionar melhor que segmentação apertada para negócio local com verba pequena.",
      quando_usar: "Montar ou reorganizar a conta de anúncios.",
      exemplo: "1 campanha de mensagens com 1 conjunto amplo na cidade e 4 a 6 criativos de ângulos diferentes.",
    },
    {
      slug: "objetivo-certo",
      titulo: "Objetivo de campanha certo para o negócio",
      tecnica: "Serviço local que fecha na conversa: objetivo de mensagens (WhatsApp ou direct). Serviço que precisa de agendamento e formulário: leads. Loja virtual com pixel funcionando: vendas. Alcance e engajamento só para lembrar a marca a quem já conhece. Objetivo errado otimiza para a pessoa errada.",
      quando_usar: "Escolher o objetivo de cada campanha.",
      exemplo: "Oficina mecânica: mensagens para WhatsApp, não tráfego para o site.",
    },
    {
      slug: "criativo-e-a-segmentacao",
      titulo: "O criativo é a segmentação",
      tecnica: "Com público amplo, quem filtra é o criativo: a imagem e a primeira frase chamam a pessoa certa. Por isso a conta precisa de variedade real de criativos (ângulos, formatos, pessoas), renovada quando a frequência sobe e o custo piora. Mais versões do mesmo anúncio não é variedade.",
      quando_usar: "Planejar a rodada de criativos do mês.",
      exemplo: "Para atrair donos de pet idoso, o criativo mostra um cão de focinho branco, não um filhote.",
    },
    {
      slug: "leitura-da-queda",
      titulo: "Diagnóstico de queda de resultado",
      tecnica: "Leia na ordem: rastreamento (o evento ainda está chegando?), entrega (CPM e alcance mudaram?), criativo (frequência alta, CTR caindo = fadiga), página ou atendimento (cliques bons e poucas conversões = problema depois do clique), oferta e época (sazonalidade, concorrente em promoção). Mude uma coisa por vez e dê tempo para ler.",
      quando_usar: "Quando o custo por resultado sobe ou as conversões caem.",
      exemplo: "Custo por conversa dobrou e frequência passou de 4: trocar criativos antes de mexer em público.",
    },
    {
      slug: "teste-com-verba-e-tempo",
      titulo: "Teste com verba e tempo suficientes",
      tecnica: "Teste só conclui quando cada versão teve resultados suficientes para comparar. Defina antes o que está testando, a métrica de decisão (custo por resultado) e o prazo. Pausar um anúncio no primeiro dia por causa de curtidas é decidir no escuro. Julgue sempre o resultado de negócio, não o CTR sozinho.",
      quando_usar: "Planejar e encerrar testes A/B.",
      exemplo: "\"Ângulo dor x ângulo prova, mesma verba, 7 dias, vence o menor custo por conversa.\"",
    },
    {
      slug: "escala-gradual",
      titulo: "Escala gradual",
      tecnica: "Achou o vencedor: aumente a verba aos poucos e acompanhe o custo por resultado. Aumento brusco pode reiniciar o aprendizado e piorar o custo. Outra forma de escalar é duplicar o vencedor com criativos novos no mesmo ângulo. Escalar sem atendimento para dar conta das conversas queima verba.",
      quando_usar: "Aumentar investimento de campanha que funciona.",
      exemplo: "Subir a verba diária em passos pequenos a cada poucos dias, conferindo o atendimento do WhatsApp.",
    },
    {
      slug: "rastreamento",
      titulo: "Rastreamento antes de verba",
      tecnica: "Sem evento confiável, a otimização trabalha às cegas. Confira o pixel e a API de conversões, o evento certo (compra, lead, conversa iniciada) e a deduplicação. Para WhatsApp, registre de onde veio cada conversa. Número que não bate com o caixa do cliente é sinal de rastreamento quebrado.",
      quando_usar: "Antes de subir campanha nova e em auditoria.",
      exemplo: "Lead no formulário chega no CRM mas não no Gerenciador: conferir o evento antes de aumentar verba.",
    },
    {
      slug: "nada-sem-aprovacao",
      titulo: "Plano e rascunho: nada aplicado sem aprovação",
      tecnica: "Regra da casa: o agente planeja, escreve e sugere; mudar orçamento, pausar, criar ou publicar anúncio na conta só com confirmação explícita da equipe. Toda sugestão diz o que muda, por quê, o risco e como desfazer. Sugestão boa vem com o número que a justifica.",
      quando_usar: "Toda recomendação de otimização.",
      exemplo: "\"Pausar o criativo 3 (custo por conversa 2x a média da conta em 10 dias). Desfazer: reativar.\"",
    },
  ],

  // ---------------------------------------------------------------- Mesa Vídeos: diretor
  "videos.diretor": [
    {
      slug: "resposta-no-gancho",
      titulo: "A resposta já no gancho",
      tecnica: "Os Reels que mais crescem no nicho entregam a resposta ou o primeiro exemplo completo logo no começo, nos primeiros segundos, e o resto aprofunda. Gancho que só promete (\"fica até o final\") perde para gancho que já dá algo. Gancho de texto e gancho visual juntos.",
      quando_usar: "Abertura de todo Reel.",
      exemplo: "\"Responde assim quem pergunta 'quanto custa' no direct:\" e a mensagem já aparece digitada na tela.",
    },
    {
      slug: "escada-ou-trio",
      titulo: "Corpo em escada ou trio",
      tecnica: "Estruturas que prendem: trio (ruim, bom, o que vende) ou escada (do mais comum ao mais raro, do pior ao melhor). Cada degrau termina puxando o próximo. A chamada para seguir é o último degrau, em tom leve, quase uma piada. Duração boa para isso: de 30 a 40 segundos.",
      quando_usar: "Reel educativo e comparativo.",
      exemplo: "\"Foto ruim do produto, foto boa, e a foto que vende\" com as três lado a lado no fim.",
    },
    {
      slug: "historia-e-verdade",
      titulo: "História e verdade antes de aula",
      tecnica: "Conteúdo com cara de aula e dado solto soa roteiro decorado. Prefira a história real do dono, um caso do dia, uma tela real do app ou um erro que ele viu. Útil e humano juntos: a pessoa aprende algo e sente que é gente falando com gente.",
      quando_usar: "Escolher o formato e o tom do Reel.",
      exemplo: "No lugar de \"5 dicas de atendimento\", \"o cliente que quase perdi ontem por causa de um áudio de 3 minutos\".",
    },
    {
      slug: "tela-limpa",
      titulo: "Tela limpa",
      tecnica: "Um texto por vez, no centro, entrando de lados alternados. Nada de selo de episódio, cantoneira, barra de progresso, grão, chiado ou caixinha de rótulo. Fonte e crédito vão na legenda do post, não na tela. Com texto grande na tela, o fundo fica desfocado e escuro; fundo nítido só sem texto. Legenda sem ponto final.",
      quando_usar: "Edição e acabamento de Reels da casa e dos clientes.",
      exemplo: "\"3 passos\" grande no centro sobre o vídeo desfocado; depois o vídeo volta nítido.",
    },
    {
      slug: "som-vende",
      titulo: "O som vende",
      tecnica: "Trilha que troca com o vídeo (uma para o gancho, outra para a virada, energia no passo a passo, volta da primeira no fim), sempre bem abaixo da voz. Efeito sonoro marca a transição e nunca passa por cima da fala. Final para cima, sem silêncio e sem música triste.",
      quando_usar: "Mixagem de qualquer Reel com fala.",
      exemplo: "Riser curto antes de \"e o terceiro...\" e a batida entrando seca na resposta.",
    },
    {
      slug: "formatos-que-crescem",
      titulo: "Formatos que crescem",
      tecnica: "Lista com número, mito e verdade, antes e depois real, bastidor do processo, tela real do app com passo a passo, comparação lado a lado, notícia com data (\"cuidado com o dia 8\") e polêmica leve e responsável (opinião firme sobre prática do mercado, sem atacar pessoa). Escolha o formato pelo tema, não por moda.",
      quando_usar: "Definir o formato de cada vídeo do mês.",
      exemplo: "Mito e verdade para estética: \"protetor solar só no verão? mito\".",
    },
    {
      slug: "gatilho-de-envio",
      titulo: "Gatilho de compartilhamento",
      tecnica: "O Instagram já disse publicamente que envios (quando alguém manda o vídeo para outra pessoa) pesam para alcançar quem não segue. As pessoas enviam o que é útil para alguém específico, o que as representa (\"sou eu\") e o que é engraçado. Pense em quem vai receber o vídeo e diga isso na chamada.",
      quando_usar: "Gancho, tema e chamada de Reels de alcance.",
      exemplo: "\"Manda pra aquele amigo que ainda atende cliente por áudio\".",
    },
    {
      slug: "camera-viva",
      titulo: "Câmera viva e pessoa real",
      tecnica: "O dono ou a equipe gravando, falando natural, com câmera que se mexe (zoom leve, corte de ângulo a cada ideia). Tela preta com texto só em momentos curtos. Abertura pode ser cinematográfica e sem voz, mas a pessoa aparece logo depois. Corte pausa e respiro.",
      quando_usar: "Reels com fala do cliente.",
      exemplo: "Plano aberto no balcão, corte para close na mão fazendo o produto, volta para o rosto na frase-chave.",
    },
    {
      slug: "chamada-final",
      titulo: "Chamada final que conversa",
      tecnica: "Peça uma ação só e fácil: comentar uma palavra (\"comenta GUIA que te mando\"), mandar para quem tem negócio ou seguir para mais vídeos assim. Não anuncie o próximo episódio. Chamada dita com energia, na mesma batida da trilha.",
      quando_usar: "Fim de todo Reel.",
      exemplo: "\"Comenta ZAP que eu te mando as três mensagens prontas\".",
    },
  ],

  // ---------------------------------------------------------------- Mesa Foto: diretor
  "foto.diretor": [
    {
      slug: "cena-de-uso",
      titulo: "Cena que mostra o uso",
      tecnica: "Produto sozinho no fundo branco serve para catálogo; para vender no feed, mostre o produto em uso, no lugar onde ele vive, com sinal de gente (mão, xícara pela metade, sacola aberta). A foto responde: como fica na minha vida?",
      quando_usar: "Fotos de campanha e de feed.",
      exemplo: "Bolsa no banco do carona com chave e óculos ao lado, luz de fim de tarde.",
    },
    {
      slug: "composicao",
      titulo: "Composição que guia o olho",
      tecnica: "Ponto focal no cruzamento dos terços, linhas do cenário levando até o produto, espaço livre para respirar (e para o texto), primeiro plano desfocado para dar profundidade. Um só herói por foto. Fundo com cor que contrasta com o produto.",
      quando_usar: "Toda direção de foto.",
      exemplo: "Garrafa no terço direito, linha da bancada levando o olho até ela, folhas desfocadas na frente.",
    },
    {
      slug: "still-ou-lifestyle",
      titulo: "Still ou lifestyle",
      tecnica: "Still (produto, fundo controlado, luz de estúdio) para loja virtual, cardápio e detalhe técnico. Lifestyle (pessoa, ambiente, momento) para feed, anúncio e campanha. Uma série boa combina os dois: o still mostra o produto, o lifestyle mostra o desejo.",
      quando_usar: "Planejar o ensaio ou o kit de fotos.",
      exemplo: "Kit de 6: 2 stills de detalhe, 3 lifestyles em uso, 1 plano aberto do ambiente.",
    },
    {
      slug: "comida-que-da-fome",
      titulo: "Comida que dá fome",
      tecnica: "Ângulo de 45 graus ou de cima, luz lateral suave, textura à mostra (crosta, vapor, molho escorrendo), migalha e talher para parecer real, porção de verdade (não exagerada). Fundo e louça que conversam com a marca. Prato bonito demais vira propaganda de banco de imagem.",
      quando_usar: "Restaurantes, padarias, doces e delivery.",
      exemplo: "Hambúrguer cortado ao meio mostrando o ponto, com guardanapo amassado ao lado.",
    },
    {
      slug: "pessoa-real",
      titulo: "Pessoa com cara de cliente",
      tecnica: "Modelos e pessoas que se parecem com o público real do negócio (idade, corpo, estilo), em pose de ação e não olhando para a câmera o tempo todo. Expressão natural, roupa do dia a dia. Nada de pessoa famosa ou parecida com alguém conhecido.",
      quando_usar: "Fotos com gente para qualquer nicho.",
      exemplo: "Senhora de 60 anos rindo enquanto prova óculos, e não uma modelo de 20 anos fazendo pose.",
    },
    {
      slug: "produto-real-intacto",
      titulo: "Produto real intacto",
      tecnica: "Quando há foto real do produto, ela é a fonte: forma, cor, rótulo e logo não podem mudar. A cena se constrói em volta, sem redesenhar o produto. Se o gerador alterar o rótulo, a foto não serve. A logo entra pelo código, nunca redesenhada.",
      quando_usar: "Kits com produto do cliente.",
      exemplo: "Pote de geleia real recortado e posto na mesa do café gerada, com o rótulo original.",
    },
    {
      slug: "paleta-na-cena",
      titulo: "Paleta da marca dentro da cena",
      tecnica: "Traga as cores da marca para o cenário pelos objetos (tecido, louça, flor, parede), sem pintar tudo. Uma cor da marca bem colocada liga a foto à identidade sem precisar de logo. Cada marca do cliente tem sua paleta: não misture.",
      quando_usar: "Ensaios de marca e campanha.",
      exemplo: "Marca verde-escuro: guardanapo de linho verde e um ramo de alecrim na cena.",
    },
    {
      slug: "gerar-a-mais",
      titulo: "Gerar a mais e escolher",
      tecnica: "Regra da casa: em vez de corrigir uma foto várias vezes, gere algumas opções de cara (composição diferente de verdade, não variação mínima) e escolha as melhores pela nota. Refazer pede composição nova. Correção automática só para erro objetivo (texto, logo) e só na área dele.",
      quando_usar: "Toda geração de kit e ensaio.",
      exemplo: "Pedir 3 enquadramentos (aberto, médio, detalhe) e ficar com o melhor de cada.",
    },
  ],

  // ---------------------------------------------------------------- Mesa Motion
  "motion.agente": [
    {
      slug: "movimento-com-motivo",
      titulo: "Movimento com motivo",
      tecnica: "Cada animação tem uma função: chamar o olho para a informação que importa, mostrar sequência ou mostrar transformação (antes vira depois). Movimento sem motivo cansa e tira a atenção da mensagem. Um elemento se mexe por vez.",
      quando_usar: "Planejar qualquer peça animada.",
      exemplo: "O preço entra com um pulo curto quando a voz diz o valor; o resto fica parado.",
    },
    {
      slug: "tipografia-cinetica",
      titulo: "Tipografia cinética na palavra certa",
      tecnica: "A palavra-chave aparece no instante em que a voz diz, no centro, grande, uma por vez. Entradas alternadas (de baixo, de cima, dos lados). Números e nomes de lugar entram com impacto. Texto da tela nunca repete a frase inteira da fala: destaca o que importa.",
      quando_usar: "Vídeo narrado ou falado com texto na tela.",
      exemplo: "Fala: \"você perde cliente no primeiro minuto\"; tela: \"1º MINUTO\".",
    },
    {
      slug: "ritmo-no-beat",
      titulo: "Ritmo no tempo da música",
      tecnica: "Cortes e entradas caem na batida da trilha. Antes do drop, camadas e tensão; no drop, a revelação principal. Mude o ritmo entre blocos (calmo no contexto, rápido no passo a passo) para o vídeo não ficar monótono.",
      quando_usar: "Edição de motion com trilha.",
      exemplo: "Logo do cliente montando em 4 batidas e se fechando no bumbo do drop.",
    },
    {
      slug: "transicao-sem-corte-seco",
      titulo: "Transições que ligam as ideias",
      tecnica: "Cenas que deslizam uma sobre a outra, chicote rápido entre blocos e objeto que se transforma no próximo. Nada de corte seco entre ideias diferentes e nada de transição chamativa a cada segundo. A transição carrega o sentido (a reclamação vira solução).",
      quando_usar: "Ligar blocos de um vídeo explicativo.",
      exemplo: "O balão de reclamação gira e vira o balão de avaliação 5 estrelas.",
    },
    {
      slug: "minimalismo",
      titulo: "Minimalismo que parece caro",
      tecnica: "Fundo escuro ou neutro com luz suave em movimento lento, um elemento por cena, muito espaço vazio. Nada de partícula, faixa de cor varrendo a tela, emoji ou desenho infantil. Imagem real do assunto, nítida, quando ela existe. Pouco e bem feito.",
      quando_usar: "Peças de marca, abertura e assinatura.",
      exemplo: "Fundo preto, a foto real do produto girando devagar e uma frase curta embaixo.",
    },
    {
      slug: "abertura-cinematografica",
      titulo: "Abertura cinematográfica sem voz",
      tecnica: "Os primeiros segundos podem ser só imagem e som: um plano de cinema do assunto, a trilha subindo, um texto curto de gancho. A voz entra depois que o olho foi fisgado. Funciona melhor quando o plano mostra algo real do cliente.",
      quando_usar: "Abertura de Reel de marca e lançamento.",
      exemplo: "Travelling lento pela vitrine à noite, luz acendendo, texto \"a loja que o bairro esqueceu\".",
    },
    {
      slug: "assinatura-curta",
      titulo: "Assinatura de marca curta",
      tecnica: "A logo aparece no fim, rápida e limpa, com o arquivo oficial (nunca redesenhada). Se precisar de chamada, uma linha só. A assinatura não pode ser mais longa que o gancho. Em peça para cliente feita pela agência, a assinatura é do cliente.",
      quando_usar: "Final de vídeo de marca e anúncio.",
      exemplo: "Logo entra com um leve desfoque para nítido em um segundo, com \"peça pelo WhatsApp\" embaixo.",
    },
  ],

  // ---------------------------------------------------------------- Mesa Roteiros
  "roteiros.roteirista": [
    {
      slug: "formulas-de-gancho",
      titulo: "Fórmulas de gancho que funcionam",
      tecnica: "Abra com uma destas: o erro comum (\"você está respondendo errado quem pergunta o preço\"), a resposta direta (\"faz assim:\"), a pergunta específica (\"seu cliente some depois do orçamento?\"), o contraste (\"o que você faz x o que vende\"), a notícia com data e o desafio prático (\"abre o Google agora e procura...\"). Gancho específico ganha de gancho genérico.",
      quando_usar: "Primeira frase de todo roteiro.",
      exemplo: "\"Abre o ChatGPT e pergunta qual o melhor lugar pra comprar o que você vende na sua cidade.\"",
    },
    {
      slug: "escada-e-trio",
      titulo: "Escada e trio no corpo",
      tecnica: "Organize o corpo em três (ruim, bom, o que vende) ou em degraus (do básico ao avançado). Cada passo tem um exemplo prático (frase pronta, print, conta) e termina puxando o próximo (\"e o segundo é o que deixa você cobrar mais caro\"). Resumo rápido antes da chamada.",
      quando_usar: "Roteiro educativo de 30 a 60 segundos.",
      exemplo: "\"Mensagem ruim: 'oi, tudo bem?'. Boa: 'oi, Ana, seu pedido ficou pronto'. A que vende: 'oi, Ana, ficou pronto, e separei o que combina com ele'.\"",
    },
    {
      slug: "fala-humanizada",
      titulo: "Fala humanizada",
      tecnica: "Frases curtas, uma ideia por frase, \"você\" em vez de \"as pessoas\", verbos concretos, exemplos do dia a dia. Fale como o dono fala no balcão. Corte \"neste vídeo eu vou\", \"é muito importante\" e explicações do óbvio. Leia em voz alta: se tropeça, reescreva.",
      quando_usar: "Revisão de todo roteiro falado.",
      exemplo: "\"É fundamental otimizar seu atendimento\" vira \"responde rápido, porque o cliente tá falando com mais três\".",
    },
    {
      slug: "o-que-soa-ia",
      titulo: "O que soa a texto de IA",
      tecnica: "Corte: trios de adjetivos, \"não é só X, é Y\", perguntas retóricas em série, \"mergulhar\", \"desbloquear\", \"potencializar\", \"jornada\", \"no cenário atual\", travessão a cada frase, emoji em cada linha e o fecho motivacional genérico. Troque por detalhe concreto, número verdadeiro e opinião assumida.",
      quando_usar: "Revisão final de roteiro e legenda.",
      exemplo: "\"Potencialize sua jornada de vendas\" vira \"vende mais pro cliente que já comprou uma vez\".",
    },
    {
      slug: "historia-real",
      titulo: "História real antes de aula",
      tecnica: "Abrir com um caso concreto (o cliente que quase desistiu, o erro que o dono cometeu, a conversa de ontem) prende mais do que uma lista de dicas. Use a estrutura situação, virada, lição prática. Nada de inventar caso: se não há história, use a tela real ou um exemplo hipotético dito como hipotético.",
      quando_usar: "Roteiros de autoridade e de conexão.",
      exemplo: "\"Ontem um cliente me mandou um áudio de 4 minutos. Sabe o que eu respondi?\"",
    },
    {
      slug: "util-pratico",
      titulo: "Útil e prático, para usar hoje",
      tecnica: "O roteiro entrega algo que a pessoa aplica no mesmo dia: mensagem pronta, passo no app, conta simples, checklist. Mostre na tela real (WhatsApp, Google, Instagram) sempre que der. Assunto é o que o empresário quer saber, não o que a agência quer falar de si.",
      quando_usar: "Roteiro de conteúdo útil da Aceleriq e de clientes.",
      exemplo: "\"Três mensagens prontas para quem sumiu depois do orçamento\" com o WhatsApp em tela cheia digitando.",
    },
    {
      slug: "chamada-com-palavra",
      titulo: "Chamada com palavra-chave",
      tecnica: "Peça um comentário com uma palavra ligada ao conteúdo (\"comenta GUIA\") e cumpra a entrega. Alternativas: mandar para alguém específico, salvar para usar depois ou seguir em tom leve como último degrau. Uma chamada por roteiro.",
      quando_usar: "Fecho de roteiro de conteúdo.",
      exemplo: "\"Comenta MENSAGEM que eu te mando as três por escrito.\"",
    },
    {
      slug: "roteiro-de-anuncio",
      titulo: "Roteiro de anúncio falado",
      tecnica: "Gancho com a dor ou o resultado; uma frase de identificação (\"se você...\"); demonstração ou prova; oferta com condição clara; chamada única com motivo para agir agora. Linguagem de conversa, sem jargão. Escreva três ganchos alternativos para o mesmo corpo.",
      quando_usar: "Anúncios em vídeo e UGC.",
      exemplo: "\"Se a sua cozinha tem cheiro de gordura mesmo limpa, olha isso\" + demonstração + \"orçamento grátis até sexta\".",
    },
    {
      slug: "ponte-entre-partes",
      titulo: "Pontes entre as partes",
      tecnica: "Ligue os blocos com frases de passagem que mantêm a pessoa (\"e é aqui que quase todo mundo erra\", \"o que você aprende com isso? aplica no teu negócio\"). Sem pontes o roteiro vira lista solta e a retenção cai no meio. A ponte também avisa que vem algo melhor.",
      quando_usar: "Roteiros com mais de um bloco.",
      exemplo: "\"Até aqui foi o básico. O terceiro passo é o que separa quem vende de quem só posta.\"",
    },
  ],

  // ---------------------------------------------------------------- Mesa Publicidade
  "publicidade.diretor": [
    {
      slug: "grande-ideia",
      titulo: "A grande ideia nasce de uma verdade",
      tecnica: "Grande ideia = uma verdade do público (algo que ele sente e reconhece) + uma verdade do produto (o que ele faz de diferente) + uma frase que junta as duas. Se a ideia serve para qualquer marca, não é ideia. Teste: dá para fazer dez peças diferentes com ela?",
      quando_usar: "Início de toda campanha.",
      exemplo: "Verdade: no bairro todo mundo se conhece. Produto: a padaria lembra o pedido de cada um. Ideia: \"Aqui seu pedido tem nome\".",
    },
    {
      slug: "titulo-publicitario",
      titulo: "Título publicitário com verdade",
      tecnica: "Título bom é específico, curto e tem uma virada (jogo de palavras com sentido, contraste, afirmação inesperada). Precisa ser verdade para o cliente cumprir. Escreva muitas opções e escolha poucas: a primeira ideia quase sempre é a mais óbvia.",
      quando_usar: "Títulos de peças-chave e anúncios de campanha.",
      exemplo: "Ótica: \"Tem coisa que você só vê depois que vê\".",
    },
    {
      slug: "plataforma-e-desdobramento",
      titulo: "Plataforma que desdobra em peças",
      tecnica: "Da grande ideia saem a peça-chave (a imagem que resume tudo) e os desdobramentos por canal: post, carrossel, Reel, story, anúncio, material de ponto de venda. Todas reconhecíveis como da mesma campanha (mesmo título-mãe, mesma linguagem visual), cada uma adaptada ao formato.",
      quando_usar: "Planejamento das peças da campanha.",
      exemplo: "Peça-chave no feed, Reel com clientes chamados pelo nome, story com enquete \"qual o seu pedido de sempre?\".",
    },
    {
      slug: "fases-da-campanha",
      titulo: "Campanha comercial por fase",
      tecnica: "Aquecimento (desperta o desejo e o problema, sem preço), lançamento (a oferta inteira e clara), sustentação (prova, quem comprou, bastidor, dúvidas respondidas) e última chamada (prazo ou estoque reais acabando). Cada fase com mensagem própria; a fase é dada pelo calendário.",
      quando_usar: "Campanhas de data comercial e lançamento.",
      exemplo: "Dia das Mães: aquecimento \"o que ela nunca compra para ela\", lançamento do kit, sustentação com mães reais, última chamada na sexta.",
    },
    {
      slug: "urgencia-real",
      titulo: "Urgência e escassez reais",
      tecnica: "Prazo, vaga e estoque só quando são verdadeiros, e cumpridos (se a promoção acaba sábado, acaba sábado). Urgência falsa queima a marca e a próxima campanha. Melhor: motivo real para agir agora (data, lote, agenda cheia, sazonalidade).",
      quando_usar: "Oferta com prazo, lote ou vaga.",
      exemplo: "\"Só 12 horários de sábado em dezembro\" quando a agenda tem mesmo 12.",
    },
    {
      slug: "promocao-com-criterio",
      titulo: "Promoção com critério, não desconto em tudo",
      tecnica: "Em data como Black Friday, desconto em tudo destrói margem e treina o cliente a esperar. Escolha: um produto-isca, um combo com valor percebido, um brinde ou uma condição (parcelamento, frete, bônus). Preço riscado precisa ser o preço real de antes: oferta enganosa é proibida pelo Código de Defesa do Consumidor.",
      quando_usar: "Datas promocionais do varejo.",
      exemplo: "\"Na compra do óculos de grau, a lente de sol sai pela metade\" em vez de 30% em tudo.",
    },
    {
      slug: "mundo-real",
      titulo: "Ideia que vem do mundo real",
      tecnica: "Os melhores insights vêm de observar: o que o cliente fala no balcão, a reclamação repetida, a mania do bairro, o objeto que todo mundo tem. Antes de criar, liste cinco observações reais sobre o público. A campanha que a pessoa reconhece como \"isso sou eu\" é compartilhada.",
      quando_usar: "Busca de conceito e de insight.",
      exemplo: "Oficina: \"todo mundo aumenta o volume do rádio quando o carro faz barulho\" vira campanha de revisão.",
    },
  ],

  // ---------------------------------------------------------------- Mesa Identidade
  "identidade.diretor": [
    {
      slug: "conceito-antes-do-logo",
      titulo: "Conceito antes do logo",
      tecnica: "Antes de desenhar: três palavras de personalidade, uma verdade da marca (de onde vem, o que faz diferente) e o público. Cada escolha visual (forma, cor, letra) precisa responder a esse conceito. Logo bonito sem conceito vira enfeite trocável.",
      quando_usar: "Início de todo projeto de identidade.",
      exemplo: "Padaria de família desde os avós: tradicional, acolhedora, honesta; logo com letra de forno antigo, não geométrica fria.",
    },
    {
      slug: "logo-que-funciona-pequeno",
      titulo: "Logo que funciona pequeno",
      tecnica: "O logo vive em lugares minúsculos: foto de perfil redonda do Instagram, ícone de site, carimbo, bordado. Teste em tamanho pequeno e em uma cor só. Detalhe fino, degradê e texto longo somem. Tenha versão horizontal, vertical e símbolo isolado.",
      quando_usar: "Avaliação e refinamento de logo.",
      exemplo: "Símbolo cabe no círculo do perfil sem cortar; o nome completo fica para a versão horizontal.",
    },
    {
      slug: "paleta-com-funcao",
      titulo: "Paleta com função",
      tecnica: "Uma cor principal (a que identifica), uma de apoio, neutros para fundo e texto e uma cor de ação (botão, preço). Confira o contraste do texto sobre cada cor para leitura no celular. Cor com significado no nicho ajuda (verde em saúde e natureza), mas diferenciar do concorrente também.",
      quando_usar: "Definição de paleta.",
      exemplo: "Principal azul-petróleo, apoio areia, neutros off-white e grafite, ação laranja queimado.",
    },
    {
      slug: "tipografia-da-marca",
      titulo: "Par tipográfico legível",
      tecnica: "Uma fonte de título com personalidade e uma de texto que se lê bem em tela pequena. No máximo duas famílias. Prefira fontes com licença livre de uso comercial (ex.: Google Fonts) para o cliente usar sem custo. Teste com o nome real da marca e frases do dia a dia.",
      quando_usar: "Definição tipográfica da identidade.",
      exemplo: "Título em serifada expressiva, texto em sem serifa neutra de boa leitura.",
    },
    {
      slug: "sistema-grafico",
      titulo: "Sistema gráfico, não só logo",
      tecnica: "Identidade forte se reconhece sem a logo: um elemento recorrente (forma, textura, recorte, grafismo tirado do símbolo), um grid de posts, um estilo de foto e um jeito de usar texto. Entregue regras simples que o cliente e a equipe conseguem repetir.",
      quando_usar: "Fechamento do projeto e manual de marca.",
      exemplo: "O arco do símbolo vira moldura de fotos e divisor de lâminas no carrossel.",
    },
    {
      slug: "aplicacoes-reais",
      titulo: "Aplicações no mundo real",
      tecnica: "Mostre a marca onde ela vai viver: fachada, embalagem, uniforme, cartão, post, story, WhatsApp, veículo. Mockups do mundo real ajudam o cliente a aprovar e revelam problemas (contraste na fachada, leitura no uniforme). Use a logo oficial aplicada pelo código, nunca redesenhada pelo gerador.",
      quando_usar: "Apresentação da identidade ao cliente.",
      exemplo: "Sacola kraft com o símbolo em uma cor e o perfil do Instagram com a nova grade de posts.",
    },
    {
      slug: "marcas-separadas",
      titulo: "Cada marca com seu kit",
      tecnica: "Quando o cliente tem mais de uma marca, cada uma tem logo, paleta, tipografia, contexto e Instagram próprios. A marca secundária não herda nada da principal: vazio fica vazio até ser definido. Só contrato, cobrança, equipe e cadastro passam do cliente para as marcas.",
      quando_usar: "Clientes com mais de uma marca.",
      exemplo: "Restaurante e linha de congelados do mesmo dono: kits separados, mesmo que a família visual se converse.",
    },
  ],

  // ---------------------------------------------------------------- Mesa Site
  "site.agente": [
    {
      slug: "primeira-dobra",
      titulo: "A primeira tela responde quatro coisas",
      tecnica: "Antes de rolar, a pessoa entende: o que é, para quem, por que escolher você e qual o próximo passo (botão). Título com o benefício, subtítulo com a prova ou o diferencial, foto real e um botão principal. Carrossel de banners e frase de efeito vaga atrasam a decisão.",
      quando_usar: "Topo de site e landing page.",
      exemplo: "\"Conserto de celular em 1 hora no Bacacheri\" + \"orçamento na hora, garantia de 90 dias\" + botão \"Chamar no WhatsApp\".",
    },
    {
      slug: "estrutura-que-converte",
      titulo: "Estrutura de página que converte",
      tecnica: "Problema, solução, como funciona (em passos), prova (avaliações, casos, fotos reais), oferta, dúvidas frequentes e chamada final. Cada seção com um título que já diz a ideia. A chamada aparece de novo ao longo da página, não só no fim.",
      quando_usar: "Planejamento de landing page e site de serviço.",
      exemplo: "Clínica: \"Medo de dentista?\" → \"atendimento sem pressa\" → 3 passos → depoimentos → avaliação → dúvidas → botão.",
    },
    {
      slug: "whatsapp-com-mensagem-pronta",
      titulo: "Botão de WhatsApp com mensagem pronta",
      tecnica: "Para negócio local, o WhatsApp costuma ser a principal conversão. O botão abre a conversa com uma mensagem pronta que diz de onde a pessoa veio e o que quer (\"Oi, vi no site e quero um orçamento de...\"). Botão visível no celular o tempo todo, sem cobrir conteúdo.",
      quando_usar: "Toda página com conversão por conversa.",
      exemplo: "wa.me com texto \"Olá! Vim pelo site e quero agendar uma avaliação\".",
    },
    {
      slug: "prova-real",
      titulo: "Prova social real",
      tecnica: "Depoimento com nome, foto e detalhe concreto (com autorização), avaliações do Google, fotos de trabalhos feitos, tempo de mercado, logos de clientes que autorizaram. Prova vaga (\"clientes satisfeitos\") não convence. Nunca invente depoimento.",
      quando_usar: "Seção de prova de qualquer página.",
      exemplo: "\"Trocaram a tela no mesmo dia e me mostraram a peça antiga\", com o nome e a foto do cliente que autorizou.",
    },
    {
      slug: "celular-e-velocidade",
      titulo: "Celular primeiro e página leve",
      tecnica: "A maioria chega pelo celular: desenhe para a tela pequena primeiro. Imagens comprimidas, poucos efeitos pesados, texto legível sem zoom, botões grandes para o dedo. Página lenta perde gente antes de carregar. Teste num celular comum, com internet móvel.",
      quando_usar: "Toda construção e revisão de site.",
      exemplo: "Trocar vídeo de fundo pesado por uma foto otimizada e um botão claro.",
    },
    {
      slug: "seo-local",
      titulo: "SEO local básico",
      tecnica: "Nome do serviço com bairro e cidade no título da página e no texto, endereço e telefone iguais em todo lugar (site, Google, redes), Perfil da Empresa no Google completo e com avaliações respondidas, páginas por serviço principal. Escreva como o cliente busca (\"conserto de geladeira em Curitiba\").",
      quando_usar: "Sites de negócio local.",
      exemplo: "Página \"Troca de tela de iPhone no Bacacheri, Curitiba\" com o endereço e o mapa.",
    },
    {
      slug: "faq-de-objecao",
      titulo: "Dúvidas frequentes que respondem objeções",
      tecnica: "Use a seção de dúvidas para tirar o que trava a compra: preço (\"quanto custa em média\"), prazo, garantia, forma de pagamento, medo (\"dói?\", \"e se não gostar?\"). Respostas curtas, honestas e com o próximo passo. As perguntas vêm do WhatsApp e do balcão do cliente.",
      quando_usar: "Final de landing page e site de serviço.",
      exemplo: "\"E se o conserto não resolver? Você não paga pelo serviço e devolvemos o aparelho como chegou.\" (só se for a política do cliente).",
    },
    {
      slug: "beneficio-antes-de-recurso",
      titulo: "Benefício antes de recurso",
      tecnica: "Recurso é o que o produto tem; benefício é o que muda na vida do cliente. Escreva o benefício e use o recurso como prova. Troque palavras internas da empresa pelas palavras do cliente.",
      quando_usar: "Copy de todas as seções.",
      exemplo: "\"Forno a lenha de 400 graus\" vira \"pizza com borda crocante que chega crocante na sua casa\".",
    },
  ],

  // ---------------------------------------------------------------- Mesa Proposta
  "proposta.redator": [
    {
      slug: "estrutura-da-proposta",
      titulo: "Estrutura de proposta que fecha",
      tecnica: "Diagnóstico (o que vimos no negócio), objetivo (o que o cliente quer, nas palavras dele), solução (o que vamos fazer e por quê), escopo (o que entra e o que não entra), cronograma, investimento e próximos passos com data. Curta e escaneável: o dono lê no celular entre um atendimento e outro.",
      quando_usar: "Toda proposta comercial da agência.",
      exemplo: "Página 1 com o diagnóstico em três achados; última página com \"para começar segunda, precisamos do ok até sexta\".",
    },
    {
      slug: "diagnostico-com-evidencia",
      titulo: "Diagnóstico com evidência do próprio cliente",
      tecnica: "Mostre achados verificáveis do negócio dele: o perfil do Google sem fotos, posts sem chamada, o WhatsApp que demora, o site que não abre no celular, o concorrente que aparece antes. Print e fato convencem mais que teoria. Tom de quem quer ajudar, não de quem aponta erro.",
      quando_usar: "Abertura da proposta.",
      exemplo: "\"Buscando 'pizzaria no Bacacheri', vocês aparecem em 9º no mapa; os 3 primeiros têm mais avaliações com foto.\"",
    },
    {
      slug: "ancoragem-em-tres-opcoes",
      titulo: "Três opções e a recomendada no meio",
      tecnica: "Apresente três pacotes: um essencial, o recomendado (o que de fato resolve o objetivo) e um completo. A comparação ajuda a decidir e o completo ancora o valor. Cada opção diz o que entrega e o resultado esperado, sem prometer número que não depende da agência.",
      quando_usar: "Seção de investimento.",
      exemplo: "Essencial (conteúdo), Recomendado (conteúdo + anúncios + Google), Completo (+ site e identidade).",
    },
    {
      slug: "escopo-claro",
      titulo: "Escopo claro: inclui e não inclui",
      tecnica: "Liste o que está incluído (quantidade de peças, reuniões, rodadas de ajuste, prazos) e o que não está (verba de anúncio, fotos profissionais, impressão). Escopo vago vira briga depois. Diga também o que o cliente precisa fazer (aprovar em até X dias, mandar material).",
      quando_usar: "Toda proposta.",
      exemplo: "\"Inclui 12 posts e 8 Reels por mês, 2 rodadas de ajuste. Não inclui a verba dos anúncios, paga direto à Meta.\"",
    },
    {
      slug: "objecoes",
      titulo: "Respostas às objeções",
      tecnica: "Antecipe as objeções comuns: \"está caro\" (compare com o custo de não fazer e com contratar alguém), \"já tentei e não deu certo\" (o que muda agora), \"não tenho tempo\" (o que a agência assume), \"e se não der resultado\" (como medimos e quando revisamos). Resposta honesta e curta.",
      quando_usar: "Seção de dúvidas e conversa de fechamento.",
      exemplo: "\"Já tentei impulsionar e não vendeu\": impulsionar post não é campanha; mostramos a diferença no primeiro mês.",
    },
    {
      slug: "prova-da-agencia",
      titulo: "Prova da agência na voz da casa",
      tecnica: "Casos contados em \"a gente\": o problema do cliente, o que a gente decidiu, por que e o resultado, com dados só do material do cliente e com autorização. Um caso parecido com o negócio do prospecto vale mais que dez genéricos.",
      quando_usar: "Seção de casos e portfólio.",
      exemplo: "\"Na [cliente] a gente começou pelo nome antes da logo, porque o nome antigo confundia o público\", com os fatos tirados do material do caso.",
    },
    {
      slug: "sem-promessa-garantida",
      titulo: "Sem promessa de resultado garantido",
      tecnica: "Não prometa número de vendas, seguidores ou faturamento: depende de oferta, atendimento e mercado. Prometa o que a agência controla (entregas, prazos, método, acompanhamento) e como o resultado será medido e reportado. Confiança vem de clareza, não de promessa.",
      quando_usar: "Toda proposta e conversa comercial.",
      exemplo: "\"Relatório mensal com custo por conversa e o que vamos testar no mês seguinte\" em vez de \"dobre suas vendas\".",
    },
    {
      slug: "proximo-passo-com-data",
      titulo: "Próximo passo com data",
      tecnica: "Feche com uma ação simples e datada: aprovar a opção, assinar, agendar a reunião de início. Validade da proposta real e o motivo (agenda da equipe, data comercial chegando). Facilite: link para aprovar ou responder no WhatsApp.",
      quando_usar: "Última seção da proposta.",
      exemplo: "\"Aprovando até dia 30, a gente começa a campanha de Natal com três semanas de aquecimento.\"",
    },
  ],

  // ---------------------------------------------------------------- Mesa do cliente: Stories
  "stories.roteirista": [
    {
      slug: "sequencia-novela",
      titulo: "Sequência como capítulo de novela",
      tecnica: "A sequência do dia tem começo, meio e gancho: abertura que prende (algo aconteceu), contexto, interação com adesivo, prova ou bastidor, convite (a oferta ou o link) e um gancho para amanhã (\"amanhã eu mostro o resultado\"). Quem acompanha volta para ver o próximo capítulo.",
      quando_usar: "Planejamento dos stories diários.",
      exemplo: "\"Chegou uma encomenda gigante\" → enquete \"adivinha quantos bolos?\" → bastidor → \"amanhã mostro a entrega\".",
    },
    {
      slug: "adesivo-certo",
      titulo: "O adesivo certo para cada objetivo",
      tecnica: "Enquete para opinião rápida e para descobrir preferência; caixinha de perguntas para dúvidas que viram conteúdo; quiz para ensinar brincando; contagem regressiva para lançamento e prazo; link para levar à compra ou ao WhatsApp; controle deslizante para reação. Um adesivo por story.",
      quando_usar: "Escolher a interação de cada story.",
      exemplo: "Contagem regressiva \"abre a agenda de dezembro\" com lembrete ativado pelos seguidores.",
    },
    {
      slug: "um-story-uma-ideia",
      titulo: "Um story, uma ideia",
      tecnica: "Cada tela diz uma coisa só, com texto curto e grande, dentro da área segura (longe do topo e da parte de baixo). Story com parágrafo é pulado. Se precisa de mais texto, divida em telas.",
      quando_usar: "Toda sequência de stories.",
      exemplo: "Tela 1: \"Acabou o bolo de pote\". Tela 2: \"amanhã às 10h tem fornada nova\". Tela 3: link para encomendar.",
    },
    {
      slug: "rosto-e-voz",
      titulo: "Rosto e voz do dono",
      tecnica: "Stories com a pessoa falando para a câmera criam confiança mais rápido do que artes. Fale curto, olhando para a lente, com o celular na vertical e luz de frente. Bastidor real (preparar, atender, entregar) vale mais que produção caprichada.",
      quando_usar: "Stories de relação e de venda.",
      exemplo: "Dono da oficina: \"olha o que chegou hoje\" mostrando o carro, em 10 segundos.",
    },
    {
      slug: "venda-no-meio",
      titulo: "A venda vem no meio, não no começo",
      tecnica: "Primeiro gera atenção e relação (algo do dia, uma dúvida, um bastidor); depois a oferta com o link e o motivo para agir agora; por fim prova ou resposta de cliente. Sequência que começa com preço perde gente na primeira tela.",
      quando_usar: "Dias de oferta nos stories.",
      exemplo: "Bastidor da fornada → \"sobrou só 8\" com link → print de cliente elogiando.",
    },
    {
      slug: "caixinha-vira-conteudo",
      titulo: "Resposta da caixinha vira conteúdo",
      tecnica: "Perguntas da caixinha são temas prontos: responda nos stories com a pergunta na tela, e as melhores viram Reel ou carrossel. A caixinha também revela objeções de venda que o cliente precisa responder.",
      quando_usar: "Depois de abrir caixinha de perguntas.",
      exemplo: "Pergunta \"vocês entregam no domingo?\" vira story com a resposta e o link do pedido.",
    },
    {
      slug: "destaques-vitrine",
      titulo: "Destaques como vitrine",
      tecnica: "Os destaques são a vitrine do perfil para quem chega pela primeira vez: \"Comece aqui\" (quem somos em poucas telas), serviços ou cardápio, prova (avaliações, antes e depois real), como comprar e localização. Capas simples, na identidade da marca, e conteúdo atualizado.",
      quando_usar: "Organização do perfil e dos destaques.",
      exemplo: "Destaque \"Como pedir\": 3 telas com WhatsApp, horário e área de entrega.",
    },
    {
      slug: "frequencia-de-stories",
      titulo: "Presença diária, sem excesso",
      tecnica: "Stories funcionam pela presença: aparecer todo dia com uma sequência curta mantém a relação. Sequência longa demais faz a pessoa pular. Distribua ao longo do dia (manhã bastidor, tarde oferta, noite conversa) quando houver assunto.",
      quando_usar: "Planejar a rotina de stories do cliente.",
      exemplo: "Manhã: abrindo a loja. Tarde: novidade com link. Noite: enquete sobre o que trazer amanhã.",
    },
  ],
};

/** O endereço que identifica o documento no banco (idempotência do seed e marca "Biblioteca da casa"). */
export function urlDoDocumento(agente: string, slug: string, versao = VERSAO_DA_BIBLIOTECA): string {
  return `biblioteca:${versao}/${agente}/${slug}`;
}

export const NOME_DA_FONTE_DA_CASA = `Biblioteca da casa (versão ${VERSAO_DA_BIBLIOTECA})`;
