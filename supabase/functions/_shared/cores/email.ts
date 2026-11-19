/**
 * Ateliê de Cor no Correio (19/11/2026): a versão HTML de uma mensagem de texto,
 * com as cores da marca do cliente e segura no modo escuro.
 *
 * O Correio continua mandando o texto puro (obrigatório); isto é a parte
 * text/html do multipart/alternative. A paleta vem do kit da marca
 * (cliente_kit_marca.paleta). Sem paleta, sai um tema neutro.
 *
 * Regras de cor (docs/cores/PESQUISA.md): cabeçalho na cor da marca, cartão
 * quase branco (nunca #FFF puro), link e botão no destaque da marca ajustado
 * até 4,5:1 sobre o cartão, versão escura por @media prefers-color-scheme e
 * por [data-ogsc]/[data-ogsb] (Outlook). Sem script, sem imagem, tabelas e
 * estilo em linha. Puro: roda no Deno e no Vite.
 */

import { ajustarAteContraste, contraste, hexParaOklch, hexValido, melhorTexto, oklchParaHex } from "./oklch.ts";
import { papeisDaPeca, type CorDaMarcaNaPeca } from "./papeis-da-peca.ts";

export type TemaDaMensagem = {
  marca: string;
  claro: { fundo: string; cartao: string; borda: string; texto: string; textoSec: string; faixa: string; textoFaixa: string; link: string };
  escuro: { fundo: string; cartao: string; borda: string; texto: string; textoSec: string; faixa: string; textoFaixa: string; link: string };
};

const NEUTRO_H = 250;

/** As cores da mensagem a partir da paleta da marca (ou neutras). */
export function temaDaMensagem(paleta: CorDaMarcaNaPeca[] | null | undefined, marca = ""): TemaDaMensagem {
  const validas = (paleta || []).filter((c) => hexValido(c.hex));
  const papeis = validas.length ? papeisDaPeca(validas, { fundoPreferido: "marca" }) : null;
  const primaria = papeis ? papeis.fundo.hex : oklchParaHex({ l: 0.32, c: 0.03, h: NEUTRO_H });
  const destaque = papeis ? papeis.destaque.hex : oklchParaHex({ l: 0.5, c: 0.15, h: NEUTRO_H });
  const op = hexParaOklch(primaria);
  const h = op.c > 0.02 ? op.h : NEUTRO_H;
  // Claro: fundo e cartão quase brancos, levemente tingidos.
  const fundoC = oklchParaHex({ l: 0.965, c: 0.006, h });
  const cartaoC = oklchParaHex({ l: 0.995, c: 0.003, h });
  const textoC = oklchParaHex({ l: 0.22, c: 0.015, h });
  // A faixa do topo leva a cor da marca; se ela for clara demais para segurar o nome, escurece no mesmo matiz.
  const faixaC = contraste(primaria, cartaoC) >= 3 ? primaria : ajustarAteContraste(primaria, cartaoC, 3) ?? primaria;
  const linkC = ajustarAteContraste(destaque, cartaoC, 4.5) ?? textoC;
  // Escuro: grafite tingido (nunca #000), texto quase branco.
  const fundoE = oklchParaHex({ l: 0.17, c: 0.01, h });
  const cartaoE = oklchParaHex({ l: 0.22, c: 0.012, h });
  const textoE = oklchParaHex({ l: 0.94, c: 0.006, h });
  const faixaE = hexParaOklch(primaria).l < 0.45 ? primaria : oklchParaHex({ l: 0.3, c: Math.min(0.08, op.c), h });
  const linkE = ajustarAteContraste(destaque, cartaoE, 4.5) ?? textoE;
  return {
    marca,
    claro: { fundo: fundoC, cartao: cartaoC, borda: oklchParaHex({ l: 0.9, c: 0.008, h }), texto: textoC, textoSec: oklchParaHex({ l: 0.45, c: 0.012, h }), faixa: faixaC, textoFaixa: melhorTexto(faixaC, [cartaoC, textoC]).hex, link: linkC },
    escuro: { fundo: fundoE, cartao: cartaoE, borda: oklchParaHex({ l: 0.32, c: 0.012, h }), texto: textoE, textoSec: oklchParaHex({ l: 0.76, c: 0.01, h }), faixa: faixaE, textoFaixa: melhorTexto(faixaE, [textoE, cartaoC]).hex, link: linkE },
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto puro em parágrafos, com links clicáveis. O que vem depois de "--" sozinho na linha é rodapé. */
function corpoEmHtml(texto: string, t: TemaDaMensagem["claro"]): { corpo: string; rodape: string } {
  const normal = texto.replace(/\r\n/g, "\n");
  const corte = normal.search(/\n--\s*\n/);
  const principal = corte >= 0 ? normal.slice(0, corte) : normal;
  const fim = corte >= 0 ? normal.slice(corte).replace(/^\n--\s*\n/, "") : "";
  const linkar = (s: string) =>
    esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => `<a href="${u}" class="link" style="color:${t.link};text-decoration:underline;">${u}</a>`);
  const paragrafos = principal.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p class="texto" style="margin:0 0 14px;color:${t.texto};font:400 15px/1.6 Arial,Helvetica,sans-serif;">${linkar(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const rodape = fim.trim()
    ? `<p class="texto-sec" style="margin:0;color:${t.textoSec};font:400 12px/1.5 Arial,Helvetica,sans-serif;">${linkar(fim.trim()).replace(/\n/g, "<br>")}</p>`
    : "";
  return { corpo: paragrafos, rodape };
}

/** A parte text/html da mensagem: o mesmo texto, com as cores da marca. */
export function htmlDaMensagem(texto: string, tema: TemaDaMensagem, assunto = ""): string {
  const c = tema.claro;
  const e = tema.escuro;
  const { corpo, rodape } = corpoEmHtml(texto, c);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(assunto)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .fundo { background: ${e.fundo} !important; }
    .cartao { background: ${e.cartao} !important; border-color: ${e.borda} !important; }
    .faixa { background: ${e.faixa} !important; color: ${e.textoFaixa} !important; }
    .texto { color: ${e.texto} !important; }
    .texto-sec { color: ${e.textoSec} !important; }
    .link { color: ${e.link} !important; }
  }
  [data-ogsb] .fundo { background: ${e.fundo} !important; }
  [data-ogsb] .cartao { background: ${e.cartao} !important; }
  [data-ogsb] .faixa { background: ${e.faixa} !important; }
  [data-ogsc] .texto { color: ${e.texto} !important; }
  [data-ogsc] .texto-sec { color: ${e.textoSec} !important; }
  [data-ogsc] .link { color: ${e.link} !important; }
  [data-ogsc] .faixa { color: ${e.textoFaixa} !important; }
</style>
</head>
<body class="fundo" style="margin:0;padding:0;background:${c.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fundo" style="background:${c.fundo};">
<tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cartao" style="max-width:600px;background:${c.cartao};border:1px solid ${c.borda};border-radius:14px;overflow:hidden;">
${tema.marca ? `<tr><td class="faixa" style="background:${c.faixa};color:${c.textoFaixa};padding:14px 24px;font:700 14px/1.3 Arial,Helvetica,sans-serif;">${esc(tema.marca)}</td></tr>` : `<tr><td class="faixa" style="background:${c.faixa};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>`}
<tr><td style="padding:24px;">
${corpo}
</td></tr>
${rodape ? `<tr><td style="padding:0 24px 20px;border-top:1px solid ${c.borda};"><div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>${rodape}</td></tr>` : ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}
