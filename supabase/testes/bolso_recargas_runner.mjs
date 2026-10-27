// Dependência local isolada; não importa credenciais, CLI Supabase ou configuração da app.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireTest=createRequire(resolve('work/bolso-db-test/package.json'));
const { PGlite }=requireTest('@electric-sql/pglite');
import { readFileSync } from 'node:fs';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TYPE public.app_role AS ENUM('admin','client','member');
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,aud text,role text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
CREATE FUNCTION public.has_role(u uuid,r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role=r) $$;
CREATE FUNCTION public.membros_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT public.has_role(auth.uid(),'admin') $$;
CREATE FUNCTION public.membros_usuario_confirmado() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated,service_role;
GRANT SELECT ON storage.objects TO authenticated;
`);
for(const file of ['supabase/migrations/20261027120000_aceleriq_de_bolso.sql','supabase/migrations/20261027220000_bolso_carteiras_recargas_openrouter.sql']) {
  try { await db.exec(readFileSync(file,'utf8')); console.log('Applied isolated fixture:',file); }
  catch(e) { console.error('Migration error',file,e.message,e.where,e.position); process.exit(1); }
}
const test='supabase/testes/bolso_recargas_cenarios.sql';
try {
const results=await db.exec(readFileSync(test,'utf8'));
const rows=results.flatMap(r=>r.rows||[]).filter(r=>'ok' in r && 'teste' in r);
for(const r of rows) console.log(r.ok?'OK':'FAIL',r.n,r.teste,r.detalhe||'');
console.log(`${rows.filter(r=>r.ok).length}/${rows.length} passed`);
if(!rows.length||rows.some(r=>!r.ok))process.exitCode=1;
} catch(e) { console.error('Test error',e.message,e.where,e.position);process.exitCode=1; }
await db.close();
