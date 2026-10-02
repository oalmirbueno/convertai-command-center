"""
Render na nuvem pela Modal (02/10/2026).

O PC da agência é fraco para render. Aqui roda o MESMO worker de
workers/render (Remotion, HyperFrames, ffmpeg) numa máquina forte que só liga
quando há pedido e sai sozinha com a fila vazia (RENDER_SAIR_OCIOSO_S), então
só se paga o tempo de render.

- acordar: o banco chama na hora em que entra pedido (gatilho
  render_pedidos_acordar_nuvem, cabeçalho x-aceleriq-segredo);
- vigia: a cada minuto, se houver pedido esperando há mais de 20 s (aviso
  perdido), liga o processar;
- processar: o worker com o nome "nuvem-render". O banco reserva os pedidos
  novos para ele por 75 s; se a nuvem falhar, o PC assume.

Segredos (Modal Secret "aceleriq-render", nunca em arquivo do repositório):
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e RENDER_NUVEM_SEGREDO.

Publicar (da raiz de um clone limpo):  python -m modal deploy workers/render-nuvem/app.py
"""

import hmac
import json
import os
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import modal
from fastapi import Header, HTTPException

RAIZ = Path(__file__).resolve().parent.parent.parent
APP = "/app"
DEPS = "/deps"
NUCLEOS = 8.0  # núcleos físicos da Modal (16 vCPU)
VERSAO_DO_CHROME = "152.0.7928.2"
CHROME = "/opt/chrome-headless-shell-linux64/chrome-headless-shell"

ignorar = ["**/node_modules/**", "**/.git/**", "**/tmp/**", "**/dist/**", "**/.env*", "**/testes/**"]

imagem = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "curl", "unzip", "ca-certificates", "ffmpeg", "fonts-noto-core", "fonts-noto-color-emoji", "fonts-liberation",
        # Chrome Headless Shell do Remotion e do HyperFrames no Debian (docs do Remotion: Linux dependencies)
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libgbm-dev", "libasound2", "libxrandr2", "libxkbcommon-dev",
        "libxfixes3", "libxcomposite1", "libxdamage1", "libatk-bridge2.0-0", "libpango-1.0-0", "libcairo2", "libcups2",
    )
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs && node --version")
    # Dependências primeiro (camada em cache enquanto o package-lock não muda).
    .add_local_file(RAIZ / "workers/render/package.json", f"{DEPS}/package.json", copy=True)
    .add_local_file(RAIZ / "workers/render/package-lock.json", f"{DEPS}/package-lock.json", copy=True)
    # Chrome Headless Shell oficial (a mesma versão que o Remotion 4.0.529 pede), baixado direto:
    # o "remotion browser ensure" travou em 100% no build da Modal (02/10). Remotion e HyperFrames usam este.
    .run_commands(
        f"curl -fsSL -o /tmp/chs.zip https://storage.googleapis.com/chrome-for-testing-public/{VERSAO_DO_CHROME}/linux64/chrome-headless-shell-linux64.zip"
        " && unzip -q /tmp/chs.zip -d /opt && rm /tmp/chs.zip"
        f" && {CHROME} --version",
    )
    .env({"RENDER_CHROME": CHROME, "PRODUCER_HEADLESS_SHELL_PATH": CHROME})
    .run_commands(f"cd {DEPS} && npm ci --no-audit --no-fund --loglevel=error")
    # O app.py é importado em todo contêiner; o FastAPI (do acordar) tem de existir aqui também.
    .pip_install("fastapi[standard]")
    # O código: os workers importam por caminho relativo de src/ e supabase/functions/.
    .add_local_dir(RAIZ / "workers/render", f"{APP}/workers/render", copy=True, ignore=ignorar)
    .add_local_dir(RAIZ / "workers/supervisor", f"{APP}/workers/supervisor", copy=True, ignore=ignorar)
    .add_local_dir(RAIZ / "src", f"{APP}/src", copy=True, ignore=ignorar)
    .add_local_dir(RAIZ / "supabase/functions", f"{APP}/supabase/functions", copy=True, ignore=ignorar)
    # Fontes livres e sons do editor (o worker copia de public/editor; sem isto o render final dava ENOENT, 02/10).
    .add_local_dir(RAIZ / "public/editor", f"{APP}/public/editor", copy=True)
    .run_commands(f"ln -sfn {DEPS}/node_modules {APP}/workers/render/node_modules")
)

leve = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")

app = modal.App("aceleriq-render")
segredos = modal.Secret.from_name("aceleriq-render")


@app.function(image=imagem, secrets=[segredos], cpu=NUCLEOS, memory=16384, timeout=3600, max_containers=3)
def processar() -> int:
    env = {
        **os.environ,
        "RENDER_WORKER_NOME": "nuvem-render",
        "RENDER_SAIR_OCIOSO_S": "20",
        "RENDER_CONCORRENCIA": str(int(NUCLEOS * 2)),
        "RENDER_PASTA": "/tmp/aceleriq-render",
    }
    env.pop("RENDER_NUVEM_SEGREDO", None)
    r = subprocess.run(["node", "principal.ts"], cwd=f"{APP}/workers/render", env=env)
    return r.returncode


@app.function(image=leve, secrets=[segredos], cpu=0.25, memory=256)
@modal.fastapi_endpoint(method="POST", docs=False)
def acordar(x_aceleriq_segredo: str = Header(default="")):
    esperado = os.environ.get("RENDER_NUVEM_SEGREDO", "")
    if not esperado or not hmac.compare_digest(x_aceleriq_segredo.encode(), esperado.encode()):
        raise HTTPException(status_code=401, detail="não autorizado")
    processar.spawn()
    return {"ok": True}


def _pedido_esperando(idade_s: int) -> bool:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    antes = (datetime.now(timezone.utc) - timedelta(seconds=idade_s)).isoformat().replace("+00:00", "Z")
    q = f"{url}/rest/v1/render_pedidos?select=id&estado=eq.fila&criado_em=lt.{antes}&limit=1"
    req = urllib.request.Request(q, headers={"apikey": chave, "Authorization": f"Bearer {chave}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return len(json.loads(r.read() or b"[]")) > 0


@app.function(image=leve, secrets=[segredos], cpu=0.25, memory=256, schedule=modal.Period(minutes=1))
def vigia():
    if _pedido_esperando(20):
        processar.spawn()
