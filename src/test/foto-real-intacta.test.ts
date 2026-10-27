import { describe, expect, it } from "vitest";
import { caminhoDaFotoDaPauta, layoutDoAntesEDepois, ordenarReferencias } from "../../supabase/functions/mesa-foto/foto-da-pauta-regras";

describe("foto real nunca vai ao gerador (27/10)", () => {
  it("antes e depois viram montagem com os pixels reais, um par por foto da série", () => {
    const refs = ordenarReferencias([{ papel: "depois" as const }, { papel: "antes" as const }, { papel: "antes" as const }, { papel: "depois" as const }]);
    expect(caminhoDaFotoDaPauta(refs, 1)).toEqual({ tipo: "montagem", par: { antes: 0, depois: 2 }, pares: 2 });
    expect(caminhoDaFotoDaPauta(refs, 2)).toEqual({ tipo: "montagem", par: { antes: 1, depois: 3 }, pares: 2 });
  });
  it("antes, depois ou lugar sem par entram como estão", () => {
    expect(caminhoDaFotoDaPauta([{ papel: "cenario" as const }])).toEqual({ tipo: "real_como_esta", indices: [0] });
    expect(caminhoDaFotoDaPauta([{ papel: "produto" as const }, { papel: "antes" as const }])).toEqual({ tipo: "real_como_esta", indices: [1] });
  });
  it("só produto, estilo ou nada: o gerador cria a cena", () => {
    expect(caminhoDaFotoDaPauta([{ papel: "produto" as const }, { papel: "estilo" as const }]).tipo).toBe("gerar");
    expect(caminhoDaFotoDaPauta([]).tipo).toBe("gerar");
  });
  it("retrato empilha (antes em cima), quadrado e paisagem lado a lado, com fresta", () => {
    expect(layoutDoAntesEDepois(1088, 1360)).toEqual({ antes: { x: 0, y: 0, largura: 1088, altura: 676 }, depois: { x: 0, y: 684, largura: 1088, altura: 676 } });
    expect(layoutDoAntesEDepois(1024, 1024)).toEqual({ antes: { x: 0, y: 0, largura: 508, altura: 1024 }, depois: { x: 516, y: 0, largura: 508, altura: 1024 } });
  });
});
