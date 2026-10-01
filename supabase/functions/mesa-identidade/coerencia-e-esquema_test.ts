/**
 * Frente IDR (revisão de 01/10): o que antes só tinha teste de "procurar
 * trecho no código" roda aqui de verdade, com um fetch falso (banco do
 * Supabase, OpenRouter e Jev). Nenhuma chamada sai da máquina, custo zero.
 *
 * - ia-motor: o OpenRouter recusa o esquema estrito ("The compiled grammar is
 *   too large", a estratégia parava em 30/09); a segunda chamada vai em modo
 *   JSON com o esquema no sistema e a resposta chega normalizada a quem chamou.
 * - ranquearPropostas: a nota do Jev ordena as propostas (a melhor primeiro).
 * - Jev fora do ar: o ranking e a coerência viram aviso, nunca erro.
 *
 *   npx --yes deno test --allow-env supabase/functions/mesa-identidade/coerencia-e-esquema_test.ts
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", "http://banco.falso");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-falsa-de-teste");
Deno.env.set("OPENROUTER_API_KEY", "chave-falsa-de-teste");
Deno.env.set("TYPESAFE_API_KEY", "chave-falsa-de-teste");

type Pedido = { url: string; corpo: Record<string, unknown> | null };
const pedidos: Pedido[] = [];
/** Respostas do OpenRouter, uma por chamada, na ordem. */
let filaOpenRouter: Array<{ status: number; corpo: unknown }> = [];
/** Resposta do Jev (null = fora do ar, 503). */
let respostaDoJev: unknown = null;

const MODELO = { id: "openrouter:teste", provedor: "openrouter", modelo_api: "x/teste", tipo: "texto", ativo: true, disponivel: true, preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, raciocinio: [] };
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const texto = init && typeof init.body === "string" ? init.body : null;
  const corpo = texto ? JSON.parse(texto) : null;
  pedidos.push({ url, corpo });
  if (url.startsWith("http://banco.falso/rest/v1/ia_modelos")) return resposta([MODELO]);
  if (url.startsWith("http://banco.falso/rest/v1/rpc/ia_chave_resolver")) return resposta([]);
  if (url.startsWith("http://banco.falso/rest/v1/ia_clientes_config")) return resposta([]);
  if (url.startsWith("http://banco.falso/rest/v1/ia_carteiras")) return resposta([{ saldo_usd: 1000 }]);
  if (url.startsWith("http://banco.falso/rest/v1/rpc/ia_registrar_uso")) return resposta([{ uso_id: "uso-teste", saldo_usd: 999 }]);
  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    const r = filaOpenRouter.shift();
    if (!r) return resposta({ error: { message: "fila vazia no teste" } }, 500);
    return resposta(r.corpo, r.status);
  }
  if (url === "https://api.typesafe.ai/v1/systemone") return respostaDoJev ? resposta(respostaDoJev) : resposta({ erro: "fora do ar" }, 503);
  return resposta({ erro: `rota falsa sem resposta: ${url}` }, 404);
}) as typeof fetch;

const { chamarTexto, ehEsquemaGrandeDemais } = await import("../_shared/ia-motor.ts");
const { AVISO_SEM_JEV, conferirCoerencia, ranquearPropostas } = await import("./coerencia-acoes.ts");

const opcoes = { sanitizeOps: false, sanitizeResources: false };
const chamadasAoOpenRouter = () => pedidos.filter((p) => p.url === "https://openrouter.ai/api/v1/chat/completions");

const ESQUEMA = {
  nome: "estrategia_teste",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["arquetipo", "tracos"],
    properties: { arquetipo: { type: "string" }, tracos: { type: "array", items: { type: "string" } } },
  },
};

