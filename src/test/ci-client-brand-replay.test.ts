// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const temporary:string[]=[];
const historical='supabase/migrations/20260925174500_cliente_marcas_acerbi_cme.sql';
const staged=['20260925174459_ci_brand_prerequisites.sql','20260925174501_ci_brand_cleanup.sql'];
const triggerSources=['20260720163307_ba44c9c5-a2a8-43ce-9493-c36a4a9c769d.sql','20260807211000_harden_notify_ops_sync_vault.sql'];
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'aceleriq-ci-brand-'));temporary.push(root);
  for(const p of ['scripts/prepare-ci-brand-replay.mjs',historical,...triggerSources.map(n=>'supabase/migrations/'+n),'supabase/bootstrap/ci-brand-before.sql','supabase/bootstrap/ci-brand-after.sql']){
    const to=join(root,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(p),to);
  }
  const run=(command:string,ci=true)=>spawnSync(process.execPath,[join(root,'scripts/prepare-ci-brand-replay.mjs'),command],{
    encoding:'utf8',windowsHide:true,env:{...process.env,CI:ci?'true':'false',GITHUB_ACTIONS:ci?'true':'false'},
  });
  return {root,run,path:(name:string)=>join(root,'supabase/migrations',name)};
}
afterEach(()=>{for(const p of temporary.splice(0))rmSync(p,{recursive:true,force:true})});
describe('empty CI replay of historical brand data',()=>{
  it('stages around the unchanged migration and removes only its own files',()=>{
    const f=fixture();const original=readFileSync(join(f.root,historical));
    expect(f.run('--self-test',false).status).toBe(0);
    expect(f.run('--stage').status).toBe(0);
    for(const p of staged)expect(existsSync(f.path(p))).toBe(true);
    expect(readFileSync(join(f.root,historical))).toEqual(original);
    expect(f.run('--restore').status).toBe(0);
    for(const p of staged)expect(existsSync(f.path(p))).toBe(false);
    expect(readFileSync(join(f.root,historical))).toEqual(original);
  });
  it('refuses staging outside CI and refuses a changed historical source',()=>{
    const f=fixture();expect(f.run('--stage',false).status).not.toBe(0);
    for(const p of staged)expect(existsSync(f.path(p))).toBe(false);
    writeFileSync(join(f.root,historical),'changed historical SQL');
    expect(f.run('--stage').status).not.toBe(0);
    for(const p of staged)expect(existsSync(f.path(p))).toBe(false);
  });
  it('preserves an existing file instead of overwriting it',()=>{
    const f=fixture();writeFileSync(f.path(staged[0]),'pre-existing');
    expect(f.run('--stage').status).not.toBe(0);
    expect(readFileSync(f.path(staged[0]),'utf8')).toBe('pre-existing');
    expect(existsSync(f.path(staged[1]))).toBe(false);
  });
  it('refuses a changed trigger prerequisite rather than accepting unreviewed code',()=>{
    const f=fixture();writeFileSync(f.path(triggerSources[1]),'changed trigger');
    expect(f.run('--stage').status).not.toBe(0);
    for(const p of staged)expect(existsSync(f.path(p))).toBe(false);
  });
  it('refuses to remove a changed staged file',()=>{
    const f=fixture();expect(f.run('--stage').status).toBe(0);
    writeFileSync(f.path(staged[0]),'changed staging');
    expect(f.run('--restore').status).not.toBe(0);
    expect(readFileSync(f.path(staged[0]),'utf8')).toBe('changed staging');
  });
});
