import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Film } from "lucide-react";
import FilePreviewContent, { prefetchImages } from "@/components/shared/FilePreviewContent";
import { supabase } from "@/integrations/supabase/client";
import { isCarouselAssetGroup, mediaKindFromFile, useResolvedFileUrl } from "@/lib/fileUrls";

type Slide = {
  id?: string;
  file_name: string;
  file_url: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  extension?: string | null;
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

  useEffect(() => {
    let alive = true;
    if (!parent?.id) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path, mime_type, extension")
        .eq("parent_file_id", parent.id)
        .order("file_name", { ascending: true });
      if (!alive) return;
      if (data && data.length) setChildren(data);
    })();
    return () => { alive = false; };
  }, [parent?.id]);

  const files = useMemo(() => {
    const validChildren = isCarouselAssetGroup(parent, children) ? children : [];
    const list: Slide[] = [parent, ...validChildren.filter((c) => c.id !== parent.id)];
    // Natural sort by trailing number in filename so "slide 2" comes before "slide 10"
    const num = (s: string) => {
      const m = /(\d+)(?!.*\d)/.exec(s || "");
      return m ? parseInt(m[1], 10) : 0;
    };
    return [list[0], ...list.slice(1).sort((a, b) => num(a.file_name) - num(b.file_name) || a.file_name.localeCompare(b.file_name))];
  }, [parent, children]);

  useEffect(() => {
    prefetchImages(files.map((f) => f.file_url).filter(Boolean));
    setIdx(0);
  }, [files.length, parent?.id]);

  useEffect(() => {
    if (files.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + files.length) % files.length);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % files.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);

  const current = files[idx];
  if (!current) return null;
  if (files.length === 1) {
    return (
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={(current as any).id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type}
        extension={current.extension}
      />
    );
  }

  return (
    <div className="relative group">
      <FilePreviewContent
        fileName={current.file_name}
        fileUrl={current.file_url}
        fileId={(current as any).id}
        storageBucket={current.storage_bucket}
        storagePath={current.storage_path}
        mimeType={current.mime_type}
        extension={current.extension}
      />
      <button
        type="button"
        aria-label="Anterior"
        className="absolute z-10 left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + files.length) % files.length); }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label="Próximo"
        className="absolute z-10 right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-full p-2 shadow-md opacity-80 hover:opacity-100 transition-all"
        onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % files.length); }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {files.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ir para slide ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); setIdx(i); }}
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
