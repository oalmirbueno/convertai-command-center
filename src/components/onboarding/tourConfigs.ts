export interface TourStep {
  /** CSS selector or data-tour attribute value to highlight */
  target: string;
  title: string;
  description: string;
  /** Position of tooltip relative to target */
  placement: "top" | "bottom" | "left" | "right" | "center";
  /** Optional route to navigate to before showing step */
  route?: string;
}

/* ═══════════════════════════════════════════════════════
   ADMIN TOUR — Linguagem de gestor de agência
   ═══════════════════════════════════════════════════════ */
export const adminTourSteps: TourStep[] = [
  // ── Boas-vindas ──
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo ao Aceleriq! 🚀",
    description:
      "Este é o centro de comando da sua agência. Vamos percorrer cada seção para que você domine a plataforma e gerencie seus clientes e equipe com total controle.",
    placement: "center",
  },

  // ── Dashboard ──
  {
    target: "[data-tour='nav-dashboard']",
    title: "Dashboard — Visão Geral",
    description:
      "O painel principal da sua agência. Aqui você vê projetos ativos, tarefas pendentes, métricas e o feed de atualizações em tempo real.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dash-stats']",
    title: "Métricas da Agência",
    description:
      "Acompanhe de relance: projetos ativos, total de clientes, tarefas pendentes e projetos em revisão. Números atualizados em tempo real.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dash-quick-actions']",
    title: "Ações Rápidas",
    description:
      "Crie projetos, cadastre clientes, gere links de briefing ou registre atas de reunião — tudo com um clique, sem sair do dashboard.",
    placement: "bottom",
    route: "/dashboard",
  },

  // ── Projetos ──
  {
    target: "[data-tour='nav-projetos']",
    title: "Projetos",
    description:
      "Gerencie todos os projetos dos seus clientes. Visualize status, prazos e progresso de cada um.",
    placement: "bottom",
    route: "/projetos",
  },
  {
    target: "[data-tour='projects-create-btn']",
    title: "Criar Novo Projeto",
    description:
      "Clique aqui para criar um projeto. Defina nome, cliente, tipo, datas de início e prazo. O projeto aparecerá automaticamente no dashboard do cliente.",
    placement: "bottom",
    route: "/projetos",
  },
  {
    target: "[data-tour='projects-list']",
    title: "Lista de Projetos",
    description:
      "Clique em qualquer projeto para abrir o painel lateral com controle total: altere status, ajuste progresso via slider, veja marcos, tarefas e equipe.",
    placement: "top",
    route: "/projetos",
  },

  // ── Kanban ──
  {
    target: "[data-tour='nav-kanban']",
    title: "Kanban — Gestão de Tarefas",
    description:
      "Visualize todas as tarefas da agência em colunas: Backlog, Em Andamento, Revisão e Concluído.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='kanban-create-btn']",
    title: "Criar Nova Tarefa",
    description:
      "Adicione tarefas rapidamente. Defina título, projeto vinculado, prioridade, responsável da equipe e prazo de entrega.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='kanban-board']",
    title: "Quadro Kanban",
    description:
      "Arraste os cards entre colunas para atualizar o status. Cada card mostra prioridade (borda colorida), responsável e projeto vinculado.",
    placement: "top",
    route: "/kanban",
  },

  // ── Clientes ──
  {
    target: "[data-tour='nav-clientes']",
    title: "Clientes",
    description:
      "Cadastre e gerencie os clientes da sua agência. Veja dados de contato, projetos vinculados e status do plano.",
    placement: "bottom",
    route: "/clientes",
  },
  {
    target: "[data-tour='clients-create-btn']",
    title: "Cadastrar Novo Cliente",
    description:
      "Crie a conta do cliente com nome, empresa, email e telefone. O cliente receberá acesso ao portal para acompanhar seus projetos.",
    placement: "bottom",
    route: "/clientes",
  },
  {
    target: "[data-tour='clients-briefing-btn']",
    title: "Link de Briefing",
    description:
      "Gere um link de briefing para enviar ao cliente. Ele responde um questionário que alimenta automaticamente o projeto.",
    placement: "bottom",
    route: "/clientes",
  },

  // ── Relatórios ──
  {
    target: "[data-tour='nav-relatorios']",
    title: "Relatórios",
    description:
      "Crie relatórios de performance com métricas, gráficos e insights. Os relatórios ficam disponíveis automaticamente no portal do cliente.",
    placement: "bottom",
    route: "/relatorios",
  },

  // ── Menu Mais ──
  {
    target: "[data-tour='nav-more']",
    title: "Mais Funcionalidades",
    description:
      "Acesse: Aprovações (revisar entregas), Pedidos (solicitações de clientes), Briefings, Equipe, Timeline, Financeiro, Arquivos e Configurações.",
    placement: "bottom",
  },

  // ── Notificações ──
  {
    target: "[data-tour='nav-notifications']",
    title: "Central de Notificações",
    description:
      "Receba alertas da agência em tempo real: aprovações de arquivos, novos pedidos de clientes, atualizações de tarefas e marcos alcançados.",
    placement: "bottom",
  },

  // ── Perfil ──
  {
    target: "[data-tour='nav-user']",
    title: "Sua Conta",
    description:
      "Acesse suas configurações de administrador e faça logout quando necessário.",
    placement: "bottom",
  },

  // ── Conclusão ──
  {
    target: "[data-tour='finish']",
    title: "Você está no controle! ✅",
    description:
      "Agora você domina todas as funcionalidades da plataforma. A qualquer momento, clique no botão (?) no canto inferior direito para refazer este tour.",
    placement: "center",
  },
];

