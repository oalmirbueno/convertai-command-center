import type { TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";
import { desenharCarrossel, linhasRicas, textoSemMarcas, type MidiaCarregada, type Pedaco, type ResultadoDoCarrossel } from "./renderCarrossel";

/**
 * Template do Estúdio (21/10/2026, dono: "simular um post do Instagram e do X
 * real mesmo"). Um só desenho para a prévia e para o PNG entregue: a moldura
 * do post (X, feed do Instagram ou Story) é feita aqui, por código, com os
 * ícones desenhados à mão; a foto entra INTEIRA no espaço da mídia, sem nada
 * colado por cima dela (só a pílula "1/5" do carrossel, que é da interface).
 * Erro de tamanho nunca vira corte silencioso: o texto que não cabe recusa.
 */

export const ALTURAS_PROFILE = { feed_4x5: 1350, retrato_3x4: 1440, quadrado_1x1: 1080, stories_9x16: 1920 } as const;
export type FormatoProfile = keyof typeof ALTURAS_PROFILE;
export const LARGURA_PROFILE = 1080;

const FONTE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const fonte = (peso: number, px: number) => `${peso} ${Math.max(1, Math.round(px))}px ${FONTE}`;

/** Cores das interfaces reais (X: claro, dim e "apagar as luzes"; Instagram: claro e escuro). */
export const CORES_DO_X = {
  claro: { fundo: "#ffffff", texto: "#0f1419", cinza: "#536471", borda: "#eff3f4", midia: "#cfd9de", fio: "#cfd9de", fundoMidia: "#f7f9f9" },
  dim: { fundo: "#15202b", texto: "#f7f9f9", cinza: "#8b98a5", borda: "#38444d", midia: "#38444d", fio: "#425364", fundoMidia: "#1e2732" },
  escuro: { fundo: "#000000", texto: "#e7e9ea", cinza: "#71767b", borda: "#2f3336", midia: "#2f3336", fio: "#333639", fundoMidia: "#16181c" },
} as const;
export const CORES_DO_IG = {
  claro: { fundo: "#ffffff", texto: "#000000", cinza: "#737373", borda: "#dbdbdb", fundoMidia: "#efefef", ponto: "#a8a8a8" },
  escuro: { fundo: "#000000", texto: "#f5f5f5", cinza: "#a8a8a8", borda: "#262626", fundoMidia: "#121212", ponto: "#555555" },
} as const;
const AZUL_DO_X = "#1d9bf0";
const AZUL_DO_IG = "#0095f6";

/** Tempo padrão de cada rede quando a equipe não escreve um. */
export const TEMPO_PADRAO = { twitter: "2h", instagram: "Há 2 horas", story: "2 h", carrossel: "2h" } as const;

type Medir = (s: string) => number;

/** Quebra palavras e parágrafos sem cortar caracteres ou desenhar fora do quadro. */
export function linhasProfile(texto: string, largura: number, medir: Medir): string[] {
  return quebrar(texto, () => largura, medir);
}

/** Igual ao linhasProfile, com a largura que pode mudar por linha (a 1ª da legenda divide espaço com o @). */
function quebrar(texto: string, larguraDa: (linha: number) => number, medir: Medir): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.replace(/\r/g, "").split("\n")) {
    let linha = "";
    for (const palavra of paragrafo.trim().split(/\s+/).filter(Boolean)) {
      const candidata = linha ? `${linha} ${palavra}` : palavra;
      if (medir(candidata) <= larguraDa(linhas.length)) { linha = candidata; continue; }
      if (linha) { linhas.push(linha); linha = ""; }
      for (const letra of Array.from(palavra)) {
        if (linha && medir(linha + letra) > larguraDa(linhas.length)) { linhas.push(linha); linha = ""; }
        linha += letra;
      }
    }
    linhas.push(linha);
  }
  return linhas;
}

/**
 * Linhas com negrito para o post do X e o Story (24/10, dono: "aparece com os asteriscos"): "**trecho**" sai
 * em negrito pela mesma leitura do Carrossel X; linha vazia continua uma linha em branco, como no app.
 */
export function linhasComNegrito(texto: string, largura: number, medir: (s: string, negrito: boolean) => number): Pedaco[][] {
  const saida: Pedaco[][] = [];
  for (const l of linhasRicas(texto, largura, medir)) { if (l.paragrafo) saida.push([]); saida.push(l.pedacos); }
  return saida;
}

/** Escreve uma linha de pedaços (negrito no peso forte), à esquerda ou centrada em x. */
function escreverPedacos(ctx: CanvasRenderingContext2D, pedacos: Pedaco[], x: number, y: number, px: number, peso: number, centro = false) {
  const larguraDe = (p: Pedaco) => { ctx.font = fonte(p.negrito ? 700 : peso, px); return ctx.measureText(p.texto).width; };
  const antes = ctx.textAlign;
  let cx = centro ? x - pedacos.reduce((a, p) => a + larguraDe(p), 0) / 2 : x;
  ctx.textAlign = "left";
  for (const p of pedacos) { ctx.font = fonte(p.negrito ? 700 : peso, px); ctx.fillText(p.texto, cx, y); cx += ctx.measureText(p.texto).width; }
  ctx.textAlign = antes;
}

