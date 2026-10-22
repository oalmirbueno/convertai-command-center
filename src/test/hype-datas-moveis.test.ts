import { describe, expect, it } from "vitest";
import {
  agruparPorPeriodo, blocoDaData, linhaCurtaDaData, seloDaData,
  blackFriday, carnaval, datasDasProximasSemanas, datasDoAno, DEFINICOES_DO_HYPE, diaDasMaes, diaDoProgramador, diaDosPais,
  faixaDaLinha, nEsimoDiaDaSemana, pascoa, posicaoNaLinha, quandoDaData, segundaDe,
} from "@/components/mesa/datasDoHype";
import { ordenarDatas } from "@/components/mesa/hypeETrending";

describe("datas móveis do calendário de hype", () => {
  it.each([
    [2025, "2025-04-20"], [2026, "2026-04-05"], [2027, "2027-03-28"], [2028, "2028-04-16"], [2030, "2030-04-21"],
  ])("Páscoa de %i", (ano, esperado) => expect(pascoa(ano)).toBe(esperado));

  it("Carnaval é a terça 47 dias antes da Páscoa", () => {
    expect(carnaval(2026)).toBe("2026-02-17");
    expect(carnaval(2027)).toBe("2027-02-09");
  });

  it("Dia das Mães = 2º domingo de maio; Dia dos Pais = 2º domingo de agosto", () => {
    expect(diaDasMaes(2026)).toBe("2026-05-10");
    expect(diaDasMaes(2027)).toBe("2027-05-09");
    expect(diaDosPais(2026)).toBe("2026-08-09");
    expect(diaDosPais(2027)).toBe("2027-08-08");
  });

  it("Black Friday = sexta depois da 4ª quinta de novembro (em 2029 não é a última sexta)", () => {
    expect(blackFriday(2026)).toBe("2026-11-27");
    expect(blackFriday(2025)).toBe("2025-11-28");
    expect(blackFriday(2029)).toBe("2029-11-23");
    expect(nEsimoDiaDaSemana(2029, 11, 5, -1)).toBe("2029-11-30");
  });

  it("Dia do Programador é o 256º dia (12/09 em ano bissexto)", () => {
    expect(diaDoProgramador(2026)).toBe("2026-09-13");
    expect(diaDoProgramador(2028)).toBe("2028-09-12");
  });

  it("a lista fixa tem ids únicos e toda data dentro do ano, com início <= pico <= fim", () => {
    const ids = DEFINICOES_DO_HYPE.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of datasDoAno(2026)) {
      expect(d.pico.slice(0, 4)).toBe("2026");
      expect(d.inicio <= d.pico && d.pico <= d.fim).toBe(true);
      expect(d.porQue.length).toBeGreaterThan(10);
    }
    const bf = datasDoAno(2026).find((d) => d.id === "black-friday")!;
    expect(quandoDaData(bf)).toBe("aquece 28/10 · pico 27/11 · até 30/11");
    const rosa = datasDoAno(2026).find((d) => d.id === "outubro-rosa")!;
    expect(quandoDaData(rosa)).toBe("o mês todo · 01/10 a 31/10");
  });

  it("próximas 8 semanas a partir de 21/10/2026: em andamento e aquecendo entram; o que acabou sai", () => {
    const ids = datasDasProximasSemanas("2026-10-21").map((d) => d.id);
    expect(ids).toContain("outubro-rosa");
    expect(ids).toContain("halloween");
    expect(ids).toContain("black-friday");
    expect(ids).toContain("natal");
    expect(ids).not.toContain("dia-das-criancas");
    expect(ids).not.toContain("dia-do-medico");
    expect(ids).not.toContain("dia-das-maes");
    // Na virada do ano, o Carnaval do ano seguinte entra quando aquece dentro da faixa.
    expect(datasDasProximasSemanas("2026-12-28").map((d) => d.id)).toContain("carnaval");
  });

  it("linha do tempo: 8 semanas de segunda a domingo, barra e pico em %", () => {
    const faixa = faixaDaLinha("2026-10-21");
    expect(segundaDe("2026-10-25")).toBe("2026-10-19");
    expect(faixa.inicio).toBe("2026-10-19");
    expect(faixa.fim).toBe("2026-12-13");
    expect(faixa.semanas.map((s) => s.rotulo)[0]).toBe("19/10");
    const bf = datasDoAno(2026).find((d) => d.id === "black-friday")!;
    const p = posicaoNaLinha(bf, faixa);
    expect(p.esquerda).toBeCloseTo((9 / 56) * 100, 5);
    expect(p.pico).toBeCloseTo(((39 + 0.5) / 56) * 100, 5);
    const natal = datasDoAno(2026).find((d) => d.id === "natal")!;
    expect(posicaoNaLinha(natal, faixa).pico).toBeNull();
    expect(posicaoNaLinha(natal, faixa).esquerda + posicaoNaLinha(natal, faixa).largura).toBeLessThanOrEqual(100);
  });

  it("ordem pela relevância do Jev; sem nota vai para o fim na ordem da data", () => {
    const datas = datasDasProximasSemanas("2026-10-21");
    const notas = { natal: { nota: 9, nivel: "Serve muito a este cliente" }, halloween: { nota: 2, nivel: null } };
    const ordem = ordenarDatas(datas, notas, "relevancia").map((d) => d.id);
    expect(ordem.slice(0, 2)).toEqual(["natal", "halloween"]);
    expect(ordenarDatas(datas, notas, "data")).toEqual(datas);
  });
});

