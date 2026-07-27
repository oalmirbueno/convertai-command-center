import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const clientApprovalSurfaces = {
  ClientApprovals: read("src/pages/ClientApprovals.tsx"),
  ClientDocuments: read("src/pages/ClientDocuments.tsx"),
  TabDeliveries: read("src/components/client/tabs/TabDeliveries.tsx"),
};

const fileApprovalActions = read("src/lib/fileApprovalActions.ts");
const mcpFilesService = read(
  "supabase/functions/_shared/mcp-files-services.ts",
);
const apiGateway = read("supabase/functions/api-gateway/index.ts");
const fileUrls = read("src/lib/fileUrls.ts");
const clientRequests = read("src/pages/ClientRequests.tsx");
const clientFinance = read("src/pages/ClientFinanceiro.tsx");
const clientVaultPage = read("src/pages/ClientVaultPage.tsx");
const projectPayments = read("src/components/client/tabs/TabPayments.tsx");
const appLayout = read("src/components/AppLayout.tsx");
const supabaseData = read("src/hooks/useSupabaseData.ts");
const workspace = read("src/pages/Workspace.tsx");
const extractedFramesPreview = read(
  "src/components/shared/ExtractedFramesPreview.tsx",
);
const contractPublic = read("supabase/functions/contract-public/index.ts");
const deleteFileAssets = read(
  "supabase/functions/delete-file-assets/index.ts",
);
const reviewToApproval = read("src/lib/reviewToApproval.ts");
const voiceAssistant = read("src/components/admin/VoiceAssistant.tsx");

