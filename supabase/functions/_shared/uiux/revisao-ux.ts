/**
 * Regras de UX da base UI UX Pro Max conferidas por CÓDIGO no HTML
 * pré-renderizado e no CSS do build (frente UXM, 30/09/2026). É aviso, nunca
 * trava a publicação (regra "a conferência é só aviso"). Cerca de 20 regras
 * (REGRAS_POR_CODIGO em mapeamentos.ts); as de layout vivo ficam com o agente
 * do motor (prova em .aceleriq/ux/<seção>.json) e o resto é marcado pela
 * pessoa na Revisão.
 *
 * O worker chama revisarUxDasPaginas depois do revisarHtml (todas as páginas
 * do dist); a tela monta o checklist das 109 regras da web com
 * itensDoChecklist de checklist-de-ux.ts (sem dado da base, os textos vêm do
 * pt.ts carregado sob demanda). Sem Deno, sem banco. Sem lookbehind, sem
 * grupo nomeado, sem travessão.
 */

import type { AvisoDeQa } from "../site-metodo.ts";
import { contraste } from "../cores-da-marca.ts";
import { REGRAS_DE_UX_DA_BASE } from "./dados/ux.ts";
import { REGRAS_POR_CODIGO } from "./mapeamentos.ts";
import { REGRA_DE_UX_EM_PORTUGUES, severidadeDaRegra } from "./pt.ts";
import { type AvisoDeUx, type EntradaDoChecklist, type ItemDoChecklistDeUx, itensDoChecklist, REGRAS_DE_PAGINA, type RegraParaChecklist } from "./checklist-de-ux.ts";

export type { AvisoDeUx, EntradaDoChecklist, EstadoDoItem, ItemDoChecklistDeUx, ProvaDoAgente, RegraParaChecklist } from "./checklist-de-ux.ts";
export { pendenciasGraves, REGRAS_DE_PAGINA } from "./checklist-de-ux.ts";

const AREA_DA_REGRA: Record<string, AvisoDeQa["area"]> = { "68": "celular", "47": "seo", "50": "seo", "51": "seo", "75": "seo" };

const regraDaBase = (no: string) => REGRAS_DE_UX_DA_BASE.filter((r) => r.no === no)[0] || null;

function aviso(no: string, texto: string): AvisoDeUx {
  const r = regraDaBase(no);
  const pt = REGRA_DE_UX_EM_PORTUGUES[no];
  return {
    area: AREA_DA_REGRA[no] || "acessibilidade",
    texto,
    regra: `uupm:ux:${no}`,
    severidade: severidadeDaRegra(r ? r.severidade : "Medium"),
    corrigir: pt ? pt.corrigir : "",
    exemplo: r && r.codigoBom ? r.codigoBom : undefined,
    modo: "codigo",
  };
}

/** As variáveis de CSS (--nome: valor) de um texto de CSS (ex.: src/marca.css). */
export function lerTokensDoCss(css: string): Record<string, string> {
  const saida: Record<string, string> = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;}\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(css || "")))) saida[m[1]] = m[2].trim();
  return saida;
}

