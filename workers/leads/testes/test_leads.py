"""Testes da Máquina de leads sem rede: nichos, extração, robots e uma busca com fontes falsas."""

import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from buscar import rodar  # noqa: E402
from extrair import chave_do_candidato, cnpj_valido, extrair_da_pagina, instagram_do_link, numero_do_whatsapp, telefone_de_texto  # noqa: E402
from fontes import Educado, candidato_do_osm  # noqa: E402
from nichos import consulta_overpass, nicho_do_texto, regex_do_nome  # noqa: E402

HTML = """
<html><head><title>Pizzaria Bella Napoli | Curitiba</title></head><body>
<a href="https://wa.me/5541999887766?text=oi">Peça pelo WhatsApp</a>
<a href="https://www.instagram.com/bellanapoli.cwb/">Instagram</a>
<a href="https://www.instagram.com/p/AbC123/">post</a>
<a href="mailto:Contato@BellaNapoli.com.br?subject=x">e-mail</a>
<a href="/contato">Fale conosco</a><a href="/cardapio">Cardápio</a>
<a href="https://outro-site.com/contato">contato de outro site</a>
<p>Ligue (41) 3333-4444 · CNPJ 11.222.333/0001-81 · logo@2x.png</p>
</body></html>
"""


class Nichos(unittest.TestCase):
    def test_sinonimos_e_o_mais_longo(self):
        self.assertEqual(nicho_do_texto("Restaurantes")["rotulo"], "Restaurante")
        self.assertEqual(nicho_do_texto("salão de beleza")["rotulo"], "Salão de beleza")
        self.assertEqual(nicho_do_texto("clínica odontológica")["rotulo"], "Dentista")
        self.assertEqual(nicho_do_texto("academia de crossfit")["rotulo"], "Academia")
        self.assertIsNone(nicho_do_texto("fábrica de foguetes"))
        # Pontuação conta como espaço: o texto da campanha vem com vírgula e parêntese.
        self.assertEqual(nicho_do_texto("loja de comércio (eletrônicos, perfumaria)")["rotulo"], "Informática")

    def test_consulta_tem_etiqueta_e_nome_com_acento(self):
        q = consulta_overpass("pet shop", 3600297514, 20)
        self.assertIn('nwr["shop"="pet"](area.a);', q)
        self.assertIn("area(id:3600297514)->.a;", q)
        self.assertIn("out center tags 60;", q)
        self.assertEqual(regex_do_nome("salao"), "s[aáàâã]l[aáàâã][oóôõ]")
        desconhecido = consulta_overpass("foguetes", 1, 300)
        self.assertNotIn('"shop"="', desconhecido)
        self.assertIn('["name"~"%s",i]' % regex_do_nome("foguetes"), desconhecido)
        self.assertIn("out center tags 900;", desconhecido)


class Extracao(unittest.TestCase):
    def test_contatos_da_pagina(self):
        a = extrair_da_pagina(HTML, "https://bellanapoli.com.br/")
        self.assertEqual(a["whatsapps"][0][0], "+5541999887766")
        self.assertEqual([x[0] for x in a["instagrams"]], ["bellanapoli.cwb"])
        self.assertEqual(a["emails"][0][0], "contato@bellanapoli.com.br")
        self.assertIn("+554133334444", [x[0] for x in a["telefones"]])
        self.assertEqual([x[0] for x in a["cnpjs"]], ["11222333000181"])
        self.assertEqual([x[0] for x in a["paginas_de_contato"]], ["https://bellanapoli.com.br/contato"])
        self.assertTrue(all(x[1] == "https://bellanapoli.com.br/" for x in a["emails"]))
        self.assertNotIn("logo@2x.png", [x[0] for x in a["emails"]])

    def test_telefone_whatsapp_instagram_cnpj(self):
        self.assertEqual(telefone_de_texto("+55 (11) 9 8765-4321"), "+5511987654321")
        self.assertIsNone(telefone_de_texto("(20) 3333-4444"))
        self.assertIsNone(telefone_de_texto("1111-1111"))
        self.assertEqual(numero_do_whatsapp("https://api.whatsapp.com/send?phone=5548988776655"), "+5548988776655")
        self.assertIsNone(numero_do_whatsapp("https://example.com/?phone=1"))
        self.assertIsNone(instagram_do_link("https://instagram.com/explore/tags/pizza"))
        self.assertTrue(cnpj_valido("11.222.333/0001-81"))
        self.assertFalse(cnpj_valido("11.222.333/0001-82"))
        self.assertFalse(cnpj_valido("00000000000000"))

    def test_chave_sem_repetir(self):
        self.assertEqual(chave_do_candidato("Pizzaria Bella Nápoli", "+5541999887766"), chave_do_candidato("pizzaria bella napoli", "(41) 99988-7766"))
        self.assertEqual(chave_do_candidato("Loja X", None, "https://www.lojax.com.br/a"), "lojax:lojax.com.br")


class Educacao(unittest.TestCase):
    def test_robots_e_pausa_por_site(self):
        pedidos = []
        dormiu = []
        agora = [0.0]

        def buscar(url, timeout=25):
            pedidos.append(url)
            if url.endswith("/robots.txt"):
                return 200, "User-agent: *\nDisallow: /privado\n", url
            return 200, "<html></html>", url

        e = Educado(pausa=3, buscar=buscar, dormir=lambda s: dormiu.append(s), relogio=lambda: agora[0])
        self.assertEqual(e.pagina("https://a.com.br/privado/x")[0], None)
        html, _ = e.pagina("https://a.com.br/")
        self.assertEqual(html, "<html></html>")
        self.assertEqual(pedidos.count("https://a.com.br/robots.txt"), 1)
        self.assertTrue(dormiu and all(abs(s - 3) < 0.01 for s in dormiu))

    def test_robots_que_bloqueia_tudo(self):
        e = Educado(pausa=0, buscar=lambda u, t=25: (403, "", u), dormir=lambda s: None)
        self.assertFalse(e.pode("https://b.com.br/"))


