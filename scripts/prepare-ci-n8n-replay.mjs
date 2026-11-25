import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// O schema acq_n8n nasce no repositório do n8n, fora deste ledger. Em produção ele
// existe; no banco vazio do CI, a migration que pendura gatilhos nele não tem onde
// pendurar. Este script põe as duas tabelas antes dela, só no GitHub CI, e tira depois.
// As funções LANGUAGE sql do intermediador também validam, ao nascer, duas relações
// do acq_n8n; o mesmo arquivo as cria vazias, só com as colunas que essas funções citam.
export const root=fileURLToPath(new URL('../',import.meta.url));
export const historicalN8n='supabase/migrations/20261104140829_n8n_avisa_no_sino.sql';
const expected='89087042e498888e18f11a08482e8618b8aeb4e00a0bda5a504627d84a4cada0';
export const historicalIntermediador='supabase/migrations/20261125120000_intermediador_dos_grupos.sql';
const expectedIntermediador='e5feda98cc6552d766122fd5620e0a3b811c3aaaa32a5b0f3aa0336c6c08a97d';
export const stagedName='20261104140828_ci_n8n_prerequisites.sql';
const digest=s=>createHash('sha256').update(s).digest('hex');
const readSource=async file=>(await readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n');
export async function buildN8nPlan(){
  assert.equal(digest(await readSource(historicalN8n)),expected,'Immutable n8n migration changed');
  assert.equal(digest(await readSource(historicalIntermediador)),expectedIntermediador,'Immutable intermediador migration changed');
  const sql=(await readFile(path.join(root,'supabase/bootstrap/ci-n8n-before.sql'),'utf8'))
    .replaceAll('__SOURCE_SHA256__',expected).replaceAll('__INTERMEDIADOR_SHA256__',expectedIntermediador);
  return {name:stagedName,sql,sha256:digest(sql)};
}
// Relações e colunas acq_n8n citadas por alias (FROM acq_n8n.<tabela> <alias> ... <alias>.<coluna>).
export function referencedColumns(sql){
  const code=sql.replace(/--[^\n]*/g,''),out=new Map();
  for(const [,rel,alias] of code.matchAll(/\bfrom\s+acq_n8n\.(\w+)\s+(\w+)/gi)){
    const cols=out.get(rel)??new Set();out.set(rel,cols);
    for(const [,col] of code.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`,'g')))cols.add(col);
  }
  return out;
}
// Colunas de cada CREATE TABLE acq_n8n.<tabela> do bootstrap.
export function stagedColumns(sql){
  const code=sql.replace(/--[^\n]*/g,''),out=new Map();
  for(const [,rel,body] of code.matchAll(/create table if not exists acq_n8n\.(\w+)\s*\(([\s\S]*?)\n\);/gi)){
    out.set(rel,new Set(body.split('\n').map(l=>l.trim().match(/^(\w+)\s/)?.[1]).filter(Boolean)));
  }
  return out;
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
    const refs=referencedColumns(await readSource(historicalIntermediador)),staged=stagedColumns(f.sql);
    assert.deepEqual([...refs.keys()].sort(),['grupos_cliente','mensagens_entrada'],'Intermediador acq_n8n relations changed');
    for(const [rel,cols] of refs){
      assert(staged.has(rel),`CI staging lacks acq_n8n.${rel}`);
      for(const col of cols)assert(staged.get(rel).has(col),`CI staging lacks acq_n8n.${rel}.${col}`);
    }
    for(const rel of ['propostas','incidentes'])assert(staged.has(rel),`CI staging lacks acq_n8n.${rel}`);
    assert(!/\b(insert|copy|grant)\b/i.test(f.sql.replace(/--[^\n]*/g,'')),'CI staging must stay empty and grant nothing');
    console.log('n8n replay self-test passed: immutable n8n and intermediador SQL, staged acq_n8n columns, CI guard and one bounded staging path.');return;
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
