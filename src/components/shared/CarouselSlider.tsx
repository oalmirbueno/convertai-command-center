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
 * Ordem das lâminas no slider: a capa e depois as filhas pela ordem real do
 * carrossel (orderEditorialCarouselFiles: número no caminho, "(2/10)" no
 * nome, e só então a data). Vale também quando quem chama já manda as
 * filhas (initialChildren): elas chegavam na ordem de criação decrescente
 * (capa, N, N-1...) e o slider mostrava o carrossel de trás para frente.
 */
export function ordenarLaminasDoCarrossel<T extends Slide>(parent: T, children: T[]): T[] {
  const validChildren = isCarouselAssetGroup(parent, children) ? children : [];
  const filhas = validChildren.filter((c) => c.id !== parent.id);
  return orderEditorialCarouselFiles(
    { ...parent, id: parent.id || "carousel-root" },
    filhas.map((file, index) => ({
      ...file,
      id: file.id || `carousel-child-${index}`,
    })),
  ) as unknown as T[];
}

/** A lâmina em texto: o que importa para mostrar e baixar, sem depender do objeto. */
function assinaturaDaLamina(f?: Slide | null): string {
  if (!f) return "";
  return [f.id || "", f.file_url || "", f.storage_bucket || "", f.storage_path || "", f.mime_type || "", f.extension || "", f.file_name || "", f.created_at || ""].join("|");
}

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

  // Quem chama costuma montar `parent` e `initialChildren` de novo a cada
  // desenho (a Agenda relê a cada 15 e 30 s). Comparar pelo conteúdo, e não
  // pelo objeto, evita voltar sozinho para a 1ª lâmina e assinar e baixar
  // todas as lâminas de novo a cada releitura.
  const chavePai = assinaturaDaLamina(parent);
  const chaveFilhas = initialChildren === undefined ? null : initialChildren.map(assinaturaDaLamina).join("\n");

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
  // Lê o initialChildren atual; só recarrega quando o conteúdo muda de verdade.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFilhas, parent?.id]);

  // Com initialChildren, usa as filhas que chegaram agora (sem um desenho com
  // a capa nova e as filhas antigas enquanto o efeito acima não roda).
  const filhas = initialChildren !== undefined ? initialChildren : children;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const files = useMemo(() => ordenarLaminasDoCarrossel<Slide>(parent, filhas), [children, chavePai, chaveFilhas]);
  const chaveArquivos = files.map(assinaturaDaLamina).join("\n");

  // Mesmo bucket/caminho e 3600 s da prévia visível: as duas recebem a mesma
  // URL assinada e o navegador baixa o original uma vez só (E05, 30/09).
  useEffect(() => {
    prefetchImages(files.filter((f) => !!f.file_url).map((f) => ({ fileUrl: f.file_url, storageBucket: f.storage_bucket, storagePath: f.storage_path })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveArquivos]);

  // Volta para a 1ª lâmina só quando o carrossel muda (outro carrossel,
  // lâmina nova ou removida, arquivo trocado), e não a cada desenho.
  useEffect(() => {
    setIdx(0);
  }, [chaveArquivos]);

  // Lâmina removida: no desenho entre a mudança e a volta para a 1ª, o
  // índice pode passar do fim; a prévia não some por isso.
  const aberta = Math.min(idx, Math.max(0, files.length - 1));
  const current = files[aberta];
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
        onClick={(e) => { e.stopPropagation(); setIdx((aberta - 1 + files.length) % files.length); }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label="Próximo"
        className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 p-0 opacity-80 shadow-md transition-all hover:bg-background hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); setIdx((aberta + 1) % files.length); }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {files.map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`w-2 h-2 rounded-full transition-colors ${i === aberta ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
        ))}
      </div>
      <span className="absolute z-10 top-2 right-2 bg-background/80 text-[10px] px-2 py-0.5 rounded-md text-muted-foreground">
        {aberta + 1}/{files.length}
      </span>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
        {files.map((file, i) => (
          <button
            key={file.id || `${file.file_name}-${i}`}
            type="button"
            aria-label={`Abrir item ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); setIdx(i); }}
            className={`relative flex w-24 h-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-secondary transition-all ${
              i === aberta ? "border-primary ring-1 ring-primary/50" : "border-border hover:border-primary/40"
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
    miniatura: kind === "image",
    expiresIn: 3600,
  });

  if (url && kind === "image") return <img src={url} alt={slide.file_name} loading="lazy" decoding="async" className="h-full w-full object-cover" />;
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
