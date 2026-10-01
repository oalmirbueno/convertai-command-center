import { estadoNoTempo, familiaDaFonte, FORMATOS_DO_QUADRO, type CamadaDoQuadro, type QuadroAnimado } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { carregarFontesDoQuadro } from "./apoio";
import { tempoDaMidia } from "./estiloDaCamada";

/**
 * Exportar o quadro (frente CNV, 30/09): desenha o Quadro no tempo t num
 * canvas 2D do navegador, no tamanho real do formato (1080 px de largura), e
 * devolve um PNG. Mesmo cálculo do palco e do render (estadoNoTempo): o que
 * sai é o que a pessoa vê. Mídia com link assinado do Storage (CORS liberado);
 * mídia que não carregou fica de fora e entra no aviso.
 */

function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error("imagem não carregou"));
    img.src = url;
  });
}

function carregarQuadroDoVideo(url: string, tempo: number): Promise<HTMLVideoElement> {
  return new Promise((ok, falha) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    (v as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    let feito = false;
    const pronto = () => {
      if (feito) return;
      feito = true;
      ok(v);
    };
    const prazo = window.setTimeout(() => {
      if (!feito) {
        feito = true;
        falha(new Error("vídeo não carregou a tempo"));
      }
    }, 12000);
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(Math.max(0, tempo), Math.max(0, (v.duration || tempo) - 0.05));
      } catch {
        window.clearTimeout(prazo);
        pronto();
      }
    };
    v.onseeked = () => {
      window.clearTimeout(prazo);
      pronto();
    };
    v.onerror = () => {
      window.clearTimeout(prazo);
      if (!feito) {
        feito = true;
        falha(new Error("vídeo não carregou"));
      }
    };
    v.src = url;
  });
}

/** Caminho de retângulo com cantos redondos (sem roundRect, que o Safari 11 não tem). */
function caminhoArredondado(ctx: CanvasRenderingContext2D, x: number, y: number, l: number, a: number, r: number) {
  const raio = Math.max(0, Math.min(r, l / 2, a / 2));
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.lineTo(x + l - raio, y);
  ctx.quadraticCurveTo(x + l, y, x + l, y + raio);
  ctx.lineTo(x + l, y + a - raio);
  ctx.quadraticCurveTo(x + l, y + a, x + l - raio, y + a);
  ctx.lineTo(x + raio, y + a);
  ctx.quadraticCurveTo(x, y + a, x, y + a - raio);
  ctx.lineTo(x, y + raio);
  ctx.quadraticCurveTo(x, y, x + raio, y);
  ctx.closePath();
}

/** Quebra o texto em linhas que cabem na largura (respeita as quebras que a pessoa pôs). */
export function linhasDoTexto(ctx: Pick<CanvasRenderingContext2D, "measureText">, texto: string, largura: number): string[] {
  const saida: string[] = [];
  texto.split("\n").forEach((paragrafo) => {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (!palavras.length) {
      saida.push("");
      return;
    }
    let linha = palavras[0];
    for (let i = 1; i < palavras.length; i++) {
      const tentativa = `${linha} ${palavras[i]}`;
      if (ctx.measureText(tentativa).width <= largura) linha = tentativa;
      else {
        saida.push(linha);
        linha = palavras[i];
      }
    }
    saida.push(linha);
  });
  return saida;
}

function desenharMidia(ctx: CanvasRenderingContext2D, fonte: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }, c: CamadaDoQuadro, x: number, y: number, l: number, a: number, L: number) {
  const lw = fonte.videoWidth || fonte.naturalWidth || fonte.width || l;
  const lh = fonte.videoHeight || fonte.naturalHeight || fonte.height || a;
  const conter = c.ajuste === "conter" || c.tipo === "logo";
  const k = conter ? Math.min(l / lw, a / lh) : Math.max(l / lw, a / lh);
  const dw = lw * k;
  const dh = lh * k;
  ctx.save();
  caminhoArredondado(ctx, x, y, l, a, c.canto * L);
  ctx.clip();
  ctx.drawImage(fonte, x + (l - dw) / 2, y + (a - dh) / 2, dw, dh);
  ctx.restore();
}

