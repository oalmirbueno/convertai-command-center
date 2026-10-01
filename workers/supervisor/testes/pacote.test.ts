import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comandoDoTar, montarPacote, PASTAS_DO_PACOTE } from "../pacote.ts";
import { pastaTemp } from "./apoio.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// 01/10: o pacote só com workers/ derrubou os 3 motores na partida (ERR_MODULE_NOT_FOUND),
// porque eles importam por caminho relativo de supabase/functions e de src/.
describe("pacote dos motores", () => {
  it("leva workers, src e supabase/functions, e cada import relativo de fora resolve dentro dele", () => {
    const dir = pastaTemp("aceleriq-pacote-real-");
    const zip = path.join(dir, "m.zip");
    const p = montarPacote(REPO, zip, "HEAD");
    assert.match(p.versao, /^[0-9a-f]{10}$/);
    const x = path.join(dir, "x");
    mkdirSync(x);
    const r = spawnSync(comandoDoTar(), ["-xf", zip, "-C", x], { windowsHide: true, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    for (const pasta of PASTAS_DO_PACOTE) assert.ok(existsSync(path.join(x, pasta)), `faltou ${pasta}`);
    for (const f of [
      "workers/render/principal.ts",
      "supabase/functions/_shared/render-do-editor.ts",
      "supabase/functions/computador-do-agente/modulos/navegador.ts",
      "supabase/functions/_shared/motor-codigo.ts",
      "src/components/mesa-edicao/editor/Composicao.tsx",
    ]) assert.ok(existsSync(path.join(x, f)), `faltou ${f}`);
  });
});
