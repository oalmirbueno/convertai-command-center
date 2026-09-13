import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Only forwarded IPv4 traffic from the inspected Supabase bridge is filtered.
// Host processes (including Docker's DNS proxy), Node and browser requests need
// their own guards. Run after Supabase start and before fixtures. Keep the rule
// until Supabase stop, then restore. Do not reconnect containers while guarded.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LABEL = "com.supabase.cli.project";
const COMPOSE_LABEL = "com.docker.compose.project";
const ID = /^[a-f0-9]{64}$/;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validateEnvironment(env, platform) {
  assert(platform === "linux", "Firewall operations require Linux; use --self-test elsewhere.");
  assert(env.CI === "true" && env.GITHUB_ACTIONS === "true", "Firewall operations require GitHub CI.");
  assert(env.RUNNER_ENVIRONMENT === "github-hosted", "Only an ephemeral GitHub-hosted runner is supported.");
  assert(/^\d+$/.test(env.GITHUB_RUN_ID ?? "") && /^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? ""), "Missing GitHub run identity.");
  assert(/^[a-zA-Z0-9_-]+$/.test(env.GITHUB_JOB ?? ""), "Missing GitHub job identity.");
  assert(typeof env.RUNNER_TEMP === "string" && path.posix.isAbsolute(env.RUNNER_TEMP) && env.RUNNER_TEMP !== "/", "RUNNER_TEMP must be an absolute runner directory.");
  assert(!env.DOCKER_HOST || env.DOCKER_HOST === "unix:///var/run/docker.sock", "Remote or nonstandard Docker hosts are forbidden.");
  assert(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === "default", "Only the default local Docker context is supported.");
  assert(!env.DOCKER_TLS_VERIFY && !env.DOCKER_CERT_PATH, "Remote Docker TLS settings are forbidden.");
  return { run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB };
}

