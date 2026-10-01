/**
 * Frente CUS (01/10/2026): a migration 20260930325000 num Postgres em memória (PGlite), por cima da
 * 20260930320200. Confere: os casos novos, os sites da pesquisa, a pegada que respeita o provedor do modelo
 * (worker antigo de 4 argumentos continua funcionando e só pega o que é da Anthropic), o último erro do
 * worker e os modelos marcados com computer use no catálogo.
 *
 *   node --test testes/banco-cus.test.ts
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
INSERT INTO public.ia_modelos VALUES
  ('anthropic:claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'texto', '{"visao": true, "fonte": "manual"}'),
  ('anthropic:claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 'texto', NULL),
  ('openai:gpt-6.1-sol', 'openai', 'gpt-6.1-sol', 'texto', '{"visao": true}'),
  ('openai:gpt-6-astra', 'openai', 'gpt-6-astra', 'texto', '{"visao": true}'),
  ('openai:gpt-6-luna', 'openai', 'gpt-6-luna', 'texto', '{"visao": true}'),
  ('openrouter:anthropic/claude-sonnet-5.5', 'openrouter', 'anthropic/claude-sonnet-5.5', 'texto', '{"visao": true}');
`;

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const DONO = "99999999-9999-4999-8999-999999999999";
const TOKEN = "33333333-3333-4333-8333-333333333333";

let db: PGlite;

async function aprovada(extra: Record<string, string> = {}): Promise<string> {
  const campos: Record<string, string> = {
    client_id: `'${CLIENTE}'`,
    titulo: "'Tarefa'",
    app: "'navegador'",
    caso: "'coleta_publica'",
    url_inicial: "'https://permitido.com.br/'",
    dominios: "ARRAY['permitido.com.br']",
    objetivo: "'preços da página inicial'",
    teto_passos: "10",
    teto_custo_usd: "1",
    estado: "'aprovada'",
    aprovado_por: `'${DONO}'`,
    aprovado_em: "now()",
    ...extra,
  };
  const r = await db.query<{ id: string }>(`INSERT INTO public.agente_computador_tarefas (${Object.keys(campos).join(", ")}) VALUES (${Object.values(campos).join(", ")}) RETURNING id`);
  return r.rows[0].id;
}

const TODOS = "ARRAY['captura_site','conferir_post','coleta_publica','conferir_site','capturar_referencia','perfil_publico','concorrentes_visuais']";
const pegar = async (provedores: string | null, casos = TODOS, executor = "worker-cus") =>
  (await db.query<{ id: string }>(`SELECT id FROM public.computador_tarefa_pegar('${TOKEN}', '${executor}', ${casos}, 'cus-1.2'${provedores === null ? "" : `, ${provedores}`})`)).rows.map((r) => r.id);
const concluir = (id: string) => db.exec(`SELECT public.computador_tarefa_concluir('${id}', '${TOKEN}', 'feita', '{}'::jsonb, null)`);

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(`INSERT INTO public.profiles VALUES ('${CLIENTE}');`);
  await db.exec(tabelaOriginal());
  await db.exec(ler("20260930320200_navegador_do_agente.sql"));
  const sql = ler("20260930325000_navegador_qualquer_modelo_e_acoes.sql");
  await db.exec(sql);
  // Idempotente: rodar de novo não quebra nem duplica.
  await db.exec(sql);
});

describe("navegador com qualquer modelo no banco (migration 20260930325000)", () => {
  it("aceita os casos novos e os sites da pesquisa (até 5); caso desconhecido continua recusado", async () => {
    // Nascem esperando o dono: o teste só confere que o CHECK aceita os casos novos.
    for (const caso of ["conferir_site", "capturar_referencia", "perfil_publico"]) assert.ok(await aprovada({ caso: `'${caso}'`, estado: "'aguardando_dono'" }));
    await aprovada({ caso: "'concorrentes_visuais'", estado: "'aguardando_dono'", urls: "ARRAY['https://a.com.br/','https://b.com.br/']", dominios: "ARRAY['a.com.br','b.com.br']" });
    await assert.rejects(aprovada({ caso: "'comprar'" }), /caso_check/);
    await assert.rejects(aprovada({ urls: "ARRAY['https://a.com.br/','https://b.com.br/','https://c.com.br/','https://d.com.br/','https://e.com.br/','https://f.com.br/']" }), /urls_check/);
  });

  it("tarefa com modelo só vai para o worker que tem a chave do provedor; fixa vai para qualquer um", async () => {
    const daOpenai = await aprovada({ modelo_id: "'openai:gpt-6.1-sol'" });
    assert.deepEqual(await pegar("ARRAY['anthropic']"), [], "worker só com a chave da Anthropic não pega a tarefa da OpenAI");
    assert.deepEqual(await pegar("ARRAY['openai']"), [daOpenai]);
    await concluir(daOpenai);
    const fixa = await aprovada({ caso: "'conferir_site'", objetivo: "NULL", teto_custo_usd: "0" });
    assert.deepEqual(await pegar("ARRAY[]::text[]"), [fixa]);
    await concluir(fixa);
    const ex = await db.query<{ provedores: string[] }>("SELECT provedores FROM public.computador_executores WHERE nome = 'worker-cus'");
    assert.deepEqual(ex.rows[0].provedores, []);
  });

  it("worker antigo (4 argumentos) continua pegando, mas só o que é da Anthropic ou sem modelo", async () => {
    const daOpenai = await aprovada({ modelo_id: "'openai:gpt-6.1-sol'" });
    const semModelo = await aprovada({ modelo_id: "NULL" });
    assert.deepEqual(await pegar(null, "ARRAY['coleta_publica']", "worker-antigo"), [semModelo]);
    await concluir(semModelo);
    const daAnthropic = await aprovada({ modelo_id: "'anthropic:claude-opus-5-5'" });
    assert.deepEqual(await pegar(null, "ARRAY['coleta_publica']", "worker-antigo"), [daAnthropic]);
    await concluir(daAnthropic);
    assert.deepEqual(await pegar(null, "ARRAY['coleta_publica']", "worker-antigo"), []);
    assert.deepEqual(await pegar("ARRAY['anthropic','openai']"), [daOpenai]);
    await concluir(daOpenai);
    // Uma função só com esse nome (o PostgREST não fica em dúvida entre duas).
    const f = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'computador_tarefa_pegar'");
    assert.equal(f.rows[0].n, 1);
  });

  it("último erro do worker: grava, limpa e fica fechado para quem não é service_role", async () => {
    await pegar("ARRAY['anthropic']");
    await db.exec("SELECT public.computador_executor_erro('worker-cus', 'Falha na fila: tempo esgotado')");
    let r = await db.query<{ ultimo_erro: string | null; ultimo_erro_em: string | null }>("SELECT ultimo_erro, ultimo_erro_em FROM public.computador_executores WHERE nome = 'worker-cus'");
    assert.equal(r.rows[0].ultimo_erro, "Falha na fila: tempo esgotado");
    assert.ok(r.rows[0].ultimo_erro_em);
    await db.exec("SELECT public.computador_executor_erro('worker-cus', NULL)");
    r = await db.query("SELECT ultimo_erro, ultimo_erro_em FROM public.computador_executores WHERE nome = 'worker-cus'");
    assert.equal(r.rows[0].ultimo_erro, null);
    for (const assinatura of ["public.computador_executor_erro(text, text)", "public.computador_tarefa_pegar(uuid, text, text[], text, text[])"]) {
      const a = await db.query<{ ok: boolean }>(`SELECT has_function_privilege('authenticated', '${assinatura}', 'EXECUTE') AS ok`);
      assert.equal(a.rows[0].ok, false, assinatura);
      const s = await db.query<{ ok: boolean }>(`SELECT has_function_privilege('service_role', '${assinatura}', 'EXECUTE') AS ok`);
      assert.equal(s.rows[0].ok, true, assinatura);
    }
  });

  it("catálogo: computer_use só nos 4 diretos que fazem; o resto dos recursos fica", async () => {
    const r = await db.query<{ id: string; recursos: Record<string, unknown> | null }>("SELECT id, recursos FROM public.ia_modelos ORDER BY id");
    const com = r.rows.filter((x) => x.recursos && x.recursos.computer_use === true).map((x) => x.id).sort();
    assert.deepEqual(com, ["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5", "openai:gpt-6-astra", "openai:gpt-6.1-sol"]);
    const sonnet = r.rows.find((x) => x.id === "anthropic:claude-sonnet-5-5");
    assert.equal(sonnet && sonnet.recursos && sonnet.recursos.fonte, "manual");
  });
});

