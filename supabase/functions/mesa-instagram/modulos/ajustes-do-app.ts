/**
 * Ajustes do app (20/10/2026, "perfil perfeito" da aba Redes).
 *
 * O dono trouxe o "Checklist do Instagram Viral" de um criador de conteúdo: o que ligar e desligar
 * em Editar perfil, nas Configurações e na hora de postar foto, carrossel e Reels. A API do
 * Instagram não lê nem muda nada disso: é um checklist que a equipe confere no app e marca aqui,
 * guardado por conta no plano do cliente (cliente_instagram_planos.ajustes_do_app).
 *
 * "Com a inteligência, melhore": o original é de criador. Cada item tem a recomendação por tipo de
 * negócio. Onde o conselho de criador atrapalha um negócio (tirar telefone e WhatsApp, esconder os
 * botões de contato, não ter perguntas frequentes), a recomendação muda e diz por quê. O tipo sai
 * do Jev (Choice, com "não sei" como saída) e a equipe troca na tela.
 *
 * Puro: a função mesa-instagram e a tela usam o mesmo catálogo (a tela importa este arquivo; nada
 * de Deno.env aqui). Sem travessão nos textos.
 */

import type { PerguntaJev, RespostaJev } from "./conhecimento-perfil-instagram.ts";

export const VERSAO_DOS_AJUSTES = "2026-10-20.1";

export type TipoDeNegocio = "criador" | "negocio_local" | "loja" | "profissional_liberal";
export type TipoOuNaoSei = TipoDeNegocio | "nao_sei";

export const TIPOS_DE_NEGOCIO: Array<{ valor: TipoOuNaoSei; rotulo: string; dica: string }> = [
  { valor: "criador", rotulo: "Criador de conteúdo", dica: "Vive de audiência, publis e parcerias" },
  { valor: "negocio_local", rotulo: "Negócio local", dica: "Atende na cidade: liga, WhatsApp, visita" },
  { valor: "loja", rotulo: "Loja ou e-commerce", dica: "Vende produto, com entrega" },
  { valor: "profissional_liberal", rotulo: "Profissional liberal", dica: "Atende com hora marcada no próprio nome" },
  { valor: "nao_sei", rotulo: "Não sei", dica: "Sem dado: escolha para adaptar" },
];

export const ehTipo = (v: unknown): v is TipoOuNaoSei => TIPOS_DE_NEGOCIO.some((t) => t.valor === v);
export const rotuloDoTipo = (t: TipoOuNaoSei | null | undefined) => (TIPOS_DE_NEGOCIO.find((x) => x.valor === t) || TIPOS_DE_NEGOCIO[TIPOS_DE_NEGOCIO.length - 1]).rotulo;

export type GrupoDoAjuste = "editar_perfil" | "configuracoes" | "postar_foto" | "postar_reels";

export const GRUPOS_DOS_AJUSTES: Array<{ grupo: GrupoDoAjuste; rotulo: string }> = [
  { grupo: "editar_perfil", rotulo: "Editar perfil" },
  { grupo: "configuracoes", rotulo: "Configurações" },
  { grupo: "postar_foto", rotulo: "Ao postar foto ou carrossel" },
  { grupo: "postar_reels", rotulo: "Ao postar Reels" },
];

/** O que muda para um tipo: o que fazer, o porquê e se o item vale (false: não se aplica e sai da conta). */
export type RecomendacaoDoTipo = { fazer: string; porque: string; aplica?: boolean };

export type AjusteDoApp = {
  chave: string;
  grupo: GrupoDoAjuste;
  titulo: string;
  /** A recomendação original do checklist (de criador de conteúdo). */
  fazer: string;
  /** Onde fica no app: o caminho de toques. Os nomes mudam um pouco entre versões do app. */
  caminho: string;
  porque: string;
  /** Só onde o tipo muda a recomendação (o resto segue o original). */
  por_tipo?: Partial<Record<TipoDeNegocio, RecomendacaoDoTipo>>;
};

const LOCAL_CONTATO = "Quem acha um negócio local no Instagram quer ligar, chamar no WhatsApp ou ver como chegar agora; cada toque a mais perde o cliente. O conselho de tirar o contato é de criador, que quer conversa no direct para ganhar alcance.";

