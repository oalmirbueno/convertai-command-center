#!/usr/bin/env python3
"""Prova do caminho da mídia sem tocar em cliente: registra uma mensagem de teste num grupo que NÃO existe na lista
(fica sem cliente, em revisão), manda uma imagem gerada aqui para o fluxo "entender imagens e vídeos" e mostra a
descrição que voltou. Depois é só apagar a linha de teste no banco. Não imprime o segredo.
Uso (root, no servidor): python3 prova_midia.py
"""
import base64
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = "https://blue-fly-822772.hostingersite.com/webhook/"
SEGREDO = open("/etc/aceleriq-leitor-grupos/webhook.segredo", encoding="utf-8").read().strip()
PROVEDOR = "baileys_3429"
MSG = "TESTE-MIDIA-%d" % int(time.time())


def postar(caminho, corpo):
    req = urllib.request.Request(BASE + caminho, data=json.dumps(corpo).encode("utf-8"), method="POST", headers={
        "content-type": "application/json", "x-acq-segredo": SEGREDO, "x-acq-carimbo": str(int(time.time())), "x-provedor": PROVEDOR, "user-agent": "aceleriq-prova/1"})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


with tempfile.TemporaryDirectory() as d:
    img = d + "/t.jpg"
    desenho = ("color=c=0x8a1c1c:s=1080x1350,drawtext=text='BLACK DO FRANGO':fontcolor=white:fontsize=96:x=(w-tw)/2:y=300,"
               "drawtext=text='Frango assado R$ 39,90':fontcolor=yellow:fontsize=72:x=(w-tw)/2:y=600,"
               "drawtext=text='So neste sabado 14/11':fontcolor=white:fontsize=56:x=(w-tw)/2:y=820")
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", desenho, "-frames:v", "1", img])
    if r.returncode != 0:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=640x480", "-frames:v", "1", img], check=True)
    dados = open(img, "rb").read()

corpo_msg = {"provedor": PROVEDOR, "mensagem": {"id": MSG, "grupo": "000000000000000000@g.us", "de": "5500000000000", "em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "tipo": "imagem", "texto": None, "media_id": MSG, "de_mim": False, "nome": "Teste", "resposta_a": None}}
import hashlib
h = hashlib.sha256(dados).hexdigest()
midia = {"provedor": PROVEDOR, "midia": {"mensagem_id": MSG, "tipo": "imagem", "mime": "image/jpeg", "hash": h, "bytes": len(dados), "imagens": [base64.b64encode(dados).decode("ascii")]}}

print("antes da mensagem existir:", postar("acq12-midia", midia)[0], "(esperado 409)")
print("mensagem de teste:", postar("acq04-mensagens", corpo_msg))
time.sleep(3)
st, txt = postar("acq12-midia", midia)
print("descrever:", st, txt[:1500])
st, txt = postar("acq12-midia", midia)
print("repetida (não gasta modelo de novo):", st, json.loads(txt).get("novo") if st == 200 else txt[:200])
print("id da mensagem de teste:", MSG)
