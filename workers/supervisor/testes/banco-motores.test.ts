/**
 * Frente SUP: a migration 20260930326000 num Postgres em memória (PGlite).
 * Confere: código de uso único e com prazo, revogação, limite de tentativas,
 * máquina registrada pelo pareamento e pela batida (modo migrar), remoção que a
 * batida devolve como "revogada", motores por máquina, versão alvo, auditoria,
 * só admin na tela e nada de hash na leitura do admin.
 *
 *   node --test testes/banco-motores.test.ts
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// O PGlite vem das devDependencies do worker de render (o supervisor não tem dependência nenhuma).
interface PGlite {
  exec(q: string): Promise<unknown>;
  query<T>(q: string): Promise<{ rows: T[] }>;
}
async function carregarPGlite(): Promise<new () => PGlite> {
  const nome = "@electric-sql/pglite";
  try {
    return (await import(nome)).PGlite;
  } catch {
    const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "render", "package.json"));
    return (await import(pathToFileURL(req.resolve(nome)).href)).PGlite;
  }
}
const PGlite = await carregarPGlite();

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sql = readFileSync(path.join(RAIZ, "supabase", "migrations", "20260930326000_aceleriq_motores.sql"), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EQUIPE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ESQUELETO = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('teste.uid', true), '')::uuid $f$;
CREATE TYPE public.app_role AS ENUM ('admin', 'client', 'design', 'traffic', 'manager');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
INSERT INTO public.profiles VALUES ('${ADMIN}', 'Almir'), ('${EQUIPE}', 'Equipe');
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $f$ SELECT _user_id = '${ADMIN}'::uuid AND _role = 'admin' $f$;
-- No teste, "backend confiável" é o papel de sessão do teste.
CREATE OR REPLACE FUNCTION app_private.rpc_trusted_backend() RETURNS boolean LANGUAGE sql STABLE AS
  $f$ SELECT COALESCE(current_setting('teste.backend', true), '') = '1' $f$;
`;

let db: PGlite;
const H = (n: number) => n.toString(16).padStart(64, "0");

async function comoBackend<T>(q: string): Promise<T> {
  await db.exec("SET teste.backend = '1'; SET teste.uid = '';");
  const r = await db.query<{ r: T }>(q);
  return r.rows[0]?.r as T;
}

async function comoUsuario<T>(uid: string, q: string): Promise<T> {
  await db.exec(`SET teste.backend = ''; SET teste.uid = '${uid}';`);
  const r = await db.query<{ r: T }>(q);
  return r.rows[0]?.r as T;
}

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(sql);
  // Idempotente: rodar de novo não quebra.
  await db.exec(sql);
});

describe("Aceleriq Motores no banco", () => {
  it("o código vale uma vez: a segunda troca é recusada e auditada", async () => {
    const c = await comoBackend<{ id: string; expira_em: string }>(`SELECT public.motores_pareamento_criar('${H(1)}', '${ADMIN}', 'Notebook da Ana', ARRAY['navegador'], 10) AS r`);
    assert.ok(c.id);
    const t1 = await comoBackend<{ ok: boolean; maquina_id: string; nome: string; motores: string[] }>(`SELECT public.motores_pareamento_trocar('${H(1)}', 'origem-0001', 'PC', 'NOTE-ANA', 'windows') AS r`);
    assert.equal(t1.ok, true);
    assert.equal(t1.nome, "Notebook da Ana");
    assert.deepEqual(t1.motores, ["navegador"]);
    const t2 = await comoBackend<{ ok: boolean; motivo: string }>(`SELECT public.motores_pareamento_trocar('${H(1)}', 'origem-0001', 'PC', 'NOTE-ANA', 'windows') AS r`);
    assert.deepEqual(t2, { ok: false, motivo: "ja_usado" });
    const aud = await db.query<{ acao: string }>(`SELECT acao FROM public.motores_auditoria WHERE pareamento_id = '${c.id}' ORDER BY id`);
    assert.deepEqual(aud.rows.map((r) => r.acao), ["codigo_gerado", "codigo_usado", "codigo_recusado"]);
  });

  it("código vencido e revogado não valem", async () => {
    await comoBackend(`SELECT public.motores_pareamento_criar('${H(2)}', '${ADMIN}', NULL, NULL, 10) AS r`);
    await db.exec(`UPDATE public.motores_pareamentos SET criado_em = now() - interval '20 minutes', expira_em = now() - interval '10 minutes' WHERE codigo_hash = '${H(2)}'`);
    const t = await comoBackend<{ motivo: string }>(`SELECT public.motores_pareamento_trocar('${H(2)}', 'origem-0002', NULL, 'X', 'windows') AS r`);
    assert.equal(t.motivo, "expirado");
    const c = await comoBackend<{ id: string }>(`SELECT public.motores_pareamento_criar('${H(3)}', '${ADMIN}', NULL, NULL, 10) AS r`);
    await comoUsuario(ADMIN, `SELECT public.motores_admin_pareamento_revogar('${c.id}') AS r`);
    const t2 = await comoBackend<{ motivo: string }>(`SELECT public.motores_pareamento_trocar('${H(3)}', 'origem-0003', NULL, 'X', 'windows') AS r`);
    assert.equal(t2.motivo, "revogado");
  });

  it("limita as tentativas erradas por origem (8 em 15 min)", async () => {
    await comoBackend(`SELECT public.motores_pareamento_criar('${H(4)}', '${ADMIN}', NULL, NULL, 10) AS r`);
    for (let i = 0; i < 8; i++) {
      const t = await comoBackend<{ motivo: string }>(`SELECT public.motores_pareamento_trocar('${H(900 + i)}', 'atacante-01', NULL, 'X', 'windows') AS r`);
      assert.equal(t.motivo, "codigo_invalido");
    }
    // Até o código certo é barrado para essa origem agora.
    const barrado = await comoBackend<{ motivo: string }>(`SELECT public.motores_pareamento_trocar('${H(4)}', 'atacante-01', NULL, 'X', 'windows') AS r`);
    assert.equal(barrado.motivo, "muitas_tentativas");
    // Outra origem segue podendo.
    const ok = await comoBackend<{ ok: boolean }>(`SELECT public.motores_pareamento_trocar('${H(4)}', 'origem-boa', NULL, 'X', 'windows') AS r`);
    assert.equal(ok.ok, true);
  });

  it("no máximo 5 códigos abertos por admin", async () => {
    await db.exec(`UPDATE public.motores_pareamentos SET revogado_em = now() WHERE usado_em IS NULL`);
    for (let i = 0; i < 5; i++) await comoBackend(`SELECT public.motores_pareamento_criar('${H(100 + i)}', '${ADMIN}', NULL, NULL, 10) AS r`);
    await assert.rejects(comoBackend(`SELECT public.motores_pareamento_criar('${H(200)}', '${ADMIN}', NULL, NULL, 10) AS r`), /MOTORES_CODIGOS_DEMAIS/);
  });

  it("só o backend cria e troca códigos", async () => {
    await assert.rejects(comoUsuario(ADMIN, `SELECT public.motores_pareamento_criar('${H(300)}', '${ADMIN}', NULL, NULL, 10) AS r`), /MOTORES_SO_SERVIDOR/);
    await assert.rejects(comoUsuario(ADMIN, `SELECT public.motores_pareamento_trocar('${H(300)}', 'origem-x1', NULL, 'X', 'windows') AS r`), /MOTORES_SO_SERVIDOR/);
    await assert.rejects(comoUsuario(ADMIN, `SELECT public.motores_maquina_sinal(NULL, 'x', 'x', 'windows', NULL, '{}', '{}') AS r`), /MOTORES_SO_SERVIDOR/);
  });

  it("batida sem id registra a máquina migrada e devolve a versão publicada", async () => {
    const s1 = await comoBackend<{ maquina_id: string; revogada: boolean; motores: string[]; versao_alvo: unknown }>(
      `SELECT public.motores_maquina_sinal(NULL, 'DESKTOP-3A5EAKC', 'DESKTOP-3A5EAKC', 'windows', 'abcdef0123', '{"motores":{}}', '{"render":"DESKTOP-3A5EAKC-render"}') AS r`,
    );
    assert.ok(s1.maquina_id);
    assert.equal(s1.revogada, false);
    assert.deepEqual(s1.motores, ["render", "codigo", "navegador"]);
    assert.equal(s1.versao_alvo, null);
    await comoBackend(`SELECT public.motores_versao_publicar('0123456789', '${"a".repeat(64)}', '0123456789/aceleriq-motores-0123456789.zip', 2048, 'primeira', 'teste') AS r`);
    const s2 = await comoBackend<{ maquina_id: string; versao_alvo: { versao: string; sha256: string } }>(
      `SELECT public.motores_maquina_sinal('${s1.maquina_id}', 'DESKTOP-3A5EAKC', 'DESKTOP-3A5EAKC', 'windows', 'abcdef0123', '{}', '{}') AS r`,
    );
    assert.equal(s2.maquina_id, s1.maquina_id);
    assert.equal(s2.versao_alvo.versao, "0123456789");
    // Versão retirada deixa de ser alvo.
    await db.exec(`UPDATE public.motores_versoes SET retirada_em = now()`);
    const s3 = await comoBackend<{ versao_alvo: unknown }>(`SELECT public.motores_maquina_sinal('${s1.maquina_id}', 'D', 'D', 'windows', 'abcdef0123', '{}', '{}') AS r`);
    assert.equal(s3.versao_alvo, null);
    // Trocou de versão: auditoria "maquina_atualizada".
    await comoBackend(`SELECT public.motores_maquina_sinal('${s1.maquina_id}', 'D', 'D', 'windows', 'fedcba9876', '{}', '{}') AS r`);
    const a = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.motores_auditoria WHERE acao = 'maquina_atualizada' AND maquina_id = '${s1.maquina_id}'`);
    assert.equal(a.rows[0].n, 1);
  });

  it("o admin escolhe os motores e remove a máquina; a batida devolve revogada", async () => {
    const m = await comoBackend<{ maquina_id: string }>(`SELECT public.motores_maquina_sinal(NULL, 'Fraca', 'FRACA', 'windows', NULL, '{}', '{}') AS r`);
    await assert.rejects(comoUsuario(EQUIPE, `SELECT public.motores_admin_maquina_motores('${m.maquina_id}', ARRAY['navegador']) AS r`), /MOTORES_SO_ADMIN/);
    const t = await comoUsuario<{ motores: string[] }>(ADMIN, `SELECT public.motores_admin_maquina_motores('${m.maquina_id}', ARRAY['navegador', 'navegador', 'xpto']) AS r`);
    assert.deepEqual(t.motores, ["navegador"]);
    const s = await comoBackend<{ motores: string[] }>(`SELECT public.motores_maquina_sinal('${m.maquina_id}', 'Fraca', 'FRACA', 'windows', NULL, '{}', '{}') AS r`);
    assert.deepEqual(s.motores, ["navegador"]);
    await comoUsuario(ADMIN, `SELECT public.motores_admin_maquina_remover('${m.maquina_id}') AS r`);
    const s2 = await comoBackend<{ revogada: boolean }>(`SELECT public.motores_maquina_sinal('${m.maquina_id}', 'Fraca', 'FRACA', 'windows', NULL, '{}', '{}') AS r`);
    assert.equal(s2.revogada, true);
  });

  it("a tela do admin não recebe hash e a equipe não lê", async () => {
    await assert.rejects(comoUsuario(EQUIPE, `SELECT public.motores_admin_painel() AS r`), /MOTORES_SO_ADMIN/);
    const p = await comoUsuario<Record<string, unknown>>(ADMIN, `SELECT public.motores_admin_painel() AS r`);
    const texto = JSON.stringify(p);
    assert.ok(!/codigo_hash/.test(texto));
    assert.ok(!new RegExp(H(100)).test(texto));
    assert.ok(Array.isArray(p.maquinas) && (p.maquinas as unknown[]).length >= 1);
    assert.ok(Array.isArray(p.codigos));
    assert.ok(Array.isArray(p.auditoria) && (p.auditoria as unknown[]).length > 0);
  });

  it("RLS ligada nas cinco tabelas e o bucket é privado", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('motores_maquinas','motores_pareamentos','motores_tentativas','motores_versoes','motores_auditoria') ORDER BY relname`,
    );
    assert.equal(r.rows.length, 5);
    assert.ok(r.rows.every((x) => x.relrowsecurity));
    const b = await db.query<{ public: boolean }>(`SELECT public FROM storage.buckets WHERE id = 'motores-pacotes'`);
    assert.equal(b.rows[0].public, false);
  });
});