export function parseProjectId(config) {
  const topLevel = config.split(/^\s*\[/m)[0];
  const assignments = topLevel.match(/^\s*project_id\s*=/gm) ?? [];
  const match = /^\s*project_id\s*=\s*"([a-z0-9][a-z0-9_-]{1,62})"\s*(?:#.*)?$/m.exec(topLevel);
  assert(assignments.length === 1 && match, "Expected one safe, local project_id in supabase/config.toml.");
  assert(!/^[a-z0-9]{20}$/.test(match[1]), "A hosted Supabase project reference cannot identify this local CI network.");
  return match[1];
}

function ipv4(value) {
  assert(typeof value === "string" && /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value), "Expected an IPv4 address.");
  const octets = value.split(".").map(Number);
  assert(octets.every((octet) => octet <= 255), "Invalid IPv4 address.");
  return octets.reduce((total, octet) => total * 256 + octet, 0);
}

function cidrRange(cidr) {
  assert(typeof cidr === "string" && /^.+\/(?:0|[1-9]\d?)$/.test(cidr), "Expected an IPv4 CIDR.");
  const [address, rawPrefix] = cidr.split("/");
  const prefix = Number(rawPrefix);
  assert(prefix <= 32, "Invalid IPv4 prefix.");
  const start = ipv4(address);
  const size = 2 ** (32 - prefix);
  assert(start % size === 0, "The subnet must use its canonical network address.");
  return { start, end: start + size - 1, prefix };
}

function inside(address, range) {
  const value = ipv4(address);
  return value > range.start && value < range.end;
}

function projectLabels(labels, projectId) {
  return labels?.[LABEL] === projectId && labels?.[COMPOSE_LABEL] === projectId;
}

export function validateTopology(projectId, networks, containers) {
  assert(Array.isArray(networks) && Array.isArray(containers), "Docker inspection did not return arrays.");
  const expectedName = `supabase_network_${projectId}`;
  const candidates = networks.filter((network) => network.Name === expectedName || network.Labels?.[LABEL] === projectId || network.Labels?.[COMPOSE_LABEL] === projectId);
  assert(candidates.length === 1, "Expected exactly one network for the local Supabase project.");
  const network = candidates[0];
  assert(network.Name === expectedName && ID.test(network.Id) && projectLabels(network.Labels, projectId), "Unexpected Supabase network identity or labels.");
  assert(network.Driver === "bridge" && network.Scope === "local" && network.Ingress === false && network.EnableIPv6 === false, "Only a local IPv4 bridge is supported.");
  assert(network.IPAM?.Driver === "default" && network.IPAM.Config?.length === 1, "Expected exactly one default IPv4 subnet.");
  const subnet = network.IPAM.Config[0];
  const range = cidrRange(subnet.Subnet);
  const privateRanges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(cidrRange);
  assert(range.prefix <= 30 && privateRanges.some((allowed) => range.start >= allowed.start && range.end <= allowed.end), "The complete subnet must be private RFC1918 IPv4.");
  assert(inside(subnet.Gateway, range), "The bridge gateway must be within its private subnet.");
  assert(!subnet.AuxiliaryAddresses || Object.keys(subnet.AuxiliaryAddresses).length === 0, "Unexpected reserved bridge addresses.");
  for (const other of networks.filter((item) => item.Id !== network.Id)) {
    for (const allocation of other.IPAM?.Config ?? []) {
      if (!allocation.Subnet || allocation.Subnet.includes(":")) continue;
      const otherRange = cidrRange(allocation.Subnet);
      assert(otherRange.end < range.start || otherRange.start > range.end, "Another Docker network overlaps the protected subnet.");
    }
  }

  const members = Object.entries(network.Containers ?? {});
  assert(members.length >= 3, "The Supabase API, auth and database must be running before guarding.");
  assert(new Set(containers.map((container) => container.Id)).size === containers.length, "Duplicate container inspection results.");
  const memberIds = members.map(([id]) => id).sort();
  const projectContainers = containers.filter((container) => container.Labels?.[LABEL] === projectId || container.Labels?.[COMPOSE_LABEL] === projectId || (container.Name?.startsWith("/supabase_") && container.Name.endsWith(`_${projectId}`)));
  assert.deepEqual(projectContainers.map((container) => container.Id).sort(), memberIds, "All project containers must belong exclusively to the inspected network.");
  const seenAddresses = new Set();
  const snapshot = members.map(([id, member]) => {
    const container = containers.find((item) => item.Id === id);
    assert(ID.test(id) && container && projectLabels(container.Labels, projectId), "An unrelated or unidentified container is connected to the Supabase network.");
    assert(typeof member.Name === "string" && member.Name.startsWith("supabase_") && member.Name.endsWith(`_${projectId}`) && /^[a-z0-9_-]+$/.test(member.Name), "Unexpected container namespace.");
    assert(container.Name === `/${member.Name}` && container.Running === true, "Supabase container identity or running state changed.");
    assert(container.NetworkMode === expectedName || container.NetworkMode === network.Id, "Host, shared or alternate container networking is forbidden.");
    assert.deepEqual(Object.keys(container.Networks ?? {}), [expectedName], "A Supabase container is attached to another network.");
    const attachment = container.Networks[expectedName];
    assert(attachment.NetworkID === network.Id && attachment.IPPrefixLen === range.prefix && attachment.Gateway === subnet.Gateway, "Container network attachment disagrees with the inspected bridge.");
    assert(!attachment.GlobalIPv6Address && !attachment.IPv6Gateway && !member.IPv6Address, "IPv6 container connectivity is unsupported.");
    assert(inside(attachment.IPAddress, range) && attachment.IPAddress !== subnet.Gateway && member.IPv4Address === `${attachment.IPAddress}/${range.prefix}`, "Container IP does not match the protected subnet.");
    assert(!seenAddresses.has(attachment.IPAddress), "Duplicate container IP addresses.");
    seenAddresses.add(attachment.IPAddress);
    return { id, name: member.Name, ip: attachment.IPAddress };
  }).sort((a, b) => a.id.localeCompare(b.id));
  for (const service of ["db", "auth", "kong"]) {
    assert(snapshot.some((item) => item.name === `supabase_${service}_${projectId}`), "The local API, auth and database containers are required.");
  }
  return { projectId, networkId: network.Id, cidr: subnet.Subnet, topologyHash: hash(snapshot), containers: snapshot.length };
}

function assertLocalContext(context) {
  assert(Array.isArray(context) && context.length === 1 && context[0].Name === "default" && context[0].Endpoints?.docker?.Host === "unix:///var/run/docker.sock", "Docker must use the default local Unix socket.");
}

async function checked(run, command, args) {
  const result = await run(command, args);
  // Never include Docker inspection output, environment, or command stderr in errors.
  assert(result.status === 0, `${command} inspection or firewall operation failed (exit ${result.status}).`);
  return result.stdout.trim();
}

async function inspect(runtime, projectId, stoppedTopology) {
  assertLocalContext(JSON.parse(await checked(runtime.run, "docker", ["context", "inspect"])));
  const networkIds = (await checked(runtime.run, "docker", ["network", "ls", "--no-trunc", "--format", "{{.ID}}"])).split(/\s+/);
  assert(networkIds.length > 0 && networkIds.every((id) => ID.test(id)), "Invalid Docker network inventory.");
  const networks = JSON.parse(await checked(runtime.run, "docker", ["network", "inspect", ...networkIds]));
  const inventory = await checked(runtime.run, "docker", ["ps", "--all", "--no-trunc", "--format", "{{.ID}}"]);
  const containerIds = inventory ? inventory.split(/\s+/) : [];
  assert(containerIds.every((id) => ID.test(id)), "Invalid Docker container inventory.");
  // Explicit fields avoid retrieving container Env, which can contain credentials.
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Running":{{json .State.Running}},"NetworkMode":{{json .HostConfig.NetworkMode}},"Networks":{{json .NetworkSettings.Networks}}}';
  const rows = containerIds.length ? await checked(runtime.run, "docker", ["container", "inspect", "--format", format, ...containerIds]) : "";
  const containers = rows ? rows.split("\n").map((row) => JSON.parse(row)) : [];
  if (stoppedTopology) {
    const stillPresent = networks.some((network) => network.Id === stoppedTopology.networkId || network.Name === `supabase_network_${projectId}` || network.Labels?.[LABEL] === projectId || network.Labels?.[COMPOSE_LABEL] === projectId);
    if (!stillPresent) {
      assert(!containers.some((container) => container.Labels?.[LABEL] === projectId || container.Labels?.[COMPOSE_LABEL] === projectId || (container.Name?.startsWith("/supabase_") && container.Name.endsWith(`_${projectId}`))), "The project network disappeared while its containers still exist.");
      return stoppedTopology;
    }
  }
  return validateTopology(projectId, networks, containers);
}

function ruleFor(owner, topology) {
  const comment = `supabase-ci-e2e-${hash({ owner, topology }).slice(0, 32)}`;
  const spec = ["-s", topology.cidr, "!", "-d", topology.cidr, "-m", "comment", "--comment", comment, "-j", "REJECT", "--reject-with", "icmp-port-unreachable"];
  return { comment, spec };
}

function validateState(state, owner, projectId) {
  assert(state?.version === 1 && ["prepared", "guarded", "restored"].includes(state.phase), "Invalid guard state.");
  assert.deepEqual(state.owner, owner, "Guard state belongs to another GitHub run or job.");
  const topology = state.topology;
  assert(topology?.projectId === projectId && ID.test(topology.networkId) && ID.test(topology.topologyHash) && Number.isSafeInteger(topology.containers) && topology.containers >= 3, "Unexpected saved project topology.");
  const range = cidrRange(topology.cidr);
  assert(range.prefix <= 30 && ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(cidrRange).some((allowed) => range.start >= allowed.start && range.end <= allowed.end), "Saved rule is not confined to one private IPv4 subnet.");
  assert.deepEqual(state.rule, ruleFor(owner, topology), "Guard state contains an unexpected rule.");
}

const iptables = (run, args) => checked(run, "sudo", ["-n", "iptables", "-w", "5", ...args]);

async function readRules(run, rule, requireFirst) {
  if (requireFirst) {
    const forward = (await iptables(run, ["-S", "FORWARD"])).split("\n").filter((line) => line.startsWith("-A "));
    assert(forward[0] === "-A FORWARD -j DOCKER-USER", "DOCKER-USER must be the first FORWARD rule; unsupported Docker firewall configuration.");
  }
  const rules = (await iptables(run, ["-S", "DOCKER-USER"])).split("\n").filter((line) => line.startsWith("-A "));
  const owned = rules.filter((line) => line.includes(rule.comment));
  assert(owned.length <= 1, "Duplicate owned rules require investigation; no broad removal is allowed.");
  const check = await run("sudo", ["-n", "iptables", "-w", "5", "-C", "DOCKER-USER", ...rule.spec]);
  assert(check.status === 0 || check.status === 1, "Unable to verify the exact firewall rule.");
  assert((check.status === 0) === (owned.length === 1), "The owned firewall rule differs from its exact specification.");
  if (owned.length && requireFirst) assert(rules[0] === owned[0], "The guard must precede every other DOCKER-USER rule.");
  return owned.length === 1;
}

// Commands must be serialized in one CI job. State is written before insertion,
// so an interrupted operation can be restored using only its exact rule.
export async function executeGuard(mode, runtime) {
  assert(mode === "--guard" || mode === "--restore", "Use --guard, --restore or --self-test.");
  const owner = validateEnvironment(runtime.env, runtime.platform);
  const projectId = parseProjectId(await runtime.readConfig());
  const previous = await runtime.readState(owner);
  if (mode === "--restore" && !previous) return { phase: "absent", changed: false };
  if (previous) validateState(previous, owner, projectId);
  // All topology validation precedes even read-only iptables commands.
  // Restoration also accepts a fully stopped project: the original private
  // rule and run identity are validated from state, never inferred afresh.
  const topology = await inspect(runtime, projectId, mode === "--restore" ? previous.topology : undefined);
  if (previous) assert.deepEqual(previous.topology, topology, "The guarded network or its containers changed; refusing firewall changes.");
  const rule = ruleFor(owner, topology);
  const exists = await readRules(runtime.run, rule, mode === "--guard");
  assert(previous || !exists, "An existing firewall rule without this job's state cannot be adopted.");
  let state = previous ?? { version: 1, phase: "prepared", owner, topology, rule };
  if (mode === "--guard") {
    if (!exists) {
      state = { ...state, phase: "prepared" };
      await runtime.writeState(owner, state, !previous);
      await iptables(runtime.run, ["-I", "DOCKER-USER", "1", ...rule.spec]);
    }
    assert(await readRules(runtime.run, rule, true), "The inserted firewall rule was not found.");
    assert.deepEqual(await inspect(runtime, projectId), topology, "Docker topology changed during installation; the restrictive rule is retained for restoration.");
    state = { ...state, phase: "guarded" };
  } else {
    if (exists) await iptables(runtime.run, ["-D", "DOCKER-USER", ...rule.spec]);
    assert(!(await readRules(runtime.run, rule, false)), "The exact firewall rule was not removed.");
    state = { ...state, phase: "restored" };
  }
  await runtime.writeState(owner, state, false);
  return { phase: state.phase, changed: mode === "--guard" ? !exists : exists, projectId, containers: topology.containers, cidr: topology.cidr };
}

function commandRunner(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      resolve({ status: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout: stdout ?? "" });
    });
  });
}

