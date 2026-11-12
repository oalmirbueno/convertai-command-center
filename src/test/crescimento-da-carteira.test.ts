import { describe, expect, it } from "vitest";
import { diaEmSaoPaulo, resumoDoCrescimento, segundaDaSemana, serieDoCrescimento, type ClienteDaCarteira, type Recebimento } from "@/lib/crescimentoDaCarteira";

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
    const s = serieDoCrescimento(clientes, recebimentos, { periodo: "tudo", grao: "mes", tipo: "hybrid", hoje: HOJE });
    expect(s.reduce((n, b) => n + b.entraram, 0)).toBe(2);
    expect(s.reduce((n, b) => n + b.recebido, 0)).toBe(900);
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
