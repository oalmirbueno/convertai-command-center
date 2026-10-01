/**
 * Quadro animado do Canvas (frente CNV, 30/09/2026).
 *
 * O cartão "Quadro" do Canvas é uma composição em camadas (texto, imagem,
 * vídeo, forma e logo) num formato de vídeo (9:16, 4:5, 1:1, 16:9), com
 * animação por camada (entrada, saída e chaves simples de posição, escala,
 * opacidade e rotação). Ele é editado no editor de quadro da tela, montado
 * pela IA a partir de um pedido (a IA escreve o CONTEÚDO e escolhe o modelo;
 * a posição de cada camada sai do código, dos modelos da marca), exportado
 * como imagem e mandado para o render pela Mesa Edição.
 *
 * Tudo em frações do quadro: x e largura sobre a largura, y e altura sobre a
 * altura, tamanho de letra sobre a largura. O mesmo quadro serve à tela (DOM),
 * à exportação (canvas 2D) e à composição do render (Remotion).
 *
 * Puro: sem Deno, sem banco, sem React. A função mesa-foto valida com
 * `normalizarQuadro`; a tela e o render usam `estadoNoTempo`. Sem travessão.
 */

// ------------------------------------------------------------------ formatos e limites

export const FORMATOS_DO_QUADRO: Record<string, { largura: number; altura: number; rotulo: string }> = {
  "9:16": { largura: 1080, altura: 1920, rotulo: "Vertical 9:16 (Reels, Stories)" },
  "4:5": { largura: 1080, altura: 1350, rotulo: "Retrato 4:5 (feed)" },
  "1:1": { largura: 1080, altura: 1080, rotulo: "Quadrado 1:1" },
  "16:9": { largura: 1920, altura: 1080, rotulo: "Horizontal 16:9" },
};
export type FormatoDoQuadro = "9:16" | "4:5" | "1:1" | "16:9";
export const LISTA_DE_FORMATOS_DO_QUADRO: FormatoDoQuadro[] = ["9:16", "4:5", "1:1", "16:9"];

export const MAX_CAMADAS = 40;
export const MAX_CHAVES = 12;
export const MAX_TEXTO_DA_CAMADA = 400;
export const DURACAO_MIN_S = 1;
export const DURACAO_MAX_S = 60;

export const TIPOS_DE_CAMADA = ["texto", "imagem", "video", "forma", "logo"] as const;
export type TipoDeCamada = (typeof TIPOS_DE_CAMADA)[number];

export const FORMAS = ["retangulo", "pilula", "circulo", "linha"] as const;
export type FormaDaCamada = (typeof FORMAS)[number];

/** Famílias livres (OFL) que o painel e o render já carregam (public/editor/fontes). */
export const FONTES_DO_QUADRO: { valor: string; rotulo: string; familia: string }[] = [
  { valor: "montserrat", rotulo: "Montserrat", familia: "Montserrat, Outfit, Inter, sans-serif" },
  { valor: "anton", rotulo: "Anton (impacto)", familia: "Anton, Montserrat, sans-serif" },
  { valor: "figtree", rotulo: "Figtree", familia: "Figtree, Outfit, Inter, sans-serif" },
  { valor: "caveat", rotulo: "Caveat (à mão)", familia: "Caveat, 'Comic Sans MS', cursive" },
];
export const familiaDaFonte = (v: string | null | undefined) => (FONTES_DO_QUADRO.find((f) => f.valor === v) || FONTES_DO_QUADRO[0]).familia;

export const ENTRADAS = ["nenhuma", "aparecer", "subir", "descer", "da_esquerda", "da_direita", "zoom", "pulo", "revelar"] as const;
export type EntradaDaCamada = (typeof ENTRADAS)[number];
export const SAIDAS = ["nenhuma", "sumir", "subir", "descer", "zoom"] as const;
export type SaidaDaCamada = (typeof SAIDAS)[number];

export const ROTULO_DA_ENTRADA: Record<EntradaDaCamada, string> = {
  nenhuma: "Sem entrada",
  aparecer: "Aparecer",
  subir: "Subir",
  descer: "Descer",
  da_esquerda: "Da esquerda",
  da_direita: "Da direita",
  zoom: "Zoom",
  pulo: "Pulo",
  revelar: "Revelar",
};
export const ROTULO_DA_SAIDA: Record<SaidaDaCamada, string> = { nenhuma: "Sem saída", sumir: "Sumir", subir: "Subir", descer: "Descer", zoom: "Zoom" };

// ------------------------------------------------------------------ tipos

export interface ChaveDaCamada {
  /** Segundos desde o começo do quadro. */
  t: number;
  x?: number;
  y?: number;
  escala?: number;
  opacidade?: number;
  rotacao?: number;
}

export interface MidiaDaCamada {
  bucket: string;
  caminho: string;
  nome: string;
  imagem_id: string | null;
  arquivo_id: string | null;
}

export interface CamadaDoQuadro {
  id: string;
  tipo: TipoDeCamada;
  nome: string;
  x: number;
  y: number;
  l: number;
  a: number;
  rotacao: number;
  opacidade: number;
  visivel: boolean;
  travada: boolean;
  grupo: string | null;
  inicio_s: number;
  fim_s: number;
  entrada: EntradaDaCamada;
  entrada_s: number;
  saida: SaidaDaCamada;
  saida_s: number;
  chaves: ChaveDaCamada[];
  // texto
  texto: string;
  fonte: string;
  peso: number;
  tamanho: number;
  cor: string;
  fundo: string | null;
  alinhamento: "esquerda" | "centro" | "direita";
  maiusculas: boolean;
  sombra: boolean;
  // mídia
  midia: MidiaDaCamada | null;
  ajuste: "cobrir" | "conter";
  canto: number;
  // forma
  forma: FormaDaCamada;
  borda_cor: string | null;
  borda: number;
}

export interface MarcaDoQuadro {
  nome: string;
  primaria: string;
  apoio: string;
  fundo: string;
  texto: string;
  claro: string;
  logo: MidiaDaCamada | null;
}

export interface QuadroAnimado {
  versao: 1;
  formato: FormatoDoQuadro;
  duracao_s: number;
  fundo: string;
  camadas: CamadaDoQuadro[];
  /** Modelo da marca que montou o quadro (null = feito à mão). */
  modelo: string | null;
}

// ------------------------------------------------------------------ leitura

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ID_DA_CAMADA = /^[A-Za-z0-9_-]{1,40}$/;
const CAMINHO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\u0000-\u001f]{1,400}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || typeof v === "boolean" || !isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
};
const cor = (v: unknown, padrao: string): string => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : padrao);
const corOuNulo = (v: unknown): string | null => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);
const umDe = <T extends string>(lista: readonly T[], v: unknown, padrao: T): T => ((lista as readonly string[]).indexOf(String(v)) >= 0 ? (String(v) as T) : padrao);
const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r/g, "").slice(0, max) : typeof v === "number" ? String(v) : "");
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function lerMidia(v: unknown): MidiaDaCamada | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const caminho = typeof o.caminho === "string" ? o.caminho.trim() : "";
  if (!caminho || caminho.indexOf("..") >= 0 || !CAMINHO.test(caminho)) return null;
  const bucket = o.bucket === "files" ? "files" : "mesa";
  return {
    bucket,
    caminho,
    nome: texto(o.nome, 120).trim() || caminho.split("/").pop() || "mídia",
    imagem_id: typeof o.imagem_id === "string" && UUID.test(o.imagem_id) ? o.imagem_id : null,
    arquivo_id: typeof o.arquivo_id === "string" && UUID.test(o.arquivo_id) ? o.arquivo_id : null,
  };
}

