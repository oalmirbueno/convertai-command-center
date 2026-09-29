"""Extrai dos zips originais só os PSDs de um lote (e os arquivos extras, como mapas de displace).

Os zips do Drive guardam zip dentro de zip. O zip de dentro é copiado para uma pasta temporária,
os membros escolhidos saem dele e a cópia é apagada no fim. Nada de abrir os 25 GB.

Uso:
  python extrair.py <selecao.json> [<selecao2.json> ...] [--zips C:/Users/Usuario/Downloads] [--destino C:/AI/acervo-aceleriq/mockups-trabalho]

Saída: <destino>/psd/<id>/<nome do psd> e <destino>/psd/<id>/extras/..., mais <destino>/extracao.json.
"""
import argparse
import json
import os
import shutil
import sys
import time
import unicodedata
import zipfile

PADRAO_ZIPS = 'C:/Users/Usuario/Downloads'
PADRAO_DESTINO = 'C:/AI/acervo-aceleriq/mockups-trabalho'


def nome_do_membro(zi):
    """Nome legível do membro: zips antigos gravam cp437/cp850 sem avisar."""
    n = zi.filename
    if not (zi.flag_bits & 0x800):
        for enc in ('utf-8', 'cp850'):
            try:
                return n.encode('cp437').decode(enc)
            except Exception:
                continue
    return n


def normalizar(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if ord(c) < 128)
    return s.lower().replace('\\', '/')


def casa(nome, membro, prefixo=None):
    n = normalizar(nome)
    if '__macosx' in n or os.path.basename(n).startswith('._'):
        return False
    if not n.endswith(normalizar(membro)):
        return False
    return prefixo is None or normalizar(prefixo) in n


def copiar(src, destino):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    tmp = destino + '.parcial'
    with open(tmp, 'wb') as o:
        shutil.copyfileobj(src, o, 16 * 1024 * 1024)
    os.replace(tmp, destino)


def achar(z, cadeia):
    alvo = normalizar(cadeia)
    for zi in z.infolist():
        if normalizar(nome_do_membro(zi)) == alvo:
            return zi
    raise KeyError(f'zip interno não achado: {cadeia}')


def extrair_de(z, pedidos, destino, relatorio):
    nomes = [(nome_do_membro(zi), zi) for zi in z.infolist() if not zi.is_dir()]
    for item in pedidos:
        pasta = os.path.join(destino, 'psd', item['id'])
        alvos = [(item['membro'], item.get('prefixo'), '')] + [(e, None, 'extras') for e in item.get('extras', [])]
        for membro, prefixo, sub in alvos:
            achados = [(n, zi) for n, zi in nomes if casa(n, membro, prefixo)]
            if not achados:
                relatorio['faltando'].append({'id': item['id'], 'membro': membro})
                print('  FALTA', item['id'], membro, flush=True)
                continue
            if len(achados) > 1:
                print('  aviso: mais de um arquivo casa', item['id'], [a[0] for a in achados][:4], flush=True)
            n, zi = achados[0]
            final = os.path.join(pasta, sub, os.path.basename(n))
            if not os.path.exists(final):
                with z.open(zi) as g:
                    copiar(g, final)
            if not sub:
                relatorio['itens'][item['id']] = {'psd': final.replace('\\', '/'), 'origem_zip': item['zip'], 'origem_caminho': (item['cadeia'] + '/' if item['cadeia'] else '') + n, 'bytes': os.path.getsize(final)}
            else:
                relatorio['itens'].setdefault(item['id'], {}).setdefault('extras', []).append(final.replace('\\', '/'))
            print('  ok', item['id'], os.path.basename(n), round(os.path.getsize(final) / 1e6, 1), 'MB', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('selecao', nargs='+')
    ap.add_argument('--zips', default=PADRAO_ZIPS)
    ap.add_argument('--destino', default=PADRAO_DESTINO)
    a = ap.parse_args()
    sel = [i for arq in a.selecao for i in json.load(open(arq, encoding='utf-8'))['itens']]
    os.makedirs(a.destino, exist_ok=True)
    caminho_rel = os.path.join(a.destino, 'extracao.json')
    relatorio = json.load(open(caminho_rel, encoding='utf-8')) if os.path.exists(caminho_rel) else {'itens': {}, 'faltando': []}
    relatorio['faltando'] = []
    pendentes = [i for i in sel if i['id'] not in relatorio['itens'] or not os.path.exists(relatorio['itens'][i['id']].get('psd', ''))]
    grupos = {}
    for i in pendentes:
        grupos.setdefault((i['zip'], i['cadeia']), []).append(i)
    tmpdir = os.path.join(a.destino, '_tmp')
    for (zipnome, cadeia), pedidos in sorted(grupos.items()):
        t = time.time()
        print(zipnome, cadeia or '(direto)', len(pedidos), 'itens', flush=True)
        z = zipfile.ZipFile(os.path.join(a.zips, zipnome + '.zip'))
        if cadeia:
            zi = achar(z, cadeia)
            tmp = os.path.join(tmpdir, normalizar(cadeia).replace('/', '_'))
            if not os.path.exists(tmp):
                with z.open(zi) as g:
                    copiar(g, tmp)
            try:
                with zipfile.ZipFile(tmp) as iz:
                    extrair_de(iz, pedidos, a.destino, relatorio)
            finally:
                os.remove(tmp)
        else:
            extrair_de(z, pedidos, a.destino, relatorio)
        json.dump(relatorio, open(caminho_rel, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('  ', round(time.time() - t, 1), 's', flush=True)
    shutil.rmtree(tmpdir, ignore_errors=True)
    total = sum(v.get('bytes', 0) for v in relatorio['itens'].values())
    print('extraídos', len(relatorio['itens']), 'PSDs,', round(total / 1e9, 2), 'GB; faltando', len(relatorio['faltando']))
    return 0 if not relatorio['faltando'] else 1


if __name__ == '__main__':
    sys.exit(main())
