import { supabase } from "@/integrations/supabase/client";
import { baixarDoStorage, nomeDoArquivo } from "../instagram/capaDoDestaque";
import { corDaLetra, hexValido, LAYOUT_DO_TEXTO, quebrarEmLinhas, TAMANHO_DO_STORY } from "./layoutDoStory";
import type { Story } from "./storiesApi";

/**
 * A arte do story de cor da marca montada no navegador (1080 x 1920, sem
 * custo): o texto pedido sobre a cor, na fonte e nas cores da marca. A área do
 * adesivo fica livre: o adesivo entra no app.
 * 21/10 (regra da casa: "nunca colocar imagem em cima, sempre gerar com o
 * gerador"): story com imagem sai do gerador do Estúdio (storiesApi.ts,
 * gerarImagensDosStories); a foto real vai inteira como referência, nunca
 * recortada aqui com texto por cima. `montarArteDoStory` ainda aceita a foto
 * (testes e sequências antigas), mas a tela só chama sem ela.
 * Safari 11 não tem createImageBitmap: abre pelo <img>.
 */

export interface MarcaDaArte {
  /** Cores do kit (#rrggbb), a primeira é a principal. */
  paleta: string[];
  /** Família da fonte da marca já carregada no documento (null: a padrão do painel). */
  familia: string | null;
}

async function abrirImagem(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => erro(new Error("O navegador não conseguiu abrir a foto."));
      img.src = url;
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function paraPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, erro) => {
    canvas.toBlob((b) => (b ? ok(b) : erro(new Error("O navegador não conseguiu gerar o PNG."))), "image/png");
  });
}

/** Cor do fundo liso: a escolhida (se for hex) ou a principal da marca. */
export function corDoFundo(story: Pick<Story, "fundo">, paleta: string[]): string {
  return hexValido(story.fundo.cor) || hexValido(paleta[0]) || "#111111";
}

const fonteDoCanvas = (tamanho: number, familia: string | null) => `600 ${Math.round(tamanho)}px ${familia ? `"${familia}", ` : ""}Outfit, sans-serif`;

/** Monta o PNG do story. `foto` é a foto do acervo já baixada (fundo de foto). */
export async function montarArteDoStory(story: Pick<Story, "texto_na_tela" | "fundo">, marca: MarcaDaArte, foto: Blob | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = TAMANHO_DO_STORY.largura;
  canvas.height = TAMANHO_DO_STORY.altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu montar a arte.");
  const W = canvas.width;
  const H = canvas.height;

  const comFoto = story.fundo.tipo === "foto" && !!foto;
  const fundo = corDoFundo(story, marca.paleta);
  if (comFoto && foto) {
    const img = await abrirImagem(foto);
    const escala = Math.max(W / img.width, H / img.height);
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);
    ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
  } else {
    ctx.fillStyle = fundo;
    ctx.fillRect(0, 0, W, H);
  }

  const texto = (story.texto_na_tela || "").trim();
  if (!texto) return paraPng(canvas);

  // Sobre a foto, o texto vai num fundo da cor da marca (o "texto com fundo" do Instagram); a foto não muda.
  const caixa = hexValido(marca.paleta[0]) || "#111111";
  const letra = comFoto ? corDaLetra(caixa, marca.paleta) : corDaLetra(fundo, marca.paleta);
  const largura = W * (1 - 2 * LAYOUT_DO_TEXTO.margem);
  let corpo = W * LAYOUT_DO_TEXTO.corpo;
  let linhas: string[] = [];
  for (;;) {
    ctx.font = fonteDoCanvas(corpo, marca.familia);
    linhas = quebrarEmLinhas(texto, largura, (t) => ctx.measureText(t).width);
    if (linhas.length <= LAYOUT_DO_TEXTO.linhasMaximas || corpo <= W * LAYOUT_DO_TEXTO.corpoMinimo) break;
    corpo -= 4;
  }
  const passo = corpo * LAYOUT_DO_TEXTO.entrelinha;
  const respiro = corpo * LAYOUT_DO_TEXTO.respiro;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = H * LAYOUT_DO_TEXTO.topo + passo / 2;
  for (const l of linhas) {
    if (comFoto) {
      const w = ctx.measureText(l).width + respiro * 2;
      ctx.fillStyle = caixa;
      ctx.fillRect(W / 2 - w / 2, y - passo / 2, w, passo);
    }
    ctx.fillStyle = letra;
    ctx.fillText(l, W / 2, y);
    y += passo;
  }
  return paraPng(canvas);
}

/** Nome do arquivo da arte: "story-03-titulo.png". */
export function nomeDaArte(story: Pick<Story, "ordem" | "titulo" | "texto_na_tela">): string {
  const n = story.ordem < 10 ? `0${story.ordem}` : String(story.ordem);
  return nomeDoArquivo(story.titulo || story.texto_na_tela.slice(0, 40) || "story", `story-${n}`);
}

/** Baixa a arte registrada (o PNG do arquivo do cliente) ou devolve null quando não acha. */
export async function arteRegistrada(fileId: string): Promise<Blob | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db.from("files").select("storage_bucket, storage_path").eq("id", fileId).maybeSingle();
  if (!data || !data.storage_path) return null;
  return baixarDoStorage(String(data.storage_bucket || "mesa"), String(data.storage_path));
}
