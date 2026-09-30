/**
 * Modelo de contrato da Aceleriq, versão 1 (frente CON, 30/09/2026).
 *
 * Texto próprio, escrito do zero a partir da análise dos 7 contratos antigos
 * (plano p1-documentos, seção 3): nada copiado dos modelos de terceiros.
 * Lei citada só a vigente: Código Civil (Lei 10.406/2002), Lei 9.610/1998
 * (direitos autorais), LGPD (Lei 13.709/2018), CDC (Lei 8.078/1990),
 * MP 2.200-2/2001 e Lei 14.063/2020 (assinatura eletrônica).
 *
 * Nasce como "v1 · revisão jurídica pendente": a marca fica só na tela da
 * equipe e nunca entra no documento do cliente. É a fonte do seed da
 * migration 20260930030200_contratos_modelo_v1.sql (o teste confere que o
 * banco e este arquivo têm o mesmo texto).
 */
import type { ClausulaDoModelo, ModeloDeContrato, OpcaoDaVariavel, ServicoDoContrato, VariavelDoModelo } from "../../_shared/contrato-modelo.ts";
import { DIREITOS_PADRAO, variavelDeDireitos } from "../../_shared/contrato-modelo.ts";

export const REVISAO_JURIDICA_V1 = "v1 · revisão jurídica pendente";

const SIM_NAO: OpcaoDaVariavel[] = [
  { valor: "sim", rotulo: "Sim" },
  { valor: "nao", rotulo: "Não" },
];

const DIREITOS: OpcaoDaVariavel[] = [
  { valor: "cessao", rotulo: "Cessão dos direitos patrimoniais após o pagamento" },
  { valor: "licenca", rotulo: "Licença de uso" },
];

const direitosDe = (s: ServicoDoContrato, rotulo: string): VariavelDoModelo => ({
  nome: variavelDeDireitos(s),
  rotulo: `Direitos autorais (${rotulo})`,
  tipo: "escolha",
  obrigatoria: true,
  padrao: DIREITOS_PADRAO[s],
  opcoes: DIREITOS,
  grupo: "servico",
  ajuda: "Cessão: o cliente passa a ser titular dos direitos patrimoniais depois de pagar. Licença: a agência continua titular e o cliente usa.",
});

const PROJETO: VariavelDoModelo[] = [
  { nome: "valor_total", rotulo: "Valor total do projeto", tipo: "moeda", obrigatoria: true, grupo: "quadro" },
  { nome: "condicoes_pagamento", rotulo: "Condições de pagamento", tipo: "texto", obrigatoria: true, padrao: "50% na assinatura e 50% na entrega final", grupo: "quadro" },
];

const MENSAL: VariavelDoModelo[] = [
  { nome: "valor_mensal", rotulo: "Valor mensal", tipo: "moeda", obrigatoria: true, grupo: "quadro" },
  { nome: "vencimento_dia", rotulo: "Dia do vencimento", tipo: "inteiro", obrigatoria: true, grupo: "quadro" },
  { nome: "vigencia_meses", rotulo: "Vigência (meses)", tipo: "inteiro", obrigatoria: true, grupo: "quadro" },
];

const direitosDoBloco = (s: ServicoDoContrato, cessao: string, licenca: string): ClausulaDoModelo[] => [
  { chave: "direitos_cessao", titulo: "Direitos autorais", texto: cessao, quando: { variavel: variavelDeDireitos(s), igual: "cessao" } },
  { chave: "direitos_licenca", titulo: "Direitos autorais", texto: licenca, quando: { variavel: variavelDeDireitos(s), igual: "licenca" } },
];

// ------------------------------------------------------------------ condições gerais

