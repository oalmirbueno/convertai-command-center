/**
 * Conhecimento destilado dos repositórios do GitHub que o dono pediu (Frente W, 25/09/2026).
 *
 * Pedido do dono: "reforce todos os motores internos; instale todos os
 * repositórios que eu já tinha pedido, assim como skills. Ele tem que entender
 * skills, tem que entender repositórios, porque são bases que vão se
 * conversando para deixar a ferramenta cada vez mais poderosa".
 *
 * O painel roda em Edge Functions: "instalar" um repositório aqui é ler, tirar
 * o método útil e escrever em português, com as regras da casa, um bloco curto
 * que entra no prompt do agente certo, escolhido por tarefa e com teto
 * (conhecimento-dos-agentes.ts). Quem usa cada bloco está no índice único
 * (motores.ts) e a tabela completa, com licença e estado, em
 * docs/motores/REPOSITORIOS.md.
 *
 * Licença: nenhum texto foi copiado. Mesmo nos repositórios MIT e CC0 o texto
 * é resumo próprio, citando a fonte no comentário de cada bloco. Coleções de
 * prompts com texto de terceiros sem licença (no-chili, YouMind) só dão
 * técnica, nunca frase.
 *
 * Regras da casa aplicadas: sem número inventado (todo número da peça vem do
 * cliente), sem travessão, política da Meta, nunca escurecer foto, kit da
 * marca manda, leitura de mercado marcada como leitura (não como regra da
 * Meta). Onde um bloco daqui encontra uma regra de conhecimento-ads.ts,
 * conhecimento-design.ts ou dos especialistas, vale a de lá.
 *
 * Puro: só constantes de texto. Sem Deno, sem banco.
 */

export const VERSAO_CONHECIMENTO_REPOSITORIOS = "2026-09-25.1";

// ------------------------------------------------------------------ ganchos
// Origem: coreyhaines31/marketingskills (MIT), skill ad-creative,
// references/hook-system.md (segmento x motivação x formato, regra de não
// duplicar, funil por componente, fidelidade em escada). Soma aos
// TIPOS_DE_GANCHO e às TECNICAS de conhecimento-ads.ts, sem repetir.

export const MATRIZ_DE_GANCHOS = `MATRIZ DE GANCHOS (segmento x motivação x formato; soma aos tipos de gancho e às técnicas da base)
- Antes do gancho, decidir três coisas: o segmento (uma fatia do público com a mesma situação), a motivação que move essa fatia (a dor, o desejo ou a objeção, com as palavras dela) e o formato (estático de manchete, bastidor, demonstração, comparação, depoimento autorizado). Só então escrever.
- Diversidade é de célula, não de palavra: dez ganchos para dez combinações de segmento e motivação valem mais que trinta versões da mesma frase.
- Imagem e título se completam, nunca se repetem: se a imagem mostra o produto, o título diz o que a pessoa ganha; se o título promete, a imagem prova.
- Ler o funil por componente: para a rolagem e ninguém clica, o problema está na promessa ou na oferta, não na imagem; clique sem contato, o destino não continua a promessa. Mudar um componente por rodada.
- Custo proporcional à evidência: ângulo sem sinal sai em estático simples e barato; produção cara só para o ângulo que já mostrou sinal.`;

// ------------------------------------------------------------------ portfólio de estáticos
// Origem: coreyhaines31/marketingskills (MIT), skill ad-creative,
// references/static-ad-templates.md (papel no funil de cada formato estático,
// a partir de um ranking público de formatos da Meta citado pelo autor).
// Os ids entre parênteses são os ESTILOS_VISUAIS de conhecimento-ads.ts.

export const PORTFOLIO_DE_ESTATICOS = `PORTFÓLIO DE FORMATOS ESTÁTICOS (papel no funil; leitura de mercado registrada no repositório marketingskills, não regra da Meta)
Abrem público frio (pesar quando o objetivo é alcance novo ou escala):
- Fala do dono: por que o negócio existe e para quem, a partir de uma situação real (bastidor_real, rosto_e_olhar). Costuma ser o primeiro vencedor.
- História de origem: o momento concreto que fez o negócio nascer; é o texto longo que ainda abre público frio.
- Grade de produtos ou serviços: vários itens numa peça para a pessoa se escolher (pilha_de_oferta); primeiro teste quando há mais de um produto.
Convertem quem já considera (remarketing e meio de funil; não matar por não escalar no frio, esse não era o papel):
- Destaque de recurso ou ingrediente, manchete editorial (editorial_manchete), pergunta frequente com a objeção nas palavras do cliente (objecao_na_manchete), nós contra eles e comparação justa (nos_contra_eles, comparacao_lado_a_lado), antes e depois honesto (antes_depois), problema e solução, infográfico que ensina, bilhete escrito à mão em data de promoção real.
Gastos ou arriscados (só com motivo): lista numerada genérica (lista_checklist sem ideia nova); cartão de avaliação com elogio genérico (depoimento_citacao só vale com a frase específica, verdadeira e autorizada); logo de veículo de imprensa (uso de marca sem licença).
Montagem do lote: para alcance novo, mais formatos que abrem público frio; para remarketing, os de meio de funil. Com dado da conta, a maior parte nos formatos que já venceram para este cliente e o resto cobrindo os outros; nunca zerar a cobertura.`;

