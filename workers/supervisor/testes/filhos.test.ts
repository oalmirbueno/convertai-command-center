/**
 * Frente SUP: o filho (worker) sob o supervisor, com processos de verdade.
 * - reinício com espera crescente;
 * - parada limpa que espera o trabalho em curso terminar (nunca mata ocupado);
 * - ocioso que ignora o "parar" é encerrado no prazo;
 * - sobe sem janela (windowsHide, sem stdio herdado, canal IPC).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { esperaDoReinicio, Filho, opcoesDeSubida } from "../filhos.ts";
import { criarWorkerFalso, dormir, esperarAte, eventos, pastaTemp, registroEmMemoria } from "./apoio.ts";

function filho(dir: string, extra: Partial<ConstructorParameters<typeof Filho>[0]> = {}) {
  const registro = registroEmMemoria();
  const f = new Filho({ id: "render", pasta: () => dir, args: ["principal.ts"], ambiente: () => ({ ...process.env }), registro, ...extra });
  return { f, registro };
}

describe("espera do reinício", () => {
  it("cresce em dobro até o teto", () => {
    const e = { base: 2_000, teto: 300_000 };
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => esperaDoReinicio(n, e)), [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000]);
    assert.equal(esperaDoReinicio(500, e), 300_000);
  });
});

describe("filho do supervisor", () => {
  it("sobe sem janela: windowsHide, saída por cano e canal IPC", () => {
    const o = opcoesDeSubida("C:\\x", { PATH: "p" });
    assert.equal(o.windowsHide, true);
    assert.deepEqual(o.stdio, ["ignore", "pipe", "pipe", "ipc"]);
    assert.equal((o.env as Record<string, string>).ACELERIQ_SUPERVISOR, "1");
  });

  it("caiu: sobe de novo com espera crescente e guarda o último erro", async () => {
    const raiz = pastaTemp();
    const dir = criarWorkerFalso(raiz, "render", "principal.ts", { modo: "cai" });
    const { f } = filho(dir, { espera: { base: 150, teto: 2_000, estavel: 60_000 } });
    f.ligar();
    await esperarAte(() => eventos(dir).length >= 4, 15_000);
    await f.desligar();
    // A espera marcada dobra a cada queda (150, 300, 600 ms)...
    assert.deepEqual(f.esperas.slice(0, 3), [150, 300, 600]);
    // ...e o worker de verdade subiu de novo a cada queda (o relógio de cada subida varia com a carga da máquina).
    assert.ok(eventos(dir).filter((e) => e.texto.startsWith("subiu")).length >= 4);
    assert.ok(f.reinicios >= 3);
    assert.match(String(f.ultimoErro), /caí ao subir/);
    assert.equal(f.situacao, "desligado");
  });

  it("parada limpa espera o trabalho em curso (não mata ocupado)", async () => {
    const raiz = pastaTemp();
    const dir = criarWorkerFalso(raiz, "motor-codigo", "worker.ts", { modo: "normal", trabalho_ms: 1_500 });
    const { f } = filho(dir, { args: ["worker.ts"], prazoOcioso: 200 });
    f.ligar();
    await esperarAte(() => f.ocupado, 10_000);
    const t0 = Date.now();
    await f.desligar();
    const ev = eventos(dir).map((e) => e.texto);
    assert.ok(Date.now() - t0 >= 900, "devia esperar o trabalho");
    assert.deepEqual(ev.slice(-4), ["pegou trabalho", "pediram parar (ocupado)", "terminou trabalho", "saiu limpo"]);
    assert.equal(f.situacao, "desligado");
  });

  it("ocioso que ignora o parar é encerrado no prazo", async () => {
    const raiz = pastaTemp();
    const dir = criarWorkerFalso(raiz, "computador", "principal.ts", { modo: "surdo" });
    const { f, registro } = filho(dir, { prazoOcioso: 400 });
    f.ligar();
    await esperarAte(() => f.comCanal, 10_000);
    const t0 = Date.now();
    await f.desligar();
    assert.ok(Date.now() - t0 < 8_000);
    assert.ok(registro.linhas.some((l) => /encerrando render/.test(l)));
    assert.ok(!eventos(dir).some((e) => e.texto === "saiu limpo"));
  });

  it("reiniciar desliga com calma e liga de novo", async () => {
    const raiz = pastaTemp();
    const dir = criarWorkerFalso(raiz, "render", "principal.ts", { modo: "normal" });
    const { f } = filho(dir);
    f.ligar();
    await esperarAte(() => f.comCanal, 10_000);
    await f.reiniciar();
    await esperarAte(() => f.comCanal && eventos(dir).filter((e) => e.texto.startsWith("subiu")).length === 2, 10_000);
    await f.desligar();
    const textos = eventos(dir).map((e) => e.texto);
    assert.equal(textos.filter((t) => t === "saiu limpo").length, 2);
    await dormir(50);
    assert.equal(path.basename(dir), "render");
  });
});