export function carregarImagemProfile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível carregar uma foto. Escolha outra imagem ou envie o avatar pelo campo Foto do perfil."));
    img.src = url;
  });
}

/** Números como o X mostra em português (1,2 mil; 3,4 mi). */
export function numeroDoX(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const umaCasa = (v: number) => (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "").replace(".", ",");
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) return `${umaCasa(n / 1000)} mil`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)} mil`;
  if (n < 1_000_000_000) return `${umaCasa(n / 1_000_000)} mi`;
  return `${umaCasa(n / 1_000_000_000)} bi`;
}

/** Números como o Instagram mostra (1.234). */
export function numeroDoIG(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function caixa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, raio: number) {
  const r = Math.max(0, Math.min(raio, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Corta com reticências quando não cabe (como o X faz com nome e @ longos). */
function cortar(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && ctx.measureText(`${letras.join("")}…`).width > max) letras.pop();
  return `${letras.join("")}…`;
}

export interface RetanguloProfile { x: number; y: number; largura: number; altura: number }
export interface ResultadoProfile { imagem: RetanguloProfile | null; carrossel?: ResultadoDoCarrossel }
export interface RecursosProfile {
  avatar?: HTMLImageElement | null;
  imagem?: HTMLImageElement | null;
  imagemExata?: boolean;
  /** Lâmina no conjunto: pontinhos e "1/5" do carrossel, barras do Story, linha do fio do X. */
  posicao?: { atual: number; total: number };
  /** Carrossel estilo X: a mídia do bloco (imagem ou o quadro atual do vídeo). */
  midia?: MidiaCarregada | null;
}

/** Preserva a foto inteira; a composição não regenera nem recorta. */
function fotoInteira(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, raio: number, fundo: string): RetanguloProfile {
  ctx.save(); caixa(ctx, x, y, w, h, raio); ctx.clip(); ctx.fillStyle = fundo; ctx.fillRect(x, y, w, h);
  const escala = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * escala, ih = img.naturalHeight * escala;
  const quadro = { x: x + (w - iw) / 2, y: y + (h - ih) / 2, largura: iw, altura: ih };
  ctx.drawImage(img, quadro.x, quadro.y, iw, ih); ctx.restore();
  return quadro;
}

// ------------------------------------------------------------------ ícones (desenho próprio, caixa de 24 unidades)

type Desenho = (ctx: CanvasRenderingContext2D) => void;
const ICONES: Record<string, Desenho> = {
  responder: (c) => { c.moveTo(8, 4); c.lineTo(16, 4); c.arcTo(21, 4, 21, 9, 5); c.lineTo(21, 11); c.arcTo(21, 16, 16, 16, 5); c.lineTo(12, 16); c.lineTo(7, 20); c.lineTo(7, 16); c.arcTo(3, 16, 3, 11, 4.5); c.lineTo(3, 9); c.arcTo(3, 4, 8, 4, 5); c.closePath(); },
  repostar: (c) => { c.moveTo(4.5, 13); c.lineTo(4.5, 8); c.lineTo(17.5, 8); c.moveTo(14.5, 5); c.lineTo(17.5, 8); c.lineTo(14.5, 11); c.moveTo(19.5, 11); c.lineTo(19.5, 16); c.lineTo(6.5, 16); c.moveTo(9.5, 13); c.lineTo(6.5, 16); c.lineTo(9.5, 19); },
  curtir: (c) => { c.moveTo(12, 20.5); c.bezierCurveTo(5, 15.6, 2.5, 12.4, 2.5, 8.9); c.bezierCurveTo(2.5, 5.9, 4.8, 3.8, 7.5, 3.8); c.bezierCurveTo(9.4, 3.8, 11, 4.9, 12, 6.6); c.bezierCurveTo(13, 4.9, 14.6, 3.8, 16.5, 3.8); c.bezierCurveTo(19.2, 3.8, 21.5, 5.9, 21.5, 8.9); c.bezierCurveTo(21.5, 12.4, 19, 15.6, 12, 20.5); c.closePath(); },
  ver: (c) => { c.moveTo(5, 20); c.lineTo(5, 13); c.moveTo(10, 20); c.lineTo(10, 5); c.moveTo(15, 20); c.lineTo(15, 10); c.moveTo(20, 20); c.lineTo(20, 15); },
  salvar: (c) => { c.moveTo(6, 3.5); c.lineTo(18, 3.5); c.lineTo(18, 20.5); c.lineTo(12, 16); c.lineTo(6, 20.5); c.closePath(); },
  compartilhar: (c) => { c.moveTo(4, 14); c.lineTo(4, 20); c.lineTo(20, 20); c.lineTo(20, 14); c.moveTo(12, 15); c.lineTo(12, 3.5); c.moveTo(7, 8.5); c.lineTo(12, 3.5); c.lineTo(17, 8.5); },
  comentar: (c) => { c.arc(12, 11.5, 9, Math.PI * 0.72, Math.PI * 2.62); c.lineTo(3, 21); c.closePath(); },
  enviar: (c) => { c.moveTo(21.5, 3); c.lineTo(2.5, 9.8); c.lineTo(10.2, 13.6); c.lineTo(14.2, 21.5); c.closePath(); c.moveTo(10.2, 13.6); c.lineTo(21.5, 3); },
  fechar: (c) => { c.moveTo(5, 5); c.lineTo(19, 19); c.moveTo(19, 5); c.lineTo(5, 19); },
};
const PONTOS: Desenho = (c) => { c.arc(5, 12, 1.6, 0, Math.PI * 2); c.moveTo(13.6, 12); c.arc(12, 12, 1.6, 0, Math.PI * 2); c.moveTo(20.6, 12); c.arc(19, 12, 1.6, 0, Math.PI * 2); };

function icone(ctx: CanvasRenderingContext2D, desenho: Desenho, x: number, y: number, tamanho: number, cor: string, preencher = false, linha = 1.9) {
  ctx.save(); ctx.translate(x, y); ctx.scale(tamanho / 24, tamanho / 24);
  ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineWidth = linha; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath(); desenho(ctx);
  if (preencher) ctx.fill(); else ctx.stroke();
  ctx.restore();
}

/** Selo de verificação: estrela de pontas arredondadas e o visto branco (desenho próprio, não a marca). */
function selo(ctx: CanvasRenderingContext2D, cx: number, cy: number, raio: number, cor: string) {
  ctx.save(); ctx.fillStyle = cor; ctx.beginPath();
  const pontas = 24;
  for (let i = 0; i <= pontas; i++) {
    const a = (i / pontas) * Math.PI * 2 - Math.PI / 2, r = i % 2 === 0 ? raio : raio * 0.86;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = raio * 0.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(cx - raio * 0.4, cy + raio * 0.02); ctx.lineTo(cx - raio * 0.1, cy + raio * 0.32); ctx.lineTo(cx + raio * 0.42, cy - raio * 0.3); ctx.stroke();
  ctx.restore();
}

function avatarRedondo(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null | undefined, nome: string, x: number, y: number, d: number, fundo: string, tinta: string) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  if (img) {
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, x, y, d, d);
  } else {
    ctx.fillStyle = fundo; ctx.fillRect(x, y, d, d);
    ctx.fillStyle = tinta; ctx.font = fonte(600, d * 0.42); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(Array.from(nome.trim())[0]?.toUpperCase() || "?", x + d / 2, y + d / 2);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

/** Altura da mídia sobre a largura (16:9, 1:1 ou 4:5), com o padrão de cada rede. */
function razaoDaMidia(t: TemplateProfile): number {
  const p = t.proporcao || (t.estilo === "instagram" ? "4:5" : "16:9");
  if (t.estilo === "instagram") return p === "1:1" ? 1 : 1.25;
  return p === "1:1" ? 1 : p === "4:5" ? 1.25 : 9 / 16;
}

const NAO_CABE = "O texto não cabe neste formato. Reduza o tamanho, escolha um formato mais alto ou divida a lâmina antes de montar.";

// ------------------------------------------------------------------ X

function planoDoX(ctx: CanvasRenderingContext2D, t: TemplateProfile, W: number, temImagem: boolean) {
  const s = t.tamanho_texto / 15, pad = 16 * s, A = t.tamanho_foto, gap = 8 * s;
  const colX = pad + A + gap, cw = W - colX - pad;
  const linhas = linhasComNegrito(t.texto, cw, (x, negrito) => { ctx.font = fonte(negrito ? 700 : 400, 15 * s); return ctx.measureText(x).width; });
  const lh = 20 * s, topo = 12 * s, cab = 20 * s, textoTopo = 2 * s, fim = 12 * s;
  // Largura da mídia ajustável à mão (40 a 100% da coluna do texto), alinhada à esquerda como no X.
  const midiaW = cw * Math.max(40, Math.min(100, t.midia ?? 100)) / 100;
  const midiaH = temImagem ? midiaW * razaoDaMidia(t) : 0;
  const conteudo = cab + textoTopo + linhas.length * lh + (midiaH ? 12 * s + midiaH : 0) + 12 * s + 20 * s;
  return { s, pad, A, colX, cw, linhas, lh, topo, cab, textoTopo, fim, midiaW, midiaH, altura: topo + Math.max(conteudo, A) + fim };
}

function pintarX(ctx: CanvasRenderingContext2D, t: TemplateProfile, x: number, y: number, W: number, p: ReturnType<typeof planoDoX>, rec: RecursosProfile) {
  const cor = CORES_DO_X[t.tema === "dim" ? "dim" : t.tema === "escuro" ? "escuro" : "claro"];
  const { s, pad, A, colX, cw } = p;
  ctx.fillStyle = cor.fundo; caixa(ctx, x, y, W, p.altura, t.arredondamento); ctx.fill();
  ctx.strokeStyle = cor.borda; ctx.lineWidth = Math.max(1, s); caixa(ctx, x, y, W, p.altura, t.arredondamento); ctx.stroke();
  const ax = x + pad, ay = y + p.topo;
  // Fio: a linha entra pelo alto do avatar (post seguinte) e sai por baixo (post anterior do fio).
  const pos = rec.posicao;
  if (t.fio && pos && pos.total > 1) {
    ctx.strokeStyle = cor.fio; ctx.lineWidth = 2 * s; ctx.lineCap = "butt";
    if (pos.atual > 1) { ctx.beginPath(); ctx.moveTo(ax + A / 2, y); ctx.lineTo(ax + A / 2, ay - 4 * s); ctx.stroke(); }
    if (pos.atual < pos.total) { ctx.beginPath(); ctx.moveTo(ax + A / 2, ay + A + 4 * s); ctx.lineTo(ax + A / 2, y + p.altura); ctx.stroke(); }
  }
  avatarRedondo(ctx, rec.avatar, t.nome, ax, ay, A, cor.borda, cor.texto);
  // Cabeçalho: nome, selo, @ · tempo e o "…" à direita, na mesma linha (o @ corta antes do nome).
  const cx = x + colX, meio = ay + p.cab / 2, mais = 18.75 * s;
  ctx.textBaseline = "middle";
  const espacoDoSelo = t.verificado ? 20 * s : 0;
  const larguraDaLinha = cw - mais - 8 * s;
  ctx.font = fonte(700, 15 * s);
  const nome = cortar(ctx, t.nome, Math.max(40 * s, larguraDaLinha * 0.62 - espacoDoSelo));
  ctx.fillStyle = cor.texto; ctx.fillText(nome, cx, meio);
  let cursor = cx + ctx.measureText(nome).width;
  if (t.verificado) { selo(ctx, cursor + 2 * s + 9.4 * s, meio, 9.4 * s, AZUL_DO_X); cursor += espacoDoSelo; }
  ctx.font = fonte(400, 15 * s); ctx.fillStyle = cor.cinza;
  const resto = cx + larguraDaLinha - (cursor + 4 * s);
  const handle = t.ocultar_tempo ? `@${t.username}` : `@${t.username} · ${t.tempo || TEMPO_PADRAO.twitter}`;
  if (resto > 12 * s) ctx.fillText(cortar(ctx, handle, resto), cursor + 4 * s, meio);
  icone(ctx, PONTOS, x + W - pad - mais, meio - mais / 2, mais, cor.cinza, true);
  // Texto do post, com as quebras do autor.
  ctx.font = fonte(400, 15 * s); ctx.fillStyle = cor.texto; ctx.textBaseline = "top";
  let cy = ay + p.cab + p.textoTopo;
  for (const linha of p.linhas) { escreverPedacos(ctx, linha, cx, cy + (p.lh - 15 * s * 1.18) / 2, 15 * s, 400); cy += p.lh; }
  let imagem: RetanguloProfile | null = null, area: RetanguloProfile | null = null;
  if (rec.imagem && p.midiaH) {
    cy += 12 * s;
    area = { x: cx, y: cy, largura: p.midiaW, altura: p.midiaH };
    // Foto gerada: cantos de 16 px como no X. Captura, logo ou foto exata (e ponto marcado): sem recorte nenhum.
    const raio = rec.imagemExata || t.destaque ? 0 : 16 * s;
    imagem = fotoInteira(ctx, rec.imagem, cx, cy, p.midiaW, p.midiaH, raio, cor.fundoMidia);
    ctx.strokeStyle = cor.midia; ctx.lineWidth = Math.max(1, s); caixa(ctx, cx, cy, p.midiaW, p.midiaH, raio); ctx.stroke();
    cy += p.midiaH;
  }
  // Ações: responder, repostar, curtir, ver; salvar e compartilhar à direita.
  cy += 12 * s;
  const tam = 18.75 * s, linhaDoMeio = cy + 10 * s, direita = 2 * tam + 12 * s, esquerda = cw - direita - 12 * s;
  const n = t.numeros || {};
  const acoes: Array<[string, number | undefined]> = [["responder", n.respostas], ["repostar", n.reposts], ["curtir", n.curtidas], ["ver", n.visualizacoes]];
  ctx.textBaseline = "middle"; ctx.font = fonte(400, 13 * s);
  acoes.forEach(([nomeDoIcone, valor], i) => {
    const ix = cx + i * (esquerda / 4);
    icone(ctx, ICONES[nomeDoIcone], ix, linhaDoMeio - tam / 2, tam, cor.cinza);
    if (!t.ocultar_numeros && typeof valor === "number" && valor > 0) { ctx.fillStyle = cor.cinza; ctx.fillText(numeroDoX(valor), ix + tam + 4 * s, linhaDoMeio); }
  });
  icone(ctx, ICONES.salvar, cx + cw - direita, linhaDoMeio - tam / 2, tam, cor.cinza);
  icone(ctx, ICONES.compartilhar, cx + cw - tam, linhaDoMeio - tam / 2, tam, cor.cinza);
  ctx.textBaseline = "alphabetic";
  return { imagem, area };
}

// ------------------------------------------------------------------ Instagram (feed)

interface LinhaDaLegenda { texto: string; arroba?: string; mais?: boolean }

/** Legenda como o app mostra: @ em negrito na 1ª linha, até 2 linhas e "… mais" (ou tudo, se aberta). */
export function linhasDaLegenda(arroba: string, texto: string, largura: number, medir: (s: string, negrito: boolean) => number, aberta = false): LinhaDaLegenda[] {
  const larguraDoArroba = medir(`${arroba} `, true);
  const linhas = quebrar(texto, (i) => (i === 0 ? largura - larguraDoArroba : largura), (s) => medir(s, false));
  const saida: LinhaDaLegenda[] = linhas.map((l) => ({ texto: l }));
  if (!aberta && saida.length > 2) {
    saida.length = 2;
    const ultima = saida[1];
    const sufixo = "… mais";
    const palavras = ultima.texto.split(" ");
    while (palavras.length > 1 && medir(`${palavras.join(" ")}${sufixo}`, false) > largura) palavras.pop();
    let resto = palavras.join(" ");
    while (Array.from(resto).length > 1 && medir(`${resto}${sufixo}`, false) > largura) resto = Array.from(resto).slice(0, -1).join("");
    saida[1] = { texto: resto, mais: true };
  }
  saida[0] = { ...saida[0], arroba };
  return saida;
}

function planoDoIG(ctx: CanvasRenderingContext2D, t: TemplateProfile, W: number) {
  // A escala segue o texto escolhido, sem passar da proporção do app (ícones e pontinhos sempre cabem na linha).
  const s = Math.min(t.tamanho_texto / 14, W / 330), pad = 12 * s, A = t.tamanho_foto, anel = A + 8 * s;
  const cab = Math.max(anel, 36 * s) + 16 * s;
  const midiaH = W * razaoDaMidia(t);
  const acoes = 46 * s, lh = 18 * s;
  const medir = (x: string, negrito: boolean) => { ctx.font = fonte(negrito ? 600 : 400, 14 * s); return ctx.measureText(x).width; };
  // A legenda do Instagram não tem negrito no app: as marcas saem e o texto fica normal.
  const legenda = linhasDaLegenda(t.username, textoSemMarcas(t.texto), W - 2 * pad, medir, !!t.legenda_completa);
  const n = t.numeros || {};
  const curtidas = t.curtido_por || (typeof n.curtidas === "number" && n.curtidas > 0) ? lh + 4 * s : 0;
  const comentarios = typeof n.comentarios === "number" && n.comentarios > 0 ? lh + 4 * s : 0;
  const altura = cab + midiaH + acoes + curtidas + legenda.length * lh + 4 * s + comentarios + 16 * s + 14 * s;
  return { s, pad, A, anel, cab, midiaH, acoes, lh, legenda, curtidas, comentarios, altura };
}

function pintarIG(ctx: CanvasRenderingContext2D, t: TemplateProfile, x: number, y: number, W: number, p: ReturnType<typeof planoDoIG>, rec: RecursosProfile) {
  const cor = CORES_DO_IG[t.tema === "claro" ? "claro" : "escuro"];
  const { s, pad, A, anel } = p;
  ctx.fillStyle = cor.fundo; caixa(ctx, x, y, W, p.altura, t.arredondamento); ctx.fill();
  ctx.strokeStyle = cor.borda; ctx.lineWidth = Math.max(1, s); caixa(ctx, x, y, W, p.altura, t.arredondamento); ctx.stroke();
  // Cabeçalho: avatar com anel de Story, @, selo, local e "…".
  const meio = y + p.cab / 2, ax = x + pad;
  const gradiente = ctx.createLinearGradient(ax, meio + anel / 2, ax + anel, meio - anel / 2);
  if (gradiente) { gradiente.addColorStop(0, "#feda75"); gradiente.addColorStop(0.35, "#fa7e1e"); gradiente.addColorStop(0.65, "#d62976"); gradiente.addColorStop(1, "#962fbf"); }
  ctx.save(); ctx.beginPath(); ctx.arc(ax + anel / 2, meio, anel / 2, 0, Math.PI * 2); ctx.fillStyle = gradiente || "#d62976"; ctx.fill();
  ctx.beginPath(); ctx.arc(ax + anel / 2, meio, anel / 2 - 2.2 * s, 0, Math.PI * 2); ctx.fillStyle = cor.fundo; ctx.fill(); ctx.restore();
  avatarRedondo(ctx, rec.avatar, t.nome, ax + (anel - A) / 2, meio - A / 2, A, cor.borda, cor.texto);
  const tx = ax + anel + 10 * s, mais = 24 * s, larguraDoNome = x + W - pad - mais - 8 * s - tx;
  ctx.textBaseline = "middle"; ctx.font = fonte(600, 14 * s); ctx.fillStyle = cor.texto;
  const comLocal = !!t.local;
  const yNome = comLocal ? meio - 9 * s : meio;
  const arroba = cortar(ctx, t.username, larguraDoNome - (t.verificado ? 18 * s : 0));
  ctx.fillText(arroba, tx, yNome);
  if (t.verificado) selo(ctx, tx + ctx.measureText(arroba).width + 4 * s + 6.5 * s, yNome, 6.5 * s, AZUL_DO_IG);
  if (comLocal) { ctx.font = fonte(400, 12 * s); ctx.fillText(cortar(ctx, t.local || "", larguraDoNome), tx, meio + 9 * s); }
  icone(ctx, PONTOS, x + W - pad - mais, meio - mais / 2, mais, cor.texto, true);
  // Mídia: a largura inteira do post, a foto inteira dentro (fundo neutro onde sobrar).
  const my = y + p.cab;
  let imagem: RetanguloProfile | null = null;
  const area: RetanguloProfile = { x, y: my, largura: W, altura: p.midiaH };
  if (rec.imagem) imagem = fotoInteira(ctx, rec.imagem, x, my, W, p.midiaH, 0, cor.fundoMidia);
  else { ctx.fillStyle = cor.fundoMidia; ctx.fillRect(x, my, W, p.midiaH); }
  const pos = rec.posicao && rec.posicao.total > 1 ? rec.posicao : null;
  if (pos) {
    // A pílula "1/5" é da interface do carrossel (como no app), no canto da mídia.
    ctx.font = fonte(600, 12 * s);
    const rotulo = `${pos.atual}/${pos.total}`, pw = ctx.measureText(rotulo).width + 16 * s, ph = 26 * s;
    ctx.fillStyle = "rgba(18,18,18,0.7)"; caixa(ctx, x + W - 14 * s - pw, my + 14 * s, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(rotulo, x + W - 14 * s - pw / 2, my + 14 * s + ph / 2); ctx.textAlign = "left";
  }
  // Ações: curtir, comentar, enviar; os pontinhos do carrossel no meio; salvar à direita.
  const ay = my + p.midiaH, tam = 24 * s, linha = ay + p.acoes / 2;
  ["curtir", "comentar", "enviar"].forEach((nome, i) => icone(ctx, ICONES[nome], x + pad + i * (tam + 14 * s), linha - tam / 2, tam, cor.texto, false, 2));
  icone(ctx, ICONES.salvar, x + W - pad - tam, linha - tam / 2, tam, cor.texto, false, 2);
  if (pos) {
    const quantos = Math.min(pos.total, 5), d = 6 * s, g = 4 * s, total = quantos * d + (quantos - 1) * g;
    const ativo = Math.min(pos.atual - 1, quantos - 1);
    // No meio do post, mas nunca em cima dos ícones da esquerda.
    const inicio = Math.max(x + W / 2 - total / 2, x + pad + 3 * tam + 2 * 14 * s + 12 * s);
    for (let i = 0; i < quantos; i++) {
      ctx.beginPath(); ctx.arc(inicio + i * (d + g) + d / 2, linha, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = i === ativo ? AZUL_DO_IG : cor.ponto; ctx.fill();
    }
  }
  let cy = ay + p.acoes;
  const tx2 = x + pad;
  ctx.textBaseline = "top";
  const n = t.numeros || {};
  if (p.curtidas) {
    if (t.curtido_por) {
      // O @ encurta com reticências para a linha nunca passar da borda do post.
      ctx.font = fonte(400, 14 * s); const fixos = ctx.measureText("Curtido por  e ").width;
      ctx.font = fonte(600, 14 * s); const sobra = W - 2 * pad - fixos - ctx.measureText("outras pessoas").width;
      const partes: Array<[string, boolean]> = [["Curtido por ", false], [cortar(ctx, t.curtido_por, Math.max(20 * s, sobra)), true], [" e ", false], ["outras pessoas", true]];
      let px = tx2;
      for (const [trecho, negrito] of partes) { ctx.font = fonte(negrito ? 600 : 400, 14 * s); ctx.fillStyle = cor.texto; ctx.fillText(trecho, px, cy); px += ctx.measureText(trecho).width; }
    } else {
      ctx.font = fonte(600, 14 * s); ctx.fillStyle = cor.texto; ctx.fillText(`${numeroDoIG(n.curtidas || 0)} curtidas`, tx2, cy);
    }
    cy += p.curtidas;
  }
  for (const l of p.legenda) {
    let px = tx2;
    if (l.arroba) { ctx.font = fonte(600, 14 * s); ctx.fillStyle = cor.texto; ctx.fillText(l.arroba, px, cy); px += ctx.measureText(`${l.arroba} `).width; }
    ctx.font = fonte(400, 14 * s); ctx.fillStyle = cor.texto;
    if (l.texto) { ctx.fillText(l.texto, px, cy); px += ctx.measureText(l.texto).width; }
    if (l.mais) { ctx.fillText("…", px, cy); px += ctx.measureText("… ").width; ctx.fillStyle = cor.cinza; ctx.fillText("mais", px, cy); }
    cy += p.lh;
  }
  cy += 4 * s;
  if (p.comentarios) { ctx.font = fonte(400, 14 * s); ctx.fillStyle = cor.cinza; ctx.fillText(`Ver todos os ${numeroDoIG(n.comentarios || 0)} comentários`, tx2, cy); cy += p.comentarios; }
  ctx.font = fonte(400, 12 * s); ctx.fillStyle = cor.cinza; ctx.fillText(t.tempo || TEMPO_PADRAO.instagram, tx2, cy);
  ctx.textBaseline = "alphabetic";
  return { imagem, area: rec.imagem ? area : null };
}

// ------------------------------------------------------------------ Story (9:16)

function corDoTextoSobre(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#111111" : "#ffffff";
}

function pintarStory(ctx: CanvasRenderingContext2D, t: TemplateProfile, q: RetanguloProfile, raio: number, rec: RecursosProfile) {
  const s = q.largura / 375;
  ctx.save(); caixa(ctx, q.x, q.y, q.largura, q.altura, raio); ctx.clip();
  ctx.fillStyle = "#000000"; ctx.fillRect(q.x, q.y, q.largura, q.altura);
  // Barras de progresso: uma por lâmina, as já vistas e a atual cheias.
  const pos = rec.posicao && rec.posicao.total > 0 ? rec.posicao : { atual: 1, total: 1 };
  const bx = q.x + 8 * s, bw = q.largura - 16 * s, g = 4 * s, segmento = (bw - g * (pos.total - 1)) / pos.total;
  for (let i = 0; i < pos.total; i++) {
    ctx.fillStyle = i < pos.atual ? "#ffffff" : "rgba(255,255,255,0.35)";
    caixa(ctx, bx + i * (segmento + g), q.y + 8 * s, segmento, 2.5 * s, 1.25 * s); ctx.fill();
  }
  // Cabeçalho: avatar, @, tempo, "…" e fechar.
  const A = 32 * s, ay = q.y + 8 * s + 2.5 * s + 10 * s, meio = ay + A / 2;
  avatarRedondo(ctx, rec.avatar, t.nome, q.x + 12 * s, ay, A, "#3a3a3a", "#ffffff");
  ctx.textBaseline = "middle"; ctx.font = fonte(600, 14 * s); ctx.fillStyle = "#ffffff";
  const nx = q.x + 12 * s + A + 8 * s, arroba = cortar(ctx, t.username, q.largura * 0.5);
  ctx.fillText(arroba, nx, meio);
  let cursor = nx + ctx.measureText(arroba).width;
  if (t.verificado) { selo(ctx, cursor + 4 * s + 6.5 * s, meio, 6.5 * s, AZUL_DO_IG); cursor += 17 * s; }
  ctx.font = fonte(400, 14 * s); ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillText(t.tempo || TEMPO_PADRAO.story, cursor + 8 * s, meio);
  const tam = 24 * s;
  icone(ctx, PONTOS, q.x + q.largura - 12 * s - tam * 2 - 10 * s, meio - tam / 2, tam, "#ffffff", true);
  icone(ctx, ICONES.fechar, q.x + q.largura - 12 * s - tam, meio - tam / 2, tam, "#ffffff", false, 2);
  // Rodapé: "Enviar mensagem", curtir e enviar.
  const rh = 44 * s, ry = q.y + q.altura - 14 * s - rh, iconesW = 2 * tam + 34 * s;
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = Math.max(1, 1.2 * s);
  caixa(ctx, q.x + 12 * s, ry, q.largura - 24 * s - iconesW, rh, rh / 2); ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.font = fonte(400, 14 * s); ctx.fillText("Enviar mensagem", q.x + 12 * s + 18 * s, ry + rh / 2);
  icone(ctx, ICONES.curtir, q.x + q.largura - 12 * s - tam * 2 - 18 * s, ry + rh / 2 - tam / 2, tam, "#ffffff", false, 2);
  icone(ctx, ICONES.enviar, q.x + q.largura - 12 * s - tam, ry + rh / 2 - tam / 2, tam, "#ffffff", false, 2);
  // Meio: o texto (fora da foto) e a foto inteira; sem foto, o Story de texto no fundo escolhido.
  const topo = ay + A + 12 * s, baixo = ry - 12 * s, mx = q.x + 8 * s, mw = q.largura - 16 * s;
  const px = Math.round(t.tamanho_texto * 1.15), lh = px * 1.28;
  const linhas = t.texto.trim() ? linhasComNegrito(t.texto, mw - 40 * s, (x, negrito) => { ctx.font = fonte(negrito ? 800 : 600, px); return ctx.measureText(x).width; }) : [];
  const alturaDoTexto = linhas.length * lh;
  let imagem: RetanguloProfile | null = null, area: RetanguloProfile | null = null;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (rec.imagem) {
    const reservado = alturaDoTexto ? alturaDoTexto + 20 * s : 0;
    if (reservado > (baixo - topo) * 0.45) { ctx.restore(); throw new Error(NAO_CABE); }
    ctx.fillStyle = "#ffffff";
    linhas.forEach((l, i) => escreverPedacos(ctx, l, q.x + q.largura / 2, topo + i * lh, px, 600, true));
    area = { x: mx, y: topo + reservado, largura: mw, altura: baixo - topo - reservado };
    imagem = fotoInteira(ctx, rec.imagem, area.x, area.y, area.largura, area.altura, 8 * s, "#000000");
  } else {
    if (alturaDoTexto > (baixo - topo) - 40 * s) { ctx.restore(); throw new Error(NAO_CABE); }
    ctx.fillStyle = t.cor_fundo; caixa(ctx, mx, topo, mw, baixo - topo, 8 * s); ctx.fill();
    ctx.fillStyle = corDoTextoSobre(t.cor_fundo);
    const inicio = topo + (baixo - topo - alturaDoTexto) / 2;
    linhas.forEach((l, i) => escreverPedacos(ctx, l, q.x + q.largura / 2, inicio + i * lh, px, 600, true));
  }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.restore();
  return { imagem, area };
}

// ------------------------------------------------------------------ destaque (ponto marcado na tela real)

function desenharDestaque(ctx: CanvasRenderingContext2D, imagem: RetanguloProfile, area: RetanguloProfile, destaque: NonNullable<TemplateProfile["destaque"]>) {
  if (!Number.isFinite(destaque.x) || !Number.isFinite(destaque.y) || destaque.x < 0 || destaque.x > 1 || destaque.y < 0 || destaque.y > 1) throw new Error("Marque um ponto dentro da imagem real.");
  const rotulo = destaque.rotulo.trim();
  if (!rotulo || rotulo.length > 60 || /[\r\n\t<>]/.test(rotulo)) throw new Error("Escreva um rótulo simples de até 60 caracteres para o ponto.");
  const x = imagem.x + imagem.largura * destaque.x, y = imagem.y + imagem.altura * destaque.y;
  // Toda a anotação fica no espaço reservado à foto, inclusive sobre o letterbox.
  // O centro do círculo continua nos pixels da imagem inteira, sem deslocar o ponto.
  ctx.save(); caixa(ctx, area.x, area.y, area.largura, area.altura, 0); ctx.clip();
  ctx.strokeStyle = "#efb300"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.stroke();
  ctx.font = fonte(600, 22); ctx.textBaseline = "top";
  const margem = 12, larguraDoTexto = Math.min(280, area.largura - margem * 2 - 24);
  const linhas = linhasProfile(rotulo, larguraDoTexto, (s) => ctx.measureText(s).width);
  const w = Math.max(70, ...linhas.map((s) => ctx.measureText(s).width)) + 24, h = linhas.length * 29 + 18;
  if (w > area.largura - margem * 2 || h > area.altura - margem * 2) { ctx.restore(); throw new Error("O rótulo não cabe na área da imagem. Use um rótulo mais curto."); }
  const direita = area.x + area.largura - margem, baixo = area.y + area.altura - margem;
  const lx = Math.max(area.x + margem, Math.min(direita - w, x + 36 + w > direita ? x - w - 36 : x + 36));
  const ly = Math.max(area.y + margem, Math.min(baixo - h, y - h - 24 < area.y + margem ? y + 24 : y - h - 24));
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(Math.max(lx, Math.min(lx + w, x)), Math.max(ly, Math.min(ly + h, y))); ctx.stroke();
  ctx.fillStyle = "#fff2bc"; caixa(ctx, lx, ly, w, h, 8); ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  linhas.forEach((linha, i) => ctx.fillText(linha, lx + 12, ly + 9 + i * 29));
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

// ------------------------------------------------------------------ entrada

/** Mesmo desenho na prévia e no PNG entregue; erro de tamanho nunca vira corte silencioso. */
export function desenharProfile(canvas: HTMLCanvasElement, template: TemplateProfile, formato: FormatoProfile, recursos: RecursosProfile = {}): ResultadoProfile {
  canvas.width = LARGURA_PROFILE; canvas.height = ALTURAS_PROFILE[formato];
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Seu navegador não disponibilizou a prévia do template.");
  const margem = Math.max(0, template.espacamento ?? 48);
  if (template.estilo === "carrossel") {
    // Carrossel estilo post do X (22/10): a lâmina inteira é o post, com o bloco de mídia (renderCarrossel.ts).
    const carrossel = desenharCarrossel(ctx, canvas.width, canvas.height, template, { avatar: recursos.avatar, midia: recursos.midia, posicao: recursos.posicao });
    return { imagem: carrossel.bloco, carrossel };
  }
  ctx.fillStyle = template.cor_fundo || "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let r: { imagem: RetanguloProfile | null; area: RetanguloProfile | null };
  if (template.estilo === "story") {
    // No formato 9:16 o Story é a peça inteira; nos outros, um quadro 9:16 no meio do fundo escolhido.
    const cheio = formato === "stories_9x16";
    const h = cheio ? canvas.height : canvas.height - margem * 2, w = cheio ? canvas.width : h * 9 / 16;
    r = pintarStory(ctx, template, { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, largura: w, altura: h }, cheio ? 0 : template.arredondamento, recursos);
  } else {
    const disponivel = canvas.height - margem * 2, minimo = 420;
    const ig = template.estilo === "instagram";
    // Zoom do post no quadro (50 a 150%): letra, avatar e largura crescem ou diminuem juntos.
    // Sem escala escolhida, o post do X cresce até ocupar o quadro (dono: "sem a moldura branca enorme vazia").
    const escalaDe = (zz: number) => (zz === 1 ? template : { ...template, tamanho_texto: template.tamanho_texto * zz, tamanho_foto: template.tamanho_foto * zz });
    let z = Math.max(0.5, Math.min(1.5, (template.escala ?? 100) / 100));
    if (template.escala == null && !ig) {
      const cheio = canvas.width - margem * 2;
      for (let zz = 1.05; zz <= 1.3001; zz += 0.05) {
        if (planoDoX(ctx, escalaDe(zz), cheio, !!recursos.imagem).altura > disponivel * 0.9) break;
        z = zz;
      }
    }
    const t = escalaDe(z);
    const medir = (W: number) => (ig ? planoDoIG(ctx, t, W) : planoDoX(ctx, t, W, !!recursos.imagem));
    let W = (canvas.width - margem * 2) * Math.min(1, z);
    let plano = medir(W);
    while (plano.altura > disponivel && W - 20 >= minimo) { W -= 20; plano = medir(W); }
    if (plano.altura > disponivel) throw new Error(NAO_CABE);
    const x = (canvas.width - W) / 2, y = (canvas.height - plano.altura) / 2;
    r = ig ? pintarIG(ctx, t, x, y, W, plano as ReturnType<typeof planoDoIG>, recursos) : pintarX(ctx, t, x, y, W, plano as ReturnType<typeof planoDoX>, recursos);
  }
  if (template.destaque) {
    if (!r.imagem || !r.area) throw new Error("Escolha a imagem real antes de marcar um ponto.");
    desenharDestaque(ctx, r.imagem, r.area, template.destaque);
  }
  return { imagem: r.imagem };
}
