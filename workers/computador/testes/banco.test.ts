/**
 * A migration de verdade do navegador do agente (20260930320200) num Postgres
 * em memória (PGlite), com o esqueleto das tabelas do painel. Confere as
 * travas no banco: sem o Confirmar do dono o worker não pega; teto de passos
 * e de custo; Parar vence o worker; CHECKs; ia_usos aceita 'computador'.
 *
 *   node --test testes/banco.test.ts
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ler = (arq: string) => readFileSync(path.join(RAIZ, "supabase", "migrations", arq), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");

/** A tabela como a Mesa Vídeos criou (o CREATE TABLE sai do próprio arquivo da migration). */
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
CREATE TABLE public.ia_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa text NOT NULL,
  agente text NOT NULL,
  CONSTRAINT ia_usos_tarefa_check CHECK (tarefa = ANY (ARRAY['calendario', 'estudio', 'conversa', 'site', 'documento'])),
  CONSTRAINT ia_usos_agente_check CHECK (agente = ANY (ARRAY['estrategista', 'leitor', 'site', 'documento']))
);
`;

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const DONO = "99999999-9999-4999-8999-999999999999";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const OUTRO = "44444444-4444-4444-8444-444444444444";

let db: PGlite;

async function nova(extra: Record<string, string> = {}): Promise<string> {
  const campos: Record<string, string> = {
    client_id: `'${CLIENTE}'`,
    titulo: "'Capturar a tela inteira: permitido.com.br'",
    app: "'navegador'",
    caso: "'captura_site'",
    url_inicial: "'https://permitido.com.br/'",
    dominios: "ARRAY['permitido.com.br']",
    teto_passos: "3",
    teto_custo_usd: "0",
    ...extra,
  };
  const r = await db.query<{ id: string }>(`INSERT INTO public.agente_computador_tarefas (${Object.keys(campos).join(", ")}) VALUES (${Object.values(campos).join(", ")}) RETURNING id`);
  return r.rows[0].id;
}

const pegar = async (casos = "ARRAY['captura_site','conferir_post']") =>
  (await db.query<{ id: string; estado: string }>(`SELECT id, estado FROM public.computador_tarefa_pegar('${TOKEN}', 'worker-teste', ${casos}, 'mod-1.0')`)).rows;
const passo = async (id: string, custo = 0, token = TOKEN) =>
  (await db.query<{ r: string }>(`SELECT public.computador_tarefa_passo('${id}', '${token}', '{"passo":1,"storage_path":"x.png"}'::jsonb, ${custo}) AS r`)).rows[0].r;
const concluir = async (id: string, token = TOKEN) =>
  (await db.query<{ r: boolean }>(`SELECT public.computador_tarefa_concluir('${id}', '${token}', 'feita', '{"ok":true}'::jsonb, null) AS r`)).rows[0].r;
const estado = async (id: string) => (await db.query<{ estado: string }>(`SELECT estado FROM public.agente_computador_tarefas WHERE id = '${id}'`)).rows[0].estado;

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(`INSERT INTO public.profiles VALUES ('${CLIENTE}');`);
  await db.exec(tabelaOriginal());
  const sql = ler("20260930320200_navegador_do_agente.sql");
  await db.exec(sql);
  // Idempotente: rodar de novo não quebra.
  await db.exec(sql);
});

describe("navegador do agente no banco (migration 20260930320200)", () => {
  it("sem o Confirmar do dono o worker não pega; com ele, pega e trava", async () => {
    const esperando = await nova();
    const semQuem = await nova();
    await db.exec(`UPDATE public.agente_computador_tarefas SET estado = 'aprovada' WHERE id = '${semQuem}'`);
    assert.equal((await pegar()).length, 0);
    const aprovada = await nova();
    await db.exec(`UPDATE public.agente_computador_tarefas SET estado = 'aprovada', aprovado_por = '${DONO}', aprovado_em = now() WHERE id = '${aprovada}'`);
    // Caso que o worker não sabe fazer: fica na fila.
    assert.equal((await pegar("ARRAY['conferir_post']")).length, 0);
    const linhas = await pegar();
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].id, aprovada);
    assert.equal(linhas[0].estado, "executando");
    assert.equal(await estado(esperando), "aguardando_dono");
    const ex = await db.query<{ nome: string }>("SELECT nome FROM public.computador_executores");
    assert.deepEqual(ex.rows.map((r) => r.nome), ["worker-teste"]);
    await concluir(aprovada);
  });

  it("teto de passos e de custo: a RPC manda parar no limite", async () => {
    const id = await nova({ caso: "'coleta_publica'", objetivo: "'preços da página inicial'", teto_passos: "3", teto_custo_usd: "0.05", estado: "'aprovada'", aprovado_por: `'${DONO}'`, aprovado_em: "now()" });
    assert.equal((await pegar("ARRAY['coleta_publica']")).length, 1);
    assert.equal(await passo(id, 0.01), "seguir");
    assert.equal(await passo(id, 0.05), "teto");
    const t = await db.query<{ passos_feitos: number; custo_usd: string; provas: unknown[] }>(`SELECT passos_feitos, custo_usd, provas FROM public.agente_computador_tarefas WHERE id = '${id}'`);
    assert.equal(t.rows[0].passos_feitos, 2);
    assert.equal(Number(t.rows[0].custo_usd), 0.06);
    assert.equal((t.rows[0].provas as unknown[]).length, 2);
    await concluir(id);
    const id2 = await nova({ estado: "'aprovada'", aprovado_por: `'${DONO}'`, aprovado_em: "now()" });
    assert.equal((await pegar()).length, 1);
    assert.equal(await passo(id2), "seguir");
    assert.equal(await passo(id2), "seguir");
    assert.equal(await passo(id2), "teto");
    await concluir(id2);
  });

  it("Parar vence o worker: o passo seguinte diz 'parar' e 'feita' não sobrescreve", async () => {
    const id = await nova({ estado: "'aprovada'", aprovado_por: `'${DONO}'`, aprovado_em: "now()" });
    assert.equal((await pegar()).length, 1);
    assert.equal(await passo(id), "seguir");
    await db.exec(`UPDATE public.agente_computador_tarefas SET estado = 'cancelada', motivo = 'Parada no passo 1.' WHERE id = '${id}'`);
    assert.equal(await passo(id), "parar");
    assert.equal(await concluir(id), false);
    assert.equal(await estado(id), "cancelada");
  });

  it("token de outro worker não grava passo nem conclusão", async () => {
    const id = await nova({ estado: "'aprovada'", aprovado_por: `'${DONO}'`, aprovado_em: "now()" });
    assert.equal((await pegar()).length, 1);
    assert.equal(await passo(id, 0, OUTRO), "parar");
    assert.equal(await concluir(id, OUTRO), false);
    assert.equal(await concluir(id), true);
    assert.equal(await estado(id), "feita");
  });

  it("CHECKs: caso desconhecido, tarefa de navegador sem domínio e teto acima do máximo são recusados", async () => {
    await assert.rejects(nova({ caso: "'comprar'" }), /caso_check/);
    await assert.rejects(nova({ dominios: "'{}'::text[]" }), /navegador_check/);
    await assert.rejects(nova({ url_inicial: "'file:///c:/x'" }), /navegador_check/);
    await assert.rejects(nova({ teto_passos: "61" }), /tetos_check/);
    await assert.rejects(nova({ teto_custo_usd: "6" }), /tetos_check/);
  });

  it("ia_usos aceita 'computador' como tarefa e agente, sem perder os valores de antes", async () => {
    await db.exec("INSERT INTO public.ia_usos (tarefa, agente) VALUES ('computador', 'computador'), ('site', 'site')");
    await assert.rejects(db.exec("INSERT INTO public.ia_usos (tarefa, agente) VALUES ('outra', 'computador')"), /ia_usos_tarefa_check/);
  });

  it("a escrita é só da service_role: as RPCs não ficam abertas para authenticated", async () => {
    const r = await db.query<{ ok: boolean }>("SELECT has_function_privilege('authenticated', 'public.computador_tarefa_pegar(uuid, text, text[], text)', 'EXECUTE') AS ok");
    assert.equal(r.rows[0].ok, false);
    const s = await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', 'public.computador_tarefa_passo(uuid, uuid, jsonb, numeric)', 'EXECUTE') AS ok");
    assert.equal(s.rows[0].ok, true);
  });
});
