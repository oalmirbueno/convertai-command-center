import { describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chamar: vi.fn() }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: m.chamar, ErroDaMesa: class extends Error {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { cancelarRodada, normalizarExecucao, normalizarSaida, precisaAcompanhar, precisaLerExecucao } from "@/lib/laboratorio/api";

describe("Acompanhamento do fluxo salvo", () => {
  it("mantém a rodada de arte acompanhada enquanto uma peça espera a anterior", () => {
    for (const tipo of ["carrossel", "imagem", "filme", "agente_externo"]) {
      const e = normalizarExecucao({ no_id: "n", tipo, status: "aguardando", saida: { aguardando_dependencias: true } })!;
      expect(precisaLerExecucao(tipo, e)).toBe(true);
    }
  });
  it("acompanha a tarefa externa real e a aprovação, sem concluir por um simples relatório", () => {
    const externo = normalizarExecucao({ no_id: "n", tipo: "agente_externo", status: "aguardando", saida: { tarefa_id: "t" } })!;
    const publicado = normalizarExecucao({ no_id: "p", tipo: "por_no_ar", status: "pronto", saida: { aprovacao_id: "a" } })!;
    expect(precisaAcompanhar("agente_externo", externo)).toBe(true);
    expect(precisaLerExecucao("agente_externo", externo)).toBe(false);
    expect(precisaAcompanhar("por_no_ar", publicado)).toBe(false);
  });
  it("preserva qual peça foi corrigida ao recarregar e descarta referências inválidas", () => {
    const origem = { execucao_id: "original", indice: 2, modo: "ajustar" };
    expect(normalizarSaida({ origem, revisao_texto: "Só troque a chamada" })).toMatchObject({ origem, revisao_texto: "Só troque a chamada" });
    expect(normalizarSaida({ origem: { ...origem, indice: -1 } }).origem).toBeUndefined();
    expect(normalizarSaida({ origem: { ...origem, modo: "resetar" } }).origem).toBeUndefined();
  });
  it("envia o cancelamento para o projeto e rodada exatos", async () => {
    m.chamar.mockResolvedValue({ canceladas: ["esperando", 2] });
    expect(await cancelarRodada("projeto", "rodada")).toEqual(["esperando"]);
    expect(m.chamar).toHaveBeenCalledWith("laboratorio", { acao: "rodada_cancelar", projeto_id: "projeto", rodada_id: "rodada" });
  });
});
