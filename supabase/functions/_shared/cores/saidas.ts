/**
 * Ateliê de Cor: o que sai de uma proposta (19/11/2026). Sem IA.
 *
 * - Tokens semânticos (CSS, Tailwind v4, JSON) com o contraste em cada par.
 * - Arquivo .ase (Adobe Swatch Exchange, formato público) para Illustrator,
 *   Photoshop e InDesign.
 * - Tema de e-mail claro e escuro e um modelo HTML seguro para o modo escuro
 *   do Gmail, Outlook e Apple Mail (meta color-scheme, @media
 *   prefers-color-scheme, [data-ogsc]/[data-ogsb], sem #000/#FFF puros, botão
 *   em HTML com borda da mesma cor). Fonte: litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers
 */

import { ajustarAteContraste, contraste, escala, hexParaOklch, hexParaRgb, melhorTexto, oklchParaHex, textoOklch } from "./oklch.ts";
import type { Proposta } from "./paleta.ts";

const r2 = (n: number) => n.toFixed(2);

export type Token = { nome: string; hex: string; nota: string };

function porPapel(p: Proposta, papel: string) {
  return p.cores.find((c) => c.papel === papel);
}

/** Tokens semânticos da proposta. O destaque só vira cor de link se passar de 4,5:1 no fundo. */
export function tokensDaProposta(p: Proposta): Token[] {
  const dom = porPapel(p, "dominante")!;
  const ap = porPapel(p, "apoio");
  const des = porPapel(p, "destaque");
  const fundo = hexParaOklch(dom.hex).l > 0.8 ? dom.hex : p.neutros.papel;
  const superficie = ap && hexParaOklch(ap.hex).l > 0.8 ? ap.hex : oklchParaHex({ ...hexParaOklch(fundo), l: Math.max(0, hexParaOklch(fundo).l - 0.04) });
  const texto = melhorTexto(fundo, [p.neutros.tinta, "#000000"]).hex;
  const textoSec = ajustarAteContraste(p.neutros.cinza, fundo, 4.5) ?? texto;
  const link = des && contraste(des.hex, fundo) >= 4.5 ? des.hex : ajustarAteContraste(des?.hex ?? dom.hex, fundo, 4.5) ?? texto;
  const t: Token[] = [
    { nome: "cor-dominante", hex: dom.hex, nota: `${dom.nome} (marca, 60%)` },
    ...(ap ? [{ nome: "cor-apoio", hex: ap.hex, nota: `${ap.nome} (marca, 30%)` }] : []),
    ...(des ? [{ nome: "cor-destaque", hex: des.hex, nota: `${des.nome} (botão e realce, 10%)` }] : []),
    { nome: "cor-fundo", hex: fundo, nota: "Fundo das páginas" },
    { nome: "cor-superficie", hex: superficie, nota: "Cartões e seções" },
    { nome: "cor-texto", hex: texto, nota: `Texto sobre o fundo · ${r2(contraste(texto, fundo))}:1` },
    { nome: "cor-texto-secundario", hex: textoSec, nota: `Texto de apoio · ${r2(contraste(textoSec, fundo))}:1` },
    { nome: "cor-texto-sobre-dominante", hex: dom.texto, nota: `${r2(dom.razaoTexto)}:1` },
    ...(des ? [{ nome: "cor-texto-sobre-destaque", hex: des.texto, nota: `${r2(des.razaoTexto)}:1` }] : []),
    { nome: "cor-link", hex: link, nota: `Links sobre o fundo · ${r2(contraste(link, fundo))}:1` },
    { nome: "cor-borda", hex: oklchParaHex({ ...hexParaOklch(fundo), l: Math.max(0, hexParaOklch(fundo).l - 0.12), c: 0.01 }), nota: "Bordas e divisores (decorativo)" },
  ];
  return t;
}

export function tokensCss(p: Proposta): string {
  const t = tokensDaProposta(p);
  const largura = Math.max(...t.map((x) => x.nome.length));
  const linhas = t.map((x) => `  --${x.nome.padEnd(largura)}: ${x.hex}; /* ${x.nota} */`);
  const des = porPapel(p, "destaque");
  const tons = des ? escala(des.hex).map((d) => `  --destaque-${d.degrau}: ${d.hex};`) : [];
  return `:root {\n${linhas.join("\n")}\n${tons.length ? `\n  /* tons do destaque (OKLCH) */\n${tons.join("\n")}\n` : ""}}\n`;
}

export function tokensTailwind(p: Proposta): string {
  const t = tokensDaProposta(p);
  const linhas = t.map((x) => `  --color-${x.nome.replace(/^cor-/, "")}: ${textoOklch(x.hex)}; /* ${x.hex} · ${x.nota} */`);
  return `@theme {\n${linhas.join("\n")}\n}\n`;
}

