import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBilling, type BillingDraft } from "@/lib/createBilling";

const db = vi.hoisted(() => ({ insert: vi.fn(), single: vi.fn(), notify: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: db.insert }) },
}));
vi.mock("@/lib/notifyHelpers", () => ({ notifyUser: db.notify }));

const draft: BillingDraft = { client_id: "client", amount: "50", due_date: "2026-09-30", type: "renewal", description: "Sintética" };

beforeEach(() => {
  vi.clearAllMocks();
  db.insert.mockImplementation(() => ({ select: () => ({ single: db.single }) }));
  db.single.mockResolvedValue({ data: { id: "billing" }, error: null });
  db.notify.mockResolvedValue(undefined);
});

describe("nova cobranca: somente notificar apos persistencia", () => {
  it("recusa INSERT com erro e nao notifica", async () => {
    db.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createBilling(draft)).rejects.toThrow("Seus dados foram mantidos");
    expect(db.notify).not.toHaveBeenCalled();
    expect(draft.description).toBe("Sintética");
  });

  it("nao confirma sucesso se nenhuma linha criada retornar", async () => {
    db.single.mockResolvedValue({ data: null, error: null });
    await expect(createBilling(draft)).rejects.toThrow("Não foi possível confirmar");
    expect(db.notify).not.toHaveBeenCalled();
  });

  it("espera o INSERT concluir antes de emitir notificacao", async () => {
    let resolve: (value: { data: { id: string }; error: null }) => void;
    db.single.mockReturnValue(new Promise((done) => { resolve = done; }));
    const promise = createBilling(draft);
    expect(db.notify).not.toHaveBeenCalled();
    resolve!({ data: { id: "billing" }, error: null });
    await expect(promise).resolves.toEqual({ notificationFailed: false });
    expect(db.notify).toHaveBeenCalledOnce();
  });

  it("notificacao que falha nao transforma cobranca persistida em erro de criacao", async () => {
    db.notify.mockRejectedValue(new Error("Offline"));
    await expect(createBilling(draft)).resolves.toEqual({ notificationFailed: true });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it.each(["0", "-1", "NaN", "Infinity", "10x"])("rejeita valor invalido %s antes de gravar", async (amount) => {
    await expect(createBilling({ ...draft, amount })).rejects.toThrow("valor maior que zero");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.notify).not.toHaveBeenCalled();
  });
});
