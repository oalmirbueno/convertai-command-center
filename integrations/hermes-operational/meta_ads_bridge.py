"""Durable internal execution reports; never calls Meta or changes tasks.
Only enqueue is local. Transport is connected explicitly by the CLI/drain.
"""
import argparse
import asyncio
import datetime as dt
import hashlib
import json
import sqlite3
from pathlib import Path
from contextlib import contextmanager

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (300, 1800, 7200)
BASE = Path(__file__).resolve().parent


def readable_report(root, payload):
    """Project an existing, hash-verified report into the panel. No collection or AI."""
    import re
    if payload.get('event') != 'review' or not payload.get('run_key', '').startswith('meta-snapshot-review-'):
        return payload
    root = Path(root).resolve()
    evidence = payload.get('evidence', '')
    candidates = re.findall(r'/root/[^\s;]+\.md', evidence)
    if not candidates:
        return dict(payload, detail={'work_kind': 'documental'})
    source = Path(candidates[-1]).resolve()
    if not any(source.is_relative_to(root / folder) for folder in ('runs', 'outputs')) or not source.is_file():
        raise ValueError('Report outside this workflow or missing')
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() not in evidence:
        raise ValueError('Report changed since its recorded evidence; create a new version')
    content = raw.decode('utf-8')
    if len(content) > 32000:
        raise ValueError('Report exceeds readable contract; attach the full file first')
    return dict(payload, detail={'work_kind': 'documental', 'title': 'Acompanhamento Meta Ads · relatório do espelho', 'summary': content})


@contextmanager
def db(root):
    path = Path(root)/'bridge-outbox.sqlite3'
    con = sqlite3.connect(path, timeout=2)
    con.execute('PRAGMA synchronous=FULL')
    con.execute('''CREATE TABLE IF NOT EXISTS reports (
        key TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at REAL NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
        run_id TEXT, error TEXT, updated_at TEXT)''')
    try:
        with con:
            yield con
    finally:
        con.close()


def read_outbox(root):
    with db(root) as con:
        con.row_factory = sqlite3.Row
        return [dict(row, payload=json.loads(row['payload'])) for row in con.execute('SELECT * FROM reports ORDER BY key')]


def enqueue_snapshot(root, run):
    root, run = Path(root).resolve(), Path(run).resolve()
    if run.parent != root/'runs':
        raise ValueError('Snapshot must belong to this workflow/runs')
    raw = (run/'resumo.json').read_bytes()
    summary = json.loads(raw)
    if summary['expected'] != summary['collected'] or summary['collected'] != len(summary['clients']):
        raise ValueError('Incomplete snapshot index')
    digest = hashlib.sha256(raw).hexdigest()
    cut = summary['observed_at']
    clients = summary['clients']
    endings = [{'client_id':c['client_id'], 'client':c['name'], **e} for c in clients for e in c.get('ends_today', [])]
    gaps = [c['client_id'] for c in clients if not c.get('comparisons',{}).get('sete_vs_sete_anteriores',{}).get('complete_dates',False)]
    restricted = [c['client_id'] for c in clients if c.get('state') == 'restrito Ads']
    coordination = {
        'snapshot':str(run), 'observed_at':cut, 'summary_sha256':digest,
        'source':'Painel/MCP; não nova coleta Meta', 'kind':'triagem determinística; não é análise IA',
        'coverage':{'expected':summary['expected'],'collected':summary['collected'],'read_failures':summary.get('failures',[])},
        'ends_today':endings, 'incomplete_seven_day_comparisons':gaps,'restricted_clients':restricted,
        'dependencies':['Helena: análise por objetivo e confirmação de evidências de gates/dot', 'Core: consolidar prioridades e aprovações materiais'],
        'next_step':'Helena validar o corte e objetivos; Augusto conferir cada gate contra dossiê/dot antes de propor ação ao Core.',
        'approval_required_for':['campanha/objetivo/público/criativo', 'orçamento/verba/pagamento/recarga', 'renovação/prazo/novo ciclo', 'publicação/mensagem externa', 'conta/acesso/integração', 'mudança de responsável/fechamento de tarefa', 'custo/modelo/concorrência/toolsets'],
        'gate_rule':'Fim de programação não comprova execução; pagamento ou saldo não autoriza novo ciclo.',
        'dot_state':'não comprovada por snapshot; consultar evidência vigente antes de qualquer duplicação',
    }
    output = root/'outputs'/'augusto'/run.name
    output.mkdir(parents=True, exist_ok=True)
    target = output/'coordenacao-deterministica.json'
    if not target.exists():
        target.write_text(json.dumps(coordination,ensure_ascii=False,indent=2))
    report = run/'relatorio.md'
    if not report.is_file() or report.is_symlink():
        raise ValueError('Snapshot has no real report')
    report_raw = report.read_bytes()
    if not report_raw:
        raise ValueError('Snapshot report is empty')
    report_digest = hashlib.sha256(report_raw).hexdigest()
    evidence = (f'Corte {cut}; snapshot {run}; resumo SHA256 {digest}; '
                f'artefato real relatorio.md {report}; SHA256 {report_digest}. '
                f'Cobertura {summary["collected"]}/{summary["expected"]}; '
                f'Fonte Painel/MCP, sem nova coleta Meta. Revisão confirma somente a existência/corte do snapshot; '
                f'não é análise IA nem certificação de qualidade, aprovação ou freshness primária.')
    keys = []
    with db(root) as con:
        for operator in ('helena','augusto'):
            # The review namespace is deliberate: the previous monitor reused this
            # run_key for a progress heartbeat, so the MCP idempotency key could
            # resurrect an orphan progress run instead of creating a review run.
            key = f'meta-snapshot-review-{run.name}-{digest[:16]}-{operator}'
            payload = {'operator':operator,'event':'review','run_key':key,'from_cron':True,
                       'approval_required':False,'timeout_seconds':900,
                       'action': 'Snapshot determinístico revisado com prova real relatorio.md; não é análise especializada nem heartbeat.' if operator=='helena' else 'Snapshot determinístico revisado com prova real relatorio.md; coordenação e gates ainda não são análise especializada.',
                       'evidence':evidence,
                       'next_step': 'Produzir análise própria por objetivo em atividade separada, usando este snapshot como fonte.' if operator=='helena' else 'Produzir coordenação/gates em atividade separada; decisões sensíveis dependem de aprovação específica.'}
            con.execute('INSERT OR IGNORE INTO reports(key,payload) VALUES (?,?)',(key,json.dumps(payload,ensure_ascii=False)))
            keys.append(key)
    return keys


