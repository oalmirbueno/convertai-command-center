"""Fonte Google Maps pelo Apify, sem rede: o teto de gasto, o candidato e o que falha com clareza."""

import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from apify import ErroDoApify, candidato_do_google, entrada_do_ator, extras_do_lugar, lugares_do_google, notas_do_lugar, teto_em_dolar  # noqa: E402
from buscar import rodar  # noqa: E402

LUGAR = {
    "title": "Pet Shop Bom Amigo",
    "categoryName": "Pet shop",
    "website": None,
    "phoneUnformatted": "+5541999887766",
    "phone": "(41) 99988-7766",
    "address": "Rua das Flores, 10 - Centro, Curitiba - PR",
    "city": "Curitiba",
    "url": "https://www.google.com/maps/place/x",
    "totalScore": 4.7,
    "reviewsCount": 37,
}


class Falsa:
    """O Apify de mentira: guarda os pedidos e responde na ordem."""

    def __init__(self, status="SUCCEEDED", itens=None):
        self.pedidos = []
        self.status = status
        self.itens = itens if itens is not None else [LUGAR]

    def __call__(self, metodo, url, token, corpo=None):
        self.pedidos.append((metodo, url, token, corpo))
        if metodo == "POST":
            return {"data": {"id": "run1", "status": "RUNNING", "defaultDatasetId": "ds1"}}
        if "/actor-runs/" in url:
            return {"data": {"id": "run1", "status": self.status, "defaultDatasetId": "ds1", "statusMessage": "motivo"}}
        return self.itens


class Teto(unittest.TestCase):
    def test_cobre_a_busca_e_respeita_o_maximo(self):
        self.assertEqual(teto_em_dolar(50, {}), 0.5)
        self.assertAlmostEqual(teto_em_dolar(300, {}), 2.4)
        self.assertEqual(teto_em_dolar(300, {"APIFY_TETO_USD": "1"}), 1.0)

    def test_teto_invalido_nao_libera_gasto(self):
        self.assertEqual(teto_em_dolar(300, {"APIFY_TETO_USD": "abc"}), 2.4)
        self.assertEqual(teto_em_dolar(300, {"APIFY_TETO_USD": "9999"}), 2.4)


class Entrada(unittest.TestCase):
    def test_cidade_e_quantidade_vao_no_pedido(self):
        e = entrada_do_ator({"nicho": "pet shop", "cidade": "Curitiba", "uf": "PR"}, 40)
        self.assertEqual(e["searchStringsArray"], ["pet shop"])
        self.assertEqual(e["locationQuery"], "Curitiba, PR, Brasil")
        self.assertEqual(e["maxCrawledPlacesPerSearch"], 40)
        self.assertEqual(e["maxReviews"], 0)
        self.assertEqual(e["maxImages"], 0)

    def test_outro_pais(self):
        self.assertEqual(entrada_do_ator({"nicho": "x", "cidade": "Asunción", "uf": "PY"}, 5)["locationQuery"], "Asunción, Paraguay")


class Candidato(unittest.TestCase):
    def test_lugar_vira_candidato_com_a_fonte(self):
        c = candidato_do_google(LUGAR)
        self.assertEqual(c["nome"], "Pet Shop Bom Amigo")
        self.assertEqual(c["telefone_bruto"], "(41) 99988-7766")
        self.assertEqual(c["fonte_url"], LUGAR["url"])

    def test_telefone_so_no_formato_cru_nao_se_perde(self):
        c = candidato_do_google({"title": "A", "phoneUnformatted": "+5541999887766"})
        self.assertEqual(c["telefone_bruto"], "(41) 99988-7766")
        self.assertEqual(candidato_do_google({"title": "A", "phoneUnformatted": "+554133334444"})["telefone_bruto"], "(41) 3333-4444")
        self.assertIsNone(candidato_do_google({"title": "A"})["telefone_bruto"])

    def test_fechado_ou_sem_nome_fica_de_fora(self):
        self.assertIsNone(candidato_do_google(dict(LUGAR, permanentlyClosed=True)))
        self.assertIsNone(candidato_do_google(dict(LUGAR, temporarilyClosed=True)))
        self.assertIsNone(candidato_do_google(dict(LUGAR, title=" ")))

    def test_site_que_e_rede_social_nao_conta_como_site(self):
        c = candidato_do_google(dict(LUGAR, website="https://www.instagram.com/bomamigo/"))
        self.assertIsNone(c["site"])
        self.assertEqual(c["instagram"], "bomamigo")
        self.assertIsNone(candidato_do_google(dict(LUGAR, website="https://www.ifood.com.br/x"))["site"])

    def test_notas_nao_quebram_com_campo_faltando(self):
        self.assertEqual(notas_do_lugar({}), {"dor": 3, "oportunidade": 0})
        self.assertEqual(notas_do_lugar(LUGAR), {"dor": 3, "oportunidade": 3})
        self.assertEqual(notas_do_lugar({"website": "https://a.com.br", "reviewsCount": 500, "totalScore": 4.9, "phone": "1"}), {"dor": 0, "oportunidade": 1})


