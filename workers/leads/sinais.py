"""O que dá para afirmar sobre o site de uma empresa (04/11/2026). Vira {{2}} da primeira mensagem do Mercúrio.

Regra fixa em código, sem modelo de linguagem: cada fato é conferível abrindo o site, e um fato errado dito ao
dono da empresa é pior que não dizer nada. Por isso, página magra (site montado por JavaScript) não acusa ausência:
o HTML cru não mostrou, mas isso não prova que falta. A ordem da lista é a força do fato.
"""

import json
import re
from urllib.parse import quote, urlparse

PLATAFORMAS = (
    ("canva.site", "do Canva"),
    ("wixsite.com", "do Wix"),
    ("webnode.", "do Webnode"),
    ("negocio.site", "do Google"),
    ("business.site", "do Google"),
    ("sites.google.com", "do Google Sites"),
    ("carrd.co", "do Carrd"),
    ("wordpress.com", "do WordPress"),
    ("blogspot.", "do Blogger"),
    ("lovable.app", "do Lovable"),
    ("vercel.app", "da Vercel"),
    ("netlify.app", "da Netlify"),
)
_VIEWPORT = re.compile(r"<meta[^>]+name=[\"']?viewport", re.I)
_DIREITOS = re.compile(r"(?:©|&copy;|&#169;|copyright)[^<]{0,40}?((?:19|20)\d{2})(?:\s*[-–/]\s*((?:19|20)\d{2}))?", re.I)
_TAGS = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.I | re.S)
TEXTO_MINIMO = 400
ANOS_DE_ATRASO = 2
AVALIACOES_POUCAS = 100
NOTA_BOA = 4.5


def _fato(texto, prova, url):
    return {"texto": texto, "prova": prova, "url": url}


def _visivel(html):
    return re.sub(r"\s+", " ", _TAGS.sub(" ", html or "")).strip()


def fatos_do_site(html, url, ano_atual, outras_paginas=None, https_funciona=None):
    """Os fatos, do mais forte para o mais fraco. https_funciona: só acusa quando foi testado e falhou."""
    fatos = []
    u = urlparse(url)
    host = (u.netloc or "").lower()
    for dominio, nome in PLATAFORMAS:
        if dominio in host:
            fatos.append(_fato("o site de vocês está em um endereço %s, sem domínio próprio" % nome, "O endereço do site é %s" % host, url))
            break
    if u.scheme == "http" and https_funciona is False:
        fatos.append(_fato("o site de vocês abre sem o cadeado de segurança (sem https)", "O site abriu em http e o endereço em https não respondeu", url))
    if len(_visivel(html)) < TEXTO_MINIMO:
        return fatos
    if not _VIEWPORT.search(html):
        fatos.append(_fato("o site de vocês não parece adaptado para celular", "A página inicial não declara a marcação de celular (meta viewport)", url))
    tudo = " ".join([html] + list(outras_paginas or [])).lower()
    if "whatsapp" not in tudo and "wa.me" not in tudo:
        fatos.append(_fato("não encontrei um botão de WhatsApp no site de vocês", "Nenhuma menção a WhatsApp nas páginas lidas", url))
    anos = [int(b or a) for a, b in _DIREITOS.findall(html)]
    if anos and max(anos) <= ano_atual - ANOS_DE_ATRASO:
        fatos.append(_fato("o rodapé do site de vocês ainda mostra %d" % max(anos), "O aviso de direitos da página inicial termina em %d" % max(anos), url))
    return fatos


def fato_do_dominio_inexistente(url, buscar):
    """O site não abriu por DNS: só vira fato se um DNS público de fora também disser que o domínio não existe."""
    host = (urlparse(url).netloc or "").lower()
    if not host:
        return None
    try:
        status, corpo, _ = buscar("https://dns.google/resolve?name=%s&type=A" % quote(host), 15)
        if status != 200 or json.loads(corpo).get("Status") != 3:
            return None
    except Exception:  # noqa: BLE001
        return None
    return _fato("o endereço do site de vocês no Google não está abrindo", "O domínio %s não existe no DNS público" % host, url)


def fato_da_avaliacao(valor, url=None):
    """Da evidência "4.9 (41 avaliações)": boa nota com poucas avaliações é um fato verdadeiro e útil."""
    m = re.match(r"^\s*([\d.]+)\s*\((\d+)", str(valor or ""))
    if not m:
        return None
    nota, avaliacoes = float(m.group(1)), int(m.group(2))
    if nota < NOTA_BOA or avaliacoes >= AVALIACOES_POUCAS or avaliacoes < 2:
        return None
    return _fato("vocês têm nota %s no Google, mas só %d avaliações" % (("%.1f" % nota).replace(".", ","), avaliacoes), "Google Maps: %s" % valor, url)
