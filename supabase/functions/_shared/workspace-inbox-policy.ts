export const WORKSPACE_INBOX_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export class WorkspaceInboxRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "WorkspaceInboxRequestError";
    this.code = code;
    this.status = status;
  }
}

export type LegacyWorkspaceInboxUpload = {
  body: ReadableStream<Uint8Array>;
  sizeBytes: number;
  requestId: string;
  originalName: string;
  sender: string;
};

// Temporary EXPAND bridge for the frontend already published in production.
// The Content-Length ceiling bounds formData() before it can materialize the
// multipart request. The extracted file then joins the same reservation,
// Storage, quarantine and compensation flow as the binary protocol.
export async function parseLegacyWorkspaceInboxMultipart(
  request: Request,
): Promise<LegacyWorkspaceInboxUpload> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new WorkspaceInboxRequestError(
      "invalid_upload",
      "Formato de envio inválido.",
      400,
    );
  }

  const requestBytes = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(requestBytes) || requestBytes <= 0) {
    throw new WorkspaceInboxRequestError(
      "length_required",
      "O tamanho do envio é obrigatório.",
      411,
    );
  }
  if (
    requestBytes
      > WORKSPACE_INBOX_MAX_FILE_BYTES
        + WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES
  ) {
    throw new WorkspaceInboxRequestError(
      "file_too_large",
      "O arquivo excede o limite de 25 MB.",
      413,
    );
  }

  if (!request.body) {
    throw new WorkspaceInboxRequestError(
      "missing_file",
      "Selecione um arquivo.",
      400,
    );
  }

  const boundedMultipart = createCountingInboxStream(
    request.body,
    requestBytes,
    WORKSPACE_INBOX_MAX_FILE_BYTES
      + WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES,
  );
  let form: FormData;
  try {
    form = await new Response(boundedMultipart.stream, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    if (boundedMultipart.violation() === "max_size") {
      throw new WorkspaceInboxRequestError(
        "file_too_large",
        "O arquivo excede o limite de 25 MB.",
        413,
      );
    }
    if (boundedMultipart.violation() === "declared_length") {
      throw new WorkspaceInboxRequestError(
        "size_mismatch",
        "O tamanho recebido não confere com o envio.",
        400,
      );
    }
    throw new WorkspaceInboxRequestError(
      "invalid_upload",
      "Não foi possível ler o envio.",
      400,
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new WorkspaceInboxRequestError(
      "missing_file",
      "Selecione um arquivo.",
      400,
    );
  }
  if (file.size <= 0) {
    throw new WorkspaceInboxRequestError(
      "empty_file",
      "O arquivo está vazio.",
      400,
    );
  }
  if (file.size > WORKSPACE_INBOX_MAX_FILE_BYTES) {
    throw new WorkspaceInboxRequestError(
      "file_too_large",
      "O arquivo excede o limite de 25 MB.",
      413,
    );
  }

  return {
    body: file.stream(),
    sizeBytes: file.size,
    requestId: crypto.randomUUID(),
    originalName: file.name,
    sender: String(form.get("sender") || ""),
  };
}

export type InboxBodyViolation = "declared_length" | "max_size";

export class InboxBodyLimitError extends Error {
  readonly violation: InboxBodyViolation;

  constructor(violation: InboxBodyViolation) {
    super(violation === "max_size"
      ? "Workspace inbox body exceeds the maximum size"
      : "Workspace inbox body exceeds the declared length");
    this.name = "InboxBodyLimitError";
    this.violation = violation;
  }
}

export function createCountingInboxStream(
  body: ReadableStream<Uint8Array>,
  declaredBytes: number,
  maxBytes = WORKSPACE_INBOX_MAX_FILE_BYTES,
): {
  stream: ReadableStream<Uint8Array>;
  bytesRead: () => number;
  violation: () => InboxBodyViolation | null;
} {
  let bytes = 0;
  let rejectedFor: InboxBodyViolation | null = null;
  const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        rejectedFor = "max_size";
        controller.error(new InboxBodyLimitError(rejectedFor));
        return;
      }
      if (bytes > declaredBytes) {
        rejectedFor = "declared_length";
        controller.error(new InboxBodyLimitError(rejectedFor));
        return;
      }
      controller.enqueue(chunk);
    },
  }));

  return {
    stream,
    bytesRead: () => bytes,
    violation: () => rejectedFor,
  };
}

export function canonicalInboxMime(extension: string): string {
  const known: Record<string, string> = {
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    webm: "video/webm",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
  };
  return known[extension] ?? "application/octet-stream";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BLOCKED_EXTENSIONS = new Set([
  "apk",
  "bat",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "htm",
  "html",
  "iso",
  "jar",
  "js",
  "mjs",
  "msi",
  "php",
  "ps1",
  "sh",
  "svg",
  "vbs",
]);

export type InboxErrorResponse = {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
};

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function safeFileExtension(name: string): string | null {
  const raw = name.includes(".") ? name.split(".").pop() ?? "" : "";
  const extension = raw.toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) return "bin";
  if (BLOCKED_EXTENSIONS.has(extension)) return null;
  return extension;
}

export function sanitizeInboxText(value: string, maxLength: number): string {
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  return withoutControls
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function mapInboxDatabaseError(message: string): InboxErrorResponse {
  if (
    message.includes("INBOX_INVALID_TOKEN") ||
    message.includes("INBOX_TOKEN_EXPIRED") ||
    message.includes("INBOX_RESERVATION_REVOKED")
  ) {
    return {
      status: 404,
      code: "invalid_or_expired_link",
      message: "Link inválido, revogado ou expirado.",
    };
  }

  if (message.includes("INBOX_FILE_TOO_LARGE")) {
    return {
      status: 413,
      code: "file_too_large",
      message: "O arquivo excede o limite de 25 MB.",
    };
  }

  if (message.includes("INBOX_EMPTY_FILE")) {
    return {
      status: 400,
      code: "empty_file",
      message: "O arquivo está vazio.",
    };
  }

  if (message.includes("INBOX_RATE_LIMIT")) {
    return {
      status: 429,
      code: "rate_limit",
      message: "Muitos envios em pouco tempo. Aguarde um minuto e tente novamente.",
      retryAfterSeconds: 60,
    };
  }

  if (
    message.includes("INBOX_FILE_QUOTA") ||
    message.includes("INBOX_BYTE_QUOTA")
  ) {
    return {
      status: 429,
      code: "daily_quota",
      message: "A cota deste link nas últimas 24 horas foi atingida.",
      retryAfterSeconds: 3600,
    };
  }

  if (message.includes("INBOX_REQUEST_REUSED")) {
    return {
      status: 409,
      code: "request_reused",
      message: "Este envio não pode ser repetido. Selecione o arquivo novamente.",
    };
  }

  return {
    status: 400,
    code: "invalid_upload",
    message: "Não foi possível validar este envio.",
  };
}
