import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ritualTiming } from "@/lib/ritualTiming";

const central = readFileSync(
  resolve(__dirname, "../..", "src/pages/AdminExperience.tsx"),
  "utf8",
);

/**
 * A Central se chama "o que enviar e quando" e não dizia o que era HOJE: as
 * cinco linhas tinham o mesmo peso visual, e quem abria na quarta precisava
 * lembrar de cabeça que quarta é o Check do Meio da Semana. A tela já tinha
 * essa informação e não usava.
 */

// Segunda 17/08/2026 ... domingo 23/08.
const dia = (n: number) => new Date(2026, 7, 16 + n, 10, 0, 0);

const rotaSegunda = { value: "rota_semana", dia: 1 };
const checkQuarta = { value: "meio_semana", dia: 3 };
const provaSexta = { value: "prova_movimento", dia: 5 };
const mensal = { value: "radar_aceleriq" };

describe("o ritual do dia salta aos olhos", () => {
  it("na segunda, a Rota da Semana é a de hoje", () => {
    const q = ritualTiming(rotaSegunda, dia(1));
    expect(q.destaque).toBe(true);
    expect(q.etiqueta).toBe("hoje");
  });

  it("na quarta, quem fica em destaque é o Check do Meio", () => {
    expect(ritualTiming(checkQuarta, dia(3)).etiqueta).toBe("hoje");
    // E a Rota de segunda já não disputa a atenção.
    expect(ritualTiming(rotaSegunda, dia(3)).destaque).toBe(false);
  });

  it("na sexta, a Prova de Movimento é a de hoje", () => {
    expect(ritualTiming(provaSexta, dia(5)).etiqueta).toBe("hoje");
  });
});

describe("a tolerância de um dia existe porque a semana é real", () => {
  it("o de segunda ainda merece destaque na terça", () => {
    // Perder o horário de segunda não deve empurrar a mensagem para a semana
    // seguinte: ainda dá tempo, e o destaque lembra disso.
    const q = ritualTiming(rotaSegunda, dia(2));
    expect(q.destaque).toBe(true);
    expect(q.etiqueta).toBe("era ontem");
  });

  it("passada a tolerância, sai do destaque sem virar cobrança", () => {
    const q = ritualTiming(rotaSegunda, dia(4));
    expect(q.destaque).toBe(false);
    expect(q.etiqueta).toBe("passou");
    // Nada de "atrasado": a Central é ferramenta de trabalho, não cobrança.
    expect(q.etiqueta).not.toMatch(/atrasad|pendente/i);
  });

  it("o que ainda vai chegar é anunciado sem alarme", () => {
    expect(ritualTiming(provaSexta, dia(1)).etiqueta).toBe("em breve");
    expect(ritualTiming(provaSexta, dia(1)).destaque).toBe(false);
  });
});

describe("o que não tem dia fixo não é cobrado por dia", () => {
  it("mensal e trimestral ficam neutros a semana toda", () => {
    for (let d = 1; d <= 7; d += 1) {
      const q = ritualTiming(mensal, dia(d));
      expect(q.destaque).toBe(false);
      expect(q.etiqueta).toBe("");
    }
  });

  it("no fim de semana nada é cobrado", () => {
    // Sábado e domingo: a conta recomeça na segunda.
    expect(ritualTiming(rotaSegunda, dia(6)).etiqueta).toBe("");
    expect(ritualTiming(provaSexta, dia(7)).etiqueta).toBe("");
  });
});

describe("a Central usa a regra e acompanha a virada do dia", () => {
  it("os rituais semanais declaram o dia deles", () => {
    expect(central).toContain('value: "rota_semana", dia: 1');
    expect(central).toContain('value: "meio_semana", dia: 3');
    expect(central).toContain('value: "prova_movimento", dia: 5');
  });

  it("usa o relógio que avança sozinho, não um instante congelado", () => {
    // Com new Date() fixo na renderização, a etiqueta "hoje" ficaria na linha
    // errada depois da virada da meia-noite até alguém recarregar.
    expect(central).toContain("ritualTiming(r, nowTick)");
  });

  it("o destaque muda a faixa e o botão, não só a cor do texto", () => {
    expect(central).toContain("quando.destaque");
    expect(central).toMatch(/quando\.destaque[\s\S]{0,120}bg-primary/);
  });
});