def enqueue_review(root, run, operator):
    """Report existence of a cut-matched real artifact, not quality/approval."""
    if operator not in ('helena','augusto'):
        raise ValueError('Unknown operator')
    root,run=Path(root).resolve(),Path(run).resolve()
    # Validates snapshot and computes stable base key; does not generate IA output.
    keys=enqueue_snapshot(root,run)
    summary=json.loads((run/'resumo.json').read_text())
    artifact=root/'outputs'/operator/run.name/('analise.md' if operator=='helena' else 'coordenacao.md')
    if not artifact.is_file() or artifact.is_symlink():
        raise ValueError('Real artifact missing')
    raw=artifact.read_bytes();text=raw.decode('utf-8')
    if len(raw)<200 or f'Snapshot: {run.name}' not in text or f'Corte: {summary["observed_at"]}' not in text:
        raise ValueError('Artifact snapshot/cut missing or mismatched')
    base=next(key for key in keys if key.endswith('-'+operator))
    key=base+'-analysis'
    digest=hashlib.sha256(raw).hexdigest()
    payload={'operator':operator,'event':'review','run_key':key,'from_cron':True,
             'approval_required':False,'timeout_seconds':900,
             'action':'Artefato especializado produzido no turno do Core, pronto para revisão interna; nenhuma ação externa executada.',
             'evidence':f'Corte {summary["observed_at"]}; snapshot {run}; artefato {artifact}; SHA256 {digest}. Existência/corte conferidos; qualidade e aprovação não certificadas. Fonte Painel/MCP, não nova coleta Meta. Entregável especializado no turno do Core, não execução separada de perfil.',
             'next_step':'Core revisar recomendações/gates; decisões sensíveis dependem de aprovação específica de Almir.'}
    encoded=json.dumps(payload,ensure_ascii=False)
    with db(root) as con:
        old=con.execute('SELECT payload FROM reports WHERE key=?',(key,)).fetchone()
        if old and old[0]!=encoded:
            raise ValueError('Artifact changed after first review enqueue; requires explicit versioned review')
        con.execute('INSERT OR IGNORE INTO reports(key,payload) VALUES (?,?)',(key,encoded))
    return key


