import type { CSSProperties } from "react";
import { areaDoAdesivo, quebrarEmLinhas, TAMANHO_DO_STORY } from "./layoutDoStory";
import type { Adesivo, Story } from "./storiesApi";

/**
 * O texto nativo do Instagram (22/10/2026, dono: "pra story ter o padrão de
 * story mesmo"): o texto que a pessoa digita no app, com os estilos do próprio
 * app (Clássico, Moderno, Máquina de escrever, Forte) e a caixa de fundo
 * opcional, no tamanho e na posição de um story de verdade. É a camada de
 * texto do story, desenhada pelo código como o app desenha (na prévia, em
 * DOM; no PNG final, no canvas, com as mesmas medidas). Nunca uma imagem
 * colada por cima de outra.
 *
 * Também o adesivo desenhado no estilo do app para o PNG de baixar (no
 * Instagram de verdade a equipe põe o adesivo pelo app; o desenho é a mesma
 * forma, para postar pronto ou mandar ao cliente).
 * Safari 11: sem roundRect no canvas, sem regex nova.
 */

export type EstiloDoTexto = "classico" | "moderno" | "maquina" | "forte";
export type PosicaoDoTexto = "topo" | "meio" | "baixo";

export interface EstiloNativo {
  rotulo: string;
  familia: string;
  peso: number;
  italico: boolean;
  maiusculas: boolean;
  /** Espaço entre letras (fração do corpo). */
  espacamento: number;
  /** Corpo da letra (fração da largura do story). */
  corpo: number;
  entrelinha: number;
}

export const ESTILOS_DO_TEXTO: Record<EstiloDoTexto, EstiloNativo> = {
  classico: { rotulo: "Clássico", familia: '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif', peso: 600, italico: false, maiusculas: false, espacamento: 0, corpo: 0.062, entrelinha: 1.22 },
  moderno: { rotulo: "Moderno", familia: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif', peso: 500, italico: false, maiusculas: true, espacamento: 0.06, corpo: 0.056, entrelinha: 1.2 },
  maquina: { rotulo: "Máquina de escrever", familia: '"Courier New", Courier, monospace', peso: 700, italico: false, maiusculas: false, espacamento: 0, corpo: 0.054, entrelinha: 1.3 },
  forte: { rotulo: "Forte", familia: '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif', peso: 900, italico: true, maiusculas: true, espacamento: 0, corpo: 0.07, entrelinha: 1.1 },
};

export const ORDEM_DOS_ESTILOS: EstiloDoTexto[] = ["classico", "moderno", "maquina", "forte"];
export const ROTULO_DA_POSICAO: Record<PosicaoDoTexto, string> = { topo: "Em cima", meio: "No meio", baixo: "Embaixo" };

/** Margem dos lados e o centro de cada posição (frações), fora das zonas seguras. */
export const LAYOUT_DO_TEXTO_NATIVO = { largura: 0.8, centro: { topo: 0.25, meio: 0.44, baixo: 0.68 } as Record<PosicaoDoTexto, number>, folgaDaCaixa: 0.28 };

export interface TextoNativo {
  texto: string;
  estilo: EstiloDoTexto;
  caixa: boolean;
  posicao: PosicaoDoTexto;
}

/** O texto nativo de um story (o fundo natural guarda o estilo; com adesivo no meio, o texto sobe). */
export function textoNativoDoStory(s: Pick<Story, "texto_na_tela" | "fundo" | "adesivo">): TextoNativo {
  const f = s.fundo;
  const estilo = (f.estilo_texto && ESTILOS_DO_TEXTO[f.estilo_texto as EstiloDoTexto] ? f.estilo_texto : "classico") as EstiloDoTexto;
  let posicao = (f.posicao === "meio" || f.posicao === "baixo" ? f.posicao : "topo") as PosicaoDoTexto;
  if (s.adesivo.tipo !== "nenhum" && posicao !== "topo") posicao = "topo";
  return { texto: (s.texto_na_tela || "").trim(), estilo, caixa: f.caixa === true, posicao };
}

const textoNaCaixa = (t: TextoNativo) => (ESTILOS_DO_TEXTO[t.estilo].maiusculas ? t.texto.toUpperCase() : t.texto);

/** O estilo CSS do texto na prévia (largura do story em px). */
export function estiloCssDoTexto(t: TextoNativo, largura: number): { bloco: CSSProperties; linha: CSSProperties } {
  const e = ESTILOS_DO_TEXTO[t.estilo];
  const corpo = largura * e.corpo;
  return {
    bloco: {
      left: `${((1 - LAYOUT_DO_TEXTO_NATIVO.largura) / 2) * 100}%`,
      right: `${((1 - LAYOUT_DO_TEXTO_NATIVO.largura) / 2) * 100}%`,
      top: `${LAYOUT_DO_TEXTO_NATIVO.centro[t.posicao] * 100}%`,
      transform: "translateY(-50%)",
      fontFamily: e.familia,
      fontWeight: e.peso,
      fontStyle: e.italico ? "italic" : "normal",
      fontSize: corpo,
      lineHeight: e.entrelinha,
      letterSpacing: e.espacamento ? `${e.espacamento}em` : undefined,
      textAlign: "center",
      whiteSpace: "pre-line",
      overflowWrap: "anywhere",
      color: t.caixa ? "#111111" : "#ffffff",
      textShadow: t.caixa ? undefined : "0 1px 3px rgba(0,0,0,0.45)",
    },
    linha: t.caixa
      ? { background: "#ffffff", padding: `${corpo * 0.08}px ${corpo * LAYOUT_DO_TEXTO_NATIVO.folgaDaCaixa}px`, borderRadius: corpo * 0.18 }
      : {},
  };
}

export { textoNaCaixa };

// ------------------------------------------------------------------ canvas

function retanguloRedondo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const raio = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.lineTo(x + w - raio, y);
  ctx.arcTo(x + w, y, x + w, y + raio, raio);
  ctx.lineTo(x + w, y + h - raio);
  ctx.arcTo(x + w, y + h, x + w - raio, y + h, raio);
  ctx.lineTo(x + raio, y + h);
  ctx.arcTo(x, y + h, x, y + h - raio, raio);
  ctx.lineTo(x, y + raio);
  ctx.arcTo(x, y, x + raio, y, raio);
  ctx.closePath();
}