const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
const semTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const atributo = (tag: string, nome: string): string | null => {
  const m = new RegExp(`\\s${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : null;
};
const temAtributo = (tag: string, nome: string) => new RegExp(`\\s${nome}(\\s|=|>|/)`, "i").test(tag);

/**
 * Confere as regras de código. `html` é o HTML pré-renderizado (dist), `css` o
 * CSS do build (dist/assets/*.css juntos) e `tokens` as variáveis de
 * src/marca.css. Devolve só o que falhou.
 */
export function revisarUx(html: string, css: string, tokens: Record<string, string>): AvisoDeUx[] {
  const h = String(html || "");
  const c = String(css || "");
  const avisos: AvisoDeUx[] = [];
  const reduzido = /prefers-reduced-motion/i.test(c) || /prefers-reduced-motion/i.test(h);

  // 9 e 99: movimento reduzido.
  if (!reduzido && /@keyframes|animation\s*:|transition\s*:/i.test(c)) avisos.push(aviso("9", "O CSS anima, mas não tem @media (prefers-reduced-motion)."));
  if (!reduzido && /parallax|scrolltrigger|data-pin|scroll-timeline|position\s*:\s*sticky/i.test(`${c} ${h}`)) avisos.push(aviso("99", "Há efeito de rolagem (parallax, pin ou sticky) sem alternativa para movimento reduzido."));

  // 28 e 102: foco visível.
  const temFocoVisivel = /:focus-visible/i.test(c);
  if (!temFocoVisivel && !/:focus\b/i.test(c)) avisos.push(aviso("28", "O CSS não tem estilo de foco (:focus-visible)."));
  if (!temFocoVisivel && /outline\s*:\s*(none|0)\b/i.test(c)) avisos.push(aviso("102", "O CSS tira o contorno (outline: none) sem pôr um foco visível no lugar."));

  // 36 e 76: contraste dos tokens da marca.
  const fundo = hex(tokens["--cor-fundo"]);
  const texto = hex(tokens["--cor-texto"]);
  if (fundo && texto && contraste(texto, fundo) < 4.5) avisos.push(aviso("76", `Texto sobre o fundo com ${contraste(texto, fundo).toFixed(2)}:1 (o mínimo é 4,5:1).`));
  const destaque = hex(tokens["--cor-destaque"]);
  const sobre = hex(tokens["--cor-sobre-destaque"]);
  if (destaque && sobre && contraste(sobre, destaque) < 4.5) avisos.push(aviso("36", `Texto sobre o destaque com ${contraste(sobre, destaque).toFixed(2)}:1 (o mínimo é 4,5:1 no texto normal).`));
  const suave = hex(tokens["--cor-texto-suave"]);
  if (fundo && suave && contraste(suave, fundo) < 4.5) avisos.push(aviso("36", `Texto suave sobre o fundo com ${contraste(suave, fundo).toFixed(2)}:1.`));
  const linkCor = hex(tokens["--cor-destaque-texto"]) || destaque;
  if (fundo && linkCor && !tokens["--cor-destaque-texto"] && contraste(linkCor, fundo) < 4.5) avisos.push(aviso("36", `O destaque como texto sobre o fundo fica em ${contraste(linkCor, fundo).toFixed(2)}:1; use --cor-destaque-texto em link e texto pequeno.`));

  // 38: texto alternativo.
  const imgs = h.match(/<img\b[^>]*>/gi) || [];
  const semAlt = imgs.filter((i) => !temAtributo(i, "alt")).length;
  if (semAlt) avisos.push(aviso("38", `${semAlt} imagem(ns) sem alt.`));

  // 39: ordem dos títulos.
  const niveis = (h.match(/<h[1-6][\s>]/gi) || []).map((t) => Number(t.charAt(2)));
  for (let i = 1; i < niveis.length; i++) {
    if (niveis[i] > niveis[i - 1] + 1) {
      avisos.push(aviso("39", `Título pula de h${niveis[i - 1]} para h${niveis[i]}.`));
      break;
    }
  }

  // 42: HTML semântico.
  const faltam = ["main", "footer"].filter((t) => !new RegExp(`<${t}[\\s>]`, "i").test(h));
  if (faltam.length) avisos.push(aviso("42", `A página não tem ${faltam.map((t) => `<${t}>`).join(" nem ")}.`));

  // 43 e 54: campo sem rótulo.
  const ids: string[] = [];
  const reLabel = /<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi;
  let ml: RegExpExecArray | null;
  while ((ml = reLabel.exec(h))) ids.push(ml[1]);
  const campos = (h.match(/<(input|select|textarea)\b[^>]*>/gi) || []).filter((t) => !/type\s*=\s*["']?(hidden|submit|button|reset|image)/i.test(t));
  const semRotulo = campos.filter((t) => {
    const id = atributo(t, "id");
    if (id && ids.indexOf(id) >= 0) return false;
    if (temAtributo(t, "aria-label") || temAtributo(t, "aria-labelledby")) return false;
    // Campo dentro de <label>...</label>.
    const pos = h.indexOf(t);
    const antes = h.slice(Math.max(0, pos - 600), pos);
    const abriu = antes.lastIndexOf("<label");
    return !(abriu >= 0 && antes.indexOf("</label>", abriu) < 0);
  });
  if (semRotulo.length) avisos.push(aviso("43", `${semRotulo.length} campo(s) sem rótulo ligado.`));
  const soPlaceholder = semRotulo.filter((t) => temAtributo(t, "placeholder")).length;
  if (soPlaceholder) avisos.push(aviso("54", `${soPlaceholder} campo(s) usam só o placeholder como rótulo.`));

  // 45: pular para o conteúdo (quando há menu).
  if (/<nav[\s>]/i.test(h) && !/<a\b[^>]*href\s*=\s*["']#(main|conteudo|principal)["']/i.test(h)) avisos.push(aviso("45", "Há menu e falta o link \"Pular para o conteúdo\"."));

  // 47: imagens abaixo da dobra sem loading="lazy" (a primeira pode carregar na hora).
  const semLazy = imgs.slice(1).filter((i) => !/loading\s*=\s*["']?lazy/i.test(i)).length;
  if (semLazy) avisos.push(aviso("47", `${semLazy} imagem(ns) depois da primeira sem loading="lazy".`));

  // 50 e 75: a fonte carrega e com display=swap.
  const linksDeFonte = h.match(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/gi) || [];
  if (linksDeFonte.some((l) => !/display=(swap|optional|fallback)/i.test(l))) avisos.push(aviso("50", "A fonte do Google carrega sem display=swap."));
  if (/@font-face/i.test(c) && !/font-display\s*:/i.test(c)) avisos.push(aviso("50", "@font-face sem font-display."));
  const familia = String(tokens["--fonte-titulo"] || tokens["--fonte-texto"] || "");
  const temFamiliaPropria = /^\s*"[^"]+"/.test(familia);
  if (temFamiliaPropria && !linksDeFonte.length && !/@font-face/i.test(c)) avisos.push(aviso("75", "A fonte da marca está no CSS, mas nada a carrega (nem link do Google Fonts nem @font-face)."));

  // 51: script de terceiro sem async ou defer.
  const terceiros = (h.match(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^>]*>/gi) || []).filter((s) => !/\basync\b|\bdefer\b|type\s*=\s*["']module/i.test(s));
  if (terceiros.length) avisos.push(aviso("51", `${terceiros.length} script(s) de terceiros sem async ou defer.`));

  // 57 e 58: tipo e autocomplete de e-mail e telefone.
  const doContato = campos.filter((t) => /(email|e-mail|telefone|whatsapp|phone|\btel\b|celular)/i.test(`${atributo(t, "name") || ""} ${atributo(t, "id") || ""}`));
  const tipoErrado = doContato.filter((t) => {
    const nome = `${atributo(t, "name") || ""} ${atributo(t, "id") || ""}`.toLowerCase();
    const tipo = (atributo(t, "type") || "text").toLowerCase();
    return /mail/.test(nome) ? tipo !== "email" : tipo !== "tel";
  }).length;
  if (tipoErrado) avisos.push(aviso("57", `${tipoErrado} campo(s) de e-mail ou telefone sem o type certo.`));
  const semAuto = doContato.filter((t) => !temAtributo(t, "autocomplete")).length;
  if (semAuto) avisos.push(aviso("58", `${semAuto} campo(s) de contato sem autocomplete.`));

  // 68: viewport.
  if (!/<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(h)) avisos.push(aviso("68", "Falta a meta viewport com width=device-width."));

  // 96: vídeo que toca sozinho.
  const videos = (h.match(/<video\b[^>]*>/gi) || []).filter((v) => temAtributo(v, "autoplay") && (!temAtributo(v, "muted") || !temAtributo(v, "controls")));
  if (videos.length) avisos.push(aviso("96", `${videos.length} vídeo(s) com autoplay sem muted ou sem controles.`));

  // 108: carrossel ou faixa que gira sem pausa.
  const gira = /aria-roledescription=["']carousel|data-carrossel|data-marquee|class=["'][^"']*\b(carousel|carrossel|marquee)\b/i.test(h);
  const pausa = /<button\b[^>]*aria-label=["'][^"']*(paus|pause|parar)[^"']*["']/i.test(h) || /<button\b[^>]*>[^<]*(Pausar|Parar)/i.test(h);
  if (gira && !pausa) avisos.push(aviso("108", "Há carrossel ou faixa que gira sem botão de pausar."));

  return avisos;
}

export type PaginaParaRevisar = { caminho: string; html: string };

/**
 * revisarUx em TODAS as páginas pré-renderizadas (dist/index.html e
 * dist/<slug>/index.html): o mesmo aviso em várias páginas vira um só, com a
 * lista das páginas; as regras de página dizem onde acenderam. Devolve também
 * as páginas lidas (o checklist diz em quantas conferiu).
 */
export function revisarUxDasPaginas(paginas: PaginaParaRevisar[], css: string, tokens: Record<string, string>): { avisos: AvisoDeUx[]; paginas: string[] } {
  const lidas: string[] = [];
  const porChave: Record<string, AvisoDeUx & { paginas: string[] }> = {};
  const ordem: string[] = [];
  for (const p of paginas) {
    const caminho = String(p.caminho || "/");
    if (lidas.indexOf(caminho) >= 0) continue;
    lidas.push(caminho);
    for (const a of revisarUx(p.html, css, tokens)) {
      const chave = `${a.regra}|${a.texto}`;
      if (!porChave[chave]) {
        porChave[chave] = { ...a, paginas: [] };
        ordem.push(chave);
      }
      porChave[chave].paginas.push(caminho);
    }
  }
  const avisos = ordem.map((k) => {
    const a = porChave[k];
    const daPagina = REGRAS_DE_PAGINA.indexOf(a.regra.replace(/^uupm:ux:/, "")) >= 0;
    if (!daPagina || lidas.length < 2) return a;
    const onde = a.paginas.length === lidas.length ? "em todas as páginas" : `em ${a.paginas.slice(0, 6).join(", ")}${a.paginas.length > 6 ? " e outras" : ""}`;
    return { ...a, texto: `${a.texto} (${onde})`.slice(0, 300) };
  });
  return { avisos, paginas: lidas };
}

/** Texto curto do aviso sem tags (o HTML nunca volta cru para a tela). */
export const textoLimpo = (s: string) => semTags(s).slice(0, 300);

// ------------------------------------------------------------------ checklist das 109 regras da web

/**
 * O checklist mora em checklist-de-ux.ts, SEM dado da base (a tela o importa
 * de forma fixa e passa os textos do pt.ts que carregou sob demanda). Aqui
 * fica a versão com os textos já ligados, para o servidor, o worker e o teste.
 */
export function itensDoChecklistDeUx(regras: RegraParaChecklist[], entrada: EntradaDoChecklist): ItemDoChecklistDeUx[] {
  return itensDoChecklist(regras, entrada, { REGRA_DE_UX_EM_PORTUGUES, severidadeDaRegra });
}

export const TOTAL_POR_CODIGO = REGRAS_POR_CODIGO.length;
