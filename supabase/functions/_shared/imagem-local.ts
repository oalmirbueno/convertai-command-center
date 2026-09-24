/**
 * Operações de imagem feitas na própria função, sem IA e sem custo:
 * tela dupla para o carrossel contínuo, máscara de edição, recorte, foto real
 * no formato 4:5 e a devolução dos pixels originais fora da área editada.
 *
 * Regra do dono (23/09): quando a lâmina usa uma foto real do cliente, a foto
 * não é refeita pelo gerador. O gerador desenha só onde a máscara abre (texto,
 * logo, área pedida) e o código devolve a foto original em todo o resto.
 *
 * Medido em 23/09 (Deno, 1088 x 1360): decodificar 33 ms, tela dupla 66 ms,
 * máscara 36 ms, recorte 74 ms, mistura com pena 136 ms.
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

export const LARGURA_LAMINA = 1088;
export const ALTURA_LAMINA = 1360;
export const TAMANHO_TELA_DUPLA = `${LARGURA_LAMINA * 2}x${ALTURA_LAMINA}`;

/** Área relativa à lâmina, de 0 a 1 (canto superior esquerdo até o inferior direito). */
export type Area = { x0: number; y0: number; x1: number; y1: number };

const limitar = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Normaliza as áreas pedidas pela tela: ordena os cantos, corta em [0,1] e descarta áreas vazias. */
export function normalizarAreas(bruto: unknown, max = 6): Area[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Area[] = [];
  for (const a of bruto.slice(0, max)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const xa = limitar(Number(r.x0)), xb = limitar(Number(r.x1));
    const ya = limitar(Number(r.y0)), yb = limitar(Number(r.y1));
    const area = { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
    if (area.x1 - area.x0 >= 0.02 && area.y1 - area.y0 >= 0.02) saida.push(area);
  }
  return saida;
}

export async function decodificar(bytes: Uint8Array): Promise<Image> {
  const img = await Image.decode(bytes);
  if (!(img instanceof Image)) throw new Error("imagem_animada");
  return img;
}

/** Recorte "cover" pelo centro no tamanho pedido (padrão: lâmina 4:5). */
export function cobrir(img: Image, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Image {
  const escala = Math.max(largura / img.width, altura / img.height);
  const l = Math.max(largura, Math.round(img.width * escala));
  const a = Math.max(altura, Math.round(img.height * escala));
  const c = img.clone();
  if (l !== img.width || a !== img.height) c.resize(l, a);
  return c.crop(Math.floor((l - largura) / 2), Math.floor((a - altura) / 2), largura, altura);
}

/**
 * Foto qualquer (JPEG, PNG) vira PNG no tamanho da lâmina, recortada pelo
 * foco da foto (rosto, pessoa, detalhe) e não mais pelo centro cego:
 * 1088 x 1360 por padrão (post e carrossel 4:5); o criativo de anúncio passa
 * o tamanho do formato (1088 x 1088 no 1:1, 1088 x 1920 no 9:16).
 */
export async function fotoNaLamina(bytes: Uint8Array, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Promise<Uint8Array> {
  return await cobrirComFoco(await decodificar(bytes), largura, altura).encode(1);
}

/**
 * Máscara no padrão do editor da OpenAI: pixel transparente = pode mudar;
 * opaco = fica. `abertas` em coordenadas relativas à tela inteira.
 */
export async function mascara(largura: number, altura: number, abertas: Area[]): Promise<Uint8Array> {
  const m = new Image(largura, altura);
  m.fill(0xffffffff);
  for (const a of abertas) {
    const x = Math.floor(a.x0 * largura), y = Math.floor(a.y0 * altura);
    const w = Math.max(1, Math.ceil((a.x1 - a.x0) * largura)), h = Math.max(1, Math.ceil((a.y1 - a.y0) * altura));
    // drawBox usa coordenadas a partir de 1.
    m.drawBox(x + 1, y + 1, w, h, 0x00000000);
  }
  return await m.encode(1);
}

/**
 * Tela dupla do carrossel contínuo: a lâmina anterior à esquerda, a metade
 * direita vazia para o gerador pintar a continuação. Devolve a tela e a máscara.
 */
export async function telaDupla(anterior: Uint8Array): Promise<{ tela: Uint8Array; mascara: Uint8Array }> {
  const esquerda = cobrir(await decodificar(anterior));
  const tela = new Image(LARGURA_LAMINA * 2, ALTURA_LAMINA);
  tela.fill(0x808080ff);
  tela.composite(esquerda, 0, 0);
  return {
    tela: await tela.encode(1),
    mascara: await mascara(LARGURA_LAMINA * 2, ALTURA_LAMINA, [{ x0: 0.5, y0: 0, x1: 1, y1: 1 }]),
  };
}

/** Metade direita da tela dupla, já no tamanho da lâmina. */
export async function metadeDireita(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await decodificar(bytes);
  const meio = Math.floor(img.width / 2);
  const direita = img.clone().crop(meio, 0, img.width - meio, img.height);
  return await cobrir(direita).encode(1);
}

/**
 * O gerador redesenha a imagem inteira mesmo com máscara. Aqui os pixels do
 * original voltam em tudo o que ficou fora das áreas abertas, com uma pena
 * suave na borda para não marcar a emenda.
 *
 * Correção de 24/09: o gerador (Gemini e GPT pelo OpenRouter, que não aceitam
 * máscara) reenquadra a foto, com zoom e deslocamento. Colar o original no
 * lugar antigo punha duas fotos desencontradas uma sobre a outra (pedaços
 * repetidos na borda da área do texto). Agora o original é primeiro alinhado
 * ao enquadramento que o gerador devolveu e só então volta.
 *
 * `texto: true` (lâmina com foto real): dentro das áreas fica só o que o
 * gerador ACRESCENTOU (letras, sombra das letras); a foto por baixo continua a
 * original, então véu, caixa ou foto redesenhada dentro da área não passam.
 */
export async function devolverOriginalForaDasAreas(
  original: Uint8Array,
  gerado: Uint8Array,
  abertas: Area[],
  penaPx = 28,
  opcoes: { texto?: boolean } = {},
): Promise<Uint8Array> {
  return (await devolverOriginalAlinhado(original, gerado, abertas, penaPx, opcoes)).png;
}

/** Mesma operação, com o que foi medido (para gravar junto da versão). */
export async function devolverOriginalAlinhado(
  original: Uint8Array,
  gerado: Uint8Array,
  abertas: Area[],
  penaPx = 28,
  opcoes: { texto?: boolean } = {},
): Promise<{ png: Uint8Array; alinhamento: Alinhamento; alinhou: boolean; erro: number; recortouTexto: boolean; cenaMudada: boolean }> {
  const g = await decodificar(gerado);
  const o = cobrir(await decodificar(original), g.width, g.height);
  const W = g.width, H = g.height;
  const est = estimarAlinhamento(o, g, abertas);
  const alinhou = Number.isFinite(est.erro) && est.erro < est.erroSemAlinhar * 0.9;
  const al = alinhou ? est.alinhamento : IDENTIDADE;
  const erro = alinhou ? est.erro : est.erroSemAlinhar;
  // Lâmina com foto real em que o gerador mudou a cena (outra pose, outra
  // foto): nenhum alinhamento junta as duas e colar daria colagem. Fica a
  // imagem inteira do gerador, coerente, e a versão sai marcada.
  if (opcoes.texto && !(erro <= LIMITE_CENA_MUDADA)) {
    return { png: gerado, alinhamento: al, alinhou, erro, recortouTexto: false, cenaMudada: true };
  }
  // Recorte das letras só quando a foto do gerador bate com a original depois
  // de alinhada; se ele mudou a cena (pose, objetos), a área fica inteira dele.
  const recortouTexto = !!opcoes.texto && abertas.length > 0 && erro <= LIMITE_ERRO_RECORTE;

  const caixas = abertas.map((a) => ({
    x0: a.x0 * W, y0: a.y0 * H, x1: a.x1 * W, y1: a.y1 * H,
  }));
  const fg = g.bitmap, ob = o.bitmap;
  // Original já no enquadramento do gerador (amostragem bilinear) e o quanto cada pixel fica dentro dele.
  const alinhado = new Float32Array(W * H * 3);
  const cobertura = new Float32Array(W * H);
  const amostrarRgb = (ox: number, oy: number, k: number) => {
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(ox))), y0 = Math.max(0, Math.min(H - 1, Math.floor(oy)));
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, ox - x0)), fy = Math.max(0, Math.min(1, oy - y0));
    const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
    for (let c = 0; c < 3; c++) {
      const cima = ob[i00 + c] * (1 - fx) + ob[i10 + c] * fx;
      const baixo = ob[i01 + c] * (1 - fx) + ob[i11 + c] * fx;
      alinhado[k * 3 + c] = cima * (1 - fy) + baixo * fy;
    }
  };
  for (let y = 0; y < H; y++) {
    const oy = (al.cv + ((y + 0.5) / H - 0.5) / al.escala) * H - 0.5;
    for (let x = 0; x < W; x++) {
      const ox = (al.cu + ((x + 0.5) / W - 0.5) / al.escala) * W - 0.5;
      const k = y * W + x;
      const margem = Math.min(ox, oy, W - 1 - ox, H - 1 - oy);
      cobertura[k] = margem < 0 ? 0 : Math.min(1, (margem + 1) / 6);
      amostrarRgb(ox, oy, k);
    }
  }

  // Matte das letras: diferença entre o gerado e o original alinhado, tolerando
  // 2 px de sobra de alinhamento (o menor valor entre os vizinhos).
  let matte: Float32Array<ArrayBufferLike> | null = null;
  if (recortouTexto) {
    matte = new Float32Array(W * H);
    const dentro = (x: number, y: number) => caixas.some((c) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
    // Só a caixa que envolve as áreas (limite de CPU da função).
    const bx0 = Math.max(0, Math.floor(Math.min(...caixas.map((c) => c.x0))));
    const by0 = Math.max(0, Math.floor(Math.min(...caixas.map((c) => c.y0))));
    const bx1 = Math.min(W - 1, Math.ceil(Math.max(...caixas.map((c) => c.x1))));
    const by1 = Math.min(H - 1, Math.ceil(Math.max(...caixas.map((c) => c.y1))));
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (!dentro(x, y)) continue;
        const k = y * W + x;
        let menor = Infinity;
        for (let dy = -2; dy <= 2 && menor > 0; dy += 2) {
          const yy = Math.max(0, Math.min(H - 1, y + dy));
          for (let dx = -2; dx <= 2; dx += 2) {
            const xx = Math.max(0, Math.min(W - 1, x + dx));
            const kk = yy * W + xx, i = k * 4;
            const d = Math.max(
              Math.abs(fg[i] - alinhado[kk * 3]),
              Math.abs(fg[i + 1] - alinhado[kk * 3 + 1]),
              Math.abs(fg[i + 2] - alinhado[kk * 3 + 2]),
            );
            if (d < menor) menor = d;
          }
        }
        const t = Math.max(0, Math.min(1, (menor - 26) / (70 - 26)));
        matte[k] = cobertura[k] > 0 ? t * t * (3 - 2 * t) : 1;
      }
    }
    const janela = { x0: Math.max(0, bx0 - 2), y0: Math.max(0, by0 - 2), x1: Math.min(W - 1, bx1 + 2), y1: Math.min(H - 1, by1 + 2) };
    matte = suavizarMatte(dilatarMatte(matte, W, H, janela), W, H, janela);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Distância até a área aberta mais próxima (0 dentro dela).
      let dist = Infinity;
      for (const c of caixas) {
        const dx = Math.max(c.x0 - x, 0, x - c.x1);
        const dy = Math.max(c.y0 - y, 0, y - c.y1);
        const d = Math.max(dx, dy);
        if (d < dist) dist = d;
        if (dist === 0) break;
      }
      const k = y * W + x, i = k * 4;
      // Peso do original: 1 longe das áreas; dentro delas, o que não é letra.
      const peso = dist === 0 ? (matte ? 1 - matte[k] : 0) : Math.min(1, dist / penaPx);
      const p = peso * cobertura[k];
      if (p <= 0) continue;
      fg[i] = fg[i] * (1 - p) + alinhado[k * 3] * p;
      fg[i + 1] = fg[i + 1] * (1 - p) + alinhado[k * 3 + 1] * p;
      fg[i + 2] = fg[i + 2] * (1 - p) + alinhado[k * 3 + 2] * p;
      fg[i + 3] = 255;
    }
  }
  return { png: await g.encode(1), alinhamento: al, alinhou, erro, recortouTexto, cenaMudada: false };
}