const fonteDoEstilo = (e: EstiloNativo, corpo: number) => `${e.italico ? "italic " : ""}${e.peso} ${Math.round(corpo)}px ${e.familia}`;

/** Desenha o texto nativo no canvas do story (1080 x 1920). */
export function desenharTextoNativo(ctx: CanvasRenderingContext2D, t: TextoNativo, W: number, H: number) {
  if (!t.texto) return;
  const e = ESTILOS_DO_TEXTO[t.estilo];
  const corpo = W * e.corpo;
  ctx.font = fonteDoEstilo(e, corpo);
  const texto = textoNaCaixa(t);
  const linhas = quebrarEmLinhas(texto, W * LAYOUT_DO_TEXTO_NATIVO.largura, (x) => ctx.measureText(x).width);
  const passo = corpo * e.entrelinha;
  let y = H * LAYOUT_DO_TEXTO_NATIVO.centro[t.posicao] - (passo * linhas.length) / 2 + passo / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of linhas) {
    if (t.caixa) {
      const w = ctx.measureText(l).width + corpo * LAYOUT_DO_TEXTO_NATIVO.folgaDaCaixa * 2;
      ctx.fillStyle = "#ffffff";
      retanguloRedondo(ctx, W / 2 - w / 2, y - passo / 2, w, passo, corpo * 0.18);
      ctx.fill();
      ctx.fillStyle = "#111111";
      ctx.shadowColor = "transparent";
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = corpo * 0.12;
      ctx.shadowOffsetY = corpo * 0.03;
    }
    ctx.fillText(l, W / 2, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    y += passo;
  }
}

