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

export function buildClientProjectFields(opts: {
  type?: string;
  clientName?: string;
  narrative?: string | null;
  plan?: PlanLike;
}) {
  const plan = opts.plan?.milestones || [];
  const taskTotal = plan.reduce((sum, m) => sum + (m.tasks?.length || 0), 0);
  const narrative = sanitizeClientText(opts.narrative);
  const scope = TYPE_SCOPE[opts.type || "other"] || TYPE_SCOPE.other;
  const intro = narrative || `Projeto estruturado para ${opts.clientName || "o cliente"}, com escopo organizado em etapas acompanháveis e entregas revisadas antes da conclusão.`;
  const structure = plan.length
    ? `A operação está organizada em ${plan.length} etapa${plan.length > 1 ? "s" : ""} e ${taskTotal} tarefa${taskTotal > 1 ? "s" : ""}, com acompanhamento por status, prazo e validação de entrega.`
    : "A operação será conduzida por etapas de planejamento, execução, revisão e entrega, mantendo visibilidade clara do andamento.";

  const objectives = [
    "Organizar o escopo em etapas claras e acompanháveis.",
    "Dar visibilidade ao cliente sobre prazos, produção e entregas.",
    "Manter qualidade, consistência e revisão antes de cada entrega.",
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