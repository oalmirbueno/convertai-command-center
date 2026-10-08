"""Inventário MCP de leitura. Não faz refresh Meta, campanha ou alteração externa."""
import asyncio, datetime as dt, json, re, sys, os
from pathlib import Path
from zoneinfo import ZoneInfo
from portfolio_scope import PROJECT_ID, select_clients, read_selection
sys.path.insert(0, '/usr/local/lib/hermes-agent')
from tools.mcp_tool_config import _load_mcp_config
from tools.mcp_tool_discovery import _connect_server
OUT=Path(os.environ['META_MONITOR_OUT'])
OUT.mkdir(parents=True,exist_ok=True)
EXCLUDED={'14f72d12-a00b-4673-99c6-4dabbcc8aad1'}
RESTRICTED={'20c96cea-6ada-4db5-a408-25a3b0c978ba'}
ALLOW={'aceleriq_list_clients','aceleriq_get_project','aceleriq_get_client_dossier','aceleriq_get_ads_campaigns','aceleriq_get_ads_performance','aceleriq_get_current_dossier','aceleriq_health'}
def clean(s):
    s=re.sub(r'(?im)^.*(?:access_token|refresh_token|authorization\s*[:=]|api_key\s*[:=]|password\s*[:=]|senha\s*[:=]|cookie\s*[:=]).*$', '[REDACTED]', s)
    s=re.sub(r'https?://[^\s<>\"]+',lambda m:m[0].split('?')[0],s)
    return s
def scrub(x):
    if isinstance(x,dict):
        return {k:('[REDACTED]' if re.search(r'(?i)^(access_token|refresh_token|authorization|api_key|password|senha|cookie|secret)$',k) else scrub(v)) for k,v in x.items() if k not in ('email','phone','avatar_url')}
    if isinstance(x,list):return [scrub(v) for v in x]
    return clean(x) if isinstance(x,str) else x
async def read(server,name,args):
    assert name in ALLOW
    r=await asyncio.wait_for(server.session.call_tool(name,args),timeout=30)
    text='\n'.join(getattr(x,'text','') for x in r.content)
    if getattr(r,'isError',False):raise RuntimeError(clean(text)[:180])
    x=json.loads(text)
    if isinstance(x,dict) and isinstance(x.get('result'),str):x=json.loads(x['result'])
    return scrub(x)
def disabled(x):
    if isinstance(x,dict):
        for k,v in x.items():
            if k in ('is_ads_mcp_enabled','ads_mcp_enabled','ads_read_enabled','is_ads_consultable','can_read_ads') and v is False:return True
            if isinstance(v,(dict,list)) and disabled(v):return True
    elif isinstance(x,list):return any(disabled(v) for v in x)
    return False
async def main():
    conf=_load_mcp_config()
    if 'aceleriq' not in conf:raise RuntimeError('MCP existente indisponível; nenhuma configuração alterada.')
    server=await _connect_server('aceleriq',conf['aceleriq'])
    index=[]
    try:
        roster=await read(server,'aceleriq_list_clients',{'limit':500,'offset':0})
        if roster.get('has_more'):raise RuntimeError('Roster incompleto; interrompido antes de consulta individual.')
        clients=[{k:x.get(k) for k in ('id','company_name','plan_status','client_type')} for x in roster['items']]
        assert len({x['id'] for x in clients})==roster['total']
        now=dt.datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat()
        (OUT/'roster.json').write_text(json.dumps({'collected_at':now,'total':roster['total'],'clients':clients},ensure_ascii=False,indent=2))
        project = await read(server, 'aceleriq_get_project', {'project_id': PROJECT_ID})
        if 'scope' not in project.get('project', {}):
            raise RuntimeError('A carteira não foi confirmada pelo painel; nenhuma leitura individual iniciada.')
        scope = project['project']['scope']
        selected = select_clients(clients, scope, EXCLUDED)
        selection_source = 'panel' if read_selection(scope) is not None else 'existing_roster'
        sem=asyncio.Semaphore(1)
        async def one(c):
            async with sem:
                row={'client':c,'collected_at':dt.datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat(),'source':'Painel/MCP: leitura de registros; não refresh direto da Meta'}
                try:
                    d=await read(server,'aceleriq_get_client_dossier',{'client_id':c['id']})
                    row['dossier']=d
                    block=c['id'] in RESTRICTED or disabled(d)
                    row['ads_mcp_restricted']=block
                    if block:
                        row['campaigns_read']='not_called_restricted'
                        row['performance_read']='not_called_restricted'
                    else:
                        for key,tool,args in [('campaigns','aceleriq_get_ads_campaigns',{'client_id':c['id'],'only_active':False}),('performance','aceleriq_get_ads_performance',{'client_id':c['id'],'days':30})]:
                            try:row[key]=await read(server,tool,args)
                            except Exception as e:row[key+'_error']=type(e).__name__+': '+clean(str(e))[:160]
                    state={'client_id':c['id'],'name':c['company_name'],'plan_status':c['plan_status'],'restricted':block,'dossier_ok':True,'campaigns_ok':'campaigns' in row,'performance_ok':'performance' in row}
                except Exception as e:
                    row['error']=type(e).__name__+': '+clean(str(e))[:160]
                    state={'client_id':c['id'],'name':c['company_name'],'error':row['error']}
                (OUT/(c['id']+'.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2))
                index.append(state)
                print(json.dumps(state,ensure_ascii=False),flush=True)
        await asyncio.gather(*(one(c) for c in selected))
        summary={'collected_at':now,'roster_count':len(clients),'expected':len(selected),'collected':len(index),'items':sorted(index,key=lambda x:x['name'] or ''),'excluded':['Ajenda'],'direct_meta_collection':False,'selection_source':selection_source,'portfolio_project_id':PROJECT_ID}
        (OUT/'collection.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
        assert len(index)==len(selected)
        print('COVERAGE',len(index),'/',len(selected),'ROSTER',len(clients),flush=True)
    finally:await server.shutdown()
if __name__=='__main__':asyncio.run(asyncio.wait_for(main(),timeout=150))
