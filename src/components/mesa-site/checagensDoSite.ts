/**
 * Checagens automáticas antes de publicar (Mesa Site, 19/10/2026, aprendido
 * com o Gravyx: page_checks). Roda sobre o documento do site (a prévia rápida
 * ou o HTML que a ponte manda do site do motor), sem IA e sem custo:
 *  - texto passando da borda ou cortado (com layout: medida real; sem layout:
 *    palavra comprida que não quebra);
 *  - link quebrado ou vazio (sem destino, "#", âncora que não existe,
 *    javascript:, contato vazio, endereço malformado, sem texto);
 *  - imagem sem alt;
 *  - contraste baixo (WCAG: 4,5 no texto comum, 3 no grande);
 *  - títulos repetidos (e mais de um h1);
 *  - página pesada (HTML grande, imagens demais, imagem enorme, sem lazy).
 *
 * Cada problema leva o caminho do elemento (tag:nth-of-type) para a tela ir
 * até ele numa cópia da página. Puro sobre o DOM: o teste usa um documento
 * de exemplo (sem layout, as medidas ficam de fora).
 */

export type TipoDeChecagem = "borda" | "link" | "alt" | "contraste" | "titulo" | "peso";

export type ProblemaDaChecagem = {
  id: string;
  tipo: TipoDeChecagem;
  grave: boolean;
  texto: string;
  /** Caminho do elemento no documento checado (null = a página toda). */
  caminho: string | null;
  /** A seção do site (data-secao), quando há. */
  secao: string | null;
  aparelho?: "celular" | "computador";
};

export const ROTULO_DA_CHECAGEM: Record<TipoDeChecagem, string> = {
  borda: "Texto passando da borda",
  link: "Link quebrado ou vazio",
  alt: "Imagem sem descrição",
  contraste: "Contraste baixo",
  titulo: "Título repetido",
  peso: "Página pesada",
};

export const LIMITES_DA_CHECAGEM = { htmlKb: 600, imagens: 30, larguraDaImagem: 2600, palavraLonga: 26, semLazy: 6 };

/** Só tag, ">" e :nth-of-type(n): o caminho que a tela aceita para ir até o problema. */
export const CAMINHO_VALIDO = /^[a-z][a-z0-9-]*(:nth-of-type\(\d{1,4}\))?(>[a-z][a-z0-9-]*(:nth-of-type\(\d{1,4}\))?){0,60}$/;

const TEXTUAIS = "h1,h2,h3,h4,h5,h6,p,li,a,button,span,strong,em,small,label,blockquote,figcaption,dt,dd,td,th,summary";
const FORA = "script,style,noscript,template,[data-aq-chrome],[hidden],[aria-hidden='true']";

const norm = (s: string | null | undefined) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const curto = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** O caminho do elemento a partir do body (tag:nth-of-type), igual em qualquer cópia do mesmo HTML. */
export function caminhoDe(el: Element): string | null {
  const partes: string[] = [];
  let atual: Element | null = el;
  while (atual && atual.tagName && atual.tagName.toLowerCase() !== "html") {
    const tag = atual.tagName.toLowerCase();
    if (tag === "body") {
      partes.unshift("body");
      break;
    }
    const pai: Element | null = atual.parentElement;
    if (!pai) return null;
    let n = 0;
    let i = 0;
    for (let k = 0; k < pai.children.length; k++) {
      const irmao = pai.children[k];
      if (irmao.tagName === atual.tagName) {
        i += 1;
        if (irmao === atual) n = i;
      }
    }
    partes.unshift(`${tag}:nth-of-type(${n})`);
    atual = pai;
  }
  const c = partes.join(">");
  return CAMINHO_VALIDO.test(c) ? c : null;
}

const secaoDe = (el: Element) => {
  const s = el.closest ? el.closest("[data-secao]") : null;
  return s ? s.getAttribute("data-secao") : null;
};

const fora = (el: Element) => !!(el.closest && el.closest(FORA));

/** O texto do próprio elemento (nós de texto filhos diretos). */
function textoProprio(el: Element): string {
  let t = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 3) t += n.textContent || "";
  }
  return norm(t);
}

// ------------------------------------------------------------------ cor

type Rgba = { r: number; g: number; b: number; a: number };