export const AJUSTES_DO_APP: AjusteDoApp[] = [
  // ------------------------------------------------------------------ Editar perfil
  {
    chave: "sugestoes_de_contas",
    grupo: "editar_perfil",
    titulo: "Sugestões de contas em perfis",
    fazer: "Ative \"Mostrar sugestões de contas em perfis\".",
    caminho: "Só no computador: instagram.com > Perfil > Editar perfil > Mostrar sugestões de contas em perfis",
    porque: "O perfil passa a aparecer como sugestão em perfis parecidos: gente nova chegando sem anúncio.",
  },
  {
    chave: "rotulo_de_categoria",
    grupo: "editar_perfil",
    titulo: "Rótulo de categoria",
    fazer: "Escolha a categoria certa e desative \"Exibir no perfil\".",
    caminho: "Perfil > Editar perfil > Categoria (e Exibição do perfil > Exibir rótulo de categoria)",
    porque: "A categoria certa ajuda o Instagram a entender e recomendar o perfil; escondida, a bio ganha a linha.",
    por_tipo: {
      negocio_local: {
        fazer: "Escolha a categoria mais específica (ex.: Pizzaria, Clínica odontológica) e deixe \"Exibir no perfil\" ligado.",
        porque: "Quem chega entende na hora que tipo de lugar é, antes de ler a bio. Esconder o rótulo é conselho de criador, que não quer parecer empresa.",
      },
      profissional_liberal: {
        fazer: "Escolha a categoria da profissão (ex.: Advogado, Psicólogo) e deixe \"Exibir no perfil\" ligado.",
        porque: "O rótulo da profissão passa confiança e diz o serviço em uma palavra. Esconder é conselho de criador.",
      },
    },
  },
  {
    chave: "selo_do_threads",
    grupo: "editar_perfil",
    titulo: "Selo do Threads",
    fazer: "Desative o selo do Threads.",
    caminho: "Perfil > Editar perfil > Mostrar selo do Threads",
    porque: "Os únicos botões ficam Seguir e o link: nada levando a pessoa para fora antes de seguir.",
  },
  {
    chave: "exibicao_do_perfil",
    grupo: "editar_perfil",
    titulo: "Exibição do perfil",
    fazer: "Desative o rótulo e as informações de contato no perfil.",
    caminho: "Perfil > Editar perfil > Exibição do perfil",
    porque: "Sem botão de contato, a conversa vai para o direct, e conversa no direct conta como interação para o algoritmo.",
    por_tipo: {
      negocio_local: {
        fazer: "Deixe \"Exibir informações de contato\" ligado: Ligar, WhatsApp e Como chegar à vista.",
        porque: LOCAL_CONTATO,
      },
      loja: {
        fazer: "Deixe os botões de contato e de compra à vista (WhatsApp ou E-mail, Ver loja ou Fazer pedido).",
        porque: "Na loja o botão é o caminho da venda: quem quer comprar não pode ter de procurar por onde. O direct continua aberto para quem prefere conversar.",
      },
      profissional_liberal: {
        fazer: "Deixe o contato à vista: WhatsApp do atendimento ou o botão Agendar.",
        porque: "Quem procura um profissional quer marcar horário; esconder o contato manda a pessoa para outro perfil. Tirar o contato é conselho de criador.",
      },
    },
  },
  {
    chave: "opcoes_de_contato",
    grupo: "editar_perfil",
    titulo: "Opções de contato",
    fazer: "Apague e-mail, telefone e WhatsApp do perfil.",
    caminho: "Perfil > Editar perfil > Opções de contato",
    porque: "Segurança: número e e-mail pessoais à vista atraem golpe e tentativa de roubo de conta.",
    por_tipo: {
      negocio_local: {
        fazer: "Mantenha o WhatsApp Business e o telefone comercial; apague número e e-mail pessoais.",
        porque: "A segurança vale para o contato pessoal. O comercial é o canal de venda do negócio local: tirar ele corta pedido e agendamento.",
      },
      loja: {
        fazer: "Mantenha o WhatsApp Business ou o e-mail do atendimento; apague os pessoais.",
        porque: "A loja vende e tira dúvida de entrega pelo atendimento. Só o contato pessoal é risco.",
      },
      profissional_liberal: {
        fazer: "Mantenha o WhatsApp do consultório ou escritório (ou da secretária); nunca o número pessoal.",
        porque: "O agendamento chega por ali. Separar o número de atendimento do pessoal resolve a segurança sem perder cliente.",
      },
    },
  },
  {
    chave: "botao_de_acao",
    grupo: "editar_perfil",
    titulo: "Botão de ação",
    fazer: "Não precisa: o link da bio e o direct bastam.",
    caminho: "Perfil > Editar perfil > Botões de ação",
    porque: "Criador vende pelo link e pela conversa; botão extra divide a atenção com o Seguir.",
    por_tipo: {
      criador: { fazer: "Não precisa: o link da bio e o direct bastam.", porque: "Criador vende pelo link e pela conversa; botão extra divide a atenção com o Seguir.", aplica: false },
      negocio_local: {
        fazer: "Adicione o botão que o negócio usa: Reservar, Fazer pedido ou Agendar, ligado ao parceiro (iFood, agenda, WhatsApp).",
        porque: "É o atalho do perfil para a venda: um toque e a pessoa já reservou ou pediu.",
      },
      loja: {
        fazer: "Adicione o botão de compra (Ver loja ou Fazer pedido) com o link da loja.",
        porque: "Leva quem quer comprar direto ao produto, sem passar pela bio.",
      },
      profissional_liberal: {
        fazer: "Adicione o botão Agendar com o link da agenda (ou do WhatsApp de atendimento).",
        porque: "Quem está decidindo marca na hora; sem o botão, a pessoa adia e esquece.",
      },
    },
  },

  // ------------------------------------------------------------------ Configurações
  {
    chave: "presentes",
    grupo: "configuracoes",
    titulo: "Presentes",
    fazer: "Desative os presentes.",
    caminho: "Menu > Configurações e atividade > Ferramentas para criadores de conteúdo > Presentes",
    porque: "O botão de presente divide a atenção do Reels e quase não rende para perfil pequeno.",
  },
  {
    chave: "conteudo_de_marca",
    grupo: "configuracoes",
    titulo: "Conteúdo de marca",
    fazer: "Mantenha \"Aprovar criadores de conteúdo manualmente\" ativado.",
    caminho: "Menu > Configurações e atividade > Conteúdo de marca > Aprovar criadores de conteúdo manualmente",
    porque: "Segurança: ninguém marca a conta como parceira de publi sem a aprovação de vocês.",
  },
  {
    chave: "publicacao_cruzada",
    grupo: "configuracoes",
    titulo: "Publicação cruzada",
    fazer: "Ative o compartilhamento de stories e publicações no Facebook e \"Recomendar reels no Facebook\".",
    caminho: "Menu > Central de Contas > Compartilhamento entre perfis",
    porque: "O mesmo post alcança o Facebook sem trabalho a mais.",
    por_tipo: {
      negocio_local: {
        fazer: "Ative stories, publicações e \"Recomendar reels no Facebook\", com a página do negócio ligada.",
        porque: "O público local da cidade ainda usa muito o Facebook: é alcance de graça perto de quem compra.",
      },
    },
  },
  {
    chave: "sugestoes_de_resposta",
    grupo: "configuracoes",
    titulo: "Sugestões de resposta",
    fazer: "Ative as sugestões com respostas salvas.",
    caminho: "Menu > Configurações e atividade > Ferramentas para empresas > Sugestões de resposta",
    porque: "O direct sugere a resposta pronta enquanto se digita: responde mais rápido.",
  },
  {
    chave: "respostas_salvas",
    grupo: "configuracoes",
    titulo: "Respostas salvas",
    fazer: "Crie respostas prontas para o direct (parcerias, publi, onde está o link).",
    caminho: "Menu > Configurações e atividade > Ferramentas para empresas > Respostas salvas",
    porque: "Resposta rápida não perde a conversa, e conversa é sinal de interesse para o Instagram.",
    por_tipo: {
      negocio_local: { fazer: "Crie respostas prontas para horário, endereço, como agendar ou pedir e preço médio.", porque: "São as perguntas de todo dia: responder em segundos fecha o pedido antes de a pessoa ir ao concorrente." },
      loja: { fazer: "Crie respostas prontas para prazo e valor de entrega, trocas, formas de pagamento e tamanhos.", porque: "Dúvida de frete e troca sem resposta rápida vira carrinho abandonado." },
      profissional_liberal: { fazer: "Crie respostas prontas para como agendar, valores ou convênio, online ou presencial e endereço.", porque: "Quem pergunta está decidindo: a resposta pronta leva direto ao agendamento." },
    },
  },
  {
    chave: "perguntas_frequentes",
    grupo: "configuracoes",
    titulo: "Perguntas frequentes",
    fazer: "Opcional: crie só se recebe sempre a mesma pergunta (até 4).",
    caminho: "Menu > Configurações e atividade > Ferramentas para empresas > Perguntas frequentes",
    porque: "As perguntas aparecem quando a pessoa abre o direct: ela toca e recebe a resposta pronta.",
    por_tipo: {
      criador: { fazer: "Opcional: crie só se recebe sempre a mesma pergunta (até 4).", porque: "O original diz que faz sentido para loja; para criador o direct aberto rende mais conversa.", aplica: false },
      negocio_local: { fazer: "Crie as 4 perguntas: horário, endereço, como agendar ou pedir, preço.", porque: "Quem abre o direct já vê o que mais se pergunta e chega ao pedido com um toque." },
      loja: { fazer: "Crie as 4 perguntas: entrega, trocas, pagamento, tamanhos ou estoque.", porque: "O checklist original recomenda para loja: tira a dúvida que trava a compra." },
      profissional_liberal: { fazer: "Crie as 4 perguntas sobre o atendimento: como agendar, valores ou convênio, online ou presencial, onde atende.", porque: "Responde o que a pessoa tem vergonha de perguntar e encurta o caminho até a consulta." },
    },
  },
  {
    chave: "comentarios_gif",
    grupo: "configuracoes",
    titulo: "Comentários com GIF",
    fazer: "Permita comentários com GIF.",
    caminho: "Menu > Configurações e atividade > Comentários > Permitir comentários com GIF",
    porque: "Comentar fica mais fácil, e comentário é interação que conta para o alcance.",
  },
  {
    chave: "compartilhamento_e_remixes",
    grupo: "configuracoes",
    titulo: "Compartilhamento e remixes",
    fazer: "Ative tudo: compartilhar no story e por mensagem, remix e sequência.",
    caminho: "Menu > Configurações e atividade > Compartilhamento e remixes",
    porque: "Cada compartilhamento leva o post para quem ainda não segue.",
  },
  {
    chave: "permitir_baixar_reels",
    grupo: "configuracoes",
    titulo: "Permitir baixar reels",
    fazer: "Ative \"Permitir que as pessoas baixem seus reels\".",
    caminho: "Menu > Configurações e atividade > Compartilhamento e remixes > Permitir downloads",
    porque: "Baixar é um sinal forte para o algoritmo: a pessoa quis guardar ou mandar o vídeo.",
  },
  {
    chave: "interacoes_limitadas",
    grupo: "configuracoes",
    titulo: "Interações limitadas",
    fazer: "Use só se a conta estiver sendo atacada (comentários e mensagens em massa); desligue depois.",
    caminho: "Menu > Configurações e atividade > Interações limitadas",
    porque: "Segura o ataque sem reduzir o alcance dos posts. Marque como feito depois de conferir.",
  },
  {
    chave: "alta_qualidade",
    grupo: "configuracoes",
    titulo: "Uso de dados",
    fazer: "Deixe ativado só \"Carregar em alta qualidade\" (no celular que posta).",
    caminho: "Menu > Configurações e atividade > Uso de dados e qualidade de mídia",
    porque: "Sem isso o app comprime o vídeo e a foto na hora de subir. O ajuste é do aparelho: confira em cada celular que posta.",
  },

  // ------------------------------------------------------------------ Ao postar foto ou carrossel
  {
    chave: "foto_compartilhar_facebook",
    grupo: "postar_foto",
    titulo: "Compartilhar no Facebook",
    fazer: "Ligue o compartilhamento na página do Facebook.",
    caminho: "Nova publicação > tela da legenda > Compartilhar no Facebook",
    porque: "O mesmo post entra na página sem trabalho a mais.",
  },
  {
    chave: "foto_configuracoes_avancadas",
    grupo: "postar_foto",
    titulo: "Configurações avançadas",
    fazer: "Deixe desligados: programar, ocultar curtidas e desativar comentários.",
    caminho: "Nova publicação > tela da legenda > Mais opções > Configurações avançadas",
    porque: "Curtida escondida e comentário fechado tiram a prova social e a conversa do post.",
    por_tipo: {
      negocio_local: { fazer: "Deixe desligados ocultar curtidas e desativar comentários. Programar pode ficar quando o horário já está na Agenda.", porque: "O que tira alcance é esconder curtida e fechar comentário; o negócio costuma programar pela agenda da agência." },
      loja: { fazer: "Deixe desligados ocultar curtidas e desativar comentários. Programar pode ficar quando o horário já está na Agenda.", porque: "O que tira alcance é esconder curtida e fechar comentário; a loja costuma programar lançamento e promoção." },
      profissional_liberal: { fazer: "Deixe desligados ocultar curtidas e desativar comentários. Programar pode ficar quando o horário já está na Agenda.", porque: "O que tira alcance é esconder curtida e fechar comentário; programar ajuda quem atende o dia inteiro." },
    },
  },
  {
    chave: "foto_texto_alternativo",
    grupo: "postar_foto",
    titulo: "Texto alternativo",
    fazer: "Escreva o texto alternativo dizendo o que aparece na imagem.",
    caminho: "Nova publicação > Configurações avançadas > Escrever texto alternativo",
    porque: "Acessibilidade, e o Instagram entende melhor do que é a imagem para mostrar na busca.",
  },

  // ------------------------------------------------------------------ Ao postar Reels
  {
    chave: "reels_marcar_pessoas",
    grupo: "postar_reels",
    titulo: "Marcar pessoas e colaboração",
    fazer: "Marque as pessoas e convide colaboradores quando fizer sentido.",
    caminho: "Novo reel > tela da legenda > Marcar pessoas (e Convidar colaborador)",
    porque: "Colaboração mostra o Reels também para os seguidores do outro perfil.",
  },
  {
    chave: "reels_botao_mensagem",
    grupo: "postar_reels",
    titulo: "Botão de mensagem",
    fazer: "Não use o botão de mensagem no Reels.",
    caminho: "Novo reel > tela da legenda > Adicionar botão (deixe sem)",
    porque: "O botão deixa o Reels com cara de anúncio. Peça a mensagem na fala ou na legenda.",
  },
  {
    chave: "reels_publico",
    grupo: "postar_reels",
    titulo: "Público",
    fazer: "Deixe o público em Todos.",
    caminho: "Novo reel > tela da legenda > Público > Todos",
    porque: "Amigos próximos fecha o Reels para quem ainda não segue.",
  },
  {
    chave: "reels_topicos",
    grupo: "postar_reels",
    titulo: "Tópicos",
    fazer: "Adicione 3 tópicos do assunto do vídeo.",
    caminho: "Novo reel > tela da legenda > Adicionar tópicos",
    porque: "Os tópicos dizem ao Instagram para quem recomendar o vídeo.",
  },
  {
    chave: "reels_renomear_audio",
    grupo: "postar_reels",
    titulo: "Renomear áudio original",
    fazer: "Renomeie o áudio original com um chamado (ex.: \"Compartilhe\", \"Deixa o like\").",
    caminho: "Novo reel > tela da legenda > Renomear áudio",
    porque: "O nome do áudio aparece embaixo do vídeo: é mais um lugar com chamado para ação.",
    por_tipo: {
      negocio_local: { fazer: "Renomeie o áudio original com um chamado ligado ao negócio (ex.: \"Agende pelo link\", \"Chama no WhatsApp\").", porque: "O nome do áudio aparece embaixo do vídeo: vira um chamado para o pedido, não só para o like." },
      loja: { fazer: "Renomeie o áudio original com um chamado de compra (ex.: \"Link na bio\", \"Peça pelo direct\").", porque: "O nome do áudio aparece embaixo do vídeo: vira um chamado para a compra, não só para o like." },
      profissional_liberal: { fazer: "Renomeie o áudio original com um chamado de agendamento (ex.: \"Agende pelo link\").", porque: "O nome do áudio aparece embaixo do vídeo: vira um chamado para a consulta, não só para o like." },
    },
  },
  {
    chave: "reels_localizacao",
    grupo: "postar_reels",
    titulo: "Localização",
    fazer: "Adicione a localização quando o lugar interessa ao público.",
    caminho: "Novo reel > tela da legenda > Adicionar localização",
    porque: "A localização mostra o vídeo para quem está perto ou procura aquele lugar.",
    por_tipo: {
      negocio_local: { fazer: "Adicione sempre a localização do negócio.", porque: "É assim que o Reels chega a quem está perto e pode virar cliente hoje." },
      loja: { fazer: "Se tem loja física, sempre a localização dela; só online, a cidade.", porque: "Loja física ganha visita de quem está perto; a online ganha confiança mostrando de onde é." },
      profissional_liberal: { fazer: "Adicione sempre o local do consultório ou escritório (ou a cidade).", porque: "Quem procura um profissional quer alguém perto de casa." },
    },
  },
  {
    chave: "reels_lembrete",
    grupo: "postar_reels",
    titulo: "Lembrete",
    fazer: "Use lembrete só para evento (lançamento, live, inauguração).",
    caminho: "Novo reel > tela da legenda > Adicionar lembrete",
    porque: "Fora de evento o lembrete reduz o alcance.",
  },
  {
    chave: "reels_modelo",
    grupo: "postar_reels",
    titulo: "Usar como modelo",
    fazer: "Permita usar como modelo quando o Reels foi feito no editor do Instagram.",
    caminho: "Novo reel > Mais opções > Permitir que as pessoas usem como modelo",
    porque: "Quem usa o modelo leva o nome do perfil junto.",
  },
  {
    chave: "reels_presentes",
    grupo: "postar_reels",
    titulo: "Presentes no Reels",
    fazer: "Deixe os presentes desligados.",
    caminho: "Novo reel > Mais opções > Presentes",
    porque: "O botão de presente tira a atenção do chamado do vídeo.",
  },
  {
    chave: "reels_curtidas_visiveis",
    grupo: "postar_reels",
    titulo: "Curtidas visíveis",
    fazer: "Deixe as curtidas visíveis.",
    caminho: "Novo reel > Mais opções > Ocultar número de curtidas (desligado)",
    porque: "Curtida à vista é prova social para quem chega.",
  },
  {
    chave: "reels_legendas_automaticas",
    grupo: "postar_reels",
    titulo: "Legendas automáticas",
    fazer: "Desligue as legendas automáticas quando a fala é rápida ou enrolada; faça a legenda na edição.",
    caminho: "Novo reel > Mais opções > Legendas automáticas",
    porque: "A automática erra palavra em fala rápida e cobre a legenda feita na edição.",
  },
  {
    chave: "reels_permitir_baixar",
    grupo: "postar_reels",
    titulo: "Permitir baixar",
    fazer: "Deixe ligado \"Permitir que as pessoas baixem\" neste Reels.",
    caminho: "Novo reel > Mais opções > Permitir downloads",
    porque: "Baixar é sinal forte para o algoritmo.",
  },
];

