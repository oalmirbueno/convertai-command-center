import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decidirHorarioDoArrasto } from "@/lib/editorialDrag";

/**
 * Arrastar uma publicação para HOJE com o horário já vencido empurra para
 * daqui a 15 minutos. Às 23h50 de São Paulo, esses 15 minutos caem amanhã — e
 * o aviso dizia "movida para <hoje>". Se o horário efetivo sai do dia de
 * destino, o arrasto é recusado sem mover.
 */

// 01/11/2026 às 23:50 em São Paulo (UTC-3) = 02/11 às 02:50 UTC.
const quaseMeiaNoite = new Date("2026-11-02T02:50:00.000Z");
// 01/11/2026 às 14:00 em São Paulo.
const tarde = new Date("2026-11-01T17:00:00.000Z");

describe("horário de uma publicação arrastada no calendário", () => {
  it("hoje, perto da meia-noite, com a hora vencida: recusa em vez de agendar amanhã", () => {
    // Horário original 09:00 de hoje, já passou.
    const decisao = decidirHorarioDoArrasto(
      "2026-11-01T12:00:00.000Z",
      "2026-11-01",
      quaseMeiaNoite,
    );
    expect(decisao.ok).toBe(false);
    if (!decisao.ok) expect(decisao.mensagem).toMatch(/amanhã/);
  });

  it("hoje, de tarde, com a hora vencida: empurra 15 minutos e continua hoje", () => {
    const decisao = decidirHorarioDoArrasto(
      "2026-11-01T12:00:00.000Z",
      "2026-11-01",
      tarde,
    );
    expect(decisao).toEqual({ ok: true, scheduledAt: "2026-11-01T17:15:00.000Z" });
  });

  it("hora de hoje ainda à frente: mantém o horário escolhido", () => {
    const decisao = decidirHorarioDoArrasto(
      "2026-11-01T21:00:00.000Z",
      "2026-11-01",
      tarde,
    );
    expect(decisao).toEqual({ ok: true, scheduledAt: "2026-11-01T21:00:00.000Z" });
  });

  it("dia futuro: mantém o horário, mesmo perto da meia-noite", () => {
    const decisao = decidirHorarioDoArrasto(
      "2026-11-03T12:00:00.000Z",
      "2026-11-03",
      quaseMeiaNoite,
    );
    expect(decisao).toEqual({ ok: true, scheduledAt: "2026-11-03T12:00:00.000Z" });
  });

  it("dia que já passou: recusa com o aviso de sempre", () => {
    const decisao = decidirHorarioDoArrasto(
      "2026-10-31T12:00:00.000Z",
      "2026-10-31",
      tarde,
    );
    expect(decisao).toEqual({
      ok: false,
      mensagem: "Não dá para agendar publicação em dia que já passou.",
    });
  });

  it("a tela usa a decisão e não move quando ela recusa", () => {
    const pagina = readFileSync(
      resolve(__dirname, "../pages/EditorialCalendar.tsx"),
      "utf8",
    );
    expect(pagina).toContain(
      "const decisao = decidirHorarioDoArrasto(scheduledAt, targetDateKey);",
    );
    expect(pagina).toMatch(
      /if \(!decisao\.ok\) \{\s*toast\.error\(decisao\.mensagem\);\s*return;\s*\}/,
    );
  });
});