describe("hierarquia das datas (3ª rodada)", () => {
  const ano = datasDoAno(2026);
  const d = (id: string) => ano.find((x) => x.id === id)!;

  it("bloco de calendário com o dia e o mês curto", () => {
    expect(blocoDaData("2026-10-25")).toEqual({ dia: "25", mes: "OUT" });
    expect(blocoDaData("2026-01-08")).toEqual({ dia: "08", mes: "JAN" });
  });

  it("selo: Aqueça já na janela de aquecimento, Agora no pico, nada fora da janela", () => {
    expect(seloDaData(d("halloween"), "2026-10-21")).toBe("aqueca");
    expect(seloDaData(d("halloween"), "2026-10-31")).toBe("agora");
    expect(seloDaData(d("outubro-rosa"), "2026-10-21")).toBe("agora");
    expect(seloDaData(d("natal"), "2026-10-21")).toBeNull();
    expect(seloDaData(d("dia-das-criancas"), "2026-10-21")).toBeNull();
  });

  it("linha curta: aquecer agora, no pico ou em N dias", () => {
    expect(linhaCurtaDaData(d("halloween"), "2026-10-21")).toBe("Aquecer agora · pico em 10 dias");
    expect(linhaCurtaDaData(d("outubro-rosa"), "2026-10-21")).toBe("No pico · até 31/10");
    expect(linhaCurtaDaData(d("natal"), "2026-10-21")).toBe("em 65 dias · aquece 20/11");
  });

  it("agrupa por período: Agora, Próximas 2 semanas e os meses, na ordem do tempo", () => {
    const grupos = agruparPorPeriodo(datasDasProximasSemanas("2026-10-21"), "2026-10-21");
    expect(grupos.map((g) => g.titulo)).toEqual(["Agora", "Próximas 2 semanas", "Novembro", "Dezembro"]);
    expect(grupos[0].datas.map((x) => x.id)).toContain("outubro-rosa");
    expect(grupos[0].datas.map((x) => x.id)).toContain("halloween");
    expect(grupos[3].datas.map((x) => x.id)).toContain("natal");
    // A virada do ano ganha o ano no título.
    const virada = agruparPorPeriodo(datasDasProximasSemanas("2026-12-28"), "2026-12-28").map((g) => g.titulo);
    expect(virada.some((t) => t.indexOf("de 2027") > 0)).toBe(true);
  });
});
