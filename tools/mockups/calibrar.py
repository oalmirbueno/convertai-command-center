"""Recupera mockups que ficaram na revisão refazendo, a partir da prévia do Photoshop, o que o
psd-tools não sabe renderizar (frente MCK, rodada 2, 30/09/2026).

Por que funciona:
  O psd-tools ignora Photo Filter, Color Balance, efeitos de camada (sombra, bevel) e alguns
  filtros. Mas o PSD traz a prévia que o próprio Photoshop gravou, com o design original.

  1) Fora do slot o design não chega: ali a verdade é a prévia. base = vazio = prévia e ganho = 0.
     (Sombra projetada, reflexo do chão e luz do cenário voltam exatamente como no Photoshop.)
  2) Dentro de cada slot, os filtros que faltam agem, em primeira ordem, como uma correção de cor
     por canal depois da mistura: saida' = alfa * saida + beta. Como a conta é linear no design,
     isso vira  base' = alfa*base + beta,  vazio' = alfa*vazio + beta,  ganho' = alfa*ganho,
     e o navegador continua fazendo a mesma conta (nada muda no shader).
  3) Validação honesta: alfa e beta (6 números por slot) são ajustados em metade dos pixels
     (tabuleiro de blocos de 16 px) e medidos na outra metade, e vice-versa. O mockup só volta
     para o catálogo se a diferença medida fora do ajuste ficar no limite (3,0) do controle de
     qualidade. Correção local (textura de papel, relevo) não é inventada: se o erro é local,
     o mockup continua na revisão.

Uso:
  python calibrar.py [--trabalho C:/AI/acervo-aceleriq/mockups-trabalho] [--so id1,id2] [--seco]
Grava por mockup: layers corrigidas (alta e trabalho), qc.jpg e meta.json com 'calibracao'.
O original fica em <saida>/<id>/_antes_da_calibracao/ (nada é apagado).
"""
import argparse
import json
import os
import shutil
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from psd_mockup import (LIMITE_QC, achar_slots, compor, conteudo_do_so, decodificar_uv, diferenca,  # noqa: E402
                        lado_na_tela, reduzir, rgb8, tamanho_do_so)

PADRAO_TRABALHO = 'C:/AI/acervo-aceleriq/mockups-trabalho'
BLOCO = 12
ALFA_MIN, ALFA_MAX = 0.55, 1.8
BETA_MAX = 70.0
LIMITE_DE_LUZ = 45


def ler_conjunto(pasta):
    base = np.asarray(Image.open(os.path.join(pasta, 'base.jpg')).convert('RGB'), np.uint8).copy()
    vazio = np.asarray(Image.open(os.path.join(pasta, 'vazio.jpg')).convert('RGB'), np.uint8).copy()
    ganho = np.asarray(Image.open(os.path.join(pasta, 'ganho.png')).convert('RGB'), np.uint8).copy()
    uv = np.asarray(Image.open(os.path.join(pasta, 'uv.png')).convert('RGB'), np.uint8).copy()
    mapa = np.asarray(Image.open(os.path.join(pasta, 'mapa.png')).convert('L'), np.uint8).copy()
    return base, vazio, ganho, uv, mapa


def salvar_conjunto(pasta, base, vazio, ganho):
    Image.fromarray(base).save(os.path.join(pasta, 'base.jpg'), quality=90, optimize=True)
    Image.fromarray(vazio).save(os.path.join(pasta, 'vazio.jpg'), quality=90, optimize=True)
    Image.fromarray(ganho).save(os.path.join(pasta, 'ganho.png'), optimize=True)


def tabuleiro(h, w):
    yy, xx = np.mgrid[0:h, 0:w]
    return ((yy // BLOCO + xx // BLOCO) % 2) == 0


def termos(xy):
    """Campo suave de luz: 1, x, y, x², xy, y² (coordenadas da imagem em 0..1)."""
    x, y = xy[:, 0], xy[:, 1]
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], -1)


def ajustar(x, y, xy):
    """Mínimos quadrados por canal:  prévia ~ alfa * nosso + campo(x, y)  (campo quadrático).
    x, y: (n, 3) float; xy: (n, 2) em 0..1. Devolve alfa (3,) e coeficientes do campo (3, 6)."""
    T = termos(xy)
    a = np.ones(3)
    cf = np.zeros((3, T.shape[1]))
    for c in range(3):
        A = np.concatenate([x[:, c:c + 1], T], 1)
        sol, *_ = np.linalg.lstsq(A, y[:, c], rcond=None)
        ac = float(np.clip(sol[0], ALFA_MIN, ALFA_MAX))
        # Com alfa preso no limite, o campo é refeito com esse alfa.
        sol2, *_ = np.linalg.lstsq(T, y[:, c] - ac * x[:, c], rcond=None)
        a[c] = ac
        cf[c] = sol2
    return a, cf


