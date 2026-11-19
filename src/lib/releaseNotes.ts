/**
 * As novidades do painel: o que mudou, para quem e quando.
 *
 * Regra de escrita: nada de termo técnico, nada de nome de arquivo, nada de
 * promessa vaga. Para o cliente, cada item responde "o que mudou para mim" em
 * uma frase que a pessoa entende sem saber nada de tecnologia. Para a equipe,
 * a linguagem do dia a dia do painel, com o nome das telas como aparecem no
 * menu. Sem travessão.
 *
 * `publico` diz quem lê a entrada:
 *   - "cliente": mudou algo que o cliente vê ou usa (o portal dele, o CRM e o
 *     Correio da empresa dele, contrato e briefing por link, primeiro acesso).
 *   - "equipe": tudo o que é do painel da casa (mesas, agentes, Central,
 *     Ciclo, Comercial, Financeiro da casa, produtos, skills).
 * Quem tem papel de cliente só recebe as entradas "cliente" (`novidadesPara`).
 *
 * `status` separa o que já está no ar do que está sendo construído agora, para
 * a página nunca prometer algo como pronto antes da hora. Só entra o que já
 * está no ar; quando um tema teve várias rodadas, uma entrada só com o estado
 * final. A lista sai em ordem da mais nova para a mais antiga.
 */

export type ReleaseStatus = "no-ar" | "esta-semana";

export type ReleasePublico = "cliente" | "equipe";

export interface ReleaseItem {
  title: string;
  description: string;
}

export interface ReleaseEntry {
  id: string;
  /** Data de referência, formato ISO curto. */
  date: string;
  status: ReleaseStatus;
  /** Quem lê esta entrada. O cliente nunca recebe as de "equipe". */
  publico: ReleasePublico;
  title: string;
  /** Frase de abertura, o "porquê" da mudança. */
  summary: string;
  items: ReleaseItem[];
}

