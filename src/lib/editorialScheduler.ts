import type { EditorialApprovedMediaAsset } from "@/lib/editorialMedia";

export interface EditorialSchedulePayloadInput {
  clientId: string;
  projectId: string;
  asset: EditorialApprovedMediaAsset;
  publicationTargets: readonly EditorialSchedulePublicationTarget[];
  scheduledAtIso: string;
  timezone: string;
  postIdempotencyKey: string;
  mutationId: string;
  existingPost?: EditorialScheduleExistingPost | null;
}

export interface EditorialSchedulePublicationTarget {
  accountId: string;
  id?: string | null;
  idempotencyKey: string;
  asset?: EditorialApprovedMediaAsset | null;
  fileId?: string | null;
  caption?: string | null;
  firstComment?: string | null;
  altText?: string | null;
}

export interface EditorialScheduleExistingPost {
  id: string;
  idempotencyKey: string;
  title: string;
  contentType: string;
  objective?: string | null;
  defaultCaption?: string | null;
  taskId?: string | null;
  responsibleId?: string | null;
  internalNotes?: string | null;
  revisionOfPostId?: string | null;
}

export interface EditorialScheduleReadinessInput {
  clientId?: string | null;
  projectId?: string | null;
  assetId?: string | null;
  accountIds?: readonly string[] | null;
  scheduledAt?: string | null;
}

export function activeEditorialSchedulePlans<
  T extends { publication: { status: string } },
>(plans: readonly T[]) {
  return plans.filter(({ publication }) => publication.status !== "cancelled");
}

export function editorialSchedulePlanFingerprint<
  T extends {
    publication: {
      id: string;
      external_account_id: string;
      file_id?: string | null;
      caption?: string | null;
      first_comment?: string | null;
      alt_text?: string | null;
      scheduled_at?: string | null;
      scheduled_timezone?: string | null;
      status: string;
      version?: number | null;
    };
    internal?: { idempotency_key?: string | null } | null;
  },
>(plans: readonly T[]) {
  return JSON.stringify(
    activeEditorialSchedulePlans(plans)
      .map(({ publication, internal }) => ({
        id: publication.id,
        accountId: publication.external_account_id,
        fileId: publication.file_id || null,
        caption: publication.caption || null,
        firstComment: publication.first_comment || null,
        altText: publication.alt_text || null,
        scheduledAt: publication.scheduled_at || null,
        timezone: publication.scheduled_timezone || null,
        status: publication.status,
        version: publication.version ?? null,
        idempotencyKey: internal?.idempotency_key || null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function editorialSchedulePlanMatchesSnapshot<
  T extends Parameters<typeof editorialSchedulePlanFingerprint>[0][number],
>(
  postVersion: number,
  plans: readonly T[],
  snapshot: { postVersion: number; planFingerprint: string },
) {
  return (
    postVersion === snapshot.postVersion &&
    editorialSchedulePlanFingerprint(plans) === snapshot.planFingerprint
  );
}

export function editorialScheduleMissingFields(
  input: EditorialScheduleReadinessInput,
) {
  const missing: string[] = [];
  if (!input.clientId) missing.push("cliente");
  if (!input.projectId) missing.push("projeto");
  if (!input.assetId) missing.push("conteúdo");
  if (!input.accountIds?.length) missing.push("conta");
  if (!input.scheduledAt) missing.push("data e horário");
  return missing;
}

/** A Meta publica no máximo 10 itens por publicação automática. */
export const AUTOMATIC_DELIVERY_MAX_ASSETS = 10;

/**
 * A publicação pode sair sozinha? Precisa da lista de arquivos congelada e
 * dentro do limite da Meta. Fora disso, o agendamento continua valendo, só que
 * a publicação é feita pela equipe.
 */
export function canDeliverAutomatically(assetFileIds: readonly string[]) {
  return (
    assetFileIds.length > 0 && assetFileIds.length <= AUTOMATIC_DELIVERY_MAX_ASSETS
  );
}

export function buildEditorialSchedulePayload(
  input: EditorialSchedulePayloadInput,
) {
  const targets = [
    ...new Map(
      input.publicationTargets
        .filter((target) => target.accountId)
        .map((target) => [target.accountId, target]),
    ).values(),
  ];
  if (targets.length === 0) {
    throw new Error("Escolha pelo menos uma conta para agendar.");
  }
  if (targets.some((target) => !target.idempotencyKey)) {
    throw new Error("Não foi possível preparar as publicações com segurança.");
  }

  const caption = input.asset.root.caption?.trim() || null;
  const objective = input.asset.root.description?.trim() || null;

  return {
    id: input.existingPost?.id || null,
    idempotency_key:
      input.existingPost?.idempotencyKey || input.postIdempotencyKey,
    mutation_id: input.mutationId,
    client_id: input.clientId,
    project_id: input.projectId,
    primary_file_id: input.asset.root.id,
    title: input.existingPost?.title.trim() || input.asset.root.file_name.trim(),
    content_type: input.existingPost?.contentType || input.asset.contentType,
    objective:
      input.existingPost?.objective === undefined
        ? objective
        : input.existingPost.objective,
    default_caption:
      input.existingPost?.defaultCaption === undefined
        ? caption
        : input.existingPost.defaultCaption,
    production_status: "ready",
    task_id: input.existingPost?.taskId || null,
    responsible_id: input.existingPost?.responsibleId || null,
    internal_notes: input.existingPost?.internalNotes?.trim() || null,
    revision_of_post_id: input.existingPost?.revisionOfPostId || null,
    publications: targets.map((target) => {
      const targetAsset = target.asset || input.asset;
      const assetFileIds = targetAsset.files.map((file) => file.id);
      return {
        id: target.id || null,
        idempotency_key: target.idempotencyKey,
        external_account_id: target.accountId,
        file_id:
          target.fileId === undefined ? targetAsset.root.id : target.fileId,
        caption:
          target.caption === undefined ? caption : target.caption,
        first_comment: target.firstComment ?? null,
        alt_text: target.altText ?? null,
        asset_file_ids: assetFileIds,
        // Sem isto o agendamento nascia "manual" e o motor de publicação
        // simplesmente nunca olhava para ele: nada saía sozinho. O limite de 10
        // é da própria Meta; acima disso o envio segue manual para o
        // agendamento continuar funcionando em vez de ser recusado.
        delivery_mode: canDeliverAutomatically(assetFileIds) ? "automatic" : "manual",
        scheduled_at: input.scheduledAtIso,
        scheduled_timezone: input.timezone,
      };
    }),
  };
}