// ------------------------------------------------ alinhamento da foto real

/**
 * Onde o gerador pôs a foto: o ponto (u, v) do gerado, de 0 a 1, mostra o
 * ponto (cu + (u - 0,5) / escala, cv + (v - 0,5) / escala) do original.
 * Escala acima de 1 = o gerador aproximou (zoom).
 */
export type Alinhamento = { escala: number; cu: number; cv: number };
export const IDENTIDADE: Alinhamento = { escala: 1, cu: 0.5, cv: 0.5 };
/**
 * Desvio da diferença de luminância (0 a 255) depois de alinhar, medido em
 * 24/09: mesma cena reenquadrada fica entre 0,6 e 3,4; pose espelhada deu 31;
 * outra foto, 69. Até 16 recorta só as letras; acima de 24 é outra cena.
 */
export const LIMITE_ERRO_RECORTE = 16;
export const LIMITE_CENA_MUDADA = 24;

type Mapa = { l: number; a: number; px: Float32Array };

/** Luminância média por bloco (redução fiel, sem pular pixel). */
function mapaCinza(img: Image, l: number, a: number): Mapa {
  const W = img.width, H = img.height, b = img.bitmap;
  const px = new Float32Array(l * a);
  const n = new Float32Array(l * a);
  const colunas = new Int32Array(W);
  for (let x = 0; x < W; x++) colunas[x] = Math.min(l - 1, Math.floor((x * l) / W));
  for (let y = 0; y < H; y++) {
    const base = Math.min(a - 1, Math.floor((y * a) / H)) * l;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const k = base + colunas[x];
      px[k] += 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      n[k]++;
    }
  }
  for (let k = 0; k < px.length; k++) px[k] /= n[k] || 1;
  return { l, a, px };
}

