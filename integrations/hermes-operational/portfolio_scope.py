"""Shared portfolio selection contract. Selection never grants Ads permissions."""
import json
import re

START = '<!-- operacao_carteira_v1 -->'
END = '<!-- /operacao_carteira_v1 -->'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
PROJECT_ID = '0dd4ae09-f358-4111-a9b8-8c6226594f88'


def read_selection(scope):
    if not scope or START not in scope:
        return None
    if scope.count(START) != 1 or scope.count(END) != 1:
        raise ValueError('Seleção da carteira inválida; leitura individual interrompida.')
    value = json.loads(scope.split(START)[1].split(END)[0].strip())
    ids = value.get('client_ids')
    if value.get('version') != 1 or not isinstance(ids, list) or any(not isinstance(i, str) or not UUID.fullmatch(i) for i in ids):
        raise ValueError('Seleção da carteira inválida; leitura individual interrompida.')
    return set(ids)


def select_clients(clients, scope, excluded):
    selected = read_selection(scope)
    return [c for c in clients if c['id'] not in excluded
            and ((selected is None and c.get('plan_status') in ('active', 'onboarding', 'standby'))
                 or (selected is not None and c['id'] in selected))]
