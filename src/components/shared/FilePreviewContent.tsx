import { ExternalLink, FileText, Download } from "lucide-react";

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
};

const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");

const isVideo = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["mp4", "webm", "mov"].includes(ext);
};

interface Props {
  fileName: string;
  fileUrl: string;
}

export default function FilePreviewContent({ fileName, fileUrl }: Props) {
  if (isImage(fileName)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden flex items-center justify-center">
        <img
          src={fileUrl}
          alt={fileName}
          className="max-w-full max-h-[60vh] object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  if (isPdf(fileName)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden flex flex-col">
        <iframe
          src={`${fileUrl}#toolbar=1&navpanes=0`}
          className="w-full h-[60vh] rounded-xl border-0"
          title={fileName}
        />
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-xs text-primary hover:underline py-2"
        >
          <ExternalLink className="w-3 h-3" /> Abrir em nova aba
        </a>
      </div>
    );
  }

  if (isVideo(fileName)) {
    return (
      <div className="bg-secondary rounded-xl overflow-hidden">
        <video
          src={fileUrl}
          controls
          className="w-full max-h-[60vh] rounded-xl"
        />
      </div>
    );
  }

  // Generic file
  return (
    <div className="bg-secondary rounded-xl flex flex-col items-center justify-center py-12 gap-3">
      <FileText className="w-10 h-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{fileName}</p>
      <a
        href={fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <Download className="w-4 h-4" /> Baixar arquivo
      </a>
    </div>
  );
}

export { isImage, isPdf, isVideo };
