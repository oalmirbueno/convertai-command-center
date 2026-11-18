import { describe, expect, it } from "vitest";
import { dataCurta, diaEmSaoPaulo, entradasPorDiaDaSemana, resumoDasSaidas, resumoDoCrescimento, segundaDaSemana, serieDoCrescimento, servicosDeQuemEntrou, valorDeQuemEntrou, type ClienteDaCarteira, type Recebimento } from "@/lib/crescimentoDaCarteira";

// 12/11/2026 (dono): quantos clientes entraram por semana e por mês, o histórico inteiro, o mês com mais
// e com menos entradas e o de maior faturamento.
const HOJE = new Date("2026-11-12T15:00:00Z");
const c = (id: string, entrou: string, tipo: ClienteDaCarteira["tipo"] = "recurring", ativo = true): ClienteDaCarteira => ({ id, nome: `Cliente ${id}`, entrou, tipo, ativo });
const clientes = [
  c("a", "2026-07-03T12:00:00Z"), c("b", "2026-07-20T12:00:00Z"), c("c", "2026-07-21T12:00:00Z", "one_off", false),
  c("d", "2026-09-10T12:00:00Z", "hybrid"),
  c("e", "2026-11-02T12:00:00Z"), c("f", "2026-11-10T12:00:00Z", "hybrid"),
];
const recebimentos: Recebimento[] = [
  { data: "2026-07-15", valor: 1000, clienteId: "a" },
  { data: "2026-08-05", valor: 2500, clienteId: "a" },
  { data: "2026-09-12", valor: 900, clienteId: "d" },
  { data: "2026-10-05", valor: 1200, clienteId: "a" },
  { data: "2026-11-09", valor: 1500.5, clienteId: "e" },
];

describe("datas no fuso de São Paulo", () => {
  it("23h de sábado em São Paulo ainda é sábado, mesmo sendo domingo em UTC", () => {
    expect(diaEmSaoPaulo("2026-11-01T01:30:00Z")).toEqual({ a: 2026, m: 10, d: 31 });
    expect(diaEmSaoPaulo("2026-11-09")).toEqual({ a: 2026, m: 11, d: 9 });
  });
  it("a semana começa na segunda (domingo pertence à semana que termina nele)", () => {
    expect(segundaDaSemana({ a: 2026, m: 11, d: 12 })).toEqual({ a: 2026, m: 11, d: 9 });
    expect(segundaDaSemana({ a: 2026, m: 11, d: 15 })).toEqual({ a: 2026, m: 11, d: 9 });
    expect(segundaDaSemana({ a: 2026, m: 11, d: 1 })).toEqual({ a: 2026, m: 10, d: 26 });
  });
});

describe("série por mês e por semana", () => {
  it("histórico inteiro por mês, sem buraco: mês sem cliente aparece com zero", () => {
    const s = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo: "todos", hoje: HOJE });
    expect(s.map((b) => b.chave)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(s.map((b) => b.entraram)).toEqual([3, 0, 1, 0, 2]);
    expect(s.map((b) => b.recebido)).toEqual([1000, 2500, 900, 1200, 1500.5]);
    expect(s[0].rotulo).toBe("jul/26");
    expect(s[0].nomes).toEqual(["Cliente a", "Cliente b", "Cliente c"]);
  });
  it("o período corta o começo e vai até hoje", () => {
    const s = serieDoCrescimento(clientes, recebimentos, { periodo: "3m", grao: "mes", tipo: "todos", hoje: HOJE });
    expect(s.map((b) => b.chave)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
  it("o filtro de tipo vale para as entradas e para o dinheiro", () => {
    // "Com avulso" pega o avulso puro e o híbrido (o mesmo cliente pode ter os dois).
    const s = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo: "avulso", hoje: HOJE });
    expect(s.reduce((n, b) => n + b.entraram, 0)).toBe(3);
    expect(s.reduce((n, b) => n + b.recebido, 0)).toBe(900);
    const m = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo: "mensal", hoje: HOJE });
    expect(m.reduce((n, b) => n + b.entraram, 0)).toBe(5);
  });
  it("por semana, cada barra é a segunda-feira da semana", () => {
    const s = serieDoCrescimento(clientes, recebimentos, { periodo: "3m", grao: "semana", tipo: "todos", hoje: HOJE });
    const semanaDeHoje = s[s.length - 1];
    expect(semanaDeHoje.chave).toBe("2026-11-09");
    expect(semanaDeHoje.rotulo).toBe("09/11");
    expect(semanaDeHoje.entraram).toBe(1);
    expect(s.find((b) => b.chave === "2026-11-02")?.entraram).toBe(1);
  });
  it("sem cliente e sem recebimento não inventa série", () => {
    expect(serieDoCrescimento([], [], { periodo: "tudo", grao: "mes", tipo: "todos", hoje: HOJE })).toEqual([]);
  });
});