function fileRuntime() {
  let directory;
  async function statePath(owner) {
    directory ??= await realpath(process.env.RUNNER_TEMP);
    assert(directory === path.resolve(process.env.RUNNER_TEMP) && (await lstat(directory)).isDirectory(), "RUNNER_TEMP must resolve to its own existing directory.");
    return path.join(directory, `supabase-ci-e2e-network-${owner.run}-${owner.attempt}-${hash(owner.job).slice(0, 12)}.json`);
  }
  async function existingFile(filename) {
    try {
      const stat = await lstat(filename);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "Guard state must be a private regular file owned by the runner.");
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return {
    env: process.env, platform: process.platform, run: commandRunner,
    readConfig: () => readFile(path.join(ROOT, "supabase/config.toml"), "utf8"),
    readState: async (owner) => {
      const filename = await statePath(owner);
      return await existingFile(filename) ? JSON.parse(await readFile(filename, "utf8")) : null;
    },
    writeState: async (owner, state, initial) => {
      const filename = await statePath(owner);
      const serialized = JSON.stringify(state, null, 2) + "\n";
      if (initial) await writeFile(filename, serialized, { flag: "wx", mode: 0o600 });
      else {
        assert(await existingFile(filename), "The guard state disappeared; refusing to overwrite another file.");
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
        await rename(temporary, filename);
      }
    },
  };
}

function fixture() {
  const projectId = "aceleriq-os";
  const name = `supabase_network_${projectId}`;
  const networkId = "a".repeat(64);
  const labels = { [LABEL]: projectId, [COMPOSE_LABEL]: projectId };
  const containers = ["db", "auth", "kong"].map((service, index) => ({
    Id: String(index + 1).repeat(64), Name: `/supabase_${service}_${projectId}`, Labels: labels, Running: true, NetworkMode: name,
    Networks: { [name]: { NetworkID: networkId, IPAddress: `172.28.0.${index + 2}`, IPPrefixLen: 16, Gateway: "172.28.0.1", GlobalIPv6Address: "", IPv6Gateway: "" } },
  }));
  const network = {
    Name: name, Id: networkId, Labels: labels, Driver: "bridge", Scope: "local", Ingress: false, EnableIPv6: false,
    IPAM: { Driver: "default", Config: [{ Subnet: "172.28.0.0/16", Gateway: "172.28.0.1" }] },
    Containers: Object.fromEntries(containers.map((container) => [container.Id, { Name: container.Name.slice(1), IPv4Address: `${container.Networks[name].IPAddress}/16`, IPv6Address: "" }])),
  };
  const f = {
    projectId, networks: [network], containers, state: null, rules: ["-A DOCKER-USER -j RETURN"], calls: [],
    env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "db_tests", RUNNER_TEMP: "/runner/temp" },
    platform: "linux", context: [{ Name: "default", Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }],
    config: `project_id = "${projectId}"\n[functions]\n`, forward: "-A FORWARD -j DOCKER-USER", inserts: 0, removals: 0,
  };
  f.readConfig = async () => f.config;
  f.readState = async () => structuredClone(f.state);
  f.writeState = async (_, state, initial) => { assert(!initial || !f.state); f.state = structuredClone(state); };
  f.run = async (command, args) => {
    f.calls.push([command, ...args]);
    const ok = (value) => ({ status: 0, stdout: typeof value === "string" ? value : JSON.stringify(value) });
    if (command === "docker") {
      if (args[0] === "context") return ok(f.context);
      if (args[0] === "network" && args[1] === "ls") return ok(f.networks.map((network) => network.Id).join("\n"));
      if (args[0] === "network") return ok(f.networks);
      if (args[0] === "ps") return ok(f.containers.map((container) => container.Id).join("\n"));
      if (args[0] === "container") return ok(f.containers.map((container) => JSON.stringify(container)).join("\n"));
    }
    assert.equal(command, "sudo");
    assert.deepEqual(args.slice(0, 4), ["-n", "iptables", "-w", "5"]);
    const [action, chain, ...rest] = args.slice(4);
    if (action === "-S") return ok(chain === "FORWARD" ? f.forward : f.rules.join("\n"));
    const rule = `-A DOCKER-USER ${(action === "-I" ? rest.slice(1) : rest).join(" ")}`;
    if (action === "-C") return { status: f.rules.includes(rule) ? 0 : 1, stdout: "" };
    assert.equal(chain, "DOCKER-USER");
    if (action === "-I") { assert.equal(rest[0], "1"); f.rules.unshift(rule); f.inserts++; return ok(""); }
    if (action === "-D") { assert(f.rules.includes(rule)); f.rules.splice(f.rules.indexOf(rule), 1); f.removals++; return ok(""); }
    assert.fail("Unexpected command; offline tests cannot access Docker or iptables.");
  };
  return f;
}

