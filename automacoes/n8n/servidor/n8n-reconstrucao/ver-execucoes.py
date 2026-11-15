#!/usr/bin/env python3
"""Mostra as últimas execuções do n8n do VPS lendo o SQLite só para leitura.
Uso: python3 ver-execucoes.py [quantas=25] [filtro-do-nome]"""
import sqlite3, subprocess, sys

n = int(sys.argv[1]) if len(sys.argv) > 1 else 25
filtro = sys.argv[2] if len(sys.argv) > 2 else ''
dados = subprocess.check_output(['docker', 'volume', 'inspect', 'n8n-recovery_n8n_data', '--format', '{{.Mountpoint}}'], text=True).strip()
c = sqlite3.connect('file:' + dados + '/database.sqlite?mode=ro', uri=True)
ativos = c.execute("select count(*) from workflow_entity where active=1").fetchone()[0]
print('fluxos ligados:', ativos)
q = """select e.id, w.name, e.mode, e.status, e.startedAt, e.stoppedAt from execution_entity e
       join workflow_entity w on w.id = e.workflowId where w.name like ? order by e.id desc limit ?"""
for r in c.execute(q, ('%' + filtro + '%', n)).fetchall():
    print(' | '.join(str(x) for x in r))
print('--- por fluxo (total / com erro / última)')
for r in c.execute("""select w.name, count(*), sum(e.status not in ('success','running','waiting')), max(e.startedAt) from execution_entity e
                      join workflow_entity w on w.id = e.workflowId group by 1 order by 1""").fetchall():
    print(' | '.join(str(x) for x in r))