/* ═══════════════════════════════════════════════════════
   CLIENT TOUR — Linguagem de cliente / empresa
   ═══════════════════════════════════════════════════════ */
export const clientTourSteps: TourStep[] = [
  // ── Boas-vindas ──
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo ao portal da sua empresa! 🎉",
    description:
      "Aqui você acompanha o progresso dos projetos da sua empresa, aprova entregas, envia solicitações e visualiza relatórios — tudo em um só lugar.",
    placement: "center",
  },

  // ── Dashboard / Canvas ──
  {
    target: "[data-tour='nav-dashboard']",
    title: "Seus Projetos",
    description:
      "O canvas interativo mostra todos os projetos da sua empresa com indicadores de progresso. Clique em qualquer projeto para explorar os detalhes.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='client-canvas']",
    title: "Canvas de Projetos",
    description:
      "Cada card representa um projeto da sua empresa. O círculo de progresso mostra o quanto já foi concluído. Clique para abrir a visão expandida.",
    placement: "center",
    route: "/dashboard",
  },

  // ── Projetos (visão expandida) ──
  {
    target: "[data-tour='nav-projetos']",
    title: "Detalhes do Projeto",
    description:
      "Veja informações completas: progresso, entregas, tarefas em andamento, timeline e atualizações da equipe que cuida da sua empresa.",
    placement: "bottom",
    route: "/projetos",
  },

  // ── Relatórios ──
  {
    target: "[data-tour='nav-relatorios']",
    title: "Relatórios de Resultados",
    description:
      "Acesse os relatórios de performance da sua empresa com métricas detalhadas, gráficos de evolução e análises dos resultados alcançados.",
    placement: "bottom",
    route: "/relatorios",
  },

  // ── Timeline ──
  {
    target: "[data-tour='nav-timeline']",
    title: "Cronograma",
    description:
      "Visualize o cronograma dos projetos da sua empresa. Veja marcos importantes, datas de entrega e o que vem pela frente.",
    placement: "bottom",
    route: "/timeline",
  },

  // ── Menu Mais ──
  {
    target: "[data-tour='nav-more']",
    title: "Mais Opções",
    description:
      "Acesse funcionalidades adicionais importantes para a sua empresa:",
    placement: "bottom",
  },
  {
    target: "[data-tour='welcome']",
    title: "📋 Aprovações",
    description:
      "Revise as entregas feitas pela equipe. Você pode aprovar, solicitar ajustes ou rejeitar cada arquivo enviado. Sua opinião guia o trabalho.",
    placement: "center",
  },
  {
    target: "[data-tour='welcome']",
    title: "📝 Pedidos e Solicitações",
    description:
      "Precisa de algo novo ou quer solicitar um ajuste? Crie um pedido descrevendo o que a sua empresa precisa. A equipe recebe na hora.",
    placement: "center",
  },
  {
    target: "[data-tour='welcome']",
    title: "💰 Financeiro",
    description:
      "Acompanhe faturas, boletos e o histórico financeiro da sua empresa. Veja o que está pendente e o que já foi pago.",
    placement: "center",
  },

  // ── Notificações ──
  {
    target: "[data-tour='nav-notifications']",
    title: "Suas Notificações",
    description:
      "Receba alertas quando houver novas entregas para aprovar, atualizações nos projetos da sua empresa ou respostas da equipe.",
    placement: "bottom",
  },

  // ── Conclusão ──
  {
    target: "[data-tour='finish']",
    title: "Tudo pronto! ✅",
    description:
      "Agora você sabe como acompanhar os projetos da sua empresa. Clique no botão (?) no canto inferior direito a qualquer momento para rever este tour.",
    placement: "center",
  },
];

