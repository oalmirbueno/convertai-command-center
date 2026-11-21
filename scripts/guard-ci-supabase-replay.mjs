import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, get as httpGet } from "node:http";
import { BlockList, createConnection, createServer, isIPv4 } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseProjectId, validateEnvironment } from "./guard-ci-e2e-network.mjs";

const LABELS = ["com.supabase.cli.project", "com.docker.compose.project"];
const OWNED_LABEL = "aceleriq.ci.supabase-replay";
const ID = /^[a-f0-9]{64}$/;
const SERVICES = [
  { service: "db", hostPort: 54322, containerPort: 5432 },
  { service: "kong", hostPort: 54321, containerPort: 8000 },
];
const FIREWALLS = ["iptables", "ip6tables"];
const CHAINS = ["INPUT", "FORWARD"];
// Published by Docker Official Images for linux/amd64, busybox:1.37.0-musl.
const CANARY_IMAGE = "docker.io/library/busybox@sha256:5624bb6777cf469b1fb50ae3f981b15d2715ee2fffaf20b9998cfb7843726835";
const CANARY_RESPONSE = "aceleriq-ci-replay-canary";
export const CanaryStage = Object.freeze({
  GatewayListener: "gateway-listener",
  ComparisonBridge: "comparison-bridge",
  ComparisonServer: "comparison-server",
  DbServer: "db-server",
  DbProxy: "db-loopback",
  KongServer: "kong-server",
  KongProxy: "kong-loopback",
  ComparisonAddress: "comparison-address",
  ComparisonHttp: "comparison-http",
  InternalDns: "internal-dns",
  GatewayHttp: "gateway-http",
  Ipv4Route: "ipv4-default-route",
  Ipv6Route: "ipv6-default-route",
  BlockComparison: "comparison-bridge-block",
  BlockGateway: "gateway-block",
  RemoveContainers: "remove-synthetic-containers",
  RemoveBridge: "remove-synthetic-bridge",
});

class ReplayCommandError extends Error {
  constructor(command, code) {
    const exitCode = Number.isInteger(code) ? code : null;
    super(`${command} replay isolation check failed (exit ${exitCode ?? "unknown"}).`);
    this.exitCode = exitCode;
  }
}

class DefaultRouteError extends Error {}

class CanaryError extends Error {
  constructor(stage, cause) {
    const socketCodes = ["EADDRINUSE", "EADDRNOTAVAIL", "ECONNREFUSED", "ETIMEDOUT"];
    const code = cause instanceof ReplayCommandError && cause.exitCode !== null ? `exit ${cause.exitCode}`
      : socketCodes.includes(cause?.code) ? cause.code
      : cause instanceof DefaultRouteError ? cause.message
      : cause?.code === "ERR_ASSERTION" ? "unexpected result" : "probe failed";
    super(`Synthetic network canary failed at ${stage} (${code}).`, { cause });
    this.stage = stage;
  }
}

export async function runCanaryStage(stage, run) {
  assert(Object.values(CanaryStage).includes(stage), "Unknown synthetic canary stage.");
  try {
    return await run();
  } catch (error) {
    throw new CanaryError(stage, error);
  }
}

export async function runWithCanaryCleanup(run, cleanup) {
  let primary;
  try {
    return await run();
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!primary) throw error;
      if (primary instanceof CanaryError) {
        const stage = error instanceof CanaryError ? error.stage : "cleanup";
        primary.message += ` Cleanup also failed at ${stage}.`;
      }
    }
  }
}
const CONTAINER_FIELDS = '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}},"Privileged":{{json .HostConfig.Privileged}},"NetworkMode":{{json .HostConfig.NetworkMode}},"Mounts":{{json .Mounts}},"Labels":{{json .Config.Labels}},"Networks":{{json .NetworkSettings.Networks}}}';

function bridgeName(networkId) {
  return `br-${networkId.slice(0, 12)}`;
}

function networkName(projectId) {
  return `supabase_network_${projectId}`;
}

