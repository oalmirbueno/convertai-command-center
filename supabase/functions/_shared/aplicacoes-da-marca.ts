/**
 * Aplicações da marca por código (frente IDV2, 30/09/2026): redes sociais,
 * papelaria e assinatura de e-mail em HTML. Pedido do dono: "mais
 * ferramentas e estrutura"; regra da casa: a logo entra pelo código, nunca
 * redesenhada por gerador de imagem.
 *
 * Cada peça é um LAYOUT (camadas: retângulo, texto, logo e padrão) montado
 * aqui a partir das cores, da tipografia e dos textos da marca. A tela desenha
 * o layout no canvas (com a fonte carregada, para o PNG) e o serializa em SVG
 * (vetor, para o pacote). A assinatura de e-mail é HTML de tabela com estilo
 * na linha (o que os programas de e-mail aceitam), com todo texto escapado.
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import { contraste, luminanciaRelativa, normalizarHex, textoSobre } from "./cores-da-marca.ts";
import { escaparXml } from "./grafismos-da-marca.ts";

export const PECAS_DA_MARCA = [
  { valor: "avatar", grupo: "redes", rotulo: "Foto de perfil", largura: 1080, altura: 1080 },
  { valor: "post", grupo: "redes", rotulo: "Post 4:5", largura: 1080, altura: 1350 },
  { valor: "story", grupo: "redes", rotulo: "Story", largura: 1080, altura: 1920 },
  { valor: "destaque", grupo: "redes", rotulo: "Capa de destaque", largura: 1080, altura: 1920 },
  { valor: "capa_linkedin", grupo: "redes", rotulo: "Capa do LinkedIn", largura: 1584, altura: 396 },
  { valor: "cartao", grupo: "papelaria", rotulo: "Cartão de visita (90 x 50 mm)", largura: 1063, altura: 591 },
  { valor: "timbrado", grupo: "papelaria", rotulo: "Papel timbrado (A4)", largura: 1240, altura: 1754 },
  { valor: "envelope", grupo: "papelaria", rotulo: "Envelope (DL)", largura: 1299, altura: 650 },
] as const;

export type PecaDaMarca = (typeof PECAS_DA_MARCA)[number]["valor"];

export function ehPeca(v: unknown): v is PecaDaMarca {
  return typeof v === "string" && PECAS_DA_MARCA.some((p) => p.valor === v);
}

export type Camada =
  | { tipo: "retangulo"; x: number; y: number; w: number; h: number; cor: string; raio?: number }
  | { tipo: "texto"; x: number; y: number; texto: string; tamanho: number; peso: number; cor: string; familia: string; alinhar: "esquerda" | "centro" | "direita"; maxLargura?: number }
  | { tipo: "logo"; x: number; y: number; w: number; h: number }
  | { tipo: "padrao"; x: number; y: number; w: number; h: number; opacidade: number };

export type LayoutDaPeca = { peca: PecaDaMarca; largura: number; altura: number; fundo: string; camadas: Camada[] };

export type DadosDaPeca = {
  nome: string;
  slogan?: string;
  /** Linhas de contato (telefone, e-mail, site, @). */
  contato?: string[];
  pessoa?: { nome: string; cargo: string };
  cores: Array<{ hex: string; papel: string }>;
  tituloFamilia?: string;
  textoFamilia?: string;
  temLogo: boolean;
  temPadrao: boolean;
};

const PADRAO_ESCURA = "#151B17";
const PADRAO_CLARA = "#F4F6F4";

/** As cores que a peça usa: primária, escura para texto, clara para fundo e o destaque legível. */
export function coresDaPeca(cores: Array<{ hex: string; papel: string }>): { primaria: string; escura: string; clara: string; destaque: string } {
  const validas = cores.map((c) => ({ papel: c.papel, hex: normalizarHex(c.hex) || "" })).filter((c) => c.hex);
  const primaria = (validas.filter((c) => c.papel === "primaria")[0] || validas[0] || { hex: PADRAO_ESCURA }).hex;
  const ordenadas = validas.slice().sort((a, b) => luminanciaRelativa(a.hex) - luminanciaRelativa(b.hex));
  const escura = ordenadas[0] && luminanciaRelativa(ordenadas[0].hex) < 0.06 ? ordenadas[0].hex : PADRAO_ESCURA;
  const clara = ordenadas.length && luminanciaRelativa(ordenadas[ordenadas.length - 1].hex) > 0.8 ? ordenadas[ordenadas.length - 1].hex : PADRAO_CLARA;
  const destaques = validas.filter((c) => c.papel === "destaque" && contraste(c.hex, clara) >= 3);
  const destaque = destaques.length ? destaques[0].hex : contraste(primaria, clara) >= 3 ? primaria : escura;
  return { primaria, escura, clara, destaque };
}

