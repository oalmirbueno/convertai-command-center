import { textoSobre } from "../../../supabase/functions/_shared/cores-da-marca";
import { mapaDoSite, secaoDaBiblioteca } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import { copyDoSite, type EstadoDaSecao, type OpcaoDaCopy, ROTULO_DO_ESTADO_DA_SECAO, type SiteDaPrevia } from "../../../supabase/functions/mesa-site/modulos/site-previa";
import { codigoDaPonte } from "../../../supabase/functions/mesa-site/modulos/ponte-da-previa";

/**
 * Prévia rápida do site (frente SPV, 30/09): o site montado no navegador a
 * partir do que a Mesa Site já sabe (mapa, copy escolhida, imagens, cores e
 * fontes da marca com o ajuste deste site), sem esperar o motor. Cada seção
 * sai com o estado da construção (pronta, construindo, na fila) e cada texto
 * com o endereço da copy, para a ponte editar ali mesmo.
 *
 * Roda num iframe com sandbox só de script (origem opaca) e CSP fechada:
 * imagem por https, fonte só do Google Fonts, nada de rede além disso. Todo
 * texto do cliente passa por `esc`. CSS sem flex gap e sem aspect-ratio
 * (Safari 11 abre a mesma prévia).
 */

export type DadosDaPreviaRapida = {
  nome: string;
  cores: { destaque: string; fundo: string; texto: string; escuro: boolean };
  fontes: { titulo: string | null; texto: string | null };
  fontes_url: string | null;
  logo_url: string | null;
  imagens: Array<{ id: string; slot: string; secao: string | null; origem: string; alt: string; escolhida: boolean; url: string | null }>;
};

export type SecaoDaPrevia = { uid: string; tipo: string; rotulo: string; estado: EstadoDaSecao; global: boolean; oculta: boolean; pagina: string | null };