const ENTRADAS: ReleaseEntry[] = [
  {
    id: "menu-produtos-clientes",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Menu novo: Produtos, Clientes e CRM de vendas",
    summary: "O menu passou a separar cada coisa pelo que ela é, para achar tudo de primeira.",
    items: [
      { title: "Produto CRM e Produto E-mail", description: "Cada produto tem o seu grupo no menu, com visão geral, planos e preços e faturamento só dele." },
      { title: "Clientes à parte", description: "A carteira de clientes ganhou lugar próprio, separada do CRM de vendas da casa." },
      { title: "Caminho de volta", description: "Do painel para o CRM ou para o Correio e de volta, sempre pelo botão de voltar." },
    ],
  },
  {
    id: "telas-design-novo-19-11",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Mais telas no design novo",
    summary: "Números em destaque, uma ação principal por cartão e a explicação longa no ponto de interrogação.",
    items: [
      { title: "Produto E-mail", description: "Central com os números no topo, entradas e migrações separadas e cada migração com o passo a passo." },
      { title: "Domínios e sites", description: "Domínios, sites, saúde, custo e preço numa lista só, com filtro por cliente." },
      { title: "Produto CRM", description: "A janela da empresa mostra o CRM como o cliente vê, com plano, equipe e cobrança em abas." },
      { title: "Skills e cérebro", description: "Skills separadas por área, busca em todas de uma vez e o detalhe abrindo no centro da tela." },
      { title: "Base dos agentes", description: "Lista dos agentes parada ao lado e as fichas em grade, com filtro e busca." },
      { title: "Escritório e Grupos dos clientes", description: "Os números do dia na frente e a ficha de cada agente ou grupo abrindo no centro." },
    ],
  },
  {
    id: "acessos-dos-clientes",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Acessos dos clientes num lugar só",
    summary: "Quem entra no CRM e no e-mail de cada cliente, e como entra, sem procurar em várias telas.",
    items: [
      { title: "Pessoas e caixas", description: "Todas as pessoas do CRM e todas as caixas de e-mail, com busca e filtro por empresa." },
      { title: "Definir senha nova", description: "O dono troca a senha de uma pessoa e ela aparece uma vez só, sem ficar guardada." },
      { title: "Link de entrada por cliente", description: "Cada empresa tem o seu link para copiar ou mandar no WhatsApp, e a tela mostra quem já entrou." },
      { title: "Minha caixa", description: "A casa abre a caixa de um cliente com a senha e vê o correio com as mesmas telas que ele vê." },
      { title: "Adicionar pessoa", description: "A lista traz todos os clientes do painel, e pôr ou tirar alguém acompanha o valor do extra no financeiro." },
    ],
  },
  {
    id: "correio-no-painel",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Correio dentro do painel",
    summary: "O e-mail da casa e dos clientes passou a ser lido e respondido no próprio painel, pelo Migadu.",
    items: [
      { title: "Ler, responder e guardar", description: "Cada caixa conectada lê, responde e guarda cópia em Enviados, com a senha protegida no cofre." },
      { title: "Organizado como no Gmail", description: "Abas Principal, Atualizações, Promoções e Social, logo de quem enviou e um quadro que abre a mensagem." },
      { title: "Campanhas", description: "Lista colada, teste para mim primeiro e envio em lotes com limite por dia." },
      { title: "Cliente novo de e-mail", description: "Empresa, domínio, caixas e quem paga, tudo numa janela só." },
    ],
  },
  {
    id: "atelie-de-cor",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Ateliê de Cor",
    summary: "Tela nova para montar a paleta de cada marca, com o motivo de cada cor e a conferência de leitura.",
    items: [
      { title: "Três propostas por marca", description: "Pelo cliente, por um briefing, por perguntas ou pelo nicho, cada proposta já conferida no contraste." },
      { title: "Ver a cor em uso", description: "Prévia em site, post, story, e-mail e cartão antes de decidir." },
      { title: "Aplicar no cliente", description: "A paleta escolhida vai para o kit da marca e o Estúdio passa a usar as cores nos papéis certos." },
      { title: "Entrega pronta", description: "PDF, mensagem e arquivos da paleta para mandar ao cliente." },
    ],
  },
  {
    id: "central-de-automacoes",
    date: "2026-11-19",
    status: "no-ar",
    publico: "equipe",
    title: "Central de Automações",
    summary: "Todas as automações da casa e dos clientes numa tela, com a saúde de cada uma.",
    items: [
      { title: "Fluxos e execuções", description: "Cada fluxo com as últimas execuções, o caminho que percorreu e a saúde do servidor." },
      { title: "Pastas por cliente", description: "As automações da Aceleriq e as de cada cliente separadas, e uma aba Automações na ficha do cliente." },
      { title: "Ligar e desligar", description: "O dono liga ou desliga um fluxo com um toque." },
    ],
  },
  {
    id: "correio-do-cliente",
    date: "2026-11-19",
    // 19/11: aparece como "chegando" até o Migadu ser contratado e a cobrança do e-mail ligar.
    status: "esta-semana",
    publico: "cliente",
    title: "O e-mail da sua empresa no painel",
    summary: "Você lê, responde e organiza o e-mail profissional da sua empresa sem sair do painel.",
    items: [
      { title: "Correio e CRM separados", description: "Cada um tem o seu atalho no menu e no início, e o botão de voltar leva para onde você estava." },
      { title: "Caixa organizada", description: "As mensagens chegam separadas em Principal, Atualizações, Promoções e Social, com a logo de quem enviou." },
      { title: "Responder sem perder a conversa", description: "A resposta fica junto da mensagem original, e cada e-mail aparece do jeito que foi enviado." },
      { title: "Traga seus e-mails antigos", description: "Em três passos você copia os e-mails do provedor antigo, e a barra mostra o andamento." },
      { title: "Aplicativo no celular", description: "O Correio pode ser instalado como aplicativo próprio na tela inicial." },
    ],
  },
  {
    id: "entrar-mais-facil",
    date: "2026-11-18",
    status: "no-ar",
    publico: "cliente",
    title: "Entrar ficou mais fácil",
    summary: "Menos senha esquecida e menos vezes tendo que entrar de novo.",
    items: [
      { title: "Link que já entra", description: "O link que a equipe manda já abre o seu painel e deixa você criar ou trocar a senha." },
      { title: "Você continua conectado", description: "O painel não desconecta mais sozinho no meio do uso." },
      { title: "Aplicativo no Android", description: "O painel pode ser instalado na tela inicial do Android, com ícone e atalhos." },
    ],
  },
  {
    id: "central-de-skills",
    date: "2026-11-18",
    status: "no-ar",
    publico: "equipe",
    title: "Central de Skills e segundo cérebro",
    summary: "As skills de todos os agentes num catálogo só, igual em todas as máquinas.",
    items: [
      { title: "Um catálogo para todos", description: "Skills do Claude, do Codex, do Hermes e as da casa no mesmo lugar, sincronizadas sozinhas." },
      { title: "Segundo cérebro em tempo real", description: "As notas do segundo cérebro aparecem e são editadas direto no painel." },
      { title: "Conectar uma IA", description: "Uma IA nova entra no painel com um clique, e o erro explica o que falta quando não conecta." },
    ],
  },
  {
    id: "escritorio",
    date: "2026-11-18",
    status: "no-ar",
    publico: "equipe",
    title: "Escritório da Aceleriq",
    summary: "Os agentes de todas as plataformas trabalham, conversam e pedem decisão num lugar só.",
    items: [
      { title: "Agora, organograma e conversas", description: "Quem está trabalhando, quem responde a quem, as salas e as mensagens entre os agentes." },
      { title: "Regras permanentes", description: "Na aba Regras o dono liga, desliga e põe limite, e o pedido que cabe numa regra já volta aprovado." },
      { title: "Pelo app do Hermes", description: "O dono lê e responde o Escritório também pelo aplicativo do Hermes." },
    ],
  },
  {
    id: "grupos-dos-clientes",
    date: "2026-11-18",
    status: "no-ar",
    publico: "equipe",
    title: "Grupos dos clientes",
    summary: "Uma tela com os grupos de WhatsApp dos clientes para ninguém ficar sem resposta.",
    items: [
      { title: "Quem está esperando", description: "Os grupos com mensagem sem resposta aparecem primeiro, com o tempo de espera." },
      { title: "Resumo do dia", description: "O que foi falado em cada grupo, com a conversa a um toque." },
    ],
  },
  {
    id: "email-dominios-crm-plano",
    date: "2026-11-18",
    status: "no-ar",
    publico: "equipe",
    title: "E-mail profissional, domínios e CRM pelo plano",
    summary: "A venda, a configuração e o acesso dos produtos ficaram num caminho só.",
    items: [
      { title: "Entradas e migrações", description: "Cada pedido de e-mail e cada migração de caixa com o seu andamento, do pedido até a caixa no ar." },
      { title: "Domínios e sites da casa", description: "Todos os domínios e sites com saúde, vencimento, custo e preço." },
      { title: "CRM como extra do plano", description: "O CRM entra como extra na ficha do cliente, e o pagamento confirmado libera o acesso." },
    ],
  },
  {
    id: "financeiro-lucro-parcelas",
    date: "2026-11-16",
    status: "no-ar",
    publico: "equipe",
    title: "Financeiro com lucro do mês e parcelas",
    summary: "A visão geral responde quanto sobrou no mês e quanto ainda vai entrar.",
    items: [
      { title: "Lucro e caixa", description: "Lucro do mês, caixa no fim do mês e a comparação mês a mês, que o CFO também lê." },
      { title: "A receber nos próximos meses", description: "O que vence depois do mês atual aparece separado, sem misturar com o mês." },
      { title: "Entrada e parcelas", description: "Entrada livre com o restante em parcelas, primeira mensalidade dividida e suporte mensal na nova entrada." },
      { title: "Indicação", description: "O repasse de quem indicou entra em Despesas a cada mensalidade paga." },
    ],
  },
  {
    id: "extras-e-crescimento",
    date: "2026-11-14",
    status: "no-ar",
    publico: "equipe",
    title: "Extras do cliente e crescimento da carteira",
    summary: "Tudo o que o cliente compra além do plano, e quanto a carteira cresceu, com o financeiro junto.",
    items: [
      { title: "Extras e adicionais", description: "Adicionais e upgrades na ficha do cliente, cada cobrança editável, inclusive comissão que entra conforme recebe." },
      { title: "Crescimento da carteira", description: "Quem entrou por semana e por mês, com serviços e valor, o recebido de cada mês e as saídas." },
    ],
  },
  {
    id: "esteira-precisa-de-voce",
    date: "2026-11-14",
    status: "no-ar",
    publico: "equipe",
    title: "Esteira e caixa Precisa de você",
    summary: "Uma linha do tempo por cliente e uma caixa só com o que depende do dono.",
    items: [
      { title: "Esteira", description: "Cada cliente numa faixa com a etapa de cada peça, filtro de clientes e o painel da peça sempre no mesmo lugar." },
      { title: "Precisa de você", description: "Pedidos que só o dono resolve chegam numa caixa, com revisão entre os agentes antes." },
      { title: "Estúdio sem perder trabalho", description: "A fila é vigiada, o progresso só avança e o botão Ver erros mostra o motivo de cada falha." },
      { title: "Alerta de senha errada", description: "O sino avisa quando alguém erra a senha do painel várias vezes." },
    ],
  },
  {
    id: "agenda-estudio-novembro",
    date: "2026-11-14",
    status: "no-ar",
    publico: "equipe",
    title: "Agenda e Estúdio mais diretos",
    summary: "Menos volta para ajustar o que já foi aprovado.",
    items: [
      { title: "Ajustar o aprovado", description: "Legenda e formato de um conteúdo aprovado mudam sem abrir revisão, e o Story entra no agendamento." },
      { title: "Reagendar sem susto", description: "Mudar a data de um post aprovado não acusa mais alteração por fora." },
      { title: "Arte final pronta", description: "No Estúdio dá para enviar ou trocar a arte pronta de uma lâmina, sem gerar de novo." },
      { title: "Campanhas do Mês", description: "Campanha arquivada sai da frente e o período pode ser editado." },
    ],
  },
  {
    id: "portal-cara-nova",
    date: "2026-11-15",
    status: "no-ar",
    publico: "cliente",
    title: "Seu painel com cara nova",
    summary: "Mais limpo, com os números na frente e o que precisa de você sempre à vista.",
    items: [
      { title: "Início", description: "Saudação, atalhos para as áreas e um cartão com a próxima coisa a fazer, como uma aprovação." },
      { title: "Onde estamos", description: "O retrato do momento em cima e o resto em abas: Andamento, Resultados, Diário e Atualizações." },
      { title: "Documentos", description: "As pastas viraram abas, e a lista ficou mais fácil de ler." },
      { title: "Aprovações, relatórios e pedidos", description: "Peças maiores para olhar e os números da fila em destaque." },
      { title: "Próximo pagamento", description: "O próximo pagamento aparece em destaque no financeiro." },
      { title: "No celular", description: "As telas não tremem mais enquanto carregam." },
    ],
  },
  {
    id: "painel-casa-design-novo",
    date: "2026-11-15",
    status: "no-ar",
    publico: "equipe",
    title: "Painel inteiro no design novo",
    summary: "Todas as áreas da casa ganharam a cara nova, mais limpa e com uma ação principal por cartão.",
    items: [
      { title: "Números grandes", description: "Dashboard, Financeiro, Clientes, Comercial e Contratos com os números em destaque e sem pulo ao carregar." },
      { title: "Mesas e Estúdio", description: "Hub das mesas em azulejos e uma ação por vez na prancheta do Estúdio." },
      { title: "Quadros nas cores da etapa", description: "Esteira, Kanban e Agenda com os cartões na cor de cada etapa." },
      { title: "Topo parado", description: "No computador o topo fica no lugar e só o conteúdo rola." },
    ],
  },
  {
    id: "crm-do-cliente",
    date: "2026-11-13",
    status: "no-ar",
    publico: "cliente",
    title: "O CRM da sua empresa",
    summary: "Um CRM com a cara e o jeito de vender da sua empresa.",
    items: [
      { title: "Do seu jeito", description: "Escolha a cor da empresa e os nomes das etapas do funil, e o painel mantém tudo legível." },
      { title: "Equipe de vendas", description: "Cargos, hierarquia e ranking de quem mais vende." },
      { title: "Lead quente na hora", description: "Quem chega pelo formulário do anúncio já vem com nota, e o lead quente avisa o vendedor na mesma hora." },
      { title: "Menu que recolhe", description: "O menu lateral vira uma faixa de ícones quando você quer mais espaço, e lembra a sua escolha." },
      { title: "Conversa com a sua IA", description: "O CRM pode ser ligado ao Claude e ao ChatGPT." },
    ],
  },
  {
    id: "aprovacao-aviso-certo",
    date: "2026-11-13",
    status: "no-ar",
    publico: "cliente",
    title: "Aviso de aprovação na hora certa",
    summary: "Você fica sabendo quando tem peça para aprovar, sem receber aviso repetido.",
    items: [
      { title: "Aviso no grupo", description: "Peça nova para aprovar vira aviso no grupo da sua empresa na mesma hora." },
      { title: "Link direto na peça", description: "O lembrete abre exatamente a peça que espera por você." },
      { title: "Sem aviso em dobro", description: "E-mail e WhatsApp nunca chegam no mesmo dia, e só lembramos das peças que ainda valem." },
    ],
  },
  {
    id: "resumo-da-semana-cliente",
    date: "2026-11-11",
    status: "no-ar",
    publico: "cliente",
    title: "Resumo da semana mais direto",
    summary: "A mensagem da semana no seu grupo ficou curta e conta o que foi feito de verdade.",
    items: [
      { title: "Curto", description: "No máximo dez linhas, fáceis de ler no celular." },
      { title: "O que a equipe fez", description: "Cada linha conta uma ação concreta da semana, com o detalhe do que foi feito." },
      { title: "Seus números", description: "Os números do perfil e os contatos que os anúncios trouxeram." },
    ],
  },
  {
    id: "agentes-hierarquia-moldes",
    date: "2026-11-11",
    status: "no-ar",
    publico: "equipe",
    title: "Hierarquia editável e moldes de carrossel",
    summary: "Os agentes se organizam pelo painel e o conteúdo aprende com os perfis que funcionam.",
    items: [
      { title: "Hierarquia dos agentes", description: "Criar e excluir agente pelo painel, filtro por origem e a última execução de cada um." },
      { title: "Mensagem da semana", description: "Só entra promessa com fato novo, e cada bloco tem título e espaço entre eles." },
      { title: "Moldes de carrossel", description: "O carrossel de referência é lido lâmina a lâmina e vira molde nas pautas do Mês." },
    ],
  },
  {
    id: "comercial-mercurio",
    date: "2026-11-09",
    status: "no-ar",
    publico: "equipe",
    title: "Comercial com o Mercúrio",
    summary: "O vendedor do WhatsApp trabalha dentro do Comercial, do primeiro contato até o Pix.",
    items: [
      { title: "Lead que chega sozinho", description: "O lead entra na fila, conversa com o executivo e recebe as provas autorizadas da Biblioteca." },
      { title: "Pix e reunião", description: "Pix no Asaas, reunião na agenda do Almir e repasse para a equipe no WhatsApp." },
      { title: "Máquina de leads", description: "Busca no Google Maps com teto de gasto, filtros e Levar ao CRM sempre à mão." },
      { title: "Aviso de fechamento", description: "A fila avisa quando um lead está perto de fechar." },
    ],
  },
  {
    id: "crm-de-vendas-freela",
    date: "2026-11-05",
    status: "no-ar",
    publico: "equipe",
    title: "CRM de vendas e Freela",
    summary: "Do lead ao cliente cadastrado sem digitar a mesma coisa duas vezes.",
    items: [
      { title: "Ganho completo", description: "Marcar ganho pede o cliente e os detalhes, com entrada parcelada e início da mensalidade, igual ao Novo cliente." },
      { title: "Mudar plano em um passo", description: "Na ficha, a próxima mensalidade e o CRM acompanham sozinhos." },
      { title: "Freela", description: "Funil em quadro, Fechados vira cliente, Perdidos com retomada e caixa em real e dólar sem misturar." },
    ],
  },
  {
    id: "documentos-agenda-cliente",
    date: "2026-11-05",
    status: "no-ar",
    publico: "cliente",
    title: "Documentos à vista e agenda sem repetição",
    summary: "O que é seu aparece na hora e uma vez só.",
    items: [
      { title: "Documentos à vista", description: "Os documentos ficam à vista no painel, e arquivo novo já aparece para você." },
      { title: "Agenda sem peça repetida", description: "A mesma peça não aparece mais duas vezes na sua agenda." },
      { title: "Datas e listas certas", description: "Corrigimos dez detalhes de data, aviso e lista nas suas telas." },
    ],
  },
  {
    id: "posts-no-horario",
    date: "2026-10-30",
    status: "no-ar",
    publico: "cliente",
    title: "Seus posts saem no horário",
    summary: "A publicação ficou mais firme, inclusive quando a internet oscila.",
    items: [
      { title: "Sem falha por instabilidade", description: "Se a conexão cair na hora de publicar, o painel tenta de novo sozinho até o post ir ao ar." },
      { title: "Vídeo em alta qualidade", description: "Os vídeos vão ao ar na melhor qualidade disponível." },
    ],
  },
  {
    id: "publicacao-sem-surpresa",
    date: "2026-10-30",
    status: "no-ar",
    publico: "equipe",
    title: "Publicação sem surpresa",
    summary: "Quando algo não vai ao ar, a equipe fica sabendo na hora e sabe por quê.",
    items: [
      { title: "Aviso no sino", description: "Publicação que falha avisa no sino com o motivo." },
      { title: "Vídeo pronto para agendar", description: "O vídeo da pauta nasce pronto na Agenda, com a legenda do post editável no envio." },
      { title: "Renovação sozinha", description: "A cobrança de renovação paga avança a data e já cria a próxima." },
    ],
  },
  {
    id: "clientes-cobranca-outubro",
    date: "2026-10-27",
    status: "no-ar",
    publico: "equipe",
    title: "Clientes, cobrança e contas da Meta",
    summary: "A carteira mostra quem está ativo e quem está em atraso de verdade.",
    items: [
      { title: "Inativos à parte", description: "Clientes inativos em aba própria, filtro da cobrança e atraso só quando não pagou." },
      { title: "Cobrança pausada", description: "A cobrança pode ser pausada por cliente." },
      { title: "Cliente no exterior", description: "Serviço novo nos contratos e proposta em dólar ou euro." },
      { title: "Meta sem vencer", description: "A conexão com a Meta passou a usar o acesso da empresa, que não vence." },
    ],
  },
  {
    id: "estudio-fotos-videos-outubro",
    date: "2026-10-29",
    status: "no-ar",
    publico: "equipe",
    title: "Estúdio, fotos e vídeos das pautas",
    summary: "Arte, foto e vídeo de cada pauta saem do mesmo lugar, com a foto real do cliente primeiro.",
    items: [
      { title: "Foto real primeiro", description: "O acervo lê as fotos sem descrição e a foto real do cliente já vem escolhida na arte e no vídeo." },
      { title: "Referência é estilo", description: "A referência dá o estilo e o tema manda no conteúdo, e dá para combinar referências." },
      { title: "Peça de vídeo", description: "Gravar com roteiro ou gerar por IA, legendar, pôr trilha e entregar para a Agenda." },
      { title: "Legenda que assiste ao vídeo", description: "A legenda do vídeo é escrita a partir do que o vídeo mostra e fala." },
      { title: "Mesa Foto organizada", description: "Produtos e gerações em pastas, sem produto duplicado." },
    ],
  },
  {
    id: "mes-e-campanhas",
    date: "2026-10-24",
    status: "no-ar",
    publico: "equipe",
    title: "Mês e Campanhas",
    summary: "O planejamento do mês ficou mais esperto e as campanhas ganharam linha do tempo.",
    items: [
      { title: "Campanhas com fases", description: "Da introdução ao encerramento, com datas que se reorganizam e um agente que edita por versões." },
      { title: "Hype e Em alta", description: "Assuntos da semana, datas e o que está em alta no nicho do cliente viram pauta pronta." },
      { title: "Mistura de formatos", description: "O Mês mistura formatos pelo nicho, inclui Stories e vídeo e troca uma ou várias peças." },
      { title: "Pautas prontas sem IA", description: "Um lançador de pautas prontas e o fim de semana definido por cliente." },
      { title: "Copy que prende", description: "Motor de copy com centenas de ganchos testados e o template de carrossel no estilo do X." },
    ],
  },
  {
    id: "membros",
    date: "2026-10-21",
    status: "no-ar",
    publico: "equipe",
    title: "Área de membros",
    summary: "Uma biblioteca de cursos e ferramentas com acessos separados do painel.",
    items: [
      { title: "Cursos e comunidade", description: "Cursos, leitura em PDF e comunidade, com acessos independentes por pessoa." },
      { title: "Licenças do CRM", description: "Suspender, reativar e renovar licença pela administração, sem perder os dados." },
    ],
  },
  {
    id: "laboratorio",
    date: "2026-10-21",
    status: "no-ar",
    publico: "equipe",
    title: "Laboratório",
    summary: "Um canvas para montar projetos inteiros ligando cada etapa, com créditos próprios.",
    items: [
      { title: "Canvas de projetos", description: "Cada caixa faz uma coisa, as caixas se ligam soltando em qualquer parte e o projeto roda inteiro." },
      { title: "Estúdio livre", description: "Arte sem marca de cliente, paga com os créditos do Laboratório." },
      { title: "Ligado às Campanhas", description: "Canvas e campanha se completam nos dois sentidos, com as fases já no funil." },
    ],
  },
  {
    id: "portal-recados-limpos",
    date: "2026-10-19",
    status: "no-ar",
    publico: "cliente",
    title: "Recados da equipe mais limpos",
    summary: "Os recados que chegam até você ficaram curtos e organizados.",
    items: [
      { title: "Sem repetição", description: "Recados curtos, sem repetir o que você já leu." },
      { title: "Só o que é seu", description: "Anotação interna da equipe não aparece no seu painel." },
    ],
  },
  {
    id: "agentes-outubro",
    date: "2026-10-17",
    status: "no-ar",
    publico: "equipe",
    title: "Agentes ao vivo e pedidos de acesso",
    summary: "Dá para ver o que cada agente faz agora e responder o que ele precisa sem sair da tela.",
    items: [
      { title: "Hierarquia ao vivo", description: "O que cada agente está fazendo, a movimentação e o zoom no organograma." },
      { title: "Base dos agentes", description: "Cada agente aprende com o que o dono ensina e com a pesquisa da semana." },
      { title: "Pedidos de acesso", description: "Senha, código ou conexão pedidos com print, aviso e formulário seguro." },
      { title: "Mesa de decisão", description: "Aprovar um por vez na Revisão do Ciclo e na Execução, e a decisão da equipe fecha de verdade." },
    ],
  },
  {
    id: "celular-aplicativo",
    date: "2026-10-16",
    status: "no-ar",
    publico: "cliente",
    title: "No celular, jeito de aplicativo",
    summary: "O painel no celular ficou parecido com um aplicativo.",
    items: [
      { title: "Barra de baixo", description: "As áreas principais ficam numa barra embaixo, ao alcance do dedo." },
      { title: "Janelas que sobem", description: "As janelas abrem de baixo para cima, como num aplicativo." },
    ],
  },
  {
    id: "dia-prioritario-mesa-ads",
    date: "2026-10-13",
    status: "no-ar",
    publico: "equipe",
    title: "Dia Prioritário e memória da conta de anúncios",
    summary: "Cada cliente tem o seu dia fixo e cada conta de anúncios tem a sua memória.",
    items: [
      { title: "Dia Prioritário", description: "Um dia fixo por cliente, com a captação do que se grava na Central." },
      { title: "Memória da conta", description: "Na Mesa Ads, a conta guarda o contexto em oito camadas antes de qualquer análise." },
      { title: "Auditoria e alertas", description: "Auditoria da conta e alertas na Conta ao vivo." },
      { title: "Diagnóstico do perfil", description: "A aba Redes faz o diagnóstico do perfil do Instagram em nove partes." },
    ],
  },
  {
    id: "central-gestor-navegador",
    date: "2026-10-09",
    status: "no-ar",
    publico: "equipe",
    title: "Gestor Aceleriq e navegador do cliente",
    summary: "A Central virou estação de trabalho, com o Gestor e o Hermes lado a lado.",
    items: [
      { title: "Gestor Aceleriq", description: "Conversa como gente, mostra a carteira inteira e recebe arquivo, imagem e áudio." },
      { title: "Navegador do cliente", description: "Os agentes trabalham no navegador de cada cliente, com as abas e o histórico da sessão." },
      { title: "Troca de e-mail de login", description: "O admin troca o e-mail de entrada do cliente sem mudar a senha." },
    ],
  },
  {
    id: "contexto-execucao",
    date: "2026-10-07",
    status: "no-ar",
    publico: "equipe",
    title: "Contexto do cliente e Execução",
    summary: "O que se sabe de cada cliente ficou organizado e a Execução mostra a prova de cada trabalho.",
    items: [
      { title: "Cérebro do cliente", description: "Dossiê em destaque, busca, próximas prioridades e leitura de links públicos e do Drive." },
      { title: "Execução com prova", description: "Histórico legível, comprovação de cada entrega e a carteira por cliente." },
      { title: "Performance da Meta", description: "Central de performance dos anúncios com relatórios em documento." },
    ],
  },
  {
    id: "editor-de-video",
    date: "2026-10-02",
    status: "no-ar",
    publico: "equipe",
    title: "Editor de vídeo completo",
    summary: "Editar vídeo com IA dentro do painel, do bruto ao vídeo pronto.",
    items: [
      { title: "Editar com IA", description: "Cortes limpos, legenda da marca, zoom e imagens de apoio, com o agente editor." },
      { title: "Pronto no Workspace", description: "O vídeo final vai para a pasta do cliente, com baixar e salvar no celular." },
      { title: "Render na nuvem", description: "O vídeo final também pode ser montado na nuvem, sem prender o computador da casa." },
    ],
  },
  {
    id: "chaves-motores-cfo",
    date: "2026-10-01",
    status: "no-ar",
    publico: "equipe",
    title: "Chaves e custos, motores e CFO",
    summary: "Tudo o que gera custo de IA num lugar só, e um agente financeiro que segura o gasto.",
    items: [
      { title: "Chaves e custos", description: "Em Configurações, todas as chaves testadas na hora, com gasto e saldo." },
      { title: "Escolha de modelo", description: "Seletor de modelo com ícones do que cada um faz e o estado dos motores no painel." },
      { title: "CFO no painel", description: "Agente financeiro que conduz, projeta e trava gasto acima do limite." },
      { title: "Roteiros validados", description: "Modelos de roteiro escolhidos pelo objetivo do vídeo." },
    ],
  },
  {
    id: "mesa-site-identidade",
    date: "2026-10-25",
    status: "no-ar",
    publico: "equipe",
    title: "Mesa Site e Mesa Identidade",
    summary: "Site e marca do cliente feitos dentro do painel.",
    items: [
      { title: "Site em cinco passos", description: "Do objetivo ao site pronto, com prévia editável, doze modelos prontos e loja virtual." },
      { title: "Identidade e mockups", description: "Naming, marca completa a partir da logo e mockups de fachada e sinalização." },
    ],
  },
  {
    id: "contratos-e-propostas",
    date: "2026-09-30",
    status: "no-ar",
    publico: "equipe",
    title: "Contratos e propostas pelo painel",
    summary: "Proposta e contrato saem do painel, a partir do cliente.",
    items: [
      { title: "Contratos gerados pelo painel", description: "Ficha fiscal, gerar do cliente ou da proposta, aditivos, renovação com aviso e vários assinantes." },
      { title: "Modelos e PDF", description: "Editor de modelos, cláusulas extras e PDF com capa." },
      { title: "Proposta em cinco etapas", description: "Cliente, conversa, rascunho, revisão e envio, com pacotes e formas de pagamento." },
      { title: "Briefing por link", description: "O briefing vai por link para o cliente preencher." },
    ],
  },
  {
    id: "contrato-briefing-link",
    date: "2026-09-29",
    status: "no-ar",
    publico: "cliente",
    title: "Contrato e briefing pelo link",
    summary: "Você resolve contrato e briefing pelo link, sem papel e sem anexo.",
    items: [
      { title: "Contrato para assinar", description: "O contrato chega por link, com várias pessoas assinando quando precisa e PDF com capa." },
      { title: "Briefing pelo link", description: "Você preenche o briefing do seu projeto direto pelo link que a equipe manda." },
    ],
  },
  {
    id: "rapido-qualquer-celular",
    date: "2026-09-30",
    status: "no-ar",
    publico: "cliente",
    title: "Mais rápido e em qualquer celular",
    summary: "O painel abre mais rápido e funciona também em aparelho antigo.",
    items: [
      { title: "Abre mais rápido", description: "O painel ficou mais leve e não trava mais na abertura." },
      { title: "Celular antigo", description: "Abre em iPhone 6, 7, 8, X e 11, no Chrome do iPhone e em Android antigo." },
      { title: "Sem tela preta", description: "Se algo falhar, o painel se recupera sozinho em vez de ficar parado." },
      { title: "Janelas no centro", description: "As janelas abrem no meio da tela, mais fáceis de ler." },
    ],
  },
  {
    id: "aviso-por-email-cliente",
    date: "2026-09-28",
    status: "no-ar",
    publico: "cliente",
    title: "Aviso por e-mail quando tem algo para você",
    summary: "Você não precisa abrir o painel para saber que tem peça esperando.",
    items: [
      { title: "Peça para aprovar", description: "Peça nova chega por e-mail, e um lembrete vem depois de dois dias se ela continuar esperando." },
      { title: "Aprovação na hora", description: "A peça enviada aparece para você aprovar no mesmo momento." },
      { title: "Primeiro acesso", description: "O convite de acesso também chega por e-mail, e o link pode ser reenviado." },
    ],
  },
  {
    id: "mesas-de-criacao",
    date: "2026-09-28",
    status: "no-ar",
    publico: "equipe",
    title: "Mesas de criação",
    summary: "Conteúdo, arte, anúncio e foto de cada cliente produzidos dentro do painel.",
    items: [
      { title: "Mês", description: "Calendário do mês com um agente que planeja, cria, muda e apaga peças com confirmação." },
      { title: "Estúdio", description: "Arte e carrossel com a marca do cliente, foto real e um diretor que refaz pelo pedido." },
      { title: "Entrega", description: "Envio em lote para aprovação, e o aprovado vai para a Agenda sozinho." },
      { title: "Mesa Ads", description: "Oferta, plano, criativos e o gerenciador de campanhas como o da Meta." },
      { title: "Mesa Foto", description: "Fotos de produto, modelos, clones e book, prontas para usar nas outras mesas." },
      { title: "Redes", description: "Prévia do perfil, bio, destaques e grade do Instagram e das páginas do Facebook." },
    ],
  },
  {
    id: "avisos-da-equipe",
    date: "2026-09-27",
    status: "no-ar",
    publico: "equipe",
    title: "Avisos para a equipe",
    summary: "Decisão e pedido de cliente chegam para a equipe na hora, uma vez só.",
    items: [
      { title: "Um fato, um aviso", description: "No sino, por e-mail e no navegador, sem aviso repetido." },
      { title: "Primeiro acesso", description: "Gerar o link de primeiro acesso para mandar na mão e reenviar quando precisar." },
      { title: "Revisão geral", description: "Cinquenta correções de uma vez em arquivos, Central e portal." },
    ],
  },
  {
    id: "esteira-revisao-ciclo",
    date: "2026-09-17",
    status: "no-ar",
    publico: "equipe",
    title: "Esteira de produção e Revisão do Ciclo",
    summary: "O Ciclo passou a ler o estado real de cada cliente.",
    items: [
      { title: "Esteira de produção", description: "Plano da semana pelo dossiê, por onde começar e cada feito registrado no dossiê." },
      { title: "Revisão do Ciclo", description: "Rituais revisados por cliente, com aprovação e versões." },
      { title: "CRM mais completo", description: "Colunas com rolagem, ficha rica da empresa e funil próprio no celular." },
    ],
  },
  {
    id: "agentes-que-trabalham",
    date: "2026-09-01",
    status: "no-ar",
    publico: "equipe",
    title: "Agentes que trabalham de verdade",
    summary: "Aprovar passou a produzir trabalho, e cada agente presta contas do que fez.",
    items: [
      { title: "Aprovou, anda", description: "A aprovação não fica mais presa e vira tarefa para o agente." },
      { title: "Prestação de contas", description: "O agente age sozinho e registra o que fez, para ninguém se perder." },
      { title: "Escritório e hierarquia", description: "Os agentes como pessoas, agrupados por área, com responsável humano pela Execução." },
      { title: "Tarefa sem colar código", description: "A tarefa do Kanban chega ao agente certo sozinha." },
    ],
  },
  {
    id: "financeiro-pro-labore",
    date: "2026-08-31",
    status: "no-ar",
    publico: "equipe",
    title: "Financeiro: pró-labore e custos fixos",
    summary: "Um jeito só de pagar e as saídas realizadas no fluxo.",
    items: [
      { title: "Pró-labore", description: "Aba própria, com o valor proporcional em um clique." },
      { title: "Custos fixos", description: "Pagar custo fixo pela barra, com a alíquota de cada mês." },
    ],
  },
  {
    id: "metricas-anuncios",
    date: "2026-08-31",
    status: "no-ar",
    publico: "equipe",
    title: "Métricas e Anúncios",
    summary: "Os números do Instagram e dos anúncios entram sozinhos, por cliente.",
    items: [
      { title: "Instagram toda semana", description: "Alcance, salvos e compartilhamentos por publicação e seguidores do dia." },
      { title: "Anúncios ligados à Meta", description: "Campanhas agrupadas por cliente e criativos com miniatura e desempenho por peça." },
      { title: "Saúde das contas", description: "As Métricas avisam quando uma conta precisa de atenção." },
    ],
  },
  {
    id: "ciclo-central-agosto",
    date: "2026-08-25",
    status: "no-ar",
    publico: "equipe",
    title: "Ciclo semanal e Central",
    summary: "A semana de cada cliente num roteiro só, com as mensagens escritas a partir dos dados.",
    items: [
      { title: "Ciclo semanal", description: "Checklist por cliente, três frentes da semana e a folha do cliente com o que falta." },
      { title: "Aplicativo do Ciclo", description: "O Ciclo pode ser instalado no celular como aplicativo próprio." },
      { title: "Rituais da Central", description: "Mensagens de segunda, quarta e sexta escritas com os números reais do cliente." },
    ],
  },
  {
    id: "agenda-workspace-agosto",
    date: "2026-08-27",
    status: "no-ar",
    publico: "equipe",
    title: "Agenda editorial e Workspace",
    summary: "Agendar ficou a um clique e os arquivos se movem como no computador.",
    items: [
      { title: "Agendar em um clique", description: "O conteúdo aprovado aparece pronto para agendar, com a arte no card e sem duplicar." },
      { title: "Arrastar o card", description: "O card anda pelo calendário arrastando por inteiro." },
      { title: "Workspace", description: "Colar imagem, botão direito com as ações do lugar e mover arquivo de pasta." },
    ],
  },
  {
    id: "aviso-post-no-ar",
    date: "2026-08-21",
    status: "no-ar",
    publico: "cliente",
    title: "Aviso quando o post vai ao ar",
    summary: "Você fica sabendo na hora que o seu post foi publicado.",
    items: [
      { title: "Aviso com o post", description: "O aviso de post no ar leva direto para a publicação." },
      { title: "Notícia sua", description: "O que chega até você fala do seu negócio, não dos bastidores da agência." },
    ],
  },
  {
    id: "cronograma-documentos",
    date: "2026-08-14",
    status: "no-ar",
    publico: "cliente",
    title: "Seu cronograma completo e documentos numa área só",
    summary: "Você vê tudo o que está sendo preparado para o seu perfil, do começo ao post no ar.",
    items: [
      { title: "Cronograma completo", description: "Pautas, produção, agendados e publicados no seu calendário, que nunca fica vazio." },
      { title: "Documentos numa área só", description: "Tudo o que foi enviado para você aparece numa área só." },
      { title: "Plano sem termo técnico", description: "O valor do seu plano aparece em palavras simples." },
    ],
  },
  {
    id: "acesso-estavel",
    date: "2026-08-13",
    status: "no-ar",
    publico: "cliente",
    title: "O painel se atualiza sozinho",
    summary:
      "Alguns clientes ficavam presos numa versão antiga do painel, o que causava tela branca e travava aprovações. Isso acabou.",
    items: [
      {
        title: "Nunca mais tela branca",
        description:
          "Sempre que publicamos uma melhoria, o seu painel busca a versão nova sozinho, no celular ou no computador. Você não precisa fazer nada.",
      },
      {
        title: "Funciona igual em qualquer aparelho",
        description:
          "Seja pelo atalho na tela inicial do celular ou pelo navegador, a experiência é a mesma e o acesso é o mesmo.",
      },
    ],
  },
  {
    id: "organizacao-arquivos",
    date: "2026-08-13",
    status: "no-ar",
    publico: "cliente",
    title: "Seus arquivos organizados por tipo",
    summary:
      "Antes era tudo um monte só e você não sabia o que era cada coisa. Agora cada material tem o seu lugar.",
    items: [
      {
        title: "Materiais gráficos separados",
        description:
          "Dentro de Materiais você filtra por carrossel, post, story e vídeo. Cada botão mostra quantos itens existem antes de você clicar.",
      },
      {
        title: "Cada pasta explica o que é",
        description:
          "Identidade visual, base de fotos e vídeos, documentos estratégicos, documentos operacionais, relatórios e contratos. Tudo nomeado em português claro.",
      },
      {
        title: "Nada mais fica escondido",
        description:
          "Antes a sua tela mostrava só uma parte das pastas e material liberado ficava invisível. Agora você vê tudo o que é seu.",
      },
    ],
  },
  {
    id: "painel-alinhado",
    date: "2026-08-13",
    status: "no-ar",
    publico: "cliente",
    title: "Painel mais limpo e fácil de ler",
    summary:
      "Passamos tela por tela deixando tudo no mesmo padrão, para a informação ficar na frente e não a decoração.",
    items: [
      {
        title: "Tudo alinhado",
        description:
          "Títulos, larguras e cartões seguem um padrão único em todas as telas. Acabaram os espaços vazios e os blocos desencontrados.",
      },
      {
        title: "Mesma cara no celular",
        description:
          "O painel foi ajustado para o celular sem perder nada do que existe no computador.",
      },
    ],
  },
  {
    id: "onde-estamos",
    date: "2026-08-12",
    status: "no-ar",
    publico: "cliente",
    title: "Onde Estamos: a sua evolução mês a mês",
    summary:
      "A pergunta mais comum era simples: o que está sendo feito pelo meu negócio agora? Esta tela responde sozinha, em tempo real.",
    items: [
      {
        title: "Linha do tempo da sua evolução",
        description:
          "Mês a mês, quantos materiais foram produzidos, quantas publicações foram ao ar e quantas medições foram feitas. Clique no mês e veja o que aconteceu nele.",
      },
      {
        title: "Gráfico de crescimento do negócio",
        description:
          "Contatos e alcance período a período, montados a partir dos relatórios reais. Não é estimativa, é o que aconteceu.",
      },
      {
        title: "Antes e Agora",
        description:
          "Um resumo automático de tudo o que não existia quando começamos e existe hoje. É a sua história com a Aceleriq escrita sozinha.",
      },
      {
        title: "Como funciona cada serviço",
        description:
          "Um desenho simples do caminho do trabalho, do planejamento até a entrega, para você saber sempre em que etapa estamos.",
      },
    ],
  },
  {
    id: "diario-do-trabalho",
    date: "2026-08-11",
    status: "no-ar",
    publico: "cliente",
    title: "Diário do Trabalho em tempo real",
    summary:
      "Cada movimento do time aparece para você na hora, sem precisar perguntar no WhatsApp.",
    items: [
      {
        title: "Tudo o que acontece vira registro",
        description:
          "Material novo, envio para aprovação, aprovação, publicação no ar e relatório publicado entram na linha do tempo automaticamente.",
      },
      {
        title: "Explicação junto da entrega",
        description:
          "A equipe registra o que foi feito, por que foi feito e qual o próximo passo. Você lê e entende a estratégia, não só o resultado.",
      },
      {
        title: "Clique e veja o material",
        description:
          "Cada registro abre o arquivo correspondente, com miniatura, direto do diário.",
      },
    ],
  },
  {
    id: "aprovacao-publicacao",
    date: "2026-08-10",
    status: "no-ar",
    publico: "cliente",
    title: "Aprovou, publica sozinho",
    summary:
      "O caminho entre a sua aprovação e o post no ar ficou automático, sem ninguém precisar lembrar de nada.",
    items: [
      {
        title: "Publicação automática no Instagram",
        description:
          "Post, carrossel e vídeo aprovados vão ao ar na data e hora combinadas, sem etapa manual no meio.",
      },
      {
        title: "Aprovação sem confusão",
        description:
          "Os cartões do carrossel aparecem na ordem certa e o histórico de ajustes fica registrado.",
      },
    ],
  },
  {
    id: "relatorios-claros",
    date: "2026-08-06",
    status: "no-ar",
    publico: "cliente",
    title: "Relatórios em linguagem de gente",
    summary:
      "Relatório serve para decidir, não para impressionar. Reescrevemos a leitura dos números.",
    items: [
      {
        title: "O número e o significado",
        description:
          "Cada métrica vem com a explicação do que ela quer dizer para o seu negócio e a comparação com o período anterior.",
      },
      {
        title: "Sem zero sem sentido",
        description:
          "Onde ainda não existe medição, a tela diz isso com clareza em vez de mostrar um zero que assusta.",
      },
    ],
  },
  {
    id: "financeiro",
    date: "2026-07-30",
    status: "no-ar",
    publico: "cliente",
    title: "Financeiro transparente",
    summary:
      "O ponto de partida desta evolução toda: deixar a parte do dinheiro clara dos dois lados.",
    items: [
      {
        title: "Seu plano e seus valores",
        description:
          "O que está contratado, o que está pago e o que está em aberto, sempre atualizado.",
      },
      {
        title: "Pedidos avulsos e investimento em anúncios",
        description:
          "Trabalhos fora do plano e verba de anúncio aparecem separados, para nunca haver dúvida sobre o que é o quê.",
      },
    ],
  },
];

