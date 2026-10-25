/**
 * Captura da referência (frente MCC, 25/10/2026). O agente não tem internet:
 * quem abre o site de referência é o motor, no Chromium do Playwright (o
 * mesmo da conferência no navegador), e deixa no projeto só o que o agente
 * precisa para seguir a FORMA:
 *   referencias/referencia/computador-N.jpg (a página em fatias de 1800 px, 1440 de largura)
 *   referencias/referencia/celular-N.jpg    (a página em fatias de 1700 px, 390 de largura)
 *   referencias/referencia/estrutura.json  (seções na ordem com altura,
 *     colunas, alinhamento, fundo, título (tamanho e número de palavras, sem o
 *     texto), imagens e botões; menu; tokens de tipografia, cores, cantos,
 *     espaçamento e largura; e a medida no celular)
 * Os textos da referência ficam FORA do projeto (na pasta do motor), só para
 * a conferência de autoria no fim (o site final não pode ter trecho longo
 * deles). É o passo "observar" do ai-website-cloner-template (MIT), feito
 * pelo motor.
 *
 * Segurança: só endereço público (o mesmo filtro da tela, mais a resolução do
 * nome: nada que caia em rede interna); o navegador bloqueia pedido para rede
 * interna durante a captura; prazo de 60 s; nada da referência é executado
 * na máquina fora do Chromium.
 */
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { urlPublicaDaReferencia } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site.ts";
import { PASTA_DA_REFERENCIA } from "../../../supabase/functions/mesa-site/modulos/partida-no-motor.ts";
import { abrirNavegador } from "./conferencia-no-navegador.ts";

/** Endereço IP de rede interna, laço local, link local ou reservado (v4 e v6). */
export function ipInterno(ip: string): boolean {
  const s = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s.replace(/^::ffff:/, ""));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (s.indexOf(":") >= 0) return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  return false;
}

/** Host que não pode ser aberto na captura (nome local ou IP interno escrito no endereço). */
export function hostBloqueado(host: string): boolean {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) return true;
  return ipInterno(h);
}

/** A referência pode ser aberta? Endereço público e nome que não resolve para rede interna. */
export async function conferirReferencia(bruta: string, resolver: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((x) => x.address)): Promise<{ ok: boolean; url: string | null; motivo: string | null }> {
  const url = urlPublicaDaReferencia(bruta);
  if (!url) return { ok: false, url: null, motivo: "o endereço da referência não é um site público" };
  const host = new URL(url).hostname;
  if (hostBloqueado(host)) return { ok: false, url: null, motivo: "o endereço da referência aponta para a rede interna" };
  let ips: string[] = [];
  try {
    ips = await resolver(host);
  } catch {
    return { ok: false, url: null, motivo: `o endereço ${host} não foi achado` };
  }
  if (!ips.length || ips.some(ipInterno)) return { ok: false, url: null, motivo: "o endereço da referência aponta para a rede interna" };
  return { ok: true, url, motivo: null };
}

