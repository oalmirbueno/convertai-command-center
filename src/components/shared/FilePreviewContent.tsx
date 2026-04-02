import { ExternalLink, FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

const getFileExtension = (value?: string) => {
  if (!value) return "";
  const normalized = value.split("?")[0].split("#")[0];
  return normalized.split(".").pop()?.toLowerCase() || "";
};

const resolveExtension = (fileName: string, fileUrl?: string) =>
  getFileExtension(fileName) || getFileExtension(fileUrl);

const isImage = (fileName: string, fileUrl?: string) => {
  const ext = resolveExtension(fileName, fileUrl);
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (fileName: string, fileUrl?: string) => resolveExtension(fileName, fileUrl) === "pdf";

const isVideo = (fileName: string, fileUrl?: string) => {
  const ext = resolveExtension(fileName, fileUrl);
  return ["mp4", "webm", "mov"].includes(ext);
};

interface Props {
  fileName: string;
  fileUrl: string;
}

export default function FilePreviewContent({ fileName, fileUrl }: Props) {
  if (isImage(fileName)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden flex items-center justify-center p-2">
        <img
          src={fileUrl}
          alt={fileName}
          className="max-w-full max-h-[55vh] object-contain rounded-lg"
          loading="lazy"
        />
      </div>
    );
  }

  if (isPdf(fileName)) {
    return (
      <div className="rounded-xl overflow-hidden flex flex-col border border-border">
        <iframe
          src={`${fileUrl}#toolbar=1&navpanes=0&view=FitH`}
          className="w-full h-[55vh] border-0 bg-white"
          title={fileName}
        />
        <div className="flex items-center justify-center gap-4 py-2 bg-secondary/50 border-t border-border">
          <a href={fileUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <ExternalLink className="w-3 h-3" /> Nova aba
          </a>
          <a href={fileUrl} download className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <Download className="w-3 h-3" /> Baixar
          </a>
        </div>
      </div>
    );
  }

  if (isVideo(fileName)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden p-2">
        <video
          src={fileUrl}
          controls
          className="w-full max-h-[55vh] rounded-lg"
        />
      </div>
    );
  }

  // Generic file — nice card with actions
  return (
    <div className="bg-secondary rounded-xl flex flex-col items-center justify-center py-10 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <FileText className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">{fileName}</p>
        <p className="text-xs text-muted-foreground">Pré-visualização não disponível</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Abrir
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={fileUrl} download className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Baixar
          </a>
        </Button>
      </div>
    </div>
  );
}

export { isImage, isPdf, isVideo };
