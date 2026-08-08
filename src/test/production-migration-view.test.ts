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
    ...plan.manifest.forward_migrations.slice(0, appliedForward).map((entry) => ({
      remoteVersion: entry.version,
      remoteName: entry.remote_name,
      remoteStatementsSha256: entry.remote_statements_sha256,
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

  it("validates the explicit 96 + 2 + 12 contract and lists only deployable versions", () => {
    const plan = loadProductionMigrationPlan();
    const versions = listProductionVersions();
    const attested = new Set(plan.attestations.map((entry) => entry.local_version));

    expect(plan.legacyEntries).toHaveLength(96);
    expect(plan.attestations).toHaveLength(2);
    expect(plan.manifest.forward_migrations).toHaveLength(12);
    expect(plan.forwardMigrations).toHaveLength(12);
    expect(versions).toHaveLength(108);
    expect(versions).toEqual([...versions].sort());
    expect(versions.some((version) => attested.has(version))).toBe(false);

    const cli = spawnSync(process.execPath, [scriptPath, "--list-versions"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stderr).toBe("");
    expect(cli.stdout).toBe(`${versions.join("\n")}\n`);

    const sqlValues = formatProductionLedgerSqlValues();
    expect(sqlValues.split("\n")).toHaveLength(108);
    expect(sqlValues).toMatch(/^\('20260223193632','',[0-9a-f']+\),/);
    expect(sqlValues).toContain("'20260807223000','harden_api_gateway_tenant_scope'");
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

  it("turns an applied forward prefix into sentinels and leaves only its suffix pending", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture(2);

    expect(result.appliedForward).toBe(2);
    expect(result.pendingForward).toBe(10);
    for (const forward of plan.forwardMigrations.slice(0, 2)) {
      expect(readFileSync(join(outputDir, forward.filename), "utf8"))
        .toContain(`migration sentinel ${forward.version}`);
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
        remoteVersion: plan.forwardMigrations[1].version,
        remoteName: plan.forwardMigrations[1].name,
        remoteStatementsSha256: plan.forwardMigrations[1].statementsSha256,
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
