import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { destinosDaBarra, rotaNaBarra } from "@/components/MobileBottomNav";
import { tituloDaTela } from "@/components/AppLayout";

// 16/10/2026 (dono: "otimizar o mobile, cara de aplicativo, mais clean, sem tela se mexendo").
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("casca do celular", () => {
  it("barra de baixo: 4 destinos por papel (o 5º é o Mais), rótulo curto, Agenda em todos", () => {
    for (const papel of ["admin", "manager", "design", "traffic", "client"]) {
      const d = destinosDaBarra(papel);
      expect(d).toHaveLength(4);
      expect(d.map((x) => x.url)).toContain("/calendario");
      for (const x of d) expect(x.title.length).toBeLessThanOrEqual(12);
    }
    expect(destinosDaBarra("admin").map((x) => x.url)).toEqual(["/dashboard", "/central", "/calendario", "/clientes"]);
    expect(destinosDaBarra("client").map((x) => x.url)).toEqual(["/dashboard", "/onde-estamos", "/aprovacoes", "/calendario"]);
  });

  it("o Mais acende quando a tela não está na barra", () => {
    const d = destinosDaBarra("admin");
    expect(rotaNaBarra("/clientes/abc", d)).toBe(true);
    expect(rotaNaBarra("/kanban", d)).toBe(false);
  });

  it("nome da tela no topo: o item mais longo que casa com a rota", () => {
    const paginas = [
      { title: "Visão geral", url: "/comercial" },
      { title: "CRM", url: "/comercial/crm" },
      { title: "Clientes", url: "/clientes" },
    ];
    expect(tituloDaTela("/comercial/crm", paginas)).toBe("CRM");
    expect(tituloDaTela("/comercial", paginas)).toBe("Comercial");
    expect(tituloDaTela("/clientes/123", paginas)).toBe("Clientes");
    expect(tituloDaTela("/mesa-foto", paginas)).toBe("Mesa Foto");
  });

  it("no celular a casca não monta o topo flutuante; topo enxuto e folha Mais no lugar do menu em gaveta", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain('{!celular && <nav data-casca="topo"');
    expect(layout).toContain('data-topo-do-celular=""');
    expect(layout).not.toContain("mobileMenuOpen");
    expect(layout).toContain("top-[calc(env(safe-area-inset-top)+52px)] bottom-[calc(env(safe-area-inset-bottom)+56px)]");
  });

  it("sem tela se mexendo: sem elástico, sem clarão no toque, folhas sobem de baixo; diálogo vira folha só abaixo de 640 px", () => {
    const css = ler("src/index.css");
    expect(css).toMatch(/@media \(max-width: 767px\) \{\s*html \{\s*overscroll-behavior: none;/);
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
    expect(css).toContain("@keyframes subir-da-base");
    expect(ler("src/styles/responsive.css")).toContain("font-size: 16px !important");
    const dialogo = ler("src/components/ui/dialog.tsx");
    expect(dialogo).toContain('data-dialogo-do-painel=""');
    expect(dialogo).toContain("max-sm:top-auto");
    expect(dialogo).not.toMatch(/(^|\s)sm:top-auto/);
  });
});
