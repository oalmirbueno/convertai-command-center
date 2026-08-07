import { describe, expect, it } from "vitest";
import {
  parseMigrationManifest,
  verifyAppendOnlyManifest,
  verifyInitialBaseline,
} from "../../scripts/verify-migration-integrity.mjs";

const hash = (character: string) => character.repeat(64);
const migration = (version: string, slug: string) =>
  `supabase/migrations/${version}_${slug}.sql`;

describe("forward-only migration manifest", () => {
  it("parses strict SHA-256 entries", () => {
    const entries = parseMigrationManifest(
      `# baseline\n${hash("a")}  ${migration("20260807223000", "gateway")}\n`,
      "fixture",
    );
    expect(entries.get(migration("20260807223000", "gateway"))).toBe(hash("a"));
  });

  it("rejects a changed or removed published migration", () => {
    const path = migration("20260807223000", "gateway");
    expect(() => verifyAppendOnlyManifest(
      new Map([[path, hash("b")]]),
      new Map([[path, hash("a")]]),
    )).toThrow(/published entry changed/);
    expect(() => verifyAppendOnlyManifest(
      new Map(),
      new Map([[path, hash("a")]]),
    )).toThrow(/published entry was removed/);
  });

  it("accepts only migrations newer than the published ledger", () => {
    const oldPath = migration("20260807223000", "gateway");
    const nextPath = migration("20260807224000", "next");
    expect(() => verifyAppendOnlyManifest(
      new Map([[oldPath, hash("a")], [nextPath, hash("b")]]),
      new Map([[oldPath, hash("a")]]),
    )).not.toThrow();

    const backdated = migration("20260807222000", "backdated");
    expect(() => verifyAppendOnlyManifest(
      new Map([[oldPath, hash("a")], [backdated, hash("b")]]),
      new Map([[oldPath, hash("a")]]),
    )).toThrow(/not forward-only/);
  });

  it("keeps the bootstrap immutable after baseline", () => {
    const bootstrap = "supabase/bootstrap/legacy_prerequisites.sql";
    expect(() => verifyAppendOnlyManifest(
      new Map([[bootstrap, hash("b")]]),
      new Map([[bootstrap, hash("a")]]),
    )).toThrow(/published entry changed/);
  });

  it("rejects historical rewrites while initializing the first ledger", () => {
    const oldPath = migration("20260505022451", "legacy");
    expect(() => verifyInitialBaseline(
      new Map([[oldPath, hash("b")]]),
      new Map([[oldPath, hash("a")]]),
      new Map(),
    )).toThrow(/without an approved sanitization/);
  });

  it("allows only an exact, forward-fixed sanitization in the first ledger", () => {
    const oldPath = migration("20260505022451", "legacy");
    const forwardFix = migration("20260807211000", "forward_fix");
    const exception = {
      path: oldPath,
      published_sha256: hash("a"),
      sanitized_sha256: hash("b"),
      forward_fix: forwardFix,
      reason: "Reviewed removal of an exposed value with a forward database correction.",
    };
    expect(verifyInitialBaseline(
      new Map([[oldPath, hash("b")], [forwardFix, hash("c")]]),
      new Map([[oldPath, hash("a")]]),
      new Map([[oldPath, exception]]),
    )).toEqual({ approvedSanitizations: 1 });

    expect(() => verifyInitialBaseline(
      new Map([[oldPath, hash("c")], [forwardFix, hash("d")]]),
      new Map([[oldPath, hash("a")]]),
      new Map([[oldPath, exception]]),
    )).toThrow(/without an approved sanitization/);
  });
});
