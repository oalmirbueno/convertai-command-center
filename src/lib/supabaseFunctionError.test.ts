import { describe, expect, it } from "vitest";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

describe("Supabase function error messages", () => {
  it("surfaces the safe JSON message returned by a failed function", async () => {
    const message = await getSupabaseFunctionErrorMessage(
      {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ error: "Histórico editorial preservado." }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      },
      "Erro",
    );

    expect(message).toBe("Histórico editorial preservado.");
  });

  it("falls back to the SDK message when the response is not JSON", async () => {
    const message = await getSupabaseFunctionErrorMessage(
      {
        message: "Falha segura",
        context: new Response("indisponível", { status: 500 }),
      },
      "Erro",
    );

    expect(message).toBe("Falha segura");
  });
});
