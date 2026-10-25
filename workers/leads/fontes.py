"""As fontes da Máquina de leads, com educação (25/10/2026).

Regras da casa, não negociáveis:
- User-Agent identificado (AceleriqLeads/1.0) e sem disfarce: o Fetcher do Scrapling roda com
  impersonate=None e stealth=False. Nada de modo stealth, solver de Cloudflare, CAPTCHA ou proxy.
- robots.txt de cada site é lido e respeitado; site que proíbe fica de fora.
- Ritmo: no mínimo PAUSA_POR_SITE segundos entre duas páginas do mesmo site, e o Nominatim no
  máximo 1 pedido por segundo (a política de uso dele).
- Fontes: OpenStreetMap (Overpass e Nominatim, dados abertos ODbL, "© OpenStreetMap contributors"),
  o site da própria empresa e a BrasilAPI (CNPJ público). Google, Google Maps, Instagram e LinkedIn
  ficam de fora (os termos deles proíbem coleta automática).
"""

import json
import os
import tempfile
import time
from urllib.parse import quote, urlparse
from urllib.robotparser import RobotFileParser

from scrapling.fetchers import FetcherSession

UA = "AceleriqLeads/1.0 (+https://aceleriq.com.br; contato@aceleriq.com.br)"
CABECALHOS = {"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"}


def _sessao():
    """Sessão do Scrapling sem disfarce: sem imitar navegador, sem cabeçalhos de navegador, sem proxy.
    follow_redirects "safe" recusa redirecionamento para endereço interno."""
    return FetcherSession(impersonate=None, stealthy_headers=False, headers=dict(CABECALHOS), retries=1, follow_redirects="safe")


def _texto(r):
    corpo = r.body
    if isinstance(corpo, bytes):
        corpo = corpo.decode(r.encoding or "utf-8", errors="replace")
    return corpo
PAUSA_POR_SITE = float(os.environ.get("LEADS_PAUSA_POR_SITE_S") or 3)
OVERPASS = os.environ.get("LEADS_OVERPASS_URL") or "https://overpass-api.de/api/interpreter"
# Espelho público do Overpass para quando o principal está cheio (429/504 são comuns em horário de pico).
OVERPASS_ESPELHO = os.environ.get("LEADS_OVERPASS_ESPELHO") or "https://overpass.kumi.systems/api/interpreter"
NOMINATIM = os.environ.get("LEADS_NOMINATIM_URL") or "https://nominatim.openstreetmap.org/search"
CREDITO_OSM = "© OpenStreetMap contributors (ODbL)"


class Educado:
    """Busca páginas com pausa por site, robots.txt respeitado e o UA da casa."""

    def __init__(self, pausa=PAUSA_POR_SITE, buscar=None, dormir=time.sleep, relogio=time.monotonic):
        self.pausa = pausa
        self.buscar = buscar or self._buscar_scrapling
        self.dormir = dormir
        self.relogio = relogio
        self.ultimo = {}
        self.robots = {}

    @staticmethod
    def _buscar_scrapling(url, timeout=25):
        with _sessao() as s:
            r = s.get(url, timeout=timeout)
        return r.status, _texto(r), str(r.url or url)

    def _esperar_vez(self, host):
        antes = self.ultimo.get(host)
        if antes is not None:
            falta = self.pausa - (self.relogio() - antes)
            if falta > 0:
                self.dormir(falta)
        self.ultimo[host] = self.relogio()

    def pode(self, url):
        u = urlparse(url)
        host = (u.netloc or "").lower()
        if not host or u.scheme not in ("http", "https"):
            return False
        if host not in self.robots:
            rp = RobotFileParser()
            try:
                self._esperar_vez(host)
                status, corpo, _ = self.buscar("%s://%s/robots.txt" % (u.scheme, u.netloc), 15)
                if status in (401, 403):
                    rp.disallow_all = True
                elif status >= 400:
                    rp.allow_all = True
                else:
                    rp.parse(corpo.splitlines())
            except Exception:
                rp.allow_all = True
            self.robots[host] = rp
        return self.robots[host].can_fetch(UA, url)

    def pagina(self, url):
        """(html, url_final) ou (None, motivo)."""
        if not self.pode(url):
            return None, "robots.txt não permite"
        host = (urlparse(url).netloc or "").lower()
        self._esperar_vez(host)
        try:
            status, corpo, final = self.buscar(url, 25)
        except Exception as e:  # noqa: BLE001
            return None, "não abriu (%s)" % str(e)[:80]
        if status >= 400:
            return None, "respondeu %s" % status
        return corpo, final


def _json_de(educado, url, corpo=None):
    host = (urlparse(url).netloc or "").lower()
    educado._esperar_vez(host)
    if corpo is None:
        status, texto, _ = educado.buscar(url, 60)
    else:
        with _sessao() as s:
            r = s.post(url, data=corpo, timeout=120)
        status, texto = r.status, _texto(r)
    if status >= 400:
        raise RuntimeError("%s respondeu %s" % (host, status))
    return json.loads(texto)


