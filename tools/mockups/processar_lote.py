"""Roda o pré-processamento de um lote inteiro e monta o catalogo.json.

Cada PSD roda num processo à parte (memória e tempo limitados). Mockup já processado
(meta.json existente na mesma versão do pipeline) é pulado, então dá para parar e retomar.

Uso:
  python processar_lote.py <selecao.json> [<selecao2.json> ...] [--trabalho C:/AI/acervo-aceleriq/mockups-trabalho] [--procs 2] [--so id1,id2]
Saída: <trabalho>/saida/<id>/... e <trabalho>/catalogo.json (aprovados + lista de revisão).
"""
import argparse
import ctypes
import json
import os
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
PADRAO_TRABALHO = 'C:/AI/acervo-aceleriq/mockups-trabalho'
TEMPO_MAXIMO = 40 * 60
MEMORIA_MINIMA = 2.5e9

NOMES = {
    'papelaria': 'Papelaria', 'cartao': 'Cartão de visita', 'sacola': 'Sacola', 'caneca': 'Caneca e copo',
    'vestuario': 'Vestuário', 'embalagem': 'Embalagem', 'outdoor': 'Outdoor e mídia externa', 'dispositivo': 'Dispositivos',
    'poster': 'Pôster e cartaz', 'veiculo': 'Veículo', 'logo-efeito': 'Logo com efeito', 'folder': 'Folder e flyer', 'livro': 'Livro',
}


def memoria_livre():
    class M(ctypes.Structure):
        _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong), ('sullAvailExtendedVirtual', ctypes.c_ulonglong)]
    try:
        m = M()
        m.dwLength = ctypes.sizeof(M)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return m.ullAvailPhys
    except Exception:
        return 1e12


def nome_legivel(item):
    base = NOMES.get(item['categoria'], item['categoria'])
    resto = item['id'].split('-', 1)[1] if '-' in item['id'] else item['id']
    return f"{base} · {resto.replace('-', ' ')}"


def eficacia_dos_slots(pasta_trabalho, n):
    """Fração de cada slot em que o design aparece de fato (ganho > 12). Slot que não aparece
    passa no controle de qualidade (a conta repete a prévia) mas não muda nada na imagem:
    é camada escondida, atalho ou o design vem de outra camada."""
    import numpy as np
    from PIL import Image
    ganho = np.asarray(Image.open(os.path.join(pasta_trabalho, 'ganho.png')).convert('RGB'), np.float32).mean(-1)
    mapa = np.asarray(Image.open(os.path.join(pasta_trabalho, 'mapa.png')))
    out = []
    for k in range(1, n + 1):
        m = mapa == k
        out.append(float((ganho[m] > 12).mean()) if m.any() else 0.0)
    return out


