import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { confirmStoredObject } from "@/lib/fileRecordActions";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  mime: string;
  progress: number;   // 0..100
  status: "queued" | "uploading" | "done" | "error" | "canceled";
  cancelable: boolean;
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
const FAST_PATH_MAX = 100 * 1024 * 1024;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function cleanupUnregisteredWorkspaceObject(key: string): Promise<"removed" | "registered"> {
  const { data: registered, error: lookupError } = await supabase
    .from("workspace_nodes")
    .select("id")
    .eq("storage_path", key)
    .limit(1);
  if (lookupError) {
    throw new Error("Falha ao confirmar o upload; o objeto foi preservado por segurança.");
  }
  if (registered?.length) return "registered";

  const { error: cleanupError } = await supabase.storage.from("workspace").remove([key]);
  if (cleanupError) {
    throw new Error("O registro falhou e o arquivo temporário não pôde ser removido.");
  }
  return "removed";
}

async function registerWorkspaceNode({
  key,
  file,
  scope,
  clientId,
  parentId,
  userId,
}: {
  key: string;
  file: File;
  scope: "global" | "client";
  clientId: string | null;
  parentId: string | null;
  userId: string;
}): Promise<"created" | "registered"> {
  const existing = await supabase
    .from("workspace_nodes")
    .select("id")
    .eq("storage_path", key)
    .limit(1);
  if (existing.error) {
    throw new Error("Falha ao confirmar o registro; o objeto foi preservado por segurança.");
  }
  if (existing.data?.length) return "registered";

  const { error: insertError } = await supabase.from("workspace_nodes").insert({
    name: file.name,
    kind: "file",
    scope,
    client_id: scope === "client" ? clientId : null,
    parent_id: parentId,
    mime: file.type || null,
    size_bytes: file.size,
    storage_path: key,
    created_by: userId,
  });
  if (!insertError) return "created";

  const recovered = await supabase
    .from("workspace_nodes")
    .select("id")
    .eq("storage_path", key)
    .limit(1);
  if (recovered.error) {
    throw new Error("Falha ao confirmar o registro; o objeto foi preservado por segurança.");
  }
  if (recovered.data?.length) return "registered";
  throw insertError;
}

