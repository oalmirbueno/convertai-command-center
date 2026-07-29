import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/pages/EditorialCalendar.tsx");
const hook = read("src/hooks/useEditorialCalendar.ts");
const editor = read("src/components/editorial/EditorialEditor.tsx");
const inbox = read(
  "src/components/editorial/EditorialTaskInbox.tsx",
);
const layout = read("src/components/AppLayout.tsx");
const syncMigration = read(
  "supabase/migrations/20260728235000_sync_editorial_tasks_bidirectionally.sql",
);
const workstreamMigration = read(
  "supabase/migrations/20260728234519_add_task_workstreams.sql",
);

describe("editorial design task workspace contract", () => {
  it("uses an explicit task workstream instead of title heuristics", () => {
    expect(workstreamMigration).toContain(
      "ADD COLUMN workstream text NOT NULL DEFAULT 'general'",
    );
    expect(workstreamMigration).toContain("'design'");
    expect(page).toContain("isDesignTask(task, designMemberIds)");
    expect(page).not.toMatch(/carrossel|criativo|thumbnail/i);
  });

  it("keeps client and project filters shared with the task tray", () => {
    expect(page).toContain(
      'searchParams.get("tasks") === "all" ? "all" : "design"',
    );
    expect(page).toContain("project.client_id !== forcedClientId");
    expect(page).toContain("task.project_id !== projectId");
    expect(inbox).toContain("Vêm do Kanban central");
    expect(inbox).toContain("projectScopeNames");
    expect(inbox).toContain("Criar conteúdo");
  });

  it("does not compress the calendar with a permanent side rail", () => {
    expect(page).not.toContain(
      "xl:grid-cols-[minmax(0,1fr)_300px]",
    );
    expect(layout).toContain(
      'location.pathname === "/calendario"\n            ? "max-w-[1400px]"',
    );
    expect(inbox).toContain("overflow-x-auto");
  });

  it("uses a centered editor and keeps the existing upload route guarded", () => {
    expect(editor).toContain("<Dialog open={open}");
    expect(editor).toContain("max-w-5xl");
    expect(editor).not.toContain("<Sheet open={open}");
    expect(editor).toContain('folder: "criativos"');
    expect(editor).toContain('"noopener,noreferrer"');
    expect(editor).toContain(
      'window.addEventListener("focus", refreshOptionsOnFocus)',
    );
  });

  it("keeps task scope and content format explicit in the editor", () => {
    expect(page).toContain('allowAllTasks={taskScope === "all"}');
    expect(editor).toContain(
      "(allowAllTasks || isDesignTask(task, designIds))",
    );
    expect(editor).not.toContain("setContentType(nextContentType)");
    expect(page).not.toContain('"responsible",\n      "tasks"');
  });
});

describe("editorial and Kanban bidirectional sync contract", () => {
  it("maps production stages to the existing Kanban columns", () => {
    expect(syncMigration).toContain(
      "WHEN 'draft' THEN 'backlog'",
    );
    expect(syncMigration).toContain(
      "WHEN 'production' THEN 'doing'",
    );
    expect(syncMigration).toContain(
      "WHEN 'ready' THEN",
    );
    expect(syncMigration).toContain(
      "WHEN 'review' THEN 'ready'",
    );
  });

  it("selects the active terminal revision from its causal chain", () => {
    expect(syncMigration).toContain(
      "editorial_current_post_id_for_task",
    );
    expect(syncMigration).toContain(
      "post.production_status IN ('draft', 'production', 'ready')",
    );
    expect(syncMigration).toContain(
      "child_internal.revision_of_post_id = post.id",
    );
    expect(syncMigration).toContain("HAVING count(*) > 1");
  });

  it("serializes both public RPCs and direct status writes before row locks", () => {
    expect(syncMigration).toContain(
      "pg_catalog.pg_advisory_xact_lock",
    );
    expect(syncMigration).toContain(
      "save_editorial_post_unlocked",
    );
    expect(syncMigration).toContain(
      "transition_editorial_publication_unlocked",
    );
    expect(syncMigration).toContain(
      "archive_editorial_post_unlocked",
    );
    expect(syncMigration).toContain("FOR EACH STATEMENT");
  });

  it("marks the task done only after every active publication is published", () => {
    expect(syncMigration).toContain(
      "publication.status NOT IN ('published', 'cancelled')",
    );
    expect(syncMigration).toContain(
      "editorial_prevent_premature_task_completion",
    );
    expect(syncMigration).toContain(
      "O conteúdo vinculado precisa estar publicado antes de concluir a tarefa.",
    );
    expect(syncMigration).toContain(
      "_canonical_task_status IS DISTINCT FROM 'done'",
    );
  });

  it("does not move scheduled or terminal publication plans backwards", () => {
    expect(syncMigration).toContain(
      "publication.status NOT IN ('planned', 'cancelled')",
    );
    expect(syncMigration).toContain(
      "Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.",
    );
  });

  it("keeps one active editorial chain per task", () => {
    expect(syncMigration).toContain("editorial_task_link_guard");
    expect(syncMigration).toContain(
      "A revisão editorial precisa manter a tarefa de origem.",
    );
    expect(syncMigration).toContain(
      "A revisão de origem não é mais a revisão atual.",
    );
    expect(syncMigration).toContain(
      "A tarefa já possui um conteúdo editorial ativo.",
    );
  });

  it("keeps client-request tasks outside the editorial synchronizer", () => {
    expect(syncMigration.match(/client_request:/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(syncMigration).toContain(
      "Tarefas originadas de pedidos não podem ser vinculadas ao editorial.",
    );
  });

  it("records Kanban-originated editorial stage changes", () => {
    expect(syncMigration).toContain(
      "'production_status_synced_from_task'",
    );
    expect(syncMigration).toContain("'source', 'kanban'");
    expect(syncMigration).toContain("'task_status_before', OLD.status");
    expect(syncMigration).toContain("'task_status_after', NEW.status");
  });

  it("refreshes both query families after editorial mutations", () => {
    expect(hook).toContain(
      'queryClient.invalidateQueries({ queryKey: ["tasks"] })',
    );
    expect(hook).toContain(
      'queryKey: ["editorial-linked-task-ids"]',
    );
    expect(hook).toContain(
      'table: "tasks"',
    );
  });

  it("releases tasks linked only to cancelled or archived content", () => {
    expect(hook).toContain(
      '.in("production_status", ["draft", "production", "ready"])',
    );
    expect(hook).toContain('.is("archived_at", null)');
  });

  it("reconciles existing active links when the migration is applied", () => {
    expect(syncMigration).toContain(
      "PERFORM public.editorial_sync_task_for_post(_post_id)",
    );
    expect(syncMigration).toContain("SELECT DISTINCT internal.task_id");
  });
});
