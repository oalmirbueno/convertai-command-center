import { assert, assertEquals } from "jsr:@std/assert@1";
import { motivoDoProjetoEmUso } from "./exclusao.ts";

Deno.test("projeto sem nada rodando nem pedido aberto pode ser excluído", () => {
  assertEquals(motivoDoProjetoEmUso([]), null);
  assertEquals(
    motivoDoProjetoEmUso([
      { no_id: "a", tipo: "copy", status: "pronto", created_at: "2026-10-20T10:00:00Z" },
      { no_id: "b", tipo: "por_no_ar", status: "pronto", saida: { estado: "feito" }, created_at: "2026-10-20T10:00:00Z" },
      { no_id: "c", tipo: "por_no_ar", status: "erro", saida: { estado: "recusado" }, created_at: "2026-10-20T10:00:00Z" },
      { no_id: "d", tipo: "filme", status: "aguardando", created_at: "2026-10-20T10:00:00Z" },
    ]),
    null,
  );
});

Deno.test("nó rodando ou na fila bloqueia; só vale a última execução de cada nó", () => {
  const m = motivoDoProjetoEmUso([{ no_id: "a", tipo: "imagem", status: "rodando", created_at: "2026-10-20T10:00:00Z" }]);
  assert(m && m.indexOf("1 nó está rodando") >= 0);
  assertEquals(
    motivoDoProjetoEmUso([
      { no_id: "a", tipo: "imagem", status: "rodando", created_at: "2026-10-20T09:00:00Z" },
      { no_id: "a", tipo: "imagem", status: "pronto", created_at: "2026-10-20T10:00:00Z" },
    ]),
    null,
  );
});

Deno.test("Pôr no ar com pedido aberto (aguardando aprovação ou com o agente) bloqueia", () => {
  for (const estado of ["aguardando_aprovacao", "com_agente"]) {
    const m = motivoDoProjetoEmUso([{ no_id: "z", tipo: "por_no_ar", status: "aguardando", saida: { estado }, created_at: "2026-10-20T10:00:00Z" }]);
    assert(m && m.indexOf("Pôr no ar tem um pedido aberto") >= 0, estado);
  }
});
