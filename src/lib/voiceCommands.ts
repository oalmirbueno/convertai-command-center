// Rule-based natural language parser (pt-BR) for the Voice Assistant.
// No external AI. Heuristics + keyword matching.

export type ParsedIntent =
  | { kind: "create_project"; clientHint?: string; name: string; type?: string; deadlineDays?: number }
  | { kind: "create_task"; title: string; projectHint?: string; clientHint?: string; status?: string; priority?: string }
  | { kind: "create_milestone"; title: string; projectHint?: string; clientHint?: string; days?: number }
  | { kind: "update_task_status"; taskHint: string; status: string; clientHint?: string; projectHint?: string }
  | { kind: "report_pending"; clientHint?: string }
  | { kind: "report_overview"; clientHint?: string }
  | { kind: "upload_file"; clientHint?: string; projectHint?: string; folder?: string }
  | { kind: "unknown"; raw: string };

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const STATUS_MAP: Record<string, string> = {
  backlog: "backlog",
  pendente: "backlog",
  "a fazer": "backlog",
  "to do": "backlog",
  fazendo: "doing",
  "em andamento": "doing",
  doing: "doing",
  revisao: "review",
  revisar: "review",
  review: "review",
  concluida: "done",
  concluido: "done",
  feita: "done",
  feito: "done",
  pronto: "done",
  done: "done",
};

function extractStatus(t: string): string | undefined {
  const n = norm(t);
  for (const k of Object.keys(STATUS_MAP)) {
    if (n.includes(k)) return STATUS_MAP[k];
  }
  return undefined;
}

function afterKeyword(text: string, keywords: string[]): string | undefined {
  const n = norm(text);
  for (const k of keywords) {
    const idx = n.indexOf(k);
    if (idx >= 0) {
      const rest = text.slice(idx + k.length).trim();
      // stop at conjunctions
      const stop = rest.search(/\b(para|do cliente|no projeto|na milestone|com prazo|em|status|prioridade)\b/i);
      return (stop > 0 ? rest.slice(0, stop) : rest).replace(/^[:\-,\s"]+|[.\s,"]+$/g, "");
    }
  }
  return undefined;
}

function extractClient(text: string): string | undefined {
  const m = text.match(/(?:cliente|para o cliente|do cliente|para|pro|pra)\s+([^.,\n]+?)(?=\s+(?:no projeto|com|criar|crie|fazer|faz|status|prioridade|relat|tarefa|milestone|projeto|prazo|$|\.|,))/i);
  return m?.[1]?.trim();
}

function extractProject(text: string): string | undefined {
  const m = text.match(/(?:no projeto|projeto)\s+([^.,\n]+?)(?=\s+(?:para|do cliente|com|status|prioridade|$|\.|,))/i);
  return m?.[1]?.trim();
}

function extractDays(text: string): number | undefined {
  const m = text.match(/(\d+)\s*dias?/i);
  if (m) return parseInt(m[1], 10);
  if (/uma\s+semana/i.test(text)) return 7;
  if (/duas\s+semanas/i.test(text)) return 14;
  if (/um\s+m[eê]s/i.test(text)) return 30;
  return undefined;
}

// Loose verb regex – matches conjugations: criar/crie/cria/criou,
// fazer/faz/faça/faca, montar/monta/monte, gerar/gera/gere, abrir/abre,
// cadastrar/cadastra, adicionar/adiciona, novo/nova, bota/coloca/põe.
const VERB_CREATE = /(cri[ae]r?|crio[u]?|fa[czç]a?|fazer|montar?|mont[ea]|gerar?|ger[ea]|abr[ie]r?|cadastr[ae]r?|adicion[ae]r?|nova?|novo|bota|coloca|p[oõ]e)/i;
const VERB_MOVE = /(avan[cç]ar|conclu[ií]r?|marca?r?|mover?|mov[ae]|finaliz[ae]r?|termin[ae]r?|passa)/i;

