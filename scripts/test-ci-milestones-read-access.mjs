import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { root, extractFunction } from "./prepare-ci-editorial-replay.mjs";

const host=process.env.PGHOST||"127.0.0.1";
const port=process.env.PGPORT||"54322";
assert(["127.0.0.1","localhost","::1"].includes(host) && /^\d+$/.test(port)
  && Number(port)>0 && Number(port)<65536 && (!process.env.PGUSER||process.env.PGUSER==="postgres"),
  "Milestones tests require loopback PostgreSQL as postgres.");
const database="acq_isolated_milestones_"+Date.now().toString(36)+"_"+process.pid;
const env={...process.env,PGHOST:host==="localhost"?"127.0.0.1":host,PGPORT:port,PGUSER:"postgres"};
env.PGHOSTADDR=env.PGHOST;
for(const key of ["PGDATABASE","PGSERVICE","PGSERVICEFILE","PGOPTIONS"]) delete env[key];
const logDir=path.join(root,"logs/database-isolated");
await mkdir(logDir,{recursive:true});
let output="";
function sql(source,db=database) {
  assert(db==="postgres"||/^acq_isolated_milestones_[a-z0-9_]+$/.test(db));
  const result=spawnSync(process.env.PSQL_PATH||"psql",
    ["-X","-q","-t","-A","-w","-v","ON_ERROR_STOP=1","-h",env.PGHOST,"-p",port,"-U","postgres","-d",db],
    {input:"SET statement_timeout='30s'; SET aceleriq.isolated_tests='on';\n"+source,
      encoding:"utf8",env,windowsHide:true,timeout:40000});
  output+=(result.stdout||"")+(result.stderr||"");
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error("Isolated SQL failed: "+(result.stderr||"").slice(-3000));
  return result.stdout||"";
}
const canonical={
  core:["20260223193634_53550802-f9c7-4caf-8aca-9dbd9741eb24.sql","3312f9ddae283e3d670a6cfdc88e528b933291b6f8826e9ee349bfb3f6642a22"],
  clean:["20260223210126_b8c2fce3-96a7-476c-87ce-58d2108549e3.sql","f17bd87f2ab1b1d7651fe847db5c431d22cc54c51fdf4360ca357161b7d79df2"],
  update:["20260223213218_7f5eaf50-9c1c-4335-ae01-2d40f859dbac.sql","f4dc564483240ac55c230359ce421f4c69e25d85c0963d3c5b6f5316247b75c9"],
  scope:["20260528163622_b27ffa65-a154-4bb5-bb92-1478927a8a75.sql","0efdae4d2c7da9cda7aa3e322e0dcff2d6718fab8004f290698afdd7a46d8254"],
  link:["20260226160142_2376ec24-03eb-4270-9d08-324821aa39ab.sql","4cdafcf187426d7d40add2e9347eb14d5375bc6206a69a85fb4ea403368a7c3a"],
};
function match(source,pattern,label) {
  const result=source.match(pattern);
  assert(result,"Canonical SQL missing: "+label);
  return result[0];
}
try {
  const sources={};
  for(const [key,[file,hash]] of Object.entries(canonical)) {
    sources[key]=await readFile(path.join(root,"supabase/migrations",file),"utf8");
    assert.equal(createHash("sha256").update(sources[key]).digest("hex"),hash,"Historical source drift: "+file);
  }
  // Real table definitions, FK and authorization helpers/policies are copied
  // unchanged from their pinned migration sources. Only Auth identities and the
  // empty CI attestation marker below are synthetic test scaffolding.
  const fixture=[
    "CREATE TABLE auth.users(id uuid PRIMARY KEY);",
    match(sources.core,/CREATE TYPE public\.app_role[^;]+;/,"roles"),
    ...["profiles","user_roles","projects","tasks","milestones"].map((name)=>
      match(sources.core,new RegExp("CREATE TABLE public\\."+name+" \\([\\s\\S]*?\\n\\);"),name)),
    match(sources.link,/ALTER TABLE public\.tasks ADD COLUMN milestone_id[^;]+;/,"milestone FK"),
    extractFunction(sources.core,"has_role").definition,
    extractFunction(sources.scope,"is_staff").definition,
    extractFunction(sources.scope,"user_owns_project").definition,
    "ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;",
    match(sources.scope,/CREATE POLICY milestones_select ON public\.milestones[\s\S]*?;/,"milestone read policy"),
    match(sources.clean,/CREATE POLICY "milestones_insert" ON milestones[\s\S]*?;/,"milestone insert policy"),
    match(sources.update,/CREATE POLICY "milestones_admin_update" ON public\.milestones[^;]+;/,"milestone update policy"),
    "GRANT SELECT ON public.tasks,public.projects TO authenticated;",
    "GRANT SELECT(id,full_name) ON public.profiles TO authenticated;",
    "CREATE SCHEMA aceleriq_ci_replay; CREATE TABLE aceleriq_ci_replay.operator_parent_attestation(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),pilot_stable_fields jsonb NOT NULL,frozen boolean NOT NULL DEFAULT false);",
    "INSERT INTO aceleriq_ci_replay.operator_parent_attestation(pilot_stable_fields) VALUES('[]');",
  ].join("\n");
  sql('CREATE DATABASE "'+database+'" TEMPLATE template0;',"postgres");
  sql(await readFile(path.join(root,"tests/database-isolated/bootstrap.sql"),"utf8"));
  sql(fixture);
  const grantSql=await readFile(path.join(root,"supabase/bootstrap/ci-milestones-read-access.sql"),"utf8");
  const testSql=(await readFile(path.join(root,"tests/database-isolated/tests/ci_milestones_read_access.test.sql"),"utf8"))
    .replaceAll("__GRANT_SCRIPT__", "$grant_script$"+grantSql+"$grant_script$");
  const tap=sql(testSql).replaceAll("\r","");
  const count=[...tap.matchAll(/^ok \d+ /gm)].length;
  const plans=[...tap.matchAll(/^1\.\.(\d+)$/gm)];
  assert(!/^not ok\b|^Bail out!/m.test(tap)&&plans.length===1&&Number(plans[0][1])===count&&count>0,tap);
  console.log("Milestones CI access: "+count+" PostgreSQL assertions passed; "+database+" retained.");
} finally {
  await writeFile(path.join(logDir,"ci-milestones-read-access.log"),output);
}
