import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  fetchAiChatCompletion,
  requestAiChatCompletion,
  resolveAiProviderChain,
  type AiProviderEnvName,
} from "../../supabase/functions/_shared/ai-provider.ts";

function env(values: Partial<Record<AiProviderEnvName, string>>) {
  return (name: AiProviderEnvName) => values[name];
}

describe("portable AI provider configuration", () => {
  it("prioritizes the configured OpenAI-compatible endpoint and AI_MODEL", () => {
    const providers = resolveAiProviderChain({
      primaryModels: ["gpt-4o-mini"],
      lovableModels: ["google/gemini-2.5-flash"],
    }, env({
      AI_BASE_URL: "https://inference.example.test/openai/v1/",
      AI_API_KEY: "configured-key",
      AI_MODEL: "team-model",
      OPENAI_API_KEY: "openai-key",
      LOVABLE_API_KEY: "lovable-key",
    }));

    expect(providers.map(({ kind, model }) => ({ kind, model }))).toEqual([
      { kind: "configured", model: "team-model" },
      { kind: "openai", model: "team-model" },
      { kind: "lovable", model: "google/gemini-2.5-flash" },
    ]);
    expect(providers[0].chatCompletionsUrl).toBe(
      "https://inference.example.test/openai/v1/chat/completions",
    );
  });

  it("uses OPENAI_API_KEY without requiring Lovable", () => {
    const providers = resolveAiProviderChain({
      primaryModels: ["gpt-5-mini", "gpt-4o-mini"],
      lovableModels: ["google/gemini-2.5-flash"],
    }, env({ OPENAI_API_KEY: "openai-key" }));

    expect(providers).toHaveLength(2);
    expect(providers.every((provider) => provider.kind === "openai")).toBe(true);
    expect(providers[0].chatCompletionsUrl).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("keeps Lovable as an optional compatibility fallback", () => {
    const providers = resolveAiProviderChain({
      primaryModels: ["gpt-4o-mini"],
      lovableModels: ["google/gemini-2.5-flash-lite"],
    }, env({ LOVABLE_API_KEY: "lovable-key" }));

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      kind: "lovable",
      model: "google/gemini-2.5-flash-lite",
      chatCompletionsUrl:
        "https://ai.gateway.lovable.dev/v1/chat/completions",
    });
    expect(providers[0].headers).toMatchObject({
      Authorization: "Bearer lovable-key",
      "Lovable-API-Key": "lovable-key",
    });
  });

  it("rejects unsafe configured base URLs", () => {
    expect(() => resolveAiProviderChain({
      primaryModels: ["model"],
    }, env({
      AI_BASE_URL: "https://user:secret@example.test/v1",
      AI_API_KEY: "key",
    }))).toThrow("AI_BASE_URL must not contain embedded credentials");
  });

  it("requires HTTPS except for a loopback development endpoint", () => {
    expect(() => resolveAiProviderChain({
      primaryModels: ["model"],
    }, env({
      AI_BASE_URL: "http://inference.example.test/v1",
      AI_API_KEY: "key",
    }))).toThrow("AI_BASE_URL must use HTTPS except for loopback development");

    const [provider] = resolveAiProviderChain({
      primaryModels: ["local-model"],
    }, env({
      AI_BASE_URL: "http://127.0.0.1:11434/v1",
      AI_API_KEY: "local-key",
    }));
    expect(provider.chatCompletionsUrl).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
  });

  it("injects provider auth and model without changing the caller payload", async () => {
    const [provider] = resolveAiProviderChain({
      primaryModels: ["configured-model"],
    }, env({ AI_API_KEY: "key" }));
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const payload = { messages: [{ role: "user", content: "hello" }], stream: true };

    await fetchAiChatCompletion(provider, payload, fetcher);

    expect(payload).not.toHaveProperty("model");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
        body: JSON.stringify({ ...payload, model: "configured-model" }),
      }),
    );
  });

  it("falls through failed providers while preserving the payload factory", async () => {
    const providers = resolveAiProviderChain({
      primaryModels: ["configured-model"],
      lovableModels: ["compat-model"],
    }, env({
      AI_BASE_URL: "https://inference.example.test/v1",
      AI_API_KEY: "configured-key",
      OPENAI_API_KEY: "openai-key",
      LOVABLE_API_KEY: "lovable-key",
    }));
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        body: JSON.parse(String(init?.body)),
      });
      return calls.length === 1
        ? new Response("unavailable", { status: 503 })
        : new Response("{}", { status: 200 });
    });

    const result = await requestAiChatCompletion(
      providers,
      (provider) => ({
        messages: [{ role: "user", content: "hello" }],
        stream: provider.kind !== "lovable",
      }),
      fetcher,
    );

    expect(result.provider.kind).toBe("openai");
    expect(result.attempts).toBe(2);
    expect(calls).toEqual([
      {
        url: "https://inference.example.test/v1/chat/completions",
        body: expect.objectContaining({ model: "configured-model", stream: true }),
      },
      {
        url: "https://api.openai.com/v1/chat/completions",
        body: expect.objectContaining({ model: "configured-model", stream: true }),
      },
    ]);
  });

  it("wires every AI Edge Function through the shared provider", () => {
    const root = process.cwd();
    const functions = [
      "workspace-ocr",
      "process-meeting-notes",
      "mcp-files-worker",
      "workspace-agent-import",
      "voice-assistant-agent",
      "workspace-agent",
    ];

    for (const name of functions) {
      const source = readFileSync(
        resolve(root, `supabase/functions/${name}/index.ts`),
        "utf8",
      );
      expect(source).toContain("../_shared/ai-provider.ts");
      expect(source).not.toContain("ai.gateway.lovable.dev");
      expect(source).not.toMatch(/Deno\.env\.get\(["']LOVABLE_API_KEY["']\)/);
    }
  });

  it("preserves multimodal, tool-calling, JSON and streaming contracts", () => {
    const root = process.cwd();
    const readFunction = (name: string) => readFileSync(
      resolve(root, `supabase/functions/${name}/index.ts`),
      "utf8",
    );
    const ocr = readFunction("workspace-ocr");
    const meeting = readFunction("process-meeting-notes");
    const files = readFunction("mcp-files-worker");
    const agentImport = readFunction("workspace-agent-import");
    const voice = readFunction("voice-assistant-agent");
    const workspace = readFunction("workspace-agent");

    expect(ocr).toContain('{ type: "image_url", image_url: { url: image } }');
    expect(meeting).toContain('name: "create_project_plan"');
    expect(meeting).toContain("tool_choice:");
    expect(meeting).toContain('"google/gemini-3-flash-preview"');
    expect(files).toContain("{ type: 'file', file:");
    expect(files).toContain("{ type: 'image_url', image_url:");
    expect(files).toContain("Deno.env.get('MCP_FILE_OCR_MODEL')");
    expect(agentImport).toContain('"google/gemini-2.5-flash"');
    expect(voice).toContain('response_format: { type: "json_object" }');
    expect(voice).toContain('"google/gemini-3.1-flash-lite-preview"');
    expect(workspace).toContain("{ messages, stream: true }");
    expect(workspace).toContain('if (!line.startsWith("data:")) continue');
    expect(workspace).toContain('primaryModels: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini"]');
  });
});