function projectContainer(name, projectId) {
  return name.startsWith("supabase_") && name.endsWith(`_${projectId}`);
}

function subnetContains(cidr, ip) {
  const blocks = new BlockList();
  const [base, mask] = cidr.split("/");
  blocks.addSubnet(base, Number(mask));
  return isIPv4(ip) && blocks.check(ip);
}

export function verifyNetwork(network, state) {
  assert(ID.test(state.networkId) && network.Id === state.networkId, "Supabase network identity changed.");
  assert.equal(network.Name, networkName(state.projectId), "Unexpected Supabase network name.");
  assert(network.Internal === true && network.EnableIPv6 === false, "Expected internal IPv4-only Docker network.");
  assert(network.Driver === "bridge" && network.Scope === "local" && !network.Ingress, "Expected a local Docker bridge.");
  assert(!network.Options?.["com.docker.network.bridge.name"] ||
    network.Options["com.docker.network.bridge.name"] === bridgeName(state.networkId), "Unexpected bridge interface.");
  assert(LABELS.every((label) => network.Labels?.[label] === state.projectId) &&
    network.Labels?.[OWNED_LABEL] === state.owner, "Supabase network is not owned by this runner job.");
  return privateAllocation(network);
}

function privateAllocation(network) {
  assert(network.IPAM?.Driver === "default" && network.IPAM.Config?.length === 1, "Unexpected bridge address allocation.");
  const { Subnet: cidr, Gateway: gateway } = network.IPAM.Config[0];
  const [base, rawMask] = String(cidr).split("/");
  const mask = Number(rawMask);
  const privateRange = [["10.0.0.0/8", 8], ["172.16.0.0/12", 12], ["192.168.0.0/16", 16]];
  assert(/^\d+$/.test(rawMask ?? "") && mask <= 30 &&
    privateRange.some(([range, prefix]) => mask >= prefix && subnetContains(range, base)) &&
    subnetContains(cidr, gateway), "Expected a private IPv4 subnet and gateway.");
  return { cidr, gateway };
}