/** Reduz um mapa por um fator inteiro (média dos blocos). */
function reduzirMapa(m: Mapa, fator: number): Mapa {
  const l = Math.floor(m.l / fator), a = Math.floor(m.a / fator);
  const px = new Float32Array(l * a);
  for (let y = 0; y < a; y++) {
    for (let x = 0; x < l; x++) {
      let s = 0;
      for (let dy = 0; dy < fator; dy++) {
        const linha = (y * fator + dy) * m.l + x * fator;
        for (let dx = 0; dx < fator; dx++) s += m.px[linha + dx];
      }
      px[y * l + x] = s / (fator * fator);
    }
  }
  return { l, a, px };
}

function amostrar(m: Mapa, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(m.l - 1, x0 + 1), y1 = Math.min(m.a - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const p = m.px;
  return (p[y0 * m.l + x0] * (1 - fx) + p[y0 * m.l + x1] * fx) * (1 - fy) +
    (p[y1 * m.l + x0] * (1 - fx) + p[y1 * m.l + x1] * fx) * fy;
}

/** Pixels do mapa que caem nas áreas abertas (o gerador mudou ali de propósito). */
function mascaraDoMapa(l: number, a: number, abertas: Area[]): Uint8Array {
  const m = new Uint8Array(l * a);
  for (let y = 0; y < a; y++) {
    const v = (y + 0.5) / a;
    for (let x = 0; x < l; x++) {
      const u = (x + 0.5) / l;
      if (abertas.some((ar) => u >= ar.x0 && u <= ar.x1 && v >= ar.y0 && v <= ar.y1)) m[y * l + x] = 1;
    }
  }
  return m;
}

/**
 * Desvio da diferença entre o gerado e o original posto no alinhamento, fora
 * das áreas abertas. Tira a diferença média (o gerador pode clarear ou
 * escurecer a foto toda). Menos de 60% de cobertura = alinhamento impossível.
 */
function erroDoAlinhamento(g: Mapa, o: Mapa, al: Alinhamento, ignorar: Uint8Array, passo: number): number {
  let s = 0, s2 = 0, n = 0, total = 0;
  const { l, a } = g;
  for (let y = 0; y < a; y += passo) {
    const oy = (al.cv + ((y + 0.5) / a - 0.5) / al.escala) * a - 0.5;
    for (let x = 0; x < l; x += passo) {
      const k = y * l + x;
      if (ignorar[k]) continue;
      total++;
      const ox = (al.cu + ((x + 0.5) / l - 0.5) / al.escala) * l - 0.5;
      if (ox < 0 || oy < 0 || ox > l - 1 || oy > a - 1) continue;
      const d = g.px[k] - amostrar(o, ox, oy);
      s += d;
      s2 += d * d;
      n++;
    }
  }
  if (!total || n < total * 0.6) return Infinity;
  const media = s / n;
  return Math.sqrt(Math.max(0, s2 / n - media * media));
}

/**
 * Procura escala e deslocamento em três níveis (do grosso ao fino). Escala de
 * 0,8 a 1,3 e centro até 20% fora do meio cobrem o que os geradores fazem.
 * Os mapas saem uma vez em 288 px de largura e os menores são reduções dele
 * (limite de CPU da função): cerca de 10 milhões de amostras.
 */
export function estimarAlinhamento(original: Image, gerado: Image, abertas: Area[]): {
  alinhamento: Alinhamento;
  erro: number;
  erroSemAlinhar: number;
} {
  const proporcao = gerado.height / gerado.width;
  const lf = 288, af = Math.max(24, Math.round((lf * proporcao) / 9) * 9);
  const gFino = mapaCinza(gerado, lf, af), oFino = mapaCinza(original, lf, af);
  const mapas = [9, 3, 1].map((fator) => {
    const g = fator === 1 ? gFino : reduzirMapa(gFino, fator);
    const o = fator === 1 ? oFino : reduzirMapa(oFino, fator);
    return { g, o, ignorar: mascaraDoMapa(g.l, g.a, abertas) };
  });
  const busca = (
    nivel: number,
    passo: number,
    base: Alinhamento,
    escalas: { de: number; ate: number; passo: number },
    raioU: number,
    raioV: number,
  ) => {
    const { g, o, ignorar } = mapas[nivel];
    let melhor = base, menor = erroDoAlinhamento(g, o, base, ignorar, passo);
    for (let e = escalas.de; e <= escalas.ate + 1e-9; e += escalas.passo) {
      for (let du = -raioU; du <= raioU; du++) {
        for (let dv = -raioV; dv <= raioV; dv++) {
          const al = { escala: e, cu: base.cu + du / g.l, cv: base.cv + dv / g.a };
          const err = erroDoAlinhamento(g, o, al, ignorar, passo);
          if (err < menor) {
            menor = err;
            melhor = al;
          }
        }
      }
    }
    return { melhor, menor };
  };
  const n1 = mapas[0].g;
  // 32 px: escala de 2,5 em 2,5% e centro de pixel em pixel até 20% do quadro.
  const r1 = busca(0, 1, IDENTIDADE, { de: 0.8, ate: 1.3, passo: 0.025 }, Math.round(0.2 * n1.l), Math.round(0.2 * n1.a));
  // 96 px: vizinhança do melhor, um pixel grosso para cada lado.
  const r2 = busca(1, 2, r1.melhor, { de: r1.melhor.escala - 0.025, ate: r1.melhor.escala + 0.025, passo: 0.005 }, 3, 3);
  // 288 px: acerto fino (cerca de 4 px na lâmina de 1088).
  const r3 = busca(2, 3, r2.melhor, { de: r2.melhor.escala - 0.006, ate: r2.melhor.escala + 0.006, passo: 0.003 }, 3, 3);
  const { g, o, ignorar } = mapas[2];
  return { alinhamento: r3.melhor, erro: r3.menor, erroSemAlinhar: erroDoAlinhamento(g, o, IDENTIDADE, ignorar, 3) };
}

type Janela = { x0: number; y0: number; x1: number; y1: number };

/** Engrossa as letras em 1 px (a borda antisserrilhada entra inteira). */
function dilatarMatte(m: Float32Array, W: number, H: number, j: Janela): Float32Array {
  const s = new Float32Array(m.length);
  for (let y = j.y0; y <= j.y1; y++) {
    for (let x = j.x0; x <= j.x1; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = m[yy * W + xx];
          if (q > v) v = q;
        }
      }
      s[y * W + x] = v;
    }
  }
  return s;
}