async def drain(root, call, now=None, limit=4, budget=45):
    """One bounded attempt per due record; stable run_key on every retry."""
    import fcntl
    import time
    now = time.time() if now is None else now
    deadline = time.monotonic()+budget
    with (Path(root)/'bridge.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return {'locked':True}
        with db(root) as con:
            con.execute("UPDATE reports SET state='exhausted',error='Interrupted final attempt; not confirmed' WHERE state='pending' AND attempts>=?",(MAX_ATTEMPTS,))
            rows=con.execute("SELECT key,payload,attempts FROM reports WHERE state='pending' AND next_at<=? AND attempts<? ORDER BY attempts,key LIMIT ?",(now,MAX_ATTEMPTS,limit)).fetchall()
        for key, raw, attempts in rows:
            if time.monotonic()>=deadline:
                break
            payload=json.loads(raw);attempts+=1
            with db(root) as con:
                con.execute('UPDATE reports SET attempts=?, next_at=?, updated_at=? WHERE key=?',(attempts,now+BACKOFF_SECONDS[attempts-1],dt.datetime.now(dt.timezone.utc).isoformat(),key))
            payload['attempt']=attempts
            try:
                await asyncio.wait_for(call('aceleriq_operator_report',payload),timeout=max(.1,min(12,deadline-time.monotonic())))
                board=await asyncio.wait_for(call('aceleriq_operator_board',{'operator':payload['operator'],'limit':100}),timeout=max(.1,min(12,deadline-time.monotonic())))
                found=next((r for r in board.get('runs_recentes',[]) if r.get('run_key')==key and r.get('operador')==payload['operator'] and r.get('status')==payload['event']),None)
                if not found or not found.get('id'):
                    raise RuntimeError('Report not confirmed by exact board readback')
                with db(root) as con:
                    con.execute("UPDATE reports SET state='sent',run_id=?,error=NULL WHERE key=?",(found['id'],key))
            except Exception as exc:
                # Exception text may contain secrets; persist the class only.
                error=type(exc).__name__+'; registro/readback não confirmado'
                with db(root) as con:
                    con.execute('UPDATE reports SET state=?,error=? WHERE key=?',('exhausted' if attempts>=MAX_ATTEMPTS else 'pending',error,key))
                    if payload['event']!='failed':
                        failure=dict(payload,run_key=key+'-bridge-failure',event='failed',attempt=1,
                                     action='Ponte interna do snapshot falhou; snapshot preservado e retry finito pendente.',
                                     error=error,next_step='Augusto verificar outbox e conexão MCP; não recoletar nem simular análise.')
                        con.execute('INSERT OR IGNORE INTO reports(key,payload) VALUES (?,?)',(failure['run_key'],json.dumps(failure,ensure_ascii=False)))
        return {'states':[{k:r[k] for k in ('key','state','attempts','run_id','error')} for r in read_outbox(root)]}


async def real_drain(root, budget=45):
    """Existing MCP connection, exact allowlist. No credentials persisted."""
    if (Path(root)/'PAUSED').exists():
        return {'paused':True}
    import sys
    import time
    deadline=time.monotonic()+budget
    sys.path.insert(0,'/usr/local/lib/hermes-agent')
    from tools.mcp_tool_config import _load_mcp_config
    from tools.mcp_tool_discovery import _connect_server
    allowed={'aceleriq_operator_report','aceleriq_operator_board'}
    server=None
    try:
        conf=_load_mcp_config()
        server=await asyncio.wait_for(_connect_server('aceleriq',conf['aceleriq']),timeout=min(10,budget))
        listed=await asyncio.wait_for(server.session.list_tools(),timeout=5)
        schemas={t.name:t.input_schema for t in listed.tools if t.name in allowed}
        if set(schemas)!=allowed:
            raise RuntimeError('Exact report/board tools absent')
        async def call(name,args):
            if name == 'aceleriq_operator_report':
                args = readable_report(root, args)
            if name not in allowed or set(args)-set(schemas[name].get('properties',{})):
                raise ValueError('Tool or schema outside allowlist')
            result=await server.session.call_tool(name,args)
            if getattr(result,'isError',False):
                raise RuntimeError('MCP report/read failed')
            value=json.loads('\n'.join(getattr(c,'text','') for c in result.content))
            if isinstance(value,dict) and isinstance(value.get('result'),str):
                value=json.loads(value['result'])
            if isinstance(value,dict) and value.get('error'):
                raise RuntimeError('MCP error envelope')
            return value
        return await drain(root,call,budget=max(.1,deadline-time.monotonic()))
    except Exception as exc:
        error_class=type(exc).__name__
        async def unavailable(name,args):
            raise RuntimeError(error_class)
        return await drain(root,unavailable,budget=budget)
    finally:
        if server:
            await server.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot',type=Path)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--drain',action='store_true')
    parser.add_argument('--review-artifact',choices=['helena','augusto'])
    args = parser.parse_args()
    if args.dry_run and args.drain:
        parser.error('dry-run cannot use network/drain')
    if args.review_artifact and not args.snapshot:
        parser.error('review-artifact requires explicit snapshot')
    if args.snapshot:
        print(json.dumps(enqueue_snapshot(BASE,args.snapshot)))
    if args.review_artifact:
        print(enqueue_review(BASE,args.snapshot,args.review_artifact))
    if args.dry_run:
        print(json.dumps(read_outbox(BASE),ensure_ascii=False))
    if args.drain:
        print(json.dumps(asyncio.run(real_drain(BASE)),ensure_ascii=False))
