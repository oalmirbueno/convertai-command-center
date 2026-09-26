import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyComPreCarga, moduloPronto, preCarregarModulo } from "@/lib/lazyComPreCarga";
import { MESAS_DO_PAINEL, cargasDaMesa, chaveDaEtapa, etapaQueVaiAbrir } from "@/lib/mesa/preCarga";
import { BotaoDeTelaCheia, CLASSE_DA_TELA_CHEIA, definirTelaCheia, useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import { chavePersistivel, criarQueryClient, devePersistir, IDADE_MAXIMA_MS } from "@/lib/mesa/cachePersistido";
import type { Query } from "@tanstack/react-query";

/**
 * Frente U (25/09, dono: "eu clico, ele já aparece tudo", "todas as mesas com
 * tela cheia" e "no notebook fica tudo na lateral"). Fixa a pré-carga das
 * mesas, a tela cheia padrão e as grades que desciam para o notebook.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const C1 = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  window.localStorage.clear();
  act(() => definirTelaCheia(false));
  document.body.removeAttribute("data-tela-cheia-da-mesa");
});

describe("tela que baixa antes do clique", () => {
  it("baixa uma vez só e, já baixada, aparece sem passar pelo esqueleto", async () => {
    const carregar = vi.fn(async () => ({ default: () => h("p", null, "Aba pronta") }));
    const Aba = lazyComPreCarga("teste/aba-pronta", carregar);
    await Aba.preCarregar();
    await Aba.preCarregar();
    await preCarregarModulo("teste/aba-pronta", carregar);
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(moduloPronto("teste/aba-pronta")).toBe(true);
    render(h(Suspense, { fallback: h("p", null, "esqueleto") }, h(Aba)));
    // Sem espera nenhuma: o conteúdo já está na primeira pintura.
    expect(screen.getByText("Aba pronta")).toBeTruthy();
    expect(screen.queryByText("esqueleto")).toBeNull();
  });

  it("falha de rede não trava: a próxima tentativa baixa de novo", async () => {
    let vez = 0;
    const carregar = vi.fn(async () => {
      vez += 1;
      if (vez === 1) throw new Error("sem rede");
      return { default: () => null };
    });
    await expect(preCarregarModulo("teste/sem-rede", carregar)).rejects.toThrow("sem rede");
    await preCarregarModulo("teste/sem-rede", carregar);
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});

describe("a etapa baixa junto com a mesa", () => {
  it("usa a etapa do endereço, senão onde parou com o cliente, senão a primeira", () => {
    expect(etapaQueVaiAbrir("/mesa-ads", `?client=${C1}&etapa=estudio`)).toBe("estudio");
    window.localStorage.setItem(`mesa:onde:${C1}`, JSON.stringify({ aba: "mes" }));
    expect(etapaQueVaiAbrir("/mesa", `?client=${C1}`)).toBe("mes");
    expect(etapaQueVaiAbrir("/mesa-foto", `?client=${C1}`)).toBe("acervo");
    expect(etapaQueVaiAbrir("/mesa-foto", `?client=${C1}&etapa=invalida`)).toBe("acervo");
    // Sem cliente, nenhuma etapa; fora das mesas, nada.
    expect(etapaQueVaiAbrir("/mesa-ads", "")).toBeNull();
    expect(etapaQueVaiAbrir("/central", `?client=${C1}`)).toBeNull();
  });

  it("página, etapa e as peças fixas saem juntas; a Mesa sem cliente já traz a fila", () => {
    const foto = cargasDaMesa("/mesa-foto", `?client=${C1}&etapa=ensaio`).map(([k]) => k);
    expect(foto).toEqual(["pagina/mesa-foto", "mesa-foto/ensaio", "mesa-foto/barra-do-ensaio", "mesa-foto/agente-diretor"]);
    expect(cargasDaMesa("/mesa", "").map(([k]) => k)).toEqual(["pagina/mesa", "mesa/fila"]);
    // O Canvas só entra quando o endereço pede o Canvas.
    expect(cargasDaMesa("/mesa-foto", `?client=${C1}`).map(([k]) => k)).not.toContain("mesa-foto/canvas");
  });

  it("as chaves da pré-carga são as mesmas das páginas (mesmo download, mesmo módulo)", () => {
    const paginas: Record<string, string> = { "/mesa": "src/pages/MesaDoCliente.tsx", "/mesa-ads": "src/pages/MesaAds.tsx", "/mesa-foto": "src/pages/MesaFoto.tsx", "/mesa-videos": "src/pages/MesaVideos.tsx", "/mesa-publicidade": "src/pages/MesaPublicidade.tsx", "/mesa-roteiros": "src/pages/MesaRoteiros.tsx" };
    for (const caminho of Object.keys(MESAS_DO_PAINEL) as Array<keyof typeof MESAS_DO_PAINEL>) {
      const fonte = ler(paginas[caminho]);
      const pre = ler("src/lib/mesa/preCarga.ts");
      for (const etapa of Object.keys(MESAS_DO_PAINEL[caminho].etapas)) {
        expect(fonte).toContain(`lazyComPreCarga("${chaveDaEtapa(caminho, etapa)}"`);
      }
      // O mesmo arquivo nos dois lados: cada import da página aparece na pré-carga.
      const imports = fonte.match(/import\("@\/components\/mesa[^"]*\/(Aba|Etapa)[A-Za-z]+"\)/g) || [];
      expect(imports.length).toBeGreaterThan(4);
      for (const i of imports) expect(pre).toContain(i);
    }
  });

  it("as rotas usam a pré-carga, e o painel baixa as mesas no tempo ocioso", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('import { PaginaMesaAds, PaginaMesaDoCliente, PaginaMesaFoto } from "@/lib/mesa/preCarga";');
    expect(app).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaDoCliente /></Suspense>");
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain('usePreCargaOciosaDasMesas(["admin", "manager", "design"].includes(role));');
    // Link entre mesas: mouse em cima já baixa.
    expect(ler("src/components/mesa-foto/TrocaDeMesas.tsx")).toContain("{...propsDePreCarga(enderecoDaMesa(m.valor, clientId, marcaId))}");
  });
});

describe("abertura do painel mais leve", () => {
  it("o assistente de voz e o leitor de PDF saem da abertura", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).not.toContain('import VoiceAssistant from "@/components/admin/VoiceAssistant";');
    expect(layout).toContain('const VoiceAssistant = lazy(() => import("@/components/admin/VoiceAssistant"));');
    const arquivo = ler("src/lib/fileContext.ts");
    expect(arquivo).not.toMatch(/^import \* as pdfjs from "pdfjs-dist";/m);
    expect(arquivo).toContain('import("pdfjs-dist")');
  });

  it("a logo de 1,5 MB saiu de todas as telas; as versões leves têm poucas dezenas de KB", () => {
    const pastas = ["src"];
    const arquivos: string[] = [];
    while (pastas.length) {
      const p = pastas.pop()!;
      for (const nome of readdirSync(resolve(raiz, p))) {
        const rel = `${p}/${nome}`;
        if (statSync(resolve(raiz, rel)).isDirectory()) {
          if (nome !== "test") pastas.push(rel);
        } else if (/\.(tsx?|css)$/.test(nome)) arquivos.push(rel);
      }
    }
    for (const a of arquivos) expect(ler(a)).not.toContain("assets/logo-aceleriq.png");
    expect(statSync(resolve(raiz, "src/assets/logo-aceleriq-256.png")).size).toBeLessThan(20_000);
    expect(statSync(resolve(raiz, "src/assets/logo-aceleriq-640.png")).size).toBeLessThan(40_000);
    expect(statSync(resolve(raiz, "src/assets/consultant-hero-flipped.jpg")).size).toBeLessThan(120_000);
  });
});

describe("primeira tela da Mesa Foto volta do navegador", () => {
  const consulta = (queryKey: unknown[], data: unknown) => ({ queryKey, state: { status: "success", data } }) as unknown as Query;

  it("fotos, kits e ensaios vão; o resto da Mesa Foto não", () => {
    expect(chavePersistivel(["mesa-foto", "acervo", C1])).toBe(true);
    expect(chavePersistivel(["mesa-foto", "kits", C1])).toBe(true);
    expect(chavePersistivel(["mesa-foto", "ensaios", C1])).toBe(true);
    expect(chavePersistivel(["mesa-foto", "biblioteca", C1])).toBe(false);
    expect(chavePersistivel(["mesa-foto", "estimar", C1])).toBe(false);
  });

  it("acervo grande fica só na memória, e o que vai vive 24 h", () => {
    expect(devePersistir(consulta(["mesa-foto", "acervo", C1], [{ id: "1", storage_path: "a.png" }]))).toBe(true);
    const grande = Array.from({ length: 601 }, (_, i) => ({ id: String(i) }));
    expect(devePersistir(consulta(["mesa-foto", "acervo", C1], grande))).toBe(false);
    expect(criarQueryClient().getQueryDefaults(["mesa-foto", "kits", C1]).gcTime).toBe(IDADE_MAXIMA_MS);
  });
});

describe("tela cheia padrão das mesas", () => {
  function Mesa() {
    const tela = useTelaCheiaDaMesa();
    return h("div", { "data-testid": "raiz", className: tela.cheia ? CLASSE_DA_TELA_CHEIA : "" }, h(BotaoDeTelaCheia, { tela }));
  }

  it("o botão liga a sobreposição e marca o body; Esc sai", () => {
    render(h(Mesa));
    const botao = screen.getByRole("button", { name: "Tela cheia" });
    act(() => botao.click());
    expect(screen.getByTestId("raiz").className).toContain(CLASSE_DA_TELA_CHEIA);
    expect(document.body.hasAttribute("data-tela-cheia-da-mesa")).toBe(true);
    expect(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }).getAttribute("aria-pressed")).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.getByTestId("raiz").className).not.toContain(CLASSE_DA_TELA_CHEIA);
    expect(document.body.hasAttribute("data-tela-cheia-da-mesa")).toBe(false);
  });

  it("com uma janela aberta, o Esc é da janela", () => {
    render(h("div", null, h(Mesa), h("div", { role: "dialog" }, "janela")));
    act(() => screen.getByRole("button", { name: "Tela cheia" }).click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.getByTestId("raiz").className).toContain(CLASSE_DA_TELA_CHEIA);
  });

  it("as três mesas usam a mesma peça; o CSS esconde a casca em qualquer largura", () => {
    for (const p of ["src/pages/MesaDoCliente.tsx", "src/pages/MesaAds.tsx", "src/pages/MesaFoto.tsx", "src/pages/MesaVideos.tsx", "src/pages/MesaPublicidade.tsx", "src/pages/MesaRoteiros.tsx"]) {
      const fonte = ler(p);
      expect(fonte).toContain("const telaCheia = useTelaCheiaDaMesa();");
      expect(fonte).toContain("<BotaoDeTelaCheia tela={telaCheia}");
      expect(fonte).toContain("${classeDaRaiz(telaCheia.cheia)}");
      // Celular: o cabeçalho da mesa não gruda (a Mesa Foto passava de 250 px presos no topo).
      expect(fonte).toContain('<header data-cabecalho-da-mesa="" className="relative z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:sticky');
    }
    const css = ler("src/index.css");
    expect(css).toContain('body[data-tela-cheia-da-mesa] [data-casca="rodape"]');
    expect(css).toContain('body[data-tela-cheia-da-mesa] [data-casca="topo"]');
    expect(css).toContain(".mesa-tela-cheia {");
    expect(ler("src/components/AppLayout.tsx")).toContain('<div data-casca="rodape">');
    // O Estúdio usa a mesma regra do Esc (sem cópia).
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain('import { temJanelaAberta } from "./TelaCheiaDaMesa";');
  });
});

describe("notebook: coluna lateral só em tela grande", () => {
  it("Estúdio Ads: copy na terceira coluna só de 1800 px; posicionamentos logo abaixo da arte", () => {
    const f = ler("src/components/mesa-ads/AbaEstudioAds.tsx");
    expect(f).toContain("min-[1800px]:grid-cols-[260px_minmax(0,1fr)_400px]");
    expect(f).not.toContain("2xl:grid-cols-[260px_minmax(0,1fr)_400px]");
    expect(f).not.toContain("lg:ml-[266px]");
    expect(f).toContain('data-posicionamentos=""');
    expect(ler("src/components/mesa-ads/ArteDoCriativo.tsx")).toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
  });

  it("Book da Mesa Foto: o book final desce no notebook", () => {
    const f = ler("src/components/mesa-foto/EtapaBook.tsx");
    expect(f).toContain("min-[1800px]:grid-cols-[260px_minmax(0,1fr)_300px]");
    expect(f).not.toContain("2xl:grid-cols-[260px_minmax(0,1fr)_300px]");
  });
});