export function tokensJson(p: Proposta, marca: string): string {
  return JSON.stringify({
    marca,
    proposta: p.titulo,
    cores: p.cores.map((c) => ({ papel: c.papel, nome: c.nome, hex: c.hex, oklch: textoOklch(c.hex), texto: c.texto, contraste_texto: c.razaoTexto })),
    neutros: p.neutros,
    tokens: Object.fromEntries(tokensDaProposta(p).map((x) => [x.nome, x.hex])),
  }, null, 2);
}

/** Lista para colar no Canva ou no Figma. */
export function listaDeHex(p: Proposta, marca: string): string {
  return [
    `${marca} · ${p.titulo}`,
    ...p.cores.map((c) => `${c.nome} (${c.papel}): ${c.hex}`),
    `Tinta (neutro): ${p.neutros.tinta}`,
    `Papel (neutro): ${p.neutros.papel}`,
    `Cinza (neutro): ${p.neutros.cinza}`,
  ].join("\n");
}

/** Adobe Swatch Exchange 1.0: grupo com as cores de marca e os neutros, em RGB. */
export function arquivoAse(p: Proposta, marca: string): Uint8Array {
  const cores = [
    ...p.cores.map((c) => ({ nome: `${c.nome} (${c.papel})`, hex: c.hex })),
    { nome: "Tinta", hex: p.neutros.tinta },
    { nome: "Papel", hex: p.neutros.papel },
    { nome: "Cinza", hex: p.neutros.cinza },
  ];
  const partes: number[] = [];
  const u16 = (n: number) => partes.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => partes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const f32 = (n: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, n, false);
    for (let i = 0; i < 4; i++) partes.push(b.getUint8(i));
  };
  const nomeUtf16 = (s: string) => {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out.push((c >> 8) & 255, c & 255); }
    out.push(0, 0);
    return out;
  };
  const grupo = nomeUtf16(`${marca} · ${p.titulo}`.slice(0, 60));
  partes.push(65, 83, 69, 70); // ASEF
  u16(1); u16(0);
  u32(cores.length + 2);
  u16(0xc001); u32(2 + grupo.length); u16(grupo.length / 2); partes.push(...grupo);
  for (const c of cores) {
    const nome = nomeUtf16(c.nome.slice(0, 60));
    const { r, g, b } = hexParaRgb(c.hex);
    u16(0x0001);
    u32(2 + nome.length + 4 + 12 + 2);
    u16(nome.length / 2); partes.push(...nome);
    partes.push(82, 71, 66, 32); // "RGB "
    f32(r / 255); f32(g / 255); f32(b / 255);
    u16(2); // normal
  }
  u16(0xc002); u32(0);
  return new Uint8Array(partes);
}

// ------------------------------------------------------------------ e-mail

export type TemaDeEmail = {
  claro: { fundo: string; cartao: string; texto: string; textoSec: string; cabecalho: string; textoCabecalho: string; botao: string; textoBotao: string; link: string; borda: string };
  escuro: { fundo: string; cartao: string; texto: string; textoSec: string; cabecalho: string; textoCabecalho: string; botao: string; textoBotao: string; link: string; borda: string };
  avisos: string[];
};

