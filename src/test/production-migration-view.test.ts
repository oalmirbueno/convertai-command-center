// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProductionMigrationView,
  formatProductionLedgerSqlValues,
  listProductionVersions,
  loadProductionMigrationPlan,
  parseCsv,
  parseRemoteLedgerCsv,
  splitSupabaseStatements,
  validateRemoteLedger,
} from "../../scripts/prepare-production-migration-view.mjs";

const repoRoot = resolve(process.cwd());
const scriptPath = resolve(repoRoot, "scripts/prepare-production-migration-view.mjs");
const manifestPath = resolve(repoRoot, "supabase/production-migration-baseline.json");
const exceptionsPath = resolve(repoRoot, "supabase/migration-baseline-exceptions.json");
const temporaryRoots: string[] = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "production-migration-view-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

type LedgerRow = {
  remoteVersion: string;
  remoteName: string;
  remoteStatementsSha256: string;
};

function ledgerCsv(rows: LedgerRow[], bom = false) {
  const header = "remote_version,remote_name,remote_statements_sha256";
  const body = rows.map((row) => [
    row.remoteVersion,
    row.remoteName,
    row.remoteStatementsSha256,
  ].map(csvField).join(","));
  return `${bom ? "\uFEFF" : ""}${[header, ...body].join("\r\n")}\r\n`;
}

function remoteRows(appliedForward = 0): LedgerRow[] {
  const plan = loadProductionMigrationPlan();
  return [
    ...plan.legacyEntries.map((entry) => ({
      remoteVersion: entry.remote_version,
      remoteName: entry.remote_name,
      remoteStatementsSha256: entry.remote_statements_sha256,
    })),
    ...plan.forwardLedger.slice(0, appliedForward).map((entry) => ({
      remoteVersion: entry.version,
      remoteName: entry.name,
      remoteStatementsSha256: entry.statementsSha256,
    })),
  ];
}


function buildFixture(appliedForward = 0) {
  const root = temporaryRoot();
  const ledgerCsvPath = join(root, "ledger.csv");
  const outputDir = join(root, "migrations");
  writeFileSync(ledgerCsvPath, ledgerCsv(remoteRows(appliedForward), true));
  const result = buildProductionMigrationView({ ledgerCsvPath, outputDir });
  return { root, ledgerCsvPath, outputDir, result };
}

