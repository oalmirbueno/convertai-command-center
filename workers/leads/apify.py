"""Fonte Google Maps da Máquina de leads, pelo Apify (04/11/2026, decisão do dono: pagar pelo ator
compass~crawler-google-places em vez de coletar direto). É paga e só roda quando a busca escolhe "google_maps".

Toda rodada leva teto de gasto (maxTotalChargeUsd). Preço conferido em 04/11: US$ 0,004 por lugar no plano grátis.
O token vem de APIFY_TOKEN, no cabeçalho, nunca na URL nem em mensagem de erro.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

from fontes import PAISES

API = "https://api.apify.com/v2"
ATOR = "compass~crawler-google-places"
# US$ 0,004 por lugar + US$ 0,002 dos contatos da empresa (plano grátis, 04/11/2026), com margem. Mínimo de US$ 0,50 por rodada.
USD_POR_LUGAR = 0.008
TETO_MINIMO_USD = 0.5
ESPERA_ENTRE_CONSULTAS_S = 10
PRAZO_DA_RODADA_S = 900
# O site que é rede social ou marketplace não conta como site próprio.
NAO_E_SITE = ("instagram.com", "facebook.com", "ifood.com", "rappi.com", "ubereats.com", "linktr.ee", "bit.ly", "tinyurl.com", "wa.me", "whatsapp.com")


class ErroDoApify(RuntimeError):
    pass


def teto_em_dolar(limite, env=None):
    """O máximo que a rodada pode gastar: o custo do limite pedido, e nunca mais que APIFY_TETO_USD."""
    env = os.environ if env is None else env
    teto = max(TETO_MINIMO_USD, round(limite * USD_POR_LUGAR, 2))
    try:
        pedido = float(env.get("APIFY_TETO_USD") or "")
    except ValueError:
        return teto
    return max(TETO_MINIMO_USD, min(teto, pedido))


def entrada_do_ator(busca, limite):
    uf = (busca.get("uf") or "").upper()
    lugar = "%s, %s" % (busca["cidade"], PAISES[uf]) if uf in PAISES else ", ".join(x for x in [busca["cidade"], uf, "Brasil"] if x)
    return {
        "searchStringsArray": [busca["nicho"]],
        "locationQuery": lugar,
        "maxCrawledPlacesPerSearch": limite,
        "language": "pt-BR",
        "maxReviews": 0,
        "maxImages": 0,
        # 04/11/2026 (dono: "mais completo pro Apify"): e-mail e redes que a empresa publica. Fechado nem é cobrado.
        "scrapeContacts": True,
        "skipClosedPlaces": True,
    }


def _http(metodo, url, token, corpo=None):
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    pedido = urllib.request.Request(url, data=dados, method=metodo, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ErroDoApify("o Apify respondeu %s ao pedir %s" % (e.code, "a rodada" if metodo == "POST" else "o resultado")) from None
    except urllib.error.URLError as e:
        raise ErroDoApify("não consegui falar com o Apify (%s)" % str(e.reason)[:80]) from None


def lugares_do_google(busca, limite, env=None, http=_http, dormir=time.sleep, avisar=None):
    """Roda o ator e devolve os lugares. Parou no teto ou no prazo: aproveita o que já achou."""
    env = os.environ if env is None else env
    token = (env.get("APIFY_TOKEN") or "").strip()
    if not token:
        raise ErroDoApify("Falta a chave do Apify (APIFY_TOKEN) nos segredos do motor de leads.")
    url = "%s/acts/%s/runs?maxTotalChargeUsd=%s&timeout=%d" % (API, ATOR, teto_em_dolar(limite, env), PRAZO_DA_RODADA_S)
    rodada = http("POST", url, token, entrada_do_ator(busca, limite))["data"]
    fim = time.monotonic() + PRAZO_DA_RODADA_S + 120
    while rodada.get("status") in ("READY", "RUNNING", "TIMING-OUT", "ABORTING"):
        if time.monotonic() > fim:
            raise ErroDoApify("a rodada no Apify passou do prazo")
        if avisar:
            avisar()
        dormir(ESPERA_ENTRE_CONSULTAS_S)
        rodada = http("GET", "%s/actor-runs/%s" % (API, rodada["id"]), token)["data"]
    if rodada.get("status") == "FAILED":
        raise ErroDoApify("a rodada falhou no Apify: %s" % str(rodada.get("statusMessage") or "sem motivo")[:160])
    return http("GET", "%s/datasets/%s/items?clean=true&format=json" % (API, rodada["defaultDatasetId"]), token)


def _site_proprio(url):
    u = str(url or "").strip()
    if not u or any(x in u.lower() for x in NAO_E_SITE):
        return None
    return u


def _instagram(url):
    u = str(url or "").strip().rstrip("/")
    return u.split("/")[-1].lstrip("@") or None if "instagram.com/" in u.lower() else None


def _telefone_legivel(item):
    """O telefone no formato que telefone_de_texto entende: o formatado, ou o cru (+5541999887766) separado."""
    if item.get("phone"):
        return item["phone"]
    d = re.sub(r"\D", "", str(item.get("phoneUnformatted") or ""))
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    return "(%s) %s-%s" % (d[:2], d[2:-4], d[-4:]) if len(d) in (10, 11) else None


def _primeiro(item, campo):
    """O primeiro valor de uma lista de contatos do ator; lista vazia ou campo ausente dá None."""
    valores = item.get(campo)
    if not isinstance(valores, list):
        return None
    for v in valores:
        v = v.get("value") if isinstance(v, dict) else v
        if v and str(v).strip():
            return str(v).strip()
    return None


def _horarios(item):
    dias = item.get("openingHours")
    if not isinstance(dias, list):
        return None
    texto = "; ".join("%s: %s" % (d.get("day"), d.get("hours")) for d in dias if isinstance(d, dict) and d.get("day") and d.get("hours"))
    return texto[:400] or None


def extras_do_lugar(item):
    """O que não tem coluna própria e vai como evidência, com a origem. Campo que falta não quebra."""
    categorias = item.get("categories")
    return {
        "bairro": item.get("neighborhood"),
        "horario": _horarios(item),
        "categorias": ", ".join(str(c) for c in categorias)[:300] if isinstance(categorias, list) and categorias else None,
        "facebook": _primeiro(item, "facebooks"),
        "linkedin": _primeiro(item, "linkedIns"),
    }


def candidato_do_google(item):
    """Um lugar vira candidato. Fechado ou sem nome fica de fora."""
    nome = str(item.get("title") or "").strip()
    if not nome or item.get("permanentlyClosed") or item.get("temporarilyClosed"):
        return None
    return {
        "nome": nome[:200],
        "categoria": item.get("categoryName"),
        "site": _site_proprio(item.get("website")),
        "telefone_bruto": _telefone_legivel(item) or _primeiro(item, "phones"),
        "whatsapp_bruto": _primeiro(item, "whatsapps"),
        "email": _primeiro(item, "emails"),
        "instagram": _instagram(_primeiro(item, "instagrams")) or _instagram(item.get("website")),
        "endereco": item.get("address"),
        "cidade": item.get("city"),
        "fonte_url": item.get("url"),
    }


def notas_do_lugar(item):
    """Dor (o que falta para o negócio) e oportunidade (sinais de que vale a conversa). Campo que falta não quebra."""
    site = _site_proprio(item.get("website"))
    avaliacoes = int(item.get("reviewsCount") or 0)
    nota = float(item.get("totalScore") or 0)
    dor = (2 if not site else 0) + (1 if avaliacoes < 50 else 0) + (1 if nota and nota < 4.3 and avaliacoes > 20 else 0)
    oportunidade = (2 if nota > 4.5 and avaliacoes < 150 else 0) + (1 if item.get("phone") or item.get("phoneUnformatted") else 0)
    return {"dor": dor, "oportunidade": oportunidade}