function desenharTexto(ctx: CanvasRenderingContext2D, c: CamadaDoQuadro, x: number, y: number, l: number, a: number, L: number) {
  const tamanho = Math.max(1, c.tamanho * L);
  ctx.font = `${c.peso} ${tamanho}px ${familiaDaFonte(c.fonte)}`;
  const texto = c.maiusculas ? c.texto.toUpperCase() : c.texto;
  const padX = c.fundo ? tamanho * 0.32 : 0;
  const padY = c.fundo ? tamanho * 0.12 : 0;
  const linhas = linhasDoTexto(ctx, texto, Math.max(10, l - padX * 2));
  const alturaDaLinha = tamanho * 1.12;
  const bloco = linhas.length * alturaDaLinha + padY * 2;
  const larguraDoBloco = Math.min(l, Math.max.apply(null, linhas.map((t) => ctx.measureText(t).width)) + padX * 2);
  const bx = c.alinhamento === "esquerda" ? x : c.alinhamento === "direita" ? x + l - larguraDoBloco : x + (l - larguraDoBloco) / 2;
  const by = y + (a - bloco) / 2;
  if (c.fundo) {
    ctx.fillStyle = c.fundo;
    caminhoArredondado(ctx, bx, by, larguraDoBloco, bloco, tamanho * 0.18);
    ctx.fill();
  }
  ctx.fillStyle = c.cor;
  ctx.textBaseline = "middle";
  ctx.textAlign = c.alinhamento === "esquerda" ? "left" : c.alinhamento === "direita" ? "right" : "center";
  if (c.sombra) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = tamanho * 0.3;
    ctx.shadowOffsetY = tamanho * 0.06;
  }
  const tx = c.alinhamento === "esquerda" ? bx + padX : c.alinhamento === "direita" ? bx + larguraDoBloco - padX : bx + larguraDoBloco / 2;
  linhas.forEach((t, i) => ctx.fillText(t, tx, by + padY + alturaDaLinha * (i + 0.5)));
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function desenharForma(ctx: CanvasRenderingContext2D, c: CamadaDoQuadro, x: number, y: number, l: number, a: number, L: number) {
  ctx.fillStyle = c.cor;
  if (c.forma === "circulo") {
    ctx.beginPath();
    ctx.ellipse(x + l / 2, y + a / 2, l / 2, a / 2, 0, 0, Math.PI * 2);
  } else caminhoArredondado(ctx, x, y, l, a, c.forma === "pilula" ? Math.min(l, a) / 2 : c.canto * L);
  ctx.fill();
  if (c.borda > 0 && c.borda_cor) {
    ctx.strokeStyle = c.borda_cor;
    ctx.lineWidth = Math.max(1, c.borda * L);
    ctx.stroke();
  }
}

/**
 * Desenha e devolve o PNG. `urls` são os links assinados por caminho.
 * `escala` 1 = tamanho do formato (1080 de largura).
 */
export async function exportarQuadroPng(q: QuadroAnimado, t: number, urls: Record<string, string>, escala = 1): Promise<{ blob: Blob; faltaram: string[]; largura: number; altura: number }> {
  await carregarFontesDoQuadro();
  const f = FORMATOS_DO_QUADRO[q.formato] || FORMATOS_DO_QUADRO["9:16"];
  const L = Math.round(f.largura * escala);
  const H = Math.round(f.altura * escala);
  const tela = document.createElement("canvas");
  tela.width = L;
  tela.height = H;
  const ctx = tela.getContext("2d");
  if (!ctx) throw new Error("Este navegador não desenha o quadro.");
  ctx.fillStyle = q.fundo;
  ctx.fillRect(0, 0, L, H);
  const faltaram: string[] = [];
  for (const c of q.camadas) {
    const e = estadoNoTempo(c, t);
    if (!e.visivel) continue;
    const l = c.l * L;
    const a = c.a * H;
    const x = e.x * L;
    const y = e.y * H;
    ctx.save();
    ctx.globalAlpha = e.opacidade;
    ctx.translate(x + l / 2, y + a / 2);
    ctx.rotate((e.rotacao * Math.PI) / 180);
    ctx.scale(e.escala, e.escala);
    ctx.translate(-l / 2, -a / 2);
    if (e.recorte < 0.999) {
      ctx.beginPath();
      ctx.rect(0, 0, l * e.recorte, a);
      ctx.clip();
    }
    try {
      if (c.tipo === "texto") desenharTexto(ctx, c, 0, 0, l, a, L);
      else if (c.tipo === "forma") desenharForma(ctx, c, 0, 0, l, a, L);
      else if (c.midia) {
        const url = urls[c.midia.caminho];
        if (!url) faltaram.push(c.nome);
        else if (c.tipo === "video") desenharMidia(ctx, await carregarQuadroDoVideo(url, tempoDaMidia(c, t)), c, 0, 0, l, a, L);
        else desenharMidia(ctx, await carregarImagem(url), c, 0, 0, l, a, L);
      }
    } catch {
      faltaram.push(c.nome);
    }
    ctx.restore();
  }
  const blob: Blob = await new Promise((ok, falha) => {
    try {
      tela.toBlob((b) => (b ? ok(b) : falha(new Error("O navegador não gerou a imagem."))), "image/png");
    } catch {
      falha(new Error("A imagem ficou bloqueada pelo navegador (mídia de outro endereço)."));
    }
  });
  return { blob, faltaram, largura: L, altura: H };
}

/** Baixa um arquivo no navegador. */
export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