describe("production migration view", () => {
  it("parses quoted RFC-style CSV and the Supabase statement boundaries", () => {
    expect(parseCsv(
      '\uFEFF"first","comma,value","escaped ""quote"""\r\n'
      + '"second","line one\r\nline two","last"\r\n',
      "fixture",
    )).toEqual([
      ["first", "comma,value", 'escaped "quote"'],
      ["second", "line one\r\nline two", "last"],
    ]);

    const statements = splitSupabaseStatements(
      "-- a semicolon ; inside a comment\n"
      + "SELECT ';' AS value;\n"
      + "/* outer ; /* nested ; */ comment */\n"
      + "DO $body$\nBEGIN\n  PERFORM 1;\nEND;\n$body$;\n"
      + "SELECT (1 + 2);\n",
    );
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("SELECT ';' AS value");
    expect(statements[1]).toContain("PERFORM 1;");
    expect(statements[2]).toBe("SELECT (1 + 2)");
  });

  it("validates the explicit 96 + 2 + 12 canonical + 12 alias contract", () => {
    const plan = loadProductionMigrationPlan();
    const versions = listProductionVersions();
    const attested = new Set(plan.attestations.map((entry) => entry.local_version));

    expect(plan.legacyEntries).toHaveLength(96);
    expect(plan.attestations).toHaveLength(2);
    expect(plan.manifest.forward_migrations).toHaveLength(12);
    expect(plan.forwardMigrations).toHaveLength(12);
    expect(plan.manifest.applied_forward_aliases).toHaveLength(12);
    expect(plan.appliedAliases).toHaveLength(12);
    expect(plan.shadowPaths).toHaveLength(12);
    expect(plan.forwardLedger).toHaveLength(12);
    expect(versions).toHaveLength(108);
    expect(versions).toEqual([...versions].sort());
    expect(versions.some((version) => attested.has(version))).toBe(false);
    // The canonical versions are the logical forward set, never remote rows.
    for (const forward of plan.forwardMigrations) {
      expect(versions).not.toContain(forward.version);
    }
    for (const alias of plan.appliedAliases) {
      expect(versions).toContain(alias.remoteVersion);
    }

    const cli = spawnSync(process.execPath, [scriptPath, "--list-versions"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stderr).toBe("");
    expect(cli.stdout).toBe(`${versions.join("\n")}\n`);

    const shadowCli = spawnSync(process.execPath, [scriptPath, "--list-shadow-files"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(shadowCli.status, shadowCli.stderr).toBe(0);
    expect(shadowCli.stdout).toBe(`${plan.shadowPaths.join("\n")}\n`);

    const sqlValues = formatProductionLedgerSqlValues();
    expect(sqlValues.split("\n")).toHaveLength(108);
    expect(sqlValues).toMatch(/^\('20260223193632','',[0-9a-f']+\),/);
    const lastAlias = plan.appliedAliases.at(-1)!;
    expect(sqlValues).toContain(`'${lastAlias.remoteVersion}','${lastAlias.remoteName}'`);
    expect(sqlValues).not.toContain("'20260807223000'");
    const sqlCli = spawnSync(process.execPath, [scriptPath, "--ledger-sql-values"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(sqlCli.status, sqlCli.stderr).toBe(0);
    expect(sqlCli.stderr).toBe("");
    expect(sqlCli.stdout).toBe(`${sqlValues}\n`);
  });

  it("emits legacy sentinels, omits attestations, and copies pending forward SQL byte-for-byte", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture();
    const filenames = readdirSync(outputDir).sort();

    expect(result).toEqual({
      aliases: 96,
      appliedForward: 0,
      appliedAliases: 0,
      pendingForward: 12,
      files: 108,
    });
    expect(filenames).toHaveLength(108);
    expect(filenames.filter((name) => name.endsWith("_production_ledger_sentinel.sql")))
      .toHaveLength(96);
    for (const attestation of plan.attestations) {
      expect(filenames.some((name) => name.startsWith(attestation.local_version))).toBe(false);
    }
    const firstSentinel = readFileSync(join(outputDir, filenames[0]), "utf8");
    expect(firstSentinel).toContain("RAISE EXCEPTION");

    for (const forward of plan.forwardMigrations) {
      expect(readFileSync(join(outputDir, forward.filename))).toEqual(forward.bytes);
    }
  });

  it("reconciles the live aliased ledger to sentinels only and zero pending forward", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture(12);
    const filenames = readdirSync(outputDir).sort();

    expect(result).toEqual({
      aliases: 96,
      appliedForward: 12,
      appliedAliases: 12,
      pendingForward: 0,
      files: 108,
    });
    expect(filenames).toHaveLength(108);
    expect(filenames.every((name) => name.endsWith("_production_ledger_sentinel.sql"))).toBe(true);
    for (const alias of plan.appliedAliases) {
      const sentinel = readFileSync(
        join(outputDir, `${alias.remoteVersion}_production_ledger_sentinel.sql`),
        "utf8",
      );
      expect(sentinel).toContain(`migration sentinel ${alias.remoteVersion}`);
      // No canonical or shadow SQL may be replayed against production.
      expect(filenames).not.toContain(alias.canonical.filename);
      expect(filenames).not.toContain(alias.shadow.filename);
    }
  });

  it("turns an applied forward prefix into sentinels and leaves only its suffix pending", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture(2);

    expect(result.appliedForward).toBe(2);
    expect(result.appliedAliases).toBe(2);
    expect(result.pendingForward).toBe(10);
    for (const applied of plan.forwardLedger.slice(0, 2)) {
      expect(readFileSync(
        join(outputDir, `${applied.version}_production_ledger_sentinel.sql`),
        "utf8",
      )).toContain(`migration sentinel ${applied.version}`);
    }
    expect(readFileSync(join(outputDir, plan.forwardMigrations[2].filename)))
      .toEqual(plan.forwardMigrations[2].bytes);
  });

  it("supports the workflow source-directory override", () => {
    const root = temporaryRoot();
    const sourceDir = join(root, "repository-migrations");
    cpSync(resolve(repoRoot, "supabase/migrations"), sourceDir, { recursive: true });
    expect(listProductionVersions({ sourceDir })).toHaveLength(108);
  });

  it("applies canonical-only migrations when the shadow files are excluded in CI", () => {
    const plan = loadProductionMigrationPlan();
    const root = temporaryRoot();
    const sourceDir = join(root, "ci-migrations");
    cpSync(resolve(repoRoot, "supabase/migrations"), sourceDir, { recursive: true });
    for (const shadow of plan.shadowPaths) {
      rmSync(join(sourceDir, shadow.replace("supabase/migrations/", "")));
    }
    const applied = readdirSync(sourceDir).sort();
    expect(applied).toHaveLength(readdirSync(resolve(repoRoot, "supabase/migrations")).length - 12);
    for (const forward of plan.forwardMigrations) {
      expect(applied).toContain(forward.filename);
    }
    for (const alias of plan.appliedAliases) {
      expect(applied).not.toContain(alias.shadow.filename);
    }
  });

  it("rejects missing, extra, reordered, and drifted applied forward aliases", () => {
    const root = temporaryRoot();
    const read = () => JSON.parse(readFileSync(manifestPath, "utf8"));

    const missing = read();
    missing.applied_forward_aliases.pop();
    const missingPath = join(root, "missing-alias.json");
    writeFileSync(missingPath, JSON.stringify(missing));
    expect(() => loadProductionMigrationPlan({ manifestFile: missingPath }))
      .toThrow(/forward migration manifest coverage is not exact/);

    const extra = read();
    extra.applied_forward_aliases.push({
      ...extra.applied_forward_aliases.at(-1),
      remote_version: "20260809000000",
    });
    const extraPath = join(root, "extra-alias.json");
    writeFileSync(extraPath, JSON.stringify(extra));
    expect(() => loadProductionMigrationPlan({ manifestFile: extraPath }))
      .toThrow(/contains duplicate canonical_path|shadow migration file is missing/);

    const reordered = read();
    const [first, second] = reordered.applied_forward_aliases;
    const canonicalOf = (entry: Record<string, unknown>) => ({
      canonical_version: entry.canonical_version,
      canonical_path: entry.canonical_path,
      canonical_local_sha256: entry.canonical_local_sha256,
    });
    reordered.applied_forward_aliases[0] = { ...first, ...canonicalOf(second) };
    reordered.applied_forward_aliases[1] = { ...second, ...canonicalOf(first) };

    const reorderedPath = join(root, "reordered-alias.json");
    writeFileSync(reorderedPath, JSON.stringify(reordered));
    expect(() => loadProductionMigrationPlan({ manifestFile: reorderedPath }))
      .toThrow(/not paired with the canonical forward migration in order/);

    const drifted = read();
    drifted.applied_forward_aliases[0].shadow_local_sha256 = "0".repeat(64);
    const driftedPath = join(root, "drifted-alias.json");
    writeFileSync(driftedPath, JSON.stringify(drifted));
    expect(() => loadProductionMigrationPlan({ manifestFile: driftedPath }))
      .toThrow(/shadow local SHA-256 mismatch/);

    const hashDrift = read();
    hashDrift.applied_forward_aliases[0].remote_statements_sha256 = "0".repeat(64);
    const hashDriftPath = join(root, "hash-drift-alias.json");
    writeFileSync(hashDriftPath, JSON.stringify(hashDrift));
    expect(() => loadProductionMigrationPlan({ manifestFile: hashDriftPath }))
      .toThrow(/remote statement hash must match the runner shadow file/);
  });

  it("keeps a future unaliased forward migration pending after the current package", () => {
    const plan = loadProductionMigrationPlan();
    const rows = parseRemoteLedgerCsv(ledgerCsv(remoteRows(12)));
    const future = { ...plan.forwardLedger.at(-1)! };
    const syntheticPlan = {
      ...plan,
      forwardLedger: [
        ...plan.forwardLedger,
        {
          canonical: { ...future.canonical, version: "20260809120000" },
          alias: null,
          version: "20260809120000",
          name: "future_forward_migration",
          statementsSha256: future.statementsSha256,
        },
      ],
    };

    const reconciliation = validateRemoteLedger(syntheticPlan, rows);
    expect(reconciliation.appliedForward).toHaveLength(12);
    expect(reconciliation.appliedAliases).toHaveLength(12);
    expect(reconciliation.pendingForward).toHaveLength(1);
    expect(reconciliation.pendingForward[0].version).toBe("20260809120000");

    const withFuture = [...rows, {
      remoteVersion: "20260809120000",
      remoteName: "future_forward_migration",
      remoteStatementsSha256: future.statementsSha256,
    }];
    expect(validateRemoteLedger(syntheticPlan, withFuture).pendingForward).toHaveLength(0);
  });

  it("rejects a canonical version recorded directly when an alias exists", () => {
    const plan = loadProductionMigrationPlan();
    const rows = [...remoteRows(), {
      remoteVersion: plan.forwardMigrations[0].version,
      remoteName: plan.forwardMigrations[0].name,
      remoteStatementsSha256: plan.forwardMigrations[0].statementsSha256,
    }];
    expect(() => validateRemoteLedger(plan, parseRemoteLedgerCsv(ledgerCsv(rows))))
      .toThrow(/aliased canonical version unexpectedly exists/);
  });



  it("rejects missing, altered, non-prefix, and schema-attested remote rows", () => {
    const plan = loadProductionMigrationPlan();
    const valid = parseRemoteLedgerCsv(ledgerCsv(remoteRows()));
    expect(() => validateRemoteLedger(plan, valid.slice(0, -1)))
      .toThrow(/expected at least 96/);

    const alteredLegacy = structuredClone(valid);
    alteredLegacy[0].remoteStatementsSha256 = "0".repeat(64);
    expect(() => validateRemoteLedger(plan, alteredLegacy))
      .toThrow(/remote legacy ledger mismatch/);

    const skippedForward = [
      ...valid,
      {
        remoteVersion: plan.forwardLedger[1].version,
        remoteName: plan.forwardLedger[1].name,
        remoteStatementsSha256: plan.forwardLedger[1].statementsSha256,
      },
    ];
    expect(() => validateRemoteLedger(plan, skippedForward))
      .toThrow(/not a canonical prefix/);


    const attested = [
      ...valid,
      {
        remoteVersion: plan.attestations[0].local_version,
        remoteName: "unexpected_attestation",
        remoteStatementsSha256: "0".repeat(64),
      },
    ];
    expect(() => validateRemoteLedger(plan, attested))
      .toThrow(/schema-attested version unexpectedly exists/);
  });

  it("rejects forward name/hash drift and a nonempty output directory", () => {
    const plan = loadProductionMigrationPlan();
    const rows = parseRemoteLedgerCsv(ledgerCsv(remoteRows(1)));
    rows.at(-1)!.remoteName = "wrong_name";
    expect(() => validateRemoteLedger(plan, rows)).toThrow(/forward name mismatch/);

    const hashRows = parseRemoteLedgerCsv(ledgerCsv(remoteRows(1)));
    hashRows.at(-1)!.remoteStatementsSha256 = "0".repeat(64);
    expect(() => validateRemoteLedger(plan, hashRows)).toThrow(/forward statement hash mismatch/);

    const root = temporaryRoot();
    const ledgerCsvPath = join(root, "ledger.csv");
    const outputDir = join(root, "output");
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, "keep.txt"), "do not overwrite");
    writeFileSync(ledgerCsvPath, ledgerCsv(remoteRows()));
    expect(() => buildProductionMigrationView({ ledgerCsvPath, outputDir }))
      .toThrow(/output directory must be empty/);
    expect(readFileSync(join(outputDir, "keep.txt"), "utf8")).toBe("do not overwrite");
  });

  it("fails closed when forward hashes, query hashes, or sanitization evidence drift", () => {
    const root = temporaryRoot();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.forward_migrations[0].remote_statements_sha256 = "0".repeat(64);
    const changedForward = join(root, "changed-forward.json");
    writeFileSync(changedForward, JSON.stringify(manifest));
    expect(() => loadProductionMigrationPlan({ manifestFile: changedForward }))
      .toThrow(/forward statement SHA-256 mismatch/);

    const changedAuditDocument = JSON.parse(readFileSync(manifestPath, "utf8"));
    changedAuditDocument.audit.ledger_query_sha256 = "0".repeat(64);
    const changedAudit = join(root, "changed-audit.json");
    writeFileSync(changedAudit, JSON.stringify(changedAuditDocument));
    expect(() => loadProductionMigrationPlan({ manifestFile: changedAudit }))
      .toThrow(/audit query SHA-256 mismatch/);

    const exceptions = JSON.parse(readFileSync(exceptionsPath, "utf8"));
    exceptions.exceptions[0].sanitized_sha256 = "0".repeat(64);
    const changedExceptions = join(root, "changed-exceptions.json");
    writeFileSync(changedExceptions, JSON.stringify(exceptions));
    expect(() => loadProductionMigrationPlan({ exceptionsFile: changedExceptions }))
      .toThrow(/published sanitization is not exact/);
  });
});
