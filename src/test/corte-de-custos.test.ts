import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { resumoDoCorte, vencimentoAoReassinar, type LinhaDeDespesa } from "@/lib/financeiro/corteDeCustos";

const l = (p: Partial<LinhaDeDespesa>): LinhaDeDespesa => ({ id: Math.random().toString(), description: "x", category: "ferramentas", amount: 0, due_date: "2026-11-10", status: "pending", recurrence: "monthly", ...p });

describe("corte de custos", () => {
  it("soma ativos sem pró-labore, liberado das cortadas e a redução", () => {
    const r = resumoDoCorte([
      l({ description: "Claude", amount: 1120 }),
      l({ description: "Domínio", amount: 120, recurrence: "yearly" }),
      l({ description: "Pró-labore Almir", category: "salarios", amount: 2200 }),
      l({ description: "Higgsfield", amount: 255, recurrence: "none", corte_estado: "encerrada", corte_recorrencia: "monthly", corte_em: "2026-11-27T17:44:00Z" }),
      l({ description: "Suno", amount: 150, recurrence: "none", corte_estado: "pausada", corte_recorrencia: "monthly", corte_em: "2026-11-27T17:38:00Z" }),
      l({ description: "Avulso", amount: 999, recurrence: "none" }),
    ]);
    expect(r.agora).toBe(1130);
    expect(r.liberado).toBe(405);
    expect(r.antes).toBe(1535);
    expect(r.pausadas.map((e) => e.description)).toEqual(["Suno"]);
    expect(r.encerradas.map((e) => e.description)).toEqual(["Higgsfield"]);
    expect(r.ativos.map((e) => e.description)).toEqual(["Claude", "Domínio"]);
  });
  it("reassinar nunca nasce atrasado", () => {
    expect(vencimentoAoReassinar("2026-10-21", "monthly", "2026-11-27")).toBe("2026-12-21");
    expect(vencimentoAoReassinar("2026-12-15", "monthly", "2026-11-27")).toBe("2026-12-15");
    expect(vencimentoAoReassinar("2026-11-27", "monthly", "2026-11-27")).toBe("2026-11-27");
    expect(vencimentoAoReassinar("2025-02-24", "yearly", "2026-11-27")).toBe("2027-02-24");
  });
});
