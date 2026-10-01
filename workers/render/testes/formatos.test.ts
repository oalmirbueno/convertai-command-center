/**
 * Render por formato (frente EDT, rodada 2): a migration 20260930319000 troca
 * "um ativo por versão e tipo" por "um ativo por versão, tipo e formato". O
 * teste roda as duas migrations de verdade num Postgres em memória (PGlite).
 * Rodar: npm run teste (na pasta workers/render).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { bancoComFormatos, CLIENTE, VERSAO } from "./banco.ts";

async function pedir(db: PGlite, uid: string, formato: string | null, tipo = "render_final") {
  const entrada = formato ? JSON.stringify({ formato }) : "{}";
  return db.query(`INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, projeto, entrada) VALUES ($1, $2, $3, $4, '{"fps":25}'::jsonb, $5::jsonb) RETURNING id`, [CLIENTE, VERSAO, tipo, uid, entrada]);
}

test("vários formatos da mesma versão ficam na fila juntos; o mesmo formato, só um", async () => {
  const db = await bancoComFormatos();
  await pedir(db, "clique-f001", null);
  await pedir(db, "clique-f002", "1:1");
  await pedir(db, "clique-f003", "16:9");
  await assert.rejects(pedir(db, "clique-f004", "1:1"), /render_pedidos_ativo_por_formato|duplicate key/i);
  await assert.rejects(pedir(db, "clique-f005", null), /render_pedidos_ativo_por_formato|duplicate key/i);
  const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.render_pedidos")).rows[0].n;
  assert.equal(n, 3);
  // O índice antigo sumiu (senão o segundo formato esperaria o primeiro).
  const antigos = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'render_pedidos_ativo_unico'")).rows[0].n;
  assert.equal(antigos, 0);
});

test("pedido que terminou libera o formato; a migration roda duas vezes sem erro", async () => {
  const db = await bancoComFormatos();
  const a = await pedir(db, "clique-f101", "9:16");
  await db.query("UPDATE public.render_pedidos SET estado = 'pronto' WHERE id = $1", [(a.rows[0] as { id: string }).id]);
  await pedir(db, "clique-f102", "9:16");
  await bancoComFormatos(db);
});

test("na Mídia, o nome do render diz o formato; a letra da marca só vem da pasta do cliente ou da biblioteca", async () => {
  const { letraDaMarcaParaBaixar, nomeDoRender } = await import("../trabalho.ts");
  assert.equal(nomeDoRender("Reel do café", false, "1:1"), "Reel do café (render 1:1)");
  assert.equal(nomeDoRender("Reel do café", true, "9:16"), "Reel do café (amostra 9:16)");
  assert.equal(nomeDoRender("Reel do café", false, null), "Reel do café (render)");
  const projeto = (fonte_path: string, fonte: string | null = "Bebas Neue") => ({ fps: 25, largura: 1080, altura: 1920, duracao_s: 1, fontes: {}, trilhas: [], identidade: { fonte, fonte_path } });
  assert.equal(letraDaMarcaParaBaixar(projeto(`${CLIENTE}/fontes/bebas.otf`), CLIENTE), `${CLIENTE}/fontes/bebas.otf`);
  assert.equal(letraDaMarcaParaBaixar(projeto("biblioteca/fontes/roboto/Roboto-Regular.ttf"), CLIENTE), "biblioteca/fontes/roboto/Roboto-Regular.ttf");
  assert.equal(letraDaMarcaParaBaixar(projeto("22222222-2222-4222-8222-222222222222/fontes/x.ttf"), CLIENTE), null);
  assert.equal(letraDaMarcaParaBaixar(projeto(`${CLIENTE}/../x.ttf`), CLIENTE), null);
  assert.equal(letraDaMarcaParaBaixar(projeto(`${CLIENTE}/fontes/bebas.otf`, null), CLIENTE), null);
});
