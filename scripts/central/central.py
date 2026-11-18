#!/usr/bin/env python3
"""Central de Skills Aceleriq: cliente de sincronização (só biblioteca padrão).

Uma Central no painel guarda as skills de todos os agentes. Este cliente, em
qualquer máquina (Windows, Linux, macOS):

  sync      sobe as skills criadas ou mudadas aqui e baixa as novas/atualizadas
            para cada agente instalado (Claude Code, Codex, Hermes, ~/.agents).
  instalar  sync + sincronização automática (a cada 30 min e no início de cada
            sessão do Claude Code) + o aviso da Central nas instruções globais.
  status    o que tem aqui e o que está diferente da Central.

Regra de conflito: vence a versão mais nova (como o claude-sync). Nada local é
apagado sem estar na Central; a versão anterior de cada skill fica na Central.
A chave vem de ACELERIQ_CENTRAL_TOKEN (ou ~/.aceleriq/token) e nunca é gravada
em log.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

VERSAO = "1.0.0"
BASE = os.environ.get(
    "ACELERIQ_CENTRAL_URL",
    "https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/central-skills",
)
HOME = Path.home()
PASTA = HOME / ".aceleriq"
ESTADO = PASTA / "central-estado.json"
LOG = PASTA / "central.log"
TRAVA = PASTA / "central.lock"

IGNORAR_PASTAS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", ".curator_backups", ".hub",
    ".archive", ".cache", ".next", "dist", "build", ".pytest_cache", ".mypy_cache", "synced",
}
IGNORAR_ARQUIVO = re.compile(
    r"(^\.env(\..*)?$|\.(pem|key|p12|pfx|log|lock|pyc)$|^id_(rsa|ed25519|ecdsa)|credentials.*\.json$|token(s)?\.json$|^\.DS_Store$|^Thumbs\.db$)",
    re.I,
)
EXT_TEXTO = {
    ".md", ".txt", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml",
    ".sh", ".ps1", ".toml", ".html", ".css", ".csv", ".xml", ".ini", ".cfg",
}
SEGREDOS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bmcp_live_[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),
]
MAX_ARQUIVO = 15 * 1024 * 1024
MAX_PACOTE = 44 * 1024 * 1024

SILENCIOSO = False


# ─── utilidades ──────────────────────────────────────────────────

def agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    linha = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    if not SILENCIOSO:
        print(msg, flush=True)
    try:
        PASTA.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 1_000_000:
            LOG.write_text("", encoding="utf-8")
        with LOG.open("a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def token() -> str:
    t = os.environ.get("ACELERIQ_CENTRAL_TOKEN", "").strip()
    if not t and sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                t = str(winreg.QueryValueEx(k, "ACELERIQ_CENTRAL_TOKEN")[0]).strip()
        except OSError:
            t = ""
    if not t and (PASTA / "token").exists():
        t = (PASTA / "token").read_text(encoding="utf-8").strip()
    if not t:
        raise SystemExit("Sem chave: defina ACELERIQ_CENTRAL_TOKEN (chave mcp_live_ com memory:read e memory:write).")
    return t


def maquina() -> str:
    arquivo = PASTA / "maquina"
    fixo = arquivo.read_text(encoding="utf-8").strip() if arquivo.exists() else ""
    return (
        os.environ.get("ACELERIQ_MAQUINA")
        or fixo
        or os.environ.get("SECOND_BRAIN_MACHINE_NAME")
        or platform.node()
        or "maquina"
    )[:80]


def normalizar_slug(valor: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", str(valor or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").strip().lower()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    return re.sub(r"^[-._]+|[-._]+$", "", s)[:80]


def frontmatter(md: str) -> dict:
    m = re.match(r"^﻿?---\r?\n(.*?)\r?\n---", md or "", re.S)
    if not m:
        return {}
    out = {}
    linhas = m.group(1).splitlines()
    i = 0
    while i < len(linhas):
        r = re.match(r"^(name|description):\s*(.*)$", linhas[i])
        if r:
            v = r.group(2).strip()
            if re.match(r"^[>|][-+]?$", v):
                partes = []
                i += 1
                while i < len(linhas) and (linhas[i].startswith((" ", "\t")) or not linhas[i].strip()):
                    partes.append(linhas[i].strip())
                    i += 1
                v = " ".join(p for p in partes if p)
                i -= 1
            out[r.group(1)] = v.strip().strip("'\"")
        i += 1
    return out


def tem_segredo(texto: str) -> bool:
    return any(p.search(texto) for p in SEGREDOS)


def http(metodo: str, url: str, corpo=None, cabecalhos=None, dados: bytes | None = None, tempo=60):
    cab = {"User-Agent": f"aceleriq-central/{VERSAO}"}
    if cabecalhos:
        cab.update(cabecalhos)
    if corpo is not None:
        dados = json.dumps(corpo).encode("utf-8")
        cab["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cab)
    try:
        with urllib.request.urlopen(req, timeout=tempo) as r:
            bruto = r.read()
            tipo = r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        bruto = e.read()
        try:
            msg = json.loads(bruto).get("erro")
        except Exception:
            msg = bruto[:300].decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {msg}") from None
    if "json" in tipo:
        return json.loads(bruto)
    return bruto


def central(metodo: str, consulta: str = "", corpo=None, tempo=90):
    url = BASE + (f"?{consulta}" if consulta else "")
    return http(metodo, url, corpo=corpo, cabecalhos={"Authorization": f"Bearer {token()}"}, tempo=tempo)


# ─── onde moram as skills ─────────────────────────────────────────

def pastas_dos_agentes() -> dict[str, Path]:
    """Só os agentes instalados nesta máquina (a pasta-mãe existe)."""
    cand = {
        "claude": HOME / ".claude" / "skills",
        "codex": Path(os.environ.get("CODEX_HOME", HOME / ".codex")) / "skills",
        "agents": HOME / ".agents" / "skills",
        "hermes": Path(os.environ.get("HERMES_HOME", HOME / ".hermes")) / "skills",
    }
    return {rt: p for rt, p in cand.items() if p.parent.exists()}


def arquivos_da_skill(raiz: Path) -> tuple[list[tuple[str, Path]], list[str]]:
    """Arquivos que entram no pacote e os que ficaram de fora (com motivo)."""
    dentro: list[tuple[str, Path]] = []
    fora: list[str] = []
    for pasta, subpastas, arquivos in os.walk(raiz, followlinks=True):
        subpastas[:] = sorted(d for d in subpastas if d not in IGNORAR_PASTAS and not d.startswith(".git"))
        for nome in sorted(arquivos):
            p = Path(pasta) / nome
            rel = p.relative_to(raiz).as_posix()
            if IGNORAR_ARQUIVO.search(nome):
                fora.append(f"{rel} (arquivo sensível ou temporário)")
                continue
            try:
                tam = p.stat().st_size
            except OSError:
                continue
            if tam > MAX_ARQUIVO:
                fora.append(f"{rel} (maior que 15 MB)")
                continue
            if p.suffix.lower() in EXT_TEXTO and tam < 2_000_000:
                try:
                    if tem_segredo(p.read_text(encoding="utf-8", errors="ignore")):
                        fora.append(f"{rel} (parece ter chave ou token)")
                        continue
                except OSError:
                    continue
            dentro.append((rel, p))
    # Cabe no pacote: tira a mídia mais pesada primeiro, nunca o SKILL.md.
    total = sum(p.stat().st_size for _, p in dentro)
    if total > MAX_PACOTE:
        for rel, p in sorted(dentro, key=lambda x: -x[1].stat().st_size):
            if total <= MAX_PACOTE:
                break
            if rel == "SKILL.md":
                continue
            total -= p.stat().st_size
            dentro.remove((rel, p))
            fora.append(f"{rel} (pacote passava de 44 MB)")
    return dentro, fora


def hash_da_skill(arquivos: list[tuple[str, Path]]) -> str:
    h = hashlib.sha256()
    for rel, p in sorted(arquivos):
        fh = hashlib.sha256()
        with p.open("rb") as f:
            for bloco in iter(lambda: f.read(1 << 20), b""):
                fh.update(bloco)
        h.update(f"{rel}\0{fh.hexdigest()}\n".encode())
    return h.hexdigest()


def achar_skills(raiz: Path):
    """Pastas com SKILL.md (não desce dentro de uma skill)."""
    if not raiz.exists():
        return
    for pasta, subpastas, arquivos in os.walk(raiz, followlinks=True):
        if "SKILL.md" in arquivos and Path(pasta) != raiz:
            subpastas[:] = []
            yield Path(pasta)
            continue
        subpastas[:] = sorted(d for d in subpastas if d not in IGNORAR_PASTAS and not d.startswith("."))


def ler_skill(pasta: Path, runtime: str, raiz: Path, plugin: str | None = None) -> dict | None:
    try:
        md = (pasta / "SKILL.md").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    fm = frontmatter(md)
    slug = normalizar_slug(fm.get("name") or pasta.name)
    if not slug:
        return None
    dentro, fora = arquivos_da_skill(pasta)
    if not any(rel == "SKILL.md" for rel, _ in dentro):
        log(f"  pulei {slug}: o SKILL.md parece ter chave ou token")
        return None
    mtime = max((p.stat().st_mtime for _, p in dentro), default=0)
    return {
        "slug": slug,
        "nome": fm.get("name") or pasta.name,
        "descricao": fm.get("description") or "",
        "pasta": pasta,
        "runtime": runtime,
        "relativo": pasta.relative_to(raiz).as_posix() if raiz in pasta.parents else pasta.name,
        "plugin": plugin,
        "md": md,
        "arquivos": dentro,
        "fora": fora,
        "hash": hash_da_skill(dentro),
        "mtime": mtime,
        "tamanho": sum(p.stat().st_size for _, p in dentro),
        "link": pasta.is_symlink(),
    }


def plugins_do_claude() -> tuple[dict[str, Path], dict[str, str]]:
    """plugin@marketplace → pasta instalada; marketplace → origem."""
    base = HOME / ".claude" / "plugins"
    instalados: dict[str, Path] = {}
    origens: dict[str, str] = {}
    try:
        d = json.loads((base / "installed_plugins.json").read_text(encoding="utf-8"))
        for nome, lista in (d.get("plugins", d) or {}).items():
            if isinstance(lista, list) and lista:
                p = lista[-1].get("installPath")
                if p and Path(p).exists():
                    instalados[nome] = Path(p)
    except (OSError, ValueError, AttributeError):
        pass
    try:
        m = json.loads((base / "known_marketplaces.json").read_text(encoding="utf-8"))
        for nome, info in (m or {}).items():
            src = (info or {}).get("source") or {}
            origens[nome] = src.get("repo") or src.get("url") or src.get("path") or nome
    except (OSError, ValueError, AttributeError):
        pass
    return instalados, origens


def indice_local() -> dict[str, dict[str, dict]]:
    """runtime → slug → skill lida desta máquina."""
    indice: dict[str, dict[str, dict]] = {}
    for rt, raiz in pastas_dos_agentes().items():
        indice[rt] = {}
        for pasta in achar_skills(raiz):
            s = ler_skill(pasta, rt, raiz)
            if s and s["slug"] not in indice[rt]:
                indice[rt][s["slug"]] = s
    instalados, _ = plugins_do_claude()
    if instalados:
        indice["claude-plugin"] = {}
        for nome, pasta in instalados.items():
            for sp in achar_skills(pasta / "skills"):
                s = ler_skill(sp, "claude-plugin", pasta, plugin=nome)
                if s and s["slug"] not in indice["claude-plugin"]:
                    indice["claude-plugin"][s["slug"]] = s
    return indice


def config() -> dict:
    """~/.aceleriq/central-config.json, ex.: {"hermes_tudo": true} instala tudo também no Hermes."""
    try:
        return json.loads((PASTA / "central-config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# ─── estado ──────────────────────────────────────────────────────

def ler_estado() -> dict:
    try:
        return json.loads(ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"skills": {}}


def gravar_estado(e: dict) -> None:
    PASTA.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO.with_suffix(".tmp")
    tmp.write_text(json.dumps(e, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ESTADO)


def ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0.0


# ─── subir ───────────────────────────────────────────────────────

def zipar(s: dict) -> Path:
    fd, nome = tempfile.mkstemp(prefix="aceleriq-central-", suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(nome, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel, p in s["arquivos"]:
            z.write(p, rel)
    return Path(nome)


def subir(s: dict, dry: bool) -> bool:
    if dry:
        log(f"  [simulação] subiria {s['slug']} ({s['runtime']})")
        return True
    prep = central("POST", corpo={"acao": "preparar", "slug": s["slug"], "hash": s["hash"]})
    pacote_path = None
    if not prep.get("igual"):
        z = zipar(s)
        try:
            dados = z.read_bytes()
            http("PUT", prep["upload_url"], dados=dados,
                 cabecalhos={"Content-Type": "application/zip", "x-upsert": "true"}, tempo=300)
        finally:
            z.unlink(missing_ok=True)
        pacote_path = prep["pacote_path"]
    origem = {"runtime": s["runtime"], "caminho": s["relativo"], "maquina": maquina()}
    if s.get("plugin"):
        origem["plugin"] = s["plugin"]
    r = central("POST", corpo={
        "acao": "publicar",
        "slug": s["slug"],
        "nome": s["nome"],
        "descricao": s["descricao"],
        "hash": s["hash"],
        "skill_md": s["md"],
        "tamanho_bytes": s["tamanho"],
        "arquivos": len(s["arquivos"]),
        "plugin": s.get("plugin"),
        "pacote_path": pacote_path,
        "origem": origem,
    })
    if r.get("mudou"):
        log(f"  ↑ {s['slug']} v{r.get('versao')} ({s['runtime']})" + (f", {len(s['fora'])} arquivo(s) de fora" if s["fora"] else ""))
    return True


# ─── baixar ──────────────────────────────────────────────────────

def pasta_destino(rt: str, raiz: Path, remoto: dict) -> Path:
    if rt == "hermes":
        return raiz / f"central-{remoto.get('categoria') or 'outros'}" / remoto["slug"]
    return raiz / remoto["slug"]


def instalar_pacote(url: str, destino: Path) -> None:
    fd, nome = tempfile.mkstemp(prefix="aceleriq-central-", suffix=".zip")
    os.close(fd)
    zipado = Path(nome)
    novo = destino.with_name(f"{destino.name}.central-novo-{os.getpid()}")
    try:
        zipado.write_bytes(http("GET", url, tempo=300))
        if novo.exists():
            shutil.rmtree(novo)
        with zipfile.ZipFile(zipado) as z:
            for membro in z.namelist():
                alvo = (novo / membro).resolve()
                if novo.resolve() not in alvo.parents and alvo != novo.resolve():
                    raise RuntimeError(f"caminho inválido no pacote: {membro}")
            z.extractall(novo)
        if destino.exists():
            shutil.rmtree(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        novo.replace(destino)
    finally:
        zipado.unlink(missing_ok=True)
        if novo.exists():
            shutil.rmtree(novo, ignore_errors=True)


# ─── conectores (plugins e MCP), sem segredo ─────────────────────

def conectores_locais() -> list[dict]:
    saida: list[dict] = []
    instalados, origens = plugins_do_claude()
    for nome, pasta in instalados.items():
        plugin, _, mkt = nome.partition("@")
        skills = [normalizar_slug(frontmatter((p / "SKILL.md").read_text(encoding="utf-8", errors="ignore")).get("name") or p.name)
                  for p in achar_skills(pasta / "skills")]
        saida.append({
            "slug": f"plugin:{nome}".lower(), "tipo": "plugin", "nome": plugin,
            "descricao": f"Plugin do Claude Code ({mkt}).",
            "instalar": {"claude": f"/plugin marketplace add {origens.get(mkt, mkt)}\n/plugin install {nome}"},
            "skills": skills,
        })
    servidores: dict[str, dict] = {}
    try:
        cfg = json.loads((HOME / ".claude.json").read_text(encoding="utf-8"))
        servidores.update(cfg.get("mcpServers") or {})
    except (OSError, ValueError):
        pass
    try:
        import tomllib
        cdx = tomllib.loads((Path(os.environ.get("CODEX_HOME", HOME / ".codex")) / "config.toml").read_text(encoding="utf-8"))
        for k, v in (cdx.get("mcp_servers") or {}).items():
            servidores.setdefault(k, v)
    except Exception:
        pass
    for nome, s in servidores.items():
        if not isinstance(s, dict):
            continue
        url = str(s.get("url") or "").split("?")[0]
        requer = sorted(set(list((s.get("env") or {}).keys()) + list((s.get("headers") or {}).keys())))
        if url:
            como = f"Streamable HTTP: {url}" + (f" (cabeçalhos: {', '.join(requer)})" if requer else "")
            claude = f"claude mcp add --transport http {nome} {url}"
        else:
            cmd = str(s.get("command") or "")
            pacote = next((a for a in (s.get("args") or []) if isinstance(a, str) and not a.startswith("-")
                           and not tem_segredo(a) and len(a) < 80 and "=" not in a and a not in ("/c", "npx", "-y")), "")
            como = f"STDIO: {cmd} {pacote}".strip()
            claude = f"claude mcp add {nome} -- {cmd} {pacote}".strip()
        if tem_segredo(como):
            continue
        tipo = "composio" if "composio" in nome.lower() or "composio" in url else "mcp"
        saida.append({
            "slug": f"mcp:{normalizar_slug(nome)}", "tipo": tipo, "nome": nome,
            "descricao": como,
            "instalar": {"claude": claude, "geral": como},
            "requer": [re.sub(r"[^A-Z0-9_]", "_", r.upper()) for r in requer],
        })
    return saida


# ─── sync ────────────────────────────────────────────────────────

def com_trava(fn):
    def envolvido(*a, **k):
        PASTA.mkdir(parents=True, exist_ok=True)
        if TRAVA.exists() and time.time() - TRAVA.stat().st_mtime < 1800:
            log("Outra sincronização está rodando; saio.")
            return 0
        TRAVA.write_text(str(os.getpid()), encoding="utf-8")
        try:
            return fn(*a, **k)
        finally:
            TRAVA.unlink(missing_ok=True)
    return envolvido


@com_trava
def sync(dry=False, so_subir=False, so_baixar=False, conectores=True) -> int:
    inicio = time.time()
    estado = ler_estado()
    vistos = estado.setdefault("skills", {})
    indice = indice_local()
    manifesto = central("GET", "acao=manifesto")
    remotas = {s["slug"]: s for s in manifesto.get("skills", [])}
    instalados, _ = plugins_do_claude()

    # 1) Subir: a cópia mais nova de cada slug nesta máquina.
    enviadas = 0
    melhores: dict[str, dict] = {}
    for rt, skills in indice.items():
        for slug, s in skills.items():
            atual = melhores.get(slug)
            if not atual or s["mtime"] > atual["mtime"]:
                melhores[slug] = s
    subiu: set[str] = set()
    if not so_baixar:
        for slug, s in sorted(melhores.items()):
            r = remotas.get(slug)
            if r and r["hash"] == s["hash"]:
                continue
            mudou_aqui = s["hash"] != vistos.get(slug, {}).get("hash")
            if r and (not mudou_aqui or s["mtime"] <= ts(r.get("atualizado_em", ""))):
                continue  # a Central está mais nova: o passo 2 baixa
            if r and r.get("status") == "arquivada":
                continue
            try:
                subir(s, dry)
                enviadas += 1
                subiu.add(slug)
                vistos[slug] = {"hash": s["hash"]}
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ não subiu {slug}: {e}")
        if not dry and subiu:
            manifesto = central("GET", "acao=manifesto")
            remotas = {s["slug"]: s for s in manifesto.get("skills", [])}

    # 2) Baixar para cada agente desta máquina.
    instaladas = 0
    if not so_subir:
        pendentes: list[tuple[str, Path, dict]] = []
        for slug, r in remotas.items():
            for rt, raiz in pastas_dos_agentes().items():
                if rt not in (r.get("runtimes") or []):
                    continue
                if rt == "claude" and r.get("plugin") and r["plugin"] in instalados:
                    continue  # no Claude ela já vem pelo plugin
                local = indice.get(rt, {}).get(slug)
                if local and local["hash"] == r["hash"]:
                    continue
                if not local and rt == "hermes" and not config().get("hermes_tudo"):
                    continue  # Hermes lista as skills em toda chamada: por padrão só atualiza as que já tem
                if local and local["link"]:
                    continue  # pasta ligada a outro sistema (ex.: ego-browser): não mexo
                if local and slug in subiu:
                    continue
                destino = local["pasta"] if local else pasta_destino(rt, raiz, r)
                pendentes.append((slug, destino, r))
        if pendentes and not dry:
            links: dict[str, dict] = {}
            unicos = sorted({p[0] for p in pendentes})
            for i in range(0, len(unicos), 100):
                for pac in central("POST", corpo={"acao": "baixar", "slugs": unicos[i:i + 100]}).get("pacotes", []):
                    links[pac["slug"]] = pac
            for slug, destino, r in pendentes:
                pac = links.get(slug) or {}
                try:
                    if pac.get("url"):
                        instalar_pacote(pac["url"], destino)
                    elif pac.get("skill_md"):
                        destino.mkdir(parents=True, exist_ok=True)
                        (destino / "SKILL.md").write_text(pac["skill_md"], encoding="utf-8")
                    else:
                        continue
                    instaladas += 1
                    vistos[slug] = {"hash": r["hash"]}
                    log(f"  ↓ {slug} v{r.get('versao')} → {destino}")
                except Exception as e:  # noqa: BLE001
                    log(f"  ✗ não instalou {slug} em {destino}: {e}")
        elif dry:
            for slug, destino, _ in pendentes:
                log(f"  [simulação] instalaria {slug} → {destino}")

    # 3) Conectores (plugins e servidores MCP desta máquina, só nome e como instalar).
    if conectores and not dry and not so_baixar:
        for c in conectores_locais():
            try:
                central("POST", corpo={"acao": "conector", **c})
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ conector {c['slug']}: {e}")

    if not dry:
        estado["ultima_sync"] = agora_iso()
        gravar_estado(estado)
        for rt in pastas_dos_agentes():
            try:
                central("POST", corpo={
                    "acao": "maquina", "maquina": maquina(), "agente": rt, "versao_cliente": VERSAO,
                    "instaladas": len(indice.get(rt, {})), "enviadas": enviadas,
                    "detalhe": {"sistema": platform.system(), "segundos": round(time.time() - inicio, 1)},
                })
            except Exception:  # noqa: BLE001
                pass
    log(f"Central: {enviadas} enviada(s), {instaladas} instalada(s), {len(remotas)} na Central ({round(time.time() - inicio, 1)} s).")
    return 0


def status() -> int:
    indice = indice_local()
    manifesto = central("GET", "acao=manifesto")
    remotas = {s["slug"]: s for s in manifesto.get("skills", [])}
    print(f"Central: {len(remotas)} skill(s) · máquina {maquina()} · cliente {VERSAO}")
    for rt, skills in indice.items():
        iguais = sum(1 for s, v in skills.items() if remotas.get(s, {}).get("hash") == v["hash"])
        print(f"  {rt:14} {len(skills):4} aqui · {iguais} iguais à Central · {len(skills) - iguais} diferentes ou só aqui")
    return 0


# ─── instalar (automação + aviso nas instruções) ─────────────────

BLOCO = """<!-- central-aceleriq:inicio -->
## Central de Skills e segundo cérebro (Aceleriq)
- As skills de todos os agentes (Claude Code, Codex, Hermes e outros) vêm da Central do painel Aceleriq (menu Agentes > Skills e cérebro). Elas sincronizam sozinhas a cada 30 minutos e no início de cada sessão.
- Criou, instalou ou mudou uma skill? No fim, rode `python ~/.aceleriq/central.py sync` para ela chegar aos outros agentes (ou use a ferramenta MCP `aceleriq_central_publicar_skill`).
- Segundo cérebro em tempo real pelo MCP aceleriq-os: `memory_get_context`, `memory_search` e `memory_fetch` para ler; `aceleriq_cerebro_salvar_nota` para criar ou editar nota (com o sha lido); `memory_propose_update` para memória consolidada.
- Conectores (plugins, MCP, Composio): `aceleriq_central_skills` com `conectores: true` mostra como instalar cada um.
<!-- central-aceleriq:fim -->"""


def escrever_bloco(arquivo: Path) -> None:
    try:
        atual = arquivo.read_text(encoding="utf-8") if arquivo.exists() else ""
    except OSError:
        return
    if "<!-- central-aceleriq:inicio -->" in atual:
        novo = re.sub(r"<!-- central-aceleriq:inicio -->.*?<!-- central-aceleriq:fim -->", BLOCO, atual, flags=re.S)
    else:
        novo = (atual.rstrip() + "\n\n" if atual.strip() else "") + BLOCO + "\n"
    if novo != atual:
        arquivo.parent.mkdir(parents=True, exist_ok=True)
        arquivo.write_text(novo, encoding="utf-8")
        log(f"  aviso da Central em {arquivo}")


def comando_python() -> str:
    exe = Path(sys.executable)
    if sys.platform == "win32":
        w = exe.with_name("pythonw.exe")
        return str(w if w.exists() else exe)
    return str(exe)


def ligar_automacao() -> None:
    script = str(PASTA / "central.py")
    if sys.platform == "win32":
        tr = f'"{comando_python()}" "{script}" sync --silencioso'
        r = subprocess.run(["schtasks", "/Create", "/F", "/SC", "MINUTE", "/MO", "30",
                            "/TN", "Aceleriq - Central de Skills", "/TR", tr],
                           capture_output=True, text=True)
        log("  tarefa agendada a cada 30 min" if r.returncode == 0 else f"  ✗ tarefa agendada: {r.stderr.strip()}")
    else:
        linha = f"*/30 * * * * {comando_python()} {script} sync --silencioso >/dev/null 2>&1"
        atual = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
        if "central.py sync" not in atual:
            novo = (atual.rstrip("\n") + "\n" if atual.strip() else "") + linha + "\n"
            subprocess.run(["crontab", "-"], input=novo, text=True)
            log("  cron a cada 30 min")
    # Claude Code: sincroniza no começo de cada sessão (sem travar a sessão).
    cfg = HOME / ".claude" / "settings.json"
    if cfg.parent.exists():
        try:
            dados = json.loads(cfg.read_text(encoding="utf-8")) if cfg.exists() else {}
        except ValueError:
            log("  ✗ ~/.claude/settings.json inválido; não mexi no hook")
            return
        ganchos = dados.setdefault("hooks", {}).setdefault("SessionStart", [])
        if "central.py" not in json.dumps(ganchos):
            ganchos.append({"matcher": "startup", "hooks": [{
                "type": "command",
                "command": f'"{comando_python()}" "{script}" sync --silencioso',
                "timeout": 120,
                "async": True,
            }]})
            shutil.copy2(cfg, cfg.with_suffix(".json.antes-central")) if cfg.exists() else None
            cfg.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
            log("  hook do Claude Code no início da sessão")


def instalar() -> int:
    PASTA.mkdir(parents=True, exist_ok=True)
    destino = PASTA / "central.py"
    if Path(__file__).resolve() != destino.resolve():
        shutil.copy2(__file__, destino)
    sync()
    ligar_automacao()
    if (HOME / ".claude").exists():
        escrever_bloco(HOME / ".claude" / "CLAUDE.md")
    codex = Path(os.environ.get("CODEX_HOME", HOME / ".codex"))
    if codex.exists():
        escrever_bloco(codex / "AGENTS.md")
    log("Central instalada. Ver: python ~/.aceleriq/central.py status")
    return 0


def main() -> int:
    global SILENCIOSO
    ap = argparse.ArgumentParser(description="Central de Skills Aceleriq")
    ap.add_argument("comando", nargs="?", default="sync", choices=["sync", "instalar", "status", "versao"])
    ap.add_argument("--simular", action="store_true", help="mostra o que faria, sem mudar nada")
    ap.add_argument("--so-subir", action="store_true")
    ap.add_argument("--so-baixar", action="store_true")
    ap.add_argument("--sem-conectores", action="store_true")
    ap.add_argument("--silencioso", action="store_true")
    a = ap.parse_args()
    SILENCIOSO = a.silencioso
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if a.comando == "versao":
        print(VERSAO)
        return 0
    try:
        if a.comando == "status":
            return status()
        if a.comando == "instalar":
            return instalar()
        return sync(dry=a.simular, so_subir=a.so_subir, so_baixar=a.so_baixar, conectores=not a.sem_conectores)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"Central: falhou: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
