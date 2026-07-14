import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Download, Eye, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openFile, downloadFile } from "@/lib/fileActions";

/**
 * Prefetch images into browser cache so carousel navigation is instantaneous.
 * Call with the full sibling URL list when a preview modal opens.
 */
export function prefetchImages(urls: string[]) {
  if (typeof window === "undefined") return;
  urls.forEach((u) => {
    if (!u) return;
    const ext = u.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || "";
    if (!["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext)) return;
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  });
}

function InlineImage({ fileName, fileUrl }: { fileName: string; fileUrl: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    setZoomed(false);
  }, [fileUrl]);

  if (errored) {
    return (
      <div className="bg-secondary rounded-xl flex flex-col items-center justify-center py-10 gap-3">
        <FileText className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Não foi possível carregar. Tente novamente.</p>
        <Button size="sm" variant="outline" onClick={() => { setErrored(false); setLoaded(false); }}>
          Recarregar
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-secondary rounded-xl overflow-auto flex items-center justify-center ${zoomed ? "max-h-[80vh]" : "p-2"}`}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary/60 z-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={fileUrl}
        alt={fileName}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={() => setZoomed((z) => !z)}
        decoding="async"
        // @ts-expect-error fetchpriority is valid HTML but not yet in React typings
        fetchpriority="high"
        className={
          zoomed
            ? "w-auto max-w-none cursor-zoom-out select-none"
            : "max-w-full max-h-[70vh] object-contain rounded-lg cursor-zoom-in select-none"
        }
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
        className="absolute top-2 right-2 z-20 bg-background/80 hover:bg-background border border-border rounded-full p-1.5 shadow-sm"
        title={zoomed ? "Reduzir" : "Ampliar"}
      >
        {zoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

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

const OFFICE_EXTS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "odt", "ods", "odp"];
const isOffice = (fileName: string, fileUrl?: string) =>
  OFFICE_EXTS.includes(resolveExtension(fileName, fileUrl));

// Detect external video providers and convert to embeddable URL
export const getVideoEmbedUrl = (url: string): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // YouTube
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[2]}`;
    }
    // Vimeo
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    // Loom
    if (host.endsWith("loom.com")) {
      const m = u.pathname.match(/\/(share|embed)\/([\w-]+)/);
      if (m) return `https://www.loom.com/embed/${m[2]}`;
    }
    // Google Drive
    if (host.endsWith("drive.google.com")) {
      const m = u.pathname.match(/\/file\/d\/([\w-]+)/);
      const id = m?.[1] || u.searchParams.get("id");
      if (id) return `https://drive.google.com/file/d/${id}/preview`;
    }
    // Wistia
    if (host.endsWith("wistia.com") || host.endsWith("wistia.net")) {
      const m = u.pathname.match(/\/medias\/([\w-]+)/);
      if (m) return `https://fast.wistia.net/embed/iframe/${m[1]}`;
    }
  } catch { /* not a URL */ }
  return null;
};

export const isExternalVideoUrl = (url: string) => !!getVideoEmbedUrl(url);


interface Props {
  fileName: string;
  fileUrl: string;
}

export default function FilePreviewContent({ fileName, fileUrl }: Props) {
  // External video providers (YouTube/Vimeo/Loom/Drive/Wistia) — embed iframe, no storage cost
  const embedUrl = getVideoEmbedUrl(fileUrl);
  if (embedUrl) {
    return (
      <div className="bg-black rounded-xl overflow-hidden">
        <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={embedUrl}
            title={fileName}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  if (isImage(fileName, fileUrl)) {
    return <InlineImage fileName={fileName} fileUrl={fileUrl} />;
  }

  if (isPdf(fileName, fileUrl)) {
    return (
      <div className="rounded-xl overflow-hidden flex flex-col border border-border">
        {/* <object> is more reliable than <iframe> for cross-origin PDFs and supports
            inline fallback content for sandboxed environments where PDF plugin is blocked */}
        <object
          data={`${fileUrl}#toolbar=1&navpanes=0&view=FitH`}
          type="application/pdf"
          className="w-full h-[70vh] bg-white"
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
          className="w-full max-h-[70vh] rounded-lg"
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
