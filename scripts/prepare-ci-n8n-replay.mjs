import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// O schema acq_n8n nasce no repositório do n8n, fora deste ledger. Em produção ele
// existe; no banco vazio do CI, a migration que pendura gatilhos nele não tem onde
// pendurar. Este script põe as duas tabelas antes dela, só no GitHub CI, e tira depois.
export const root=fileURLToPath(new URL('../',import.meta.url));
export const historicalN8n='supabase/migrations/20261104140829_n8n_avisa_no_sino.sql';
const expected='89087042e498888e18f11a08482e8618b8aeb4e00a0bda5a504627d84a4cada0';
export const stagedName='20261104140828_ci_n8n_prerequisites.sql';
const digest=s=>createHash('sha256').update(s).digest('hex');
export async function buildN8nPlan(){
  const source=(await readFile(path.join(root,historicalN8n),'utf8')).replaceAll('\r\n','\n');
  assert.equal(digest(source),expected,'Immutable n8n migration changed');
  const sql=(await readFile(path.join(root,'supabase/bootstrap/ci-n8n-before.sql'),'utf8')).replaceAll('__SOURCE_SHA256__',expected);
  return {name:stagedName,sql,sha256:digest(sql)};
}
const statePath=path.join(root,'supabase/.temp/ci-n8n-replay.json');
export function requireCI(env=process.env){
  assert(env.GITHUB_ACTIONS==='true'&&env.CI==='true','n8n staging requires GitHub CI');
}
function target(name){
  assert(name===stagedName,'Unexpected n8n staging path');
  return path.join(root,'supabase/migrations',name);
}
async function main(){
  const command=process.argv[2];
  if(command==='--self-test'){
    const f=await buildN8nPlan();
    assert.throws(()=>requireCI({CI:'true'}));
    assert.throws(()=>target('../production.sql'));
    assert(!/__\w+__/.test(f.sql));
    console.log('n8n replay self-test passed: immutable SQL, CI guard and one bounded staging path.');return;
  }
  requireCI();
  if(command==='--stage'){
    const f=await buildN8nPlan();
    try{await readFile(target(f.name));throw Error('Refusing to overwrite '+f.name)}
    catch(e){if(e.code!=='ENOENT')throw e}
    await mkdir(path.dirname(statePath),{recursive:true});
    await writeFile(statePath,JSON.stringify({name:f.name,sha256:f.sha256}),{flag:'wx'});
    await writeFile(target(f.name),f.sql,{flag:'wx'});
    console.log('Staged CI-only acq_n8n parents; historical SQL unchanged.');return;
  }
  if(command==='--restore'){
    let state;try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(e){if(e.code==='ENOENT')return;throw e}
    let sql;try{sql=await readFile(target(state.name),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
    if(sql!==undefined){assert.equal(digest(sql),state.sha256,'Staged n8n SQL changed');await unlink(target(state.name))}
    await unlink(statePath);console.log('Removed only the hash-verified n8n staging file.');return;
  }
  throw Error('Usage: --self-test|--stage|--restore');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error(e.message);process.exitCode=1});
}
