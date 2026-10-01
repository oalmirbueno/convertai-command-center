/**
 * Frente SUP: atualização sozinha.
 * - só troca com TODOS os motores ociosos (o render ocupado termina antes);
 * - pacote que não confere com o sha256 não entra;
 * - versão nova que derruba um motor na prova volta para a anterior e fica recusada;
 * - versão que se firma limpa as antigas sem apagar as dependências em uso.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { VersaoPublicada } from "../banco.ts";
import { CODIGO_DE_TROCA } from "../atualizar.ts";
import { caminhos, gravarJson, lerAtual } from "../config.ts";
import { comandoDoTar, ligarPasta, sha256 } from "../pacote.ts";
import { bancoFalso, montar } from "./montagem.ts";
import { criarWorkerFalso, esperarAte, eventos, pastaTemp } from "./apoio.ts";

const A = "aaaaaaaaaa";
const B = "bbbbbbbbbb";

/** Zip de uma versão falsa (workers/supervisor/principal.ts e o package.json de cada motor). */
function zipDeVersao(): Uint8Array {
  const dir = pastaTemp("aceleriq-pacote-");
  for (const w of ["supervisor", "render", "motor-codigo", "computador"]) {
    mkdirSync(path.join(dir, "workers", w), { recursive: true });
    writeFileSync(path.join(dir, "workers", w, "package.json"), JSON.stringify({ name: `falso-${w}`, private: true }));
  }
  writeFileSync(path.join(dir, "workers", "supervisor", "principal.ts"), "process.exit(0);\n");
  const zip = path.join(dir, "pacote.zip");
  const r = spawnSync(comandoDoTar(), ["-a", "-cf", zip, "-C", dir, "workers"], { windowsHide: true, encoding: "utf8" });
  assert.equal(r.status, 0, `tar não criou o zip: ${r.stderr}`);
  return new Uint8Array(readFileSync(zip));
}