function lerChave(v: unknown, duracao: number): ChaveDaCamada | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const c: ChaveDaCamada = { t: r4(num(o.t, 0, 0, duracao)) };
  if (o.x !== undefined && o.x !== null) c.x = r4(num(o.x, 0, -2, 3));
  if (o.y !== undefined && o.y !== null) c.y = r4(num(o.y, 0, -2, 3));
  if (o.escala !== undefined && o.escala !== null) c.escala = r4(num(o.escala, 1, 0, 8));
  if (o.opacidade !== undefined && o.opacidade !== null) c.opacidade = r4(num(o.opacidade, 1, 0, 1));
  if (o.rotacao !== undefined && o.rotacao !== null) c.rotacao = r4(num(o.rotacao, 0, -720, 720));
  return c;
}

/** Camada só com os campos conhecidos e dentro dos limites. */
export function lerCamada(v: unknown, duracao: number, i = 0): CamadaDoQuadro | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const tipo = umDe(TIPOS_DE_CAMADA, o.tipo, "texto");
  const id = typeof o.id === "string" && ID_DA_CAMADA.test(o.id) ? o.id : `c${i + 1}`;
  const midia = tipo === "imagem" || tipo === "video" || tipo === "logo" ? lerMidia(o.midia) : null;
  const inicio = r4(num(o.inicio_s, 0, 0, duracao));
  const chaves: ChaveDaCamada[] = [];
  (Array.isArray(o.chaves) ? o.chaves : []).forEach((x) => {
    const c = lerChave(x, duracao);
    if (c && chaves.length < MAX_CHAVES) chaves.push(c);
  });
  chaves.sort((a, b) => a.t - b.t);
  const padraoTexto = tipo === "texto" ? "Texto" : "";
  return {
    id,
    tipo,
    nome: texto(o.nome, 60).trim() || nomePadrao(tipo, i),
    x: r4(num(o.x, 0.1, -2, 3)),
    y: r4(num(o.y, 0.1, -2, 3)),
    l: r4(num(o.l, 0.8, 0.005, 4)),
    a: r4(num(o.a, 0.1, 0.002, 4)),
    rotacao: r4(num(o.rotacao, 0, -360, 360)),
    opacidade: r4(num(o.opacidade, 1, 0, 1)),
    visivel: o.visivel !== false,
    travada: o.travada === true,
    grupo: typeof o.grupo === "string" && ID_DA_CAMADA.test(o.grupo) ? o.grupo : null,
    inicio_s: inicio,
    fim_s: r4(Math.max(inicio + 0.1, num(o.fim_s, duracao, 0, duracao))),
    entrada: umDe(ENTRADAS, o.entrada, "nenhuma"),
    entrada_s: r4(num(o.entrada_s, 0.6, 0.1, 5)),
    saida: umDe(SAIDAS, o.saida, "nenhuma"),
    saida_s: r4(num(o.saida_s, 0.5, 0.1, 5)),
    chaves,
    texto: tipo === "texto" ? texto(o.texto, MAX_TEXTO_DA_CAMADA) || padraoTexto : "",
    fonte: FONTES_DO_QUADRO.some((f) => f.valor === o.fonte) ? String(o.fonte) : "montserrat",
    peso: Math.round(num(o.peso, 700, 300, 900) / 100) * 100,
    tamanho: r4(num(o.tamanho, 0.06, 0.01, 0.4)),
    cor: cor(o.cor, tipo === "forma" ? "#00ff66" : "#ffffff"),
    fundo: corOuNulo(o.fundo),
    alinhamento: o.alinhamento === "esquerda" || o.alinhamento === "direita" ? o.alinhamento : "centro",
    maiusculas: o.maiusculas === true,
    sombra: o.sombra === true,
    midia,
    ajuste: o.ajuste === "conter" ? "conter" : "cobrir",
    canto: r4(num(o.canto, 0, 0, 0.5)),
    forma: umDe(FORMAS, o.forma, "retangulo"),
    borda_cor: corOuNulo(o.borda_cor),
    borda: r4(num(o.borda, 0, 0, 0.05)),
  };
}

export function nomePadrao(tipo: TipoDeCamada, i: number): string {
  const r: Record<TipoDeCamada, string> = { texto: "Texto", imagem: "Imagem", video: "Vídeo", forma: "Forma", logo: "Logo" };
  return `${r[tipo]} ${i + 1}`;
}

/** Quadro vazio no formato pedido. */
export function quadroVazio(formato: FormatoDoQuadro = "9:16", fundo = "#0b0b0c"): QuadroAnimado {
  return { versao: 1, formato, duracao_s: 6, fundo, camadas: [], modelo: null };
}

/** Quadro vindo da tela ou do banco, validado (a função grava sempre esta forma). */
export function normalizarQuadro(bruto: unknown): QuadroAnimado {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const formato = umDe(LISTA_DE_FORMATOS_DO_QUADRO, o.formato, "9:16");
  const duracao = r4(num(o.duracao_s, 6, DURACAO_MIN_S, DURACAO_MAX_S));
  const camadas: CamadaDoQuadro[] = [];
  const vistos: Record<string, boolean> = {};
  (Array.isArray(o.camadas) ? o.camadas : []).slice(0, MAX_CAMADAS).forEach((x, i) => {
    const c = lerCamada(x, duracao, i);
    if (!c) return;
    let id = c.id;
    let n = 2;
    while (vistos[id]) id = `${c.id}_${n++}`.slice(0, 40);
    vistos[id] = true;
    camadas.push({ ...c, id });
  });
  return { versao: 1, formato, duracao_s: duracao, fundo: cor(o.fundo, "#0b0b0c"), camadas, modelo: typeof o.modelo === "string" && /^[a-z0-9_-]{1,40}$/.test(o.modelo) ? o.modelo : null };
}

/** Caminhos de mídia que o quadro cita (a função confere que são do cliente). */
export function caminhosDoQuadro(q: QuadroAnimado): string[] {
  return q.camadas.filter((c) => !!c.midia).map((c) => (c.midia as MidiaDaCamada).caminho);
}

// ------------------------------------------------------------------ tempo e animação

const suave = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const saidaSuave = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) * (1 - Math.min(1, Math.max(0, t)));
/** Pulo: passa um pouco do tamanho e volta (sem mola, conta fechada: o render bate com a tela). */
const pulo = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.7 ? suave(x / 0.7) * 1.08 : 1.08 - 0.08 * suave((x - 0.7) / 0.3);
};

export interface EstadoDaCamada {
  visivel: boolean;
  x: number;
  y: number;
  escala: number;
  opacidade: number;
  rotacao: number;
  /** Revelar: fração visível da largura (1 = toda). */
  recorte: number;
}

function valorDasChaves(chaves: ChaveDaCamada[], campo: keyof Omit<ChaveDaCamada, "t">, t: number, base: number): number {
  const com = chaves.filter((c) => typeof c[campo] === "number");
  if (!com.length) return base;
  if (t <= com[0].t) return com[0][campo] as number;
  const ultima = com[com.length - 1];
  if (t >= ultima.t) return ultima[campo] as number;
  for (let i = 0; i < com.length - 1; i++) {
    const a = com[i];
    const b = com[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = b.t === a.t ? 1 : suave((t - a.t) / (b.t - a.t));
      return (a[campo] as number) + ((b[campo] as number) - (a[campo] as number)) * k;
    }
  }
  return base;
}

