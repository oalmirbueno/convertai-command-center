import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const hook = ler("src/hooks/useClientGroupMessage.ts");
const folha = ler("src/components/ciclo/ClientCycleSheet.tsx");
const central = ler("src/pages/AdminExperience.tsx");

/**
 * A mensagem semanal do Ciclo saía sempre igual por mais que a rotina do GPT
 * reescrevesse o dossiê. Duas causas, e a primeira foi erro meu de conserto
 * pela metade: a leitura do contexto vivia DUPLICADA na Central e aqui, e a
 * correção só chegou na Central. O Ciclo continuou lendo o TÍTULO do
 * registro — que é um rótulo com data, igual em toda versão.
 */

describe("a leitura do contexto é uma só", () => {
  it("o Ciclo usa a mesma função da Central", () => {
    expect(hook).toContain("trechoDoContexto(contexto)");
    expect(central).toContain("trechoDoContexto(contextoEntrada)");
  });

  it("ninguém mais lê o título antes do corpo", () => {
    // Era isto que fazia a mensagem repetir: o título do dossiê é constante.
    expect(hook).not.toContain("contexto.title || contexto.content");
    expect(central).not.toContain("contextoEntrada.title || contextoEntrada.content");
  });

  it("a lista de tipos de contexto não está mais duplicada", () => {
    // Regra repetida em dois lugares é regra que diverge no primeiro conserto.
    expect(hook).toContain("CONTEXTO_KINDS");
    expect(hook).not.toMatch(/const CONTEXTO = new Set\(/);
  });
});

describe("o que o MCP grava por fora tem como ser relido", () => {
  it("o hook expõe recarregar", () => {
    // O GPT grava o dossiê sem passar pelo app: nenhuma mutação acontece,
    // então nada invalida o cache sozinho.
    expect(hook).toContain("const recarregar = async ()");
    expect(hook).toContain("invalidateQueries({ queryKey: chave })");
    expect(hook).toContain("recarregar, recarregando: isFetching");
  });

  it("recarregar força a leitura, não só marca como velho", () => {
    // invalidateQueries sozinho não busca de novo se a consulta não estiver
    // ativa; sem o refetch o botão diria "atualizado" sem ter atualizado.
    const trecho = hook.slice(hook.indexOf("const recarregar"));
    expect(trecho).toContain("await refetch()");
  });

  it("a folha do Ciclo tem o botão ao lado da mensagem", () => {
    expect(folha).toContain("recarregarMensagem");
    expect(folha).toContain("Reler o contexto do cliente");
  });
});
