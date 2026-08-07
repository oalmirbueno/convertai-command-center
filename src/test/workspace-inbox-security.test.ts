// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalInboxMime,
  createCountingInboxStream,
  isUuid,
  mapInboxDatabaseError,
  parseLegacyWorkspaceInboxMultipart,
  safeFileExtension,
  sanitizeInboxText,
  WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES,
  WORKSPACE_INBOX_MAX_FILE_BYTES,
} from "../../supabase/functions/_shared/workspace-inbox-policy";

const edgeSource = readFileSync("supabase/functions/workspace-inbox/index.ts", "utf8");
const policySource = readFileSync(
  "supabase/functions/_shared/workspace-inbox-policy.ts",
  "utf8",
);
const migrationSource = readFileSync(
  "supabase/migrations/20260807213000_harden_workspace_inbox_tokens.sql",
  "utf8",
);
const quarantineBoundarySource = readFileSync(
  "supabase/migrations/20260807221000_harden_workspace_quarantine_boundary.sql",
  "utf8",
);
const publicPageSource = readFileSync("src/pages/WorkspaceInboxPublic.tsx", "utf8");
const workspacePageSource = readFileSync("src/pages/Workspace.tsx", "utf8");

async function legacyMultipartRequest(
  file: File | null,
  sender = "",
  declaredLength?: number,
) {
  const form = new FormData();
  if (file) form.set("file", file);
  if (sender) form.set("sender", sender);
  const encoded = new Request("https://example.test/workspace-inbox", {
    method: "POST",
    body: form,
  });
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new Request("https://example.test/workspace-inbox", {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type") || "",
      "content-length": String(declaredLength ?? body.byteLength),
    },
    body,
  });
}

