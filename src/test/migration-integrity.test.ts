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

  it("registers a base-tracked SQL omitted from the manifest only with the identical blob hash", () => {
    const listed = migration("20261125180000", "latest");
    const omitted = migration("20261120090000", "omitted");
    const base = new Map([[listed, hash("a")]]);
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [omitted, hash("b")]]),
      base,
      new Map([[omitted, hash("b")]]),
    )).not.toThrow();

    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [omitted, hash("c")]]),
      base,
      new Map([[omitted, hash("b")]]),
    )).toThrow(/existing unlisted migration changed/);

    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [omitted, hash("b")]]),
      base,
      new Map([[omitted, null]]),
    )).toThrow(/existing unlisted migration changed/);
  });

  it("rejects a changed unlisted base SQL even when it is the most recent version", () => {
    const listed = migration("20261120090000", "listed");
    const recent = migration("20261125180000", "recent_unlisted");
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [recent, hash("c")]]),
      new Map([[listed, hash("a")]]),
      new Map([[recent, hash("b")]]),
    )).toThrow(/existing unlisted migration changed/);
  });

  it("rejects removing a base-tracked SQL omitted from the manifest", () => {
    const listed = migration("20261125180000", "latest");
    const omitted = migration("20261120090000", "omitted");
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")]]),
      new Map([[listed, hash("a")]]),
      new Map([[omitted, hash("b")]]),
    )).toThrow(/existing unlisted migration was removed/);
  });

  it("rejects a historical SQL with no blob in base", () => {
    const listed = migration("20261125180000", "latest");
    const historical = migration("20261120090000", "invented");
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [historical, hash("b")]]),
      new Map([[listed, hash("a")]]),
      new Map(),
    )).toThrow(/not forward-only/);
  });

  it("uses the latest real base SQL, listed or not, to reject backdated new SQL", () => {
    const listed = migration("20261120090000", "listed");
    const unlisted = migration("20261125180000", "unlisted");
    const backdated = migration("20261125170000", "backdated");
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [unlisted, hash("b")], [backdated, hash("c")]]),
      new Map([[listed, hash("a")]]),
      new Map([[unlisted, hash("b")]]),
    )).toThrow(/not forward-only/);

    const forward = migration("20261125190000", "forward");
    expect(() => verifyAppendOnlyManifest(
      new Map([[listed, hash("a")], [unlisted, hash("b")], [forward, hash("c")]]),
      new Map([[listed, hash("a")]]),
      new Map([[unlisted, hash("b")]]),
    )).not.toThrow();
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
