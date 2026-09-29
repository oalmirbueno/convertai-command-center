/**
 * A fila de render de verdade (frente EDT): a migration roda num Postgres em
 * memória (PGlite) com um esqueleto das tabelas do painel, e o teste confere a
 * idempotência (um pedido por clique, um ativo por versão e tipo), a trava
 * (SKIP LOCKED + prazo + token), a volta do pedido de worker que caiu e o teto
 * de tentativas. Rodar: npm run teste (na pasta workers/render).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { RAIZ_DO_REPO } from "../trabalho.ts";
import { bancoComAFila, CLIENTE, VERSAO } from "./banco.ts";

const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function pedir(db: PGlite, uid: string, tipo = "render_final") {
  return db.query(`INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, projeto, entrada) VALUES ($1, $2, $3, $4, '{"fps":25}'::jsonb, '{}'::jsonb) RETURNING id`, [CLIENTE, VERSAO, tipo, uid]);
}
const pegar = async (db: PGlite, token: string) => (await db.query<{ id: string; tipo: string; estado: string; tentativas: number }>(`SELECT * FROM public.render_pedidos_pegar($1, 'maquina', 600, 'teste')`, [token])).rows;
const progresso = async (db: PGlite, id: string, token: string) => (await db.query<{ r: boolean }>(`SELECT public.render_pedidos_progresso($1, $2, 'renderizando', 0.5) AS r`, [id, token])).rows[0].r;

test("idempotência: um pedido por clique e um ativo por versão e tipo", async () => {
  const db = await bancoComAFila();
  const a = await pedir(db, "clique-0001");
  assert.equal(a.rows.length, 1);
  await assert.rejects(pedir(db, "clique-0001"), /duplicate key|unique/i);
  await assert.rejects(pedir(db, "clique-0002"), /render_pedidos_ativo_unico|duplicate key/i);
  // Outro tipo da mesma versão pode (a amostra não espera o vídeo inteiro).
  await pedir(db, "clique-0003", "amostra");
  const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.render_pedidos")).rows[0].n;
  assert.equal(n, 2);
});

test("trava: quem pegou trabalha sozinho; outro worker não pega o mesmo pedido", async () => {
  const db = await bancoComAFila();
  await pedir(db, "clique-0100");
  const um = await pegar(db, TOKEN_A);
  assert.equal(um.length, 1);
  assert.equal(um[0].estado, "rodando");
  assert.equal((await pegar(db, TOKEN_B)).length, 0);
  assert.equal(await progresso(db, um[0].id, TOKEN_B), false);
  assert.equal(await progresso(db, um[0].id, TOKEN_A), true);
  const w = (await db.query<{ nome: string }>("SELECT nome FROM public.render_workers")).rows;
  assert.deepEqual(w.map((x) => x.nome), ["maquina"]);
});

test("worker que caiu: a trava vence, outro retoma com tentativas + 1 e o velho não escreve mais", async () => {
  const db = await bancoComAFila();
  await pedir(db, "clique-0200");
  const [p] = await pegar(db, TOKEN_A);
  await db.query("UPDATE public.render_pedidos SET trava_ate = now() - interval '1 second' WHERE id = $1", [p.id]);
  const [q] = await pegar(db, TOKEN_B);
  assert.equal(q.id, p.id);
  assert.equal(q.tentativas, 1);
  assert.equal(await progresso(db, p.id, TOKEN_A), false);
  const ok = (await db.query<{ r: boolean }>(`SELECT public.render_pedidos_concluir($1, $2, 'x/video/render/p.mp4', NULL, '{"lufs_final":-14}'::jsonb) AS r`, [p.id, TOKEN_A])).rows[0].r;
  assert.equal(ok, false, "token velho não conclui");
  const ok2 = (await db.query<{ r: boolean }>(`SELECT public.render_pedidos_concluir($1, $2, 'x/video/render/p.mp4', NULL, '{"lufs_final":-14}'::jsonb) AS r`, [p.id, TOKEN_B])).rows[0].r;
  assert.equal(ok2, true);
  const fim = (await db.query<{ estado: string; progresso: string }>("SELECT estado, progresso FROM public.render_pedidos WHERE id = $1", [p.id])).rows[0];
  assert.equal(fim.estado, "pronto");
  // Pronto libera a versão para um pedido novo.
  await pedir(db, "clique-0201");
});

test("teto de tentativas: a trava vence na última tentativa e vira erro (sem laço)", async () => {
  const db = await bancoComAFila();
  await pedir(db, "clique-0300");
  const [p] = await pegar(db, TOKEN_A);
  await db.query("UPDATE public.render_pedidos SET tentativas = 2, trava_ate = now() - interval '1 second' WHERE id = $1", [p.id]);
  assert.equal((await pegar(db, TOKEN_B)).length, 0);
  const r = (await db.query<{ estado: string; erro_codigo: string }>("SELECT estado, erro_codigo FROM public.render_pedidos WHERE id = $1", [p.id])).rows[0];
  assert.deepEqual(r, { estado: "erro", erro_codigo: "tentativas_esgotadas" });
});

test("cancelado no meio: o progresso devolve false e o worker para", async () => {
  const db = await bancoComAFila();
  await pedir(db, "clique-0400");
  const [p] = await pegar(db, TOKEN_A);
  await db.query("UPDATE public.render_pedidos SET estado = 'cancelado' WHERE id = $1", [p.id]);
  assert.equal(await progresso(db, p.id, TOKEN_A), false);
});

test("ordem: a onda e a amostra passam na frente do vídeo inteiro", async () => {
  const db = await bancoComAFila();
  await pedir(db, "clique-0500", "render_final");
  await pedir(db, "clique-0501", "amostra");
  await pedir(db, "clique-0502", "onda");
  const tipos: string[] = [];
  for (let k = 0; k < 3; k++) {
    const [p] = await pegar(db, `cccccccc-cccc-4ccc-8ccc-00000000000${k}`);
    tipos.push(p.tipo);
  }
  assert.deepEqual(tipos, ["onda", "amostra", "render_final"]);
});

test("a migration amplia o tipo de video_arquivos sem perder os antigos e roda duas vezes", async () => {
  const db = await bancoComAFila();
  const sql = readFileSync(path.join(RAIZ_DO_REPO, "supabase", "migrations", "20260930080000_render_pedidos.sql"), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");
  // Um tipo que outra frente pôs depois (não está na lista desta migration) não pode sumir ao rodar de novo.
  await db.exec(`ALTER TABLE public.video_arquivos DROP CONSTRAINT video_arquivos_tipo_check; ALTER TABLE public.video_arquivos ADD CONSTRAINT video_arquivos_tipo_check CHECK (tipo = ANY ('{bruto,take,gerado,audio,entrega,angulo,quadro,render,amostra,elemento,de_outra_frente}'::text[]));`);
  await db.exec(sql);
  const def = (await db.query<{ d: string }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'video_arquivos_tipo_check'")).rows[0].d;
  ["bruto", "angulo", "quadro", "render", "amostra", "elemento", "de_outra_frente"].forEach((t) => assert.match(def, new RegExp(`[{,']${t}[},']`)));
});
