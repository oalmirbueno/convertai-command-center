/**
 * Peças novas do kit da Mesa Motion e o acabamento da cena (frente MOV,
 * 30/09/2026). Moram aqui (e não no _shared, que está no teto do Lovable) e o
 * _shared/cena-hf.ts junta ao kit: a mesma cena serve 9:16, 1:1, 4:5 e 16:9
 * (tudo em `--u`), só arquivos locais, linha do tempo pausada e sem sorteio.
 *
 * Peças (blueprints de cena de agência):
 * - frase_impacto: tipografia cinética, palavra por palavra batendo, a
 *   palavra de destaque na cor da marca;
 * - foto_destaque: foto REAL do cliente em tela cheia com Ken Burns e título
 *   (a foto entra pelo código, nunca pelo gerador de imagem);
 * - mockup_tela: print do site ou do app dentro do celular ou do navegador,
 *   rolando a página;
 * - pergunta: gancho digitado com cursor e a resposta que bate;
 * - beneficios: 2 a 4 benefícios com o check desenhado.
 *
 * Acabamentos (direção de arte da marca, camada nossa em volta do miolo):
 * limpo, grão de filme, grade técnica, luz da marca e cinema.
 * Sem travessão.
 */

import type { CenaDoFilme, MarcaDaCena, PecaDoKit } from "../../_shared/cena-hf.ts";

interface Quadro {
  largura: number;
  altura: number;
  u: number;
  deitado: boolean;
}

interface Montagem {
  corpo: string;
  css: string;
  js: string;
  picos: Array<{ t: number; som: string }>;
  imagens: string[];
}

