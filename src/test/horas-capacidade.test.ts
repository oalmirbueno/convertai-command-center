import { describe, expect, it } from "vitest";
import {
  avanco,
  capacidade,
  comparar,
  eficiencia,
  mapaDeCalor,
  periodoDaHora,
  periodoQueRendeMais,
  projetar,
  segundosPorCliente,
  semanasDoMes,
  totalizar,
  type Detalhe,
  type MesDoCliente,
  type TotaisDoMes,
} from "@/lib/horas/calculos";

/**
 * Central de horas e custos (frente CR): capacidade, eficiência e a decisão
 * "escalar, segurar ou contratar" são conta em código, com a regra que o "?"
 * da tela explica. Estes casos fixam a regra.
 */

const H = 3600;
const A = "cliente-a";
const B = "cliente-b";
/** 28/09/2026 12:00 em São Paulo (mês quase no fim). */
const AGORA = Date.UTC(2026, 8, 28, 15, 0, 0);
/** 1º/10/2026 12:00 em São Paulo (mês começando). */
const COMECO = Date.UTC(2026, 9, 1, 15, 0, 0);

function mes(m: string, segundos: number, entregas: number, clientes: number, extra: Partial<TotaisDoMes> = {}): TotaisDoMes {
  return {
    mes: m,
    segundos,
    custoUsd: 0,
    entregas,
    previstas: 0,
    clientesComPrevisao: 0,
    entregasComPrevisao: 0,
    atrasadas: 0,
    clientesAtivos: clientes,
    porTipo: {},
    ...extra,
  };
}

describe("recortes do mês", () => {
  const detalhe: Detalhe[] = [
    { client_id: A, dia: "2026-09-01", hora: 9, segundos: 2 * H }, // terça, manhã
    { client_id: A, dia: "2026-09-01", hora: 14, segundos: 1 * H }, // terça, tarde
    { client_id: B, dia: "2026-09-08", hora: 20, segundos: 3 * H }, // terça seguinte, noite
    { client_id: B, dia: "2026-09-08", hora: 2, segundos: H / 2 }, // madrugada conta como noite
  ];

  it("período do dia: manhã 6 a 12, tarde 12 a 18, noite 18 a 6", () => {
    expect([5, 6, 11, 12, 17, 18, 23, 0].map(periodoDaHora)).toEqual(["noite", "manha", "manha", "tarde", "tarde", "noite", "noite", "noite"]);
  });

  it("mês, semana, dia e período recortam o tempo por cliente", () => {
    expect(segundosPorCliente(detalhe, { tipo: "mes" }, "todos")).toEqual({ [A]: 3 * H, [B]: 3.5 * H });
    expect(segundosPorCliente(detalhe, { tipo: "semana", inicio: "2026-08-31" }, "todos")).toEqual({ [A]: 3 * H });
    expect(segundosPorCliente(detalhe, { tipo: "dia", dia: "2026-09-08" }, "todos")).toEqual({ [B]: 3.5 * H });
    expect(segundosPorCliente(detalhe, { tipo: "mes" }, "noite")).toEqual({ [B]: 3.5 * H });
    expect(semanasDoMes("2026-09-01")[0]).toBe("2026-08-31");
    expect(semanasDoMes("2026-09-01")).toHaveLength(5);
  });

  it("mapa de calor por dia da semana e hora", () => {
    const mapa = mapaDeCalor(detalhe);
    expect(mapa[1][9]).toBe(2 * H); // terça 9h
    expect(mapa[1][20]).toBe(3 * H);
    expect(mapa[0].reduce((s, x) => s + x, 0)).toBe(0);
  });

  it("horário que rende mais: peças por hora no período; sem peças, o período com mais horas", () => {
    const pecas = [
      { client_id: A, hora: 9, pecas: 2 },
      { client_id: A, hora: 15, pecas: 3 },
    ];
    // Manhã: 2 peças em 2 h = 1/h; tarde: 3 peças em 1 h = 3/h.
    expect(periodoQueRendeMais(detalhe, pecas, A)).toMatchObject({ periodo: "tarde", criterio: "pecas-por-hora", valor: 3 });
    expect(periodoQueRendeMais(detalhe, [], B)).toMatchObject({ periodo: "noite", criterio: "mais-horas" });
    expect(periodoQueRendeMais(detalhe, [], "ninguem")).toBeNull();
  });
});

describe("eficiência e comparação", () => {
  it("horas e custo por entrega e entregas por hora; sem entrega, sem número inventado", () => {
    expect(eficiencia(10 * H, 5, 20)).toEqual({ horasPorEntrega: 0.5, custoPorEntrega: 0.25, entregasPorHora: 2, custoPorHora: 0.5 });
    expect(eficiencia(10 * H, 5, 0)).toMatchObject({ horasPorEntrega: null, custoPorEntrega: null, entregasPorHora: 0 });
    expect(eficiencia(0, 0, 3)).toMatchObject({ horasPorEntrega: null, entregasPorHora: null });
  });

  it("compara com o mês anterior e com a média dos 3 anteriores", () => {
    const c = comparar(120, 100, [100, 80, null]);
    expect(c.media3).toBe(90);
    expect(c.vsAnterior).toBeCloseTo(0.2);
    expect(c.vsMedia3).toBeCloseTo(0.3333, 3);
    expect(comparar(5, null, [null]).vsAnterior).toBeNull();
  });

  it("avanço do plano: pautas feitas sobre o previsto, cada cliente até o previsto dele", () => {
    const linhas: MesDoCliente[] = [
      { client_id: A, nome: "A", mes: "2026-09-01", segundos: H, dias: 1, custoUsd: 1, entregas: 12, porTipo: { posts: 12 }, previstas: 10, feitasDoPlano: 12, atrasadas: 0 },
      { client_id: B, nome: "B", mes: "2026-09-01", segundos: H, dias: 1, custoUsd: 1, entregas: 3, porTipo: { posts: 3 }, previstas: 10, feitasDoPlano: 3, atrasadas: 2 },
      { client_id: "c", nome: "C", mes: "2026-09-01", segundos: 0, dias: 0, custoUsd: 0, entregas: 4, porTipo: { tarefas: 4 }, previstas: null, feitasDoPlano: 0, atrasadas: 0 },
    ];
    const t = totalizar("2026-09-01", linhas);
    expect(t).toMatchObject({ entregas: 19, previstas: 20, entregasComPrevisao: 13, atrasadas: 2, clientesAtivos: 2, clientesComPrevisao: 2 });
    expect(t.porTipo).toEqual({ posts: 15, tarefas: 4 });
    expect(avanco(t)).toBeCloseTo(0.65);
    expect(avanco({ previstas: 0, entregasComPrevisao: 0 })).toBeNull();
  });
});