// ------------------------------------------------------------------ adaptar ao tipo

export type AjusteAdaptado = {
  chave: string;
  grupo: GrupoDoAjuste;
  titulo: string;
  fazer: string;
  caminho: string;
  porque: string;
  /** false: não se aplica a este tipo (fica na lista, apagado, e sai da conta). */
  aplica: boolean;
  /** A recomendação deste tipo é diferente da original (de criador). */
  mudou: boolean;
  /** Tipo "não sei" e o item muda conforme o tipo: escolher o tipo antes de mexer. */
  depende_do_tipo: boolean;
  /** A recomendação original, quando mudou (para o "?" mostrar o que o checklist dizia). */
  original: string | null;
};

const original = (a: AjusteDoApp): RecomendacaoDoTipo => ({ fazer: a.fazer, porque: a.porque, aplica: true });

/** A recomendação de um item para o tipo. "Não sei" fica com o original (de criador) e marca o que depende do tipo. */
export function adaptarAjuste(a: AjusteDoApp, tipo: TipoOuNaoSei): AjusteAdaptado {
  const base = original(a);
  const doCriador = (a.por_tipo && a.por_tipo.criador) || base;
  // "Não sei" fica com o original do checklist (que é o de criador).
  const r = tipo === "nao_sei" ? doCriador : (a.por_tipo && a.por_tipo[tipo]) || base;
  const aplica = r.aplica !== false;
  const mudou = tipo !== "nao_sei" && tipo !== "criador" && r.fazer !== doCriador.fazer;
  const tiposQueMudam = a.por_tipo ? (Object.keys(a.por_tipo) as TipoDeNegocio[]).filter((t) => t !== "criador" && a.por_tipo![t]!.fazer !== doCriador.fazer) : [];
  return {
    chave: a.chave,
    grupo: a.grupo,
    titulo: a.titulo,
    fazer: r.fazer,
    caminho: a.caminho,
    porque: r.porque,
    aplica,
    mudou,
    depende_do_tipo: tipo === "nao_sei" && tiposQueMudam.length > 0,
    original: mudou ? doCriador.fazer : null,
  };
}

