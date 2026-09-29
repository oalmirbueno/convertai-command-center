"""Biblioteca de texturas e carimbos do estúdio de mockups, a partir dos brushes (.abr).

Tira só os .abr escolhidos do zip de brushes (o zip de dentro vai para uma pasta temporária e
é apagado no fim), lê as pontas e guarda as boas como PNG (preto com alfa = a ponta), no máximo
2048 px, com miniatura de 256 px. Uma ponta deixa de ser pincel e passa a ser imagem usada como
fundo (multiplicar sobre a cor da marca) ou acabamento (desgaste na logo).

Uso:
  python texturas.py [--zip C:/Users/Usuario/Downloads/Brushes-20260929T145807Z-1-002.zip]
                     [--destino C:/AI/acervo-aceleriq/mockups-trabalho] [--por-arquivo 6]
Saída: <destino>/texturas/<id>.png, <id>_mini.png e <destino>/texturas.json
"""
import argparse
import json
import os
import shutil
import struct
import zipfile

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

PADRAO_ZIP = 'C:/Users/Usuario/Downloads/Brushes-20260929T145807Z-1-002.zip'
PADRAO_DESTINO = 'C:/AI/acervo-aceleriq/mockups-trabalho'
ZIP_INTERNO = 'Brushes/_Brushes-variados-artisticos.zip'

# Lote curado: grunge, papel, concreto e fumaça. Fora: Monoprint (marca d'água), ultimategrungeset (placas com texto e números),
# figurativos e o Chuva (824 MB).
CURADORIA = [
    ('Brushes/rons__ grunge.abr', 'grunge', 'Grunge'),
    ('Brushes/rons__grunge overlay.abr', 'grunge', 'Grunge suave'),
    ('Brushes/Burnt Paper 01/Burnt Paper 01.abr', 'papel', 'Papel queimado'),
    ('Brushes/rons__concrete.abr', 'concreto', 'Concreto'),
    ('Brushes/rons__cracks.abr', 'concreto', 'Rachaduras'),
    ('Brushes/rons__smoke.abr', 'fumaca', 'Fumaça'),
    ('Brushes/rons__fog.abr', 'fumaca', 'Névoa'),
]
LADO_MAX = 2048
LADO_MINI = 256
LADO_MINIMO = 380


# ---------------------------------------------------------------- leitor de .abr (v1, v2, v6 e v10)

def packbits(data, n):
    out = bytearray()
    i = 0
    while len(out) < n and i < len(data):
        c = data[i]
        i += 1
        if c > 127:
            c = 256 - c
            out += bytes([data[i]]) * (c + 1)
            i += 1
        else:
            out += data[i:i + c + 1]
            i += c + 1
    return bytes(out[:n])


def decodificar(f, w, h, depth, comp):
    if w <= 0 or h <= 0 or depth != 8:
        return None
    if comp == 0:
        data = f.read(w * h)
    else:
        counts = struct.unpack(f'>{h}h', f.read(2 * h))
        data = bytearray()
        for c in counts:
            data += packbits(f.read(c), w)
        data = bytes(data)
    if len(data) < w * h:
        return None
    return np.frombuffer(data[:w * h], np.uint8).reshape(h, w)


def pontas_v12(f, ver):
    cnt = struct.unpack('>h', f.read(2))[0]
    for _ in range(cnt):
        btype = struct.unpack('>h', f.read(2))[0]
        size = struct.unpack('>i', f.read(4))[0]
        nxt = f.tell() + size
        if btype == 2:
            f.read(6)
            if ver == 2:
                ln = struct.unpack('>i', f.read(4))[0]
                f.read(ln * 2)
            f.read(9)
            t, l, b, r = struct.unpack('>4i', f.read(16))
            depth = struct.unpack('>h', f.read(2))[0]
            comp = f.read(1)[0]
            img = decodificar(f, r - l, b - t, depth, comp)
            if img is not None:
                yield img
        f.seek(nxt)


def pontas_v6(f, sub, tamanho):
    while f.tell() < tamanho:
        sig = f.read(4)
        if len(sig) < 4:
            break
        tag = f.read(4)
        size = struct.unpack('>I', f.read(4))[0]
        fim = f.tell() + size
        if tag != b'samp':
            f.seek(fim)
            continue
        while f.tell() < fim:
            bsize = struct.unpack('>I', f.read(4))[0]
            while bsize % 4:
                bsize += 1
            nxt = f.tell() + bsize
            f.seek(47 if sub == 1 else 301, 1)
            t, l, b, r = struct.unpack('>4i', f.read(16))
            depth = struct.unpack('>h', f.read(2))[0]
            comp = f.read(1)[0]
            img = decodificar(f, r - l, b - t, depth, comp)
            if img is not None:
                yield img
            f.seek(nxt)
        f.seek(fim)