/** Média 3 x 3: tira o serrilhado do recorte. */
function suavizarMatte(m: Float32Array, W: number, H: number, j: Janela): Float32Array {
  const s = new Float32Array(m.length);
  for (let y = j.y0; y <= j.y1; y++) {
    for (let x = j.x0; x <= j.x1; x++) {
      let soma = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          soma += m[yy * W + xx];
          n++;
        }
      }
      s[y * W + x] = soma / n;
    }
  }
  return s;
}

// ------------------------------------------------ recorte com foco

/**
 * Centro de interesse da foto (0 a 1): pele (rosto, mãos) pesa mais, depois
 * detalhe (bordas). Serve para recortar sem cortar a cabeça de quem está no
 * alto de um quadro vertical (foto de Reels 9:16 virando lâmina 4:5).
 */
export function focoDaFoto(img: Image): { fx: number; fy: number; pele: number } {
  const l = 64, a = Math.max(8, Math.round((64 * img.height) / img.width));
  const W = img.width, H = img.height, b = img.bitmap;
  const lum = new Float32Array(l * a);
  const pele = new Float32Array(l * a);
  const n = new Float32Array(l * a);
  for (let y = 0; y < H; y += 2) {
    const my = Math.min(a - 1, Math.floor((y * a) / H));
    for (let x = 0; x < W; x += 2) {
      const k = my * l + Math.min(l - 1, Math.floor((x * l) / W));
      const i = (y * W + x) * 4;
      const r = b[i], g = b[i + 1], bl = b[i + 2];
      const yv = 0.299 * r + 0.587 * g + 0.114 * bl;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * bl;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * bl;
      lum[k] += yv;
      if (yv > 40 && cb >= 77 && cb <= 127 && cr >= 137 && cr <= 173) pele[k]++;
      n[k]++;
    }
  }
  for (let k = 0; k < lum.length; k++) {
    lum[k] /= n[k] || 1;
    pele[k] /= n[k] || 1;
  }
  let sx = 0, sy = 0, sp = 0, totalPele = 0;
  for (let y = 1; y < a - 1; y++) {
    for (let x = 1; x < l - 1; x++) {
      const k = y * l + x;
      const borda = Math.abs(lum[k + 1] - lum[k - 1]) + Math.abs(lum[k + l] - lum[k - l]);
      const p = borda / 40 + pele[k] * 3;
      sx += p * (x + 0.5);
      sy += p * (y + 0.5);
      sp += p;
      totalPele += pele[k];
    }
  }
  if (sp <= 0) return { fx: 0.5, fy: 0.45, pele: 0 };
  return { fx: sx / sp / l, fy: sy / sp / a, pele: totalPele / (l * a) };
}