// ------------------------------------------------------------------ fontes do criativo
// Origem: coreyhaines31/marketingskills (MIT), skill ad-creative (Grounded
// Inputs); gntrs/swipefile (MIT), veredito humano que a inferência por
// longevidade nunca sobrescreve; nord342/ad-whisperer (MIT) e
// charlesdove977/advertising-ops (MIT), campos da decomposição de anúncio.

export const FONTES_DO_CRIATIVO = `FONTES DO CRIATIVO (todo conceito nasce de material real e diz de onde veio)
- As três fontes que mais rendem: anúncios vencedores do próprio cliente nos últimos 90 dias; avaliações e depoimentos reais (a dor, a transformação e o benefício inesperado, com as palavras do comprador); comentários dos anúncios e perguntas do atendimento (a objeção vira anúncio de pergunta frequente; o elogio espontâneo revela ângulo que ninguém escreveu).
- Cada conceito diz a fonte (qual avaliação, qual vencedor, qual comentário). Sem fonte no contexto, o conceito sai marcado como hipótese e a lacuna vira pergunta à equipe.
- Frase do cliente entra como está, sem paráfrase, e só vira depoimento na peça com autorização.
- As fontes envelhecem: trocar os vencedores quando um novo escala e renovar comentários e avaliações a cada mês.
- Referência de terceiro é decomposta, não copiada: gancho (a manchete ou os 3 primeiros segundos), estrutura (PAS, AIDA, antes e depois, história), texto na tela, prova, CTA e destino. O veredito da equipe (venceu, perdeu, testando, incerto) manda; tempo no ar é pista (E2), nunca prova de lucro.`;

// ------------------------------------------------------------------ Meta na prática
// Origem: coreyhaines31/marketingskills (MIT), skill ads (Modern Meta
// playbook, Retargeting Strategies, Landing Page Alignment). Leitura de
// mercado; a régua do cliente e CONHECIMENTO_CONTA continuam mandando.

export const META_NA_PRATICA = `META NA PRÁTICA (leitura de mercado do repositório marketingskills; a régua do cliente e a leitura de conta mandam)
- Volume de criativo é o gargalo: estáticos simples e nativos, renovados toda semana para a oferta que vence, costumam render mais que uma peça cara e rara.
- O criativo segmenta: público aberto e a peça dizendo para quem é. Uma palavra de identidade no título ou no texto (o nicho, a profissão, o bairro ou a cidade atendida) chama quem se reconhece e ajuda a entrega a achar o público. Duplicar o vencedor trocando só essa palavra é teste barato.
- Anúncio que não parece anúncio: estudar o que o nicho publica de forma orgânica e que performa, e produzir do mesmo jeito (foto real, texto direto, cara de post).
- Remarketing com outra oferta: quem viu e não comprou talvez não tenha achado a oferta certa. Rodar juntos: a peça que responde à objeção mais ouvida (com as palavras de quem não comprou), um carrossel de provas reais, outras ofertas do catálogo e uma oferta de valor primeiro (avaliação, diagnóstico ou visita sem compromisso).
- Janelas de remarketing de referência: quente de 1 a 7 dias, morno de 7 a 30, frio de 30 a 90; excluir quem já comprou, salvo venda adicional.
- Espelho do título: o título que venceu no anúncio vira a manchete do destino (página ou primeira mensagem do WhatsApp) com as mesmas palavras; destino que muda a promessa perde o clique.`;

// ------------------------------------------------------------------ psicologia do comprador
// Origem: coreyhaines31/marketingskills (MIT), skill marketing-psychology
// (modelos de comprador, persuasão e preço), só os que servem a negócio local
// e com uso honesto. Ancoragem e equação de valor já estão em CONHECIMENTO_OFERTA.

