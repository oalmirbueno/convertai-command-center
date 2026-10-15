import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CentralApproval, ReviewReport } from "@/lib/centralReview";

/**
 * Mesa da Revisão (15/10/2026): junta pedidos de ritual decidíveis e avisos de post pendentes
 * e decide pelo RPC certo, com versão e hash exatos. Aprovar não envia nada.
 */
const estado = vi.hoisted(() => ({ pedidos: [] as unknown[], avisos: [] as unknown[], rpc: vi.fn(), aviso: vi.fn() }));
vi.mock("@/hooks/useCentralReviews", () => ({
  callReviewRpc: estado.rpc,
  useCentralReviews: () => ({ data: estado.pedidos, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useAvisosDePublicacao", () => ({
  chamarAviso: estado.aviso,
  useAvisosDePublicacao: () => ({ data: estado.avisos, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null }) }));
vi.mock("@/lib/fileUrls", () => ({ useResolvedFileUrl: () => ({ url: "" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import MesaDaRevisao from "@/components/central/MesaDaRevisao";

const relatorio: ReviewReport = { id: "r1", client_id: "c1", title: "Meio da semana | Mirante", summary: "Oi! Tudo andando.", next_steps: "Aprovar as pautas", created_at: "2026-10-15T10:00:00Z", review_version: 2, status: "draft", metrics: { ritual_type: "meio_semana" } };
const pedido: CentralApproval = { id: "ap1", report_id: "r1", client_id: "c1", payload_version: 2, payload_hash: "h2", status: "pendente", created_at: relatorio.created_at, valid_until: "2099-01-01T00:00:00Z", payload: { report: relatorio, destination: { channel: "portal", recipient: "c1" } } };
const aviso = { id: "av1", client_id: "c1", publication_id: "p1", mensagem: "Seu post está no ar", destino: { channel: "portal", recipient: "c1" }, payload: { publication: { title: "Reel do mirante", platform: "instagram", published_at: "2026-10-15T09:00:00Z" } }, payload_hash: "hav", status: "pendente", preparado_via: "painel", valid_until: "2099-01-01T00:00:00Z", decided_at: null, decision_note: null, executed_at: null, execution_evidence: null, created_at: "2026-10-15T09:05:00Z" };

function montar(reports: ReviewReport[] = [relatorio]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><MesaDaRevisao reports={reports} clients={[{ id: "c1", company_name: "Mirante" }]} isAdmin /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => { estado.pedidos = [pedido]; estado.avisos = [aviso]; estado.rpc.mockReset().mockResolvedValue({ ok: true }); estado.aviso.mockReset().mockResolvedValue({ ok: true }); });

describe("mesa da Revisão", () => {
  it("põe o ritual e o aviso na mesma fila", () => {
    montar();
    expect(screen.getByText("1 de 2")).toBeTruthy();
    expect(screen.getByText("Meio da semana | Mirante")).toBeTruthy();
  });

  it("aprovar o ritual decide com a versão e o hash exatos", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(estado.rpc).toHaveBeenCalledWith("central_review_decide", expect.objectContaining({ _approval_id: "ap1", _expected_version: 2, _expected_payload_hash: "h2", _decision: "aprovado" })));
  });

  it("pedido de outra versão do rascunho não entra na mesa", () => {
    montar([{ ...relatorio, review_version: 3 }]);
    expect(screen.getByText("1 de 1")).toBeTruthy();
    expect(screen.getByText("Reel do mirante")).toBeTruthy();
  });

  it("ajuste no aviso vira rejeição com o pedido escrito", async () => {
    estado.pedidos = [];
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Ajuste/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Trocar a legenda" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir ajuste" }));
    await waitFor(() => expect(estado.aviso).toHaveBeenCalledWith("aviso_publicacao_decidir", expect.objectContaining({ _aviso_id: "av1", _expected_payload_hash: "hav", _decision: "rejeitado", _comment: "Ajuste: Trocar a legenda" })));
  });
});