export async function selfTest() {
  let count = 0;
  const test = async (body) => { await body(); count++; };
  const rejectedBeforeFirewall = async (mutate, pattern) => test(async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(executeGuard("--guard", f), pattern);
    assert(!f.calls.some(([command]) => command === "sudo"));
    assert.equal(f.state, null);
  });
  for (const flag of ["CI", "GITHUB_ACTIONS", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "RUNNER_TEMP", "RUNNER_ENVIRONMENT"]) {
    await rejectedBeforeFirewall((f) => { delete f.env[flag]; });
  }
  await rejectedBeforeFirewall((f) => { f.platform = "win32"; }, /Linux/);
  await rejectedBeforeFirewall((f) => { f.env.RUNNER_ENVIRONMENT = "self-hosted"; }, /GitHub-hosted/);
  await rejectedBeforeFirewall((f) => { f.env.DOCKER_HOST = "tcp:\/\/remote:2375"; }, /Docker hosts/);
  await rejectedBeforeFirewall((f) => { f.env.DOCKER_CONTEXT = "production"; }, /local Docker context/);
  await rejectedBeforeFirewall((f) => { f.env.DOCKER_TLS_VERIFY = "1"; }, /TLS/);
  await rejectedBeforeFirewall((f) => { f.context[0].Endpoints.docker.Host = "ssh:\/\/remote"; }, /local Unix socket/);
  await rejectedBeforeFirewall((f) => { f.config = 'project_id = "abcdefghijklmnopqrst"\n'; }, /hosted Supabase/);
  await rejectedBeforeFirewall((f) => { f.config = 'project_id = "one"\nproject_id = "two"\n'; }, /one safe/);
  await rejectedBeforeFirewall((f) => { f.networks[0].Name = "unrelated_network"; }, /identity/);
  await rejectedBeforeFirewall((f) => { f.networks[0].Labels = {}; }, /labels/);
  await rejectedBeforeFirewall((f) => { f.networks[0].Driver = "host"; }, /bridge/);
  await rejectedBeforeFirewall((f) => { f.networks[0].EnableIPv6 = true; }, /IPv4 bridge/);
  await rejectedBeforeFirewall((f) => { f.networks[0].IPAM.Config.push({ Subnet: "fd00::/64" }); }, /one default/);
  await rejectedBeforeFirewall((f) => { f.networks[0].IPAM.Config[0].Subnet = "8.8.0.0/16"; }, /private/);
  await rejectedBeforeFirewall((f) => { f.networks[0].IPAM.Config[0].Subnet = "172.28.1.0/16"; }, /canonical/);
  await rejectedBeforeFirewall((f) => { f.networks[0].IPAM.Config[0].Gateway = "172.29.0.1"; }, /gateway/);
  await rejectedBeforeFirewall((f) => { f.networks.push({ ...f.networks[0], Id: "b".repeat(64) }); }, /one network/);
  await rejectedBeforeFirewall((f) => { f.networks.push({ Id: "b".repeat(64), Name: "other", IPAM: { Config: [{ Subnet: "172.28.1.0/24" }] } }); }, /overlaps/);
  await rejectedBeforeFirewall((f) => { f.containers[0].Labels = {}; }, /unrelated/);
  await rejectedBeforeFirewall((f) => { f.containers[0].NetworkMode = "host"; }, /networking/);
  await rejectedBeforeFirewall((f) => { f.containers[0].Networks.other = {}; }, /another network/);
  await rejectedBeforeFirewall((f) => { f.containers[0].Networks[f.networks[0].Name].GlobalIPv6Address = "fd00::2"; }, /IPv6/);
  await rejectedBeforeFirewall((f) => { f.containers[0].Running = false; }, /running state/);
  await rejectedBeforeFirewall((f) => { f.containers.push({ ...f.containers[0], Id: "b".repeat(64) }); }, /All project/);
  await rejectedBeforeFirewall((f) => { delete f.networks[0].Containers[f.containers[0].Id]; }, /must be running/);
  await test(async () => {
    const f = fixture();
    assert.equal((await executeGuard("--guard", f)).changed, true);
    assert.equal((await executeGuard("--guard", f)).changed, false);
    assert.equal(f.inserts, 1);
    assert(f.rules[0].includes("-s 172.28.0.0/16 ! -d 172.28.0.0/16"));
    assert.equal(f.state.phase, "guarded");
    assert.equal((await executeGuard("--restore", f)).changed, true);
    assert.equal((await executeGuard("--restore", f)).changed, false);
    assert.deepEqual(f.rules, ["-A DOCKER-USER -j RETURN"]);
    assert.equal(f.removals, 1);
    assert.equal(f.state.phase, "restored");
    assert.equal((await executeGuard("--guard", f)).changed, true);
  });
  await test(async () => {
    const f = fixture();
    assert.deepEqual(await executeGuard("--restore", f), { phase: "absent", changed: false });
    assert.equal(f.calls.length, 0);
  });
  await test(async () => {
    const f = fixture(); f.forward = "-A FORWARD -j ACCEPT\n-A FORWARD -j DOCKER-USER";
    await assert.rejects(executeGuard("--guard", f), /first FORWARD/);
    assert.equal(f.inserts, 0);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.state.rule.spec[1] = "0.0.0.0/0"; f.calls = [];
    await assert.rejects(executeGuard("--restore", f), /unexpected rule/);
    assert(!f.calls.some(([command]) => command === "sudo"));
    assert.equal(f.removals, 0);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.state.owner.run = "456"; f.calls = [];
    await assert.rejects(executeGuard("--restore", f), /another GitHub run/);
    assert(!f.calls.some(([command]) => command === "sudo"));
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f); f.state = null;
    await assert.rejects(executeGuard("--guard", f), /cannot be adopted/);
    assert.equal(f.inserts, 1);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f); f.rules.unshift(f.rules[0]);
    await assert.rejects(executeGuard("--restore", f), /Duplicate owned/);
    assert.equal(f.removals, 0);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f); f.rules.unshift("-A DOCKER-USER -j ACCEPT");
    await assert.rejects(executeGuard("--guard", f), /precede/);
    await executeGuard("--restore", f);
    assert.deepEqual(f.rules, ["-A DOCKER-USER -j ACCEPT", "-A DOCKER-USER -j RETURN"]);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f); f.state.phase = "prepared";
    await executeGuard("--restore", f);
    assert.equal(f.removals, 1);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.networks = [{ Id: "c".repeat(64), Name: "bridge", IPAM: { Config: [{ Subnet: "172.17.0.0/16" }] } }];
    f.containers = [];
    await executeGuard("--restore", f);
    assert.deepEqual(f.rules, ["-A DOCKER-USER -j RETURN"]);
    assert.equal(f.removals, 1);
    assert.equal((await executeGuard("--restore", f)).changed, false);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.networks = [{ Id: "c".repeat(64), Name: "bridge" }]; f.calls = [];
    await assert.rejects(executeGuard("--restore", f), /containers still exist/);
    assert(!f.calls.some(([command]) => command === "sudo"));
    assert.equal(f.removals, 0);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    const name = f.networks[0].Name;
    f.containers[0].Networks[name].IPAddress = "172.28.0.99";
    f.networks[0].Containers[f.containers[0].Id].IPv4Address = "172.28.0.99/16";
    f.calls = [];
    await assert.rejects(executeGuard("--restore", f), /containers changed/);
    assert(!f.calls.some(([command]) => command === "sudo"));
  });
  await test(async () => {
    const f = fixture();
    f.writeState = async () => { throw new Error("simulated state write failure"); };
    await assert.rejects(executeGuard("--guard", f), /state write failure/);
    assert.equal(f.inserts, 0);
  });
  await test(async () => {
    const f = fixture(); const run = f.run;
    f.run = async (command, args) => command === "sudo" && args[4] === "-I" ? { status: 2, stdout: "" } : run(command, args);
    await assert.rejects(executeGuard("--guard", f), /operation failed/);
    assert.equal(f.state.phase, "prepared");
    assert.equal(f.inserts, 0);
    assert.equal((await executeGuard("--restore", f)).changed, false);
  });
  await test(async () => {
    const f = fixture(); const run = f.run;
    f.run = async (command, args) => {
      const result = await run(command, args);
      if (command === "sudo" && args[4] === "-I") {
        const name = f.networks[0].Name;
        f.containers[0].Networks[name].IPAddress = "172.28.0.99";
        f.networks[0].Containers[f.containers[0].Id].IPv4Address = "172.28.0.99/16";
      }
      return result;
    };
    await assert.rejects(executeGuard("--guard", f), /topology changed/);
    assert.equal(f.inserts, 1);
    assert.equal(f.removals, 0);
    assert.equal(f.state.phase, "prepared");
    assert(f.rules[0].includes("-j REJECT"));
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.rules[0] = f.rules[0].replace("-s 172.28.0.0/16", "-s 0.0.0.0/0");
    await assert.rejects(executeGuard("--restore", f), /exact specification/);
    assert.equal(f.removals, 0);
  });
  await test(async () => {
    const f = fixture(); await executeGuard("--guard", f);
    f.rules[0] = f.rules[0].replace("--comment ", '--comment "').replace(" -j REJECT", '" -j REJECT');
    const run = f.run;
    // iptables -S may quote a comment; -C remains the authoritative exact match.
    f.run = async (command, args) => {
      if (command === "sudo" && ["-C", "-D"].includes(args[4])) {
        f.rules = f.rules.map((rule) => rule.replaceAll('"', ""));
      }
      return run(command, args);
    };
    await executeGuard("--restore", f);
    assert.equal(f.removals, 1);
  });
  return { passed: count, dockerOrFirewallInvocations: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3, "Usage: node scripts/guard-ci-e2e-network.mjs --guard|--restore|--self-test");
    const mode = process.argv[2];
    const result = mode === "--self-test" ? await selfTest() : await executeGuard(mode, fileRuntime());
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(`CI network guard: ${error.message}\n`);
    process.exitCode = 1;
  }
}
