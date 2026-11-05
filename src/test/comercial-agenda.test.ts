import { describe, expect, it } from "vitest";
import { horarioDaGrade, horariosLivres, rotuloDoHorario } from "../../supabase/functions/_shared/comercial-agenda";
import { ADICIONAL_GOOGLE, planoPorId, valorDoFechamento } from "../../supabase/functions/_shared/comercial-asaas";

// quinta, 05/11/2026, 08h em São Paulo
const AGORA = Date.parse("2026-11-05T11:00:00Z");

describe("Agenda do Almir", () => {
  it("terça e quinta às 11h, quarta às 11h, uma por dia", () => {
    const h = horariosLivres(AGORA, [], [], 4);
    expect(h.map((x) => x.rotulo)).toEqual(["quinta, 05/11, às 11h", "terça, 10/11, às 11h", "quarta, 11/11, às 11h", "quinta, 12/11, às 11h"]);
  });

  it("11h ocupada no Google passa para as 16h; na quarta o dia sai", () => {
    const ocupados = [
      { inicio: "2026-11-10T14:00:00Z", fim: "2026-11-10T15:00:00Z" }, // terça 11h
      { inicio: "2026-11-11T14:30:00Z", fim: "2026-11-11T15:30:00Z" }, // quarta 11h30
    ];
    const h = horariosLivres(AGORA + 6 * 3600000, ocupados, [], 3);
    expect(h.map((x) => x.rotulo)).toEqual(["terça, 10/11, às 16h", "quinta, 12/11, às 11h", "terça, 17/11, às 11h"]);
  });

  it("dia que já tem reunião não oferece nada, e respeita a antecedência", () => {
    const h = horariosLivres(Date.parse("2026-11-05T12:30:00Z"), [], ["2026-11-10"], 2);
    expect(h.map((x) => x.rotulo)).toEqual(["quinta, 05/11, às 16h", "quarta, 11/11, às 11h"]);
  });

  it("só aceita horário da grade", () => {
    expect(horarioDaGrade("2026-11-10T14:00:00Z")).toBe(true);
    expect(horarioDaGrade("2026-11-11T19:00:00Z")).toBe(false);
    expect(horarioDaGrade("2026-11-09T14:00:00Z")).toBe(false);
    expect(rotuloDoHorario("2026-11-10T19:00:00Z")).toBe("terça, 10/11, às 16h");
  });
});

describe("Google por R$ 297", () => {
  it("é adicional do plano mensal e custa o mesmo avulso; a verba segue à parte", () => {
    expect(ADICIONAL_GOOGLE.valor).toBe(297);
    expect(valorDoFechamento(planoPorId("start_assistido")!, true)).toBe(1244 + 297);
    expect(valorDoFechamento(planoPorId("google_avulso")!)).toBe(297);
  });
});
