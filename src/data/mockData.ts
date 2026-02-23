export const clients = [
  {
    id: "1",
    name: "Acerbi Associação",
    email: "contato@acerbi.com.br",
    avatar: "AA",
    services: ["Social Media", "Automação", "Site"],
    projects: 2,
    status: "ativo" as const,
  },
  {
    id: "2",
    name: "Cresol Cooperativa",
    email: "marketing@cresol.com.br",
    avatar: "CC",
    services: ["Evento", "Social Media"],
    projects: 2,
    status: "ativo" as const,
  },
];

export const projects = [
  {
    id: "1",
    name: "Social Media Acerbi",
    client: "Acerbi Associação",
    type: "Social Media",
    status: "Em andamento",
    progress: 65,
    deadline: "15 Mar 2026",
    description: "Gestão completa de redes sociais com conteúdo semanal.",
  },
  {
    id: "2",
    name: "Evento Cresol 2026",
    client: "Cresol Cooperativa",
    type: "Evento",
    status: "Em revisão",
    progress: 80,
    deadline: "28 Fev 2026",
    description: "Planejamento e execução do evento anual cooperativo.",
  },
  {
    id: "3",
    name: "Automação Acerbi",
    client: "Acerbi Associação",
    type: "Automação",
    status: "Em andamento",
    progress: 40,
    deadline: "10 Abr 2026",
    description: "Fluxos de automação de email e CRM integrado.",
  },
  {
    id: "4",
    name: "Site Cresol",
    client: "Cresol Cooperativa",
    type: "Site",
    status: "Backlog",
    progress: 10,
    deadline: "30 Mai 2026",
    description: "Novo site institucional responsivo com blog.",
  },
];

export interface KanbanTask {
  id: string;
  title: string;
  project: string;
  priority: "alta" | "média" | "baixa";
  deadline: string;
  assignee: string;
  assigneeAvatar: string;
  column: "backlog" | "andamento" | "revisao" | "concluido";
}

export const kanbanTasks: KanbanTask[] = [
  { id: "t1", title: "Criar calendário editorial", project: "Social Media Acerbi", priority: "alta", deadline: "25 Fev", assignee: "Ana", assigneeAvatar: "AN", column: "andamento" },
  { id: "t2", title: "Design posts Instagram", project: "Social Media Acerbi", priority: "média", deadline: "28 Fev", assignee: "Pedro", assigneeAvatar: "PE", column: "andamento" },
  { id: "t3", title: "Briefing evento cooperativo", project: "Evento Cresol 2026", priority: "alta", deadline: "20 Fev", assignee: "Lucas", assigneeAvatar: "LF", column: "revisao" },
  { id: "t4", title: "Layout convite digital", project: "Evento Cresol 2026", priority: "média", deadline: "22 Fev", assignee: "Ana", assigneeAvatar: "AN", column: "revisao" },
  { id: "t5", title: "Configurar fluxo e-mail", project: "Automação Acerbi", priority: "alta", deadline: "01 Mar", assignee: "Pedro", assigneeAvatar: "PE", column: "backlog" },
  { id: "t6", title: "Integrar CRM com landing", project: "Automação Acerbi", priority: "baixa", deadline: "05 Mar", assignee: "Lucas", assigneeAvatar: "LF", column: "backlog" },
  { id: "t7", title: "Wireframe homepage", project: "Site Cresol", priority: "média", deadline: "10 Mar", assignee: "Ana", assigneeAvatar: "AN", column: "backlog" },
  { id: "t8", title: "Relatório mensal entregue", project: "Social Media Acerbi", priority: "baixa", deadline: "15 Fev", assignee: "Pedro", assigneeAvatar: "PE", column: "concluido" },
];

export const notifications = [
  { id: "n1", type: "aprovação" as const, title: "Aprovação pendente", message: "Posts da semana 8 aguardando aprovação da Acerbi.", time: "2h atrás", read: false },
  { id: "n2", type: "relatório" as const, title: "Relatório disponível", message: "Relatório de fevereiro do Social Media Acerbi está pronto.", time: "5h atrás", read: false },
  { id: "n3", type: "cobrança" as const, title: "Fatura gerada", message: "Fatura #0042 de R$ 4.500 emitida para Cresol.", time: "1d atrás", read: true },
  { id: "n4", type: "pedido" as const, title: "Novo pedido recebido", message: "Cresol solicitou ajustes no layout do convite.", time: "1d atrás", read: false },
  { id: "n5", type: "aprovação" as const, title: "Conteúdo aprovado", message: "Acerbi aprovou os criativos do carrossel.", time: "2d atrás", read: true },
];

export const updates = [
  { id: "u1", type: "projeto", message: "Social Media Acerbi avançou para 65% concluído.", time: "1h atrás" },
  { id: "u2", type: "tarefa", message: "Ana finalizou o calendário editorial de março.", time: "3h atrás" },
  { id: "u3", type: "cliente", message: "Cresol enviou feedback sobre o convite digital.", time: "6h atrás" },
  { id: "u4", type: "sistema", message: "Backup automático realizado com sucesso.", time: "12h atrás" },
];

export const typeColors: Record<string, string> = {
  "Social Media": "bg-info/20 text-info",
  "Evento": "bg-warning/20 text-warning",
  "Automação": "bg-success/20 text-success",
  "Site": "bg-primary/20 text-primary",
};

export const priorityColors: Record<string, string> = {
  alta: "bg-destructive/20 text-destructive",
  média: "bg-warning/20 text-warning",
  baixa: "bg-success/20 text-success",
};

export const updateDotColors: Record<string, string> = {
  projeto: "bg-primary",
  tarefa: "bg-success",
  cliente: "bg-warning",
  sistema: "bg-muted-foreground",
};
