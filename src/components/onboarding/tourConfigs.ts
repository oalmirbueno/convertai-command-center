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

/* ──────────────── ADMIN TOUR ──────────────── */
export const adminTourSteps: TourStep[] = [
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo ao Aceleriq! 🚀",
    description: "Este é o seu painel de controle completo. Vamos fazer um tour rápido para você dominar cada funcionalidade da plataforma.",
    placement: "center",
  },
  {
    target: "[data-tour='nav-dashboard']",
    title: "Dashboard",
    description: "Visão geral de tudo: projetos ativos, feed de atualizações, tarefas pendentes e métricas da sua agência em um só lugar.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='nav-projetos']",
    title: "Projetos",
    description: "Gerencie todos os projetos dos seus clientes. Crie novos, acompanhe progresso, defina marcos e controle o status de cada um.",
    placement: "bottom",
    route: "/projetos",
  },
  {
    target: "[data-tour='nav-kanban']",
    title: "Kanban",
    description: "Visualize e organize todas as tarefas em colunas de Backlog, Em Progresso, Revisão e Concluído. Arraste para reorganizar.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='nav-clientes']",
    title: "Clientes",
    description: "Cadastre e gerencie seus clientes. Acesse dados de contato, projetos vinculados e gere links de briefing diretamente.",
    placement: "bottom",
    route: "/clientes",
  },
  {
    target: "[data-tour='nav-relatorios']",
    title: "Relatórios",
    description: "Crie relatórios de performance com métricas, gráficos e insights para enviar aos seus clientes.",
    placement: "bottom",
    route: "/relatorios",
  },
  {
    target: "[data-tour='nav-more']",
    title: "Mais opções",
    description: "Acesse funções adicionais: Aprovações, Pedidos, Briefings, Equipe, Timeline, Financeiro, Arquivos e Configurações.",
    placement: "bottom",
  },
  {
    target: "[data-tour='nav-notifications']",
    title: "Notificações",
    description: "Acompanhe em tempo real: aprovações de arquivos, novos pedidos de clientes, atualizações de projetos e mais.",
    placement: "bottom",
  },
  {
    target: "[data-tour='nav-user']",
    title: "Seu Perfil",
    description: "Acesse suas configurações de conta e faça logout quando necessário.",
    placement: "bottom",
  },
  {
    target: "[data-tour='finish']",
    title: "Tudo pronto! ✅",
    description: "Agora você conhece todas as funcionalidades. Use o botão de ajuda (?) no canto inferior para refazer o tour quando quiser.",
    placement: "center",
  },
];

/* ──────────────── CLIENT TOUR ──────────────── */
export const clientTourSteps: TourStep[] = [
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo! 🎉",
    description: "Este é o seu portal de acompanhamento. Aqui você visualiza o progresso dos seus projetos, envia aprovações e se comunica com a equipe.",
    placement: "center",
  },
  {
    target: "[data-tour='nav-dashboard']",
    title: "Dashboard",
    description: "Sua visão geral: veja o status dos projetos, últimas atualizações e o que precisa da sua atenção.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='nav-projetos']",
    title: "Seus Projetos",
    description: "Explore cada projeto em detalhes. Veja progresso, tarefas, entregas, timeline e atualizações — tudo em um canvas interativo.",
    placement: "bottom",
    route: "/projetos",
  },
  {
    target: "[data-tour='nav-relatorios']",
    title: "Relatórios",
    description: "Acesse relatórios de performance com métricas detalhadas e gráficos de evolução dos seus resultados.",
    placement: "bottom",
    route: "/relatorios",
  },
  {
    target: "[data-tour='nav-timeline']",
    title: "Timeline",
    description: "Visualize o cronograma dos seus projetos com marcos e datas importantes em uma linha do tempo visual.",
    placement: "bottom",
    route: "/timeline",
  },
  {
    target: "[data-tour='nav-more']",
    title: "Mais opções",
    description: "Acesse Aprovações (para aprovar entregas), Pedidos (para solicitar ajustes), Documentos e Financeiro.",
    placement: "bottom",
  },
  {
    target: "[data-tour='nav-notifications']",
    title: "Notificações",
    description: "Receba alertas quando houver novas entregas para aprovar, atualizações no projeto ou respostas da equipe.",
    placement: "bottom",
  },
  {
    target: "[data-tour='finish']",
    title: "Tudo pronto! ✅",
    description: "Agora você sabe navegar pela plataforma. Clique no botão (?) no canto inferior a qualquer momento para rever este tour.",
    placement: "center",
  },
];

/* ──────────────── TEAM MEMBER TOUR ──────────────── */
export const teamTourSteps: TourStep[] = [
  {
    target: "[data-tour='welcome']",
    title: "Bem-vindo à equipe! 💪",
    description: "Este é o seu espaço de trabalho. Aqui você acessa os projetos, tarefas atribuídas e entregas que precisa fazer.",
    placement: "center",
  },
  {
    target: "[data-tour='nav-dashboard']",
    title: "Dashboard",
    description: "Veja um resumo das suas tarefas, projetos e atualizações recentes.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='nav-projetos']",
    title: "Projetos",
    description: "Acesse os projetos nos quais você está envolvido e acompanhe entregas e prazos.",
    placement: "bottom",
    route: "/projetos",
  },
  {
    target: "[data-tour='nav-kanban']",
    title: "Kanban",
    description: "Gerencie suas tarefas visualmente. Mova cards entre colunas conforme avança no trabalho.",
    placement: "bottom",
    route: "/kanban",
  },
  {
    target: "[data-tour='nav-notifications']",
    title: "Notificações",
    description: "Fique por dentro de novas tarefas, aprovações de clientes e atualizações dos projetos.",
    placement: "bottom",
  },
  {
    target: "[data-tour='finish']",
    title: "Tudo pronto! ✅",
    description: "Você já conhece a plataforma. Use o botão (?) no canto inferior para rever o tour quando quiser.",
    placement: "center",
  },
];
