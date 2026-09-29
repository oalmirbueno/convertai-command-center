// Mede cada som da biblioteca (public/editor/sons): duração, ponto forte (janela de 10 ms
// com mais energia) e pico em dBFS. Decodifica com o ffmpeg (mono, 48 kHz, float).
// Uso: node workers/render/sons/medir-sons.mjs  -> imprime JSON para som-do-editor.ts
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "editor", "sons");
const saida = {};
for (const nome of readdirSync(raiz).filter((n) => n.endsWith(".wav")).sort()) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", join(raiz, nome), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg falhou em ${nome}`);
  const b = r.stdout;
  const a = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  const n = 480;
  let melhor = -1, onde = 0, pico = 0;
  for (let i = 0; i < a.length; i += n) {
    let s = 0;
    for (let k = i; k < Math.min(a.length, i + n); k++) { s += a[k] * a[k]; pico = Math.max(pico, Math.abs(a[k])); }
    if (s > melhor) { melhor = s; onde = i; }
  }
  saida[nome] = { duracao_s: Math.round((a.length / 48000) * 1000) / 1000, pico_s: Math.round(((onde + n / 2) / 48000) * 1000) / 1000, pico_dbfs: Math.round(20 * Math.log10(pico || 1e-9) * 10) / 10 };
}
console.log(JSON.stringify(saida, null, 1));
