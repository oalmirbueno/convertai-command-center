import { describe, it, expect, vi } from "vitest";
import { linksNoPedido, urlPublicaDoContexto, lerLinksDoContexto } from "../../supabase/functions/agente-contexto/modulos/links-do-contexto";
import { assertPublicHttpsUrl, type FetchPublicTextOptions } from "../../supabase/functions/_shared/public-http";

const conteudo = "Informações públicas sobre serviços e entregas do evento. ".repeat(8);
const validar = (url: string) => assertPublicHttpsUrl(url, async () => ["93.184.216.34"]);
const pagina = (data: Record<string, unknown> = {}, status = 200) => ({
  ok: status === 200, status, headers: new Headers(), url: "https://r.jina.ai/https://example.com/",
  text: JSON.stringify({ data: { title: "Serviços do evento", url: "https://example.com/", content: conteudo, httpStatus: 200, ...data } }),
});

describe("Links fornecidos ao contexto", () => {
  it("encontra links com pontuação, markdown, www e parênteses válidos sem duplicar âncoras", () => {
    expect(linksNoPedido("[site](https://example.com/#um). https://example.com/#dois www.example.org; https://example.net/a_(b)"))
      .toEqual(["https://example.com/", "https://www.example.org/", "https://example.net/a_(b)"]);
  });
  it("não encaminha credenciais, rede privada, portas ou protocolos alternativos", () => {
    for (const url of ["https://a:b@example.com", "https://example.com/?token=privado", "https://example.com/?X-Amz-Signature=assinatura", "https://127.0.0.1/", "https://localhost/", "https://example.com:8080", "file:///etc/passwd", "https://example.com/login"]) {
      expect(() => urlPublicaDoContexto(url)).toThrow();
    }
    expect(urlPublicaDoContexto("http://example.com").href).toBe("https://example.com/");
  });
  it("usa host fixo, sem cookies e guarda conteúdo/fonte como material", async () => {
    const leitor = vi.fn(async (_url: string, _options: FetchPublicTextOptions) => pagina());
    const r = await lerLinksDoContexto("Organize https://example.com", { validar, leitor });
    expect(leitor.mock.calls[0][0]).toBe("https://r.jina.ai/https://example.com/");
    expect(leitor.mock.calls[0][1]).toMatchObject({ allowedHostnames: ["r.jina.ai"], maxRedirects: 0, headers: { DNT: "1" } });
    expect(r.lidos[0].texto).toContain(conteudo.trim());
    expect(r.lidos[0].origem).toBe("https://example.com/");
    expect(r.avisos).toEqual([]);
  });
  it("deixa o Drive no importador existente e limita links com aviso", async () => {
    const leitor = vi.fn(async () => pagina());
    const links = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`).join(" ");
    const r = await lerLinksDoContexto(`${links} https://drive.google.com/file/d/abcdefghij12345/view`, { validar, leitor });
    expect(leitor).toHaveBeenCalledTimes(4);
    expect(r.avisos[0]).toContain("6 links externos");
  });
  it("falhas, login, resposta inválida e HTTP de origem não viram conteúdo lido", async () => {
    for (const res of [pagina({}, 429), pagina({ httpStatus: 403 }), pagina({ title: "Sign in to continue" }), pagina({ content: "" }), { ...pagina(), text: "<html>erro</html>" }]) {
      const r = await lerLinksDoContexto("https://example.com", { validar, leitor: async () => res });
      expect(r.fontes).toEqual([]); expect(r.lidos).toEqual([]); expect(r.avisos).toHaveLength(1);
    }
  });
  it("rejeita DNS privado antes da rede e destino privado retornado pelo leitor", async () => {
    const leitor = vi.fn(async () => pagina({ url: "https://127.0.0.1/" }));
    const r = await lerLinksDoContexto("https://example.com", { validar, leitor });
    expect(r.fontes).toHaveLength(0);
    leitor.mockClear();
    await lerLinksDoContexto("https://example.com", { validar: u => assertPublicHttpsUrl(u, async () => ["10.0.0.1"]), leitor });
    expect(leitor).not.toHaveBeenCalled();
  });
  it("sinaliza leitura parcial sem descartar os demais links acessíveis", async () => {
    let n = 0;
    const r = await lerLinksDoContexto("https://example.com https://example.org", { validar, leitor: async () => ++n === 1 ? pagina({}, 403) : pagina({ content: "a".repeat(16_000) }) });
    expect(r.fontes).toHaveLength(1); expect(r.fontes[0].texto).toHaveLength(15_000);
    expect(r.lidos[0].texto).toContain("PARCIAL"); expect(r.avisos).toHaveLength(2);
  });
  it("não ecoa credenciais de URL em avisos nem manda binários ao leitor", async () => {
    const leitor = vi.fn(async () => pagina());
    const r = await lerLinksDoContexto("https://example.com/?token=confidencial https://example.com/filme.mp4", { validar, leitor });
    expect(leitor).not.toHaveBeenCalled(); expect(JSON.stringify(r)).not.toContain("confidencial");
    expect(r.avisos[1]).toContain("transcrição");
  });
});