/**
 * "Cover" que segue o foco em vez do centro. Na vertical, o foco fica a 42%
 * da altura do quadro (espaço acima da cabeça como numa foto bem enquadrada).
 */
export function cobrirComFoco(img: Image, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Image {
  const escala = Math.max(largura / img.width, altura / img.height);
  const l = Math.max(largura, Math.round(img.width * escala));
  const a = Math.max(altura, Math.round(img.height * escala));
  if (l === largura && a === altura) return cobrir(img, largura, altura);
  const { fx, fy } = focoDaFoto(img);
  const c = img.clone();
  c.resize(l, a);
  const x = Math.max(0, Math.min(l - largura, Math.round(fx * l - largura / 2)));
  const y = Math.max(0, Math.min(a - altura, Math.round(fy * a - altura * 0.42)));
  return c.crop(x, y, largura, altura);
}

// ------------------------------------------------ logo aplicada em código

/**
 * Logo oficial posta pelo código na lâmina com foto real: o gerador não
 * redesenha a logo (saía torta, dentro de uma caixa fosca). Cabe na caixa,
 * alinhada ao lado da caixa, e ganha um halo suave do valor oposto só quando
 * a foto atrás tem o mesmo valor dela (logo escura em foto escura). Não
 * escurece a foto: o halo acompanha o desenho da logo, sem caixa.
 */
export async function aplicarLogo(arte: Uint8Array, logo: Uint8Array, caixa: Area, clara: boolean): Promise<Uint8Array> {
  const img = await decodificar(arte);
  const L = await decodificar(logo);
  const W = img.width, H = img.height;
  const cw = Math.max(8, Math.round((caixa.x1 - caixa.x0) * W));
  const ch = Math.max(8, Math.round((caixa.y1 - caixa.y0) * H));
  const esc = Math.min(cw / L.width, ch / L.height);
  const lw = Math.max(1, Math.round(L.width * esc)), lh = Math.max(1, Math.round(L.height * esc));
  const logoNaCaixa = L.clone().resize(lw, lh);
  const centro = (caixa.x0 + caixa.x1) / 2;
  const x = Math.round(centro < 0.45 ? caixa.x0 * W : centro > 0.55 ? caixa.x1 * W - lw : centro * W - lw / 2);
  const y = Math.round(caixa.y0 * H + (ch - lh) / 2);

  // Valor da foto atrás da logo.
  const b = img.bitmap;
  let soma = 0, n = 0;
  for (let yy = Math.max(0, y); yy < Math.min(H, y + lh); yy += 2) {
    for (let xx = Math.max(0, x); xx < Math.min(W, x + lw); xx += 2) {
      const i = (yy * W + xx) * 4;
      soma += 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      n++;
    }
  }
  const fundo = n ? soma / n : 128;
  const poucoContraste = clara ? fundo > 150 : fundo < 95;
  if (poucoContraste) {
    const r = Math.max(3, Math.round(lh * 0.12));
    const hw = lw + r * 2, hh = lh + r * 2;
    let alfa: Float32Array<ArrayBufferLike> = new Float32Array(hw * hh);
    const lb = logoNaCaixa.bitmap;
    for (let yy = 0; yy < lh; yy++) {
      for (let xx = 0; xx < lw; xx++) alfa[(yy + r) * hw + xx + r] = lb[(yy * lw + xx) * 4 + 3] / 255;
    }
    for (let passe = 0; passe < 2; passe++) alfa = desfocarCaixa(alfa, hw, hh, r);
    const halo = new Image(hw, hh);
    const cor = clara ? 0 : 255;
    const hb = halo.bitmap;
    for (let k = 0; k < hw * hh; k++) {
      hb[k * 4] = cor;
      hb[k * 4 + 1] = cor;
      hb[k * 4 + 2] = cor;
      hb[k * 4 + 3] = Math.round(Math.min(1, alfa[k] * 1.6) * 255 * 0.55);
    }
    img.composite(halo, x - r, y - r);
  }
  img.composite(logoNaCaixa, x, y);
  return await img.encode(1);
}

/** Desfoque de caixa separável (horizontal e vertical) com raio r. */
function desfocarCaixa(m: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(m.length), out = new Float32Array(m.length);
  const janela = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += m[y * W + Math.max(0, Math.min(W - 1, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / janela;
      s += m[y * W + Math.min(W - 1, x + r + 1)] - m[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(H - 1, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / janela;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

/**
 * Tom dominante e claridade da logo, para o prompt pôr atrás dela um fundo de
 * valor oposto (logo azul nunca sobre fundo azul). Ignora pixels transparentes
 * e, em logo sem transparência, o fundo quase branco.
 */
export async function analisarLogo(bytes: Uint8Array): Promise<{ tom: string | null; clara: boolean }> {
  const img = await decodificar(bytes);
  const pequena = img.width > 200 ? img.clone().resize(200, Image.RESIZE_AUTO) : img;
  const b = pequena.bitmap;
  let r = 0, g = 0, bl = 0, n = 0, opacos = 0;
  for (let i = 0; i < b.length; i += 4) {
    if (b[i + 3] < 128) continue;
    opacos++;
    const claro = b[i] > 235 && b[i + 1] > 235 && b[i + 2] > 235;
    if (claro) continue;
    r += b[i]; g += b[i + 1]; bl += b[i + 2]; n++;
  }
  // Quase tudo branco: logo branca (versão para fundo escuro).
  if (!opacos || n < opacos * 0.08) return { tom: "#FFFFFF", clara: true };
  r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminancia = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const hex = `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return { tom: hex, clara: luminancia > 0.45 };
}

/**
 * Logo pronta para anexar ao gerador: no máximo 512 px e sem fundo falso.
 * Muita logo chega com o "xadrez" de transparência desenhado na própria imagem
 * (ou com fundo branco); o gerador copia isso como uma caixa. Aqui o fundo
 * claro e sem cor ligado à borda vira transparente (preenchimento a partir das
 * bordas, então o branco de dentro da logo fica).
 */
export async function logoLimpa(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await decodificar(bytes);
  const l = img.width > 512 || img.height > 512 ? img.clone().contain(512, 512) : img.clone();
  const W = l.width, H = l.height, b = l.bitmap;
  const fundo = (i: number) => {
    if (b[i + 3] < 16) return true;
    const r = b[i], g = b[i + 1], bl = b[i + 2];
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
    return min >= 200 && max - min <= 18;
  };
  const visto = new Uint8Array(W * H);
  const pilha: number[] = [];
  for (let x = 0; x < W; x++) pilha.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) pilha.push(y * W, y * W + W - 1);
  let limpos = 0;
  while (pilha.length) {
    const p = pilha.pop()!;
    if (visto[p]) continue;
    visto[p] = 1;
    if (!fundo(p * 4)) continue;
    b[p * 4 + 3] = 0;
    limpos++;
    const x = p % W, y = (p - x) / W;
    if (x > 0) pilha.push(p - 1);
    if (x < W - 1) pilha.push(p + 1);
    if (y > 0) pilha.push(p - W);
    if (y < H - 1) pilha.push(p + W);
  }
  // Nada ou quase tudo limpo: a logo não tinha fundo falso (ou é branca); vai como veio.
  if (limpos < W * H * 0.05 || limpos > W * H * 0.97) return bytes;
  return await l.encode(1);
}

/** Amplia a área em volta (margem relativa), para o gerador ter espaço de fundir a borda. */
export function ampliar(a: Area, margem = 0.03): Area {
  return { x0: limitar(a.x0 - margem), y0: limitar(a.y0 - margem), x1: limitar(a.x1 + margem), y1: limitar(a.y1 + margem) };
}

// ------------------------------------------------ panorama do carrossel contínuo
//
// Correção de 23/09 (noite): a tela dupla antiga não emendava. O gerador
// redesenha a tela inteira mesmo com máscara, e a lâmina nova continuava a
// cópia redesenhada da anterior, não a anterior de verdade. Agora o fundo do
// carrossel nasce como UM panorama (trechos de até 3 lâminas), é fatiado e
// cada lâmina recebe o texto por cima só na área do texto: as emendas batem
// porque as fatias vêm da mesma imagem.

/** Tamanho do trecho de k lâminas lado a lado (múltiplos de 16, proporção até 2,4:1). */
export const tamanhoDoTrecho = (k: number) => `${LARGURA_LAMINA * k}x${ALTURA_LAMINA}`;

/**
 * Tela do trecho seguinte: a primeira lâmina (o fundo já pronto do trecho
 * anterior) à esquerda e o resto aberto na máscara para o gerador continuar.
 */
export async function telaDoTrecho(k: number, primeira: Uint8Array): Promise<{ tela: Uint8Array; mascara: Uint8Array }> {
  const W = LARGURA_LAMINA * k;
  const tela = new Image(W, ALTURA_LAMINA);
  tela.fill(0x808080ff);
  tela.composite(cobrir(await decodificar(primeira)), 0, 0);
  return {
    tela: await tela.encode(1),
    mascara: await mascara(W, ALTURA_LAMINA, [{ x0: 1 / k, y0: 0, x1: 1, y1: 1 }]),
  };
}

/** Corta o trecho em k fundos 1088 x 1360, da esquerda para a direita. */
export async function fatiarPanorama(bytes: Uint8Array, k: number): Promise<Uint8Array[]> {
  const img = cobrir(await decodificar(bytes), LARGURA_LAMINA * k, ALTURA_LAMINA);
  const fatias: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    fatias.push(await img.clone().crop(i * LARGURA_LAMINA, 0, LARGURA_LAMINA, ALTURA_LAMINA).encode(1));
  }
  return fatias;
}

/**
 * Emenda entre trechos: o gerador redesenha de leve a lâmina de ligação, então
 * a borda esquerda do fundo novo pode sair num tom um pouco diferente da borda
 * direita do fundo que já existe. Aqui a diferença de cor de cada linha na
 * divisa é medida e aplicada no fundo novo, sumindo aos poucos em `faixa` px.
 */
export async function corrigirEmenda(anterior: Uint8Array, nova: Uint8Array, faixa = 180): Promise<Uint8Array> {
  const a = cobrir(await decodificar(anterior));
  const n = cobrir(await decodificar(nova));
  const W = n.width, H = n.height;
  const pa = a.bitmap, pn = n.bitmap;
  const media = (bm: Uint8ClampedArray, y: number, x0: number, x1: number, c: number) => {
    let s = 0, q = 0;
    for (let x = x0; x < x1; x++) { s += bm[(y * W + x) * 4 + c]; q++; }
    return s / Math.max(1, q);
  };
  // Diferença por linha (R, G, B) medida em 6 colunas de cada lado da divisa.
  const delta: number[][] = [];
  for (let y = 0; y < H; y++) {
    delta.push([0, 1, 2].map((c) => media(pa, y, W - 6, W, c) - media(pn, y, 0, 6, c)));
  }
  // Suaviza entre linhas para não criar listras.
  const R = 16;
  const suave = delta.map((_, y) => [0, 1, 2].map((c) => {
    let s = 0, q = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy >= 0 && yy < H) { s += delta[yy][c]; q++; } }
    return s / q;
  }));
  const larg = Math.min(faixa, W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < larg; x++) {
      const peso = 1 - x / larg;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) pn[i + c] = Math.max(0, Math.min(255, pn[i + c] + suave[y][c] * peso));
    }
  }
  return await n.encode(1);
}
