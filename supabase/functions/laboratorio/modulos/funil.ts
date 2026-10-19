/**
 * Laboratório v4 (ESPEC-LABORATORIO-v4.md): as peças do funil montadas por regra fixa, sem rede.
 *
 * Aqui mora o que NÃO precisa de modelo de IA e precisa sair certo sempre: as páginas do funil em HTML
 * (checkout com o link do gateway, quiz com pontuação, sala do webinar com a oferta no minuto, e-mails,
 * boas-vindas da área de membros, template com camadas), o formulário que manda para o site-formulario,
 * o script do teste A/B, a validação do domínio e dos modelos de WhatsApp, os links com UTM e o rascunho
 * do workflow do n8n (sempre INATIVO). O texto vem do modelo (nos-v4.ts); o esqueleto vem daqui.
 *
 * Os scripts das páginas rodam no navegador de quem visita: ES5 puro (sem arrow, sem let/const, sem
 * template string), para valer em celular antigo.
 */
import { cartaoDeDns, type CartaoDeDns, ehRegistrador, normalizarDominio } from "../../mesa-site/modulos/dns-do-site.ts";
import { gerarScriptDeConversao, gerarScriptDeDivisao } from "../../_shared/ab-divisao.ts";
import { type Canvas, type Gatilho, gatilhoValido, type NoDoCanvas, ROTULO_DO_GATILHO, ROTULO_DO_TIPO, ancestraisDe } from "./regras.ts";

const txt = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ texto e endereços

/** Escapa para dentro de HTML (texto e atributo). */
export function escaparHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Para dentro de <script> como JSON (sem fechar a tag). */
export const jsonNoScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

/** Link https válido (o checkout só põe no ar com ele) ou null. */
export function urlHttps(v: unknown): string | null {
  const s = txt(v, 2000);
  if (!/^https:\/\/[^\s"'<>]+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.indexOf(".") > 0 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Endereço público que dá para ler sem risco (Referências): http(s), nome com ponto, nada interno. */
export function urlPublicaSegura(v: unknown): string | null {
  const s = txt(v, 2000);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h || h.indexOf(".") < 0 || h === "localhost" || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) return null;
  // IP literal: só deixa passar IPv4 público.
  if (/^\[/.test(h) || h.indexOf(":") >= 0) return null;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return null;
  }
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  return u.toString();
}

/** "/oferta" a partir do que veio (minúsculo, sem acento, só letras, números, hífen e barra). */
export function caminhoLimpo(v: unknown, reserva = "/"): string {
  const s = txt(v, 200)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "");
  if (!s) return reserva;
  if (s === "/") return "/";
  return s.charAt(0) === "/" ? s.replace(/\/$/, "") || reserva : `/${s.replace(/\/$/, "")}`;
}

/** Hash curto e estável (id do teste A/B a partir do id do nó). */
export function hashCurto(t: string, tamanho = 6): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(tamanho, "0").slice(-tamanho);
}

/** As cores que a marca citou (#hex), na ordem; a primeira é a principal. */
export function coresDoTexto(t: string): string[] {
  const saida: string[] = [];
  for (const m of String(t || "").match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []) {
    const c = m.toLowerCase();
    if (saida.indexOf(c) < 0) saida.push(c);
  }
  return saida.slice(0, 6);
}

export type Cores = { principal: string; texto: string; fundo: string; suave: string };
export function coresDaPagina(marca: string): Cores {
  const c = coresDoTexto(marca);
  return { principal: c[0] || "#111827", texto: "#111827", fundo: "#ffffff", suave: c[1] || "#f3f4f6" };
}

// ------------------------------------------------------------------ ligações do funil

export type Destino = { no_id: string; tipo: string; rotulo: string; caminho: string; link: string | null; gatilho: Gatilho | null };

/** O endereço de um nó do funil: o caminho do nó (ou o link do gateway, no checkout sem caminho). */
export function enderecoDoNo(no: NoDoCanvas): { caminho: string; link: string | null } {
  const d = no.dados;
  const reserva: Record<string, string> = { pagina: "/pagina", checkout: "/checkout", quiz: "/quiz", webinar: "/webinar", area_membros: "/boas-vindas", teste_ab: "/teste" };
  const caminho = no.tipo === "teste_ab" ? caminhoLimpo(d.caminho, `/teste-ab-${hashCurto(no.id)}`) : caminhoLimpo(d.caminho, reserva[no.tipo] || `/${no.id}`);
  return { caminho, link: no.tipo === "checkout" ? urlHttps(d.link_pagamento) : null };
}

const rotuloDe = (n: NoDoCanvas) => (typeof n.dados.titulo === "string" && n.dados.titulo.trim() ? n.dados.titulo.trim() : ROTULO_DO_TIPO[n.tipo]);

/** Para onde cada fio que sai do nó leva, com o gatilho (o que tem gatilho vem primeiro). */
export function destinosDoNo(c: Pick<Canvas, "nos" | "ligacoes">, noId: string): Destino[] {
  const origem = c.nos.find((n) => n.id === noId);
  if (!origem) return [];
  const saida: Destino[] = [];
  for (const l of c.ligacoes) {
    if (l.de !== noId) continue;
    const n = c.nos.find((x) => x.id === l.para);
    if (!n) continue;
    const e = enderecoDoNo(n);
    saida.push({ no_id: n.id, tipo: n.tipo, rotulo: rotuloDe(n), caminho: e.caminho, link: e.link, gatilho: gatilhoValido(origem.tipo, l.gatilho) ? l.gatilho as Gatilho : null });
  }
  return saida.sort((a, b) => Number(!a.gatilho) - Number(!b.gatilho));
}

/** O destino do fio com um destes gatilhos (o primeiro), ou null. Página e checkout contam como destino. */
export function destinoPor(destinos: Destino[], gatilhos: Gatilho[], tipos = ["pagina", "checkout", "quiz", "webinar", "area_membros", "teste_ab"]): Destino | null {
  for (const g of gatilhos) {
    const d = destinos.find((x) => x.gatilho === g && tipos.indexOf(x.tipo) >= 0);
    if (d) return d;
  }
  return null;
}

/** O href do destino: o link do gateway (checkout) ou o caminho da página. */
export const hrefDe = (d: Destino | null, reserva = "#") => (d ? d.link || d.caminho : reserva);

/** Os fios de saída em texto (para o resultado do nó e para o Pôr no ar). */
export function fiosEmTexto(destinos: Destino[]): string {
  return destinos.map((d) => `${d.gatilho ? `[${ROTULO_DO_GATILHO[d.gatilho]}] ` : ""}→ ${d.rotulo} (${d.link || d.caminho})`).join("\n");
}

/**
 * O que ainda falta para o Pôr no ar (além da trava de prova sem fonte): checkout antes dele sem link
 * https do gateway. Vazio = pode pedir.
 */
export function faltasParaPorNoAr(c: Pick<Canvas, "nos" | "ligacoes">, noId: string): string[] {
  const faltas: string[] = [];
  for (const id of ancestraisDe(c, noId)) {
    const n = c.nos.find((x) => x.id === id);
    if (n && n.tipo === "checkout" && !urlHttps(n.dados.link_pagamento)) faltas.push(`${rotuloDe(n)}: preencha o link de pagamento do gateway (https).`);
  }
  return faltas;
}

// ------------------------------------------------------------------ esqueleto das páginas

/** Documento HTML completo com CSS próprio (sem script de fora). */
export function documento(o: { titulo: string; cores: Cores; corpo: string; scripts?: string; descricao?: string }): string {
  const c = o.cores;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparHtml(o.titulo)}</title>
