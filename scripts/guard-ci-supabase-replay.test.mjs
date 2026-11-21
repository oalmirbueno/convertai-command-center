import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import test from "node:test";
import { CanaryStage, createLoopbackProxy, prepareReplay, proveBeforeReplay, releaseReplay, runCanaryStage, runReplay, runWithCanaryCleanup, verifyNetwork } from "./guard-ci-supabase-replay.mjs";

const projectId = "aceleriq-os";
const owner = "123-1-db-tests";
const name = `supabase_network_${projectId}`;
const networkId = "a".repeat(64);
const labels = {
  "com.supabase.cli.project": projectId,
  "com.docker.compose.project": projectId,
  "aceleriq.ci.supabase-replay": owner,
};

function fixture() {
  const f = {
    network: {
      Id: networkId, Name: name, Driver: "bridge", Scope: "local", Internal: true, EnableIPv6: false,
      Labels: labels, IPAM: { Driver: "default", Config: [{ Subnet: "172.28.0.0/16", Gateway: "172.28.0.1" }] },
      Containers: {},
    },
    state: { owner, projectId, networkId },
    existing: "",
    stateWritten: false,
    commands: [],
    containers: [],
    firewall: new Map(),
    proxyReady: true,
    canaryPassed: true,
    proof: false,
    args: [],
    setupServices() {
      f.containers = ["db", "kong", "auth"].map((service, index) => ({
        Id: String(index + 1).repeat(64), Name: `/supabase_${service}_${projectId}`,
        Running: true, Privileged: false, Mounts: [], Labels: labels, NetworkMode: name,
        Networks: { [name]: { NetworkID: networkId, IPAddress: `172.28.0.${index + 2}` } },
      }));
      f.syncAttachments();
    },
    syncAttachments() {
      f.network.Containers = Object.fromEntries(f.containers.map((container) =>
        [container.Id, { IPv4Address: `${container.Networks[name].IPAddress}/16` }]));
    },
  };
  f.runtime = {
    checked: async (command, args) => {
      f.commands.push([command, ...args]);
      if (command === "docker") {
        if (args[0] === "context") return JSON.stringify([{ Name: "default", Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }]);
        if (args[0] === "version") return "28.0.4";
        if (args[0] === "network" && args[1] === "ls") return f.existing;
        if (args[0] === "network" && args[1] === "create") {
          assert(args.includes("--internal") && args.includes("--ipv6=false") && args.at(-1) === name);
          return networkId;
        }
        if (args[0] === "network" && args[1] === "rm") {
          assert.deepEqual(args, ["network", "rm", networkId]);
          f.existing = "";
          return "";
        }
        if (args[0] === "network" && args[1] === "inspect") {
          assert.equal(args[2], networkId);
          return JSON.stringify([f.network]);
        }
        if (args[0] === "ps") return f.containers.map(({ Id, Name }) => `${Id} ${Name.slice(1)}`).join("\n");
        if (args[0] === "container" && args[1] === "inspect") return f.containers.map(JSON.stringify).join("\n");
      }
      if (command === "ip") return JSON.stringify([{ ifname: `br-${networkId.slice(0, 12)}`, linkinfo: { info_kind: "bridge" } }]);
      if (command === "sudo") {
        const [flag, firewall, lock, seconds, operation, chain, ...rest] = args;
        assert.deepEqual([flag, lock, seconds], ["-n", "-w", "5"]);
        assert(["INPUT", "FORWARD"].includes(chain));
        const key = `${firewall}/${chain}`;
        if (operation === "-I") {
          assert(f.stateWritten && rest[0] === "1");
          f.firewall.set(key, rest.slice(1).join(" "));
        } else if (operation === "-C") {
          assert.equal(f.firewall.get(key), rest.join(" "), "missing scoped firewall rule");
        } else if (operation === "-S") {
          return `-P ${chain} ACCEPT\n-A ${chain} ${f.firewall.get(key)}\n-A ${chain} -j ACCEPT`;
        } else if (operation === "-D") {
          assert.equal(f.firewall.get(key), rest.join(" "));
          f.firewall.delete(key);
        } else assert.fail("Unexpected fake firewall operation.");
        return "";
      }
      assert.fail("Offline test cannot invoke a real command.");
    },
    createStateDirectory: async () => { f.commands.push(["state", "mkdir"]); },
    writeState: async (state) => {
      assert.deepEqual(state, f.state);
      f.stateWritten = true;
    },
    checkProxies: async () => {
      f.commands.push(["proxy", "check"]);
      assert(f.proxyReady, "proxy unavailable");
    },
    stopProxies: async () => { f.proxyReady = false; },
    proveNetwork: async () => {
      f.commands.push(["canary", "prove"]);
      assert(f.canaryPassed, "synthetic canary failed");
    },
    recordProof: async () => { f.proof = true; },
    requireProof: async () => { assert(f.proof, "missing pre-replay proof"); },
    runSupabase: async (args) => {
      f.commands.push(["supabase", ...args]);
      f.args.push(args);
      if (args[0] === "start") f.setupServices();
      else {
        f.containers[0].Id = "b".repeat(64);
        f.containers[0].Networks[name].IPAddress = "172.28.0.9";
        f.syncAttachments();
      }
    },
  };
  f.prepare = () => prepareReplay(f.runtime, { projectId, owner });
  f.prove = () => proveBeforeReplay(f.runtime, f.state);
  f.start = () => runReplay(f.runtime, f.state, "start");
  f.release = () => releaseReplay(f.runtime, f.state);
  f.reset = () => runReplay(f.runtime, f.state, "reset");
  return f;
}

