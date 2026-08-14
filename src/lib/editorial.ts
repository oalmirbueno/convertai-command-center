export const SUPPORTED_EDITORIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube",
  "google_business",
] as const;

export type EditorialPlatform =
  (typeof SUPPORTED_EDITORIAL_PLATFORMS)[number];

export const EDITORIAL_PLATFORMS = SUPPORTED_EDITORIAL_PLATFORMS;

export const EDITORIAL_PLATFORM_CONFIG: Record<
  EditorialPlatform,
  { label: string; color: string }
> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  facebook: { label: "Facebook", color: "#1877F2" },
  tiktok: { label: "TikTok", color: "#111827" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  youtube: { label: "YouTube", color: "#FF0000" },
  google_business: { label: "Google Business", color: "#4285F4" },
};

export const PLATFORM_LABELS: Record<EditorialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google_business: "Google Business",
};

export const EDITORIAL_PUBLICATION_STATUSES = [
  "planned",
  "scheduled",
  "published",
  "failed",
  "cancelled",
] as const;

export type EditorialPublicationStatus =
  (typeof EDITORIAL_PUBLICATION_STATUSES)[number];

export const PUBLICATION_STATUS_LABELS: Record<
  EditorialPublicationStatus,
  string
> = {
  planned: "Planejado",
  scheduled: "Agendado",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export const EDITORIAL_PRODUCTION_STATUSES = [
  "draft",
  "production",
  "ready",
  "cancelled",
  "archived",
] as const;

export type EditorialProductionStatus =
  (typeof EDITORIAL_PRODUCTION_STATUSES)[number];

export const PRODUCTION_STATUS_LABELS: Record<
  EditorialProductionStatus,
  string
> = {
  draft: "Rascunho",
  production: "Em produção",
  ready: "Pronto",
  cancelled: "Cancelado",
  archived: "Arquivado",
};

export const EDITORIAL_PRODUCTION_STATUS_CONFIG: Record<
  EditorialProductionStatus,
  { label: string; color: string }
> = {
  // Cores alinhadas com as colunas do board: rascunho cinza, produção violeta,
  // pronto/revisão âmbar. Agendado (azul) e publicado (verde) vêm do status de
  // publicação. Assim a agenda e o kanban contam a mesma história de cores.
  draft: { label: "Rascunho", color: "#64748B" },
  production: { label: "Em produção", color: "#8B5CF6" },
  ready: { label: "Pronto", color: "#F59E0B" },
  cancelled: { label: "Cancelado", color: "#6B7280" },
  archived: { label: "Arquivado", color: "#475569" },
};

export type EditorialAggregateStatus =
  | "draft"
  | EditorialPublicationStatus
  | "partially_published";

export const EDITORIAL_STATUS_CONFIG: Record<
  EditorialAggregateStatus,
  { label: string; color: string }
> = {
  draft: { label: "Rascunho", color: "#64748B" },
  planned: { label: "Planejado", color: "#8B5CF6" },
  scheduled: { label: "Agendado", color: "#0EA5E9" },
  partially_published: {
    label: "Publicado parcialmente",
    color: "#F59E0B",
  },
  published: { label: "Publicado", color: "#10B981" },
  failed: { label: "Falhou", color: "#EF4444" },
  cancelled: { label: "Cancelado", color: "#6B7280" },
};

export type EditorialRole =
  | "admin"
  | "manager"
  | "design"
  | "traffic"
  | "client";

export interface EditorialPermissions {
  canRead: boolean;
  canEdit: boolean;
  canPublish: boolean;
  readOnly: boolean;
}

export interface EditorialApprovalFile {
  agency_approval_status?: string | null;
  visibility?: string | null;
  approval_status?: string | null;
  locked_at?: string | null;
  status?: string | null;
  archived_at?: string | null;
}

export interface EditorialPublicationLike {
  platform: string;
  status: string;
  caption?: string | null;
}

export type EditorialApprovalStage =
  | "not_requested"
  | "agency_review"
  | "agency_approved"
  | "client_review"
  | "approved"
  | "changes";

export interface EditorialApprovalBundleLike {
  primaryFile?: EditorialApprovalFile | null;
  publications: readonly {
    publication: {
      status: string;
      file_id?: string | null;
    };
    file?: EditorialApprovalFile | null;
  }[];
}

export interface EditorialFilterablePost {
  title: string;
  objective?: string | null;
  default_caption?: string | null;
  content_type?: string | null;
  production_status?: string | null;
  client_name?: string | null;
  project_name?: string | null;
  responsible_name?: string | null;
  publications?: readonly EditorialPublicationLike[] | null;
}

export interface EditorialPostFilters {
  text?: string | null;
  platform?: EditorialPlatform | "all" | null;
  status?: EditorialAggregateStatus | "all" | null;
}

export function isSupportedEditorialPlatform(
  value: string | null | undefined,
): value is EditorialPlatform {
  return SUPPORTED_EDITORIAL_PLATFORMS.includes(value as EditorialPlatform);
}

export function isEditorialPublicationStatus(
  value: string | null | undefined,
): value is EditorialPublicationStatus {
  return EDITORIAL_PUBLICATION_STATUSES.includes(
    value as EditorialPublicationStatus,
  );
}

export function getEditorialPermissions(
  role: string | null | undefined,
): EditorialPermissions {
  const canRead =
    role === "admin"
    || role === "manager"
    || role === "design"
    || role === "traffic"
    || role === "client";
  const canEdit =
    role === "admin"
    || role === "manager"
    || role === "design"
    || role === "traffic";
  const canPublish = role === "admin" || role === "manager";

  return {
    canRead,
    canEdit,
    canPublish,
    readOnly: canRead && !canEdit,
  };
}

export function canEditEditorial(role: string | null | undefined) {
  return getEditorialPermissions(role).canEdit;
}

export function canPublishEditorial(role: string | null | undefined) {
  return getEditorialPermissions(role).canPublish;
}

export function isEditorialFilePublishable(
  file: EditorialApprovalFile | null | undefined,
) {
  // Dois estados finais valem para publicar:
  // - fluxo de aprovação concluído (cliente aprovou no painel ou no grupo);
  // - material DISPONIBILIZADO ao cliente (client_shared): a regra da casa é
  //   que disponibilizar dispensa a aprovação do cliente.
  return Boolean(
    file
    && file.agency_approval_status === "approved"
    && (
      (file.visibility === "approval" && file.approval_status === "approved")
      || file.visibility === "client_shared"
    )
    && file.locked_at
    && file.archived_at == null
    && (file.status ?? "ready") === "ready",
  );
}

export function isEditorialFileEditable(
  file: EditorialApprovalFile | null | undefined,
) {
  return Boolean(
    file
    && file.archived_at == null
    && !file.locked_at
    && file.visibility === "internal"
    && file.agency_approval_status === "not_requested"
    && file.approval_status === "none",
  );
}

export function getEditorialApprovalStage(
  post: EditorialApprovalBundleLike,
): EditorialApprovalStage {
  const activePublications = post.publications.filter(
    ({ publication }) => publication.status !== "cancelled",
  );
  if (
    !post.primaryFile ||
    activePublications.some(
      ({ publication, file }) => publication.file_id && !file,
    )
  ) {
    return "not_requested";
  }

  const files = [
    post.primaryFile,
    ...activePublications.map(({ publication, file }) =>
      publication.file_id ? file : null,
    ),
  ].filter(
    (file): file is EditorialApprovalFile => Boolean(file),
  );

  if (files.length === 0) return "not_requested";
  if (
    files.some(
      (file) =>
        file.agency_approval_status === "rejected" ||
        file.approval_status === "rejected",
    )
  ) {
    return "changes";
  }
  if (
    files.some(
      (file) => file.agency_approval_status === "not_requested",
    )
  ) {
    return "not_requested";
  }
  if (
    files.some((file) => file.agency_approval_status === "pending")
  ) {
    return "agency_review";
  }
  if (files.some((file) => file.approval_status === "pending")) {
    return "client_review";
  }
  if (files.every(isEditorialFilePublishable)) return "approved";
  if (
    files.some((file) => file.agency_approval_status === "approved")
  ) {
    return "agency_approved";
  }
  return "not_requested";
}

export function aggregateEditorialPostStatus(
  publications: readonly Pick<EditorialPublicationLike, "status">[] | null | undefined,
): EditorialAggregateStatus {
  if (!publications?.length) return "draft";

  const statuses = publications
    .map(({ status }) => status)
    .filter(isEditorialPublicationStatus);
  if (!statuses.length) return "draft";

  const allAre = (status: EditorialPublicationStatus) =>
    statuses.every((current) => current === status);

  if (allAre("published")) return "published";
  if (allAre("cancelled")) return "cancelled";

  if (statuses.includes("published")) return "partially_published";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("scheduled")) return "scheduled";
  if (statuses.includes("planned")) return "planned";

  return "cancelled";
}