${o.descricao ? `<meta name="description" content="${escaparHtml(o.descricao)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:${c.texto};background:${c.fundo};line-height:1.55}
.envelope{max-width:960px;margin:0 auto;padding:32px 16px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 0 12px}h2{font-size:clamp(22px,3.5vw,30px);margin:32px 0 12px}h3{margin:0 0 8px}
p{margin:0 0 12px}.sub{font-size:18px;opacity:.85}
.botao{display:inline-block;background:${c.principal};color:#fff;border:0;border-radius:12px;padding:16px 28px;font-size:18px;font-weight:700;text-decoration:none;cursor:pointer;text-align:center}
.botao[aria-disabled=true]{opacity:.45;pointer-events:none}
.cartao{background:${c.suave};border-radius:16px;padding:20px;margin:16px 0}
.grade{display:grid;gap:16px}@media(min-width:760px){.grade.duas{grid-template-columns:1fr 1fr}}
.campo{display:block;width:100%;padding:14px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;margin:0 0 12px}
.oculto{display:none}.aviso{font-size:14px;opacity:.75}.rascunho{background:#fef3c7;border:1px dashed #d97706;border-radius:10px;padding:10px;font-size:14px}
ul.lista{padding-left:20px}ul.lista li{margin:6px 0}
.opcao{display:block;width:100%;text-align:left;background:#fff;border:2px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:0 0 10px;font-size:16px;cursor:pointer}
.opcao:hover{border-color:${c.principal}}.barra{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin:0 0 20px}.barra span{display:block;height:100%;background:${c.principal}}
.video{position:relative;padding-top:56.25%;background:#000;border-radius:16px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.oferta-fixa{position:sticky;bottom:0;background:${c.principal};color:#fff;padding:16px;border-radius:16px 16px 0 0;text-align:center}
.oferta-fixa .botao{background:#fff;color:${c.principal}}
</style>
</head>
<body>
${o.corpo}
${o.scripts || ""}
</body>
</html>`;
}

/** Marcadores [RASCUNHO SEM FONTE: ...] ficam visíveis na página (o Pôr no ar trava até o dono resolver). */
export function paragrafos(t: unknown): string {
  return txt(t, 6000)
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/\[RASCUNHO SEM FONTE/i.test(p) ? `<p class="rascunho">${escaparHtml(p)}</p>` : `<p>${escaparHtml(p)}</p>`))
    .join("\n");
}

