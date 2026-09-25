/**
 * Base de conhecimento de marketing dos agentes do painel (Frente R, 25/09/2026).
 *
 * Pedido do dono: "todas as skills que a gente tem aqui (marketing, designer,
 * várias) têm que estar lá dentro do sistema". O painel é web: instalar aqui
 * significa trazer o conhecimento das skills da máquina para os prompts dos
 * agentes. Este módulo é a destilação, em português e com as regras da casa,
 * do que é útil para calendário, estúdio, Mesa Ads, Mesa Foto, contexto e
 * dossiê. Lista completa, origem e onde usar: docs/conhecimento/SKILLS-NO-SISTEMA.md.
 * Plano de integração e limites de tamanho: docs/conhecimento/COMO-INTEGRAR.md.
 *
 * Origem (cada bloco repete a sua em comentário):
 * - Plugin "marketing" 1.2.0 da Anthropic (licença Apache 2.0): skills
 *   brand-review, campaign-plan, competitive-brief, content-creation,
 *   draft-content, email-sequence, performance-report, seo-audit.
 * - Plugin "sales" 2.0.1 da Anthropic: skills handle-objection e customer-voice.
 * - Skills de design do usuário em ~/.claude/skills: brandkit, redesign-skill,
 *   minimalist-skill, soft-skill, taste-skill (licença MIT onde declarada).
 * - Skill hyperframes-creative (referências story-spine e narration).
 * Nada foi copiado na íntegra: é resumo próprio, adaptado ao Brasil, à Meta e
 * às regras da agência (sem inventar dado, sem travessão). Onde um bloco daqui
 * encontra uma regra de conhecimento-ads.ts ou conhecimento-design.ts, vale a
 * de lá (são mais específicas e já validadas pelo dono).
 *
 * Sem dependências: só constantes de texto e uma função de montagem.
 */

export const VERSAO_CONHECIMENTO_MARKETING = "2026-09-25.1";

// ------------------------------------------------------------------ voz de marca
// Origem: marketing/brand-review (Brand Voice Documentation Framework, Voice
// Attribute Spectrums, Tone Adaptation) e marketing/draft-content.

export const VOZ_DE_MARCA = `VOZ DE MARCA (como documentar e aplicar)
Documento de voz completo tem sete partes:
1. Personalidade: a marca descrita como uma pessoa ("um especialista do bairro que explica sem enrolar e cumpre o que promete").
2. Atributos de voz: de 3 a 5. Cada um com quatro linhas: somos (o que significa na prática), não somos (a leitura errada que se quer evitar), soa como (uma frase exemplo), não soa como (uma frase que viola).
3. Público: com quem a marca fala, o que ele valoriza, quanto entende do assunto e como espera ser tratado (você, a senhora, a gente).
4. Pilares de mensagem: de 3 a 5 temas que a marca repete sempre, em ordem de importância, cada um ligado a uma necessidade do público.
5. Espectro de tom: como a voz se adapta ao contexto sem deixar de ser reconhecível.
6. Regras de estilo: caixa de títulos, números, datas, emoji, exclamação, termos técnicos.
7. Terminologia: termos preferidos e termos proibidos da marca.
Espectros para posicionar cada atributo (escolher um ponto em cada eixo, não os dois extremos):
- Formal e institucional ou casual e conversado.
- Especialista que ensina ou colega que troca ideia.
- Caloroso e empático ou direto e objetivo.
- Técnico e preciso ou simples e acessível.
- Enérgico e ousado ou calmo e medido.
- Bem-humorado ou sério.
- Inovador ou tradicional e comprovado.
A voz é fixa; o tom muda com a situação. Exemplo: marca "ousada e calorosa" sobe a ousadia num lançamento e sobe o calor num pedido de desculpas; nenhum dos dois atributos some.
Tom por situação: lançamento (confiante e animado), problema ou atraso (transparente e responsável), caso de cliente (celebra o cliente, com dado específico), conteúdo de autoridade (fundamentado, com nuance), boas-vindas (acolhedor e claro), notícia ruim como aumento de preço (honesto, respeitoso, com solução), comparação (confiante e justo, sem desmerecer ninguém).
Tom por canal: legenda de Instagram (visual, história na primeira linha, quebras de linha), anúncio (benefício específico e ação), e-mail e WhatsApp (pessoal, útil, uma ação por mensagem), blog (explica e ensina), atendimento (paciente, passo a passo).
Quando o cliente não tem guia de voz, o agente propõe um rascunho com esses campos a partir do que a marca já publicou e marca como proposta para a equipe aprovar; nunca trata a proposta como regra aprovada.`;

