#!/usr/bin/env python3
"""Rotina da Clio (Hermes): guarda no painel o material que o CLIENTE mandou no grupo de WhatsApp.

O leitor dos grupos baixa imagem, vídeo e documento; o n8n descreve e diz quais são do cliente. Para cada um, o
leitor deixa uma ficha (.json) ao lado do arquivo. Este script sobe o arquivo para o painel, na pasta Materiais do
projeto do cliente, com a descrição, e avisa o n8n qual é o arquivo. Não acorda a agente: é trabalho mecânico.

Nada aqui fala com cliente. A chave do painel vem do ambiente do perfil (MCP_ACELERIQ_API_KEY) e o segredo do n8n de
/etc/aceleriq-leitor-grupos/webhook.segredo; nenhum dos dois é impresso.
Uso manual: python3 clio_guardar_materiais.py [--listar]
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

MIDIA = os.environ.get("CLIO_MIDIA_DIR") or "/var/lib/aceleriq-leitor-grupos/midia"  # a variável só serve para prova
MCP_URL = "https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-server"
WEBHOOK = "https://blue-fly-822772.hostingersite.com/webhook/acq12-midia"
SEGREDO = "/etc/aceleriq-leitor-grupos/webhook.segredo"
ENV_PERFIL = "/root/.hermes/profiles/clio/.env"
REGISTRO = "/var/log/aceleriq-clio-materiais.log"
PROVEDOR = "baileys_3429"
MAX_POR_RODADA = 25
MAX_TENTATIVAS = 5


def anotar(texto):
    linha = time.strftime("%Y-%m-%d %H:%M:%S ") + texto
    try:
        with open(REGISTRO, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass
    print(linha, file=sys.stderr)


def chave_do_painel():
    k = os.environ.get("MCP_ACELERIQ_API_KEY")
    if k:
        return k.strip()
    try:
        for linha in open(ENV_PERFIL, encoding="utf-8"):
            if linha.startswith("MCP_ACELERIQ_API_KEY="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def painel(chave, ferramenta, argumentos):
    """Chama uma ferramenta do painel. Devolve (ok, dados ou texto do erro)."""
    corpo = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": ferramenta, "arguments": argumentos}}).encode("utf-8")
    req = urllib.request.Request(MCP_URL, data=corpo, method="POST", headers={
        "content-type": "application/json", "accept": "application/json, text/event-stream",
        "authorization": "Bearer " + chave, "mcp-protocol-version": "2025-06-18", "user-agent": "aceleriq-clio/1"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            bruto = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return False, "HTTP %s" % e.code
    except Exception as e:
        return False, e.__class__.__name__
    texto = bruto.strip()
    if not texto.startswith("{"):
        dados = [l[5:].strip() for l in texto.splitlines() if l.startswith("data:")]
        texto = dados[-1] if dados else "{}"
    try:
        j = json.loads(texto)
    except ValueError:
        return False, "resposta ilegível"
    if j.get("error"):
        return False, str(j["error"].get("message", "erro"))[:200]
    res = j.get("result") or {}
    conteudo = res.get("structuredContent")
    if conteudo is None:
        try:
            conteudo = json.loads((res.get("content") or [{}])[0].get("text") or "{}")
        except ValueError:
            conteudo = {"texto": (res.get("content") or [{}])[0].get("text")}
    if res.get("isError") or (isinstance(conteudo, dict) and conteudo.get("ok") is False):
        return False, json.dumps(conteudo, ensure_ascii=False)[:300]
    return True, conteudo


def achar(d, nomes):
    """Procura um campo pelo nome em um resultado que pode vir embrulhado."""
    if isinstance(d, dict):
        for n in nomes:
            if d.get(n):
                return d[n]
        for v in d.values():
            r = achar(v, nomes)
            if r:
                return r
    return None


def slug(texto, teto=24):
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:teto] or "cliente"


def nome_do_arquivo(f):
    quando = str(f.get("quando") or "")
    dia, hora = quando[:10], quando[11:16].replace(":", "")
    ext = os.path.splitext(f["arquivo"])[1].lstrip(".") or "bin"
    return "%s_%s_whatsapp_%s_%s.%s" % (dia or "sem-data", hora or "0000", slug(f.get("de")), f["hash"][:8], ext)


def descricao(f):
    quando = str(f.get("quando") or "")
    partes = ["Enviado por %s no grupo de WhatsApp em %s/%s às %s (guardado automaticamente pela Clio)." % (
        f.get("de") or "cliente", quando[8:10], quando[5:7], quando[11:16])]
    if f.get("nome"):
        partes.append("Nome original: %s." % f["nome"])
    if f.get("legenda"):
        partes.append('Mensagem que veio junto: "%s".' % str(f["legenda"])[:400])
    if f.get("descricao"):
        partes.append("O que é (descrição automática, conferir): %s" % str(f["descricao"])[:1200])
    return " ".join(partes)[:1900]


def avisar_n8n(mensagem_id, file_id):
    try:
        segredo = open(SEGREDO, encoding="utf-8").read().strip()
    except OSError:
        return False
    req = urllib.request.Request(WEBHOOK, method="POST", data=json.dumps({"provedor": PROVEDOR, "arquivo": {"mensagem_id": mensagem_id, "file_id": file_id}}).encode("utf-8"),
        headers={"content-type": "application/json", "x-acq-segredo": segredo, "x-acq-carimbo": str(int(time.time())), "user-agent": "aceleriq-clio/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status == 200 and json.loads(r.read().decode("utf-8")).get("ok") is True
    except Exception:
        return False


def guardar(chave, ficha_arq):
    base = ficha_arq[:-5]
    f = json.load(open(ficha_arq, encoding="utf-8"))
    original = os.path.join(MIDIA, f["arquivo"])
    if not os.path.isfile(original):
        return "sem_arquivo", None
    dados = open(original, "rb").read()
    sha = hashlib.sha256(dados).hexdigest()
    idem = "clio-midia:" + hashlib.sha256(str(f["mensagem_id"]).encode("utf-8")).hexdigest()[:40]
    mime = str(f.get("mime") or "application/octet-stream").split(";")[0].strip()
    args = {"client_id": f["client_id"], "file_name": nome_do_arquivo(f), "mime_type": mime, "size_bytes": len(dados), "sha256": sha,
            "folder": "materiais", "description": descricao(f), "tags": ["grupo-whatsapp", f.get("tipo") or "arquivo"], "idempotency_key": idem}
    if f.get("project_id"):
        args["project_id"] = f["project_id"]
    ok, r = painel(chave, "aceleriq_prepare_file_upload", args)
    if not ok:
        return "painel recusou o preparo: %s" % r, None
    file_id = achar(r, ["file_id", "id"])
    url = achar(r, ["upload_url", "signed_upload_url", "signed_url", "url"])
    if not file_id:
        return "preparo sem id do arquivo", None
    if url:
        cab = {"content-type": mime, "x-upsert": "true"}
        extra = achar(r, ["upload_headers", "headers"])
        if isinstance(extra, dict):
            cab.update({str(k).lower(): str(v) for k, v in extra.items()})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=dados, method=str(achar(r, ["upload_method", "method"]) or "PUT").upper(), headers=cab), timeout=300) as up:
                if up.status >= 300:
                    return "envio falhou (HTTP %s)" % up.status, None
        except urllib.error.HTTPError as e:
            return "envio falhou (HTTP %s)" % e.code, None
        except Exception as e:
            return "envio falhou (%s)" % e.__class__.__name__, None
    ok, r2 = painel(chave, "aceleriq_finalize_file_upload", {"file_id": file_id, "sha256": sha, "idempotency_key": idem})  # o painel exige a mesma chave do preparo
    if not ok:
        return "painel recusou a confirmação: %s" % r2, None
    avisado = avisar_n8n(f["mensagem_id"], file_id)
    with open(base + ".guardado", "w", encoding="utf-8") as m:
        json.dump({"file_id": file_id, "nome": args["file_name"], "avisou_n8n": avisado, "em": time.strftime("%Y-%m-%dT%H:%M:%S")}, m)
    try:
        os.remove(original)
    except OSError:
        pass
    return None, {"cliente": f.get("cliente"), "nome": args["file_name"], "file_id": file_id}


def main():
    fichas = sorted(os.path.join(MIDIA, n) for n in os.listdir(MIDIA) if n.endswith(".json")) if os.path.isdir(MIDIA) else []
    pendentes = [a for a in fichas if not os.path.exists(a[:-5] + ".guardado") and not os.path.exists(a[:-5] + ".desistiu")]
    if "--listar" in sys.argv:
        print("fichas: %d | por guardar: %d" % (len(fichas), len(pendentes)))
        return 0
    if pendentes:
        chave = chave_do_painel()
        if not chave:
            anotar("sem a chave do painel no ambiente do perfil; nada guardado")
        else:
            for arq in pendentes[:MAX_POR_RODADA]:
                base = arq[:-5]
                try:
                    erro, feito = guardar(chave, arq)
                except Exception as e:  # ficha quebrada, disco, etc.
                    erro, feito = e.__class__.__name__, None
                if feito:
                    anotar("guardado: %s | %s" % (feito["cliente"], feito["nome"]))
                    continue
                n = 1
                try:
                    n = int(open(base + ".tentativas").read().strip() or "0") + 1
                except (OSError, ValueError):
                    pass
                open(base + ".tentativas", "w").write(str(n))
                anotar("não guardou (%d/%d): %s" % (n, MAX_TENTATIVAS, erro))
                if n >= MAX_TENTATIVAS or erro == "sem_arquivo":
                    open(base + ".desistiu", "w").write(str(erro))
    # Trabalho mecânico: a agente não precisa acordar.
    print(json.dumps({"wakeAgent": False}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
