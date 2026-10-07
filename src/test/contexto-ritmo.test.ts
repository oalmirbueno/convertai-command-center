import { describe, expect, it } from "vitest";
import { precisaPesquisar, raciocinioDoPlano } from "../../supabase/functions/agente-contexto/modulos/ritmo-do-plano";

describe("Plano responsivo com pesquisa sob demanda", () => {
  it("não transforma permissão de pesquisa em chamada externa sem necessidade", () => {
    for (const pedido of [null, undefined, true, {}, { consulta: "evento" }, { motivo: "faltam dados" }, { consulta: " ", motivo: " " }]) {
      expect(precisaPesquisar(pedido, true, false)).toBe(false);
    }
  });
  it("só habilita pesquisa justificada quando permitida e uma vez por pedido", () => {
    const pedido = { consulta: "horário oficial do evento", motivo: "confirmar uma informação solicitada e ausente no briefing" };
    expect(precisaPesquisar(pedido, true, false)).toBe(true);
    expect(precisaPesquisar(pedido, false, false)).toBe(false);
    expect(precisaPesquisar(pedido, "true", false)).toBe(false);
    expect(precisaPesquisar(pedido, true, true)).toBe(false);
  });
  it("não força raciocínio alto em modelos que oferecem esforço conversacional menor", () => {
    expect(raciocinioDoPlano(["high", "medium", "low"])).toBe("low");
    expect(raciocinioDoPlano(["high", "minimal"])).toBe("minimal");
    expect(raciocinioDoPlano(["medium", "high"])).toBe("medium");
  });
  it("respeita modelos sem raciocínio configurável e sem nível low", () => {
    expect(raciocinioDoPlano(null)).toBeUndefined();
    expect(raciocinioDoPlano([])).toBeUndefined();
    expect(raciocinioDoPlano(["high"])).toBe("high");
  });
});
