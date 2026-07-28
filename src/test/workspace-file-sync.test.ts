import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { suggestedFileType } from "@/lib/workspaceFileHandoff";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const workspace = read("src/pages/Workspace.tsx");
const adminFiles = read("src/pages/AdminFiles.tsx");
const handoff = read("src/lib/workspaceFileHandoff.ts");
const uploads = read("src/hooks/useWorkspaceUploads.ts");
const fileActions = read("src/lib/fileRecordActions.ts");

describe("workspace and files synchronization", () => {
  it("infers a useful internal type without changing the underlying object", () => {
    expect(suggestedFileType("campanha.mp4", null)).toBe("criativo");
    expect(suggestedFileType("relatorio.pdf", "application/pdf")).toBe("documento");
    expect(suggestedFileType("fonte.bin", null)).toBe("outro");
  });

  it("polls Files within 30 seconds and fails visibly without hiding Workspace", () => {
    const queryStart = workspace.indexOf('queryKey: ["workspace-client-files"');
    const queryEnd = workspace.indexOf("// Group carousel children", queryStart);
    const query = workspace.slice(queryStart, queryEnd);

    expect(query).toContain("if (error) throw error");
    expect(query).toContain("refetchInterval: 30_000");
    expect(query).not.toContain("placeholderData");
    expect(workspace).toContain("Workspace disponível; sincronização com Arquivos temporariamente indisponível.");
  });

  it("keeps homonymous rows and deduplicates only a shared physical identity", () => {
    const filterStart = workspace.indexOf("const filtered = useMemo");
    const filterEnd = workspace.indexOf("// Category counts", filterStart);
    const filter = workspace.slice(filterStart, filterEnd);

    expect(filter).toContain("object:${bucket || \"external\"}:${path}");
    expect(filter).not.toContain("n.name.replace");
    expect(filter).not.toContain("Dedup by name");
  });

  it("invalidates Workspace immediately when Arquivos changes", () => {
    expect(adminFiles).toContain('queryKey: ["workspace-client-files"]');
    expect(adminFiles).toContain("invalidateFileViews()");
  });

  it("keeps revision deep-links blocked until the source file is confirmed", () => {
    expect(adminFiles).toContain(
      "if (requestedRevisionId && !revisionSource)",
    );
    expect(adminFiles).toContain(
      "|| (!!requestedRevisionId && !revisionSource)",
    );
    expect(adminFiles).toContain(
      "Versão anterior ainda não carregada",
    );
    expect(adminFiles).toContain("initializedRevisionRef.current !== revisionSource.id");
    expect(adminFiles).not.toContain(
      "O novo conteúdo será salvo sem vínculo de correção.",
    );
    const invalidRevisionStart = adminFiles.indexOf(
      "if (requestedRevisionId && !loadingFiles)",
    );
    const invalidRevisionEnd = adminFiles.indexOf(
      "if (requestedFolderId",
      invalidRevisionStart,
    );
    const invalidRevision = adminFiles.slice(
      invalidRevisionStart,
      invalidRevisionEnd,
    );
    expect(invalidRevision).toContain('next.delete("revisionOf")');
    expect(invalidRevision).toContain('next.delete("novo")');
    expect(invalidRevision).toContain("setUploadOpen(false)");
  });

  it("clears revision deep-links only when the upload is explicitly closed", () => {
    const closeStart = adminFiles.indexOf("const closeUploadForm");
    const closeEnd = adminFiles.indexOf(
      "const [confirmDeleteFile",
      closeStart,
    );
    const closeUpload = adminFiles.slice(closeStart, closeEnd);

    expect(closeUpload).toContain('next.delete("revisionOf")');
    expect(closeUpload).toContain('next.delete("novo")');
    expect(adminFiles).toContain("onClick={closeUploadForm}");
    expect(adminFiles).toContain("closeUploadForm();");
  });
});

