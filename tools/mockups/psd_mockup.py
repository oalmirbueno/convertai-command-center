"""Pré-processa UM mockup PSD para o estúdio de mockups do painel.

Roda na máquina da agência, uma vez por PSD. Depois disso o painel compõe no navegador sem PSD:

    saida = vazio + a * (base + ganho * design(uv) - vazio)

  base   = PSD com os slots pretos        (luz e fundo que não dependem do design)
  ganho  = PSD com os slots brancos - base (sombra, multiplicar, máscara, dobra, brilho)
  vazio  = PSD com os slots escondidos     (o que aparece onde a logo é transparente)
  uv     = de qual ponto do design vem cada pixel (perspectiva, malha custom, displace)
  mapa   = qual slot cobre cada pixel (0 = nenhum)
  a      = alfa do design no ponto uv

Formatos que o navegador lê sem perda (sem 16 bits, sem alfa premultiplicado):
  uv.png   RGB 8 bits com u e v em 12 bits: R = u>>4, G = v>>4, B = (u&15)<<4 | (v&15)
  mapa.png tons de cinza, valor = índice do slot (1..8)
  ganho.png RGB 8 bits; base.jpg e vazio.jpg RGB

Controle de qualidade: a mesma conta, feita com o conteúdo original de cada slot, é comparada
com a prévia que o Photoshop gravou dentro do PSD (diferença média 0-255 em 800 px). Acima de 3,
o mockup fica fora do catálogo e vai para a lista de revisão.

Uso:
  python psd_mockup.py <psd> <pasta_saida> --id ID --categoria CAT [--tags a,b] [--origem TEXTO] [--dispmap PSD]
Saída: <pasta_saida>/{alta,trabalho}/{base.jpg,vazio.jpg,ganho.png,uv.png,mapa.png}, thumb.jpg, qc.jpg, meta.json
Código de saída: 0 aprovado, 2 revisão, 1 erro.
"""
import argparse
import io
import json
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Tag

Image.MAX_IMAGE_PIXELS = None
# Menos threads = menos memória por warp (a máquina roda outras coisas ao mesmo tempo).
cv2.setNumThreads(2)

LADO_ALTA = 3000
LADO_TRABALHO = 1280
LADO_THUMB = 480
LIMITE_QC = 3.0
MAX_SLOTS = 8
PALAVRAS_SLOT = ('design', 'logo', 'here', 'aqui', 'click', 'label', 'card', 'screen', 'smart object', 'mockup',
                 'id card', 'tablet', 'smartphone', 'business', 'arte', 'place', 'insert', 'your', 'edit', 'cover', 'capa', 'tela')
PALAVRAS_EFEITO = ('shadow', 'sombra', 'bevel', 'reflex', 'reflection', 'focus blur', 'highlight', 'light', 'texture', 'textura', 'noise')
CATEGORIAS_DE_LOGO = ('vestuario', 'caneca', 'logo-efeito')


# ---------------------------------------------------------------- leitura do PSD

def dados_do_so(l):
    d = l.tagged_blocks.get_data(Tag.SMART_OBJECT_LAYER_DATA1) or l.tagged_blocks.get_data(Tag.SMART_OBJECT_LAYER_DATA2)
    return getattr(d, 'data', d)


def enum(v):
    e = getattr(v, 'enum', v)
    return e.decode() if isinstance(e, bytes) else str(e)


def valores(x):
    return list(x.values) if hasattr(x, 'values') and not isinstance(x, dict) else list(x)


def num(v):
    return float(getattr(v, 'value', v))


def tamanho_do_so(l):
    sd = dados_do_so(l)
    sz = sd[b'Sz  ']
    return int(round(num(sz[b'Wdth']))), int(round(num(sz[b'Hght'])))


def visivel(l):
    try:
        return l.is_visible() and l.opacity > 0
    except Exception:
        return l.visible and l.opacity > 0


