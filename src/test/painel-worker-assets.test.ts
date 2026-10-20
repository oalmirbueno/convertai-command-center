import { describe, expect, it } from "vitest";
import borda from "../../config/painel-worker.js";

/**
 * 15/10/2026: pedaço com hash que faltava (publicação pela metade) voltava como index.html com cache
 * de 1 ano e a Execução travava em "reading 'default'". A borda devolve 404 sem cache.
 */
const ambiente = (resposta: Response) => ({ ASSETS: { fetch: async () => resposta } });

describe("borda do painel em /assets/*", () => {
  it("pedaço que não existe (fallback em HTML) vira 404 sem cache", async () => {
    const r = await borda.fetch(new Request("https://aceleriq.online/assets/x-abc.js"), ambiente(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })));
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("pedaço que existe passa igual", async () => {
    const original = new Response("export default 1", { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable" } });
    const r = await borda.fetch(new Request("https://aceleriq.online/assets/x-abc.js"), ambiente(original));
    expect(r).toBe(original);
  });
});