/**
 * Onde a camada está no tempo t (segundos do quadro): posição e escala das
 * chaves (a base vale sem chave), multiplicadas pela entrada e pela saída.
 * Determinístico (mesmo t, mesmo estado): a tela, a exportação e o render batem.
 */
export function estadoNoTempo(c: CamadaDoQuadro, t: number): EstadoDaCamada {
  const dentro = c.visivel && t >= c.inicio_s - 1e-6 && t <= c.fim_s + 1e-6;
  let x = valorDasChaves(c.chaves, "x", t, c.x);
  let y = valorDasChaves(c.chaves, "y", t, c.y);
  let escala = valorDasChaves(c.chaves, "escala", t, 1);
  let opacidade = valorDasChaves(c.chaves, "opacidade", t, c.opacidade);
  const rotacao = valorDasChaves(c.chaves, "rotacao", t, c.rotacao);
  let recorte = 1;
  const local = t - c.inicio_s;
  if (c.entrada !== "nenhuma" && local < c.entrada_s) {
    const k = saidaSuave(local / c.entrada_s);
    if (c.entrada === "aparecer") opacidade *= k;
    if (c.entrada === "subir") {
      y += (1 - k) * 0.06;
      opacidade *= k;
    }
    if (c.entrada === "descer") {
      y -= (1 - k) * 0.06;
      opacidade *= k;
    }
    if (c.entrada === "da_esquerda") {
      x -= (1 - k) * 0.25;
      opacidade *= k;
    }
    if (c.entrada === "da_direita") {
      x += (1 - k) * 0.25;
      opacidade *= k;
    }
    if (c.entrada === "zoom") {
      escala *= 0.6 + 0.4 * k;
      opacidade *= k;
    }
    if (c.entrada === "pulo") {
      escala *= Math.max(0.001, pulo(local / c.entrada_s));
      opacidade *= Math.min(1, k * 2);
    }
    if (c.entrada === "revelar") recorte = k;
  }
  const falta = c.fim_s - t;
  if (c.saida !== "nenhuma" && falta < c.saida_s) {
    const k = saidaSuave(falta / c.saida_s);
    opacidade *= k;
    if (c.saida === "subir") y -= (1 - k) * 0.06;
    if (c.saida === "descer") y += (1 - k) * 0.06;
    if (c.saida === "zoom") escala *= 1 + (1 - k) * 0.25;
  }
  return { visivel: dentro && opacidade > 0.001, x, y, escala, opacidade: Math.min(1, Math.max(0, opacidade)), rotacao, recorte };
}

/** Grava (ou troca) a chave da camada no tempo t com os valores dados. */
export function porChave(c: CamadaDoQuadro, t: number, valores: Omit<ChaveDaCamada, "t">): CamadaDoQuadro {
  const tt = r4(Math.max(0, t));
  const outras = c.chaves.filter((k) => Math.abs(k.t - tt) > 0.02);
  const atual = c.chaves.find((k) => Math.abs(k.t - tt) <= 0.02) || { t: tt };
  const nova = { ...atual, ...valores, t: tt };
  const chaves = outras.concat([nova]).sort((a, b) => a.t - b.t).slice(0, MAX_CHAVES);
  return { ...c, chaves };
}

export const tirarChave = (c: CamadaDoQuadro, t: number): CamadaDoQuadro => ({ ...c, chaves: c.chaves.filter((k) => Math.abs(k.t - t) > 0.02) });

/** Movimentos prontos por chaves (Ken Burns, flutuar, pulsar): escolha rápida no inspetor. */
export const MOVIMENTOS_PRONTOS: { valor: string; rotulo: string }[] = [
  { valor: "nenhum", rotulo: "Sem movimento" },
  { valor: "aproximar", rotulo: "Aproximar devagar (Ken Burns)" },
  { valor: "afastar", rotulo: "Afastar devagar" },
  { valor: "flutuar", rotulo: "Flutuar" },
  { valor: "pulsar", rotulo: "Pulsar" },
  { valor: "deslizar", rotulo: "Deslizar de lado" },
];

export function aplicarMovimentoPronto(c: CamadaDoQuadro, valor: string): CamadaDoQuadro {
  const i = c.inicio_s;
  const f = c.fim_s;
  const meio = r4((i + f) / 2);
  switch (valor) {
    case "aproximar":
      return { ...c, chaves: [{ t: i, escala: 1 }, { t: f, escala: 1.12 }] };
    case "afastar":
      return { ...c, chaves: [{ t: i, escala: 1.12 }, { t: f, escala: 1 }] };
    case "flutuar":
      return { ...c, chaves: [{ t: i, y: c.y }, { t: meio, y: r4(c.y - 0.012) }, { t: f, y: c.y }] };
    case "pulsar": {
      const chaves: ChaveDaCamada[] = [];
      const passo = Math.max(0.5, (f - i) / 6);
      for (let t = i, k = 0; t <= f + 1e-6 && chaves.length < MAX_CHAVES; t += passo, k++) chaves.push({ t: r4(t), escala: k % 2 ? 1.05 : 1 });
      return { ...c, chaves };
    }
    case "deslizar":
      return { ...c, chaves: [{ t: i, x: r4(c.x - 0.03) }, { t: f, x: r4(c.x + 0.03) }] };
    default:
      return { ...c, chaves: [] };
  }
}

// ------------------------------------------------------------------ alinhar, distribuir, guias

export type Alinhamento = "esquerda" | "centro_h" | "direita" | "topo" | "meio" | "base";

interface Caixa {
  x: number;
  y: number;
  l: number;
  a: number;
}

export function caixaDe(camadas: Pick<CamadaDoQuadro, "x" | "y" | "l" | "a">[]): Caixa {
  if (!camadas.length) return { x: 0, y: 0, l: 1, a: 1 };
  const x0 = Math.min.apply(null, camadas.map((c) => c.x));
  const y0 = Math.min.apply(null, camadas.map((c) => c.y));
  const x1 = Math.max.apply(null, camadas.map((c) => c.x + c.l));
  const y1 = Math.max.apply(null, camadas.map((c) => c.y + c.a));
  return { x: x0, y: y0, l: x1 - x0, a: y1 - y0 };
}

/**
 * Alinha as camadas escolhidas. Uma camada só: em relação ao quadro. Várias:
 * em relação à caixa que junta todas (como nos editores de design).
 */
export function alinhar(camadas: CamadaDoQuadro[], ids: string[], como: Alinhamento): CamadaDoQuadro[] {
  const alvo = camadas.filter((c) => ids.indexOf(c.id) >= 0 && !c.travada);
  if (!alvo.length) return camadas;
  const ref: Caixa = alvo.length === 1 ? { x: 0, y: 0, l: 1, a: 1 } : caixaDe(alvo);
  return camadas.map((c) => {
    if (alvo.indexOf(c) < 0) return c;
    if (como === "esquerda") return { ...c, x: r4(ref.x) };
    if (como === "centro_h") return { ...c, x: r4(ref.x + ref.l / 2 - c.l / 2) };
    if (como === "direita") return { ...c, x: r4(ref.x + ref.l - c.l) };
    if (como === "topo") return { ...c, y: r4(ref.y) };
    if (como === "meio") return { ...c, y: r4(ref.y + ref.a / 2 - c.a / 2) };
    return { ...c, y: r4(ref.y + ref.a - c.a) };
  });
}

