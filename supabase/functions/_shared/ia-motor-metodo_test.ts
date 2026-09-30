/**
 * Frente SPP (30/09/2026): o método da casa entra no fim do sistema nos três
 * provedores e na estimativa de custo, e o uso grava quais métodos foram.
 * Sem método, o corpo que vai ao provedor sai byte a byte igual.
 *
 * Roda o chamarTexto de verdade com um fetch falso (banco do Supabase e
 * provedores): nenhuma chamada sai da máquina, custo zero.
 *
 *   npx --yes deno test --allow-env supabase/functions/_shared/ia-motor-metodo_test.ts
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montarSuperpoderes } from "./superpoderes.ts";

Deno.env.set("SUPABASE_URL", "http://banco.falso");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-falsa-de-teste");
Deno.env.set("OPENAI_API_KEY", "chave-falsa-de-teste");
Deno.env.set("ANTHROPIC_API_KEY", "chave-falsa-de-teste");
Deno.env.set("OPENROUTER_API_KEY", "chave-falsa-de-teste");

type Pedido = { url: string; corpo: unknown };
const pedidos: Pedido[] = [];
let saldo = 1_000_000;

const MODELOS: Record<string, Record<string, unknown>> = {
  "openai:teste": { id: "openai:teste", provedor: "openai", modelo_api: "gpt-teste", tipo: "texto", ativo: true, disponivel: true, preco_entrada_1m: 1_000_000, preco_saida_1m: 0, preco_cache_1m: null, raciocinio: [] },
  "anthropic:teste": { id: "anthropic:teste", provedor: "anthropic", modelo_api: "claude-teste", tipo: "texto", ativo: true, disponivel: true, preco_entrada_1m: 1_000_000, preco_saida_1m: 0, preco_cache_1m: null, raciocinio: [] },
  "openrouter:teste": { id: "openrouter:teste", provedor: "openrouter", modelo_api: "x/teste", tipo: "texto", ativo: true, disponivel: true, preco_entrada_1m: 1_000_000, preco_saida_1m: 0, preco_cache_1m: null, raciocinio: [] },
};

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const texto = init && typeof init.body === "string" ? init.body : null;
  const corpo = texto ? JSON.parse(texto) : null;
  pedidos.push({ url, corpo });
  if (url.startsWith("http://banco.falso/rest/v1/ia_modelos")) {
    const id = decodeURIComponent((/id=eq\.([^&]+)/.exec(url) || [])[1] || "");
    return resposta(MODELOS[id] ? [MODELOS[id]] : []);
  }
  if (url.startsWith("http://banco.falso/rest/v1/rpc/ia_chave_resolver")) return resposta([]);
  if (url.startsWith("http://banco.falso/rest/v1/ia_clientes_config")) return resposta([]);
  if (url.startsWith("http://banco.falso/rest/v1/ia_carteiras")) return resposta([{ saldo_usd: saldo }]);
  if (url.startsWith("http://banco.falso/rest/v1/rpc/ia_registrar_uso")) return resposta([{ uso_id: "uso-teste", saldo_usd: 1 }]);
  if (url.startsWith("http://banco.falso/rest/v1/rpc/ia_uso_marcar_metodo")) return resposta(null);
  if (url === "https://api.openai.com/v1/responses") {
    return resposta({ output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 10, output_tokens: 2 } });
  }
  if (url === "https://api.anthropic.com/v1/messages") return resposta({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 2 } });
  if (url === "https://openrouter.ai/api/v1/chat/completions") return resposta({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 } });
  return resposta({ erro: `rota falsa sem resposta: ${url}` }, 404);
}) as typeof fetch;

const { chamarTexto } = await import("./ia-motor.ts");

const SISTEMA = "SISTEMA DO AGENTE: regras fixas.";
const METODO = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano", "causa"], fonte: "jev" })!;
const esperar = () => new Promise((r) => setTimeout(r, 20));

function sistemaEnviado(provedor: string, corpo: Record<string, unknown>): string {
  if (provedor === "openai") return String(corpo.instructions);
  if (provedor === "anthropic") return String(corpo.system);
  return String(((corpo.messages as Array<{ role: string; content: string }>)[0] || {}).content);
}

const URL_DO_PROVEDOR: Record<string, string> = {
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

for (const provedor of ["openai", "anthropic", "openrouter"]) {
  Deno.test({
    name: `${provedor}: o método vai no fim do sistema; sem método, o corpo é o mesmo`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      saldo = 1_000_000;
      pedidos.length = 0;
      await chamarTexto({ clientId: "cliente-1", tarefa: "conversa", agente: "estrategista", modeloId: `${provedor}:teste`, sistema: SISTEMA, mensagens: [{ papel: "usuario", conteudo: "oi" }] });
      const sem = pedidos.find((p) => p.url === URL_DO_PROVEDOR[provedor])!.corpo as Record<string, unknown>;
      assertEquals(sistemaEnviado(provedor, sem), SISTEMA);
      await esperar();
      assert(!pedidos.some((p) => p.url.includes("ia_uso_marcar_metodo")), "sem método, nada é gravado no uso");

      pedidos.length = 0;
      await chamarTexto({ clientId: "cliente-1", tarefa: "conversa", agente: "estrategista", modeloId: `${provedor}:teste`, sistema: SISTEMA, mensagens: [{ papel: "usuario", conteudo: "oi" }], metodo: { ...METODO, agente: "roteiros.agente" } });
      const com = pedidos.find((p) => p.url === URL_DO_PROVEDOR[provedor])!.corpo as Record<string, unknown>;
      assertEquals(sistemaEnviado(provedor, com), `${SISTEMA}\n\n${METODO.texto}`);
      // Só o sistema muda: o resto do corpo é igual.
      const semSistema = (c: Record<string, unknown>) => {
        const x = JSON.parse(JSON.stringify(c));
        delete x.instructions;
        delete x.system;
        if (Array.isArray(x.messages)) x.messages = x.messages.slice(1);
        return x;
      };
      assertEquals(semSistema(com), semSistema(sem));
      await esperar();
      const marcado = pedidos.find((p) => p.url.includes("ia_uso_marcar_metodo"));
      assert(marcado, "o uso grava o método");
      assertEquals((marcado!.corpo as Record<string, unknown>)._uso_id, "uso-teste");
      assertEquals((marcado!.corpo as Record<string, unknown>)._metodos, METODO.ids);
      assertEquals((marcado!.corpo as Record<string, unknown>)._fonte, "jev");
      assertEquals((marcado!.corpo as Record<string, unknown>)._agente, "roteiros.agente");
    },
  });
}

Deno.test({
  name: "a estimativa de custo inclui o método (a carteira que cabia sem ele não cabe com ele)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Entrada a US$ 1 por token: a estimativa é o número de tokens de entrada (caracteres / 3,5).
    const semTokens = Math.ceil((SISTEMA.length + 2) / 3.5);
    const comTokens = Math.ceil((SISTEMA.length + 2 + METODO.texto.length + 2) / 3.5);
    assert(comTokens > semTokens + 100);
    saldo = semTokens + 50;
    await chamarTexto({ clientId: "cliente-1", tarefa: "conversa", agente: "estrategista", modeloId: "openai:teste", sistema: SISTEMA, mensagens: [{ papel: "usuario", conteudo: "oi" }] });
    await assertRejects(
      () => chamarTexto({ clientId: "cliente-1", tarefa: "conversa", agente: "estrategista", modeloId: "openai:teste", sistema: SISTEMA, mensagens: [{ papel: "usuario", conteudo: "oi" }], metodo: METODO }),
      Error,
      "Saldo insuficiente",
    );
    saldo = 1_000_000;
  },
});