export const CONDICOES_GERAIS_V1: ModeloDeContrato = {
  chave: "condicoes_gerais",
  tipo: "condicoes_gerais",
  servico: null,
  nome: "Condições gerais",
  versao: 1,
  revisao_juridica: REVISAO_JURIDICA_V1,
  variaveis: [
    { nome: "cliente_nome", rotulo: "Nome ou razão social do contratante", tipo: "texto", obrigatoria: true, grupo: "cliente" },
    { nome: "cliente_documento", rotulo: "CPF ou CNPJ do contratante", tipo: "texto", obrigatoria: true, grupo: "cliente" },
    { nome: "cliente_endereco", rotulo: "Endereço do contratante", tipo: "texto", obrigatoria: true, grupo: "cliente" },
    { nome: "cliente_representante", rotulo: "Representante do contratante", tipo: "texto", grupo: "cliente" },
    { nome: "cliente_email", rotulo: "E-mail do canal oficial", tipo: "texto", obrigatoria: true, grupo: "cliente" },
    {
      nome: "cliente_tipo_pessoa", rotulo: "Tipo de pessoa", tipo: "escolha", padrao: "pj", grupo: "cliente",
      opcoes: [{ valor: "pf", rotulo: "Pessoa física" }, { valor: "mei", rotulo: "MEI" }, { valor: "pj", rotulo: "Pessoa jurídica" }],
    },
    { nome: "inicio", rotulo: "Data de início", tipo: "data", obrigatoria: true, grupo: "quadro" },
    { nome: "forma_pagamento", rotulo: "Forma de pagamento", tipo: "texto", obrigatoria: true, padrao: "PIX ou boleto bancário", lembrar: true, grupo: "quadro" },
    { nome: "revisoes_rodadas", rotulo: "Rodadas de revisão por entrega", tipo: "inteiro", obrigatoria: true, padrao: "2", grupo: "quadro", feminino: true },
    { nome: "valor_hora_extra", rotulo: "Valor da hora técnica extra", tipo: "moeda", obrigatoria: true, lembrar: true, grupo: "quadro" },
    { nome: "prazo_resposta_dias", rotulo: "Prazo de resposta do contratante (dias úteis)", tipo: "inteiro", obrigatoria: true, padrao: "5", lembrar: true, grupo: "quadro" },
    {
      nome: "silencio_efeito", rotulo: "Efeito do silêncio do contratante", tipo: "escolha", obrigatoria: true, padrao: "pausa", grupo: "quadro",
      opcoes: [{ valor: "pausa", rotulo: "Pausa o cronograma" }, { valor: "aprovacao_tacita", rotulo: "Vira aprovação depois do lembrete" }],
    },
    { nome: "portfolio", rotulo: "Portfólio liberado", tipo: "escolha", obrigatoria: true, padrao: "sim", opcoes: SIM_NAO, grupo: "quadro" },
    { nome: "uso_ia", rotulo: "Uso de IA com curadoria humana", tipo: "escolha", obrigatoria: true, padrao: "sim", opcoes: SIM_NAO, grupo: "quadro" },
    { nome: "multa_rescisao_percentual", rotulo: "Multa por rescisão sem justa causa (% do saldo)", tipo: "percentual", obrigatoria: true, padrao: "20", lembrar: true, grupo: "quadro" },
    { nome: "aviso_previo_dias", rotulo: "Aviso prévio (dias)", tipo: "inteiro", obrigatoria: true, padrao: "30", lembrar: true, grupo: "quadro" },
    { nome: "reajuste_indice", rotulo: "Índice de reajuste e correção", tipo: "texto", obrigatoria: true, padrao: "IPCA", lembrar: true, grupo: "quadro" },
    { nome: "suspensao_atraso_dias", rotulo: "Suspensão por atraso de pagamento (dias)", tipo: "inteiro", obrigatoria: true, padrao: "15", lembrar: true, grupo: "quadro" },
    { nome: "proposta_numero", rotulo: "Número da proposta comercial", tipo: "texto", grupo: "quadro" },
  ],
  clausulas: [
    {
      chave: "objeto",
      titulo: "Objeto e ordem de leitura",
      texto: [
        "Este contrato regula a prestação, pela CONTRATADA, dos serviços indicados no quadro-resumo e descritos no anexo de cada serviço.",
        "Fazem parte deste contrato o quadro-resumo, estas condições gerais, os anexos de serviço e, quando indicada no quadro-resumo, a proposta comercial aceita. Havendo conflito, vale primeiro o quadro-resumo, depois o anexo do serviço, depois estas condições gerais e, por último, a proposta comercial.",
      ].join("\n"),
    },
    {
      chave: "definicoes",
      titulo: "Definições",
      texto: [
        "Para este contrato:",
        "- entrega é cada peça, arquivo, página ou etapa listada no anexo do serviço;",
        "- rodada de revisão é um conjunto único de pedidos de ajuste sobre uma entrega, enviado de uma só vez pelo canal oficial;",
        "- aprovação é a concordância do CONTRATANTE com uma entrega, registrada no painel da CONTRATADA ou por escrito no canal oficial;",
        "- dia útil é o dia de segunda a sexta-feira que não seja feriado nacional nem feriado na cidade da sede da CONTRATADA;",
        "- material do cliente é todo texto, imagem, marca, acesso, dado ou informação que o CONTRATANTE fornece para a execução dos serviços;",
        "- canal oficial é o e-mail indicado no quadro-resumo e o painel da CONTRATADA.",
      ].join("\n"),
    },
    {
      chave: "obrigacoes_contratada",
      titulo: "Obrigações da CONTRATADA",
      texto: [
        "A CONTRATADA executa os serviços com técnica e cuidado, nos prazos combinados, com equipe própria ou parceiros sob sua responsabilidade.",
        "A CONTRATADA mantém o CONTRATANTE informado do andamento pelo painel, avisa com antecedência qualquer risco de atraso e segue a legislação aplicável, inclusive a de proteção de dados.",
      ].join("\n"),
    },
    {
      chave: "obrigacoes_contratante",
      titulo: "Obrigações do CONTRATANTE",
      texto: [
        "O CONTRATANTE fornece os materiais e as informações necessários nos prazos combinados e paga os valores em dia.",
        "O CONTRATANTE concede os acessos a contas e ferramentas por convite de parceiro ou por usuário próprio da CONTRATADA. Nenhuma senha pessoal do CONTRATANTE é pedida nem guardada para a execução deste contrato.",
        "O CONTRATANTE responde pela veracidade, pela legalidade e pelos direitos de uso de todo material do cliente e de todo conteúdo que aprovar, inclusive quanto a publicidade enganosa, direitos de terceiros, imagem de pessoas e normas do seu setor de atuação.",
      ].join("\n"),
    },
    {
      chave: "revisoes",
      titulo: "Aprovações e revisões",
      texto: [
        "Cada entrega inclui {{revisoes_rodadas}} rodadas de revisão. Os pedidos de ajuste de uma rodada são enviados juntos, numa única mensagem pelo canal oficial ou no painel.",
        "Não é revisão, e é orçado à parte, o ajuste que muda o briefing, o escopo ou uma entrega já aprovada. Rodadas além das incluídas são cobradas por hora técnica, no valor de {{valor_hora_extra}} por hora, com orçamento aceito antes do início.",
        "A aprovação de cada etapa é condição para o início da seguinte. A aprovação fica registrada no painel da CONTRATADA ou por escrito no canal oficial.",
      ].join("\n"),
    },
    {
      chave: "silencio_pausa",
      titulo: "Prazo de resposta e silêncio",
      quando: { variavel: "silencio_efeito", igual: "pausa" },
      texto: [
        "O CONTRATANTE responde a cada pedido de aprovação, material ou informação em até {{prazo_resposta_dias}} dias úteis.",
        "Sem resposta nesse prazo, o cronograma fica suspenso e volta a correr no dia útil seguinte à resposta, com as datas seguintes ajustadas na mesma medida. A suspensão não muda os valores nem os vencimentos combinados.",
        "Se a suspensão passar de 30 dias corridos, a CONTRATADA pode reorganizar a sua agenda de produção e informar as novas datas pelo canal oficial.",
      ].join("\n"),
    },
    {
      chave: "silencio_aprovacao",
      titulo: "Prazo de resposta e silêncio",
      quando: { variavel: "silencio_efeito", igual: "aprovacao_tacita" },
      texto: [
        "O CONTRATANTE responde a cada pedido de aprovação, material ou informação em até {{prazo_resposta_dias}} dias úteis.",
        "Sem resposta nesse prazo, a CONTRATADA envia um lembrete pelo canal oficial. Se o silêncio continuar por mais {{prazo_resposta_dias}} dias úteis depois do lembrete, a entrega é considerada aprovada e o cronograma segue.",
      ].join("\n"),
    },
    {
      chave: "prazos",
      titulo: "Prazos",
      texto: "Os prazos contam em dias úteis a partir do recebimento dos materiais necessários e da aprovação da etapa anterior. Não é atraso da CONTRATADA o que decorre de falta de material, acesso ou aprovação do CONTRATANTE, de falha de plataforma de terceiros ou de força maior.",
    },
    {
      chave: "pagamento",
      titulo: "Preço, pagamento, atraso e reajuste",
      texto: [
        "O CONTRATANTE paga os valores do quadro-resumo, na forma e nas datas ali indicadas.",
        "Pagamento em atraso tem multa de 2% (dois por cento), juros de 1% (um por cento) ao mês, proporcionais aos dias de atraso, e correção monetária pelo {{reajuste_indice}}.",
        "Com atraso superior a {{suspensao_atraso_dias}} dias corridos, a CONTRATADA pode suspender as entregas até a regularização, depois de aviso pelo canal oficial, e os prazos ficam suspensos pelo mesmo período.",
        "Os valores mensais são reajustados a cada 12 meses pela variação acumulada do {{reajuste_indice}} no período, ou do índice oficial que o substituir.",
      ].join("\n"),
    },
    {
      chave: "tributos",
      titulo: "Nota fiscal, tributos e despesas",
      texto: [
        "A CONTRATADA emite nota fiscal de cada pagamento. Cada parte responde pelos tributos que a lei lhe atribui.",
        "Não estão incluídas as despesas que não constam deste contrato, como impressão, mídia paga, compra de imagens, fontes ou músicas, viagens e produção com terceiros. Elas dependem de aprovação prévia do CONTRATANTE, que paga diretamente ao fornecedor ou reembolsa a CONTRATADA.",
      ].join("\n"),
    },
    {
      chave: "propriedade",
      titulo: "Propriedade intelectual",
      texto: [
        "A regra de direitos de cada serviço está no quadro-resumo e no anexo do serviço.",
        "Na cessão, a CONTRATADA cede ao CONTRATANTE, de forma definitiva e depois do pagamento integral do serviço correspondente, os direitos patrimoniais de autor sobre as entregas aprovadas, para reprodução, adaptação, distribuição e comunicação ao público em qualquer meio, nos termos dos artigos 29 e 49 da Lei 9.610/1998. Os direitos morais permanecem com os autores, como manda a lei.",
        "Na licença, a CONTRATADA continua titular dos direitos e concede ao CONTRATANTE, depois do pagamento integral, licença de uso exclusiva, sem prazo, para a finalidade do serviço, que não pode ser transferida a terceiros sem autorização escrita.",
        "Até o pagamento integral, o CONTRATANTE tem apenas licença provisória de uso das entregas já aprovadas. Propostas, conceitos e peças não aprovados continuam da CONTRATADA, que pode reaproveitá-los sem identificar o CONTRATANTE.",
        "Arquivos abertos e editáveis só são entregues quando o anexo do serviço prevê. Bancos de imagem, fontes, músicas, modelos e plugins de terceiros seguem a licença do fornecedor; quando a licença precisar estar em nome do CONTRATANTE, a compra é dele.",
      ].join("\n"),
    },
    {
      chave: "portfolio_sim",
      titulo: "Portfólio",
      quando: { variavel: "portfolio", igual: "sim" },
      texto: "A CONTRATADA pode mostrar as entregas no seu portfólio, site e redes sociais depois que forem publicadas pelo CONTRATANTE, sem revelar informação confidencial. O CONTRATANTE pode pedir a retirada a qualquer momento, pelo canal oficial.",
    },
    {
      chave: "portfolio_nao",
      titulo: "Portfólio",
      quando: { variavel: "portfolio", igual: "nao" },
      texto: "A CONTRATADA não usa as entregas em portfólio, site ou redes sociais sem autorização escrita do CONTRATANTE.",
    },
    {
      chave: "confidencialidade",
      titulo: "Confidencialidade",
      texto: "As partes mantêm em sigilo as informações não públicas que recebem uma da outra, durante o contrato e por 5 (cinco) anos depois do término. Não é confidencial o que já era público, o que a parte já conhecia de forma legítima ou o que precisa ser revelado por ordem legal ou judicial, com aviso à outra parte sempre que possível.",
    },
    {
      chave: "lgpd",
      titulo: "Proteção de dados pessoais",
      texto: [
        "As partes cumprem a Lei 13.709/2018 (LGPD). Nos dados pessoais tratados para executar os serviços, como dados de leads, mensagens, formulários, públicos de anúncios e pixels, o CONTRATANTE é o controlador e a CONTRATADA é operadora, e trata os dados só conforme as instruções do CONTRATANTE e este contrato.",
        "A CONTRATADA adota medidas de segurança compatíveis com o risco, limita o acesso a quem precisa, só usa suboperadores necessários ao serviço (como hospedagem, e-mail, plataformas de anúncio e ferramentas de produção), com as mesmas obrigações, e comunica ao CONTRATANTE incidente de segurança relevante em até 48 (quarenta e oito) horas da ciência. No fim do contrato, elimina ou devolve os dados, salvo a guarda exigida por lei.",
        "O CONTRATANTE garante que tem base legal para os dados que fornece e para as campanhas, coletas e comunicações que aprova.",
        "Os dados de contato e de assinatura das partes (nome, e-mail, endereço IP, data e hora) são tratados para executar este contrato e fazer prova da assinatura.",
      ].join("\n"),
    },
    {
      chave: "ia_sim",
      titulo: "Inteligência artificial e bancos de imagem",
      quando: { variavel: "uso_ia", igual: "sim" },
      texto: [
        "A CONTRATADA pode usar ferramentas de inteligência artificial e bancos de imagem como apoio na criação. A curadoria, a edição e a aprovação final de cada entrega são feitas por pessoas da equipe.",
        "Dado pessoal sensível e informação confidencial do CONTRATANTE não são inseridos em ferramenta de terceiros sem necessidade e sem os cuidados de segurança devidos. Logotipo, fotos reais e dados do CONTRATANTE entram nas peças como material do cliente, sem recriação por gerador de imagem.",
        "Como a proteção autoral de conteúdo gerado apenas por máquina é incerta, a CONTRATADA não garante exclusividade nem registrabilidade de elementos gerados por inteligência artificial. No símbolo principal de uma marca destinada a registro, a criação é feita por pessoas.",
      ].join("\n"),
    },
    {
      chave: "ia_nao",
      titulo: "Inteligência artificial e bancos de imagem",
      quando: { variavel: "uso_ia", igual: "nao" },
      texto: "A CONTRATADA não usa ferramentas de inteligência artificial generativa na criação das entregas deste contrato. Imagens de bancos seguem a licença do fornecedor.",
    },
    {
      chave: "resultado",
      titulo: "Sem garantia de resultado",
      texto: [
        "Os serviços são obrigação de meio. A CONTRATADA não garante número de seguidores, alcance, vendas, leads, retorno sobre investimento nem posição em buscadores, que dependem do mercado, do produto, do orçamento e de plataformas de terceiros.",
        "Plataformas como Meta, Google e TikTok têm regras próprias e podem reprovar anúncios, limitar alcance ou restringir contas. A CONTRATADA segue essas regras e apoia o CONTRATANTE na contestação, mas não responde pelas decisões delas.",
      ].join("\n"),
    },
    {
      chave: "responsabilidade",
      titulo: "Limite de responsabilidade",
      texto: "Cada parte responde pelos danos diretos que causar. Salvo dolo, culpa grave ou violação de dados pessoais, a responsabilidade total da CONTRATADA fica limitada ao valor pago pelo CONTRATANTE nos 12 (doze) meses anteriores ao fato. Nenhuma parte responde por lucros cessantes ou danos indiretos. Quando o CONTRATANTE for consumidor, prevalecem as garantias do Código de Defesa do Consumidor (Lei 8.078/1990).",
    },
    {
      chave: "rescisao",
      titulo: "Vigência, renovação e rescisão",
      texto: [
        "O contrato vale da data de início até a conclusão dos serviços de projeto e, nos serviços mensais, pela vigência do quadro-resumo, renovada automaticamente por períodos iguais se nenhuma parte avisar o contrário com {{aviso_previo_dias}} dias de antecedência.",
        "Qualquer parte pode encerrar os serviços mensais a qualquer momento, com aviso prévio de {{aviso_previo_dias}} dias pelo canal oficial, pagando o período trabalhado, respeitada a vigência mínima quando o anexo do serviço a prever.",
        "Nos serviços de projeto, quem encerrar sem justa causa paga as etapas concluídas e a parte proporcional da etapa em andamento, mais multa de {{multa_rescisao_percentual}} sobre o saldo ainda não executado. A multa é proporcional ao que falta e pode ser reduzida nos termos do artigo 413 do Código Civil.",
        "Qualquer parte pode rescindir por justa causa, sem multa, se a outra descumprir obrigação relevante e não corrigir em 10 (dez) dias úteis depois de aviso pelo canal oficial.",
        "No encerramento, a CONTRATADA entrega o que já foi pago e o CONTRATANTE revoga os acessos concedidos.",
      ].join("\n"),
    },
    {
      chave: "forca_maior",
      titulo: "Caso fortuito e força maior",
      texto: "Nenhuma parte responde por atraso ou falha causados por caso fortuito ou força maior, nos termos do artigo 393 do Código Civil, como indisponibilidade prolongada de plataformas, desastres e atos de autoridade. Os prazos ficam suspensos enquanto durar o impedimento.",
    },
    {
      chave: "comunicacoes",
      titulo: "Comunicações",
      texto: "As comunicações oficiais são feitas pelo canal oficial. Mensagens por aplicativo servem para agilidade, mas pedidos de revisão, aprovações e avisos de rescisão valem quando registrados no painel ou enviados por e-mail. Cada parte mantém os seus contatos atualizados.",
    },
    {
      chave: "assinatura",
      titulo: "Assinatura eletrônica e integridade",
      texto: [
        "As partes concordam em assinar este contrato eletronicamente, nos termos do artigo 10, § 2º, da Medida Provisória 2.200-2/2001 e da Lei 14.063/2020, e reconhecem a validade da assinatura feita no painel da CONTRATADA com nome, e-mail, aceite, endereço IP, data e hora.",
        "O documento assinado é identificado pelo seu código de integridade (SHA-256), registrado na página de carimbo ao final com a trilha de eventos. Qualquer alteração depois do envio gera uma nova versão, com novo código, e invalida o link da versão anterior.",
      ].join("\n"),
    },
    {
      chave: "disputas",
      titulo: "Solução de conflitos e foro",
      texto: [
        "As partes tentam resolver qualquer divergência primeiro por negociação direta, pelo canal oficial, em até 15 (quinze) dias do aviso.",
        "Sem acordo, as partes podem buscar mediação, presencial ou online, antes de qualquer ação judicial.",
        "Persistindo o conflito, fica eleito o foro da comarca de {{agencia_foro}}, ressalvado o direito do CONTRATANTE consumidor de propor ação no foro do seu domicílio.",
      ].join("\n"),
    },
    {
      chave: "gerais",
      titulo: "Disposições gerais",
      texto: "Tolerância não é renúncia. Se uma cláusula for considerada inválida, as demais continuam valendo. Não há vínculo empregatício ou societário entre as partes nem entre uma parte e a equipe da outra. Este contrato só muda por aditivo ou por nova versão assinada pelas partes. Aplica-se a lei brasileira, em especial o Código Civil (Lei 10.406/2002).",
    },
  ],
};