const f = (familia: string | undefined, reserva = "Helvetica") => (familia && /^[A-Za-z0-9 ]{2,40}$/.test(familia) ? familia : reserva);

/** O layout de uma peça. Tudo em px da peça; a tela escala para caber. */
export function layoutDaPeca(peca: PecaDaMarca, d: DadosDaPeca): LayoutDaPeca {
  const def = PECAS_DA_MARCA.filter((p) => p.valor === peca)[0] || PECAS_DA_MARCA[0];
  const L = def.largura;
  const A = def.altura;
  const c = coresDaPeca(d.cores);
  const tituloF = f(d.tituloFamilia);
  const textoF = f(d.textoFamilia, tituloF);
  const nome = String(d.nome || "Marca").slice(0, 60);
  const slogan = String(d.slogan || "").slice(0, 120);
  const contato = (d.contato || []).map((x) => String(x || "").slice(0, 80)).filter(Boolean).slice(0, 4);
  const sobre = (fundo: string) => textoSobre(fundo);
  const camadas: Camada[] = [];
  let fundo = c.clara;
  const logoOuNome = (x: number, y: number, w: number, h: number, corDoNome: string, tamanho: number, alinhar: "esquerda" | "centro" = "centro") => {
    if (d.temLogo) camadas.push({ tipo: "logo", x, y, w, h });
    else camadas.push({ tipo: "texto", x: alinhar === "centro" ? x + w / 2 : x, y: y + h / 2 + tamanho * 0.35, texto: nome, tamanho, peso: 700, cor: corDoNome, familia: tituloF, alinhar, maxLargura: w });
  };
  switch (peca) {
    case "avatar": {
      fundo = c.primaria;
      logoOuNome(L * 0.2, A * 0.2, L * 0.6, A * 0.6, sobre(c.primaria), 120);
      break;
    }
    case "post": {
      fundo = c.clara;
      if (d.temPadrao) camadas.push({ tipo: "padrao", x: 0, y: 0, w: L, h: A * 0.42, opacidade: 1 });
      else camadas.push({ tipo: "retangulo", x: 0, y: 0, w: L, h: A * 0.42, cor: c.primaria });
      camadas.push({ tipo: "retangulo", x: L * 0.08, y: A * 0.48, w: L * 0.1, h: 10, cor: c.destaque });
      camadas.push({ tipo: "texto", x: L * 0.08, y: A * 0.6, texto: slogan || nome, tamanho: 76, peso: 700, cor: sobre(c.clara), familia: tituloF, alinhar: "esquerda", maxLargura: L * 0.84 });
      camadas.push({ tipo: "texto", x: L * 0.08, y: A * 0.72, texto: "O texto do post entra aqui, curto e no tom da marca.", tamanho: 34, peso: 400, cor: sobre(c.clara), familia: textoF, alinhar: "esquerda", maxLargura: L * 0.84 });
      logoOuNome(L * 0.08, A * 0.84, L * 0.3, A * 0.09, sobre(c.clara), 44, "esquerda");
      break;
    }
    case "story": {
      fundo = c.primaria;
      if (d.temPadrao) camadas.push({ tipo: "padrao", x: 0, y: A * 0.7, w: L, h: A * 0.3, opacidade: 1 });
      logoOuNome(L * 0.25, A * 0.12, L * 0.5, A * 0.1, sobre(c.primaria), 64);
      camadas.push({ tipo: "texto", x: L / 2, y: A * 0.45, texto: slogan || nome, tamanho: 88, peso: 700, cor: sobre(c.primaria), familia: tituloF, alinhar: "centro", maxLargura: L * 0.8 });
      camadas.push({ tipo: "retangulo", x: L * 0.3, y: A * 0.56, w: L * 0.4, h: 110, cor: c.destaque, raio: 55 });
      camadas.push({ tipo: "texto", x: L / 2, y: A * 0.56 + 70, texto: "Saiba mais", tamanho: 40, peso: 700, cor: sobre(c.destaque), familia: textoF, alinhar: "centro" });
      break;
    }
    case "destaque": {
      fundo = c.primaria;
      camadas.push({ tipo: "retangulo", x: L * 0.2, y: A / 2 - L * 0.3, w: L * 0.6, h: L * 0.6, cor: c.clara, raio: L * 0.3 });
      logoOuNome(L * 0.3, A / 2 - L * 0.2, L * 0.4, L * 0.4, sobre(c.clara), 60);
      break;
    }
    case "capa_linkedin": {
      fundo = c.escura;
      if (d.temPadrao) camadas.push({ tipo: "padrao", x: L * 0.55, y: 0, w: L * 0.45, h: A, opacidade: 1 });
      camadas.push({ tipo: "texto", x: L * 0.06, y: A * 0.55, texto: slogan || nome, tamanho: 52, peso: 700, cor: sobre(c.escura), familia: tituloF, alinhar: "esquerda", maxLargura: L * 0.46 });
      break;
    }
    case "cartao": {
      fundo = c.clara;
      camadas.push({ tipo: "retangulo", x: 0, y: A - 18, w: L, h: 18, cor: c.primaria });
      logoOuNome(L * 0.07, A * 0.12, L * 0.36, A * 0.28, sobre(c.clara), 48, "esquerda");
      if (d.pessoa && d.pessoa.nome) {
        camadas.push({ tipo: "texto", x: L * 0.07, y: A * 0.58, texto: d.pessoa.nome.slice(0, 50), tamanho: 40, peso: 700, cor: sobre(c.clara), familia: tituloF, alinhar: "esquerda" });
        if (d.pessoa.cargo) camadas.push({ tipo: "texto", x: L * 0.07, y: A * 0.66, texto: d.pessoa.cargo.slice(0, 60), tamanho: 26, peso: 400, cor: c.destaque, familia: textoF, alinhar: "esquerda" });
      }
      contato.forEach((l, i) => camadas.push({ tipo: "texto", x: L * 0.93, y: A * 0.58 + i * 36, texto: l, tamanho: 24, peso: 400, cor: sobre(c.clara), familia: textoF, alinhar: "direita" }));
      break;
    }
    case "timbrado": {
      fundo = "#FFFFFF";
      logoOuNome(L * 0.08, A * 0.04, L * 0.28, A * 0.06, PADRAO_ESCURA, 40, "esquerda");
      camadas.push({ tipo: "retangulo", x: L * 0.08, y: A * 0.12, w: L * 0.84, h: 3, cor: c.primaria });
      for (let i = 0; i < 9; i++) camadas.push({ tipo: "retangulo", x: L * 0.08, y: A * (0.2 + i * 0.045), w: L * (i === 8 ? 0.5 : 0.84), h: 10, cor: "#EEF1EE", raio: 5 });
      camadas.push({ tipo: "retangulo", x: 0, y: A - 70, w: L, h: 70, cor: c.primaria });
      camadas.push({ tipo: "texto", x: L / 2, y: A - 28, texto: contato.join("   ") || nome, tamanho: 20, peso: 400, cor: sobre(c.primaria), familia: textoF, alinhar: "centro", maxLargura: L * 0.9 });
      break;
    }
    case "envelope": {
      fundo = "#FFFFFF";
      logoOuNome(L * 0.05, A * 0.08, L * 0.22, A * 0.18, PADRAO_ESCURA, 36, "esquerda");
      camadas.push({ tipo: "texto", x: L * 0.05, y: A * 0.34, texto: contato.slice(0, 2).join("   "), tamanho: 20, peso: 400, cor: "#626D66", familia: textoF, alinhar: "esquerda" });
      camadas.push({ tipo: "retangulo", x: 0, y: A - 24, w: L, h: 24, cor: c.primaria });
      break;
    }
  }
  return { peca, largura: L, altura: A, fundo, camadas };
}

