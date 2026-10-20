import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterAll } from "vitest";
import { supabaseStatementsSha256 } from "../../scripts/prepare-production-migration-view.mjs";

// The original 206 + 3 scenario is a fixture, not today's production ledger.
// Keep testing partial deployment and out-of-order protection after later releases.
export function reviewedMigrationFixture() {
  const root = mkdtempSync(join(tmpdir(), "reviewed-migration-fixture-"));
  afterAll(() => {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("reviewed-migration-fixture-")
    )
      throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true });
  });
  const path = "supabase/deployment-baselines/jjjtkowvxemvituvywvf.json";
  const doc = JSON.parse(readFileSync(resolve(path), "utf8"));
  doc.entries = doc.entries.slice(0, 206);
  const files = [
    "20260912213530_rpc_caller_boundaries_preserve_data.sql",
    "20260912213638_secure_publication_cancellation_dispatch.sql",
    "20260914174905_central_review_versioned_approval.sql",
  ];
  doc.pending_migrations = files.map((name) => {
    const path = "supabase/migrations/" + name;
    const bytes = readFileSync(resolve(path));
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(join(root, path), bytes);
    return {
      version: name.slice(0, 14),
      name: name.slice(15, -4),
      path,
      local_sha256: createHash("sha256").update(bytes).digest("hex"),
      statements_sha256: supabaseStatementsSha256(bytes.toString()),
      hash_mode: "supabase_cli_split",
    };
  });
  mkdirSync(join(root, "supabase/deployment-baselines"), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(doc));
  return root;
}
