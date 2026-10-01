/**
 * Frente SUP: o cofre DPAPI do Windows (só roda no Windows).
 * - grava e lê de volta;
 * - o arquivo não tem a chave em texto, nem em base64, nem em hex;
 * - arquivo estragado falha com mensagem, sem o valor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cofreDoWindows } from "../segredos.ts";
import { pastaTemp } from "./apoio.ts";

const noWindows = process.platform === "win32";
const CHAVE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.segredo-de-teste-do-dpapi";

describe("cofre DPAPI", { skip: !noWindows && "só no Windows" }, () => {
  it("grava, lê de volta e o arquivo não mostra a chave", async () => {
    const arq = path.join(pastaTemp(), "cofre.dat");
    const c = cofreDoWindows(arq);
    assert.equal(c.existe(), false);
    await c.gravar({ SUPABASE_SERVICE_ROLE_KEY: CHAVE, OPENROUTER_API_KEY: "sk-or-teste-1234567890abcdef", "nome ruim": "x", VAZIA: "  " });
    assert.equal(c.existe(), true);
    const lido = await c.ler();
    assert.deepEqual(lido, { SUPABASE_SERVICE_ROLE_KEY: CHAVE, OPENROUTER_API_KEY: "sk-or-teste-1234567890abcdef" });
    const bytes = readFileSync(arq);
    for (const forma of [CHAVE, Buffer.from(CHAVE).toString("base64"), Buffer.from(CHAVE).toString("hex"), "SUPABASE_SERVICE_ROLE_KEY"]) {
      assert.equal(bytes.indexOf(Buffer.from(forma)), -1, `o arquivo contém ${forma.slice(0, 12)}…`);
      assert.equal(bytes.indexOf(Buffer.from(forma, "utf16le")), -1);
    }
    await c.apagar();
    assert.equal(c.existe(), false);
    assert.deepEqual(await c.ler(), {});
  });

  it("arquivo estragado falha sem mostrar nada", async () => {
    const arq = path.join(pastaTemp(), "cofre.dat");
    writeFileSync(arq, Buffer.from("isto não é um blob do DPAPI"));
    await assert.rejects(cofreDoWindows(arq).ler(), (e: Error) => /cofre do Windows recusou/.test(e.message) && e.message.indexOf(CHAVE) < 0);
  });
});
