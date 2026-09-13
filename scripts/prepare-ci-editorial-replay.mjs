import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const canonical = {
  calendar: "supabase/migrations/20260728161129_create_editorial_calendar.sql",
  approved: "supabase/migrations/20260729233930_fb88e549-12f5-4470-83e2-53115d155764.sql",
  reuse: "supabase/migrations/20260814070000_reuse_art_from_archived_and_shared.sql",
  publications: "supabase/migrations/20260814110000_free_art_from_archived_publications.sql",
  corrected: "supabase/migrations/20260814120000_free_art_approved_flow.sql",
  operatorsBase: "supabase/migrations/20260827200000_operadores_internos.sql",
  operatorsHierarchy: "supabase/migrations/20260828010000_hierarquia_e_notificacao_de_tudo.sql",
  operatorsRepair: "supabase/migrations/20260828140000_operadores_hierarquia_e_vinculo_unico.sql",
  operatorsParticipation: "supabase/migrations/20260829010000_participacao_aprovacao_e_propostas.sql",
  operatorsDeliveries: "supabase/migrations/20260901060000_prestacao_de_contas_do_agente.sql",
};
const hashes = {
  calendar: "3eebbca18216f74a8f1222a6366c3bd6f15b0fa4311666333daf7cfa199c57cd",
  approved: "c997ecb61a0df4554fdffd3879f278016c2640a438fce8cb54e747937e4ca47c",
  reuse: "d2d7b35bb45b197edf801917655ab4728bbc006fa2826792e695620ea71a4a3c",
  publications: "2d6bb8ff931d779c671b658389a34fe707fc4ed6fc755b723230231aef3b0d37",
  corrected: "645227a41badbe7fe2651b81b4010bed9e5d7c305cfbb759e7b2201b9e671662",
  operatorsBase: "76e2aa288af5c4767e7df7d3b8072d607f135933de2b0a66c8f10211f41dadf2",
  operatorsHierarchy: "3fa3ae53155c714c571010c27b1858321b073a0a4b090b20c64ba23b99e2158c",
  operatorsRepair: "0b244130c7729a768fa91ab168bc1b3a82d03b673029f5493be4d7fe48bbc72a",
  operatorsParticipation: "dd5aab22e436a36d1e8a879175840622025028b0b1111cd0d370afd9729e969f",
  operatorsDeliveries: "75764b1a1ed30a0c0471c0b4cd1ec9cb387c008553107116d07526b56f872138",
};
export const digest = (text, algorithm = "sha256") => createHash(algorithm).update(text).digest("hex");
export function extractFunction(source, name) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  assert(start >= 0, "Canonical function missing: " + name);
  const tail = source.slice(start);
  const opener = /\bAS (\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$)/.exec(tail);
  assert(opener, "Function body delimiter missing: " + name);
  const bodyStart = opener.index + opener[0].length;
  const end = tail.indexOf(opener[1], bodyStart);
  assert(end > bodyStart, "Function end missing: " + name);
  return { definition: tail.slice(0, end + opener[1].length) + ";", body: tail.slice(bodyStart, end) };
}
function literal(source, variable) {
  const match = new RegExp(variable + " := (\\$[a-z]\\$)([\\s\\S]*?)\\1;").exec(source);
  assert(match, "Historical patch literal missing: " + variable);
  return match[2];
}
function substitute(source, oldText, newText) {
  assert(source.includes(oldText), "Expected historical guard is absent; no adapter generated.");
  assert.equal(source.split(oldText).length, 2, "Expected exactly one historical guard.");
  return source.replace(oldText, newText);
}
export async function buildReplayPlan() {
  const sources = {};
  for (const [name, relative] of Object.entries(canonical)) {
    sources[name] = await readFile(path.join(root, relative), "utf8");
    assert.equal(digest(sources[name]), hashes[name], "Historical source hash changed: " + relative);
  }
  const original = extractFunction(sources.approved, "save_approved_editorial_post_unlocked").body;
  let afterReuse = substitute(original, literal(sources.reuse,"old_linked"), literal(sources.reuse,"new_linked"));
  afterReuse = substitute(afterReuse, literal(sources.reuse,"old_decided"), literal(sources.reuse,"new_decided"));
  const afterPublications = substitute(afterReuse, literal(sources.publications,"old_guard"), literal(sources.publications,"new_guard"));
  assert(afterPublications.includes(literal(sources.corrected,"new_linked")));
  assert(afterPublications.includes(literal(sources.corrected,"new_decided")));
  const before=await readFile(path.join(root,"supabase/bootstrap/ci-editorial-before.sql"),"utf8");
  const after=await readFile(path.join(root,"supabase/bootstrap/ci-editorial-after.sql"),"utf8");
  const operatorBefore=await readFile(path.join(root,"supabase/bootstrap/ci-operator-parents-before.sql"),"utf8");
  const operatorAfter=await readFile(path.join(root,"supabase/bootstrap/ci-operator-parents-after.sql"),"utf8");
  const render=(template,stage,body)=>template.replaceAll("__STAGE__",stage).replaceAll("__EXPECTED_MD5__",digest(body,"md5"));
  const files = [
    ["20260814065959_ci_bind_approved_editorial.sql",render(before,"reuse",original)],
    ["20260814070001_ci_restore_editorial_names.sql",render(after,"reuse",afterReuse)],
    ["20260814105959_ci_bind_approved_editorial.sql",render(before,"publications",afterReuse)],
    ["20260814110001_ci_restore_editorial_names.sql",render(after,"publications",afterPublications)],
    ["20260828135959_ci_seed_operator_parents.sql",operatorBefore],
    ["20260828140001_ci_freeze_operator_parents.sql",operatorAfter],
  ].map(([name,sql]) => ({name,sql,sha256:digest(sql)}));
  return {files,sources,hashes,afterPublications,approvedBefore:original};
}
const statePath = path.join(root,"supabase/.temp/ci-editorial-replay.json");
function requireCI(env = process.env) {
  assert(env.GITHUB_ACTIONS==="true" && env.CI==="true", "Staging is restricted to GitHub CI; use --self-test outside CI.");
}
function outputPath(name) {
  assert(/^\d{14}_ci_(bind_approved_editorial|restore_editorial_names|seed_operator_parents|freeze_operator_parents)\.sql$/.test(name),"Unexpected staged filename");
  return path.join(root,"supabase/migrations",name);
}
async function main() {
  const command = process.argv[2];
  if (command==="--self-test") {
    const plan=await buildReplayPlan();
    assert.throws(()=>requireCI({CI:"true"}));
    assert.throws(()=>outputPath("../production.sql"));
    assert.equal(plan.files.length,6);
    assert.equal(new Set(plan.files.map(f=>f.name)).size,6);
    assert(!plan.afterPublications.includes(literal(plan.sources.publications,"old_guard")));
    console.log("CI editorial replay self-test passed: pinned sources, canonical transformations, CI-only staging and paths.");
    return;
  }
  if (command==="--print-plan") {
    const {files}=await buildReplayPlan();
    console.log(JSON.stringify(files.map(({name,sha256})=>({name,sha256})),null,2));
    return;
  }
  if (command==="--stage") {
    requireCI();
    const {files}=await buildReplayPlan();
    for (const file of files) {
      try { await readFile(outputPath(file.name)); throw new Error("Refusing to overwrite staged file: "+file.name); }
      catch(error) { if(error.code!=="ENOENT") throw error; }
    }
    await mkdir(path.dirname(statePath),{recursive:true});
    await writeFile(statePath,JSON.stringify(files.map(({name,sha256})=>({name,sha256})),null,2),{flag:"wx"});
    for (const file of files) await writeFile(outputPath(file.name),file.sql,{flag:"wx"});
    console.log("Staged six CI-only prerequisites; historical migrations unchanged.");
    return;
  }
  if (command==="--restore") {
    requireCI();
    let state;
    try { state=JSON.parse(await readFile(statePath,"utf8")); }
    catch(error) { if(error.code==="ENOENT") {console.log("No staged editorial adapters to restore.");return;} throw error; }
    assert(Array.isArray(state) && state.length===6,"Invalid CI staging record");
    for (const file of state) {
      const target=outputPath(file.name);
      let content;
      try {content=await readFile(target,"utf8");} catch(error) {if(error.code==="ENOENT") continue;throw error;}
      assert.equal(digest(content),file.sha256,"Staged SQL changed; refusing to remove it.");
      await unlink(target);
    }
    await unlink(statePath);
    console.log("Removed only the six hash-verified generated CI prerequisite files.");
    return;
  }
  throw new Error("Usage: node scripts/prepare-ci-editorial-replay.mjs --stage|--restore|--self-test|--print-plan");
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
