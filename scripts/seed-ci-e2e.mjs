import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixturePath=path.join(root,'e2e/.auth/ci-fixture.json');
const authOrigin='http://127.0.0.1:54321';
const appOrigin='http://127.0.0.1:4173';
const keys=['admin','assignedStaff','unassignedStaff','clientA','clientB'];
const roles={admin:'admin',assignedStaff:'design',unassignedStaff:'design',clientA:'client',clientB:'client'};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const businessStateSql=`jsonb_build_object(
  'projects',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.projects p),
  'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t),
  'roles',(SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'role',role) ORDER BY user_id,role) FROM public.user_roles),
  'assignments',(SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'client_id',client_id) ORDER BY user_id,client_id) FROM public.team_client_assignments))`;
const verifySql=`DO $ci$ DECLARE g record; actual jsonb; BEGIN
  IF session_user<>'postgres' OR current_database()<>'postgres'
    OR to_regclass('aceleriq_ci_replay.e2e_seed_guard') IS NULL THEN
    RAISE EXCEPTION 'E2E_VERIFY_REQUIRES_SYNTHETIC_SEED';
  END IF;
  SELECT * INTO STRICT g FROM aceleriq_ci_replay.e2e_seed_guard;
  EXECUTE format('SELECT jsonb_build_object(''last_value'',last_value,''is_called'',is_called) FROM %s',g.http_sequence::regclass) INTO actual;
  IF NOT g.restored OR NOT g.seeded OR actual IS DISTINCT FROM g.http_state
    OR EXISTS(SELECT 1 FROM net.http_request_queue) OR EXISTS(SELECT 1 FROM vault.secrets)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(g.hook_state) h(trigger_oid oid,enabled text)
      LEFT JOIN pg_trigger t ON t.oid=h.trigger_oid WHERE t.oid IS NULL OR t.tgenabled::text<>h.enabled) THEN
    RAISE EXCEPTION 'E2E_HTTP_OR_HOOK_POSTCONDITION_FAILED';
  END IF;
  IF g.business_state IS DISTINCT FROM ${businessStateSql}
    OR (SELECT count(*) FROM auth.users)<>5 OR (SELECT count(*) FROM public.profiles)<>5
    OR EXISTS(SELECT 1 FROM public.editorial_posts) OR EXISTS(SELECT 1 FROM public.editorial_publications)
    OR EXISTS(SELECT 1 FROM public.operator_runs) OR EXISTS(SELECT 1 FROM public.operator_task_links)
    OR EXISTS(SELECT 1 FROM public.operator_approvals) OR EXISTS(SELECT 1 FROM public.operator_participations)
    OR EXISTS(SELECT 1 FROM public.assignment_proposals) OR EXISTS(SELECT 1 FROM public.operator_deliveries)
    OR EXISTS(SELECT 1 FROM social_private.autopublish_jobs) THEN
    RAISE EXCEPTION 'E2E_BUSINESS_DATA_OR_QUEUE_CHANGED';
  END IF;
END $ci$;`;

