/**
 * Horário comercial do Ego (26/10/2026): a migration 20261026200000 num Postgres em memória (PGlite), por
 * cima das do navegador do agente e do navegador do PC. Confere que pedido agendado não sai antes da hora,
 * sai na hora por ordem de prioridade, não é cancelado pelo corte de 24 h antes de contar da hora agendada,
 * que tarefa antiga (sem agendamento) continua saindo como antes e que a migration roda duas vezes.
 *
 *   node --test testes/banco-horario.test.ts
 */

import { before, beforeEach, describe, it } from "node:test";
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
let db: PGlite;
let n = 0;

/** Pedido do PC; quando: SQL da hora agendada (null = sem agendamento). */
async function pedido(quando: string | null, prioridade = 2, aprovadoEm = "now()"): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.agente_computador_tarefas (titulo, app, caso, passos, url_inicial, dominios, teto_passos, teto_custo_usd, estado, aprovado_por, aprovado_em, origem, executar_a_partir_de, prioridade)
     VALUES ('Navegador do PC', 'navegador', 'pc_ego', '[{"acao":"navegar","url":"https://adsmanager.facebook.com/"},{"acao":"ler"}]'::jsonb,
             'https://adsmanager.facebook.com/', ARRAY['facebook.com'], 6, 0, 'aprovada', '${DONO}', ${aprovadoEm}, 'mcp', ${quando ?? "NULL"}, ${prioridade}) RETURNING id`,
  );
  return r.rows[0].id;
}

const pegar = async () => {
  n += 1;
  const token = `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
  return (await db.query<{ id: string }>(`SELECT id FROM public.computador_tarefa_pegar('${token}', 'DESKTOP-teste', ARRAY['pc_ego'], 'cus-1.4', ARRAY[]::text[])`)).rows;
};

const estado = async (id: string) => (await db.query<{ estado: string }>(`SELECT estado FROM public.agente_computador_tarefas WHERE id = '${id}'`)).rows[0].estado;

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(tabelaOriginal());
  await db.exec(ler("20260930320200_navegador_do_agente.sql"));
  await db.exec(ler("20260930325000_navegador_qualquer_modelo_e_acoes.sql"));
  await db.exec(ler("20261026150500_navegador_do_pc_ego.sql"));
  const sql = ler("20261026200000_ego_horario_comercial.sql");
  await db.exec(sql);
  await db.exec(sql); // idempotente
});

beforeEach(async () => {
  await db.exec("UPDATE public.agente_computador_tarefas SET estado = 'cancelada' WHERE estado IN ('aprovada', 'executando')");
});

describe("horário comercial do Ego no banco (migration 20261026200000)", () => {
  it("agendado para depois não sai; ao dar a hora, sai", async () => {
    const id = await pedido("now() + interval '10 hours'");
    assert.deepEqual(await pegar(), []);
    assert.equal(await estado(id), "aprovada");
    await db.exec(`UPDATE public.agente_computador_tarefas SET executar_a_partir_de = now() - interval '1 second' WHERE id = '${id}'`);
    const r = await pegar();
    assert.equal(r.length, 1);
    assert.equal(r[0].id, id);
  });

  it("na abertura, sai por prioridade (alta antes de normal antes de baixa), depois pela hora", async () => {
    const baixa = await pedido("now() - interval '5 minutes'", 3, "now() - interval '3 hours'");
    const normal = await pedido("now() - interval '5 minutes'", 2, "now() - interval '2 hours'");
    const alta = await pedido("now() - interval '5 minutes'", 1, "now() - interval '1 hour'");
    assert.equal((await pegar())[0].id, alta);
    assert.equal((await pegar())[0].id, normal);
    assert.equal((await pegar())[0].id, baixa);
  });

  it("pedido de sexta à noite não morre no corte de 24 h antes de segunda: conta da hora agendada", async () => {
    const id = await pedido("now() + interval '2 hours'", 2, "now() - interval '62 hours'");
    assert.deepEqual(await pegar(), []);
    assert.equal(await estado(id), "aprovada");
    // Já passou mais de um dia da hora agendada sem executor: sai da fila com motivo.
    await db.exec(`UPDATE public.agente_computador_tarefas SET executar_a_partir_de = now() - interval '25 hours' WHERE id = '${id}'`);
    assert.deepEqual(await pegar(), []);
    assert.equal(await estado(id), "cancelada");
  });

  it("tarefa sem agendamento sai como antes; prioridade inválida é recusada", async () => {
    const id = await pedido(null);
    assert.equal((await pegar())[0].id, id);
    await assert.rejects(pedido(null, 7), /prioridade_check/);
  });
});