Deno.test({
  ...opcoes,
  name: "esquema grande demais: uma nova tentativa em modo JSON, com o esquema no sistema, e a resposta chega normalizada",
  fn: async () => {
    pedidos.length = 0;
    filaOpenRouter = [
      { status: 400, corpo: { error: { message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "The compiled grammar is too large" } }) } } } },
      { status: 200, corpo: { choices: [{ message: { content: '```json\n{"arquetipo":"sabio","tracos":["claro","sereno"]}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } } },
    ];
    const saida = await chamarTexto({
      clientId: "cliente-1",
      tarefa: "conversa",
      agente: "estrategista",
      modeloId: "openrouter:teste",
      sistema: "SISTEMA DA ESTRATÉGIA",
      mensagens: [{ papel: "usuario", conteudo: "monte a estratégia" }],
      esquemaJson: ESQUEMA as never,
    });
    const envios = chamadasAoOpenRouter();
    assertEquals(envios.length, 2);
    const primeiro = envios[0].corpo as { response_format: { type: string } };
    assertEquals(primeiro.response_format.type, "json_schema");
    const segundo = envios[1].corpo as { response_format: { type: string }; messages: Array<{ role: string; content: string }> };
    assertEquals(segundo.response_format, { type: "json_object" });
    assertEquals(segundo.messages[0].role, "system");
    assert(segundo.messages[0].content.startsWith("SISTEMA DA ESTRATÉGIA"), "o sistema do agente continua no começo");
    assert(segundo.messages[0].content.includes('"arquetipo"') && segundo.messages[0].content.includes('"tracos"'), "o esquema vai escrito no sistema");
    assertEquals(saida.json, { arquetipo: "sabio", tracos: ["claro", "sereno"] });
    assertEquals(saida.usoId, "uso-teste");
  },
});

Deno.test({
  ...opcoes,
  name: "outra recusa 400 do provedor não ganha nova tentativa (sem laço nem custo dobrado)",
  fn: async () => {
    pedidos.length = 0;
    filaOpenRouter = [{ status: 400, corpo: { error: { message: "Invalid model parameter" } } }];
    const erro = await assertRejects(() =>
      chamarTexto({ clientId: "cliente-1", tarefa: "conversa", agente: "estrategista", modeloId: "openrouter:teste", sistema: "S", mensagens: [{ papel: "usuario", conteudo: "x" }], esquemaJson: ESQUEMA as never })
    );
    assertEquals(chamadasAoOpenRouter().length, 1);
    assertEquals(ehEsquemaGrandeDemais(erro), false);
  },
});

const CH = { userId: "usuario-1", token: "t", doChamador: null } as never;
const projeto = (dados: Record<string, unknown>) => ({ id: "22222222-2222-4222-8222-222222222222", client_id: "cliente-1", dados } as never);
const DADOS = {
  estrategia: {
    arquetipo: { principal: "sabio", secundario: "", justificativa: "ensina" },
    posicionamento: { declaracao: "Para gestores, a Clara é a consultoria que explica antes de vender.", diferencial: "explica antes de vender" },
    tom: { atributos: ["clara", "serena"] },
  },
  naming: { nome: "Clara Consultoria", slogan: "Entenda antes de decidir" },
  sistema: {
    cores: [
      { nome: "Marinho", papel: "primaria", hex: "#1B2A4A" },
      { nome: "Azul", papel: "secundaria", hex: "#3A6EA5" },
      { nome: "Gelo", papel: "neutra", hex: "#F2F4F7" },
    ],
    tipografia: [{ familia: "Merriweather", uso: "titulo" }, { familia: "Inter", uso: "texto" }],
  },
};
const legenda = { "0": "contradiz", "1": "neutra", "2": "em parte", "3": "bem", "4": "é a estratégia" };
const nota = (score: number) => ({ score, legend: legenda });

Deno.test({
  ...opcoes,
  name: "ranquearPropostas: a nota do Jev (0 a 4 na API) vira 0 a 1 e ordena, a melhor primeiro",
  fn: async () => {
    pedidos.length = 0;
    respostaDoJev = { answers: { p0: nota(1), p1: nota(4), p2: nota(2) }, usage: { input_tokens: 100, output_tokens: 10 } };
    const propostas = [{ nome: "A" }, { nome: "B" }, { nome: "C" }];
    const r = await ranquearPropostas(CH, projeto(DADOS), propostas, (x) => `paleta ${x.nome}`, "A paleta");
    assertEquals(r.aviso, null);
    assertEquals(r.propostas.map((x) => x.nome), ["B", "C", "A"]);
    assertEquals(r.propostas.map((x) => x.nota_jev), [1, 0.5, 0.25]);
    const jev = pedidos.find((p) => p.url === "https://api.typesafe.ai/v1/systemone");
    assert(jev && jev.corpo && Object.keys(jev.corpo.questions as Record<string, unknown>).length === 3, "uma pergunta Score por proposta");
    assert(pedidos.some((p) => p.url.startsWith("http://banco.falso/rest/v1/rpc/ia_registrar_uso")), "o custo do Jev vai para a carteira");
  },
});

Deno.test({
  ...opcoes,
  name: "Jev fora do ar: o ranking volta sem nota, na ordem de entrada, com aviso (nenhuma proposta some)",
  fn: async () => {
    respostaDoJev = null;
    const propostas = [{ nome: "A" }, { nome: "B" }];
    const r = await ranquearPropostas(CH, projeto(DADOS), propostas, (x) => x.nome, "O par de fontes");
    assertEquals(r.propostas.map((x) => [x.nome, x.nota_jev]), [["A", null], ["B", null]]);
    assert(r.aviso && /não respondeu/.test(r.aviso));
  },
});

Deno.test({
  ...opcoes,
  name: "coerência: com o Jev, nota pelo código e pelo Jev; sem o Jev, só o código, com o aviso e custo zero",
  fn: async () => {
    respostaDoJev = { answers: { nome: nota(3), paleta: nota(1), tipografia: nota(3), tagline: nota(3), conjunto: nota(2) }, usage: { input_tokens: 200, output_tokens: 20 } };
    const comJev = await conferirCoerencia(CH, projeto(DADOS));
    assertEquals(comJev.coerencia.aviso ?? null, null);
    const paleta = comJev.coerencia.itens.filter((i) => i.dimensao === "paleta")[0];
    assertEquals(paleta.nota_jev, 0.25);
    assert(comJev.custo_usd > 0, "o Jev custa fração de centavo e é registrado");

    respostaDoJev = null;
    const semJev = await conferirCoerencia(CH, projeto(DADOS));
    assertEquals(semJev.coerencia.aviso, AVISO_SEM_JEV);
    assertEquals(semJev.custo_usd, 0);
    assert(semJev.coerencia.itens.length > 0, "as regras do código continuam");
    assert(semJev.coerencia.itens.every((i) => i.nota_jev === null || i.nota_jev === undefined), "sem nota inventada");
  },
});
