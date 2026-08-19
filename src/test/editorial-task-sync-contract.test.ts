import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/pages/EditorialCalendar.tsx");
const hook = read("src/hooks/useEditorialCalendar.ts");
const supabaseDataHook = read("src/hooks/useSupabaseData.ts");
const editor = read("src/components/editorial/EditorialEditor.tsx");
const taskModal = read("src/components/admin/CreateTaskModal.tsx");
const inbox = read(
  "src/components/editorial/EditorialTaskInbox.tsx",
);
const views = read(
  "src/components/editorial/EditorialCalendarViews.tsx",
);
const workstreams = read("src/lib/taskWorkstreams.ts");
const deliveryTypes = read("src/lib/taskDeliveryTypes.ts");
const taskLinks = read("src/lib/editorialTaskLinks.ts");
const layout = read("src/components/AppLayout.tsx");
const syncMigration = read(
  "supabase/migrations/20260728235000_sync_editorial_tasks_bidirectionally.sql",
);
const workstreamMigration = read(
  "supabase/migrations/20260728234519_add_task_workstreams.sql",
);
const deliveryTypeMigration = read(
  "supabase/migrations/20260729144624_add_task_delivery_type.sql",
);

describe("editorial design task workspace contract", () => {
  it("keeps area and delivery type as separate task dimensions", () => {
    expect(workstreamMigration).toContain(
      "ADD COLUMN workstream text NOT NULL DEFAULT 'general'",
    );
    expect(deliveryTypeMigration).toContain(
      "ADD COLUMN delivery_type text NOT NULL DEFAULT 'unspecified'",
    );
    expect(workstreamMigration).toContain("'design'");
    expect(deliveryTypes).toContain("PUBLISHABLE_DELIVERY_TYPES");
    expect(deliveryTypes).toContain("isPublishableTask");
    expect(workstreams).toContain("EXPLICIT_EDITORIAL_WORKSTREAMS");
    expect(workstreams).toContain("EXPLICIT_NON_EDITORIAL_WORKSTREAMS");
    expect(workstreams).toContain("hasStrongEditorialSignal(task)");
    expect(workstreams).toContain("CLIENT_REQUEST_SOURCE_PREFIX");
  });

  it("keeps client and project filters shared with publishable tasks", () => {
    expect(page).toContain("project.client_id !== forcedClientId");
    expect(page).toContain("task.project_id !== projectId");
    expect(page).toContain("Fluxo editorial completo");
    expect(views).toContain("projectScopeNames");
    expect(views).toContain("Abrir ou preparar");
  });

  it("paginates tasks with an immutable cursor and deduplicates the result", () => {
    expect(supabaseDataHook).toContain("const TASK_PAGE_SIZE = 1_000");
    expect(supabaseDataHook).toContain('.order("id", { ascending: true })');
    expect(supabaseDataHook).toContain('.gt("id", afterId)');
    expect(supabaseDataHook).toMatch(/new Map<\s*string/);
    expect(supabaseDataHook).toContain("tasksById.set(task.id, task)");
    expect(supabaseDataHook).toContain("options.enabled ?? true");
  });

  it("does not compress the calendar with a permanent side rail", () => {
    expect(page).not.toContain(
      "xl:grid-cols-[minmax(0,1fr)_300px]",
    );
    expect(layout).toContain(
      'location.pathname === "/calendario"\n            ? "max-w-[1400px]"',
    );
    expect(page).not.toContain("<EditorialTaskInbox");
    expect(views).toContain(
      // Cinco colunas desde que "Programado" entrou no kanban editorial
      // (b85a042). O que este teste guarda é o calendário ocupando a largura
      // toda, sem barra lateral fixa — não o número de colunas em si.
      'className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5"',
    );
    expect(views).not.toContain("min-w-[1120px]");
    expect(views).not.toContain("w-[286px]");
  });

  it("keeps filter refreshes and selectable cards visually stable", () => {
    expect(hook).toContain("placeholderData: keepPreviousData");
    expect(views).not.toContain("hover:-translate-y-px");
    expect(views).toContain(
      "transition-[border-color,box-shadow]",
    );
    expect(views).toContain("motion-reduce:transition-none");
    expect(views).toContain("[scrollbar-gutter:stable]");
  });

  it("uses a centered editor with the approved media library inline", () => {
    expect(editor).toContain("<Dialog open={open}");
    expect(editor).toContain("max-w-5xl");
    expect(editor).not.toContain("<Sheet open={open}");
    expect(editor).toContain("<ApprovedMediaPicker");
    expect(editor).toContain("onSelect={selectApprovedMedia}");
    expect(editor).not.toContain("window.open(");
    expect(editor).toContain(
      'window.addEventListener("focus", refreshOptionsOnFocus)',
    );
  });

  it("keeps task eligibility and content format explicit in the editor", () => {
    expect(editor).toContain(
      "isPublishableTask(task)",
    );
    expect(editor).not.toContain("allowAllTasks");
    expect(page).toContain("contentTypeForDeliveryType(task.delivery_type)");
    expect(page).toContain(
      "defaultContentType={draftSeed?.contentType}",
    );
    expect(editor).not.toContain("setContentType(nextContentType)");
    expect(editor).not.toContain('{ value: "other", label: "Outro" }');
    expect(editor).toContain("Escolha um formato editorial publicável.");
    expect(page).not.toContain('"responsible",\n      "tasks"');
  });

  it("shows only publishable Kanban deadlines in every editorial view", () => {
    expect(page).toContain("isPublishableTask(task)");
    expect(page).toMatch(
      // Atualizado de novo, de proposito. A intencao — nada aparece duas
      // vezes — continua, mas o corte antigo fazia o item SUMIR do
      // calendario na hora em que ganhava arte (o conteudo nao tem dia
      // proprio no banco). A tarefa ligada agora permanece na grade
      // representando o conteudo e sai quando o agendamento assume o dia.
      /view === "board"\s*\? productionTasks\s*:\s*deadlineTasksForGrid/,
    );
    expect(page).toContain(
      "editorialDeadlineTasks.filter((task) => !linkedTaskIds.has(task.id))",
    );
    expect(page).toContain("tasks={tasksForCurrentView}");
    expect(views).toContain("task.due_date?.slice(0, 10)");
    expect(views).toContain("Prazo editorial");
    expect(views).toContain("Prazo Kanban");
    expect(page).toContain("Agenda editorial");
    expect(page).toContain("Prazos do Kanban aparecem em roxo");
    expect(views).toContain("Agenda cronológica");
  });

  it("carries the task theme and context into the editorial flow", () => {
    expect(page).toContain(
      "context: task.description?.trim() || undefined",
    );
    expect(page).toContain(
      "defaultContext={draftSeed?.context}",
    );
    expect(editor).toContain(
      "setObjective(revisionOf?.post.objective || defaultContext)",
    );
    expect(views).not.toContain(
      "normalizeDirectionText(post.internal?.internal_notes)",
    );
    expect(editor).toContain("Direção vinda do Kanban");
    expect(taskModal).toContain(
      "isPublishableDeliveryType(deliveryType)",
    );
    expect(taskModal).toContain("Contexto do conteúdo");
    expect(taskModal).toContain(
      'toast.error("Informe o contexto do conteúdo")',
    );
    expect(views).toContain("function ContentDirection");
    expect(views).toContain("taskContentContext(task)");
    expect(views).toContain("postContentContext(");
  });

  it("renders unlinked Kanban tasks directly in the production board", () => {
    expect(page).toContain("const productionTasks = useMemo");
    expect(page).toContain("isPublishableTask(task)");
    expect(page).not.toContain("const calendarTasks = useMemo");
    expect(page).toContain('view === "board"');
    expect(page).toContain("tasks={tasksForCurrentView}");
    expect(views).toContain("function BoardTaskCard");
    expect(views).toContain("editorialStageForTaskStatus(task.status)");
    expect(views).toContain("Criar e vincular conteúdo");
    expect(page).toContain(
      "Tarefa atualizada também no Kanban central.",
    );
    expect(page).toContain("sendTaskAttachmentsToApproval");
    expect(page).toContain("Editorial task move side effects failed");
    expect(page).toContain('.startsWith("client_request:")');
  });

  it("filters tasks and posts by the same URL-backed content format", () => {
    expect(page).toContain('searchParams.get("format")');
    expect(page).toContain(
      "contentTypeForDeliveryType(task.delivery_type) !== format",
    );
    expect(page).toContain("bundle.post.content_type !== format");
    expect(page).toContain(
      "editorialFormatValues.has(bundle.post.content_type)",
    );
    expect(page).toContain('setParam("format", value)');
    expect(page).toContain('"format",');
  });

  it("loads task schedule for every viewer while keeping edits team-only", () => {
    // Intencao atualizada (decisao do dono em 2026-08-14): as pautas do
    // Kanban fazem parte do cronograma que o CLIENTE ve; a RLS
    // (tasks_client_schedule_read) garante que cliente le so as dele, e a
    // criacao de conteudo a partir da pauta segue exclusiva da equipe.
    expect(page).toMatch(/useTasks\(undefined,\s*\{[\s\S]*?enabled: true/);
    expect(page).toContain("if (!canUseTeamData) return;");
  });

  it("opens the current linked content before offering a new draft", () => {
    expect(taskLinks).toContain("nonTerminalPostIds");
    expect(taskLinks).toContain("postIdByTaskId");
    expect(page).toContain("const openTaskItem");
    expect(page).toContain("linkedPostIdByTaskId[task.id]");
    expect(page).toContain("openDetailById(linkedPostId)");
    expect(page).toContain(
      "openCreateFromTask(task, targetDateKey, targetStage)",
    );
    expect(page).toContain("onCreateFromTask={openTaskItem}");
  });

  it("keeps task loading and failures independent from publication rendering", () => {
    expect(page).toContain("taskDataLoading");
    expect(page).toContain("taskDataError");
    expect(page).toContain(
      "As publicações continuam visíveis, mas as tarefas do Kanban não puderam ser atualizadas.",
    );
    expect(page).toContain("<main className=\"min-w-0\">");
  });

  it("keeps a task link mandatory when creation starts from the Kanban", () => {
    expect(page).toContain(
      "lockTaskId={Boolean(draftSeed?.taskId)}",
    );
    expect(editor).toContain("disabled={!projectId || lockTaskId}");
    expect(editor).toContain("!lockTaskId &&");
    expect(editor).toContain("taskId !== defaultTaskId");
    expect(editor).toContain("!!revisionOf || lockTaskId");
  });

  it("allows a linked draft when the project has no social account", () => {
    expect(editor).toContain("setPublications([])");
    expect(editor).toContain("showExistingPublicationPlan");
    expect(editor).toContain(
      ".filter((publication) => publication.externalAccountId)",
    );
    expect(editor).toContain("Plano de publicação existente");
    expect(editor).not.toContain("<EditorialAccountSetup");
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