test("verifies INPUT and FORWARD for both families and the proxies before start and reset", async () => {
  const f = fixture();
  await f.prepare();
  assert.equal(f.firewall.size, 4);
  await f.prove();
  await f.start();
  await f.reset();
  assert.deepEqual(f.args, [
    ["start", "-x", "vector", "--network-id", name],
    ["db", "reset", "--local", "--no-seed", "--network-id", name],
  ]);
  for (const at of f.commands.map(([command], index) => command === "supabase" ? index : -1).filter((index) => index >= 0)) {
    assert.deepEqual(f.commands[at - 1], ["proxy", "check"]);
    const checks = f.commands.slice(at - 10, at)
      .filter(([command, , , , , operation]) => command === "sudo" && operation === "-C")
      .map(([, , firewall, , , , chain]) => `${firewall}/${chain}`);
    assert.deepEqual(checks, ["iptables/INPUT", "iptables/FORWARD", "ip6tables/INPUT", "ip6tables/FORWARD"]);
  }
  assert.equal(f.containers[0].Networks[name].IPAddress, "172.28.0.9");
});

test("refuses a preexisting stack without creating state or firewall rules", async () => {
  const f = fixture();
  f.existing = name;
  await assert.rejects(f.prepare(), /existing Supabase stack/);
  assert(!f.commands.some(([command]) => command === "state" || command === "sudo"));
});

for (const [reason, change, error] of [
  ["bridge not internal", (f) => { f.network.Internal = false; }, /internal IPv4-only/],
  ["IPv6 enabled", (f) => { f.network.EnableIPv6 = true; }, /internal IPv4-only/],
  ["other network ID", (f) => { f.network.Id = "c".repeat(64); }, /identity changed/],
  ["network not owned", (f) => { f.network.Labels = {}; }, /not owned/],
  ["foreign member", (f) => { f.network.Containers["c".repeat(64)] = {}; }, /membership disagree/],
  ["guard missing", (f) => { f.firewall.delete("ip6tables/FORWARD"); }, /missing scoped firewall rule/],
  ["proxy missing", (f) => { f.proxyReady = false; }, /proxy unavailable/],
]) {
  test(`fails closed before Supabase starts when ${reason}`, async () => {
    const f = fixture();
    await f.prepare();
    change(f);
    await assert.rejects(f.start(), error);
    assert.deepEqual(f.args, []);
  });
}

test("fails closed if a runtime canary fails or its proof is missing", async () => {
  const f = fixture();
  await f.prepare();
  await assert.rejects(f.start(), /missing pre-replay proof/);
  f.canaryPassed = false;
  await assert.rejects(f.prove(), /synthetic canary failed/);
  await assert.rejects(f.start(), /missing pre-replay proof/);
  assert.deepEqual(f.args, []);
});

