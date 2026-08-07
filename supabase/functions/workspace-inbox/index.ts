// Public, token-scoped inbox for Workspace folders. The database serializes
// reservations per token generation before bytes reach Storage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  canonicalInboxMime,
  createCountingInboxStream,
  isUuid,
  mapInboxDatabaseError,
  parseLegacyWorkspaceInboxMultipart,
  safeFileExtension,
  sanitizeInboxText,
  WORKSPACE_INBOX_MAX_FILE_BYTES,
  WorkspaceInboxRequestError,
} from "../_shared/workspace-inbox-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-inbox-token, x-inbox-request-id, x-inbox-file-name, x-inbox-sender",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // EXPAND compatibility: the current UI uses the header, while the previously
  // published UI still sends ?token=. Remove the query fallback only in the
  // later CUTOVER, after production traffic confirms the header-only client.
  const token = req.headers.get("x-inbox-token") ||
    new URL(req.url).searchParams.get("token") || "";
  if (!isUuid(token)) return inboxError("invalid_or_expired_link", "Link inválido, revogado ou expirado.", 404);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: inspection, error: inspectionError } = await admin.rpc(
    "inspect_workspace_inbox",
    { p_token: token },
  );
  if (inspectionError || !inspection) {
    return databaseError(inspectionError?.message || "INBOX_INVALID_TOKEN");
  }

  if (req.method === "GET") return json(inspection);

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let uploadBody: ReadableStream<Uint8Array>;
  let uploadSize: number;
  let requestId: string;
  let originalInput: string;
  let senderInput: string;

  const isLegacyMultipart = (req.headers.get("content-type") || "")
    .toLowerCase()
    .startsWith("multipart/form-data");

  if (isLegacyMultipart) {
    try {
      const legacy = await parseLegacyWorkspaceInboxMultipart(req);
      uploadBody = legacy.body;
      uploadSize = legacy.sizeBytes;
      requestId = legacy.requestId;
      originalInput = legacy.originalName;
      senderInput = legacy.sender;
    } catch (error) {
      if (error instanceof WorkspaceInboxRequestError) {
        return inboxError(error.code, error.message, error.status);
      }
      return inboxError("invalid_upload", "Não foi possível ler o envio.", 400);
    }
  } else {
    const contentLength = Number(req.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      return inboxError("length_required", "O tamanho do envio é obrigatório.", 411);
    }
    if (contentLength > WORKSPACE_INBOX_MAX_FILE_BYTES) {
      return inboxError("file_too_large", "O arquivo excede o limite de 25 MB.", 413);
    }
    if (!req.body) return inboxError("missing_file", "Selecione um arquivo.", 400);

    uploadBody = req.body;
    uploadSize = contentLength;
    requestId = req.headers.get("x-inbox-request-id") || "";
    originalInput = decodeHeader(req.headers.get("x-inbox-file-name"));
    senderInput = decodeHeader(req.headers.get("x-inbox-sender"));
  }

  if (!originalInput) return inboxError("missing_file_name", "O nome do arquivo é obrigatório.", 400);
  const extension = safeFileExtension(originalInput);
  if (!extension) {
    return inboxError("blocked_file_type", "Este tipo de arquivo não é aceito.", 415);
  }

  if (!isUuid(requestId)) {
    return inboxError("invalid_request_id", "Identificador de envio inválido.", 400);
  }

  const declaredMime = canonicalInboxMime(extension);
  const sender = sanitizeInboxText(senderInput, 80);
  const originalName = sanitizeInboxText(originalInput, sender ? 150 : 220) || `arquivo.${extension}`;
  const displayName = sender ? `[${sender}] ${originalName}` : originalName;

  // The binary protocol reaches this reservation before its body is consumed.
  // The temporary legacy multipart bridge was already parsed under a strict
  // byte ceiling and now joins the same quota and quarantine flow.
  const { data: reservation, error: reserveError } = await admin.rpc(
    "reserve_workspace_inbox_upload",
    {
      p_token: token,
      p_size_bytes: uploadSize,
      p_request_id: requestId,
      p_extension: extension,
    },
  );
  if (reserveError || !reservation) {
    return databaseError(reserveError?.message || "INBOX_INVALID_TOKEN");
  }

  if (reservation.status === "completed") {
    return json({ ok: true, idempotent: true, node_id: reservation.node_id });
  }

  const reservationId = String(reservation.reservation_id || "");
  const key = String(reservation.storage_path || "");
  if (!isUuid(reservationId) || !key) {
    return inboxError("invalid_reservation", "Não foi possível iniciar o envio.", 500);
  }

  // Count the real stream while forwarding it. A forged Content-Length cannot
  // make Storage accept more than the reservation or the 25 MiB hard limit.
  const countedBody = createCountingInboxStream(uploadBody, uploadSize);
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(storageObjectUrl(key), {
      method: "POST",
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "content-type": declaredMime,
        "cache-control": "no-store",
        "x-upsert": "false",
      },
      body: countedBody.stream,
    });
  } catch {
    const { error: cleanupError } = await admin.storage.from("workspace").remove([key]);
    const violation = countedBody.violation();
    await cancelReservation(
      admin,
      reservationId,
      violation || "storage_upload_failed",
      Boolean(cleanupError),
    );
    if (violation === "max_size") {
      return inboxError("file_too_large", "O arquivo excede o limite de 25 MB.", 413);
    }
    if (violation === "declared_length") {
      return inboxError("size_mismatch", "O tamanho recebido não confere com o envio.", 400);
    }
    return inboxError("upload_failed", "O armazenamento recusou o envio. Tente novamente.", 502);
  }
  await uploadResponse.body?.cancel().catch(() => undefined);

  const storedSize = await storageObjectSize(admin, key);
  if (!uploadResponse.ok && storedSize === null) {
    await cancelReservation(admin, reservationId, "storage_upload_failed", false);
    console.error("workspace-inbox storage upload failed", { reservationId });
    return inboxError("upload_failed", "O armazenamento recusou o envio. Tente novamente.", 502);
  }

  if (countedBody.bytesRead() !== uploadSize || storedSize !== uploadSize) {
    const { error: cleanupError } = await admin.storage.from("workspace").remove([key]);
    await cancelReservation(
      admin,
      reservationId,
      "stored_size_mismatch",
      Boolean(cleanupError),
    );
    return inboxError("size_mismatch", "O tamanho recebido não confere com o envio.", 400);
  }

  const { data: nodeId, error: completeError } = await admin.rpc(
    "complete_workspace_inbox_upload",
    {
      p_reservation_id: reservationId,
      p_token: token,
      p_request_id: requestId,
      p_name: displayName,
      p_mime: declaredMime,
    },
  );

  if (completeError || !nodeId) {
    const { data: finalState } = await admin
      .from("workspace_inbox_upload_reservations")
      .select("status,node_id")
      .eq("id", reservationId)
      .maybeSingle();
    if (finalState?.status === "completed" && finalState.node_id) {
      return json({ ok: true, idempotent: true, node_id: finalState.node_id });
    }

    const { error: cleanupError } = await admin.storage.from("workspace").remove([key]);
    await cancelReservation(
      admin,
      reservationId,
      "workspace_node_insert_failed",
      Boolean(cleanupError),
    );
    console.error("workspace-inbox completion failed", {
      reservationId,
      storageOrphaned: Boolean(cleanupError),
    });
    if (completeError) return databaseError(completeError.message, 500);
    return inboxError("completion_failed", "O envio não pôde ser concluído.", 500);
  }

  return json({ ok: true, node_id: nodeId, usage: reservation.usage });
});

