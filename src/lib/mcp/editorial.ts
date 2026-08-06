export const TASK_WORKSTREAM_VALUES = [
  "general",
  "design",
  "content",
  "video",
  "traffic",
  "development",
  "operations",
] as const;

export const TASK_DELIVERY_TYPE_VALUES = [
  "unspecified",
  "design",
  "branding",
  "static",
  "carousel",
  "reel",
  "story",
  "video",
  "short",
  "article",
  "google_post",
  "planning",
  "copywriting",
  "website",
  "landing_page",
  "automation",
  "traffic",
  "seo",
  "document",
  "report",
  "other",
] as const;

export const EDITORIAL_DELIVERY_TYPE_VALUES = [
  "design",
  "static",
  "carousel",
  "reel",
  "story",
  "video",
  "short",
  "article",
  "google_post",
] as const;

export const EDITORIAL_CONTENT_TYPE_VALUES = [
  "static",
  "carousel",
  "reel",
  "story",
  "video",
  "short",
  "article",
  "google_post",
] as const;

export const EDITORIAL_PRODUCTION_STATUS_VALUES = [
  "draft",
  "production",
  "ready",
  "cancelled",
] as const;

export const EDITORIAL_PUBLICATION_STATUS_VALUES = [
  "planned",
  "scheduled",
  "published",
  "failed",
  "cancelled",
] as const;

export const EDITORIAL_CREATE_STATUS_VALUES = [
  "backlog",
  "todo",
  "doing",
  "review",
  "blocked",
] as const;

export const EDITORIAL_TASK_STATUS_VALUES = [
  "backlog",
  "todo",
  "doing",
  "review",
  "approved",
  "blocked",
] as const;

export type EditorialDeliveryType =
  (typeof EDITORIAL_DELIVERY_TYPE_VALUES)[number];

export type EditorialFileQueryRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  file_name: string;
  file_type: string | null;
  mime_type: string | null;
  extension: string | null;
  file_url: string | null;
  size_bytes: number | null;
  caption: string | null;
  carousel_text: string | null;
  description: string | null;
  approval_status: string;
  visibility: string | null;
  status: string | null;
  archived_at: string | null;
  parent_file_id: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SafeEditorialFile = Omit<
  EditorialFileQueryRow,
  "storage_path" | "archived_at"
>;

const WORKSTREAM_BY_DELIVERY_TYPE: Record<EditorialDeliveryType, string> = {
  design: "design",
  static: "design",
  carousel: "design",
  reel: "video",
  story: "content",
  video: "video",
  short: "video",
  article: "content",
  google_post: "content",
};

const CONTENT_TYPE_BY_DELIVERY_TYPE: Record<EditorialDeliveryType, string> = {
  design: "static",
  static: "static",
  carousel: "carousel",
  reel: "reel",
  story: "story",
  video: "video",
  short: "short",
  article: "article",
  google_post: "google_post",
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export function nextIsoDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day + 1));
  return parsed.toISOString().slice(0, 10);
}

export function publicationRangeBoundary(value: string): string {
  return `${value}T00:00:00-03:00`;
}

export function editorialWorkstreamFor(
  deliveryType: EditorialDeliveryType,
): string {
  return WORKSTREAM_BY_DELIVERY_TYPE[deliveryType];
}

export function contentTypeForEditorialFormat(
  format: EditorialDeliveryType,
): string {
  return CONTENT_TYPE_BY_DELIVERY_TYPE[format];
}

export function deliveryTypesForEditorialFormat(
  format: EditorialDeliveryType,
): EditorialDeliveryType[] {
  return format === "design" || format === "static"
    ? ["design", "static"]
    : [format];
}

export function buildPageMeta(
  total: number,
  returned: number,
  offset: number,
  limit: number,
) {
  const hasMore = offset + returned < total;
  return {
    total,
    returned,
    has_more: hasMore,
    next_offset: hasMore ? offset + returned : null,
    offset,
    limit,
  };
}

function numericOrder(value?: string | null) {
  if (!value) return null;
  const lastSegment = value.split(/[\\/]/).filter(Boolean).at(-1) || value;
  const fraction = lastSegment.match(/\((\d+)\s*\/\s*\d+\)/);
  if (fraction) return Number(fraction[1]);
  const labelled = lastSegment.match(
    /(?:card|slide|p[aá]gina|page)[\s._-]*(\d+)/i,
  );
  if (labelled) return Number(labelled[1]);
  const leading = lastSegment.match(/^(\d+)(?=[\s._-])/);
  return leading ? Number(leading[1]) : null;
}

function compareCarouselChildren(
  left: EditorialFileQueryRow,
  right: EditorialFileQueryRow,
) {
  const leftOrder = numericOrder(left.storage_path) ?? numericOrder(left.file_name);
  const rightOrder = numericOrder(right.storage_path) ?? numericOrder(right.file_name);
  if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder != null && rightOrder == null) return -1;
  if (leftOrder == null && rightOrder != null) return 1;
  return (
    Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id.localeCompare(right.id)
  );
}

export function toSafeEditorialFile(
  file: EditorialFileQueryRow,
): SafeEditorialFile {
  return {
    id: file.id,
    client_id: file.client_id,
    project_id: file.project_id,
    file_name: file.file_name,
    file_type: file.file_type,
    mime_type: file.mime_type,
    extension: file.extension,
    file_url: file.file_url,
    size_bytes: file.size_bytes,
    caption: file.caption,
    carousel_text: file.carousel_text,
    description: file.description,
    approval_status: file.approval_status,
    visibility: file.visibility,
    status: file.status,
    parent_file_id: file.parent_file_id,
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}

export function orderEditorialFiles(
  root: EditorialFileQueryRow,
  children: readonly EditorialFileQueryRow[],
): SafeEditorialFile[] {
  const orderedChildren = [...children]
    .filter((child) => (
      child.parent_file_id === root.id
      && child.client_id === root.client_id
      && child.project_id === root.project_id
      && child.archived_at == null
    ))
    .sort(compareCarouselChildren);
  return [root, ...orderedChildren].map(toSafeEditorialFile);
}

export interface CalendarEntrySortKey {
  kind: "task" | "post";
  id: string;
  calendar_at: string | null;
  updated_at: string;
}

export function compareCalendarEntries(
  left: CalendarEntrySortKey,
  right: CalendarEntrySortKey,
) {
  if (left.calendar_at && right.calendar_at) {
    const calendarOrder = left.calendar_at.localeCompare(right.calendar_at);
    if (calendarOrder !== 0) return calendarOrder;
  } else if (left.calendar_at) {
    return -1;
  } else if (right.calendar_at) {
    return 1;
  }
  return (
    right.updated_at.localeCompare(left.updated_at)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
  );
}

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableCanonicalValue(entry)]),
  );
}

export async function editorialRequestFingerprint(
  value: Record<string, unknown>,
): Promise<string> {
  const canonical = JSON.stringify(stableCanonicalValue(value));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