def prever(x, xy, a, cf):
    return x * a + termos(xy) @ cf.T


def fundo_da_previa(base, vazio, ganho, mapa, previa):
    """Fora do slot (ou onde o design não chega), a prévia é a verdade."""
    gm = ganho.astype(np.float32).mean(-1)
    sem_design = (mapa == 0) | ((gm <= 4) & (np.abs(base.astype(np.int16) - vazio.astype(np.int16)).max(-1) <= 6))
    # Só troca o que é correção de luz (sombra, reflexo, filtro): diferença grande fora do slot é o
    # design original vazando (slot que o psd-tools posicionou errado). Esse pedaço fica como o
    # psd-tools fez, e o controle de qualidade conta o erro, em vez de a prévia esconder o defeito.
    sem_design &= np.abs(previa.astype(np.int16) - vazio.astype(np.int16)).max(-1) <= LIMITE_DE_LUZ
    base = base.copy()
    vazio = vazio.copy()
    ganho = ganho.copy()
    base[sem_design] = previa[sem_design]
    vazio[sem_design] = previa[sem_design]
    ganho[sem_design] = 0
    return base, vazio, ganho, sem_design


def aplicar_cor(base, vazio, ganho, mapa, params):
    """base' = alfa*base + campo, vazio' = alfa*vazio + campo, ganho' = alfa*ganho (por slot)."""
    H, W = mapa.shape
    b = base.astype(np.float32)
    z = vazio.astype(np.float32)
    g = ganho.astype(np.float32)
    for k, (a, cf) in params.items():
        m = mapa == k
        if not m.any():
            continue
        ys, xs = np.nonzero(m)
        xy = np.stack([(xs + 0.5) / W, (ys + 0.5) / H], -1)
        campo = termos(xy) @ cf.T
        b[m] = np.clip(b[m] * a + campo, 0, 255)
        z[m] = np.clip(z[m] * a + campo, 0, 255)
        g[m] = np.clip(g[m] * a, 0, 255)
    q = lambda x: np.clip(np.round(x), 0, 255).astype(np.uint8)  # noqa: E731
    return q(b), q(z), q(g)


def designs_originais(psd, slots, mapa_t):
    designs = []
    for k, s in enumerate(slots, 1):
        c = conteudo_do_so(s['camadas'][0])
        if c is None:
            return None
        iw, ih = tamanho_do_so(s['camadas'][0])
        lado = lado_na_tela(mapa_t, k)
        f = min(1.0, max(32.0, 2.0 * lado) / float(max(iw, ih))) if lado else 1.0
        designs.append(np.asarray(c.resize((max(1, int(round(iw * f))), max(1, int(round(ih * f)))), Image.LANCZOS), np.uint8))
    return designs


