"""Transforma uma cena gerada por IA (superfície lisa e branca) num mockup do catálogo, com as
mesmas camadas dos PSDs (frente MCK, rodada 2, 30/09/2026). O navegador compõe igual:

    saida = vazio + a * (base - vazio) + ganho * design(uv)

Numa superfície branca impressa, a tinta multiplica a luz do papel. Então, dentro da área:
    base  = (1 - c) * cena             (c = cobertura da área, 0..1, com antisserrilhado)
    ganho = c * cena / branco           (a luz e a sombra da superfície; branco = p95 da área)
    vazio = cena                        (sem design, a peça branca como veio)
    uv    = inversa da homografia dos 4 cantos (perspectiva correta)
Fora da área: base = vazio = cena e ganho = 0.

Fundo trocável (cena em croma verde): o verde é recortado, o reflexo verde sai do objeto, a
sombra de contato vira uma razão de luz e a cena padrão ganha um fundo cinza-claro. A camada
extra fundo.png guarda R = objeto (0..255) e G = luz do fundo (razão/1,25), e o painel troca o
fundo por cor, degradê ou textura da marca sem perder a sombra.

Os 4 cantos saem sozinhos (maior área branca, lisa e com cara de quadrilátero) ou vêm curados à
mão em quads-ia.json (camiseta, parede, veículo: onde a área certa não é a maior área branca).

Uso:
  python mockup_de_ia.py [--cenas C:/AI/acervo-aceleriq/mockups-trabalho/ia] [--trabalho C:/AI/acervo-aceleriq/mockups-trabalho] [--so id1,id2]
Saída: <trabalho>/saida/<id>/{alta,trabalho}/{base.jpg,vazio.jpg,ganho.png,uv.png,mapa.png[,fundo.png]}, thumb.jpg, qc.jpg, meta.json
e acrescenta os aprovados em <trabalho>/catalogo-ia.json.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from psd_mockup import LADO_THUMB, LADO_TRABALHO, codificar_uv, decodificar_uv, compor, luminancia, tamanho_para  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
PADRAO_TRABALHO = 'C:/AI/acervo-aceleriq/mockups-trabalho'
FUNDO_PADRAO = np.array([236, 236, 236], np.float32)
RAZAO_MAX = 1.25


def cenas():
    """A lista de cenas vem do mesmo módulo que o gerador usa (uma fonte só)."""
    url = 'file:///' + os.path.join(AQUI, 'cenas-de-ia.mjs').replace('\\', '/')
    out = subprocess.run(['node', '-e', f"import('{url}').then(m=>process.stdout.write(JSON.stringify(m.CENAS_DE_IA)))"],
                         capture_output=True, text=True, encoding='utf-8', check=True)
    return {c['id']: c for c in json.loads(out.stdout)}


# ---------------------------------------------------------------- croma (fundo trocável)

def media_local(valor, peso, sigma):
    """Média de `valor` onde `peso` > 0, espalhada para os vizinhos (convolução normalizada)."""
    num = cv2.GaussianBlur((valor * peso).astype(np.float32), (0, 0), sigma)
    den = cv2.GaussianBlur(peso.astype(np.float32), (0, 0), sigma)
    return num / np.maximum(den, 1e-4), den


def recortar_croma(rgb):
    """Devolve (cena com fundo neutro, alfa do objeto 0..1, razão de luz do fundo).

    Rodada 2 (achado do revisor: contorno verde-azulado nas alças e nas bordas da sacola):
    - o alfa sai da chave LINEAR contra o verde local (pixel meio objeto, meio verde = alfa 0,5),
      e não de uma rampa fixa, que subestimava o alfa da borda;
    - a borda é descontaminada: a cor do objeto sai de P = a*F + (1-a)*verde_local, e o verde que
      sobra é tirado (G <= max(R, B) na faixa de transição);
    - a luz do fundo é medida só no fundo (o objeto claro não vaza um halo claro em volta);
    - a sombra de contato fica um pouco mais funda (o verde rebate luz e clareia a sombra).
    """
    x = rgb.astype(np.float32)
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    chave = g - np.maximum(r, b)
    certo = chave > 60.0
    # Verde de referência perto de cada pixel (o croma tem luz desigual).
    chave_fundo, cobertura_fundo = media_local(chave * certo, certo.astype(np.float32), 12.0)
    chave_fundo = np.where(cobertura_fundo > 1e-3, chave_fundo, float(np.median(chave[certo])) if certo.any() else 120.0)
    alfa_lin = np.clip(1.0 - chave / np.maximum(chave_fundo, 30.0), 0, 1)
    # Corta o ruído das pontas (respingo de verde no objeto, grão do fundo).
    alfa = np.clip((alfa_lin - 0.06) / 0.88, 0, 1).astype(np.float32)
    # Limpa respingos: objeto = componentes grandes; buraco pequeno no fundo também sai.
    obj = (alfa > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(obj, 8)
    minimo = 0.002 * obj.size
    manter = np.zeros(n, bool)
    manter[1:] = st[1:, cv2.CC_STAT_AREA] >= minimo
    obj_limpo = manter[lab]
    alfa[~obj_limpo & (alfa > 0.5)] = 0.0
    perto = cv2.dilate(obj_limpo.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    alfa[~perto] = 0.0
    alfa = cv2.GaussianBlur(alfa, (0, 0), 0.6)
    # Cor do verde em volta (com a luz local), para descontaminar a borda.
    pc = certo.astype(np.float32)
    verde = np.dstack([media_local(c, pc, 12.0)[0] for c in (r, g, b)])
    a3 = alfa[..., None]
    borda = (alfa > 0.02) & (alfa < 0.98)
    F = x.copy()
    F[borda] = np.clip((x[borda] - (1 - a3[borda]) * verde[borda]) / np.maximum(a3[borda], 0.15), 0, 255)
    # Despill: no miolo, o reflexo leve; na faixa de transição (e 2 px para dentro), verde nenhum.
    faixa = cv2.dilate(borda.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    teto = np.maximum(F[..., 0], F[..., 2]) + np.where(faixa, 0.0, 4.0)
    F[..., 1] = np.minimum(F[..., 1], teto)
    limpo = F
    # Luz do fundo: o verde de referência é uma superfície suave (quadrática, ajuste robusto).
    H, W = g.shape
    ys, xs = np.nonzero(certo)
    passo = max(1, len(xs) // 60000)
    ys, xs = ys[::passo], xs[::passo]
    X = np.stack([np.ones_like(xs), xs / W, ys / H, (xs / W) ** 2, (xs / W) * (ys / H), (ys / H) ** 2], -1).astype(np.float64)
    alvo = g[ys, xs].astype(np.float64)
    usar = np.ones(len(alvo), bool)
    for _ in range(4):
        cf, *_ = np.linalg.lstsq(X[usar], alvo[usar], rcond=None)
        pred = X @ cf
        usar = alvo >= pred * 0.92  # sombra fica fora da referência
    yy, xx = np.mgrid[0:H, 0:W]
    T = np.stack([np.ones((H, W)), xx / W, yy / H, (xx / W) ** 2, (xx / W) * (yy / H), (yy / H) ** 2], -1)
    ref = np.maximum(T @ cf, 1.0)
    razao_bruta = np.clip(g / ref, 0, RAZAO_MAX)
    # Só o fundo conta (peso 1 - alfa): sem o halo claro do objeto. O croma tem grão: sai suave.
    peso = np.clip(1.0 - alfa, 0, 1) * (chave > 20.0)
    razao, _ = media_local(razao_bruta, peso, 2.5)
    razao = np.clip(razao, 0, RAZAO_MAX)
    # Sombra de contato: o verde rebate luz e clareia a sombra; aprofunda o que é sombra (< 1).
    razao = np.where(razao < 1.0, np.power(np.clip(razao, 1e-3, 1.0), 1.6), razao)
    razao = np.where(alfa > 0.5, 1.0, razao)
    neutro = alfa[..., None] * limpo + (1 - alfa[..., None]) * FUNDO_PADRAO * razao[..., None]
    return np.clip(neutro, 0, 255).astype(np.uint8), alfa.astype(np.float32), razao.astype(np.float32)


# ---------------------------------------------------------------- área branca e 4 cantos

def area_branca(rgb):
    """Máscara (0/1) do que é branco, liso e sem cor."""
    x = rgb.astype(np.float32) / 255
    lum = luminancia(rgb)
    sat = x.max(-1) - x.min(-1)
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.GaussianBlur(np.sqrt(gx * gx + gy * gy), (0, 0), 1.5)
    claro = np.percentile(lum, 99.5)
    m = (lum >= max(0.5, claro * 0.72)) & (sat < 0.12) & (grad < 0.12)
    return m.astype(np.uint8)


def ordenar(p):
    p = np.asarray(p, np.float64)
    s = p.sum(1)
    d = p[:, 0] - p[:, 1]
    return np.array([p[np.argmin(s)], p[np.argmax(d)], p[np.argmax(s)], p[np.argmin(d)]])


def quad_da_componente(mask):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None, 0.0
    c = max(cs, key=cv2.contourArea)
    casca = cv2.convexHull(c)
    per = cv2.arcLength(casca, True)
    quad = None
    for eps in np.linspace(0.01, 0.08, 15):
        ap = cv2.approxPolyDP(casca, eps * per, True)
        if len(ap) == 4:
            quad = ap.reshape(4, 2).astype(np.float64)
            break
    if quad is None:
        quad = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float64)
    quad = ordenar(quad)
    # A borda da peça tem gradiente e fica fora da máscara: devolve 2 px para fora.
    centro = quad.mean(0)
    dirs = quad - centro
    quad = quad + dirs / np.maximum(np.linalg.norm(dirs, axis=1, keepdims=True), 1e-6) * 2.0
    area_q = abs(cv2.contourArea(quad.astype(np.float32)))
    enchimento = float(mask.sum()) / area_q if area_q > 0 else 0.0
    return quad, enchimento


def achar_areas(rgb, maximo=2):
    """Até `maximo` superfícies brancas com cara de placa (maiores primeiro)."""
    H, W = rgb.shape[:2]
    m = area_branca(rgb)
    k = max(3, int(round(min(H, W) * 0.018)) | 1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 4)
    ordem = sorted(range(1, n), key=lambda i: -st[i, cv2.CC_STAT_AREA])
    achados = []
    for i in ordem:
        frac = st[i, cv2.CC_STAT_AREA] / float(H * W)
        if frac < 0.015 or frac > 0.75:
            continue
        comp = (lab == i).astype(np.uint8)
        quad, ench = quad_da_componente(comp)
        if quad is None or ench < 0.85:
            continue
        achados.append({'quad': quad, 'enchimento': round(ench, 3), 'fracao': round(frac, 4), 'mascara': comp})
        if len(achados) >= maximo:
            break
    return achados


# ---------------------------------------------------------------- camadas

def homografia_inversa(quad):
    src = np.float32([[0, 0], [1, 0], [1, 1], [0, 1]])
    Hm = cv2.getPerspectiveTransform(src, np.float32(quad))
    return np.linalg.inv(Hm)


EXPANSAO_DO_QUAD = 0.015


def expandir_quad(quad, fracao=EXPANSAO_DO_QUAD):
    """O quad achado fica um pouco para dentro da peça (a borda tem gradiente): 1,5% para fora."""
    centro = quad.mean(0)
    return centro + (quad - centro) * (1.0 + 2.0 * fracao)


def _reta(p, q):
    """Reta a*x + b*y = c pelos pontos p e q."""
    a, b = q[1] - p[1], p[0] - q[0]
    return a, b, a * p[0] + b * p[1]


def _cruzar(r1, r2):
    a1, b1, c1 = r1
    a2, b2, c2 = r2
    det = a1 * b2 - a2 * b1
    if abs(det) < 1e-9:
        return None
    return np.array([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det])


def refinar_quad(rgb, quad):
    """Leva cada aresta do quad até a borda real da peça: o ponto de maior gradiente numa faixa
    para fora (a peça branca termina onde a luz muda). Aresta sem borda clara (peça cortada,
    borda escondida) vai 1,5% para fora. Devolve (quad, deslocamentos em px)."""
    lum = cv2.GaussianBlur(luminancia(rgb).astype(np.float32), (0, 0), 0.7)
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)
    G = np.sqrt(gx * gx + gy * gy)
    centro = quad.mean(0)
    lado = float(np.sqrt(max(1.0, abs(cv2.contourArea(quad.astype(np.float32))))))
    alcance = max(3.0, 0.02 * lado)
    padrao = EXPANSAO_DO_QUAD * lado
    retas, passos = [], []
    for i in range(4):
        p, q = quad[i], quad[(i + 1) % 4]
        v = q - p
        comp = float(np.linalg.norm(v))
        n = np.array([v[1], -v[0]]) / max(comp, 1e-6)
        if np.dot((p + q) / 2 - centro, n) < 0:
            n = -n
        s = np.linspace(0.12, 0.88, max(8, int(comp / 3)))
        base = p[None, :] + s[:, None] * v[None, :]
        ts = np.arange(-1.0, alcance + 0.01, 0.5)
        medias = []
        for t in ts:
            pts = (base + t * n).astype(np.float32)
            amostra = cv2.remap(G, pts[:, 0].reshape(1, -1), pts[:, 1].reshape(1, -1), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            medias.append(float(np.median(amostra)))
        medias = np.array(medias)
        k = int(np.argmax(medias))
        claro = medias[k] > 0.04 and medias[k] > 2.0 * float(np.median(medias))
        t = float(ts[k]) if claro else padrao
        passos.append(round(t, 2))
        retas.append(_reta(p + t * n, q + t * n))
    novo = []
    for i in range(4):
        x = _cruzar(retas[(i - 1) % 4], retas[i])
        if x is None:
            return expandir_quad(quad), passos
        novo.append(x)
    novo = np.array(novo)
    # Sanidade: o quad novo não pode encolher nem crescer demais.
    if not np.all(np.isfinite(novo)) or np.max(np.linalg.norm(novo - quad, axis=1)) > 3 * alcance:
        return expandir_quad(quad), passos
    return novo, passos


def preencher_buracos(m):
    """Máscara 0/1 com os buracos de dentro preenchidos (alça, dedo: o que fica por cima da peça)."""
    H, W = m.shape
    inv = np.pad((m == 0).astype(np.uint8), 1, constant_values=1)
    mascara = np.zeros((H + 4, W + 4), np.uint8)
    cv2.floodFill(inv, mascara, (0, 0), 2)
    return (inv[1:-1, 1:-1] != 2).astype(np.uint8)


def borda_pelo_gradiente(rgb, regiao, poli, lado):
    """A área branca para antes da borda da peça (o filtro de gradiente corta 2 a 4 px): cresce a
    região até a aresta real, que o watershed acha no gradiente de cor. Só cresce para FORA (o
    que fica por cima da peça, alça e dedo, continua de fora) e nunca passa do quad expandido."""
    d = max(3, int(round(0.012 * lado)))
    reg = (regiao > 0).astype(np.uint8)
    cheia = preencher_buracos(reg)
    faixa = cv2.dilate(cheia, np.ones((2 * d + 1, 2 * d + 1), np.uint8)) & poli
    marcas = np.zeros(reg.shape, np.int32)
    marcas[faixa == 0] = 1
    marcas[cv2.erode(reg, np.ones((3, 3), np.uint8)) > 0] = 2
    suave = cv2.GaussianBlur(rgb, (0, 0), 0.8)
    cv2.watershed(np.ascontiguousarray(suave[..., ::-1]), marcas)
    # Só perto da beirada do quad: o que fica por cima da peça longe da borda (a ponta da alça
    # dentro da sacola) não é engolido pela arte.
    ate_a_beirada = cv2.distanceTransform(poli, cv2.DIST_L2, 3)
    fora = (cheia == 0) & (faixa > 0) & (ate_a_beirada <= d + 2)
    # Nos últimos 2 px antes da beirada, +2 px: quem desenha a aresta é o polígono do quad (reto e
    # antisserrilhado), não o contorno em degraus do watershed.
    ganhou = (marcas == 2) | (marcas == -1)
    folga = (cv2.dilate(ganhou.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & (ate_a_beirada <= 4)
    cresceu = ((ganhou | folga) & fora).astype(np.float32)
    dentro = cv2.dilate(reg, np.ones((5, 5), np.uint8)).astype(np.float32)
    return np.clip(np.maximum(dentro, cresceu), 0, 1)


def cobertura(quad, H, W, regiao=None, super_=4, rgb=None, objeto=None):
    """Cobertura 0..1 do quadrilátero (antisserrilhada, 1,5% para fora), recortada pela região
    branca quando houver (dedo na frente da tela, alça por cima da sacola), com a borda ajustada
    pelo gradiente e, nas cenas de croma, pelo alfa do objeto."""
    # A aresta reta e antisserrilhada vem do quad levado até a borda real (gradiente); a região
    # cresce até 2 px além dele, então quem desenha a beirada é o polígono, sem serrilhado.
    q = refinar_quad(rgb, quad)[0] if rgb is not None else expandir_quad(quad)
    big = np.zeros((H * super_, W * super_), np.uint8)
    cv2.fillConvexPoly(big, np.round(q * super_).astype(np.int32), 255, lineType=cv2.LINE_AA)
    c = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    if regiao is not None:
        if rgb is not None:
            lado = float(np.sqrt(max(1.0, abs(cv2.contourArea(quad.astype(np.float32))))))
            poli = cv2.dilate((c > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
            r = borda_pelo_gradiente(rgb, regiao, poli, lado)
        else:
            r = cv2.dilate(regiao.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        r = cv2.GaussianBlur(r.astype(np.float32), (0, 0), 0.7)
        c = c * np.clip(r, 0, 1)
    if objeto is not None:
        c = c * np.clip(objeto, 0, 1)
    return c


def uv_do_quad(quad, H, W):
    Hi = homografia_inversa(quad)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    p = np.stack([xx + 0.5, yy + 0.5, np.ones_like(xx)], -1) @ Hi.T
    U = p[..., 0] / p[..., 2]
    V = p[..., 1] / p[..., 2]
    return np.clip(U, 0, 1).astype(np.float32), np.clip(V, 0, 1).astype(np.float32)


def montar(cena, areas, objeto=None):
    """areas: lista de (quad, regiao|None). Devolve base, vazio, ganho, U, V, mapa e info por slot.
    objeto: alfa do objeto nas cenas de croma (a arte não passa para o fundo)."""
    H, W = cena.shape[:2]
    x = cena.astype(np.float32)
    base = x.copy()
    ganho = np.zeros_like(x)
    U = np.zeros((H, W), np.float32)
    V = np.zeros((H, W), np.float32)
    mapa = np.zeros((H, W), np.uint8)
    info = []
    lum = luminancia(cena)
    for k, (quad, regiao) in enumerate(areas, 1):
        c = cobertura(quad, H, W, regiao, rgb=cena, objeto=objeto)
        dentro = c > 0.5
        branco = float(np.percentile(lum[dentro], 95)) if dentro.any() else 1.0
        branco = max(branco, 0.45)
        # A luz da superfície (sombra, dobra, brilho) vai para o ganho; o branco do papel = branco do design.
        g = np.clip(x / branco * 0.985, 0, 255)
        uk, vk = uv_do_quad(quad, H, W)
        sel = c > 0.004
        base[sel] = ((1 - c[..., None]) * x)[sel]
        ganho[sel] = (c[..., None] * g)[sel]
        U[sel], V[sel], mapa[sel] = uk[sel], vk[sel], k
        topo = np.linalg.norm(quad[1] - quad[0])
        baixo = np.linalg.norm(quad[2] - quad[3])
        esq = np.linalg.norm(quad[3] - quad[0])
        dir_ = np.linalg.norm(quad[2] - quad[1])
        largura, altura = (topo + baixo) / 2, (esq + dir_) / 2
        info.append({'largura_px': float(largura), 'altura_px': float(altura), 'luminancia': float(np.median(lum[dentro])) if dentro.any() else None,
                     'cobertura': float(dentro.mean()), 'branco': round(branco, 4)})
    return np.clip(base, 0, 255).astype(np.uint8), cena.copy(), np.clip(ganho, 0, 255).astype(np.uint8), U, V, mapa, info


def salvar(pasta, base, vazio, ganho, U, V, mapa, fundo=None):
    os.makedirs(pasta, exist_ok=True)
    Image.fromarray(base).save(os.path.join(pasta, 'base.jpg'), quality=92, optimize=True)
    Image.fromarray(vazio).save(os.path.join(pasta, 'vazio.jpg'), quality=92, optimize=True)
    Image.fromarray(ganho).save(os.path.join(pasta, 'ganho.png'), optimize=True)
    Image.fromarray(codificar_uv(U, V)).save(os.path.join(pasta, 'uv.png'), optimize=True)
    Image.fromarray(mapa, 'L').save(os.path.join(pasta, 'mapa.png'), optimize=True)
    nomes = ['base.jpg', 'vazio.jpg', 'ganho.png', 'uv.png', 'mapa.png']
    if fundo is not None:
        Image.fromarray(fundo).save(os.path.join(pasta, 'fundo.png'), optimize=True)
        nomes.append('fundo.png')
    return {n: os.path.getsize(os.path.join(pasta, n)) for n in nomes}


def xadrez(w, h, lado=64):
    yy, xx = np.mgrid[0:h, 0:w]
    q = ((yy // lado + xx // lado) % 2).astype(np.uint8)
    img = np.zeros((h, w, 4), np.uint8)
    img[..., 0] = np.where(q, 230, 20)
    img[..., 1] = np.where(q, 90, 120)
    img[..., 2] = np.where(q, 40, 200)
    img[..., 3] = 255
    return img


def processar(cena_meta, png, saida, quads_curados):
    t0 = time.time()
    ident = cena_meta['id']
    rgb = np.asarray(Image.open(png).convert('RGB'), np.uint8).copy()
    avisos = []
    alfa = razao = None
    if cena_meta.get('fundo'):
        rgb, alfa, razao = recortar_croma(rgb)
    H, W = rgb.shape[:2]
    areas = []
    fonte = 'automatica'
    if ident in quads_curados:
        fonte = 'curada'
        for q in quads_curados[ident]['quads']:
            quad = ordenar(np.array(q, np.float64) * [W, H])
            regiao = area_branca(rgb) if quads_curados[ident].get('recortar_pelo_branco', True) else None
            areas.append((quad, regiao))
        enchimentos = []
    else:
        achados = achar_areas(rgb, maximo=2 if cena_meta['categoria'] == 'cartao' else 1)
        if not achados:
            return {'id': ident, 'qualidade': {'aprovado': False, 'motivo': 'área branca lisa não achada: marque os 4 cantos em quads-ia.json'}}
        areas = [(a['quad'], a['mascara']) for a in achados]
        enchimentos = [a['enchimento'] for a in achados]
    base, vazio, ganho, U, V, mapa, info = montar(rgb, areas, alfa)
    fundo = None
    if alfa is not None:
        fundo = np.dstack([np.clip(alfa * 255 + 0.5, 0, 255), np.clip(razao / RAZAO_MAX * 255 + 0.5, 0, 255), np.zeros_like(alfa)]).astype(np.uint8)

    Wt, Ht, _ = tamanho_para(W, H, LADO_TRABALHO)
    rd = lambda a, i=cv2.INTER_AREA: cv2.resize(a, (Wt, Ht), interpolation=i) if (a.shape[1], a.shape[0]) != (Wt, Ht) else a  # noqa: E731
    tam = {'alta': salvar(os.path.join(saida, 'alta'), base, vazio, ganho, U, V, mapa, fundo)}
    Ut, Vt = rd(U, cv2.INTER_LINEAR), rd(V, cv2.INTER_LINEAR)
    tam['trabalho'] = salvar(os.path.join(saida, 'trabalho'), rd(base), rd(vazio), rd(ganho), Ut, Vt, rd(mapa, cv2.INTER_NEAREST), None if fundo is None else rd(fundo))
    tw, th, _ = tamanho_para(W, H, LADO_THUMB)
    Image.fromarray(cv2.resize(vazio, (tw, th), interpolation=cv2.INTER_AREA)).save(os.path.join(saida, 'thumb.jpg'), quality=84, optimize=True)
    tam['thumb'] = os.path.getsize(os.path.join(saida, 'thumb.jpg'))

    # Controle: (1) design branco dá exatamente o papel branco da cena (cena / branco da área): a
    # conta e a codificação do uv não sujam a peça; (2) o xadrez mostra a perspectiva para a
    # conferência a olho (qc.jpg), que é o que pega canto errado.
    Ud, Vd = decodificar_uv(codificar_uv(U, V))
    brancos = [np.full((64, 64, 4), 255, np.uint8) for _ in areas]
    rec = compor(base, ganho, vazio, Ud, Vd, mapa, brancos)
    esperado = np.clip(base.astype(np.float32) + ganho.astype(np.float32), 0, 255)
    m = mapa > 0
    dif_branco = float(np.abs(rec.astype(np.float32) - esperado)[m].mean()) if m.any() else 0.0
    tabuleiros = [xadrez(max(64, int(i['largura_px'])), max(64, int(i['altura_px']))) for i in info]
    prova = compor(base, ganho, vazio, Ud, Vd, mapa, tabuleiros)
    lado_a_lado = Image.fromarray(np.concatenate([vazio, np.full((H, 12, 3), 255, np.uint8), prova], 1))
    lado_a_lado.resize((lado_a_lado.width // 2, lado_a_lado.height // 2), Image.LANCZOS).save(os.path.join(saida, 'qc.jpg'), quality=80)

    if enchimentos and min(enchimentos) < 0.85:
        avisos.append('área pouco retangular')
    aprovado = dif_branco <= 2.0 and all(i['cobertura'] > 0.004 for i in info)
    papel = cena_meta.get('papel', 'arte')
    slots = []
    for k, i in enumerate(info, 1):
        lado = max(i['largura_px'], i['altura_px'])
        f = min(2.0, 2048.0 / max(1.0, lado))
        p = papel
        if cena_meta['categoria'] == 'cartao' and k == 2:
            p = 'verso'
        slots.append({'indice': k, 'papel': p, 'nome': 'superfície lisa', 'so_px': [int(round(i['largura_px'] * f)), int(round(i['altura_px'] * f))],
                      'area_segura': [0.1, 0.1, 0.9, 0.9] if p == 'logo' else [0.0, 0.0, 1.0, 1.0], 'area_segura_fonte': 'ia',
                      'luminancia_superficie': None if i['luminancia'] is None else round(i['luminancia'], 4), 'cobertura': round(i['cobertura'], 4),
                      'deformacao': 'perspectiva', 'px_na_tela': int(round(lado))})
    return {
        'id': ident, 'nome': cena_meta.get('nome') or ident, 'categoria': cena_meta['categoria'], 'tags': cena_meta.get('tags', []),
        'origem': f"gerado por IA ({cena_meta.get('modelo', 'gerador de imagem')}) | {os.path.basename(png)}",
        'fonte': 'ia', 'fundo_trocavel': fundo is not None, 'versao_pipeline': 4,
        'largura': W, 'altura': H, 'largura_trabalho': Wt, 'altura_trabalho': Ht,
        'luminancia_media': round(float(luminancia(vazio).mean()), 4), 'slots': slots,
        'qualidade': {'aprovado': bool(aprovado), 'diferenca': round(dif_branco, 3), 'limite': 2.0, 'metodo': 'ia: design branco devolve o papel da cena; cantos ' + fonte,
                      'enchimento': enchimentos, 'motivo': None if aprovado else f'a conta com design branco erra {dif_branco:.1f}', 'avisos': avisos},
        'bytes': tam, 'segundos': round(time.time() - t0, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cenas', default=os.path.join(PADRAO_TRABALHO, 'ia'))
    ap.add_argument('--trabalho', default=PADRAO_TRABALHO)
    ap.add_argument('--so', default='')
    a = ap.parse_args()
    lista = cenas()
    registro = {}
    rp = os.path.join(a.cenas, 'cenas.json')
    if os.path.exists(rp):
        registro = json.load(open(rp, encoding='utf-8')).get('cenas', {})
    qp = os.path.join(AQUI, 'quads-ia.json')
    quads = json.load(open(qp, encoding='utf-8'))['cenas'] if os.path.exists(qp) else {}
    so = {x for x in a.so.split(',') if x}
    cat_path = os.path.join(a.trabalho, 'catalogo-ia.json')
    catalogo = json.load(open(cat_path, encoding='utf-8')) if os.path.exists(cat_path) else {'versao': 1, 'itens': [], 'revisao': []}
    for ident, c in lista.items():
        if so and ident not in so:
            continue
        png = os.path.join(a.cenas, ident + '.png')
        if not os.path.exists(png):
            print(ident, ': cena ainda não gerada', flush=True)
            continue
        c = dict(c)
        c['modelo'] = (registro.get(ident) or {}).get('modelo')
        pasta = os.path.join(a.trabalho, 'saida', ident)
        try:
            meta = processar(c, png, pasta, quads)
        except Exception as e:  # registra e segue
            meta = {'id': ident, 'qualidade': {'aprovado': False, 'motivo': f'erro: {type(e).__name__}: {e}'[:300]}}
        os.makedirs(pasta, exist_ok=True)
        json.dump(meta, open(os.path.join(pasta, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
        catalogo['itens'] = [i for i in catalogo['itens'] if i['id'] != ident]
        catalogo['revisao'] = [i for i in catalogo['revisao'] if i['id'] != ident]
        if meta['qualidade'].get('aprovado'):
            catalogo['itens'].append(meta)
        else:
            catalogo['revisao'].append({'id': ident, 'motivo': meta['qualidade'].get('motivo')})
        q = meta['qualidade']
        print(f"{ident}: {'APROVADO' if q.get('aprovado') else 'REVISÃO'} {q.get('diferenca', '')} {q.get('motivo') or ''} {q.get('enchimento', '')}", flush=True)
    catalogo['gerado_em'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    json.dump(catalogo, open(cat_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print(f"catálogo de IA: {len(catalogo['itens'])} aprovados, {len(catalogo['revisao'])} na revisão", flush=True)


if __name__ == '__main__':
    main()