export function ajustesParaOTipo(tipo: TipoOuNaoSei | null | undefined): AjusteAdaptado[] {
  const t: TipoOuNaoSei = ehTipo(tipo) ? tipo : "nao_sei";
  return AJUSTES_DO_APP.map((a) => adaptarAjuste(a, t));
}

// ------------------------------------------------------------------ estado guardado

export type MarcaDoAjuste = { feito: boolean; quando: string | null; por: string | null };

export type TipoGuardado = {
  tipo: TipoOuNaoSei;
  origem: "jev" | "equipe";
  confianca: number | null;
  probabilidades: Record<string, number>;
  quando: string | null;
  por: string | null;
};

export type EstadoDosAjustes = { tipo_de_negocio: TipoGuardado | null; itens: Record<string, MarcaDoAjuste> };

export const CHAVES_DOS_AJUSTES = AJUSTES_DO_APP.map((a) => a.chave);
export const ehChaveDeAjuste = (v: unknown): v is string => typeof v === "string" && CHAVES_DOS_AJUSTES.indexOf(v) >= 0;

const textoOuNulo = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 64) : null);
const numeroOuNulo = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

/** Lê a coluna jsonb (ou o que a tela recebeu) sem nunca quebrar: campo estranho some. */
export function lerEstadoDosAjustes(bruto: unknown): EstadoDosAjustes {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const t = (o.tipo_de_negocio && typeof o.tipo_de_negocio === "object" ? o.tipo_de_negocio : null) as Record<string, unknown> | null;
  let tipo: TipoGuardado | null = null;
  if (t && ehTipo(t.tipo)) {
    const probs: Record<string, number> = {};
    const p = (t.probabilidades && typeof t.probabilidades === "object" ? t.probabilidades : {}) as Record<string, unknown>;
    for (const k of Object.keys(p)) if (ehTipo(k) && typeof p[k] === "number" && isFinite(p[k] as number)) probs[k] = p[k] as number;
    tipo = { tipo: t.tipo, origem: t.origem === "equipe" ? "equipe" : "jev", confianca: numeroOuNulo(t.confianca), probabilidades: probs, quando: textoOuNulo(t.quando), por: textoOuNulo(t.por) };
  }
  const itens: Record<string, MarcaDoAjuste> = {};
  const i = (o.itens && typeof o.itens === "object" && !Array.isArray(o.itens) ? o.itens : {}) as Record<string, unknown>;
  for (const k of Object.keys(i)) {
    const m = i[k] as Record<string, unknown> | null;
    if (!ehChaveDeAjuste(k) || !m || typeof m !== "object") continue;
    itens[k] = { feito: m.feito === true, quando: textoOuNulo(m.quando), por: textoOuNulo(m.por) };
  }
  return { tipo_de_negocio: tipo, itens };
}

