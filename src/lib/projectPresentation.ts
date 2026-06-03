import { parseAppDate, todayBR, toBRDateKey } from "@/lib/dateBR";

type PlanLike = { milestones?: { title: string; offsetDays?: number; tasks?: { title: string; description?: string }[] }[] } | null;

const TYPE_SCOPE: Record<string, string> = {
  trafego: "Gestão de tráfego pago com estruturação de campanhas, acompanhamento de performance, otimizações recorrentes e leitura dos indicadores principais do cliente.",
  social_media: "Gestão de presença digital com planejamento editorial, criação de conteúdos, organização de calendário, produção de peças e acompanhamento de evolução da comunicação.",
  video: "Produção audiovisual com planejamento de roteiro, organização de produção, captação, edição, revisão e entrega dos cortes finais nos formatos definidos.",
  video_ai: "Produção de vídeos generativos com roteiro, direção visual, criação de cenas, edição, ajustes de consistência, legendas, identidade visual e entrega dos formatos combinados.",
  site: "Desenvolvimento de site com arquitetura de conteúdo, design, implementação responsiva, integrações essenciais, testes de performance e publicação.",
  landing_page: "Landing page orientada à conversão com copy, estrutura visual, implementação responsiva, rastreamento e revisão final.",
  automation: "Automação de processos com mapeamento do fluxo, integração entre ferramentas, testes, validação e documentação operacional.",
  event: "Planejamento e execução de entregas ligadas ao evento, com organização de etapas, materiais, divulgação e acompanhamento até a conclusão.",
  other: "Projeto sob demanda com escopo organizado em etapas claras, entregas acompanháveis e validação progressiva.",
};

export function addDaysBR(days: number, baseKey: string = todayBR()) {
  const d = parseAppDate(baseKey) || new Date();
  d.setDate(d.getDate() + days);
  return toBRDateKey(d);
}

export function sanitizeClientText(input?: string | null) {
  if (!input) return "";
  return input
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/`+/g, "")
    .replace(/\[(AJUSTE|ANEXO|DOCUMENTO)[^\]]*\]/gi, "")
    .split("\n")
    .map((line) => line.trim().replace(/^[•*\-–—]\s*/, ""))
    .filter((line) => line && !/^(contexto da ia|direcionamento do admin|base contratual|prompt|instrução interna)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TYPE_INTRO: Record<string, string> = {
  trafego: "Operação estratégica de tráfego pago organizada em ciclos de estruturação, leitura de performance e otimização contínua, com foco em previsibilidade de resultado.",
  social_media: "Presença digital conduzida de forma estratégica, com planejamento editorial, produção consistente e leitura periódica do que gera mais conexão com a audiência.",
  video: "Produção audiovisual estruturada por etapas claras de roteiro, captação, edição e entrega — garantindo consistência criativa e qualidade técnica em cada corte.",
  video_ai: "Produção de vídeos com IA orientada por roteiro, direção visual e refinamento de consistência, entregando peças prontas para distribuição com identidade preservada.",
  site: "Desenvolvimento do site organizado em fases de arquitetura, design, implementação e publicação, priorizando performance, clareza e experiência do visitante.",
  landing_page: "Landing page construída em ciclos de copy, design e otimização orientados à conversão, com rastreamento e revisão antes da publicação.",
  automation: "Automação implementada em etapas de mapeamento, integração e validação, reduzindo trabalho manual e dando previsibilidade ao fluxo operacional.",
  event: "Operação do evento conduzida em frentes de planejamento, produção e ativação, mantendo cada entrega alinhada à data e ao objetivo da ação.",
  other: "Projeto conduzido em etapas claras de planejamento, execução, revisão e entrega, com visibilidade contínua do andamento.",
};

export function buildClientProjectFields(opts: {
  type?: string;
  clientName?: string;
  /** Internal admin/AI notes — NEVER shown to client. Kept for signature compatibility. */
  narrative?: string | null;
  plan?: PlanLike;
}) {
  const plan = opts.plan?.milestones || [];
  const taskTotal = plan.reduce((sum, m) => sum + (m.tasks?.length || 0), 0);
  const scope = TYPE_SCOPE[opts.type || "other"] || TYPE_SCOPE.other;
  const intro = TYPE_INTRO[opts.type || "other"] || TYPE_INTRO.other;
  const structure = plan.length
    ? `A entrega está organizada em ${plan.length} etapa${plan.length > 1 ? "s" : ""} e ${taskTotal} tarefa${taskTotal > 1 ? "s" : ""}, cada uma com prazo e validação antes do avanço.`
    : "A entrega será conduzida por etapas sequenciais com validação antes de cada avanço.";

  const objectives = [
    "Manter o escopo organizado em etapas claras e acompanháveis.",
    "Dar visibilidade contínua sobre prazos, produção e entregas.",
    "Garantir qualidade e revisão antes de cada entrega ir ao ar.",
  ];

  return {
    description: sanitizeClientText(`Visão geral\n${intro}\n\nEscopo contratado\n${scope}\n\nEstrutura de trabalho\n${structure}`),
    scope,
    objectives: objectives.join("\n"),
  };
}


export function summarizeProjectText(text?: string | null) {
  const cleaned = sanitizeClientText(text);
  return cleaned
    .split(/\n+/)
    .filter((line) => !/^(visão geral|escopo contratado|estrutura de trabalho|objetivos)$/i.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseClientProjectSections(text?: string | null) {
  const cleaned = sanitizeClientText(text);
  if (!cleaned) return [] as { title: string; body: string[] }[];
  const headings = /^(visão geral|escopo contratado|estrutura de trabalho|objetivos|escopo)$/i;
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } = { title: "Visão geral", body: [] };
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (headings.test(trimmed)) {
      if (current.body.length) sections.push(current);
      current = { title: trimmed, body: [] };
    } else {
      current.body.push(trimmed);
    }
  }
  if (current.body.length) sections.push(current);
  return sections;
}