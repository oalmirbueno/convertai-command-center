/**
 * Ponte da prévia editável (frente SPV, 30/09/2026): o script que roda DENTRO
 * da prévia do site (a prévia rápida do painel e o site do motor, no Vite do
 * worker) e conversa com a Mesa Site por postMessage.
 *
 * Dentro da prévia, com "Editar" ligado:
 *  - clicar num texto abre a edição ali mesmo (Enter salva, Esc desiste,
 *    colar entra como texto puro); Shift+Enter quebra linha só nos textos
 *    longos da copy (texto da seção, resposta, subtítulo), que guardam o
 *    parágrafo; nos outros a quebra não entra. O texto que é da copy (achado
 *    pelo endereço ou pelo próprio texto) vai direto, o resto a tela manda ao
 *    motor como ajuste;
 *  - clicar numa imagem pede a troca;
 *  - a barrinha da seção (passando o mouse) sobe, desce, esconde ou pede
 *    ajuste ao motor;
 *  - Ctrl+Z fora da edição pede o Desfazer da tela (só com Editar ligado).
 * Links e botões do site não navegam enquanto edita.
 *
 * Mensagens que ENTRAM (só da janela de cima): modo { editar }, campos
 * { campos, rotulos }, html { html, css } (só na prévia rápida), fontes { url },
 * ir { secao }, recarregar. Mensagens que SAEM: pronta, editar, imagem, secao,
 * desfazer, rolagem. Quem recebe confere a origem (a janela do iframe).
 *
 * É texto (o worker grava em .aceleriq/ponte.js e o Vite serve só em
 * desenvolvimento; a prévia rápida põe inline). Escrito em JavaScript antigo
 * de propósito (Safari 11): sem crase, sem ${}, sem regex nova.
 */

export const VERSAO_DA_PONTE = 1;

