"""Monitor determinístico somente leitura do espelho Painel. Sem chamadas Meta diretas."""
import csv, datetime as dt, fcntl, io, json, os, subprocess, sys, time
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo
BASE=Path(__file__).resolve().parent
TZ=ZoneInfo('America/Sao_Paulo')
def window(rows, dates):
    found=[r for r in rows if r.get('day') in dates]
    events=[Decimal(str(a['value'])) for r in found for a in r.get('actions',[]) if a.get('action_type')=='onsite_conversion.messaging_conversation_started_7d' and a.get('value') is not None]
    spend=[Decimal(str(r['spend'])) for r in found if r.get('spend') is not None]
    return {'days_present':len({r['day'] for r in found}),'days_expected':len(dates),'spend':str(sum(spend)) if spend else None,'impressions':sum(r['impressions'] for r in found if r.get('impressions') is not None) if found else None,'conversations':str(sum(events)) if events else None}
def main():
    BASE.mkdir(parents=True,exist_ok=True)
    if (BASE/'PAUSED').exists(): print('Monitor Meta/Painel pausado por flag local.');return
    with (BASE/'monitor.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('Monitor não iniciou: outra execução possui o lock.');return
        deadline=time.monotonic()+180
        now=dt.datetime.now(TZ);run=BASE/'runs'/now.strftime('%Y%m%dT%H%M%S%f');data=run/'dados';data.mkdir(parents=True)
        env=dict(os.environ,META_MONITOR_OUT=str(data))
        result=subprocess.run(['/usr/local/lib/hermes-agent/venv/bin/python',str(BASE/'coletar.py')],env=env,capture_output=True,text=True,timeout=165)
        (run/'collector.log').write_text(result.stdout)
        if result.returncode:raise RuntimeError('Coleta Painel falhou; ver collector.log local. Não usado fallback Meta.')
        idx=json.loads((data/'collection.json').read_text());assert idx['expected']==idx['collected']==len(idx['items'])
        today=now.date();dates=lambda back,n:{(today-dt.timedelta(days=k)).isoformat() for k in range(back,back+n)}
        specs={'ontem':dates(1,1),'anterior':dates(2,1),'sete_dias':dates(1,7),'sete_anteriores':dates(8,7),'hoje_parcial':dates(0,1)}
        lines=['# Monitor Meta Ads — espelho Painel',f'Consulta: {now.isoformat()}',f"Cobertura: {idx['collected']}/{idx['expected']} clientes.",'Fonte: Painel/MCP. Não é consulta direta Meta. Origem primária/runID Meta não comprovados; atualização de banco não certifica freshness.','Responsáveis: Augusto coordena; Helena analisa; Core consolida. Não altera campanhas/verbas/publicações.','Ajenda excluída; Para Si e qualquer flag Ads desabilitada respeitadas.','']
        analysis=[];faults=[]
        for item in idx['items']:
            raw=json.loads((data/(item['client_id']+'.json')).read_text());rows=raw.get('performance',{}).get('daily',[])
            keys=[(r.get('campaign_id'),r.get('day')) for r in rows]
            if len(keys)!=len(set(keys)):raise RuntimeError('Duplicatas de campanha/dia: não agregar silenciosamente.')
            metrics={name:window(rows,ds) for name,ds in specs.items()}
            restricted=raw.get('ads_mcp_restricted',False)
            if 'error' in item or (not restricted and not(item.get('campaigns_ok') and item.get('performance_ok'))):faults.append(item['name'])
            ends=[]
            for camp in raw.get('campaigns',{}).get('campaigns',[]):
                stop=camp.get('stop_time')
                if stop:
                    try:
                        end=dt.datetime.fromisoformat(stop.replace('Z','+00:00')).astimezone(TZ)
                        if end.date()==today:ends.append({'id':camp.get('campaign_id'),'name':camp.get('name'),'end_brt':end.isoformat(),'past':end<now})
                    except ValueError:pass
            state='restrito Ads' if restricted else ('diários disponíveis' if rows else 'sem diários: resultado indisponível, não zero')
            def compare(left,right):
                x,y=metrics[left],metrics[right]
                complete=x['days_present']==x['days_expected'] and y['days_present']==y['days_expected']
                changes={}
                for key in ('spend','impressions','conversations'):
                    old,new=y[key],x[key]
                    changes[key+'_pct']=str((Decimal(str(new))/Decimal(str(old))-1)*100) if complete and old is not None and new is not None and Decimal(str(old))!=0 else None
                return {'complete_dates':complete,'changes_observed_pct':changes}
            rec={'client_id':item['client_id'],'name':item['name'],'state':state,'windows':metrics,'comparisons':{'ontem_vs_anterior':compare('ontem','anterior'),'sete_vs_sete_anteriores':compare('sete_dias','sete_anteriores')},'ends_today':ends,'source':'Painel/MCP','meta_source_read_at':None}
            analysis.append(rec);lines += [f"## {item['name']}",f'Estado: {state}.','| Janela | Datas | Gasto observado R$ | Impressões | Conversas atribuídas |','|---|---|---|---|---|']
            for name,v in metrics.items():lines.append(f"| {name} | {v['days_present']}/{v['days_expected']} | {v['spend'] if v['spend'] is not None else 'NA'} | {v['impressions'] if v['impressions'] is not None else 'NA'} | {v['conversations'] if v['conversations'] is not None else 'NA'} |")
            for end in ends:lines.append(f"Término hoje: {end['end_brt']} — objeto {end['id']}. Agenda do espelho; confirmar estado efetivo, sem renovar automaticamente.")
            lines.append('')
        summary={'observed_at':now.isoformat(),'expected':idx['expected'],'collected':idx['collected'],'direct_meta_collection':False,'failures':faults,'clients':analysis}
        (run/'resumo.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));(run/'relatorio.md').write_text('\n'.join(lines)+'\n')
        tmp=BASE/'LATEST.tmp';tmp.write_text(str(run));tmp.replace(BASE/'LATEST')
        # Queue durably before any optional network/reporting. Snapshot survives all bridge failures.
        try:
            sys.path.insert(0,str(Path(__file__).resolve().parent))
            from painel_bridge import enqueue_snapshot
            keys=enqueue_snapshot(BASE,run)
            print('PAINEL_OUTBOX:', ', '.join(keys))
            remaining=deadline-time.monotonic()-1
            if remaining<=0:raise TimeoutError('Bridge deadline exhausted; outbox remains durable')
            delivery=subprocess.run(['/usr/local/lib/hermes-agent/venv/bin/python',str(BASE/'painel_bridge.py'),'--drain'],capture_output=True,text=True,timeout=min(50,remaining))
            (run/'bridge.log').write_text(delivery.stdout)
            if delivery.returncode:print('PAINEL_PENDENTE: ponte falhou; snapshot/outbox preservados.')
            elif any(r['state']!='sent' for r in json.loads(delivery.stdout).get('states',[])):
                print('PAINEL_PENDENTE: registros internos aguardam retry finito/verificação; ver bridge.log.')
        except Exception as exc:
            # Do not echo potentially sensitive exception messages.
            (run/'bridge-failed.json').write_text(json.dumps({'event':'failed','component':'internal-report-bridge','error_class':type(exc).__name__,'snapshot_preserved':True}))
            print('PAINEL_PENDENTE:',type(exc).__name__,'; snapshot preservado, ver outbox/bridge-failed.json.')
        if (BASE/'render_acompanhamento.py').exists():
            remaining=deadline-time.monotonic()-1
            if remaining>0:
                try:
                    view=subprocess.run([sys.executable,str(BASE/'render_acompanhamento.py')],capture_output=True,text=True,timeout=min(15,remaining))
                    if view.returncode:print('VISÃO não atualizada; relatório preservado.')
                except subprocess.TimeoutExpired:print('VISÃO excedeu prazo; relatório/outbox preservados.')
            else:print('VISÃO adiada por limite do turno; relatório/outbox preservados.')
        print(f"MONITOR_EXECUTADO: {idx['collected']}/{idx['expected']} clientes; falhas de leitura: {len(faults)}. Fonte Painel/MCP, não Meta direta.")
        print(f'RELATÓRIO: {run}/relatorio.md\nDADOS: {run}/resumo.json')
        for rec in analysis:
            if rec['ends_today']:print('MARCO_HOJE:',rec['name'],', '.join(x['end_brt'] for x in rec['ends_today']))
        if faults:print('COBERTURA_INCOMPLETA:',', '.join(faults))
if __name__=='__main__':main()
