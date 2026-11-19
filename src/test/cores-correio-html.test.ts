import { describe, expect, it } from "vitest";
import { montarMensagem } from "../../supabase/functions/produto-correio/modulos/imap";
import { lerCorpo } from "../../supabase/functions/produto-correio/modulos/mime";
import { htmlDaMensagem, temaDaMensagem } from "../../supabase/functions/_shared/cores/email";
import { contraste } from "../../supabase/functions/_shared/cores/oklch";

const RODAPE = "\n\n--\nVocê recebeu este e-mail porque tem contato com a nossa empresa. Para não receber mais, responda SAIR.";
const TEXTO = "Olá, Ana!\n\nSegue o orçamento: https://exemplo.com.br/orcamento\n\nAbraço" + RODAPE;

const decodificarParte = (bruto: string, tipo: string) => {
  const i = bruto.indexOf(`Content-Type: ${tipo}`);
  const corpo = bruto.slice(i).split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
  return new TextDecoder().decode(Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0)));
};

describe("Correio com as cores da marca", () => {
  const tema = temaDaMensagem([{ hex: "#002893", papel: "primaria" }, { hex: "#FFFFFF", papel: "neutra" }, { hex: "#FD701C", papel: "destaque" }], "FocusLab");
  const html = htmlDaMensagem(TEXTO, tema, "Orçamento");

  it("sem HTML, a mensagem é a de antes (só texto)", () => {
    const m = montarMensagem("a@x.com", { para: ["b@y.com"], assunto: "Oi", texto: "Olá" }, "<1@x.com>", new Date("2026-11-19T12:00:00Z"));
    expect(m).toContain("Content-Type: text/plain; charset=utf-8");
    expect(m).not.toContain("multipart");
  });

  it("com HTML, sai multipart/alternative com o texto primeiro e o HTML depois", () => {
    const m = montarMensagem("a@x.com", { para: ["b@y.com"], assunto: "Orçamento", texto: TEXTO, html }, "<1@x.com>", new Date("2026-11-19T12:00:00Z"));
    expect(m).toMatch(/Content-Type: multipart\/alternative; boundary="=_aceleriq_[0-9a-f]+"/);
    expect(m.indexOf("Content-Type: text/plain")).toBeLessThan(m.indexOf("Content-Type: text/html"));
    // O leitor do próprio Correio prefere o texto puro e acha o HTML.
    const lido = lerCorpo(m);
    expect(lido.texto).toContain("Segue o orçamento");
    expect(lido.conteudo_html).toContain("FocusLab");
  });

  it("o rodapé de descadastro vai nas duas partes", () => {
    const m = montarMensagem("a@x.com", { para: ["b@y.com"], assunto: "Campanha", texto: TEXTO, html }, "<1@x.com>", new Date());
    expect(decodificarParte(m, "text/plain")).toContain("Para não receber mais, responda SAIR.");
    expect(decodificarParte(m, "text/html")).toContain("Para não receber mais, responda SAIR.");
  });

  it("HTML seguro: sem script, link clicável, modo escuro e cores com contraste", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("[data-ogsc]");
    expect(html).toContain('href="https://exemplo.com.br/orcamento"');
    expect(html).not.toContain("—");
    for (const v of [tema.claro, tema.escuro]) {
      expect(contraste(v.texto, v.cartao)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(v.link, v.cartao)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(v.textoFaixa, v.faixa)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("escapa o que a pessoa escreveu", () => {
    expect(htmlDaMensagem("<b>oi</b> & tchau", temaDaMensagem(null, "X"))).toContain("&lt;b&gt;oi&lt;/b&gt; &amp; tchau");
  });

  it("sem paleta, sai o tema neutro sem quebrar", () => {
    const t = temaDaMensagem(null, "");
    expect(contraste(t.claro.texto, t.claro.cartao)).toBeGreaterThanOrEqual(4.5);
  });
});
