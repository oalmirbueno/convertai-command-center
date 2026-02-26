// Templates de milestones e tarefas por tipo de projeto
// role: quem deve ser atribuído automaticamente (admin, design, traffic, manager)

export interface TemplateMilestone {
  title: string;
  offsetDays: number; // dias após o início do projeto
  tasks: TemplateTask[];
}

export interface TemplateTask {
  title: string;
  description?: string;
  priority: string;
  role: "admin" | "design" | "traffic" | "manager";
}

export const projectTemplates: Record<string, TemplateMilestone[]> = {
  social_media: [
    {
      title: "Planejamento Estratégico",
      offsetDays: 7,
      tasks: [
        { title: "Definir linha editorial", priority: "high", role: "manager", description: "Definir tom de voz, pilares de conteúdo e calendário" },
        { title: "Criar identidade visual do feed", priority: "high", role: "design", description: "Paleta de cores, tipografia e grid do feed" },
        { title: "Configurar contas e ferramentas", priority: "medium", role: "admin" },
      ],
    },
    {
      title: "Produção de Conteúdo",
      offsetDays: 14,
      tasks: [
        { title: "Criar criativos (artes e vídeos)", priority: "high", role: "design", description: "Pack de criativos para o primeiro mês" },
        { title: "Escrever copies e legendas", priority: "medium", role: "manager", description: "Textos para posts, stories e reels" },
        { title: "Aprovar conteúdo com cliente", priority: "high", role: "manager" },
      ],
    },
    {
      title: "Lançamento e Publicação",
      offsetDays: 21,
      tasks: [
        { title: "Agendar publicações", priority: "medium", role: "manager" },
        { title: "Publicar primeiros posts", priority: "high", role: "manager" },
        { title: "Monitorar engajamento inicial", priority: "medium", role: "manager" },
      ],
    },
    {
      title: "Otimização e Relatório",
      offsetDays: 30,
      tasks: [
        { title: "Analisar métricas de performance", priority: "high", role: "manager" },
        { title: "Subir relatório de resultados", priority: "high", role: "manager" },
        { title: "Propor otimizações", priority: "medium", role: "manager" },
      ],
    },
  ],

  trafego: [
    {
      title: "Setup de Campanhas",
      offsetDays: 5,
      tasks: [
        { title: "Configurar pixel e conversões", priority: "urgent", role: "traffic", description: "Instalar pixel do Meta/Google e configurar eventos" },
        { title: "Criar estrutura de campanhas", priority: "high", role: "traffic", description: "Definir campanhas, conjuntos e segmentações" },
        { title: "Produzir criativos para anúncios", priority: "high", role: "design", description: "Artes e vídeos para os anúncios" },
      ],
    },
    {
      title: "Lançamento de Campanha",
      offsetDays: 10,
      tasks: [
        { title: "Subir campanhas na plataforma", priority: "urgent", role: "traffic" },
        { title: "Configurar públicos e segmentações", priority: "high", role: "traffic" },
        { title: "Revisar landing pages", priority: "high", role: "admin" },
      ],
    },
    {
      title: "Otimização",
      offsetDays: 20,
      tasks: [
        { title: "Analisar performance dos anúncios", priority: "high", role: "traffic" },
        { title: "Subir otimizações de campanha", priority: "high", role: "traffic", description: "Ajustar lances, públicos e criativos" },
        { title: "Trocar criativos com baixo desempenho", priority: "medium", role: "design" },
      ],
    },
    {
      title: "Relatório de Resultados",
      offsetDays: 30,
      tasks: [
        { title: "Compilar dados de performance", priority: "high", role: "traffic" },
        { title: "Subir relatório completo", priority: "high", role: "traffic" },
        { title: "Reunião de alinhamento com cliente", priority: "medium", role: "admin" },
      ],
    },
  ],

  automation: [
    {
      title: "Diagnóstico e Planejamento",
      offsetDays: 7,
      tasks: [
        { title: "Mapear processos atuais do cliente", priority: "high", role: "admin" },
        { title: "Definir fluxos de automação", priority: "high", role: "admin", description: "Quais processos serão automatizados e como" },
        { title: "Selecionar ferramentas e integrações", priority: "medium", role: "admin" },
      ],
    },
    {
      title: "Desenvolvimento",
      offsetDays: 21,
      tasks: [
        { title: "Configurar integrações (APIs, webhooks)", priority: "high", role: "admin" },
        { title: "Construir fluxos de automação", priority: "urgent", role: "admin" },
        { title: "Testes de fluxo", priority: "high", role: "admin" },
      ],
    },
    {
      title: "Deploy e Validação",
      offsetDays: 30,
      tasks: [
        { title: "Deploy em produção", priority: "urgent", role: "admin" },
        { title: "Monitorar automações ativas", priority: "high", role: "admin" },
        { title: "Ajustar e otimizar fluxos", priority: "medium", role: "admin" },
      ],
    },
  ],

  site: [
    {
      title: "Design e Planejamento",
      offsetDays: 10,
      tasks: [
        { title: "Wireframe e estrutura do site", priority: "high", role: "design" },
        { title: "Design visual (UI/UX)", priority: "high", role: "design", description: "Layout completo de todas as páginas" },
        { title: "Aprovar design com cliente", priority: "high", role: "manager" },
      ],
    },
    {
      title: "Desenvolvimento",
      offsetDays: 25,
      tasks: [
        { title: "Desenvolver páginas", priority: "urgent", role: "admin" },
        { title: "Integrar formulários e CTA", priority: "high", role: "admin" },
        { title: "Configurar SEO e analytics", priority: "medium", role: "admin" },
      ],
    },
    {
      title: "Testes e Lançamento",
      offsetDays: 30,
      tasks: [
        { title: "Testes de responsividade", priority: "high", role: "design" },
        { title: "Testes de performance e velocidade", priority: "high", role: "admin" },
        { title: "Deploy e publicação", priority: "urgent", role: "admin" },
      ],
    },
  ],

  landing_page: [
    {
      title: "Briefing e Design",
      offsetDays: 5,
      tasks: [
        { title: "Definir objetivo e CTA da landing", priority: "high", role: "manager" },
        { title: "Criar design da landing page", priority: "high", role: "design" },
        { title: "Aprovar layout com cliente", priority: "high", role: "manager" },
      ],
    },
    {
      title: "Desenvolvimento e Launch",
      offsetDays: 12,
      tasks: [
        { title: "Desenvolver landing page", priority: "urgent", role: "admin" },
        { title: "Configurar tracking e conversões", priority: "high", role: "traffic" },
        { title: "Publicar e testar", priority: "high", role: "admin" },
      ],
    },
  ],

  event: [
    {
      title: "Pré-evento",
      offsetDays: 14,
      tasks: [
        { title: "Criar identidade visual do evento", priority: "high", role: "design" },
        { title: "Desenvolver landing page do evento", priority: "high", role: "admin" },
        { title: "Configurar campanhas de divulgação", priority: "high", role: "traffic" },
        { title: "Preparar materiais gráficos", priority: "medium", role: "design" },
      ],
    },
    {
      title: "Evento",
      offsetDays: 28,
      tasks: [
        { title: "Cobertura em tempo real", priority: "urgent", role: "manager" },
        { title: "Stories e posts ao vivo", priority: "high", role: "manager" },
      ],
    },
    {
      title: "Pós-evento",
      offsetDays: 35,
      tasks: [
        { title: "Relatório de resultados do evento", priority: "high", role: "manager" },
        { title: "Post de agradecimento/recap", priority: "medium", role: "design" },
      ],
    },
  ],

  other: [
    {
      title: "Planejamento",
      offsetDays: 7,
      tasks: [
        { title: "Definir escopo e objetivos", priority: "high", role: "admin" },
        { title: "Montar cronograma", priority: "medium", role: "admin" },
      ],
    },
    {
      title: "Execução",
      offsetDays: 21,
      tasks: [
        { title: "Executar entregas planejadas", priority: "high", role: "admin" },
      ],
    },
    {
      title: "Entrega Final",
      offsetDays: 30,
      tasks: [
        { title: "Validação e entrega ao cliente", priority: "high", role: "admin" },
      ],
    },
  ],
};