def montar_catalogo(sel, saida):
    itens, revisao = [], []
    for item in sel:
        mp = os.path.join(saida, item['id'], 'meta.json')
        if not os.path.exists(mp):
            revisao.append({'id': item['id'], 'motivo': 'não processado'})
            continue
        meta = json.load(open(mp, encoding='utf-8'))
        if item.get('fora'):
            revisao.append({'id': item['id'], 'motivo': f"curadoria: {item['fora']}"})
            continue
        q = meta.get('qualidade', {})
        if q.get('aprovado'):
            ef = eficacia_dos_slots(os.path.join(saida, item['id'], 'trabalho'), len(meta.get('slots', [])))
            q['eficacia_dos_slots'] = [round(x, 3) for x in ef]
            # Slot que não aparece sai do catálogo (o mapa continua com o índice: sem design, fica o vazio).
            vivos = [i for i, x in enumerate(ef) if x >= 0.1]
            if not vivos or sum(ef[i] for i in vivos) / len(vivos) < 0.3:
                revisao.append({'id': item['id'], 'motivo': 'o design não aparece no slot (camada escondida ou atalho)', 'diferenca': q.get('diferenca'), 'eficacia': q['eficacia_dos_slots']})
                continue
            if len(vivos) < len(ef):
                q.setdefault('avisos', []).append(f'{len(ef) - len(vivos)} slot(s) sem efeito ficaram fora')
                meta['slots'] = [meta['slots'][i] for i in vivos]
            # Curadoria: papel do slot marcado à mão na seleção (ex.: timbrado e envelope claros).
            papeis = item.get('papeis', [])
            for slot in meta.get('slots', []):
                k = int(slot.get('indice', 0)) - 1
                if 0 <= k < len(papeis) and papeis[k]:
                    slot['papel'] = papeis[k]
            meta['nome'] = nome_legivel(item)
            itens.append(meta)
        else:
            revisao.append({'id': item['id'], 'motivo': q.get('motivo'), 'diferenca': q.get('diferenca'), 'avisos': q.get('avisos', [])})
    return {'versao': 1, 'gerado_em': time.strftime('%Y-%m-%dT%H:%M:%S'), 'itens': itens, 'revisao': revisao}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('selecao', nargs='+')
    ap.add_argument('--trabalho', default=PADRAO_TRABALHO)
    ap.add_argument('--procs', type=int, default=2)
    ap.add_argument('--so', default='')
    ap.add_argument('--refazer', action='store_true')
    a = ap.parse_args()
    sel = [i for arq in a.selecao for i in json.load(open(arq, encoding='utf-8'))['itens']]
    ext = json.load(open(os.path.join(a.trabalho, 'extracao.json'), encoding='utf-8'))['itens']
    saida = os.path.join(a.trabalho, 'saida')
    so = {x for x in a.so.split(',') if x}
    fila = []
    for item in sel:
        if so and item['id'] not in so:
            continue
        mp = os.path.join(saida, item['id'], 'meta.json')
        if os.path.exists(mp) and not a.refazer:
            continue
        e = ext.get(item['id'])
        if not e or not os.path.exists(e.get('psd', '')):
            print('sem PSD extraído:', item['id'], flush=True)
            continue
        extras = e.get('extras', [])
        disp = next((x for x in extras if 'displace' in os.path.basename(x).lower() or 'dispalce' in os.path.basename(x).lower()), None)
        cmd = [sys.executable, '-u', os.path.join(AQUI, 'psd_mockup.py'), e['psd'], os.path.join(saida, item['id']),
               '--id', item['id'], '--categoria', item['categoria'], '--tags', ','.join(item.get('tags', [])),
               '--origem', item.get('origem', '') + ' | ' + e.get('origem_caminho', '')]
        if disp:
            cmd += ['--dispmap', disp]
        fila.append((e.get('bytes', 0), item['id'], cmd))
    fila.sort()  # os pequenos primeiro: o catálogo cresce rápido
    comandos = {ident: cmd for _, ident, cmd in fila}
    rodando = []
    # Erro de memória do OpenCV ("Unknown C++ exception") acontece com a máquina cheia: quem sai
    # com erro volta uma vez para o fim da fila, e aí roda sozinho.
    repetir = {}
    os.makedirs(os.path.join(a.trabalho, 'logs'), exist_ok=True)
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    while fila or rodando:
        for r in list(rodando):
            p, ident, t0, log = r
            if p.poll() is not None:
                log.close()
                rodando.remove(r)
                print(f'{ident}: saiu {p.returncode} em {round(time.time() - t0)} s', flush=True)
                if p.returncode == 1 and ident in comandos and ident not in repetir:
                    repetir[ident] = True
                    fila.append((float('inf'), ident, comandos[ident]))
                    print(f'{ident}: volta para o fim da fila (vai rodar sozinho)', flush=True)
            elif time.time() - t0 > TEMPO_MAXIMO:
                p.kill()
                log.close()
                rodando.remove(r)
                os.makedirs(os.path.join(saida, ident), exist_ok=True)
                json.dump({'id': ident, 'qualidade': {'aprovado': False, 'motivo': f'passou de {TEMPO_MAXIMO // 60} min'}},
                          open(os.path.join(saida, ident, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'{ident}: parado por tempo', flush=True)
        sozinho = bool(fila) and fila[0][1] in repetir
        limite = 1 if sozinho else a.procs
        if fila and len(rodando) < limite and (not rodando or memoria_livre() > MEMORIA_MINIMA):
            _, ident, cmd = fila.pop(0)
            log = open(os.path.join(a.trabalho, 'logs', ident + '.log'), 'w', encoding='utf-8')
            rodando.append((subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env), ident, time.time(), log))
            print(f'{ident}: começou ({len(fila)} na fila)', flush=True)
            continue
        time.sleep(2)
    cat = montar_catalogo(sel, saida)
    json.dump(cat, open(os.path.join(a.trabalho, 'catalogo.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print(f"catálogo: {len(cat['itens'])} aprovados, {len(cat['revisao'])} na revisão", flush=True)


if __name__ == '__main__':
    main()
