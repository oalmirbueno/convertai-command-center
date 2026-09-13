import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBilling, type BillingDraft } from "@/lib/createBilling";
import { notifyUser } from "@/lib/notifyHelpers";

// Exercise the real notification helper; mock only database/Edge transports.
const db = vi.hoisted(() => ({ insert: vi.fn(), single: vi.fn(), notificationInsert: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "billing") return { insert: db.insert };
      if (table === "notifications") return { insert: db.notificationInsert };
      throw new Error("Unexpected table in synthetic test");
    },
    functions: { invoke: db.invoke },
  },
}));

const draft: BillingDraft = { client_id: "client", amount: "50", due_date: "2026-09-30", type: "renewal", description: "Sintética" };

beforeEach(() => {
  vi.resetAllMocks();
  db.insert.mockImplementation(() => ({ select: () => ({ single: db.single }) }));
  db.single.mockResolvedValue({ data: { id: "billing" }, error: null });
  db.notificationInsert.mockResolvedValue({ error: null });
  db.invoke.mockResolvedValue({ data: { ok: true, inserted: 1 }, error: null });
});

describe("nova cobranca: somente notificar apos persistencia", () => {
  it("recusa INSERT com erro e nao notifica", async () => {
    db.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createBilling(draft)).rejects.toThrow("Seus dados foram mantidos");
    expect(db.notificationInsert).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
    expect(draft.description).toBe("Sintética");
  });

  it("nao confirma sucesso se nenhuma linha criada retornar", async () => {
    db.single.mockResolvedValue({ data: null, error: null });
    await expect(createBilling(draft)).rejects.toThrow("Não foi possível confirmar");
    expect(db.notificationInsert).not.toHaveBeenCalled();
  });

  it("espera o INSERT concluir antes de emitir notificacao", async () => {
    let resolve: (value: { data: { id: string }; error: null }) => void;
    db.single.mockReturnValue(new Promise((done) => { resolve = done; }));
    const promise = createBilling(draft);
    expect(db.notificationInsert).not.toHaveBeenCalled();
    resolve!({ data: { id: "billing" }, error: null });
    await expect(promise).resolves.toEqual({ notificationFailed: false });
    expect(db.notificationInsert).toHaveBeenCalledOnce();
    expect(db.invoke).not.toHaveBeenCalled();
    expect(db.notificationInsert).toHaveBeenCalledWith({
      user_id: draft.client_id, message: expect.stringContaining("Nova cobrança"),
      notification_type: "billing", link: "/financeiro",
    });
  });

  it.each([1, 0])("aceita fallback persistido ou deduplicado (inserted=%s)", async (inserted) => {
    db.notificationInsert.mockResolvedValue({ error: { code: "42501" } });
    db.invoke.mockResolvedValue({ data: { ok: true, inserted }, error: null });
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: false });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.invoke).toHaveBeenCalledWith("notify-admin", { body: {
      target_user_id: draft.client_id, message: expect.stringContaining("Nova cobrança"),
      notification_type: "billing", link: "/financeiro",
    } });
  });

  it("ambos transportes retornando error avisam falha sem repetir a cobranca", async () => {
    db.notificationInsert.mockResolvedValue({ error: { code: "42501" } });
    db.invoke.mockResolvedValue({ data: null, error: { message: "Synthetic HTTP failure" } });
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.notificationInsert).toHaveBeenCalledOnce();
    expect(db.invoke).toHaveBeenCalledOnce();
  });

  it("rejeicao no fallback avisa falha e preserva cobranca confirmada", async () => {
    db.notificationInsert.mockResolvedValue({ error: { code: "42501" } });
    db.invoke.mockRejectedValue(new Error("Synthetic offline"));
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("rejeicao ambigua do INSERT de notificacao nao repete a escrita por fallback", async () => {
    db.notificationInsert.mockRejectedValue(new Error("Synthetic lost response"));
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("erro de transporte sem codigo SQL nao repete uma notificacao possivelmente salva", async () => {
    db.notificationInsert.mockResolvedValue({ error: { code: "", message: "Synthetic fetch failure" } });
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("resposta do fallback sem confirmacao ok nao vira sucesso", async () => {
    db.notificationInsert.mockResolvedValue({ error: { code: "42501" } });
    db.invoke.mockResolvedValue({ data: null, error: null });
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
  });

  it("consumidores antigos mantem o contrato best effort", async () => {
    db.notificationInsert.mockResolvedValue({ error: { code: "42501" } });
    db.invoke.mockResolvedValue({ data: null, error: { message: "Synthetic HTTP failure" } });
    await expect(notifyUser("client", "Synthetic notice", "billing", "/financeiro")).resolves.toBeUndefined();
  });

  it.each(["0", "-1", "NaN", "Infinity", "10x"])("rejeita valor invalido %s antes de gravar", async (amount) => {
    await expect(createBilling({ ...draft, amount })).rejects.toThrow("valor maior que zero");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.notificationInsert).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });
});