const PONTE = String.raw`(function () {
  "use strict";
  if (window.__aqPonte) return;
  window.__aqPonte = 1;
  var pai = window.parent;
  if (!pai || pai === window) return;
  var editar = false;
  var campos = [];
  var rotulos = {};
  var editando = null;
  var antesHtml = "";
  var antesTexto = "";
  var pendente = null;
  var secaoDaBarra = null;
  var ultimoAviso = "";
  var TEXTO = "h1,h2,h3,h4,h5,h6,p,li,a,button,span,summary,dt,dd,blockquote,figcaption,label,strong,em,small,td,th";
  var INLINE = { SPAN: 1, STRONG: 1, EM: 1, B: 1, I: 1, BR: 1, SMALL: 1, MARK: 1, U: 1, SUP: 1, SUB: 1, SVG: 1, IMG: 0 };
  var UID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

  function enviar(m) { try { pai.postMessage(m, "*"); } catch (e) { /* janela de cima fechou */ } }
  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function normLongo(s) {
    var linhas = String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").split("\n");
    for (var i = 0; i < linhas.length; i++) linhas[i] = linhas[i].trim();
    return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function campoDe(el) { return el ? el.getAttribute("data-aq-campo") || el.getAttribute("data-aq-achado") || null : null; }
  function longo(el) { var c = campoDe(el); return !!c && /^subtitulo$|:texto$|:resposta$/.test(c); }
  function normDe(el, s) { return longo(el) ? normLongo(s) : norm(s); }
  function valorGuardado(c) {
    for (var i = 0; i < campos.length; i++) if (campos[i] && campos[i].campo === c) return String(campos[i].valor == null ? "" : campos[i].valor);
    return null;
  }
  function visivel(el) { return typeof el.innerText === "string" ? el.innerText : el.textContent; }
  function escapar(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function perto(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  function daCasca(el) { return !!perto(el, "[data-aq-chrome]"); }
  function secaoDe(el) { var s = perto(el, "[data-secao]"); return s ? s.getAttribute("data-secao") : null; }

  var css = document.createElement("style");
  css.setAttribute("data-aq-chrome", "");
  css.textContent = [
    "html.aq-editar [data-aq-editavel]{cursor:text;border-radius:2px;outline:1px dashed transparent;outline-offset:3px;transition:outline-color .15s}",
    "html.aq-editar [data-aq-editavel]:hover{outline-color:rgba(245,158,11,.95)}",
    "html.aq-editar [data-aq-editavel][data-aq-campo]:hover,html.aq-editar [data-aq-editavel][data-aq-achado]:hover{outline-color:rgba(0,196,40,.95)}",
    "html.aq-editar [data-aq-editando]{outline:2px solid #00c428 !important;outline-offset:3px;background:rgba(0,196,40,.08);cursor:text}",
    "html.aq-editar img[data-aq-img]{cursor:pointer}",
    "html.aq-editar img[data-aq-img]:hover{outline:3px solid #00c428;outline-offset:-3px}",
    "html.aq-editar [data-secao]:hover{box-shadow:inset 0 0 0 1px rgba(0,196,40,.45)}",
    "#aq-barra{position:fixed;z-index:2147483646;display:none;align-items:center;background:#0b0b0c;color:#fff;border-radius:8px;padding:3px;font:500 12px/16px system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28)}",
    "#aq-barra [data-aq-nome]{display:inline-block;padding:6px 8px;color:#a3a3a3;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#aq-barra button{-webkit-appearance:none;appearance:none;border:0;background:transparent;color:#fff;font:inherit;line-height:16px;cursor:pointer;padding:6px 8px;border-radius:6px;margin:0 0 0 2px}",
    "#aq-barra button:hover,#aq-barra button:focus{background:rgba(255,255,255,.16);outline:none}"
  ].join("");
  (document.head || document.documentElement).appendChild(css);

  var barra = document.createElement("div");
  barra.id = "aq-barra";
  barra.setAttribute("data-aq-chrome", "");
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", "Seção");
  barra.innerHTML = '<span data-aq-nome></span>' +
    '<button type="button" data-aq-acao="subir" title="Subir a seção" aria-label="Subir a seção">&#8593;</button>' +
    '<button type="button" data-aq-acao="descer" title="Descer a seção" aria-label="Descer a seção">&#8595;</button>' +
    '<button type="button" data-aq-acao="esconder" title="Esconder a seção do site">Esconder</button>' +
    '<button type="button" data-aq-acao="ajuste" title="Pedir ao motor uma mudança nesta seção">Pedir ajuste</button>';

  function pendurarBarra() { if (document.body && barra.parentNode !== document.body) document.body.appendChild(barra); }

  function mostrarBarra(secaoEl) {
    if (!editar || !secaoEl) { barra.style.display = "none"; secaoDaBarra = null; return; }
    pendurarBarra();
    var uid = secaoEl.getAttribute("data-secao");
    secaoDaBarra = uid;
    var r = secaoEl.getBoundingClientRect();
    var topo = Math.max(8, r.top + 8);
    if (topo > window.innerHeight - 44) topo = Math.max(8, window.innerHeight - 44);
    barra.style.display = "flex";
    barra.style.top = topo + "px";
    barra.style.right = Math.max(8, window.innerWidth - r.right + 8) + "px";
    var nome = barra.querySelector("[data-aq-nome]");
    if (nome) nome.textContent = secaoEl.getAttribute("data-aq-rotulo") || rotulos[uid] || uid;
  }

  function folha(el) {
    for (var i = 0; i < el.children.length; i++) if (!INLINE[el.children[i].tagName.toUpperCase()]) return false;
    return true;
  }

  function marcar() {
    var raiz = document.body;
    if (!raiz) return { n: 0, m: 0 };
    var porTexto = {};
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i];
      var k = norm(c && c.valor).toLowerCase();
      if (!k) continue;
      if (!porTexto[k]) porTexto[k] = [];
      porTexto[k].push(c);
    }
    var els = raiz.querySelectorAll(TEXTO);
    var n = 0;
    var m = 0;
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      if (daCasca(el)) continue;
      var uid = secaoDe(el);
      if (!uid) continue;
      if (el.hasAttribute("data-aq-campo")) { el.setAttribute("data-aq-editavel", ""); n++; m++; continue; }
      if (el === editando) { n++; continue; }
      if (!folha(el)) { el.removeAttribute("data-aq-editavel"); continue; }
      var acima = el.parentElement ? perto(el.parentElement, "[data-aq-editavel]") : null;
      if (acima) { el.removeAttribute("data-aq-editavel"); el.removeAttribute("data-aq-achado"); continue; }
      var t = norm(el.textContent);
      if (!t || t.length > 1500) { el.removeAttribute("data-aq-editavel"); continue; }
      el.setAttribute("data-aq-editavel", "");
      n++;
      var opcoes = porTexto[t.toLowerCase()];
      if (opcoes) {
        var escolhido = opcoes[0];
        for (var q = 0; q < opcoes.length; q++) if (opcoes[q].secao === uid) { escolhido = opcoes[q]; break; }
        el.setAttribute("data-aq-achado", escolhido.campo);
        m++;
      } else el.removeAttribute("data-aq-achado");
    }
    var imgs = raiz.querySelectorAll("img");
    for (var p = 0; p < imgs.length; p++) if (!daCasca(imgs[p]) && secaoDe(imgs[p])) imgs[p].setAttribute("data-aq-img", "");
    return { n: n, m: m };
  }

  function avisarPronta(contas) {
    var lista = document.querySelectorAll("[data-secao]");
    var secoes = [];
    for (var i = 0; i < lista.length; i++) {
      var u = lista[i].getAttribute("data-secao");
      if (u && secoes.indexOf(u) < 0) secoes.push(u);
    }
    var chave = secoes.join(",") + "|" + contas.n + "|" + contas.m;
    if (chave === ultimoAviso) return;
    ultimoAviso = chave;
    enviar({ aq: "pronta", versao: 1, secoes: secoes, editaveis: contas.n, achados: contas.m, rapida: !!document.getElementById("aq-raiz") });
  }

  var espera = null;
  function marcarDepois() {
    if (espera) clearTimeout(espera);
    espera = setTimeout(function () { espera = null; avisarPronta(marcar()); }, 250);
  }

  function aplicarHtml(d) {
    var raiz = document.getElementById("aq-raiz");
    if (!raiz || typeof d.html !== "string") return;
    var tema = document.getElementById("aq-tema");
    if (tema && typeof d.css === "string") tema.textContent = d.css;
    var y = window.pageYOffset || 0;
    raiz.innerHTML = d.html;
    window.scrollTo(0, y);
    avisarPronta(marcar());
  }

  function comecar(el, x, y) {
    if (editando === el) return;
    if (editando) terminar(true);
    editando = el;
    antesHtml = el.innerHTML;
    // Texto longo com parágrafo guardado que o site mostra numa linha só: a edição abre com a quebra à vista.
    var guardado = longo(el) ? valorGuardado(campoDe(el)) : null;
    antesTexto = normDe(el, visivel(el));
    if (guardado && guardado.indexOf("\n") >= 0 && antesTexto.indexOf("\n") < 0 && norm(guardado) === norm(antesTexto)) {
      el.innerHTML = escapar(guardado).split("\n").join("<br>");
      antesTexto = normLongo(guardado);
    }
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-aq-editando", "");
    el.setAttribute("spellcheck", "true");
    try { el.focus(); } catch (e) { /* sem foco */ }
    try {
      var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (r) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch (e2) { /* cursor fica no começo */ }
  }

  function terminar(salvar) {
    var el = editando;
    if (!el) return;
    editando = null;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-aq-editando");
    el.removeAttribute("spellcheck");
    if (!salvar) el.innerHTML = antesHtml;
    else {
      var valor = normDe(el, visivel(el));
      if (valor !== antesTexto) enviar({ aq: "editar", campo: campoDe(el), secao: secaoDe(el), antes: antesTexto, valor: valor });
    }
    if (pendente) { var d = pendente; pendente = null; aplicarHtml(d); }
  }

  document.addEventListener("click", function (ev) {
    if (!editar) return;
    var alvo = ev.target;
    if (daCasca(alvo)) return;
    if (editando && perto(alvo, "[data-aq-editando]") === editando) return;
    var img = perto(alvo, "img[data-aq-img]");
    if (img) {
      ev.preventDefault();
      ev.stopPropagation();
      enviar({ aq: "imagem", secao: secaoDe(img), id: img.getAttribute("data-aq-img-id") || null, slot: img.getAttribute("data-aq-slot") || null, src: img.getAttribute("src") || "" });
      return;
    }
    var ed = perto(alvo, "[data-aq-editavel]");
    if (ed) { ev.preventDefault(); ev.stopPropagation(); comecar(ed, ev.clientX, ev.clientY); return; }
    if (perto(alvo, "a,button,label,summary")) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);

  document.addEventListener("submit", function (ev) { if (editar) ev.preventDefault(); }, true);

  document.addEventListener("keydown", function (ev) {
    if (editando) {
      if (ev.key === "Escape" || ev.keyCode === 27) { ev.preventDefault(); terminar(false); }
      else if (ev.key === "Enter" || ev.keyCode === 13) {
        if (!ev.shiftKey) { ev.preventDefault(); terminar(true); }
        else if (!longo(editando)) ev.preventDefault();
      }
      return;
    }
    if (editar && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === "z" || ev.key === "Z")) { ev.preventDefault(); enviar({ aq: "desfazer" }); }
  }, true);

  document.addEventListener("paste", function (ev) {
    if (!editando) return;
    var dados = ev.clipboardData || window.clipboardData;
    if (!dados) return;
    ev.preventDefault();
    var texto = normDe(editando, dados.getData("text/plain") || dados.getData("Text"));
    try { document.execCommand("insertText", false, texto); } catch (e) { /* navegador sem insertText */ }
  }, true);

  document.addEventListener("focusout", function (ev) { if (editando && ev.target === editando) terminar(true); }, true);

  document.addEventListener("mouseover", function (ev) {
    if (!editar || daCasca(ev.target)) return;
    mostrarBarra(perto(ev.target, "[data-secao]"));
  }, true);

  barra.addEventListener("click", function (ev) {
    var b = perto(ev.target, "[data-aq-acao]");
    if (!b || !secaoDaBarra) return;
    ev.preventDefault();
    ev.stopPropagation();
    enviar({ aq: "secao", acao: b.getAttribute("data-aq-acao"), secao: secaoDaBarra });
  });

  var rolando = null;
  window.addEventListener("scroll", function () {
    if (secaoDaBarra) {
      var s = document.querySelector('[data-secao="' + secaoDaBarra + '"]');
      mostrarBarra(s);
    }
    if (rolando) return;
    rolando = setTimeout(function () { rolando = null; enviar({ aq: "rolagem", y: Math.round(window.pageYOffset || 0) }); }, 300);
  }, { passive: true });

  window.addEventListener("message", function (ev) {
    if (ev.source !== pai) return;
    var d = ev.data;
    if (!d || typeof d !== "object" || typeof d.aq !== "string") return;
    if (d.aq === "modo") {
      editar = !!d.editar;
      if (editar) { if ((" " + document.documentElement.className + " ").indexOf(" aq-editar ") < 0) document.documentElement.className += " aq-editar"; }
      else {
        document.documentElement.className = document.documentElement.className.replace(/\s*aq-editar/g, "");
        terminar(true);
        mostrarBarra(null);
      }
    } else if (d.aq === "campos") {
      campos = Object.prototype.toString.call(d.campos) === "[object Array]" ? d.campos.slice(0, 400) : [];
      rotulos = d.rotulos && typeof d.rotulos === "object" ? d.rotulos : {};
      marcarDepois();
    } else if (d.aq === "html") {
      if (editando) pendente = d;
      else aplicarHtml(d);
    } else if (d.aq === "fontes") {
      var link = document.getElementById("aq-fontes");
      if (link && typeof d.url === "string" && d.url.indexOf("https://fonts.googleapis.com/") === 0) link.setAttribute("href", d.url);
    } else if (d.aq === "ir") {
      if (typeof d.secao === "string" && UID.test(d.secao)) {
        var alvo = document.querySelector('[data-secao="' + d.secao + '"]');
        if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (d.aq === "recarregar") {
      window.location.reload();
    }
  });

  function iniciar() {
    pendurarBarra();
    if (typeof window.__aqRolagem === "number" && window.__aqRolagem > 0) window.scrollTo(0, window.__aqRolagem);
    avisarPronta(marcar());
    if (window.MutationObserver && document.body) {
      new MutationObserver(function (lista) {
        for (var i = 0; i < lista.length; i++) if (!daCasca(lista[i].target)) { marcarDepois(); return; }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();`;

