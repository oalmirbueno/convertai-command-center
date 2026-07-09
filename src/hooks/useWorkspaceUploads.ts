import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  mime: string;
  progress: number;   // 0..100
  status: "queued" | "uploading" | "done" | "error" | "canceled";
  error?: string;
  storagePath?: string;
  speed?: number;     // bytes/sec
  eta?: number;       // seconds
};

type StartArgs = {
  files: File[];
  scope: "global" | "client";
  clientId: string | null;
  parentId: string | null;
  userId: string;
  onDone?: () => void;
};

const CHUNK = 6 * 1024 * 1024; // Supabase resumable requirement
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function useWorkspaceUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const uploadsRef = useRef<Map<string, tus.Upload>>(new Map());
  const metaRef = useRef<Map<string, StartArgs & { file: File; ext: string; key: string }>>(new Map());

  const patch = (id: string, p: Partial<UploadItem>) =>
    setItems(prev => prev.map(x => (x.id === id ? { ...x, ...p } : x)));

  const runOne = useCallback(async (id: string) => {
    const meta = metaRef.current.get(id);
    if (!meta) return;
    const { file, key, scope, clientId, parentId, userId, onDone } = meta;

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) { patch(id, { status: "error", error: "Sessão expirada" }); return; }

    patch(id, { status: "uploading", progress: 0, error: undefined });

    const startedAt = Date.now();
    let lastLoaded = 0; let lastAt = startedAt;

    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1500, 3000, 6000, 12000, 24000],
      headers: {
        authorization: `Bearer ${token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK,
      metadata: {
        bucketName: "workspace",
        objectName: key,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (err: any) => {
        patch(id, { status: "error", error: err?.message || "Erro no envio" });
      },
      onProgress: (loaded, total) => {
        const now = Date.now();
        const dt = (now - lastAt) / 1000;
        const dl = loaded - lastLoaded;
        const speed = dt > 0.3 ? dl / dt : undefined;
        if (speed) { lastAt = now; lastLoaded = loaded; }
        const pct = total ? (loaded / total) * 100 : 0;
        const eta = speed && speed > 0 ? (total - loaded) / speed : undefined;
        patch(id, { progress: pct, speed, eta });
      },
      onSuccess: async () => {
        try {
          const { error: insErr } = await supabase.from("workspace_nodes").insert({
            name: file.name, kind: "file", scope,
            client_id: scope === "client" ? clientId : null,
            parent_id: parentId, mime: file.type || null,
            size_bytes: file.size, storage_path: key, created_by: userId,
          });
          if (insErr) throw insErr;
          patch(id, { status: "done", progress: 100, storagePath: key });
          uploadsRef.current.delete(id);
          onDone?.();
        } catch (e: any) {
          patch(id, { status: "error", error: e.message });
        }
      },
    });

    uploadsRef.current.set(id, upload);
    // Resume prior upload if any
    try {
      const previous = await upload.findPreviousUploads();
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    } catch {}
    upload.start();
  }, []);

  const enqueue = useCallback((args: StartArgs) => {
    const newItems: UploadItem[] = args.files.map(file => {
      const id = crypto.randomUUID();
      const ext = file.name.includes(".") ? file.name.split(".").pop()! : "bin";
      const key = `${args.scope}/${args.scope === "client" ? args.clientId : "global"}/${crypto.randomUUID()}.${ext}`;
      metaRef.current.set(id, { ...args, file, ext, key });
      return { id, name: file.name, size: file.size, mime: file.type, progress: 0, status: "queued" };
    });
    setItems(prev => [...newItems, ...prev]);
    // Kick off in parallel (browser will queue at network level)
    newItems.forEach(it => runOne(it.id));
  }, [runOne]);

  const cancel = useCallback((id: string) => {
    const up = uploadsRef.current.get(id);
    if (up) { up.abort(true).catch(() => {}); uploadsRef.current.delete(id); }
    patch(id, { status: "canceled" });
  }, []);

  const retry = useCallback((id: string) => {
    runOne(id);
  }, [runOne]);

  const clearDone = useCallback(() => {
    setItems(prev => prev.filter(x => x.status !== "done" && x.status !== "canceled"));
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(x => x.id !== id));
    metaRef.current.delete(id);
  }, []);

  return { items, enqueue, cancel, retry, clearDone, dismiss };
}
