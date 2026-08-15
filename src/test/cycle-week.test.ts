import { describe, expect, it } from "vitest";
import {
  addDays, closedStreak, isSameDay, localIso, mondayOf, weekDays, weekLabel,
} from "@/lib/cycleWeek";

describe("semana do Ciclo", () => {
  it("usa a data local, sem deslocar o dia pelo fuso", () => {
    // Meia-noite local: em UTC isso vira o dia seguinte a leste de Greenwich,
    // e era assim que a semana aparecia errada.
    const midnight = new Date(2026, 7, 10, 0, 0, 0);
    expect(localIso(midnight)).toBe("2026-08-10");

    const lateNight = new Date(2026, 7, 10, 23, 59, 0);
    expect(localIso(lateNight)).toBe("2026-08-10");
  });

  it("começa a semana na segunda, inclusive quando o dia é domingo", () => {
    // Sábado 15/08/2026 pertence à semana que começou em 10/08.
    expect(localIso(mondayOf(new Date(2026, 7, 15)))).toBe("2026-08-10");
    // Domingo 16/08 ainda é a mesma semana, não a seguinte.
    expect(localIso(mondayOf(new Date(2026, 7, 16)))).toBe("2026-08-10");
    // Segunda 17/08 abre a semana nova.
    expect(localIso(mondayOf(new Date(2026, 7, 17)))).toBe("2026-08-17");
  });

  it("entrega os sete dias da semana em ordem", () => {
    const days = weekDays(mondayOf(new Date(2026, 7, 15)));
    expect(days).toHaveLength(7);
    expect(localIso(days[0])).toBe("2026-08-10");
    expect(localIso(days[6])).toBe("2026-08-16");
    expect(days[0].getDay()).toBe(1); // segunda
    expect(days[6].getDay()).toBe(0); // domingo
  });

  it("nomeia a semana e também a que vira o mês", () => {
    expect(weekLabel(new Date(2026, 7, 10))).toBe("10 a 16 de agosto");
    expect(weekLabel(new Date(2026, 7, 31))).toBe("31 de agosto a 6 de setembro");
  });

  it("compara dias ignorando a hora", () => {
    expect(isSameDay(new Date(2026, 7, 15, 1), new Date(2026, 7, 15, 22))).toBe(true);
    expect(isSameDay(new Date(2026, 7, 15), new Date(2026, 7, 16))).toBe(false);
  });

  it("anda semanas para frente e para trás sem perder o dia", () => {
    const monday = mondayOf(new Date(2026, 7, 15));
    expect(localIso(addDays(monday, -7))).toBe("2026-08-03");
    expect(localIso(addDays(monday, 7))).toBe("2026-08-17");
  });

  it("conta a sequência só até a primeira semana incompleta", () => {
    const weeks = ["w1", "w2", "w3", "w4"];
    expect(closedStreak(weeks, (key) => key !== "w1")).toBe(3);
    expect(closedStreak(weeks, (key) => key !== "w3")).toBe(1);
    expect(closedStreak(weeks, () => true)).toBe(4);
    expect(closedStreak(weeks, () => false)).toBe(0);
  });
});
