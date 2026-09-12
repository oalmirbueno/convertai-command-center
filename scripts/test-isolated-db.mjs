import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = [
  {
    name: "security",
    fixture: "tests/database-isolated/fixtures/security_contract.sql",
    migration: "supabase/migrations/20260912213530_rpc_caller_boundaries_preserve_data.sql",
    tests: ["tests/database-isolated/tests/rpc_caller_boundaries.test.sql"],
  },
  {
    name: "publication",
    fixture: "tests/database-isolated/fixtures/publication_contract.sql",
    migration: "supabase/migrations/20260912213638_secure_publication_cancellation_dispatch.sql",
    tests: [
      "tests/database-isolated/tests/publication_cancellation_dispatch.test.sql",
      "tests/database-isolated/tests/publication_dispatch_concurrency.test.sql",
    ],
  },
];

function connectionSettings(env) {
  const host = env.PGHOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error("Isolated tests require literal loopback PGHOST (127.0.0.1, ::1 or localhost).");
  }
  const port = env.PGPORT || "54322";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PGPORT must be a valid numeric local port.");
  }
  if (env.PGUSER && env.PGUSER !== "postgres") {
    throw new Error("Isolated tests require PGUSER=postgres.");
  }
  return { host: host === "localhost" ? "127.0.0.1" : host, port, user: "postgres" };
}

function assertDatabase(database) {
  if (!/^acq_isolated_(security|publication)_[a-z0-9_]+$/.test(database) || database.length > 63) {
    throw new Error("Refusing database outside the generated acq_isolated_ namespace.");
  }
}

function verifyTap(output) {
  if (/^(?:not ok\b|Bail out!)/m.test(output)) throw new Error("pgTAP reported a failed assertion or bailout.");
  const plans = [...output.matchAll(/^1\.\.(\d+)(?:[ \t].*)?\r?$/gm)];
  const tests = [...output.matchAll(/^ok(?:[ \t]+(\d+))?(?:[ \t]|\r?$)/gm)];
  if (plans.length !== 1 || Number(plans[0][1]) < 1 || Number(plans[0][1]) !== tests.length) {
    throw new Error("pgTAP plan missing, duplicated, empty or incomplete.");
  }
  tests.forEach((test, index) => {
    if (test[1] && Number(test[1]) !== index + 1) throw new Error("pgTAP assertion sequence is incomplete.");
  });
  return tests.length;
}

function sqlLiteral(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

async function main() {
  if (process.argv.includes("--self-test")) {
    assert.throws(() => connectionSettings({ PGHOST: "production.example" }));
    assert.throws(() => connectionSettings({ PGHOST: "127.0.0.1,production.example" }));
    assert.throws(() => connectionSettings({ PGHOST: "127.0.0.1", PGUSER: "service_role" }));
    assert.throws(() => connectionSettings({ PGPORT: "5432 options=unsafe" }));
    assert.equal(connectionSettings({ PGHOST: "localhost" }).host, "127.0.0.1");
    assert.throws(() => assertDatabase("postgres"));
    assert.throws(() => assertDatabase("acq_isolated_security_x;DROP DATABASE postgres"));
    assertDatabase("acq_isolated_security_test_123");
    assert.equal(verifyTap("ok 1 - positive\nok 2 - negative\n1..2\n"), 2);
    for (const invalid of ["not ok 1 - bad\n1..1\n", "Bail out! error\n", "ok 1 - partial\n1..2\n", "ok 2 - missing\n1..1\n", "1..0\n", "ok 1 - duplicate plan\n1..1\n1..1\n"]) {
      assert.throws(() => verifyTap(invalid));
    }
    console.log("Isolated DB runner self-test: loopback, namespace and TAP failure checks passed.");
    return;
  }
  if (process.argv.length > 2) throw new Error("Unsupported arguments. Configure PSQL_PATH/PGHOST/PGPORT/PGUSER through the environment.");
  const connection = connectionSettings(process.env);
  const executable = process.env.PSQL_PATH || "psql";
  const childEnv = { ...process.env, PGHOST: connection.host, PGHOSTADDR: connection.host,
    PGPORT: connection.port, PGUSER: connection.user, PGCONNECT_TIMEOUT: "5", PGAPPNAME: "aceleriq-isolated-tests" };
  for (const key of ["PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) delete childEnv[key];
  const password = process.env.PGPASSWORD || "";
  const logFolder = path.join(root, "logs", "database-isolated");
  await mkdir(logFolder, { recursive: true });
  const suffix = Date.now().toString(36) + "_" + process.pid + "_" + randomBytes(3).toString("hex");
  let assertionCount = 0;

  async function psql(database, sql, label, { isolated = true } = {}) {
    if (isolated) assertDatabase(database);
    const args = ["-X", "-q", "-t", "-A", "-w", "-v", "ON_ERROR_STOP=1",
      "-h", connection.host, "-p", connection.port, "-U", connection.user, "-d", database];
    // Optional local password travels through stdin, never command arguments
    // or logs. dblink needs it for local CI's password-authenticated server.
    const prelude = "SET standard_conforming_strings=on;\nSET statement_timeout='60s';\n" + (isolated
      ? "SET aceleriq.isolated_tests='on';\nSET aceleriq.test_dblink_password=" + sqlLiteral(password) + ";\n" : "");
    const child = spawn(executable, args, { cwd: root, env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.stdin.on("error", () => {}); // spawn/close below reports process errors.
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
      child.stdin.end(prelude + sql + "\n");
    });
    const safeOutput = password ? output.replaceAll(password, "[local-password]") : output;
    await writeFile(path.join(logFolder, label + ".log"), safeOutput);
    if (code !== 0) throw new Error(label + ": psql failed (" + code + ").\n" + safeOutput.slice(-8000));
    return output;
  }

  for (const suite of suites) {
    const database = "acq_isolated_" + suite.name + "_" + suffix;
    assertDatabase(database);
    // Only CREATE DATABASE targets local postgres. No fixture/migration/test
    // can run against the application or maintenance database.
    await psql("postgres", 'CREATE DATABASE "' + database + '" TEMPLATE template0;', suite.name + "-create", { isolated: false });
    console.log(suite.name + ": created " + database + " at " + connection.host + ":" + connection.port);
    for (const [label, relative] of [
      ["bootstrap", "tests/database-isolated/bootstrap.sql"], ["fixture", suite.fixture], ["migration", suite.migration],
    ]) {
      await psql(database, await readFile(path.join(root, relative), "utf8"), suite.name + "-" + label);
    }
    for (const relative of suite.tests) {
      const label = path.basename(relative, ".sql");
      const output = await psql(database, await readFile(path.join(root, relative), "utf8"), label);
      const count = verifyTap(output);
      assertionCount += count;
      console.log(label + ": " + count + " assertions passed");
    }
    console.log(suite.name + ": synthetic database retained for inspection; no automatic deletion.");
  }
  console.log("Isolated database contracts: " + assertionCount + " assertions passed. Logs: logs/database-isolated/");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
