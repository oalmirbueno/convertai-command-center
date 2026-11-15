#!/usr/bin/env python3
"""Prova da guarda de material no painel, usando o cliente interno da própria Aceleriq (não toca em cliente de fora).
Cria uma imagem de teste e uma ficha numa pasta temporária e roda o script da Clio apontando para ela.
Uso (root): python3 prova_guardar.py <client_id> [project_id]   -> imprime o id do arquivo criado (para arquivar depois).
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

client_id = sys.argv[1]
project_id = sys.argv[2] if len(sys.argv) > 2 else None
d = tempfile.mkdtemp(prefix="clio-prova-")
img = os.path.join(d, "orig.jpg")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=640x480", "-frames:v", "1", img], check=True)
h = hashlib.sha256(open(img, "rb").read()).hexdigest()
os.rename(img, os.path.join(d, h + ".jpg"))
msg = "TESTE-GUARDA-%d" % int(time.time())
json.dump({"mensagem_id": msg, "arquivo": h + ".jpg", "tipo": "imagem", "mime": "image/jpeg", "nome": None, "bytes": os.path.getsize(os.path.join(d, h + ".jpg")), "hash": h,
           "client_id": client_id, "cliente": "Aceleriq (prova)", "project_id": project_id, "quando": time.strftime("%Y-%m-%dT%H:%M"), "de": "Prova da Clio", "legenda": "arquivo de teste, pode arquivar",
           "descricao": "Imagem de teste com barras coloridas."}, open(os.path.join(d, msg + ".json"), "w"))
env = dict(os.environ, CLIO_MIDIA_DIR=d)
r = subprocess.run([sys.executable, "/root/.hermes/profiles/clio/scripts/clio_guardar_materiais.py"], env=env, capture_output=True, text=True)
print("saida:", r.stdout.strip())
print("registro:", r.stderr.strip()[-600:])
for n in sorted(os.listdir(d)):
    print(" ", n, open(os.path.join(d, n)).read()[:300] if n.endswith((".guardado", ".tentativas", ".desistiu")) else "")
