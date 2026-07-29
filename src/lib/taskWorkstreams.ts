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

interface DesignTaskCandidate {
  workstream?: string | null;
  assigned_to?: string | null;
  source?: string | null;
}

const CLIENT_REQUEST_SOURCE_PREFIX = "client_request:";

export function isDesignTask(
  task: DesignTaskCandidate,
  designMemberIds: ReadonlySet<string>,
) {
  if (task.source?.startsWith(CLIENT_REQUEST_SOURCE_PREFIX)) return false;

  if (task.workstream !== null && task.workstream !== undefined) {
    return task.workstream === "design";
  }

  return Boolean(
    task.assigned_to && designMemberIds.has(task.assigned_to),
  );
}
