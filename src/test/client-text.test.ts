import { describe, expect, it } from "vitest";
import { listInWords, readableFileName, readableProjectName } from "@/lib/clientText";

/**
 * Um cliente reclamou da mensagem do grupo: ela mostrava organização interna
 * ("SKC | Marketing, Presença Digital e Aquisição") e contadores soltos que
 * não diziam nada. Estas funções são a tradução para a língua dele.
 */

describe("nome de arquivo legível", () => {
  it("tira extensão, underline e carimbo de data", () => {
    expect(readableFileName("arte_dia-do-contador_20260817.png")).toBe("arte dia do contador");
  });

  it("mantém nome que já está legível", () => {
    expect(readableFileName("Post sobre MEI.jpg")).toBe("Post sobre MEI");
  });

  it("não deixa espaço duplo nem sobra de pontuação", () => {
    expect(readableFileName("video__final--v2.mp4")).toBe("video final v2");
  });
});

describe("nome de frente legível", () => {
  it("remove o prefixo do cliente, que é organização interna", () => {
    // Foi exatamente o que apareceu na mensagem que o cliente reclamou.
    expect(
      readableProjectName("SKC | Marketing, Presença Digital e Aquisição", "SKC TECNOLOGIA CONTABIL"),
    ).toBe("Marketing, Presença Digital e Aquisição");
  });

  it("funciona com outros separadores", () => {
    expect(readableProjectName("Acerbi - Social e Vídeo", "Acerbi")).toBe("Social e Vídeo");
    expect(readableProjectName("Verzelo: Jardins", "Verzelo")).toBe("Jardins");
  });

  it("não quebra com caractere especial no nome do cliente", () => {
    // "Vifut.com.br" tem pontos, que são curinga em expressão regular.
    expect(readableProjectName("Vifut.com.br | Reels analíticos", "Vifut.com.br")).toBe(
      "Reels analíticos",
    );
  });

  it("deixa passar o nome que não tem prefixo", () => {
    expect(readableProjectName("Conteúdo, Meta Ads e Reservas", "Mirante Luz")).toBe(
      "Conteúdo, Meta Ads e Reservas",
    );
  });

  it("aguenta nome de cliente vazio", () => {
    expect(readableProjectName("Campanha de verão", "")).toBe("Campanha de verão");
  });
});

describe("lista do jeito que se fala", () => {
  it("usa 'e' antes do último", () => {
    expect(listInWords(["arte do contador", "vídeo do MEI"])).toBe(
      "arte do contador e vídeo do MEI",
    );
  });

  it("respeita o limite sem cortar no meio", () => {
    expect(listInWords(["a", "b", "c", "d"], 3)).toBe("a, b e c");
  });

  it("um item sozinho não ganha conjunção", () => {
    expect(listInWords(["arte do contador"])).toBe("arte do contador");
  });

  it("lista vazia não vira texto solto", () => {
    expect(listInWords([])).toBe("");
  });
});
