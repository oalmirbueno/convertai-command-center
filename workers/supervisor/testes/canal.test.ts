/** Frente SUP: o canal worker-supervisor é inerte sem supervisor e atende o "parar" uma vez só. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { aoPedirParada, avisarSupervisor, comSupervisor, encerrarCanal, esperaQueAcorda } from "../canal.ts";

function processoFalso(env: Record<string, string>, comSend = true) {
  const e = new EventEmitter() as EventEmitter & { env: Record<string, string>; send?: (m: unknown) => boolean; connected?: boolean; disconnect?: () => void; enviados: unknown[] };
  e.env = env;
  e.enviados = [];
  e.connected = true;
  if (comSend) e.send = (m: unknown) => (e.enviados.push(m), true);
  e.disconnect = () => {
    e.connected = false;
  };
  return e;
}

describe("canal do worker", () => {
  it("sem supervisor (janela antiga) nada acontece", () => {
    const p = processoFalso({}, true);
    assert.equal(comSupervisor(p as never), false);
    avisarSupervisor({ tipo: "ocioso" }, p as never);
    assert.deepEqual(p.enviados, []);
    let chamou = false;
    aoPedirParada(() => (chamou = true), p as never);
    p.emit("message", { tipo: "parar" });
    assert.equal(chamou, false);
  });

  it("com supervisor: avisa, atende o parar uma vez e também a queda do canal", () => {
    const p = processoFalso({ ACELERIQ_SUPERVISOR: "1" });
    assert.equal(comSupervisor(p as never), true);
    avisarSupervisor({ tipo: "ocupado", id: "t1" }, p as never);
    let n = 0;
    aoPedirParada(() => n++, p as never);
    p.emit("message", { tipo: "outra" });
    assert.equal(n, 0);
    p.emit("message", { tipo: "parar" });
    p.emit("disconnect");
    p.emit("message", { tipo: "parar" });
    assert.equal(n, 1);
    assert.deepEqual(p.enviados, [{ tipo: "ocupado", id: "t1" }, { tipo: "parando" }]);
    encerrarCanal(p as never);
    assert.equal(p.connected, false);
  });

  it("canal que lança não derruba o worker", () => {
    const p = processoFalso({ ACELERIQ_SUPERVISOR: "1" });
    p.send = () => {
      throw new Error("canal fechado");
    };
    assert.doesNotThrow(() => avisarSupervisor({ tipo: "ocioso" }, p as never));
  });

  it("a espera acorda na hora quando a parada é pedida", async () => {
    const s = esperaQueAcorda();
    const t0 = Date.now();
    setTimeout(() => s.acordar(), 30);
    await s.esperar(5_000);
    assert.ok(Date.now() - t0 < 1_000);
    const t1 = Date.now();
    await s.esperar(5_000);
    assert.ok(Date.now() - t1 < 50, "depois de acordado, não espera mais");
  });
});
