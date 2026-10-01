/** Frente SUP: rotação dos registros e nenhuma chave no arquivo. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { abrirRegistro, emLinhas, esquecerSegredos, registrarSegredo, semSegredo } from "../registros.ts";
import { pastaTemp } from "./apoio.ts";

describe("registros", () => {
  it("gira pelo tamanho e guarda só os N mais novos", () => {
    const dir = pastaTemp();
    const r = abrirRegistro(dir, "render", { maximo: 2_000, guardados: 3 });
    for (let i = 0; i < 400; i++) r.linha(`linha ${String(i).padStart(4, "0")} ${"x".repeat(40)}`);
    const arquivos = readdirSync(dir).sort();
    assert.deepEqual(arquivos, ["render.1.log", "render.2.log", "render.3.log", "render.log"]);
    for (const a of arquivos) assert.ok(statSync(path.join(dir, a)).size <= 2_000, `${a} passou do teto`);
    // A linha mais nova está no render.log; as mais velhas saíram.
    assert.match(readFileSync(path.join(dir, "render.log"), "utf8"), /linha 0399/);
    const tudo = arquivos.map((a) => readFileSync(path.join(dir, a), "utf8")).join("");
    assert.ok(!/linha 0000 /.test(tudo), "o mais velho deveria ter saído");
  });

  it("nenhuma chave entra: valores conhecidos e formatos comuns", () => {
    const dir = pastaTemp();
    const chave = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura-de-teste-123";
    const outra = "chave-qualquer-do-provedor-123456";
    registrarSegredo(outra);
    const r = abrirRegistro(dir, "supervisor");
    r.linha(`falhou com Authorization: Bearer ${chave}`);
    r.linha(`openrouter ${outra} sk-or-v1-abcdefghijklmnop1234 sb_secret_abcdefghij123`);
    const texto = readFileSync(path.join(dir, "supervisor.log"), "utf8");
    assert.ok(texto.indexOf(chave) < 0);
    assert.ok(texto.indexOf(outra) < 0);
    assert.ok(texto.indexOf("sk-or-v1-abcdefghijklmnop1234") < 0);
    assert.ok(texto.indexOf("sb_secret_abcdefghij123") < 0);
    assert.match(texto, /\[chave\]/);
    esquecerSegredos();
    assert.equal(semSegredo(outra), outra, "esquecido, o valor deixa de ser conhecido");
    assert.ok(existsSync(dir));
  });

  it("junta pedaços de saída em linhas", () => {
    const linhas: string[] = [];
    const l = emLinhas((x) => linhas.push(x));
    l.escrever("um\r\ndo");
    l.escrever("is\ntr");
    l.fechar();
    assert.deepEqual(linhas, ["um", "dois", "tr"]);
  });
});
