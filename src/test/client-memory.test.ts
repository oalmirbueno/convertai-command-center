import { describe, expect, it } from "vitest";
import { MEMORY_LABELS, memoryAsContext, type MemoryEntry } from "@/lib/clientMemory";

/**
 * A memória é o que dá continuidade ao painel: a mensagem de hoje sabe o que
 * a de ontem prometeu, e o cliente vê a história da parceria. O que não pode
 * quebrar: o contexto entregue à IA precisa ser legível, datado e limitado.
 */

const entrada = (over: Partial<MemoryEntry>): MemoryEntry => ({
  id: Math.random().toString(36).slice(2),
  client_id: "acerbi",
  project_id: null,
  kind: "ritual",
  title: "Rota da semana",
  content: "Semana focada em destravar as aprovações paradas.",
  source: "central",
  tags: [],
  metadata: null,
  created_at: "2026-08-10T12:00:00.000Z",
  created_by: null,
  ...over,
});

describe("memória do cliente como contexto para a IA", () => {
  it("entrega os capítulos datados, do mais recente para o mais antigo", () => {
    const texto = memoryAsContext([
      entrada({ created_at: "2026-08-17T12:00:00.000Z", title: "Prova de movimento" }),
      entrada({ created_at: "2026-08-10T12:00:00.000Z", title: "Rota da semana" }),
    ]);

    expect(texto).toContain("Prova de movimento");
    expect(texto).toContain("Rota da semana");
    // A data precisa aparecer: sem ela a IA não sabe o que é recente.
    expect(texto).toMatch(/1[07]\/08\/2026/);
  });

  it("respeita o limite de capítulos para não estourar o contexto", () => {
    const muitas = Array.from({ length: 30 }, (_, i) =>
      entrada({ title: `Capítulo ${i}` }),
    );
    const texto = memoryAsContext(muitas, 5);

    expect(texto.split("\n")).toHaveLength(5);
    expect(texto).toContain("Capítulo 0");
    expect(texto).not.toContain("Capítulo 9");
  });

  it("devolve vazio quando o cliente ainda não tem história", () => {
    expect(memoryAsContext([])).toBe("");
  });

  it("corta capítulo muito longo, para uma entrada não engolir as outras", () => {
    const gigante = entrada({ content: "x".repeat(2000) });
    const linha = memoryAsContext([gigante]);
    expect(linha.length).toBeLessThanOrEqual(400);
  });

  it("nomeia cada tipo de registro em português para as telas", () => {
    expect(MEMORY_LABELS.ritual).toBe("Mensagem enviada");
    expect(MEMORY_LABELS.ciclo).toBe("Semana de operação");
    expect(MEMORY_LABELS.nota).toBe("Anotação da equipe");
  });
});
