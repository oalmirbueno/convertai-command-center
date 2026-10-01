/**
 * Frente SUP: o lançador estável.
 * - a versão em prova que cai logo ao subir volta para a anterior (e fica recusada);
 * - saída 75 sobe a versão que o supervisor gravou em atual.json;
 * - saída 0 para o lançador.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { entradaDaVersao, rodarLancador } from "../lancador.mjs";
import { caminhos, gravarJson, lerAtual } from "../config.ts";
import { pastaTemp } from "./apoio.ts";

function versaoFalsa(raiz: string, versao: string, codigo: string): void {
  const dir = path.join(raiz, "versoes", versao, "workers", "supervisor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "principal.ts"), codigo);
  writeFileSync(path.join(raiz, "package.json"), JSON.stringify({ type: "module" }));
}

const marcar = (nome: string) => `(await import("node:fs")).appendFileSync((await import("node:path")).join(process.env.ACELERIQ_MOTORES_PASTA, "rodou.log"), "${nome}\\n");`;

describe("lançador", () => {
  it("a versão em prova que cai ao subir volta para a anterior", async () => {
    const raiz = pastaTemp();
    versaoFalsa(raiz, "aaaaaaaaaa", `${marcar("a")} process.exit(0);`);
    versaoFalsa(raiz, "bbbbbbbbbb", `${marcar("b")} console.error("quebrei"); process.exit(1);`);
    gravarJson(caminhos(raiz).atual, { versao: "bbbbbbbbbb", anterior: "aaaaaaaaaa", em_teste: true, desde: new Date().toISOString(), recusadas: [] });
    const linhas: string[] = [];
    const codigo = await rodarLancador({ raiz, registrar: (t: string) => linhas.push(t) });
    assert.equal(codigo, 0);
    assert.deepEqual(readFileSync(path.join(raiz, "rodou.log"), "utf8").trim().split("\n"), ["b", "a"]);
    const a = lerAtual(caminhos(raiz));
    assert.equal(a.versao, "aaaaaaaaaa");
    assert.deepEqual(a.recusadas, ["bbbbbbbbbb"]);
    assert.ok(linhas.some((l) => /voltei para a aaaaaaaaaa/.test(l)));
    assert.ok(linhas.some((l) => /quebrei/.test(l)), "a saída de erro do supervisor vai para o registro do lançador");
  });

  it("saída 75 sobe a versão nova de atual.json", async () => {
    const raiz = pastaTemp();
    const gravar = `(await import("node:fs")).writeFileSync((await import("node:path")).join(process.env.ACELERIQ_MOTORES_PASTA, "atual.json"), JSON.stringify({ versao: "cccccccccc", anterior: "aaaaaaaaaa", em_teste: true, recusadas: [] }));`;
    versaoFalsa(raiz, "aaaaaaaaaa", `${marcar("a")} ${gravar} process.exit(75);`);
    versaoFalsa(raiz, "cccccccccc", `${marcar("c")} process.exit(0);`);
    gravarJson(caminhos(raiz).atual, { versao: "aaaaaaaaaa", anterior: null, em_teste: false, desde: null, recusadas: [] });
    const codigo = await rodarLancador({ raiz, registrar: () => {} });
    assert.equal(codigo, 0);
    assert.deepEqual(readFileSync(path.join(raiz, "rodou.log"), "utf8").trim().split("\n"), ["a", "c"]);
    assert.equal(lerAtual(caminhos(raiz)).versao, "cccccccccc");
  });

  it("sem versão instalada não sobe nada e diz o que fazer", async () => {
    const raiz = pastaTemp();
    const linhas: string[] = [];
    assert.equal(await rodarLancador({ raiz, registrar: (t: string) => linhas.push(t) }), 1);
    assert.match(linhas.join("\n"), /rode o instalador/);
    assert.equal(entradaDaVersao(raiz, "../fora"), null, "versão com caminho estranho é recusada");
    assert.ok(!existsSync(path.join(raiz, "rodou.log")));
  });
});
