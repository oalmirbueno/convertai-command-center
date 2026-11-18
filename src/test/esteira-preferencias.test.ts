import { describe, expect, it } from "vitest";
import {
  AVISOS_PADRAO, CHAVE_DOS_AVISOS, CHAVE_DO_PERIODO, PERIODO_PADRAO, contadorDoPrecisaDeVoce, gravarAvisos, gravarPeriodo,
  lerAvisos, lerAvisosGuardados, lerPeriodo, lerPeriodoGuardado, serializarAvisos, serializarPeriodo,
} from "@/lib/esteiraLinha/preferenciasDaEsteira";

/*
 * Preferências da Esteira lembradas no aparelho (pedido do Almir, 14/11/2026,
 * 21h53): o período (1 ou 2 semanas) e a caixa "Precisa de você" aberta ou
 * recolhida. O padrão é uma semana e caixa recolhida.
 */

const memoria = () => {
  const dados = new Map<string, string>();
  return { dados, getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v) };
};
const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("cheio"); } };

describe("período guardado", () => {
  it("lê 7 ou 14; o resto vira uma semana", () => {
    expect(lerPeriodo(null)).toEqual(PERIODO_PADRAO);
    expect(lerPeriodo(JSON.stringify({ v: 1, dias: 14 }))).toEqual({ v: 1, dias: 14 });
    expect(lerPeriodo(JSON.stringify({ v: 1, dias: 7 }))).toEqual({ v: 1, dias: 7 });
    for (const bruto of ["{quebrado", "[]", "14", JSON.stringify({ v: 2, dias: 14 }), JSON.stringify({ v: 1, dias: 30 }), JSON.stringify({ v: 1, dias: "14" }), JSON.stringify({ v: 1 })]) {
      expect(lerPeriodo(bruto), bruto).toEqual(PERIODO_PADRAO);
    }
  });

  it("grava versionado na chave da Esteira e volta igual", () => {
    const m = memoria();
    gravarPeriodo(m, 14);
    expect(CHAVE_DO_PERIODO).toBe("aceleriq:esteira:periodo");
    expect(m.dados.get(CHAVE_DO_PERIODO)).toBe('{"v":1,"dias":14}');
    expect(lerPeriodoGuardado(m)).toEqual({ v: 1, dias: 14 });
    expect(serializarPeriodo(7)).toBe('{"v":1,"dias":7}');
    expect(serializarPeriodo(99 as never)).toBe('{"v":1,"dias":7}');
  });

  it("localStorage bloqueado ou ausente não quebra a tela", () => {
    expect(lerPeriodoGuardado(quebrado)).toEqual(PERIODO_PADRAO);
    expect(lerPeriodoGuardado(null)).toEqual(PERIODO_PADRAO);
    expect(() => gravarPeriodo(quebrado, 14)).not.toThrow();
    expect(() => gravarPeriodo(undefined, 14)).not.toThrow();
  });
});

describe("avisos do topo", () => {
  it("o padrão é recolhida; só true exato abre", () => {
    expect(AVISOS_PADRAO).toEqual({ v: 1, precisaDeVoce: false });
    expect(lerAvisos(null)).toEqual(AVISOS_PADRAO);
    expect(lerAvisos(JSON.stringify({ v: 1, precisaDeVoce: true }))).toEqual({ v: 1, precisaDeVoce: true });
    for (const bruto of ["{quebrado", "true", JSON.stringify({ v: 1, precisaDeVoce: "true" }), JSON.stringify({ v: 1, precisaDeVoce: 1 }), JSON.stringify({ v: 2, precisaDeVoce: true })]) {
      expect(lerAvisos(bruto), bruto).toEqual(AVISOS_PADRAO);
    }
  });

  it("grava versionado na chave da Esteira e volta igual; bloqueado não quebra", () => {
    const m = memoria();
    gravarAvisos(m, { v: 1, precisaDeVoce: true });
    expect(CHAVE_DOS_AVISOS).toBe("aceleriq:esteira:avisos");
    expect(m.dados.get(CHAVE_DOS_AVISOS)).toBe('{"v":1,"precisaDeVoce":true}');
    expect(lerAvisosGuardados(m)).toEqual({ v: 1, precisaDeVoce: true });
    expect(serializarAvisos({ v: 1, precisaDeVoce: false })).toBe('{"v":1,"precisaDeVoce":false}');
    expect(lerAvisosGuardados(quebrado)).toEqual(AVISOS_PADRAO);
    expect(() => gravarAvisos(quebrado, { v: 1, precisaDeVoce: true })).not.toThrow();
  });

  it("o contador da caixa recolhida concorda com o número", () => {
    expect(contadorDoPrecisaDeVoce(1)).toBe("1 item precisa de você");
    expect(contadorDoPrecisaDeVoce(3)).toBe("3 itens precisam de você");
  });
});