const esc = (t: unknown) =>
  String(t === null || t === undefined ? "" : t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
const extensaoDe = (caminho: string) => {
  const m = /\.(png|jpe?g|webp)$/i.exec(caminho);
  return m ? `.${m[1].toLowerCase()}` : ".png";
};
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const IDS_DAS_PECAS_EXTRAS = ["frase_impacto", "foto_destaque", "mockup_tela", "pergunta", "beneficios"] as const;
export type IdDaPecaExtra = (typeof IDS_DAS_PECAS_EXTRAS)[number];

export const PECAS_EXTRAS: PecaDoKit[] = [
  {
    id: "frase_impacto",
    rotulo: "Frase de impacto",
    dimensao: "2d",
    quando: "tipografia cinética: a frase bate palavra por palavra, grande, com a palavra-chave na cor da marca",
    duracao_padrao_s: 3.5,
    parametros: [
      { chave: "frase", rotulo: "Frase", tipo: "texto", maximo: 90, obrigatorio: true, dica: "até 10 palavras" },
      { chave: "destaque", rotulo: "Palavra de destaque", tipo: "texto", maximo: 30, dica: "uma palavra da frase que ganha a cor da marca" },
    ],
  },
  {
    id: "foto_destaque",
    rotulo: "Foto real em destaque",
    dimensao: "2d",
    quando: "foto real do cliente (loja, equipe, produto) em tela cheia com zoom lento e título por cima",
    duracao_padrao_s: 4.5,
    parametros: [
      { chave: "imagens", rotulo: "Foto (do acervo ou dos insumos)", tipo: "imagens", maximo: 1, minimo: 1, obrigatorio: true },
      { chave: "titulo", rotulo: "Título", tipo: "texto", maximo: 60, dica: "até 7 palavras" },
      { chave: "subtitulo", rotulo: "Subtítulo", tipo: "texto", maximo: 100 },
    ],
  },
  {
    id: "mockup_tela",
    rotulo: "Tela no celular ou navegador",
    dimensao: "2d",
    quando: "mostrar o site, o app ou o Instagram do cliente: o print rola dentro do aparelho",
    duracao_padrao_s: 5,
    parametros: [
      { chave: "imagens", rotulo: "Print da tela", tipo: "imagens", maximo: 1, minimo: 1, obrigatorio: true },
      { chave: "titulo", rotulo: "Título", tipo: "texto", maximo: 50 },
      { chave: "moldura", rotulo: "Moldura", tipo: "texto", maximo: 12, dica: "celular ou navegador" },
    ],
  },
  {
    id: "pergunta",
    rotulo: "Pergunta digitada",
    dimensao: "2d",
    quando: "gancho: a pergunta do público aparece digitada e a resposta da marca bate em seguida",
    duracao_padrao_s: 4.5,
    parametros: [
      { chave: "pergunta", rotulo: "Pergunta", tipo: "texto", maximo: 90, obrigatorio: true, dica: "como o cliente pergunta" },
      { chave: "resposta", rotulo: "Resposta", tipo: "texto", maximo: 60, dica: "até 6 palavras" },
    ],
  },
  {
    id: "beneficios",
    rotulo: "Benefícios com check",
    dimensao: "2d",
    quando: "o que o cliente ganha, em 2 a 4 itens com o check desenhado",
    duracao_padrao_s: 5,
    parametros: [
      { chave: "titulo", rotulo: "Título", tipo: "texto", maximo: 50 },
      { chave: "itens", rotulo: "Benefícios", tipo: "lista", maximo: 4, minimo: 2, obrigatorio: true, dica: "até 5 palavras cada" },
    ],
  },
];

export const ehPecaExtra = (id: unknown): id is IdDaPecaExtra => (IDS_DAS_PECAS_EXTRAS as readonly string[]).indexOf(String(id)) >= 0;

/** Miolo de uma peça nova (ou null quando a peça é do kit de antes). */
export function montarPecaExtra(cena: CenaDoFilme, marca: MarcaDaCena, q: Quadro): Montagem | null {
  if (!ehPecaExtra(cena.peca)) return null;
  const D = cena.duracao_s;
  const p = cena.params || {};
  const txt = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const lst = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map((x) => String(x)) : []);
  const saida = Math.max(0.5, D - 0.45);

  if (cena.peca === "frase_impacto") {
    const frase = txt("frase") || cena.titulo;
    const destaque = semAcento(txt("destaque").trim());
    const pals = frase.split(" ").filter(Boolean).slice(0, 12);
    const passo = Math.min(0.32, Math.max(0.14, (D * 0.5) / Math.max(1, pals.length)));
    const html = pals
      .map((w, i) => {
        const limpa = semAcento(w.replace(/[.,!?;:]+$/, ""));
        const forte = !!destaque && limpa === destaque;
        return `<span class="fi-pal${forte ? " fi-forte" : ""}" id="fi${i}">${esc(w)}</span>`;
      })
      .join(" ");
    const tamanho = pals.length <= 4 ? 13 : pals.length <= 7 ? 10.5 : 8.6;
    return {
      corpo: `<div class="palco"><div class="fi-frase">${html}</div><div class="fi-barra" id="fibarra"></div></div>`,
      css: `.fi-frase{font-family:"Titulo",sans-serif;font-weight:800;line-height:1.02;letter-spacing:-.02em;text-align:center;font-size:calc(var(--u) * ${q.deitado ? tamanho * 0.85 : tamanho});max-width:calc(var(--u) * ${q.deitado ? 160 : 90});}
.fi-pal{display:inline-block;margin:0 calc(var(--u) * .6);}
.fi-forte{color:var(--primaria);}
.fi-barra{width:calc(var(--u) * 18);height:calc(var(--u) * 1.2);background:var(--primaria);margin-top:calc(var(--u) * 5);transform-origin:center center;}`,
      js: `${pals.map((_, i) => `tl.fromTo("#fi${i}", { scale: 1.7, opacity: 0, filter: "blur(12px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.32, ease: "expo.out" }, ${n3(0.15 + i * passo)});`).join("\n")}
tl.fromTo("#fibarra", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, ${n3(0.2 + pals.length * passo)});
tl.fromTo(".fi-forte", { y: 0 }, { y: -U * 1.2, duration: 0.25, ease: "power2.out", yoyo: true, repeat: 1 }, ${n3(0.3 + pals.length * passo)});
tl.to(".palco", { opacity: 0, scale: 1.04, duration: 0.4, ease: "power2.in" }, ${n3(saida)});`,
      picos: [{ t: 0.2, som: "impacto" }, ...(pals.length > 2 ? [{ t: 0.3 + pals.length * passo, som: "pop" }] : [])],
      imagens: [],
    };
  }

  if (cena.peca === "foto_destaque") {
    const img = lst("imagens")[0];
    const titulo = txt("titulo");
    const sub = txt("subtitulo");
    const arquivo = img ? `midia/prova-1${extensaoDe(img)}` : "";
    return {
      corpo: `<div class="fd-foto" id="fdfoto">${arquivo ? `<img src="${esc(arquivo)}" alt="">` : ""}</div><div class="fd-veu"></div><div class="palco fd-palco">${titulo ? `<h1 class="fd-titulo" id="fdtit">${esc(titulo)}</h1>` : ""}${sub ? `<p class="fd-sub" id="fdsub">${esc(sub)}</p>` : ""}</div>`,
      css: `.fd-foto{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;}
.fd-foto img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;}
.fd-veu{position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, var(--fundo) 100%);opacity:.92;}
.fd-palco{justify-content:flex-end;align-items:flex-start;text-align:left;padding-bottom:calc(var(--u) * 12);}
.fd-titulo{margin:0;font-family:"Titulo",sans-serif;font-weight:800;line-height:1.04;font-size:calc(var(--u) * ${q.deitado ? 7.5 : 9});max-width:calc(var(--u) * ${q.deitado ? 140 : 86});}
.fd-sub{margin:calc(var(--u) * 3) 0 0;font-size:calc(var(--u) * 4.2);opacity:.9;max-width:calc(var(--u) * ${q.deitado ? 120 : 84});}`,
      js: `tl.fromTo("#fdfoto img", { scale: 1.14, xPercent: -2 }, { scale: 1, xPercent: 2, duration: D, ease: "none" }, 0);
tl.fromTo("#fdfoto", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 0);
${titulo ? `tl.fromTo("#fdtit", { y: U * 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "expo.out" }, 0.45);` : ""}
${sub ? `tl.fromTo("#fdsub", { y: U * 3, opacity: 0 }, { y: 0, opacity: 0.9, duration: 0.6, ease: "power3.out" }, 0.8);` : ""}
tl.to([".fd-palco", "#fdfoto"], { opacity: 0, duration: 0.4 }, ${n3(saida)});`,
      picos: [{ t: 0.5, som: "whoosh" }],
      imagens: img ? [img] : [],
    };
  }

  if (cena.peca === "mockup_tela") {
    const img = lst("imagens")[0];
    const titulo = txt("titulo");
    const navegador = /naveg|site|desktop|computador/i.test(txt("moldura")) || (q.deitado && !/celular|app/i.test(txt("moldura")));
    const arquivo = img ? `midia/prova-1${extensaoDe(img)}` : "";
    const largura = navegador ? (q.deitado ? 110 : 88) : q.deitado ? 34 : 56;
    const altura = navegador ? (q.deitado ? 64 : 58) : q.deitado ? 70 : 112;
    const rolagem = Math.max(1.2, D - 2.2);
    return {
      corpo: `<div class="palco">${titulo ? `<div class="mt-titulo" id="mttit">${esc(titulo)}</div>` : ""}<div class="mt-aparelho ${navegador ? "mt-nav" : "mt-cel"}" id="mtap">${navegador ? `<div class="mt-barra"><span></span><span></span><span></span></div>` : `<div class="mt-notch"></div>`}<div class="mt-tela">${arquivo ? `<img id="mtimg" src="${esc(arquivo)}" alt="">` : ""}</div></div></div>`,
      css: `.mt-titulo{font-family:"Titulo",sans-serif;font-weight:800;font-size:calc(var(--u) * 6.4);margin-bottom:calc(var(--u) * 5);text-align:center;max-width:calc(var(--u) * 90);}
.mt-aparelho{position:relative;width:calc(var(--u) * ${largura});height:calc(var(--u) * ${altura});background:#0b0b0b;box-shadow:0 calc(var(--u) * 3) calc(var(--u) * 9) rgba(0,0,0,.45);overflow:hidden;}
.mt-cel{border-radius:calc(var(--u) * 7);border:calc(var(--u) * 1.4) solid #0b0b0b;}
.mt-nav{border-radius:calc(var(--u) * 2);border:calc(var(--u) * .5) solid #2a2a2a;}
.mt-barra{height:calc(var(--u) * 4.5);background:#1c1c1c;display:flex;align-items:center;padding-left:calc(var(--u) * 2);}
.mt-barra span{width:calc(var(--u) * 1.4);height:calc(var(--u) * 1.4);border-radius:50%;background:#555;margin-right:calc(var(--u) * 1);}
.mt-notch{position:absolute;z-index:2;left:50%;top:calc(var(--u) * 1.5);width:calc(var(--u) * 14);height:calc(var(--u) * 3.2);margin-left:calc(var(--u) * -7);border-radius:calc(var(--u) * 2);background:#0b0b0b;}
.mt-tela{position:absolute;left:0;right:0;bottom:0;top:${navegador ? "calc(var(--u) * 4.5)" : "0"};overflow:hidden;background:var(--claro);border-radius:${navegador ? "0" : "calc(var(--u) * 5.6)"};}
.mt-tela img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;object-position:50% 0%;}`,
      js: `${titulo ? `tl.fromTo("#mttit", { y: U * 3, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);` : ""}
tl.fromTo("#mtap", { y: U * 40, rotation: ${navegador ? 0 : -4}, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.9, ease: "expo.out" }, 0.2);
${arquivo ? `tl.fromTo("#mtimg", { objectPosition: "50% 0%" }, { objectPosition: "50% 100%", duration: ${n3(rolagem)}, ease: "power1.inOut" }, 1.1);` : ""}
tl.to(".palco", { opacity: 0, y: -U * 4, duration: 0.4, ease: "power2.in" }, ${n3(saida)});`,
      picos: [{ t: 0.4, som: "swish" }, { t: 1.15, som: "mouse_click" }],
      imagens: img ? [img] : [],
    };
  }

  if (cena.peca === "pergunta") {
    const pergunta = txt("pergunta") || cena.titulo;
    const resposta = txt("resposta");
    const letras = pergunta.split("").slice(0, 90);
    const digitar = Math.min(D * 0.45, Math.max(0.8, letras.length * 0.035));
    const passo = digitar / Math.max(1, letras.length);
    const fimDigitar = 0.3 + digitar;
    const html = letras.map((ch, i) => (ch === " " ? " " : `<span class="pg-l" id="pg${i}">${esc(ch)}</span>`)).join("");
    return {
      corpo: `<div class="palco"><div class="pg-caixa" id="pgcaixa"><span class="pg-texto">${html}</span><span class="pg-cursor" id="pgcur"></span></div>${resposta ? `<div class="pg-resposta" id="pgresp">${esc(resposta)}</div>` : ""}</div>`,
      css: `.pg-caixa{max-width:calc(var(--u) * ${q.deitado ? 140 : 88});padding:calc(var(--u) * 4) calc(var(--u) * 5);border-radius:calc(var(--u) * 4);background:rgba(255,255,255,.07);border:calc(var(--u) * .35) solid rgba(255,255,255,.14);font-size:calc(var(--u) * ${q.deitado ? 5 : 5.8});font-weight:600;line-height:1.3;}
.pg-l{opacity:0;}
.pg-cursor{display:inline-block;width:calc(var(--u) * .6);height:1.05em;margin-left:calc(var(--u) * .5);vertical-align:-0.15em;background:var(--primaria);}
.pg-resposta{margin-top:calc(var(--u) * 6);font-family:"Titulo",sans-serif;font-weight:800;color:var(--primaria);font-size:calc(var(--u) * ${q.deitado ? 8 : 9.5});text-align:center;max-width:calc(var(--u) * 90);line-height:1.05;}`,
      js: `tl.fromTo("#pgcaixa", { y: U * 4, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, 0);
tl.to(".pg-l", { opacity: 1, duration: 0.01, stagger: ${n3(passo)} }, 0.3);
tl.fromTo("#pgcur", { opacity: 1 }, { opacity: 0, duration: 0.25, ease: "steps(1)", yoyo: true, repeat: ${Math.max(1, Math.floor((D - 0.6) / 0.5))} }, 0.3);
${resposta ? `tl.fromTo("#pgresp", { scale: 1.5, opacity: 0, filter: "blur(10px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.4, ease: "expo.out" }, ${n3(fimDigitar + 0.35)});` : ""}
tl.to(".palco", { opacity: 0, duration: 0.4 }, ${n3(saida)});`,
      picos: [{ t: 0.35, som: "keyboard" }, ...(resposta ? [{ t: fimDigitar + 0.4, som: "impacto" }] : [])],
      imagens: [],
    };
  }

  // beneficios
  const itens = lst("itens").slice(0, 4);
  const titulo = txt("titulo");
  const passo = Math.min(0.55, Math.max(0.3, (D - 1.8) / Math.max(1, itens.length)));
  const cartoes = itens
    .map((t, i) => `<div class="bf-item" id="bf${i}"><svg class="bf-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" /><path id="bfp${i}" d="M6.5 12.5l3.6 3.6 7.4-8" stroke-dasharray="18" stroke-dashoffset="18" /></svg><span class="bf-txt">${esc(t)}</span></div>`)
    .join("");
  return {
    corpo: `<div class="palco">${titulo ? `<div class="bf-titulo" id="bftit">${esc(titulo)}</div>` : ""}<div class="bf-grade ${q.deitado ? "bf-deitado" : ""}">${cartoes}</div></div>`,
    css: `.bf-titulo{font-family:"Titulo",sans-serif;font-weight:800;font-size:calc(var(--u) * 7.4);margin-bottom:calc(var(--u) * 6);text-align:center;max-width:calc(var(--u) * 92);}
.bf-grade{display:flex;flex-direction:column;align-items:stretch;width:calc(var(--u) * 84);}
.bf-grade.bf-deitado{flex-direction:row;flex-wrap:wrap;justify-content:center;width:calc(var(--u) * 170);}
.bf-item{display:flex;align-items:center;margin:calc(var(--u) * 1.6);padding:calc(var(--u) * 3) calc(var(--u) * 4);border-radius:calc(var(--u) * 3);background:rgba(255,255,255,.06);}
.bf-deitado .bf-item{width:calc(var(--u) * 74);}
.bf-check{width:calc(var(--u) * 9);height:calc(var(--u) * 9);flex:none;margin-right:calc(var(--u) * 3.4);}
.bf-check circle{fill:var(--primaria);}
.bf-check path{fill:none;stroke:var(--fundo);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;}
.bf-txt{font-size:calc(var(--u) * 5);font-weight:700;line-height:1.2;}`,
    js: `${titulo ? `tl.fromTo("#bftit", { y: U * 3, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);` : ""}
${itens
  .map(
    (_, i) => `tl.fromTo("#bf${i}", { x: -U * 6, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, ${n3(0.5 + i * passo)});
tl.fromTo("#bfp${i}", { strokeDashoffset: 18 }, { strokeDashoffset: 0, duration: 0.35, ease: "power2.out" }, ${n3(0.75 + i * passo)});`,
  )
  .join("\n")}
tl.to(".palco", { opacity: 0, duration: 0.4 }, ${n3(saida)});`,
    picos: itens.map((_, i) => ({ t: 0.8 + i * passo, som: i === itens.length - 1 ? "success" : "tique" })),
    imagens: [],
  };
}

// ------------------------------------------------------------------ acabamento (direção de arte)

export const ACABAMENTOS = [
  { valor: "limpo", rotulo: "Limpo", dica: "Fundo da marca com luz suave (o de sempre)" },
  { valor: "grao", rotulo: "Grão de filme", dica: "Textura de película e vinheta: documental, artesanal" },
  { valor: "grade", rotulo: "Grade técnica", dica: "Linhas finas que correm: tecnologia, método, dados" },
  { valor: "luz", rotulo: "Luz da marca", dica: "Manchas de luz nas cores da marca: energia, jovem" },
  { valor: "cinema", rotulo: "Cinema", dica: "Faixas de cinema e vinheta quente: luxo, institucional" },
] as const;
export type IdDoAcabamento = (typeof ACABAMENTOS)[number]["valor"];
export const ehAcabamento = (v: unknown): v is IdDoAcabamento => ACABAMENTOS.some((a) => a.valor === v);

/**
 * Camadas do acabamento: `baixo` vai no fundo (atrás do miolo), `topo` por
 * cima de tudo (textura, vinheta, faixas), sem pegar o clique. Cena com fundo
 * transparente (sobreposição) não leva acabamento.
 */
export function camadaDoAcabamento(a: unknown, cores: { primaria: string; apoio: string }, q: Quadro): { baixo: string; topo: string; css: string; js: string } {
  const vazio = { baixo: "", topo: "", css: "", js: "" };
  if (!ehAcabamento(a) || a === "limpo") return vazio;
  if (a === "grao") {
    return {
      baixo: "",
      topo: `<svg class="ac-grao" id="acgrao" width="120%" height="120%"><filter id="acruido"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter><rect width="100%" height="100%" filter="url(#acruido)" /></svg><div class="ac-vinheta"></div>`,
      css: `.ac-grao{position:absolute;left:-10%;top:-10%;opacity:.09;pointer-events:none;mix-blend-mode:overlay;}
.ac-vinheta{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%);}`,
      js: `tl.fromTo("#acgrao", { x: 0, y: 0 }, { x: U * 3, y: -U * 2, duration: D, ease: "steps(24)" }, 0);`,
    };
  }
  if (a === "grade") {
    return {
      baixo: `<div class="ac-grade" id="acgrade"></div>`,
      topo: `<div class="ac-vinheta"></div>`,
      css: `.ac-grade{position:absolute;left:-10%;top:-10%;width:120%;height:120%;opacity:.16;background-image:linear-gradient(${cores.primaria}55 1px, transparent 1px),linear-gradient(90deg, ${cores.primaria}55 1px, transparent 1px);background-size:calc(var(--u) * 8) calc(var(--u) * 8);}
.ac-vinheta{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,.55) 100%);}`,
      js: `tl.fromTo("#acgrade", { x: 0, y: 0 }, { x: -U * 8, y: -U * 8, duration: D, ease: "none" }, 0);`,
    };
  }
  if (a === "luz") {
    return {
      baixo: `<div class="ac-mancha" id="acm1"></div><div class="ac-mancha ac-m2" id="acm2"></div>`,
      topo: "",
      css: `.ac-mancha{position:absolute;width:calc(var(--u) * 120);height:calc(var(--u) * 120);left:-30%;top:-25%;border-radius:50%;background:radial-gradient(circle, ${cores.primaria}55 0%, ${cores.primaria}00 62%);}
.ac-m2{left:45%;top:40%;background:radial-gradient(circle, ${cores.apoio}66 0%, ${cores.apoio}00 60%);}`,
      js: `tl.fromTo("#acm1", { xPercent: 0, yPercent: 0 }, { xPercent: 18, yPercent: 10, duration: D, ease: "sine.inOut" }, 0);
tl.fromTo("#acm2", { xPercent: 0, yPercent: 0 }, { xPercent: -16, yPercent: -12, duration: D, ease: "sine.inOut" }, 0);`,
    };
  }
  // cinema
  const faixa = q.deitado ? 9 : 6;
  return {
    baixo: "",
    topo: `<div class="ac-faixa ac-f1" id="acf1"></div><div class="ac-faixa ac-f2" id="acf2"></div><div class="ac-quente"></div>`,
    css: `.ac-faixa{position:absolute;left:0;width:100%;height:calc(var(--u) * ${faixa});background:#000;pointer-events:none;}
.ac-f1{top:0;}
.ac-f2{bottom:0;}
.ac-quente{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;background:radial-gradient(ellipse at center, rgba(255,190,120,.06) 0%, rgba(0,0,0,.5) 100%);}`,
    js: `tl.fromTo(["#acf1", "#acf2"], { scaleY: 0 }, { scaleY: 1, duration: 0.6, ease: "expo.out" }, 0);`,
  };
}

// ------------------------------------------------------------------ versão do worker de render

/**
 * O worker de render roda na máquina da agência com a PRÓPRIA cópia do
 * cena-hf, desta pasta e do trabalho.ts. Ele diz a versão a cada pedido
 * (render_workers.versao, VERSAO_DO_WORKER em workers/render/principal.ts).
 * As peças novas, o acabamento e a narração como voz na mixagem só existem
 * a partir da marca "mov-1": antes disso, o worker antigo falharia com
 * "Peça do kit desconhecida." ou mediria a voz errada.
 */
export const MARCA_DO_WORKER_MOV = 1;

export function workerConheceMov(versao: unknown): boolean {
  const m = /(?:^|\+)mov-(\d+)/.exec(typeof versao === "string" ? versao : "");
  return !!m && Number(m[1]) >= MARCA_DO_WORKER_MOV;
}

/** O que esta cena usa que só o worker novo sabe montar (ou null). */
export function novidadeDaCena(cena: { peca?: string | null; acabamento?: string | null }): string | null {
  if (ehPecaExtra(cena.peca)) {
    const p = PECAS_EXTRAS.find((x) => x.id === cena.peca);
    return `a cena "${p ? p.rotulo : String(cena.peca)}"`;
  }
  if (cena.acabamento && cena.acabamento !== "limpo" && ehAcabamento(cena.acabamento)) {
    const a = ACABAMENTOS.find((x) => x.valor === cena.acabamento);
    return `o acabamento "${a ? a.rotulo : cena.acabamento}"`;
  }
  return null;
}

/** A frase para a tela quando o worker visto por último está numa versão antiga. */
export const fraseDoWorkerAntigo = (versao: string | null, novidade: string) =>
  `O worker de render da agência está numa versão antiga (${versao || "sem versão"}) e não sabe montar ${novidade}. Atualize o código do worker na máquina da agência (workers/render, _shared/cena-hf.ts, _shared/motion-metodo.ts e mesa-motion/modulos) e reinicie; depois peça de novo.`;