function normalizeEditorialSearch(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesEditorialFilters(
  post: EditorialFilterablePost,
  filters: EditorialPostFilters = {},
) {
  const publications = post.publications || [];
  const text = normalizeEditorialSearch(filters.text);

  if (text) {
    const searchable = normalizeEditorialSearch(
      [
        post.title,
        post.objective,
        post.default_caption,
        post.content_type,
        post.client_name,
        post.project_name,
        post.responsible_name,
        ...publications.flatMap((publication) => [
          publication.caption,
          isSupportedEditorialPlatform(publication.platform)
            ? EDITORIAL_PLATFORM_CONFIG[publication.platform].label
            : publication.platform,
        ]),
      ]
        .filter(Boolean)
        .join(" "),
    );

    if (!searchable.includes(text)) return false;
  }

  if (
    filters.platform
    && filters.platform !== "all"
    && !publications.some(
      (publication) => publication.platform === filters.platform,
    )
  ) {
    return false;
  }

  if (
    filters.status
    && filters.status !== "all"
    && aggregateEditorialPostStatus(publications) !== filters.status
  ) {
    return false;
  }

  return true;
}

export function filterEditorialPosts<T extends EditorialFilterablePost>(
  posts: readonly T[],
  filters: EditorialPostFilters = {},
) {
  return posts.filter((post) => matchesEditorialFilters(post, filters));
}

export const editorialPermissions = getEditorialPermissions;
export const isFilePublishable = isEditorialFilePublishable;
export const isFileEditable = isEditorialFileEditable;
export const aggregateEditorialStatus = aggregateEditorialPostStatus;

/**
 * Estágio visual único do conteúdo, para agenda e quadro contarem a mesma
 * história de cor.
 *
 * O quadro colore pela coluna (derivada de production_status) e a agenda coloria
 * só por status de publicação: por isso rascunho, produção e pronto apareciam
 * com a mesma cor no calendário. Aqui os dois campos entram na mesma decisão,
 * com a publicação tendo precedência quando já saiu do planejamento.
 */
export type EditorialVisualStage =
  | "draft"
  | "production"
  | "ready"
  | "scheduled"
  | "overdue"
  | "published"
  | "failed"
  | "cancelled";

export const EDITORIAL_VISUAL_STAGE_LABELS: Record<EditorialVisualStage, string> = {
  draft: "Rascunho",
  production: "Em produção",
  ready: "Pronto",
  scheduled: "Programado",
  overdue: "Passou da hora",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

/**
 * Passou da hora e não saiu.
 *
 * Antes um post marcado para o dia 3 e que nunca foi publicado continuava com o
 * mesmo selo azul de "Programado" de um post marcado para amanhã. Era por isso
 * que a agenda parecia "teimar": ninguém tinha como ver que aquilo tinha
 * vencido. A folga existe porque a publicação automática roda de minuto em
 * minuto e um post pode estar sendo processado bem na virada.
 */
const OVERDUE_TOLERANCE_MINUTES = 15;

export function isPublicationOverdue(
  publicationStatus: string | null | undefined,
  scheduledAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (publicationStatus !== "scheduled" || !scheduledAt) return false;
  const scheduled = new Date(scheduledAt);
  if (Number.isNaN(scheduled.getTime())) return false;
  return now.getTime() - scheduled.getTime() > OVERDUE_TOLERANCE_MINUTES * 60_000;
}

export function editorialVisualStage(
  productionStatus: string | null | undefined,
  publicationStatus?: string | null,
  scheduledAt?: string | null,
  now: Date = new Date(),
): EditorialVisualStage {
  if (publicationStatus === "published") return "published";
  if (publicationStatus === "failed") return "failed";
  if (publicationStatus === "cancelled") return "cancelled";
  if (publicationStatus === "scheduled") {
    return isPublicationOverdue(publicationStatus, scheduledAt, now)
      ? "overdue"
      : "scheduled";
  }
  if (productionStatus === "cancelled") return "cancelled";
  if (productionStatus === "production") return "production";
  if (productionStatus === "ready") return "ready";
  return "draft";
}