describe("capacidade", () => {
  it("projeção do mês em andamento é linear; com menos de 3 dias não projeta", () => {
    expect(projetar(10, "2026-08-01", AGORA)).toBe(10);
    expect(projetar(90, "2026-09-01", AGORA)!).toBeGreaterThan(90);
    expect(projetar(90, "2026-09-01", AGORA)!).toBeLessThan(100);
    expect(projetar(5, "2026-10-01", COMECO)).toBeNull();
  });

  it("clientes que cabem = carga ÷ horas médias por cliente dos meses fechados; folga vira clientes novos e dias adiantáveis", () => {
    const cap = capacidade({
      mes: "2026-09-01",
      agora: AGORA,
      cargaHoras: 160,
      meses: [
        mes("2026-06-01", 60 * H, 30, 4), // 15 h por cliente
        mes("2026-07-01", 75 * H, 30, 5),
        mes("2026-08-01", 90 * H, 36, 6),
        mes("2026-09-01", 84 * H, 30, 6),
      ],
    });
    expect(cap.horasPorCliente).toBeCloseTo(15);
    expect(cap.baseDaMedia).toEqual(["2026-08-01", "2026-07-01", "2026-06-01"]);
    expect(cap.clientesQueCabem).toBe(10);
    expect(cap.horasProjetadas).toBe(true);
    expect(cap.horasDoMes).toBeGreaterThan(84);
    expect(cap.clientesNovosCabem).toBe(Math.floor((160 - cap.horasDoMes) / 15));
    expect(cap.diasAdiantaveis).toBeGreaterThan(0);
    expect(cap.clientesPorContratacao).toBe(10);
  });

  it("carga editável muda a conta", () => {
    const base = { mes: "2026-08-01", agora: AGORA, meses: [mes("2026-07-01", 100 * H, 50, 5), mes("2026-08-01", 100 * H, 50, 5)] };
    expect(capacidade({ ...base, cargaHoras: 160 }).clientesQueCabem).toBe(8);
    expect(capacidade({ ...base, cargaHoras: 120 }).clientesQueCabem).toBe(6);
  });
});

describe("escalar, segurar ou contratar", () => {
  const meses = (atual: number, anterior: number, extra: Partial<TotaisDoMes> = {}, extraAnterior: Partial<TotaisDoMes> = {}) => [
    mes("2026-05-01", 100 * H, 50, 5),
    mes("2026-06-01", 100 * H, 50, 5),
    mes("2026-07-01", anterior * H, anterior / 2, 5, extraAnterior),
    mes("2026-08-01", atual * H, atual / 2, 5, extra),
  ];
  const decidir = (m: TotaisDoMes[]) => capacidade({ mes: "2026-08-01", agora: AGORA, cargaHoras: 160, meses: m });

  it("escalar: ocupação abaixo de 75% e eficiência estável", () => {
    const d = decidir(meses(100, 100));
    expect(d.ocupacao).toBeCloseTo(0.625);
    expect(d.tendenciaDaEficiencia).toBe("estavel");
    expect(d.decisao).toBe("escalar");
  });

  it("segurar: ocupação entre 75% e 90%", () => {
    expect(decidir(meses(130, 100)).decisao).toBe("segurar");
  });

  it("segurar: ocupação baixa, mas eficiência piorando (mais horas por entrega)", () => {
    const m = meses(100, 100, { entregas: 30 });
    const d = decidir(m);
    expect(d.tendenciaDaEficiencia).toBe("sobe");
    expect(d.decisao).toBe("segurar");
  });

  it("contratar: acima de 90% por dois meses seguidos", () => {
    const d = decidir(meses(150, 148));
    expect(d.decisao).toBe("contratar");
    expect(d.horasParaContratacao).toBeCloseTo(150 - 120);
  });

  it("um mês só acima de 90% ainda é segurar", () => {
    expect(decidir(meses(150, 100)).decisao).toBe("segurar");
  });

  it("contratar: atrasos subindo com ocupação alta", () => {
    expect(decidir(meses(125, 100, { atrasadas: 6 }, { atrasadas: 2 })).decisao).toBe("contratar");
    // Atraso subindo com ocupação baixa não é contratar.
    expect(decidir(meses(90, 100, { atrasadas: 6 }, { atrasadas: 2 })).decisao).toBe("escalar");
  });

  it("primeira semana, sem horas: sem base (nada inventado)", () => {
    const d = capacidade({ mes: "2026-10-01", agora: COMECO, cargaHoras: 160, meses: [] });
    expect(d.decisao).toBe("sem-base");
    expect(d.horasPorCliente).toBeNull();
    expect(d.clientesQueCabem).toBeNull();
  });
});
