"""Extração dos contatos que a própria empresa publica no site (Máquina de leads, 25/10/2026).

Puro: recebe o HTML e o endereço, devolve o que achou e de onde (cada achado leva a URL da página).
Telefone e WhatsApp do Brasil, e-mail, Instagram, CNPJ (com dígito verificador) e as páginas de
contato ou sobre do mesmo site para olhar em seguida.
"""

import re
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from scrapling.parser import Selector

DDDS = set(
    "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 "
    "61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split()
)

_TELEFONE = re.compile(r"(?:\+?55[\s.-]?)?\(?\b([1-9][0-9])\)?[\s.-]?(9?\s?[0-9]{4})[\s.-]?([0-9]{4})\b")
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CNPJ = re.compile(r"\b(\d{2})\.?(\d{3})\.?(\d{3})/?(\d{4})-?(\d{2})\b")
_EXT_DE_ARQUIVO = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js)$", re.I)
_INSTAGRAM_NAO_PERFIL = {"p", "reel", "reels", "explore", "stories", "tv", "accounts", "about", "developer", "legal", "direct", "sharer.php"}
_CONTATO = re.compile(r"contato|contact|fale|atendimento|sobre|about|quem-somos|quem_somos|empresa|institucional|localizacao|onde-estamos", re.I)


def normalizar_telefone(ddd, meio, fim):
    """+55DDNNNNNNNNN, ou None quando não parece telefone do Brasil."""
    meio = re.sub(r"\s", "", meio)
    if ddd not in DDDS:
        return None
    numero = meio + fim
    if len(numero) == 9 and numero[0] != "9":
        return None
    if len(numero) not in (8, 9):
        return None
    if len(set(numero)) == 1:
        return None
    return "+55" + ddd + numero


def telefone_de_texto(texto):
    m = _TELEFONE.search(str(texto or ""))
    return normalizar_telefone(m.group(1), m.group(2), m.group(3)) if m else None


def eh_celular(telefone):
    return bool(telefone) and len(telefone) == 14 and telefone[5] == "9"


def numero_do_whatsapp(href):
    """O número de um link do WhatsApp (wa.me/5541..., api.whatsapp.com/send?phone=...)."""
    try:
        u = urlparse(href)
    except ValueError:
        return None
    host = (u.netloc or "").lower()
    digitos = None
    if host.endswith("wa.me"):
        digitos = re.sub(r"\D", "", u.path)
    elif "whatsapp.com" in host:
        digitos = re.sub(r"\D", "", (parse_qs(u.query).get("phone") or [""])[0])
    if not digitos:
        return None
    if digitos.startswith("55") and len(digitos) in (12, 13):
        digitos = digitos[2:]
    if len(digitos) in (10, 11):
        return normalizar_telefone(digitos[:2], digitos[2:-4], digitos[-4:])
    return None


def instagram_do_link(href):
    try:
        u = urlparse(href)
    except ValueError:
        return None
    if "instagram.com" not in (u.netloc or "").lower():
        return None
    partes = [p for p in u.path.split("/") if p]
    if not partes or partes[0].lower() in _INSTAGRAM_NAO_PERFIL:
        return None
    handle = partes[0].lstrip("@")
    return handle if re.match(r"^[A-Za-z0-9._]{1,30}$", handle) else None


def cnpj_valido(digitos):
    d = re.sub(r"\D", "", str(digitos or ""))
    if len(d) != 14 or len(set(d)) == 1:
        return False

    def dv(base, pesos):
        s = sum(int(a) * b for a, b in zip(base, pesos))
        r = s % 11
        return "0" if r < 2 else str(11 - r)

    p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    p2 = [6] + p1
    return d[12] == dv(d[:12], p1) and d[13] == dv(d[:13], p2)


def _mesmo_site(a, b):
    ha = (urlparse(a).netloc or "").lower().replace("www.", "")
    hb = (urlparse(b).netloc or "").lower().replace("www.", "")
    return ha and ha == hb


def extrair_da_pagina(html, url):
    """{telefones, whatsapps, emails, instagrams, cnpjs, paginas_de_contato}; cada item é (valor, url)."""
    sel = Selector(html or "<html></html>", url=url)
    achados = {"telefones": [], "whatsapps": [], "emails": [], "instagrams": [], "cnpjs": [], "paginas_de_contato": []}
    vistos = set()

    def por(chave, valor):
        if valor and (chave, valor) not in vistos:
            vistos.add((chave, valor))
            achados[chave].append((valor, url))

    for a in sel.css("a"):
        href = (a.attrib.get("href") or "").strip()
        if not href:
            continue
        if href.lower().startswith("mailto:"):
            email = unquote(href[7:].split("?")[0]).strip()
            if _EMAIL.fullmatch(email):
                por("emails", email.lower())
            continue
        if href.lower().startswith("tel:"):
            por("telefones", telefone_de_texto(re.sub(r"[^\d+]", " ", href[4:])))
            continue
        absoluto = urljoin(url, href)
        por("whatsapps", numero_do_whatsapp(absoluto))
        por("instagrams", instagram_do_link(absoluto))
        texto = " ".join([href, a.text or ""])
        if _mesmo_site(absoluto, url) and absoluto.split("#")[0].rstrip("/") != url.split("#")[0].rstrip("/") and _CONTATO.search(texto):
            if len(achados["paginas_de_contato"]) < 4:
                por("paginas_de_contato", absoluto.split("#")[0])

    texto = sel.get_all_text(separator=" ")
    for m in _TELEFONE.finditer(texto):
        por("telefones", normalizar_telefone(m.group(1), m.group(2), m.group(3)))
        if len(achados["telefones"]) >= 5:
            break
    for e in _EMAIL.findall(texto):
        if not _EXT_DE_ARQUIVO.search(e) and len(achados["emails"]) < 5:
            por("emails", e.lower())
    for m in _CNPJ.finditer(texto):
        d = "".join(m.groups())
        if cnpj_valido(d):
            por("cnpjs", d)
    return achados


def chave_do_candidato(nome, telefone=None, site=None):
    """Identidade para não repetir o mesmo negócio na busca: nome sem acento mais telefone ou domínio."""
    from nichos import sem_acento

    base = re.sub(r"[^a-z0-9]+", "", sem_acento(nome))[:60]
    extra = ""
    if telefone:
        extra = re.sub(r"\D", "", telefone)[-8:]
    elif site:
        extra = (urlparse(site if "://" in site else "http://" + site).netloc or "").lower().replace("www.", "")
    return (base + ":" + extra)[:120]
