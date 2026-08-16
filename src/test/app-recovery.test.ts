import { beforeEach, describe, expect, it } from "vitest";
import { clearFatalCrashes, recordFatalCrash } from "@/lib/appRefresh";

/**
 * A memória de quedas é o que separa "soluço passageiro" (a tela se recupera
 * sozinha) de "erro que insiste" (tela manual com o detalhe técnico). Ela
 * decide se o painel recarrega por conta própria — errar aqui vira ou um
 * loop de recarga ou uma pessoa presa numa tela morta.
 */
describe("memória de quedas fatais", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("conta a mesma queda em sequência", () => {
    expect(recordFatalCrash("v1:erro-x")).toBe(1);
    expect(recordFatalCrash("v1:erro-x")).toBe(2);
    expect(recordFatalCrash("v1:erro-x")).toBe(3);
  });

  it("um erro diferente recomeça a contagem", () => {
    recordFatalCrash("v1:erro-x");
    recordFatalCrash("v1:erro-x");
    // Outro erro (ou outra versão publicada) não herda as tentativas gastas.
    expect(recordFatalCrash("v2:erro-y")).toBe(1);
  });

  it("sessão saudável zera a memória", () => {
    recordFatalCrash("v1:erro-x");
    recordFatalCrash("v1:erro-x");
    clearFatalCrashes();
    expect(recordFatalCrash("v1:erro-x")).toBe(1);
  });

  it("até duas quedas permitem recuperação automática; a terceira não", () => {
    // O contrato usado pela tela de erro: <= 2 recarrega sozinho.
    expect(recordFatalCrash("v1:erro-x") <= 2).toBe(true);
    expect(recordFatalCrash("v1:erro-x") <= 2).toBe(true);
    expect(recordFatalCrash("v1:erro-x") <= 2).toBe(false);
  });
});
