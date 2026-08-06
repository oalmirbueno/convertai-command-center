import { describe, expect, it } from "vitest";
import {
  activeEditorialSchedulePlans,
  buildEditorialSchedulePayload,
  editorialSchedulePlanFingerprint,
  editorialSchedulePlanMatchesSnapshot,
  editorialScheduleMissingFields,
} from "@/lib/editorialScheduler";
import type { EditorialApprovedMediaAsset } from "@/lib/editorialMedia";

const carousel: EditorialApprovedMediaAsset = {
  id: "root",
  contentType: "carousel",
  root: {
    id: "root",
    file_name: "Carrossel aprovado.png",
    caption: "  Legenda aprovada  ",
    description: "  Direção aprovada  ",
  },
  files: [
    { id: "root", file_name: "Card 1.png" },
    { id: "child-2", file_name: "Card 2.png", parent_file_id: "root" },
  ],
};

describe("editorial quick scheduler", () => {
  it("keeps cancelled history out of the active plan", () => {
    const plans = [
      { publication: { id: "cancelled", status: "cancelled" } },
      { publication: { id: "active", status: "planned" } },
    ];

    expect(activeEditorialSchedulePlans(plans)).toEqual([plans[1]]);
  });

  it("freezes the active plan identity without depending on cancelled history order", () => {
    const active = {
      publication: {
        id: "active",
        external_account_id: "instagram",
        file_id: "root",
        status: "planned",
        scheduled_at: null,
        version: 2,
      },
      internal: { idempotency_key: "publication-key" },
    };
    const cancelled = {
      publication: {
        id: "cancelled",
        external_account_id: "facebook",
        file_id: "root",
        status: "cancelled",
        scheduled_at: null,
        version: 4,
      },
      internal: { idempotency_key: "cancelled-key" },
    };

    expect(editorialSchedulePlanFingerprint([cancelled, active])).toBe(
      editorialSchedulePlanFingerprint([active]),
    );
    expect(
      editorialSchedulePlanFingerprint([
        {
          ...active,
          publication: { ...active.publication, status: "scheduled" },
        },
      ]),
    ).not.toBe(editorialSchedulePlanFingerprint([active]));

    const snapshot = {
      postVersion: 7,
      planFingerprint: editorialSchedulePlanFingerprint([active]),
    };
    expect(editorialSchedulePlanMatchesSnapshot(7, [active], snapshot)).toBe(
      true,
    );
    expect(
      editorialSchedulePlanMatchesSnapshot(8, [cancelled], snapshot),
    ).toBe(false);
    expect(
      editorialSchedulePlanMatchesSnapshot(
        7,
        [
          {
            ...active,
            publication: { ...active.publication, status: "scheduled" },
          },
        ],
        snapshot,
      ),
    ).toBe(false);
  });

  it("reports only the fields still missing from the fast flow", () => {
    expect(
      editorialScheduleMissingFields({
        clientId: "client",
        projectId: "project",
        assetId: null,
        accountIds: [],
        scheduledAt: "",
      }),
    ).toEqual(["conteúdo", "conta", "data e horário"]);
  });

  it("builds one atomic schedule with the complete carousel for every account", () => {
    const payload = buildEditorialSchedulePayload({
      clientId: "client",
      projectId: "project",
      asset: carousel,
      publicationTargets: [
        { accountId: "instagram", idempotencyKey: "instagram-key" },
        { accountId: "facebook", idempotencyKey: "facebook-key" },
        { accountId: "instagram", idempotencyKey: "ignored-duplicate" },
      ],
      scheduledAtIso: "2026-08-08T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "post-key",
      mutationId: "mutation-key",
    });

    expect(payload).toMatchObject({
      client_id: "client",
      project_id: "project",
      primary_file_id: "root",
      title: "Carrossel aprovado.png",
      content_type: "carousel",
      objective: "Direção aprovada",
      default_caption: "Legenda aprovada",
      production_status: "ready",
    });
    expect(payload.publications).toHaveLength(2);
    expect(payload.publications[0]).toMatchObject({
      external_account_id: "instagram",
      asset_file_ids: ["root", "child-2"],
    });
    expect(payload.publications[0]).not.toHaveProperty("status");
    expect(payload.publications[1].external_account_id).toBe("facebook");
  });

  it("refuses an accountless schedule", () => {
    expect(() =>
      buildEditorialSchedulePayload({
        clientId: "client",
        projectId: "project",
        asset: carousel,
        publicationTargets: [],
        scheduledAtIso: "2026-08-08T12:00:00.000Z",
        timezone: "America/Sao_Paulo",
        postIdempotencyKey: "post-key",
        mutationId: "mutation-key",
      }),
    ).toThrow("Escolha pelo menos uma conta");
  });

  it("preserves the existing post and publication identities", () => {
    const payload = buildEditorialSchedulePayload({
      clientId: "client",
      projectId: "project",
      asset: carousel,
      publicationTargets: [
        {
          accountId: "instagram",
          id: "publication-id",
          idempotencyKey: "publication-key",
        },
      ],
      scheduledAtIso: "2026-08-08T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "unused-new-key",
      mutationId: "mutation-key",
      existingPost: {
        id: "post-id",
        idempotencyKey: "existing-post-key",
        title: "Tema editorial preservado",
        contentType: "static",
        objective: "Objetivo editorial preservado",
        defaultCaption: "Legenda base preservada",
        taskId: "task-id",
        responsibleId: "manager-id",
        internalNotes: "  Nota interna  ",
      },
    });

    expect(payload).toMatchObject({
      id: "post-id",
      idempotency_key: "existing-post-key",
      title: "Tema editorial preservado",
      content_type: "static",
      objective: "Objetivo editorial preservado",
      default_caption: "Legenda base preservada",
      task_id: "task-id",
      responsible_id: "manager-id",
      internal_notes: "Nota interna",
    });
    expect(payload.publications[0]).toMatchObject({
      id: "publication-id",
      idempotency_key: "publication-key",
    });
  });

  it("preserves account-specific copy and media while scheduling an existing plan", () => {
    const alternateAsset: EditorialApprovedMediaAsset = {
      id: "alternate-root",
      contentType: "static",
      root: { id: "alternate-root", file_name: "Arte Facebook.png" },
      files: [{ id: "alternate-root", file_name: "Arte Facebook.png" }],
    };
    const payload = buildEditorialSchedulePayload({
      clientId: "client",
      projectId: "project",
      asset: carousel,
      publicationTargets: [
        {
          accountId: "facebook",
          id: "publication-id",
          idempotencyKey: "publication-key",
          asset: alternateAsset,
          fileId: "alternate-root",
          caption: "Copy exclusiva",
          firstComment: "Primeiro comentário",
          altText: "Descrição acessível",
        },
      ],
      scheduledAtIso: "2026-08-08T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "post-key",
      mutationId: "mutation-key",
    });

    expect(payload.publications[0]).toMatchObject({
      file_id: "alternate-root",
      caption: "Copy exclusiva",
      first_comment: "Primeiro comentário",
      alt_text: "Descrição acessível",
      asset_file_ids: ["alternate-root"],
    });
  });
});
