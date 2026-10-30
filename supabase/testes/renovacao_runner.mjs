// Teste isolado da migration 20261030190000_renovacao_nasce_no_banco em PGlite.
// Não usa credencial nem projeto Supabase. PGlite fica fora do package.json:
//   PGLITE_DIR=<pasta com node_modules/@electric-sql/pglite> node supabase/testes/renovacao_runner.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const requireTest=createRequire(resolve(process.env.PGLITE_DIR||'work/bolso-db-test','package.json'));
const { PGlite }=requireTest('@electric-sql/pglite');
const db=new PGlite();
// Recorte mínimo das tabelas reais (colunas usadas pelo gatilho).
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,plan_status text,plan_renewal_date date,plan_value numeric,plan_name text,
  overdue_since date,deleted_at timestamptz,services_config jsonb,cobranca_pausada boolean NOT NULL DEFAULT false);
CREATE TABLE public.billing(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL,type text NOT NULL,amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',due_date date NOT NULL,paid_date date,platform text,description text,reminder_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),paid_amount numeric);
CREATE TABLE public.projects(id uuid PRIMARY KEY,client_id uuid,status text,deleted_at timestamptz,updated_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA public TO anon,authenticated;
`);
const migration='supabase/migrations/20261030190000_renovacao_nasce_no_banco.sql';
try { await db.exec(readFileSync(migration,'utf8')); console.log('Applied:',migration); }
catch(e) { console.error('Migration error',e.message,e.where,e.position); process.exit(1); }
// Aplicar de novo tem de passar (idempotente).
try { await db.exec(readFileSync(migration,'utf8')); console.log('Re-applied OK'); }
catch(e) { console.error('Re-apply error',e.message); process.exit(1); }
try {
  const results=await db.exec(readFileSync('supabase/testes/renovacao_cenarios.sql','utf8'));
  const rows=results.flatMap(r=>r.rows||[]).filter(r=>'ok' in r && 'teste' in r);
  for(const r of rows) console.log(r.ok?'OK':'FAIL',r.n,r.teste,r.detalhe||'');
  console.log(`${rows.filter(r=>r.ok).length}/${rows.length} passed`);
  if(!rows.length||rows.some(r=>!r.ok))process.exitCode=1;
} catch(e) { console.error('Test error',e.message,e.where,e.position);process.exitCode=1; }
await db.close();
