import type { BlocoDaLamina, GraficoDoBloco, MancheteDoBloco, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";

/**
 * Carrossel estilo post do X (22/10/2026, referências de Rafael Milagre e Thiago Concer).
 * A lâmina inteira é o post: foto redonda, nome em negrito, selo, @ cinza, o texto com
 * trechos em **negrito** e um bloco de mídia com cantos arredondados. Tudo desenhado por
 * código; a mídia (foto, quadro do vídeo) entra INTEIRA no bloco, gráfico e manchete são
 * desenhados aqui a partir dos dados. Sem contador "1/N": o Instagram já mostra a contagem.
 * A prévia, a miniatura e o PNG saem desta mesma função. Texto que não cabe recusa.
 */

const FONTE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIFA = 'Georgia, "Times New Roman", Times, serif';
const fonte = (peso: number, px: number, familia = FONTE) => `${peso} ${Math.max(1, Math.round(px))}px ${familia}`;
const AZUL = "#1d9bf0";
/** Cores das séries do gráfico (as mesmas em claro e escuro). */
export const CORES_DO_GRAFICO = ["#1d9bf0", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#64748b"];

export const CORES_DO_CARROSSEL = {
  claro: { texto: "#0f1419", cinza: "#536471", borda: "#e1e8ed", cartao: "#ffffff", fundoMidia: "#f2f4f5", grade: "#e6ecf0", rodape: "#eef0f2" },
  escuro: { texto: "#e7e9ea", cinza: "#8b98a5", borda: "#2f3336", cartao: "#16181c", fundoMidia: "#16181c", grade: "#2f3336", rodape: "#0b0b0b" },
} as const;

export interface RetanguloDoBloco { x: number; y: number; largura: number; altura: number; raio: number }
/** Uma mídia já carregada: imagem ou o quadro atual de um vídeo. */
export interface MidiaCarregada { fonte: CanvasImageSource; largura: number; altura: number }
export interface RecursosDoCarrossel {
  avatar?: HTMLImageElement | null;
  midia?: MidiaCarregada | null;
  posicao?: { atual: number; total: number };
}
export interface ResultadoDoCarrossel {
  /** Onde a mídia ficou (a área do vídeo no render), em pixels do PNG. */
  bloco: RetanguloDoBloco | null;
  /** Área inteira do bloco (com fundo), para clicar no ponto focal. */
  area: RetanguloDoBloco | null;
  fundoDoBloco: string;
}

export const NAO_CABE_CARROSSEL = "O texto não cabe nesta lâmina. Diminua o texto ou o bloco de mídia, ou divida a lâmina.";

// ------------------------------------------------------------------ texto com negrito

export interface Pedaco { texto: string; negrito: boolean }
/** Uma linha pronta para desenhar: pedaços na ordem, e o espaço antes dela (parágrafo). */
export interface LinhaRica { pedacos: Pedaco[]; paragrafo: boolean }

/** "**trecho**" vira negrito; asteriscos sem par ficam como texto. */
export function pedacosDoTexto(linha: string): Pedaco[] {
  const partes = linha.split("**");
  if (partes.length % 2 === 0) return [{ texto: linha, negrito: false }];
  return partes.map((texto, i) => ({ texto, negrito: i % 2 === 1 })).filter((p) => p.texto);
}

/** Texto sem as marcas de negrito (para contar e para a legenda). */
export const textoSemMarcas = (t: string) => t.replace(/\*\*/g, "");

/** Quebra palavra a palavra respeitando o peso de cada trecho; linha vazia vira espaço de parágrafo. */
export function linhasRicas(texto: string, largura: number, medir: (s: string, negrito: boolean) => number): LinhaRica[] {
  const saida: LinhaRica[] = [];
  let paragrafo = false;
  for (const bruta of texto.replace(/\r/g, "").split("\n")) {
    if (!bruta.trim()) { paragrafo = saida.length > 0; continue; }
    // Palavras com o peso do trecho; o espaço entre palavras usa o peso da palavra seguinte.
    const palavras: Pedaco[] = [];
    for (const p of pedacosDoTexto(bruta.trim())) {
      const pedacos = p.texto.split(/(\s+)/);
      for (const w of pedacos) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { palavras.push({ texto: " ", negrito: p.negrito }); continue; }
        palavras.push({ texto: w, negrito: p.negrito });
      }
    }
    let atual: Pedaco[] = [];
    let w = 0;
    const fechar = () => {
      while (atual.length && atual[atual.length - 1].texto === " ") atual.pop();
      if (atual.length) { saida.push({ pedacos: juntarPedacos(atual), paragrafo }); paragrafo = false; }
      atual = []; w = 0;
    };
    for (const p of palavras) {
      if (p.texto === " ") { if (atual.length) { atual.push(p); w += medir(" ", p.negrito); } continue; }
      const largo = medir(p.texto, p.negrito);
      if (w + largo > largura && atual.some((x) => x.texto !== " ")) fechar();
      if (largo > largura) {
        // Palavra maior que a linha: quebra por letra, sem cortar nada.
        let resto = "";
        for (const letra of Array.from(p.texto)) {
          if (resto && medir(resto + letra, p.negrito) > largura) { atual.push({ texto: resto, negrito: p.negrito }); fechar(); resto = ""; }
          resto += letra;
        }
        atual.push({ texto: resto, negrito: p.negrito }); w = medir(resto, p.negrito);
        continue;
      }
      atual.push(p); w += largo;
    }
    fechar();
  }
  return saida;
}

function juntarPedacos(lista: Pedaco[]): Pedaco[] {
  const r: Pedaco[] = [];
  for (const p of lista) {
    const ultimo = r[r.length - 1];
    if (ultimo && ultimo.negrito === p.negrito) ultimo.texto += p.texto; else r.push({ ...p });
  }
  return r;
}

// ------------------------------------------------------------------ desenho básico

function caixa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, raio: number) {
  const r = Math.max(0, Math.min(raio, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function cortar(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && ctx.measureText(`${letras.join("")}…`).width > max) letras.pop();
  return `${letras.join("")}…`;
}

function selo(ctx: CanvasRenderingContext2D, cx: number, cy: number, raio: number) {
  ctx.save(); ctx.fillStyle = AZUL; ctx.beginPath();
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

function avatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null | undefined, nome: string, x: number, y: number, d: number, fundo: string, tinta: string) {
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

/** A mídia inteira (contain) ou cobrindo o bloco a partir do ponto focal (cover). Devolve a área desenhada. */
export function enquadrar(m: { largura: number; altura: number }, area: { x: number; y: number; largura: number; altura: number }, modo: "inteira" | "preencher", focoX = 0.5, focoY = 0.5) {
  const escala = modo === "inteira" ? Math.min(area.largura / m.largura, area.altura / m.altura) : Math.max(area.largura / m.largura, area.altura / m.altura);
  const w = m.largura * escala, h = m.altura * escala;
  const x = modo === "inteira" ? area.x + (area.largura - w) / 2 : area.x + (area.largura - w) * focoX;
  const y = modo === "inteira" ? area.y + (area.altura - h) / 2 : area.y + (area.altura - h) * focoY;
  return { x, y, largura: w, altura: h };
}

// ------------------------------------------------------------------ gráfico e manchete (desenhados por código)

const numeroCurto = (v: number, unidade = "") => {
  const abs = Math.abs(v);
  const s = abs >= 1e9 ? `${(v / 1e9).toFixed(1)} bi` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)} mi` : abs >= 1e4 ? `${(v / 1e3).toFixed(1)} mil` : Number.isInteger(v) ? String(v) : v.toFixed(1);
  const pt = s.replace(".", ",").replace(/,0( |$)/, "$1");
  return unidade === "%" ? `${pt}%` : unidade ? `${unidade.trim()} ${pt}`.replace(/^(R\$|US\$) /, "$1 ") : pt;
};

/** Altura natural do card de manchete numa largura (para o bloco não sobrar nem cortar). */
function planoDaManchete(ctx: CanvasRenderingContext2D, m: MancheteDoBloco, w: number, s: number) {
  const pad = 28 * s;
  ctx.font = fonte(700, 34 * s, SERIFA);
  const titulo = linhasRicas(m.titulo, w - pad * 2, (x) => ctx.measureText(x).width);
  ctx.font = fonte(400, 22 * s);
  const fina = m.linha_fina ? linhasRicas(m.linha_fina, w - pad * 2, (x) => ctx.measureText(x).width) : [];
  const faixa = 52 * s;
  const altura = faixa + pad + titulo.length * 42 * s + (fina.length ? 14 * s + fina.length * 30 * s : 0) + (m.data ? 16 * s + 26 * s : 0) + pad;
  return { pad, titulo, fina, faixa, altura };
}

function desenharManchete(ctx: CanvasRenderingContext2D, m: MancheteDoBloco, r: { x: number; y: number; largura: number; altura: number }, raio: number, s: number, escuro: boolean) {
  const p = planoDaManchete(ctx, m, r.largura, s);
  const cor = m.cor || "#c4170c";
  const y0 = r.y + Math.max(0, (r.altura - p.altura) / 2);
  ctx.save(); caixa(ctx, r.x, y0, r.largura, Math.min(p.altura, r.altura), raio); ctx.clip();
  ctx.fillStyle = escuro ? "#16181c" : "#ffffff"; ctx.fillRect(r.x, y0, r.largura, p.altura);
  // Faixa do veículo na cor dele (como a barra do g1 ou o selo da Forbes), com o nome em letra própria.
  ctx.fillStyle = cor; ctx.fillRect(r.x, y0, r.largura, p.faixa);
  ctx.fillStyle = "#ffffff"; ctx.font = fonte(800, 24 * s); ctx.textBaseline = "middle";
  ctx.fillText(cortar(ctx, m.veiculo, r.largura - p.pad * 2), r.x + p.pad, y0 + p.faixa / 2);
  ctx.textBaseline = "top";
  let y = y0 + p.faixa + p.pad;
  ctx.fillStyle = escuro ? "#f5f5f5" : "#111111"; ctx.font = fonte(700, 34 * s, SERIFA);
  for (const l of p.titulo) { ctx.fillText(l.pedacos.map((x) => x.texto).join(""), r.x + p.pad, y); y += 42 * s; }
  if (p.fina.length) {
    y += 14 * s; ctx.fillStyle = escuro ? "#a8a8a8" : "#555555"; ctx.font = fonte(400, 22 * s);
    for (const l of p.fina) { ctx.fillText(l.pedacos.map((x) => x.texto).join(""), r.x + p.pad, y); y += 30 * s; }
  }
  if (m.data) { y += 16 * s; ctx.fillStyle = escuro ? "#8b98a5" : "#8a8a8a"; ctx.font = fonte(400, 20 * s); ctx.fillText(m.data, r.x + p.pad, y); }
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function desenharGrafico(ctx: CanvasRenderingContext2D, g: GraficoDoBloco, r: { x: number; y: number; largura: number; altura: number }, s: number, cor: (typeof CORES_DO_CARROSSEL)["claro"] | (typeof CORES_DO_CARROSSEL)["escuro"]) {
  const pad = 24 * s;
  let topo = r.y + pad;
  ctx.textBaseline = "top";
  if (g.titulo) { ctx.fillStyle = cor.texto; ctx.font = fonte(700, 26 * s); ctx.fillText(cortar(ctx, g.titulo, r.largura - pad * 2), r.x + pad, topo); topo += 40 * s; }
  const rodape = g.fonte ? 30 * s : 0;
  const area = { x: r.x + pad, y: topo, largura: r.largura - pad * 2, altura: r.y + r.altura - pad - rodape - topo };
  if (g.fonte) { ctx.fillStyle = cor.cinza; ctx.font = fonte(400, 18 * s); ctx.fillText(cortar(ctx, `Fonte: ${g.fonte}`, area.largura), area.x, r.y + r.altura - pad - 20 * s); }
  if (area.altura < 60 * s) { ctx.textBaseline = "alphabetic"; return; }
  if (g.tipo === "tabela") {
    const colunas = g.colunas || [], linhas = g.linhas || [];
    const n = linhas.length + 1, lh = Math.min(64 * s, area.altura / n), cw = area.largura / Math.max(1, colunas.length);
    ctx.font = fonte(700, Math.min(24 * s, lh * 0.45)); ctx.fillStyle = cor.cinza;
    colunas.forEach((c, i) => ctx.fillText(cortar(ctx, c, cw - 10 * s), area.x + i * cw, area.y + (lh - 24 * s) / 2));
    linhas.forEach((l, j) => {
      const y = area.y + (j + 1) * lh;
      ctx.fillStyle = cor.grade; ctx.fillRect(area.x, y, area.largura, Math.max(1, s));
      ctx.fillStyle = cor.texto;
      l.forEach((c, i) => { ctx.font = fonte(i === 0 ? 600 : 400, Math.min(24 * s, lh * 0.45)); ctx.fillText(cortar(ctx, c, cw - 10 * s), area.x + i * cw, y + (lh - 24 * s) / 2); });
    });
    ctx.textBaseline = "alphabetic";
    return;
  }
  const dados = g.dados;
  if (g.tipo === "pizza") {
    const total = dados.reduce((a, d) => a + Math.max(0, d.valor), 0) || 1;
    const raio = Math.min(area.altura, area.largura * 0.5) / 2;
    const cx = area.x + raio + 8 * s, cy = area.y + area.altura / 2;
    let a0 = -Math.PI / 2;
    dados.forEach((d, i) => {
      const a1 = a0 + (Math.max(0, d.valor) / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, raio, a0, a1); ctx.closePath();
      ctx.fillStyle = CORES_DO_GRAFICO[i % CORES_DO_GRAFICO.length]; ctx.fill();
      a0 = a1;
    });
    const lx = cx + raio + 32 * s, lh = Math.min(44 * s, area.altura / Math.max(1, dados.length));
    dados.forEach((d, i) => {
      const y = area.y + (area.altura - lh * dados.length) / 2 + i * lh;
      ctx.fillStyle = CORES_DO_GRAFICO[i % CORES_DO_GRAFICO.length]; caixa(ctx, lx, y + lh * 0.2, 18 * s, 18 * s, 4 * s); ctx.fill();
      ctx.fillStyle = cor.texto; ctx.font = fonte(700, 22 * s);
      const pct = `${Math.round((Math.max(0, d.valor) / total) * 1000) / 10}%`.replace(".", ",");
      ctx.fillText(pct, lx + 28 * s, y + lh * 0.12);
      const wp = ctx.measureText(`${pct} `).width;
      ctx.font = fonte(400, 20 * s); ctx.fillStyle = cor.cinza;
      ctx.fillText(cortar(ctx, d.rotulo, area.x + area.largura - (lx + 28 * s + wp)), lx + 28 * s + wp, y + lh * 0.16);
    });
    ctx.textBaseline = "alphabetic";
    return;
  }
  const max = Math.max(...dados.map((d) => d.valor), 0), min = Math.min(...dados.map((d) => d.valor), 0);
  const faixa = max - min || 1;
  const legenda = 34 * s, rotulos = 34 * s;
  const base = { y: area.y + rotulos, altura: area.altura - rotulos - legenda };
  const yDe = (v: number) => base.y + base.altura - ((v - min) / faixa) * base.altura;
  ctx.fillStyle = cor.grade; ctx.fillRect(area.x, yDe(0), area.largura, Math.max(1, s));
  const passo = area.largura / dados.length;
  ctx.font = fonte(400, 18 * s);
  dados.forEach((d, i) => {
    const cx = area.x + passo * (i + 0.5);
    ctx.fillStyle = cor.cinza; ctx.textAlign = "center";
    ctx.fillText(cortar(ctx, d.rotulo, passo - 6 * s), cx, base.y + base.altura + 10 * s);
    ctx.textAlign = "left";
  });
  if (g.tipo === "barras") {
    dados.forEach((d, i) => {
      const bw = Math.min(passo * 0.6, 140 * s), x = area.x + passo * (i + 0.5) - bw / 2;
      const y1 = yDe(Math.max(0, d.valor)), y2 = yDe(Math.min(0, d.valor));
      // A primeira barra em destaque e as outras mais claras, como nas comparações das referências.
      ctx.fillStyle = CORES_DO_GRAFICO[0]; ctx.globalAlpha = i === 0 ? 1 : 0.55;
      caixa(ctx, x, y1, bw, Math.max(2 * s, y2 - y1), 6 * s); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = cor.texto; ctx.font = fonte(700, 22 * s); ctx.textAlign = "center";
      ctx.fillText(numeroCurto(d.valor, g.unidade), x + bw / 2, y1 - 30 * s);
      ctx.textAlign = "left";
    });
  } else {
    ctx.strokeStyle = CORES_DO_GRAFICO[0]; ctx.lineWidth = 4 * s; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    dados.forEach((d, i) => { const x = area.x + passo * (i + 0.5), y = yDe(d.valor); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    dados.forEach((d, i) => {
      const x = area.x + passo * (i + 0.5), y = yDe(d.valor);
      ctx.beginPath(); ctx.arc(x, y, 6 * s, 0, Math.PI * 2); ctx.fillStyle = CORES_DO_GRAFICO[0]; ctx.fill();
      if (i === 0 || i === dados.length - 1) { ctx.fillStyle = cor.texto; ctx.font = fonte(700, 22 * s); ctx.textAlign = "center"; ctx.fillText(numeroCurto(d.valor, g.unidade), x, y - 34 * s); ctx.textAlign = "left"; }
    });
  }
  ctx.textBaseline = "alphabetic";
}

// ------------------------------------------------------------------ seta e som

function seta(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cor: string) {
  ctx.save(); ctx.strokeStyle = cor; ctx.lineWidth = Math.max(2, r * 0.14); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r * 0.42, cy); ctx.lineTo(cx + r * 0.4, cy); ctx.moveTo(cx + r * 0.05, cy - r * 0.36); ctx.lineTo(cx + r * 0.42, cy); ctx.lineTo(cx + r * 0.05, cy + r * 0.36); ctx.stroke();
  ctx.restore();
}

/** Ícone de som desligado (alto-falante cortado), como o do Instagram nas lâminas de vídeo. */
export function desenharSomDesligado(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save(); ctx.fillStyle = "rgba(38,38,38,0.78)"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = r * 0.11; ctx.lineCap = "round";
  const u = r / 24;
  ctx.beginPath(); ctx.moveTo(cx - 11 * u, cy - 4 * u); ctx.lineTo(cx - 6 * u, cy - 4 * u); ctx.lineTo(cx + 1 * u, cy - 10 * u); ctx.lineTo(cx + 1 * u, cy + 10 * u); ctx.lineTo(cx - 6 * u, cy + 4 * u); ctx.lineTo(cx - 11 * u, cy + 4 * u); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 12 * u, cy - 12 * u); ctx.lineTo(cx + 12 * u, cy + 12 * u); ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ plano e desenho da lâmina

export const BLOCO_PADRAO: BlocoDaLamina = { tipo: "nenhum", posicao: "abaixo", altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira", foco_x: 0.5, foco_y: 0.5 };

const temMidia = (b: BlocoDaLamina, rec: RecursosDoCarrossel) => (b.tipo === "imagem" || b.tipo === "video") && !!rec.midia;
const temBloco = (b: BlocoDaLamina, rec: RecursosDoCarrossel) => temMidia(b, rec) || (b.tipo === "grafico" && !!b.grafico) || (b.tipo === "manchete" && !!b.manchete);

/** Desenha a lâmina inteira no canvas já dimensionado (largura × altura do formato). */
export function desenharCarrossel(ctx: CanvasRenderingContext2D, W: number, H: number, t: TemplateProfile, rec: RecursosDoCarrossel = {}): ResultadoDoCarrossel {
  const escuro = t.tema === "escuro" || t.tema === "dim";
  const cor = CORES_DO_CARROSSEL[escuro ? "escuro" : "claro"];
  const b = { ...BLOCO_PADRAO, ...(t.bloco || {}) };
  const s = W / 1080;
  const fundo = t.cor_fundo || (escuro ? "#000000" : "#ffffff");
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
  if (t.rodape_cinza) {
    const g = ctx.createLinearGradient(0, H * 0.72, 0, H);
    if (g) { g.addColorStop(0, fundo); g.addColorStop(1, cor.rodape); ctx.fillStyle = g; ctx.fillRect(0, H * 0.72, W, H * 0.28); }
  }
  const margem = Math.max(48, Math.min(120, t.espacamento * 1.6)) * s;
  const colX = margem, colW = W - margem * 2 - (t.seta !== false ? 40 * s : 0);
  // Cabeçalho: foto redonda, nome em negrito com o selo e o @ cinza embaixo.
  const A = Math.max(64, Math.min(140, t.tamanho_foto * 1.2)) * s;
  const tamNome = 34 * s * Math.max(0.85, Math.min(1.3, t.tamanho_texto / 34));
  const px = t.tamanho_texto * 1.15 * s, lh = px * 1.34, gapPar = px * 0.75;
  const pesoBase = t.peso_texto === "medio" ? 500 : 400;
  const medir = (x: string, negrito: boolean) => { ctx.font = fonte(negrito ? 700 : pesoBase, px); return ctx.measureText(x).width; };
  const linhas = linhasRicas(t.texto, colW, medir);
  const alturaDasLinhas = (ls: LinhaRica[]) => ls.reduce((a, l, i) => a + lh + (l.paragrafo && i > 0 ? gapPar : 0), 0);
  // "meio": o bloco entra depois do primeiro parágrafo.
  const corte = b.posicao === "meio" ? Math.max(1, linhas.findIndex((l, i) => i > 0 && l.paragrafo)) : 0;
  const antes = b.posicao === "meio" ? (corte > 0 ? linhas.slice(0, corte) : linhas) : b.posicao === "acima" ? [] : linhas;
  const depois = b.posicao === "meio" ? (corte > 0 ? linhas.slice(corte) : []) : b.posicao === "acima" ? linhas : [];
  const cab = A, gapCab = 30 * s, gapBloco = 34 * s;
  const textoH = alturaDasLinhas(antes) + alturaDasLinhas(depois);
  const comBloco = temBloco(b, rec);
  const fixo = cab + gapCab + textoH + (comBloco ? gapBloco + (depois.length && antes.length ? gapBloco : 0) : 0);
  const topoMin = margem * 0.9, baixoMin = margem * 0.9;
  const livre = H - topoMin - baixoMin - fixo;
  if (livre < (comBloco ? 160 * s : 0)) throw new Error(NAO_CABE_CARROSSEL);
  // Bloco: largura pela coluna (ou a lâmina toda, sangrando), altura pelo espaço livre e pela mídia inteira.
  const sangra = b.sangrar && comBloco;
  const largura = sangra ? W : (W - margem * 2) * (b.largura / 100);
  let alturaDoBloco = 0;
  if (comBloco) {
    const teto = livre * (b.altura / 100);
    if (temMidia(b, rec) && b.enquadramento === "inteira") alturaDoBloco = Math.min(teto, largura * (rec.midia!.altura / rec.midia!.largura));
    else if (b.tipo === "manchete" && b.manchete) alturaDoBloco = Math.min(teto, planoDaManchete(ctx, b.manchete, largura, s).altura);
    else if (b.tipo === "grafico" && b.grafico) alturaDoBloco = Math.min(teto, Math.max(260 * s, largura * 0.62));
    else alturaDoBloco = teto;
    alturaDoBloco = Math.max(120 * s, alturaDoBloco);
  }
  const total = fixo + alturaDoBloco;
  // Só texto: o post fica no meio da lâmina (como as lâminas de texto grande); com bloco, começa no alto.
  let y = comBloco && !(sangra && b.posicao === "abaixo") ? Math.max(topoMin, (H - total) / 2 - (H - total) * 0.15) : Math.max(topoMin, (H - total) / 2);
  if (sangra && b.posicao === "abaixo") y = topoMin;
  const nomeX = colX + A + 22 * s;
  avatar(ctx, rec.avatar, t.nome, colX, y, A, cor.borda, cor.texto);
  ctx.textBaseline = "alphabetic";
  ctx.font = fonte(700, tamNome); ctx.fillStyle = cor.texto;
  const espacoDoSelo = t.verificado ? tamNome * 0.95 : 0;
  const nome = cortar(ctx, t.nome, W - margem - nomeX - espacoDoSelo);
  const yNome = y + A / 2 - 4 * s;
  ctx.fillText(nome, nomeX, yNome);
  if (t.verificado) selo(ctx, nomeX + ctx.measureText(nome).width + tamNome * 0.55, yNome - tamNome * 0.34, tamNome * 0.4);
  ctx.font = fonte(400, tamNome * 0.82); ctx.fillStyle = cor.cinza;
  ctx.fillText(cortar(ctx, `@${t.username}`, W - margem - nomeX), nomeX, yNome + tamNome * 1.12);
  y += cab + gapCab;
  const escrever = (ls: LinhaRica[]) => {
    ctx.textBaseline = "top"; ctx.fillStyle = cor.texto;
    ls.forEach((l, i) => {
      if (l.paragrafo && i > 0) y += gapPar;
      let x = colX;
      for (const p of l.pedacos) { ctx.font = fonte(p.negrito ? 700 : pesoBase, px); ctx.fillText(p.texto, x, y + (lh - px) / 2); x += ctx.measureText(p.texto).width; }
      y += lh;
    });
    ctx.textBaseline = "alphabetic";
  };
  escrever(antes);
  let resultado: ResultadoDoCarrossel = { bloco: null, area: null, fundoDoBloco: cor.fundoMidia };
  if (comBloco) {
    if (antes.length) y += gapBloco;
    const raio = sangra ? 0 : b.cantos * s;
    const altura = sangra && b.posicao === "abaixo" && !depois.length ? Math.max(alturaDoBloco, H - y) : alturaDoBloco;
    const area = { x: sangra ? 0 : colX, y, largura, altura, raio };
    if (b.sombra && !sangra) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 28 * s; ctx.shadowOffsetY = 8 * s;
      ctx.fillStyle = cor.cartao; caixa(ctx, area.x, area.y, area.largura, area.altura, raio); ctx.fill(); ctx.restore();
    }
    ctx.save(); caixa(ctx, area.x, area.y, area.largura, area.altura, raio); ctx.clip();
    ctx.fillStyle = b.tipo === "grafico" || b.tipo === "manchete" ? cor.cartao : cor.fundoMidia; ctx.fillRect(area.x, area.y, area.largura, area.altura);
    let midiaRet: RetanguloDoBloco | null = null;
    if (temMidia(b, rec)) {
      const m = rec.midia!;
      const q = enquadrar(m, area, b.enquadramento, b.foco_x, b.foco_y);
      ctx.drawImage(m.fonte, q.x, q.y, q.largura, q.altura);
      midiaRet = b.enquadramento === "inteira" ? { ...q, raio } : { ...area };
    } else if (b.tipo === "grafico" && b.grafico) desenharGrafico(ctx, b.grafico, area, s, cor);
    else if (b.tipo === "manchete" && b.manchete) desenharManchete(ctx, b.manchete, area, raio, s, escuro);
    ctx.restore();
    if (b.borda && !sangra) { ctx.strokeStyle = cor.borda; ctx.lineWidth = Math.max(1, 2 * s); caixa(ctx, area.x, area.y, area.largura, area.altura, raio); ctx.stroke(); }
    resultado = { bloco: midiaRet, area, fundoDoBloco: cor.fundoMidia };
    y += altura;
    if (depois.length) { y += gapBloco; escrever(depois); }
  } else escrever(depois);
  const pos = rec.posicao;
  // Seta de próxima na lateral direita, em todas menos na última lâmina.
  if (t.seta !== false && (!pos || pos.atual < pos.total)) seta(ctx, W - margem * 0.55 - 6 * s, H * 0.45, 22 * s, cor.texto);
  if (b.tipo === "video" && b.som_na_peca && resultado.bloco) desenharSomDesligado(ctx, W - 64 * s, H - 64 * s, 26 * s);
  return resultado;
}
