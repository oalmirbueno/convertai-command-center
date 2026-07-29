import { cleanup, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import EditorialCalendarViews from "@/components/editorial/EditorialCalendarViews";
import type { EditorialInboxTask } from "@/components/editorial/EditorialTaskInbox";
import type { EditorialPostBundle } from "@/hooks/useEditorialCalendar";

afterEach(cleanup);

const task: EditorialInboxTask = {
  id: "task-1",
  project_id: "project-1",
  title: "Como escolher o canal certo",
  description: "Comparar Instagram, TikTok e Google pelo objetivo",
  assigned_to: null,
  status: "todo",
  priority: "medium",
  due_date: "2026-07-15",
  workstream: "design",
  delivery_type: "carousel",
};

const scheduledPost: EditorialPostBundle = {
  post: {
    id: "post-1",
    client_id: "client-1",
    project_id: "project-1",
    primary_file_id: null,
    title: "Bastidores que geram confiança",
    content_type: "reel",
    objective: "Mostrar o processo real antes da entrega",
    default_caption: null,
    production_status: "ready",
    version: 1,
    archived_at: null,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
  },
  internal: null,
  primaryFile: null,
  publicationSetComplete: true,
  publications: [
    {
      publication: {
        id: "publication-1",
        post_id: "post-1",
        client_id: "client-1",
        project_id: "project-1",
        external_account_id: "account-1",
        file_id: null,
        platform: "instagram",
        caption: null,
        first_comment: null,
        alt_text: null,
        scheduled_at: "2026-07-15T12:00:00.000Z",
        scheduled_timezone: "America/Sao_Paulo",
        status: "scheduled",
        published_at: null,
        permalink: null,
        external_post_id: null,
        version: 1,
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:00:00.000Z",
      },
      internal: null,
      account: {
        id: "account-1",
        client_id: "client-1",
        platform: "instagram",
        display_name: "Instagram",
        handle: "@cliente",
        status: "active",
      },
      file: null,
    },
  ],
};

const postWithInternalSecret: EditorialPostBundle = {
  ...scheduledPost,
  post: {
    ...scheduledPost.post,
    objective: null,
    default_caption: null,
  },
  internal: {
    post_id: "post-1",
    client_id: "client-1",
    task_id: "task-1",
    responsible_id: null,
    revision_of_post_id: null,
    internal_notes: "segredo operacional",
    idempotency_key: "post-key",
    last_mutation_id: null,
    last_mutation_fingerprint: null,
    approval_fingerprint: null,
    created_by: "user-1",
    updated_by: "user-1",
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
  },
};

function renderView({
  view,
  tasks = [task],
  posts = [],
}: {
  view: "board" | "month" | "week" | "list";
  tasks?: EditorialInboxTask[];
  posts?: EditorialPostBundle[];
}) {
  return render(
    <DndContext>
      <EditorialCalendarViews
        view={view}
        anchorDate={new Date("2026-07-15T12:00:00")}
        posts={posts}
        tasks={tasks}
        clientNames={new Map([["client-1", "Cliente"]])}
        projectNames={new Map([["project-1", "Projeto"]])}
        projectScopeNames={
          new Map([["project-1", "Cliente / Projeto"]])
        }
        responsibleNames={new Map()}
        canCreate
        canEdit
        canPublish
        onSelectPost={vi.fn()}
        onCreateFromTask={vi.fn()}
        onCreateOnDate={vi.fn()}
        onShowBacklog={vi.fn()}
      />
    </DndContext>,
  );
}

describe("editorial calendar content direction", () => {
  it.each(["month", "week", "list"] as const)(
    "shows task theme and context in the %s view",
    (view) => {
      renderView({ view });

      expect(
        screen.getAllByTitle(`Tema: ${task.title}`).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByTitle(`Contexto: ${task.description}`).length,
      ).toBeGreaterThan(0);
    },
  );

  it("keeps theme and context visible for an undated list item", () => {
    renderView({
      view: "list",
      tasks: [{ ...task, due_date: null }],
    });

    expect(screen.getByTitle(`Tema: ${task.title}`)).toBeVisible();
    expect(
      screen.getByTitle(`Contexto: ${task.description}`),
    ).toBeVisible();
  });

  it("shows the saved editorial objective as publication context", () => {
    renderView({
      view: "list",
      tasks: [],
      posts: [scheduledPost],
    });

    expect(
      screen.getByTitle(`Tema: ${scheduledPost.post.title}`),
    ).toBeVisible();
    expect(
      screen.getByTitle(
        `Contexto: ${scheduledPost.post.objective}`,
      ),
    ).toBeVisible();
  });

  it("keeps compact month cards to exactly two visible rows", () => {
    const { container } = renderView({
      view: "month",
      posts: [scheduledPost],
    });
    const compactCards = container.querySelectorAll(
      '[data-content-density="compact"]',
    );

    expect(compactCards.length).toBeGreaterThan(0);
    compactCards.forEach((card) => {
      expect(card.childElementCount).toBe(2);
    });
  });

  it("never exposes internal notes as public content context", () => {
    renderView({
      view: "list",
      tasks: [],
      posts: [postWithInternalSecret],
    });

    expect(
      screen.queryByText(/segredo operacional/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Contexto: Não informado"),
    ).toBeVisible();
  });

  it("does not change the approved production board cards", () => {
    renderView({ view: "board" });

    expect(screen.getByText(task.title)).toBeVisible();
    expect(
      screen.queryByTitle(`Contexto: ${task.description}`),
    ).not.toBeInTheDocument();
  });
});
