import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { retornoDoAgenteExterno, type VinculoExterno } from "./agente-externo.ts";
const saida = { tarefa_id: "tarefa", link_id: "vinculo", operador_nome: "Helena" };
const vinculo = (status: string, prova: string | null = null): VinculoExterno => ({ status, last_action: "Analisou a entrega", last_evidence: prova, next_step: "Aguardar a decisão", block_reason: null, updated_at: "2026-10-21T18:00:00Z" });
Deno.test("agente externo: somente done com prova libera os próximos nós", () => {
  assertEquals(retornoDoAgenteExterno(saida, vinculo("done", "https://exemplo.invalid/entrega")).status, "pronto");
  for (const estado of ["queued", "in_progress", "review", "blocked", "done"]) assertEquals(retornoDoAgenteExterno(saida, vinculo(estado)).status, "aguardando");
  assertEquals(retornoDoAgenteExterno(saida, vinculo("review", "Relatório documental produzido")).status, "aguardando");
});
Deno.test("agente externo: sem vínculo não inventa conclusão; cancelamento e bloqueio são claros", () => {
  assertEquals(retornoDoAgenteExterno(saida, null).status, "aguardando");
  const bloqueado = retornoDoAgenteExterno(saida, { ...vinculo("blocked"), block_reason: "Falta acesso à conta" });
  assert(String(bloqueado.saida.texto).includes("Falta acesso à conta"));
  assertEquals(retornoDoAgenteExterno(saida, vinculo("cancelled")).status, "erro");
});
