/**
 * 19/10: rascunho de ritual de agente (Hermes) sai com o texto do escritor da Central.
 *
 *   npx --yes deno test --no-lock --allow-env --allow-read supabase/testes-deno/rascunho-de-ritual_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rascunhoComEscritor, ritualDoTitulo } from "../functions/mcp-server/modulos/rascunho-de-ritual.ts";

const ctx = {} as never;
const HERMES = {
  title: "Mirante Luz Floripa | Abertura da semana | 12 a 18/10/2026",
  summary: "Bom dia, pessoal!\n\nComeçamos a semana do Mirante Luz Floripa.\n\nSe precisarem aprovar alguma coisa, a revisão desta semana estará no Painel.",
  next_steps: "Avançar o carrossel",
  metrics: { reach: 4147 },
};

Deno.test("o título nomeia o ritual; preparação interna e relatório de mídia não são ritual", () => {
  assertEquals(ritualDoTitulo("Mirante | Abertura da semana | 12 a 18/10/2026"), "rota_semana");
  assertEquals(ritualDoTitulo("Verzelo | Meio da semana"), "meio_semana");
  assertEquals(ritualDoTitulo("SKC | Fechamento semanal parcial 05–11/10"), "prova_movimento");
  assertEquals(ritualDoTitulo("Preparação interna | Acerbi | Fechamento da semana"), null);
  assertEquals(ritualDoTitulo("Relatório de mídia de setembro"), null);
});

Deno.test("o texto do escritor entra e o do agente fica guardado para a equipe", async () => {
  const redigir = (async (i: { client_id: string; ritual: string }) => {
    assertEquals(i, { client_id: "c1", ritual: "rota_semana" });
    return { ok: true, title: "Carrossel dos quartos entra em produção", body: "Bom dia, Simone. O carrossel dos quartos entra em produção.", next_steps: "Confirmar a renovação até 21/10", model: "openrouter:openai/gpt-6-luna", alertas: [], tarefas_sugeridas: [], repeticao: null };
  }) as never;
  const r = await rascunhoComEscritor(HERMES, "c1", ctx, redigir);
  assertEquals(r.title, "Carrossel dos quartos entra em produção");
  assertEquals(r.summary, "Bom dia, Simone. O carrossel dos quartos entra em produção.");
  assertEquals(r.next_steps, "Confirmar a renovação até 21/10");
  const m = r.metrics as Record<string, unknown>;
  assertEquals(m.reach, 4147);
  assertEquals(m.ritual_type, "rota_semana");
  assertEquals(m.gerado_por, "escritor_central");
  assertEquals((m.rascunho_do_agente as { summary: string }).summary, HERMES.summary);
});

Deno.test("sem resposta do escritor, fica o texto do agente com o motivo; fora de ritual nem chama", async () => {
  const falha = (async () => ({ ok: false, motivo: "O escritor não respondeu agora." })) as never;
  const r = await rascunhoComEscritor(HERMES, "c1", ctx, falha);
  assertEquals(r.summary, HERMES.summary);
  assertEquals((r.metrics as unknown as Record<string, { usado: boolean; motivo: string }>).escritor_central, { usado: false, motivo: "O escritor não respondeu agora." });
  const quebra = (async () => { throw new Error("fora do ar"); }) as never;
  assertEquals(((await rascunhoComEscritor(HERMES, "c1", ctx, quebra)).metrics as unknown as Record<string, { motivo: string }>).escritor_central.motivo, "fora do ar");
  let chamou = false;
  const espia = (async () => { chamou = true; return {}; }) as never;
  const outro = { ...HERMES, title: "Relatório de mídia de setembro" };
  assertEquals(await rascunhoComEscritor(outro, "c1", ctx, espia), outro);
  assertEquals(await rascunhoComEscritor(HERMES, null, ctx, espia), HERMES);
  assertEquals(chamou, false);
});