export const lista = (itens: unknown[]) => {
  const l = itens.map((i) => txt(i, 400)).filter(Boolean);
  return l.length ? `<ul class="lista">${l.map((i) => `<li>${/\[RASCUNHO SEM FONTE/i.test(i) ? `<span class="rascunho">${escaparHtml(i)}</span>` : escaparHtml(i)}</li>`).join("")}</ul>` : "";
};

// ------------------------------------------------------------------ formulário (site-formulario)

/** A chave do formulário só existe quando o site é publicado pela Mesa Site: até lá fica este marcador. */
export const CHAVE_PENDENTE = "__CHAVE_DO_FORMULARIO__";

/**
 * O formulário que manda para o site-formulario (lead no CRM, com a origem do anúncio que veio no link).
 * `extra` vai junto no corpo (o quiz manda { quiz: {...} } por aqui). Sucesso: vai para `depois`.
 */
export function formularioDoSite(o: { endpoint: string; pagina: string; depois: string | null; botao: string; pedirWhatsapp?: boolean; pedirEmail?: boolean; id?: string }): string {
  const id = o.id || "formulario";
  return `<form id="${id}" class="cartao" novalidate data-formulario-do-lab="">
<input class="campo" name="nome" placeholder="Seu nome" autocomplete="name" required>
${o.pedirEmail === false ? "" : `<input class="campo" name="email" type="email" placeholder="Seu melhor e-mail" autocomplete="email">`}
${o.pedirWhatsapp === false ? "" : `<input class="campo" name="whatsapp" type="tel" placeholder="WhatsApp com DDD" autocomplete="tel">`}
<input name="site_url" tabindex="-1" autocomplete="off" class="oculto" aria-hidden="true">
<button class="botao" type="submit" style="width:100%">${escaparHtml(o.botao)}</button>
<p class="aviso" data-mensagem="" role="status"></p>
</form>
<script>
(function(){
  var f=document.getElementById(${jsonNoScript(id)});if(!f)return;
  var inicio=Date.now();
  var cfg={endpoint:${jsonNoScript(o.endpoint)},chave:${jsonNoScript(CHAVE_PENDENTE)},pagina:${jsonNoScript(o.pagina)},depois:${jsonNoScript(o.depois || "")}};
  function origem(){var q={};var s=window.location.search.replace(/^\\?/,"").split("&");for(var i=0;i<s.length;i++){var p=s[i].split("=");var k=decodeURIComponent(p[0]||"");if(/^(utm_source|utm_medium|utm_campaign|utm_content|utm_term|ad_id|adset_id|campaign_id|fbclid)$/.test(k))q[k]=decodeURIComponent((p[1]||"").replace(/\\+/g," "));}return q;}
  window.__enviarAoSite=function(extra,fim){
    var d={chave:cfg.chave,nome:f.nome.value,email:f.email?f.email.value:"",whatsapp:f.whatsapp?f.whatsapp.value:"",pagina:cfg.pagina,iniciado_em:inicio,site_url:f.site_url.value};
    var o=origem();for(var k in o){if(o.hasOwnProperty(k))d[k]=o[k];}
    if(extra){for(var e in extra){if(extra.hasOwnProperty(e))d[e]=extra[e];}}
    var x=new XMLHttpRequest();x.open("POST",cfg.endpoint);x.setRequestHeader("Content-Type","application/json");
    x.onload=function(){var r={};try{r=JSON.parse(x.responseText);}catch(err){}fim(x.status>=200&&x.status<300&&r.ok!==false,r.mensagem||"");};
    x.onerror=function(){fim(false,"Não deu para enviar agora. Tente de novo.");};
    x.send(JSON.stringify(d));
  };
  f.addEventListener("submit",function(ev){
    ev.preventDefault();var m=f.querySelector("[data-mensagem]");
    if(f.nome.value.length<2){m.textContent="Escreva o seu nome.";return;}
    if((!f.email||!f.email.value)&&(!f.whatsapp||!f.whatsapp.value)){m.textContent="Deixe um e-mail ou um WhatsApp.";return;}
    if(window.__segurarEnvio&&window.__segurarEnvio()){m.textContent="";return;}
    m.textContent="Enviando...";
    window.__enviarAoSite(window.__extraDoFormulario||null,function(ok,msg){
      if(!ok){m.textContent=msg||"Não deu para enviar agora. Tente de novo.";return;}
      m.textContent=msg||"Recebido!";
      if(window.__depoisDoFormulario){window.__depoisDoFormulario();return;}
      if(cfg.depois){window.location.href=cfg.depois+window.location.search;}
    });
  });
})();
</script>`;
}

// ------------------------------------------------------------------ checkout (opção a do dono)

export const GATEWAYS: Record<string, string> = { hotmart: "Hotmart", kiwify: "Kiwify", stripe: "Stripe", mercadopago: "Mercado Pago", asaas: "Asaas", outro: "o gateway do cliente" };
/** Eventos que o checkout espera do webhook do gateway (a função vendas-webhook, de outro agente). */
export const EVENTOS_DO_CHECKOUT = ["compra_aprovada", "compra_recusada", "carrinho_abandonado", "pix_gerado"] as const;
/** Upsell de 1 clique nativo (conhecimento geral; confirmar na conta do cliente). */
export const UPSELL_UM_CLIQUE: Record<string, boolean> = { hotmart: true, kiwify: true, stripe: false, mercadopago: false, asaas: false, outro: false };

export type CopyDoCheckout = { titulo: string; resumo: string; itens: string[]; garantia: string; prova: string[]; perguntas: Array<{ pergunta: string; resposta: string }>; texto_bump: string; texto_botao: string };

export function lerCopyDoCheckout(j: unknown): CopyDoCheckout {
  const o = obj(j);
  return {
    titulo: txt(o.titulo, 200) || "Finalize a sua compra",
    resumo: txt(o.resumo, 1500),
    itens: arr(o.itens).map((x) => txt(x, 300)).filter(Boolean).slice(0, 10),
    garantia: txt(o.garantia, 600),
    prova: arr(o.prova).map((x) => txt(x, 500)).filter(Boolean).slice(0, 4),
    perguntas: arr(o.perguntas).map((x) => ({ pergunta: txt(obj(x).pergunta, 300), resposta: txt(obj(x).resposta, 800) })).filter((x) => x.pergunta && x.resposta).slice(0, 6),
    texto_bump: txt(o.texto_bump, 300),
    texto_botao: txt(o.texto_botao, 60) || "Comprar agora",
  };
}

/**
 * A página do checkout: resumo, prova (com marcador quando falta fonte), garantia, bump marcável e o
 * botão para o link do gateway. Sem link https: o botão fica desligado e a página diz o que falta.
 * Bump: dois links (oferta sozinha / com bump) que a caixinha alterna.
 */
export function htmlDoCheckout(o: { copy: CopyDoCheckout; gateway: string; link: string | null; linkComBump: string | null; preco: string; produto: string; garantia: string; cores: Cores }): string {
  const c = o.copy;
  const temBump = !!(o.linkComBump && c.texto_bump);
  const botao = o.link
    ? `<a id="comprar" class="botao" style="width:100%" href="${escaparHtml(o.link)}" rel="noopener" data-gateway="${escaparHtml(o.gateway)}">${escaparHtml(c.texto_botao)}</a>`
    : `<a id="comprar" class="botao" style="width:100%" aria-disabled="true" href="#">${escaparHtml(c.texto_botao)}</a><p class="rascunho">Falta o link de pagamento do ${escaparHtml(GATEWAYS[o.gateway] || "gateway")} (https) no nó Checkout.</p>`;
  const corpo = `<main class="envelope">
<h1>${escaparHtml(c.titulo)}</h1>
${c.resumo ? `<p class="sub">${escaparHtml(c.resumo)}</p>` : ""}
<div class="grade duas">
<section class="cartao">
<h3>${escaparHtml(o.produto || "O que você recebe")}</h3>
${lista(c.itens)}
${o.preco ? `<p style="font-size:28px;font-weight:800;margin-top:12px">${escaparHtml(o.preco)}</p>` : ""}
</section>
<section class="cartao">
${temBump ? `<label style="display:flex;gap:10px;align-items:flex-start;border:2px dashed ${o.cores.principal};border-radius:12px;padding:12px;margin-bottom:16px;cursor:pointer"><input type="checkbox" id="bump" style="width:22px;height:22px;margin-top:2px"><span><strong>Sim, quero junto:</strong> ${escaparHtml(c.texto_bump)}</span></label>` : ""}
${botao}
<p class="aviso" style="margin-top:12px">Pagamento seguro pelo ${escaparHtml(GATEWAYS[o.gateway] || "gateway")}.</p>
${o.garantia || c.garantia ? `<p><strong>Garantia:</strong> ${escaparHtml(o.garantia || c.garantia)}</p>` : ""}
</section>
</div>
${c.prova.length ? `<h2>Quem já comprou</h2>${c.prova.map((p) => (/\[RASCUNHO SEM FONTE/i.test(p) ? `<p class="rascunho">${escaparHtml(p)}</p>` : `<blockquote class="cartao">${escaparHtml(p)}</blockquote>`)).join("")}` : ""}
${c.perguntas.length ? `<h2>Perguntas</h2>${c.perguntas.map((p) => `<details class="cartao"><summary><strong>${escaparHtml(p.pergunta)}</strong></summary><p>${escaparHtml(p.resposta)}</p></details>`).join("")}` : ""}
</main>`;
  const scripts = temBump && o.link
    ? `<script>
(function(){var b=document.getElementById("bump"),a=document.getElementById("comprar");if(!b||!a)return;
var so=${jsonNoScript(o.link)},com=${jsonNoScript(o.linkComBump)};
function q(){return window.location.search?(window.location.search.indexOf("?")===0?"&"+window.location.search.slice(1):""):"";}
function sep(u){return u.indexOf("?")>=0?"":"?";}
function por(){var base=b.checked?com:so;var extra=q();a.href=extra?base+sep(base)+extra.replace(/^&/,""):base;}
b.addEventListener("change",por);por();})();
</script>`
    : "";
  return documento({ titulo: c.titulo, cores: o.cores, corpo, scripts });
}

// ------------------------------------------------------------------ quiz

export type PerguntaDoQuiz = { id: string; pergunta: string; opcoes: Array<{ texto: string; pontos: number }> };
export type FaixaDoQuiz = { id: "faixa_alta" | "faixa_media" | "faixa_baixa"; nome: string; min: number; max: number; titulo: string; texto: string; cta: string };
export type Quiz = { titulo: string; subtitulo: string; perguntas: PerguntaDoQuiz[]; faixas: FaixaDoQuiz[]; pontuacao_maxima: number };

const IDS_DAS_FAIXAS: FaixaDoQuiz["id"][] = ["faixa_alta", "faixa_media", "faixa_baixa"];

/**
 * Lê o quiz do modelo e acerta as contas: pontos inteiros de 0 a 10, faixas que cobrem de 0 ao máximo
 * sem buraco (da alta para a baixa), ids fixos faixa_alta / faixa_media / faixa_baixa (os gatilhos do fio).
 */
export function quizNormalizado(j: unknown, nPerguntas: number): Quiz {
  const o = obj(j);
  const perguntas: PerguntaDoQuiz[] = arr(o.perguntas)
    .map((p, i) => {
      const q = obj(p);
      const opcoes = arr(q.opcoes)
        .map((x) => ({ texto: txt(obj(x).texto, 200), pontos: Math.max(0, Math.min(10, Math.round(Number(obj(x).pontos) || 0))) }))
        .filter((x) => x.texto)
        .slice(0, 6);
      return { id: `p${i + 1}`, pergunta: txt(q.pergunta, 300), opcoes };
    })
    .filter((p) => p.pergunta && p.opcoes.length >= 2)
    .slice(0, Math.max(3, Math.min(12, nPerguntas)));
  const max = perguntas.reduce((s, p) => s + Math.max(...p.opcoes.map((x) => x.pontos)), 0);
  const brutas = arr(o.faixas).map((x) => obj(x)).slice(0, 3);
  const n = Math.max(2, Math.min(3, brutas.length || 3));
  // Cortes pela ordem que veio (alta primeiro); sem número bom, divide o máximo em partes iguais.
  const faixas: FaixaDoQuiz[] = [];
  for (let i = 0; i < n; i++) {
    const b = brutas[i] || {};
    const id = n === 2 ? (i === 0 ? "faixa_alta" : "faixa_baixa") : IDS_DAS_FAIXAS[i];
    const minPedido = Number(b.min);
    const igual = Math.round((max * (n - 1 - i)) / n);
    faixas.push({ id, nome: txt(b.nome, 80) || ["Alta", "Média", "Baixa"][IDS_DAS_FAIXAS.indexOf(id)], min: Number.isFinite(minPedido) && minPedido >= 0 && minPedido <= max ? Math.round(minPedido) : igual, max, titulo: txt(b.titulo, 200), texto: txt(b.texto, 1200), cta: txt(b.cta, 60) || "Continuar" });
  }
  // Mínimos decrescentes; a última começa em 0; o máximo de cada uma é o mínimo da anterior menos 1.
  for (let i = 1; i < faixas.length; i++) if (faixas[i].min >= faixas[i - 1].min) faixas[i].min = Math.max(0, faixas[i - 1].min - 1);
  faixas[faixas.length - 1].min = 0;
  for (let i = 1; i < faixas.length; i++) faixas[i].max = Math.max(faixas[i].min, faixas[i - 1].min - 1);
  faixas[0].max = max;
  return { titulo: txt(o.titulo, 200) || "Descubra o seu resultado", subtitulo: txt(o.subtitulo, 400), perguntas, faixas, pontuacao_maxima: max };
}

/** A faixa de uma pontuação (a primeira cujo mínimo ela alcança, da alta para a baixa). */
export function faixaDa(q: Pick<Quiz, "faixas">, pontos: number): FaixaDoQuiz {
  return q.faixas.find((f) => pontos >= f.min) || q.faixas[q.faixas.length - 1];
}

/**
 * A página do quiz: uma pergunta por tela, pontuação no navegador, contato antes do resultado (ou onde o
 * nó pedir) e o envio pelo site-formulario com { quiz: { pontuacao, faixa, respostas } }. Cada faixa leva
 * ao destino ligado com aquele gatilho (ou ao de quiz_concluido).
 */
export function htmlDoQuiz(o: { quiz: Quiz; endpoint: string; pagina: string; captura: string; destinos: Record<string, string>; cores: Cores }): string {
  const q = o.quiz;
  const dados = { perguntas: q.perguntas, faixas: q.faixas.map((f) => ({ id: f.id, min: f.min, titulo: f.titulo, texto: f.texto, cta: f.cta, destino: o.destinos[f.id] || o.destinos.quiz_concluido || "" })), captura: o.captura };
  const corpo = `<main class="envelope" style="max-width:640px">
<div id="abertura">
<h1>${escaparHtml(q.titulo)}</h1>
${q.subtitulo ? `<p class="sub">${escaparHtml(q.subtitulo)}</p>` : ""}
<button class="botao" type="button" id="comecar">Começar</button>
</div>
<div id="pergunta" class="oculto"><div class="barra"><span id="progresso" style="width:0%"></span></div><h2 id="texto-da-pergunta" style="margin-top:0"></h2><div id="opcoes"></div></div>
<div id="contato" class="oculto"><h2 style="margin-top:0">Para ver o seu resultado, deixe o seu contato</h2>
${formularioDoSite({ endpoint: o.endpoint, pagina: o.pagina, depois: null, botao: "Ver meu resultado", id: "formulario-do-quiz" })}
</div>
<div id="resultado" class="oculto cartao"><h2 id="titulo-do-resultado" style="margin-top:0"></h2><p id="texto-do-resultado"></p><a id="cta-do-resultado" class="botao" href="#">Continuar</a></div>
</main>`;
  const scripts = `<script>
(function(){
  var Q=${jsonNoScript(dados)};var i=0,pontos=0,respostas={},terminou=false;
  function el(id){return document.getElementById(id);}
  function mostra(lista){var ids=["abertura","pergunta","contato","resultado"];for(var k=0;k<ids.length;k++){var ve=lista.indexOf(ids[k])>=0;el(ids[k]).className=ve?(ids[k]==="resultado"?"cartao":""):"oculto";}}
  function faixa(){for(var k=0;k<Q.faixas.length;k++){if(pontos>=Q.faixas[k].min)return Q.faixas[k];}return Q.faixas[Q.faixas.length-1];}
  function preencheResultado(){var f=faixa();el("titulo-do-resultado").textContent=f.titulo;el("texto-do-resultado").textContent=f.texto;var a=el("cta-do-resultado");a.textContent=f.cta;if(f.destino){a.href=f.destino+window.location.search;}else{a.style.display="none";}}
  function extra(){var f=faixa();return {quiz:{pontuacao:pontos,faixa:f.id,respostas:respostas}};}
  function fim(){terminou=true;window.__extraDoFormulario=extra();preencheResultado();
    if(Q.captura==="inicio"){window.__enviarAoSite(extra(),function(){});mostra(["resultado"]);return;}
    if(Q.captura==="fim"){window.__depoisDoFormulario=function(){};mostra(["resultado","contato"]);return;}
    window.__depoisDoFormulario=function(){mostra(["resultado"]);};mostra(["contato"]);}
  function pergunta(){var p=Q.perguntas[i];el("progresso").style.width=Math.round(i*100/Q.perguntas.length)+"%";el("texto-da-pergunta").textContent=p.pergunta;var box=el("opcoes");box.innerHTML="";
    for(var k=0;k<p.opcoes.length;k++){(function(op){var b=document.createElement("button");b.type="button";b.className="opcao";b.textContent=op.texto;b.onclick=function(){pontos+=op.pontos;respostas[p.id]=op.texto;i++;if(i<Q.perguntas.length){pergunta();}else{fim();}};box.appendChild(b);})(p.opcoes[k]);}
    mostra(["pergunta"]);}
  // Contato no início: o formulário só guarda; o envio sai uma vez, no fim, já com a pontuação.
  if(Q.captura==="inicio"){window.__segurarEnvio=function(){if(!terminou){pergunta();return true;}return false;};}
  el("comecar").onclick=function(){if(Q.captura==="inicio"){mostra(["contato"]);return;}pergunta();};
})();
</script>`;
  return documento({ titulo: q.titulo, cores: o.cores, corpo, scripts, descricao: q.subtitulo });
}

// ------------------------------------------------------------------ webinar

/** "45:00" ou "1:05:30" em segundos (inválido: null). */
export function segundosDe(v: unknown): number | null {
  const s = txt(v, 20);
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(s)) return null;
  const p = s.split(":").map(Number);
  if (p.slice(1).some((x) => x > 59)) return null;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}

/** Endereço de embed do YouTube ou do Vimeo (outro link: null). */
export function embedDoVideo(v: unknown): string | null {
  const s = txt(v, 500);
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const vm = s.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export type CopyDoWebinar = {
  inscricao: { titulo: string; subtitulo: string; bullets: string[]; cta: string };
  sala: { titulo: string; texto_oferta: string; cta_oferta: string };
  encerramento: { titulo: string; texto: string; cta: string; prazo: string };
  roteiro: Array<{ minuto: string; bloco: string; falas: string }>;
  lembretes: Array<{ quando: string; assunto: string; texto: string }>;
};

export function lerCopyDoWebinar(j: unknown): CopyDoWebinar {
  const o = obj(j);
  const i = obj(o.inscricao), s = obj(o.sala), e = obj(o.encerramento);
  return {
    inscricao: { titulo: txt(i.titulo, 200) || "Aula ao vivo", subtitulo: txt(i.subtitulo, 500), bullets: arr(i.bullets).map((x) => txt(x, 300)).filter(Boolean).slice(0, 6), cta: txt(i.cta, 60) || "Quero participar" },
    sala: { titulo: txt(s.titulo, 200), texto_oferta: txt(s.texto_oferta, 400), cta_oferta: txt(s.cta_oferta, 60) || "Quero aproveitar" },
    encerramento: { titulo: txt(e.titulo, 200) || "Obrigado por assistir", texto: txt(e.texto, 1500), cta: txt(e.cta, 60) || "Garantir a minha vaga", prazo: txt(e.prazo, 120) },
    roteiro: arr(o.roteiro).map((x) => ({ minuto: txt(obj(x).minuto, 10), bloco: txt(obj(x).bloco, 200), falas: txt(obj(x).falas, 2000) })).filter((x) => x.bloco).slice(0, 20),
    lembretes: arr(o.lembretes).map((x) => ({ quando: txt(obj(x).quando, 60), assunto: txt(obj(x).assunto, 200), texto: txt(obj(x).texto, 1500) })).filter((x) => x.texto).slice(0, 8),
  };
}

/** As 3 páginas do webinar (inscrição em 2 colunas, sala com a oferta no minuto, encerramento). */
export function paginasDoWebinar(o: { copy: CopyDoWebinar; endpoint: string; caminho: string; data: string; modo: string; embed: string | null; segundosDaOferta: number | null; linkDaOferta: string; encerramento: string; cores: Cores }): { inscricao: string; sala: string; encerramento: string } {
  const c = o.copy;
  const sala = `${o.caminho}/sala`;
  const inscricao = documento({
    titulo: c.inscricao.titulo,
    cores: o.cores,
    descricao: c.inscricao.subtitulo,
    corpo: `<main class="envelope"><div class="grade duas">
<section><h1>${escaparHtml(c.inscricao.titulo)}</h1>${c.inscricao.subtitulo ? `<p class="sub">${escaparHtml(c.inscricao.subtitulo)}</p>` : ""}${o.data ? `<p><strong>Quando:</strong> ${escaparHtml(o.data)}</p>` : ""}${lista(c.inscricao.bullets)}</section>
<section>${formularioDoSite({ endpoint: o.endpoint, pagina: `${o.caminho} (inscrição)`, depois: o.modo === "just_in_time" ? sala : `${o.caminho}/confirmado`, botao: c.inscricao.cta, pedirWhatsapp: true, id: "inscricao" })}</section>
</div></main>`,
  });
  const player = o.embed
    ? `<div class="video"><iframe src="${escaparHtml(o.embed)}" title="${escaparHtml(c.sala.titulo || c.inscricao.titulo)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
    : `<div class="cartao rascunho">Falta o link do vídeo da aula (YouTube ou Vimeo) no nó Webinar.</div>`;
  const salaHtml = documento({
    titulo: c.sala.titulo || c.inscricao.titulo,
    cores: o.cores,
    corpo: `<main class="envelope"><h1>${escaparHtml(c.sala.titulo || c.inscricao.titulo)}</h1>${player}
<div id="oferta" class="oferta-fixa oculto"><p style="font-size:18px;margin-bottom:10px">${escaparHtml(c.sala.texto_oferta)}</p><p id="contador" class="aviso" style="color:#fff"></p><a class="botao" href="${escaparHtml(o.linkDaOferta || "#")}">${escaparHtml(c.sala.cta_oferta)}</a></div></main>`,
    scripts: `<script>
(function(){var em=${jsonNoScript(o.segundosDaOferta === null ? 0 : o.segundosDaOferta)};var chave="lab_webinar_inicio_"+${jsonNoScript(o.caminho)};
var inicio=0;try{inicio=Number(window.localStorage.getItem(chave))||0;if(!inicio){inicio=Date.now();window.localStorage.setItem(chave,String(inicio));}}catch(e){inicio=Date.now();}
var of=document.getElementById("oferta"),ct=document.getElementById("contador");
function passo(){var s=Math.floor((Date.now()-inicio)/1000);if(s>=em){of.className="oferta-fixa";var resta=15*60-(s-em);if(resta>0){ct.textContent="Condição especial por mais "+Math.floor(resta/60)+" min";}else{ct.textContent="";}}}
passo();setInterval(passo,1000);})();
</script>`,
  });
  const fim = documento({
    titulo: c.encerramento.titulo,
    cores: o.cores,
    corpo: `<main class="envelope" style="max-width:720px"><h1>${escaparHtml(c.encerramento.titulo)}</h1>${paragrafos(c.encerramento.texto)}
${o.encerramento === "replay" && o.embed ? `<div class="video" style="margin:16px 0"><iframe src="${escaparHtml(o.embed)}" title="Replay" allowfullscreen></iframe></div>` : ""}
${c.encerramento.prazo ? `<p class="cartao"><strong>${escaparHtml(c.encerramento.prazo)}</strong></p>` : ""}
<a class="botao" href="${escaparHtml(o.linkDaOferta || "#")}">${escaparHtml(c.encerramento.cta)}</a></main>`,
  });
  return { inscricao, sala: salaHtml, encerramento: fim };
}

