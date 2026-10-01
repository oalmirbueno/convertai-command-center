/**
 * Troca de cenário no worker (frente TCN, 01/10/2026).
 * - regras puras (cor, corte, filtro de cada saída);
 * - a migration 20260930327000 num Postgres em memória (PGlite): o tipo
 *   'cenario' ligado à troca, a trava do alvo e o "só worker tcn- pega";
 * - com ffmpeg na máquina: a final montada DE VERDADE a partir de entradas
 *   sintéticas (trecho com áudio, recorte com alfa em VP9, fundo e versão IA).
 *   RENDER_PROVAS=<pasta> guarda os MP4 e um quadro de cada para conferir.
 * Rodar: npm run teste (na pasta workers/render).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argsDoPreparo, caminhoDoCliente, comporLocal, entradasDaComposicao, filtroDaComposicao, ganhosDeCor, type LayoutDaComposicao } from "../cenario.ts";
import { executar, FFMPEG, sondar } from "../midia.ts";
import { bancoComATroca, CLIENTE } from "./banco.ts";

test("cor: puxa a pessoa 35% para a luz do fundo, sem passar de 0,8 a 1,25", () => {
  assert.deepEqual(ganhosDeCor([100, 100, 100], [100, 100, 100]), [1, 1, 1]);
  const quente = ganhosDeCor([200, 150, 100], [100, 100, 100]);
  assert.ok(quente[0] > 1 && quente[0] <= 1.25);
  assert.ok(quente[2] === 1);
  assert.deepEqual(ganhosDeCor([10, 10, 10], [250, 250, 250]), [0.8, 0.8, 0.8]);
});

test("caminho: só da pasta do cliente, sem ..", () => {
  assert.equal(caminhoDoCliente(CLIENTE, `${CLIENTE}/video/cenarios/x/trecho.mp4`), `${CLIENTE}/video/cenarios/x/trecho.mp4`);
  assert.equal(caminhoDoCliente(CLIENTE, `outro/${CLIENTE}/a.mp4`), null);
  assert.equal(caminhoDoCliente(CLIENTE, `${CLIENTE}/../a.mp4`), null);
});

test("preparo: corta no trecho, 30 qps, lado menor 720 a 1080; Aleph com taxa contida", () => {
  const a = argsDoPreparo("in.mov", "out.mp4", 2.5, 8, "padrao");
  assert.equal(a[a.indexOf("-ss") + 1], "2.500");
  assert.equal(a[a.indexOf("-t") + 1], "8.000");
  assert.match(a[a.indexOf("-vf") + 1], /max\(720,iw\)/);
  assert.match(a[a.indexOf("-vf") + 1], /min\(1080/);
  assert.ok(a.indexOf("-maxrate") < 0);
  const b = argsDoPreparo("in.mov", "out.mp4", 0, 5, "aleph");
  assert.match(b[b.indexOf("-vf") + 1], /min\(720/);
  assert.ok(b.indexOf("-maxrate") > 0);
});

test("filtro: Rápido põe a pessoa sobre o fundo com a cor casada; Cinema usa a IA; 2 e 3 faixas empilham", () => {
  const e = entradasDaComposicao({ original: "o.mp4", recorte: "r.webm", placa: "p.png", ia: null });
  assert.deepEqual(e.indices, { original: 0, recorte: 1, placa: 2, ia: null });
  assert.equal(e.args[e.args.indexOf("r.webm") - 1], "-i");
  assert.equal(e.args[e.args.indexOf("r.webm") - 2], "libvpx-vp9");
  const cheio = filtroDaComposicao({ layout: "cheio", W: 720, H: 1280, Wp: 1080, Hp: 1920, ...e.indices, ganhos: [1.1, 1, 0.9], fonte: null });
  assert.match(cheio, /\[2:v\]scale=720:1280.*gblur/);
  assert.match(cheio, /colorchannelmixer=rr=1.1:gg=1:bb=0.9/);
  assert.match(cheio, /overlay=0:0:shortest=1/);
  assert.match(cheio, /\[ia\]null\[v\]$/);
  const duas = filtroDaComposicao({ layout: "duas_faixas", W: 720, H: 1280, Wp: 1080, Hp: 1920, ...e.indices, ganhos: null, fonte: "letra.ttf" });
  assert.match(duas, /vstack=inputs=2/);
  assert.match(duas, /text='IA'/);
  assert.match(duas, /text='Original'/);
  const tres = filtroDaComposicao({ layout: "tres_faixas", W: 720, H: 1280, Wp: 1080, Hp: 1920, ...e.indices, ganhos: null, fonte: null });
  assert.match(tres, /split=2\[rp\]\[rm\]/);
  assert.match(tres, /alphaextract/);
  assert.match(tres, /vstack=inputs=3/);
  const cinema = entradasDaComposicao({ original: "o.mp4", recorte: null, placa: null, ia: "ia.mp4" });
  assert.match(filtroDaComposicao({ layout: "cheio", W: 720, H: 1280, Wp: 1080, Hp: 1920, ...cinema.indices, ganhos: null, fonte: null }), /\[1:v\]scale=720:1280/);
  assert.throws(() => filtroDaComposicao({ layout: "tres_faixas", W: 720, H: 1280, Wp: 1080, Hp: 1920, ...cinema.indices, ganhos: null, fonte: null }), /recorte/);
  assert.throws(() => filtroDaComposicao({ layout: "cheio", W: 720, H: 1280, Wp: 1080, Hp: 1920, original: 0, recorte: 1, placa: null, ia: null, ganhos: null, fonte: null }), /fundo/);
});

// ------------------------------------------------------------------ banco

const TROCA = "33333333-3333-4333-8333-333333333333";

async function trocaNoBanco() {
  const db = await bancoComATroca();
  await db.query(
    `INSERT INTO public.video_cenarios (id, client_id, fonte_path, entrada_s, saida_s, cenario, qualidade, layout, autorizacao, chave)
     VALUES ($1, $2, $3, 0, 8, 'loja reformada', 'rapido', 'cheio', '{"confirmada": true, "em": "2026-10-01T12:00:00Z"}'::jsonb, 'amostra:clique-1')`,
    [TROCA, CLIENTE, `${CLIENTE}/video/brutos/a.mp4`],
  );
  return db;
}

test("migration: o tipo 'cenario' pertence à troca (sem versão) e não entra sem ela", async () => {
  const db = await trocaNoBanco();
  await db.query(`INSERT INTO public.render_pedidos (client_id, tipo, cenario_id, uid, entrada) VALUES ($1, 'cenario', $2, 'cenario-1-preparar', '{"fase":"preparar"}'::jsonb)`, [CLIENTE, TROCA]);
  await assert.rejects(db.query(`INSERT INTO public.render_pedidos (client_id, tipo, uid, entrada) VALUES ($1, 'cenario', 'cenario-2-preparar', '{"fase":"preparar"}'::jsonb)`, [CLIENTE]), /render_pedidos_alvo_check/);
  // Um ativo por troca e fase.
  await assert.rejects(db.query(`INSERT INTO public.render_pedidos (client_id, tipo, cenario_id, uid, entrada) VALUES ($1, 'cenario', $2, 'cenario-3-preparar', '{"fase":"preparar"}'::jsonb)`, [CLIENTE, TROCA]), /render_pedidos_cenario_ativo_unico|duplicate key/);
  // Sem a autorização confirmada, a troca não entra.
  await assert.rejects(
    db.query(`INSERT INTO public.video_cenarios (client_id, fonte_path, entrada_s, saida_s, cenario, autorizacao, chave) VALUES ($1, 'x/y.mp4', 0, 5, 'praia', '{"confirmada": false, "em": "agora"}'::jsonb, 'amostra:clique-2')`, [CLIENTE]),
    /check/i,
  );
});

test("migration: worker antigo não pega a troca; o worker tcn- pega, e o preparo passa na frente do vídeo inteiro", async () => {
  const db = await trocaNoBanco();
  await db.query(`INSERT INTO public.render_pedidos (client_id, tipo, cenario_id, uid, entrada) VALUES ($1, 'cenario', $2, 'cenario-1-preparar', '{"fase":"preparar"}'::jsonb)`, [CLIENTE, TROCA]);
  const antigo = await db.query<{ id: string }>(`SELECT id FROM public.render_pedidos_pegar(gen_random_uuid(), 'maquina-antiga', 600, 'edt-1.0+mot-1.0+mtr-1+mov-1')`);
  assert.equal(antigo.rows.length, 0);
  const novo = await db.query<{ id: string; tipo: string }>(`SELECT id, tipo FROM public.render_pedidos_pegar(gen_random_uuid(), 'maquina-nova', 600, 'edt-1.0+mot-1.0+mtr-1+tcn-1+mov-1')`);
  assert.equal(novo.rows.length, 1);
  assert.equal(novo.rows[0].tipo, "cenario");
  // Rodar a migration de novo não quebra nada (idempotente).
  await bancoComATroca(db);
});

// ------------------------------------------------------------------ ffmpeg de verdade

async function temFfmpeg() {
  try {
    return (await executar(FFMPEG, ["-version"])).codigo === 0;
  } catch {
    return false;
  }
}

async function ff(args: string[], cwd?: string) {
  const r = await executar(FFMPEG, ["-y", "-v", "error"].concat(args), { cwd });
  assert.equal(r.codigo, 0, r.erros.slice(-400));
}

test("composição real: Rápido (1, 2 e 3 faixas) e Cinema (2 faixas), com o áudio original", { timeout: 240_000 }, async (t) => {
  if (!(await temFfmpeg())) return t.skip("ffmpeg fora do PATH nesta máquina");
  const pasta = mkdtempSync(path.join(os.tmpdir(), "tcn-"));
  // Trecho "gravado": 2 s, 540x960, com áudio (a fala).
  await ff(["-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "original.mp4"], pasta);
  // Recorte com alfa (a "pessoa" é um círculo que anda) em WebM VP9, como o Bria v3 devolve.
  await ff(["-f", "lavfi", "-i", "color=c=0xD9A066:s=540x960:r=30:d=2,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(hypot(X-200-60*T,Y-560),190),255,0)'", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1M", "recorte.webm"], pasta);
  // Fundo limpo (a imagem da amostra sem a pessoa) e a versão da IA (Cinema).
  await ff(["-f", "lavfi", "-i", "gradients=s=1024x1536:c0=0x1B2440:c1=0xF2A541:d=1", "-frames:v", "1", "placa.png"], pasta);
  await ff(["-f", "lavfi", "-i", "mandelbrot=s=720x1280:r=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "ia.mp4"], pasta);
  copyFileSync(path.join(process.cwd(), "..", "..", "public", "editor", "fontes", "Figtree-Variable.ttf"), path.join(pasta, "letra.ttf"));
  const provas = process.env.RENDER_PROVAS ? path.resolve(process.env.RENDER_PROVAS) : null;
  if (provas) mkdirSync(provas, { recursive: true });
  const casos: { nome: string; layout: LayoutDaComposicao; rapido: boolean; medidas: [number, number] }[] = [
    { nome: "rapido-cheio", layout: "cheio", rapido: true, medidas: [540, 960] },
    { nome: "rapido-duas-faixas", layout: "duas_faixas", rapido: true, medidas: [1080, 1920] },
    { nome: "rapido-tres-faixas", layout: "tres_faixas", rapido: true, medidas: [1080, 1920] },
    { nome: "cinema-duas-faixas", layout: "duas_faixas", rapido: false, medidas: [1080, 1920] },
  ];
  for (const c of casos) {
    const saida = path.join(pasta, `${c.nome}.mp4`);
    const r = await comporLocal({
      pasta,
      original: path.join(pasta, "original.mp4"),
      recorte: c.rapido || c.layout === "tres_faixas" ? path.join(pasta, "recorte.webm") : null,
      placa: c.rapido ? path.join(pasta, "placa.png") : null,
      ia: c.rapido ? null : path.join(pasta, "ia.mp4"),
      layout: c.layout,
      Wp: 1080,
      Hp: 1920,
      fonte: c.layout === "cheio" ? null : "letra.ttf",
      saida,
    });
    const s = await sondar(saida);
    assert.equal(s.largura, c.medidas[0], c.nome);
    assert.equal(s.altura, c.medidas[1], c.nome);
    assert.ok(s.tem_audio, `${c.nome}: sem o áudio original`);
    assert.ok(s.duracao_s && s.duracao_s > 1.8 && s.duracao_s < 2.3, `${c.nome}: duração ${s.duracao_s}`);
    if (c.rapido) assert.ok(r.ganhos, `${c.nome}: sem ganho de cor`);
    if (provas) {
      copyFileSync(saida, path.join(provas, `${c.nome}.mp4`));
      await ff(["-ss", "1", "-i", saida, "-frames:v", "1", path.join(provas, `${c.nome}.png`)]);
      assert.ok(existsSync(path.join(provas, `${c.nome}.png`)));
    }
  }
});
