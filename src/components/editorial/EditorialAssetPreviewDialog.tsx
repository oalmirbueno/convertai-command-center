import { Check, FileImage, Film, Images } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CarouselSlider from "@/components/shared/CarouselSlider";
import type { EditorialApprovedMediaAsset } from "@/lib/editorialMedia";

interface EditorialAssetPreviewDialogProps {
  asset: EditorialApprovedMediaAsset | null;
  open: boolean;
  selected?: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (asset: EditorialApprovedMediaAsset) => void;
}

const typeLabels = {
  static: "Post",
  carousel: "Carrossel",
  video: "Vídeo",
} as const;

export default function EditorialAssetPreviewDialog({
  asset,
  open,
  selected = false,
  disabled = false,
  onOpenChange,
  onSelect,
}: EditorialAssetPreviewDialogProps) {
  if (!asset) return null;

  const TypeIcon =
    asset.contentType === "carousel"
      ? Images
      : asset.contentType === "video"
        ? Film
        : FileImage;
  const [root, ...children] = asset.files;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-3rem)]">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {typeLabels[asset.contentType]}
            </Badge>
            {asset.contentType === "carousel" && (
              <Badge variant="secondary">{asset.files.length} arquivos</Badge>
            )}
          </div>
          <DialogTitle className="break-words pr-2 text-base sm:text-lg">
            {asset.root.file_name}
          </DialogTitle>
          <DialogDescription>
            Conteúdo completo, na mesma ordem usada no agendamento.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <CarouselSlider
            parent={{
              id: root?.id || asset.root.id,
              file_name: root?.file_name || asset.root.file_name,
              file_url: root?.file_url || asset.root.file_url || "",
              storage_bucket:
                root?.storage_bucket || asset.root.storage_bucket,
              storage_path: root?.storage_path || asset.root.storage_path,
              mime_type: root?.mime_type || asset.root.mime_type,
              extension: root?.extension || asset.root.extension,
            }}
            initialChildren={children.map((file) => ({
              id: file.id,
              file_name: file.file_name,
              file_url: file.file_url || "",
              storage_bucket: file.storage_bucket,
              storage_path: file.storage_path,
              mime_type: file.mime_type,
              extension: file.extension,
            }))}
          />

          {(asset.root.caption || asset.root.description) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {asset.root.caption && (
                <section className="rounded-xl border border-border bg-muted/20 p-4">
                  <h3 className="text-xs font-semibold text-foreground">
                    Legenda aprovada
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {asset.root.caption}
                  </p>
                </section>
              )}
              {asset.root.description && (
                <section className="rounded-xl border border-border bg-muted/20 p-4">
                  <h3 className="text-xs font-semibold text-foreground">
                    Direção do conteúdo
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {asset.root.description}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
          {onSelect && (
            <Button
              type="button"
              disabled={disabled || selected}
              onClick={() => {
                onSelect(asset);
                onOpenChange(false);
              }}
            >
              {selected && <Check className="mr-1.5 h-4 w-4" />}
              {selected ? "Conteúdo selecionado" : "Selecionar conteúdo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
