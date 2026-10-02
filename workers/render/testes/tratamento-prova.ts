/**
 * Prova local do tratamento (Mesa Edição, 02/10): com ffmpeg na máquina, monta
 * DE VERDADE a partir de vídeos sintéticos (fundo animado + "legenda" branca
 * embaixo) e confere: a faixa muda, o resto do quadro fica igual ao original,
 * o áudio original continua e a máscara tem o tamanho da parte.
 * Rodar: node testes/tratamento-prova.ts (RENDER_PROVAS=<pasta> guarda os arquivos).
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argsDaMascara, argsDaParte, montarLocal, argsDoAntes } from "../tratamento.ts";
import { executar, FFMPEG, sondar } from "../midia.ts";

const pasta = process.env.RENDER_PROVAS || mkdtempSync(path.join(os.tmpdir(), "trt-"));
const ff = async (args: string[]) => {
  const r = await executar(FFMPEG, args, { cwd: pasta });
  if (r.codigo !== 0) throw new Error(r.erros.slice(-400));
};
// Original 540x960, 4 s, 30 qps, com tom de áudio e "legenda" (caixa branca com contorno) a 85% da altura.
const original = path.join(pasta, "original.mp4");
await ff(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-vf", "drawbox=x=90:y=800:w=360:h=60:color=white:t=fill,drawbox=x=90:y=800:w=360:h=60:color=black:t=4", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", original]);
// "IA": o mesmo fundo sem a legenda e com outro tamanho (como o provedor devolve).
const ia = path.join(pasta, "ia.mp4");
await ff(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=4", "-vf", "scale=720:1280", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", ia]);
// Parte (perfil padrão) e máscara.
const parte = path.join(pasta, "parte.mp4");
await ff(argsDaParte(original, parte, 1, 2, "padrao"));
const sp = await sondar(parte);
assert.ok(sp.largura && sp.largura >= 720, `parte com lado menor >= 720 (${sp.largura})`);
const mascara = path.join(pasta, "mascara.mp4");
await ff(argsDaMascara(mascara, sp.largura!, sp.altura!, sp.duracao_s!, { x: 0.15, y: 0.82, w: 0.7, h: 0.1 }));
const sm = await sondar(mascara);
assert.equal(sm.largura, sp.largura);
assert.equal(sm.altura, sp.altura);
// Fiel: mesmo tamanho do original.
const fiel = path.join(pasta, "fiel.mp4");
await ff(argsDaParte(original, fiel, 0, 2, "fiel"));
assert.equal((await sondar(fiel)).largura, 540);
// Montagem: antes (0 a 4 s) + IA, faixa de 80% a 92%.
const antes = path.join(pasta, "antes.mp4");
await ff(argsDoAntes(original, antes, 0, 4));
const depois = path.join(pasta, "depois.mp4");
await montarLocal({ pasta, antes, ia: [ia], acao: "tirar_legenda", regiao: { x: 0.1, y: 0.8, w: 0.8, h: 0.12 }, saida: depois });
const sd = await sondar(depois);
assert.equal(sd.largura, 540);
assert.equal(sd.altura, 960);
assert.ok(sd.tem_audio, "o áudio original continua");
// Quadro em 2 s: a faixa da legenda mudou (sem a caixa branca) e o alto do quadro é o original.
const quadro = async (arq: string, y: number, h: number) => (await executar(FFMPEG, ["-v", "error", "-ss", "2", "-i", arq, "-frames:v", "1", "-vf", `crop=540:${h}:0:${y},scale=27:${Math.max(1, Math.round(h / 20))},format=gray`, "-f", "rawvideo", "-"], { binario: true })).saida;
const dif = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const faixaAntes = await quadro(antes, 800, 60);
const faixaDepois = await quadro(depois, 800, 60);
const altoAntes = await quadro(antes, 0, 600);
const altoDepois = await quadro(depois, 0, 600);
console.log("faixa mudou:", dif(faixaAntes, faixaDepois).toFixed(1), "alto igual:", dif(altoAntes, altoDepois).toFixed(2));
assert.ok(dif(faixaAntes, faixaDepois) > 20, "a faixa da legenda mudou");
assert.ok(dif(altoAntes, altoDepois) < 2, "o resto do quadro ficou o original");
// Melhorar: o tamanho que o modelo devolveu, com o áudio original.
const melhor = path.join(pasta, "melhor.mp4");
await montarLocal({ pasta, antes, ia: [ia], acao: "melhorar", regiao: null, saida: melhor });
const sme = await sondar(melhor);
assert.equal(sme.largura, 720);
assert.ok(sme.tem_audio);
console.log("ok: tratamento montado de verdade em", pasta);