describe("atualização sozinha", () => {
  it("baixa, confere, prepara e só troca quando o render ocupado termina", async () => {
    const raiz = pastaTemp();
    const c = caminhos(raiz);
    const zip = zipDeVersao();
    const alvo: VersaoPublicada = { versao: B, sha256: sha256(zip), caminho: `${B}/aceleriq-motores-${B}.zip`, tamanho: zip.length };
    let publicada = false;
    const banco = bancoFalso(() => ({ versao_alvo: publicada ? alvo : null }));
    banco.baixar = async () => zip;
    gravarJson(c.atual, { versao: A, anterior: null, em_teste: false, desde: null, recusadas: [] });
    const t = montar({ raiz, versao: A, raizDoCodigo: path.join(c.versoes, A), banco, motores: ["render", "codigo"], comportamento: { render: { modo: "normal", trabalho_ms: 2_500 } } });
    // A versão atual já tem node_modules (como depois do instalador).
    for (const w of ["render", "motor-codigo", "computador"]) mkdirSync(path.join(c.versoes, A, "workers", w, "node_modules"), { recursive: true });
    await t.s.iniciar();
    await esperarAte(() => t.s.filhos.get("render")!.ocupado, 10_000);
    publicada = true;
    await esperarAte(() => t.s.atualizador.etapa === "pronta", 15_000);
    assert.ok(t.s.filhos.get("render")!.ocupado, "o render ainda está no trabalho");
    assert.deepEqual(t.saidas, [], "não troca com motor ocupado");
    await esperarAte(() => t.saidas.length === 1, 20_000);
    assert.deepEqual(t.saidas, [CODIGO_DE_TROCA]);
    const ev = eventos(t.dirs.render).map((e) => e.texto);
    assert.ok(ev.indexOf("terminou trabalho") >= 0 && ev.indexOf("terminou trabalho") < ev.indexOf("saiu limpo"), "o trabalho terminou antes da troca");
    const a = lerAtual(c);
    assert.equal(a.versao, B);
    assert.equal(a.anterior, A);
    assert.equal(a.em_teste, true);
    assert.ok(existsSync(path.join(c.versoes, B, "workers", "supervisor", "principal.ts")));
    assert.ok(existsSync(path.join(c.versoes, B, "workers", "render", "node_modules")), "dependências ligadas na versão nova");
  });

  it("pacote que não confere não entra", async () => {
    const raiz = pastaTemp();
    const c = caminhos(raiz);
    const zip = zipDeVersao();
    const alvo: VersaoPublicada = { versao: B, sha256: "0".repeat(64), caminho: `${B}/x.zip`, tamanho: zip.length };
    const banco = bancoFalso(() => ({ versao_alvo: alvo }));
    banco.baixar = async () => zip;
    const t = montar({ raiz, versao: A, raizDoCodigo: path.join(c.versoes, A), banco, motores: ["render"] });
    mkdirSync(path.join(c.versoes, A, "workers", "render", "node_modules"), { recursive: true });
    await t.s.iniciar();
    await esperarAte(() => t.s.atualizador.etapa === "falhou", 15_000);
    assert.match(String(t.s.atualizador.erro), /não confere/);
    assert.ok(!existsSync(path.join(c.versoes, B)));
    assert.deepEqual(t.saidas, []);
    await t.s.encerrar(0);
  });

  it("versão nova que derruba um motor na prova volta para a anterior e fica recusada", async () => {
    const raiz = pastaTemp();
    const c = caminhos(raiz);
    // A anterior está instalada.
    criarWorkerFalso(path.join(c.versoes, A), "supervisor", "principal.ts", { modo: "normal" });
    gravarJson(c.atual, { versao: B, anterior: A, em_teste: true, desde: new Date().toISOString(), recusadas: [] });
    const t = montar({ raiz, versao: B, raizDoCodigo: path.join(c.versoes, B), motores: ["render"], comportamento: { render: { modo: "cai" } }, extra: { espera: { base: 50, teto: 200, estavel: 60_000 }, janelaDaProva: 30_000 } });
    mkdirSync(path.join(c.versoes, B, "workers", "render", "node_modules"), { recursive: true });
    await t.s.iniciar();
    await esperarAte(() => t.saidas.length === 1, 15_000);
    assert.deepEqual(t.saidas, [CODIGO_DE_TROCA]);
    const a = lerAtual(c);
    assert.equal(a.versao, A);
    assert.equal(a.em_teste, false);
    assert.deepEqual(a.recusadas, [B]);
    assert.equal(t.s.atualizador.quer({ versao: B, sha256: "1".repeat(64), caminho: "x", tamanho: 1 }, A), false, "a recusada não volta");
  });

  it("versão que se firma limpa as antigas e mantém as dependências em uso", async () => {
    const raiz = pastaTemp();
    const c = caminhos(raiz);
    const C = "cccccccccc";
    for (const v of [A, C]) criarWorkerFalso(path.join(c.versoes, v), "supervisor", "principal.ts", { modo: "normal" });
    gravarJson(c.atual, { versao: B, anterior: A, em_teste: true, desde: new Date().toISOString(), recusadas: [] });
    // Dependências: B usa render-111; C usava render-999 (sai junto com C).
    for (const d of ["render-111111111111", "render-999999999999"]) mkdirSync(path.join(c.deps, d, "node_modules"), { recursive: true });
    const t = montar({ raiz, versao: B, raizDoCodigo: path.join(c.versoes, B), motores: ["render"], extra: { janelaDaProva: 600 } });
    ligarPasta(path.join(c.deps, "render-111111111111", "node_modules"), path.join(c.versoes, B, "workers", "render", "node_modules"));
    mkdirSync(path.join(c.versoes, C, "workers", "render"), { recursive: true });
    ligarPasta(path.join(c.deps, "render-999999999999", "node_modules"), path.join(c.versoes, C, "workers", "render", "node_modules"));
    writeFileSync(path.join(c.deps, "render-111111111111", "node_modules", "marca.txt"), "em uso");
    await t.s.iniciar();
    await esperarAte(() => lerAtual(c).em_teste === false, 15_000);
    await esperarAte(() => !existsSync(path.join(c.versoes, C)), 5_000);
    assert.ok(existsSync(path.join(c.versoes, A)), "a anterior fica (volta manual)");
    assert.ok(existsSync(path.join(c.deps, "render-111111111111", "node_modules", "marca.txt")), "as dependências em uso ficam intactas");
    assert.ok(!existsSync(path.join(c.deps, "render-999999999999")), "as dependências sem uso saem");
    await t.s.encerrar(0);
  });
});
