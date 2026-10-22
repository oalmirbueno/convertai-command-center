/**
 * 22/10: o "Criar e gravar" do Mês falhava com "project_id precisa ser um UUID" em cliente de uma marca só
 * (Casa dos Assados, Stop): a proposta nasce sem projeto. O gravar passa a usar o projeto ativo mais recente.
 *
 *   npx --yes deno test --no-lock --allow-env --allow-read supabase/testes-deno/projeto-ativo_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projetoAtivoDoCliente } from "../functions/agente-calendario/modulos/projeto-ativo.ts";

function banco(linhas: Array<{ id: string; status: string | null }>) {
  const consulta = { select: () => consulta, eq: () => consulta, is: () => consulta, order: () => consulta, limit: async () => ({ data: linhas, error: null }) };
  return { from: () => consulta } as never;
}

Deno.test("o projeto ativo mais recente, pulando os encerrados", async () => {
  assertEquals(await projetoAtivoDoCliente(banco([{ id: "p1", status: "completed" }, { id: "p2", status: "active" }, { id: "p3", status: null }]), "c1"), "p2");
  assertEquals(await projetoAtivoDoCliente(banco([{ id: "p1", status: null }]), "c1"), "p1");
});

Deno.test("sem projeto aberto devolve null (o gravar explica que falta projeto)", async () => {
  assertEquals(await projetoAtivoDoCliente(banco([{ id: "p1", status: "Cancelado" }]), "c1"), null);
  assertEquals(await projetoAtivoDoCliente(banco([]), "c1"), null);
});