/** Tema de e-mail das duas versões, com todos os pares conferidos. */
export function temaDeEmail(p: Proposta): TemaDeEmail {
  const dom = porPapel(p, "dominante")!;
  const ap = porPapel(p, "apoio");
  const des = porPapel(p, "destaque") ?? dom;
  const h = hexParaOklch(dom.hex).h;
  const avisos: string[] = [];
  // Claro: fundo quase branco (nunca #FFF puro), cartão um tom acima.
  const fundoC = oklchParaHex({ l: 0.97, c: 0.006, h });
  const cartaoC = oklchParaHex({ l: 0.995, c: 0.003, h });
  const cabC = hexParaOklch(dom.hex).l < 0.8 ? dom.hex : ap?.hex ?? p.neutros.tinta;
  const textoC = melhorTexto(cartaoC, [p.neutros.tinta, "#111111"]).hex;
  const linkC = contraste(des.hex, cartaoC) >= 4.5 ? des.hex : ajustarAteContraste(des.hex, cartaoC, 4.5) ?? textoC;
  if (linkC !== des.hex) avisos.push(`No claro, o link usa ${linkC} (o destaque puro não chega a 4,5:1 sobre o branco).`);
  // Escuro: fundo grafite tingido (nunca #000 puro), cartão um tom acima.
  const fundoE = oklchParaHex({ l: 0.17, c: 0.012, h });
  const cartaoE = oklchParaHex({ l: 0.22, c: 0.014, h });
  const cabE = hexParaOklch(dom.hex).l < 0.4 ? dom.hex : oklchParaHex({ l: 0.28, c: 0.04, h });
  const textoE = oklchParaHex({ l: 0.95, c: 0.006, h });
  const botaoE = contraste(des.hex, cartaoE) >= 3 ? des.hex : ajustarAteContraste(des.hex, cartaoE, 3) ?? des.hex;
  if (botaoE !== des.hex) avisos.push(`No escuro, o botão clareia para ${botaoE} para continuar saltando.`);
  const linkE = contraste(des.hex, cartaoE) >= 4.5 ? des.hex : ajustarAteContraste(des.hex, cartaoE, 4.5) ?? textoE;
  return {
    claro: {
      fundo: fundoC, cartao: cartaoC, texto: textoC, textoSec: ajustarAteContraste(p.neutros.cinza, cartaoC, 4.5) ?? textoC,
      cabecalho: cabC, textoCabecalho: melhorTexto(cabC, [p.neutros.papel, p.neutros.tinta]).hex,
      botao: des.hex, textoBotao: melhorTexto(des.hex, [p.neutros.tinta, p.neutros.papel]).hex, link: linkC,
      borda: oklchParaHex({ l: 0.9, c: 0.008, h }),
    },
    escuro: {
      fundo: fundoE, cartao: cartaoE, texto: textoE, textoSec: oklchParaHex({ l: 0.75, c: 0.01, h }),
      cabecalho: cabE, textoCabecalho: melhorTexto(cabE, [textoE, p.neutros.tinta]).hex,
      botao: botaoE, textoBotao: melhorTexto(botaoE, [p.neutros.tinta, textoE]).hex, link: linkE,
      borda: oklchParaHex({ l: 0.32, c: 0.012, h }),
    },
    avisos,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Modelo de e-mail HTML (tabelas, estilo em linha) com a versão escura. */
export function htmlDeEmail(p: Proposta, conteudo: { marca: string; titulo: string; texto: string; botao: string; link?: string; assinatura?: string }): string {
  const t = temaDeEmail(p);
  const c = t.claro;
  const e = t.escuro;
  const href = esc(conteudo.link || "#");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(conteudo.titulo)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .fundo { background: ${e.fundo} !important; }
    .cartao { background: ${e.cartao} !important; border-color: ${e.borda} !important; }
    .cabecalho { background: ${e.cabecalho} !important; color: ${e.textoCabecalho} !important; }
    .texto { color: ${e.texto} !important; }
    .texto-sec { color: ${e.textoSec} !important; }
    .link { color: ${e.link} !important; }
    .botao { background: ${e.botao} !important; border-color: ${e.botao} !important; color: ${e.textoBotao} !important; }
  }
  [data-ogsb] .fundo { background: ${e.fundo} !important; }
  [data-ogsb] .cartao { background: ${e.cartao} !important; }
  [data-ogsb] .cabecalho { background: ${e.cabecalho} !important; }
  [data-ogsb] .botao { background: ${e.botao} !important; border-color: ${e.botao} !important; }
  [data-ogsc] .texto { color: ${e.texto} !important; }
  [data-ogsc] .texto-sec { color: ${e.textoSec} !important; }
  [data-ogsc] .link { color: ${e.link} !important; }
  [data-ogsc] .botao, [data-ogsc] .cabecalho { color: ${e.textoBotao} !important; }
</style>
</head>
<body class="fundo" style="margin:0;padding:0;background:${c.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fundo" style="background:${c.fundo};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cartao" style="max-width:560px;background:${c.cartao};border:1px solid ${c.borda};border-radius:16px;overflow:hidden;">
<tr><td class="cabecalho" style="background:${c.cabecalho};color:${c.textoCabecalho};padding:20px 28px;font:600 16px/1.3 Arial,Helvetica,sans-serif;">${esc(conteudo.marca)}</td></tr>
<tr><td style="padding:28px;">
<h1 class="texto" style="margin:0 0 12px;color:${c.texto};font:700 22px/1.3 Arial,Helvetica,sans-serif;">${esc(conteudo.titulo)}</h1>
<p class="texto-sec" style="margin:0 0 24px;color:${c.textoSec};font:400 15px/1.6 Arial,Helvetica,sans-serif;">${esc(conteudo.texto)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td>
<a href="${href}" class="botao" style="display:inline-block;background:${c.botao};border:12px solid ${c.botao};border-left-width:24px;border-right-width:24px;border-radius:999px;color:${c.textoBotao};font:700 15px/1 Arial,Helvetica,sans-serif;text-decoration:none;">${esc(conteudo.botao)}</a>
</td></tr></table>
${conteudo.assinatura ? `<p class="texto-sec" style="margin:28px 0 0;color:${c.textoSec};font:400 13px/1.5 Arial,Helvetica,sans-serif;">${esc(conteudo.assinatura)}<br><a href="${href}" class="link" style="color:${c.link};">${esc(conteudo.link || "")}</a></p>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