function verifyContainer(container, network, state) {
  assert(ID.test(container.Id) && container.Running === true && container.Privileged === false &&
    LABELS.every((label) => container.Labels?.[label] === state.projectId), "Unexpected Supabase container identity.");
  assert(projectContainer(container.Name.replace(/^\//, ""), state.projectId), "Unexpected Supabase container name.");
  assert(!container.Mounts.some(({ Source, Destination }) =>
    [Source, Destination].some((item) => /(^|\/)docker\.sock$/.test(item ?? ""))), "Docker socket mount is forbidden in the isolated stack.");
  assert([networkName(state.projectId), state.networkId].includes(container.NetworkMode) &&
    Object.keys(container.Networks).length === 1, "Supabase container has another network.");
  const attachment = container.Networks[networkName(state.projectId)];
  assert(attachment?.NetworkID === state.networkId && !attachment.GlobalIPv6Address && !attachment.IPv6Gateway,
    "Supabase container is not on the isolated IPv4 network.");
  const { cidr, gateway } = verifyNetwork(network, state);
  assert(attachment.IPAddress !== gateway && subnetContains(cidr, attachment.IPAddress), "Container address is outside the owned bridge.");
  assert.equal(network.Containers[container.Id]?.IPv4Address, `${attachment.IPAddress}/${cidr.split("/")[1]}`,
    "Container address disagrees with the owned bridge.");
  return attachment.IPAddress;
}

async function inspectNetwork(runtime, state) {
  const rows = JSON.parse(await runtime.checked("docker", ["network", "inspect", state.networkId]));
  assert.equal(rows.length, 1, "Expected one owned Docker network.");
  verifyNetwork(rows[0], state);
  return rows[0];
}

async function inspectContainers(runtime, projectId) {
  const inventory = await runtime.checked("docker", ["ps", "--all", "--no-trunc", "--format", "{{.ID}} {{.Names}}"]);
  const ids = inventory.split("\n").map((row) => row.split(" "))
    .filter(([, name]) => name && projectContainer(name, projectId))
    .map(([id]) => id);
  if (!ids.length) return [];
  assert(ids.every((id) => ID.test(id)), "Malformed project container identifiers.");
  const rows = await runtime.checked("docker", ["container", "inspect", "--format", CONTAINER_FIELDS, ...ids]);
  return rows.split("\n").map((row) => JSON.parse(row));
}

async function verifyTopology(runtime, state, empty) {
  const network = await inspectNetwork(runtime, state);
  const containers = await inspectContainers(runtime, state.projectId);
  assert.deepEqual(containers.map(({ Id }) => Id).sort(), Object.keys(network.Containers ?? {}).sort(),
    "Project containers and isolated network membership disagree.");
  if (empty) {
    assert.equal(containers.length, 0, "An empty network is required before start.");
    return;
  }
  for (const container of containers) verifyContainer(container, network, state);
  for (const service of ["db", "kong", "auth"]) {
    assert(containers.some(({ Name }) => Name === `/supabase_${service}_${state.projectId}`),
      `Missing isolated service ${service}.`);
  }
}

function firewallRule(state, chain) {
  const bridge = bridgeName(state.networkId);
  const match = chain === "INPUT" ? ["-m", "conntrack", "!", "--ctstate", "ESTABLISHED"] : ["!", "-o", bridge];
  return ["-i", bridge, ...match, "-m", "comment", "--comment", `aceleriq-replay-${state.owner}`, "-j", "DROP"];
}

async function proveFirewall(runtime, state) {
  const bridge = bridgeName(state.networkId);
  const links = JSON.parse(await runtime.checked("ip", ["-j", "-d", "link", "show", "dev", bridge]));
  assert(links.length === 1 && links[0].ifname === bridge && links[0].linkinfo?.info_kind === "bridge",
    "Expected the owned Linux bridge interface.");
  for (const firewall of FIREWALLS) {
    for (const chain of CHAINS) {
      await runtime.checked("sudo", ["-n", firewall, "-w", "5", "-C", chain, ...firewallRule(state, chain)]);
      const rules = await runtime.checked("sudo", ["-n", firewall, "-w", "5", "-S", chain]);
      const chainRules = rules.split("\n").filter((line) => line.startsWith(`-A ${chain} `));
      const owned = chainRules.filter((line) => line.includes(`--comment aceleriq-replay-${state.owner} `) ||
        line.includes(`--comment "aceleriq-replay-${state.owner}" `));
      assert(owned.length === 1 && owned[0] === chainRules[0], `The replay guard must be first in ${chain}.`);
    }
  }
}

async function requireDocker(runtime) {
  const context = JSON.parse(await runtime.checked("docker", ["context", "inspect"]));
  assert(context.length === 1 && context[0].Name === "default" &&
    context[0].Endpoints?.docker?.Host === "unix:///var/run/docker.sock", "Expected the default local Docker context.");
  const version = await runtime.checked("docker", ["version", "--format", "{{.Server.Version}}"]);
  assert(/^\d+\.\d+\.\d+/.test(version) && Number(version.split(".")[0]) >= 28,
    "Docker 28 or newer is required for the internal resolver boundary.");
}

export async function prepareReplay(runtime, identity) {
  await requireDocker(runtime);
  const projectNetwork = networkName(identity.projectId);
  const existing = await runtime.checked("docker", ["network", "ls", "--format", "{{.Name}}"]);
  assert(!existing.split("\n").includes(projectNetwork) &&
    !(await inspectContainers(runtime, identity.projectId)).length, "Refusing to adopt an existing Supabase stack.");
  await runtime.createStateDirectory();
  const networkId = await runtime.checked("docker", ["network", "create", "--driver", "bridge",
    "--internal", "--ipv6=false", ...LABELS.flatMap((label) => ["--label", `${label}=${identity.projectId}`]),
    "--label", `${OWNED_LABEL}=${identity.owner}`, projectNetwork]);
  assert(ID.test(networkId), "Malformed Docker network identifier.");
  const state = { ...identity, networkId };
  await runtime.writeState(state);
  await verifyTopology(runtime, state, true);
  for (const firewall of FIREWALLS) {
    for (const chain of CHAINS) {
      await runtime.checked("sudo", ["-n", firewall, "-w", "5", "-I", chain, "1", ...firewallRule(state, chain)]);
    }
  }
  await proveFirewall(runtime, state);
}

export async function proveBeforeReplay(runtime, state) {
  await requireDocker(runtime);
  await verifyTopology(runtime, state, true);
  await proveFirewall(runtime, state);
  await runtime.checkProxies();
  await runtime.proveNetwork(state);
  await verifyTopology(runtime, state, true);
  await proveFirewall(runtime, state);
  await runtime.checkProxies();
  await runtime.recordProof(state);
}

export async function runReplay(runtime, state, mode) {
  assert(mode === "start" || mode === "reset", "Unexpected Supabase replay phase.");
  await requireDocker(runtime);
  await verifyTopology(runtime, state, mode === "start");
  await proveFirewall(runtime, state);
  await runtime.checkProxies();
  await runtime.requireProof(state);
  const args = mode === "start" ? ["start", "-x", "vector"] : ["db", "reset", "--local", "--no-seed"];
  await runtime.runSupabase([...args, "--network-id", networkName(state.projectId)]);
  await verifyReplay(runtime, state);
}

async function verifyReplay(runtime, state) {
  await runtime.requireProof(state);
  await verifyTopology(runtime, state, false);
  await proveFirewall(runtime, state);
  await runtime.checkProxies();
}

export async function releaseReplay(runtime, state) {
  await requireDocker(runtime);
  assert.equal((await inspectContainers(runtime, state.projectId)).length, 0,
    "Stop Supabase before releasing network protection.");
  await runtime.stopProxies();
  const networks = await runtime.checked("docker", ["network", "ls", "--no-trunc", "--format", "{{.ID}} {{.Name}}"]);
  const owned = networks.split("\n").find((line) => line.endsWith(` ${networkName(state.projectId)}`));
  if (owned) {
    assert.equal(owned.split(" ")[0], state.networkId, "Supabase network identity changed.");
    await verifyTopology(runtime, state, true);
    await runtime.checked("docker", ["network", "rm", state.networkId]);
  }
  for (const firewall of FIREWALLS) {
    for (const chain of CHAINS) {
      await runtime.checked("sudo", ["-n", firewall, "-w", "5", "-D", chain, ...firewallRule(state, chain)]);
    }
  }
}

export async function requireNoDefaultRoute(probe, family) {
  assert(family === 4 || family === 6, "Unknown route address family.");
  const prefix = family === 4 ? "0.0.0.0/0" : "::/0";
  // BusyBox parses the selector before it chooses a default address family.
  // Explicit families and prefixes exclude the connected subnet and loopback.
  const output = await probe(["ip", `-${family}`, "route", "show", "table", "all", "exact", prefix]);
  if (output === "") return;
  const routes = typeof output === "string" ? output.split("\n") : [];
  const reportedDefault = routes.some((line) => {
    const destination = line.trim().split(/\s+/, 1)[0];
    return destination === "default" || destination === prefix;
  });
  throw new DefaultRouteError(reportedDefault ? "default route present" : "unexpected exact-prefix route output");
}

async function proveLocalCanary(runtime, state) {
  const projectNetwork = networkName(state.projectId);
  const outsideName = `aceleriq-replay-canary-${state.owner}`;
  const responseScript = 'mkdir /www; printf "%s" "$1" > /www/proof; exec httpd -f -p "$2" -h /www';
  const startServer = (name, network, port, alias) => runtime.checked("docker", ["run", "--pull", "never", "-d",
    "--name", name, "--network", network, "--network-alias", alias,
    ...LABELS.flatMap((label) => ["--label", `${label}=${state.projectId}`]),
    CANARY_IMAGE, "/bin/sh", "-ec", responseScript, "--", CANARY_RESPONSE, String(port)]);
  const probe = (container, args) => runtime.checked("docker", ["exec", container, ...args]);
  const wget = ["wget", "-Y", "off", "-qO-", "-T", "2"];
  const { gateway } = verifyNetwork(await inspectNetwork(runtime, state), state);
  const gatewayCanary = createHttpServer((_request, response) => response.end(CANARY_RESPONSE));
  const containers = [];
  let outsideId;
  await runWithCanaryCleanup(async () => {
    await runCanaryStage(CanaryStage.GatewayListener, () => listen(gatewayCanary, { host: gateway, port: 0 }));
    outsideId = await runCanaryStage(CanaryStage.ComparisonBridge, async () => {
      const id = await runtime.checked("docker", ["network", "create", "--driver", "bridge", "--internal", "--ipv6=false", outsideName]);
      assert(ID.test(id), "Malformed synthetic comparison network.");
      return id;
    });
    const outside = await runCanaryStage(CanaryStage.ComparisonServer, async () => {
      const id = await startServer(outsideName, outsideName, 18080, "replay-outside");
      assert(ID.test(id), "Malformed synthetic comparison container.");
      return id;
    });
    containers.push(outside);
    const dbName = `supabase_db_${state.projectId}`;
    for (const { service, hostPort, containerPort } of SERVICES) {
      const serverStage = service === "db" ? CanaryStage.DbServer : CanaryStage.KongServer;
      const proxyStage = service === "db" ? CanaryStage.DbProxy : CanaryStage.KongProxy;
      const server = await runCanaryStage(serverStage, async () => {
        const id = await startServer(`supabase_${service}_${state.projectId}`, projectNetwork, containerPort, `replay-${service}`);
        assert(ID.test(id), "Malformed isolated synthetic container.");
        return id;
      });
      containers.push(server);
      await runCanaryStage(proxyStage, () => expectLocalCanary(`http://127.0.0.1:${hostPort}/proof`));
    }
    const outsideURL = await runCanaryStage(CanaryStage.ComparisonAddress, async () => {
      const outsideNetwork = JSON.parse(await runtime.checked("docker", ["network", "inspect", outsideId]))[0];
      assert(outsideNetwork?.Id === outsideId && outsideNetwork.Name === outsideName && outsideNetwork.Internal === true &&
        outsideNetwork.EnableIPv6 === false && outsideNetwork.Driver === "bridge" && outsideNetwork.Scope === "local",
        "Invalid synthetic comparison network.");
      const outsideIP = outsideNetwork.Containers[outside]?.IPv4Address?.split("/")[0];
      assert(isIPv4(outsideIP) && subnetContains(privateAllocation(outsideNetwork).cidr, outsideIP),
        "Synthetic comparison target is missing from its private bridge.");
      return `http://${outsideIP}:18080/proof`;
    });
    await runCanaryStage(CanaryStage.ComparisonHttp, () => expectLocalCanary(outsideURL));
    await runCanaryStage(CanaryStage.InternalDns, async () => {
      assert.equal(await probe(dbName, [...wget, "http://replay-kong:8000/proof"]), CANARY_RESPONSE);
    });
    const { port: gatewayPort } = gatewayCanary.address();
    const gatewayURL = `http://${gateway}:${gatewayPort}/proof`;
    await runCanaryStage(CanaryStage.GatewayHttp, () => expectLocalCanary(gatewayURL));
    await runCanaryStage(CanaryStage.Ipv4Route, () => requireNoDefaultRoute((args) => probe(dbName, args), 4));
    await runCanaryStage(CanaryStage.Ipv6Route, () => requireNoDefaultRoute((args) => probe(dbName, args), 6));
    console.log("Synthetic route proof confirmed no exact IPv4 or IPv6 default route.");
    const requireBlocked = (target) => probe(dbName, ["/bin/sh", "-ec",
      'if wget -Y off -qO /dev/null -T 2 "$1"; then exit 1; fi', "--", target]);
    await runCanaryStage(CanaryStage.BlockComparison, () => requireBlocked(outsideURL));
    await runCanaryStage(CanaryStage.BlockGateway, () => requireBlocked(gatewayURL));
  }, async () => {
    if (gatewayCanary.listening) {
      gatewayCanary.close();
      gatewayCanary.closeAllConnections();
    }
    await runWithCanaryCleanup(async () => {
      if (containers.length) {
        await runCanaryStage(CanaryStage.RemoveContainers,
          () => runtime.checked("docker", ["container", "rm", "-f", ...containers]));
      }
    }, async () => {
      if (outsideId) {
        await runCanaryStage(CanaryStage.RemoveBridge, () => runtime.checked("docker", ["network", "rm", outsideId]));
      }
    });
  });
}

async function expectLocalCanary(url) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (await readCanary(url) === CANARY_RESPONSE) return;
    } catch {
      // The synthetic container may still be starting.
    }
    await delay(100);
  }
  throw new Error("A synthetic local HTTP target did not return its expected response.");
}

