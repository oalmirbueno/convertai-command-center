import { describe, expect, it } from "vitest";
import {
  assuntosSugeridos, assuntoValido, CacheCurto, datasParaOJev, decodificar, filtrarPorRecencia, lerRssDeNoticias, recenciaValida, urlDoGoogleNoticias,
} from "../../supabase/functions/agente-calendario/modulos/trending-noticias";
import { filtrarNoticias, fontesDasNoticias, mensagemDaNoticia, quandoDaNoticia } from "@/components/mesa/hypeETrending";

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"black friday" - Google Notícias</title>
<item><title>Black Friday deve movimentar R$ 10 bi, diz associação - Folha Teste</title><link>https://news.google.com/rss/articles/AAA?oc=5</link><guid isPermaLink="false">AAA</guid><pubDate>Tue, 20 Oct 2026 13:45:00 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/AAA"&gt;Black Friday&lt;/a&gt;</description><source url="https://www.folha.test">Folha Teste</source></item>
<item><title><![CDATA[Lojas antecipam ofertas & "esquenta" - G Teste]]></title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Mon, 05 Oct 2026 09:00:00 GMT</pubDate><source url="https://g.test">G Teste</source></item>
<item><title>Sem data não entra - X</title><link>https://news.google.com/rss/articles/CCC</link><source url="https://x.test">X</source></item>
<item><title>Link sem https não entra</title><link>http://inseguro.test/n</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Black Friday deve movimentar R$ 10 bi, diz associação - Folha Teste</title><link>https://news.google.com/rss/articles/DUP</link><pubDate>Tue, 20 Oct 2026 14:00:00 GMT</pubDate><source url="https://www.folha.test">Folha Teste</source></item>
</channel></rss>`;

const AGORA = Date.parse("2026-10-21T12:00:00Z");

describe("leitura do RSS de notícias (mock do Google Notícias)", () => {
  it("lê título (sem o ' - Fonte'), fonte, data real e link; sem data, sem https ou repetida sai", () => {
    const itens = lerRssDeNoticias(RSS);
    expect(itens).toEqual([
      { titulo: "Black Friday deve movimentar R$ 10 bi, diz associação", fonte: "Folha Teste", fonte_url: "https://www.folha.test", link: "https://news.google.com/rss/articles/AAA?oc=5", data: "2026-10-20T13:45:00.000Z" },
      { titulo: 'Lojas antecipam ofertas & "esquenta"', fonte: "G Teste", fonte_url: "https://g.test", link: "https://news.google.com/rss/articles/BBB", data: "2026-10-05T09:00:00.000Z" },
    ]);
    expect(lerRssDeNoticias(RSS, 1)).toHaveLength(1);
    expect(lerRssDeNoticias("<html>erro</html>")).toEqual([]);
  });

  it("decodifica entidades nomeadas e numéricas", () => {
    expect(decodificar("P&amp;G &#233; &#xE9; &quot;x&quot; &nbsp;")).toBe('P&G é é "x"  ');
  });

  it("monta a URL pública com assunto, recência e região do Brasil", () => {
    expect(urlDoGoogleNoticias("black friday", "7d")).toBe("https://news.google.com/rss/search?q=black%20friday%20when%3A7d&hl=pt-BR&gl=BR&ceid=BR:pt-419");
    expect(urlDoGoogleNoticias("café", "24h")).toContain("when%3A1d");
    expect(recenciaValida("30d")).toBe("30d");
    expect(recenciaValida("1 ano")).toBe("7d");
    expect(assuntoValido("  dia\n das   mães ")).toBe("dia das mães");
    expect(assuntoValido(123)).toBe("");
    expect(assuntoValido("x".repeat(200))).toHaveLength(80);
  });
});

describe("filtros de recência", () => {
  const itens = lerRssDeNoticias(RSS);
  it("no servidor: 24 h, 7 dias e 30 dias pela data real, mais novas primeiro", () => {
    expect(filtrarPorRecencia(itens, "24h", AGORA).map((n) => n.fonte)).toEqual(["Folha Teste"]);
    expect(filtrarPorRecencia(itens, "7d", AGORA).map((n) => n.fonte)).toEqual(["Folha Teste"]);
    expect(filtrarPorRecencia(itens, "30d", AGORA).map((n) => n.fonte)).toEqual(["Folha Teste", "G Teste"]);
    expect(filtrarPorRecencia([{ data: "não é data" }], "30d", AGORA)).toEqual([]);
  });

  it("na tela: recência e fonte, sem nova busca", () => {
    expect(filtrarNoticias(itens, { recencia: "30d", fonte: "" }, AGORA)).toHaveLength(2);
    expect(filtrarNoticias(itens, { recencia: "30d", fonte: "G Teste" }, AGORA).map((n) => n.titulo)).toEqual(['Lojas antecipam ofertas & "esquenta"']);
    expect(filtrarNoticias(itens, { recencia: "24h", fonte: "G Teste" }, AGORA)).toEqual([]);
    expect(fontesDasNoticias(itens)).toEqual(["Folha Teste", "G Teste"]);
    expect(quandoDaNoticia("2026-10-21T09:00:00Z", AGORA)).toBe("há 3 h");
    expect(mensagemDaNoticia(itens[0])).toContain("Folha Teste, 20/10/2026");
    expect(mensagemDaNoticia(itens[0])).toContain("Gancho do momento: Nicho: Black Friday deve movimentar");
  });
});

describe("cache curto, sugestões e datas para o Jev", () => {
  it("o cache vence no prazo e respeita o máximo", () => {
    const c = new CacheCurto<number>(1000, 2);
    c.guardar("a", 1, 0);
    expect(c.ler("a", 999)).toBe(1);
    expect(c.ler("a", 1001)).toBeNull();
    c.guardar("a", 1, 0); c.guardar("b", 2, 0); c.guardar("c", 3, 0);
    expect(c.ler("a", 1)).toBeNull();
    expect(c.ler("c", 1)).toBe(3);
  });

  it("sugere o segmento e os títulos do nicho, sem repetir nem vazio", () => {
    expect(assuntosSugeridos("Odontologia", ["Clareamento caseiro", "odontologia", "", null, "ab"])).toEqual(["Odontologia", "Clareamento caseiro"]);
  });

  it("só aceita datas com id simples e título, até 40", () => {
    const d = datasParaOJev([{ id: "natal", titulo: "Natal", tipo: "Varejo", quando: "pico 25/12" }, { id: "Natal!", titulo: "x" }, { id: "sem-titulo" }, { id: "natal", titulo: "repetida" }, "lixo"]);
    expect(d).toEqual([{ id: "natal", titulo: "Natal", tipo: "Varejo", quando: "pico 25/12" }]);
    expect(datasParaOJev(Array.from({ length: 60 }).map((_, i) => ({ id: `d${i}`, titulo: `D ${i}` })))).toHaveLength(40);
  });
});