// Origem: marketing/brand-review (Legal and Compliance Flags, Output Format).
export const REVISAO_DE_MARCA = `REVISÃO DE MARCA E CONFORMIDADE (antes de entregar qualquer texto)
Com guia de voz: conferir voz e tom, termos preferidos e proibidos, alinhamento aos pilares de mensagem e regras de estilo.
Sem guia de voz: conferir clareza (a mensagem principal está no primeiro parágrafo ou na primeira linha?), consistência (mesmo termo para a mesma coisa do começo ao fim) e acabamento (sem erro de português, sem frase truncada).
Bandeiras que sempre são conferidas:
- Superlativo sem prova ("o melhor", "o mais rápido", "o único"): tirar ou qualificar com fonte.
- Promessa em saúde, estética, dinheiro ou garantia: exige aviso ou sai (ver políticas da Meta e conselhos profissionais).
- Comparação com concorrente: só com critério verificável e sem nomear quem não autorizou.
- Depoimento ou citação sem atribuição e sem autorização: sai.
- Texto parecido demais com fonte de terceiros: reescrever.
- Preço "de/por", escassez e prazo: só se forem reais (Código de Defesa do Consumidor e autorregulamentação do CONAR).
Cada achado tem gravidade: alta (contraria a voz, cria risco legal ou derruba a mensagem), média (inconsistente, mas não prejudica) ou baixa (preferência de estilo). Para os 3 a 5 achados mais graves, mostrar antes e depois.`;

// ------------------------------------------------------------------ copy e conteúdo
// Origem: marketing/content-creation (Headline and Hook Formulas, CTA Best
// Practices, Social Media) e marketing/draft-content, adaptados ao português.

export const FORMULAS_DE_TITULO = `FÓRMULAS DE TÍTULO E DE PRIMEIRA LINHA (reescrever para o cliente; nunca preencher no automático)
Títulos:
- Como [chegar ao resultado] sem [o obstáculo comum].
- [Número real] jeitos de [chegar ao resultado].
- Por que [crença comum da categoria] está errado (e o que fazer no lugar).
- Guia de [tema] para [público específico].
- [Faça isto], não [aquilo].
- O que [experiência real da marca] ensinou sobre [tema].
- [Tema]: o que [público] precisa saber em [ano].
Primeiras linhas (variar o tipo; não abrir sempre com número):
- Dado surpreendente, só com fonte e período.
- Afirmação contraintuitiva sobre a categoria, explicada logo depois.
- Pergunta que o próprio cliente faz (nunca sobre atributo pessoal de quem lê).
- Cena: a situação exata que o público vive.
- Afirmação ousada que a peça prova.
- Começo de história real da marca.
Se a primeira linha serviria para qualquer concorrente trocando só o nome, recomeçar.`;

export const CTA_PRINCIPIOS = `CHAMADA PARA AÇÃO
- Verbo de ação e o que acontece depois ("Peça seu orçamento pelo WhatsApp" em vez de "Enviar").
- Uma ação principal por peça, por e-mail e por página. Muitas escolhas derrubam a conversão.
- Urgência só verdadeira (data, vagas, lote, estoque).
- Reduzir risco quando for real: "sem compromisso", "avaliação gratuita", "troca fácil".
- Posição: em página, acima da dobra e repetida no fim; em e-mail, depois de mostrar o valor; em post, na última linha da legenda e na última lâmina do carrossel.
- CTAs de conteúdo orgânico: salvar para depois, mandar para alguém que precisa, comentar uma palavra, chamar no Direct. O pedido combina com a métrica que o post quer mover (envios e salvamentos pesam mais que curtida).`;