function readCanary(url) {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { agent: false, signal: AbortSignal.timeout(500) }, async (response) => {
      try {
        let body = "";
        for await (const chunk of response) {
          body += chunk;
          assert(body.length <= CANARY_RESPONSE.length, "Unexpected synthetic response.");
        }
        resolve(response.statusCode === 200 ? body : "");
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function listen(server, address) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function createLoopbackProxy(resolveTarget, containerPort) {
  return createServer({ allowHalfOpen: true }, async (client) => {
    client.on("error", () => client.destroy());
    try {
      const host = await resolveTarget();
      if (client.destroyed) return;
      const upstream = createConnection({ host, port: containerPort, allowHalfOpen: true });
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      client.pipe(upstream).pipe(client);
    } catch {
      client.destroy();
    }
  });
}

async function serveProxies(runtime, state) {
  const servers = SERVICES.map(({ service, containerPort }) => createLoopbackProxy(async () => {
    const network = await inspectNetwork(runtime, state);
    const name = `supabase_${service}_${state.projectId}`;
    const output = await runtime.checked("docker", ["container", "inspect", "--format", CONTAINER_FIELDS, name]);
    const container = JSON.parse(output);
    assert.equal(container.Name, `/${name}`, "Unexpected loopback proxy destination.");
    return verifyContainer(container, network, state);
  }, containerPort));
  const control = createServer((socket) => {
    socket.on("error", () => socket.destroy());
    socket.setTimeout(2000, () => socket.destroy());
    socket.once("data", (command) => {
      if (command.toString() === "stop") {
        socket.end("ok");
        for (const server of [...servers, control]) server.close();
      } else {
        socket.end(command.toString() === "check" && servers.every(({ listening }) => listening) ? "ok" : "");
      }
    });
  });
  try {
    await Promise.all(servers.map((server, index) => listen(server, { host: "127.0.0.1", port: SERVICES[index].hostPort })));
    await listen(control, runtime.controlSocket);
  } catch (error) {
    for (const server of [...servers, control]) server.close();
    throw error;
  }
}

function requestProxy(controlSocket, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(controlSocket);
    socket.on("error", reject);
    socket.setTimeout(2000, () => socket.destroy(new Error("CI replay proxy control timed out.")));
    socket.once("connect", () => socket.write(command));
    socket.once("data", (data) => {
      socket.destroy();
      if (data.toString() === "ok") resolve();
      else reject(new Error("CI replay proxy control refused the command."));
    });
    socket.once("end", () => reject(new Error("CI replay proxy control closed the connection.")));
  });
}

function execute(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new ReplayCommandError(command, error.code));
      else resolve(stdout.trim());
    });
  });
}