// ------------------------------------------------------------------ domínio e links curtos

/** Domínio com a mensagem amigável de cada jeito errado de digitar (como o ClickMax). */
export function validarDominio(v: unknown): { dominio: string | null; erro: string | null } {
  const s = txt(v, 300);
  if (!s) return { dominio: null, erro: "Escreva o domínio, por exemplo cliente.com.br." };
  if (/^https?:\/\//i.test(s)) return { dominio: null, erro: "Tire o https:// do começo: escreva só cliente.com.br." };
  if (/\s/.test(s)) return { dominio: null, erro: "O domínio não tem espaço." };
  if (s.indexOf("?") >= 0 || s.indexOf("#") >= 0) return { dominio: null, erro: "Tire o que vem depois do ? ou do #: escreva só o domínio." };
  if (s.indexOf("/") >= 0) return { dominio: null, erro: "Tire a barra e o caminho: o caminho vai no campo Caminho de cada página." };
  if (s.indexOf("@") >= 0) return { dominio: null, erro: "Isso parece um e-mail; escreva só o domínio." };
  if (s.indexOf(".") < 0) return { dominio: null, erro: "Falta a terminação, como .com.br ou .com." };
  const d = normalizarDominio(s);
  if (!d) return { dominio: null, erro: "Use só letras, números, hífen e ponto (sem acento)." };
  return { dominio: d, erro: null };
}

export type Redirecionamento = { de: string; para: string; erro: string | null };

/** "/curto -> https://destino" (um por linha; aceita espaço, "=>" ou "→"). */
export function redirecionamentosDe(v: unknown): Redirecionamento[] {
  const saida: Redirecionamento[] = [];
  for (const linha of txt(v, 6000).split("\n")) {
    const l = linha.trim();
    if (!l) continue;
    const p = l.split(/\s*(?:->|=>|→)\s*|\s+/).filter(Boolean);
    const de = caminhoLimpo(p[0] || "", "");
    const para = txt(p[1] || "", 1000);
    const destinoOk = /^https:\/\//i.test(para) ? !!urlHttps(para) : /^\//.test(para);
    saida.push({ de, para, erro: !de ? "Falta o caminho curto (ex.: /promo)." : !para ? "Falta o destino." : !destinoOk ? "O destino precisa ser https://... ou um caminho do site (/pagina)." : null });
    if (saida.length >= 40) break;
  }
  return saida;
}

export type PlanoDoDominio = { dominio: string | null; erro: string | null; host: string | null; estrutura: string; cartao: CartaoDeDns | null; enderecos: Array<{ rotulo: string; url: string }>; redirecionamentos: Redirecionamento[]; vercel_json: Record<string, unknown> };

/** O plano do domínio: endereço de cada página ligada, cartão de DNS, links curtos e o vercel.json. */
export function planoDoDominio(d: Record<string, unknown>, paginas: Array<{ rotulo: string; caminho: string }>): PlanoDoDominio {
  const v = validarDominio(d.dominio);
  const sub = txt(d.subdominio, 63).toLowerCase().replace(/[^a-z0-9-]+/g, "");
  const estrutura = txt(d.estrutura, 40) || "caminho";
  const host = v.dominio ? (estrutura === "subdominio" && sub ? `${sub}.${v.dominio}` : v.dominio) : null;
  const registrador = ehRegistrador(d.registrador) ? d.registrador : "outro";
  const redirecionamentos = redirecionamentosDe(d.redirecionamentos);
  return {
    dominio: v.dominio,
    erro: v.erro,
    host,
    estrutura,
    cartao: host ? cartaoDeDns(registrador, host, null) : null,
    enderecos: host ? paginas.map((p) => ({ rotulo: p.rotulo, url: `https://${host}${p.caminho === "/" ? "" : p.caminho}` })) : [],
    redirecionamentos,
    vercel_json: { redirects: redirecionamentos.filter((r) => !r.erro).map((r) => ({ source: r.de, destination: r.para, permanent: false })) },
  };
}

// ------------------------------------------------------------------ teste A/B

export type ConfigDoTesteAb = { teste_id: string; caminho: string; variantes: Array<{ letra: string; no_id: string; rotulo: string; caminho: string; peso: number }>; metrica: string; limite: string; variavel: string };

/** "50/50", "34/33/33" ou vazio (partes iguais). Erro em português quando não fecha 100 ou não bate com as páginas. */
export function pesosDoTeste(v: unknown, n: number): { pesos: number[]; erro: string | null } {
  const s = txt(v, 60);
  if (n < 2 || n > 5) return { pesos: [], erro: `O teste A/B precisa de 2 a 5 páginas ou quizzes ligados; tem ${n}.` };
  if (!s) {
    const base = Math.floor(100 / n);
    return { pesos: Array.from({ length: n }, (_, i) => base + (i === 0 ? 100 - base * n : 0)), erro: null };
  }
  const p = s.split(/[\/,;\s]+/).filter(Boolean).map((x) => Number(x.replace("%", "")));
  if (p.some((x) => !Number.isFinite(x) || x <= 0)) return { pesos: [], erro: "A divisão tem de ser números maiores que zero, como 50/50." };
  if (p.length !== n) return { pesos: [], erro: `A divisão tem ${p.length} parte(s), mas há ${n} versões ligadas.` };
  const soma = p.reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 100) > 0.001) return { pesos: [], erro: `A divisão soma ${soma}%; precisa somar 100%.` };
  return { pesos: p, erro: null };
}