export const ESTRUTURAS_DE_CONTEUDO = `ESTRUTURAS DE CONTEÚDO POR FORMATO
Post estático e legenda: gancho na primeira linha; de 2 a 4 pontos curtos ou uma história curta; CTA; de 3 a 5 hashtags específicas do nicho e da região (não genéricas).
Carrossel: capa com a promessa; lâminas de tensão, explicação, demonstração e objeção, cada uma acrescentando uma ideia; última lâmina com o próximo passo. Uma ideia por lâmina.
Página de destino: título com o benefício principal em até 10 palavras; subtítulo que explica; bloco principal com CTA e imagem real; de 3 a 4 benefícios; prova (depoimento autorizado, números com fonte, logos autorizados); respostas às objeções; CTA repetido no fim.
Blog: título com a palavra-chave principal (até cerca de 60 caracteres); introdução de 100 a 150 palavras com gancho; de 3 a 5 seções com subtítulo, uma ideia por seção e um exemplo ou dado em cada; conclusão com CTA; descrição para busca com até cerca de 160 caracteres.
Estudo de caso: título com o resultado; quem é o cliente; desafio; o que foi feito; resultado com número e período reais; citação autorizada; CTA.
Boas práticas de escrita: parágrafos de 2 a 4 frases; voz ativa; falar com a pessoa ("você"); benefício antes da característica; toda seção responde "e daí?" do ponto de vista do leitor; jargão só se o público usa.`;

// ------------------------------------------------------------------ calendário e campanha
// Origem: marketing/campaign-plan (Campaign Framework, Content Calendar
// Creation, Content Cadence, Production Timeline, Budget Allocation).

export const PLANO_DE_CAMPANHA = `PLANO DE CAMPANHA EM CINCO PARTES (objetivo, público, mensagem, canal, medida)
1. Objetivo antes de tudo, no formato específico, mensurável, alcançável, relevante e com prazo ("gerar 60 conversas qualificadas no WhatsApp em 4 semanas"). Tipos: reconhecimento (alcance), consideração (engajamento, envios, salvamentos, cadastros), conversão (leads, agendamentos, vendas), retenção (recompra, reativação) e indicação (avaliações, indicações, conteúdo de cliente).
2. Público em uma frase: "[quem] que está com [dor] e quer [resultado]; costuma descobrir soluções por [canais] e decide por [prioridades]". Dizer em que estágio está (não sabe do problema, pesquisa soluções, pronto para comprar).
3. Mensagem: uma frase central do que a pessoa deve pensar, sentir ou fazer; de 3 a 4 mensagens de apoio, cada uma com a sua prova; diferencial em relação às alternativas, inclusive a de não fazer nada. Ordem da mensagem: por que eu deveria ligar, qual é a solução, por que vocês, o que eu faço agora.
4. Canal: onde o público está, não onde a equipe se sente à vontade. Próprios (perfil, site, e-mail, WhatsApp), conquistados (imprensa, parcerias, avaliações, comunidade) e pagos (Meta, Google, patrocínio).
5. Medida: um indicador principal com meta numérica, de 3 a 5 secundários, como cada um é medido e de quanto em quanto tempo se olha.
Dependências valem tanto quanto as datas: a página ou o atendimento no WhatsApp precisam estar prontos antes de o anúncio subir.
Riscos: listar 2 ou 3 (prazo, público errado, canal que não responde) com o plano B de cada um.`;

export const CALENDARIO_EDITORIAL = `CALENDÁRIO EDITORIAL (processo)
1. Começar pelos marcos: lançamentos, datas do cliente, sazonalidade do nicho e datas comerciais (Dia das Mães, Dia dos Pais, Black Friday, Natal, volta às aulas), sempre ligadas à oferta real.
2. Planejar de trás para a frente: o que precisa estar publicado e quando, contando o prazo de produção de cada peça.
3. Cobrir o funil: peças para quem ainda não conhece (problema e curiosidade), para quem considera (método, prova, bastidor, objeção) e para quem está pronto (oferta, condição, depoimento autorizado).
4. Agrupar por tema semanal ou quinzenal, ligado aos pilares de mensagem da marca.
5. Variar formato e ângulo: não repetir o mesmo tipo de peça em sequência; cada semana tem pelo menos uma peça feita para ser enviada ou salva.
6. Deixar cerca de 20% dos espaços livres para oportunidade e assunto do momento.
Prazos de produção de referência: post estático de 1 a 2 dias úteis; carrossel de 2 a 3; e-mail de 2 a 3; página de destino de 5 a 7; vídeo de 2 a 4 semanas.
Renovação de criativo pago: a cada 2 a 4 semanas durante a campanha (ver também a leitura de conta da Mesa Ads).
Cada item do calendário diz: objetivo da peça, estágio do funil, pilar, formato, gancho e CTA. Item que não se liga a um objetivo sai do calendário.`;