describe("resumo e destaques", () => {
  const r = resumoDoCrescimento(clientes, recebimentos, "todos", HOJE);
  it("conta ativos, o mês, a semana e compara com o mês passado", () => {
    expect(r.total).toBe(6);
    expect(r.ativos).toBe(5);
    expect(r.entraramNoMes).toBe(2);
    expect(r.entraramNoMesPassado).toBe(0);
    expect(r.entraramNaSemana).toBe(1);
    expect(r.recebidoNoMes).toBe(1500.5);
    expect(r.recebidoNoMesPassado).toBe(1200);
  });
  it("aponta o mês com mais entradas, o com menos (só mês fechado) e o de maior faturamento", () => {
    expect(r.mesComMaisEntradas?.chave).toBe("2026-07");
    expect(r.mesComMenosEntradas?.chave).toBe("2026-08");
    expect(r.mesComMaiorRecebido?.chave).toBe("2026-08");
    expect(r.mediaPorMes).toBe(1);
  });
});

// Segunda rodada (12/11, dono): data e serviços de quem entrou, média mensal, melhor dia, mensalidade
// separada de avulso com o valor, e quem saiu com churn.
describe("quem entrou: data, serviços, valor e melhor dia", () => {
  const lista: ClienteDaCarteira[] = [
    { ...c("a", "2026-07-07T15:00:00Z"), mensal: 697, servicos: ["Social", "Tráfego"] }, // terça
    { ...c("b", "2026-09-08T15:00:00Z", "hybrid"), mensal: 550, avulso: 600, servicos: ["Social", "Site"] }, // terça
    { ...c("d", "2026-10-02T15:00:00Z", "one_off"), avulso: 3200, servicos: ["Site"] }, // sexta
  ];
  it("data no formato do dia a dia e serviços do mais pedido para o menos", () => {
    expect(dataCurta("2026-11-05T15:00:00Z")).toBe("05/11/2026");
    expect(servicosDeQuemEntrou(lista)).toEqual([{ servico: "Site", quantos: 2 }, { servico: "Social", quantos: 2 }, { servico: "Tráfego", quantos: 1 }]);
  });
  it("mensalidade e avulso somam separados, e o híbrido entra nos dois", () => {
    expect(valorDeQuemEntrou(lista)).toEqual({ mensalidades: 2, mensalPorMes: 1247, avulsos: 2, avulsoTotal: 3800 });
  });
  it("aponta o dia da semana em que mais entra cliente", () => {
    const d = entradasPorDiaDaSemana(lista);
    expect(d.melhor).toEqual({ dia: "terça", quantos: 2, parte: 67 });
    expect(d.dias.map((x) => x.dia)).toEqual(["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]);
    expect(entradasPorDiaDaSemana([]).melhor).toBeNull();
  });
  it("a média mensal usa só mês fechado e diz quantos meses contou", () => {
    const r = resumoDoCrescimento(clientes, recebimentos, "todos", HOJE);
    expect(r.mesesNaMedia).toBe(4);
    expect(r.mediaPorMes).toBe(1);
  });
});

describe("saídas e churn", () => {
  const base: ClienteDaCarteira[] = [
    { ...c("m1", "2026-06-10T15:00:00Z"), mensal: 697 },
    { ...c("m2", "2026-07-10T15:00:00Z"), mensal: 500 },
    { ...c("m3", "2026-07-20T15:00:00Z", "hybrid"), mensal: 797, avulso: 500 },
    { ...c("m4", "2026-08-11T15:00:00Z", "recurring", false), mensal: 697, saiuEm: "2026-09-11" },
    { ...c("m5", "2026-08-20T15:00:00Z", "recurring", false), mensal: 303, saiuEm: "2026-10-20" },
    { ...c("av", "2026-03-04T15:00:00Z", "one_off", false), avulso: 3200, saiuEm: "2026-04-06" },
    { ...c("pausado", "2026-09-01T15:00:00Z", "recurring", false), mensal: 400, saiuEm: null },
  ];
  const r = resumoDasSaidas(base, HOJE);
  it("só mensalista com plano inativo conta como saída; avulso concluído fica à parte", () => {
    expect(r.quemSaiu.map((x) => x.id)).toEqual(["m5", "m4"]);
    expect(r.avulsosConcluidos.map((x) => x.id)).toEqual(["av"]);
    expect(r.mensalistasQueJaPassaram).toBe(6);
    expect(r.mensalidadePerdida).toBe(1000);
  });
  it("o churn do mês é quem saiu sobre a base do começo do mês", () => {
    const setembro = r.meses.find((m) => m.chave === "2026-09")!;
    expect(setembro.base).toBe(5);
    expect(setembro.sairam).toBe(1);
    expect(setembro.churn).toBe(20);
    const outubro = r.meses.find((m) => m.chave === "2026-10")!;
    expect(outubro.base).toBe(5);
    expect(outubro.churn).toBe(20);
    expect(r.meses.find((m) => m.chave === "2026-11")!.base).toBe(4);
  });
  it("as médias usam só mês fechado e a permanência vem de quem saiu", () => {
    // Fechados: jun, jul, ago, set, out. Duas saídas em cinco meses.
    expect(r.mediaDeSaidasPorMes).toBe(0.4);
    // Com base: jul (1), ago (3), set (5), out (5). Churn 0, 0, 20, 20.
    expect(r.churnMedio).toBe(10);
    expect(r.permanenciaMedia).toBe(1.5);
  });
  it("sem mensalista não inventa número", () => {
    const vazio = resumoDasSaidas([], HOJE);
    expect(vazio.meses).toEqual([]);
    expect(vazio.churnMedio).toBe(0);
  });
});
