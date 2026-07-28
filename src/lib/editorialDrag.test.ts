import { describe, expect, it } from "vitest";
import type { EditorialPostBundle } from "@/hooks/useEditorialCalendar";
import {
  buildEditorialPostMutationPayload,
  isEditorialPostPlanMutable,
  isEditorialPublicationDraggable,
  moveEditorialInstantToCalendarDate,
} from "@/lib/editorialDrag";
import { dateKeyInTimeZone } from "@/lib/editorialDate";

function bundle(
  publicationStatus = "planned",
): EditorialPostBundle {
  return {
    post: {
      id: "post-1",
      client_id: "client-1",
      project_id: "project-1",
      primary_file_id: null,
      title: "Carrossel de julho",
      content_type: "carousel",
      objective: null,
      default_caption: null,
      production_status: "draft",
      version: 3,
      archived_at: null,
      created_at: "2026-07-01T12:00:00Z",
      updated_at: "2026-07-01T12:00:00Z",
    },
    internal: {
      post_id: "post-1",
      client_id: "client-1",
      task_id: "task-1",
      responsible_id: "user-1",
      revision_of_post_id: null,
      internal_notes: null,
      idempotency_key: "10000000-0000-4000-8000-000000000001",
      last_mutation_id: null,
      last_mutation_fingerprint: null,
      approval_fingerprint: null,
      created_by: "user-1",
      updated_by: "user-1",
      created_at: "2026-07-01T12:00:00Z",
      updated_at: "2026-07-01T12:00:00Z",
    },
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
          caption: "Legenda",
          first_comment: null,
          alt_text: null,
          scheduled_at: "2026-07-20T12:00:00Z",
          scheduled_timezone: "America/Sao_Paulo",
          status: publicationStatus,
          published_at: null,
          permalink: null,
          external_post_id: null,
          version: 2,
          created_at: "2026-07-01T12:00:00Z",
          updated_at: "2026-07-01T12:00:00Z",
        },
        internal: {
          publication_id: "publication-1",
          client_id: "client-1",
          idempotency_key: "20000000-0000-4000-8000-000000000002",
          included_in_approval_snapshot: false,
          failure_code: null,
          failure_reason: null,
          attempt_count: 0,
          last_attempt_at: null,
          created_by: "user-1",
          updated_by: "user-1",
          scheduled_by: null,
          published_by: null,
          created_at: "2026-07-01T12:00:00Z",
          updated_at: "2026-07-01T12:00:00Z",
        },
        account: null,
        file: null,
      },
    ],
  };
}

describe("editorial drag helpers", () => {
  it("permite mover somente planos ainda editáveis", () => {
    expect(isEditorialPostPlanMutable(bundle())).toBe(true);
    expect(isEditorialPostPlanMutable(bundle("scheduled"))).toBe(false);
  });

  it("separa permissão de edição e publicação", () => {
    const planned = bundle();
    expect(
      isEditorialPublicationDraggable(planned, planned.publications[0], {
        canEdit: true,
        canPublish: false,
      }),
    ).toBe(true);

    const scheduled = bundle("scheduled");
    expect(
      isEditorialPublicationDraggable(
        scheduled,
        scheduled.publications[0],
        { canEdit: true, canPublish: false },
      ),
    ).toBe(false);
    expect(
      isEditorialPublicationDraggable(
        scheduled,
        scheduled.publications[0],
        { canEdit: true, canPublish: true },
      ),
    ).toBe(true);
  });

  it("altera apenas a data da publicação arrastada", () => {
    const current = bundle();
    const payload = buildEditorialPostMutationPayload(current, {
      mutationId: "30000000-0000-4000-8000-000000000003",
      publicationId: "publication-1",
      scheduledAt: "2026-07-28T12:00:00Z",
      scheduledTimezone: "America/Sao_Paulo",
    });

    expect(payload.production_status).toBe("draft");
    expect(payload.task_id).toBe("task-1");
    expect(payload.publications[0].scheduled_at).toBe(
      "2026-07-28T12:00:00Z",
    );
    expect(payload.publications[0].scheduled_timezone).toBe(
      "America/Sao_Paulo",
    );
  });

  it("recusa o payload quando uma publicação já está agendada", () => {
    expect(() =>
      buildEditorialPostMutationPayload(bundle("scheduled"), {
        mutationId: "30000000-0000-4000-8000-000000000003",
        productionStatus: "ready",
      }),
    ).toThrow(/já entrou no fluxo de publicação/i);
  });

  it("recusa salvar um recorte parcial do calendário", () => {
    const partial = {
      ...bundle(),
      publicationSetComplete: false,
    };

    expect(() =>
      buildEditorialPostMutationPayload(partial, {
        mutationId: "30000000-0000-4000-8000-000000000003",
        productionStatus: "production",
      }),
    ).toThrow(/plano editorial completo/i);
  });

  it("mantém o dia e horário visuais de Brasília ao reagendar", () => {
    const moved = moveEditorialInstantToCalendarDate(
      "2026-07-28T03:30:00Z",
      "2026-07-30",
    );

    expect(moved).toBe("2026-07-30T03:30:00.000Z");
    expect(dateKeyInTimeZone(moved!)).toBe("2026-07-30");
  });
});
