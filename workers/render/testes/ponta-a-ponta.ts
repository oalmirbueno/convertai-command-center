/**
 * Teste de ponta a ponta do worker (frente EDT), NESTA máquina, sem tocar no
 * banco de produção:
 *
 * - fila: a migration de verdade num Postgres em memória (PGlite), com as RPCs
 *   render_pedidos_pegar / progresso / concluir chamadas como o worker chama;
 * - Storage: um servidor HTTP local que fala o mesmo protocolo do Supabase
 *   (download do objeto e upload resumível TUS em partes de 6 MB);
 * - mídia: um vídeo curto de exemplo do pacote EDIT IA PRO (exemplo 07) com
 *   1 s de silêncio no meio, para o corte pela onda ter o que tirar;
 * - render: a Remotion CLI de verdade com a ComposicaoDoProjeto, legenda de 3
 *   palavras, peças de motion, efeitos CC0 no pico e trilha 22 dB abaixo da
 *   voz; depois o -14 LUFS e o MP4 subindo em partes.
 *
 * Rodar (na pasta workers/render): npm run ponta-a-ponta
 * Opcional: RENDER_CHROME=<chrome-headless-shell.exe já baixado>.
 */

import assert from "node:assert/strict";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { cortesDaOnda, type TrechoDeTempo } from "../../../supabase/functions/_shared/onda-do-audio.ts";
import { caminhoDaSaida, PARTE_DO_UPLOAD_BYTES } from "../../../supabase/functions/_shared/render-do-editor.ts";
import { BIBLIOTECA_DE_SONS, caminhoDoSom, chaveDoSom, planoDeSons, noAlvoDeLoudness } from "../../../supabase/functions/mesa-motion/modulos/som-do-editor.ts";
import { armazemSupabase } from "../armazem.ts";
import type { Fila, PedidoDoWorker } from "../fila.ts";
import { executar, medirLoudness, sondar } from "../midia.ts";
import { PASTA_DO_WORKER, umPedido, type Ambiente } from "../trabalho.ts";
import { bancoComAFila, CLIENTE, VERSAO } from "./banco.ts";

const EXEMPLO = process.env.RENDER_EXEMPLO || "C:/AI/acervo-aceleriq/edit-ia-pro/EDIT-IA-PRO/EXEMPLOS/07-resposta-pergunta/exemplo.mp4";
const PASTA = path.join(PASTA_DO_WORKER, "tmp", "ponta-a-ponta");
const ARMAZEM = path.join(PASTA, "armazem");
const LARGURA = 540;
const ALTURA = 960;
const FPS = 30;
const inicio = Date.now();
const log = (t: string) => console.log(`[${((Date.now() - inicio) / 1000).toFixed(1).padStart(6)} s] ${t}`);

// ------------------------------------------------------------------ Storage local (protocolo do Supabase)

interface Envio {
  bucket: string;
  objeto: string;
  total: number;
  feito: number;
  arquivo: string;
  partes: number[];
}

function servidorDoArmazem(): Promise<{ url: string; envios: Envio[]; fechar: () => void }> {
  const envios: Envio[] = [];
  const abertos: Record<string, Envio> = {};
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    const auth = String(req.headers.authorization || "");
    if (!/^Bearer chave-de-teste-/.test(auth)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "GET" && u.pathname.indexOf("/storage/v1/object/") === 0) {
      const rel = decodeURIComponent(u.pathname.slice("/storage/v1/object/".length));
      const f = path.join(ARMAZEM, rel);
      if (!existsSync(f)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      createReadStream(f).pipe(res);
      return;
    }
    if (req.method === "POST" && u.pathname === "/storage/v1/upload/resumable") {
      const meta: Record<string, string> = {};
      String(req.headers["upload-metadata"] || "")
        .split(",")
        .forEach((par) => {
          const [k, v] = par.trim().split(" ");
          if (k) meta[k] = Buffer.from(v || "", "base64").toString("utf8");
        });
      const id = `u${envios.length + 1}`;
      const e: Envio = { bucket: meta.bucketName, objeto: meta.objectName, total: Number(req.headers["upload-length"]), feito: 0, arquivo: path.join(PASTA, `${id}.parte`), partes: [] };
      envios.push(e);
      abertos[id] = e;
      res.writeHead(201, { Location: `/storage/v1/upload/resumable/${id}`, "Tus-Resumable": "1.0.0" }).end();
      return;
    }
    if (req.method === "PATCH" && u.pathname.indexOf("/storage/v1/upload/resumable/") === 0) {
      const e = abertos[u.pathname.split("/").pop() || ""];
      if (!e || Number(req.headers["upload-offset"]) !== e.feito) {
        res.writeHead(409).end();
        return;
      }
      const pedacos: Buffer[] = [];
      req.on("data", (d: Buffer) => pedacos.push(d));
      req.on("end", async () => {
        const b = Buffer.concat(pedacos);
        // O Storage do Supabase só aceita partes de 6 MB (a última pode ser menor).
        if (b.length !== PARTE_DO_UPLOAD_BYTES && e.feito + b.length !== e.total) {
          res.writeHead(400).end();
          return;
        }
        await new Promise<void>((ok) => createWriteStream(e.arquivo, { flags: "a" }).end(b, () => ok()));
        e.feito += b.length;
        e.partes.push(b.length);
        if (e.feito === e.total) {
          const destino = path.join(ARMAZEM, e.bucket, e.objeto);
          await mkdir(path.dirname(destino), { recursive: true });
          await rename(e.arquivo, destino);
        }
        res.writeHead(204, { "Upload-Offset": String(e.feito), "Tus-Resumable": "1.0.0" }).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, envios, fechar: () => srv.close() })));
}