/** Mais nova primeiro; no mesmo dia, a ordem em que foram escritas. */
function maisNovaPrimeiro(entradas: ReleaseEntry[]): ReleaseEntry[] {
  return entradas
    .map((entrada, indice) => ({ entrada, indice }))
    .sort((a, b) => (a.entrada.date === b.entrada.date ? a.indice - b.indice : a.entrada.date < b.entrada.date ? 1 : -1))
    .map(({ entrada }) => entrada);
}

export const RELEASE_NOTES: ReleaseEntry[] = maisNovaPrimeiro(ENTRADAS);

/** Papéis da casa: veem todas as entradas. Qualquer outro (cliente, sem papel) só vê as do cliente. */
const PAPEIS_DA_EQUIPE = ["admin", "manager", "design", "traffic"];

export function veTodasAsNovidades(role: string | null | undefined): boolean {
  return !!role && PAPEIS_DA_EQUIPE.indexOf(role) >= 0;
}

/** As entradas que esta pessoa pode ler. Sem papel conhecido, só as do cliente. */
export function novidadesPara(role: string | null | undefined, entradas: ReleaseEntry[] = RELEASE_NOTES): ReleaseEntry[] {
  return veTodasAsNovidades(role) ? entradas : entradas.filter((entrada) => entrada.publico === "cliente");
}

