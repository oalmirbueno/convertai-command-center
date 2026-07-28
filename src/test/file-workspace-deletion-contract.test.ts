import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/delete-file-assets/index.ts"),
  "utf8",
);

const functionBody = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("file/workspace deletion contract", () => {
  it("deletes a Files link without deleting the shared Workspace object", () => {
    const prepareFileDelete = functionBody(
      "async function prepareFileDelete",
      "async function executeFileDelete",
    );
    const executeFileDelete = functionBody(
      "async function executeFileDelete",
      "async function collectWorkspaceTree",
    );

    expect(prepareFileDelete).toContain('ref.bucket !== "workspace"');
    expect(executeFileDelete).toContain('.from("files")');
    expect(executeFileDelete).not.toContain('.from("workspace_nodes")');
  });

  it("detects both explicit Workspace links and Files bucket/path references", () => {
    const guard = functionBody(
      "async function assertWorkspaceTreeIsUnlinked",
      "Deno.serve",
    );

    expect(guard).toContain("node.sent_for_approval_file_id");
    expect(guard).toContain('.eq("storage_bucket", "workspace")');
    expect(guard).toContain('.in("storage_path", chunk)');
    expect(guard).toContain("`${WORKSPACE_FILE_PREFIX}${path}`");
    expect(guard).toContain("linkedNodeIds.length > 0 || linkedFileIds.size > 0");
    expect(guard).toMatch(/new HttpError\([\s\S]*409,/);
  });

  it("blocks a linked file or folder before any Workspace row or object is removed", () => {
    const workspaceDelete = source.slice(
      source.indexOf("const tree = await collectWorkspaceTree"),
    );
    const guardIndex = workspaceDelete.indexOf(
      "await assertWorkspaceTreeIsUnlinked(admin, tree)",
    );
    const rowDeleteIndex = workspaceDelete.indexOf(
      '.from("workspace_nodes")\n      .delete()',
    );
    const objectDeleteIndex = workspaceDelete.indexOf(
      "await removeObjects(admin, workspaceRefs)",
    );

    expect(guardIndex).toBeGreaterThan(-1);
    expect(rowDeleteIndex).toBeGreaterThan(guardIndex);
    expect(objectDeleteIndex).toBeGreaterThan(rowDeleteIndex);
    expect(workspaceDelete).not.toContain(
      "executeFileDelete(caller, admin, approvalPlan)",
    );
  });

  it("keeps the normal deletion path for an unlinked Workspace item", () => {
    const workspaceDelete = source.slice(
      source.indexOf("const tree = await collectWorkspaceTree"),
    );

    expect(workspaceDelete).toContain('.from("workspace_nodes")');
    expect(workspaceDelete).toContain('.eq("id", root.id)');
    expect(workspaceDelete).toContain(
      "const workspaceStorage = await removeObjects(admin, workspaceRefs)",
    );
    expect(workspaceDelete).toContain("deleted: tree.length");
  });
});
