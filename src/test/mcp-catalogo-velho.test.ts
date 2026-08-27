import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O catálogo velho no cliente: o servidor tem a ferramenta, o agente não vê.
 *
 * O caso real, com três agentes parados ao mesmo tempo: Nexo e Augusto
 * declararam HOLD dizendo "as cinco rotas financeiras não estão invocáveis
 * pelo adaptador deste turno" — e estavam certos sobre o próprio estado. O
 * servidor tinha catorze rotas financeiras no ar; o adaptador deles
 * guardava a lista de antes.
 *
 * A causa é nossa: `initialize` declara `listChanged: false`, o cliente
 * entende "esta lista nunca muda", cacheia e nunca mais pergunta — enquanto
 * o catálogo saiu de 63 tools (1.20) para 78 (1.28) em uma semana.
 *
 * E `listChanged: false` é VERDADE, não descuido: o transporte é POST puro,
 * GET responde 405, não existe stream para empurrar aviso nenhum. Declarar
 * `true` trocaria um problema por uma promessa falsa — o cliente esperaria
 * um aviso que nunca chega.
 *
 * Como não dá para empurrar, o conserto é tornar a defasagem DETECTÁVEL por
 * quem está do outro lado.
 */

const raiz = resolve(__dirname, "../..");
const servidor = readFileSync(
  resolve(raiz, "supabase/functions/mcp-server/index.ts"), "utf8",
);
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"), "utf8",
);

describe("a lista velha do cliente fica detectavel", () => {
  it("initialize diz quantas tools esta versao expoe", () => {
    // As instrucoes sao relidas em TODO initialize: e o unico canal que
    // alcanca um cliente que ja cacheou a lista. Com o numero na mao, o
    // agente compara com a propria lista e percebe sozinho.
    const trecho = servidor.slice(
      servidor.indexOf('if (method === "initialize")'),
      servidor.indexOf('if (method === "notifications/initialized"'),
    );
    expect(trecho).toContain("${TOOLS.length} tools nesta versao");
    expect(trecho).toContain("chame tools/list de novo");
    expect(trecho).toContain("aceleriq_capabilities");
  });

  it("nao promete o aviso de mudanca que nao temos como enviar", () => {
    // GET responde 405 (sem stream). `listChanged: true` seria o cliente
    // esperando para sempre por uma notificacao que nunca sai.
    expect(servidor).toContain("capabilities: { tools: { listChanged: false } }");
    expect(servidor).toContain('Allow: "POST, OPTIONS"');
  });

  it("capabilities responde ao agente confuso com o conserto", () => {
    // E justamente a ferramenta que o agente chama quando desconfia — e
    // ela estava respondendo contagem sem dizer o que fazer.
    const trecho = ferramentas.slice(
      ferramentas.indexOf("const capabilitiesTool"),
      ferramentas.indexOf("// ─── Read-only tools"),
    );
    expect(trecho).toContain("nomes_visiveis");
    expect(trecho).toContain("como_destravar");
    expect(trecho).toContain("catalogo antigo em cache");
    expect(trecho).toContain("reconecte o conector");
    // E separa o outro caso: credencial sem escopo nenhum nao e cache velho.
    expect(trecho).toContain("Nenhuma tool visivel para esta credencial");
  });

  it("o financeiro tem contagem propria, para o agente conferir", () => {
    // "Quantas financeiras existem?" era pergunta sem resposta na saida.
    expect(ferramentas).toContain("finance: TOOLS.filter(t => t.scopes.includes('aceleriq:finance')).length");
  });
});
