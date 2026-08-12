import { isEditorialFileEditable, isFilePublishable } from "@/lib/editorial";
import { mediaKindFromFile } from "@/lib/fileUrls";

export type EditorialMediaContentType = "static" | "carousel" | "video";

export interface EditorialMediaFile {
  id: string;
  client_id?: string | null;
  project_id?: string | null;
  file_name: string;
  file_url?: string | null;
  file_type?: string | null;
  mime_type?: string | null;
  extension?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  caption?: string | null;
  carousel_text?: string | null;
  description?: string | null;
  created_at?: string | null;
  parent_file_id?: string | null;
  agency_approval_status?: string | null;
  approval_status?: string | null;
  visibility?: string | null;
  locked_at?: string | null;
  status?: string | null;
  archived_at?: string | null;
}

export interface EditorialApprovedMediaAsset {
  id: string;
  root: EditorialMediaFile;
  files: EditorialMediaFile[];
  contentType: EditorialMediaContentType;
}

export interface BuildApprovedMediaAssetsOptions {
  usedRootFileIds?: Iterable<string> | null;
  currentRootFileId?: string | null;
}

function activeFile(file: EditorialMediaFile) {
  return (
    file.archived_at == null && (file.status == null || file.status === "ready")
  );
}

function fileMediaKind(file: EditorialMediaFile) {
  return mediaKindFromFile(
    file.file_name,
    file.file_url,
    file.mime_type || file.file_type,
    file.extension,
  );
}

function sameAssetScope(root: EditorialMediaFile, child: EditorialMediaFile) {
  return (
    (root.client_id == null ||
      child.client_id == null ||
      root.client_id === child.client_id) &&
    (root.project_id == null ||
      child.project_id == null ||
      root.project_id === child.project_id)
  );
}

function numericOrderFromPath(value?: string | null) {
  if (!value) return null;
  const lastSegment = value.split(/[\\/]/).filter(Boolean).at(-1) || value;
  const leading = lastSegment.match(/^(\d+)(?=[\s._-])/);
  if (leading) return Number(leading[1]);
  return null;
}

function numericOrderFromName(value?: string | null) {
  if (!value) return null;

  const fraction = value.match(/\((\d+)\s*\/\s*\d+\)/);
  if (fraction) return Number(fraction[1]);

  const labelled = value.match(/(?:card|slide|p[aá]gina|page)[\s._-]*(\d+)/i);
  if (labelled) return Number(labelled[1]);

  const leading = value.match(/^(\d+)(?=[\s._-])/);
  return leading ? Number(leading[1]) : null;
}

export function editorialMediaOrderIndex(file: EditorialMediaFile) {
  return (
    numericOrderFromPath(file.storage_path) ??
    numericOrderFromName(file.file_name)
  );
}

function compareFallback(left: EditorialMediaFile, right: EditorialMediaFile) {
  const leftTime = left.created_at ? Date.parse(left.created_at) : Number.NaN;
  const rightTime = right.created_at
    ? Date.parse(right.created_at)
    : Number.NaN;
  const safeLeftTime = Number.isNaN(leftTime)
    ? Number.MAX_SAFE_INTEGER
    : leftTime;
  const safeRightTime = Number.isNaN(rightTime)
    ? Number.MAX_SAFE_INTEGER
    : rightTime;

  return safeLeftTime - safeRightTime || left.id.localeCompare(right.id);
}

export function orderEditorialCarouselFiles(
  root: EditorialMediaFile,
  children: readonly EditorialMediaFile[],
) {
  const orderedChildren = [...children].sort((left, right) => {
    const leftIndex = editorialMediaOrderIndex(left);
    const rightIndex = editorialMediaOrderIndex(right);

    if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    if (leftIndex != null && rightIndex == null) return -1;
    if (leftIndex == null && rightIndex != null) return 1;
    return compareFallback(left, right);
  });

  return [root, ...orderedChildren];
}

export function inferEditorialMediaContentType(
  root: EditorialMediaFile,
  children: readonly EditorialMediaFile[],
): EditorialMediaContentType | null {
  const rootKind = fileMediaKind(root);
  if (rootKind === "video") return "video";
  if (rootKind !== "image") return null;

  return children.some((child) => fileMediaKind(child) === "image")
    ? "carousel"
    : "static";
}

export function buildApprovedMediaAssets(
  files: readonly EditorialMediaFile[],
  options: BuildApprovedMediaAssetsOptions = {},
) {
  const usedRootFileIds = new Set(options.usedRootFileIds || []);
  const childrenByRootId = new Map<string, EditorialMediaFile[]>();

  for (const file of files) {
    if (!file.parent_file_id || !activeFile(file)) continue;
    const current = childrenByRootId.get(file.parent_file_id) || [];
    current.push(file);
    childrenByRootId.set(file.parent_file_id, current);
  }

  return files
    .filter((file) => !file.parent_file_id)
    .filter(activeFile)
    // Anexável = já aprovado (reuso) OU rascunho interno editável, espelhando a
    // regra do servidor (file_is_editable no save). O gate de aprovação completa
    // continua obrigatório na hora de agendar/publicar - nada muda na segurança.
    .filter((root) => isFilePublishable(root) || isEditorialFileEditable(root))
    .filter(
      (root) =>
        !usedRootFileIds.has(root.id) || root.id === options.currentRootFileId,
    )
    .flatMap<EditorialApprovedMediaAsset>((root) => {
      const rootKind = fileMediaKind(root);
      if (rootKind !== "image" && rootKind !== "video") return [];

      const children =
        rootKind === "image"
          ? (childrenByRootId.get(root.id) || []).filter(
              (child) =>
                sameAssetScope(root, child) && fileMediaKind(child) === "image",
            )
          : [];
      const contentType = inferEditorialMediaContentType(root, children);
      if (!contentType) return [];

      return [
        {
          id: root.id,
          root,
          files:
            contentType === "carousel"
              ? orderEditorialCarouselFiles(root, children)
              : [root],
          contentType,
        },
      ];
    })
    .sort(
      (left, right) =>
        compareFallback(right.root, left.root) ||
        left.root.file_name.localeCompare(right.root.file_name, "pt-BR"),
    );
}

function normalizeSearch(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterApprovedMediaAssets(
  assets: readonly EditorialApprovedMediaAsset[],
  query: string,
  contentType: EditorialMediaContentType | "all" = "all",
) {
  const normalizedQuery = normalizeSearch(query);

  return assets.filter((asset) => {
    if (contentType !== "all" && asset.contentType !== contentType) {
      return false;
    }
    if (!normalizedQuery) return true;

    const searchable = normalizeSearch(
      [
        asset.root.file_name,
        asset.root.caption,
        asset.root.carousel_text,
        asset.root.description,
        asset.contentType,
        ...asset.files.map((file) => file.file_name),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return searchable.includes(normalizedQuery);
  });
}