const r = (n: number) => Math.round(n * 10) / 10;

/** O layout em SVG (vetor para o pacote). A logo e o padrão entram por href (data URL). */
export function svgDoLayout(l: LayoutDaPeca, hrefs: { logo?: string | null; padrao?: string | null } = {}): string {
  const partes: string[] = [`<rect width="${l.largura}" height="${l.altura}" fill="${l.fundo}"/>`];
  for (const c of l.camadas) {
    if (c.tipo === "retangulo") partes.push(`<rect x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}"${c.raio ? ` rx="${r(c.raio)}"` : ""} fill="${c.cor}"/>`);
    else if (c.tipo === "texto") {
      const anchor = c.alinhar === "centro" ? "middle" : c.alinhar === "direita" ? "end" : "start";
      partes.push(`<text x="${r(c.x)}" y="${r(c.y)}" text-anchor="${anchor}" font-family="${escaparXml(c.familia)}, Helvetica, Arial, sans-serif" font-size="${c.tamanho}" font-weight="${c.peso}" fill="${c.cor}">${escaparXml(c.texto)}</text>`);
    } else if (c.tipo === "logo" && hrefs.logo) partes.push(`<image x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}" preserveAspectRatio="xMidYMid meet" href="${escaparXml(hrefs.logo)}"/>`);
    else if (c.tipo === "padrao" && hrefs.padrao) partes.push(`<image x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}" preserveAspectRatio="xMidYMid slice" opacity="${c.opacidade}" href="${escaparXml(hrefs.padrao)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${l.largura}" height="${l.altura}" viewBox="0 0 ${l.largura} ${l.altura}">${partes.join("")}</svg>`;
}


// ------------------------------------------------------------------ assinatura de e-mail

export type DadosDaAssinatura = {
  nome: string;
  cargo?: string;
  empresa: string;
  telefone?: string;
  email?: string;
  site?: string;
  instagram?: string;
  /** URL pública da logo (https). Sem ela, a assinatura sai só com o nome da marca. */
  logoUrl?: string | null;
  cores: Array<{ hex: string; papel: string }>;
  familia?: string;
};

const escaparHtml = (s: string) => escaparXml(String(s == null ? "" : s).trim());

/** Link só http(s) ou mailto/tel montado por nós. */
function hrefSeguro(v: string, tipo: "site" | "email" | "tel" | "instagram"): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (tipo === "email") return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(s) ? `mailto:${s}` : null;
  if (tipo === "tel") {
    const digitos = s.replace(/[^0-9+]/g, "");
    return digitos.length >= 8 ? `tel:${digitos}` : null;
  }
  if (tipo === "instagram") {
    const a = s.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
    return /^[A-Za-z0-9._]{1,30}$/.test(a) ? `https://instagram.com/${a}` : null;
  }
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s"'<>]*)?$/.test(url) ? url : null;
}

/**
 * A assinatura de e-mail em HTML (tabela, estilo na linha, largura 480,
 * fonte com reserva do sistema). Todo texto é escapado; link só http(s),
 * mailto e tel.
 */
export function assinaturaDeEmail(d: DadosDaAssinatura): string {
  const c = coresDaPeca(d.cores);
  const familia = f(d.familia, "Arial");
  const pilha = `${familia === "Arial" ? "" : `'${familia}', `}Arial, Helvetica, sans-serif`;
  const linhas: string[] = [];
  const link = (href: string | null, texto: string) => (href ? `<a href="${escaparHtml(href)}" style="color:${c.destaque};text-decoration:none;">${escaparHtml(texto)}</a>` : escaparHtml(texto));
  if (d.telefone) linhas.push(link(hrefSeguro(d.telefone, "tel"), d.telefone));
  if (d.email) linhas.push(link(hrefSeguro(d.email, "email"), d.email));
  if (d.site) linhas.push(link(hrefSeguro(d.site, "site"), d.site.replace(/^https?:\/\//i, "")));
  if (d.instagram) linhas.push(link(hrefSeguro(d.instagram, "instagram"), `@${d.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "")}`));
  const logoSegura = d.logoUrl && /^https:\/\/[^\s"'<>]+$/i.test(d.logoUrl) ? d.logoUrl : null;
  const marca = logoSegura
    ? `<img src="${escaparHtml(logoSegura)}" alt="${escaparHtml(d.empresa)}" width="120" style="display:block;border:0;max-width:120px;height:auto;" />`
    : `<span style="font-family:${pilha};font-size:18px;font-weight:700;color:${c.primaria};">${escaparHtml(d.empresa)}</span>`;
  return [
    `<table cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;font-family:${pilha};color:${PADRAO_ESCURA};">`,
    "<tr>",
    `<td style="vertical-align:middle;padding:0 16px 0 0;border-right:3px solid ${c.primaria};">${marca}</td>`,
    `<td style="vertical-align:middle;padding:0 0 0 16px;">`,
    `<div style="font-size:16px;font-weight:700;line-height:20px;color:${PADRAO_ESCURA};">${escaparHtml(d.nome)}</div>`,
    d.cargo ? `<div style="font-size:13px;line-height:18px;color:${c.destaque};">${escaparHtml(d.cargo)}${d.empresa ? ` | ${escaparHtml(d.empresa)}` : ""}</div>` : "",
    linhas.length ? `<div style="font-size:12px;line-height:18px;color:#626D66;padding-top:6px;">${linhas.join("<br />")}</div>` : "",
    "</td>",
    "</tr>",
    "</table>",
  ]
    .filter(Boolean)
    .join("");
}
