export const TASK_WORKSTREAM_VALUES = [
  "general",
  "design",
  "content",
  "video",
  "traffic",
  "development",
  "operations",
] as const;

export type TaskWorkstream = (typeof TASK_WORKSTREAM_VALUES)[number];

export const TASK_WORKSTREAM_LABELS: Record<TaskWorkstream, string> = {
  general: "Geral",
  design: "Design",
  content: "Conteúdo",
  video: "Vídeo",
  traffic: "Tráfego",
  development: "Desenvolvimento",
  operations: "Operações",
};

export const TASK_WORKSTREAM_OPTIONS = TASK_WORKSTREAM_VALUES.map((value) => ({
  value,
  label: TASK_WORKSTREAM_LABELS[value],
}));

interface EditorialTaskCandidate {
  workstream?: string | null;
  assigned_to?: string | null;
  source?: string | null;
  title?: string | null;
  description?: string | null;
}

const CLIENT_REQUEST_SOURCE_PREFIX = "client_request:";
const EXPLICIT_EDITORIAL_WORKSTREAMS = new Set([
  "design",
  "content",
  "video",
]);
const EXPLICIT_NON_EDITORIAL_WORKSTREAMS = new Set([
  "traffic",
  "development",
  "operations",
]);
const STRONG_EDITORIAL_SIGNALS = [
  /\bcarross(?:el|eis)\b/,
  /\b(?:post|posts|reel|reels|story|stories|feed)\b/,
  /\b(?:criativo|criativos|arte|artes)\b/,
  /\b(?:conteudo|conteudos)\b/,
  /\b(?:video|videos)\b/,
  /\b(?:identidade visual|direcao de arte|peca grafica|pecas graficas|social media|motion design)\b/,
] as const;

export type CanonicalTaskStatus =
  | "backlog"
  | "doing"
  | "review"
  | "done"
  | "blocked";

export type EditorialProductionStage = "draft" | "production" | "ready";

function normalizeSearchText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasStrongEditorialSignal(task: EditorialTaskCandidate) {
  const source = task.source?.toLocaleLowerCase("pt-BR") || "";
  if (
    /^orion_.*(?:carrossel|reels?|criativos?|conteudo|videos?)/.test(
      source,
    )
  ) {
    return true;
  }
  const text = normalizeSearchText(
    [task.title, task.description].filter(Boolean).join(" "),
  );
  return STRONG_EDITORIAL_SIGNALS.some((signal) => signal.test(text));
}

export function isEditorialTask(
  task: EditorialTaskCandidate,
  designMemberIds: ReadonlySet<string>,
) {
  if (
    task.source
      ?.toLocaleLowerCase("pt-BR")
      .startsWith(CLIENT_REQUEST_SOURCE_PREFIX)
  ) {
    return false;
  }

  const workstream = task.workstream?.toLocaleLowerCase("pt-BR");
  if (workstream && EXPLICIT_EDITORIAL_WORKSTREAMS.has(workstream)) {
    return true;
  }
  if (workstream && EXPLICIT_NON_EDITORIAL_WORKSTREAMS.has(workstream)) {
    return false;
  }
  if (workstream && workstream !== "general") {
    return false;
  }

  return Boolean(
    (task.assigned_to && designMemberIds.has(task.assigned_to)) ||
      hasStrongEditorialSignal(task),
  );
}

export const isDesignTask = isEditorialTask;

export function canonicalTaskStatus(
  status?: string | null,
): CanonicalTaskStatus | null {
  switch (status) {
    case "backlog":
    case "todo":
      return "backlog";
    case "doing":
    case "in_progress":
    case "blocked":
      return "doing";
    case "review":
    case "approved":
      return "review";
    case "done":
      return status;
    default:
      return null;
  }
}

export function editorialStageForTaskStatus(
  status?: string | null,
): EditorialProductionStage | null {
  switch (canonicalTaskStatus(status)) {
    case "backlog":
      return "draft";
    case "doing":
      return "production";
    case "review":
      return "ready";
    default:
      return null;
  }
}

export function kanbanStatusForEditorialStage(
  stage?: string | null,
): CanonicalTaskStatus | null {
  switch (stage) {
    case "draft":
      return "backlog";
    case "production":
      return "doing";
    case "ready":
      return "review";
    default:
      return null;
  }
}