class Overpass(unittest.TestCase):
    def test_tenta_de_novo_e_usa_o_espelho(self):
        import fontes

        chamadas = []
        dormiu = []

        def falso(ed, url, corpo=None):
            chamadas.append(url)
            if url == "espelho":
                return {"elements": [{"id": 1}]}
            raise RuntimeError("504")

        antes = fontes._json_de
        fontes._json_de = falso
        try:
            e = Educado(pausa=0, dormir=lambda s: dormiu.append(s))
            self.assertEqual(fontes.lugares_do_osm(e, "q", [("principal", 0), ("principal", 15), ("espelho", 5)]), [{"id": 1}])
            self.assertEqual(chamadas, ["principal", "principal", "espelho"])
            self.assertEqual(dormiu, [15, 5])
            fontes._json_de = lambda ed, url, corpo=None: (_ for _ in ()).throw(RuntimeError("504"))
            with self.assertRaises(RuntimeError) as c:
                fontes.lugares_do_osm(e, "q", [("a", 0)])
            self.assertIn("Tente de novo", str(c.exception))
        finally:
            fontes._json_de = antes


class Cidade(unittest.TestCase):
    def _url_da_cidade(self, cidade, uf):
        import fontes

        pedidas = []
        antes = fontes._json_de
        fontes._json_de = lambda ed, url, corpo=None: pedidas.append(url) or [{"osm_type": "relation", "osm_id": 7, "display_name": "achou"}]
        try:
            self.assertEqual(fontes.area_da_cidade(None, cidade, uf), (3600000007, "achou"))
        finally:
            fontes._json_de = antes
        return pedidas[0]

    def test_cidade_do_brasil_com_uf(self):
        url = self._url_da_cidade("Curitiba", "PR")
        self.assertIn("countrycodes=br", url)
        self.assertIn("Curitiba%2C%20PR%2C%20Brasil", url)

    def test_cidade_de_outro_pais_pelo_uf(self):
        url = self._url_da_cidade("Ciudad del Este", "PY")
        self.assertIn("countrycodes=py", url)
        self.assertIn("Ciudad%20del%20Este%2C%20Paraguay", url)
        self.assertNotIn("Brasil", url)


class Busca(unittest.TestCase):
    def test_busca_com_osm_e_site_falsos(self):
        import buscar as b

        b.area_da_cidade = lambda ed, cidade, uf=None: (3600000001, "Curitiba, Paraná")
        b.lugares_do_osm = lambda ed, q: [
            {"type": "node", "id": 1, "tags": {"name": "Pizzaria Bella Napoli", "amenity": "restaurant", "website": "bellanapoli.com.br", "phone": "+55 41 3333-4444"}},
            {"type": "node", "id": 2, "tags": {"name": "Pizzaria Bella Napoli", "amenity": "restaurant", "phone": "(41) 3333-4444"}},
            {"type": "way", "id": 3, "tags": {"amenity": "restaurant"}},
            {"type": "node", "id": 4, "tags": {"name": "Cantina Sem Contato", "amenity": "restaurant"}},
        ]

        def buscar(url, timeout=25):
            if url.endswith("/robots.txt"):
                return 404, "", url
            return 200, HTML, url

        saida = io.StringIO()
        n = rodar({"nicho": "pizzaria", "cidade": "Curitiba", "uf": "PR", "fontes": ["osm", "sites"], "limite": 10}, Educado(pausa=0, buscar=buscar, dormir=lambda s: None), saida)
        eventos = [json.loads(l) for l in saida.getvalue().splitlines()]
        cands = [e for e in eventos if e["tipo"] == "candidato"]
        self.assertEqual(n, 2)
        self.assertEqual([c["nome"] for c in cands], ["Pizzaria Bella Napoli", "Cantina Sem Contato"])
        p = cands[0]
        self.assertEqual(p["telefone"], "+554133334444")
        self.assertEqual(p["whatsapp"], "+5541999887766")
        self.assertEqual(p["instagram"], "bellanapoli.cwb")
        self.assertEqual(p["fonte_url"], "https://www.openstreetmap.org/node/1")
        campos = {(ev["campo"], ev["fonte"]) for ev in p["evidencias"]}
        self.assertIn(("whatsapp", "site"), campos)
        self.assertIn(("telefone", "osm"), campos)
        self.assertIn(("credito", "osm"), campos)
        self.assertEqual(eventos[-1], {"tipo": "fim", "encontrados": 2})

    def test_candidato_do_osm_sem_nome_sai(self):
        self.assertIsNone(candidato_do_osm({"type": "node", "id": 9, "tags": {"shop": "pet"}}))
        c = candidato_do_osm({"type": "node", "id": 9, "tags": {"name": "Pet X", "shop": "pet", "contact:instagram": "https://instagram.com/petx/"}})
        self.assertEqual(c["instagram"], "petx")
        self.assertEqual(c["categoria"], "pet")


if __name__ == "__main__":
    unittest.main()