export function lerCor(v: string | null | undefined): Rgba | null {
  const s = norm(v).toLowerCase();
  if (!s || s === "transparent") return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1].charAt(0) + m[1].charAt(0), 16), g: parseInt(m[1].charAt(1) + m[1].charAt(1), 16), b: parseInt(m[1].charAt(2) + m[1].charAt(2), 16), a: 1 };
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(s);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: m[4] ? parseInt(m[4], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].charAt(m[4].length - 1) === "%") a = a / 100;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: isFinite(a) ? a : 1 };
  }
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

const canal = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminancia = (c: Rgba) => 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);

/** Razão de contraste WCAG entre duas cores opacas. */
export function contraste(a: Rgba, b: Rgba): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const misturar = (cima: Rgba, baixo: Rgba): Rgba => ({ r: cima.r * cima.a + baixo.r * (1 - cima.a), g: cima.g * cima.a + baixo.g * (1 - cima.a), b: cima.b * cima.a + baixo.b * (1 - cima.a), a: 1 });
const hex = (c: Rgba) => `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

type Estilo = (el: Element) => CSSStyleDeclaration | null;

/** A cor do texto: a do elemento ou a herdada (o jsdom nem sempre herda). */
function corDoTexto(el: Element, estilo: Estilo): Rgba | null {
  let atual: Element | null = el;
  while (atual) {
    const cs = estilo(atual);
    const c = cs ? lerCor(cs.color) : null;
    if (c) return c;
    atual = atual.parentElement;
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** O fundo atrás do texto; null quando há imagem ou mídia por trás (aí não dá para saber). */
function fundoDe(el: Element, estilo: Estilo): Rgba | null {
  let atual: Element | null = el;
  const camadas: Rgba[] = [];
  while (atual) {
    const cs = estilo(atual);
    if (cs) {
      if (cs.backgroundImage && cs.backgroundImage !== "none" && cs.backgroundImage !== "initial") return null;
      // Mídia em camada (img/vídeo absoluto) no mesmo bloco: o texto está sobre uma foto.
      for (let i = 0; i < atual.children.length; i++) {
        const f = atual.children[i];
        const tag = f.tagName.toLowerCase();
        if ((tag === "img" || tag === "video" || tag === "picture" || tag === "canvas") && f !== el) {
          const fcs = estilo(f);
          if (fcs && (fcs.position === "absolute" || fcs.position === "fixed")) return null;
        }
      }
      const c = lerCor(cs.backgroundColor);
      if (c && c.a > 0) {
        camadas.push(c);
        if (c.a >= 0.99) break;
      }
    }
    atual = atual.parentElement;
  }
  let fundo: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = camadas.length - 1; i >= 0; i--) fundo = camadas[i].a >= 0.99 ? camadas[i] : misturar(camadas[i], fundo);
  return fundo;
}

// ------------------------------------------------------------------ checagem

export type OpcoesDaChecagem = {
  /** Tamanho do HTML em bytes (peso). */
  bytesDoHtml?: number;
  /** A prévia rápida põe "#" nos botões de propósito (o motor liga o destino): não conta como problema. */
  ignorarAncoraVazia?: boolean;
  aparelho?: "celular" | "computador";
};

/** Todos os problemas do documento, os graves primeiro. */
export function checarDocumento(doc: Document, op: OpcoesDaChecagem = {}): ProblemaDaChecagem[] {
  const saida: ProblemaDaChecagem[] = [];
  const corpo = doc.body;
  if (!corpo) return saida;
  const janela = doc.defaultView;
  const estilo: Estilo = (el) => {
    try {
      return janela && janela.getComputedStyle ? janela.getComputedStyle(el) : null;
    } catch {
      return null;
    }
  };
  const largura = doc.documentElement ? doc.documentElement.clientWidth : 0;
  const temLayout = largura > 0 && corpo.getBoundingClientRect().width > 0;
  const add = (tipo: TipoDeChecagem, grave: boolean, txt: string, el: Element | null, aparelho?: "celular" | "computador") => {
    const caminho = el ? caminhoDe(el) : null;
    saida.push({ id: `${tipo}:${caminho || "pagina"}:${saida.length}`, tipo, grave, texto: txt, caminho, secao: el ? secaoDe(el) : null, ...(aparelho ? { aparelho } : {}) });
  };
  const nomeDoAparelho = op.aparelho === "celular" ? " no celular" : op.aparelho === "computador" ? " no computador" : "";

  // ---------------------------------------------------------------- links e botões
  const links = Array.prototype.slice.call(corpo.querySelectorAll("a")) as HTMLAnchorElement[];
  links.forEach((a) => {
    if (fora(a)) return;
    const href = a.getAttribute("href");
    const h = href === null ? null : href.trim();
    const imgAlt = Array.prototype.slice.call(a.querySelectorAll("img[alt]")).map((i: Element) => i.getAttribute("alt") || "").join(" ");
    const nome = norm(a.textContent) || norm(a.getAttribute("aria-label")) || norm(a.getAttribute("title")) || norm(imgAlt);
    const rotulo = nome ? `"${curto(nome, 40)}"` : "sem texto";
    if (h === null || h === "") add("link", true, `Link vazio: ${rotulo} não leva a lugar nenhum`, a);
    else if (h === "#") {
      if (!op.ignorarAncoraVazia) add("link", true, `Link sem destino (#): ${rotulo}`, a);
    } else if (/^javascript:/i.test(h)) add("link", true, `Link que não abre nada (javascript:): ${rotulo}`, a);
    else if (h.charAt(0) === "#") {
      let id = h.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* fica como veio */
      }
      if (!doc.getElementById(id) && !doc.getElementsByName(id).length) add("link", true, `Âncora quebrada: ${h} não existe na página (${rotulo})`, a);
    } else if (/^(mailto|tel):/i.test(h)) {
      const valor = h.slice(h.indexOf(":") + 1).split("?")[0].trim();
      const ok = /^tel:/i.test(h) ? valor.replace(/\D/g, "").length >= 8 : /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(valor);
      if (!ok) add("link", true, `Contato vazio ou inválido: ${h} (${rotulo})`, a);
    } else if (/^(https?:)?\/\//i.test(h)) {
      let u: URL | null = null;
      try {
        u = new URL(h, "https://exemplo.invalid/");
      } catch {
        u = null;
      }
      if (!u || !u.hostname || u.hostname.indexOf(".") < 0) add("link", true, `Endereço malformado: ${curto(h, 50)} (${rotulo})`, a);
      else if (/^(wa\.me|api\.whatsapp\.com)$/i.test(u.hostname) && !/\d{8,}/.test(`${u.pathname}${u.search}`)) add("link", true, `WhatsApp sem número: ${rotulo}`, a);
      else if (u.protocol === "http:") add("link", false, `Link sem https: ${curto(h, 50)}`, a);
    }
    if (!nome) add("link", false, "Link sem texto: quem usa leitor de tela não sabe aonde ele vai", a);
  });
  (Array.prototype.slice.call(corpo.querySelectorAll("button")) as HTMLElement[]).forEach((b) => {
    if (fora(b)) return;
    if (!norm(b.textContent) && !norm(b.getAttribute("aria-label")) && !norm(b.getAttribute("title"))) add("link", false, "Botão sem texto nem nome", b);
  });

  // ---------------------------------------------------------------- imagens: alt e peso
  const imagens = (Array.prototype.slice.call(corpo.querySelectorAll("img")) as HTMLImageElement[]).filter((i) => !fora(i));
  let semLazy = 0;
  imagens.forEach((img, n) => {
    const decorativa = img.getAttribute("role") === "presentation" || img.getAttribute("role") === "none";
    if (!img.hasAttribute("alt")) add("alt", true, `Imagem sem alt${img.getAttribute("src") ? `: ${curto(String(img.getAttribute("src")).split("/").pop() || "", 40)}` : ""}`, img);
    else if (!norm(img.getAttribute("alt")) && !decorativa) add("alt", false, "Imagem com alt vazio (só vale para enfeite)", img);
    if (n >= 3 && (img.getAttribute("loading") || "").toLowerCase() !== "lazy") semLazy += 1;
    if (temLayout && img.naturalWidth > LIMITES_DA_CHECAGEM.larguraDaImagem) add("peso", false, `Imagem grande demais (${img.naturalWidth}px de largura): reduza para até 2000px`, img);
  });

  // ---------------------------------------------------------------- títulos
  const titulos = (Array.prototype.slice.call(corpo.querySelectorAll("h1,h2,h3")) as Element[]).filter((t) => !fora(t));
  const h1s = titulos.filter((t) => t.tagName.toLowerCase() === "h1");
  if (h1s.length > 1) add("titulo", false, `Mais de um título principal (h1): ${h1s.length} na página`, h1s[1]);
  const vistos: Record<string, { n: number; el: Element; texto: string }> = {};
  titulos.forEach((t) => {
    const txt = norm(t.textContent);
    if (!txt) return;
    const k = txt.toLowerCase();
    if (vistos[k]) {
      vistos[k].n += 1;
      if (vistos[k].n === 2) vistos[k].el = t;
    } else vistos[k] = { n: 1, el: t, texto: txt };
  });
  Object.keys(vistos).forEach((k) => {
    const v = vistos[k];
    if (v.n > 1) add("titulo", false, `Título repetido ${v.n} vezes: "${curto(v.texto)}"`, v.el);
  });

  // ---------------------------------------------------------------- borda e contraste
  const textuais = (Array.prototype.slice.call(corpo.querySelectorAll(TEXTUAIS)) as HTMLElement[]).filter((el) => !fora(el));
  const pares: Record<string, true> = {};
  let contrastes = 0;
  textuais.forEach((el) => {
    const proprio = textoProprio(el);
    if (!proprio) return;
    // Sem layout: a palavra comprida que não quebra passa da borda no celular.
    const longa = proprio.split(" ").filter((p) => p.length >= LIMITES_DA_CHECAGEM.palavraLonga)[0];
    const cs = estilo(el);
    const quebra = cs ? `${cs.overflowWrap || ""} ${cs.wordBreak || ""} ${(cs as unknown as Record<string, string>)["word-wrap"] || ""}` : "";
    if (longa && !/break-word|break-all|anywhere/.test(quebra)) add("borda", false, `Palavra comprida pode passar da borda no celular: "${curto(longa, 40)}"`, el, op.aparelho);
    if (temLayout && cs && cs.display !== "none" && cs.visibility !== "hidden") {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const cortaX = /hidden|clip/.test(`${cs.overflowX || cs.overflow}`) || cs.textOverflow === "ellipsis";
        const cortaY = /hidden|clip/.test(`${cs.overflowY || cs.overflow}`);
        if (cortaX && el.scrollWidth > el.clientWidth + 1) add("borda", true, `Texto cortado${nomeDoAparelho}: "${curto(proprio)}"`, el, op.aparelho);
        else if (cortaY && el.scrollHeight > el.clientHeight + 2) add("borda", true, `Texto cortado embaixo${nomeDoAparelho}: "${curto(proprio)}"`, el, op.aparelho);
        else if ((r.right > largura + 1 || r.left < -1) && !dentroDeRolagem(el, estilo)) add("borda", true, `Texto passa da borda${nomeDoAparelho}: "${curto(proprio)}"`, el, op.aparelho);
      }
    }
    if (contrastes >= 8 || !cs) return;
    const cor = corDoTexto(el, estilo);
    const fundo = fundoDe(el, estilo);
    if (!cor || !fundo) return;
    const corOpaca = cor.a < 1 ? misturar(cor, fundo) : cor;
    const razao = contraste(corOpaca, fundo);
    const tamanho = parseFloat(cs.fontSize || "16") || 16;
    const peso = parseInt(cs.fontWeight || "400", 10) || (cs.fontWeight === "bold" ? 700 : 400);
    const grande = tamanho >= 24 || (tamanho >= 18.6 && peso >= 700);
    const minimo = grande ? 3 : 4.5;
    if (razao >= minimo) return;
    const par = `${hex(corOpaca)}/${hex(fundo)}`;
    if (pares[par]) return;
    pares[par] = true;
    contrastes += 1;
    add("contraste", razao < 3, `Contraste baixo (${razao.toFixed(1).replace(".", ",")}:1, mínimo ${String(minimo).replace(".", ",")}): ${hex(corOpaca)} sobre ${hex(fundo)} em "${curto(proprio, 40)}"`, el);
  });

  // A página inteira rola para o lado: aponta o elemento que mais passa.
  if (temLayout && doc.documentElement.scrollWidth > largura + 1) {
    let pior: Element | null = null;
    let direita = largura;
    const todos = corpo.querySelectorAll("*");
    for (let i = 0; i < todos.length && i < 4000; i++) {
      const el = todos[i];
      if (fora(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > direita + 1 && !dentroDeRolagem(el, estilo)) {
        direita = r.right;
        pior = el;
      }
    }
    add("borda", true, `A página rola para o lado${nomeDoAparelho} (${Math.round(doc.documentElement.scrollWidth - largura)}px a mais)`, pior, op.aparelho);
  }

  // ---------------------------------------------------------------- peso
  const kb = op.bytesDoHtml ? Math.round(op.bytesDoHtml / 1024) : 0;
  if (kb > LIMITES_DA_CHECAGEM.htmlKb) add("peso", false, `HTML pesado: ${kb} KB (o ideal é abaixo de ${LIMITES_DA_CHECAGEM.htmlKb} KB)`, null);
  if (imagens.length > LIMITES_DA_CHECAGEM.imagens) add("peso", false, `Imagens demais na página: ${imagens.length}`, null);
  if (semLazy > LIMITES_DA_CHECAGEM.semLazy) add("peso", false, `${semLazy} imagens abaixo da dobra sem carregamento preguiçoso (loading="lazy")`, null);

  return saida.sort((a, b) => (a.grave === b.grave ? 0 : a.grave ? -1 : 1));
}