describe("file approval security contract", () => {
  it("keeps the guarded client decision in one shared action", () => {
    expect(fileApprovalActions).toContain("decide_file_approval");
    expect(fileApprovalActions).not.toMatch(
      /\.from\(\s*["']files["']\s*\)\s*\.update\s*\(/,
    );
  });

  it.each(Object.entries(clientApprovalSurfaces))(
    "%s delegates the client's one-time decision to the guarded RPC",
    (_name, source) => {
      expect(source).not.toMatch(
        /\.from\(\s*["']files["']\s*\)\s*\.update\s*\(/,
      );
      expect(source).toContain("useFileApprovalDecision");
    },
  );

  it("prevents MCP file agents from assigning a terminal client decision", () => {
    expect(mcpFilesService).not.toMatch(
      /approval_status\s*:\s*[^,\n}]*["'](?:approved|rejected)["']/,
    );
  });

  it("allowlists only non-approval metadata in legacy agent update_file", () => {
    const safeUpdatesStart = apiGateway.indexOf("const SAFE_FILE_UPDATES");
    const safeUpdatesEnd = apiGateway.indexOf("])", safeUpdatesStart);
    const safeUpdates = apiGateway.slice(safeUpdatesStart, safeUpdatesEnd);
    const updateFileStart = apiGateway.indexOf("update_file: async");
    const updateFileEnd = apiGateway.indexOf("\n  },", updateFileStart);
    const updateFile = apiGateway.slice(updateFileStart, updateFileEnd);

    expect(safeUpdatesStart).toBeGreaterThan(-1);
    expect(safeUpdates).not.toMatch(
      /approval_status|feedback|requires_approval|agency_|client_/,
    );
    expect(updateFileStart).toBeGreaterThan(-1);
    expect(updateFile).toContain("SAFE_FILE_UPDATES.has(key)");
  });

  it("fails closed when a private Storage URL cannot be signed", () => {
    const resolverStart = fileUrls.indexOf("export async function resolveFileUrl");
    const resolverEnd = fileUrls.indexOf("export function useResolvedFileUrl", resolverStart);
    const resolver = fileUrls.slice(resolverStart, resolverEnd);
    const signingFailureStart = resolver.indexOf("if (error || !data?.signedUrl)");
    const signingFailureEnd = resolver.indexOf("return data.signedUrl", signingFailureStart);
    const signingFailure = resolver.slice(signingFailureStart, signingFailureEnd);

    expect(resolverStart).toBeGreaterThan(-1);
    expect(signingFailureStart).toBeGreaterThan(-1);
    expect(resolver).toContain('throw error || new Error("URL indisponível")');
    expect(signingFailure).not.toContain("isDirectFileUrl");
  });

  it("keeps every mutable client surface read-only during impersonation", () => {
    expect(clientRequests).toContain("if (isImpersonating)");
    expect(clientRequests).toContain("!isImpersonating &&");
    expect(clientFinance).toContain("if (isImpersonating)");
    expect(clientFinance).toContain("Somente leitura");
    expect(clientVaultPage).toContain("isAdminOrTeam && !impersonatedId");
    expect(projectPayments).toContain(
      'profile?.role === "admin" && !isImpersonating',
    );
  });

  it("does not expose the internal timeline in the client navigation", () => {
    const clientNavStart = appLayout.indexOf("const clientMainNav");
    const clientNavEnd = appLayout.indexOf("const clientMoreNav", clientNavStart);
    const clientNav = appLayout.slice(clientNavStart, clientNavEnd);

    expect(clientNavStart).toBeGreaterThan(-1);
    expect(clientNav).not.toContain('url: "/timeline"');
  });

  it("keeps technical file columns behind the staff-only view", () => {
    const clientSelectStart = supabaseData.indexOf(
      "const CLIENT_SAFE_FILE_SELECT",
    );
    const clientSelectEnd = supabaseData.indexOf(
      "export function useProjects",
      clientSelectStart,
    );
    const clientSelect = supabaseData.slice(clientSelectStart, clientSelectEnd);
    const useAllFilesStart = supabaseData.indexOf(
      "export function useAllFiles",
    );
    const useAllFilesEnd = supabaseData.indexOf(
      "export function useProjectUpdates",
      useAllFilesStart,
    );
    const useAllFiles = supabaseData.slice(useAllFilesStart, useAllFilesEnd);

    expect(clientSelectStart).toBeGreaterThan(-1);
    expect(clientSelect).not.toMatch(
      /\bagency_|extraction_|extracted_metadata|\bsource\b|idempotency_key|sensitivity|\btags\b|sha256/,
    );
    expect(useAllFiles).toContain('.from("staff_files_secure")');
    expect(workspace).toContain('.from("staff_files_secure")');
    expect(extractedFramesPreview).toContain(
      '.from("staff_files_secure").select("extraction_status, extraction_error")',
    );
  });

  it("completes public contract signing only through the atomic RPC", () => {
    expect(contractPublic).toContain('"complete_contract_signature"');
    expect(contractPublic).not.toMatch(
      /\.from\(\s*["']contracts["']\s*\)\s*\.update\s*\(/,
    );
    expect(contractPublic).not.toMatch(
      /\.from\(\s*["']files["']\s*\)\s*\.insert\s*\(/,
    );
  });

  it("preflights file deletion with the caller's authorization", () => {
    expect(deleteFileAssets).toContain(
      'caller.rpc("can_write_file", { _file_id: fileId })',
    );
    expect(deleteFileAssets).toContain("await prepareFileDelete");
    expect(deleteFileAssets).toContain("await executeFileDelete");
    expect(deleteFileAssets.indexOf("await prepareFileDelete")).toBeLessThan(
      deleteFileAssets.indexOf("await executeFileDelete"),
    );
  });

  it("keeps new internal uploads private and attributed to the active author", () => {
    expect(reviewToApproval).toContain("uploaded_by: authorId");
    expect(reviewToApproval).not.toContain(
      "uploaded_by: attachment.uploaded_by || authorId",
    );
    expect(voiceAssistant).toContain('file_url: `files://${path}`');
    expect(voiceAssistant).not.toContain(
      'storage.from("files").getPublicUrl(path)',
    );
  });
});