/** O código da ponte (texto), igual para a prévia rápida e para o site do motor. */
export function codigoDaPonte(): string {
  return PONTE;
}

/** Mensagens que a prévia manda para a tela (o que a tela aceita). */
export type MensagemDaPonte =
  | { aq: "pronta"; versao: number; secoes: string[]; editaveis: number; achados: number; rapida: boolean }
  | { aq: "editar"; campo: string | null; secao: string | null; antes: string; valor: string }
  | { aq: "imagem"; secao: string | null; id: string | null; slot: string | null; src: string }
  | { aq: "secao"; acao: "subir" | "descer" | "esconder" | "ajuste"; secao: string }
  | { aq: "desfazer" }
  | { aq: "rolagem"; y: number };

const UID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const texto = (v: unknown, max: number) => String(v == null ? "" : v).slice(0, max);

/** Lê uma mensagem da prévia sem confiar em nada (null = ignorar). */
export function lerMensagemDaPonte(d: unknown): MensagemDaPonte | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const secao = typeof o.secao === "string" && UID.test(o.secao) ? o.secao : null;
  switch (o.aq) {
    case "pronta":
      return { aq: "pronta", versao: Number(o.versao) || 0, secoes: (Array.isArray(o.secoes) ? o.secoes : []).map((s) => String(s)).filter((s) => UID.test(s)).slice(0, 80), editaveis: Number(o.editaveis) || 0, achados: Number(o.achados) || 0, rapida: o.rapida === true };
    case "editar":
      return { aq: "editar", campo: typeof o.campo === "string" && o.campo ? texto(o.campo, 80) : null, secao, antes: texto(o.antes, 2000), valor: texto(o.valor, 2000) };
    case "imagem":
      return { aq: "imagem", secao, id: typeof o.id === "string" ? texto(o.id, 40) : null, slot: typeof o.slot === "string" ? texto(o.slot, 20) : null, src: texto(o.src, 600) };
    case "secao":
      return secao && (o.acao === "subir" || o.acao === "descer" || o.acao === "esconder" || o.acao === "ajuste") ? { aq: "secao", acao: o.acao, secao } : null;
    case "desfazer":
      return { aq: "desfazer" };
    case "rolagem":
      return { aq: "rolagem", y: Math.max(0, Math.round(Number(o.y) || 0)) };
    default:
      return null;
  }
}
