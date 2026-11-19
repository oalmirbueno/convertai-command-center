#!/usr/bin/env python3
"""Mostra, da última execução de um fluxo, o que um nó devolveu (só mensagens de erro e as chaves do JSON).
Lê o SQLite do n8n só para leitura. Não imprime corpo de pedido nem cabeçalho.
Uso: python3 ver-erro-do-no.py <parte do nome do fluxo> <parte do nome do nó> [quantas execuções=1]"""
import json
import re
import sqlite3
import subprocess
import sys

fluxo, no = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 1
dados = subprocess.check_output(['docker', 'volume', 'inspect', 'n8n-recovery_n8n_data', '--format', '{{.Mountpoint}}'], text=True).strip()
c = sqlite3.connect('file:' + dados + '/database.sqlite?mode=ro', uri=True)
linhas = c.execute("""select e.id, e.startedAt, d.data from execution_entity e join workflow_entity w on w.id = e.workflowId
                      join execution_data d on d.executionId = e.id where w.name like ? order by e.id desc limit ?""", ('%' + fluxo + '%', n)).fetchall()
for eid, quando, bruto in linhas:
    print('== execução', eid, quando)
    # O n8n grava em formato "flatted": uma lista em que cada texto pode ser um índice para outro item.
    itens = json.loads(bruto)
    achados = set()
    for i, v in enumerate(itens):
        if isinstance(v, str) and re.search(r'(?i)(error|erro|status code|insufficient|credit|quota|unauthor|not found|invalid|timeout|rate)', v) and len(v) < 600:
            achados.add(v)
    for a in sorted(achados)[:25]:
        print('  ', a[:400])
    nomes = [v for v in itens if isinstance(v, str) and no.lower() in v.lower() and len(v) < 120]
    print('  nós com esse nome:', sorted(set(nomes))[:5])