/* ═══════════════════════════════════════════════════════
   TEAM TOUR — Linguagem de colaborador / membro da equipe
   ═══════════════════════════════════════════════════════ */
export const teamTourSteps: TourStep[] = [
  // ── Boas-vindas ──
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo à equipe! 💪",
    description:
      "Este é o seu espaço de trabalho. Aqui você visualiza suas tarefas, acompanha projetos e gerencia suas entregas. Vamos conhecer tudo!",
    placement: "center",
  },

  // ── Dashboard ──
  {
    target: "[data-tour='nav-dashboard']",
    title: "Seu Painel",
    description:
      "Veja o resumo do seu dia: tarefas atribuídas a você, projetos em que está envolvido e as últimas atualizações dos projetos.",
    placement: "bottom",
    route: "/dashboard",
  },

  // ── Projetos ──
  {
    target: "[data-tour='nav-projetos']",
    title: "Projetos",
    description:
      "Acesse os projetos nos quais você participa. Veja briefings, entregas pendentes e prazos para organizar seu trabalho.",
    placement: "bottom",
    route: "/projetos",
  },

  // ── Kanban ──
  {
    target: "[data-tour='nav-kanban']",
    title: "Suas Tarefas — Kanban",
    description:
      "Gerencie suas tarefas visualmente no quadro Kanban. Mova os cards entre colunas conforme avança nas entregas.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='kanban-create-btn']",
    title: "Criar Tarefa",
    description:
      "Você pode criar novas tarefas quando necessário. Defina título, projeto, prioridade e prazo para manter tudo organizado.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='kanban-board']",
    title: "Como Funciona o Quadro",
    description:
      "Arraste suas tarefas entre as colunas para atualizar o status. A borda colorida à esquerda indica a prioridade: vermelha = urgente, amarela = alta.",
    placement: "top",
    route: "/kanban",
  },

  // ── Relatórios ──
  {
    target: "[data-tour='nav-relatorios']",
    title: "Relatórios",
    description:
      "Visualize os relatórios de performance dos projetos em que você atua. Use para acompanhar métricas e resultados.",
    placement: "bottom",
    route: "/relatorios",
  },

  // ── Notificações ──
  {
    target: "[data-tour='nav-notifications']",
    title: "Notificações",
    description:
      "Fique atento: novas tarefas atribuídas a você, aprovações de clientes, atualizações de projetos e prazos aparecerão aqui.",
    placement: "bottom",
  },

  // ── Conclusão ──
  {
    target: "[data-tour='finish']",
    title: "Bom trabalho! ✅",
    description:
      "Você já conhece a plataforma. Foque nas suas tarefas e entregas. Clique no botão (?) no canto inferior direito para rever este tour quando quiser.",
    placement: "center",
  },
];
