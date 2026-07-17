export const TASK_STATUS_VALUES = [
  "backlog",
  "todo",
  "doing",
  "review",
  "approved",
  "blocked",
  "done",
] as const;

export type McpTaskStatus = (typeof TASK_STATUS_VALUES)[number];

/**
 * `todo` is kept only as a compatibility alias for older MCP clients.
 * The current Aceleriq Kanban stores new work in `backlog`.
 */
export function normalizeTaskStatus(status?: McpTaskStatus): Exclude<McpTaskStatus, "todo"> {
  return status === "todo" || !status ? "backlog" : status;
}

/**
 * PostgREST `.or()` uses commas and parentheses as syntax. Replacing those
 * characters keeps a user supplied search term inside the intended filters.
 */
export function sanitizeProfileSearch(search?: string): string {
  return (search ?? "")
    .trim()
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