/** O adesivo no estilo do app, desenhado no canvas na área reservada (frações de layoutDoStory). */
export function desenharAdesivo(ctx: CanvasRenderingContext2D, a: Adesivo, W: number, H: number, cor: string) {
  const area = areaDoAdesivo(a.tipo);
  if (!area) return;
  const x = W * ((1 - area.largura) / 2);
  const w = W * area.largura;
  const yC = H * area.centroY;
  const u = W / 100;
  const sans = '-apple-system, "Helvetica Neue", Arial, sans-serif';
  const pergunta = (a.pergunta || "").trim();
  const opcoes = (a.opcoes || []).filter((o) => o.trim());
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const caixaBranca = (y: number, h: number) => {
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 3 * u;
    retanguloRedondo(ctx, x, y, w, h, 3 * u);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  };
  if (a.tipo === "enquete" || a.tipo === "quiz") {
    const ops = (opcoes.length ? opcoes : a.tipo === "quiz" ? ["Opção A", "Opção B", "Opção C"] : ["Sim", "Não"]).slice(0, 4);
    const h = 12 * u + ops.length * 9 * u;
    const y = yC - h / 2;
    caixaBranca(y, h);
    ctx.fillStyle = "#111111";
    ctx.font = `700 ${Math.round(4.4 * u)}px ${sans}`;
    ctx.fillText(pergunta || "Sua pergunta", W / 2, y + 6 * u, w - 6 * u);
    ops.forEach((o, i) => {
      const yy = y + 11 * u + i * 9 * u;
      ctx.fillStyle = "#f1f1f1";
      retanguloRedondo(ctx, x + 3 * u, yy, w - 6 * u, 7 * u, 2 * u);
      ctx.fill();
      ctx.fillStyle = cor;
      ctx.font = `700 ${Math.round(4.2 * u)}px ${sans}`;
      ctx.fillText(o, W / 2, yy + 3.5 * u, w - 10 * u);
    });
  } else if (a.tipo === "caixinha") {
    const h = 20 * u;
    const y = yC - h / 2;
    caixaBranca(y, h);
    ctx.fillStyle = cor;
    retanguloRedondo(ctx, x, y, w, 11 * u, 3 * u);
    ctx.fill();
    ctx.fillRect(x, y + 8 * u, w, 3 * u);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(4.4 * u)}px ${sans}`;
    ctx.fillText(pergunta || "Me pergunte algo", W / 2, y + 5.5 * u, w - 6 * u);
    ctx.fillStyle = "#9a9a9a";
    ctx.font = `500 ${Math.round(4 * u)}px ${sans}`;
    ctx.fillText("Escreva algo...", W / 2, y + 15.5 * u);
  } else if (a.tipo === "contagem") {
    const h = 18 * u;
    const y = yC - h / 2;
    ctx.fillStyle = "#141414";
    retanguloRedondo(ctx, x, y, w, h, 3 * u);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(4.2 * u)}px ${sans}`;
    ctx.fillText(pergunta || "Contagem", W / 2, y + 5 * u, w - 6 * u);
    ctx.font = `700 ${Math.round(8 * u)}px ${sans}`;
    ctx.fillText("00 : 00 : 00", W / 2, y + 12 * u);
  } else if (a.tipo === "reacao") {
    const h = 16 * u;
    const y = yC - h / 2;
    caixaBranca(y, h);
    ctx.fillStyle = "#111111";
    ctx.font = `700 ${Math.round(4.4 * u)}px ${sans}`;
    ctx.fillText(pergunta || "O que achou?", W / 2, y + 5 * u, w - 6 * u);
    ctx.fillStyle = "#dddddd";
    retanguloRedondo(ctx, x + 6 * u, y + 11 * u, w - 12 * u, 1.4 * u, u);
    ctx.fill();
    ctx.font = `${Math.round(6 * u)}px sans-serif`;
    ctx.fillText("\u{1F60D}", x + w * 0.58, y + 11.7 * u);
  } else {
    // Link, localização e menção: a pílula branca do app.
    const texto = a.tipo === "link" ? a.texto_do_link || (a.url || "Link").replace(/^https?:\/\//, "") : a.tipo === "mencao" ? `@${(pergunta || "perfil").replace(/^@/, "")}` : pergunta || "Local";
    const prefixo = a.tipo === "link" ? "\u{1F517} " : a.tipo === "localizacao" ? "\u{1F4CD} " : "";
    ctx.font = `700 ${Math.round(4.4 * u)}px ${sans}`;
    const larg = Math.min(w, ctx.measureText(prefixo + texto).width + 8 * u);
    const h = 9 * u;
    ctx.fillStyle = "#ffffff";
    retanguloRedondo(ctx, W / 2 - larg / 2, yC - h / 2, larg, h, 2.4 * u);
    ctx.fill();
    ctx.fillStyle = a.tipo === "link" ? "#0b5cff" : a.tipo === "mencao" ? "#d6249f" : "#8a3ab9";
    ctx.fillText(prefixo + texto, W / 2, yC, larg - 4 * u);
  }
}

async function abrirImagem(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => erro(new Error("O navegador não conseguiu abrir a imagem."));
      img.src = url;
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * O PNG final do story (1080 x 1920): a imagem inteira (foto natural ou arte
 * do Destaque) cobrindo a tela, o texto nativo por cima (só no Natural: no
 * Destaque o texto já está na arte) e, quando pedido, o adesivo desenhado.
 */
export async function montarStoryFinal(o: { imagem: Blob | null; corDeFundo: string; texto: TextoNativo | null; adesivo: Adesivo | null; corDoAdesivo: string }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = TAMANHO_DO_STORY.largura;
  canvas.height = TAMANHO_DO_STORY.altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu montar o story.");
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = o.corDeFundo;
  ctx.fillRect(0, 0, W, H);
  if (o.imagem) {
    const img = await abrirImagem(o.imagem);
    const escala = Math.max(W / img.width, H / img.height);
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);
    ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
  }
  if (o.texto) desenharTextoNativo(ctx, o.texto, W, H);
  if (o.adesivo && o.adesivo.tipo !== "nenhum") desenharAdesivo(ctx, o.adesivo, W, H, o.corDoAdesivo);
  return new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error("O navegador não conseguiu gerar o PNG."))), "image/png"));
}

/** Nome do PNG: a ordem e o horário vêm primeiro ("story-02-14h30-gancho.png"). */
export function nomeDoPngDoStory(s: Pick<Story, "ordem" | "horario" | "titulo" | "texto_na_tela" | "fundo">, hora: string | null): string {
  const n = s.ordem < 10 ? `0${s.ordem}` : String(s.ordem);
  const h = hora ? hora.replace(":", "h") : "sem-hora";
  const base = (s.fundo.papel || s.titulo || s.texto_na_tela.slice(0, 30) || "story")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `story-${n}-${h}-${base || "story"}.png`;
}
