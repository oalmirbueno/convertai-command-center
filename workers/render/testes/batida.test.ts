/**
 * Batida do worker de render e migration do Estado dos motores (frente MTR).
 * Rodar: npm run teste (na pasta workers/render). Nada toca o banco de produção.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { baterPonto, faltasDoRender, type CapacidadesDoRender } from "../batida.ts";
import { RAIZ_DO_REPO } from "../trabalho.ts";
import { bancoComAFila } from "./banco.ts";

const MIGRATION = path.join(RAIZ_DO_REPO, "supabase", "migrations", "20260930316000_estado_dos_motores.sql");
const semNotify = (s: string) => s.replace(/NOTIFY pgrst[^;]*;/g, "");

/** Fila de render (EDT) + motor de código (SIT) + a migration da frente MTR (duas vezes: idempotente). */
async function bancoDosMotores() {
  const db = await bancoComAFila();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE OR REPLACE FUNCTION app_private.rpc_trusted_backend() RETURNS boolean LANGUAGE sql AS 'SELECT true';
  `);
  await db.exec(semNotify(readFileSync(path.join(RAIZ_DO_REPO, "supabase", "migrations", "20260930090000_motor_de_codigo.sql"), "utf8")));
  const sql = semNotify(readFileSync(MIGRATION, "utf8"));
  await db.exec(sql);
  await db.exec(sql);
  return db;
}

test("a migration amplia render_workers, roda duas vezes e recusa capacidades que não são objeto", async () => {
  const db = await bancoDosMotores();
  await db.query("INSERT INTO public.render_workers (nome, versao, capacidades, pedido_id, iniciado_em) VALUES ('maquina-render', 'edt-1.0+mot-1.0+mtr-1', '{\"ffmpeg\": true}'::jsonb, NULL, now())");
  const linha = (await db.query<{ capacidades: { ffmpeg: boolean } }>("SELECT capacidades FROM public.render_workers WHERE nome = 'maquina-render'")).rows[0];
  assert.equal(linha.capacidades.ffmpeg, true);
  await assert.rejects(db.query("INSERT INTO public.render_workers (nome, capacidades) VALUES ('outra', '[1,2]'::jsonb)"), /render_workers_capacidades_check/);
  // A pegada da fila (RPC da frente EDT) continua gravando o worker sem as colunas novas.
  await db.query("SELECT * FROM public.render_pedidos_pegar(gen_random_uuid(), 'maquina-render', 600, 'edt-1.0')");
  const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.render_workers")).rows[0].n;
  assert.equal(n, 1);
  await db.close();
});

test("a batida grava a linha completa; sem as colunas novas, grava a mínima e não derruba o worker", async () => {
  const gravados: Record<string, unknown>[] = [];
  let semColunas = true;
  const falso = {
    from(tabela: string) {
      assert.equal(tabela, "render_workers");
      return {
        async upsert(linha: Record<string, unknown>) {
          if (semColunas && "capacidades" in linha) return { error: { message: "column \"capacidades\" of relation \"render_workers\" does not exist" } };
          gravados.push(linha);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  const caps: CapacidadesDoRender = { node: "v24", ffmpeg: true, ffprobe: true, hyperframes: true, gsap: true, chrome: "do_remotion", faltas: [] };
  assert.equal(await baterPonto(falso, "maquina", "edt-1.0+mot-1.0+mtr-1", caps, { pedido_id: null, iniciado_em: "2026-09-30T19:00:00Z" }), true);
  assert.deepEqual(Object.keys(gravados[0]).sort(), ["nome", "versao", "visto_em"]);
  semColunas = false;
  assert.equal(await baterPonto(falso, "maquina", "edt-1.0+mot-1.0+mtr-1", caps, { pedido_id: "p1", iniciado_em: "2026-09-30T19:00:00Z" }), true);
  assert.equal(gravados[1].pedido_id, "p1");
  assert.deepEqual(gravados[1].capacidades, caps);
});

test("o que falta na máquina sai em português, por peça", () => {
  assert.deepEqual(faltasDoRender({ ffmpeg: true, ffprobe: true, hyperframes: true, gsap: true, chrome: "do_remotion" }), []);
  const f = faltasDoRender({ ffmpeg: false, ffprobe: true, hyperframes: false, gsap: false, chrome: "caminho_invalido" });
  assert.equal(f.length, 4);
  assert.match(f[0], /ffmpeg/);
  assert.match(f[1], /HyperFrames/);
  assert.match(f[2], /GSAP/);
  assert.match(f[3], /RENDER_CHROME/);
});

test("motor de código: a pegada solta o trabalho órfão, cancela a fila esquecida e deixa o vivo em paz", async () => {
  const db = await bancoDosMotores();
  const C = "11111111-1111-4111-8111-111111111111";
  const ins = (id: string, projeto: string, estado: string, criado: string, pego: string | null, executor: string | null) =>
    db.query(
      "INSERT INTO public.motor_trabalhos (id, client_id, projeto, tipo, estado, criado_em, pego_em, executor, teto_usd) VALUES ($1, $2, $3, 'construir', $4, now() - $5::interval, CASE WHEN $6::text IS NULL THEN NULL ELSE now() - $6::interval END, $7, 1)",
      [id, C, projeto, estado, criado, pego, executor],
    );
  const ORFAO = "a0000000-0000-4000-8000-000000000001";
  const VIVO = "a0000000-0000-4000-8000-000000000002";
  const VELHO = "a0000000-0000-4000-8000-000000000003";
  const NOVO = "a0000000-0000-4000-8000-000000000004";
  const PARANDO = "a0000000-0000-4000-8000-000000000005";
  await ins(ORFAO, "site-orfao", "executando", "30 minutes", "20 minutes", "pc-caiu");
  await ins(VIVO, "site-vivo", "executando", "30 minutes", "20 minutes", "pc-vivo");
  await ins(VELHO, "site-velho", "na_fila", "3 days", null, null);
  await ins(NOVO, "site-orfao", "na_fila", "5 minutes", null, null);
  await ins(PARANDO, "site-parando", "parando", "40 minutes", "30 minutes", "pc-caiu");
  await db.query(`INSERT INTO public.motor_executores (nome, visto_em, trabalho_id) VALUES ('pc-caiu', now(), NULL), ('pc-vivo', now() - interval '20 seconds', $1)`, [VIVO]);

  const pego = (await db.query<{ id: string; estado: string }>("SELECT id, estado FROM public.motor_pegar_trabalho('pc-novo', ARRAY['site'])")).rows;
  // O órfão soltou o projeto: o trabalho novo do MESMO projeto já pode ser pego.
  assert.deepEqual(pego.map((p) => [p.id, p.estado]), [[NOVO, "executando"]]);
  const estado = async (id: string) => (await db.query<{ estado: string; erro: string | null }>("SELECT estado, erro FROM public.motor_trabalhos WHERE id = $1", [id])).rows[0];
  const orfao = await estado(ORFAO);
  assert.equal(orfao.estado, "falhou");
  assert.match(String(orfao.erro), /motor parou no meio/);
  assert.equal((await estado(PARANDO)).estado, "parado");
  assert.equal((await estado(VIVO)).estado, "executando");
  const velho = await estado(VELHO);
  assert.equal(velho.estado, "cancelado");
  assert.match(String(velho.erro), /mais de 2 dias na fila/);
  const fins = (await db.query<{ trabalho_id: string; dados: { motivo: string } }>("SELECT trabalho_id, dados FROM public.motor_eventos WHERE tipo = 'fim' ORDER BY trabalho_id")).rows;
  assert.deepEqual(fins.map((f) => [f.trabalho_id, f.dados.motivo]), [[ORFAO, "motor_caiu"], [VELHO, "expirou_na_fila"], [PARANDO, "motor_caiu"]]);
  // Uma segunda pegada não repete os eventos.
  await db.query("SELECT * FROM public.motor_pegar_trabalho('pc-novo', ARRAY['site'])");
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.motor_eventos WHERE tipo = 'fim'")).rows[0].n, 3);
  await db.close();
});