def area_do_bbox(l):
    """Área (px²) que a camada ocupa. Smart object salvo sem pixels (bbox zerado) usa os 4 cantos."""
    x0, y0, x1, y1 = l.bbox
    area = max(0, x1 - x0) * max(0, y1 - y0)
    if area > 0 or l.kind != 'smartobject':
        return area
    try:
        d = dados_do_so(l)
        q = d.get(b'nonAffineTransform')
        if q is None:
            q = d[b'Trnf']
        p = np.array(valores(q), dtype=np.float64).reshape(4, 2)
        return float(abs(np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1))) / 2)
    except Exception:
        return 0


def eh_efeito(nome):
    n = nome.lower()
    return any(k in n for k in PALAVRAS_EFEITO) and not any(k in n for k in ('design', 'logo', 'here'))


def achar_slots(psd):
    """Agrupa os smart objects pelo conteúdo (unique_id): o slot é o conteúdo, não a camada."""
    grupos = {}
    for l in psd.descendants():
        if l.kind != 'smartobject':
            continue
        try:
            uid = l.smart_object.unique_id
        except Exception:
            continue
        grupos.setdefault(uid, []).append(l)
    W, H = psd.size
    candidatos = []
    for uid, camadas in grupos.items():
        vis = [l for l in camadas if visivel(l)]
        if not vis:
            continue
        nomes = ' '.join(l.name.lower() for l in camadas)
        principal = max(vis, key=area_do_bbox)
        area = area_do_bbox(principal) / float(W * H)
        pelo_nome = any(k in nomes for k in PALAVRAS_SLOT) and not all(eh_efeito(l.name) for l in camadas)
        candidatos.append({'uid': uid, 'camadas': vis, 'todas': camadas, 'nome': principal.name, 'area': area, 'pelo_nome': pelo_nome})
    slots = [c for c in candidatos if c['pelo_nome'] and c['area'] > 0.0005]
    if not slots:
        grandes = sorted([c for c in candidatos if c['area'] > 0.02 and not eh_efeito(c['nome'])], key=lambda c: -c['area'])
        slots = grandes[:1]
    slots.sort(key=lambda c: (min(l.bbox[1] for l in c['camadas']), min(l.bbox[0] for l in c['camadas'])))
    return slots[:MAX_SLOTS], len(slots)


def conteudo_do_so(l):
    """Imagem RGBA que está hoje dentro do smart object (para o controle de qualidade e a área segura)."""
    so = l.smart_object
    if 'data' not in str(so.kind).lower():
        return None
    dados = so.data
    try:
        if so.is_psd():
            interno = PSDImage.open(io.BytesIO(dados))
            im = interno.topil()
            if im is None:
                im = interno.composite()
        else:
            im = Image.open(io.BytesIO(dados))
        im = im.convert('RGBA')
    except Exception:
        return None
    return im


# ---------------------------------------------------------------- geometria

def bern(t):
    return np.stack([(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t ** 2 * (1 - t), t ** 3], -1)


def geometria(l):
    d = dados_do_so(l)
    iw, ih = tamanho_do_so(l)
    # PSD antigo não grava nonAffineTransform; a transformação afim (Trnf) dá os mesmos 4 cantos.
    quad_bruto = d.get(b'nonAffineTransform')
    if quad_bruto is None:
        quad_bruto = d[b'Trnf']
    quad = np.array(valores(quad_bruto), dtype=np.float64).reshape(4, 2)
    warp = d.get(b'warp')
    estilo = enum(warp.get(b'warpStyle')) if warp is not None else 'warpNone'
    if warp is not None and b'bounds' in warp:
        b = warp[b'bounds']
        bx0, by0, bx1, by1 = num(b[b'Left']), num(b[b'Top ']), num(b[b'Rght']), num(b[b'Btom'])
    else:
        bx0, by0, bx1, by1 = 0.0, 0.0, float(iw), float(ih)
    malha = None
    if estilo == 'warpCustom':
        mp = warp[b'customEnvelopeWarp'][b'meshPoints']
        malha = np.stack([np.array(valores(mp[b'Hrzn'])), np.array(valores(mp[b'Vrtc']))], -1).reshape(4, 4, 2)
    return {'quad': quad, 'rect': np.float32([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]]), 'estilo': estilo, 'malha': malha}


