import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildReplayPlan,extractFunction,root } from "./prepare-ci-editorial-replay.mjs";

const host=process.env.PGHOST||"127.0.0.1";
const port=process.env.PGPORT||"54322";
if (!["127.0.0.1","localhost","::1"].includes(host) || !/^\d+$/.test(port)
 || Number(port)<1 || Number(port)>65535 || (process.env.PGUSER && process.env.PGUSER!=="postgres")) {
 throw new Error("Editorial replay tests require loopback PostgreSQL and PGUSER=postgres.");
}
const database="acq_isolated_editorial_"+Date.now().toString(36)+"_"+process.pid;
const env={...process.env,PGHOST:host==="localhost"?"127.0.0.1":host,PGPORT:port,PGUSER:"postgres"};
env.PGHOSTADDR=env.PGHOST;
for(const key of ["PGDATABASE","PGSERVICE","PGSERVICEFILE","PGOPTIONS"]) delete env[key];
const logDir=path.join(root,"logs/database-isolated");await mkdir(logDir,{recursive:true});
let output="";
function sql(source,db=database) {
 if(db!=="postgres" && !/^acq_isolated_editorial_[a-z0-9_]+$/.test(db)) throw new Error("Invalid isolated database");
 const result=spawnSync(process.env.PSQL_PATH||"psql",["-X","-q","-t","-A","-w","-v","ON_ERROR_STOP=1",
 "-h",env.PGHOST,"-p",port,"-U","postgres","-d",db],{
 input:"SET statement_timeout='60s'; SET aceleriq.isolated_tests='on';\n"+source,encoding:"utf8",env,windowsHide:true,timeout:65000});
 output+=(result.stdout||"")+(result.stderr||"");
 if(result.error) throw result.error;
 if(result.status!==0) throw new Error("SQL failed: "+(result.stderr||"").slice(-4000));
 return result.stdout||"";
}
async function runTap(file) {
 const tap=sql(await readFile(path.join(root,"tests/database-isolated/tests",file),"utf8")).replaceAll("\r","");
 const count=[...tap.matchAll(/^ok \d+ /gm)].length;
 const plans=[...tap.matchAll(/^1\.\.(\d+)$/gm)];
 if(/^not ok\b|^Bail out!/m.test(tap)||plans.length!==1||Number(plans[0][1])!==count||!count) {
  throw new Error("pgTAP failed or returned an incomplete plan:\n"+tap);
 }
 return count;
}
try {
 const plan=await buildReplayPlan();
 sql('CREATE DATABASE "'+database+'" TEMPLATE template0;',"postgres");
 sql(await readFile(path.join(root,"tests/database-isolated/bootstrap.sql"),"utf8"));
 sql(await readFile(path.join(root,"tests/database-isolated/fixtures/publication_contract.sql"),"utf8"));
 sql("ALTER TABLE public.files ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS caption text, ADD COLUMN IF NOT EXISTS extension text, ADD COLUMN IF NOT EXISTS file_type text, ADD COLUMN IF NOT EXISTS requires_approval boolean DEFAULT false;");
 sql("ALTER TABLE public.tasks ADD COLUMN project_id uuid, ADD COLUMN deleted_at timestamptz;");
 sql(extractFunction(plan.sources.calendar,"editorial_staff_can_access_client").definition);
 sql(extractFunction(plan.sources.calendar,"save_editorial_post").definition);
 sql("ALTER FUNCTION public.save_editorial_post(jsonb,integer) RENAME TO save_editorial_post_unlocked;");
 sql(extractFunction(plan.sources.approved,"editorial_file_is_publishable_media").definition);
 sql(extractFunction(plan.sources.approved,"save_approved_editorial_post_unlocked").definition);
 sql("REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb,integer) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb,integer) TO service_role; REVOKE ALL ON FUNCTION public.save_approved_editorial_post_unlocked(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;");
 // Reproduce the exact preceding modifications to the real regular body.
 for(const file of ["20260812120000_allow_approved_media_on_new_posts.sql","20260814020000_editorial_allow_attach_under_review.sql","20260814030000_editorial_attach_pending_art.sql"]) {
  sql(await readFile(path.join(root,"supabase/migrations",file),"utf8"));
 }
 // Every original migration below is executed verbatim; none is skipped.
 sql(plan.files[0].sql);sql(plan.sources.reuse);sql(plan.files[1].sql);
 sql(plan.files[2].sql);sql(plan.sources.publications);sql(plan.files[3].sql);
 sql(plan.sources.corrected);
 const editorialCount=await runTap("editorial_replay.test.sql");
 // The base inserts its four real pilot definitions; the next two fixtures only
 // supply missing parents. Execute the entire repair, including its empty-link
 // reconciliation and its guarded organogram, without changing historical SQL.
 sql(plan.sources.operatorsBase);sql(plan.sources.operatorsHierarchy);
 sql(plan.files[4].sql);sql(plan.sources.operatorsRepair);sql(plan.files[5].sql);
 const operatorCount=await runTap("operator_prerequisite.test.sql");
 // Install the real later table definitions and validate the same read-only
 // inactivity check that the workflow applies after the complete stack replay.
 sql(plan.sources.operatorsParticipation);sql(plan.sources.operatorsDeliveries);
 sql(await readFile(path.join(root,"supabase/bootstrap/ci-operator-parents-postcheck.sql"),"utf8"));
 console.log("Historical replay: "+editorialCount+" editorial + "+operatorCount+" operator assertions passed; "+database+" retained.");
} finally {
 const password=process.env.PGPASSWORD||"";
 await writeFile(path.join(logDir,"editorial-replay.log"),password?output.replaceAll(password,"[local-password]"):output);
}