// ------------------------------------------------------------------ análise de desempenho
// Origem: marketing/performance-report (Report Structure, Trend Analysis,
// Optimization Framework, Testing Best Practices, Attribution).

export const ANALISE_DE_DESEMPENHO = `ANÁLISE DE DESEMPENHO E RELATÓRIO (os números vêm do painel; a IA interpreta)
Estrutura do relatório:
1. Resumo em 2 ou 3 frases: a métrica principal com direção (subiu, caiu, estável) em relação ao período anterior, uma vitória e uma preocupação.
2. Painel: métrica, este período, período anterior, variação, meta e situação (no caminho, em risco, fora).
3. Tendência: direção em 4 ou mais períodos, pontos de virada e o que aconteceu neles, sazonalidade.
4. O que funcionou: de 3 a 5 destaques com dado, hipótese do porquê e como repetir.
5. O que precisa melhorar: de 3 a 5 pontos com dado, hipótese e correção proposta.
6. Recomendações com impacto e esforço: alto impacto e pouco esforço primeiro; alto impacto e muito esforço vira plano; baixo impacto e muito esforço sai.
7. Próximo período: 3 prioridades, testes a rodar e metas.
Processo de otimização: identificar a métrica abaixo da meta, localizar a etapa do funil, formular hipótese (público, mensagem, criativo, oferta, momento ou problema técnico), priorizar, testar, medir e então escalar ou iterar.
Sintoma por etapa do funil: pouco alcance (verba, público, formato); CTR ou engajamento baixo (criativo, gancho, público); muita saída da página (conteúdo da página, velocidade, coerência com o anúncio); pouca conversão (oferta, CTA, tamanho do formulário, confiança); pouca recompra (atendimento, pós-venda, nutrição).
Teste: uma variável por vez; métrica de sucesso definida antes; não encerrar cedo; pelo menos um ciclo completo do negócio (em geral uma semana); registrar tudo, inclusive o que não funcionou.
Atribuição: nenhum modelo é verdade absoluta. Último clique favorece remarketing e busca; primeiro clique favorece alcance. "Como nos conheceu" é cor qualitativa, não número. Usar a atribuição como direção.
Métrica de vaidade (curtida, seguidor sozinho) não abre relatório; abre a métrica que o objetivo do cliente pede.
Previsão: sempre em faixa (pessimista, esperado, otimista); com menos de 12 pontos de dado, confiança baixa declarada.`;

// ------------------------------------------------------------------ posicionamento, concorrência e objeções
// Origem: marketing/competitive-brief (Messaging Comparison, Narrative Analysis,
// Positioning Statement) e sales/handle-objection, sales/customer-voice.

export const POSICIONAMENTO_E_CONCORRENCIA = `POSICIONAMENTO E LEITURA DE CONCORRENTE
Declaração de posicionamento: "Para [público], [marca] é [categoria] que [benefício ou diferença principal] porque [razão para acreditar]".
Para cada concorrente (a partir do que ele publica, sem inventar): promessa (o que diz que o cliente consegue), prova (como sustenta), mecanismo (como entrega) e exclusividade (o que diz que só ele faz).
Narrativa: quem é o vilão (o problema, o jeito antigo), quem é o herói (o cliente, o produto ou a equipe), qual transformação promete e o que está em jogo se a pessoa não agir.
Avaliar a mensagem de cada um: clareza em 5 segundos, diferenciação ou genérico, prova, consistência entre canais, conexão com dor real.
Lacunas: temas e formatos que ninguém cobre, públicos mal atendidos, ângulos que ninguém reivindicou. É daí que sai o ângulo novo, não da imitação.
Armadilhas: posicionar contra o concorrente em vez de a favor da necessidade do cliente; prometer diferenciais demais (escolher 1 ou 2); usar jargão que o cliente não usa; posicionar em característica em vez de resultado; trocar de posicionamento toda hora.
Estratégia de categoria: criar categoria nova (se de fato é diferente), reenquadrar a categoria (mudar o critério de escolha a favor do cliente), vencer na categoria existente (executar melhor) ou dominar um nicho dentro dela.`;