/** Distribui 3 ou mais camadas com o mesmo espaço entre elas (horizontal ou vertical). */
export function distribuir(camadas: CamadaDoQuadro[], ids: string[], eixo: "h" | "v"): CamadaDoQuadro[] {
  const alvo = camadas.filter((c) => ids.indexOf(c.id) >= 0 && !c.travada);
  if (alvo.length < 3) return camadas;
  const ordem = alvo.slice().sort((a, b) => (eixo === "h" ? a.x - b.x : a.y - b.y));
  const total = ordem.reduce((s, c) => s + (eixo === "h" ? c.l : c.a), 0);
  const caixa = caixaDe(ordem);
  const vao = ((eixo === "h" ? caixa.l : caixa.a) - total) / (ordem.length - 1);
  const pos: Record<string, number> = {};
  let atual = eixo === "h" ? caixa.x : caixa.y;
  ordem.forEach((c) => {
    pos[c.id] = r4(atual);
    atual += (eixo === "h" ? c.l : c.a) + vao;
  });
  return camadas.map((c) => (pos[c.id] === undefined ? c : eixo === "h" ? { ...c, x: pos[c.id] } : { ...c, y: pos[c.id] }));
}

export interface Guia {
  eixo: "v" | "h";
  /** Posição da linha (fração do quadro). */
  pos: number;
}

/**
 * Encaixe ao arrastar: a caixa que se move gruda no centro e nas bordas do
 * quadro, na margem de segurança (6%) e nas bordas e centros das outras
 * camadas, quando chega a menos de `limite`. Devolve a posição encaixada e as
 * guias a desenhar.
 */
export function encaixar(movendo: Caixa, outras: Caixa[], limite = 0.012): { x: number; y: number; guias: Guia[] } {
  const verticais = [0, 0.06, 0.5, 0.94, 1];
  const horizontais = [0, 0.06, 0.5, 0.94, 1];
  outras.forEach((o) => {
    verticais.push(o.x, o.x + o.l / 2, o.x + o.l);
    horizontais.push(o.y, o.y + o.a / 2, o.y + o.a);
  });
  const melhor = (pontos: number[], linhas: number[]) => {
    let achado: { delta: number; linha: number } | null = null;
    pontos.forEach((p) => {
      linhas.forEach((l) => {
        const d = l - p;
        if (Math.abs(d) <= limite && (!achado || Math.abs(d) < Math.abs(achado.delta))) achado = { delta: d, linha: l };
      });
    });
    return achado as { delta: number; linha: number } | null;
  };
  const mx = melhor([movendo.x, movendo.x + movendo.l / 2, movendo.x + movendo.l], verticais);
  const my = melhor([movendo.y, movendo.y + movendo.a / 2, movendo.y + movendo.a], horizontais);
  const guias: Guia[] = [];
  if (mx) guias.push({ eixo: "v", pos: r4(mx.linha) });
  if (my) guias.push({ eixo: "h", pos: r4(my.linha) });
  return { x: r4(movendo.x + (mx ? mx.delta : 0)), y: r4(movendo.y + (my ? my.delta : 0)), guias };
}

// ------------------------------------------------------------------ grupos e ordem

export function idsDoGrupo(camadas: CamadaDoQuadro[], id: string): string[] {
  const c = camadas.find((x) => x.id === id);
  if (!c || !c.grupo) return c ? [c.id] : [];
  return camadas.filter((x) => x.grupo === c.grupo).map((x) => x.id);
}

export function agrupar(camadas: CamadaDoQuadro[], ids: string[], grupo: string): CamadaDoQuadro[] {
  if (ids.length < 2) return camadas;
  return camadas.map((c) => (ids.indexOf(c.id) >= 0 ? { ...c, grupo } : c));
}

export function desagrupar(camadas: CamadaDoQuadro[], ids: string[]): CamadaDoQuadro[] {
  const grupos = camadas.filter((c) => ids.indexOf(c.id) >= 0 && c.grupo).map((c) => c.grupo);
  return camadas.map((c) => (c.grupo && grupos.indexOf(c.grupo) >= 0 ? { ...c, grupo: null } : c));
}

/** Move a camada na pilha: "frente" e "fundo" vão para a ponta; "subir" e "descer" andam um. A última da lista fica na frente. */
export function mudarOrdem(camadas: CamadaDoQuadro[], id: string, como: "frente" | "fundo" | "subir" | "descer"): CamadaDoQuadro[] {
  const i = camadas.findIndex((c) => c.id === id);
  if (i < 0) return camadas;
  const lista = camadas.slice();
  const [c] = lista.splice(i, 1);
  const destino = como === "frente" ? lista.length : como === "fundo" ? 0 : como === "subir" ? Math.min(lista.length, i + 1) : Math.max(0, i - 1);
  lista.splice(destino, 0, c);
  return lista;
}

