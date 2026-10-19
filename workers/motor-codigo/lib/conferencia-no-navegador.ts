/**
 * Conferência num navegador de verdade (Gravyx, 19/10/2026: page_checks).
 * Depois do build, o motor serve o dist/ nesta máquina, abre cada página no
 * Chromium (o do Playwright que o navegador do agente já baixou, ou o Edge e
 * o Chrome da máquina) em 1440x900 e 390x844 e mede: erro de execução,
 * imagem quebrada, conteúdo vazando para o lado e texto cortado. Tira a capa
 * do site (print do computador). A regra do que é grave mora em
 * supabase/functions/mesa-site/modulos/obra-do-site.ts (a tela e a função
 * usam a mesma).
 *
 * Nunca corrige nada: a correção é um botão na tela (uma passada, com custo).
 * Sem Chromium, devolve "sem_ambiente" e o trabalho segue (aviso).
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import {
  APARELHOS_DA_CONFERENCIA,
  type AparelhoDaConferencia,
  type ConferenciaDoSite,
  juntarProblemas,
  type MedicaoDaPagina,
  type ProblemaDaConferencia,
  problemasDaMedicao,
} from "../../../supabase/functions/mesa-site/modulos/obra-do-site.ts";
import { paginasProntas } from "../modelo-site/scripts/conferir.mjs";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

export const MAX_PAGINAS_NA_CONFERENCIA = 4;

/** O endereço de cada página pronta do dist ("/" e "/sobre/"). */
export function enderecosDasPaginas(dist: string, arquivos: string[]): string[] {
  const enderecos = arquivos
    .map((c) => relative(dist, c).split(sep).join("/"))
    .filter((r) => /\.html$/.test(r) && r.indexOf("..") < 0)
    .map((r) => `/${r.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "/")}`.replace(/\/+/g, "/"));
  const unicos = enderecos.filter((e, i, l) => l.indexOf(e) === i);
  unicos.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.length - b.length));
  return unicos.slice(0, MAX_PAGINAS_NA_CONFERENCIA);
}

