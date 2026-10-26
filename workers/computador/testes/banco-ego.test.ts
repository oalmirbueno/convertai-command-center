/**
 * Navegador do PC (26/10/2026): a migration 20261026150500 num Postgres em memória (PGlite), por cima das
 * do navegador do agente. Confere que o caso pc_ego entra na fila, que só o worker que anuncia o caso
 * pega, que o sinal do executor guarda o caso (o MCP usa isso para saber se o PC está ligado) e que um
 * caso desconhecido continua recusado.
 *
 *   node --test testes/banco-ego.test.ts
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ler = (arq: string) => readFileSync(path.join(RAIZ, "supabase", "migrations", arq), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");

function tabelaOriginal(): string {
  const sql = ler("20260926031100_mesa_videos.sql");
  const ini = sql.indexOf("CREATE TABLE IF NOT EXISTS public.agente_computador_tarefas");
  const fim = sql.indexOf(");", ini);
  return sql.slice(ini, fim + 2);
}

const ESQUELETO = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE TABLE public.ia_usos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tarefa text NOT NULL, agente text NOT NULL);
CREATE TABLE public.ia_modelos (id text PRIMARY KEY, provedor text NOT NULL, modelo_api text NOT NULL, tipo text NOT NULL, recursos jsonb);
`;

const DONO = "99999999-9999-4999-8999-999999999999";
const TOKEN = "33333333-3333-4333-8333-333333333333";
let db: PGlite;

async function pedidoDoPc(caso = "'pc_ego'"): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.agente_computador_tarefas (titulo, app, caso, passos, url_inicial, dominios, teto_passos, teto_custo_usd, estado, aprovado_por, aprovado_em, origem)
     VALUES ('Navegador do PC: adsmanager.facebook.com', 'navegador', ${caso}, '[{"acao":"navegar","url":"https://adsmanager.facebook.com/"},{"acao":"ler"}]'::jsonb,
             'https://adsmanager.facebook.com/', ARRAY['facebook.com'], 6, 0, 'aprovada', '${DONO}', now(), 'mcp') RETURNING id`,
  );
  return r.rows[0].id;
}

const pegar = async (casos: string, executor: string) =>
  (await db.query<{ id: string; passos: unknown }>(`SELECT id, passos FROM public.computador_tarefa_pegar('${TOKEN}', '${executor}', ${casos}, 'cus-1.3', ARRAY[]::text[])`)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(tabelaOriginal());
  await db.exec(ler("20260930320200_navegador_do_agente.sql"));
  await db.exec(ler("20260930325000_navegador_qualquer_modelo_e_acoes.sql"));
  const sql = ler("20261026150500_navegador_do_pc_ego.sql");
  await db.exec(sql);
  await db.exec(sql); // idempotente
});

describe("navegador do PC no banco (migration 20261026150500)", () => {
  it("aceita o caso pc_ego e continua recusando caso desconhecido", async () => {
    assert.ok(await pedidoDoPc());
    await assert.rejects(pedidoDoPc("'comprar'"), /caso_check/);
  });

  it("só o worker que anuncia pc_ego pega o pedido, com os passos; o sinal guarda o caso", async () => {
    await db.exec("UPDATE public.agente_computador_tarefas SET estado = 'cancelada' WHERE estado = 'aprovada'");
    const id = await pedidoDoPc();
    assert.deepEqual(await pegar("ARRAY['captura_site','conferir_post']", "worker-antigo"), []);
    const r = await pegar("ARRAY['captura_site','pc_ego']", "DESKTOP-teste-navegador");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, id);
    assert.equal((r[0].passos as unknown[]).length, 2);
    const ex = await db.query<{ casos: string[] }>("SELECT casos FROM public.computador_executores WHERE nome = 'DESKTOP-teste-navegador'");
    assert.ok(ex.rows[0].casos.indexOf("pc_ego") >= 0);
    const ok = await db.query<{ ok: boolean }>(`SELECT public.computador_tarefa_concluir('${id}', '${TOKEN}', 'feita', '{"motor":"ego"}'::jsonb, null) AS ok`);
    assert.equal(ok.rows[0].ok, true);
  });
});