describe("explicit Workspace to Files handoff", () => {
  it("creates only an internal Files link and reuses the Workspace object", () => {
    expect(handoff).toContain('file_url: `workspace://${node.storage_path}`');
    expect(handoff).toContain('storage_bucket: "workspace"');
    expect(handoff).toContain('visibility: "internal"');
    expect(handoff).toContain('agency_approval_status: "not_requested"');
    expect(handoff).toContain('approval_status: "none"');
    expect(handoff).toContain('idempotency_key: `workspace-node:${node.id}`');
    expect(handoff).not.toMatch(/requestFileAgencyReview|reviewFileAgency|releaseFileToClient/);
  });

  it("recovers existing links by id or physical path before creating", () => {
    const existingById = handoff.indexOf("if (node.sent_for_approval_file_id)");
    const existingByPath = handoff.indexOf("findFileByWorkspacePath(clientId, node.storage_path)");
    const create = handoff.indexOf("created = await createFileRecord");

    expect(existingById).toBeGreaterThan(-1);
    expect(existingByPath).toBeGreaterThan(existingById);
    expect(create).toBeGreaterThan(existingByPath);
    expect(handoff).toContain('.eq("client_id", clientId)');
    expect(handoff).toContain('.eq("storage_path", node.storage_path!)');
    expect(handoff).toContain(".maybeSingle()");
  });

  it("exposes no approval or client-release shortcut from Workspace", () => {
    expect(workspace).toContain("Enviar para Arquivos");
    expect(workspace).not.toMatch(
      /requestFileAgencyReview|reviewFileAgency|releaseFileToClient|Solicitar revisão interna|Disponibilizar ao cliente|Enviar para aprovação/,
    );
  });

  it("prefills a unique project and labels every handoff selector", () => {
    expect(workspace).toContain(
      'clientProjects.length === 1 ? clientProjects[0].id : "none"',
    );
    expect(workspace).toContain(
      'aria-labelledby="workspace-handoff-folder-label"',
    );
    expect(workspace).toContain(
      'aria-labelledby="workspace-handoff-type-label"',
    );
    expect(workspace).toContain(
      'aria-labelledby="workspace-handoff-project-label"',
    );
  });
});

describe("safe Workspace upload cleanup", () => {
  it("recovers a committed object when the upload response is lost", () => {
    expect(uploads).toContain('confirmStoredObject("workspace", key)');
    expect(uploads).toContain("await finalizeWorkspaceNode({");
    expect(uploads).toContain("finalizationsRef");
    expect(uploads).toContain("completedRef");
    expect(uploads).toContain("onError: (err: any) =>");
    expect(fileActions).toContain("export async function confirmStoredObject");
    expect(adminFiles).toContain('confirmStoredObject("files", path)');
  });

  it("reuses stable ids when a Files batch or video-link retry resumes", () => {
    expect(adminFiles).toContain("uploadAttemptRef");
    expect(adminFiles).toContain("ensureUploadAttempt");
    expect(adminFiles).toContain("uploadAttempt.fileIds[i]");
    expect(adminFiles).toContain(
      "recoverFailedFileRecordById",
    );
    expect(adminFiles).toContain(
      "idempotency_key: `admin-files-upload:${uploadAttempt.batchId}:${i}`",
    );
  });

  it("serializes node finalization and never offers fake cancellation", () => {
    expect(uploads).toContain("finalizationsRef");
    expect(uploads).toContain("completedRef");
    expect(uploads).toContain("cancelable: file.size > FAST_PATH_MAX");
    expect(uploads).toContain("meta.file.size <= FAST_PATH_MAX");
    expect(uploads).toContain(
      'candidate.metadata?.objectName === key',
    );
  });

  it("locks retry metadata after the first Files attempt", () => {
    expect(adminFiles).toContain("postSaveAction: uploadPostSaveAction");
    expect(adminFiles).toContain("carousel: uploadCarousel");
    expect(adminFiles).toContain(
      "Este envio já foi iniciado. Para evitar duplicação",
    );
  });

  it("checks for a registered node before removing a failed upload", () => {
    const cleanupStart = uploads.indexOf("async function cleanupUnregisteredWorkspaceObject");
    const cleanupEnd = uploads.indexOf("export function useWorkspaceUploads", cleanupStart);
    const cleanup = uploads.slice(cleanupStart, cleanupEnd);

    expect(cleanup).toContain('.from("workspace_nodes")');
    expect(cleanup).toContain('.eq("storage_path", key)');
    expect(cleanup.indexOf("registered?.length")).toBeLessThan(
      cleanup.indexOf('.from("workspace").remove([key])'),
    );
    expect(cleanup).toContain("preservado por segurança");
  });

  it("preserves a Files object on uncertainty or path collision", () => {
    expect(fileActions).toContain('.from("staff_files_secure")');
    expect(fileActions).toContain("byPath.data.id !== fileId");
    expect(fileActions).toContain(
      "o objeto foi preservado",
    );
    expect(fileActions.indexOf("byPath.data.id !== fileId")).toBeLessThan(
      fileActions.indexOf('.from("files")\n    .remove([storagePath])'),
    );
  });
});
