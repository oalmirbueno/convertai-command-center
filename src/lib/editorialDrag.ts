import type {
  EditorialPostBundle,
  EditorialPublicationBundle,
} from "@/hooks/useEditorialCalendar";
import {
  EDITORIAL_DEFAULT_TIME_ZONE,
  isoUtcToZonedDateTimeLocal,
  zonedDateTimeLocalToIso,
} from "@/lib/editorialDate";

export type EditableEditorialStage = "draft" | "production" | "ready";

export function isEditorialPostPlanMutable(bundle: EditorialPostBundle) {
  return (
    bundle.post.production_status !== "archived" &&
    bundle.publications.every(({ publication }) =>
      ["planned", "cancelled"].includes(publication.status),
    )
  );
}

export function isEditorialPublicationDraggable(
  bundle: EditorialPostBundle,
  publication: EditorialPublicationBundle,
  permissions: { canEdit: boolean; canPublish: boolean },
) {
  const status = publication.publication.status;
  if (status === "planned") {
    return permissions.canEdit && isEditorialPostPlanMutable(bundle);
  }
  return (
    permissions.canPublish &&
    (status === "scheduled" || status === "failed")
  );
}

interface BuildEditorialPayloadOptions {
  mutationId: string;
  productionStatus?: EditableEditorialStage;
  publicationId?: string;
  scheduledAt?: string | null;
  scheduledTimezone?: string;
}

export function moveEditorialInstantToCalendarDate(
  scheduledAt: string | null,
  targetDateKey: string,
) {
  const localCurrent = scheduledAt
    ? isoUtcToZonedDateTimeLocal(
        scheduledAt,
        EDITORIAL_DEFAULT_TIME_ZONE,
      )
    : null;
  const time = localCurrent?.slice(11, 16) || "09:00";
  return zonedDateTimeLocalToIso(
    `${targetDateKey}T${time}`,
    EDITORIAL_DEFAULT_TIME_ZONE,
  );
}

export function buildEditorialPostMutationPayload(
  bundle: EditorialPostBundle,
  options: BuildEditorialPayloadOptions,
) {
  if (!bundle.publicationSetComplete) {
    throw new Error(
      "O plano editorial completo precisa ser carregado antes da movimentação.",
    );
  }
  if (!bundle.internal?.idempotency_key) {
    throw new Error("O conteúdo precisa ser recarregado antes de ser movido.");
  }
  if (!isEditorialPostPlanMutable(bundle)) {
    throw new Error(
      "Este conteúdo já entrou no fluxo de publicação e não pode ser movido por aqui.",
    );
  }

  const publications = bundle.publications
    .filter(({ publication }) => publication.status !== "cancelled")
    .map(({ publication, internal }) => {
      if (!internal?.idempotency_key) {
        throw new Error(
          "Uma publicação precisa ser recarregada antes de ser movida.",
        );
      }
      return {
        id: publication.id,
        idempotency_key: internal.idempotency_key,
        external_account_id: publication.external_account_id,
        file_id: publication.file_id,
        caption: publication.caption,
        first_comment: publication.first_comment,
        alt_text: publication.alt_text,
        scheduled_at:
          publication.id === options.publicationId
            ? options.scheduledAt ?? null
            : publication.scheduled_at,
        scheduled_timezone:
          publication.id === options.publicationId
            ? options.scheduledTimezone ||
              publication.scheduled_timezone
            : publication.scheduled_timezone,
      };
    });

  return {
    id: bundle.post.id,
    idempotency_key: bundle.internal.idempotency_key,
    mutation_id: options.mutationId,
    client_id: bundle.post.client_id,
    project_id: bundle.post.project_id,
    primary_file_id: bundle.post.primary_file_id,
    title: bundle.post.title,
    content_type: bundle.post.content_type,
    objective: bundle.post.objective,
    default_caption: bundle.post.default_caption,
    production_status:
      options.productionStatus || bundle.post.production_status,
    task_id: bundle.internal.task_id,
    responsible_id: bundle.internal.responsible_id,
    internal_notes: bundle.internal.internal_notes,
    revision_of_post_id: bundle.internal.revision_of_post_id,
    publications,
  };
}
