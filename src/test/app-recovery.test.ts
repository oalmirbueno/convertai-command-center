import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFatalCrashes, purgarPedacosEnvenenados, recordFatalCrash } from "@/lib/appRefresh";

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

describe("pedaço guardado como HTML (15/10/2026)", () => {
  it("baixa de novo, furando o cache, só o .js que o cache devolve como HTML", async () => {
    const entradas = [
      { name: "https://aceleriq.online/assets/bom-AAAA1111.js" },
      { name: "https://aceleriq.online/assets/ruim-BBBB2222.js" },
      { name: "https://aceleriq.online/assets/estilo-CCCC3333.css" },
    ];
    const getEntries = vi.spyOn(performance, "getEntriesByType").mockReturnValue(entradas as unknown as PerformanceEntryList);
    const chamadas: Array<[string, RequestInit | undefined]> = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push([url, init]);
      const html = url.includes("ruim") && !init;
      return new Response("x", { headers: { "Content-Type": html ? "text/html" : "text/javascript" } });
    }) as unknown as typeof fetch;
    try {
      expect(await purgarPedacosEnvenenados()).toBe(1);
      expect(chamadas.filter(([, i]) => i?.cache === "reload").map(([u]) => u)).toEqual(["https://aceleriq.online/assets/ruim-BBBB2222.js"]);
      expect(chamadas.some(([u]) => u.endsWith(".css"))).toBe(false);
    } finally {
      globalThis.fetch = original;
      getEntries.mockRestore();
    }
  });
});