/**
 * A página leve do teste: sorteia pela divisão, guarda a versão num cookie (a pessoa vê sempre a mesma),
 * conta a visita no ab-contar (função de outro agente) e redireciona com utm_content=variacao-x.
 */
export function htmlDoTesteAb(cfg: ConfigDoTesteAb, endpointDeContagem: string, base: string | null = null): string {
  const pagina = (script: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Carregando</title></head>
<body>
<script>
${script}
</script>
<noscript><p>Abra esta página com o JavaScript ligado.</p></noscript>
</body></html>`;
  // Com o endereço do site (https) já conhecido: o script compartilhado do A/B (_shared/ab-divisao.ts).
  const raiz = base ? urlHttps(base) : null;
  if (raiz) {
    try {
      return pagina(gerarScriptDeDivisao({ testeId: cfg.teste_id, endpoint: endpointDeContagem, variantes: cfg.variantes.map((x) => ({ id: x.letra.toLowerCase(), url: new URL(x.caminho, raiz).toString(), peso: x.peso })) }));
    } catch {
      // Endereço do contador fora do formato (teste local): segue com o script de caminho relativo abaixo.
    }
  }
  // Sem o endereço do site: o mesmo contrato do ab-contar ({ teste_id, variante, tipo }), com caminho relativo.
  const v = cfg.variantes.map((x) => ({ id: x.letra.toLowerCase(), c: x.caminho, p: x.peso }));
  return pagina(`(function(){
  var V=${jsonNoScript(v)},T=${jsonNoScript(cfg.teste_id)},E=${jsonNoScript(endpointDeContagem)},K="ab:"+T,i;
  function ler(){try{return window.localStorage.getItem(K);}catch(e){return null;}}
  function guardar(x){try{window.localStorage.setItem(K,x);}catch(e){}}
  var atual=ler(),escolhida=null;
  for(i=0;i<V.length;i++){if(V[i].id===atual)escolhida=V[i];}
  if(!escolhida){var r=Math.random()*100,soma=0;for(i=0;i<V.length;i++){soma+=V[i].p;if(r<soma){escolhida=V[i];break;}}if(!escolhida)escolhida=V[V.length-1];guardar(escolhida.id);}
  var corpo=JSON.stringify({teste_id:T,variante:escolhida.id,tipo:"visita"}),foi=false;
  try{if(navigator.sendBeacon){foi=navigator.sendBeacon(E,new Blob([corpo],{type:"text/plain"}));}}catch(e){}
  if(!foi){try{var x=new XMLHttpRequest();x.open("POST",E,true);x.setRequestHeader("Content-Type","text/plain");x.send(corpo);}catch(e){}}
  var q=window.location.search?window.location.search.slice(1).split("&"):[],extra=[];
  for(i=0;i<q.length;i++){if(q[i]&&q[i].indexOf("utm_content=")!==0)extra.push(q[i]);}
  extra.push("utm_content="+encodeURIComponent(escolhida.id));
  var alvo=escolhida.c+"?"+extra.join("&");
  setTimeout(function(){window.location.replace(alvo);},foi?0:300);
})();`);
}

/** O script da página de obrigado que conta a conversão da versão (sem endereço https do contador: null). */
export function scriptDeConversaoDoTeste(testeId: string, endpointDeContagem: string): string | null {
  try {
    return gerarScriptDeConversao({ testeId, endpoint: endpointDeContagem });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ fontes de tráfego

/** Parâmetros por canal; o anúncio da Meta leva os ids que o site-formulario lê (lead ligado ao anúncio). */
export function parametrosDoCanal(canal: string, campanha: string): Record<string, string> {
  const c = canal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const camp = campanha || "{{campaign.name}}";
  if (/anuncio|meta|facebook|ads/.test(c)) {
    return { utm_source: "meta", utm_medium: "paid", utm_campaign: campanha || "{{campaign.name}}", utm_content: "{{ad.id}}", ad_id: "{{ad.id}}", adset_id: "{{adset.id}}", campaign_id: "{{campaign.id}}" };
  }
  if (/google/.test(c)) return { utm_source: "google", utm_medium: "cpc", utm_campaign: campanha || "{campaignid}", utm_content: "{creative}", utm_term: "{keyword}" };
  if (/tiktok/.test(c)) return { utm_source: "tiktok", utm_medium: "paid", utm_campaign: campanha || "__CAMPAIGN_NAME__", utm_content: "__CID__" };
  const fonte = c.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "outro";
  const meio = /email|e_mail|newsletter/.test(fonte) ? "email" : /whatsapp|zap/.test(fonte) ? "mensagem" : "social";
  return { utm_source: fonte, utm_medium: meio, utm_campaign: camp.indexOf("{{") === 0 ? "organico" : camp };
}

export function linkComUtm(base: string, caminho: string, params: Record<string, string>): string {
  const b = base.replace(/\/+$/, "");
  const q = Object.keys(params).map((k) => `${k}=${params[k].indexOf("{") >= 0 || params[k].indexOf("__") === 0 ? params[k] : encodeURIComponent(params[k])}`).join("&");
  return `${b}${caminho === "/" ? "" : caminho}?${q}`;
}

// ------------------------------------------------------------------ WhatsApp (regras da Meta)

export type ModeloDeWhatsApp = { nome: string; categoria: string; idioma: string; cabecalho: string; corpo: string; rodape: string; botoes: Array<{ tipo: string; texto: string; url?: string }>; exemplos: string[] };

const contarEmojis = (t: string) => (t.match(/[\u2600-\u27BF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g) || []).length;

/**
 * As regras que a Meta confere antes de aprovar o modelo (ClickMax, "create-whatsapp-template-with-ai"):
 * variáveis {{1}}, {{2}}... em sequência, nunca no começo nem no fim, um exemplo por variável, corpo até
 * 1024, cabeçalho e rodapé até 60, botão até 25, no máximo 2 botões de link e 10 emojis.
 */
export function problemasDoModelo(m: ModeloDeWhatsApp): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(m.nome)) p.push("O nome do modelo usa só letras minúsculas, números e _.");
  if (["utilidade", "marketing", "autenticacao"].indexOf(m.categoria) < 0) p.push("Categoria precisa ser utilidade, marketing ou autenticação.");
  const corpo = m.corpo || "";
  if (!corpo.trim()) p.push("O corpo está vazio.");
  if (corpo.length > 1024) p.push(`O corpo tem ${corpo.length} caracteres (máximo 1024).`);
  if (m.cabecalho.length > 60) p.push(`O cabeçalho tem ${m.cabecalho.length} caracteres (máximo 60).`);
  if (m.rodape.length > 60) p.push(`O rodapé tem ${m.rodape.length} caracteres (máximo 60).`);
  const vars = (corpo.match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((v) => Number(v.replace(/[^\d]/g, "")));
  const unicas = vars.filter((x, i) => vars.indexOf(x) === i).sort((a, b) => a - b);
  if (unicas.some((x, i) => x !== i + 1)) p.push("As variáveis precisam vir em sequência: {{1}}, {{2}}, {{3}}...");
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(corpo)) p.push("O corpo não pode começar com variável.");
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(corpo)) p.push("O corpo não pode terminar com variável.");
  if (unicas.length && m.exemplos.filter((x) => x.trim()).length < unicas.length) p.push("Falta um exemplo real para cada variável.");
  if (contarEmojis(`${m.cabecalho}${corpo}${m.rodape}`) > 10) p.push("Mais de 10 emojis.");
  if (m.botoes.length > 3) p.push("No máximo 3 botões.");
  if (m.botoes.filter((b) => b.tipo === "url").length > 2) p.push("No máximo 2 botões de link.");
  for (const b of m.botoes) {
    if (!b.texto.trim()) p.push("Botão sem texto.");
    else if (b.texto.length > 25) p.push(`O botão "${b.texto}" passa de 25 caracteres.`);
    if (b.tipo === "url" && !/^https:\/\//.test(b.url || "")) p.push(`O botão "${b.texto}" precisa de um link https.`);
  }
  return p;
}

export function lerModelosDeWhatsApp(v: unknown): ModeloDeWhatsApp[] {
  return arr(v).map((x) => {
    const o = obj(x);
    const nome = txt(o.nome, 512).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return {
      nome,
      categoria: txt(o.categoria, 20),
      idioma: "pt_BR",
      cabecalho: txt(o.cabecalho, 200),
      corpo: txt(o.corpo, 2000),
      rodape: txt(o.rodape, 200),
      botoes: arr(o.botoes).map((b) => ({ tipo: txt(obj(b).tipo, 20) === "url" ? "url" : "resposta", texto: txt(obj(b).texto, 60), url: txt(obj(b).url, 500) || undefined })).slice(0, 5),
      exemplos: arr(o.exemplos).map((e) => txt(e, 200)),
    };
  }).filter((m) => m.corpo).slice(0, 10);
}

// ------------------------------------------------------------------ automação (n8n INATIVO)

export type PassoDaAutomacao = { ordem: number; tipo: string; detalhe: string; espera: string };

/**
 * O rascunho do workflow no formato do n8n: SEMPRE active:false. Os passos de envio ficam como "NoOp"
 * com o texto (o Hermes troca pelo nó do canal só depois da aprovação do dono); nada envia por aqui.
 */
export function rascunhoDoN8n(o: { nome: string; gatilho: string; passos: PassoDaAutomacao[]; saiQuando: string; horarioComercial: boolean }): Record<string, unknown> {
  const nos: Array<Record<string, unknown>> = [
    { id: "gatilho", name: "Gatilho", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { httpMethod: "POST", path: `lab-${hashCurto(o.nome, 8)}`, options: {} }, notes: `Quando: ${o.gatilho}` },
  ];
  const conexoes: Record<string, unknown> = {};
  let anterior = "Gatilho";
  o.passos.slice(0, 20).forEach((p, i) => {
    const nome = `${i + 1}. ${p.tipo}`.slice(0, 60);
    const espera = /espera|aguarda|wait/i.test(p.tipo);
    nos.push(espera
      ? { id: `p${i + 1}`, name: nome, type: "n8n-nodes-base.wait", typeVersion: 1.1, position: [(i + 1) * 260, 0], parameters: { resume: "timeInterval", amount: 1, unit: "days" }, notes: `${p.detalhe} ${p.espera}`.trim() }
      : { id: `p${i + 1}`, name: nome, type: "n8n-nodes-base.noOp", typeVersion: 1, position: [(i + 1) * 260, 0], parameters: {}, notes: `RASCUNHO (não envia): ${p.detalhe}`.slice(0, 1500) });
    conexoes[anterior] = { main: [[{ node: nome, type: "main", index: 0 }]] };
    anterior = nome;
  });
  return {
    name: `Laboratório: ${o.nome}`.slice(0, 120),
    active: false,
    nodes: nos,
    connections: conexoes,
    settings: { executionOrder: "v1" },
    meta: { origem: "laboratorio", sai_quando: o.saiQuando, so_horario_comercial: o.horarioComercial, aviso: "Criado INATIVO. Ativar é do dono, depois da aprovação no Pôr no ar." },
  };
}

// ------------------------------------------------------------------ e-mail

export type EmailDoLab = { dia: number; assunto: string; preheader: string; paragrafos: string[]; cta: string; link: string };

export function lerEmails(v: unknown, n: number): EmailDoLab[] {
  return arr(v).map((x) => {
    const o = obj(x);
    return {
      dia: Math.max(0, Math.round(Number(o.dia) || 0)),
      assunto: txt(o.assunto, 150),
      preheader: txt(o.preheader, 150),
      paragrafos: arr(o.paragrafos).map((p) => txt(p, 1500)).filter(Boolean).slice(0, 12),
      cta: txt(o.cta, 60),
      link: txt(o.link, 500),
    };
  }).filter((e) => e.assunto && e.paragrafos.length).slice(0, Math.max(1, Math.min(10, n)));
}

/** E-mail responsivo em tabela (como os clientes de e-mail leem), com o pré-cabeçalho escondido. */
export function htmlDoEmail(e: EmailDoLab, cores: Cores, remetente: string): string {
  const link = /^https:\/\//.test(e.link) || /^\//.test(e.link) ? e.link : "#";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaparHtml(e.assunto)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="display:none;max-height:0;overflow:hidden">${escaparHtml(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 24px;font-size:16px;line-height:1.6">
${e.paragrafos.map((p) => (/\[RASCUNHO SEM FONTE/i.test(p) ? `<p style="background:#fef3c7;border:1px dashed #d97706;padding:8px;border-radius:8px">${escaparHtml(p)}</p>` : `<p style="margin:0 0 14px">${escaparHtml(p)}</p>`)).join("\n")}
${e.cta ? `<p style="margin:24px 0"><a href="${escaparHtml(link)}" style="background:${cores.principal};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:bold;display:inline-block">${escaparHtml(e.cta)}</a></p>` : ""}
${remetente ? `<p style="margin:0;color:#6b7280;font-size:14px">${escaparHtml(remetente)}</p>` : ""}
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;margin:16px 0 0">Você recebeu porque se cadastrou. <a href="{{descadastrar}}" style="color:#9ca3af">Não quero mais receber</a></p>
</td></tr></table></body></html>`;
}

/** Uma página só com todos os e-mails, para a prévia do nó. */
export function previaDosEmails(emails: EmailDoLab[], cores: Cores, remetente: string): string {
  const blocos = emails.map((e, i) => `<section class="cartao"><p class="aviso">E-mail ${i + 1} · dia ${e.dia}</p><h3>${escaparHtml(e.assunto)}</h3><p class="aviso">${escaparHtml(e.preheader)}</p><iframe title="E-mail ${i + 1}" style="width:100%;height:520px;border:1px solid #e5e7eb;border-radius:12px;background:#fff" srcdoc="${escaparHtml(htmlDoEmail(e, cores, remetente))}"></iframe></section>`);
  return documento({ titulo: "E-mails (rascunho)", cores, corpo: `<main class="envelope"><h1>E-mails (rascunho)</h1><p class="aviso">Nada foi enviado. O envio só começa depois da sua aprovação no Pôr no ar.</p>${blocos.join("\n")}</main>` });
}

// ------------------------------------------------------------------ área de membros

export type Modulo = { titulo: string; objetivo: string; aulas: Array<{ titulo: string; roteiro: string; material: string }> };

export function lerModulos(v: unknown, nModulos: number, nAulas: number): Modulo[] {
  return arr(v).map((m) => {
    const o = obj(m);
    return {
      titulo: txt(o.titulo, 200),
      objetivo: txt(o.objetivo, 500),
      aulas: arr(o.aulas).map((a) => ({ titulo: txt(obj(a).titulo, 200), roteiro: txt(obj(a).roteiro, 2500), material: txt(obj(a).material, 400) })).filter((a) => a.titulo).slice(0, nAulas),
    };
  }).filter((m) => m.titulo).slice(0, nModulos);
}

export function htmlDasBoasVindas(o: { titulo: string; texto: string; modulos: Modulo[]; plataforma: string; cores: Cores }): string {
  return documento({
    titulo: o.titulo,
    cores: o.cores,
    corpo: `<main class="envelope" style="max-width:760px"><h1>${escaparHtml(o.titulo)}</h1>${paragrafos(o.texto)}
<p class="cartao">O acesso às aulas chega pelo e-mail da ${escaparHtml(o.plataforma)}. Confira também a caixa de spam.</p>
<h2>O que você vai ver</h2>${o.modulos.map((m, i) => `<section class="cartao"><h3>Módulo ${i + 1}: ${escaparHtml(m.titulo)}</h3>${m.objetivo ? `<p>${escaparHtml(m.objetivo)}</p>` : ""}${lista(m.aulas.map((a) => a.titulo))}</section>`).join("")}</main>`,
  });
}

// ------------------------------------------------------------------ template com camadas

export type Camada = { id: string; tipo: "texto" | "logo" | "foto"; campo: string; x: number; y: number; w: number; h: number; tamanho: number; cor: string; peso: number; alinhamento: string; exemplo: string };

const pct = (v: unknown, reserva: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : reserva;
};

export function lerCamadas(v: unknown): Camada[] {
  return arr(v).map((x, i) => {
    const o = obj(x);
    const tipo = o.tipo === "logo" || o.tipo === "foto" ? o.tipo : "texto";
    return {
      id: `c${i + 1}`,
      tipo,
      campo: txt(o.campo, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_") || `campo_${i + 1}`,
      x: pct(o.x, 8),
      y: pct(o.y, 8 + i * 12),
      w: pct(o.w, 84),
      h: pct(o.h, 10),
      tamanho: Math.max(12, Math.min(160, Math.round(Number(o.tamanho) || 48))),
      cor: /^#[0-9a-fA-F]{3,8}$/.test(txt(o.cor, 12)) ? txt(o.cor, 12) : "#ffffff",
      peso: Number(o.peso) >= 600 ? 800 : 500,
      alinhamento: ["left", "center", "right"].indexOf(txt(o.alinhamento, 10)) >= 0 ? txt(o.alinhamento, 10) : "left",
      exemplo: txt(o.exemplo, 300),
    } as Camada;
  }).slice(0, 12);
}

/** Linhas de uma planilha colada em texto (CSV com vírgula ou ponto e vírgula, ou TSV). A 1ª é o cabeçalho. */
export function linhasDaPlanilha(t: string, max = 30): Array<Record<string, string>> {
  const linhas = String(t || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length < 2) return [];
  const sep = linhas[0].indexOf("\t") >= 0 ? "\t" : linhas[0].indexOf(";") >= 0 ? ";" : ",";
  const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_"));
  return linhas.slice(1, max + 1).map((l) => {
    const cel = l.split(sep);
    const o: Record<string, string> = {};
    cab.forEach((c, i) => (o[c] = (cel[i] || "").trim().replace(/^"|"$/g, "")));
    return o;
  });
}

const PROPORCAO_DO_FORMATO: Record<string, [number, number, string]> = {
  post_1_1: [1, 1, "1:1"],
  feed_4_5: [4, 5, "4:5"],
  story_9_16: [9, 16, "9:16"],
  carrossel: [4, 5, "4:5"],
  capa_reel: [9, 16, "9:16"],
  banner: [16, 9, "16:9"],
};
export const proporcaoDoFormato = (f: unknown) => (PROPORCAO_DO_FORMATO[txt(f, 20)] || PROPORCAO_DO_FORMATO.feed_4_5)[2];

/**
 * A prévia do template: o fundo gerado e as camadas por cima (texto editável na própria prévia, sem
 * gastar). A logo entra pela imagem que veio ligada, nunca redesenhada. Com planilha: uma arte por linha.
 */
export function htmlDoTemplate(o: { formato: string; fundo: string | null; logo: string | null; camadas: Camada[]; linhas: Array<Record<string, string>>; cores: Cores }): string {
  const [w, h] = PROPORCAO_DO_FORMATO[o.formato] || PROPORCAO_DO_FORMATO.feed_4_5;
  const variantes = o.linhas.length ? o.linhas : [Object.fromEntries(o.camadas.map((c) => [c.campo, c.exemplo]))];
  const arte = (linha: Record<string, string>, k: number) => `<figure style="margin:0 0 24px"><div class="arte" style="position:relative;width:100%;max-width:540px;aspect-ratio:${w}/${h};background:${o.fundo ? `url('${escaparHtml(o.fundo)}') center/cover` : o.cores.principal};border-radius:12px;overflow:hidden">
${o.camadas.map((c) => {
    const pos = `position:absolute;left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%`;
    if (c.tipo === "logo") return o.logo ? `<img alt="Logo" src="${escaparHtml(o.logo)}" style="${pos};object-fit:contain">` : `<div style="${pos};border:2px dashed rgba(255,255,255,.7);border-radius:8px;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center">logo</div>`;
    if (c.tipo === "foto") return linha[c.campo] && /^https:\/\//.test(linha[c.campo]) ? `<img alt="" src="${escaparHtml(linha[c.campo])}" style="${pos};object-fit:cover;border-radius:8px">` : `<div style="${pos};background:rgba(255,255,255,.25);border-radius:8px"></div>`;
    return `<div contenteditable="true" data-campo="${escaparHtml(c.campo)}" style="${pos};color:${c.cor};font-weight:${c.peso};text-align:${c.alinhamento};font-size:calc(${c.tamanho}px * var(--escala,1));line-height:1.1;outline:none">${escaparHtml(linha[c.campo] ?? c.exemplo)}</div>`;
  }).join("\n")}
</div><figcaption class="aviso">Arte ${k + 1}${o.linhas.length ? " (linha da planilha)" : ""}</figcaption></figure>`;
  return documento({
    titulo: "Template editável",
    cores: o.cores,
    corpo: `<main class="envelope"><h1>Template editável</h1><p class="aviso">Clique no texto para editar (não gasta). A logo vem da imagem ligada, sem redesenhar.</p>${variantes.map(arte).join("\n")}</main>`,
    scripts: `<script>(function(){function ajusta(){var a=document.querySelectorAll(".arte");for(var i=0;i<a.length;i++){a[i].style.setProperty("--escala",String(a[i].clientWidth/1080));}}ajusta();window.addEventListener("resize",ajusta);})();</script>`,
  });
}

// ------------------------------------------------------------------ CRM

export function temperaturaDe(v: unknown): number {
  const n = Math.round(Number(String(v ?? "").replace(/[^\d+-]/g, "")) || 0);
  return Math.max(-100, Math.min(100, n));
}