let contador = 0;
export function novoIdDaCamada(prefixo = "c"): string {
  contador += 1;
  return `${prefixo}${Date.now().toString(36).slice(-5)}${contador.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 40);
}

/** Camada nova com os padrões do tipo (no meio do quadro). */
export function novaCamada(tipo: TipoDeCamada, q: Pick<QuadroAnimado, "duracao_s" | "camadas">, extra: Partial<CamadaDoQuadro> = {}): CamadaDoQuadro {
  const base = lerCamada({ tipo, id: novoIdDaCamada(), fim_s: q.duracao_s }, q.duracao_s, q.camadas.length) as CamadaDoQuadro;
  const porTipo: Partial<CamadaDoQuadro> =
    tipo === "texto"
      ? { x: 0.08, y: 0.42, l: 0.84, a: 0.1, texto: "Seu texto aqui", tamanho: 0.07, entrada: "subir" }
      : tipo === "forma"
      ? { x: 0.3, y: 0.4, l: 0.4, a: 0.12, cor: "#00ff66", forma: "pilula" }
      : tipo === "logo"
      ? { x: 0.35, y: 0.84, l: 0.3, a: 0.08, ajuste: "conter", entrada: "aparecer" }
      : { x: 0, y: 0, l: 1, a: 1, ajuste: "cobrir" };
  return { ...base, ...porTipo, ...extra };
}

export function duplicarCamadas(camadas: CamadaDoQuadro[], ids: string[]): { camadas: CamadaDoQuadro[]; novos: string[] } {
  const novos: string[] = [];
  const grupoNovo: Record<string, string> = {};
  let lista = camadas.slice();
  camadas.forEach((c) => {
    if (ids.indexOf(c.id) < 0 || lista.length >= MAX_CAMADAS) return;
    const id = novoIdDaCamada();
    let grupo = c.grupo;
    if (grupo) grupo = grupoNovo[grupo] || (grupoNovo[grupo] = novoIdDaCamada("g"));
    novos.push(id);
    lista = lista.concat([{ ...c, id, grupo, nome: `${c.nome} (cópia)`.slice(0, 60), x: r4(c.x + 0.03), y: r4(c.y + 0.03), travada: false }]);
  });
  return { camadas: lista, novos };
}

// ------------------------------------------------------------------ marca

const clarear = (hex: string): number => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
export const ehEscura = (hex: string) => clarear(hex) < 0.55;
/** Cor de texto legível sobre um fundo. */
export const textoSobre = (fundo: string) => (ehEscura(fundo) ? "#ffffff" : "#111111");

/**
 * Cores do quadro a partir da paleta da marca (papel "primaria", "fundo",
 * "texto", "apoio"; sem papel, pela ordem). Sem paleta: o verde da casa.
 */
export function marcaDoQuadro(e: { nome?: string | null; paleta?: { hex?: string; papel?: string }[] | null; logo?: MidiaDaCamada | null }): MarcaDoQuadro {
  const paleta = (e.paleta || []).filter((p) => p && typeof p.hex === "string" && HEX.test(p.hex.trim())).map((p) => ({ hex: (p.hex as string).trim().toLowerCase(), papel: String(p.papel || "").toLowerCase() }));
  const doPapel = (re: RegExp) => (paleta.find((p) => re.test(p.papel)) || { hex: "" }).hex;
  const primaria = doPapel(/prim|princ|destaque|marca/) || (paleta[0] && paleta[0].hex) || "#00ff66";
  const fundo = doPapel(/fundo|base|escur/) || (paleta.find((p) => p.hex !== primaria && ehEscura(p.hex)) || { hex: "#0b0b0c" }).hex;
  const apoio = doPapel(/apoio|secund|acento/) || (paleta.find((p) => p.hex !== primaria && p.hex !== fundo) || { hex: "#d8ffe6" }).hex;
  const claro = (paleta.find((p) => !ehEscura(p.hex) && p.hex !== primaria) || { hex: "#f5f5f4" }).hex;
  return { nome: String(e.nome || "").slice(0, 80), primaria, apoio, fundo, texto: textoSobre(fundo), claro, logo: e.logo || null };
}

// ------------------------------------------------------------------ modelos da marca (layouts)

/** Conteúdo que a IA (ou a pessoa) dá; o modelo decide onde cada coisa fica. */
export interface ConteudoDoQuadro {
  titulo: string;
  subtitulo: string;
  cta: string;
  selo: string;
  topicos: string[];
  midias: MidiaDaCamada[];
}

export interface ModeloDoQuadro {
  id: string;
  rotulo: string;
  descricao: string;
  /** Precisa de mídia (foto ou vídeo) para ficar bom. */
  pedeMidia: boolean;
}

export const MODELOS_DO_QUADRO: ModeloDoQuadro[] = [
  { id: "capa_cheia", rotulo: "Capa com foto cheia", descricao: "Foto ou vídeo ocupando o quadro todo, degradê escuro embaixo, título grande na base e chamada pequena por cima.", pedeMidia: true },
  { id: "produto_central", rotulo: "Produto no centro", descricao: "Fundo na cor da marca, produto grande no meio, título no topo e botão de chamada embaixo.", pedeMidia: true },
  { id: "titulo_forte", rotulo: "Título de impacto", descricao: "Só tipografia: fundo liso da marca, título enorme centralizado, subtítulo menor e selo no topo.", pedeMidia: false },
  { id: "lista_tres", rotulo: "Lista de três", descricao: "Título no topo e três tópicos numerados que entram um por vez, com a logo no pé.", pedeMidia: false },
  { id: "meio_a_meio", rotulo: "Metade foto, metade texto", descricao: "Foto na metade de cima e bloco de texto na metade de baixo, com a chamada destacada.", pedeMidia: true },
  { id: "depoimento", rotulo: "Depoimento", descricao: "Aspas grandes, a frase em destaque no meio e o nome embaixo, sobre fundo escuro da marca.", pedeMidia: false },
  { id: "chamada_final", rotulo: "Chamada final", descricao: "Logo no centro, chamada para ação em botão e subtítulo curto: bom para o último quadro.", pedeMidia: false },
  { id: "antes_depois", rotulo: "Antes e depois", descricao: "Duas mídias lado a lado com os rótulos Antes e Depois e o título por cima.", pedeMidia: true },
];

export const modeloPorId = (id: string | null | undefined) => MODELOS_DO_QUADRO.find((m) => m.id === id) || null;

type Parcial = Partial<CamadaDoQuadro> & { tipo: TipoDeCamada };

function montar(q: Pick<QuadroAnimado, "duracao_s">, partes: Parcial[]): CamadaDoQuadro[] {
  const saida: CamadaDoQuadro[] = [];
  partes.forEach((p, i) => {
    const c = lerCamada({ ...p, id: p.id || novoIdDaCamada(), fim_s: p.fim_s === undefined ? q.duracao_s : p.fim_s }, q.duracao_s, i);
    if (c) saida.push({ ...c, midia: p.midia !== undefined ? p.midia : c.midia });
  });
  return saida.slice(0, MAX_CAMADAS);
}

const midiaDe = (m: MidiaDaCamada | undefined, tipo: "imagem" | "video" = "imagem"): Parcial | null =>
  m ? { tipo: /\.(mp4|mov|webm|m4v)$/i.test(m.caminho) ? "video" : tipo, midia: m, nome: m.nome.slice(0, 60) } : null;

/** Altura aproximada do texto (fração da altura do quadro) para caber em N linhas. */
function alturaDoTexto(txt: string, tamanho: number, largura: number, proporcao: number): number {
  const porLinha = Math.max(6, Math.floor(largura / (tamanho * 0.55)));
  const linhas = Math.max(1, Math.ceil(txt.length / porLinha));
  return Math.min(0.6, (linhas * tamanho * 1.18 * proporcao) + 0.01);
}

/**
 * Monta as camadas de um modelo da marca com o conteúdo dado. A posição, o
 * tamanho e a animação de cada camada saem daqui (código), nunca da IA.
 */
export function aplicarModelo(modeloId: string, conteudo: ConteudoDoQuadro, marca: MarcaDoQuadro, formato: FormatoDoQuadro, duracao_s: number, animacao: "suave" | "dinamica" | "elegante" = "suave"): QuadroAnimado {
  const f = FORMATOS_DO_QUADRO[formato];
  const proporcao = f.largura / f.altura; // tamanho de letra é fração da largura; altura em fração da altura
  const vertical = formato === "9:16";
  const largo = formato === "16:9";
  const q = { duracao_s };
  const ent = (tipo: EntradaDaCamada, atraso: number): Partial<CamadaDoQuadro> => ({ entrada: animacao === "elegante" && tipo !== "nenhuma" ? "aparecer" : animacao === "dinamica" && tipo === "subir" ? "pulo" : tipo, inicio_s: Math.min(duracao_s - 0.5, atraso), entrada_s: animacao === "dinamica" ? 0.45 : animacao === "elegante" ? 0.9 : 0.6 });
  const titulo = conteudo.titulo.trim() || marca.nome || "Título";
  const sub = conteudo.subtitulo.trim();
  const cta = conteudo.cta.trim();
  const selo = conteudo.selo.trim();
  const m1 = conteudo.midias[0];
  const m2 = conteudo.midias[1];
  const tt = largo ? 0.055 : vertical ? 0.095 : 0.08;
  const partes: Parcial[] = [];
  const logo = marca.logo ? { tipo: "logo" as const, midia: marca.logo, nome: "Logo", ajuste: "conter" as const } : null;
  const botao = (y: number): Parcial[] =>
    cta
      ? [
          { tipo: "forma", nome: "Botão", forma: "pilula", cor: marca.primaria, x: largo ? 0.36 : 0.2, y, l: largo ? 0.28 : 0.6, a: largo ? 0.1 : vertical ? 0.06 : 0.08, ...ent("zoom", 0.9), grupo: "botao" },
          { tipo: "texto", nome: "Chamada", texto: cta, cor: textoSobre(marca.primaria), tamanho: largo ? 0.025 : 0.045, peso: 800, x: largo ? 0.36 : 0.2, y: y + (largo ? 0.025 : vertical ? 0.014 : 0.02), l: largo ? 0.28 : 0.6, a: largo ? 0.05 : vertical ? 0.035 : 0.045, ...ent("zoom", 0.9), grupo: "botao" },
        ]
      : [];
  switch (modeloId) {
    case "capa_cheia": {
      const m = midiaDe(m1);
      if (m) partes.push({ ...m, x: 0, y: 0, l: 1, a: 1, ajuste: "cobrir", chaves: [{ t: 0, escala: 1 }, { t: duracao_s, escala: 1.08 }] });
      partes.push({ tipo: "forma", nome: "Degradê", forma: "retangulo", cor: "#000000", opacidade: 0.55, x: 0, y: 0.55, l: 1, a: 0.45 });
      if (selo) partes.push({ tipo: "texto", nome: "Selo", texto: selo, cor: textoSobre(marca.primaria), fundo: marca.primaria, tamanho: largo ? 0.02 : 0.035, peso: 800, maiusculas: true, x: 0.08, y: 0.6, l: largo ? 0.3 : 0.5, a: 0.04, alinhamento: "esquerda", ...ent("da_esquerda", 0.2) });
      const ht = alturaDoTexto(titulo, tt, 0.84, proporcao);
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "anton", peso: 400, tamanho: tt, cor: "#ffffff", sombra: true, x: 0.08, y: Math.max(0.62, 0.9 - ht - (sub ? 0.06 : 0)), l: 0.84, a: ht, alinhamento: "esquerda", ...ent("subir", 0.35) });
      if (sub) partes.push({ tipo: "texto", nome: "Subtítulo", texto: sub, fonte: "figtree", peso: 500, tamanho: largo ? 0.022 : 0.04, cor: "#f4f4f5", x: 0.08, y: 0.9, l: 0.84, a: 0.05, alinhamento: "esquerda", ...ent("aparecer", 0.7) });
      break;
    }
    case "produto_central": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.fundo, x: 0, y: 0, l: 1, a: 1 });
      // Círculo e produto: 16:9 (largo), 9:16 (vertical) ou 1:1 e 4:5 (menores, para caber o texto embaixo).
      const circulo = largo ? { x: 0.3, y: 0.1, l: 0.4 } : vertical ? { x: 0.1, y: 0.22, l: 0.8 } : { x: 0.2, y: 0.13, l: 0.6 };
      const produto = largo ? { x: 0.32, y: 0.14, l: 0.36 } : vertical ? { x: 0.12, y: 0.26, l: 0.76 } : { x: 0.25, y: 0.18, l: 0.5 };
      partes.push({ tipo: "forma", nome: "Círculo", forma: "circulo", cor: marca.primaria, opacidade: 0.18, ...circulo, a: circulo.l * proporcao, ...ent("zoom", 0) });
      const m = midiaDe(m1);
      if (m) partes.push({ ...m, ajuste: "conter", ...produto, a: produto.l * proporcao, ...ent("pulo", 0.25), chaves: [] });
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "montserrat", peso: 900, tamanho: tt * 0.8, cor: marca.texto, x: 0.06, y: vertical ? 0.07 : 0.05, l: 0.88, a: alturaDoTexto(titulo, tt * 0.8, 0.88, proporcao), ...ent("descer", 0.1) });
      if (sub) partes.push({ tipo: "texto", nome: "Subtítulo", texto: sub, fonte: "figtree", peso: 500, tamanho: largo ? 0.022 : 0.038, cor: marca.texto, opacidade: 0.85, x: 0.1, y: vertical ? 0.72 : 0.74, l: 0.8, a: 0.06, ...ent("aparecer", 0.6) });
      partes.push(...botao(vertical ? 0.82 : 0.85));
      break;
    }
    case "titulo_forte": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.primaria, x: 0, y: 0, l: 1, a: 1 });
      if (selo) partes.push({ tipo: "texto", nome: "Selo", texto: selo, cor: marca.primaria, fundo: textoSobre(marca.primaria), tamanho: largo ? 0.02 : 0.035, peso: 800, maiusculas: true, x: 0.25, y: 0.14, l: 0.5, a: 0.045, ...ent("descer", 0.1) });
      const ht = alturaDoTexto(titulo, tt * 1.25, 0.86, proporcao);
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "anton", peso: 400, tamanho: tt * 1.25, cor: textoSobre(marca.primaria), maiusculas: true, x: 0.07, y: 0.5 - ht / 2 - 0.03, l: 0.86, a: ht, ...ent("pulo", 0.3) });
      if (sub) partes.push({ tipo: "texto", nome: "Subtítulo", texto: sub, fonte: "figtree", peso: 600, tamanho: largo ? 0.024 : 0.042, cor: textoSobre(marca.primaria), x: 0.1, y: 0.5 + ht / 2, l: 0.8, a: 0.07, ...ent("subir", 0.8) });
      if (logo) partes.push({ ...logo, x: 0.38, y: 0.86, l: 0.24, a: 0.06, ...ent("aparecer", 1.1) });
      break;
    }
    case "lista_tres": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.fundo, x: 0, y: 0, l: 1, a: 1 });
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "montserrat", peso: 900, tamanho: tt * 0.8, cor: marca.texto, x: 0.07, y: 0.08, l: 0.86, a: alturaDoTexto(titulo, tt * 0.8, 0.86, proporcao), alinhamento: "esquerda", ...ent("descer", 0.1) });
      const topicos = (conteudo.topicos.length ? conteudo.topicos : [sub, cta].filter(Boolean)).slice(0, 3);
      topicos.forEach((t, i) => {
        const y = 0.32 + i * (vertical ? 0.17 : 0.2);
        const g = `item${i + 1}`;
        partes.push({ tipo: "forma", nome: `Número ${i + 1}`, forma: "circulo", cor: marca.primaria, x: 0.07, y, l: largo ? 0.06 : 0.12, a: (largo ? 0.06 : 0.12) * proporcao, grupo: g, ...ent("zoom", 0.5 + i * 0.45) });
        partes.push({ tipo: "texto", nome: `Número ${i + 1} texto`, texto: String(i + 1), fonte: "anton", peso: 400, tamanho: largo ? 0.035 : 0.065, cor: textoSobre(marca.primaria), x: 0.07, y: y + 0.01, l: largo ? 0.06 : 0.12, a: (largo ? 0.06 : 0.12) * proporcao - 0.02, grupo: g, ...ent("zoom", 0.5 + i * 0.45) });
        partes.push({ tipo: "texto", nome: `Tópico ${i + 1}`, texto: t, fonte: "figtree", peso: 700, tamanho: largo ? 0.028 : 0.048, cor: marca.texto, x: largo ? 0.16 : 0.23, y: y + 0.005, l: largo ? 0.76 : 0.7, a: vertical ? 0.1 : 0.12, alinhamento: "esquerda", grupo: g, ...ent("da_direita", 0.55 + i * 0.45) });
      });
      if (logo) partes.push({ ...logo, x: 0.38, y: 0.88, l: 0.24, a: 0.06, ...ent("aparecer", 1.8) });
      break;
    }
    case "meio_a_meio": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.fundo, x: 0, y: 0, l: 1, a: 1 });
      const m = midiaDe(m1);
      if (m) partes.push({ ...m, ajuste: "cobrir", ...(largo ? { x: 0, y: 0, l: 0.5, a: 1 } : { x: 0, y: 0, l: 1, a: 0.52 }), ...ent("aparecer", 0), chaves: [{ t: 0, escala: 1 }, { t: duracao_s, escala: 1.06 }] });
      const bx = largo ? 0.54 : 0.08;
      const by = largo ? 0.2 : 0.56;
      const bl = largo ? 0.4 : 0.84;
      if (selo) partes.push({ tipo: "texto", nome: "Selo", texto: selo, cor: textoSobre(marca.primaria), fundo: marca.primaria, tamanho: largo ? 0.02 : 0.034, peso: 800, maiusculas: true, x: bx, y: by, l: Math.min(bl, 0.5), a: 0.045, alinhamento: "esquerda", ...ent("da_esquerda", 0.2) });
      const ht = alturaDoTexto(titulo, tt * 0.75, bl, proporcao);
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "montserrat", peso: 900, tamanho: tt * 0.75, cor: marca.texto, x: bx, y: by + 0.06, l: bl, a: ht, alinhamento: "esquerda", ...ent("subir", 0.35) });
      if (sub) partes.push({ tipo: "texto", nome: "Subtítulo", texto: sub, fonte: "figtree", peso: 500, tamanho: largo ? 0.022 : 0.038, cor: marca.texto, opacidade: 0.85, x: bx, y: by + 0.07 + ht, l: bl, a: 0.08, alinhamento: "esquerda", ...ent("aparecer", 0.7) });
      partes.push(...botao(largo ? 0.72 : 0.86).map((p) => ({ ...p, x: bx, l: largo ? 0.3 : p.l })));
      break;
    }
    case "depoimento": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.fundo, x: 0, y: 0, l: 1, a: 1 });
      partes.push({ tipo: "texto", nome: "Aspas", texto: "“", fonte: "anton", peso: 400, tamanho: largo ? 0.12 : 0.25, cor: marca.primaria, x: 0.07, y: vertical ? 0.14 : 0.08, l: 0.3, a: 0.16, alinhamento: "esquerda", ...ent("zoom", 0) });
      const frase = sub || titulo;
      const ht = alturaDoTexto(frase, tt * 0.7, 0.86, proporcao);
      partes.push({ tipo: "texto", nome: "Frase", texto: frase, fonte: "figtree", peso: 700, tamanho: tt * 0.7, cor: marca.texto, x: 0.07, y: 0.5 - ht / 2, l: 0.86, a: ht, alinhamento: "esquerda", ...ent("revelar", 0.3) });
      const quem = sub ? titulo : selo;
      if (quem) partes.push({ tipo: "texto", nome: "Quem disse", texto: quem, fonte: "montserrat", peso: 600, tamanho: largo ? 0.022 : 0.036, cor: marca.primaria, x: 0.07, y: 0.5 + ht / 2 + 0.03, l: 0.86, a: 0.05, alinhamento: "esquerda", ...ent("aparecer", 1.1) });
      if (logo) partes.push({ ...logo, x: 0.38, y: 0.88, l: 0.24, a: 0.06, ...ent("aparecer", 1.4) });
      break;
    }
    case "chamada_final": {
      partes.push({ tipo: "forma", nome: "Fundo", forma: "retangulo", cor: marca.fundo, x: 0, y: 0, l: 1, a: 1 });
      if (logo) partes.push({ ...logo, x: 0.25, y: vertical ? 0.28 : 0.2, l: 0.5, a: vertical ? 0.14 : 0.22, ...ent("zoom", 0.1) });
      else partes.push({ tipo: "texto", nome: "Marca", texto: marca.nome || titulo, fonte: "anton", peso: 400, tamanho: tt, cor: marca.primaria, x: 0.1, y: 0.3, l: 0.8, a: 0.12, ...ent("zoom", 0.1) });
      partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "montserrat", peso: 800, tamanho: tt * 0.6, cor: marca.texto, x: 0.08, y: vertical ? 0.48 : 0.5, l: 0.84, a: alturaDoTexto(titulo, tt * 0.6, 0.84, proporcao), ...ent("subir", 0.5) });
      partes.push(...botao(vertical ? 0.64 : 0.72));
      if (sub) partes.push({ tipo: "texto", nome: "Subtítulo", texto: sub, fonte: "figtree", peso: 500, tamanho: largo ? 0.02 : 0.034, cor: marca.texto, opacidade: 0.8, x: 0.1, y: vertical ? 0.74 : 0.86, l: 0.8, a: 0.05, ...ent("aparecer", 1.2) });
      break;
    }
    case "antes_depois": {
      const a1 = midiaDe(m1);
      const a2 = midiaDe(m2 || m1);
      const horizontal = !vertical;
      if (a1) partes.push({ ...a1, nome: "Antes", ajuste: "cobrir", ...(horizontal ? { x: 0, y: 0, l: 0.5, a: 1 } : { x: 0, y: 0, l: 1, a: 0.5 }), ...ent("da_esquerda", 0) });
      if (a2) partes.push({ ...a2, nome: "Depois", ajuste: "cobrir", ...(horizontal ? { x: 0.5, y: 0, l: 0.5, a: 1 } : { x: 0, y: 0.5, l: 1, a: 0.5 }), ...ent("da_direita", 0.4) });
      partes.push({ tipo: "forma", nome: "Divisória", forma: "retangulo", cor: "#ffffff", ...(horizontal ? { x: 0.4985, y: 0, l: 0.003, a: 1 } : { x: 0, y: 0.4985, l: 1, a: 0.003 }) });
      partes.push({ tipo: "texto", nome: "Rótulo antes", texto: "Antes", cor: "#ffffff", fundo: "#000000", tamanho: largo ? 0.02 : 0.034, peso: 700, x: 0.04, y: 0.04, l: largo ? 0.12 : 0.22, a: 0.04, ...ent("aparecer", 0.3) });
      partes.push({ tipo: "texto", nome: "Rótulo depois", texto: "Depois", cor: textoSobre(marca.primaria), fundo: marca.primaria, tamanho: largo ? 0.02 : 0.034, peso: 700, ...(horizontal ? { x: 0.54, y: 0.04 } : { x: 0.04, y: 0.54 }), l: largo ? 0.12 : 0.22, a: 0.04, ...ent("aparecer", 0.7) });
      if (titulo) partes.push({ tipo: "texto", nome: "Título", texto: titulo, fonte: "anton", peso: 400, tamanho: tt * 0.7, cor: "#ffffff", sombra: true, x: 0.06, y: horizontal ? 0.84 : 0.43, l: 0.88, a: 0.1, ...ent("subir", 1) });
      break;
    }
    default:
      return aplicarModelo("titulo_forte", conteudo, marca, formato, duracao_s, animacao);
  }
  return { versao: 1, formato, duracao_s, fundo: marca.fundo, camadas: montar(q, partes), modelo: modeloId };
}

/**
 * Trocar a proporção: com modelo da marca, remonta no formato novo (as
 * posições saem do modelo); feito à mão, as frações ficam e a pessoa ajusta.
 * A mesma regra no editor e no painel do cartão.
 */
export function quadroNoFormato(q: QuadroAnimado, formato: FormatoDoQuadro, marca: MarcaDoQuadro): { quadro: QuadroAnimado; remontado: boolean } {
  if (formato === q.formato) return { quadro: q, remontado: false };
  if (q.modelo && modeloPorId(q.modelo)) return { quadro: aplicarModelo(q.modelo, conteudoDoQuadro(q), marca, formato, q.duracao_s), remontado: true };
  return { quadro: { ...q, formato }, remontado: false };
}

/** Conteúdo que já está no quadro (para sugerir outros layouts com o mesmo texto e as mesmas mídias). */
export function conteudoDoQuadro(q: QuadroAnimado): ConteudoDoQuadro {
  const textos = q.camadas.filter((c) => c.tipo === "texto" && c.texto.trim() && c.texto.trim().length > 1 && !/^\d$/.test(c.texto.trim()) && c.texto !== "“" && c.nome.indexOf("Rótulo") !== 0);
  const porTamanho = textos.slice().sort((a, b) => b.tamanho - a.tamanho);
  const porNome = (re: RegExp) => textos.find((c) => re.test(c.nome));
  // Depoimento: a frase é o subtítulo e quem disse é o título (o mesmo par que o modelo recebeu).
  const frase = porNome(/^Frase/);
  const quem = porNome(/^Quem disse/);
  const titulo = (frase && quem ? quem : porNome(/^T[ií]tulo/) || frase || porTamanho[0] || { texto: "" }).texto;
  const cta = (porNome(/^Chamada/) || { texto: "" }).texto;
  const selo = (porNome(/^Selo/) || { texto: "" }).texto;
  const topicos = textos.filter((c) => /^T[óo]pico/.test(c.nome)).map((c) => c.texto);
  const sub = (frase && quem ? frase : porNome(/^Subt[ií]tulo/) || porTamanho.filter((c) => c.texto !== titulo && c.texto !== cta && c.texto !== selo && topicos.indexOf(c.texto) < 0)[0] || { texto: "" }).texto;
  const midias: MidiaDaCamada[] = [];
  q.camadas.forEach((c) => {
    if ((c.tipo === "imagem" || c.tipo === "video") && c.midia && !midias.some((m) => m.caminho === (c.midia as MidiaDaCamada).caminho)) midias.push(c.midia);
  });
  return { titulo, subtitulo: sub, cta, selo, topicos, midias };
}

/**
 * Sugestões de layout: o mesmo conteúdo em outros modelos da marca (os que
 * pedem mídia só entram quando há mídia). Sem IA: a ordem sai do código e a
 * função pode reordenar pelo Jev.
 */
export function sugestoesDeLayout(q: QuadroAnimado, marca: MarcaDoQuadro, limite = 4): { modelo: ModeloDoQuadro; quadro: QuadroAnimado }[] {
  const conteudo = conteudoDoQuadro(q);
  const temMidia = conteudo.midias.length > 0;
  return MODELOS_DO_QUADRO.filter((m) => m.id !== q.modelo && (!m.pedeMidia || temMidia) && (m.id !== "antes_depois" || conteudo.midias.length >= 2) && (m.id !== "lista_tres" || conteudo.topicos.length >= 2))
    .slice(0, limite)
    .map((m) => ({ modelo: m, quadro: aplicarModelo(m.id, conteudo, marca, q.formato, q.duracao_s) }));
}

// ------------------------------------------------------------------ montar com IA (contrato com a função)

export const ANIMACOES_DA_MONTAGEM = ["suave", "dinamica", "elegante"] as const;

/** Esquema JSON que o modelo de texto preenche (o conteúdo; a posição é do código). */
export const ESQUEMA_DA_MONTAGEM = {
  nome: "quadro_do_canvas",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "modelo", "titulo", "subtitulo", "cta", "selo", "topicos", "duracao_s", "animacao", "alternativas"],
    properties: {
      resposta: { type: "string" },
      modelo: { type: "string", enum: MODELOS_DO_QUADRO.map((m) => m.id) },
      titulo: { type: "string" },
      subtitulo: { type: "string" },
      cta: { type: "string" },
      selo: { type: "string" },
      topicos: { type: "array", items: { type: "string" } },
      duracao_s: { type: "number" },
      animacao: { type: "string", enum: ANIMACOES_DA_MONTAGEM as unknown as string[] },
      alternativas: { type: "array", items: { type: "string", enum: MODELOS_DO_QUADRO.map((m) => m.id) } },
    },
  },
};

export const SISTEMA_DA_MONTAGEM = `Você é o diretor de motion da agência Aceleriq montando UM quadro animado de vídeo curto (Reels, Stories, anúncio) para a marca do cliente.
Você escreve o CONTEÚDO e escolhe o MODELO de layout; o código posiciona e anima cada camada, com as cores, as fontes e a logo reais da marca.
Regras:
- título curto e forte (até 7 palavras); subtítulo até 14 palavras; cta até 4 palavras (verbo de ação); selo até 3 palavras ou vazio; tópicos: 0 ou 3 itens de até 6 palavras.
- nada de número, preço, prazo, desconto, nome de pessoa ou promessa que não esteja nos dados reais ou no pedido. Sem base, deixe o campo vazio.
- modelo: um dos ids da lista; escolha pelo pedido e pelo que existe (modelo que pede mídia só com mídia; antes_depois só com duas mídias; lista_tres com três tópicos).
- alternativas: de 2 a 3 outros modelos que também serviriam, do melhor para o pior.
- duracao_s entre 3 e 12; animacao: suave, dinamica ou elegante, pelo tom da marca.
- resposta: uma frase dizendo o que você montou.
Português do Brasil, sem travessão, sem emoji. Responda só com o JSON.`;

export interface MontagemDoQuadro {
  resposta: string;
  modelo: string;
  conteudo: Omit<ConteudoDoQuadro, "midias">;
  duracao_s: number;
  animacao: "suave" | "dinamica" | "elegante";
  alternativas: string[];
}

const semTravessao = (t: string) => t.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
const corta = (t: unknown, max: number) => semTravessao(typeof t === "string" ? t : "").slice(0, max);

/** Resposta do modelo limpa e presa às listas (nada fora do esquema passa). */
export function limparMontagem(bruto: unknown, e: { midias: number } = { midias: 0 }): MontagemDoQuadro {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const valido = (id: unknown) => {
    const m = modeloPorId(String(id || ""));
    if (!m) return false;
    if (m.pedeMidia && e.midias < 1) return false;
    if (m.id === "antes_depois" && e.midias < 2) return false;
    return true;
  };
  const topicos = (Array.isArray(o.topicos) ? o.topicos : []).map((x) => corta(x, 60)).filter(Boolean).slice(0, 3);
  let modelo = valido(o.modelo) ? String(o.modelo) : e.midias ? "capa_cheia" : "titulo_forte";
  if (modelo === "lista_tres" && topicos.length < 2) modelo = e.midias ? "capa_cheia" : "titulo_forte";
  const alternativas = (Array.isArray(o.alternativas) ? o.alternativas : []).map(String).filter((x, i, l) => valido(x) && x !== modelo && l.indexOf(x) === i && (x !== "lista_tres" || topicos.length >= 2)).slice(0, 3);
  const animacao = (ANIMACOES_DA_MONTAGEM as readonly string[]).indexOf(String(o.animacao)) >= 0 ? (String(o.animacao) as MontagemDoQuadro["animacao"]) : "suave";
  return {
    resposta: corta(o.resposta, 400) || "Montei o quadro com o conteúdo do pedido.",
    modelo,
    conteudo: { titulo: corta(o.titulo, 90), subtitulo: corta(o.subtitulo, 160), cta: corta(o.cta, 40), selo: corta(o.selo, 30), topicos },
    duracao_s: Math.round(num(o.duracao_s, 6, 3, 12)),
    animacao,
    alternativas,
  };
}

/** Descrição curta de um layout para o Jev comparar com o pedido. */
export const descricaoParaEscolha = (m: ModeloDoQuadro) => `${m.rotulo}: ${m.descricao}`;