describe("workspace inbox upload policy", () => {
  it("caps public files at 25 MiB and validates UUIDs", () => {
    expect(WORKSPACE_INBOX_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("not-a-token")).toBe(false);
  });

  it("normalizes safe extensions and rejects active content", () => {
    expect(safeFileExtension("campanha.Final.PDF")).toBe("pdf");
    expect(safeFileExtension("sem-extensao")).toBe("bin");
    expect(safeFileExtension("x.extension-is-too-long")).toBe("bin");
    expect(safeFileExtension("preview.svg")).toBeNull();
    expect(safeFileExtension("payload.exe")).toBeNull();
    expect(canonicalInboxMime("pdf")).toBe("application/pdf");
    expect(canonicalInboxMime("unknown")).toBe("application/octet-stream");
  });

  it("aborts a stream as soon as the real body exceeds its declared size", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    const counted = createCountingInboxStream(source, 8, 16);
    const reader = counted.stream.getReader();

    await expect((async () => {
      while (!(await reader.read()).done) {
        // consume until the transform rejects the ninth byte
      }
    })()).rejects.toThrow("declared length");
    expect(counted.bytesRead()).toBe(9);
    expect(counted.violation()).toBe("declared_length");
  });

  it("removes control, bidi and path characters from display names", () => {
    expect(sanitizeInboxText("../pasta\\nome\u202e.pdf\n", 100)).toBe(".._pasta_nome.pdf");
    expect(sanitizeInboxText("  nome    normal  ", 100)).toBe("nome normal");
  });

  it("maps token errors neutrally and quota errors to throttling", () => {
    expect(mapInboxDatabaseError("INBOX_TOKEN_EXPIRED")).toMatchObject({
      status: 404,
      code: "invalid_or_expired_link",
    });
    expect(mapInboxDatabaseError("INBOX_RATE_LIMIT")).toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(mapInboxDatabaseError("INBOX_BYTE_QUOTA")).toMatchObject({
      status: 429,
      code: "daily_quota",
    });
  });

  it("normalizes the temporary legacy multipart contract under a hard ceiling", async () => {
    const request = await legacyMultipartRequest(
      new File([new Uint8Array([1, 2, 3, 4])], "brief.Final.PDF", {
        type: "application/pdf",
      }),
      "Cliente Externo",
    );
    const upload = await parseLegacyWorkspaceInboxMultipart(request);
    const bytes = new Uint8Array(await new Response(upload.body).arrayBuffer());

    expect(upload.originalName).toBe("brief.Final.PDF");
    expect(upload.sender).toBe("Cliente Externo");
    expect(upload.sizeBytes).toBe(4);
    expect(isUuid(upload.requestId)).toBe(true);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it("rejects malformed, empty and oversized legacy multipart before storage", async () => {
    await expect(parseLegacyWorkspaceInboxMultipart(
      await legacyMultipartRequest(null),
    )).rejects.toMatchObject({
      code: "missing_file",
      status: 400,
    });
    await expect(parseLegacyWorkspaceInboxMultipart(
      await legacyMultipartRequest(new File([], "empty.pdf")),
    )).rejects.toMatchObject({
      code: "empty_file",
      status: 400,
    });
    await expect(parseLegacyWorkspaceInboxMultipart(
      await legacyMultipartRequest(
        new File(["x"], "large.pdf"),
        "",
        WORKSPACE_INBOX_MAX_FILE_BYTES
          + WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES
          + 1,
      ),
    )).rejects.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
  });
});

describe("workspace inbox security boundaries", () => {
  it("streams the binary protocol and tightly bounds the temporary multipart bridge", () => {
    expect(edgeSource).toContain("uploadBody = req.body");
    expect(edgeSource).toContain("parseLegacyWorkspaceInboxMultipart(req)");
    expect(edgeSource).toContain("createCountingInboxStream(uploadBody, uploadSize)");
    expect(edgeSource).toContain("body: countedBody.stream");
    expect(policySource).toContain('startsWith("multipart/form-data")');
    expect(policySource).toContain('form.get("file")');
    expect(policySource).toContain('form.get("sender")');
    expect(policySource).toContain("new Response(boundedMultipart.stream");
    expect(policySource).toContain("}).formData()");
    expect(policySource).toContain("createCountingInboxStream(\n    request.body");
    expect(policySource).toContain("WORKSPACE_INBOX_LEGACY_MULTIPART_OVERHEAD_BYTES");
    expect(policySource.indexOf("requestBytes\n      > WORKSPACE_INBOX_MAX_FILE_BYTES"))
      .toBeLessThan(policySource.indexOf("}).formData()"));
    expect(policySource).not.toContain("file.arrayBuffer()");
    expect(policySource).not.toContain("new Uint8Array");
    expect(edgeSource).toContain('req.headers.get("content-length")');
    expect(edgeSource.indexOf('"reserve_workspace_inbox_upload"')).toBeLessThan(
      edgeSource.indexOf("body: countedBody.stream"),
    );
    expect(edgeSource).toContain('new URL(req.url).searchParams.get("token")');
    expect(edgeSource).toContain("Remove the query fallback only in the");
  });

  it("uses an atomic reservation/finalization protocol with compensation", () => {
    expect(edgeSource).toContain('"reserve_workspace_inbox_upload"');
    expect(edgeSource).toContain('"complete_workspace_inbox_upload"');
    expect(edgeSource).toContain('"cancel_workspace_inbox_upload"');
    expect(edgeSource).toContain('.from("workspace").remove([key])');
    expect(migrationSource).toContain("FOR UPDATE;");
    expect(migrationSource).toContain("request_id uuid NOT NULL UNIQUE");
    expect(migrationSource).toContain("_files_24h >= 20");
    expect(migrationSource).toContain("_bytes_24h + p_size_bytes > 104857600");
    expect(migrationSource).toContain("_uploads_1m >= 10");
  });

  it("keeps the reservation ledger private and RPCs service-role only", () => {
    expect(migrationSource).toContain(
      "ALTER TABLE public.workspace_inbox_upload_reservations FORCE ROW LEVEL SECURITY",
    );
    expect(migrationSource).toContain(
      "FROM PUBLIC, anon, authenticated",
    );
    expect(migrationSource).toContain(
      "GRANT EXECUTE ON FUNCTION public.reserve_workspace_inbox_upload(uuid, bigint, uuid, text) TO service_role",
    );
  });

  it("uses headers and no-store responses instead of placing tokens in function URLs", () => {
    expect(publicPageSource).toContain('"x-inbox-token": token');
    expect(publicPageSource).not.toContain("?token=${encodeURIComponent(token)}");
    expect(edgeSource).toContain('"cache-control": "no-store"');
    expect(edgeSource).toContain('"referrer-policy": "no-referrer"');
    expect(publicPageSource).toContain('role="button"');
    expect(publicPageSource).toContain('event.key === "Enter"');
    expect(publicPageSource).toContain("info.limits.max_file_bytes");
  });

  it("provides atomic ensure, rotation and revocation controls to staff", () => {
    expect(migrationSource).toContain("public.manage_workspace_inbox_token");
    expect(migrationSource).toContain("p_action NOT IN ('ensure', 'rotate', 'revoke')");
    expect(workspacePageSource).toContain('p_action: rotate ? "rotate" : "ensure"');
    expect(workspacePageSource).toContain('p_action: "revoke"');
    expect(workspacePageSource).toContain("Gerar novo link (7 dias)");
  });

  it("quarantines every public upload before preview or handoff", () => {
    expect(migrationSource).toContain("inbox_scan_status");
    expect(migrationSource).toContain("'pending'");
    expect(workspacePageSource).toContain("Arquivo externo em quarentena");
    expect(workspacePageSource).toContain("!isInboxQuarantined(n)");
    expect(workspacePageSource).toContain("markInboxFileVerified");
    expect(workspacePageSource).toContain("allowNavigationFallback: !isInboxQuarantined(n)");
    expect(workspacePageSource).toContain('selected.inbox_scan_status === "pending"');
    expect(workspacePageSource).toContain('supabase.rpc("mark_workspace_inbox_scan_clean"');
    expect(workspacePageSource).not.toContain('.update({ inbox_scan_status: "clean" })');
    expect(workspacePageSource).not.toContain('isInboxQuarantined(selected) && (\n                  <Button size="sm" variant="outline" onClick={() => markInboxFileVerified');
    expect(quarantineBoundarySource).toContain("workspace_storage_object_is_releasable");
    expect(quarantineBoundarySource).toContain("inbox_scan_status = 'clean'");
    expect(quarantineBoundarySource).toContain("WORKSPACE_INBOX_SECURITY_FIELDS_SERVER_ONLY");
    expect(quarantineBoundarySource).toContain("WORKSPACE_INBOX_NOT_PENDING");
    expect(quarantineBoundarySource).toContain("workspace_inbox_scan_events");
  });
});
