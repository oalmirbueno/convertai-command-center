// Teste isolado da migration 20261101230000_cliente_ve_vinculo_tarefa_conteudo em PGlite.
// Não usa credencial nem projeto Supabase. PGlite fica fora do package.json:
//   PGLITE_DIR=<pasta com node_modules/@electric-sql/pglite> node supabase/testes/vinculo_tarefa_conteudo_runner.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const requireTest=createRequire(resolve(process.env.PGLITE_DIR||'work/bolso-db-test','package.json'));
const { PGlite }=requireTest('@electric-sql/pglite');
const db=new PGlite();
// Recorte mínimo das tabelas e funções reais usadas pela função.
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin','manager','design','traffic','client');
CREATE TABLE public.user_roles(user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.editorial_posts(id uuid PRIMARY KEY, client_id uuid NOT NULL,
  production_status text NOT NULL DEFAULT 'draft', archived_at timestamptz);
CREATE TABLE public.editorial_post_internal(post_id uuid PRIMARY KEY, client_id uuid NOT NULL,
  task_id uuid, revision_of_post_id uuid, internal_notes text, responsible_id uuid);
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
`);
const migration='supabase/migrations/20261101230000_cliente_ve_vinculo_tarefa_conteudo.sql';
try { await db.exec(readFileSync(migration,'utf8')); console.log('Applied:',migration); }
catch(e) { console.error('Migration error',e.message,e.where,e.position); process.exit(1); }
// Aplicar de novo tem de passar (idempotente).
try { await db.exec(readFileSync(migration,'utf8')); console.log('Re-applied OK'); }
catch(e) { console.error('Re-apply error',e.message); process.exit(1); }
try {
  const results=await db.exec(readFileSync('supabase/testes/vinculo_tarefa_conteudo_cenarios.sql','utf8'));
  const rows=results.flatMap(r=>r.rows||[]).filter(r=>'ok' in r && 'teste' in r);
  for(const r of rows) console.log(r.ok?'OK':'FAIL',r.n,r.teste,r.detalhe||'');
  console.log(`${rows.filter(r=>r.ok).length}/${rows.length} passed`);
  if(!rows.length||rows.some(r=>!r.ok))process.exitCode=1;
} catch(e) { console.error('Test error',e.message,e.where,e.position);process.exitCode=1; }
await db.close();