export type PreviaMontada = {
  /** O documento inteiro (srcdoc do iframe). */
  documento: string;
  /** Só o miolo (para trocar sem recarregar). */
  html: string;
  /** Só as variáveis do tema. */
  css: string;
  fontesUrl: string | null;
  secoes: SecaoDaPrevia[];
  paginas: Array<{ id: string; titulo: string }>;
  pagina: string;
  temCopy: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;
const cor = (v: string | null | undefined, padrao: string) => (v && HEX.test(v) ? v : padrao);
const FAMILIA = /^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/;
const familia = (v: string | null | undefined) => (v && FAMILIA.test(v) ? `"${v}", ` : "");
const URL_SEGURA = /^https:\/\/[^\s"'<>]+$/;
const urlSegura = (v: string | null | undefined) => (v && URL_SEGURA.test(v) ? v : null);

/** Escapa texto para HTML (conteúdo e atributo). */
export function esc(v: unknown): string {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const campo = (c: string | null) => (c ? ` data-aq-campo="${esc(c)}"` : "");

/** O CSS do tema (variáveis): muda com a cor e a fonte, sem recarregar a prévia. */
export function cssDoTema(d: Pick<DadosDaPreviaRapida, "cores" | "fontes">): string {
  const destaque = cor(d.cores.destaque, "#00d52b");
  const fundo = cor(d.cores.fundo, "#fafaf7");
  const texto = cor(d.cores.texto, "#111111");
  const escuro = !!d.cores.escuro;
  return [
    ":root{",
    `--aq-destaque:${destaque};`,
    `--aq-sobre-destaque:${textoSobre(destaque)};`,
    `--aq-fundo:${fundo};`,
    `--aq-texto:${texto};`,
    `--aq-suave:${escuro ? "#a3a3a3" : "#5c5c5c"};`,
    `--aq-superficie:${escuro ? "#18181a" : "#ffffff"};`,
    `--aq-borda:${escuro ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)"};`,
    `--aq-fonte-titulo:${familia(d.fontes.titulo)}ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;`,
    `--aq-fonte-texto:${familia(d.fontes.texto)}ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;`,
    "}",
  ].join("");
}

const CSS_BASE = [
  "*,*:before,*:after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%}",
  "body{margin:0;background:var(--aq-fundo);color:var(--aq-texto);font-family:var(--aq-fonte-texto);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}",
  "img{display:block;max-width:100%}",
  "h1,h2,h3,h4{font-family:var(--aq-fonte-titulo);line-height:1.12;margin:0;letter-spacing:-.015em}",
  "p {margin:0}",
  "[data-secao]{position:relative}",
  // SPV: o texto longo da copy guarda o parágrafo (Shift+Enter na prévia); a prévia mostra a quebra.
  "[data-aq-campo]{white-space:pre-line}",
  ".aq-sec{position:relative;padding:88px 24px}",
  ".aq-sec+.aq-sec{border-top:1px solid var(--aq-borda)}",
  ".aq-miolo{max-width:1120px;margin:0 auto}",
  ".aq-titulo{font-size:40px;font-weight:700;max-width:760px}",
  ".aq-texto{margin-top:16px;font-size:18px;color:var(--aq-suave);max-width:680px}",
  ".aq-botao{display:inline-block;margin-top:28px;padding:14px 22px;border-radius:999px;background:var(--aq-destaque);color:var(--aq-sobre-destaque);font-weight:600;text-decoration:none;font-size:16px}",
  ".aq-botao-2{display:inline-block;margin:28px 0 0 12px;padding:13px 21px;border-radius:999px;border:1px solid var(--aq-borda);color:inherit;font-weight:600;text-decoration:none;font-size:16px}",
  ".aq-grade{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:20px;gap:20px;margin-top:40px}",
  ".aq-cartao{padding:24px;border-radius:16px;background:var(--aq-superficie);border:1px solid var(--aq-borda)}",
  ".aq-cartao p {font-size:16px;color:var(--aq-suave)}",
  ".aq-forte{display:block;color:var(--aq-texto);font-family:var(--aq-fonte-titulo);font-weight:650;font-size:18px;margin-bottom:6px}",
  ".aq-numero{display:block;font-family:var(--aq-fonte-titulo);font-size:14px;font-weight:700;color:var(--aq-destaque);margin-bottom:10px}",
  ".aq-imagem{width:100%;height:280px;object-fit:cover;border-radius:16px;margin-top:40px;background:var(--aq-superficie)}",
  ".aq-imagens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-gap:16px;gap:16px;margin-top:40px}",
  ".aq-imagens .aq-imagem{margin-top:0}",
  ".aq-topo{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid var(--aq-borda);background:var(--aq-fundo);position:relative}",
  ".aq-marca{display:flex;align-items:center;font-family:var(--aq-fonte-titulo);font-weight:700;font-size:18px}",
  ".aq-marca img{height:32px;width:auto;margin-right:10px}",
  ".aq-menu{display:flex;align-items:center;list-style:none;margin:0;padding:0}",
  ".aq-menu li{margin-left:22px;font-size:15px;color:var(--aq-suave)}",
  ".aq-menu .aq-botao{margin:0 0 0 22px;padding:10px 16px;font-size:14px}",
  ".aq-hero{position:relative;min-height:640px;display:flex;align-items:center;padding:96px 24px;overflow:hidden}",
  ".aq-hero .aq-fundo-img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}",
  ".aq-hero .aq-veu{position:absolute;left:0;top:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(0,0,0,.72),rgba(0,0,0,.25))}",
  ".aq-hero.aq-com-img{color:#fff}",
  ".aq-hero.aq-com-img .aq-texto{color:rgba(255,255,255,.85)}",
  ".aq-hero .aq-miolo{position:relative;width:100%}",
  ".aq-hero h1{font-size:60px;font-weight:750;max-width:820px}",
  ".aq-dividido{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-gap:48px;gap:48px;align-items:center}",
  ".aq-dividido .aq-imagem{height:460px;margin-top:0}",
  ".aq-grande{font-size:48px}",
  ".aq-lista{margin:28px 0 0;padding:0;list-style:none}",
  ".aq-lista li{padding:14px 0;border-top:1px solid var(--aq-borda);font-size:17px}",
  ".aq-faq{margin-top:36px;max-width:820px}",
  ".aq-faq-item{padding:22px 0;border-top:1px solid var(--aq-borda)}",
  ".aq-faq-item h3{font-size:19px;font-weight:650}",
  ".aq-faq-item p {margin-top:8px;color:var(--aq-suave)}",
  ".aq-chamada{text-align:center;background:var(--aq-destaque);color:var(--aq-sobre-destaque);overflow:hidden}",
  ".aq-chamada .aq-titulo,.aq-chamada .aq-texto{margin-left:auto;margin-right:auto;color:inherit}",
  ".aq-chamada .aq-texto{opacity:.85}",
  ".aq-chamada .aq-botao{background:var(--aq-sobre-destaque);color:var(--aq-destaque)}",
  ".aq-chamada .aq-fundo-img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:.18}",
  ".aq-chamada .aq-miolo{position:relative}",
  ".aq-faixa{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:28px}",
  ".aq-faixa span{margin:8px 18px;font-family:var(--aq-fonte-titulo);font-weight:650;font-size:20px;color:var(--aq-suave)}",
  ".aq-rodape{padding:48px 24px;font-size:14px;color:var(--aq-suave);border-top:1px solid var(--aq-borda)}",
  ".aq-rodape .aq-miolo{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);grid-gap:32px;gap:32px}",
  ".aq-rodape ul{list-style:none;margin:0;padding:0}",
  ".aq-rodape li{margin-bottom:6px}",
  ".aq-vazio{color:var(--aq-suave);font-style:italic;opacity:.8}",
  // Estado da construção (casca da prévia, não é do site).
  ".aq-selo{position:absolute;z-index:5;left:12px;top:12px;padding:3px 9px;border-radius:999px;font:600 11px/16px system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0b0c;color:#fff;pointer-events:none;letter-spacing:.01em}",
  ".aq-selo-construindo{background:#00c428;color:#04140a}",
  ".aq-selo-na_fila{background:#3f3f46}",
  ".aq-selo-falhou{background:#dc2626}",
  ".aq-selo-pendente{background:#52525b}",
  ".aq-rascunho{outline:2px dashed rgba(127,127,127,.35);outline-offset:-8px}",
  ".aq-construindo{outline:2px solid rgba(0,196,40,.7);outline-offset:-8px;animation:aqPulso 1.6s ease-in-out infinite}",
  "@keyframes aqPulso{0%,100%{outline-color:rgba(0,196,40,.25)}50%{outline-color:rgba(0,196,40,.9)}}",
  "@media (prefers-reduced-motion:reduce){.aq-construindo{animation:none}}",
  "@media (max-width:720px){.aq-sec{padding:64px 20px}.aq-titulo{font-size:30px}.aq-hero{min-height:560px;padding:72px 20px}.aq-hero h1{font-size:38px}.aq-grande{font-size:32px}.aq-texto{font-size:16px}.aq-grade,.aq-imagens,.aq-dividido,.aq-rodape .aq-miolo{grid-template-columns:minmax(0,1fr)}.aq-menu li{display:none}.aq-menu li.aq-menu-cta{display:block}.aq-dividido .aq-imagem{height:300px}.aq-botao-2{margin-left:0}}",
].join("");

/** Uma imagem clicável (a ponte troca pela da biblioteca); sem imagem, o lugar dela. */
function imagem(img: DadosDaPreviaRapida["imagens"][number] | null, slot: string, classe: string, rotulo: string): string {
  if (img && urlSegura(img.url)) return `<img class="${classe}" src="${esc(img.url)}" alt="${esc(img.alt)}" data-aq-img-id="${esc(img.id)}" data-aq-slot="${esc(slot)}" loading="lazy">`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="100%" height="100%" fill="#d4d4d8"/><text x="50%" y="50%" fill="#52525b" font-family="system-ui,sans-serif" font-size="26" text-anchor="middle" dominant-baseline="middle">+ ${esc(rotulo)}</text></svg>`;
  return `<img class="${classe}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="${esc(rotulo)}" data-aq-slot="${esc(slot)}">`;
}

type Copia = { titulo: string; texto: string; itens: string[]; cta: string; tem: boolean };

function copiaDa(copy: OpcaoDaCopy | null, uid: string): Copia {
  const s = copy && Array.isArray(copy.secoes) ? copy.secoes.find((x) => x && x.id === uid) : null;
  return {
    titulo: s && typeof s.titulo === "string" ? s.titulo : "",
    texto: s && typeof s.texto === "string" ? s.texto : "",
    itens: s && Array.isArray(s.itens) ? s.itens.map((i) => String(i)) : [],
    cta: s && typeof s.cta === "string" ? s.cta : "",
    tem: !!s,
  };
}

/** "Título: frase" vira título forte e frase (o texto inteiro continua um campo só). */
function item(texto: string, endereco: string, n: number, numerar: boolean): string {
  const i = texto.indexOf(":");
  const miolo = i > 0 && i < 60 ? `<span class="aq-forte">${esc(texto.slice(0, i + 1))}</span>${esc(texto.slice(i + 1).trim())}` : esc(texto);
  return `<div class="aq-cartao">${numerar ? `<span class="aq-numero" data-aq-chrome>${String(n + 1).padStart(2, "0")}</span>` : ""}<p${campo(endereco)}>${miolo}</p></div>`;
}

function tituloETexto(uid: string, c: Copia, rotulo: string, grande = false): string {
  const titulo = c.titulo ? `<h2 class="aq-titulo${grande ? " aq-grande" : ""}"${campo(`secao:${uid}:titulo`)}>${esc(c.titulo)}</h2>` : `<h2 class="aq-titulo aq-vazio" data-aq-chrome>${esc(rotulo)}</h2>`;
  const texto = c.texto ? `<p class="aq-texto"${campo(`secao:${uid}:texto`)}>${esc(c.texto)}</p>` : c.tem ? "" : `<p class="aq-texto aq-vazio" data-aq-chrome>Sem texto na copy para esta seção.</p>`;
  return titulo + texto;
}

function selo(estado: EstadoDaSecao, marcar: boolean): { classe: string; html: string } {
  if (!marcar || estado === "pronta") return { classe: "", html: "" };
  return { classe: estado === "construindo" ? " aq-construindo" : " aq-rascunho", html: `<div class="aq-selo aq-selo-${estado}" data-aq-chrome>${esc(ROTULO_DO_ESTADO_DA_SECAO[estado])}</div>` };
}

type Contexto = { copy: OpcaoDaCopy | null; dados: DadosDaPreviaRapida; imagensDa: (uid: string, tipo: string) => DadosDaPreviaRapida["imagens"]; menu: string[] };

function secaoHtml(uid: string, tipo: string, estado: EstadoDaSecao, marcar: boolean, ctx: Contexto): string {
  const rotulo = rotuloDaSecao(uid);
  const c = copiaDa(ctx.copy, uid);
  const s = selo(estado, marcar);
  const imgs = ctx.imagensDa(uid, tipo);
  const lib = secaoDaBiblioteca(tipo);
  const slotDaSecao = lib && lib.slots.length ? lib.slots[0].slot : "secao";
  const attrs = (classe: string) => ` class="${classe}${s.classe}" data-secao="${esc(uid)}" data-aq-rotulo="${esc(rotulo)}"`;
  const copy = ctx.copy;
  if (tipo === "topo") {
    const marca = ctx.dados.logo_url && urlSegura(ctx.dados.logo_url) ? `<img src="${esc(ctx.dados.logo_url)}" alt="${esc(ctx.dados.nome)}">` : "";
    const itens = c.itens.length ? c.itens : ctx.menu;
    const cta = c.cta || (copy && copy.cta) || "";
    const ctaCampo = c.cta ? `secao:${uid}:cta` : copy && copy.cta ? "cta" : null;
    const menu = itens
      .slice(0, 6)
      .map((t, n) => (c.itens.length ? `<li${campo(`secao:${uid}:item:${n}`)}>${esc(t)}</li>` : `<li data-aq-chrome>${esc(t)}</li>`))
      .join("");
    return `<header${attrs("aq-topo")}>${s.html}<div class="aq-marca">${marca}<span${c.titulo ? campo(`secao:${uid}:titulo`) : " data-aq-chrome"}>${esc(c.titulo || ctx.dados.nome)}</span></div><ul class="aq-menu">${menu}${cta ? `<li class="aq-menu-cta"><a class="aq-botao" href="#"${campo(ctaCampo)}>${esc(cta)}</a></li>` : ""}</ul></header>`;
  }
  if (tipo === "rodape") {
    const lista = c.itens.map((t, n) => `<li${campo(`secao:${uid}:item:${n}`)}>${esc(t)}</li>`).join("");
    return `<footer${attrs("aq-rodape")}>${s.html}<div class="aq-miolo"><div><strong${c.titulo ? campo(`secao:${uid}:titulo`) : " data-aq-chrome"}>${esc(c.titulo || ctx.dados.nome)}</strong>${c.texto ? `<p style="margin-top:8px"${campo(`secao:${uid}:texto`)}>${esc(c.texto)}</p>` : ""}</div><ul>${lista}</ul></div><p style="margin-top:24px" data-aq-chrome>© ${new Date().getFullYear()} ${esc(ctx.dados.nome)}</p></footer>`;
  }
  if (tipo === "hero" || tipo === "hero_dividido") {
    const h = copy && copy.headline ? `<h1${campo("headline")}>${esc(copy.headline)}</h1>` : c.titulo ? `<h1${campo(`secao:${uid}:titulo`)}>${esc(c.titulo)}</h1>` : `<h1 class="aq-vazio" data-aq-chrome>${esc(rotulo)}</h1>`;
    const sub = copy && copy.subtitulo ? `<p class="aq-texto"${campo("subtitulo")}>${esc(copy.subtitulo)}</p>` : c.texto ? `<p class="aq-texto"${campo(`secao:${uid}:texto`)}>${esc(c.texto)}</p>` : "";
    const cta = copy && copy.cta ? `<a class="aq-botao" href="#"${campo("cta")}>${esc(copy.cta)}</a>` : "";
    const segundo = c.itens.length > 1 ? `<a class="aq-botao-2" href="#"${campo(`secao:${uid}:item:1`)}>${esc(c.itens[1])}</a>` : "";
    const img = imgs[0] || null;
    // Sem imagem, a abertura fica dividida com o lugar da imagem (clicável para escolher uma).
    if (tipo === "hero_dividido" || !img) {
      return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo aq-dividido"><div>${h.replace(/^<h1(?: class="([^"]*)")?/, (_x: string, c?: string) => `<h1 class="aq-titulo aq-grande${c ? ` ${c}` : ""}"`)}${sub}<div>${cta}${segundo}</div></div>${imagem(img, tipo === "hero" ? "hero" : slotDaSecao, "aq-imagem", "Imagem da abertura")}</div></section>`;
    }
    const fundo = imagem(img, "hero", "aq-fundo-img", "Imagem da abertura") + '<div class="aq-veu" data-aq-chrome></div>';
    return `<section${attrs("aq-hero aq-com-img")}>${s.html}${fundo}<div class="aq-miolo">${h}${sub}<div>${cta}${segundo}</div></div></section>`;
  }
  if (tipo === "faq") {
    const faq = copy && Array.isArray(copy.faq) ? copy.faq : [];
    const lista = faq.map((f, n) => `<div class="aq-faq-item"><h3${campo(`faq:${n}:pergunta`)}>${esc(f.pergunta)}</h3><p${campo(`faq:${n}:resposta`)}>${esc(f.resposta)}</p></div>`).join("");
    return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo">${tituloETexto(uid, c, rotulo)}<div class="aq-faq">${lista || '<p class="aq-vazio" data-aq-chrome>Sem perguntas na copy.</p>'}</div></div></section>`;
  }
  if (tipo === "chamada") {
    const img = imgs[0] || null;
    const cta = c.cta ? `<a class="aq-botao" href="#"${campo(`secao:${uid}:cta`)}>${esc(c.cta)}</a>` : copy && copy.cta ? `<a class="aq-botao" href="#"${campo("cta")}>${esc(copy.cta)}</a>` : "";
    return `<section${attrs("aq-sec aq-chamada")}>${s.html}${img ? imagem(img, "fundo", "aq-fundo-img", "Fundo") : ""}<div class="aq-miolo">${tituloETexto(uid, c, rotulo, true)}${cta}</div></section>`;
  }
  if (tipo === "marquee") {
    return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo">${tituloETexto(uid, c, rotulo)}<div class="aq-faixa">${c.itens.map((t, n) => `<span${campo(`secao:${uid}:item:${n}`)}>${esc(t)}</span>`).join("")}</div></div></section>`;
  }
  if (tipo === "problema" || tipo === "sobre") {
    const lista = c.itens.length ? `<ul class="aq-lista">${c.itens.map((t, n) => `<li${campo(`secao:${uid}:item:${n}`)}>${esc(t)}</li>`).join("")}</ul>` : "";
    const img = imgs[0] || null;
    if (tipo === "sobre") return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo aq-dividido"><div>${tituloETexto(uid, c, rotulo)}${lista}</div>${imagem(img, slotDaSecao, "aq-imagem", "Foto real")}</div></section>`;
    return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo">${tituloETexto(uid, c, rotulo, true)}${lista}</div></section>`;
  }
  if (tipo === "galeria" || tipo === "portfolio" || tipo === "antes_depois") {
    const quantos = lib && lib.slots.length ? lib.slots[0].quantos : 2;
    const lugares = Array.from({ length: Math.max(imgs.length, Math.min(quantos, 4)) }, (_, n) => imagem(imgs[n] || null, slotDaSecao, "aq-imagem", `Imagem ${n + 1}`)).join("");
    const lista = c.itens.length ? `<div class="aq-grade">${c.itens.map((t, n) => item(t, `secao:${uid}:item:${n}`, n, false)).join("")}</div>` : "";
    return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo">${tituloETexto(uid, c, rotulo)}<div class="aq-imagens">${lugares}</div>${lista}</div></section>`;
  }
  // Seções de itens (serviços, bento, processo, diferenciais, prova, números, planos, equipe, vitrine, links, contato...).
  const numerar = tipo === "processo" || tipo === "rolagem_fixa";
  const grade = c.itens.length ? `<div class="aq-grade">${c.itens.map((t, n) => item(t, `secao:${uid}:item:${n}`, n, numerar)).join("")}</div>` : "";
  const cta = c.cta ? `<a class="aq-botao" href="#"${campo(`secao:${uid}:cta`)}>${esc(c.cta)}</a>` : "";
  const fotos = imgs.length ? (imgs.length > 1 ? `<div class="aq-imagens">${imgs.slice(0, 4).map((i) => imagem(i, slotDaSecao, "aq-imagem", "Imagem")).join("")}</div>` : imagem(imgs[0], slotDaSecao, "aq-imagem", "Imagem")) : lib && lib.slots.length && !lib.slots[0].so_real ? imagem(null, slotDaSecao, "aq-imagem", "Imagem da seção") : "";
  return `<section${attrs("aq-sec")}>${s.html}<div class="aq-miolo">${tituloETexto(uid, c, rotulo)}${grade}${fotos}${cta}</div></section>`;
}

/**
 * Monta a prévia rápida de uma página do site. `estados` vem de
 * estadoDasSecoes (trabalhos do motor); `marcarEstados` desliga os selos
 * (ver o site limpo). `rolagem` guarda onde a pessoa estava.
 */
export function montarPreviaRapida(
  site: SiteDaPrevia & { nome?: string },
  dados: DadosDaPreviaRapida,
  opcoes: { pagina?: string | null; estados?: Record<string, EstadoDaSecao>; marcarEstados?: boolean; rolagem?: number } = {},
): PreviaMontada {
  const mapa = mapaDoSite({ mapa: site.mapa, tipo: site.tipo, direcao: site.direcao || {} });
  const pagina = mapa.paginas.find((p) => p.id === opcoes.pagina) || mapa.paginas[0];
  const { copy } = copyDoSite(site.conteudo);
  const estados = opcoes.estados || {};
  const marcar = opcoes.marcarEstados !== false;
  const escolhidas = dados.imagens.filter((i) => i.escolhida && !!i.url);
  const imagensDa = (uid: string, tipo: string) => {
    const daSecao = escolhidas.filter((i) => i.secao === uid);
    if (daSecao.length) return daSecao;
    // Imagem antiga sem seção: a do slot da abertura vai para o hero; as outras ficam na biblioteca.
    if (tipo === "hero") return escolhidas.filter((i) => !i.secao && i.slot === "hero").slice(0, 1);
    return [];
  };
  const menu = mapa.paginas.length > 1 ? mapa.paginas.map((p) => p.titulo) : pagina ? pagina.secoes.slice(0, 4).map((s) => rotuloDaSecao(s.uid)) : [];
  const ctx: Contexto = { copy, dados, imagensDa, menu };
  const ordem: Array<{ uid: string; tipo: string; global: boolean }> = [];
  if (mapa.globais.indexOf("topo") >= 0) ordem.push({ uid: "topo", tipo: "topo", global: true });
  (pagina ? pagina.secoes : []).forEach((s) => ordem.push({ uid: s.uid, tipo: s.tipo, global: false }));
  if (mapa.globais.indexOf("rodape") >= 0) ordem.push({ uid: "rodape", tipo: "rodape", global: true });
  const html = ordem.map((s) => secaoHtml(s.uid, s.tipo, estados[s.uid] || "pendente", marcar, ctx)).join("");
  const css = cssDoTema(dados);
  const fontesUrl = urlSegura(dados.fontes_url) && String(dados.fontes_url).indexOf("https://fonts.googleapis.com/") === 0 ? dados.fontes_url : null;
  const csp = "default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'";
  const rolagem = Math.max(0, Math.round(Number(opcoes.rolagem) || 0));
  const documento = [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<title>${esc(site.nome || dados.nome)}</title>`,
    `<link id="aq-fontes" rel="stylesheet" href="${esc(fontesUrl || "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap")}">`,
    `<style id="aq-base">${CSS_BASE}</style><style id="aq-tema">${css}</style>`,
    `</head><body><div id="aq-raiz">${html}</div>`,
    `<script>window.__aqRolagem=${rolagem};</script>`,
    `<script>${codigoDaPonte()}</script>`,
    "</body></html>",
  ].join("");
  const ocultas = (mapa.ocultas || []).filter((o) => o.pagina === null || (pagina && o.pagina === pagina.id));
  const secoes: SecaoDaPrevia[] = ordem
    .map((s) => ({ uid: s.uid, tipo: s.tipo, rotulo: rotuloDaSecao(s.uid), estado: estados[s.uid] || ("pendente" as EstadoDaSecao), global: s.global, oculta: false, pagina: s.global ? null : pagina ? pagina.id : null }))
    .concat(ocultas.map((o) => ({ uid: o.uid, tipo: o.tipo, rotulo: rotuloDaSecao(o.uid), estado: estados[o.uid] || ("pendente" as EstadoDaSecao), global: o.pagina === null, oculta: true, pagina: o.pagina })));
  return { documento, html, css, fontesUrl, secoes, paginas: mapa.paginas.map((p) => ({ id: p.id, titulo: p.titulo })), pagina: pagina ? pagina.id : "", temCopy: !!copy };
}
