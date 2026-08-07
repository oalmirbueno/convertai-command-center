import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpsUrl,
  fetchPublicText,
  isPublicIpAddress,
  parsePublicHttpsUrl,
  PublicHttpError,
  type PublicHostnameResolver,
} from "../../supabase/functions/_shared/public-http.ts";

const PUBLIC_IPV4 = "93.184.216.34";
const publicResolver = vi.fn<PublicHostnameResolver>(async () => [PUBLIC_IPV4]);
const EXAMPLE_HOSTS = ["www.example.com", "cdn.example.com"];

describe("public HTTPS SSRF policy", () => {
  it("accepts only credential-free public HTTPS hostnames", () => {
    expect(parsePublicHttpsUrl("https://www.example.com/path?q=1#fragment").toString())
      .toBe("https://www.example.com/path?q=1");

    for (const candidate of [
      "http://www.example.com",
      "https://user:secret@www.example.com",
      "https://localhost/admin",
      "https://service.internal/admin",
      "https://printer.local/status",
      "https://single-label/path",
      "https://127.0.0.1/admin",
      "https://2130706433/admin",
      "https://0x7f000001/admin",
      "https://0177.0.0.1/admin",
      "https://8.8.8.8/",
      "https://[::1]/",
      "https://[2606:4700:4700::1111]/",
    ]) {
      expect(() => parsePublicHttpsUrl(candidate), candidate).toThrow(PublicHttpError);
    }
  });

  it("classifies loopback, link-local, private and reserved DNS answers as non-public", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "::1",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2002:7f00:1::",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
    expect(isPublicIpAddress(PUBLIC_IPV4)).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("fails closed when DNS returns any non-public address", async () => {
    await expect(assertPublicHttpsUrl(
      "https://www.example.com/data",
      async () => [PUBLIC_IPV4, "169.254.169.254"],
    )).rejects.toMatchObject({ code: "private_address" });

    await expect(assertPublicHttpsUrl(
      "https://www.example.com/data",
      async () => [],
    )).rejects.toMatchObject({ code: "dns_unresolved" });
  });

  it("uses manual redirects and revalidates every destination", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    }));

    await expect(fetchPublicText("https://www.example.com/start", {
      allowedHostnames: EXAMPLE_HOSTS,
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: async () => [PUBLIC_IPV4],
    })).rejects.toMatchObject({ code: "ip_literal_forbidden" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });

    const rebindingHost = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example.org/private" },
    }));
    await expect(fetchPublicText("https://www.example.com/start", {
      allowedHostnames: ["www.example.com"],
      fetchImpl: rebindingHost as typeof fetch,
      resolveHostname: async () => [PUBLIC_IPV4],
    })).rejects.toMatchObject({ code: "host_not_allowed" });
    expect(rebindingHost).toHaveBeenCalledTimes(1);
  });

  it("follows a safe redirect and strips sensitive request headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/final" },
      }))
      .mockResolvedValueOnce(new Response("conteúdo", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));
    const resolver = vi.fn<PublicHostnameResolver>(async () => [PUBLIC_IPV4]);

    const result = await fetchPublicText("https://www.example.com/start", {
      allowedHostnames: EXAMPLE_HOSTS,
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: resolver,
      headers: {
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        "User-Agent": "Aceleriq-Test/1.0",
      },
    });

    expect(result).toMatchObject({
      url: "https://cdn.example.com/final",
      status: 200,
      text: "conteúdo",
    });
    expect(resolver.mock.calls.map(([hostname]) => hostname))
      .toEqual(["www.example.com", "cdn.example.com"]);
    for (const [, init] of fetchImpl.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe("manual");
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("user-agent")).toBe("Aceleriq-Test/1.0");
    }
  });

  it("enforces response limits from both headers and streamed bytes", async () => {
    const resolveHostname = async () => [PUBLIC_IPV4];
    await expect(fetchPublicText("https://www.example.com/header", {
      allowedHostnames: EXAMPLE_HOSTS,
      resolveHostname,
      maxBytes: 4,
      fetchImpl: (async () => new Response("x", {
        headers: { "content-length": "5" },
      })) as typeof fetch,
    })).rejects.toMatchObject({ code: "response_too_large" });

    await expect(fetchPublicText("https://www.example.com/body", {
      allowedHostnames: EXAMPLE_HOSTS,
      resolveHostname,
      maxBytes: 4,
      fetchImpl: (async () => new Response("12345")) as typeof fetch,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });
});

describe("workspace SSRF integration", () => {
  const workspaceAgent = readFileSync(
    resolve(process.cwd(), "supabase/functions/workspace-agent/index.ts"),
    "utf8",
  );
  const workspaceImport = readFileSync(
    resolve(process.cwd(), "supabase/functions/workspace-agent-import/index.ts"),
    "utf8",
  );

  it("routes every user-controlled page read through the shared policy", () => {
    expect(workspaceAgent).toContain('import { fetchPublicText } from "../_shared/public-http.ts"');
    expect(workspaceImport).toContain('import { fetchPublicText } from "../_shared/public-http.ts"');
    expect(workspaceAgent).not.toContain("await fetch(u,");
    expect(workspaceAgent).not.toContain("await fetch(it.url,");
    expect(workspaceImport).not.toContain("redirect: \"follow\"");
    expect(workspaceImport).not.toMatch(/await fetch\(url[,)]/);
    expect(workspaceAgent).toContain("WORKSPACE_LINK_READER_ALLOWED_HOSTS");
    expect(workspaceAgent).not.toContain("fetchPublicText(it.url");
    expect(workspaceAgent.match(/fetchPublicText\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workspaceImport).toContain('allowedHostnames: ["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]');
    expect(workspaceImport).toContain("maxBytes: 1024 * 1024");
  });
});
