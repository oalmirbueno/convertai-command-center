import { describe, expect, it } from "vitest";
import {
  CHAVE_DO_FILTRO_DE_CLIENTES, CORES_DE_APOIO_DO_CLIENTE, FILTRO_TODOS, ajustarFiltroACarteira, alternarCliente,
  aplicarFiltroDeClientes, buscarClientesPeloNome, corDeApoioDoCliente, diaDaSemanaEmSP, escolherModo, gravarFiltro,
  lerFiltroDeClientes, lerFiltroGuardado, prioritariosDeHoje,
} from "@/lib/esteiraLinha/filtroDeClientes";
import { ESTILO_DA_ETAPA } from "@/components/esteira-linha/estilosDaEtapa";

/** Organização da Esteira (14/11/2026, 21h08): o filtro de clientes, sem tela. O "+N" saiu em 21h55 (cada dia rola por dentro). */

// Já na ordem da grade (nome pt-BR).
const FAIXAS = [
  { clientId: "a", nome: "Ágil Serviços", diaPrioritario: 1 },
  { clientId: "b", nome: "Beta Loja", diaPrioritario: 4 },
  { clientId: "c", nome: "Casa Nova", diaPrioritario: null },
  { clientId: "d", nome: "Delta", diaPrioritario: 4 },
];
const ids = (fs: Array<{ clientId: string }>) => fs.map((f) => f.clientId);

describe("filtro de clientes: modos e seleção", () => {
  it("Todos mostra a carteira inteira, na mesma ordem", () => {
    expect(ids(aplicarFiltroDeClientes(FAIXAS, FILTRO_TODOS, 3))).toEqual(["a", "b", "c", "d"]);
  });

  it("Só prioritários hoje inclui quem tem o dia de hoje e exclui os outros, sem reordenar", () => {
    expect(ids(aplicarFiltroDeClientes(FAIXAS, escolherModo("prioritarios_hoje"), 4))).toEqual(["b", "d"]);
    expect(ids(aplicarFiltroDeClientes(FAIXAS, escolherModo("prioritarios_hoje"), 1))).toEqual(["a"]);
  });

  it("no sábado e no domingo ninguém tem dia prioritário", () => {
    expect(prioritariosDeHoje(FAIXAS, 6)).toEqual([]);
    expect(prioritariosDeHoje(FAIXAS, 7)).toEqual([]);
    // 22/11/2026 é domingo e 21/11 é sábado em São Paulo.
    expect(diaDaSemanaEmSP(new Date("2026-11-22T15:00:00Z"))).toBe(7);
    expect(diaDaSemanaEmSP(new Date("2026-11-21T15:00:00Z"))).toBe(6);
    // 02:00 UTC de quinta ainda é quarta em São Paulo.
    expect(diaDaSemanaEmSP(new Date("2026-11-19T02:00:00Z"))).toBe(3);
  });

  it("multi-seleção: clicar entra, soma, tira; vazia volta para Todos; a ordem é a da grade", () => {
    let f = alternarCliente(FILTRO_TODOS, "d");
    expect(f).toEqual({ v: 1, modo: "clientes", ids: ["d"] });
    f = alternarCliente(f, "a");
    expect(ids(aplicarFiltroDeClientes(FAIXAS, f, 3))).toEqual(["a", "d"]);
    f = alternarCliente(f, "d");
    expect(f.ids).toEqual(["a"]);
    expect(alternarCliente(f, "a")).toEqual(FILTRO_TODOS);
  });

  it("escolher um cliente sai do modo prioritários; voltar para Todos limpa a seleção", () => {
    expect(alternarCliente(escolherModo("prioritarios_hoje"), "c")).toEqual({ v: 1, modo: "clientes", ids: ["c"] });
    expect(escolherModo("todos")).toEqual({ v: 1, modo: "todos", ids: [] });
  });

  it("ids que saíram da carteira são ignorados; se nenhum sobrar, Todos", () => {
    const f = { v: 1 as const, modo: "clientes" as const, ids: ["sumiu", "b"] };
    expect(ajustarFiltroACarteira(f, ["a", "b"])).toEqual({ v: 1, modo: "clientes", ids: ["b"] });
    expect(ajustarFiltroACarteira({ v: 1, modo: "clientes", ids: ["sumiu"] }, ["a"])).toEqual(FILTRO_TODOS);
    const prioritarios = escolherModo("prioritarios_hoje");
    expect(ajustarFiltroACarteira(prioritarios, [])).toBe(prioritarios);
  });

  it("busca pelo nome sem acento nem caixa, mantendo a ordem", () => {
    expect(ids(buscarClientesPeloNome(FAIXAS, "agil"))).toEqual(["a"]);
    expect(ids(buscarClientesPeloNome(FAIXAS, " LOJA "))).toEqual(["b"]);
    expect(ids(buscarClientesPeloNome(FAIXAS, ""))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("filtro de clientes: localStorage", () => {
  const memoria = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("grava versionado na chave da Esteira e lê de volta", () => {
    const s = memoria();
    gravarFiltro(s, { v: 1, modo: "clientes", ids: ["b", "d"] });
    expect(CHAVE_DO_FILTRO_DE_CLIENTES).toBe("aceleriq:esteira:filtro-clientes");
    expect(JSON.parse(s.m.get(CHAVE_DO_FILTRO_DE_CLIENTES)!)).toEqual({ v: 1, modo: "clientes", ids: ["b", "d"] });
    expect(lerFiltroGuardado(s)).toEqual({ v: 1, modo: "clientes", ids: ["b", "d"] });
    gravarFiltro(s, escolherModo("prioritarios_hoje"));
    expect(lerFiltroGuardado(s)).toEqual({ v: 1, modo: "prioritarios_hoje", ids: [] });
  });

  it("JSON corrompido, versão ou modo desconhecido, ids inválidos e storage quebrado caem em Todos", () => {
    for (const bruto of [null, "", "{", "null", "[]", "42", '{"v":2,"modo":"todos","ids":[]}', '{"v":1,"modo":"outro","ids":[]}', '{"v":1,"modo":"clientes","ids":[]}', '{"v":1,"modo":"clientes","ids":"b"}', '{"v":1,"modo":"clientes","ids":[1,null,""]}']) {
      expect(lerFiltroDeClientes(bruto)).toEqual(FILTRO_TODOS);
    }
    expect(lerFiltroDeClientes('{"v":1,"modo":"clientes","ids":["b","b",3]}')).toEqual({ v: 1, modo: "clientes", ids: ["b"] });
    expect(lerFiltroDeClientes('{"v":1,"modo":"todos","ids":["b"]}')).toEqual(FILTRO_TODOS);
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("cheio"); } };
    expect(lerFiltroGuardado(quebrado)).toEqual(FILTRO_TODOS);
    expect(() => gravarFiltro(quebrado, FILTRO_TODOS)).not.toThrow();
    expect(lerFiltroGuardado(null)).toEqual(FILTRO_TODOS);
  });
});

describe("cor de apoio do cliente", () => {
  it("é estável pelo id e não usa as cores das etapas", () => {
    expect(corDeApoioDoCliente("c1")).toBe(corDeApoioDoCliente("c1"));
    const daEtapa = Object.values(ESTILO_DA_ETAPA).map((e) => e.ponto.match(/bg-(\w+)-/)?.[1]);
    for (const c of CORES_DE_APOIO_DO_CLIENTE) expect(daEtapa).not.toContain(c.ponto.match(/bg-(\w+)-/)?.[1]);
  });
});