// ------------------------------------------------------------------ blocos por serviço

const bloco = (servico: ServicoDoContrato, nome: string, variaveis: VariavelDoModelo[], clausulas: ClausulaDoModelo[]): ModeloDeContrato => ({
  chave: `bloco_${servico}`,
  tipo: "bloco",
  servico,
  nome,
  versao: 1,
  revisao_juridica: REVISAO_JURIDICA_V1,
  variaveis,
  clausulas,
});

export const BLOCO_SOCIAL_V1 = bloco("social", "Social e Instagram", [
  { nome: "social_perfis", rotulo: "Perfis cobertos", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: @marca no Instagram e a página da marca no Facebook." },
  { nome: "social_pecas_mes", rotulo: "Peças por mês", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: 8 carrosséis, 4 reels e 12 stories." },
  { nome: "social_ciclo", rotulo: "Ciclo do planejamento", tipo: "escolha", obrigatoria: true, padrao: "mensal", grupo: "servico", opcoes: [{ valor: "mensal", rotulo: "mensal" }, { valor: "quinzenal", rotulo: "quinzenal" }] },
  { nome: "social_publicacao", rotulo: "Quem publica", tipo: "escolha", obrigatoria: true, padrao: "contratada", grupo: "servico", opcoes: [{ valor: "contratada", rotulo: "A agência publica" }, { valor: "cliente", rotulo: "O cliente publica" }] },
  { nome: "social_comunidade", rotulo: "Gestão de comunidade (comentários e mensagens)", tipo: "escolha", obrigatoria: true, padrao: "nao", opcoes: SIM_NAO, grupo: "servico" },
  ...MENSAL,
  direitosDe("social", "social"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA planeja, cria e entrega, por mês, {{social_pecas_mes}}, para os perfis {{social_perfis}}. O escopo vale só para os perfis nomeados; outros perfis ou páginas dependem de aditivo." },
  { chave: "ciclo", titulo: "Planejamento e aprovação", texto: "O planejamento é apresentado em ciclo {{social_ciclo}} e aprovado no painel antes da produção. Cada peça é aprovada no painel antes da publicação, com as rodadas de revisão das condições gerais." },
  { chave: "publicacao_agencia", titulo: "Publicação", quando: { variavel: "social_publicacao", igual: "contratada" }, texto: "A CONTRATADA publica as peças aprovadas nas datas combinadas, com acesso de parceiro concedido pelo CONTRATANTE no gerenciador da plataforma, sem receber senha. Atraso de publicação causado por falha da plataforma não é falha da CONTRATADA." },
  { chave: "publicacao_cliente", titulo: "Publicação", quando: { variavel: "social_publicacao", igual: "cliente" }, texto: "O CONTRATANTE publica as peças aprovadas, com os arquivos e as legendas entregues pela CONTRATADA no painel." },
  { chave: "comunidade_sim", titulo: "Gestão de comunidade", quando: { variavel: "social_comunidade", igual: "sim" }, texto: "A CONTRATADA responde comentários e mensagens diretas em dias úteis, no horário comercial, seguindo o guia de respostas aprovado pelo CONTRATANTE. Assuntos de preço especial, reclamação grave, saúde, questão jurídica ou dado pessoal sensível são repassados ao CONTRATANTE." },
  { chave: "comunidade_nao", titulo: "Gestão de comunidade", quando: { variavel: "social_comunidade", igual: "nao" }, texto: "A gestão de comunidade (responder comentários e mensagens) não está incluída." },
  { chave: "nao_incluido", titulo: "O que não está incluído", texto: "Não estão incluídos, salvo aditivo: mídia paga e gestão de anúncios, produção de fotos e vídeos em campo, contratação de influenciadores, impressão e verba de impulsionamento. Peças não usadas no mês não acumulam para o mês seguinte, salvo atraso causado pela CONTRATADA, que é compensado no mês seguinte." },
  ...direitosDoBloco("social",
    "Os direitos patrimoniais das peças publicadas são cedidos ao CONTRATANTE depois do pagamento do mês correspondente, na forma das condições gerais.",
    "O CONTRATANTE recebe licença de uso das peças publicadas nos perfis nomeados, durante o contrato e depois dele. Alterar a arte ou usá-la em outros meios depende de autorização da CONTRATADA."),
]);

export const BLOCO_SITE_V1 = bloco("site", "Sites e landing pages", [
  { nome: "site_tipo", rotulo: "O que será criado", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: site institucional com 5 páginas; landing page de captação." },
  { nome: "site_plataforma", rotulo: "Plataforma", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: WordPress, Next.js, Webflow." },
  { nome: "site_integracoes", rotulo: "Integrações", tipo: "texto", obrigatoria: true, padrao: "formulário de contato e botão de WhatsApp", grupo: "servico" },
  { nome: "site_prazo_layout_dias", rotulo: "Prazo do layout (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  { nome: "site_prazo_dev_dias", rotulo: "Prazo do desenvolvimento (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  { nome: "site_garantia_dias", rotulo: "Garantia de correção (dias)", tipo: "inteiro", obrigatoria: true, padrao: "30", lembrar: true, grupo: "servico" },
  { nome: "site_hospedagem", rotulo: "Hospedagem e domínio", tipo: "escolha", obrigatoria: true, padrao: "cliente", grupo: "servico", opcoes: [{ valor: "cliente", rotulo: "Contratados pelo cliente" }, { valor: "contratada", rotulo: "Hospedagem pela agência" }] },
  ...PROJETO,
  direitosDe("site", "site"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA cria {{site_tipo}}, na plataforma {{site_plataforma}}, com layout responsivo para celular e computador e as integrações: {{site_integracoes}}." },
  { chave: "etapas", titulo: "Etapas e prazos", texto: "O layout é apresentado em até {{site_prazo_layout_dias}} dias úteis depois do briefing e dos materiais. Com o layout aprovado, o desenvolvimento leva até {{site_prazo_dev_dias}} dias úteis. Depois da aprovação final, a CONTRATADA publica o site no domínio do CONTRATANTE e faz um treinamento de uso de até 1 (uma) hora." },
  { chave: "seo", titulo: "SEO e acessibilidade", texto: "O site sai com SEO técnico básico: título e descrição por página, endereços legíveis, mapa do site, imagens otimizadas e marcação para compartilhamento. Não há promessa de posição em buscadores. A acessibilidade segue boas práticas de contraste, texto alternativo e navegação por teclado nas páginas entregues." },
  { chave: "hospedagem_cliente", titulo: "Domínio, hospedagem e licenças", quando: { variavel: "site_hospedagem", igual: "cliente" }, texto: "Domínio, hospedagem e licenças pagas (temas, plugins e ferramentas) são contratados e pagos pelo CONTRATANTE, em nome dele. A CONTRATADA orienta a escolha e faz a configuração." },
  { chave: "hospedagem_agencia", titulo: "Domínio, hospedagem e licenças", quando: { variavel: "site_hospedagem", igual: "contratada" }, texto: "A CONTRATADA contrata a hospedagem e cobra o custo à parte, conforme orçamento aceito. O domínio fica sempre registrado em nome do CONTRATANTE. Licenças pagas de temas, plugins e ferramentas são do CONTRATANTE." },
  { chave: "garantia", titulo: "Garantia e manutenção", texto: "Durante {{site_garantia_dias}} dias depois da publicação, a CONTRATADA corrige sem custo as falhas de funcionamento do que entregou. Funções novas, mudanças de conteúdo e atualizações depois desse prazo são manutenção, contratada à parte." },
  { chave: "privacidade", titulo: "Privacidade do site", texto: "Site com formulário ou ferramenta de medição recebe aviso de cookies e política de privacidade, redigidos com as informações do CONTRATANTE, que é o controlador desses dados." },
  { chave: "acessos", titulo: "Entrega de acessos", texto: "Depois do pagamento integral, a CONTRATADA entrega os acessos administrativos e, quando a plataforma permitir, o código-fonte ou a exportação do site." },
  ...direitosDoBloco("site",
    "Depois do pagamento integral, os direitos patrimoniais sobre o layout e o código criados para o CONTRATANTE são cedidos a ele. Componentes de terceiros e bibliotecas de código aberto seguem as suas licenças, e as ferramentas internas da CONTRATADA continuam dela.",
    "A CONTRATADA continua titular do layout e do código e concede ao CONTRATANTE, depois do pagamento integral, licença de uso exclusiva e sem prazo para o domínio contratado. O CONTRATANTE pode mudar de hospedagem e contratar manutenção com terceiros. Um crédito discreto da CONTRATADA no rodapé pode ser mantido, salvo pedido em contrário."),
]);

export const BLOCO_MARCA_V1 = bloco("marca", "Marca e identidade visual", [
  { nome: "marca_conceitos", rotulo: "Conceitos apresentados", tipo: "inteiro", obrigatoria: true, padrao: "2", grupo: "servico" },
  { nome: "marca_entregaveis", rotulo: "Entregáveis", tipo: "textoLongo", obrigatoria: true, padrao: "logotipo principal e variações, paleta de cores, tipografia, padrões de aplicação e manual da marca", grupo: "servico" },
  { nome: "marca_papelaria", rotulo: "Papelaria", tipo: "texto", obrigatoria: true, padrao: "não incluída", grupo: "servico" },
  { nome: "marca_prazo_conceitos_dias", rotulo: "Prazo dos conceitos (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  { nome: "marca_prazo_final_dias", rotulo: "Prazo dos arquivos finais (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  { nome: "marca_busca_inpi", rotulo: "Busca preliminar no INPI", tipo: "escolha", obrigatoria: true, padrao: "nao", opcoes: SIM_NAO, grupo: "servico" },
  ...PROJETO,
  direitosDe("marca", "marca"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA cria a identidade visual com: {{marca_entregaveis}}. Papelaria: {{marca_papelaria}}." },
  { chave: "etapas", titulo: "Etapas e prazos", texto: "A CONTRATADA apresenta {{marca_conceitos}} conceitos em até {{marca_prazo_conceitos_dias}} dias úteis depois do briefing, com a explicação de cada um. O CONTRATANTE escolhe um conceito, que passa pelas rodadas de revisão. Com o conceito aprovado, os arquivos finais saem em até {{marca_prazo_final_dias}} dias úteis." },
  { chave: "formatos", titulo: "Formatos", texto: "Os arquivos finais são entregues em PNG, SVG e PDF, e em AI ou EPS quando pedido, nas versões de cor para tela (RGB) e para impressão (CMYK). Fontes com licença paga são indicadas pela CONTRATADA e compradas pelo CONTRATANTE." },
  { chave: "inpi_sim", titulo: "Registro no INPI", quando: { variavel: "marca_busca_inpi", igual: "sim" }, texto: "A CONTRATADA faz uma busca preliminar de marcas parecidas na base pública do INPI, na classe indicada pelo CONTRATANTE, e informa o resultado. A busca é preliminar e não garante o registro, que depende de análise do INPI. O pedido de registro cabe ao CONTRATANTE, que pode contratar profissional especializado." },
  { chave: "inpi_nao", titulo: "Registro no INPI", quando: { variavel: "marca_busca_inpi", igual: "nao" }, texto: "A criação não inclui busca de anterioridade nem pedido de registro no INPI e não garante que a marca seja registrável. A CONTRATADA recomenda a busca e o pedido de registro antes do lançamento." },
  { chave: "sigilo", titulo: "Sigilo até o lançamento", texto: "Até o lançamento, a CONTRATADA não divulga a marca em desenvolvimento. Depois do lançamento vale a regra de portfólio das condições gerais." },
  ...direitosDoBloco("marca",
    "Depois do pagamento integral, a CONTRATADA cede ao CONTRATANTE os direitos patrimoniais sobre a marca escolhida e seus elementos, para uso e registro em qualquer meio. Os conceitos não escolhidos continuam da CONTRATADA.",
    "A CONTRATADA continua titular e concede ao CONTRATANTE, depois do pagamento integral, licença de uso exclusiva e sem prazo da marca escolhida. A licença pode dificultar o registro da marca pelo CONTRATANTE no INPI."),
]);

export const BLOCO_NAMING_V1 = bloco("naming", "Naming", [
  { nome: "naming_candidatos", rotulo: "Nomes candidatos", tipo: "inteiro", obrigatoria: true, padrao: "10", grupo: "servico" },
  { nome: "naming_finalistas", rotulo: "Finalistas apresentados", tipo: "inteiro", obrigatoria: true, padrao: "3", grupo: "servico" },
  { nome: "naming_prazo_dias", rotulo: "Prazo (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  ...PROJETO,
  direitosDe("naming", "naming"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA pesquisa e cria {{naming_candidatos}} nomes candidatos e apresenta {{naming_finalistas}} finalistas, com a justificativa de cada um, em até {{naming_prazo_dias}} dias úteis depois do briefing." },
  { chave: "triagem", titulo: "Triagem preliminar", texto: "Os finalistas passam por triagem preliminar de domínio, de perfil em redes sociais e de marcas parecidas na base pública do INPI. A triagem não garante disponibilidade futura nem registrabilidade: o registro depende de análise do INPI." },
  ...direitosDoBloco("naming",
    "Depois do pagamento integral, o nome escolhido passa a ser do CONTRATANTE, que pode usá-lo e registrá-lo livremente. Os nomes não escolhidos continuam da CONTRATADA.",
    "A CONTRATADA concede ao CONTRATANTE, depois do pagamento integral, licença de uso exclusiva e sem prazo do nome escolhido. A licença pode dificultar o registro do nome pelo CONTRATANTE no INPI."),
]);

export const BLOCO_TRAFEGO_V1 = bloco("trafego", "Tráfego pago", [
  { nome: "trafego_plataformas", rotulo: "Plataformas", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: Meta Ads e Google Ads." },
  { nome: "trafego_verba_estimada", rotulo: "Verba de mídia estimada por mês", tipo: "moeda", grupo: "servico" },
  { nome: "trafego_percentual_verba", rotulo: "Percentual sobre a verba (além do fee)", tipo: "percentual", grupo: "servico" },
  { nome: "trafego_setup", rotulo: "Configuração inicial", tipo: "texto", obrigatoria: true, padrao: "pixel, eventos de conversão e públicos", grupo: "servico" },
  ...MENSAL,
  direitosDe("trafego", "criativos de anúncio"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA planeja, configura e gere campanhas em {{trafego_plataformas}}, com configuração inicial de {{trafego_setup}}, otimização contínua e relatório mensal com investimento, resultados e próximos passos." },
  { chave: "remuneracao_percentual", titulo: "Remuneração variável", quando: { variavel: "trafego_percentual_verba", preenchida: true }, texto: "Além do valor mensal, a CONTRATADA recebe {{trafego_percentual_verba}} sobre a verba de mídia efetivamente investida no mês, conforme o relatório das plataformas." },
  { chave: "verba", titulo: "Verba de mídia", texto: "A verba de mídia é paga pelo CONTRATANTE diretamente às plataformas, em conta de anúncios em nome dele e com o meio de pagamento dele. A CONTRATADA não recebe nem repassa verba de mídia." },
  { chave: "verba_estimada", titulo: "Verba estimada", quando: { variavel: "trafego_verba_estimada", preenchida: true }, texto: "A verba de mídia estimada é de {{trafego_verba_estimada}} por mês. Mudanças de verba são combinadas pelo canal oficial." },
  { chave: "acessos", titulo: "Acessos", texto: "O CONTRATANTE dá à CONTRATADA acesso de parceiro às contas de anúncio, ao gerenciador de negócios e às ferramentas de medição, sem senha pessoal. As contas continuam do CONTRATANTE." },
  { chave: "politicas", titulo: "Políticas das plataformas", texto: "As campanhas seguem as políticas das plataformas. Reprovação de anúncio, restrição ou bloqueio de conta decididos pela plataforma não são falha da CONTRATADA, que apoia a contestação e a adequação." },
  { chave: "dados", titulo: "Pixel, públicos e dados", texto: "Pixel, API de conversões e listas de clientes tratam dados pessoais. O CONTRATANTE, como controlador, mantém aviso de privacidade e base legal no site, e listas de clientes só vão às plataformas com base legal e pelo meio seguro da própria plataforma." },
  ...direitosDoBloco("trafego",
    "Os direitos patrimoniais dos criativos de anúncio feitos pela CONTRATADA são cedidos ao CONTRATANTE depois do pagamento do mês correspondente.",
    "O CONTRATANTE recebe licença de uso dos criativos de anúncio nas contas dele, durante o contrato e depois dele."),
]);

export const BLOCO_VIDEO_V1 = bloco("video", "Vídeo e motion", [
  { nome: "video_quantidade", rotulo: "Quantidade de vídeos", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: 4 vídeos." },
  { nome: "video_duracao", rotulo: "Duração", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: até 60 segundos cada." },
  { nome: "video_formatos", rotulo: "Formatos", tipo: "texto", obrigatoria: true, padrao: "vertical 9:16", grupo: "servico" },
  {
    nome: "video_captacao", rotulo: "Origem das imagens", tipo: "escolha", obrigatoria: true, padrao: "cliente", grupo: "servico",
    opcoes: [{ valor: "diarias", rotulo: "Captação pela agência" }, { valor: "cliente", rotulo: "Material do cliente" }, { valor: "motion", rotulo: "Motion e animação" }],
  },
  { nome: "video_diarias", rotulo: "Diárias de captação", tipo: "inteiro", grupo: "servico", feminino: true },
  { nome: "video_prazo_dias", rotulo: "Prazo de entrega (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  { nome: "video_brutos", rotulo: "Entrega dos arquivos brutos", tipo: "escolha", obrigatoria: true, padrao: "nao", opcoes: SIM_NAO, grupo: "servico" },
  ...PROJETO,
  direitosDe("video", "vídeo"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA produz {{video_quantidade}}, com {{video_duracao}}, no formato {{video_formatos}}, em até {{video_prazo_dias}} dias úteis depois do roteiro aprovado e do material recebido." },
  { chave: "roteiro", titulo: "Roteiro", texto: "Cada vídeo parte de roteiro aprovado pelo CONTRATANTE antes da captação ou da produção. Mudar o roteiro depois de captado é refação, orçada à parte." },
  { chave: "captacao_diarias", titulo: "Captação", quando: { variavel: "video_captacao", igual: "diarias" }, texto: "A captação é feita pela CONTRATADA em {{video_diarias}} diárias, em local e data combinados. Remarcação pedida pelo CONTRATANTE com menos de 48 (quarenta e oito) horas pode ter custo de deslocamento e equipe." },
  { chave: "captacao_cliente", titulo: "Material de vídeo", quando: { variavel: "video_captacao", igual: "cliente" }, texto: "As imagens são fornecidas pelo CONTRATANTE, que responde pela qualidade técnica e pelos direitos do material. A CONTRATADA orienta a gravação quando pedido." },
  { chave: "captacao_motion", titulo: "Motion e animação", quando: { variavel: "video_captacao", igual: "motion" }, texto: "Os vídeos são feitos em motion design ou animação, a partir do roteiro aprovado e dos elementos de marca do CONTRATANTE." },
  { chave: "trilha", titulo: "Trilha e imagens de terceiros", texto: "Trilhas, efeitos sonoros e imagens de terceiros vêm de bancos licenciados para o uso previsto. Música comercial de artista só entra com licença paga pelo CONTRATANTE." },
  { chave: "imagem", titulo: "Autorização de imagem", texto: "O CONTRATANTE obtém e guarda a autorização de uso de imagem e voz de colaboradores, clientes e demais pessoas que aparecem nos vídeos, para os usos previstos, e responde por ela. A CONTRATADA fornece modelo de autorização quando pedido." },
  { chave: "brutos_sim", titulo: "Arquivos brutos", quando: { variavel: "video_brutos", igual: "sim" }, texto: "Os arquivos brutos da captação são entregues depois do pagamento integral, por link de download válido por 30 (trinta) dias." },
  { chave: "brutos_nao", titulo: "Arquivos brutos", quando: { variavel: "video_brutos", igual: "nao" }, texto: "Arquivos brutos e projetos de edição não estão incluídos e podem ser orçados à parte." },
  ...direitosDoBloco("video",
    "Depois do pagamento integral, os direitos patrimoniais dos vídeos finais são cedidos ao CONTRATANTE. Trilhas e imagens de bancos seguem a licença do fornecedor.",
    "O CONTRATANTE recebe, depois do pagamento integral, licença de uso exclusiva e sem prazo dos vídeos finais, nos canais dele. Trilhas e imagens de bancos seguem a licença do fornecedor."),
]);

export const BLOCO_DESIGN_V1 = bloco("design", "Design pontual", [
  { nome: "design_pecas", rotulo: "Peças", tipo: "textoLongo", obrigatoria: true, grupo: "servico", ajuda: "Ex.: 1 folder A4 frente e verso e 1 banner 1x2 m." },
  { nome: "design_finalidade", rotulo: "Finalidade de uso", tipo: "texto", obrigatoria: true, grupo: "servico" },
  { nome: "design_prazo_uso", rotulo: "Prazo de uso", tipo: "texto", obrigatoria: true, padrao: "sem prazo definido", grupo: "servico" },
  { nome: "design_prazo_dias", rotulo: "Prazo de entrega (dias úteis)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  ...PROJETO,
  direitosDe("design", "peças"),
], [
  { chave: "entregas", titulo: "Entregas", texto: "A CONTRATADA cria as peças {{design_pecas}}, para a finalidade {{design_finalidade}}, com prazo de uso {{design_prazo_uso}}, em até {{design_prazo_dias}} dias úteis depois do briefing e dos materiais." },
  { chave: "producao", titulo: "Produção e fornecedores", texto: "Impressão, produção gráfica e fornecedores não estão incluídos. A CONTRATADA pode indicar fornecedores e acompanhar a produção mediante orçamento à parte, e não responde por fornecedor escolhido pelo CONTRATANTE." },
  { chave: "revisao_de_preco", titulo: "Revisão de preço", texto: "O preço pode ser revisto, com aceite do CONTRATANTE, quando houver mudança de briefing, atraso do CONTRATANTE que exija reorganizar a produção, refação de peça já aprovada ou novas aplicações da mesma arte." },
  ...direitosDoBloco("design",
    "Depois do pagamento integral, os direitos patrimoniais das peças são cedidos ao CONTRATANTE, para a finalidade indicada e para outras que ele escolher.",
    "O CONTRATANTE recebe, depois do pagamento integral, licença de uso das peças para a finalidade e o prazo indicados. Outros usos dependem de nova autorização da CONTRATADA."),
]);

export const BLOCO_MENSALISTA_V1 = bloco("mensalista", "Mensalista (fee mensal)", [
  { nome: "mensal_pacote", rotulo: "Pacote do mês", tipo: "textoLongo", obrigatoria: true, grupo: "servico", ajuda: "Ex.: até 20 peças por mês ou 30 horas de criação." },
  { nome: "mensal_sla_horas", rotulo: "Confirmação de pedido (horas úteis)", tipo: "inteiro", obrigatoria: true, padrao: "48", grupo: "servico", feminino: true },
  { nome: "mensal_vigencia_minima_meses", rotulo: "Vigência mínima (meses)", tipo: "inteiro", obrigatoria: true, grupo: "servico" },
  ...MENSAL,
  direitosDe("mensalista", "mensalista"),
], [
  { chave: "entregas", titulo: "Pacote mensal", texto: "O pacote mensal inclui {{mensal_pacote}}. Os pedidos são feitos pelo painel; a CONTRATADA confirma o recebimento em até {{mensal_sla_horas}} horas úteis e combina o prazo de cada pedido." },
  { chave: "limites", titulo: "Limites do pacote", texto: "Pedidos acima do pacote são orçados à parte antes de começar. Saldo não usado no mês não acumula. Atraso causado pela CONTRATADA é compensado no mês seguinte." },
  { chave: "vigencia_minima", titulo: "Vigência mínima", texto: "A vigência mínima é de {{mensal_vigencia_minima_meses}} meses. Se o CONTRATANTE encerrar antes, sem justa causa, paga multa de {{multa_rescisao_percentual}} sobre as mensalidades que faltam para completar a vigência mínima, proporcional ao período restante." },
  ...direitosDoBloco("mensalista",
    "Os direitos patrimoniais das peças entregues são cedidos ao CONTRATANTE depois do pagamento do mês correspondente.",
    "O CONTRATANTE recebe licença de uso das peças entregues, para as finalidades combinadas em cada pedido."),
]);

/** O modelo completo da versão 1: condições gerais e os 8 blocos. */
export const MODELOS_V1: ModeloDeContrato[] = [
  CONDICOES_GERAIS_V1,
  BLOCO_SOCIAL_V1,
  BLOCO_SITE_V1,
  BLOCO_MARCA_V1,
  BLOCO_NAMING_V1,
  BLOCO_TRAFEGO_V1,
  BLOCO_VIDEO_V1,
  BLOCO_DESIGN_V1,
  BLOCO_MENSALISTA_V1,
];