export const OBJECOES_E_VOZ_DO_CLIENTE = `OBJEÇÕES E VOZ DO CLIENTE
Classificar a objeção antes de responder: preço ou valor, momento ou prioridade, comparação com concorrente, risco ou confiança, autoridade ("preciso ver com meu sócio") ou costume ("sempre fiz assim"). Separar objeção (motivo para não comprar) de negociação (motivo para comprar mais barato): a resposta é diferente.
Resposta: reconhecer primeiro; responder com o objetivo que o próprio cliente declarou e uma prova real; terminar com uma pergunta que faz a conversa andar.
O que costuma perder: desconto demais, despejar característica, discutir com o cliente.
Voz do cliente: é citação literal com fonte (conversa, avaliação, comentário), nunca paráfrase apresentada como fala. Serve para descobrir a linguagem do público, as dúvidas recorrentes e as provas. Não vira depoimento em peça sem autorização.
Uso nos agentes: a objeção mais ouvida vira ângulo de anúncio ("objeção na manchete"), pauta de carrossel e resposta pronta do atendimento; registrar no dossiê de onde ela veio.`;

// ------------------------------------------------------------------ sequências de mensagem
// Origem: marketing/email-sequence (Sequence Strategy, Sequence Logic,
// Sequence Type Templates), adaptado a e-mail e WhatsApp.

export const SEQUENCIAS_DE_MENSAGEM = `SEQUÊNCIAS DE MENSAGEM (e-mail ou WhatsApp com consentimento)
Antes de escrever: qual é o arco da sequência, que estágio da jornada cada mensagem atende, como a intensidade cresce e qual ação encerra a sequência.
Cada mensagem tem um propósito em uma frase, um gancho, o corpo curto e uma ação principal. No e-mail, assunto com até cerca de 50 caracteres e texto de pré-visualização que complementa (não repete) o assunto.
Regras: quem converteu sai da sequência; não mandar para quem pediu para sair ou está em outra sequência ativa; ajustar o intervalo pelo comportamento (abriu e não clicou recebe uma mensagem mais leve).
Modelos de partida:
- Boas-vindas ou pós-compra (de 5 a 7 mensagens em 2 a 3 semanas): expectativa, primeira vitória rápida, como aproveitar melhor, prova social, pedido de avaliação, próximo passo.
- Nutrição de lead (de 4 a 6 em 3 a 4 semanas): conteúdo útil, dor, solução com prova, casos, convite leve, convite direto.
- Reativação (de 3 a 4 em 10 a 14 dias): lembrete com motivo real para voltar, o que a pessoa está perdendo, condição real, último aviso com data.
- Lançamento (de 4 a 6 em 2 a 3 semanas): aviso prévio, lançamento, destaque de uso, prova inicial, condição por tempo real, lembrete final.
No WhatsApp vale a política da Meta para mensagens comerciais: só com opt-in e modelo aprovado fora da janela de atendimento.`;

// ------------------------------------------------------------------ busca (SEO)
// Origem: marketing/seo-audit e marketing/content-creation (SEO Fundamentals).

export const SEO_ESSENCIAL = `BUSCA ORGÂNICA (site, blog e perfil de empresa no Google)
- Uma palavra-chave principal e 2 ou 3 secundárias por página, pela intenção (informativa, comparativa, de compra, de navegação).
- Palavra principal no título da página (50 a 60 caracteres), no primeiro parágrafo, em um subtítulo, na descrição (150 a 160 caracteres, com convite à ação) e no endereço curto da página.
- Um H1 por página; H2 e H3 em ordem lógica; texto alternativo descritivo nas imagens; 2 ou 3 links internos para páginas relacionadas.
- Responder as perguntas relacionadas que a busca mostra; conteúdo raso (menos de 300 palavras em tema informativo) não posiciona.
- Técnico: celular primeiro, velocidade, HTTPS, mapa do site, sem páginas quebradas, dados estruturados (FAQ, produto, empresa local).
- Negócio local: nome, endereço e telefone iguais em todo lugar; perfil de empresa completo; avaliações reais respondidas.
- Prioridade: ganhos rápidos da semana (título, descrição, links quebrados, texto alternativo) antes de investimentos do trimestre (grupos de conteúdo, página pilar).`;