export const PSICOLOGIA_DO_COMPRADOR = `PSICOLOGIA DO COMPRADOR (só com verdade; nunca para manipular)
- Trabalho a ser feito: a pessoa não quer a furadeira, quer o furo. Enquadrar pela tarefa que ela resolve, não pela especificação.
- Aversão à perda: o que a pessoa perde ou continua pagando ao esperar costuma mover mais que o ganho equivalente; só com consequência real e proporcional.
- Viés do presente: benefício de hoje ("já na primeira visita") pesa mais que o de daqui a meses.
- Preço lido de jeitos diferentes: valor por dia soa menor que o mesmo valor por mês; em produto barato o desconto em porcentagem parece maior, em produto caro o desconto em reais parece maior.
- Menos escolhas: poucas opções, uma recomendada ("a mais escolhida") e um CTA só.
- Prova social e semelhança: quantidade real de clientes, avaliações reais e gente parecida com o público.
- Reciprocidade e compromisso: dar algo útil antes de pedir (dica, diagnóstico, amostra) e pedir primeiro um passo pequeno (mandar a foto, marcar a avaliação).
- Limite admitido: dizer com honestidade o que a empresa não é ("não somos os mais baratos; somos os que...") aumenta a confiança.
- Medo de se arrepender e apego ao costume: garantia real, troca fácil, "sem compromisso" e mostrar que trocar é fácil (a gente busca, instala, resolve) tiram a trava.
Nunca: escassez ou prazo falso, medo desproporcional, pressão sobre atributo pessoal de quem lê.`;

// ------------------------------------------------------------------ revisão de texto
// Origem: coreyhaines31/marketingskills (MIT), skill copy-editing (Seven
// Sweeps Framework), adaptado: números só da fonte.

export const REVISAO_EM_SETE_PASSADAS = `REVISÃO EM SETE PASSADAS (antes de entregar texto; cada passada olha uma coisa só)
1. Clareza: uma ideia por bloco, frase curta, sem jargão que o público não usa, a mensagem principal logo no começo.
2. Voz: o mesmo jeito de falar do começo ao fim; nada de começar conversado e terminar institucional.
3. E daí?: toda característica ganha a ponte até o benefício real para quem lê.
4. Prove: toda afirmação tem prova por perto (dado do cliente com período, depoimento autorizado, garantia real) ou é suavizada.
5. Especificidade: trocar palavra vaga (melhorar, otimizar, de qualidade) por fato concreto do cliente; o que não pode ficar específico costuma ser enchimento. Número só da fonte.
6. Emoção: a situação de antes com o detalhe que a pessoa reconhece, uma microcena, o alívio de resolver; emoção a serviço da mensagem, nunca exagero.
7. Risco zero: perto do CTA, responder o medo que trava (preço, compromisso, prazo) e dizer o que acontece depois.
Depois de cada passada, conferir se as anteriores continuam de pé.`;

// ------------------------------------------------------------------ briefing antes de criar
// Origem: charlesdove977/advertising-ops (MIT), frameworks/cmo-brief.md;
// coreyhaines31/marketingskills (MIT), skill offers (Diagnostic Loop e
// When NOT to Use Offer-Design Tactics).

export const BRIEFING_ANTES_DE_CRIAR = `BRIEFING ANTES DE CRIAR (a conversa de diretor de marketing)
- Três decisões antes de qualquer peça: que tipo de anúncio (formato e tom; seguir o que já roda no nicho ou diferenciar de propósito), qual é a ação única (uma só, coerente com o destino real) e o que a oferta entrega exatamente (o resultado concreto em linguagem simples).
- Oferta vaga ("ajudamos empresas a crescer") volta para a equipe com a pergunta que falta; não gerar criativo em cima de oferta vaga.
- Pedido com três CTAs: escolher um e dizer qual e por quê.
- Melhorar a oferta por rodada: escrever a oferta atual em linguagem simples (nome, preço, o que recebe, garantia, prazo), dar nota às quatro alavancas da equação de valor, mexer só na mais fraca e projetar o ganho com honestidade (mudar um componente rende pouco, não milagre).
- Desconto para conquistar cliente novo ancora o produto como barato: preferir subir o valor (bônus que resolve objeção, garantia real) e deixar desconto para data sazonal real ou para quem já é cliente.`;

// ------------------------------------------------------------------ contexto de marketing
// Origem: coreyhaines31/marketingskills (MIT), skill product-marketing (o
// documento de contexto que todas as outras skills leem primeiro). No painel
// esse papel é do contexto consolidado do cliente (agente-contexto).