type AdminClient = ReturnType<typeof createClient>;

async function storageObjectSize(admin: AdminClient, key: string): Promise<number | null> {
  const separator = key.lastIndexOf("/");
  if (separator < 1) return null;
  const folder = key.slice(0, separator);
  const filename = key.slice(separator + 1);
  const { data, error } = await admin.storage.from("workspace").list(folder, {
    limit: 2,
    search: filename,
  });
  if (error) return null;
  const match = data?.find((entry) => entry.name === filename);
  const size = Number(match?.metadata?.size);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function storageObjectUrl(key: string) {
  const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/workspace/${encodedPath}`;
}

function decodeHeader(value: string | null): string {
  if (!value || value.length > 2048) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

async function cancelReservation(
  admin: AdminClient,
  reservationId: string,
  failureCode: string,
  storageOrphaned: boolean,
) {
  const { error } = await admin.rpc("cancel_workspace_inbox_upload", {
    p_reservation_id: reservationId,
    p_failure_code: failureCode,
    p_storage_orphaned: storageOrphaned,
  });
  if (error) console.error("workspace-inbox reservation cancel failed", { reservationId });
}

function databaseError(message: string, fallbackStatus?: number) {
  const mapped = mapInboxDatabaseError(message);
  return inboxError(
    mapped.code,
    mapped.message,
    fallbackStatus && mapped.status === 400 ? fallbackStatus : mapped.status,
    mapped.retryAfterSeconds,
  );
}

function inboxError(code: string, message: string, status: number, retryAfterSeconds?: number) {
  return json(
    { error: message, code },
    status,
    retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
  );
}

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}
