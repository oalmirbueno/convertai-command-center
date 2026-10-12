/**
 * Medir antes, conferir depois (12/10/2026, ffmpeg-skill). As regras são puras; os dois últimos
 * testes geram vídeos curtos com o ffmpeg de verdade (um bom e um preto e mudo).
 * Rodar: npm run teste (na pasta workers/render).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { avisosDaEntrada, conferirSaida, detectarConteudo, falhasDa, lerDeteccoes, lerSonda, motivoDaFalha, projetoTemSom, sondarDetalhado, type Medido, type SondaDetalhada } from "../conferencia.ts";
import { executar, FFMPEG } from "../midia.ts";

const BOA: SondaDetalhada = { duracao_s: 10.02, largura: 1080, altura: 1920, codec: "h264", pix_fmt: "yuv420p", fps_nominal: 30, fps_medio: 30, transferencia: "bt709", rotacao: 0, tem_video: true, tem_audio: true };
const ESPERADO = { duracao_s: 10, largura: 1080, altura: 1920, tem_som: true, lufs_alvo: -14 };
const medido = (o: Partial<Medido> = {}, s: Partial<SondaDetalhada> = {}): Medido => ({ sonda: { ...BOA, ...s }, lufs: -14.3, pico_db: -1.6, conteudo: { preto_s: 0, congelado_s: 0, silencio_s: 0.8 }, ...o });

test("arquivo certo: tudo ok", () => {
  const l = conferirSaida(medido(), ESPERADO);
  assert.equal(falhasDa(l).length, 0);
  assert.ok(l.every((x) => x.estado === "ok"), JSON.stringify(l));
});

test("duração, tamanho, formato e áudio que faltou param o pedido", () => {
  assert.equal(conferirSaida(medido({}, { duracao_s: 8.9 }), ESPERADO).find((x) => x.item === "duração")?.estado, "falha");
  assert.equal(conferirSaida(medido({}, { duracao_s: 10.4 }), ESPERADO).find((x) => x.item === "duração")?.estado, "ok"); // folga de 0,5 s
  assert.equal(conferirSaida(medido({}, { largura: 1920, altura: 1080 }), ESPERADO).find((x) => x.item === "tamanho")?.estado, "falha");
  assert.equal(conferirSaida(medido({}, { pix_fmt: "yuv444p" }), ESPERADO).find((x) => x.item === "formato")?.estado, "falha");
  const semAudio = conferirSaida(medido({ lufs: null, pico_db: null }, { tem_audio: false }), ESPERADO);
  assert.equal(semAudio.find((x) => x.item === "áudio")?.estado, "falha");
  assert.match(motivoDaFalha(semAudio), /não foi entregue: áudio/);
  // Projeto sem som: arquivo sem áudio é o certo.
  assert.equal(falhasDa(conferirSaida(medido({ lufs: null, pico_db: null }, { tem_audio: false }), { ...ESPERADO, tem_som: false })).length, 0);
});

test("volume fora do alvo, pico alto e imagem parada são aviso; preto e mudo param", () => {
  const l = conferirSaida(medido({ lufs: -19, pico_db: -0.2, conteudo: { preto_s: 0, congelado_s: 9.8, silencio_s: 0 } }), ESPERADO);
  assert.deepEqual(l.filter((x) => x.estado === "aviso").map((x) => x.item).sort(), ["movimento", "pico", "volume"]);
  assert.equal(falhasDa(l).length, 0);
  const preto = conferirSaida(medido({ conteudo: { preto_s: 9.9, congelado_s: 9.9, silencio_s: 9.9 } }), ESPERADO);
  assert.deepEqual(falhasDa(preto).map((x) => x.item).sort(), ["imagem", "som"]);
  // Mudo num projeto sem som é só aviso.
  assert.equal(conferirSaida(medido({ conteudo: { preto_s: 0, congelado_s: 0, silencio_s: 9.9 } }), { ...ESPERADO, tem_som: false }).find((x) => x.item === "som")?.estado, "aviso");
});

test("leitura das detecções: começo sem fim vai até o fim do vídeo", () => {
  const stderr = [
    "[blackdetect @ 0x1] black_start:0 black_end:1.5 black_duration:1.5",
    "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 2",
    "[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 3",
    "[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 5",
    "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 8",
    "[silencedetect @ 0x3] silence_start: 1",
    "[silencedetect @ 0x3] silence_end: 2.5 | silence_duration: 1.5",
  ].join("\n");
  assert.deepEqual(lerDeteccoes(stderr, 10), { preto_s: 1.5, congelado_s: 5, silencio_s: 1.5 });
});

test("medir antes: taxa variável, HDR, rotação e voz sem áudio viram aviso", () => {
  const s = lerSonda(JSON.stringify({
    format: { duration: "12.5" },
    streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, pix_fmt: "yuv420p10le", r_frame_rate: "30/1", avg_frame_rate: "2797/100", color_transfer: "arib-std-b67", side_data_list: [{ rotation: -90 }] }],
  }));
  assert.equal(s.rotacao, 270);
  const a = avisosDaEntrada("gravacao.mov", s, "voz");
  assert.equal(a.length, 4, a.join("\n"));
  assert.match(a.join(" "), /variável/);
  assert.match(a.join(" "), /HDR/);
  assert.match(a.join(" "), /rotação de 270/);
  assert.match(a.join(" "), /voz do vídeo/);
  assert.deepEqual(avisosDaEntrada("ok.mp4", BOA), []);
});

test("o projeto tem som pela trilha de áudio ou pelo vídeo com áudio", () => {
  const p = (trilhas: { tipo: string; oculta: boolean; muda?: boolean; clipes: { fonte: string | null }[] }[]) => ({ trilhas });
  assert.equal(projetoTemSom(p([{ tipo: "audio", oculta: false, clipes: [{ fonte: "voz" }] }])), true);
  assert.equal(projetoTemSom(p([{ tipo: "audio", oculta: false, muda: true, clipes: [{ fonte: "voz" }] }])), false);
  assert.equal(projetoTemSom(p([{ tipo: "video", oculta: false, clipes: [{ fonte: "cam" }] }])), false);
  assert.equal(projetoTemSom(p([{ tipo: "video", oculta: false, clipes: [{ fonte: "cam" }] }]), (k) => k === "cam"), true);
});

test("ffmpeg de verdade: vídeo bom passa; preto e mudo param", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "conferencia-"));
  try {
    const bom = path.join(pasta, "bom.mp4");
    const ruim = path.join(pasta, "ruim.mp4");
    const g1 = await executar(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x568:r=25:d=3", "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bom]);
    assert.equal(g1.codigo, 0, g1.erros);
    const g2 = await executar(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x568:r=25:d=3", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", ruim]);
    assert.equal(g2.codigo, 0, g2.erros);
    const esperado = { duracao_s: 3, largura: 320, altura: 568, tem_som: true, lufs_alvo: -14 };
    const sb = await sondarDetalhado(bom);
    const lb = conferirSaida({ sonda: sb, lufs: null, pico_db: null, conteudo: await detectarConteudo(bom, sb.duracao_s as number, sb.tem_audio) }, esperado);
    assert.equal(falhasDa(lb).length, 0, JSON.stringify(lb));
    const sr = await sondarDetalhado(ruim);
    const lr = conferirSaida({ sonda: sr, lufs: null, pico_db: null, conteudo: await detectarConteudo(ruim, sr.duracao_s as number, sr.tem_audio) }, esperado);
    assert.deepEqual(falhasDa(lr).map((x) => x.item).sort(), ["imagem", "som"], JSON.stringify(lr));
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
