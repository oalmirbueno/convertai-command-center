import { ExternalLink, FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openFile, downloadFile } from "@/lib/fileActions";

const getFileExtension = (value?: string) => {
  if (!value) return "";
  const normalized = value.split("?")[0].split("#")[0];
  return normalized.split(".").pop()?.toLowerCase() || "";
};

const resolveExtension = (fileName: string, fileUrl?: string) =>
  getFileExtension(fileName) || getFileExtension(fileUrl);

const isImage = (fileName: string, fileUrl?: string) => {
  const ext = resolveExtension(fileName, fileUrl);
  return ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
};

const isPdf = (fileName: string, fileUrl?: string) => resolveExtension(fileName, fileUrl) === "pdf";

const isVideo = (fileName: string, fileUrl?: string) => {
  const ext = resolveExtension(fileName, fileUrl);
  return ["mp4", "webm", "mov", "m4v"].includes(ext);
};

const isAudio = (fileName: string, fileUrl?: string) => {
  const ext = resolveExtension(fileName, fileUrl);
  return ["mp3", "wav", "m4a", "ogg"].includes(ext);
};

interface Props {
  fileName: string;
  fileUrl: string;
}

export default function FilePreviewContent({ fileName, fileUrl }: Props) {
  if (isImage(fileName, fileUrl)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden flex items-center justify-center p-2">
        <img
          src={fileUrl}
          alt={fileName}
          className="max-w-full max-h-[55vh] object-contain rounded-lg cursor-zoom-in"
          loading="lazy"
          onClick={() => openFile(fileUrl)}
        />
      </div>
    );
  }

  if (isPdf(fileName, fileUrl)) {
    return (
      <div className="rounded-xl overflow-hidden flex flex-col border border-border">
        {/* <object> is more reliable than <iframe> for cross-origin PDFs and supports
            inline fallback content for sandboxed environments where PDF plugin is blocked */}
        <object
          data={`${fileUrl}#toolbar=1&navpanes=0&view=FitH`}
          type="application/pdf"
          className="w-full h-[55vh] bg-white"
        >
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-center bg-secondary">
            <FileText className="w-10 h-10 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              A pré-visualização inline não está disponível neste navegador.
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => openFile(fileUrl)} className="gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Abrir PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadFile(fileUrl, fileName)} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Baixar
              </Button>
            </div>
          </div>
        </object>
        <div className="flex items-center justify-center gap-4 py-2 bg-secondary/50 border-t border-border">
          <button
            type="button"
            onClick={() => openFile(fileUrl)}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Abrir em nova aba
          </button>
          <button
            type="button"
            onClick={() => downloadFile(fileUrl, fileName)}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Download className="w-3 h-3" /> Baixar
          </button>
        </div>
      </div>
    );
  }

  if (isVideo(fileName, fileUrl)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden p-2">
        <video
          src={fileUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-[55vh] rounded-lg"
        />
      </div>
    );
  }

  if (isAudio(fileName, fileUrl)) {
    return (
      <div className="bg-secondary rounded-xl p-6 flex flex-col items-center gap-3">
        <p className="text-sm font-medium text-foreground text-center break-all">{fileName}</p>
        <audio src={fileUrl} controls className="w-full" />
      </div>
    );
  }

  // Generic file — nice card with actions
  return (
    <div className="bg-secondary rounded-xl flex flex-col items-center justify-center py-10 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <FileText className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1 px-6">
        <p className="text-sm font-medium text-foreground break-all">{fileName}</p>
        <p className="text-xs text-muted-foreground">Pré-visualização não disponível neste formato</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => openFile(fileUrl)} className="gap-1.5">
          <Eye className="w-3.5 h-3.5" /> Abrir
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadFile(fileUrl, fileName)} className="gap-1.5">
          <Download className="w-3.5 h-3.5" /> Baixar
        </Button>
      </div>
    </div>
  );
}

export { isImage, isPdf, isVideo };
