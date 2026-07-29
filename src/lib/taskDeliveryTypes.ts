import {
  isEditorialTask,
  type TaskWorkstream,
} from "@/lib/taskWorkstreams";

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

export type TaskDeliveryType =
  (typeof TASK_DELIVERY_TYPE_VALUES)[number];

export const TASK_DELIVERY_TYPE_LABELS: Record<TaskDeliveryType, string> = {
  unspecified: "Não definido",
  design: "Design",
  branding: "Branding",
  static: "Post estático",
  carousel: "Carrossel",
  reel: "Reels",
  story: "Stories",
  video: "Vídeo",
  short: "Short",
  article: "Artigo",
  google_post: "Post Google",
  planning: "Planejamento",
  copywriting: "Copywriting",
  website: "Site",
  landing_page: "Landing page",
  automation: "Automação",
  traffic: "Tráfego",
  seo: "SEO",
  document: "Documento",
  report: "Relatório",
  other: "Outro",
};

export const TASK_DELIVERY_TYPE_OPTIONS = TASK_DELIVERY_TYPE_VALUES.map(
  (value) => ({
    value,
    label: TASK_DELIVERY_TYPE_LABELS[value],
  }),
);

const SUGGESTED_WORKSTREAMS: Record<TaskDeliveryType, TaskWorkstream> = {
  unspecified: "general",
  design: "design",
  branding: "design",
  static: "design",
  carousel: "design",
  reel: "video",
  story: "content",
  video: "video",
  short: "video",
  article: "content",
  google_post: "content",
  planning: "content",
  copywriting: "content",
  website: "development",
  landing_page: "development",
  automation: "development",
  traffic: "traffic",
  seo: "content",
  document: "general",
  report: "general",
  other: "general",
};

const PUBLISHABLE_DELIVERY_TYPES = new Set<TaskDeliveryType>([
  "design",
  "static",
  "carousel",
  "reel",
  "story",
  "video",
  "short",
  "article",
  "google_post",
]);

const EDITORIAL_CONTENT_TYPES: Partial<Record<TaskDeliveryType, string>> = {
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

const LEGACY_NON_PUBLISHABLE_SIGNALS = [
  /\b(?:branding|brandbook|identidade visual|logotipo|logo)\b/,
  /\b(?:planejamento|plano editorial|calendario editorial)\b/,
  /\b(?:site|website|landing page|pagina de captura)\b/,
  /\b(?:automacao|integracao|workflow)\b/,
  /\b(?:trafego|campanha paga|google ads|meta ads)\b/,
  /\b(?:seo|relatorio|dashboard|documento|contrato)\b/,
] as const;

interface PublishableTaskCandidate {
  delivery_type?: string | null;
  workstream?: string | null;
  assigned_to?: string | null;
  source?: string | null;
  title?: string | null;
  description?: string | null;
}

function isTaskDeliveryType(value?: string | null): value is TaskDeliveryType {
  return TASK_DELIVERY_TYPE_VALUES.includes(value as TaskDeliveryType);
}

function hasLegacyNonPublishableSignal(task: PublishableTaskCandidate) {
  const text = [task.title, task.description]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return LEGACY_NON_PUBLISHABLE_SIGNALS.some((signal) =>
    signal.test(text),
  );
}

export function suggestedWorkstreamForDeliveryType(
  deliveryType?: string | null,
): TaskWorkstream {
  return isTaskDeliveryType(deliveryType)
    ? SUGGESTED_WORKSTREAMS[deliveryType]
    : "general";
}

export function isPublishableDeliveryType(
  deliveryType?: string | null,
): boolean {
  return (
    isTaskDeliveryType(deliveryType)
    && PUBLISHABLE_DELIVERY_TYPES.has(deliveryType)
  );
}

export function contentTypeForDeliveryType(
  deliveryType?: string | null,
): string | null {
  return isTaskDeliveryType(deliveryType)
    ? EDITORIAL_CONTENT_TYPES[deliveryType] || null
    : null;
}

export function isPublishableTask(
  task: PublishableTaskCandidate,
  designMemberIds: ReadonlySet<string>,
): boolean {
  const source = task.source?.toLocaleLowerCase("pt-BR") || "";
  if (source.startsWith("client_request:")) return false;

  const deliveryType = task.delivery_type?.toLocaleLowerCase("pt-BR");
  if (deliveryType && deliveryType !== "unspecified") {
    return isPublishableDeliveryType(deliveryType);
  }
  if (hasLegacyNonPublishableSignal(task)) return false;

  return isEditorialTask(task, designMemberIds);
}
