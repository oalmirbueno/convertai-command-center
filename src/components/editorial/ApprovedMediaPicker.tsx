import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Eye,
  FileImage,
  Film,
  Images,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EditorialAssetPreviewDialog from "@/components/editorial/EditorialAssetPreviewDialog";
import { cn } from "@/lib/utils";
import {
  buildApprovedMediaAssets,
  filterApprovedMediaAssets,
  type EditorialApprovedMediaAsset,
  type EditorialMediaContentType,
  type EditorialMediaFile,
} from "@/lib/editorialMedia";
import { mediaKindFromFile, useResolvedFileUrl } from "@/lib/fileUrls";

interface ApprovedMediaPickerProps {
  files: readonly EditorialMediaFile[];
  usedRootFileIds?: readonly string[];
  currentRootFileId?: string | null;
  selectedFileId?: string | null;
  onSelect: (asset: EditorialApprovedMediaAsset) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onRetry?: () => void;
  className?: string;
}

const contentTypeLabels = {
  static: "Post",
  carousel: "Carrossel",
  video: "Vídeo",
} as const;
const EMPTY_FILE_IDS: readonly string[] = [];
const mediaFilters: Array<{
  value: EditorialMediaContentType | "all";
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "carousel", label: "Carrosséis" },
  { value: "static", label: "Posts" },
  { value: "video", label: "Vídeos" },
];

function MediaPreview({
  file,
  className,
}: {
  file: EditorialMediaFile;
  className?: string;
}) {
  const kind = mediaKindFromFile(
    file.file_name,
    file.file_url,
    file.mime_type || file.file_type,
    file.extension,
  );
  const { url, loading, error } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    transform:
      kind === "image" ? { width: 640, quality: 76, resize: "cover" } : null,
    expiresIn: 3600,
  });

  return (
    <span
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-secondary",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : url && kind === "image" ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : url && kind === "video" ? (
        <>
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Film className="h-5 w-5 text-white drop-shadow" />
          </span>
        </>
      ) : (
        <span title={error || undefined}>
          {kind === "video" ? (
            <Film className="h-5 w-5 text-muted-foreground" />
          ) : (
            <FileImage className="h-5 w-5 text-muted-foreground" />
          )}
        </span>
      )}
    </span>
  );
}

function AssetPreview({ asset }: { asset: EditorialApprovedMediaAsset }) {
  const visibleFiles = asset.files.slice(0, 3);

  if (visibleFiles.length === 1) {
    return <MediaPreview file={visibleFiles[0]} className="h-full w-full" />;
  }

  return (
    <span className="grid h-full w-full grid-cols-3 gap-px bg-border">
      {visibleFiles.map((file) => (
        <MediaPreview key={file.id} file={file} className="h-full" />
      ))}
    </span>
  );
}

export default function ApprovedMediaPicker({
  files,
  usedRootFileIds = EMPTY_FILE_IDS,
  currentRootFileId = null,
  selectedFileId = null,
  onSelect,
  loading = false,
  error = null,
  disabled = false,
  onRetry,
  className,
}: ApprovedMediaPickerProps) {
  const [search, setSearch] = useState("");
  const [contentType, setContentType] = useState<
    EditorialMediaContentType | "all"
  >("all");
  const [previewAsset, setPreviewAsset] =
    useState<EditorialApprovedMediaAsset | null>(null);
  const assets = useMemo(
    () =>
      buildApprovedMediaAssets(files, {
        usedRootFileIds,
        currentRootFileId,
      }),
    [currentRootFileId, files, usedRootFileIds],
  );
  const visibleAssets = useMemo(
    () => filterApprovedMediaAssets(assets, search, contentType),
    [assets, contentType, search],
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={disabled || loading}
            className="h-11 pl-9"
            aria-label="Buscar mídia aprovada"
            placeholder="Buscar por título, legenda ou slide"
          />
        </div>
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Filtrar conteúdo por formato"
        >
          {mediaFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              disabled={disabled || loading}
              aria-pressed={contentType === filter.value}
              onClick={() => setContentType(filter.value)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
                contentType === filter.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Carregando mídia aprovada"
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="overflow-hidden rounded-xl border border-border"
            >
              <div className="aspect-[4/3] animate-pulse bg-secondary" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-center rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-6 text-center"
        >
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p className="mt-2 text-xs text-muted-foreground">{error}</p>
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRetry}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          )}
        </div>
      ) : visibleAssets.length > 0 ? (
        <div className="grid max-h-[420px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAssets.map((asset) => {
            const selected = selectedFileId === asset.id;
            const TypeIcon =
              asset.contentType === "carousel"
                ? Images
                : asset.contentType === "video"
                  ? Film
                  : FileImage;

            return (
              <article
                key={asset.id}
                className={cn(
                  "group overflow-hidden rounded-xl border bg-card text-left [content-visibility:auto] transition-[border-color,box-shadow] hover:border-primary/45 hover:shadow-md",
                  selected
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-border",
                )}
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Ver ${asset.root.file_name} completo`}
                  onClick={() => setPreviewAsset(asset)}
                  className="relative block aspect-[4/3] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AssetPreview asset={asset} />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                    <TypeIcon className="h-3 w-3" />
                    {contentTypeLabels[asset.contentType]}
                    {asset.contentType === "carousel"
                      ? ` · ${asset.files.length}`
                      : ""}
                  </span>
                  {selected && (
                    <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/20 bg-black/70 px-2.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    Ver completo
                  </span>
                </button>
                <div className="block min-w-0 p-3">
                  <span
                    className="block truncate text-xs font-semibold text-foreground"
                    title={asset.root.file_name}
                  >
                    {asset.root.file_name}
                  </span>
                  <span className="mt-1 line-clamp-2 block min-h-8 text-[10px] leading-4 text-muted-foreground">
                    {asset.root.caption ||
                      asset.root.description ||
                      "Mídia aprovada e pronta para publicação"}
                  </span>
                  <Button
                    type="button"
                    variant={selected ? "secondary" : "outline"}
                    size="sm"
                    disabled={disabled || selected}
                    className="mt-3 h-10 w-full"
                    onClick={() => onSelect(asset)}
                  >
                    {selected && <Check className="mr-1.5 h-4 w-4" />}
                    {selected ? "Selecionado" : "Selecionar"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-8 text-center">
          <FileImage className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-2 text-xs font-medium text-foreground">
            {search
              ? "Nenhuma mídia aprovada corresponde à busca"
              : "Nenhuma mídia aprovada disponível"}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {search || contentType !== "all"
              ? "Limpe a busca ou troque o filtro para ver outros conteúdos."
              : "Só aparecem conteúdos com aprovação interna e do cliente."}
          </p>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {visibleAssets.length} conteúdo
        {visibleAssets.length === 1 ? " encontrado" : "s encontrados"}
      </p>

      <EditorialAssetPreviewDialog
        asset={previewAsset}
        open={!!previewAsset}
        selected={previewAsset?.id === selectedFileId}
        disabled={disabled}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPreviewAsset(null);
        }}
        onSelect={onSelect}
      />
    </div>
  );
}