export function validateEnvironment(env) {
  assert(env.CI==='true' && env.GITHUB_ACTIONS==='true','E2E seed requires GitHub CI.');
  assert(!env.ACELERIQ_E2E_SUPABASE_URL || env.ACELERIQ_E2E_SUPABASE_URL===authOrigin,'E2E seed refuses noncanonical Supabase endpoints.');
  assert(!env.PGHOST || env.PGHOST==='127.0.0.1','E2E seed requires literal loopback PGHOST.');
  assert(!env.PGHOSTADDR || env.PGHOSTADDR==='127.0.0.1','E2E seed refuses alternate PGHOSTADDR.');
  assert(!env.PGPORT || env.PGPORT==='54322','E2E seed requires CI port 54322.');
  assert(!env.PGUSER || env.PGUSER==='postgres','E2E seed requires local postgres owner.');
  assert(!env.PGDATABASE || env.PGDATABASE==='postgres','E2E seed requires the local CI database.');
}
export function validateRequest(input) {
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  assert(url.origin===authOrigin && !url.username && !url.password,'E2E seed blocked a nonlocal HTTP endpoint.');
  assert(url.pathname.startsWith('/auth/v1/'),'E2E seed only calls the local Auth API.');
  return url;
}
function databaseSql(source) {
  const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:'54322',PGUSER:'postgres',PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'5'};
  for(const key of ['PGSERVICE','PGSERVICEFILE','PGOPTIONS'])delete env[key];
  const result=spawnSync(process.env.PSQL_PATH||'psql',['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1',
    '-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres'],
    {input:"SET statement_timeout='30s'; SET search_path=public,pg_catalog;\n"+source,encoding:'utf8',env,windowsHide:true,timeout:40000});
  if(result.error)throw new Error('E2E local psql could not run: '+result.error.code);
  if(result.status!==0) {
    // SQL contains only synthetic IDs/data, but still report just the guard code.
    const code=(result.stderr||'').match(/E2E_[A-Z_]+/)?.[0]||'E2E_LOCAL_SQL_FAILED';
    throw new Error(code+'; no auth credentials or SQL bodies were logged.');
  }
  return (result.stdout||'').trim();
}
async function restore() {
  databaseSql(await readFile(path.join(root,'e2e/fixtures/seed-restore.sql'),'utf8'));
}
function validateFixture(fixture) {
  assert.deepEqual(Object.keys(fixture.users),keys);
  for(const key of keys) {
    const user=fixture.users[key];
    assert.match(user.id,uuidPattern);
    assert.equal(user.role,roles[key]);
    assert.match(user.email,/^ci-e2e\.[a-z]+\+[a-f0-9]+@example\.test$/);
    assert(user.password.length>=24);
  }
  assert.equal(fixture.supabaseUrl,authOrigin);
  assert.equal(fixture.appUrl,appOrigin);
  assert.match(fixture.runId,uuidPattern);
  for(const key of ['clientA','clientB']) {
    assert.match(fixture.projects[key].id,uuidPattern);
    assert.equal(fixture.projects[key].clientId,fixture.users[key].id);
    assert.match(fixture.tasks[key].id,uuidPattern);
    assert.equal(fixture.tasks[key].projectId,fixture.projects[key].id);
  }
  assert(!/access_token|refresh_token|service_role_key|anon_key/.test(JSON.stringify(fixture)));
}
function seedDataSql(fixture) {
  validateFixture(fixture);
  const ids=keys.map(key=>literal(fixture.users[key].id)+'::uuid').join(',');
  const parts=['BEGIN;'];
  parts.push(`DO $ci$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.e2e_seed_guard WHERE run_id=${literal(fixture.runId)}::uuid AND NOT restored AND NOT seeded)
      OR (SELECT count(*) FROM auth.users)<>5 OR (SELECT count(*) FROM public.profiles WHERE id IN (${ids}))<>5
      OR (SELECT count(*) FROM public.user_roles WHERE user_id IN (${ids}) AND role='client')<>5 THEN
      RAISE EXCEPTION 'E2E_REAL_AUTH_PROFILE_CREATION_MISMATCH';
    END IF;
  END $ci$;`);
  for(const key of keys) {
    const user=fixture.users[key];
    if(user.role!=='client')parts.push(`UPDATE public.user_roles SET role=${literal(user.role)}::public.app_role WHERE user_id=${literal(user.id)}::uuid AND role='client';`);
    parts.push(`UPDATE public.profiles SET onboarding_done=true,plan_status='active',plan_renewal_date='2099-01-01',services_config='{}'::jsonb WHERE id=${literal(user.id)}::uuid;`);
  }
  for(const key of ['clientA','clientB']) {
    const project=fixture.projects[key],task=fixture.tasks[key];
    parts.push(`UPDATE public.profiles SET services_config='{"social":true}'::jsonb WHERE id=${literal(project.clientId)}::uuid;`);
    parts.push(`INSERT INTO public.projects(id,client_id,name,project_type,status,progress,start_date,deadline,billing_mode,created_by)
      VALUES(${literal(project.id)}::uuid,${literal(project.clientId)}::uuid,${literal(project.name)},'social_media','active',0,current_date,current_date+30,'included',${literal(fixture.users.admin.id)}::uuid);`);
    parts.push(`INSERT INTO public.tasks(id,project_id,title,status,priority,source,workstream,delivery_type,assigned_to,due_date)
      VALUES(${literal(task.id)}::uuid,${literal(project.id)}::uuid,${literal(task.title)},'backlog','medium','portal','design','static',
      ${key==='clientA'?literal(fixture.users.assignedStaff.id)+'::uuid':'NULL'},current_date+7);`);
  }
  parts.push(`INSERT INTO public.team_client_assignments(user_id,client_id,created_by) VALUES(${literal(fixture.users.assignedStaff.id)}::uuid,${literal(fixture.users.clientA.id)}::uuid,${literal(fixture.users.admin.id)}::uuid);`);
  parts.push(`DO $ci$ BEGIN
    IF (SELECT count(*) FROM public.user_roles WHERE user_id IN (${ids}))<>5
      OR (SELECT count(*) FROM public.projects)<>2 OR (SELECT count(*) FROM public.tasks)<>2
      OR (SELECT count(*) FROM public.team_client_assignments)<>1 THEN
      RAISE EXCEPTION 'E2E_SYNTHETIC_RELATIONS_MISMATCH';
    END IF;
  END $ci$; UPDATE aceleriq_ci_replay.e2e_seed_guard SET seeded=true,business_state=${businessStateSql}; COMMIT;`);
  return parts.join('\n');
}
async function seed() {
  assert(process.env.ACELERIQ_E2E_SERVICE_ROLE_KEY,'E2E seed needs the ephemeral local service role key.');
  assert(process.env.ACELERIQ_E2E_ANON_KEY,'E2E tests need the ephemeral local anonymous key.');
  try {await access(fixturePath);throw new Error('E2E refuses to overwrite an existing credentials fixture.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const runId=randomUUID();
  databaseSql((await readFile(path.join(root,'e2e/fixtures/seed-prepare.sql'),'utf8')).replaceAll('__RUN_ID__',runId));
  const fixture={version:1,runId,appUrl:appOrigin,supabaseUrl:authOrigin,users:{},projects:{},tasks:{}};
  try {
    const client=createClient(authOrigin,process.env.ACELERIQ_E2E_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init)=>{validateRequest(input);return fetch(input,{...init,redirect:'error',signal:init?.signal||AbortSignal.timeout(15000)});}}});
    for(const key of keys) {
      const email='ci-e2e.'+key.toLowerCase()+'+'+runId.replaceAll('-','').slice(0,12)+'@example.test';
      const password='CiOnly!'+randomBytes(24).toString('base64url');
      const fullName='CI E2E '+key;
      const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName,company_name:'Synthetic CI '+key}});
      if(error||!data.user)throw new Error('E2E_CREATE_USER_FAILED: '+key+'; local Auth returned status '+(error?.status||'unknown'));
      fixture.users[key]={id:data.user.id,email,password,fullName,role:roles[key]};
    }
    for(const key of ['clientA','clientB']) {
      fixture.projects[key]={id:randomUUID(),clientId:fixture.users[key].id,name:'CI E2E Project '+key};
      fixture.tasks[key]={id:randomUUID(),projectId:fixture.projects[key].id,title:'CI E2E Schedule '+key};
    }
    databaseSql(seedDataSql(fixture));
  } finally {await restore();}
  // Sequence inspection detects even a queued request already consumed by pg_net.
  databaseSql(verifySql);
  await mkdir(path.dirname(fixturePath),{recursive:true,mode:0o700});
  await writeFile(fixturePath,JSON.stringify(fixture,null,2),{flag:'wx',mode:0o600});
  console.log('CI E2E: five real Auth users, two projects and two tasks created; hooks restored; zero outbound HTTP. Private synthetic fixture is ready.');
}
async function selfTest() {
  const valid={CI:'true',GITHUB_ACTIONS:'true'};
  validateEnvironment(valid);
  for(const patch of [{CI:'false'},{GITHUB_ACTIONS:'false'},{ACELERIQ_E2E_SUPABASE_URL:'https://remote.supabase.co'},
    {ACELERIQ_E2E_SUPABASE_URL:'http://127.0.0.1:54321/redirect'},{PGHOST:'localhost'},{PGHOSTADDR:'192.0.2.1'},
    {PGPORT:'5432'},{PGUSER:'service_role'},{PGDATABASE:'customer_database'}])assert.throws(()=>validateEnvironment({...valid,...patch}));
  validateRequest(authOrigin+'/auth/v1/admin/users');
  for(const url of ['https://remote.supabase.co/auth/v1/admin/users','http://127.0.0.1:1234/auth/v1/admin/users',
    authOrigin+'/rest/v1/profiles','http://user:pass@127.0.0.1:54321/auth/v1/admin/users','http://localhost:54321/auth/v1/admin/users'])assert.throws(()=>validateRequest(url));
  const fixture={runId:randomUUID(),supabaseUrl:authOrigin,appUrl:appOrigin,users:{},projects:{},tasks:{}};
  for(const key of keys)fixture.users[key]={id:randomUUID(),role:roles[key],email:'ci-e2e.'+key.toLowerCase()+'+0123456789ab@example.test',password:'CiOnly!SyntheticPasswordForSelfTest'};
  for(const key of ['clientA','clientB']) {fixture.projects[key]={id:randomUUID(),clientId:fixture.users[key].id,name:'Synthetic project'};fixture.tasks[key]={id:randomUUID(),projectId:fixture.projects[key].id,title:'Synthetic task'};}
  const sql=seedDataSql(fixture);
  assert(!/\bDELETE\b|\bTRUNCATE\b|DISABLE TRIGGER|request.jwt/i.test(sql));
  assert(!sql.includes(fixture.users.admin.password));
  assert.equal((sql.match(/UPDATE public.user_roles/g)||[]).length,3);
  assert.throws(()=>validateFixture({...fixture,supabaseUrl:'https://remote.supabase.co'}));
  console.log('CI E2E seed self-test passed: CI, loopback, redirect, synthetic identity, no credential SQL and data-preserving role guards.');
}
async function main() {
  if(process.argv[2]==='--self-test'){await selfTest();return;}
  validateEnvironment(process.env);
  if(process.argv[2]==='--restore'){await restore();console.log('CI E2E hook restoration verified.');return;}
  if(process.argv[2]==='--verify'){databaseSql(verifySql);console.log('CI E2E data, queue, hook and zero outbound HTTP postconditions passed.');return;}
  assert(process.argv[2]==='--seed','Use --seed, --restore, --verify or --self-test.');
  await seed();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