/** Mede a página no navegador. Volta { estrutura, textos }; o texto nunca vai para a estrutura. */
export const SCRIPT_DA_REFERENCIA = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const hex = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(parseFloat); if (p.length > 3 && p[3] < 0.1) return null; return '#' + p.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); };
  const fundo = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); const c = hex(cs.backgroundColor); if (c) return c; if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'imagem'; } return hex(getComputedStyle(document.body).backgroundColor) || '#ffffff'; };
  const topo = (el) => el.getBoundingClientRect().top + window.scrollY;
  const largura = window.innerWidth;
  // Os blocos: desce pelos invólucros de um filho só até achar a lista de seções.
  let raiz = document.querySelector('main') || document.body;
  for (let i = 0; i < 6; i++) { const f = Array.from(raiz.children).filter(vis); if (f.length === 1 && f[0].children.length) raiz = f[0]; else break; }
  let blocos = Array.from(raiz.children).filter((e) => vis(e) && e.getBoundingClientRect().height >= 60 && !/^(SCRIPT|STYLE|NOSCRIPT|LINK)$/.test(e.tagName));
  const cab = document.querySelector('header'); const rod = document.querySelector('footer');
  if (cab && vis(cab) && blocos.indexOf(cab) < 0 && !blocos.some((b) => b.contains(cab))) blocos.unshift(cab);
  if (rod && vis(rod) && blocos.indexOf(rod) < 0 && !blocos.some((b) => b.contains(rod))) blocos.push(rod);
  blocos = blocos.slice(0, 40);
  const colunas = (b) => { let max = 1; const w = b.getBoundingClientRect().width; b.querySelectorAll('*').forEach((e) => { if (e.children.length < 2 || e.children.length > 12) return; const filhos = Array.from(e.children).filter((x) => vis(x) && x.getBoundingClientRect().width > w * 0.12); const linhas = {}; filhos.forEach((x) => { const t = Math.round(x.getBoundingClientRect().top / 12); linhas[t] = (linhas[t] || 0) + 1; }); Object.keys(linhas).forEach((k) => { if (linhas[k] > max) max = linhas[k]; }); }); return Math.min(max, 6); };
  const palavras = (t) => String(t || '').trim().split(/\\s+/).filter(Boolean).length;
  const secoes = blocos.map((b, i) => {
    const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    const h = b.querySelector('h1, h2, h3');
    const hs = h ? getComputedStyle(h) : null;
    const tag = b.tagName.toLowerCase();
    const papel = tag === 'header' || (i === 0 && r.height < 160) ? 'topo' : tag === 'footer' || i === blocos.length - 1 && r.height < 500 ? 'rodape' : b.querySelector('h1') ? 'abertura' : b.querySelector('form, input[type=email], textarea') ? 'formulario' : b.querySelectorAll('img, picture, video').length >= 4 ? 'galeria' : b.querySelector('details, [aria-expanded]') ? 'perguntas' : 'conteudo';
    return {
      ordem: i + 1,
      papel,
      tag,
      altura: Math.round(r.height),
      altura_em_telas: Math.round((r.height / window.innerHeight) * 10) / 10,
      colunas: colunas(b),
      fundo: fundo(b),
      alinhamento: hs ? hs.textAlign : cs.textAlign,
      espaco_interno: { topo: parseFloat(cs.paddingTop) || 0, base: parseFloat(cs.paddingBottom) || 0 },
      titulo: h ? { nivel: h.tagName.toLowerCase(), tamanho: parseFloat(hs.fontSize), peso: hs.fontWeight, palavras: palavras(h.innerText), caixa: hs.textTransform } : null,
      imagens: b.querySelectorAll('img, picture, svg image, video').length,
      video: !!b.querySelector('video, iframe[src*=youtube], iframe[src*=vimeo]'),
      botoes: Array.from(b.querySelectorAll('a, button')).filter((x) => vis(x) && (x.tagName === 'BUTTON' || /btn|button|botao|cta/i.test(x.className || '') || hex(getComputedStyle(x).backgroundColor))).length,
      links: b.querySelectorAll('a').length,
      fixo: cs.position === 'fixed' || cs.position === 'sticky',
      fundo_com_imagem: cs.backgroundImage && cs.backgroundImage !== 'none',
    };
  });
  // Tokens: fontes, cores (por área), cantos, espaçamento e largura.
  const fonte = (sel) => { const e = Array.from(document.querySelectorAll(sel)).find(vis); if (!e) return null; const cs = getComputedStyle(e); return { familia: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), tamanho: parseFloat(cs.fontSize), peso: cs.fontWeight, entrelinha: cs.lineHeight, espacamento: cs.letterSpacing, caixa: cs.textTransform }; };
  const area = {}; const texto = {};
  document.querySelectorAll('body *').forEach((e) => { if (!vis(e)) return; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); const b = hex(cs.backgroundColor); if (b) area[b] = (area[b] || 0) + r.width * r.height; if (e.childNodes.length && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) { const c = hex(cs.color); if (c) texto[c] = (texto[c] || 0) + 1; } });
  const top = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n);
  const cantos = {}; document.querySelectorAll('a, button, img, [class*=card], [class*=Card]').forEach((e) => { if (!vis(e)) return; const r = getComputedStyle(e).borderTopLeftRadius; if (r && r !== '0px') cantos[r] = (cantos[r] || 0) + 1; });
  const larguras = {}; document.querySelectorAll('body *').forEach((e) => { const cs = getComputedStyle(e); if (cs.maxWidth && cs.maxWidth !== 'none' && /px$/.test(cs.maxWidth) && (cs.marginLeft === 'auto' || cs.marginLeft === cs.marginRight)) larguras[cs.maxWidth] = (larguras[cs.maxWidth] || 0) + 1; });
  const espacos = secoes.map((s) => s.espaco_interno.topo).filter((v) => v > 0).sort((a, b) => a - b);
  const nav = document.querySelector('header nav, nav');
  const estrutura = {
    largura_da_tela: largura,
    altura_total: Math.round(document.documentElement.scrollHeight),
    secoes,
    menu: nav ? { itens: Array.from(nav.querySelectorAll('a')).filter(vis).length, fixo: !!(cab && /fixed|sticky/.test(getComputedStyle(cab).position)), com_botao: !!nav.querySelector('button, [class*=btn], [class*=button]') } : null,
    tokens: {
      fontes: { titulo_1: fonte('h1'), titulo_2: fonte('h2'), corpo: fonte('p'), botao: fonte('button, a[class*=btn], a[class*=button]') },
      cores_de_fundo: top(area, 6),
      cores_de_texto: top(texto, 5),
      cantos: top(cantos, 3),
      espaco_entre_secoes_px: espacos.length ? espacos[Math.floor(espacos.length / 2)] : null,
      largura_do_conteudo: top(larguras, 2),
    },
  };
  const textos = [];
  document.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, figcaption, a, button, td, span, label').forEach((e) => { if (!vis(e)) return; const t = (e.innerText || '').replace(/\\s+/g, ' ').trim(); if (t.length >= 30 && t.length <= 1200) textos.push(t); });
  return { estrutura, textos: Array.from(new Set(textos)).slice(0, 600), titulo: document.title };
})()`;

const ROLAGEM = `(async () => {
  const passo = Math.max(300, Math.floor(window.innerHeight * 0.8));
  const fim = Math.min(document.documentElement.scrollHeight, 30000);
  for (let y = 0; y < fim; y += passo) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 500));
  return true;
})()`;

export type ReferenciaCapturada = { url: string; pasta: string; secoes: number; textos: number; de_cache: boolean; aviso: string | null };

/** A pasta (fora do projeto) com os textos da referência para a conferência de autoria. */
export const arquivoDosTextos = (pastaProjetos: string, url: string) => join(pastaProjetos, "_referencias", `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`);

/** Os textos guardados da referência (para a conferência de autoria). */
export function textosDaReferencia(pastaProjetos: string, url: string): string[] {
  try {
    const j = JSON.parse(readFileSync(arquivoDosTextos(pastaProjetos, url), "utf8")) as { textos?: unknown };
    return Array.isArray(j.textos) ? j.textos.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

const ALTURA_MAXIMA = { computador: 14_000, celular: 16_000 };
/** Cada print é uma fatia da página (a API de imagem recusa imagem com mais de 8.000 px de lado). */
export const FATIA = { computador: 1800, celular: 1700, maximo: 8 };

/** As fatias (y e altura) de uma página de `total` px. */
export function fatiasDaPagina(total: number, fatia: number, maximo = FATIA.maximo): Array<{ y: number; altura: number }> {
  const saida: Array<{ y: number; altura: number }> = [];
  for (let y = 0; y < total && saida.length < maximo; y += fatia) saida.push({ y, altura: Math.min(fatia, total - y) });
  return saida.filter((x) => x.altura > 40);
}

/**
 * Captura a referência para o projeto (uma vez por endereço: a mesma
 * referência no mesmo projeto não é aberta de novo). Falha = erro com motivo
 * (o trabalho para antes de gastar com o modelo).
 */
// deno-lint-ignore no-explicit-any
export async function capturarReferencia(pasta: string, pastaProjetos: string, bruta: string, opcoes: { abrir?: typeof abrirNavegador } = {}): Promise<ReferenciaCapturada> {
  const conferida = await conferirReferencia(bruta);
  if (!conferida.ok || !conferida.url) throw new Error(conferida.motivo || "referência recusada");
  const url = conferida.url;
  const destino = join(pasta, PASTA_DA_REFERENCIA);
  const arquivoDaEstrutura = join(destino, "estrutura.json");
  if (existsSync(arquivoDaEstrutura) && existsSync(arquivoDosTextos(pastaProjetos, url))) {
    try {
      const e = JSON.parse(readFileSync(arquivoDaEstrutura, "utf8")) as { url?: string; computador?: { secoes?: unknown[] } };
      if (e.url === url) return { url, pasta: PASTA_DA_REFERENCIA, secoes: Array.isArray(e.computador?.secoes) ? e.computador!.secoes!.length : 0, textos: textosDaReferencia(pastaProjetos, url).length, de_cache: true, aviso: null };
    } catch {
      /* captura de novo */
    }
  }
  const aberto = await (opcoes.abrir || abrirNavegador)();
  if ("erro" in aberto) throw new Error(`a referência não foi capturada: ${aberto.erro}`);
  // deno-lint-ignore no-explicit-any
  const navegador = aberto.navegador as any;
  let aviso: string | null = null;
  try {
    const medir = async (largura: number, altura: number, celular: boolean) => {
      const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 1, isMobile: celular, hasTouch: celular, locale: "pt-BR", userAgent: celular ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" : undefined });
      // Nada de rede interna durante a captura (redirecionamento ou recurso da página).
      // deno-lint-ignore no-explicit-any
      await ctx.route("**/*", (rota: any) => {
        try {
          const h = new URL(rota.request().url()).hostname;
          return hostBloqueado(h) ? rota.abort() : rota.continue();
        } catch {
          return rota.abort();
        }
      });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: 45_000 });
        await page.waitForTimeout(1200);
        const final = new URL(page.url()).hostname;
        if (hostBloqueado(final)) throw new Error("a referência redirecionou para a rede interna");
        await page.evaluate(ROLAGEM);
        await page.waitForTimeout(600);
        const medida = (await page.evaluate(SCRIPT_DA_REFERENCIA)) as { estrutura: Record<string, unknown>; textos: string[]; titulo: string };
        const alturaTotal = Math.min(Number(medida.estrutura.altura_total) || altura, celular ? ALTURA_MAXIMA.celular : ALTURA_MAXIMA.computador);
        if (Number(medida.estrutura.altura_total) > alturaTotal) aviso = `a referência é muito longa: o print foi cortado em ${alturaTotal} px`;
        const prints: Uint8Array[] = [];
        const fatias = fatiasDaPagina(alturaTotal, celular ? FATIA.celular : FATIA.computador);
        if (fatias.length * (celular ? FATIA.celular : FATIA.computador) < alturaTotal) aviso = `a referência é muito longa: os prints cobrem os primeiros ${fatias.length * (celular ? FATIA.celular : FATIA.computador)} px`;
        for (const fa of fatias) prints.push((await page.screenshot({ type: "jpeg", quality: 62, fullPage: true, clip: { x: 0, y: fa.y, width: largura, height: fa.altura } })) as Uint8Array);
        return { medida, prints };
      } finally {
        await ctx.close().catch(() => {});
      }
    };
    const pc = await medir(1440, 900, false);
    const cel = await medir(390, 844, true);
    mkdirSync(destino, { recursive: true });
    const nomes = { computador: pc.prints.map((_, i) => `computador-${i + 1}.jpg`), celular: cel.prints.map((_, i) => `celular-${i + 1}.jpg`) };
    pc.prints.forEach((b, i) => writeFileSync(join(destino, nomes.computador[i]), b));
    cel.prints.forEach((b, i) => writeFileSync(join(destino, nomes.celular[i]), b));
    writeFileSync(
      arquivoDaEstrutura,
      JSON.stringify(
        {
          url,
          capturada_em: new Date().toISOString(),
          prints: { ...nomes, fatia_px: { computador: FATIA.computador, celular: FATIA.celular }, largura_px: { computador: 1440, celular: 390 } },
          aviso_de_autoria: "Siga só a forma (ordem, grade, ritmo, hierarquia, comportamento). Texto, logo, fotos, ícones e código da referência nunca entram no site do cliente.",
          computador: pc.medida.estrutura,
          celular: { altura_total: cel.medida.estrutura.altura_total, secoes: (cel.medida.estrutura.secoes as Array<Record<string, unknown>>).map((s) => ({ ordem: s.ordem, papel: s.papel, altura: s.altura, colunas: s.colunas, titulo: s.titulo })), menu: cel.medida.estrutura.menu },
        },
        null,
        2,
      ),
    );
    const textos = Array.from(new Set(pc.medida.textos.concat(cel.medida.textos)));
    mkdirSync(join(pastaProjetos, "_referencias"), { recursive: true });
    writeFileSync(arquivoDosTextos(pastaProjetos, url), JSON.stringify({ url, titulo: pc.medida.titulo, textos }, null, 2));
    return { url, pasta: PASTA_DA_REFERENCIA, secoes: (pc.medida.estrutura.secoes as unknown[]).length, textos: textos.length, de_cache: false, aviso };
  } finally {
    await navegador.close().catch(() => {});
  }
}

/** O texto visível do site construído (todas as páginas do dist), para a conferência de autoria. */
export function textoDoSite(htmls: string[]): string {
  return htmls
    .map((h) => String(h || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "))
    .join(" ");
}