export const CONTEXTO_DE_MARKETING = `CONTEXTO DE MARKETING DO CLIENTE (o documento que todos os agentes leem antes de criar; o que faltar vira pergunta, nunca invenção)
1. O negócio em uma linha; o que faz; em que "prateleira" o cliente procura (como ele busca esse serviço); modelo de venda e preço.
2. Público: quem compra e quem decide; o uso principal; de 2 a 3 trabalhos para os quais o cliente "contrata" a empresa.
3. Dores: o problema antes de achar a empresa, por que as saídas atuais falham, quanto custa (tempo, dinheiro, oportunidade) e a tensão emocional.
4. Concorrência em três níveis: direta (mesma solução), secundária (outra solução para o mesmo problema) e indireta (outro jeito, como fazer sozinho ou não fazer nada), e onde cada uma deixa a desejar.
5. Diferenciais: o que só ela faz, como faz diferente e por que isso é melhor para o cliente.
6. Objeções mais ouvidas com a resposta, e o antipúblico (quem não é bom cliente).
7. Forças da troca: empurrão (o que irrita na solução atual), atração (o que puxa para a empresa), hábito (o que prende ao jeito atual) e ansiedade (o medo de trocar). Anúncio e conteúdo aumentam empurrão e atração e diminuem hábito e ansiedade.
8. Linguagem do cliente: como ele descreve o problema e a solução, com as palavras dele; termos a usar e a evitar.
9. Provas: resultados com fonte, clientes e depoimentos autorizados.
10. Meta principal e a ação de conversão (mensagem, agendamento, compra).
Registrar a data e o que mudou a cada atualização do contexto.`;

// ------------------------------------------------------------------ pesquisa de cliente
// Origem: coreyhaines31/marketingskills (MIT), skill customer-research
// (Extraction Framework, Synthesis, Research Quality Guardrails);
// nothingbutcici/product-swipefile (MIT), references/inventory.md (estado de
// cada fato, "não consultado" diferente de "não encontrado", fronteira do
// concorrente).

export const PESQUISA_DE_CLIENTE = `PESQUISA DE CLIENTE E DE MERCADO (extrair, sintetizar e dizer a confiança)
Extrair de cada material (conversa, avaliação, comentário, atendimento, pesquisa):
- Trabalho a ser feito em três camadas: funcional (a tarefa), emocional (como quer se sentir) e social (como quer ser visto).
- Dor (prioridade para a dita sem ser perguntada e com emoção), gatilho (o que mudou e fez procurar agora), resultado desejado nas palavras dele e alternativas que tentou, inclusive não fazer nada.
Sintetizar: agrupar por tema, pontuar frequência vezes intensidade, separar por perfil, guardar de 5 a 10 frases literais por tema e apontar onde o que dizem contradiz o que fazem.
Confiança de cada achado: alta (3 ou mais fontes independentes, espontâneo), média (2 fontes ou só quando perguntado), baixa (fonte única). Menos de 5 pontos de dado por segmento não sustenta persona nem mensagem.
Viés da fonte: avaliação online puxa para quem ama ou odeia, atendimento puxa para problema; dar mais peso aos últimos 12 meses.
Estado de cada fato: verificado, incerto, inferido ou estimado. O que não pôde ser consultado (bloqueado, pede login, ferramenta fora do ar) se escreve "não consultado", nunca "não existe".
Concorrente é quem o cliente considera para o mesmo trabalho; fornecedor, plataforma e vizinho de categoria não entram na comparação.`;

// ------------------------------------------------------------------ lançamento e isca
// Origem: coreyhaines31/marketingskills (MIT), skills launch (ORB, prontidão,
// fases) e lead-magnets (princípios e estágio do comprador).

export const LANCAMENTO_E_ISCA = `LANÇAMENTO E ISCA DIGITAL
Lançamento em três tipos de canal: próprios (perfil, lista de WhatsApp com consentimento, e-mail, site), alugados (Instagram, Google, marketplace: alcance que muda sem aviso) e emprestados (parceiro, influenciador local, imprensa, comunidade do bairro). O próprio acumula, o emprestado traz gente nova e o alugado leva gente para o próprio.
Pronto de verdade antes de lançar: oferta fechada, atendimento preparado, destino funcionando e prova mínima.
Ritmo: aviso para a base (lista de espera ou acesso antecipado), lançamento, prova inicial (primeiros clientes, bastidor) e lembrete final com data real; depois, anunciar cada melhoria como novidade.
Isca digital (objetivo de lead): resolve um problema específico e pequeno; bate com o estágio do público (quem ainda não sabe do problema recebe guia ou checklist; quem compara recebe comparativo ou simulação; quem está pronto recebe avaliação, orçamento ou demonstração); entrega valor alto em pouco tempo de consumo e leva naturalmente ao serviço. Pedir só o dado que será usado.`;