test("blocks reset when the DB also attaches to another network", async () => {
  const f = fixture();
  await f.prepare();
  await f.prove();
  await f.start();
  f.containers[0].Networks.unexpected = {};
  await assert.rejects(f.reset(), /another network/);
  assert.equal(f.args.length, 1);
});

test("blocks reset when a project service mounts the Docker socket", async () => {
  const f = fixture();
  await f.prepare();
  await f.prove();
  await f.start();
  f.containers[0].Mounts.push({ Destination: "/var/run/docker.sock" });
  await assert.rejects(f.reset(), /socket mount is forbidden/);
  assert.equal(f.args.length, 1);
});

test("releases only the owned bridge and firewall after the ledger fails before startup", async () => {
  const f = fixture();
  await f.prepare();
  await f.prove();
  f.existing = `${networkId} ${name}`;
  await f.release();
  assert.equal(f.existing, "");
  assert.equal(f.proxyReady, false);
  assert.equal(f.firewall.size, 0);
  assert.deepEqual(f.args, []);
});

test("keeps containment when Supabase has not stopped or the bridge changed", async () => {
  const f = fixture();
  await f.prepare();
  f.setupServices();
  await assert.rejects(f.release(), /Stop Supabase/);
  assert(f.proxyReady);
  f.containers = [];
  f.syncAttachments();
  f.existing = `${"b".repeat(64)} ${name}`;
  await assert.rejects(f.release(), /identity changed/);
  assert.equal(f.firewall.size, 4);
});

test("rejects a subnet outside RFC 1918 and a gateway outside its subnet", () => {
  const f = fixture();
  for (const Config of [
    [{ Subnet: "192.0.2.0/24", Gateway: "192.0.2.1" }],
    [{ Subnet: "172.28.0.0/20", Gateway: "172.28.128.1" }],
  ]) {
    const network = { ...f.network, IPAM: { Driver: "default", Config } };
    assert.throws(() => verifyNetwork(network, f.state), /private IPv4/);
  }
});

test("reports the canary stage and a sanitized failure when cleanup also fails", async () => {
  const sensitive = "synthetic do-not-log command output";
  const order = [];
  await assert.rejects(runWithCanaryCleanup(
    () => runCanaryStage(CanaryStage.Ipv6Route, async () => {
      order.push("probe");
      throw new Error(sensitive);
    }),
    () => runCanaryStage(CanaryStage.RemoveBridge, async () => {
      order.push("cleanup");
      throw new Error(sensitive);
    }),
  ), (error) => {
    assert.equal(error.stage, CanaryStage.Ipv6Route);
    assert.equal(error.message, "Synthetic network canary failed at ipv6-default-route (probe failed). Cleanup also failed at remove-synthetic-bridge.");
    assert(!error.message.includes(sensitive));
    return true;
  });
  assert.deepEqual(order, ["probe", "cleanup"]);
});

test("blocks the proof when only cleanup fails", async () => {
  await assert.rejects(runWithCanaryCleanup(
    async () => "healthy probe",
    () => runCanaryStage(CanaryStage.RemoveContainers, async () => { throw new Error("synthetic"); }),
  ), (error) => error.stage === CanaryStage.RemoveContainers);
});

test("loopback proxy resolves each connection and rejects destinations on failed attestation", async (t) => {
  const backend = createServer((socket) => socket.end("synthetic response"));
  const bind = async (server) => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
  };
  const backendPort = await bind(backend);
  t.after(() => backend.close());
  let resolutions = 0;
  const proxy = createLoopbackProxy(async () => {
    if (++resolutions === 2) throw new Error("Synthetic incorrect ownership");
    return "127.0.0.1";
  }, backendPort);
  const proxyPort = await bind(proxy);
  t.after(() => proxy.close());
  const connect = async () => {
    const client = createConnection({ host: "127.0.0.1", port: proxyPort });
    client.setTimeout(3000, () => client.destroy(new Error("Synthetic loopback connection timed out.")));
    let response = "";
    for await (const chunk of client) response += chunk;
    return response;
  };
  assert.equal(await connect(), "synthetic response");
  assert.equal(await connect(), "");
  assert.equal(resolutions, 2);
});
