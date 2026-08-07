const DEFAULT_MAX_BYTES = 512 * 1024;
const HARD_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESERVED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

export type PublicHostnameResolver = (hostname: string) => Promise<string[]>;

export interface FetchPublicTextOptions {
  // Deno.fetch does not expose DNS pinning. An exact, operator-controlled
  // hostname allowlist is therefore mandatory to close DNS-rebinding for
  // untrusted input after the DNS preflight below.
  allowedHostnames: Iterable<string>;
  headers?: HeadersInit;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveHostname?: PublicHostnameResolver;
}

export interface PublicTextResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

export class PublicHttpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicHttpError";
    this.code = code;
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function parseIpv4(input: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)) return null;
  const parts = input.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function ipv4InCidr(parts: number[], base: number[], prefix: number): boolean {
  const value = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const network = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPublicIpv4(parts: number[]): boolean {
  const blocked: Array<[number[], number]> = [
    [[0, 0, 0, 0], 8],
    [[10, 0, 0, 0], 8],
    [[100, 64, 0, 0], 10],
    [[127, 0, 0, 0], 8],
    [[169, 254, 0, 0], 16],
    [[172, 16, 0, 0], 12],
    [[192, 0, 0, 0], 24],
    [[192, 0, 2, 0], 24],
    [[192, 88, 99, 0], 24],
    [[192, 168, 0, 0], 16],
    [[198, 18, 0, 0], 15],
    [[198, 51, 100, 0], 24],
    [[203, 0, 113, 0], 24],
    [[224, 0, 0, 0], 4],
    [[240, 0, 0, 0], 4],
  ];
  return !blocked.some(([base, prefix]) => ipv4InCidr(parts, base, prefix));
}

function parseIpv6(input: string): bigint | null {
  let value = input.toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value || value.includes("%")) return null;

  if (value.includes(".")) {
    const splitAt = value.lastIndexOf(":");
    if (splitAt < 0) return null;
    const ipv4 = parseIpv4(value.slice(splitAt + 1));
    if (!ipv4) return null;
    value = `${value.slice(0, splitAt)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  if ((value.match(/::/g) ?? []).length > 1) return null;
  const hasCompression = value.includes("::");
  const [leftRaw, rightRaw = ""] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;
  const parts = hasCompression
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8) return null;

  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv6InCidr(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
}

function ipv6Base(value: string): bigint {
  const parsed = parseIpv6(value);
  if (parsed === null) throw new Error(`Invalid internal IPv6 constant: ${value}`);
  return parsed;
}

const IPV6_GLOBAL_UNICAST = ipv6Base("2000::");
const IPV6_IETF_SPECIAL = ipv6Base("2001::");
const IPV6_SIX_TO_FOUR = ipv6Base("2002::");
const IPV6_DOCUMENTATION = ipv6Base("2001:db8::");
const IPV6_DOCUMENTATION_2 = ipv6Base("3fff::");

function isPublicIpv6(value: bigint): boolean {
  if (!ipv6InCidr(value, IPV6_GLOBAL_UNICAST, 3)) return false;
  if (ipv6InCidr(value, IPV6_IETF_SPECIAL, 23)) return false;
  if (ipv6InCidr(value, IPV6_SIX_TO_FOUR, 16)) return false;
  if (ipv6InCidr(value, IPV6_DOCUMENTATION, 32)) return false;
  if (ipv6InCidr(value, IPV6_DOCUMENTATION_2, 20)) return false;
  return true;
}

export function isPublicIpAddress(input: string): boolean {
  const ipv4 = parseIpv4(input);
  if (ipv4) return isPublicIpv4(ipv4);
  const ipv6 = parseIpv6(input);
  return ipv6 !== null && isPublicIpv6(ipv6);
}

function looksLikeIpLiteral(hostname: string): boolean {
  return parseIpv4(hostname) !== null
    || parseIpv6(hostname) !== null
    || hostname.includes(":")
    || /^\d+(?:\.\d+){0,3}$/.test(hostname);
}

export function parsePublicHttpsUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4096) {
    throw new PublicHttpError("invalid_url", "URL pública HTTPS inválida");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicHttpError("invalid_url", "URL pública HTTPS inválida");
  }

  if (url.protocol !== "https:") {
    throw new PublicHttpError("https_required", "A URL precisa usar HTTPS");
  }
  if (url.username || url.password) {
    throw new PublicHttpError("credentials_forbidden", "Credenciais na URL não são permitidas");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || looksLikeIpLiteral(hostname)) {
    throw new PublicHttpError("ip_literal_forbidden", "Endereços IP literais não são permitidos");
  }
  if (!hostname.includes(".") || RESERVED_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    throw new PublicHttpError("private_hostname", "O host precisa ser público");
  }
  if (hostname.length > 253 || hostname.split(".").some((label) => (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
  ))) {
    throw new PublicHttpError("invalid_hostname", "Host público inválido");
  }

  const topLevelDomain = hostname.split(".").at(-1)!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(topLevelDomain)) {
    throw new PublicHttpError("invalid_hostname", "Host público inválido");
  }

  url.hostname = hostname;
  url.hash = "";
  return url;
}

export async function resolvePublicHostname(hostname: string): Promise<string[]> {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { resolveDns?: (query: string, recordType: "A" | "AAAA") => Promise<string[]> };
  }).Deno;
  if (!deno?.resolveDns) {
    throw new PublicHttpError("dns_unavailable", "Validação DNS indisponível");
  }

  const [ipv4, ipv6] = await Promise.all([
    deno.resolveDns(hostname, "A").catch(() => [] as string[]),
    deno.resolveDns(hostname, "AAAA").catch(() => [] as string[]),
  ]);
  return [...new Set([...ipv4, ...ipv6])];
}

export async function assertPublicHttpsUrl(
  rawUrl: string,
  resolveHostname: PublicHostnameResolver = resolvePublicHostname,
  allowedHostnames?: ReadonlySet<string>,
): Promise<URL> {
  const url = parsePublicHttpsUrl(rawUrl);
  if (allowedHostnames && !allowedHostnames.has(url.hostname)) {
    throw new PublicHttpError("host_not_allowed", "O host não está autorizado para esta leitura");
  }
  const addresses = await resolveHostname(url.hostname);
  if (!addresses.length) {
    throw new PublicHttpError("dns_unresolved", "O host público não pôde ser resolvido");
  }
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new PublicHttpError("private_address", "O host resolve para uma rede não pública");
  }
  return url;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new PublicHttpError("response_too_large", "A resposta excede o limite permitido");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new PublicHttpError("response_too_large", "A resposta excede o limite permitido");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchPublicText(
  rawUrl: string,
  options: FetchPublicTextOptions,
): Promise<PublicTextResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHostname = options.resolveHostname ?? resolvePublicHostname;
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1, HARD_MAX_BYTES);
  const maxRedirects = boundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 5);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 30_000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromParent();
  else options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new PublicHttpError("timeout", "Tempo limite da leitura excedido")),
    timeoutMs,
  );

  const headers = new Headers(options.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  const allowedHostnames = new Set(
    Array.from(options.allowedHostnames, (hostname) => hostname.toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
  if (!allowedHostnames.size) {
    throw new PublicHttpError("allowlist_required", "Nenhum host público foi autorizado");
  }

  let currentUrl = rawUrl;
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const safeUrl = await assertPublicHttpsUrl(currentUrl, resolveHostname, allowedHostnames);
      let response: Response;
      try {
        response = await fetchImpl(safeUrl.toString(), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new PublicHttpError("timeout", "Tempo limite da leitura excedido");
        }
        throw error;
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new PublicHttpError("invalid_redirect", "Redirecionamento sem destino");
        if (redirectCount >= maxRedirects) {
          throw new PublicHttpError("too_many_redirects", "Limite de redirecionamentos excedido");
        }
        try {
          currentUrl = new URL(location, safeUrl).toString();
        } catch {
          throw new PublicHttpError("invalid_redirect", "Destino de redirecionamento inválido");
        }
        continue;
      }

      return {
        url: safeUrl.toString(),
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        text: await readLimitedText(response, maxBytes),
      };
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}
