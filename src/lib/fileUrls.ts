import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type TransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

type ResolveInput = {
  fileUrl?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type UseResolvedInput = ResolveInput & {
  transform?: TransformOptions | null;
  expiresIn?: number;
};

const MCP_FILE_PREFIX = "mcp-files://";
const WORKSPACE_FILE_PREFIX = "workspace://";

export function isMcpFileUrl(value?: string | null) {
  return !!value && value.startsWith(MCP_FILE_PREFIX);
}

export function isWorkspaceFileUrl(value?: string | null) {
  return !!value && value.startsWith(WORKSPACE_FILE_PREFIX);
}

function storageRefFromStorageUrl(value?: string | null): { bucket: string; path: string } | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/";
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return null;
    const rest = url.pathname.slice(idx + marker.length);
    const parts = rest.split("/").filter(Boolean);
    if (parts[0] === "public" || parts[0] === "sign" || parts[0] === "authenticated") parts.shift();
    const bucket = parts.shift();
    const path = parts.join("/");
    if (!bucket || !path) return null;
    return { bucket: decodeURIComponent(bucket), path: decodeURIComponent(path) };
  } catch {
    return null;
  }
}

export function storageRefFromFile(input: ResolveInput): { bucket: string; path: string } | null {
  const bucket = input.storageBucket
    || (isMcpFileUrl(input.fileUrl) ? "mcp-files" : null)
    || (isWorkspaceFileUrl(input.fileUrl) ? "workspace" : null);
  const path = input.storagePath
    || (isMcpFileUrl(input.fileUrl) ? input.fileUrl!.slice(MCP_FILE_PREFIX.length) : null)
    || (isWorkspaceFileUrl(input.fileUrl) ? input.fileUrl!.slice(WORKSPACE_FILE_PREFIX.length) : null);
  if (!bucket || !path) return storageRefFromStorageUrl(input.fileUrl);
  return { bucket, path };
}

export function isDirectFileUrl(value?: string | null) {
  if (!value || value === "#") return false;
  return /^https?:\/\//i.test(value) || value.startsWith("blob:") || value.startsWith("data:");
}

export async function resolveFileUrl(input: UseResolvedInput): Promise<string> {
  const ref = storageRefFromFile(input);
  if (ref) {
    const options = input.transform ? { transform: input.transform } : undefined;
    const { data, error } = await (supabase.storage.from(ref.bucket) as any).createSignedUrl(
      ref.path,
      input.expiresIn || 3600,
      options,
    );
    if (error || !data?.signedUrl) {
      if (isDirectFileUrl(input.fileUrl)) return input.fileUrl!;
      throw error || new Error("URL indisponível");
    }
    return data.signedUrl;
  }
  if (isDirectFileUrl(input.fileUrl)) return input.fileUrl!;
  return input.fileUrl || "";
}

export function useResolvedFileUrl(input: UseResolvedInput) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const transformKey = useMemo(() => JSON.stringify(input.transform || null), [input.transform]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    setError(null);
    setUrl("");

    const ref = storageRefFromFile(input);
    if (!ref && isDirectFileUrl(input.fileUrl)) {
      setUrl(input.fileUrl!);
      return;
    }
    if (!ref && !input.fileUrl) return;

    setLoading(true);
    resolveFileUrl(input)
      .then((nextUrl) => {
        if (!alive) return;
        setUrl(nextUrl);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "Não foi possível carregar o arquivo.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.fileUrl, input.storageBucket, input.storagePath, input.expiresIn, transformKey, version]);

  return { url, loading, error, reload };
}

export function fileExtension(fileName?: string | null, fileUrl?: string | null, explicit?: string | null) {
  if (explicit) return explicit.replace(/^\./, "").toLowerCase();
  for (const value of [fileName, fileUrl].filter(Boolean) as string[]) {
    const clean = value.split("?")[0].split("#")[0];
    const matches = [...clean.matchAll(/\.([a-z0-9]{1,8})(?=$|[\s_\-()\[\]\/])/gi)];
    const ext = matches.length ? matches[matches.length - 1]?.[1]?.toLowerCase() : "";
    if (ext) return ext;
  }
  return "";
}

export function mediaKindFromFile(fileName?: string | null, fileUrl?: string | null, mime?: string | null, extension?: string | null) {
  const m = (mime || "").toLowerCase();
  const ext = fileExtension(fileName, fileUrl, extension);
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp"].includes(ext)) return "image";
  if (m.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "mkv", "avi"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "odt", "ods", "odp"].includes(ext)) return "office";
  if (m === "image" || m === "imagem" || m === "photo" || m === "foto") return "image";
  if (m === "video" || m === "vídeo") return "video";
  if (m === "audio" || m === "áudio") return "audio";
  if (m === "pdf") return "pdf";
  if (["documento", "contrato", "relatório", "relatorio", "doc", "office"].includes(m)) return "office";
  return "other";
}

type CarouselLikeFile = {
  file_name?: string | null;
  name?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  file_type?: string | null;
  mime?: string | null;
  extension?: string | null;
  caption?: string | null;
  carousel_text?: string | null;
  description?: string | null;
  folder?: string | null;
};

export function isCarouselAssetGroup(parent?: CarouselLikeFile | null, children: CarouselLikeFile[] = []) {
  if (!parent || children.length === 0) return false;
  const all = [parent, ...children];
  const allImages = all.every((file) =>
    mediaKindFromFile(
      file.file_name || file.name,
      file.file_url,
      file.mime_type || file.mime || file.file_type,
      file.extension,
    ) === "image"
  );
  if (!allImages) return false;
  const context = [
    parent.file_type,
    parent.caption,
    parent.carousel_text,
    parent.description,
    parent.file_name || parent.name,
    parent.folder,
  ].filter(Boolean).join(" ").toLowerCase();
  return /carrossel|carousel|slides?|sequ[eê]ncia|feed/.test(context) || children.length >= 1;
}