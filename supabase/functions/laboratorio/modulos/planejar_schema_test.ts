/** Regressão do 400 de structured outputs no planejar e nos nós do funil. Sem rede. */
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corpoOpenAi, corpoOpenRouter } from "../../_shared/corpo-dos-provedores.ts";
import { converterParaAnthropic, respeitaAsRegrasDaAnthropic } from "../../_shared/esquema-compativel.ts";
import { aplicarOperacoes, canvasVazio, ESQUEMA_DO_PLANEJAR, lerPlano } from "./regras.ts";
import { ESQUEMA_DA_COPY, ESQUEMA_DO_CARROSSEL } from "./prompts.ts";
import { ESQUEMA_DO_CHECKOUT } from "./prompts_v4.ts";

type Schema = {
  type?: string;
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, Schema>;
  items?: Schema;
};

/** Regra que o provedor recusou: todo campo de todo objeto precisa constar em required. */
function conferirObjetosEstritos(schema: Schema, caminho: string): void {
  if (schema.type === "object") {
    assertEquals(schema.additionalProperties, false, `${caminho}: objeto precisa ser fechado`);
    assertEquals([...(schema.required || [])].sort(), Object.keys(schema.properties || {}).sort(), `${caminho}: required deve incluir cada propriedade`);
  }
  for (const [nome, filho] of Object.entries(schema.properties || {})) conferirObjetosEstritos(filho, `${caminho}.${nome}`);
  if (schema.items) conferirObjetosEstritos(schema.items, `${caminho}[]`);
}

Deno.test("schemas do funil: pedido real de OpenAI e OpenRouter contém objetos estritos completos", () => {
  for (const esquema of [ESQUEMA_DO_PLANEJAR, ESQUEMA_DA_COPY, ESQUEMA_DO_CARROSSEL, ESQUEMA_DO_CHECKOUT]) {
    const entrada = { sistema: "Teste de contrato", mensagens: [], esquemaJson: esquema };
    const direto = corpoOpenAi("gpt-6-luna", entrada);
    const router = corpoOpenRouter("openai/gpt-6-luna", entrada);
    const formatoDireto = (direto.text as { format: { strict: boolean; name: string; schema: Schema } }).format;
    const formatoRouter = (router.response_format as { json_schema: { strict: boolean; name: string; schema: Schema } }).json_schema;
    for (const formato of [formatoDireto, formatoRouter]) {
      assertEquals(formato.strict, true);
      assertEquals(formato.name, esquema.nome);
      conferirObjetosEstritos(formato.schema, esquema.nome);
    }
  }
});

Deno.test("planejar: campos sem uso têm vazio válido também para enums e para Anthropic", () => {
  const propriedades = ESQUEMA_DO_PLANEJAR.schema.properties.operacoes.items.properties;
  assert((propriedades.tipo.enum as readonly string[]).includes(""));
  assert((propriedades.gatilho.enum as readonly string[]).includes(""));
  assert(!propriedades.op.enum.includes("" as never));
  const convertido = converterParaAnthropic(ESQUEMA_DO_PLANEJAR);
  assert(respeitaAsRegrasDaAnthropic(convertido.schema));
  assertEquals(convertido.mudou, false, "O contrato não depende de converter null ou remover campos");
});

const operacao = (campos: Record<string, string>) => ({
  op: "organizar", ref: "", tipo: "", no: "", de: "", para: "", gatilho: "", dados_json: "{}", ...campos,
});

Deno.test("planejar: resposta estrita mantém dados específicos, ligações e ajuste localizado sem permitir execução", () => {
  const plano = lerPlano({
    resposta: "Fluxo montado para revisão.",
    operacoes: [
      operacao({ op: "criar", ref: "contexto", tipo: "contexto", dados_json: JSON.stringify({ texto: "Oficina demonstrativa", inventado: "não permitido" }) }),
      operacao({ op: "criar", ref: "copy", tipo: "copy", dados_json: JSON.stringify({ formato: "anuncio", instrucao: "Texto curto", modelo_id: "openai:gpt-6-sol" }) }),
      operacao({ op: "criar", ref: "pagina", tipo: "pagina", dados_json: JSON.stringify({ tipo_pagina: "vendas", caminho: "/oferta" }) }),
      operacao({ op: "ligar", de: "contexto", para: "copy" }),
      operacao({ op: "ligar", de: "copy", para: "pagina" }),
      operacao({ op: "definir", no: "copy", dados_json: JSON.stringify({ instrucao: "Texto ajustado" }) }),
      operacao({}),
      operacao({ op: "gerar", no: "copy" }),
    ],
  }, "");
  const aplicado = aplicarOperacoes(canvasVazio(), plano.operacoes);
  assertEquals(aplicado.canvas.nos.length, 3);
  assertEquals(aplicado.canvas.ligacoes.length, 2);
  assertEquals(aplicado.recibos.filter((r) => r.aceita).length, 7);
  assertEquals(aplicado.recibos.filter((r) => !r.aceita).length, 1);
  assertMatch(aplicado.recibos[7].recibo, /Não gero nem publico/);
  const contexto = aplicado.canvas.nos.find((n) => n.tipo === "contexto")!;
  const copy = aplicado.canvas.nos.find((n) => n.tipo === "copy")!;
  const pagina = aplicado.canvas.nos.find((n) => n.tipo === "pagina")!;
  assertEquals(contexto.dados, { texto: "Oficina demonstrativa" });
  assertEquals(copy.dados, { formato: "anuncio", instrucao: "Texto ajustado", modelo_id: "openai:gpt-6-sol" });
  assertEquals(pagina.dados, { tipo_pagina: "vendas", caminho: "/oferta" });
  assert(aplicado.canvas.ligacoes.every((l) => !("gatilho" in l)), "Vazio não cria gatilho no funil");
});

Deno.test("planejar: tipo vazio só é neutro fora de criar e o parser continua lendo respostas antigas", () => {
  const antigo = lerPlano({ resposta: "Organizado.", operacoes: [{ op: "organizar" }] }, "");
  assertEquals(aplicarOperacoes(canvasVazio(), antigo.operacoes).recibos[0].aceita, true);
  const vazio = lerPlano({ operacoes: [operacao({ op: "criar", ref: "invalido" })] }, "");
  const aplicado = aplicarOperacoes(canvasVazio(), vazio.operacoes);
  assertEquals(aplicado.canvas.nos.length, 0);
  assertEquals(aplicado.recibos[0].aceita, false);
  assertMatch(aplicado.recibos[0].recibo, /Tipo de nó desconhecido/);
});