async function fileRuntime() {
  const { run, attempt, job } = validateEnvironment(process.env, process.platform);
  const owner = `${run}-${attempt}-${job}`;
  const temp = await realpath(process.env.RUNNER_TEMP);
  assert.equal(temp, path.resolve(process.env.RUNNER_TEMP), "Expected the runner's own temporary directory.");
  const directory = path.join(temp, `aceleriq-replay-${owner}`);
  const filename = path.join(directory, "state.json");
  const proofFile = path.join(directory, "proof.json");
  const controlSocket = path.join(directory, "proxy.sock");
  assert(Buffer.byteLength(controlSocket) <= 100, "Replay proxy control path is too long.");
  const projectId = parseProjectId(await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"));
  assert(!process.env.SUPABASE_NETWORK_ID || process.env.SUPABASE_NETWORK_ID === networkName(projectId),
    "Unexpected Supabase network override.");
  const identity = { owner, projectId };
  const checkProxies = () => requestProxy(controlSocket, "check");
  const runtime = {
    checked: execute,
    controlSocket,
    checkProxies,
    proveNetwork: (state) => proveLocalCanary(runtime, state),
    recordProof: (state) => writeFile(proofFile, JSON.stringify(state), { flag: "wx", mode: 0o600 }),
    requireProof: async (state) => {
      const info = await lstat(proofFile).catch(() => null);
      assert(info?.isFile() && info.uid === process.getuid() && (info.mode & 0o077) === 0, "Missing private pre-replay network proof.");
      assert.deepEqual(JSON.parse(await readFile(proofFile, "utf8")), state, "Network proof does not match the active replay.");
    },
    stopProxies: async () => {
      try {
        await requestProxy(controlSocket, "stop");
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ECONNREFUSED") throw error;
      }
    },
    createStateDirectory: () => mkdir(directory, { mode: 0o700 }),
    writeState: (state) => writeFile(filename, JSON.stringify(state), { flag: "wx", mode: 0o600 }),
    readState: async () => {
      const dir = await lstat(directory);
      const info = await lstat(filename);
      assert(dir.isDirectory() && dir.uid === process.getuid() && (dir.mode & 0o077) === 0 &&
        info.isFile() && info.uid === process.getuid() && (info.mode & 0o077) === 0, "Invalid private replay state.");
      const state = JSON.parse(await readFile(filename, "utf8"));
      assert(state.owner === owner && state.projectId === projectId && ID.test(state.networkId),
        "Replay state does not match this job and project.");
      return state;
    },
    runSupabase: (args) => new Promise((resolve, reject) => {
      const child = spawn("supabase", args, { stdio: ["ignore", args[0] === "start" ? "ignore" : "inherit", "inherit"] });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Supabase replay command failed (exit ${code ?? "unknown"}).`));
      });
    }),
  };
  return { identity, runtime };
}

async function main(mode) {
  assert(["--prepare", "--serve", "--wait", "--prove", "--start", "--reset", "--verify", "--release"].includes(mode),
    "Invalid replay guard mode.");
  const { identity, runtime } = await fileRuntime();
  if (mode === "--prepare") {
    await requireDocker(runtime);
    await runtime.checked("docker", ["pull", CANARY_IMAGE]);
    return prepareReplay(runtime, identity);
  }
  const state = await runtime.readState();
  if (mode === "--serve") return serveProxies(runtime, state);
  if (mode === "--prove") {
    await proveBeforeReplay(runtime, state);
    console.log("Synthetic Docker replay isolation and loopback proof passed.");
    return;
  }
  if (mode === "--release") return releaseReplay(runtime, state);
  if (mode === "--verify") return verifyReplay(runtime, state);
  if (mode === "--wait") {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { return await runtime.checkProxies(); }
      catch { await delay(100); }
    }
    throw new Error("Local replay proxies did not become ready.");
  }
  return runReplay(runtime, state, mode.slice(2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(`Supabase CI replay guard: ${error.message}`);
    process.exitCode = 1;
  });
}
