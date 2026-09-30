/**
 * Cópias leves (miniatura e média) fora do fio principal (EX-13, 30/09).
 *
 * Decodificar e reduzir uma foto de 12 MP na tela levava de 180 a 260 ms, e
 * um PNG de carrossel cerca de 50 ms, travando a navegação enquanto a fila de
 * imagens antigas andava. Aqui o trabalho é o mesmo do caminho da tela
 * (src/lib/miniaturas.ts): reduzir pela metade até perto do alvo, conferir a
 * transparência (passo 16, alfa < 250), fundo branco para foto e PNG só com
 * transparência, na mesma qualidade.
 *
 * Quem chama já sabe o tamanho (pelo <img>, sem desenhar) e manda os alvos.
 * Se o tamanho decodificado aqui for outro (orientação da foto tratada de
 * outro jeito) ou qualquer coisa falhar, devolve erro e quem chama faz pelo
 * caminho de sempre. Arquivo sem import: roda como worker clássico.
 */

type Alvo = { largura: number; altura: number };

type Pedido = {
  id: number;
  blob: Blob;
  largura: number;
  altura: number;
  alvoMini: Alvo;
  alvoMedia: Alvo | null;
  checarTransparencia: boolean;
  qualidadeMini: number;
  qualidadeMedia: number;
};

type Tela = OffscreenCanvas;
type Contexto = OffscreenCanvasRenderingContext2D;

const escopo = self as unknown as {
  onmessage: ((e: MessageEvent<Pedido>) => void) | null;
  postMessage: (mensagem: unknown) => void;
};

function tela(largura: number, altura: number): Tela {
  return new OffscreenCanvas(largura, altura);
}

function contexto(c: Tela): Contexto {
  const ctx = c.getContext("2d") as Contexto | null;
  if (!ctx) throw new Error("canvas_indisponivel");
  ctx.imageSmoothingEnabled = true;
  try {
    ctx.imageSmoothingQuality = "high";
  } catch {
    // suavização padrão
  }
  return ctx;
}

function desenharReduzida(origem: ImageBitmap, largura: number, altura: number, alvo: Alvo): Tela {
  let el: CanvasImageSource = origem;
  let l = largura;
  let a = altura;
  while (l / 2 >= alvo.largura * 1.5 && a / 2 >= alvo.altura * 1.5) {
    const nl = Math.round(l / 2);
    const na = Math.round(a / 2);
    const passo = tela(nl, na);
    contexto(passo).drawImage(el, 0, 0, l, a, 0, 0, nl, na);
    el = passo;
    l = nl;
    a = na;
  }
  const final = tela(alvo.largura, alvo.altura);
  contexto(final).drawImage(el, 0, 0, l, a, 0, 0, alvo.largura, alvo.altura);
  return final;
}

function temTransparencia(c: Tela): boolean {
  try {
    const ctx = c.getContext("2d") as Contexto | null;
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
  } catch {
    // trata como opaca, como na tela
  }
  return false;
}

function comFundoBranco(c: Tela): Tela {
  const f = tela(c.width, c.height);
  const ctx = contexto(f);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.drawImage(c, 0, 0);
  return f;
}

escopo.onmessage = (e: MessageEvent<Pedido>) => {
  const p = e.data;
  let imagem: ImageBitmap | null = null;
  const terminar = () => {
    if (imagem) imagem.close();
    imagem = null;
  };
  createImageBitmap(p.blob, { imageOrientation: "from-image" })
    .then(async (bmp) => {
      imagem = bmp;
      if (bmp.width !== p.largura || bmp.height !== p.altura) throw new Error("tamanho_diferente");
      const miniTela = desenharReduzida(bmp, p.largura, p.altura, p.alvoMini);
      const transparente = p.checarTransparencia && temTransparencia(miniTela);
      const tipo = transparente ? "image/png" : "image/jpeg";
      const mini = await (transparente ? miniTela : comFundoBranco(miniTela)).convertToBlob({ type: tipo, quality: p.qualidadeMini });
      let media: Blob | null = null;
      if (p.alvoMedia) {
        const mediaTela = desenharReduzida(bmp, p.largura, p.altura, p.alvoMedia);
        media = await (transparente ? mediaTela : comFundoBranco(mediaTela)).convertToBlob({ type: tipo, quality: p.qualidadeMedia });
      }
      terminar();
      escopo.postMessage({ id: p.id, mini, media });
    })
    .catch((erro: unknown) => {
      terminar();
      escopo.postMessage({ id: p.id, erro: String((erro as Error)?.message || erro) });
    });
};
