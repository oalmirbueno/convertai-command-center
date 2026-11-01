import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toBRDateKey } from "@/lib/dateBR";

/**
 * `toBRDateKey("2026-11-10")` devolvia "2026-11-09": `new Date` de data pura
 * é meia-noite UTC, que em São Paulo ainda é 21h da véspera. Vencimento de
 * parcela e prazo de projeto passam por aqui. O teste roda no fuso do Brasil,
 * como o navegador da equipe.
 */

const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});

describe("toBRDateKey com data pura", () => {
  it("devolve o mesmo dia, não a véspera", () => {
    expect(toBRDateKey("2026-11-10")).toBe("2026-11-10");
    expect(toBRDateKey("2026-01-01")).toBe("2026-01-01");
  });

  it("timestamp continua convertido para o dia de São Paulo", () => {
    // 01/11 às 01:30 UTC = 31/10 às 22:30 em Brasília.
    expect(toBRDateKey("2026-11-01T01:30:00Z")).toBe("2026-10-31");
    expect(toBRDateKey(new Date("2026-11-01T15:00:00Z"))).toBe("2026-11-01");
  });
});