// ------------------------------------------------------------------ anti-genérico
// Origem: redesign-skill (Content, AI copywriting cliches), minimalist-skill e
// soft-skill (anti-padrões), taste-skill. Adaptado de interface web para peça
// de rede social e texto; o kit da marca do cliente continua mandando.

export const ANTI_GENERICO = `ANTI-GENÉRICO (o que denuncia texto e arte feitos no automático)
Texto:
- Clichês de IA em português: elevar, potencializar, alavancar, impulsionar, desbloquear, revolucionar, transformar sua vida, jornada, no mundo de hoje, no cenário atual, descubra, mergulhe, solução completa, experiência única, próximo nível, sem complicação, de forma simples e eficaz. Trocar por linguagem específica e simples.
- Exclamação em série, frase inteira em caixa alta, "Ops!" em aviso, voz passiva que esconde quem fez.
- Dado redondo inventado (99%, 50%, 10x) ou nome genérico de exemplo: todo número vem da fonte; sem número real, usar especificidade concreta.
- Título Com Todas As Iniciais Maiúsculas: usar caixa de frase.
Arte (vale depois do kit da marca e da base do diretor):
- Uma cor de destaque só; o resto neutro da marca. Várias cores de destaque competem.
- Evitar o gradiente roxo e azul típico de IA e fundos genéricos sem relação com o cliente.
- Preto puro e branco puro chapados em área grande cansam; preferir o tom escuro e o claro da paleta da marca.
- Três blocos iguais lado a lado é o layout mais genérico que existe; preferir assimetria, um elemento dominante e escala contrastante.
- Ícones de estilos misturados ou metáforas óbvias (foguete para lançar, escudo para segurança): trocar por objeto do nicho do cliente.
- Foto de banco com "equipe diversa sorrindo" não prova nada; foto real do cliente vence.
- Textura leve (grão, papel) tira a cara de vetor estéril quando a marca comporta.
Teste final: se a peça ou o texto serviria para outra marca trocando só o logo, não está pronto.`;

// ------------------------------------------------------------------ identidade de marca
// Origem: brandkit (Core Principle, Brand Strategy First, Logo Concept Methods,
// Board Composition). Para propostas de identidade e pranchas de marca.

export const IDENTIDADE_DE_MARCA = `IDENTIDADE DE MARCA (quando o agente propõe ou revisa identidade visual)
Uma identidade não é enfeite: é um argumento visual de por que a marca existe. Toda proposta responde cinco perguntas: o que a marca representa, qual é a metáfora central, como o símbolo expressa isso, como o sistema funciona em peça, tela, impresso e detalhe, e por que o conjunto parece próprio (ninguém mais poderia usar).
Estratégia antes do desenho: categoria, público, função do produto, promessa emocional, nível de confiança exigido, mundo visual e o que a marca deve evitar. O símbolo nasce do significado, nunca de sorteio.
Caminhos de conceito de símbolo (usar um, no máximo combinar dois):
1. Inicial com significado: a letra da marca trabalhada com recorte, dobra ou espaço negativo que carrega a ideia.
2. Ação do produto: o verbo principal do negócio vira forma (proteger, conectar, construir, cuidar, entregar).
3. Fusão de metáforas: duas ideias do negócio reduzidas a uma forma simples e legível.
4. Espaço negativo: seta escondida, centro protegido, inicial recortada.
5. Geometria de construção: círculos, diagonais, grade e módulos que explicam a forma.
Evitar: raio, foguete ou brilho genéricos sem motivo, animal aleatório, brasão falso de luxo, qualquer semelhança com marca famosa, símbolo complicado demais, variações inconsistentes.
Prancha de marca com ritmo: capa calma com o símbolo, construção do símbolo, aplicação digital, frase de essência, paleta, tipografia, aplicação física, direção de imagem e detalhe. Nem todo painel grita; alternar quieto, funcional, emocional e técnico.
No painel, identidade do cliente é dado do kit da marca: o agente nunca troca logo, cor ou fonte aprovados; propostas novas saem marcadas como proposta.`;

