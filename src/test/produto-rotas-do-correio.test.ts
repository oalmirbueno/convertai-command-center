import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VOLTAR_PARA, lembrarOrigem, linkDoCorreio, origemDoEndereco } from "@/lib/produto/rotas-do-correio";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

function guardaFalsa() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("rotas do Correio: ir e voltar sem misturar (19/11/2026)", () => {
  it("o link leva a origem e o voltar sabe para onde ir", () => {
    expect(linkDoCorreio("painel")).toBe("/correio?de=painel");
    expect(linkDoCorreio("crm")).toBe("/correio?de=crm");
    expect(linkDoCorreio()).toBe("/correio");
    expect(VOLTAR_PARA.painel.para).toBe("/dashboard");
    expect(VOLTAR_PARA.crm.para).toBe("/app");
    expect(origemDoEndereco("?de=painel&area=quadro")).toBe("painel");
    expect(origemDoEndereco("?de=qualquer")).toBeNull();
  });

  it("a origem fica guardada na aba: trocar de área no Correio não perde o voltar", () => {
    const g = guardaFalsa();
    expect(lembrarOrigem("?de=crm", g)).toBe("crm");
    expect(lembrarOrigem("?area=quadro", g)).toBe("crm");
    expect(lembrarOrigem("", guardaFalsa())).toBeNull();
  });

  it("o painel tem Correio e CRM separados, e o CRM troca para o Correio", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain('{ title: "Correio", url: "/correio?de=painel", icon: Mail }');
    expect(layout).toContain('{ title: "CRM", url: "/app", icon: Boxes }');
    expect(layout).not.toContain('{ title: "CRM e E-mail", url: "/app"');
    const atalho = ler("src/components/produto/AtalhoDoProduto.tsx");
    expect(atalho).toContain('linkDoCorreio("painel")');
    expect(atalho).toContain('troca.abrir("correio")');
    expect(ler("src/pages/ProdutoApp.tsx")).toContain('linkDoCorreio("crm")');
    expect(ler("src/components/produto/TrocaDeAcesso.tsx")).toContain('para: "/correio?de=painel"');
  });

  it("o Correio vira app próprio e o logo mantém a Aceleriq", () => {
    const manifesto = JSON.parse(ler("public/correio.webmanifest"));
    expect(manifesto.start_url).toBe("/correio");
    expect(manifesto.short_name).toBe("Correio");
    expect(manifesto.icons.map((i: { src: string }) => i.src)).toEqual(["/correio-icon-192.png", "/correio-icon-512.png", "/correio-icon-512-maskable.png"]);
    expect(ler("index.html")).toContain('set(\'link[rel="manifest"]\', "href", "/correio.webmanifest")');
    expect(ler("src/pages/Correio.tsx")).toContain('manifestHref: "/correio.webmanifest"');
    expect(ler("src/components/correio/LogoDoCorreio.tsx")).toContain("<MarcaAceleriq");
  });
});
