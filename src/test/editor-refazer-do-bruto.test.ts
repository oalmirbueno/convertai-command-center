import { describe, expect, it } from "vitest";
import { lerPedidoDoDono } from "../../supabase/functions/editor-video/modulos/pedido-do-dono";

// 02/10: "refaz do zero a partir do vídeo bruto" rodava a edição completa em cima dos cortes velhos
// (o vídeo da Thainá ficou com o trecho de 0,32 s e o zoom 1,15 que cortava a cabeça).

describe("refazer do zero", () => {
  it("o pedido entende refaz / do zero / do bruto / começa de novo", () => {
    for (const t of ["Refaz a edição do zero a partir do vídeo bruto, sem legenda", "começa de novo", "edita do bruto", "refazer tudo"]) {
      expect(lerPedidoDoDono(t).refazer, t).toBe(true);
    }
    expect(lerPedidoDoDono("edita completo e dinâmico").refazer).toBe(false);
    const p = lerPedidoDoDono("Refaz do zero, edição dinâmica, SEM legenda");
    expect(p.refazer).toBe(true);
    expect(p.sem).toContain("legenda");
  });
});