// ------------------------------------------------------------------ estratégia de conteúdo
// Origem: coreyhaines31/marketingskills (MIT), skills content-strategy
// (buscável x compartilhável, pilares, priorização, criar uma vez) e social
// (reaproveitamento, engenharia reversa do que viraliza).

export const ESTRATEGIA_DE_CONTEUDO = `ESTRATÉGIA DE CONTEÚDO (buscável, compartilhável e reaproveitável)
- Buscável ou compartilhável: conteúdo de busca responde a pergunta que o cliente digita (a pergunta no título, resposta direta, fácil de escanear); conteúdo de compartilhamento traz ideia nova, dado do próprio cliente ou história com emoção e é feito para ser enviado. Cada pauta declara qual dos dois é.
- Prioridade das pautas: primeiro o impacto no cliente e na venda, depois o encaixe com a oferta e com o que a marca pode dizer com autoridade, depois o potencial de busca ou de envio e, por último, o esforço de produção.
- Fontes de pauta: perguntas do atendimento e do comercial, comentários, avaliações, buscas do Google e o que o concorrente não cobre.
- Criar uma vez, distribuir duas: o carrossel vira estático de uma ideia, a pergunta respondida vira post de dúvida; o que já performou volta em outro formato.
- Engenharia reversa do que viraliza no nicho: gancho, formato, ângulo emocional e estrutura; adaptar a função, nunca copiar.`;

// ------------------------------------------------------------------ foto de produto
// Origem: JeremyGDM/awesome-ai-product-photography-prompts (CC0 1.0, "Prompt
// writing tips": verdade do produto primeiro, uma tarefa por imagem, mudar uma
// instrução por variação, texto de campanha fora da foto);
// EvoLinkAI/awesome-gpt-image-2-API-and-Prompts (CC0 1.0), cenas de produto;
// OpenAI Cookbook, guia de prompt de imagem (MIT): repetir o que se preserva;
// Black Forest Labs, referência de prompt: negativo em positivo, lente e
// abertura. Mesma regra da biblioteca da Mesa Foto (docs/mesa-foto/biblioteca).

export const FOTO_DE_PRODUTO_COM_VERDADE = `FOTO DE PRODUTO COM VERDADE (técnica das coleções CC0 e dos guias dos geradores; texto próprio)
- A verdade do produto vem primeiro na direção: rótulo, cor, material, forma e proporção que não podem mudar; só depois ambiente e luz.
- Uma tarefa por imagem: vitrine de fundo limpo, detalhe, uso real ou peça de campanha. Não pedir história, demonstração e oferta no mesmo quadro.
- Ao refazer a mesma foto, mudar uma instrução por vez e repetir a lista do que se preserva em toda nova tentativa; não reescrever o pedido inteiro. (Um lote de variações segue a regra do lote: cada foto claramente diferente.)
- Descrever o que deve ocupar o espaço em vez de só proibir (vários modelos ignoram o negativo): "rótulo reto e legível" no lugar de "sem rótulo torto".
- Câmera concreta: lente (35 mm para ambiente, 50 mm natural, 85 a 100 mm para produto e retrato, macro para textura), abertura (f/2 a f/2.8 separa do fundo; f/8 a f/11 deixa a vitrine toda nítida), altura e ângulo da câmera.
- O ambiente pode compor: uma moldura natural (pedra, folhagem, arco, batente) que conduz o olhar ao produto, como uma câmera que descobre o objeto.
- Preço, claim, nome e aviso legal não são desenhados na foto; entram depois, no layout.
- Conferir o resultado contra o produto real (rótulo, proporção, material) antes de ir para o cliente.`;

// ------------------------------------------------------------------ Estúdio: imagem e título
// Origem: coreyhaines31/marketingskills (MIT), hook-system (regra de não
// duplicar: o título não legenda a imagem) e JeremyGDM (CC0), uma tarefa por
// imagem. Curto de propósito: o diretor já tem a base de design inteira.

export const IMAGEM_E_TITULO = `IMAGEM E TÍTULO SE COMPLETAM
- A imagem prova e o título promete: se a cena mostra o produto, o título diz o que a pessoa ganha; se o título promete, a cena mostra a prova. Título que descreve a foto desperdiça metade da peça.
- Uma tarefa por lâmina: apresentar, demonstrar, provar ou chamar para a ação; não empilhar história, demonstração e oferta na mesma lâmina.
- Quando o contexto traz comentário, pergunta ou avaliação do público, o título sai dessas palavras; marketing genérico não aparece na fala de ninguém.`;
