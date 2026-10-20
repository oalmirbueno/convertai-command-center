import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=fileURLToPath(new URL('../',import.meta.url));
export const historicalBrand='supabase/migrations/20260925174500_cliente_marcas_acerbi_cme.sql';
export const prerequisiteBodies=[
  ['20260720163307_ba44c9c5-a2a8-43ce-9493-c36a4a9c769d.sql','6758addc170dc6da4c1f152e1d4e07d95dd9a50f9396a9050d3124e791a7141f','__HANDLE_MD5__'],
  ['20260807211000_harden_notify_ops_sync_vault.sql','3d8230382a168e14536ccfb0b23ac0a397575347bb8bd6a5811813a12796ace8','__OPS_MD5__'],
];
const expected='a2eb92e1f3b614b3e0b9606a21c88168eb264e7d8f7538fda1212d7a2e2c67f8';
const digest=s=>createHash('sha256').update(s).digest('hex');
export async function buildBrandPlan(){
  const source=await readFile(path.join(root,historicalBrand),'utf8');
  assert.equal(digest(source.replaceAll('\r\n','\n')),expected,'Immutable brand migration changed');
  const bodies=new Map();
  for(const [name,sha256,placeholder] of prerequisiteBodies){
    const pinned=(await readFile(path.join(root,'supabase/migrations',name),'utf8')).replaceAll('\r\n','\n');
    assert.equal(digest(pinned),sha256,'Historical prerequisite changed: '+name);
    const match=pinned.match(/\bAS (\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$)([\s\S]*?)\1;/);
    assert(match,'Historical trigger body missing');
    bodies.set(placeholder,createHash('md5').update(match[2]).digest('hex'));
  }
  const files=[];
  for(const [name,template] of [
    ['20260925174459_ci_brand_prerequisites.sql','ci-brand-before.sql'],
    ['20260925174501_ci_brand_cleanup.sql','ci-brand-after.sql'],
  ]){
    let sql=(await readFile(path.join(root,'supabase/bootstrap',template),'utf8')).replaceAll('__SOURCE_SHA256__',expected);
    for(const [placeholder,bodyMd5] of bodies)sql=sql.replaceAll(placeholder,bodyMd5);
    files.push({name,sql,sha256:digest(sql)});
  }
  return {source,files};
}
const statePath=path.join(root,'supabase/.temp/ci-brand-replay.json');
export function requireCI(env=process.env){
  assert(env.GITHUB_ACTIONS==='true'&&env.CI==='true','Brand staging requires GitHub CI');
}
function target(name){
  assert(/^2026092517(4459_ci_brand_prerequisites|4501_ci_brand_cleanup)\.sql$/.test(name),'Unexpected brand staging path');
  return path.join(root,'supabase/migrations',name);
}
async function main(){
  const command=process.argv[2];
  if(command==='--self-test'){
    const {files}=await buildBrandPlan();
    assert.throws(()=>requireCI({CI:'true'}));
    assert.throws(()=>target('../production.sql'));
    assert.equal(files.length,2);
    assert(files.every(f=>!/__\w+__/.test(f.sql)));
    console.log('Brand replay self-test passed: immutable SQL, CI guard and two bounded staging paths.');return;
  }
  requireCI();
  if(command==='--stage'){
    const {files}=await buildBrandPlan();
    for(const f of files){
      try{await readFile(target(f.name));throw Error('Refusing to overwrite '+f.name)}
      catch(e){if(e.code!=='ENOENT')throw e}
    }
    await mkdir(path.dirname(statePath),{recursive:true});
    await writeFile(statePath,JSON.stringify(files.map(({name,sha256})=>({name,sha256}))),{flag:'wx'});
    for(const f of files)await writeFile(target(f.name),f.sql,{flag:'wx'});
    console.log('Staged synthetic brand parents and verified cleanup; historical SQL unchanged.');return;
  }
  if(command==='--restore'){
    let state;try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(e){if(e.code==='ENOENT')return;throw e}
    assert(Array.isArray(state)&&state.length===2,'Invalid brand staging record');
    for(const f of state){
      let sql;try{sql=await readFile(target(f.name),'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
      assert.equal(digest(sql),f.sha256,'Staged brand SQL changed');await unlink(target(f.name));
    }
    await unlink(statePath);console.log('Removed only the two hash-verified brand staging files.');return;
  }
  throw Error('Usage: --self-test|--stage|--restore');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error(e.message);process.exitCode=1});
}