export type ProgressoDosAjustes = { feitos: number; total: number; por_grupo: Record<GrupoDoAjuste, { feitos: number; total: number }> };

/** x de y feitos, contando só o que se aplica ao tipo. */
export function progressoDosAjustes(adaptados: AjusteAdaptado[], itens: Record<string, MarcaDoAjuste>): ProgressoDosAjustes {
  const por_grupo = {} as ProgressoDosAjustes["por_grupo"];
  for (const g of GRUPOS_DOS_AJUSTES) por_grupo[g.grupo] = { feitos: 0, total: 0 };
  let feitos = 0;
  let total = 0;
  for (const a of adaptados) {
    if (!a.aplica) continue;
    const ok = !!(itens[a.chave] && itens[a.chave].feito);
    total += 1;
    por_grupo[a.grupo].total += 1;
    if (ok) {
      feitos += 1;
      por_grupo[a.grupo].feitos += 1;
    }
  }
  return { feitos, total, por_grupo };
}

/** O progresso direto do estado guardado (a linha "ajustes do app: x de y" do diagnóstico). */
export function progressoDoEstado(estado: EstadoDosAjustes | null | undefined): ProgressoDosAjustes {
  const e = estado || { tipo_de_negocio: null, itens: {} };
  return progressoDosAjustes(ajustesParaOTipo(e.tipo_de_negocio ? e.tipo_de_negocio.tipo : "nao_sei"), e.itens);
}

