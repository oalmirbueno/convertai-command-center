#!/usr/bin/env python3
"""Coletor da Central de Automações do painel Aceleriq (roda no VPS, só leitura).

Lê o SQLite do n8n (modo ro), o estado dos serviços do systemd e dois endereços HTTP,
e manda um retrato enxuto para a função `automacoes-n8n` do painel. Nunca escreve no n8n,
nunca manda corpo de pedido, cabeçalho ou credencial: das execuções vai só o caminho
(nomes dos nós), o estado e a mensagem de erro curta e mascarada.

Uso:
  python3 coletor.py            # coleta e envia (timer a cada minuto)
  python3 coletor.py --mostrar  # coleta e imprime o resumo, não envia nada
  python3 coletor.py --tudo     # reenvia o desenho de todos os fluxos

Configuração: /etc/aceleriq-automacoes/coletor.json  {"url": "...", "arquivo_da_chave": "..."}
Estado (último id visto, versões já enviadas): /var/lib/aceleriq-automacoes/estado.json
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

FUSO = ZoneInfo('America/Sao_Paulo')
CONFIG = '/etc/aceleriq-automacoes/coletor.json'
ESTADO = '/var/lib/aceleriq-automacoes/estado.json'
VOLUME = 'n8n-recovery_n8n_data'
CONTAINER = 'n8n-recovery-n8n-1'
POR_FLUXO = 30            # execuções guardadas por fluxo no painel
NOVAS_POR_RODADA = 400    # teto de execuções novas lidas por rodada
TETO_DE_DADOS = 4_000_000  # execução maior que isso não é aberta (só estado e horário), para não pesar no servidor

# Serviços vigiados: chave, nome humano, unidade, tipo ("servico" fica rodando; "timer" roda de tempos em tempos)
SERVICOS = [
    ('ponte_3429', 'Ponte do WhatsApp da equipe (3429)', 'mercurio-pilot-bridge.service', 'servico'),
    ('leitor_grupos', 'Leitor dos grupos de clientes', 'aceleriq-leitor-grupos.service', 'servico'),
    ('grupo_cliente', 'Envio aos grupos (lembrete e mensagem da semana)', 'aceleriq-grupo-cliente', 'timer'),
    ('post_no_ar', 'Aviso de post no ar', 'aceleriq-post-no-ar', 'timer'),
    ('vigia', 'Vigia de saúde e vencimentos', 'aceleriq-vigia', 'timer'),
    ('backup_n8n', 'Cópia diária do n8n', 'n8n-backup', 'timer'),
]


# ---------------------------------------------------------------- leitura do formato "flatted" do n8n
class Flatted:
    """O n8n grava a execução como lista: cada texto e cada objeto vira um índice (em texto) para outro item.
    Esta classe resolve só o caminho pedido, sem montar o objeto inteiro (execução pode ter vários MB)."""

    def __init__(self, bruto):
        self.itens = json.loads(bruto)

    def _r(self, v):
        if isinstance(v, str) and v.isdigit() and int(v) < len(self.itens):
            return self.itens[int(v)]
        return v

    def raiz(self):
        return self.itens[0] if self.itens else {}

    def pega(self, obj, *chaves):
        atual = obj
        for k in chaves:
            if not isinstance(atual, dict):
                return None
            atual = self._r(atual.get(k))
        return atual

    def lista(self, v):
        v = self._r(v)
        return [self._r(x) for x in v] if isinstance(v, list) else []


SEGREDOS = [
    (re.compile(r'(?i)bearer\s+[A-Za-z0-9._\-]+'), 'Bearer ***'),
    (re.compile(r'(?i)((?:api[_-]?key|token|secret|senha|password|apikey|authorization)["\']?\s*[:=]\s*["\']?)[^\s"\'&,}]+'), r'\1***'),
    (re.compile(r'[A-Za-z0-9_\-]{32,}'), '***'),
    (re.compile(r'(?i)(https?://[^\s?]+)\?[^\s]*'), r'\1?***'),
]


def mascarar(texto, teto=320):
    if not texto:
        return None
    t = str(texto)
    for padrao, troca in SEGREDOS:
        t = padrao.sub(troca, t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:teto] + ('…' if len(t) > teto else '')


def resumo_da_execucao(bruto):
    """Caminho percorrido (nós em ordem), onde parou e o erro, se houve."""
    try:
        f = Flatted(bruto)
    except Exception:
        return {'caminho': [], 'parou_em': None, 'erro': None, 'erro_no': None}
    raiz = f.raiz()
    resultado = f.pega(raiz, 'resultData') or {}
    run = f._r(resultado.get('runData')) if isinstance(resultado, dict) else None
    passos = []
    if isinstance(run, dict):
        for nome, v in run.items():
            corridas = f.lista(v)
            for i, c in enumerate(corridas):
                if not isinstance(c, dict):
                    continue
                inicio = f._r(c.get('startTime')) or 0
                estado = f._r(c.get('executionStatus')) or ('error' if c.get('error') else 'success')
                erro = f.pega(c, 'error', 'message') if c.get('error') else None
                passos.append((inicio, nome, estado, erro, i))
    passos.sort(key=lambda p: (p[0] if isinstance(p[0], (int, float)) else 0))
    caminho = []
    for inicio, nome, estado, erro, i in passos:
        if caminho and caminho[-1]['no'] == nome:
            caminho[-1]['vezes'] += 1
            continue
        caminho.append({'no': nome, 'estado': estado, 'vezes': 1})
    erro_geral = f.pega(resultado, 'error') if isinstance(resultado, dict) else None
    erro_msg = None
    erro_no = None
    if isinstance(erro_geral, dict):
        erro_msg = f._r(erro_geral.get('message'))
        no = f._r(erro_geral.get('node'))
        if isinstance(no, dict):
            erro_no = f._r(no.get('name'))
    if not erro_msg:
        for inicio, nome, estado, erro, i in reversed(passos):
            if erro:
                erro_msg, erro_no = erro, nome
                break
    parou = f._r(resultado.get('lastNodeExecuted')) if isinstance(resultado, dict) else None
    return {
        'caminho': caminho[:80],
        'parou_em': parou if isinstance(parou, str) else None,
        'erro': mascarar(erro_msg),
        'erro_no': erro_no if isinstance(erro_no, str) else None,
    }


# ---------------------------------------------------------------- gatilhos e próxima execução
def _campo_cron(txt, minimo, maximo):
    valores = set()
    for parte in txt.split(','):
        passo = 1
        if '/' in parte:
            parte, p = parte.split('/')
            passo = int(p)
        if parte in ('*', '?'):
            a, b = minimo, maximo
        elif '-' in parte:
            a, b = (int(x) for x in parte.split('-'))
        else:
            a = int(parte)
            b = maximo if passo > 1 else a
        valores.update(range(a, b + 1, passo))
    return valores


def proxima_do_cron(expr, agora):
    partes = expr.split()
    if len(partes) == 6:
        partes = partes[1:]  # o n8n aceita segundos na frente; ignoramos
    if len(partes) != 5:
        return None
    try:
        mi = _campo_cron(partes[0], 0, 59)
        ho = _campo_cron(partes[1], 0, 23)
        di = _campo_cron(partes[2], 1, 31)
        me = _campo_cron(partes[3], 1, 12)
        sem = {d % 7 for d in _campo_cron(partes[4], 0, 7)}
    except ValueError:
        return None
    dia_livre = partes[2] in ('*', '?')
    sem_livre = partes[4] in ('*', '?')
    t = agora.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(60 * 24 * 32):
        dow = (t.weekday() + 1) % 7
        if dia_livre and sem_livre:
            dia_ok = True
        elif dia_livre:
            dia_ok = dow in sem
        elif sem_livre:
            dia_ok = t.day in di
        else:
            dia_ok = t.day in di or dow in sem
        if t.month in me and dia_ok and t.hour in ho and t.minute in mi:
            return t
        t += timedelta(minutes=1)
    return None


DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']


def descrever_cron(expr):
    p = expr.split()
    if len(p) == 6:
        p = p[1:]
    if len(p) != 5:
        return expr
    mi, ho, _, _, sem = p
    if sem in ('*', '?'):
        dias = 'todo dia'
    else:
        try:
            ds = sorted({d % 7 for d in _campo_cron(sem, 0, 7)})
            dias = 'seg a sex' if ds == [1, 2, 3, 4, 5] else ', '.join(DIAS[d] for d in ds)
        except ValueError:
            dias = sem
    if '/' in mi:
        passo = mi.split('/')[1]
        faixa = '' if ho == '*' else (f', {ho.replace("-", "h a ")}h' if '-' in ho else f', {ho}h')
        return f'a cada {passo} min{faixa}' + ('' if dias == 'todo dia' else f', {dias}')
    if mi.isdigit() and '/' in ho:
        base, passo = ho.split('/')
        faixa = '' if base in ('*', '0') else f' das {base.replace("-", "h às ")}h'
        return f'a cada {passo} h no minuto {int(mi):02d}{faixa}' + ('' if dias == 'todo dia' else f', {dias}')
    if mi.isdigit() and ho != '*':
        try:
            horas = sorted(_campo_cron(ho, 0, 23))
        except ValueError:
            horas = []
        if horas and len(horas) <= 6:
            return f'{dias} às ' + ', '.join(f'{h:02d}h{int(mi):02d}' for h in horas)
    return f'{dias}, {ho}h:{mi}'


def gatilhos_do_fluxo(nos, agora):
    lista = []
    proxima = None
    for n in nos:
        if n.get('disabled'):
            continue
        tipo = n.get('type', '')
        if tipo.endswith('.scheduleTrigger'):
            for it in (n.get('parameters', {}).get('rule', {}) or {}).get('interval', []) or [{}]:
                campo = it.get('field', 'days')
                quando = None
                if campo == 'cronExpression':
                    desc = descrever_cron(it.get('expression', ''))
                    quando = proxima_do_cron(it.get('expression', ''), agora)
                elif campo == 'minutes':
                    k = int(it.get('minutesInterval', 5) or 5)
                    desc = f'a cada {k} min'
                    quando = agora.replace(second=0, microsecond=0) + timedelta(minutes=k - agora.minute % k)
                elif campo == 'hours':
                    k = int(it.get('hoursInterval', 1) or 1)
                    m = int(it.get('triggerAtMinute', 0) or 0)
                    desc = f'a cada {k} h (minuto {m})'
                    quando = proxima_do_cron(f'{m} */{k} * * *', agora)
                else:
                    desc = f'agendado ({campo})'
                lista.append({'tipo': 'agenda', 'descricao': desc})
                if quando and (proxima is None or quando < proxima):
                    proxima = quando
        elif tipo.endswith('.webhook'):
            caminho = n.get('parameters', {}).get('path', '')
            lista.append({'tipo': 'webhook', 'descricao': f'/webhook/{caminho}' if caminho else 'webhook'})
        elif tipo.endswith('.executeWorkflowTrigger'):
            lista.append({'tipo': 'subfluxo', 'descricao': 'chamado por outro fluxo'})
        elif tipo.endswith('.errorTrigger'):
            lista.append({'tipo': 'erro', 'descricao': 'recebe as falhas dos outros fluxos'})
    return lista, proxima


def grupo_do_nome(nome):
    for prefixo in ('Apoio', 'Clientes', 'Comercial', 'Instagram', 'Grupos DK', 'TMP'):
        if nome.startswith(prefixo):
            return 'Temporários' if prefixo == 'TMP' else prefixo
    if '(o Hermes já faz)' in nome:
        return 'Desligado: o Hermes já faz'
    return 'Outros'


def desenho(nos, ligacoes):
    """Só o que a tela precisa para desenhar: nome, tipo curto, posição, desligado e as ligações."""
    nos_curtos = []
    for n in nos:
        tipo = n.get('type', '').split('.')[-1]
        nos_curtos.append({
            'nome': n.get('name'),
            'tipo': tipo,
            'x': (n.get('position') or [0, 0])[0],
            'y': (n.get('position') or [0, 0])[1],
            'desligado': bool(n.get('disabled')),
        })
    arestas = []
    for origem, saidas in (ligacoes or {}).items():
        for tipo_saida, ramos in (saidas or {}).items():
            for indice, ramo in enumerate(ramos or []):
                for destino in ramo or []:
                    arestas.append({'de': origem, 'para': destino.get('node'), 'saida': indice, 'tipo': tipo_saida})
    return {'nos': nos_curtos, 'ligacoes': arestas}


# ---------------------------------------------------------------- saúde
def sh(*cmd, timeout=10):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception:
        return ''


def props(unidade, campos):
    saida = sh('systemctl', 'show', unidade, '-p', ','.join(campos))
    d = {}
    for linha in saida.splitlines():
        if '=' in linha:
            k, v = linha.split('=', 1)
            d[k] = v
    return d


def quando_systemd(txt):
    if not txt or txt in ('n/a', '0'):
        return None
    try:
        dt = datetime.strptime(' '.join(txt.split()[1:3]), '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def http(url, timeout=8):
    inicio = time.time()
    try:
        pedido = urllib.request.Request(url, method='GET', headers={'User-Agent': 'aceleriq-coletor-automacoes/1.0'})
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            return r.status, int((time.time() - inicio) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, int((time.time() - inicio) * 1000)
    except Exception:
        return 0, None


def saude(conexao, agora):
    itens = []
    estado_n8n = sh('docker', 'inspect', CONTAINER, '--format', '{{.State.Status}}|{{.State.StartedAt}}')
    st, desde = (estado_n8n.split('|') + [''])[:2]
    cod, ms = http('https://n8n-recovery.srv1769409.hstgr.cloud/healthz')
    itens.append({
        'chave': 'n8n', 'nome': 'n8n no ar', 'estado': 'ok' if st == 'running' and cod == 200 else 'falha',
        'detalhe': f'respondeu em {ms} ms' if cod == 200 else f'não respondeu (código {cod})',
        'info': {'container': st, 'desde': desde[:19] if desde else None, 'ms': ms},
    })
    cod, ms = http('https://n8n.aceleriq.com.br/healthz')
    itens.append({
        'chave': 'porta', 'nome': 'Porta dos webhooks (n8n.aceleriq.com.br)', 'estado': 'ok' if cod == 200 else 'falha',
        'detalhe': f'respondeu em {ms} ms' if cod == 200 else f'não respondeu (código {cod})', 'info': {'ms': ms},
    })
    cod, ms = http('http://127.0.0.1:3049/health', timeout=4)
    for chave, nome, unidade, tipo in SERVICOS:
        if tipo == 'servico':
            p = props(unidade, ['ActiveState', 'SubState', 'NRestarts', 'ActiveEnterTimestamp'])
            ok = p.get('ActiveState') == 'active'
            info = {'desde': quando_systemd(p.get('ActiveEnterTimestamp')), 'reinicios': int(p.get('NRestarts') or 0)}
            detalhe = 'rodando' if ok else f"parado ({p.get('SubState', '?')})"
            if chave == 'ponte_3429':
                info['responde'] = cod in (200, 401)
                if ok and not info['responde']:
                    ok, detalhe = False, 'rodando, mas não responde'
            itens.append({'chave': chave, 'nome': nome, 'estado': 'ok' if ok else 'falha', 'detalhe': detalhe, 'info': info})
        else:
            pt = props(unidade + '.timer', ['ActiveState', 'LastTriggerUSec', 'NextElapseUSecRealtime'])
            ps = props(unidade + '.service', ['Result', 'ExecMainStatus', 'ActiveState'])
            ligado = pt.get('ActiveState') == 'active'
            ultima_ok = ps.get('Result') in ('success', '') and ps.get('ExecMainStatus', '0') in ('0', '')
            estado = 'ok' if ligado and ultima_ok else ('atencao' if ligado else 'falha')
            detalhe = ('ligado' if ligado else 'desligado') + ('' if ultima_ok else ' · última rodada falhou')
            itens.append({'chave': chave, 'nome': nome, 'estado': estado, 'detalhe': detalhe, 'info': {
                'ultima': quando_systemd(pt.get('LastTriggerUSec')),
                'proxima': quando_systemd(pt.get('NextElapseUSecRealtime')),
                'resultado': ps.get('Result'),
            }})
    # Vencimentos (o vigia avisa o dono; aqui só mostramos)
    try:
        cfg = json.load(open('/etc/aceleriq-vigia/vigia.json'))
        venc = []
        for m in cfg.get('mensais', []):
            if m.get('pago_ate'):
                dias = (datetime.fromisoformat(m['pago_ate']).date() - agora.date()).days
                venc.append({'nome': m['nome'], 'pago_ate': m['pago_ate'], 'dias': dias})
        for d in cfg.get('dominios', []):
            venc.append({'nome': d['nome'], 'pago_ate': None, 'dias': None})
        perto = [v for v in venc if v['dias'] is not None and v['dias'] <= 7]
        itens.append({'chave': 'vencimentos', 'nome': 'Vencimentos', 'estado': 'atencao' if perto else 'ok',
                      'detalhe': ('vence em ' + ', '.join(f"{v['dias']} d" for v in perto)) if perto else 'nada vence nos próximos 7 dias',
                      'info': {'itens': venc}})
    except Exception:
        pass
    # Disco do servidor
    try:
        st = os.statvfs('/')
        livre = st.f_bavail * st.f_frsize
        total = st.f_blocks * st.f_frsize
        uso = round(100 * (1 - livre / total))
        itens.append({'chave': 'disco', 'nome': 'Disco do servidor', 'estado': 'ok' if uso < 90 else ('atencao' if uso < 96 else 'falha'),
                      'detalhe': f'{uso}% usado, {livre // 2**30} GB livres', 'info': {'uso': uso, 'livre_gb': livre // 2**30}})
    except Exception:
        pass
    # Falhas de execução nas últimas 24 h
    desde = (agora - timedelta(hours=24)).astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    total, erros = conexao.execute(
        "select count(*), sum(status in ('error','crashed','canceled')) from execution_entity where startedAt >= ?", (desde,)).fetchone()
    erros = erros or 0
    itens.append({'chave': 'execucoes', 'nome': 'Execuções nas últimas 24 h', 'estado': 'ok' if erros == 0 else 'atencao',
                  'detalhe': f'{total} rodadas, {erros} com erro', 'info': {'total': total, 'erros': erros}})
    return itens


# ---------------------------------------------------------------- coleta
def utc_iso(txt):
    if not txt:
        return None
    return datetime.strptime(txt[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).isoformat()


def coletar(estado, tudo=False):
    agora = datetime.now(FUSO)
    pasta = sh('docker', 'volume', 'inspect', VOLUME, '--format', '{{.Mountpoint}}')
    c = sqlite3.connect('file:' + pasta + '/database.sqlite?mode=ro', uri=True, timeout=10)
    desde = (agora - timedelta(hours=24)).astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    contagem = {r[0]: (r[1], r[2] or 0) for r in c.execute(
        "select workflowId, count(*), sum(status in ('error','crashed','canceled')) from execution_entity where startedAt >= ? group by 1", (desde,))}
    ultima = {r[0]: r for r in c.execute(
        """select e.workflowId, e.id, e.status, e.startedAt, e.stoppedAt, e.mode from execution_entity e
           join (select workflowId, max(id) m from execution_entity group by 1) u on u.m = e.id""")}
    pastas = {r[0]: r[1] for r in c.execute('select id, name from folder')}
    versoes = estado.setdefault('versoes', {})
    fluxos = []
    for wid, nome, ativo, nos, lig, versao, pasta_id, atualizado, arquivado in c.execute(
            'select id, name, active, nodes, connections, versionId, parentFolderId, updatedAt, isArchived from workflow_entity'):
        nos = json.loads(nos or '[]')
        gat, proxima = gatilhos_do_fluxo(nos, agora)
        u = ultima.get(wid)
        item = {
            'id': wid, 'nome': nome, 'ativo': bool(ativo), 'arquivado': bool(arquivado),
            'grupo': pastas.get(pasta_id) or grupo_do_nome(nome), 'versao': versao,
            'atualizado_em': utc_iso(atualizado), 'gatilhos': gat,
            'proxima_execucao': proxima.isoformat() if (proxima and ativo) else None,
            'total_24h': contagem.get(wid, (0, 0))[0], 'erros_24h': contagem.get(wid, (0, 0))[1],
            'ultima_execucao': {'id': u[1], 'status': u[2], 'inicio': utc_iso(u[3]), 'fim': utc_iso(u[4]), 'modo': u[5]} if u else None,
            'qtd_nos': len(nos),
        }
        if tudo or versoes.get(wid) != versao:
            item['desenho'] = desenho(nos, json.loads(lig or '{}'))
            versoes[wid] = versao
        fluxos.append(item)
    # Execuções: as novas desde a última rodada e as que estavam rodando
    ultimo_id = int(estado.get('ultimo_id') or 0)
    if ultimo_id == 0:
        # primeira rodada: as últimas POR_FLUXO de cada fluxo
        ids = [r[0] for r in c.execute(
            """select id from (select id, row_number() over (partition by workflowId order by id desc) n from execution_entity) where n <= ?""",
            (POR_FLUXO,))]
    else:
        ids = [r[0] for r in c.execute('select id from execution_entity where id > ? order by id limit ?', (ultimo_id, NOVAS_POR_RODADA))]
    pendentes = [int(x) for x in estado.get('rodando', [])]
    ids = sorted(set(ids) | set(pendentes))
    execucoes = []
    rodando = []
    for i in range(0, len(ids), 200):
        lote = ids[i:i + 200]
        marcas = ','.join('?' * len(lote))
        for eid, wid, modo, st, ini, fim, dados in c.execute(
                f"""select e.id, e.workflowId, e.mode, e.status, e.startedAt, e.stoppedAt,
                           case when length(d.data) <= ? then d.data end from execution_entity e
                    left join execution_data d on d.executionId = e.id where e.id in ({marcas})""", [TETO_DE_DADOS] + lote):
            r = resumo_da_execucao(dados) if dados else {'caminho': [], 'parou_em': None, 'erro': None, 'erro_no': None, 'grande': True}
            execucoes.append({'id': eid, 'fluxo_id': wid, 'modo': modo, 'status': st, 'inicio': utc_iso(ini), 'fim': utc_iso(fim), **r})
            if st in ('running', 'waiting', 'new'):
                rodando.append(eid)
    if ids:
        estado['ultimo_id'] = max([ultimo_id] + [e['id'] for e in execucoes])
    estado['rodando'] = rodando[-200:]
    return {'coletado_em': agora.isoformat(), 'fluxos': fluxos, 'execucoes': execucoes, 'saude': saude(c, agora), 'por_fluxo': POR_FLUXO}


def enviar(retrato):
    cfg = json.load(open(CONFIG))
    chave = open(cfg['arquivo_da_chave']).read().strip()
    corpo = json.dumps({'acao': 'coletar', **retrato}, ensure_ascii=False).encode()
    pedido = urllib.request.Request(cfg['url'], data=corpo, method='POST', headers={
        'content-type': 'application/json', 'x-coletor-chave': chave, 'User-Agent': 'aceleriq-coletor-automacoes/1.0'})
    with urllib.request.urlopen(pedido, timeout=40) as r:
        return json.loads(r.read() or b'{}')


def main():
    mostrar = '--mostrar' in sys.argv
    tudo = '--tudo' in sys.argv
    try:
        estado = json.load(open(ESTADO))
    except Exception:
        estado = {}
    if mostrar:
        estado = {}
    retrato = coletar(estado, tudo=tudo or mostrar)
    if mostrar:
        saida = {k: v for k, v in retrato.items() if k != 'execucoes'}
        saida['execucoes_amostra'] = retrato['execucoes'][-5:]
        saida['qtd_execucoes'] = len(retrato['execucoes'])
        print(json.dumps(saida, ensure_ascii=False, indent=1, default=str))
        return
    resposta = enviar(retrato)
    os.makedirs(os.path.dirname(ESTADO), exist_ok=True)
    tmp = ESTADO + '.tmp'
    json.dump(estado, open(tmp, 'w'))
    os.replace(tmp, ESTADO)
    print(json.dumps({'ok': resposta.get('ok'), 'fluxos': len(retrato['fluxos']), 'execucoes': len(retrato['execucoes'])}))


if __name__ == '__main__':
    main()
