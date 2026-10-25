"""Uma busca da Máquina de leads (25/10/2026). Chamado pelo worker Node (principal.ts).

Entrada (stdin, JSON): {id, nicho, cidade, uf, fontes: [osm|sites|cnpj|lista], limite, urls: [...]}.
Saída (stdout, uma linha JSON por evento):
  {"tipo":"progresso","etapa":"...","feitos":n,"total":m}
  {"tipo":"candidato", nome, categoria, site, telefone, whatsapp, email, instagram, endereco, cidade,
   fonte, fonte_url, chave, evidencias:[{campo, valor, fonte, url}]}
  {"tipo":"fim","encontrados":n} ou {"tipo":"erro","mensagem":"..."}
Cada dado leva a URL de onde veio (LGPD: dá para mostrar a origem de tudo).
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extrair import chave_do_candidato, eh_celular, extrair_da_pagina, telefone_de_texto
from fontes import CREDITO_OSM, CacheDeCnpj, Educado, area_da_cidade, candidato_do_osm, dados_do_cnpj, lugares_do_osm
from nichos import consulta_overpass, nicho_do_texto

FONTES_ACEITAS = ("osm", "sites", "cnpj", "lista")


def emitir(evento, saida=sys.stdout):
    saida.write(json.dumps(evento, ensure_ascii=False) + "\n")
    saida.flush()


def _evidencia(campo, valor, fonte, url):
    return {"campo": campo, "valor": valor, "fonte": fonte, "url": url}


def candidato_base(bruto, fonte):
    tel = telefone_de_texto(bruto.get("telefone_bruto")) if bruto.get("telefone_bruto") else None
    zap = telefone_de_texto(bruto.get("whatsapp_bruto")) if bruto.get("whatsapp_bruto") else None
    c = {
        "nome": bruto["nome"],
        "categoria": bruto.get("categoria"),
        "site": bruto.get("site"),
        "telefone": tel,
        "whatsapp": zap,
        "email": bruto.get("email"),
        "instagram": bruto.get("instagram"),
        "endereco": bruto.get("endereco"),
        "cidade": bruto.get("cidade"),
        "fonte": fonte,
        "fonte_url": bruto.get("fonte_url"),
        "cnpj": None,
        "evidencias": [],
    }
    for campo in ("site", "telefone", "whatsapp", "email", "instagram", "endereco"):
        if c[campo]:
            c["evidencias"].append(_evidencia(campo, c[campo], fonte, c["fonte_url"]))
    return c


def enriquecer_pelo_site(c, educado, max_paginas_extra=2):
    """Home e até 2 páginas de contato/sobre do próprio site; preenche o que falta, com a fonte."""
    if not c.get("site"):
        return
    fila = [c["site"]]
    vistas = set()
    while fila and len(vistas) < 1 + max_paginas_extra:
        url = fila.pop(0)
        if url in vistas:
            continue
        vistas.add(url)
        html, final = educado.pagina(url)
        if html is None:
            c["evidencias"].append(_evidencia("site", "não lido: " + final, "site", url))
            continue
        a = extrair_da_pagina(html, final)
        if len(vistas) == 1:
            fila.extend(u for u, _ in a["paginas_de_contato"][:max_paginas_extra])
            if c["nome"].startswith("http"):
                titulo = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
                if titulo:
                    c["nome"] = re.split(r"\s[|\-–]\s", re.sub(r"\s+", " ", titulo.group(1)).strip())[0][:200] or c["nome"]
        for campo, chave in (("whatsapp", "whatsapps"), ("telefone", "telefones"), ("email", "emails"), ("instagram", "instagrams"), ("cnpj", "cnpjs")):
            for valor, origem in a[chave]:
                if not c.get(campo):
                    c[campo] = valor
                    c["evidencias"].append(_evidencia(campo, valor, "site", origem))
        if not c.get("whatsapp") and c.get("telefone") and eh_celular(c["telefone"]):
            # Celular publicado no site: candidato a WhatsApp, marcado como suposição.
            c["evidencias"].append(_evidencia("whatsapp_provavel", c["telefone"], "site", final))


def rodar(busca, educado=None, saida=sys.stdout, cache=None):
    educado = educado or Educado()
    fontes = [f for f in (busca.get("fontes") or ["osm", "sites"]) if f in FONTES_ACEITAS]
    limite = max(1, min(int(busca.get("limite") or 50), 300))
    candidatos = []
    if "osm" in fontes:
        emitir({"tipo": "progresso", "etapa": "Achando a cidade no mapa", "feitos": 0, "total": limite}, saida)
        area, nome_da_area = area_da_cidade(educado, busca["cidade"], busca.get("uf"))
        n = nicho_do_texto(busca["nicho"])
        emitir({"tipo": "progresso", "etapa": "Buscando %s em %s" % (n["rotulo"] if n else busca["nicho"], nome_da_area.split(",")[0]), "feitos": 0, "total": limite}, saida)
        for el in lugares_do_osm(educado, consulta_overpass(busca["nicho"], area, limite)):
            b = candidato_do_osm(el)
            if b:
                candidatos.append(candidato_base(b, "osm"))
        # Primeiro quem tem como falar (telefone, site, e-mail).
        candidatos.sort(key=lambda c: -((2 if c["telefone"] or c["whatsapp"] else 0) + (1 if c["site"] else 0) + (1 if c["email"] else 0)))
    if "lista" in fontes:
        for url in (busca.get("urls") or [])[:300]:
            url = str(url).strip()
            if not url:
                continue
            if "://" not in url:
                url = "http://" + url
            if not urlparse(url).netloc:
                continue
            candidatos.append(candidato_base({"nome": url, "site": url, "fonte_url": url}, "lista"))
    vistos = set()
    unicos = []
    for c in candidatos:
        k = chave_do_candidato(c["nome"], c["telefone"] or c["whatsapp"], c["site"])
        if k in vistos:
            continue
        vistos.add(k)
        unicos.append(c)
    unicos = unicos[:limite]
    cache = cache or (CacheDeCnpj() if "cnpj" in fontes else None)
    feitos = 0
    for c in unicos:
        if "sites" in fontes or c["fonte"] == "lista":
            emitir({"tipo": "progresso", "etapa": "Lendo o site de %s" % c["nome"][:60], "feitos": feitos, "total": len(unicos)}, saida)
            enriquecer_pelo_site(c, educado)
        if "cnpj" in fontes and c.get("cnpj") and cache is not None:
            d = dados_do_cnpj(educado, cache, c["cnpj"])
            if d:
                c["evidencias"].append(_evidencia("cnpj", json.dumps(d, ensure_ascii=False), "brasilapi", "https://brasilapi.com.br/api/cnpj/v1/%s" % c["cnpj"]))
        c["chave"] = chave_do_candidato(c["nome"], c["telefone"] or c["whatsapp"], c["site"])
        if c["fonte"] == "osm":
            c["evidencias"].append(_evidencia("credito", CREDITO_OSM, "osm", c["fonte_url"]))
        feitos += 1
        emitir(dict(c, tipo="candidato"), saida)
        emitir({"tipo": "progresso", "etapa": "Lendo os sites", "feitos": feitos, "total": len(unicos)}, saida)
    emitir({"tipo": "fim", "encontrados": feitos}, saida)
    return feitos


def main():
    try:
        busca = json.loads(sys.stdin.read() or "{}")
        if not busca.get("nicho") and "lista" not in (busca.get("fontes") or []):
            raise ValueError("busca sem nicho")
        rodar(busca)
    except Exception as e:  # noqa: BLE001
        emitir({"tipo": "erro", "mensagem": str(e)[:300]})
        sys.exit(1)


if __name__ == "__main__":
    import logging

    sys.stdout.reconfigure(encoding="utf-8")
    # O log do Scrapling vai para a saída de erro: a saída padrão é só dos eventos em JSON.
    for nome in ("scrapling", ""):
        lg = logging.getLogger(nome)
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.addHandler(logging.StreamHandler(sys.stderr))
        lg.setLevel(logging.WARNING)
    main()
