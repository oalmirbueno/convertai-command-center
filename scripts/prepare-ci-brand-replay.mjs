import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=fileURLToPath(new URL('../',import.meta.url));
export const historicalBrand='supabase/migrations/20260925174500_cliente_marcas_acerbi_cme.sql';
const expected='a2eb92e1f3b614b3e0b9606a21c88168eb264e7d8f7538fda1212d7a2e2c67f8';
const digest=s=>createHash('sha256').update(s).digest('hex');
export async function buildBrandPlan(){
  const source=await readFile(path.join(root,historicalBrand),'utf8');
  assert.equal(digest(source.replaceAll('\r\n','\n')),expected,'Immutable brand migration changed');
  const files=[];
  for(const [name,template] of [
    ['20260925174459_ci_brand_prerequisites.sql','ci-brand-before.sql'],
    ['20260925174501_ci_brand_cleanup.sql','ci-brand-after.sql'],
  ]){
    const sql=(await readFile(path.join(root,'supabase/bootstrap',template),'utf8')).replaceAll('__SOURCE_SHA256__',expected);
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
    assert(files.every(f=>!f.sql.includes('__SOURCE_SHA256__')));
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