export function useWorkspaceUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const uploadsRef = useRef<Map<string, tus.Upload>>(new Map());
  const metaRef = useRef<Map<string, StartArgs & { file: File; ext: string; key: string }>>(new Map());
  const finalizationsRef = useRef<Map<string, Promise<"created" | "registered">>>(new Map());
  const completedRef = useRef<Set<string>>(new Set());

  const patch = (id: string, p: Partial<UploadItem>) =>
    setItems(prev => prev.map(x => (x.id === id ? { ...x, ...p } : x)));

  const finalizeWorkspaceNode = useCallback((
    args: Parameters<typeof registerWorkspaceNode>[0],
  ) => {
    const existing = finalizationsRef.current.get(args.key);
    if (existing) return existing;
    const pending = registerWorkspaceNode(args).catch((error) => {
      if (finalizationsRef.current.get(args.key) === pending) {
        finalizationsRef.current.delete(args.key);
      }
      throw error;
    });
    finalizationsRef.current.set(args.key, pending);
    return pending;
  }, []);

  const runOne = useCallback(async (id: string) => {
    const meta = metaRef.current.get(id);
    if (!meta) return;
    const { file, key, scope, clientId, parentId, userId, onDone } = meta;
    const markDone = () => {
      if (completedRef.current.has(id)) return;
      completedRef.current.add(id);
      patch(id, { status: "done", progress: 100, storagePath: key });
      uploadsRef.current.delete(id);
      onDone?.();
    };

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) { patch(id, { status: "error", error: "Sessão expirada" }); return; }

    patch(id, { status: "uploading", progress: 0, error: undefined });

    // Fast path for small/medium files: direct upload avoids TUS handshake
    // overhead (create + PATCH per chunk) and is dramatically faster on the
    // typical marketing assets uploaded here (images, docs, short reels).
    // Single-PUT is reliable up to ~100 MB; larger goes through resumable TUS.
    if (file.size <= FAST_PATH_MAX) {
      let uploadedObject = false;
      let tick: ReturnType<typeof setInterval> | null = null;
      try {
        // Simulated smooth progress while the single PUT is in-flight — the
        // real byte-level progress is not exposed by supabase-js, so we ramp
        // to 90% and jump to 100% on success.
        let simulated = 0;
        tick = setInterval(() => {
          simulated = Math.min(90, simulated + (simulated < 40 ? 8 : 3));
          patch(id, { progress: simulated });
        }, 250);
        const { error } = await supabase.storage.from("workspace").upload(key, file, {
          cacheControl: "3600",
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) {
          const objectState = await confirmStoredObject("workspace", key);
          if (objectState === "missing") throw error;
          if (objectState === "unknown") {
            throw new Error(
              "O envio perdeu a confirmação; o objeto foi preservado e precisa ser conferido antes de tentar novamente.",
            );
          }
        }
        uploadedObject = true;
        await finalizeWorkspaceNode({
          key,
          file,
          scope,
          clientId,
          parentId,
          userId,
        });
        markDone();
      } catch (e: any) {
        if (uploadedObject) {
          try {
            const cleanup = await cleanupUnregisteredWorkspaceObject(key);
            if (cleanup === "registered") {
              markDone();
              return;
            }
          } catch (cleanupError: any) {
            patch(id, { status: "error", error: cleanupError?.message || e?.message || "Erro no envio" });
            return;
          }
        }
        patch(id, { status: "error", error: e?.message || "Erro no envio" });
      } finally {
        if (tick) clearInterval(tick);
      }
      return;
    }

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
        void (async () => {
          const objectState = await confirmStoredObject("workspace", key);
          if (objectState === "exists") {
            try {
              await finalizeWorkspaceNode({
                key,
                file,
                scope,
                clientId,
                parentId,
                userId,
              });
              markDone();
              return;
            } catch (registrationError: any) {
              try {
                const cleanup = await cleanupUnregisteredWorkspaceObject(key);
                if (cleanup === "registered") {
                  markDone();
                  return;
                }
              } catch (cleanupError: any) {
                patch(id, {
                  status: "error",
                  error: cleanupError?.message || registrationError?.message || "Erro no envio",
                });
                return;
              }
            }
          }
          patch(id, {
            status: "error",
            error: objectState === "unknown"
              ? "O envio perdeu a confirmação; o objeto foi preservado por segurança."
              : err?.message || "Erro no envio",
          });
        })();
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
          await finalizeWorkspaceNode({
            key,
            file,
            scope,
            clientId,
            parentId,
            userId,
          });
          markDone();
        } catch (e: any) {
          try {
            const cleanup = await cleanupUnregisteredWorkspaceObject(key);
            if (cleanup === "registered") {
              markDone();
              return;
            }
            patch(id, { status: "error", error: e?.message || "Erro ao registrar o arquivo" });
          } catch (cleanupError: any) {
            patch(id, { status: "error", error: cleanupError?.message || e?.message || "Erro no envio" });
          }
        }
      },
    });

    uploadsRef.current.set(id, upload);
    // Resume prior upload if any
    try {
      const previous = await upload.findPreviousUploads();
      const matchingUpload = previous.find(
        (candidate) =>
          candidate.metadata?.bucketName === "workspace"
          && candidate.metadata?.objectName === key,
      );
      if (matchingUpload) upload.resumeFromPreviousUpload(matchingUpload);
    } catch {
      // Resume discovery is opportunistic; a fresh upload remains safe.
    }
    upload.start();
  }, [finalizeWorkspaceNode]);


  const enqueue = useCallback((args: StartArgs) => {
    const newItems: UploadItem[] = args.files.map(file => {
      const id = crypto.randomUUID();
      const ext = file.name.includes(".") ? file.name.split(".").pop()! : "bin";
      const key = `${args.scope}/${args.scope === "client" ? args.clientId : "global"}/${crypto.randomUUID()}.${ext}`;
      metaRef.current.set(id, { ...args, file, ext, key });
      return {
        id,
        name: file.name,
        size: file.size,
        mime: file.type,
        progress: 0,
        status: "queued",
        cancelable: file.size > FAST_PATH_MAX,
      };
    });
    setItems(prev => [...newItems, ...prev]);
    // Kick off in parallel (browser will queue at network level)
    newItems.forEach(it => runOne(it.id));
  }, [runOne]);

  const cancel = useCallback((id: string) => {
    const meta = metaRef.current.get(id);
    if (!meta || meta.file.size <= FAST_PATH_MAX) return;
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
    const meta = metaRef.current.get(id);
    setItems(prev => prev.filter(x => x.id !== id));
    metaRef.current.delete(id);
    completedRef.current.delete(id);
    if (meta) finalizationsRef.current.delete(meta.key);
  }, []);

  return { items, enqueue, cancel, retry, clearDone, dismiss };
}
