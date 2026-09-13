-- Synthetic contracts only. Never apply to the application database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'acq_isolated_%'
    OR current_setting('aceleriq.isolated_tests', true) IS DISTINCT FROM 'on'
    OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'ISOLATED_DATABASE_BOOTSTRAP_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN
    RAISE EXCEPTION 'ISOLATED_TESTS_REQUIRE_SUPERUSER_FOR_SESSION_AUTHORIZATION';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN NOINHERIT; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS social_private;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
