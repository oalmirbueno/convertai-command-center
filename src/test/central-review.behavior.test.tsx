import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CentralReviewQueue from "@/components/central/CentralReviewQueue";
import { latestReviewReports, reviewDecisionArgs, type CentralApproval, type ReviewReport } from "@/lib/centralReview";
import { deliveryTransition, prepareReviewNotice } from "@/lib/centralReviewTransport";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), prepare: vi.fn(), save: vi.fn(), from: vi.fn(), sourceRpc: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/hooks/useCentralReviews", () => ({
  callReviewRpc: mock.rpc, prepareCentralReview: mock.prepare, saveCentralReviewDraft: mock.save,
  useCentralReviews: () => ({ data: mock.rows, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.sourceRpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const source = { dossier_id: "dossier-a", dossier_version: 4, dossier_updated_at: "2026-09-14T12:00:00Z", scope_hash: "a".repeat(64) };
const report: ReviewReport = { id: "report-a", client_id: "client-a", title: "Ritual de segunda", summary: "Entrega conferida", next_steps: "Revisar a proposta", created_at: "2026-09-14T13:00:00Z", review_version: 2, status: "draft", metrics: { ritual_type: "rota_semana", central_review_source: source } };
const approval: CentralApproval = { id: "approval-a", client_id: "client-a", report_id: "report-a", payload_version: 2, payload_hash: "hash-2", status: "pendente", created_at: report.created_at, payload: { report, destination: { channel: "whatsapp", recipient: "Grupo sintético A" }, source: { dossier_version: 4 } } };
const props = { reports: [report], clients: [{ id: "client-a", company_name: "Cliente sintético A" }], isAdmin: true, onRefresh: vi.fn() };
function mount(entry = "/central", overrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queue = (changed: object) => <MemoryRouter initialEntries={[entry]}><QueryClientProvider client={client}><CentralReviewQueue {...props} {...changed} /></QueryClientProvider></MemoryRouter>;
  const rendered = render(queue(overrides));
  return { ...rendered, rerenderQueue: (changed: object) => rendered.rerender(queue(changed)) };
}
beforeEach(() => { vi.clearAllMocks(); mock.rows = [approval]; mock.rpc.mockResolvedValue({ ok: true }); mock.save.mockResolvedValue({ ...report, review_version: 3 }); mock.sourceRpc.mockResolvedValue({ data: source, error: null }); });

describe("Revisão compartilhada", () => {
  it("não expõe os pedidos para uma conta não administrativa", () => { mount("/central", { isAdmin: false }); expect(screen.queryByText("Revisão por cliente e ritual")).not.toBeInTheDocument(); });
  it("abrir link apenas lê o pedido e não aprova nem envia", () => { mount("/central?review=approval-a"); expect(screen.getByText("Grupo sintético A", { exact: false })).toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.prepare).not.toHaveBeenCalled(); });
  it("exige conferência explícita e envia identidade/versão/hash exatos", async () => {
    mount("/central?review=approval-a"); const button = screen.getByRole("button", { name: "Aprovar esta versão" });
    expect(button).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("central_review_decide", expect.objectContaining({ _approval_id: "approval-a", _expected_client_id: "client-a", _expected_version: 2, _expected_payload_hash: "hash-2", _decision: "aprovado" })));
  });
  it("ajuste exige comentário e usa o mesmo pedido", async () => {
    mount("/central?review=approval-a"); const button = screen.getByRole("button", { name: "Pedir ajuste" }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Comentário" }), { target: { value: "Conferir a fonte da entrega" } }); fireEvent.click(button);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("central_review_decide", expect.objectContaining({ _approval_id: "approval-a", _decision: "alteracoes_pedidas", _comment: "Conferir a fonte da entrega" })));
  });
  it("histórico decidido abre pelo link sem oferecer nova aprovação", () => { mock.rows = [{ ...approval, status: "aprovado" }]; mount("/central?review=approval-a"); expect(screen.getByText("Aprovado · envio não realizado")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Aprovar esta versão" })).not.toBeInTheDocument(); });
  it("duplo clique não dispara duas decisões", async () => {
    let resolve!: (value: unknown) => void; mock.rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
    mount("/central?review=approval-a"); fireEvent.click(screen.getByRole("checkbox")); const button = screen.getByRole("button", { name: "Aprovar esta versão" }); fireEvent.click(button); fireEvent.click(button);
    expect(mock.rpc).toHaveBeenCalledTimes(1); resolve({ ok: true }); await waitFor(() => expect(button).not.toBeDisabled());
  });
  it("edita o rascunho atual e envia a versão exata sem decidir ou preparar", async () => {
    mount("/central?review=approval-a");
    fireEvent.click(screen.getByRole("button", { name: "Editar rascunho atual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Próximo passo do rascunho" }), { target: { value: "Validar o calendário atualizado" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ id: "report-a", client_id: "client-a", review_version: 2, status: "draft" }), { summary: report.summary, next_steps: "Validar o calendário atualizado" }));
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("preserva a edição e explica um conflito sem alegar sucesso", async () => {
    mock.save.mockRejectedValue(new Error("O rascunho mudou enquanto você editava."));
    mount("/central?review=approval-a"); fireEvent.click(screen.getByRole("button", { name: "Editar rascunho atual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem do rascunho" }), { target: { value: "Minha revisão local" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("O rascunho mudou"));
    expect(screen.getByRole("textbox", { name: "Mensagem do rascunho" })).toHaveValue("Minha revisão local");
  });
  it("preserva texto não salvo quando a atualização traz outra versão", () => {
    const view = mount("/central?review=approval-a"); fireEvent.click(screen.getByRole("button", { name: "Editar rascunho atual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem do rascunho" }), { target: { value: "Edição ainda local" } });
    view.rerenderQueue({ reports: [{ ...report, review_version: 3, summary: "Edição de outra sessão" }] });
    expect(screen.getByRole("textbox", { name: "Mensagem do rascunho" })).toHaveValue("Edição ainda local");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    expect(screen.getByText(/Outra versão chegou durante a edição/)).toBeInTheDocument();
  });
  it("não oferece editar ou aprovar quando o relatório foi publicado", () => {
    mount("/central?review=approval-a", { reports: [{ ...report, status: "published" }] });
    expect(screen.queryByRole("button", { name: "Editar rascunho atual" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar esta versão" })).not.toBeInTheDocument();
  });
  it("pedido vencido pede nova revisão e não oferece aprovar", () => {
    mock.rows = [{ ...approval, valid_until: "2020-01-01T00:00:00Z" }]; mount("/central?review=approval-a");
    expect(screen.queryByRole("button", { name: "Aprovar esta versão" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparar pedido desta versão" })).toBeEnabled();
  });
  it("comentários registrados continuam visíveis ao reabrir o pedido", () => {
    mock.rows = [{ ...approval, events: [{ id: "event-a", event: "comentario", comment: "Aguardar a confirmação da fonte", created_at: report.created_at }] }];
    mount("/central?review=approval-a"); expect(screen.getByText("Aguardar a confirmação da fonte")).toBeInTheDocument();
  });
  it("comenta no snapshot histórico sem reabrir ou aprovar sua decisão", async () => {
    mock.rows = [{ ...approval, status: "aprovado" }]; mount("/central?review=approval-a", { reports: [{ ...report, review_version: 3 }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Comentário" }), { target: { value: "Conferência posterior registrada" } });
    fireEvent.click(screen.getByRole("button", { name: "Comentar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("central_review_decide", expect.objectContaining({ _approval_id: "approval-a", _expected_version: 2, _expected_payload_hash: "hash-2", _decision: "comentario" })));
    expect(screen.queryByRole("button", { name: "Aprovar esta versão" })).not.toBeInTheDocument();
  });
  it("não oferece aprovar o pedido antigo após mudança de versão", () => {
    mount("/central?review=approval-a", { reports: [{ ...report, review_version: 3, summary: "Mensagem revisada" }] });
    expect(screen.queryByRole("button", { name: "Aprovar esta versão" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparar pedido desta versão" })).toBeEnabled();
    expect(screen.getByText("Entrega conferida")).toBeInTheDocument();
    expect(screen.getByText(/A versão atual é 3/)).toBeInTheDocument();
  });
  it("não prepara nem aprova sem próximo passo, mesmo com conferência marcada", () => {
    const missing = { ...report, next_steps: "", metrics: { ...report.metrics, central_review_next_steps_required: true } };
    mock.rows = [{ ...approval, payload: { ...approval.payload, report: missing } }];
    mount("/central?review=approval-a", { reports: [missing] });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Aprovar esta versão" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar rascunho atual" })).toBeEnabled();
  });
  it("um rascunho incompleto pode ser editado mas não preparado", () => {
    mock.rows = []; mount("/central", { reports: [{ ...report, next_steps: "" }] });
    expect(screen.getByRole("button", { name: "Preparar pedido desta versão" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar rascunho atual" })).toBeEnabled();
  });
  it("fonte obsoleta exige nova geração e não afirma decisão registrada", async () => {
    mock.rpc.mockRejectedValue(new Error("CENTRAL_SOURCE_STALE"));
    mount("/central?review=approval-a"); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Aprovar esta versão" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Gere uma nova prévia com a fonte atual"));
  });
  it("mostra plano e todas as frentes congeladas sem exibir objetos privados", () => {
    mock.rows = [{ ...approval, payload: { ...approval.payload, scope: { plan_name: "Plano completo", service_keys: ["social_media", "trafego_pago", "sites", "automacao"] } } }];
    mount("/central?review=approval-a", { clients: [{ id: "client-a", company_name: "Cliente sintético A", services_config: { pulse_history: { secret: "privado" } } }] });
    expect(screen.getByText("Plano completo", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Automação", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("privado", { exact: false })).not.toBeInTheDocument();
  });
});

describe("Persistência concorrente do rascunho", () => {
  const storage = (data: unknown) => {
    const chain = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
    chain.update.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.select.mockReturnValue(chain); mock.from.mockReturnValue(chain); return chain;
  };
  it("condiciona a escrita ao cliente, versão lida e status draft no banco", async () => {
    const chain = storage({ ...report, review_version: 3 });
    const { saveCentralReviewDraft } = await vi.importActual<typeof import("@/hooks/useCentralReviews")>("@/hooks/useCentralReviews");
    await saveCentralReviewDraft(report, { summary: " Nova mensagem ", next_steps: " Nova ação " });
    expect(chain.eq.mock.calls).toEqual([["id", "report-a"], ["client_id", "client-a"], ["review_version", 2], ["status", "draft"]]);
    expect(chain.update).toHaveBeenCalledWith({ summary: "Nova mensagem", next_steps: "Nova ação" });
  });
  it("zero linhas atualizadas é conflito, não sucesso", async () => {
    storage(null); const { saveCentralReviewDraft } = await vi.importActual<typeof import("@/hooks/useCentralReviews")>("@/hooks/useCentralReviews");
    await expect(saveCentralReviewDraft(report, { summary: "Minha edição", next_steps: "Ação" })).rejects.toThrow("não sobrescreveu a outra versão");
  });
  it("não salva se a fonte mudou nem se o relatório já foi publicado", async () => {
    const { saveCentralReviewDraft } = await vi.importActual<typeof import("@/hooks/useCentralReviews")>("@/hooks/useCentralReviews");
    mock.sourceRpc.mockResolvedValue({ data: { ...source, dossier_version: 5 }, error: null });
    await expect(saveCentralReviewDraft(report, { summary: "Minha edição", next_steps: "Ação" })).rejects.toThrow("Gere uma nova prévia");
    await expect(saveCentralReviewDraft({ ...report, status: "published" }, { summary: "Minha edição", next_steps: "Ação" })).rejects.toThrow("rascunho");
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe("Contrato de revisão e transporte", () => {
  it("não agrupa clientes distintos e preserva somente a versão mais recente do ritual", () => {
    const result = latestReviewReports([report, { ...report, id: "new", created_at: "2026-09-14T14:00:00Z" }, { ...report, id: "other", client_id: "client-b" }]); expect(result.map(item => item.id).sort()).toEqual(["new", "other"]);
  });
  it("agrupa o fallback da mesma semana UTC e separa a próxima segunda", () => {
    const result = latestReviewReports([report, { ...report, id: "sunday", created_at: "2026-09-20T23:59:59Z" }, { ...report, id: "next-week", created_at: "2026-09-21T00:00:00Z" }]);
    expect(result.map(item => item.id)).toEqual(["next-week", "sunday"]);
  });
  it("mantém períodos explícitos distintos mesmo na mesma semana", () => {
    expect(latestReviewReports([{ ...report, period_start: "2026-09-14" }, { ...report, id: "daily", period_start: "2026-09-15" }])).toHaveLength(2);
  });
  it("rejeita comentários vazios e decisão de pedido encerrado", () => { expect(() => reviewDecisionArgs(approval, "rejeitado", "", "key")).toThrow(); expect(() => reviewDecisionArgs({ ...approval, status: "aprovado" }, "rejeitado", "nota", "key")).toThrow(); });
  it("consolida e deduplica somente os pedidos apresentados, mantendo envio desligado", () => {
    const notice = prepareReviewNotice([approval, approval], "https://app.example.com"); expect(notice.approvalIds).toEqual(["approval-a"]); expect(notice.sendingEnabled).toBe(false); expect(notice.text).toContain("/ciclo/revisao?review=approval-a"); expect(notice.capability).toBe("authenticated_link");
    expect(prepareReviewNotice([approval], "https://app.example.com").deduplicationKey).toBe(notice.deduplicationKey);
  });
  it("versão/destino alterados não reutilizam a identidade de aprovação", () => { expect(() => prepareReviewNotice([approval, { ...approval, payload_hash: "changed-destination" }], "https://app.example.com")).toThrow(); });
  it("envio incerto exige conciliação, não volta à autorização de envio", () => { expect(() => deliveryTransition("incerto", "aprovado")).toThrow(); expect(deliveryTransition("incerto", "confirmado")).toBe("confirmado"); expect(() => deliveryTransition("confirmado", "enviado")).toThrow(); });
});
