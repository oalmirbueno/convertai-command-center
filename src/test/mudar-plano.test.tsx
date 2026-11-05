import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tipoDepoisDoPlano } from "@/components/admin/MudarPlano";

/** 05/11/2026 (dono): upgrade de plano em um passo. */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

describe("mudar plano", () => {
  it("avulso que passa a pagar mensalidade vira híbrido; os outros ficam", () => {
    expect(tipoDepoisDoPlano("one_off")).toBe("hybrid");
    expect(tipoDepoisDoPlano("hybrid")).toBe("hybrid");
    expect(tipoDepoisDoPlano("recurring")).toBe("recurring");
    expect(tipoDepoisDoPlano(null)).toBe("recurring");
  });

  it("a ficha mostra o plano com o botão, em qualquer aba, só para admin", () => {
    expect(ler("src/components/admin/EditClientDrawer.tsx")).toContain("{isAdmin && <MudarPlano key={client.id}");
  });

  it("o banco leva o valor à próxima mensalidade aberta e ao CRM; paga e vencida ficam", () => {
    const sql = ler("supabase/migrations/20261105190000_plano_mudou_atualiza_tudo.sql");
    expect(sql).toContain("type = 'renewal' AND status = 'pending' AND paid_date IS NULL AND due_date >= v_hoje");
    expect(sql).toContain("UPDATE public.commercial_leads SET monthly_value = NEW.plan_value");
    expect(sql).toContain("AFTER UPDATE OF plan_value ON public.profiles");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated;");
  });
});