// ------------------------------------------------------------------ fila no PGlite (as RPCs de verdade)

function filaNoPGlite(db: PGlite): Fila {
  const um = async <T>(sql: string, p: unknown[]) => (await db.query<T>(sql, p)).rows[0];
  return {
    async pegar(token, worker, versao) {
      const r = (await db.query<PedidoDoWorker>("SELECT * FROM public.render_pedidos_pegar($1, $2, 600, $3)", [token, worker, versao])).rows;
      return r.length ? r[0] : null;
    },
    progresso: async (id, token, etapa, p) => (await um<{ r: boolean }>("SELECT public.render_pedidos_progresso($1, $2, $3, $4, 600) AS r", [id, token, etapa, p])).r,
    concluir: async (id, token, s, a, r) => (await um<{ r: boolean }>("SELECT public.render_pedidos_concluir($1, $2, $3, $4, $5::jsonb) AS r", [id, token, s, a, JSON.stringify(r)])).r,
    falhar: async (id, token, c, m) => (await um<{ r: boolean }>("SELECT public.render_pedidos_falhar($1, $2, $3, $4) AS r", [id, token, c, m])).r,
    async registrarArquivo(l) {
      const r = await um<{ id: string }>(
        "INSERT INTO public.video_arquivos (client_id, nome, nome_original, storage_bucket, storage_path, tipo, mime, bytes, duracao_s, largura, altura, sha256, origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id",
        [l.client_id, l.nome, l.nome_original, l.storage_bucket, l.storage_path, l.tipo, l.mime, l.bytes, l.duracao_s, l.largura, l.altura, l.sha256, JSON.stringify(l.origem)],
      );
      return r.id;
    },
    tituloDaVersao: async () => "Exemplo 07 v3",
  };
}

// ------------------------------------------------------------------ o vídeo de exemplo com uma pausa longa

async function prepararFonte(): Promise<{ caminho: string; duracao: number }> {
  const rel = `${CLIENTE}/video/brutos/exemplo-com-pausa.mp4`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  await mkdir(path.dirname(destino), { recursive: true });
  // Exemplo 07 (8,2 s) + 1 s de silêncio preto + os 4 primeiros segundos de novo: uma pausa longa no meio.
  const filtro = [
    `[0:v]scale=${LARGURA}:${ALTURA},fps=${FPS},format=yuv420p,setsar=1[a]`,
    `[0:a]aresample=48000,aformat=channel_layouts=stereo[aa]`,
    `color=c=black:s=${LARGURA}x${ALTURA}:r=${FPS}:d=1,format=yuv420p,setsar=1[b]`,
    `anullsrc=r=48000:cl=stereo,atrim=0:1[ba]`,
    `[0:v]trim=0:4,setpts=PTS-STARTPTS,scale=${LARGURA}:${ALTURA},fps=${FPS},format=yuv420p,setsar=1[c]`,
    `[0:a]atrim=0:4,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[ca]`,
    `[a][aa][b][ba][c][ca]concat=n=3:v=1:a=1[v][au]`,
  ].join(";");
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-i", EXEMPLO, "-filter_complex", filtro, "-map", "[v]", "-map", "[au]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", destino]);
  assert.equal(r.codigo, 0, r.erros);
  const s = await sondar(destino);
  return { caminho: rel, duracao: s.duracao_s || 13.2 };
}

