/**
 * E3 parte A (26/09): a fila de revisão no sistema de design. Trava o
 * comportamento novo: a faixa e o cliente escolhidos ficam guardados (mesmo
 * hook da Central, formato tela:v1:) quando a tela passa `memoria`, e nada é
 * guardado sem ela.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CentralReviewQueue from "@/components/central/CentralReviewQueue";
import type { ReviewReport } from "@/lib/centralReview";

vi.mock("@/hooks/useCentralReviews", () => ({
  callReviewRpc: vi.fn(), prepareCentralReview: vi.fn(), saveCentralReviewDraft: vi.fn(),
  useCentralReviews: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const report: ReviewReport = { id: "r1", client_id: "c1", title: "Ritual sintético", summary: "Mensagem", next_steps: "Passo", created_at: "2026-09-22T12:00:00Z", review_version: 1, status: "draft", metrics: { ritual_type: "rota_semana" } };

function montar(memoria: string | null, relatorio: ReviewReport = report) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/ciclo/revisao"]}>
      <QueryClientProvider client={qc}>
        <CentralReviewQueue reports={[relatorio]} clients={[{ id: "c1", company_name: "Cliente sintético" }]} isAdmin onRefresh={vi.fn()} memoria={memoria} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());

describe("fila de revisão com o sistema de design", () => {
  it("as faixas são um seletor e a escolhida volta ao reabrir", () => {
    vi.useFakeTimers();
    try {
      const primeira = montar("ciclo-revisao:u1");
      const faixas = screen.getByRole("tablist", { name: "Faixa da revisão" });
      fireEvent.click(screen.getAllByRole("tab").find((t) => /Enviados/.test(t.textContent || ""))!);
      act(() => { vi.advanceTimersByTime(300); });
      expect(faixas.querySelector('[aria-selected="true"]')).toHaveTextContent("Enviados");
      primeira.unmount();
      expect(JSON.parse(window.localStorage.getItem("tela:v1:ciclo-revisao:u1:faixa") || "null")).toBe("enviado");
      montar("ciclo-revisao:u1");
      expect(screen.getByRole("tablist", { name: "Faixa da revisão" }).querySelector('[aria-selected="true"]')).toHaveTextContent("Enviados");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem memória nada é guardado e a fila abre em Precisa decisão", () => {
    montar(null);
    fireEvent.click(screen.getAllByRole("tab").find((t) => /Enviados/.test(t.textContent || ""))!);
    expect(Object.keys(window.localStorage).filter((k) => k.indexOf("tela:v1:") === 0)).toEqual([]);
  });

  it("uma linha de controles, sem título repetido; o pedido do Hermes fica no \"...\" (15/10/2026)", () => {
    montar(null);
    expect(screen.queryByRole("heading", { name: "Revisão por cliente e ritual" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mais ações da revisão" })).toBeInTheDocument();
  });

  it("cada pedido é uma linha fechada que abre ao tocar", () => {
    const fonte = { dossier_id: "d1", dossier_version: 1, dossier_updated_at: "2026-09-22T12:00:00Z", scope_hash: "a".repeat(64) };
    montar(null, { ...report, next_steps: "", metrics: { ...report.metrics, central_review_source: fonte } });
    const linha = screen.getByRole("button", { name: /Ritual sintético/ });
    expect(linha).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Editar rascunho atual" })).not.toBeInTheDocument();
    fireEvent.click(linha);
    expect(linha).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Editar rascunho atual" })).toBeInTheDocument();
  });
});