def ler_pontas(caminho):
    tamanho = os.path.getsize(caminho)
    with open(caminho, 'rb') as f:
        ver, sub = struct.unpack('>hh', f.read(4))
        if ver in (1, 2):
            f.seek(2)
            yield from pontas_v12(f, ver)
        else:
            yield from pontas_v6(f, sub, tamanho)


# ---------------------------------------------------------------- curadoria

def boa(img):
    """Ponta útil como textura: grande, nem vazia nem chapada."""
    h, w = img.shape
    if min(h, w) < LADO_MINIMO:
        return None
    cob = float((img > 24).mean())
    if cob < 0.06 or cob > 0.9:
        return None
    return cob


def salvar(img, destino_png, destino_mini):
    h, w = img.shape
    s = min(1.0, LADO_MAX / float(max(h, w)))
    im = Image.fromarray(img, 'L')
    if s < 1:
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    rgba = Image.new('RGBA', im.size, (0, 0, 0, 0))
    rgba.putalpha(im)
    rgba.save(destino_png, optimize=True)
    mini = rgba.copy()
    mini.thumbnail((LADO_MINI, LADO_MINI), Image.LANCZOS)
    mini.save(destino_mini, optimize=True)
    return rgba.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', default=PADRAO_ZIP)
    ap.add_argument('--destino', default=PADRAO_DESTINO)
    ap.add_argument('--por-arquivo', type=int, default=6)
    a = ap.parse_args()
    pasta_abr = os.path.join(a.destino, 'brushes')
    pasta_tex = os.path.join(a.destino, 'texturas')
    os.makedirs(pasta_abr, exist_ok=True)
    os.makedirs(pasta_tex, exist_ok=True)
    faltam = [c for c in CURADORIA if not os.path.exists(os.path.join(pasta_abr, os.path.basename(c[0])))]
    if faltam:
        tmp = os.path.join(a.destino, '_tmp_brushes.zip')
        with zipfile.ZipFile(a.zip) as z:
            with z.open(ZIP_INTERNO) as g, open(tmp, 'wb') as o:
                shutil.copyfileobj(g, o, 16 * 1024 * 1024)
        try:
            with zipfile.ZipFile(tmp) as iz:
                for membro, _, _ in faltam:
                    with iz.open(membro) as g, open(os.path.join(pasta_abr, os.path.basename(membro)), 'wb') as o:
                        shutil.copyfileobj(g, o, 16 * 1024 * 1024)
        finally:
            os.remove(tmp)
    itens = []
    for membro, categoria, nome in CURADORIA:
        arq = os.path.join(pasta_abr, os.path.basename(membro))
        candidatas = []
        try:
            for i, img in enumerate(ler_pontas(arq)):
                cob = boa(img)
                if cob is not None:
                    candidatas.append((img.shape[0] * img.shape[1], i, img, cob))
        except Exception as e:
            print('erro lendo', membro, e, flush=True)
        candidatas.sort(key=lambda x: -x[0])
        base = os.path.splitext(os.path.basename(membro))[0].lower().replace(' ', '-').replace('_', '-').strip('-')
        base = ''.join(c for c in base if c.isalnum() or c == '-').strip('-')
        while '--' in base:
            base = base.replace('--', '-')
        for n, (_, i, img, cob) in enumerate(candidatas[:a.por_arquivo], 1):
            ident = f'{categoria}-{base}-{i:03d}'
            w, h = salvar(img, os.path.join(pasta_tex, ident + '.png'), os.path.join(pasta_tex, ident + '_mini.png'))
            itens.append({'id': ident, 'nome': f'{nome} {n}', 'categoria': categoria, 'largura': w, 'altura': h,
                          'cobertura': round(cob, 3), 'origem': f'{os.path.basename(membro)} ponta {i}',
                          'bytes': os.path.getsize(os.path.join(pasta_tex, ident + '.png'))})
        print(membro, len(candidatas), 'boas,', min(len(candidatas), a.por_arquivo), 'guardadas', flush=True)
    json.dump({'versao': 1, 'itens': itens}, open(os.path.join(a.destino, 'texturas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('texturas:', len(itens), round(sum(i['bytes'] for i in itens) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main()