async function prepararTrilha(): Promise<string> {
  // Trilha feita aqui (acordes em seno com leve tremolo): sem licença de terceiro.
  const rel = `${CLIENTE}/video/brutos/trilha-teste.wav`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  const expr = "0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.2*sin(2*PI*277.18*t)+0.18*sin(2*PI*329.63*t)";
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=48000:d=16`, "-ac", "2", destino]);
  assert.equal(r.codigo, 0, r.erros);
  return rel;
}

// ------------------------------------------------------------------ o projeto que o editor salvaria

const FALA_DO_EXEMPLO = "Eu gravei esse vídeo uma vez só, errei, gaguejei, repeti frase e você não viu nada disso, porque quem editou esse vídeo não fui eu, foi uma IA.";

/** Palavras espalhadas pelos trechos de fala medidos (só para a legenda do teste; no painel vem do Timestamp). */
function palavrasNaFala(pausas: TrechoDeTempo[], ate: number): { t: string; i: number; f: number }[] {
  const falas: TrechoDeTempo[] = [];
  let cursor = 0;
  pausas.forEach((p) => {
    if (p.de_s > cursor + 0.05 && p.de_s <= ate) falas.push({ de_s: cursor, ate_s: Math.min(p.de_s, ate) });
    cursor = Math.max(cursor, p.ate_s);
  });
  if (cursor < ate) falas.push({ de_s: cursor, ate_s: ate });
  const total = falas.reduce((s, f) => s + (f.ate_s - f.de_s), 0);
  const palavras = FALA_DO_EXEMPLO.split(" ");
  const passo = total / palavras.length;
  const saida: { t: string; i: number; f: number }[] = [];
  let k = 0;
  falas.forEach((f) => {
    for (let t = f.de_s; t + passo * 0.5 <= f.ate_s && k < palavras.length; t += passo) saida.push({ t: palavras[k++], i: Math.round(t * 1000) / 1000, f: Math.round((t + passo * 0.9) * 1000) / 1000 });
  });
  return saida;
}

function montarProjeto(fonte: { caminho: string; duracao: number }, trilha: string, onda: { pausas: TrechoDeTempo[]; lufs: number | null }) {
  const q = (s: number) => Math.round(s * FPS) / FPS;
  // Corte pela onda (a mesma função da skill cortar_pela_onda).
  const cortes = cortesDaOnda({ entrada_s: 0, saida_s: fonte.duracao }, onda.pausas);
  const trechos: TrechoDeTempo[] = [];
  let de = 0;
  cortes.forEach((c) => {
    if (c.de_s > de) trechos.push({ de_s: de, ate_s: c.de_s });
    de = c.ate_s;
  });
  if (de < fonte.duracao) trechos.push({ de_s: de, ate_s: fonte.duracao });
  let t = 0;
  const clipes = trechos.map((x, k) => {
    const c = { id: `v${k + 1}`, fonte: "exemplo", inicio_s: q(t), entrada_s: x.de_s, saida_s: x.ate_s, velocidade: 1, volume: 1, texto: null, estilo: null, transicao_entrada: null, transicao_saida: null, zoom: k % 2 ? { de: 1.08, para: 1.08 } : null, cena_ref: null, nota: null, comparar: null, origem: { tipo: "skill", ref: "cortar_pela_onda" } };
    t += x.ate_s - x.de_s;
    return c;
  });
  const duracao = q(t);
  const palavras = palavrasNaFala(onda.pausas, 8.2);
  // Legenda padrão de 3 palavras (tempo da fonte = linha aqui, o primeiro trecho começa em 0).
  const legendas: Record<string, unknown>[] = [];
  for (let k = 0; k < palavras.length; k += 3) {
    const b = palavras.slice(k, k + 3);
    const ini = q(b[0].i);
    const fim = q(Math.min(b[b.length - 1].f, k + 3 < palavras.length ? palavras[k + 3].i : b[b.length - 1].f));
    if (fim - ini < 1 / FPS) continue;
    legendas.push({ id: `l${legendas.length + 1}`, fonte: null, inicio_s: ini, entrada_s: 0, saida_s: q(fim - ini), velocidade: 1, volume: 1, texto: b.map((w) => w.t).join(" "), estilo: { preset: "destaque", posicao: "base", palavras: b.map((w) => ({ t: w.t, i: Math.round((w.i - ini) * 1000) / 1000, f: Math.round((w.f - ini) * 1000) / 1000 })) }, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null });
  }
  const errei = palavras.find((w) => /errei/i.test(w.t));
  const ia = palavras.filter((w) => /IA/i.test(w.t)).pop();
  const pecas = [
    { id: "s1", inicio_s: q(errei ? errei.i : 2.4), dur: 3, estilo: { peca: "lista", params: { itens: ["errei", "gaguejei", "repeti frase"], modo: "riscada" }, tempos: [0, 0.6, 1.3] }, pico: 0.24, som: "tique" },
    { id: "s2", inicio_s: q(ia ? ia.i : 7.3), dur: 1.6, estilo: { peca: "carimbo", params: { texto: "IA" } }, pico: 0.16, som: "impacto" },
    { id: "s3", inicio_s: q(Math.max(0, duracao - 2.4)), dur: 2.4, estilo: { peca: "cartao_final", params: { titulo: "Editado pela fila da Aceleriq", botao: "Teste de ponta a ponta" } }, pico: 0.35, som: "swish" },
  ];
  const plano = planoDeSons(pecas.map((p) => ({ pico_s: p.inicio_s + p.pico, som: p.som, prioridade: 2, ref: p.id })), { fps: FPS });
  const fontes: Record<string, unknown> = {
    exemplo: { chave: "exemplo", arquivo_id: null, nome: "Exemplo 07 com pausa", tipo: "bruto", storage_bucket: "mesa", storage_path: fonte.caminho, duracao_s: fonte.duracao, largura: LARGURA, altura: ALTURA, midia: "video" },
    trilha: { chave: "trilha", arquivo_id: null, nome: "Trilha de teste", tipo: "audio", storage_bucket: "mesa", storage_path: trilha, duracao_s: 16, largura: null, altura: null, midia: "audio" },
  };
  plano.forEach((s) => {
    const x = BIBLIOTECA_DE_SONS.find((b) => b.id === s.som)!;
    fontes[chaveDoSom(x.id)] = { chave: chaveDoSom(x.id), arquivo_id: null, nome: x.rotulo, tipo: "audio", storage_bucket: "publico", storage_path: caminhoDoSom(x), duracao_s: x.duracao_s, largura: null, altura: null, midia: "audio" };
  });
  const clipeDeAudio = (id: string, fonteK: string, ini: number, dur: number, estilo: Record<string, unknown>, volume = 1) => ({ id, fonte: fonteK, inicio_s: q(ini), entrada_s: 0, saida_s: dur, velocidade: 1, volume, texto: null, estilo, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null });
  return {
    projeto: {
      formato_versao: 2,
      titulo: "Exemplo 07",
      formato: "9:16",
      largura: LARGURA,
      altura: ALTURA,
      fps: FPS,
      fps_informado: true,
      duracao_s: duracao,
      revisao: 3,
      roteiro_id: null,
      direcao: null,
      grade: "none",
      fontes,
      trilhas: [
        { id: "video-1", tipo: "video", nome: "Vídeo", muda: false, oculta: false, clipes },
        { id: "sobreposicao-1", tipo: "sobreposicao", nome: "Motion", muda: false, oculta: false, clipes: pecas.map((p) => ({ id: p.id, fonte: null, inicio_s: p.inicio_s, entrada_s: 0, saida_s: p.dur, velocidade: 1, volume: 1, texto: null, estilo: p.estilo, transicao_entrada: null, transicao_saida: null, zoom: null, cena_ref: null, nota: null, comparar: null, origem: null })) },
        { id: "legenda-1", tipo: "legenda", nome: "Legenda", muda: false, oculta: false, clipes: legendas },
        { id: "audio-1", tipo: "audio", nome: "Trilha", muda: false, oculta: false, clipes: [clipeDeAudio("a1", "trilha", 0, duracao, { papel: "trilha" })] },
        { id: "audio-2", tipo: "audio", nome: "Efeitos", muda: false, oculta: false, clipes: plano.map((s, k) => clipeDeAudio(`a${k + 2}`, chaveDoSom(s.som), s.inicio_s, BIBLIOTECA_DE_SONS.find((b) => b.id === s.som)!.duracao_s, { papel: "efeito", som: s.som, pico_s: s.pico_s }, 0.8)) },
      ],
      atualizado_em: null,
      transcricoes: { exemplo: { segmentos: palavras, por_palavra: true, origem: "teste", versao: 1, em: null } },
      visoes: {},
      marcadores: [],
      continuidade: { personagem: null, cenario: null, referencias: [] },
      skills_aplicadas: [],
      referencias: [],
      ondas: { exemplo: { janela_s: 0.01, limiar_db: -40, chao_db: -60, duracao_s: fonte.duracao, pausas: onda.pausas, lufs: onda.lufs, em: null } },
      mixagem: { trilha_abaixo_da_voz_db: 22, subida_nas_pausas_db: 6, lufs_alvo: -14, duck: true },
    },
    cortes,
    duracao,
    plano,
  };
}

// ------------------------------------------------------------------ o teste

async function principal() {
  await rm(PASTA, { recursive: true, force: true });
  await mkdir(ARMAZEM, { recursive: true });
  assert.ok(existsSync(EXEMPLO), `Falta o vídeo de exemplo: ${EXEMPLO}`);
  const srv = await servidorDoArmazem();
  const db = await bancoComAFila();
  const fila = filaNoPGlite(db);
  const amb: Ambiente = {
    fila,
    armazem: armazemSupabase(srv.url, "chave-de-teste-local-sem-valor"),
    token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    pasta: path.join(PASTA, "trabalho"),
    chrome: process.env.RENDER_CHROME || null,
    concorrencia: Number(process.env.RENDER_CONCORRENCIA) || null,
    log,
  };
  try {
    log("preparando o vídeo de exemplo com 1 s de pausa e a trilha");
    const fonte = await prepararFonte();
    const trilha = await prepararTrilha();
    log(`fonte ${fonte.duracao} s em ${fonte.caminho}`);

    // 1) Onda (como o editor pede: render_pedir tipo onda).
    await db.query("INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, entrada) VALUES ($1, $2, 'onda', 'teste-onda-0001', $3::jsonb)", [CLIENTE, VERSAO, JSON.stringify({ fontes: [{ chave: "exemplo", bucket: "mesa", caminho: fonte.caminho }] })]);
    const r1 = await umPedido(amb, "maquina-de-teste", "teste");
    assert.equal(r1 && r1.estado, "pronto", r1 ? r1.detalhe : "fila vazia");
    const ondaLinha = (await db.query<{ resultado: { ondas: Record<string, { pausas: TrechoDeTempo[]; lufs: number | null; limiar_db: number; chao_db: number }> } }>("SELECT resultado FROM public.render_pedidos WHERE uid = 'teste-onda-0001'")).rows[0];
    const onda = ondaLinha.resultado.ondas.exemplo;
    const longa = onda.pausas.find((p) => p.de_s > 7.5 && p.ate_s < 10 && p.ate_s - p.de_s > 0.8);
    assert.ok(longa, `a pausa de 1 s no meio foi medida (pausas: ${JSON.stringify(onda.pausas.slice(0, 12))})`);
    log(`onda: limiar ${onda.limiar_db} dB, chão ${onda.chao_db} dB, ${onda.pausas.length} pausas, voz ${onda.lufs} LUFS; pausa longa ${longa!.de_s}-${longa!.ate_s} s`);

    // 2) O projeto que o editor salvaria (corte pela onda, legenda de 3, motion, sons, trilha).
    const m = montarProjeto(fonte, trilha, onda);
    const tirado = Math.round((fonte.duracao - m.duracao) * 1000) / 1000;
    log(`corte pela onda: ${m.cortes.length} cortes, ${fonte.duracao} s para ${m.duracao} s (-${tirado} s); ${m.plano.length} efeitos no pico`);
    assert.ok(tirado >= 0.8, "o corte tirou a pausa longa");

    // 3) Amostra e vídeo inteiro (o render_pedir grava o projeto do clique).
    await db.query("INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, projeto, revisao, entrada) VALUES ($1, $2, 'render_final', 'teste-render-0001', $3::jsonb, 3, '{}'::jsonb)", [CLIENTE, VERSAO, JSON.stringify(m.projeto)]);
    await db.query("INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, projeto, revisao, entrada) VALUES ($1, $2, 'amostra', 'teste-amostra-0001', $3::jsonb, 3, $4::jsonb)", [CLIENTE, VERSAO, JSON.stringify(m.projeto), JSON.stringify({ inicio_s: 1, fim_s: 10 })]);
    // Idempotência: o mesmo clique de novo não entra.
    await assert.rejects(db.query("INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, entrada) VALUES ($1, $2, 'amostra', 'teste-amostra-0001', '{}'::jsonb)", [CLIENTE, VERSAO]));

    const feitos: string[] = [];
    for (;;) {
      const r = await umPedido(amb, "maquina-de-teste", "teste");
      if (!r) break;
      log(`${r.tipo}: ${r.estado} (${r.detalhe})`);
      assert.equal(r.estado, "pronto", r.detalhe);
      feitos.push(r.tipo);
    }
    assert.deepEqual(feitos, ["amostra", "render_final"], "a amostra passa na frente do vídeo inteiro");

    // 4) Conferência do que saiu.
    const linhas = (await db.query<{ id: string; tipo: string; estado: string; saida_path: string; arquivo_id: string; resultado: Record<string, number> }>("SELECT id, tipo, estado, saida_path, arquivo_id, resultado FROM public.render_pedidos WHERE tipo <> 'onda' ORDER BY tipo")).rows;
    const provas: Record<string, unknown> = { fonte_s: fonte.duracao, cortado_para_s: m.duracao, pausas_medidas: onda.pausas.length, efeitos: m.plano.map((s) => `${s.som}@${s.pico_s}`) };
    for (const l of linhas) {
      assert.equal(l.estado, "pronto");
      assert.equal(l.saida_path, caminhoDaSaida(CLIENTE, l.id, l.tipo as "amostra" | "render_final"));
      const local = path.join(ARMAZEM, "mesa", l.saida_path);
      const s = await sondar(local);
      const lufs = await medirLoudness(local);
      const esperado = l.tipo === "amostra" ? 9 : m.duracao;
      assert.ok(s.duracao_s !== null && Math.abs(s.duracao_s - esperado) < 0.25, `${l.tipo}: duração ${s.duracao_s} s (esperado ${esperado})`);
      assert.equal(s.largura, LARGURA);
      assert.equal(s.altura, ALTURA);
      assert.ok(lufs && noAlvoDeLoudness(lufs.input_i), `${l.tipo}: ${lufs ? lufs.input_i : "sem"} LUFS (alvo -14)`);
      const arq = (await db.query<{ tipo: string; bytes: string }>("SELECT tipo, bytes FROM public.video_arquivos WHERE id = $1", [l.arquivo_id])).rows[0];
      assert.equal(arq.tipo, l.tipo === "amostra" ? "amostra" : "render");
      provas[l.tipo] = { duracao_s: s.duracao_s, lufs: lufs ? lufs.input_i : null, bytes: Number(arq.bytes), ganhos_db: l.resultado.ganhos_db, voz_lufs: l.resultado.voz_lufs };
      // Quadros de prova (legenda, lista, carimbo, cartão final).
      for (const t of l.tipo === "amostra" ? [2.5] : [1, 3.5, 7.6, m.duracao - 1]) {
        await executar("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.max(0, t)), "-i", local, "-frames:v", "1", path.join(PASTA, `quadro-${l.tipo}-${String(t).replace(".", "_")}.png`)]);
      }
    }
    const envios = srv.envios.filter((e) => e.objeto.indexOf("/video/render/") > 0);
    assert.equal(envios.length, 2);
    envios.forEach((e) => assert.equal(e.feito, e.total));
    provas.upload = envios.map((e) => ({ objeto: e.objeto, bytes: e.total, partes: e.partes.length }));
    await writeFile(path.join(PASTA, "provas.json"), JSON.stringify(provas, null, 1));
    log(`PASSOU. Provas em ${path.join(PASTA, "provas.json")}`);
    console.log(JSON.stringify(provas, null, 1));
  } finally {
    srv.fechar();
    await db.close();
  }
}

principal().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});

// Só para quem quiser conferir o tamanho de um arquivo pronto sem abrir.
export const _tamanho = async (f: string) => (await stat(f)).size;
export const _ler = readFile;