// ------------------------------------------------------------------ Jev: o tipo de negócio

/**
 * Uma pergunta Choice sobre o contexto do cliente (negócio, dossiê, perfil). Critérios com o que é e
 * o que não é, porque criador e profissional liberal se confundem (os dois têm a pessoa na frente), e
 * negócio local e loja também (loja de bairro). "Não sei" é a saída quando os dados não bastam.
 */
export function perguntaDoTipoDeNegocio(): Record<string, PerguntaJev> {
  return {
    tipo_de_negocio: {
      type: "choice",
      instructions:
        "Pelo `negocio` (o que faz, oferta, público), pelo `dossie` e pelo `perfil` do Instagram, como este cliente ganha dinheiro com quem chega ao perfil? Escolha o tipo que decide o que o perfil deve mostrar: contato direto, botão de compra, agenda ou só conteúdo.",
      criteria: {
        criador: {
          o_que_e: "Criador de conteúdo ou influenciador: a renda vem da audiência (publis, parcerias, infoproduto, curso, monetização).",
          nao_e: "Um negócio que só usa o Instagram para divulgar o próprio serviço ou produto.",
        },
        negocio_local: {
          o_que_e: "Negócio com endereço que atende gente da cidade ou do bairro: restaurante, pizzaria, clínica, salão, academia, oficina, escola, loja de bairro.",
          nao_e: "Venda online com entrega para longe, ou uma pessoa que atende com hora marcada no próprio nome.",
        },
        loja: {
          o_que_e: "Loja que vende produtos pelo site, pelo direct ou pelo WhatsApp, com entrega; pode ter também loja física.",
          nao_e: "Serviço prestado no local ou atendimento com hora marcada.",
        },
        profissional_liberal: {
          o_que_e: "Profissional que atende com hora marcada no próprio nome: advogado, psicólogo, dentista, médico, nutricionista, contador, consultor, arquiteto.",
          nao_e: "Criador que vive de publi, ou uma empresa com marca própria e equipe atendendo.",
        },
        nao_sei: "Os dados não dizem o suficiente para separar um tipo do outro (negócio vazio, bio genérica, dossiê ausente).",
      },
    },
  };
}

