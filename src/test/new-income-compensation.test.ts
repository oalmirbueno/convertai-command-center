import { describe, expect, it, vi } from "vitest";
import { compensateNewIncome } from "@/lib/newIncomeCompensation";

describe("new income compensation", () => {
  it("remove o projeto raiz quando o fluxo criou um projeto novo", async () => {
    const deleteById = vi.fn().mockResolvedValue({ error: null, deletedCount: 1 });

    await compensateNewIncome(
      { createdProjectId: "project-1", createdPaymentId: "payment-1" },
      deleteById,
    );

    expect(deleteById).toHaveBeenCalledOnce();
    expect(deleteById).toHaveBeenCalledWith("projects", "project-1");
  });

  it("remove somente o pagamento ao vincular um projeto existente", async () => {
    const deleteById = vi.fn().mockResolvedValue({ error: null, deletedCount: 1 });

    await compensateNewIncome(
      { createdProjectId: null, createdPaymentId: "payment-2" },
      deleteById,
    );

    expect(deleteById).toHaveBeenCalledWith("project_payments", "payment-2");
  });

  it("propaga falha de compensação para impedir uma nova tentativa cega", async () => {
    const deleteById = vi.fn().mockResolvedValue({
      error: { message: "delete blocked" },
      deletedCount: 0,
    });

    await expect(
      compensateNewIncome(
        { createdProjectId: "project-3", createdPaymentId: null },
        deleteById,
      ),
    ).rejects.toThrow("delete blocked");
  });

  it("não declara compensação concluída quando nenhuma linha foi removida", async () => {
    const deleteById = vi.fn().mockResolvedValue({ error: null, deletedCount: 0 });

    await expect(
      compensateNewIncome(
        { createdProjectId: null, createdPaymentId: "payment-missing" },
        deleteById,
      ),
    ).rejects.toThrow("não confirmou a remoção");
  });
});