export type FiltroDePublico = "todas" | ReleasePublico;

export function filtrarPorPublico(entradas: ReleaseEntry[], filtro: FiltroDePublico): ReleaseEntry[] {
  return filtro === "todas" ? entradas : entradas.filter((entrada) => entrada.publico === filtro);
}

export interface MesDeNovidades {
  /** "2026-11" */
  chave: string;
  /** "novembro de 2026" */
  rotulo: string;
  entradas: ReleaseEntry[];
}

/** Agrupa por mês, mantendo a ordem de entrada (mais novo primeiro). */
export function agruparPorMes(entradas: ReleaseEntry[]): MesDeNovidades[] {
  const meses: MesDeNovidades[] = [];
  for (const entrada of entradas) {
    const chave = entrada.date.slice(0, 7);
    let mes = meses.find((m) => m.chave === chave);
    if (!mes) {
      const data = new Date(`${chave}-15T12:00:00`);
      const rotulo = Number.isNaN(data.getTime()) ? chave : data.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      mes = { chave, rotulo, entradas: [] };
      meses.push(mes);
    }
    mes.entradas.push(entrada);
  }
  return meses;
}

export function releasesByStatus(status: ReleaseStatus, entradas: ReleaseEntry[] = RELEASE_NOTES): ReleaseEntry[] {
  return entradas.filter((entry) => entry.status === status);
}

/** Data no formato que o cliente lê: "13 de agosto de 2026". */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
