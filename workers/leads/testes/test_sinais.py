"""Fatos observados no site da empresa: só o que dá para conferir, e nada quando a leitura não basta."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from buscar import enriquecer_pelo_site  # noqa: E402
from sinais import fato_da_avaliacao, fato_do_dominio_inexistente, fatos_do_site  # noqa: E402

CORPO = "<p>" + "Clínica de estética em Curitiba, tratamentos faciais e corporais. " * 20 + "</p>"
BOM = '<html><head><meta name="viewport" content="width=device-width"></head><body>%s<a href="https://wa.me/5541999887766">Fale</a><footer>© 2026 Clínica</footer></body></html>' % CORPO


def textos(html, url="https://clinica.com.br/", **k):
    return [f["texto"] for f in fatos_do_site(html, url, ano_atual=2026, **k)]


class Fatos(unittest.TestCase):
    def test_site_bem_feito_nao_gera_fato(self):
        self.assertEqual(textos(BOM), [])

    def test_plataforma_sem_dominio_proprio(self):
        self.assertIn("o site de vocês está em um endereço do Canva, sem domínio próprio", textos(BOM, "https://x.my.canva.site/clinica"))

    def test_sem_https(self):
        self.assertIn("o site de vocês abre sem o cadeado de segurança (sem https)", textos(BOM, "http://clinica.com.br/", https_funciona=False))

    def test_http_que_tem_https_funcionando_nao_acusa(self):
        self.assertEqual(textos(BOM, "http://clinica.com.br/", https_funciona=True), [])

    def test_http_sem_saber_do_https_nao_acusa(self):
        self.assertEqual(textos(BOM, "http://clinica.com.br/"), [])

    def test_sem_viewport(self):
        html = BOM.replace('<meta name="viewport" content="width=device-width">', "")
        self.assertIn("o site de vocês não parece adaptado para celular", textos(html))

    def test_sem_whatsapp_em_nenhuma_pagina(self):
        html = BOM.replace('<a href="https://wa.me/5541999887766">Fale</a>', "")
        self.assertIn("não encontrei um botão de WhatsApp no site de vocês", textos(html))
        self.assertNotIn("não encontrei um botão de WhatsApp no site de vocês", textos(html, outras_paginas=["<a href='https://api.whatsapp.com/send'>x</a>"]))

    def test_widget_de_whatsapp_em_script_conta_como_tendo(self):
        html = BOM.replace('<a href="https://wa.me/5541999887766">Fale</a>', "<script>carregar('whatsapp-widget')</script>")
        self.assertEqual(textos(html), [])

    def test_rodape_antigo(self):
        self.assertIn("o rodapé do site de vocês ainda mostra 2021", textos(BOM.replace("© 2026", "© 2021")))
        self.assertEqual(textos(BOM.replace("© 2026", "© 2025")), [], "um ano de atraso não é sinal")
        self.assertEqual(textos(BOM.replace("© 2026", "© 2019 - 2026")), [], "faixa que chega ao ano atual")

    def test_pagina_magra_nao_acusa_o_que_nao_deu_para_ver(self):
        # Site montado por JavaScript: o HTML cru não mostra quase nada, então ausência não prova nada.
        magra = '<html><head></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
        self.assertEqual(textos(magra), [])
        self.assertEqual(textos(magra, "https://x.wixsite.com/c")[0], "o site de vocês está em um endereço do Wix, sem domínio próprio", "o endereço continua valendo")

    def test_cada_fato_leva_a_prova_e_cabe_no_modelo(self):
        html = BOM.replace('<meta name="viewport" content="width=device-width">', "").replace("© 2026", "© 2020")
        for f in fatos_do_site(html, "https://clinica.com.br/", ano_atual=2026):
            self.assertTrue(f["prova"])
            self.assertEqual(f["url"], "https://clinica.com.br/")
            self.assertTrue(8 <= len(f["texto"]) <= 200)
            self.assertFalse(f["texto"].endswith("."))


class Dominio(unittest.TestCase):
    def test_so_acusa_com_o_dns_publico_confirmando(self):
        nao_existe = lambda u, t: (200, '{"Status": 3}', u)  # noqa: E731
        existe = lambda u, t: (200, '{"Status": 0}', u)  # noqa: E731

        def fora(u, t):
            raise OSError("sem rede")

        self.assertEqual(fato_do_dominio_inexistente("https://a.com.br/", nao_existe)["texto"], "o endereço do site de vocês no Google não está abrindo")
        self.assertIsNone(fato_do_dominio_inexistente("https://a.com.br/", existe))
        self.assertIsNone(fato_do_dominio_inexistente("https://a.com.br/", fora), "sem conferir, não afirma")


class Busca(unittest.TestCase):
    def test_fato_entra_nas_evidencias_com_a_prova(self):
        class Falso:
            def pagina(self, url):
                return BOM.replace("© 2026", "© 2019"), url

            def buscar(self, url, t):
                raise OSError("não devia chamar")

        c = {"site": "https://a.com.br/", "evidencias": [{"campo": "avaliacoes", "valor": "4.9 (41 avaliações)", "url": "https://maps"}], "nome": "A", "fonte": "google_maps"}
        for campo in ("whatsapp", "telefone", "email", "instagram", "cnpj"):
            c[campo] = None
        enriquecer_pelo_site(c, Falso())
        fatos = [e for e in c["evidencias"] if e["campo"] == "fato_observado"]
        self.assertEqual([f["valor"] for f in fatos], ["o rodapé do site de vocês ainda mostra 2019", "vocês têm nota 4,9 no Google, mas só 41 avaliações"])
        self.assertTrue(fatos[0]["detalhe"])

    def test_sem_site_nao_gera_fato_aqui(self):
        c = {"site": None, "evidencias": []}
        enriquecer_pelo_site(c, None)
        self.assertEqual(c["evidencias"], [])


class Avaliacao(unittest.TestCase):
    def test_nota_boa_com_poucas_avaliacoes(self):
        self.assertEqual(fato_da_avaliacao("4.9 (41 avaliações)")["texto"], "vocês têm nota 4,9 no Google, mas só 41 avaliações")

    def test_muitas_avaliacoes_ou_nota_baixa_nao_viram_fato(self):
        self.assertIsNone(fato_da_avaliacao("4.9 (236 avaliações)"))
        self.assertIsNone(fato_da_avaliacao("3.9 (41 avaliações)"))
        self.assertIsNone(fato_da_avaliacao("4.9 (1 avaliações)"))
        self.assertIsNone(fato_da_avaliacao(None))


if __name__ == "__main__":
    unittest.main()