/** Confiança mínima para aceitar a escolha do Jev; abaixo disso fica "não sei" e a equipe escolhe. */
export const PROBABILIDADE_MINIMA_DO_TIPO = 0.5;

/** Lê a resposta: tipo válido com probabilidade suficiente; senão "não sei". */
export function tipoDaResposta(r: RespostaJev | undefined | null, agora: Date = new Date()): TipoGuardado {
  const probs: Record<string, number> = {};
  const bruto: Record<string, number> = (r && r.probabilities && typeof r.probabilities === "object" ? r.probabilities : {}) as Record<string, number>;
  for (const k of Object.keys(bruto)) if (ehTipo(k) && typeof bruto[k] === "number" && isFinite(bruto[k])) probs[k] = Math.round(bruto[k] * 1000) / 1000;
  const escolha = r && ehTipo(r.choice) ? r.choice : null;
  const prob = escolha ? (typeof probs[escolha] === "number" ? probs[escolha] : null) : null;
  const vale = !!escolha && escolha !== "nao_sei" && (prob === null || prob >= PROBABILIDADE_MINIMA_DO_TIPO);
  return {
    tipo: vale ? (escolha as TipoOuNaoSei) : "nao_sei",
    origem: "jev",
    confianca: r && typeof r.confidence === "number" && isFinite(r.confidence) ? Math.round(r.confidence * 1000) / 1000 : null,
    probabilidades: probs,
    quando: agora.toISOString(),
    por: null,
  };
}

/** Os ajustes em texto curto para os agentes (o que falta, com o tipo). */
export function blocoDosAjustes(estado: EstadoDosAjustes | null | undefined): string {
  const e = estado || { tipo_de_negocio: null, itens: {} };
  const tipo = e.tipo_de_negocio ? e.tipo_de_negocio.tipo : "nao_sei";
  const adaptados = ajustesParaOTipo(tipo);
  const p = progressoDosAjustes(adaptados, e.itens);
  const faltam = adaptados.filter((a) => a.aplica && !(e.itens[a.chave] && e.itens[a.chave].feito));
  if (!faltam.length) return `AJUSTES DO APP (${rotuloDoTipo(tipo)}): ${p.feitos} de ${p.total} feitos.`;
  return [`AJUSTES DO APP (${rotuloDoTipo(tipo)}, ${p.feitos} de ${p.total} feitos). Faltam:`, ...faltam.slice(0, 12).map((a) => `- ${a.titulo}: ${a.fazer}`)].join("\n");
}
