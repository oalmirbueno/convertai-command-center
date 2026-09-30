/**
 * Banco de teste da fila (frente EDT): esqueleto das tabelas do painel + a
 * migration de verdade num Postgres em memória (PGlite).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { RAIZ_DO_REPO } from "../trabalho.ts";

export const ESQUELETO = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.video_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, nome text NOT NULL, nome_original text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'mesa', storage_path text NOT NULL, tipo text NOT NULL DEFAULT 'bruto',
  mime text, bytes bigint, duracao_s numeric, largura integer, altura integer, sha256 text, criado_por uuid, origem jsonb,
  CONSTRAINT video_arquivos_tipo_check CHECK (tipo = ANY (ARRAY['bruto','take','gerado','audio','entrega','angulo','quadro']))
);
CREATE TABLE public.video_versoes (id uuid PRIMARY KEY, client_id uuid NOT NULL, titulo text NOT NULL DEFAULT 'Vídeo', numero integer NOT NULL DEFAULT 1, projeto jsonb);
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
`;

export const CLIENTE = "11111111-1111-4111-8111-111111111111";
export const VERSAO = "22222222-2222-4222-8222-222222222222";

export async function bancoComAFila(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(`INSERT INTO public.profiles VALUES ('${CLIENTE}'); INSERT INTO public.video_versoes (id, client_id, titulo, numero) VALUES ('${VERSAO}', '${CLIENTE}', 'Teste', 3);`);
  const sql = readFileSync(path.join(RAIZ_DO_REPO, "supabase", "migrations", "20260930080000_render_pedidos.sql"), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");
  await db.exec(sql);
  return db;
}


/** Frente MOT: a fila da frente EDT + a migration da Mesa Motion (filmes, cena_hf, batidas, portfólio). */
export async function bancoComOMotion(): Promise<PGlite> {
  const db = await bancoComAFila();
  const sql = readFileSync(path.join(RAIZ_DO_REPO, "supabase", "migrations", "20260930180000_mesa_motion.sql"), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");
  await db.exec(sql);
  return db;
}
