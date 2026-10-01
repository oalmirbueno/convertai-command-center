/**
 * Frente SUP (01/10/2026, depois do laço de abas): nenhum teste abre navegador
 * nem pasta de verdade, e o supervisor só abre por clique no menu.
 * - abrirNoSistema com ACELERIQ_SEM_NAVEGADOR=1 não chama nada;
 * - sem a variável, chama UMA vez o programa padrão (aqui, um lançador falso);
 * - nenhum arquivo de teste chama rundll32, explorer, url.dll ou start com URL;
 * - todo Supervisor dos testes recebe um "abrir" falso.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirNoSistema } from "../principal.ts";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, "..", "..", "..");

function lancadorFalso() {
  const chamadas: Array<{ cmd: string; args: string[] }> = [];
  const lancar = ((cmd: string, args: string[]) => {
    chamadas.push({ cmd, args });
    const p = new EventEmitter() as EventEmitter & { unref: () => void };
    p.unref = () => {};
    return p;
  }) as never;
  return { chamadas, lancar };
}

describe("nunca abre navegador sozinho", () => {
  it("ACELERIQ_SEM_NAVEGADOR=1 desliga a abertura", () => {
    const f = lancadorFalso();
    assert.equal(abrirNoSistema("https://aceleriq.online", { ACELERIQ_SEM_NAVEGADOR: "1" }, f.lancar), false);
    assert.deepEqual(f.chamadas, []);
  });

  it("sem a variável, uma chamada só ao programa padrão (falso aqui)", () => {
    const f = lancadorFalso();
    assert.equal(abrirNoSistema("https://aceleriq.online", {}, f.lancar), true);
    assert.equal(f.chamadas.length, 1);
    assert.ok(f.chamadas[0].args.indexOf("https://aceleriq.online") >= 0);
  });

  it("nenhum teste chama rundll32, explorer, url.dll ou start com URL", () => {
    const pastas = [path.join(REPO, "workers", "supervisor", "testes"), path.join(REPO, "workers", "instalador", "testes")];
    const proibido = /rundll32|explorer\.exe|url\.dll|FileProtocolHandler|\bstart\s+["']?https?:|Start-Process\s+["']?https?:/i;
    for (const d of pastas) {
      for (const a of readdirSync(d).filter((x) => /\.(ts|mjs|js|ps1)$/.test(x) && x !== "sem-navegador.test.ts")) {
        assert.ok(!proibido.test(readFileSync(path.join(d, a), "utf8")), `${a} chama programa de abrir`);
      }
    }
    const tela = readFileSync(path.join(REPO, "src", "test", "sup-aceleriq-motores.test.tsx"), "utf8");
    assert.ok(!proibido.test(tela));
  });

  it("todo Supervisor dos testes recebe um abrir falso e o ponta a ponta desliga a abertura", () => {
    const montagem = readFileSync(path.join(AQUI, "montagem.ts"), "utf8");
    assert.match(montagem, /abrir: \(a\) => void abertos\.push\(a\)/);
    const e2e = readFileSync(path.join(REPO, "workers", "instalador", "testes", "ponta-a-ponta.ts"), "utf8");
    assert.match(e2e, /ACELERIQ_SEM_NAVEGADOR: "1"/);
    const janela = readFileSync(path.join(AQUI, "janela.test.ts"), "utf8");
    assert.match(janela, /ACELERIQ_SEM_NAVEGADOR/);
  });

  it("o controle local não tem caminho para abrir nada", () => {
    const principal = readFileSync(path.join(AQUI, "..", "principal.ts"), "utf8");
    assert.match(principal, /abrirControle\(enderecoDoControle\(c\.raiz\), \(cmd\) => s\.comando\(cmd\)\)/);
    const sup = readFileSync(path.join(AQUI, "..", "supervisor.ts"), "utf8");
    const corpoDoComando = sup.slice(sup.indexOf("async comando("), sup.indexOf("/** Para tudo com calma"));
    assert.ok(!/abrir/.test(corpoDoComando), "Supervisor.comando não pode abrir nada");
  });
});
