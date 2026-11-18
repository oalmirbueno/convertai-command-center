// 18/11/2026: a chave chega de vários jeitos; o servidor lê todos e nunca expõe mais que o começo.
import { assertEquals } from "jsr:@std/assert@1";
import { comecoDaChave, extractBearer } from "./mcp-auth.ts";

const req = (headers: Record<string, string>) => new Request("https://x/mcp", { headers });
const k = "mcp_live_ABCDEFGHIJKLMNOP";

Deno.test("Authorization: Bearer certo", () => assertEquals(extractBearer(req({ authorization: `Bearer ${k}` })), k));
Deno.test("sem Bearer, só a chave", () => assertEquals(extractBearer(req({ authorization: k })), k));
Deno.test("entre aspas e com espaço sobrando", () => assertEquals(extractBearer(req({ authorization: `Bearer "${k}"  ` })), k));
Deno.test("caractere invisível colado", () => assertEquals(extractBearer(req({ authorization: `Bearer ${k}â` })), k));
Deno.test("X-API-Key e X-Aceleriq-Key", () => {
  assertEquals(extractBearer(req({ "x-api-key": k })), k);
  assertEquals(extractBearer(req({ "x-aceleriq-key": `Bearer ${k}` })), k);
});
Deno.test("nada mandado continua nada", () => assertEquals(extractBearer(req({})), null));
Deno.test("outro texto no Authorization não vira chave", () => assertEquals(extractBearer(req({ authorization: "Painel Aceleriq" })), null));
Deno.test("começo da chave para conferir", () => assertEquals(comecoDaChave(req({ authorization: `Bearer ${k}` })), "mcp_live_ABC…"));
