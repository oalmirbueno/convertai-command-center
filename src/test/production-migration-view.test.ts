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
/**
 * Os testes que montam o pacote inteiro copiam uma migration por arquivo.
 * Com a declaracao das 29 que faltavam, passaram de 19 para 48 arquivos por
 * montagem e, rodando junto com a suite toda, estouravam os 5s padrao do
 * vitest. O prazo maior nao afrouxa nada: as assercoes continuam iguais.
 */
const TEMPO_PACOTE_COMPLETO = 20_000;

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

// Timeout proprio: os its montam pacotes reais no filesystem e, com a suite
// inteira em paralelo, o padrao de 5s estoura por CARGA — nao por regressao.
// O falso-vermelho recorrente custava um cheque manual a cada rodada.
describe("production migration view", { timeout: 30000 }, () => {
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

  it("validates the explicit 96 + 2 + 64 canonical + 12 alias contract", () => {
    const plan = loadProductionMigrationPlan();
    const versions = listProductionVersions();
    const attested = new Set(plan.attestations.map((entry) => entry.local_version));

    expect(plan.legacyEntries).toHaveLength(96);
    expect(plan.attestations).toHaveLength(2);
    expect(plan.manifest.forward_migrations).toHaveLength(88);
    expect(plan.forwardMigrations).toHaveLength(88);
    expect(plan.manifest.applied_forward_aliases).toHaveLength(12);
    expect(plan.appliedAliases).toHaveLength(12);
    expect(plan.shadowPaths).toHaveLength(12);
    expect(plan.forwardLedger).toHaveLength(88);
    expect(versions).toHaveLength(184);
    expect(versions).toEqual([...versions].sort());
    expect(versions.some((version) => attested.has(version))).toBe(false);
    // Aliased canonical versions are never remote rows; the unaliased forward
    // migrations are recorded under their own canonical versions.
    for (const alias of plan.appliedAliases) {
      expect(versions).not.toContain(alias.canonical.version);
    }
    const unaliased = plan.forwardLedger.filter((entry) => entry.alias === null);
    expect(unaliased).toHaveLength(76);
    for (const forward of unaliased) {
      expect(versions).toContain(forward.canonical.version);
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
    expect(sqlValues.split("\n")).toHaveLength(184);
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

  it("declares an exact remote hash mode per forward migration and uses raw ledger hashes", () => {
    const plan = loadProductionMigrationPlan();
    const entries = plan.manifest.forward_migrations as Array<Record<string, string>>;
    const aliasEntries = plan.manifest.applied_forward_aliases as Array<Record<string, string>>;

    const cliSplit = entries.filter(
      (entry) => entry.remote_hash_mode === "supabase_cli_split",
    );
    expect(cliSplit).toHaveLength(83);
    const hardening = cliSplit.find((entry) => entry.version === "20260809044000")!;
    const hardeningSource = plan.forwardMigrations.find(
      (source) => source.version === hardening.version,
    )!;
    expect(hardening.remote_statements_sha256).toBe(hardeningSource.statementsSha256);
    expect(hardening.remote_statements_sha256).not.toBe(hardeningSource.sha256);

    const financeV2 = cliSplit.find((entry) => entry.version === "20260810150000")!;
    const financeV2Source = plan.forwardMigrations.find(
      (source) => source.version === financeV2.version,
    )!;
    expect(financeV2.remote_statements_sha256).toBe(financeV2Source.statementsSha256);
    expect(financeV2.remote_statements_sha256).not.toBe(financeV2Source.sha256);

    const direct = entries.filter((entry) => entry.remote_hash_mode === "runner_exact_sql");
    expect(direct).toHaveLength(5);
    expect(direct.map((entry) => entry.version)).toEqual([
      "20260809030446",
      "20260809032942",
      "20260809034005",
      "20260809040741",
      "20260809042538",
    ]);
    expect(direct[0].remote_statements_sha256)
      .toBe("21391458d27641651e4c116e77a92062430c8b1dd44bdba171b0c652f0d06833");
    expect(direct[1].remote_statements_sha256)
      .toBe("be2e27a8f095691a56f01176014fc05594c457f3f2373f4c18ecd51a43c0743d");
    expect(direct[2].remote_statements_sha256)
      .toBe("a26a6fd36ffe858ef71d4d9f54309463501aa63ffeca1979fa9c2ca8ba470e1b");
    expect(direct[3].remote_statements_sha256)
      .toBe("6b330467ac033ffafab47a3d866238ccfcd2032c9d83bb4eed7a0d4a1de0fe83");
    expect(direct[4].remote_statements_sha256)
      .toBe("ef8b5e8497d14caffd11523edadf741c187b7f29e13a02b4be346c633b987bdc");

    // Every direct runner row is the raw SQL bytes, never the split/trim hash.
    for (const entry of direct) {
      const source = plan.forwardMigrations.find(
        (candidate) => candidate.version === entry.version,
      )!;
      expect(entry.remote_statements_sha256).toBe(source.sha256);
      expect(entry.remote_statements_sha256).not.toBe(source.statementsSha256);
      const ledgerEntry = plan.forwardLedger.find(
        (candidate) => candidate.canonical.version === entry.version,
      )!;
      expect(ledgerEntry.alias).toBeNull();
      expect(ledgerEntry.statementsSha256).toBe(source.sha256);
    }


    // Every alias row is the raw shadow file bytes, never the split/trim hash.
    for (const [index, entry] of aliasEntries.entries()) {
      expect(entry.remote_statements_sha256).toBe(entry.shadow_local_sha256);
      expect(entry.remote_statements_sha256).not.toBe(entry.shadow_statements_sha256);
      expect(plan.appliedAliases[index].remoteStatementsSha256).toBe(entry.shadow_local_sha256);
      expect(plan.appliedAliases[index].shadow.sha256).toBe(entry.shadow_local_sha256);
      expect(plan.appliedAliases[index].shadow.statementsSha256)
        .toBe(entry.shadow_statements_sha256);
    }
  });

  it("rejects normalized hashes, invalid modes, and swapped modes", () => {
    const root = temporaryRoot();
    const read = () => JSON.parse(readFileSync(manifestPath, "utf8"));
    const write = (name: string, document: unknown) => {
      const path = join(root, name);
      writeFileSync(path, JSON.stringify(document));
      return path;
    };

    const aliasSplit = read();
    aliasSplit.applied_forward_aliases[0].remote_statements_sha256 =
      aliasSplit.applied_forward_aliases[0].shadow_statements_sha256;
    expect(() => loadProductionMigrationPlan({ manifestFile: write("alias-split.json", aliasSplit) }))
      .toThrow(/remote statement hash must match the runner shadow file bytes/);

    const directSplit = read();
    const directIndex = directSplit.forward_migrations
      .map((entry: { remote_hash_mode: string }) => entry.remote_hash_mode)
      .lastIndexOf("runner_exact_sql");
    expect(directIndex).toBeGreaterThanOrEqual(0);
    directSplit.forward_migrations[directIndex].remote_statements_sha256 =
      "3ba673061202460cedbfddf8e099cf0dc9b9e60184a8ba8283b018fda2e09227";
    expect(() => loadProductionMigrationPlan({ manifestFile: write("direct-split.json", directSplit) }))
      .toThrow(/forward raw SQL SHA-256 mismatch/);

    const invalidMode = read();
    invalidMode.forward_migrations[0].remote_hash_mode = "either";
    expect(() => loadProductionMigrationPlan({ manifestFile: write("invalid-mode.json", invalidMode) }))
      .toThrow(/remote_hash_mode is invalid/);

    const missingMode = read();
    delete missingMode.forward_migrations[0].remote_hash_mode;
    expect(() => loadProductionMigrationPlan({ manifestFile: write("missing-mode.json", missingMode) }))
      .toThrow(/has an invalid contract/);

    // Swapping the declared mode without swapping the hash must fail closed in
    // both directions — no fallback and no accepting both hash shapes.
    const swappedCanonical = read();
    swappedCanonical.forward_migrations[0].remote_hash_mode = "runner_exact_sql";
    expect(() => loadProductionMigrationPlan({
      manifestFile: write("swapped-canonical.json", swappedCanonical),
    })).toThrow(/forward raw SQL SHA-256 mismatch/);

    const swappedDirect = read();
    swappedDirect.forward_migrations[directIndex].remote_hash_mode = "supabase_cli_split";
    expect(() => loadProductionMigrationPlan({
      manifestFile: write("swapped-direct.json", swappedDirect),
    })).toThrow(/forward statement SHA-256 mismatch/);
  });

  it("accepts the live 115-row raw ledger and rejects normalized rows", () => {
    const plan = loadProductionMigrationPlan();
    const rows = remoteRows(88);
    expect(rows).toHaveLength(184);
    const reconciliation = validateRemoteLedger(plan, parseRemoteLedgerCsv(ledgerCsv(rows)));
    expect(reconciliation.pendingForward).toHaveLength(0);
    expect(reconciliation.appliedForward).toHaveLength(88);
    expect(reconciliation.appliedAliases).toHaveLength(12);

    const normalizedAlias = structuredClone(rows);
    normalizedAlias[96].remoteStatementsSha256 =
      plan.appliedAliases[0].shadow.statementsSha256;
    expect(() => validateRemoteLedger(plan, parseRemoteLedgerCsv(ledgerCsv(normalizedAlias))))
      .toThrow(/forward statement hash mismatch/);

    for (const index of [108, 109, 110, 111, 112]) {
      const normalizedDirect = structuredClone(rows);
      const source = plan.forwardMigrations.find(
        (candidate) => candidate.version === normalizedDirect[index].remoteVersion,
      )!;
      normalizedDirect[index].remoteStatementsSha256 = source.statementsSha256;
      expect(() => validateRemoteLedger(plan, parseRemoteLedgerCsv(ledgerCsv(normalizedDirect))))
        .toThrow(/forward statement hash mismatch/);
    }
  });



  it("emits legacy sentinels, omits attestations, and copies pending forward SQL byte-for-byte", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture();
    const filenames = readdirSync(outputDir).sort();

    expect(result).toEqual({
      aliases: 96,
      appliedForward: 0,
      appliedAliases: 0,
      pendingForward: 88,
      files: 184,
    });
    expect(filenames).toHaveLength(184);
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
  }, TEMPO_PACOTE_COMPLETO);

  it("reconciles the live aliased ledger to sentinels only and zero pending forward", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture(88);
    const filenames = readdirSync(outputDir).sort();

    expect(result).toEqual({
      aliases: 96,
      appliedForward: 88,
      appliedAliases: 12,
      pendingForward: 0,
      files: 184,
    });
    expect(filenames).toHaveLength(184);
    expect(filenames.filter((name) => name.endsWith("_production_ledger_sentinel.sql")))
      .toHaveLength(108);
    // The unaliased forwards keep their canonical filenames, but its content must
    // still be the fail-closed sentinel for the version already in the ledger.
    for (const entry of plan.forwardLedger.filter((item) => item.alias === null)) {
      expect(filenames).toContain(entry.canonical.filename);
      const emitted = readFileSync(join(outputDir, entry.canonical.filename), "utf8");
      expect(emitted).toContain(`migration sentinel ${entry.version}`);
      expect(emitted).toContain("RAISE EXCEPTION");
      expect(emitted).not.toContain("ALTER VIEW");
    }
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
  }, TEMPO_PACOTE_COMPLETO);

  it("turns an applied forward prefix into sentinels and leaves only its suffix pending", () => {
    const plan = loadProductionMigrationPlan();
    const { outputDir, result } = buildFixture(2);

    expect(result.appliedForward).toBe(2);
    expect(result.appliedAliases).toBe(2);
    expect(result.pendingForward).toBe(86);
    for (const applied of plan.forwardLedger.slice(0, 2)) {
      expect(readFileSync(
        join(outputDir, `${applied.version}_production_ledger_sentinel.sql`),
        "utf8",
      )).toContain(`migration sentinel ${applied.version}`);
    }
    expect(readFileSync(join(outputDir, plan.forwardMigrations[2].filename)))
      .toEqual(plan.forwardMigrations[2].bytes);
  }, TEMPO_PACOTE_COMPLETO);

  it("supports the workflow source-directory override", () => {
    const root = temporaryRoot();
    const sourceDir = join(root, "repository-migrations");
    cpSync(resolve(repoRoot, "supabase/migrations"), sourceDir, { recursive: true });
    expect(listProductionVersions({ sourceDir })).toHaveLength(184);
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
  }, TEMPO_PACOTE_COMPLETO);

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
    // Both stay in lockstep so the file-level shadow hash check is the one that
    // fails, keeping the original coverage intact under the raw-hash contract.
    drifted.applied_forward_aliases[0].shadow_local_sha256 = "0".repeat(64);
    drifted.applied_forward_aliases[0].remote_statements_sha256 = "0".repeat(64);
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
    const rows = parseRemoteLedgerCsv(ledgerCsv(remoteRows(88)));
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
    expect(reconciliation.appliedForward).toHaveLength(88);
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
  }, TEMPO_PACOTE_COMPLETO);

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

  it("keeps a future supabase_cli_split forward pending until its split hash lands", () => {
    const plan = loadProductionMigrationPlan();
    const canonical = plan.forwardMigrations[0];
    const syntheticPlan = {
      ...plan,
      forwardLedger: [
        ...plan.forwardLedger,
        {
          canonical: { ...canonical, version: "20260810120000" },
          alias: null,
          version: "20260810120000",
          name: "future_split_forward",
          // supabase_cli_split declares the split/trim hash as the remote hash.
          statementsSha256: canonical.statementsSha256,
        },
      ],
    };

    const live = parseRemoteLedgerCsv(ledgerCsv(remoteRows(88)));
    const pending = validateRemoteLedger(syntheticPlan, live);
    expect(pending.pendingForward).toHaveLength(1);
    expect(pending.pendingForward[0].bytes).toEqual(canonical.bytes);

    const withSplit = [...live, {
      remoteVersion: "20260810120000",
      remoteName: "future_split_forward",
      remoteStatementsSha256: canonical.statementsSha256,
    }];
    expect(validateRemoteLedger(syntheticPlan, withSplit).pendingForward).toHaveLength(0);

    const withRaw = [...live, {
      remoteVersion: "20260810120000",
      remoteName: "future_split_forward",
      remoteStatementsSha256: canonical.sha256,
    }];
    expect(() => validateRemoteLedger(syntheticPlan, withRaw))
      .toThrow(/forward statement hash mismatch/);
  });
});