def mapear(l, src, tela, escala=1.0):
    """Leva uma imagem float (h, w, c) do espaço do smart object para a tela (W, H), multiplicando pela escala.
    O último canal deve ser a cobertura (1 dentro), e os demais já multiplicados por ela."""
    g = geometria(l)
    W, H = tela
    sh, sw = src.shape[:2]
    c = 1 if src.ndim == 2 else src.shape[2]
    quad = g['quad'] * escala
    Hm = cv2.getPerspectiveTransform(g['rect'], np.float32(quad))
    if g['malha'] is not None:
        N = 48
        us = np.linspace(0, 1, N + 1)
        B = bern(us)
        G = np.einsum('vi,uj,ijk->vuk', B, B, g['malha'])
        Gh = cv2.perspectiveTransform(G.reshape(-1, 1, 2).astype(np.float64), Hm.astype(np.float64)).reshape(N + 1, N + 1, 2)
        out = np.zeros((H, W, c), np.float32)
        for i in range(N):
            for j in range(N):
                s = np.float32([[us[j] * sw, us[i] * sh], [us[j + 1] * sw, us[i] * sh], [us[j + 1] * sw, us[i + 1] * sh], [us[j] * sw, us[i + 1] * sh]])
                t = np.float32([Gh[i, j], Gh[i, j + 1], Gh[i + 1, j + 1], Gh[i + 1, j]])
                x0, y0 = np.floor(t.min(0)).astype(int) - 2
                x1, y1 = np.ceil(t.max(0)).astype(int) + 2
                x0c, y0c, x1c, y1c = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
                if x1c <= x0c or y1c <= y0c:
                    continue
                off = np.float32([x0c, y0c])
                M = cv2.getPerspectiveTransform(s, t - off)
                patch = cv2.warpPerspective(src, M, (x1c - x0c, y1c - y0c), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                if patch.ndim == 2:
                    patch = patch[..., None]
                m = np.zeros((y1c - y0c, x1c - x0c), np.uint8)
                cv2.fillConvexPoly(m, np.round(t - off).astype(np.int32), 1)
                m = cv2.dilate(m, np.ones((3, 3), np.uint8))
                reg = out[y0c:y1c, x0c:x1c]
                sel = (m > 0) & (reg[..., -1] == 0)
                reg[sel] = patch[sel]
        return out, g['estilo']
    S = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]]), g['rect'])
    out = cv2.warpPerspective(src, Hm @ S, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    if out.ndim == 2:
        out = out[..., None]
    return out, g['estilo']


def filtros_do_so(l):
    fx = dados_do_so(l).get(b'filterFX')
    res = []
    if fx is None:
        return res
    for f in fx.get(b'filterFXList', []):
        nm = str(getattr(f.get(b'Nm  '), 'value', f.get(b'Nm  '))).strip("'\x00 ")
        item = {'nome': nm}
        if nm.startswith('Displace'):
            fl = f[b'Fltr']
            item['hs'] = num(fl[b'HrzS'])
            item['vs'] = num(fl[b'VrtS'])
        res.append(item)
    return res


def deslocamento(mapa_psd, W, H, hs, vs):
    mp = np.array(PSDImage.open(mapa_psd).composite().convert('L').resize((W, H)), np.float32)
    return (mp - 128) * hs / 100.0, (mp - 128) * vs / 100.0


def mascara_na_tela(l, W, H):
    m = l.mask
    if m is None or getattr(m, 'disabled', False) or m.bbox == (0, 0, 0, 0):
        return None
    tela = np.full((H, W), m.background_color, np.uint8)
    x0, y0, x1, y1 = m.bbox
    mi = np.array(m.topil().convert('L'))
    cx0, cy0, cx1, cy1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if cx1 > cx0 and cy1 > cy0:
        tela[cy0:cy1, cx0:cx1] = mi[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    return tela


# ---------------------------------------------------------------- passadas

def passada(psd_path, uids, modo, dispmap, avisos):
    """modo: 'preto' | 'branco' | 'vazio'. Devolve a composição em uint8 RGB (resolução cheia)."""
    psd = PSDImage.open(psd_path)
    W, H = psd.size
    for l in list(psd.descendants()):
        if l.kind != 'smartobject':
            continue
        try:
            uid = l.smart_object.unique_id
        except Exception:
            continue
        if uid not in uids or not visivel(l):
            continue
        if modo == 'vazio':
            l.visible = False
            continue
        iw, ih = tamanho_do_so(l)
        cob, _ = mapear(l, np.ones((ih, iw), np.float32), (W, H))
        alfa = cob[..., 0]
        for f in filtros_do_so(l):
            if f['nome'].startswith('Displace'):
                if dispmap:
                    dx, dy = deslocamento(dispmap, W, H, f['hs'], f['vs'])
                    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
                    alfa = cv2.remap(alfa, xx + dx, yy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                else:
                    avisos.add('displace sem mapa')
            elif 'Gaussian' in f['nome'] or f['nome'] == 'Blur':
                alfa = cv2.GaussianBlur(alfa, (0, 0), 0.8)
            else:
                avisos.add('filtro ' + f['nome'])
        mk = mascara_na_tela(l, W, H)
        if mk is not None:
            alfa = alfa * (mk.astype(np.float32) / 255)
        a8 = np.clip(alfa * 255 + 0.5, 0, 255).astype(np.uint8)
        ys, xs = np.nonzero(a8)
        if len(xs) == 0:
            continue
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        cor = 0 if modo == 'preto' else 255
        rgba = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        rgba[..., :3] = cor
        rgba[..., 3] = a8[y0:y1, x0:x1]
        if l.has_effects():
            avisos.add('efeitos de camada no slot')
        pai = l.parent
        idx = pai.index(l)
        nova = PixelLayer.frompil(Image.fromarray(rgba, 'RGBA'), pai, name='SLOT', top=int(y0), left=int(x0))
        if nova in pai:
            pai.remove(nova)
        nova.blend_mode = l.blend_mode
        nova.opacity = l.opacity
        nova.clipping = l.clipping
        pai.insert(idx, nova)
        pai.remove(l)
    im = psd.composite(force=True)
    return rgb8(im)


def rgb8(im):
    if im.mode in ('I;16', 'I;16B', 'I'):
        a = np.asarray(im, np.float32)
        a = (a / (256.0 if a.max() > 255 else 1.0))
        a = np.clip(a, 0, 255).astype(np.uint8)
        return np.dstack([a] * 3)
    return np.asarray(im.convert('RGB'), np.uint8).copy()


def reduzir(img, W2, H2, interp=cv2.INTER_AREA):
    if img.shape[1] == W2 and img.shape[0] == H2:
        return img
    return cv2.resize(img, (W2, H2), interpolation=interp)


def tamanho_para(W, H, lado):
    s = min(1.0, lado / float(max(W, H)))
    return max(1, int(round(W * s))), max(1, int(round(H * s))), s


# ---------------------------------------------------------------- uv e mapa

def uv_e_mapa(psd, slots, tela, escala, dispmap):
    W2, H2 = tela
    melhor = np.zeros((H2, W2), np.float32)
    U = np.zeros((H2, W2), np.float32)
    V = np.zeros((H2, W2), np.float32)
    mapa = np.zeros((H2, W2), np.uint8)
    estilos = set()
    # Ordem do documento (de baixo para cima): onde dois slots se cobrem, vale o de cima
    # (cartão por cima do timbrado, celular por cima da folha).
    ordem = {id(l): i for i, l in enumerate(psd.descendants())}
    instancias = sorted(((ordem.get(id(l), 0), k, l) for k, s in enumerate(slots, 1) for l in s['camadas']), key=lambda x: x[0])
    for _, k, l in instancias:
        if True:
            iw, ih = tamanho_do_so(l)
            u = (np.arange(iw, dtype=np.float32) + 0.5) / iw
            v = (np.arange(ih, dtype=np.float32) + 0.5) / ih
            UU, VV = np.meshgrid(u, v)
            src = np.dstack([UU, VV, np.ones_like(UU)]).astype(np.float32)
            out, estilo = mapear(l, src, (W2, H2), escala)
            estilos.add(estilo)
            for f in filtros_do_so(l):
                if f['nome'].startswith('Displace') and dispmap:
                    dx, dy = deslocamento(dispmap, W2, H2, f['hs'] * escala, f['vs'] * escala)
                    yy, xx = np.mgrid[0:H2, 0:W2].astype(np.float32)
                    out = cv2.remap(out, xx + dx, yy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            cob = out[..., 2]
            # a camada de cima toma o pixel quando cobre pelo menos metade; na borda dela, só onde estava vazio
            sel = (cob >= 0.5) | ((cob > 0.02) & (melhor < 0.02))
            U[sel] = out[..., 0][sel] / cob[sel]
            V[sel] = out[..., 1][sel] / cob[sel]
            mapa[sel] = k
            melhor[sel] = cob[sel]
    return np.clip(U, 0, 1), np.clip(V, 0, 1), mapa, estilos


def estender(U, V, mapa, raio=24):
    """Leva o uv e o slot até 'raio' px para fora da borda, para o desfoque e o antisserrilhado da borda."""
    fora = (mapa == 0).astype(np.uint8)
    if fora.all() or not fora.any():
        return U, V, mapa
    dist, lab = cv2.distanceTransformWithLabels(fora, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    dentro = mapa > 0
    idx = np.zeros(lab.max() + 1, np.int64)
    idx[lab[dentro]] = np.flatnonzero(dentro)
    perto = (~dentro) & (dist <= raio)
    fonte = idx[lab[perto]]
    U2, V2, M2 = U.copy(), V.copy(), mapa.copy()
    U2[perto] = U.ravel()[fonte]
    V2[perto] = V.ravel()[fonte]
    M2[perto] = mapa.ravel()[fonte]
    return U2, V2, M2


def lado_na_tela(mapa, k):
    """Maior lado (px) do retângulo que o slot k ocupa no mapa."""
    ys, xs = np.nonzero(mapa == k)
    if len(xs) == 0:
        return 0
    return max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1)


def codificar_uv(U, V):
    u12 = np.clip(np.round(U * 4095), 0, 4095).astype(np.uint16)
    v12 = np.clip(np.round(V * 4095), 0, 4095).astype(np.uint16)
    r = (u12 >> 4).astype(np.uint8)
    g = (v12 >> 4).astype(np.uint8)
    b = (((u12 & 15) << 4) | (v12 & 15)).astype(np.uint8)
    return np.dstack([r, g, b])


def decodificar_uv(rgb):
    r = rgb[..., 0].astype(np.uint16)
    g = rgb[..., 1].astype(np.uint16)
    b = rgb[..., 2].astype(np.uint16)
    u12 = (r << 4) | (b >> 4)
    v12 = (g << 4) | (b & 15)
    return u12.astype(np.float32) / 4095, v12.astype(np.float32) / 4095


# ---------------------------------------------------------------- composição (a mesma do navegador)

def compor(base, ganho, vazio, U, V, mapa, designs):
    """designs: lista de imagens RGBA uint8, uma por slot (índice 1..n). Mesma conta de src/lib/mockups/composicao.ts."""
    out = base.astype(np.float32)
    b = base.astype(np.float32)
    g = ganho.astype(np.float32)
    z = vazio.astype(np.float32)
    for k, d in enumerate(designs, 1):
        m = mapa == k
        if d is None or not m.any():
            continue
        dh, dw = d.shape[:2]
        samp = cv2.remap(d.astype(np.float32), U * dw - 0.5, V * dh - 0.5, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        a = samp[..., 3:4] / 255
        x = samp[..., :3] / 255
        res = z + a * (b + g * x - z)
        out[m] = res[m]
    return np.clip(out, 0, 255).astype(np.uint8)


def diferenca(a, b, largura=800, area=None):
    """Diferença média (0-255) em 800 px. Com 'area' (máscara), mede também só dentro dela."""
    h = max(1, int(round(largura * a.shape[0] / a.shape[1])))
    x = cv2.resize(a, (largura, h), interpolation=cv2.INTER_AREA).astype(np.float32)
    y = cv2.resize(b, (largura, h), interpolation=cv2.INTER_AREA).astype(np.float32)
    d = np.abs(x - y).mean(-1)
    total = float(d.mean())
    if area is None:
        return total, None
    m = cv2.resize(area.astype(np.uint8), (largura, h), interpolation=cv2.INTER_NEAREST) > 0
    return total, (float(d[m].mean()) if m.any() else None)


# ---------------------------------------------------------------- papéis e área segura

def papel_do_slot(s, i, n, categoria):
    nome = s['nome'].lower()
    if 'logo' in nome:
        return 'logo'
    if any(k in nome for k in ('back', 'verso', 'costas', 'rear')):
        return 'verso'
    if any(k in nome for k in ('color', 'colour', ' cor', 'cor ')):
        return 'cor'
    if categoria in CATEGORIAS_DE_LOGO:
        return 'logo' if i == 0 or s['area'] > 0.01 else 'cor'
    if categoria == 'cartao' and n >= 2 and i % 2 == 1:
        return 'verso'
    return 'arte'


def area_segura(conteudo, papel):
    """Retângulo [x0, y0, x1, y1] (0..1) no espaço do design onde a peça deve ficar."""
    margem = {'logo': 0.14, 'arte': 0.0, 'verso': 0.0, 'cor': 0.0}.get(papel, 0.0)
    padrao = [margem, margem, 1 - margem, 1 - margem]
    if papel != 'logo' or conteudo is None:
        return padrao, 'padrao'
    a = np.asarray(conteudo.convert('RGBA'), np.uint8)
    h, w = a.shape[:2]
    alfa = a[..., 3]
    if (alfa < 250).mean() > 0.05:
        ocupado = alfa > 24
    else:
        canto = np.median(np.concatenate([a[:4, :4, :3].reshape(-1, 3), a[-4:, -4:, :3].reshape(-1, 3)]), 0)
        ocupado = np.abs(a[..., :3].astype(np.int16) - canto).max(-1) > 28
    ys, xs = np.nonzero(ocupado)
    if len(xs) < 50:
        return padrao, 'padrao'
    x0, x1 = np.percentile(xs, 1) / w, np.percentile(xs, 99) / w
    y0, y1 = np.percentile(ys, 1) / h, np.percentile(ys, 99) / h
    if (x1 - x0) * (y1 - y0) > 0.85 or (x1 - x0) < 0.05 or (y1 - y0) < 0.05:
        return padrao, 'padrao'
    folga = 0.03
    return [round(max(0, x0 - folga), 4), round(max(0, y0 - folga), 4), round(min(1, x1 + folga), 4), round(min(1, y1 + folga), 4)], 'conteudo_original'


def luminancia(rgb):
    x = rgb.astype(np.float32) / 255
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


# ---------------------------------------------------------------- principal

def salvar_conjunto(pasta, base, vazio, ganho, uvrgb, mapa):
    os.makedirs(pasta, exist_ok=True)
    Image.fromarray(base).save(os.path.join(pasta, 'base.jpg'), quality=90, optimize=True)
    Image.fromarray(vazio).save(os.path.join(pasta, 'vazio.jpg'), quality=90, optimize=True)
    Image.fromarray(ganho).save(os.path.join(pasta, 'ganho.png'), optimize=True)
    Image.fromarray(uvrgb).save(os.path.join(pasta, 'uv.png'), optimize=True)
    Image.fromarray(mapa, 'L').save(os.path.join(pasta, 'mapa.png'), optimize=True)
    return {f: os.path.getsize(os.path.join(pasta, f)) for f in ('base.jpg', 'vazio.jpg', 'ganho.png', 'uv.png', 'mapa.png')}


def processar(psd_path, saida, ident, categoria, tags, origem, dispmap=None):
    t0 = time.time()
    os.makedirs(saida, exist_ok=True)
    avisos = set()
    meta = {'id': ident, 'categoria': categoria, 'tags': tags, 'origem': origem, 'psd': os.path.basename(psd_path),
            'psd_bytes': os.path.getsize(psd_path), 'versao_pipeline': 2}
    psd = PSDImage.open(psd_path)
    W, H = psd.size
    meta['psd_px'] = [W, H]
    modo = str(psd.color_mode).split('.')[-1]
    if modo not in ('RGB', '3'):
        meta['qualidade'] = {'aprovado': False, 'motivo': f'modo de cor {modo}'}
        return meta
    previa_pil = psd.topil()
    if previa_pil is None:
        meta['qualidade'] = {'aprovado': False, 'motivo': 'sem prévia embutida'}
        return meta
    previa = rgb8(previa_pil)
    slots, achados = achar_slots(psd)
    if not slots:
        meta['qualidade'] = {'aprovado': False, 'motivo': 'nenhum smart object de design'}
        return meta
    if achados > MAX_SLOTS:
        avisos.add(f'{achados} slots, ficaram {MAX_SLOTS}')
    uids = {s['uid'] for s in slots}
    conteudos = [conteudo_do_so(s['camadas'][0]) for s in slots]

    tempos = {}
    comp = {}
    for modo_p in ('preto', 'branco', 'vazio'):
        t = time.time()
        comp[modo_p] = passada(psd_path, uids, modo_p, dispmap, avisos)
        tempos[modo_p] = round(time.time() - t, 1)
        print(f'  {ident}: {modo_p} {tempos[modo_p]} s', flush=True)

    Wa, Ha, ea = tamanho_para(W, H, LADO_ALTA)
    Wt, Ht, _ = tamanho_para(W, H, LADO_TRABALHO)
    base_a = reduzir(comp['preto'], Wa, Ha)
    branco_a = reduzir(comp['branco'], Wa, Ha)
    vazio_a = reduzir(comp['vazio'], Wa, Ha)
    ganho_a = np.clip(branco_a.astype(np.int16) - base_a.astype(np.int16), 0, 255).astype(np.uint8)
    del comp
    U, V, mapa, estilos = uv_e_mapa(psd, slots, (Wa, Ha), ea, dispmap)
    U, V, mapa = estender(U, V, mapa)
    for e in estilos:
        if e not in ('warpNone', 'warpCustom'):
            avisos.add('deformação ' + e)

    # uv passa pela codificação de 12 bits antes do QC, para o QC medir o que o navegador vai ver
    uv_a = codificar_uv(U, V)
    Ud, Vd = decodificar_uv(uv_a)
    base_t = reduzir(base_a, Wt, Ht)
    vazio_t = reduzir(vazio_a, Wt, Ht)
    ganho_t = reduzir(ganho_a, Wt, Ht)
    Ut = cv2.resize(Ud, (Wt, Ht), interpolation=cv2.INTER_LINEAR)
    Vt = cv2.resize(Vd, (Wt, Ht), interpolation=cv2.INTER_LINEAR)
    mapa_t = cv2.resize(mapa, (Wt, Ht), interpolation=cv2.INTER_NEAREST)
    uv_t = codificar_uv(Ut, Vt)

    # controle de qualidade: a conta com o conteúdo original x a prévia do Photoshop
    previa_t = reduzir(previa, Wt, Ht)
    designs = []
    for k, (s, c) in enumerate(zip(slots, conteudos), 1):
        if c is None:
            designs.append(None)
            avisos.add('conteúdo do slot fora do PSD')
            continue
        # O design vai no tamanho em que aparece na tela (x2), como o navegador faz: amostrar um
        # design de 2000 px numa tela de 300 px sem reduzir antes serrilha e engana o controle.
        iw, ih = tamanho_do_so(s['camadas'][0])
        lado = lado_na_tela(mapa_t, k)
        f = min(1.0, max(32.0, 2.0 * lado) / float(max(iw, ih))) if lado else 1.0
        designs.append(np.asarray(c.resize((max(1, int(round(iw * f))), max(1, int(round(ih * f)))), Image.LANCZOS), np.uint8))
    Ut2, Vt2 = decodificar_uv(uv_t)
    recon = compor(base_t, ganho_t, vazio_t, Ut2, Vt2, mapa_t, designs)
    dif_total, dif_slot = diferenca(recon, previa_t, area=mapa_t > 0)
    dif = max(dif_total, dif_slot or 0.0)
    sem_conteudo = any(d is None for d in designs)
    aprovado = dif <= LIMITE_QC and not sem_conteudo
    motivo = None
    if not aprovado:
        motivo = 'conteúdo do slot fora do PSD' if sem_conteudo else f'diferença {dif:.1f} com a prévia (imagem {dif_total:.1f}, área do slot {dif_slot or 0:.1f})'
    qc = np.concatenate([previa_t, np.full((Ht, 12, 3), 255, np.uint8), recon], 1)
    Image.fromarray(qc).save(os.path.join(saida, 'qc.jpg'), quality=80)

    tam = {}
    tam['alta'] = salvar_conjunto(os.path.join(saida, 'alta'), base_a, vazio_a, ganho_a, uv_a, mapa)
    tam['trabalho'] = salvar_conjunto(os.path.join(saida, 'trabalho'), base_t, vazio_t, ganho_t, uv_t, mapa_t)
    tw, th, _ = tamanho_para(W, H, LADO_THUMB)
    Image.fromarray(reduzir(previa, tw, th)).save(os.path.join(saida, 'thumb.jpg'), quality=82, optimize=True)
    tam['thumb'] = os.path.getsize(os.path.join(saida, 'thumb.jpg'))

    info_slots = []
    lum_v = luminancia(vazio_t)
    gmed = ganho_t.astype(np.float32).mean(-1)
    for i, (s, c) in enumerate(zip(slots, conteudos)):
        k = i + 1
        papel = papel_do_slot(s, i, len(slots), categoria)
        seg, fonte = area_segura(c, papel)
        m = (mapa_t == k) & (gmed > 8)
        if m.any():
            dentro = m & (Ut2 >= seg[0]) & (Ut2 <= seg[2]) & (Vt2 >= seg[1]) & (Vt2 <= seg[3])
            alvo = dentro if dentro.sum() > 30 else m
            lum = float(np.median(lum_v[alvo]))
            cobertura = float(m.mean())
        else:
            lum, cobertura = None, 0.0
        iw, ih = tamanho_do_so(s['camadas'][0])
        g = geometria(s['camadas'][0])
        info_slots.append({
            'indice': k, 'papel': papel, 'nome': s['nome'], 'unique_id': s['uid'], 'so_px': [iw, ih],
            'instancias': len(s['camadas']), 'deformacao': g['estilo'], 'mescla': str(s['camadas'][0].blend_mode).split('.')[-1],
            'area_segura': seg, 'area_segura_fonte': fonte, 'luminancia_superficie': None if lum is None else round(lum, 4),
            'cobertura': round(cobertura, 4),
            'px_na_tela': int(lado_na_tela(mapa, k)),
        })
    meta.update({
        'nome': ident,
        'largura': Wa, 'altura': Ha, 'largura_trabalho': Wt, 'altura_trabalho': Ht,
        'luminancia_media': round(float(luminancia(base_t).mean()), 4),
        'slots': info_slots,
        'qualidade': {'aprovado': aprovado, 'diferenca': round(dif, 3), 'diferenca_imagem': round(dif_total, 3), 'diferenca_slot': None if dif_slot is None else round(dif_slot, 3), 'limite': LIMITE_QC, 'motivo': motivo, 'avisos': sorted(avisos)},
        'bytes': tam, 'tempos': tempos, 'segundos': round(time.time() - t0, 1),
    })
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('psd')
    ap.add_argument('saida')
    ap.add_argument('--id', required=True)
    ap.add_argument('--categoria', required=True)
    ap.add_argument('--tags', default='')
    ap.add_argument('--origem', default='')
    ap.add_argument('--dispmap', default=None)
    a = ap.parse_args()
    try:
        meta = processar(a.psd, a.saida, a.id, a.categoria, [t for t in a.tags.split(',') if t], a.origem, a.dispmap)
    except Exception as e:  # o lote registra e segue; nada é engolido
        import traceback
        traceback.print_exc()
        meta = {'id': a.id, 'categoria': a.categoria, 'qualidade': {'aprovado': False, 'motivo': f'erro: {type(e).__name__}: {e}'[:300]}}
        os.makedirs(a.saida, exist_ok=True)
        json.dump(meta, open(os.path.join(a.saida, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return 1
    json.dump(meta, open(os.path.join(a.saida, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    q = meta['qualidade']
    print(f"{a.id}: {'APROVADO' if q['aprovado'] else 'REVISÃO'} dif={q.get('diferenca')} {q.get('motivo') or ''} {meta.get('segundos', '')} s", flush=True)
    return 0 if q['aprovado'] else 2


if __name__ == '__main__':
    sys.exit(main())
