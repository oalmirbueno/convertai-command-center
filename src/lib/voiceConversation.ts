// Conversational state machine helpers for the VoiceAssistant.
// Detects gaps in a parsed intent and produces suggestions (project name, deadline, type).

import type { ParsedIntent } from "./voiceCommands";
import { buildClientProjectFields, addDaysBR } from "@/lib/projectPresentation";
import { formatBRDate } from "@/lib/dateBR";

export type Clarification =
  | { id: "client"; label: string; suggestion?: string }
  | { id: "project"; label: string; suggestion?: string }
  | { id: "project_name"; label: string; suggestion: string }
  | { id: "project_type"; label: string; options: { value: string; label: string }[]; suggestion?: string }
  | { id: "deadline"; label: string; options: { value: number; label: string }[]; suggestion?: number }
  | { id: "task_title"; label: string; suggestion?: string }
  | { id: "milestone_title"; label: string; suggestion?: string }
  | { id: "apply_template"; label: string; suggestion: boolean };

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const TYPE_LABELS: Record<string, string> = {
  trafego: "Tráfego Pago",
  social_media: "Social Media",
  video: "Vídeo (captação)",
  video_ai: "Vídeo IA",
  site: "Site",
  landing_page: "Landing Page",
  automation: "Automação",
  event: "Evento",
  other: "Outro",
};

const DEFAULT_DEADLINE: Record<string, number> = {
  trafego: 30,
  social_media: 30,
  video: 30,
  video_ai: 21,
  site: 45,
  landing_page: 14,
  automation: 21,
  event: 30,
  other: 30,
};

export function suggestProjectName(opts: {
  type?: string;
  clientName?: string;
  rawHint?: string;
}): string {
  return suggestProjectNames(opts)[0];
}

// Múltiplas sugestões criativas — viram chips clicáveis no clarify.
export function suggestProjectNames(opts: {
  type?: string;
  clientName?: string;
  rawHint?: string;
}): string[] {
  const { type, clientName, rawHint } = opts;
  const now = new Date();
  const monthYear = `${MONTHS_PT[now.getMonth()]}/${String(now.getFullYear()).slice(-2)}`;
  const quarter = `Q${Math.floor(now.getMonth() / 3) + 1}/${now.getFullYear()}`;
  const label = TYPE_LABELS[type || "other"] || "Projeto";
  const cli = clientName?.trim();
  const hint = rawHint && rawHint.length > 2 && !/novo projeto/i.test(rawHint) ? rawHint.trim() : "";

  const cycleByType: Record<string, string[]> = {
    trafego: ["Aceleração", "Performance", "Escala", "Captação"],
    social_media: ["Presença", "Conteúdo", "Engajamento", "Editorial"],
    video: ["Produção", "Cobertura", "Storytelling", "Branded Content"],
    video_ai: ["Vídeo IA", "AI Reels", "Generativo", "AI Storytelling"],
    site: ["Plataforma", "Reposicionamento", "Redesign", "Institucional"],
    landing_page: ["Conversão", "Captura", "Lançamento", "Oferta"],
    automation: ["Automação", "Workflow", "Integração", "Operação"],
    event: ["Evento", "Ativação", "Cobertura", "Lançamento"],
    other: ["Projeto", "Iniciativa", "Operação", "Sprint"],
  };
  const cycle = cycleByType[type || "other"] || cycleByType.other;

  const out = new Set<string>();
  if (hint && cli) out.add(`${hint} — ${cli}`);
  if (hint) out.add(hint);
  if (cli) {
    out.add(`${label} — ${cli} — ${monthYear}`);
    out.add(`${cycle[0]} ${cli} — ${monthYear}`);
    out.add(`${cli} ${cycle[1]} ${quarter}`);
    out.add(`${cycle[2]} ${cli}`);
  } else {
    out.add(`${label} — ${monthYear}`);
    out.add(`${cycle[0]} ${monthYear}`);
    out.add(`${cycle[1]} ${quarter}`);
  }
  return Array.from(out).slice(0, 5);
}

export function suggestDeadline(type?: string): number {
  return DEFAULT_DEADLINE[type || "other"] || 30;
}

export function defaultProjectDescription(
  type?: string,
  clientName?: string,
  enrichment?: {
    narrative?: string | null;
    contractName?: string | null;
    plan?: { milestones: { title: string; offsetDays: number; tasks: { title: string }[] }[] } | null;
    rawHint?: string | null;
  },
): string {
  return buildClientProjectFields({ type, clientName, narrative: enrichment?.narrative, plan: enrichment?.plan }).description;
}

export function gapsForIntent(
  intent: ParsedIntent,
  ctx: { clientName?: string },
): Clarification[] {
  const gaps: Clarification[] = [];
  if (intent.kind === "create_project") {
    if (!intent.clientHint) {
      gaps.push({ id: "client", label: "Para qual cliente?" });
    }
    const typeSuggestion = intent.type || "other";
    gaps.push({
      id: "project_type",
      label: "Tipo de projeto:",
      suggestion: typeSuggestion,
      options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
    });
    gaps.push({
      id: "project_name",
      label: "Nome sugerido:",
      suggestion: suggestProjectName({
        type: typeSuggestion,
        clientName: ctx.clientName,
        rawHint: intent.name,
      }),
    });
    gaps.push({
      id: "deadline",
      label: "Prazo:",
      suggestion: intent.deadlineDays ?? suggestDeadline(typeSuggestion),
      options: [
        { value: 14, label: "14 dias" },
        { value: 30, label: "30 dias" },
        { value: 45, label: "45 dias" },
        { value: 60, label: "60 dias" },
      ],
    });
    gaps.push({
      id: "apply_template",
      label: "Aplicar template de milestones e tarefas?",
      suggestion: true,
    });
  }
  if (intent.kind === "create_task") {
    if (!intent.projectHint && !intent.clientHint) {
      gaps.push({ id: "client", label: "Para qual cliente?" });
    }
    if (intent.title === "Nova tarefa" || !intent.title) {
      gaps.push({ id: "task_title", label: "Título da tarefa:", suggestion: intent.title });
    }
  }
  if (intent.kind === "create_milestone") {
    if (!intent.projectHint && !intent.clientHint) {
      gaps.push({ id: "client", label: "Para qual cliente?" });
    }
    if (!intent.title || intent.title === "Nova etapa") {
      gaps.push({ id: "milestone_title", label: "Nome da etapa:", suggestion: intent.title });
    }
  }
  return gaps;
}

export function formatScopePreview(
  answers: Record<string, any>,
  clientName?: string,
  enrichment?: Parameters<typeof defaultProjectDescription>[2],
) {
  const endKey = addDaysBR(answers.deadline || 30);
  return {
    startDate: formatBRDate(addDaysBR(0)),
    endDate: formatBRDate(endKey),
    description: defaultProjectDescription(answers.project_type, clientName, enrichment),
  };
}
