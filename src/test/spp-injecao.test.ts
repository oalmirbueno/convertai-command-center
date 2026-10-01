import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { payloadComMetodo, requestAiChatCompletion, type AiProvider } from "../../supabase/functions/_shared/ai-provider";
import { juntarMetodoAoSistema, TETO_DOS_SUPERPODERES } from "../../supabase/functions/_shared/superpoderes-catalogo";
import { montarSuperpoderes } from "../../supabase/functions/_shared/superpoderes";
import { CONHECIMENTO_ESTRATEGISTA_ADS } from "../../supabase/functions/_shared/conhecimento-ads";
import { conhecimentoAdsPara } from "../../supabase/functions/_shared/conhecimento-dos-agentes";

/**
 * Frente SPP (30/09/2026): o método da casa entra por um campo novo de
 * chamarTexto (EntradaTexto.metodo) e por um parâmetro na cadeia ai-provider,
 * sempre no fim do sistema e fora dos tetos que existem. Sem método, o sistema
 * sai byte a byte igual (as strings `sistema:` fixadas em teste e as fixtures
 * do Estúdio não mudam).
 *
 * O chamarTexto de verdade, com os 3 provedores e a estimativa, é provado no
 * teste Deno supabase/functions/_shared/ia-motor-metodo_test.ts (o Vitest não
 * carrega o `npm:` do motor).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const motor = ler("supabase/functions/_shared/ia-motor.ts");
const METODO = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano", "causa"], fonte: "jev" })!;

describe("chamarTexto: o método no fim do sistema, nos 3 provedores e na estimativa", () => {
  it("EntradaTexto ganha o campo metodo e um sistemaCompleto(e) único faz a junção", () => {
    expect(motor).toContain("metodo?: MetodoInjetado | null;");
    expect(motor).toContain("function sistemaCompleto(e: EntradaTexto): string {\n  return juntarMetodoAoSistema(e.sistema, e.metodo);\n}");
    expect(motor).toContain('import { juntarMetodoAoSistema, type MetodoInjetado } from "./superpoderes-catalogo.ts";');
  });

  it("OpenAI (instructions), Anthropic (system), OpenRouter (mensagem system) e a estimativa usam o sistema completo", () => {
    // MOD2 (30/09): os 3 corpos saem de corpo-dos-provedores.ts com a entrada que o motor monta; o sistema
    // que entra lá é o completo (entradaDoProvedor) e os 3 provedores passam por ela.
    expect(motor).toContain("    sistema: sistemaCompleto(e),\n");
    expect(motor).toContain("const corpo = corpoOpenAi(m.modelo_api, entradaDoProvedor(m, e));");
    expect(motor).toContain("const corpo = corpoAnthropic(m.modelo_api, entradaDoProvedor(m, e));");
    expect(motor).toContain("const corpo = corpoOpenRouter(m.modelo_api, entradaDoProvedor(m, e));");
    const corpos = ler("supabase/functions/_shared/corpo-dos-provedores.ts");
    expect(corpos).toContain("instructions: e.sistema, input, store: false");
    expect(motor).toContain("const caracteres = sistemaCompleto(e).length + e.mensagens.reduce");
    // Nenhum outro lugar lê e.sistema direto (a junção é uma só).
    expect(motor.match(/\be\.sistema\b/g)).toHaveLength(1);
  });

  it("o uso grava o método (RPC só do servidor, sem esperar) e o motor continua com um fetch só", () => {
    expect(motor).toContain("    metodo: e.metodo,\n  });");
    expect(motor).toContain('clienteServico().rpc("ia_uso_marcar_metodo", {');
    expect(motor).toContain("if (r.metodo) marcarMetodoDoUso(usoId, r.metodo);");
    expect(motor.match(/\bfetch\(/g)).toHaveLength(1);
  });

  it("a junção: sem método igual byte a byte; com método, no fim, com uma linha em branco", () => {
    const s = "SISTEMA\ncom regras\n";
    expect(juntarMetodoAoSistema(s, null)).toBe(s);
    const com = juntarMetodoAoSistema(s, METODO);
    expect(com.startsWith(s)).toBe(true);
    expect(com.endsWith(METODO.texto)).toBe(true);
    expect(com.length - s.length).toBe(METODO.tamanho + 2);
  });

  it("com o maior sistema de hoje (Mesa Ads), o método cabe com folga no contexto dos modelos", () => {
    const base = CONHECIMENTO_ESTRATEGISTA_ADS.length + conhecimentoAdsPara("pacote").texto.length;
    const total = base + TETO_DOS_SUPERPODERES + 2;
    // O teste de tetos combinados já prende a base da Mesa Ads em 58.000; com o método, menos de 60.500 caracteres
    // (cerca de 17 mil tokens), longe do contexto de 128 mil tokens dos modelos do catálogo.
    expect(base).toBeLessThanOrEqual(58_000);
    expect(total).toBeLessThan(60_500);
  });
});

describe("cadeia ai-provider: o mesmo parâmetro", () => {
  const provider: AiProvider = { kind: "openai", chatCompletionsUrl: "https://prov.falso/v1/chat/completions", model: "gpt-teste", label: "openai/gpt-teste", headers: { "Content-Type": "application/json" } };

  it("payloadComMetodo junta no fim da primeira mensagem de sistema; sem sistema, abre uma; sem método, o mesmo objeto", () => {
    const p = { messages: [{ role: "system", content: "BASE" }, { role: "user", content: "oi" }], temperature: 0.2 };
    expect(payloadComMetodo(p, null)).toBe(p);
    const com = payloadComMetodo(p, METODO);
    expect((com.messages as Array<{ content: string }>)[0].content).toBe(`BASE\n\n${METODO.texto}`);
    expect((com.messages as Array<{ content: string }>)[1]).toEqual({ role: "user", content: "oi" });
    expect(com.temperature).toBe(0.2);
    expect(p.messages[0].content).toBe("BASE");
    const semSistema = payloadComMetodo({ messages: [{ role: "user", content: "oi" }] }, METODO);
    expect((semSistema.messages as Array<{ role: string }>)[0].role).toBe("system");
  });

  it("requestAiChatCompletion manda o método ao provedor (fetch falso) e sem ele o corpo não muda", async () => {
    const corpos: Array<Record<string, unknown>> = [];
    const falso = vi.fn(async (_u: unknown, init?: RequestInit) => {
      corpos.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    });
    const pedido = (prov: AiProvider) => ({ messages: [{ role: "system", content: "BASE" }, { role: "user", content: `para ${prov.model}` }] });
    await requestAiChatCompletion([provider], pedido, falso);
    await requestAiChatCompletion([provider], pedido, falso, METODO);
    expect((corpos[0].messages as Array<{ content: string }>)[0].content).toBe("BASE");
    expect((corpos[1].messages as Array<{ content: string }>)[0].content).toBe(`BASE\n\n${METODO.texto}`);
    expect(corpos[1].model).toBe("gpt-teste");
  });
});

describe("quem liga pela cadeia antiga e pela Central", () => {
  it("Workspace, Central (motor e reserva) e rituais passam o método", () => {
    expect(ler("supabase/functions/workspace-agent/index.ts")).toContain("}, fetch, sp);");
    const central = ler("supabase/functions/_shared/modelo-da-central.ts");
    expect(central).toContain("metodo: e.metodo ?? null,");
    expect(central).toContain("legado(juntarMetodoAoSistema(p.sistema, p.metodo), p.usuario, temperatura)");
    // Revisão 30/09: o método vai na chamada e, como a cadeia antiga não grava em ia_usos, conta no registro sem uso.
    const coach = ler("supabase/functions/cycle-coach/index.ts");
    expect(coach).toContain('const metodoDoCoach = await superpoderesPara(db, { agente: "rituais.coach" });');
    expect(coach).toContain("}, fetch, metodoDoCoach);");
    expect(coach).toContain("registrarMetodoSemUso(db, { metodo: metodoDoCoach");
    const radar = ler("supabase/functions/radar-ideas/index.ts");
    expect(radar).toContain('const metodoDoRadar = await superpoderesPara(db, { agente: "rituais.radar" });');
    expect(radar).toContain("registrarMetodoSemUso(db, { metodo: metodoDoRadar");
    // A reserva da Central devolve usoId null (quem chama registra o método sem uso); o motor devolve o do ia_usos.
    expect(central).toContain("usoId: saida.usoId || null");
    expect(central).toContain("usage: antigo.usage, usoId: null");
  });
});