def area_da_cidade(educado, cidade, uf=None):
    """O id de área do OSM (3600000000 + relação) da cidade, e o nome que o Nominatim achou."""
    q = "%s%s, Brasil" % (cidade, (", " + uf) if uf else "")
    url = "%s?q=%s&format=json&limit=5&addressdetails=0&countrycodes=br" % (NOMINATIM, quote(q))
    lista = _json_de(educado, url)
    for item in lista or []:
        if item.get("osm_type") == "relation":
            return 3600000000 + int(item["osm_id"]), item.get("display_name") or cidade
    raise RuntimeError("não achei a cidade %s no OpenStreetMap" % q)


def lugares_do_osm(educado, consulta, tentativas=None):
    """A consulta no Overpass; cheio ou fora do ar, espera e tenta de novo, e por último o espelho."""
    tentativas = tentativas or [(OVERPASS, 0), (OVERPASS, 15), (OVERPASS_ESPELHO, 5)]
    ultimo = None
    for url, espera in tentativas:
        if espera:
            educado.dormir(espera)
        try:
            dados = _json_de(educado, url, corpo={"data": consulta})
            return dados.get("elements") or []
        except Exception as e:  # noqa: BLE001
            ultimo = e
    raise RuntimeError("o mapa (Overpass) não respondeu agora: %s. Tente de novo em alguns minutos." % str(ultimo)[:120])


def candidato_do_osm(el):
    """Um elemento do Overpass vira candidato (só o que o mapa tem, com a fonte)."""
    t = el.get("tags") or {}
    nome = (t.get("name") or "").strip()
    if not nome:
        return None
    url = "https://www.openstreetmap.org/%s/%s" % (el.get("type"), el.get("id"))
    endereco = ", ".join(
        x for x in [
            " ".join(x for x in [t.get("addr:street"), t.get("addr:housenumber")] if x),
            t.get("addr:suburb"),
        ] if x
    )
    categoria = next((t[k] for k in ("shop", "amenity", "office", "craft", "healthcare", "leisure", "tourism") if t.get(k)), None)
    site = t.get("website") or t.get("contact:website") or t.get("url")
    if site and not site.startswith("http"):
        site = "http://" + site
    ig = t.get("contact:instagram") or t.get("instagram")
    if ig:
        ig = ig.rstrip("/").split("/")[-1].lstrip("@")
    return {
        "nome": nome[:200],
        "categoria": categoria,
        "site": site,
        "telefone_bruto": t.get("phone") or t.get("contact:phone") or t.get("mobile") or t.get("contact:mobile"),
        "whatsapp_bruto": t.get("contact:whatsapp"),
        "email": (t.get("email") or t.get("contact:email") or "").strip().lower() or None,
        "instagram": ig or None,
        "endereco": endereco or None,
        "cidade": t.get("addr:city"),
        "fonte_url": url,
    }


class CacheDeCnpj:
    def __init__(self, arquivo=None, dias=30):
        self.arquivo = arquivo or os.path.join(os.environ.get("LEADS_CACHE") or tempfile.gettempdir(), "aceleriq-leads-cnpj.json")
        self.dias = dias
        try:
            with open(self.arquivo, encoding="utf-8") as f:
                self.dados = json.load(f)
        except Exception:
            self.dados = {}

    def ler(self, cnpj):
        x = self.dados.get(cnpj)
        if x and time.time() - x.get("em", 0) < self.dias * 86400:
            return x.get("dados")
        return None

    def gravar(self, cnpj, dados):
        self.dados[cnpj] = {"em": time.time(), "dados": dados}
        try:
            os.makedirs(os.path.dirname(self.arquivo), exist_ok=True)
            with open(self.arquivo, "w", encoding="utf-8", newline="\n") as f:
                json.dump(self.dados, f)
        except Exception:
            pass


def dados_do_cnpj(educado, cache, cnpj):
    """Razão social, situação e porte pela BrasilAPI (dado público da Receita), com cache de 30 dias."""
    guardado = cache.ler(cnpj)
    if guardado is not None:
        return guardado
    try:
        d = _json_de(educado, "https://brasilapi.com.br/api/cnpj/v1/%s" % cnpj)
    except Exception:
        return None
    dados = {
        "razao_social": d.get("razao_social"),
        "nome_fantasia": d.get("nome_fantasia"),
        "situacao": d.get("descricao_situacao_cadastral"),
        "porte": d.get("porte") or d.get("descricao_porte"),
        "cnae": d.get("cnae_fiscal_descricao"),
        "municipio": d.get("municipio"),
        "uf": d.get("uf"),
    }
    cache.gravar(cnpj, dados)
    return dados