/** Serve o dist/ em 127.0.0.1 (porta livre). Só arquivos de dentro do dist. */
export function servirDist(dist: string): Promise<{ url: string; fechar: () => Promise<void> }> {
  const raiz = normalize(dist);
  const servidor: Server = createServer((req, res) => {
    try {
      const caminho = decodeURIComponent(String(req.url || "/").split("?")[0].split("#")[0]);
      let arquivo = normalize(join(raiz, caminho));
      if (arquivo.indexOf(raiz) !== 0) {
        res.writeHead(403).end();
        return;
      }
      if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, "index.html");
      if (!existsSync(arquivo) && existsSync(`${arquivo}.html`)) arquivo = `${arquivo}.html`;
      if (!existsSync(arquivo)) {
        res.writeHead(404, { "content-type": "text/plain" }).end("não achado");
        return;
      }
      res.writeHead(200, { "content-type": TIPOS[extname(arquivo).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      res.end(readFileSync(arquivo));
    } catch {
      res.writeHead(500).end();
    }
  });
  return new Promise((resolver, rejeitar) => {
    servidor.on("error", rejeitar);
    servidor.listen(0, "127.0.0.1", () => {
      const end = servidor.address();
      const porta = typeof end === "object" && end ? end.port : 0;
      resolver({ url: `http://127.0.0.1:${porta}`, fechar: () => new Promise<void>((r) => servidor.close(() => r())) });
    });
  });
}

/**
 * O que roda dentro da página (vai como texto para o Chromium: JavaScript
 * puro, sem tipo). O caminho do elemento é o mesmo da tela (tag:nth-of-type
 * a partir do body), para o "Ir até o problema".
 */
export const SCRIPT_DA_MEDICAO = `(() => {
  // A largura do aparelho (no celular emulado, o Chromium alarga a janela quando a página vaza).
  const W = Number("__LARGURA__") || window.innerWidth;
  const doc = document.documentElement;
  const largura = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const caminho = (el) => {
    const partes = [];
    let atual = el;
    while (atual && atual.tagName && atual.tagName.toLowerCase() !== "html") {
      const tag = atual.tagName.toLowerCase();
      if (tag === "body") { partes.unshift("body"); break; }
      const pai = atual.parentElement;
      if (!pai) return null;
      let n = 0, i = 0;
      for (let k = 0; k < pai.children.length; k++) {
        const irmao = pai.children[k];
        if (irmao.tagName === atual.tagName) { i += 1; if (irmao === atual) n = i; }
      }
      partes.unshift(tag + ":nth-of-type(" + n + ")");
      atual = pai;
    }
    return partes.join(">");
  };
  const secao = (el) => { const s = el.closest ? el.closest("[data-secao]") : null; return s ? s.getAttribute("data-secao") : null; };
  const texto = (el) => String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120);
  const visivel = (el, st) => {
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const vazando = [];
  if (largura > W + 1 && document.body) {
    const todos = document.body.querySelectorAll("*");
    for (let k = 0; k < todos.length && vazando.length < 5; k++) {
      const el = todos[k];
      const st = getComputedStyle(el);
      if (st.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.right <= W + 1 || r.width === 0 || !visivel(el, st)) continue;
      const pai = el.parentElement;
      if (pai && pai !== document.body && pai.getBoundingClientRect().right > W + 1) continue;
      vazando.push({ caminho: caminho(el), secao: secao(el), texto: texto(el).slice(0, 80), direita: r.right + window.scrollX });
    }
  }
  const imagens = [];
  const imgs = document.images;
  for (let k = 0; k < imgs.length && imagens.length < 6; k++) {
    const i = imgs[k];
    const src = i.currentSrc || i.src || "";
    if (!src || !i.complete || i.naturalWidth > 0) continue;
    imagens.push({ src: src.slice(0, 300), caminho: caminho(i), secao: secao(i) });
  }
  const cortados = [];
  const textuais = document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,button,span,label,blockquote,figcaption,td,th,summary");
  for (let k = 0; k < textuais.length && cortados.length < 6; k++) {
    const el = textuais[k];
    if (el.closest("script,style,noscript,template,[aria-hidden='true'],[hidden]")) continue;
    let proprio = "";
    for (let n = 0; n < el.childNodes.length; n++) if (el.childNodes[n].nodeType === 3) proprio += el.childNodes[n].textContent || "";
    if (proprio.replace(/\\s+/g, "").length < 3) continue;
    const st = getComputedStyle(el);
    if (!visivel(el, st)) continue;
    const corta = /hidden|clip/.test(st.overflowX + " " + st.overflowY) || st.textOverflow === "ellipsis" || (st.webkitLineClamp && st.webkitLineClamp !== "none");
    if (!corta) continue;
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) cortados.push({ caminho: caminho(el), secao: secao(el), texto: texto(el) });
  }
  return { largura_da_tela: W, largura_da_pagina: largura, vazando, imagens, cortados };
})()`;

type Navegador = { newContext: (o: Record<string, unknown>) => Promise<Contexto>; close: () => Promise<void> };
type Contexto = { newPage: () => Promise<Pagina>; close: () => Promise<void> };
type Pagina = {
  on: (ev: string, fn: (x: any) => void) => void;
  goto: (url: string, o: Record<string, unknown>) => Promise<{ status: () => number } | null>;
  evaluate: (s: string) => Promise<any>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (o: Record<string, unknown>) => Promise<Uint8Array>;
};

/** Abre o Chromium: o do Playwright, o caminho em MOTOR_CHROMIUM, o Edge ou o Chrome da máquina. */
export async function abrirNavegador(): Promise<{ navegador: Navegador; como: string } | { erro: string }> {
  let pw: { chromium: { launch: (o: Record<string, unknown>) => Promise<Navegador> } };
  try {
    pw = (await import("playwright-core")) as unknown as typeof pw;
  } catch {
    return { erro: "o playwright-core não está instalado no worker (npm install em workers/motor-codigo)" };
  }
  const tentativas: Array<{ como: string; op: Record<string, unknown> }> = [];
  if (process.env.MOTOR_CHROMIUM) tentativas.push({ como: "MOTOR_CHROMIUM", op: { executablePath: process.env.MOTOR_CHROMIUM } });
  tentativas.push({ como: "chromium do playwright", op: {} }, { como: "edge da máquina", op: { channel: "msedge" } }, { como: "chrome da máquina", op: { channel: "chrome" } });
  let ultimo = "";
  for (const t of tentativas) {
    try {
      const navegador = await pw.chromium.launch({ headless: true, timeout: 30_000, args: ["--no-first-run", "--no-default-browser-check"], ...t.op });
      return { navegador, como: t.como };
    } catch (e) {
      ultimo = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "erro";
    }
  }
  return { erro: `nenhum Chromium abriu nesta máquina (${ultimo})` };
}

/** Rola a página até o fim (revela as animações e as imagens preguiçosas) e volta ao topo. */
const SCRIPT_DA_ROLAGEM = `(async () => {
  const passo = Math.max(300, Math.floor(window.innerHeight * 0.8));
  const fim = Math.min(document.documentElement.scrollHeight, 40000);
  for (let y = 0; y < fim; y += passo) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 400));
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  return true;
})()`;

/** Mede uma página num aparelho; a capa sai do computador na primeira página. */
async function medirPagina(nav: Navegador, url: string, aparelho: { id: AparelhoDaConferencia; largura: number; altura: number }, comCapa: boolean): Promise<{ medicao: MedicaoDaPagina; capa: Uint8Array | null }> {
  const ctx = await nav.newContext({ viewport: { width: aparelho.largura, height: aparelho.altura }, deviceScaleFactor: 1, isMobile: aparelho.id === "celular", hasTouch: aparelho.id === "celular", reducedMotion: "no-preference" });
  const erros: string[] = [];
  try {
    const p = await ctx.newPage();
    p.on("pageerror", (e: { message?: string }) => erros.push(`${e && e.message ? e.message : e}`));
    p.on("console", (m: { type: () => string; text: () => string }) => {
      if (m.type() === "error") erros.push(m.text());
    });
    // Script e estilo que não carregam quebram a página sem erro de execução: viram erro com o nome do arquivo.
    p.on("response", (r: { status: () => number; url: () => string; request: () => { resourceType: () => string } }) => {
      try {
        const tipo = r.request().resourceType();
        if (r.status() >= 400 && (tipo === "script" || tipo === "stylesheet")) erros.push(`o arquivo ${r.url().split("?")[0].split("/").pop() || tipo} não carregou (${r.status()})`);
      } catch {
        /* resposta sem pedido: ignora */
      }
    });
    let status: number | null = null;
    try {
      const r = await p.goto(url, { waitUntil: "load", timeout: 30_000 });
      status = r ? r.status() : null;
    } catch (e) {
      return { medicao: { carregou: false, status, largura_da_tela: aparelho.largura, largura_da_pagina: aparelho.largura, vazando: [], imagens: [], cortados: [], erros: [e instanceof Error ? e.message.split("\n")[0] : "não abriu"] }, capa: null };
    }
    await p.waitForTimeout(600);
    await p.evaluate(SCRIPT_DA_ROLAGEM).catch(() => undefined);
    await p.waitForTimeout(500);
    const m = (await p.evaluate(SCRIPT_DA_MEDICAO.replace("__LARGURA__", String(aparelho.largura)))) as Omit<MedicaoDaPagina, "carregou" | "status" | "erros">;
    const capa = comCapa ? await p.screenshot({ type: "jpeg", quality: 72 }).catch(() => null) : null;
    return { medicao: { ...m, carregou: true, status, erros: erros.slice(0, 10) }, capa: capa ? new Uint8Array(capa) : null };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * A conferência inteira do projeto (o build já rodou). `subirCapa` guarda o
 * print e devolve onde ficou (bucket e caminho), ou null.
 */
export async function conferirNoNavegador(pasta: string, op: { subirCapa?: (bytes: Uint8Array) => Promise<{ bucket: string; path: string } | null> } = {}): Promise<ConferenciaDoSite> {
  const em = new Date().toISOString();
  const dist = join(pasta, "dist");
  const vazia = (estado: ConferenciaDoSite["estado"], motivo: string): ConferenciaDoSite => ({ estado, motivo, em, paginas: [], problemas: [], graves: 0, capa: null });
  if (!existsSync(join(dist, "index.html"))) return vazia("erro", "o build não deixou o dist/index.html");
  let paginas: string[] = [];
  try {
    paginas = enderecosDasPaginas(dist, paginasProntas(dist) as string[]);
  } catch {
    paginas = ["/"];
  }
  if (!paginas.length) paginas = ["/"];
  const aberto = await abrirNavegador();
  if ("erro" in aberto) return vazia("sem_ambiente", aberto.erro);
  let servidor: { url: string; fechar: () => Promise<void> } | null = null;
  try {
    servidor = await servirDist(dist);
    const listas: ProblemaDaConferencia[][] = [];
    let capa: { bucket: string; path: string } | null = null;
    for (const aparelho of APARELHOS_DA_CONFERENCIA) {
      for (let i = 0; i < paginas.length; i++) {
        const comCapa = aparelho.id === "computador" && i === 0 && !!op.subirCapa;
        const r = await medirPagina(aberto.navegador, `${servidor.url}${paginas[i]}`, aparelho, comCapa);
        listas.push(problemasDaMedicao(r.medicao, aparelho.id, paginas[i]));
        if (r.capa && op.subirCapa) capa = await op.subirCapa(r.capa).catch(() => null);
      }
    }
    const problemas = juntarProblemas(listas);
    return { estado: "pronto", motivo: null, em, paginas, problemas, graves: problemas.filter((p) => p.grave).length, capa };
  } catch (e) {
    return vazia("erro", e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "a conferência falhou");
  } finally {
    if (servidor) await servidor.fechar().catch(() => undefined);
    await aberto.navegador.close().catch(() => undefined);
  }
}

/** Uma linha para o evento da conferência. */
export function resumoDaConferencia(c: ConferenciaDoSite): string {
  if (c.estado === "sem_ambiente") return `Conferência no navegador não rodou: ${c.motivo || "sem Chromium"}`;
  if (c.estado === "erro") return `Conferência no navegador falhou: ${c.motivo || "erro"}`;
  const n = c.problemas.length;
  const telas = `${c.paginas.length} ${c.paginas.length === 1 ? "página" : "páginas"} no computador e no celular`;
  if (!n) return `Conferido no navegador (${telas}): nada a corrigir`;
  return `Conferido no navegador (${telas}): ${n} ${n === 1 ? "ponto" : "pontos"}${c.graves ? `, ${c.graves} ${c.graves === 1 ? "grave" : "graves"}` : ""}`;
}

/** Os problemas da correção (pedido.pacote.correcao.problemas). */
export function problemasDoPedido(v: unknown): ProblemaDaConferencia[] {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return (Array.isArray(o.problemas) ? o.problemas : [])
    .filter((p): p is ProblemaDaConferencia => !!p && typeof p === "object" && typeof (p as ProblemaDaConferencia).texto === "string")
    .slice(0, 12);
}