export function parseCommand(input: string): ParsedIntent {
  const text = input.trim();
  if (!text) return { kind: "unknown", raw: text };
  const n = norm(text);

  // Reports
  if (/\b(relat[oó]rio|pendente|pendencias|o que falta|status\b|resumo)\b/i.test(text)) {
    const clientHint = extractClient(text);
    if (/pendente|pendencias|falta|aberta/i.test(text)) {
      return { kind: "report_pending", clientHint };
    }
    return { kind: "report_overview", clientHint };
  }

  // Update task status
  if ((new RegExp(`${VERB_MOVE.source}\\s+(a\\s+)?tarefa`, "i")).test(text) ||
      /tarefa\s+.*\b(foi feita|conclu[ií]da|pronto|feita|feito|done)\b/i.test(text)) {
    const status = extractStatus(text) || "done";
    const m = text.match(/tarefa\s+([^.,\n]+?)(?=\s+(?:no projeto|do cliente|para|foi|esta|com|status|$|\.|,))/i);
    return {
      kind: "update_task_status",
      taskHint: (m?.[1] || "").trim(),
      status,
      clientHint: extractClient(text),
      projectHint: extractProject(text),
    };
  }

  // Create milestone
  if ((new RegExp(`${VERB_CREATE.source}\\s+(uma?\\s+)?(milestone|marco|etapa)`, "i")).test(text)) {
    const title =
      afterKeyword(text, ["milestone ", "marco ", "etapa "]) ||
      afterKeyword(text, ["chamada ", "chamado ", "com nome "]) || "";
    return {
      kind: "create_milestone",
      title: title || "Nova etapa",
      projectHint: extractProject(text),
      clientHint: extractClient(text),
      days: extractDays(text) ?? 14,
    };
  }

  // Create task
  if ((new RegExp(`${VERB_CREATE.source}\\s+(uma?\\s+)?tarefa`, "i")).test(text)) {
    const title =
      afterKeyword(text, ["tarefa ", "chamada ", "chamado ", "com nome ", "intitulada "]) || "";
    return {
      kind: "create_task",
      title: title.replace(/^(de\s+|para\s+)/i, "") || "Nova tarefa",
      projectHint: extractProject(text),
      clientHint: extractClient(text),
      status: extractStatus(text),
      priority: /alta\s+prioridade|urgente/i.test(text) ? "high" : /baixa\s+prioridade/i.test(text) ? "low" : undefined,
    };
  }

  // Create project (explicit verb + projeto)
  const projectExplicit = (new RegExp(`${VERB_CREATE.source}\\s+(o\\s+|um\\s+)?projeto`, "i")).test(text);
  // Fallback: mentions "projeto" + a "pro/para CLIENTE" hint, even without verb
  const projectImplicit = /\bprojeto\b/i.test(text) && /\b(pro|para|do|da)\s+\S+/i.test(text);
  if (projectExplicit || projectImplicit) {
    const name =
      afterKeyword(text, ["projeto ", "chamado ", "chamada ", "com nome "]) || "Novo projeto";
    // Detecta vídeo IA antes de vídeo normal (IA / inteligência artificial / Runway / Sora / Veo / Heygen).
    const isVideoAI = /\b(v[ií]deo[s]?\s+(com\s+|de\s+|por\s+)?(ia|i\.a\.|inteligencia\s+artificial)|ia\s+video|ai\s+video|runway|sora|veo|heygen|pika|kling|generat[ei]va?\s+de\s+v[ií]deo)\b/i.test(text);
    const type = isVideoAI ? "video_ai"
      : /tr[aá]fego|ads/i.test(text) ? "trafego"
      : /v[ií]deo|edi[cç][aã]o|reels|youtube|youtub|tiktok/i.test(text) ? "video"
      : /site|landing|web/i.test(text) ? "site"
      : /social|conte[uú]do/i.test(text) ? "social_media" : "other";
    return {
      kind: "create_project",
      name: name.replace(/^(de\s+|para\s+|do\s+|da\s+)/i, ""),
      clientHint: extractClient(text),
      type,
      deadlineDays: extractDays(text) ?? 30,
    };
  }

  // Upload file
  if ((new RegExp(`(enviar|subir|upload|anexar|carregar|sob[ie]r?)\\s+(o\\s+)?(arquivo|documento|contrato|relat[oó]rio|material)`, "i")).test(text)) {
    const folder = /contrato/i.test(text) ? "contratos" : /relat[oó]rio/i.test(text) ? "relatorios" : /estrat[eé]gico/i.test(text) ? "estrategicos" : /grafico|criativo/i.test(text) ? "graficos" : "operacionais";
    return { kind: "upload_file", clientHint: extractClient(text), projectHint: extractProject(text), folder };
  }

  return { kind: "unknown", raw: text };
}

export function summarizeIntent(intent: ParsedIntent): string {
  switch (intent.kind) {
    case "create_project":
      return `Criar projeto "${intent.name}"${intent.clientHint ? ` para ${intent.clientHint}` : ""} (${intent.type}, ${intent.deadlineDays}d)`;
    case "create_task":
      return `Criar tarefa "${intent.title}"${intent.projectHint ? ` no projeto ${intent.projectHint}` : intent.clientHint ? ` para ${intent.clientHint}` : ""}${intent.status ? ` [${intent.status}]` : ""}`;
    case "create_milestone":
      return `Criar etapa "${intent.title}"${intent.projectHint ? ` no projeto ${intent.projectHint}` : ""} (${intent.days}d)`;
    case "update_task_status":
      return `Atualizar tarefa "${intent.taskHint}" → ${intent.status}`;
    case "report_pending":
      return `Relatório de tarefas pendentes${intent.clientHint ? ` — ${intent.clientHint}` : ""}`;
    case "report_overview":
      return `Resumo de projetos${intent.clientHint ? ` — ${intent.clientHint}` : ""}`;
    case "upload_file":
      return `Anexar arquivo${intent.folder ? ` em ${intent.folder}` : ""}${intent.clientHint ? ` (${intent.clientHint})` : ""}`;
    default:
      return "Comando não reconhecido";
  }
}