class Rodada(unittest.TestCase):
    def test_sem_token_nao_chama_ninguem(self):
        f = Falsa()
        with self.assertRaises(ErroDoApify) as e:
            lugares_do_google({"nicho": "x", "cidade": "y"}, 10, {}, http=f, dormir=lambda s: None)
        self.assertIn("APIFY_TOKEN", str(e.exception))
        self.assertEqual(f.pedidos, [])

    def test_todo_pedido_de_rodada_leva_teto(self):
        f = Falsa()
        itens = lugares_do_google({"nicho": "x", "cidade": "y"}, 300, {"APIFY_TOKEN": "tok"}, http=f, dormir=lambda s: None)
        self.assertEqual(len(itens), 1)
        self.assertIn("maxTotalChargeUsd=2.4", f.pedidos[0][1])
        self.assertNotIn("tok", f.pedidos[0][1], "o token não vai na URL")

    def test_falha_vira_erro_sem_token(self):
        f = Falsa(status="FAILED")
        with self.assertRaises(ErroDoApify) as e:
            lugares_do_google({"nicho": "x", "cidade": "y"}, 10, {"APIFY_TOKEN": "tok"}, http=f, dormir=lambda s: None)
        self.assertNotIn("tok", str(e.exception))

    def test_parada_no_teto_aproveita_o_que_achou(self):
        f = Falsa(status="ABORTED")
        self.assertEqual(len(lugares_do_google({"nicho": "x", "cidade": "y"}, 10, {"APIFY_TOKEN": "t"}, http=f, dormir=lambda s: None)), 1)


class BuscaInteira(unittest.TestCase):
    def test_google_maps_gera_candidato_com_evidencias(self):
        saida = io.StringIO()
        n = rodar({"nicho": "pet shop", "cidade": "Curitiba", "uf": "PR", "fontes": ["google_maps"], "limite": 5}, saida=saida, lugares_google=lambda b, l: [LUGAR])
        self.assertEqual(n, 1)
        eventos = [json.loads(x) for x in saida.getvalue().splitlines()]
        c = next(e for e in eventos if e["tipo"] == "candidato")
        self.assertEqual(c["fonte"], "google_maps")
        self.assertTrue(c["chave"])
        campos = {e["campo"]: e for e in c["evidencias"]}
        self.assertEqual(campos["avaliacoes"]["valor"], "4.7 (37 avaliações)")
        self.assertEqual(campos["nota_dor"]["valor"], "3")
        self.assertEqual(campos["nota_oportunidade"]["valor"], "3")
        self.assertEqual(campos["whatsapp_provavel"]["fonte"], "google_maps")

    def test_nao_escolher_a_fonte_nao_gasta(self):
        def nao_chame(b, l):
            raise AssertionError("não devia chamar o Apify")

        rodar({"nicho": "x", "cidade": "y", "fontes": ["lista"], "urls": [], "limite": 5}, saida=io.StringIO(), lugares_google=nao_chame)


class ContatosDaEmpresa(unittest.TestCase):
    """04/11/2026: a rodada pede os contatos da empresa e pula quem fechou; o que falta não quebra."""

    def test_pede_contatos_e_pula_fechados(self):
        e = entrada_do_ator({"nicho": "x", "cidade": "Curitiba", "uf": "PR"}, 5)
        self.assertIs(e["scrapeContacts"], True)
        self.assertIs(e["skipClosedPlaces"], True)
        self.assertEqual(e["maxReviews"], 0)

    def test_email_instagram_e_whatsapp_dos_contatos(self):
        c = candidato_do_google({"title": "Loja", "emails": ["a@loja.com.br"], "instagrams": ["https://www.instagram.com/lojax/"], "whatsapps": ["+5541999887766"]})
        self.assertEqual(c["email"], "a@loja.com.br")
        self.assertEqual(c["instagram"], "lojax")
        self.assertEqual(c["whatsapp_bruto"], "+5541999887766")

    def test_sem_contatos_nao_quebra(self):
        c = candidato_do_google({"title": "Loja", "emails": [], "instagrams": None})
        self.assertIsNone(c["email"])
        self.assertIsNone(c["instagram"])

    def test_extras(self):
        x = extras_do_lugar({"neighborhood": "Batel", "openingHours": [{"day": "segunda", "hours": "8 às 18"}], "categories": ["Pizzaria", "Delivery"], "facebooks": ["https://facebook.com/l"], "linkedIns": []})
        self.assertEqual(x, {"bairro": "Batel", "horario": "segunda: 8 às 18", "categorias": "Pizzaria, Delivery", "facebook": "https://facebook.com/l", "linkedin": None})
        self.assertEqual(extras_do_lugar({}), {"bairro": None, "horario": None, "categorias": None, "facebook": None, "linkedin": None})


if __name__ == "__main__":
    unittest.main()
