import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Film } from "lucide-react";
import FilePreviewContent, { prefetchImages } from "@/components/shared/FilePreviewContent";
import { supabase } from "@/integrations/supabase/client";
import { orderEditorialCarouselFiles } from "@/lib/editorialMedia";
import { isCarouselAssetGroup, mediaKindFromFile, useResolvedFileUrl } from "@/lib/fileUrls";

type Slide = {
  id?: string;
  file_name: string;
  file_url: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  extension?: string | null;
  created_at?: string | null;
};

/**
 * Robust carousel preview. Always fetches sibling slides directly from the DB
 * so a parent's children never go missing (previous versions relied on a
 * hook-cached childrenMap which could be empty during a refetch window).
 */
export default function CarouselSlider({
  parent,
  initialChildren,
}: {
  parent: Slide & { id?: string };
  initialChildren?: Slide[];
}) {
  const [children, setChildren] = useState<Slide[]>(initialChildren || []);
  const [idx, setIdx] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    if (initialChildren !== undefined) {
      setChildren(initialChildren);
      return () => {
        alive = false;
      };
    }
    if (!parent?.id) return;
    (async () => {
      const { data } = await supabase
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path, mime_type, extension, created_at")
        .eq("parent_file_id", parent.id)
        .order("file_name", { ascending: true });
      if (!alive) return;
      if (data && data.length) setChildren(data);
    })();
    return () => { alive = false; };
  }, [initialChildren, parent?.id]);

  const files = useMemo(() => {
    const validChildren = isCarouselAssetGroup(parent, children) ? children : [];
    const list: Slide[] = [parent, ...validChildren.filter((c) => c.id !== parent.id)];
    if (initialChildren !== undefined) return list;

    return orderEditorialCarouselFiles(
      { ...parent, id: parent.id || "carousel-root" },
      list.slice(1).map((file, index) => ({
        ...file,
        id: file.id || `carousel-child-${index}`,
      })),
    );
  }, [children, initialChildren, parent]);

  useEffect(() => {
    prefetchImages(files.map((f) => f.file_url).filter(Boolean));
    setIdx(0);
  }, [files, parent?.id]);

  const current = files[idx];
  if (!current) return null;
  if (files.length === 1) {
    return (
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={current.id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type}
        extension={current.extension}
      />
    );
  }

  return (
    <div
      className="relative group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      role="group"
      aria-label={`Prévia de ${files.length} arquivos. Use as setas para navegar.`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setIdx((currentIndex) =>
            (currentIndex - 1 + files.length) % files.length,
          );
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setIdx((currentIndex) => (currentIndex + 1) % files.length);
        }
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStartRef.current;
        const touch = event.changedTouches[0];
        touchStartRef.current = null;
        if (!start || !touch) return;
        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) {
          return;
        }
        setIdx((currentIndex) =>
          deltaX > 0
            ? (currentIndex - 1 + files.length) % files.length
            : (currentIndex + 1) % files.length,
        );
      }}
    >
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={current.id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type}
        extension={current.extension}
      />
      <button
        type="button"
        aria-label="Anterior"
        className="absolute left-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 p-0 opacity-80 shadow-md transition-all hover:bg-background hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + files.length) % files.length); }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label="Próximo"
        className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 p-0 opacity-80 shadow-md transition-all hover:bg-background hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % files.length); }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {files.map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`w-2 h-2 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
        ))}
      </div>
      <span className="absolute z-10 top-2 right-2 bg-background/80 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground">
        {idx + 1}/{files.length}
      </span>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
        {files.map((file, i) => (
          <button
            key={file.id || `${file.file_name}-${i}`}
            type="button"
            aria-label={`Abrir item ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); setIdx(i); }}
            className={`relative flex w-24 h-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-secondary transition-all ${
              i === idx ? "border-primary ring-1 ring-primary/50" : "border-border hover:border-primary/40"
            }`}
          >
            <SlideThumb slide={file} />
            <span className="absolute bottom-1 right-1 rounded bg-background/80 px-1 text-[9px] font-mono text-muted-foreground">
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SlideThumb({ slide }: { slide: Slide }) {
  const kind = mediaKindFromFile(slide.file_name, slide.file_url, slide.mime_type, slide.extension);
  const { url } = useResolvedFileUrl({
    fileUrl: slide.file_url,
    storageBucket: slide.storage_bucket,
    storagePath: slide.storage_path,
    transform: kind === "image" ? { width: 320, height: 320, quality: 70, resize: "cover" } : null,
    expiresIn: 3600,
  });

  if (url && kind === "image") return <img src={url} alt={slide.file_name} loading="lazy" className="h-full w-full object-cover" />;
  if (url && kind === "video") {
    return (
      <>
        <video src={`${url}#t=0.1`} muted playsInline preload="none" className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-background/30">
          <Film className="h-5 w-5 text-foreground" />
        </div>
      </>
    );
  }
  return <FileText className="h-7 w-7 text-muted-foreground" />;
}