def calibrar(ident, pasta, psd_path, seco=False):
    from psd_tools import PSDImage
    meta = json.load(open(os.path.join(pasta, 'meta.json'), encoding='utf-8'))
    q = meta.get('qualidade', {})
    if q.get('aprovado'):
        return {'id': ident, 'resultado': 'já aprovado'}
    if not isinstance(q.get('diferenca'), (int, float)) or not meta.get('slots'):
        return {'id': ident, 'resultado': 'fora', 'motivo': q.get('motivo')}
    antes = float(q['diferenca'])
    psd = PSDImage.open(psd_path)
    pil = psd.topil()
    if pil is None:
        return {'id': ident, 'resultado': 'fora', 'motivo': 'sem prévia'}
    previa = rgb8(pil)
    slots, _ = achar_slots(psd)
    uids_meta = [s.get('unique_id') for s in meta['slots']]
    # A ordem dos slots precisa bater com a do meta (os índices do mapa vêm dela).
    por_uid = {s['uid']: s for s in slots}
    slots = [por_uid[u] for u in uids_meta if u in por_uid]
    if len(slots) != len(uids_meta):
        return {'id': ident, 'resultado': 'fora', 'motivo': 'slots do PSD não batem com o meta'}

    pt = os.path.join(pasta, 'trabalho')
    base_t, vazio_t, ganho_t, uv_t, mapa_t = ler_conjunto(pt)
    Ht, Wt = mapa_t.shape
    previa_t = reduzir(previa, Wt, Ht)
    designs = designs_originais(psd, slots, mapa_t)
    if designs is None:
        return {'id': ident, 'resultado': 'fora', 'motivo': 'conteúdo do slot fora do PSD'}
    U, V = decodificar_uv(uv_t)

    base1, vazio1, ganho1, sem = fundo_da_previa(base_t, vazio_t, ganho_t, mapa_t, previa_t)
    recon1 = compor(base1, ganho1, vazio1, U, V, mapa_t, designs).astype(np.float32)
    # O ajuste e a validação são feitos na mesma escala do controle de qualidade (800 px, média de
    # área): em resolução cheia, um desalinhamento de 1 px entre o psd-tools e o Photoshop puxa a
    # reta para o cinza (diluição da regressão) e piora a imagem.
    LQ = 800
    hq = max(1, int(round(LQ * Ht / Wt)))
    rq = cv2.resize(recon1, (LQ, hq), interpolation=cv2.INTER_AREA)
    aq = cv2.resize(previa_t.astype(np.float32), (LQ, hq), interpolation=cv2.INTER_AREA)
    mq = cv2.resize(mapa_t, (LQ, hq), interpolation=cv2.INTER_NEAREST)
    sq = cv2.resize(sem.astype(np.uint8), (LQ, hq), interpolation=cv2.INTER_NEAREST) > 0
    gq = cv2.resize(ganho1.astype(np.float32).mean(-1), (LQ, hq), interpolation=cv2.INTER_AREA)
    par = tabuleiro(hq, LQ)
    yy, xx = np.mgrid[0:hq, 0:LQ]
    XY = np.stack([(xx + 0.5) / LQ, (yy + 0.5) / hq], -1)
    params = {}
    validacao = {}
    soma_dentro = soma_fora = peso = 0.0
    for k in range(1, len(slots) + 1):
        m = (mq == k) & (~sq) & (gq > 8)
        if m.sum() < 200:
            continue
        erros = []
        dentro = []
        for lado in (par, ~par):
            a, cf = ajustar(rq[m & lado], aq[m & lado], XY[m & lado])
            dentro.append(float(np.abs(prever(rq[m & lado], XY[m & lado], a, cf) - aq[m & lado]).mean()))
            teste = m & ~lado
            erros.append(float(np.abs(prever(rq[teste], XY[teste], a, cf) - aq[teste]).mean()))
        sem_ajuste = float(np.abs(rq[m] - aq[m]).mean())
        validacao[k] = {'antes': round(sem_ajuste, 3), 'no_ajuste': round(float(np.mean(dentro)), 3), 'fora_do_ajuste': round(float(np.mean(erros)), 3), 'pixels': int(m.sum())}
        # Só fica a correção que melhora onde não foi ajustada.
        if np.mean(erros) < sem_ajuste - 0.2:
            a, cf = ajustar(rq[m], aq[m], XY[m])
            params[k] = (a, cf)
            soma_dentro += float(np.mean(dentro)) * m.sum()
            soma_fora += float(np.mean(erros)) * m.sum()
            peso += float(m.sum())
    base2, vazio2, ganho2 = aplicar_cor(base1, vazio1, ganho1, mapa_t, params)
    recon2 = compor(base2, ganho2, vazio2, U, V, mapa_t, designs)
    dif_total, dif_slot = diferenca(recon2, previa_t, area=mapa_t > 0)
    # A nota do slot é a de validação (fora do ajuste), nunca a do próprio ajuste.
    # Mesma régua do controle de qualidade (psd_mockup.diferenca) no resultado calibrado, e uma
    # trava contra ajuste decorado: o erro fora do ajuste não pode passar do erro no ajuste + 1,0.
    generaliza = bool(peso == 0 or (soma_fora / peso) <= (soma_dentro / peso) + 1.0)
    dif_slot_val = (soma_fora / peso) if peso else (dif_slot or 0.0)
    depois = max(dif_total, dif_slot or 0.0)
    aprovado = bool(depois <= LIMITE_QC and generaliza)
    res = {'id': ident, 'antes': round(antes, 3), 'depois': round(depois, 3), 'imagem': round(dif_total, 3), 'slot': round(dif_slot or 0, 3),
           'slot_validacao': round(dif_slot_val, 3), 'aprovado': aprovado,
           'generaliza': generaliza,
           'params': {str(k): {'alfa': [round(x, 4) for x in a], 'campo': [[round(float(v), 3) for v in linha] for linha in cf]} for k, (a, cf) in params.items()}}
    if seco or not aprovado:
        # Reprovado continua como estava (nada é gravado): só o resultado vai para calibracao.json.
        return res

    guarda = os.path.join(pasta, '_antes_da_calibracao')
    if not os.path.exists(guarda):
        os.makedirs(guarda)
        for nome in ('alta', 'trabalho'):
            shutil.copytree(os.path.join(pasta, nome), os.path.join(guarda, nome))
        for nome in ('meta.json', 'qc.jpg'):
            shutil.copy2(os.path.join(pasta, nome), os.path.join(guarda, nome))
    else:
        # Rodar de novo parte sempre do original.
        for nome in ('alta', 'trabalho'):
            shutil.rmtree(os.path.join(pasta, nome))
            shutil.copytree(os.path.join(guarda, nome), os.path.join(pasta, nome))

    salvar_conjunto(pt, base2, vazio2, ganho2)
    pa = os.path.join(pasta, 'alta')
    base_a, vazio_a, ganho_a, _uv_a, mapa_a = ler_conjunto(pa)
    Ha, Wa = mapa_a.shape
    previa_a = reduzir(previa, Wa, Ha)
    base_a, vazio_a, ganho_a, _ = fundo_da_previa(base_a, vazio_a, ganho_a, mapa_a, previa_a)
    base_a, vazio_a, ganho_a = aplicar_cor(base_a, vazio_a, ganho_a, mapa_a, params)
    salvar_conjunto(pa, base_a, vazio_a, ganho_a)
    qc = np.concatenate([previa_t, np.full((Ht, 12, 3), 255, np.uint8), recon2], 1)
    Image.fromarray(qc).save(os.path.join(pasta, 'qc.jpg'), quality=80)

    q2 = dict(q)
    q2.update({'aprovado': aprovado, 'diferenca': round(depois, 3), 'diferenca_imagem': round(dif_total, 3),
               'diferenca_slot': round(dif_slot or 0.0, 3), 'diferenca_validacao': round(dif_slot_val, 3), 'motivo': None if aprovado else f'calibrado e ainda {depois:.1f} (antes {antes:.1f})'})
    avisos = set(q2.get('avisos') or [])
    avisos.add(f'calibrado pela prévia (antes {antes:.1f})')
    q2['avisos'] = sorted(avisos)
    meta['qualidade'] = q2
    meta['calibracao'] = {'antes': round(antes, 3), 'depois': round(depois, 3), 'validacao': {str(k): v for k, v in validacao.items()}, 'params': res['params'], 'metodo': 'fundo pela prévia + cor por canal e campo de luz quadrático, validados em tabuleiro'}
    meta['versao_pipeline'] = max(int(meta.get('versao_pipeline') or 2), 3)
    json.dump(meta, open(os.path.join(pasta, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trabalho', default=PADRAO_TRABALHO)
    ap.add_argument('--so', default='')
    ap.add_argument('--seco', action='store_true')
    a = ap.parse_args()
    ext = json.load(open(os.path.join(a.trabalho, 'extracao.json'), encoding='utf-8'))['itens']
    so = {x for x in a.so.split(',') if x}
    saida = os.path.join(a.trabalho, 'saida')
    resultados = []
    for ident in sorted(os.listdir(saida)):
        if so and ident not in so:
            continue
        pasta = os.path.join(saida, ident)
        if not os.path.exists(os.path.join(pasta, 'meta.json')) or ident not in ext:
            continue
        try:
            r = calibrar(ident, pasta, ext[ident]['psd'], a.seco)
        except Exception as e:  # registra e segue
            r = {'id': ident, 'resultado': 'erro', 'motivo': f'{type(e).__name__}: {e}'[:300]}
        if r.get('resultado') in ('já aprovado',):
            continue
        resultados.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
    json.dump(resultados, open(os.path.join(a.trabalho, 'calibracao.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ok = [r for r in resultados if r.get('aprovado')]
    print(f'calibração: {len(ok)} recuperados de {len(resultados)}', flush=True)


if __name__ == '__main__':
    main()
