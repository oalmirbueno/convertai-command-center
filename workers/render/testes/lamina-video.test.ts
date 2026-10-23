/**
 * Lâmina de vídeo do carrossel estilo X (22/10/2026): regras do contrato e, com ffmpeg na
 * máquina, o MP4 montado DE VERDADE a partir de uma lâmina sintética (fundo vermelho) e de um
 * vídeo de teste: tamanho da lâmina, duração do vídeo, som, o vídeo dentro do retângulo e o
 * canto arredondado mostrando a lâmina (a máscara funcionou).
 * Rodar: node --test testes/lamina-video.test.ts (na pasta workers/render).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argumentosDaComposicao, argumentosDaMascara, normalizarEntradaDaLaminaEmVideo } from "../../../supabase/functions/estudio-arte/modulos/lamina-em-video.ts";
import { comporLaminaLocal } from "../laminaVideo.ts";
import { executar, FFMPEG } from "../midia.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "33333333-3333-4333-8333-333333333333";
const entradaBase = {
  trabalho_id: TRABALHO, ordem: 2, versao: 1, largura: 1080, altura: 1350,
  fundo: { bucket: "mesa", caminho: `${CLIENTE}/estudio/cards/l2.png` },
  video: { bucket: "mesa", caminho: `${CLIENTE}/video/brutos/v.mp4` },
  retangulo: { x: 101, y: 501, largura: 879, altura: 495, raio: 40 },
  enquadramento: "preencher", foco_x: 0.5, foco_y: 0.5, cor_do_bloco: "#f2f4f5", som: true,
  saida: `${CLIENTE}/estudio/template/videos/${TRABALHO}-2.mp4`,
};

test("contrato: caminhos só do cliente, retângulo par e dentro da lâmina", () => {
  const e = normalizarEntradaDaLaminaEmVideo(entradaBase, CLIENTE);
  assert.deepEqual([e.retangulo.x % 2, e.retangulo.y % 2, e.retangulo.largura % 2, e.retangulo.altura % 2], [0, 0, 0, 0]);
  assert.ok(e.retangulo.x + e.retangulo.largura <= 1080 && e.retangulo.y + e.retangulo.altura <= 1350);
  assert.throws(() => normalizarEntradaDaLaminaEmVideo({ ...entradaBase, video: { bucket: "mesa", caminho: `outro/${CLIENTE}/v.mp4` } }, CLIENTE), /deste cliente/);
  assert.throws(() => normalizarEntradaDaLaminaEmVideo({ ...entradaBase, fundo: { bucket: "mesa", caminho: `${CLIENTE}/../x.png` } }, CLIENTE), /PNG/);
  assert.throws(() => normalizarEntradaDaLaminaEmVideo({ ...entradaBase, retangulo: { x: 900, y: 0, largura: 400, altura: 200, raio: 0 } }, CLIENTE), /caber/);
  assert.throws(() => normalizarEntradaDaLaminaEmVideo({ ...entradaBase, saida: `${CLIENTE}/outra/pasta.mp4` }, CLIENTE), /Destino/);
  // Vídeo do Workspace do cliente vale.
  assert.equal(normalizarEntradaDaLaminaEmVideo({ ...entradaBase, video: { bucket: "workspace", caminho: `client/${CLIENTE}/a.mov` } }, CLIENTE).video.bucket, "workspace");
});

test("argumentos: máscara com o raio; inteira usa pad e preencher usa crop pelo foco; teto de 60 s", () => {
  const e = normalizarEntradaDaLaminaEmVideo(entradaBase, CLIENTE);
  assert.match(argumentosDaMascara(e, "m.png").join(" "), /geq=lum='255\*clip\(40/);
  const preencher = argumentosDaComposicao(e, { fundo: "f.png", video: "v.mp4", mascara: "m.png", saida: "s.mp4" }, 300, true);
  assert.match(preencher[preencher.indexOf("-filter_complex") + 1], /crop=880:496:\(iw-880\)\*0\.5/);
  assert.equal(preencher[preencher.indexOf("-t") + 1], "60.000");
  const inteira = argumentosDaComposicao({ ...e, enquadramento: "inteira", som: false }, { fundo: "f.png", video: "v.mp4", mascara: "m.png", saida: "s.mp4" }, 4, true);
  assert.match(inteira[inteira.indexOf("-filter_complex") + 1], /pad=880:496:.*color=0xf2f4f5/);
  assert.ok(inteira.indexOf("-an") >= 0);
});

async function temFfmpeg(): Promise<boolean> {
  try { return (await executar(FFMPEG, ["-version"])).codigo === 0; } catch { return false; }
}

/** Cor de um ponto do primeiro quadro (rgb24). */
async function pixel(arquivo: string, x: number, y: number, t = 0.5): Promise<number[]> {
  const r = await executar(FFMPEG, ["-v", "error", "-ss", String(t), "-i", arquivo, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"], { binario: true });
  return Array.from(r.saida.subarray(0, 3));
}

test("ffmpeg: monta o MP4 da lâmina com o vídeo no bloco e o canto arredondado", async (t) => {
  if (!(await temFfmpeg())) { t.skip("sem ffmpeg nesta máquina"); return; }
  const pasta = mkdtempSync(path.join(os.tmpdir(), "lamina-video-"));
  const fundo = path.join(pasta, "lamina.png"), video = path.join(pasta, "v.mp4"), saida = path.join(pasta, "saida.mp4");
  const f = await executar(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=1080x1350:d=1", "-frames:v", "1", fundo]);
  assert.equal(f.codigo, 0, f.erros);
  const v = await executar(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
  assert.equal(v.codigo, 0, v.erros);
  const e = normalizarEntradaDaLaminaEmVideo(entradaBase, CLIENTE);
  const r = await comporLaminaLocal(e, { fundo, video, pasta, saida });
  assert.equal(r.largura, 1080);
  assert.equal(r.altura, 1350);
  assert.ok(r.duracao_s !== null && r.duracao_s > 1.8 && r.duracao_s < 2.3, `duração ${r.duracao_s}`);
  assert.equal(r.com_som, true);
  const fora = await pixel(saida, 50, 50);
  const dentro = await pixel(saida, e.retangulo.x + e.retangulo.largura / 2, e.retangulo.y + e.retangulo.altura / 2);
  const canto = await pixel(saida, e.retangulo.x + 2, e.retangulo.y + 2);
  assert.ok(fora[0] > 180 && fora[2] < 80, `fora ${fora}`);
  assert.ok(dentro[2] > 180 && dentro[0] < 80, `dentro ${dentro}`);
  assert.ok(canto[0] > 180 && canto[2] < 80, `canto ${canto}`);
});