// ------------------------------------------------------------------ roteiro de vídeo
// Origem: hyperframes-creative, referências story-spine e narration.

export const ROTEIRO_DE_VIDEO = `ROTEIRO DE VÍDEO CURTO (anúncio, reels ou explicativo)
- Ritmo de fala natural: cerca de 2,5 palavras por segundo. 15 s são umas 37 palavras; 30 s, umas 75; 60 s, umas 150. O roteiro deve parecer mais curto que o vídeo; pausa é respiro, não buraco.
- O gancho fala a língua de quem assiste: resultado que a pessoa ganha, evita ou finalmente entende. Nada de "olá, somos a empresa X" nem lista de características na abertura.
- Valor antes da evidência: a promessa aparece até a segunda batida; o resto (demonstração, bastidor, mecanismo) é prova a serviço dela. Teste: tirando as provas, o valor continua dito; tirando o valor, sobra só um passeio pelo produto.
- Estrutura: gancho, história (o que faz e para quem, concreto), prova (número e nome reais) e CTA. Um anúncio de 15 s pode ser só gancho, prova e CTA.
- Variar o tipo de gancho: afirmação ousada, pergunta que provoca, contraste, número (com moderação, e só real).
- Escreva o número como deve ser falado ("mais de cento e trinta") e mostre o número exato na tela.
- Visual vem do assunto: frases, objetos e cenas do próprio cliente. Se o elemento poderia aparecer igual no vídeo de outra marca, trocar.
- Escrever como gente fala: frases de tamanhos variados, leitura em voz alta antes de aprovar.`;

// ------------------------------------------------------------------ montagem por agente

/** Agentes do painel que recebem esta base. */
export type AgenteMarketing = "calendario" | "estudio" | "mesa_ads" | "mesa_foto" | "contexto" | "dossie";

/** Blocos de cada agente, em ordem de prioridade (o primeiro é o mais importante). */
export const BLOCOS_POR_AGENTE: Record<AgenteMarketing, readonly string[]> = {
  calendario: [CALENDARIO_EDITORIAL, PLANO_DE_CAMPANHA, FORMULAS_DE_TITULO, CTA_PRINCIPIOS, ESTRUTURAS_DE_CONTEUDO, ANTI_GENERICO],
  estudio: [ANTI_GENERICO, VOZ_DE_MARCA, REVISAO_DE_MARCA, CTA_PRINCIPIOS, IDENTIDADE_DE_MARCA],
  mesa_ads: [OBJECOES_E_VOZ_DO_CLIENTE, POSICIONAMENTO_E_CONCORRENCIA, REVISAO_DE_MARCA, ANTI_GENERICO, ROTEIRO_DE_VIDEO],
  mesa_foto: [ANTI_GENERICO, IDENTIDADE_DE_MARCA],
  contexto: [VOZ_DE_MARCA, POSICIONAMENTO_E_CONCORRENCIA, OBJECOES_E_VOZ_DO_CLIENTE, IDENTIDADE_DE_MARCA],
  dossie: [ANALISE_DE_DESEMPENHO, PLANO_DE_CAMPANHA, OBJECOES_E_VOZ_DO_CLIENTE, SEQUENCIAS_DE_MENSAGEM, SEO_ESSENCIAL],
};

/** Teto padrão de caracteres por agente (cerca de 1 token para 3,5 caracteres em português). */
export const TETO_PADRAO_CARACTERES = 9000;

/**
 * Base de marketing de um agente, cortada em blocos inteiros até o teto.
 * Nunca corta um bloco no meio: se o próximo não cabe, para ali.
 */
export function conhecimentoMarketingPara(agente: AgenteMarketing, tetoCaracteres = TETO_PADRAO_CARACTERES): string {
  const saida: string[] = [];
  let total = 0;
  for (const bloco of BLOCOS_POR_AGENTE[agente]) {
    const custo = bloco.length + (saida.length ? 2 : 0);
    if (total + custo > tetoCaracteres) break;
    saida.push(bloco);
    total += custo;
  }
  return saida.join("\n\n");
}