/** Dentro de um carrossel ou faixa que rola ou corta de propósito (o texto sai da borda, mas a página não). */
function dentroDeRolagem(el: Element, estilo: Estilo): boolean {
  let atual = el.parentElement;
  while (atual && atual.tagName.toLowerCase() !== "body") {
    const cs = estilo(atual);
    if (cs && /auto|scroll|hidden|clip/.test(`${cs.overflowX || ""} ${cs.overflow || ""}`)) return true;
    atual = atual.parentElement;
  }
  return false;
}

/** Junta as checagens de mais de um aparelho sem repetir o mesmo problema. */
export function juntarChecagens(listas: ProblemaDaChecagem[][]): ProblemaDaChecagem[] {
  const vistos: Record<string, true> = {};
  const saida: ProblemaDaChecagem[] = [];
  listas.forEach((l) =>
    l.forEach((p) => {
      const k = `${p.tipo}|${p.caminho || ""}|${p.texto.replace(/ no (celular|computador)/, "")}`;
      if (vistos[k]) return;
      vistos[k] = true;
      saida.push({ ...p, id: `${p.id}:${saida.length}` });
    }),
  );
  return saida.sort((a, b) => (a.grave === b.grave ? 0 : a.grave ? -1 : 1));
}

/** Contagem por tipo (a linha de resumo). */
export function resumoDasChecagens(l: ProblemaDaChecagem[]): { total: number; graves: number; porTipo: Partial<Record<TipoDeChecagem, number>> } {
  const porTipo: Partial<Record<TipoDeChecagem, number>> = {};
  l.forEach((p) => (porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1));
  return { total: l.length, graves: l.filter((p) => p.grave).length, porTipo };
}

/** O pedido de correção ao diretor de site (preenche o campo; enviar e o custo seguem com a pessoa). */
export function pedidoDasChecagens(l: ProblemaDaChecagem[]): string {
  return `Corrija estes problemas das checagens antes de publicar:\n${l.slice(0, 12).map((p) => `- ${p.texto}${p.secao ? ` (seção ${p.secao})` : ""}`).join("\n")}`;
}

/** Leva a cópia da página até o elemento e marca (a tela chama com o documento do iframe sem script). */
export function irAteOProblema(doc: Document, caminho: string | null): boolean {
  if (!caminho || !CAMINHO_VALIDO.test(caminho)) return false;
  let el: HTMLElement | null = null;
  try {
    el = doc.querySelector(caminho) as HTMLElement | null;
  } catch {
    el = null;
  }
  if (!el) return false;
  try {
    el.scrollIntoView({ block: "center" });
  } catch {
    /* jsdom e navegador antigo */
  }
  el.style.outline = "3px solid #ef4444";
  el.style.outlineOffset = "3px";
  return true;
}
