import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarServiceWorker } from "@/lib/registrarServiceWorker";

/** 09/11/2026 (dono): "o PWA funcionando nos Android, mais bonito e mais rápido". */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

type Ouvinte = (e: Record<string, unknown>) => void;

/** Roda o public/sw.js de verdade com um navegador de mentira: caches, fetch e relógio controlados. */
function montarSw(opcoes: { rede: (url: string) => Promise<Response> | Response }) {
  const ouvintes: Record<string, Ouvinte> = {};
  const guardados = new Map<string, Response>();
  const cache = {
    match: async (chave: string | Request) => {
      const r = guardados.get(typeof chave === "string" ? chave : new URL(chave.url).pathname);
      return r ? r.clone() : undefined;
    },
    put: async (chave: string | Request, r: Response) => { guardados.set(typeof chave === "string" ? chave : new URL(chave.url).pathname, r); },
    keys: async () => [...guardados.keys()].map((k) => ({ url: `https://painel.test${k}` })),
    delete: async (chave: { url: string }) => guardados.delete(new URL(chave.url).pathname),
  };
  const escopo = {
    location: { origin: "https://painel.test" },
    addEventListener: (nome: string, f: Ouvinte) => { ouvintes[nome] = f; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    registration: { unregister: vi.fn() },
  };
  const buscar = vi.fn((pedido: Request) => Promise.resolve(opcoes.rede(pedido.url)));
  new Function("self", "caches", "fetch", "URL", "setTimeout", "clearTimeout", ler("public/sw.js"))(
    escopo, { open: async () => cache, keys: async () => ["painel-v1", "velho"], delete: vi.fn(async () => true) }, buscar, URL, setTimeout, clearTimeout,
  );
  const pedir = (url: string, extra: { mode?: string; destination?: string; method?: string } = {}) => {
    let resposta: Promise<Response> | null = null;
    const pedido = { url, method: extra.method ?? "GET", mode: extra.mode ?? "cors", destination: extra.destination ?? "", headers: new Headers() };
    ouvintes.fetch({ request: pedido, respondWith: (r: Promise<Response>) => { resposta = r; } });
    return resposta as Promise<Response> | null;
  };
  return { pedir, guardados, buscar, ouvintes, escopo };
}

const html = (texto = "<html>casca</html>") => new Response(texto, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const js = (texto = "export{}") => new Response(texto, { status: 200, headers: { "content-type": "text/javascript" } });
// O Response do teste não traz `type`; no navegador, resposta do próprio site é "basic".
const basica = (r: Response) => Object.defineProperty(r, "type", { value: "basic" });
const NAVEGAR = { mode: "navigate", destination: "document" };

describe("service worker do painel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("página: com rede, vale a rede (a versão nova chega na hora) e a casca fica guardada", async () => {
    const sw = montarSw({ rede: () => basica(html("<html>nova</html>")) });
    const r = await sw.pedir("https://painel.test/clientes", NAVEGAR)!;
    expect(await r.text()).toBe("<html>nova</html>");
    await vi.runAllTimersAsync();
    expect(sw.guardados.has("/__casca__")).toBe(true);
  });

  it("página: sem rede, abre a última casca em vez da página de erro do navegador", async () => {
    let cair = false;
    const sw = montarSw({ rede: () => (cair ? Promise.reject(new TypeError("Failed to fetch")) : basica(html())) });
    await sw.pedir("https://painel.test/", NAVEGAR);
    await vi.runAllTimersAsync();
    cair = true;
    const r = await sw.pedir("https://painel.test/financeiro", NAVEGAR)!;
    expect(await r.text()).toBe("<html>casca</html>");
  });

  it("página: rede travada por mais de 4 s abre a casca guardada", async () => {
    let travar = false;
    const sw = montarSw({ rede: () => (travar ? new Promise<Response>(() => {}) : basica(html())) });
    await sw.pedir("https://painel.test/", NAVEGAR);
    await vi.runAllTimersAsync();
    travar = true;
    const espera = sw.pedir("https://painel.test/mesa", NAVEGAR)!;
    await vi.advanceTimersByTimeAsync(4100);
    expect(await (await espera).text()).toBe("<html>casca</html>");
  });

  it("página: primeira visita sem rede não inventa nada (o erro é o da rede)", async () => {
    const sw = montarSw({ rede: () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(sw.pedir("https://painel.test/", NAVEGAR)).rejects.toThrow("Failed to fetch");
  });

  it("pedaço com hash: a segunda vez nem vai à rede", async () => {
    const sw = montarSw({ rede: () => basica(js("codigo")) });
    await sw.pedir("https://painel.test/assets/index-abc.js");
    await vi.runAllTimersAsync();
    const r = await sw.pedir("https://painel.test/assets/index-abc.js")!;
    expect(await r.text()).toBe("codigo");
    expect(sw.buscar).toHaveBeenCalledTimes(1);
  });

  it("HTML no lugar de um pedaço nunca é guardado (publicação pela metade, 15/10)", async () => {
    const sw = montarSw({ rede: () => basica(html()) });
    await sw.pedir("https://painel.test/assets/sumiu-123.js");
    await vi.runAllTimersAsync();
    expect(sw.guardados.has("/assets/sumiu-123.js")).toBe(false);
  });

  it("não toca no que não é dele: banco, version.json, envio, quadro e arquivo .html", () => {
    const sw = montarSw({ rede: () => basica(html()) });
    expect(sw.pedir("https://x.supabase.co/rest/v1/billing")).toBeNull();
    expect(sw.pedir("https://painel.test/version.json")).toBeNull();
    expect(sw.pedir("https://painel.test/assets/a.js", { method: "POST" })).toBeNull();
    expect(sw.pedir("https://painel.test/mesa?embutido=1", { mode: "navigate", destination: "iframe" })).toBeNull();
    expect(sw.pedir("https://painel.test/editor/base.html", NAVEGAR)).toBeNull();
  });

  it("navegador antigo (sem destination) também recebe a casca; e o arquivo não usa sintaxe nova", async () => {
    const sw = montarSw({ rede: () => basica(html()) });
    expect(sw.pedir("https://painel.test/", { mode: "navigate", destination: "" })).not.toBeNull();
    const fonte = ler("public/sw.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/=>|\bconst\b|\blet\b|\basync\b|\bawait\b|\?\.|\?\?|`/);
  });
});

describe("registro do service worker", () => {
  const registrar = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    registrar.mockClear();
    Object.defineProperty(navigator, "serviceWorker", { value: { register: registrar }, configurable: true });
  });

  it("só no site publicado, nunca em desenvolvimento", () => {
    expect(registrarServiceWorker("dev")).toBe(false);
    expect(registrarServiceWorker("mw9-abc")).toBe(true);
    window.dispatchEvent(new Event("load"));
    expect(registrar).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("entra na abertura do painel e é servido sem cache", () => {
    expect(ler("src/main.tsx")).toContain("registrarServiceWorker();");
    expect(ler("public/_headers")).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
    expect(ler("config/csp.ts")).toContain("worker-src 'self'");
  });
});

describe("manifesto e ícones para o Android", () => {
  const m = JSON.parse(ler("public/manifest.webmanifest"));

  it("instalável: nome, início, tela cheia e ícones de 192 e 512", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    const tamanhos = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(tamanhos).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable", "512x512 monochrome"]));
    for (const i of m.icons) expect(existsSync(resolve(process.cwd(), `public${i.src}`)), i.src).toBe(true);
  });

  it("atalhos ao segurar o ícone só para telas que cliente e equipe têm", () => {
    expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/aprovacoes", "/calendario", "/financeiro"]);
    const rotas = ler("src/App.tsx");
    for (const s of m.shortcuts) expect(rotas).toContain(`path="${s.url}"`);
  });
});

describe("fontes dentro do painel", () => {
  it("nada de outro site segura a primeira pintura", () => {
    const html = ler("index.html");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  it("as duas famílias, com todos os pesos usados, em arquivos que existem", () => {
    const css = ler("src/styles/fontes.css");
    expect(css.match(/font-family: "Outfit"/g)).toHaveLength(2);
    expect(css.match(/font-family: "JetBrains Mono"/g)).toHaveLength(2);
    expect(css).toContain("font-weight: 300 800;");
    expect(css.match(/font-display: swap/g)).toHaveLength(4);
    for (const [, arquivo] of css.matchAll(/url\("\.\.\/assets\/fonts\/([^"]+)"\)/g)) {
      expect(existsSync(resolve(process.cwd(), `src/assets/fonts/${arquivo}`)), arquivo).toBe(true);
    }
    expect(ler("src/main.tsx").indexOf('"./styles/fontes.css"')).toBeLessThan(ler("src/main.tsx").indexOf('"./index.css"'));
  });
});
