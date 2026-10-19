import { supabase } from "@/integrations/supabase/client";
import { novoIdDaProposta } from "../mesaV4Api";
import { baixarDoStorage, nomeDoArquivo, salvarBlob } from "../instagram/capaDoDestaque";
import { corDaLetra, hexValido, LAYOUT_DO_TEXTO, quebrarEmLinhas, TAMANHO_DO_STORY } from "./layoutDoStory";
import { chamarStories, normalizarStory, type Story } from "./storiesApi";
import type { MarcaDosStories } from "./marcaDosStories";

/**
 * A arte do story montada no navegador (1080 x 1920, sem custo), com a mesma
 * técnica das capas de destaque (capaDoDestaque.ts): a foto real do acervo
 * recortada para cobrir a tela, intacta (sem filtro, sem escurecer), e por
 * cima só o texto pedido, na fonte e nas cores da marca. Sem foto, a cor da
 * marca. A área do adesivo fica livre: o adesivo entra no app.
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

/**
 * Sobe o PNG no bucket mesa (em <cliente>/stories/) e avisa a função
 * (registrar_arte com o caminho): ela guarda a arte em Arquivos (bucket files,
 * com o sha256 que a publicação automática exige) e liga o arquivo ao story.
 */
export async function subirArteDoStory(o: { clientId: string; story: Story; png: Blob }): Promise<Story> {
  const caminho = `${o.clientId}/stories/${o.story.id}/${novoIdDaProposta()}.png`;
  const envio = await supabase.storage.from("mesa").upload(caminho, o.png, { contentType: "image/png", upsert: false });
  if (envio.error) throw envio.error;
  const r = await chamarStories<{ story: unknown }>("registrar_arte", o.clientId, { id: o.story.id, caminho });
  if (!r || !r.story) throw new Error("A função não confirmou a arte. Gere de novo.");
  return normalizarStory(r.story);
}

/** Baixa a arte registrada (o PNG do arquivo do cliente) ou devolve null quando não acha. */
export async function arteRegistrada(fileId: string): Promise<Blob | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db.from("files").select("storage_bucket, storage_path").eq("id", fileId).maybeSingle();
  if (!data || !data.storage_path) return null;
  return baixarDoStorage(String(data.storage_bucket || "mesa"), String(data.storage_path));
}

/** A foto do acervo do story, baixada (null: fundo de cor ou foto que saiu do acervo). */
export async function fotoDoStory(story: Pick<Story, "fundo">, marca: Pick<MarcaDosStories, "foto">): Promise<Blob | null> {
  if (story.fundo.tipo !== "foto") return null;
  const f = marca.foto(story.fundo.imagem_id);
  if (!f) return null;
  return baixarDoStorage(f.storage_bucket || "mesa", f.storage_path);
}

/** Monta, sobe e registra a arte de um story (o "Gerar artes", um por vez). */
export async function gerarArteDoStory(o: { clientId: string; story: Story; marca: MarcaDosStories }): Promise<Story> {
  const png = await montarArteDoStory(o.story, { paleta: o.marca.paleta, familia: o.marca.familia }, await fotoDoStory(o.story, o.marca));
  return subirArteDoStory({ clientId: o.clientId, story: o.story, png });
}

/** "Baixar arte" (caminho pelo app): a arte registrada (arte_url do painel ou o arquivo); sem ela, monta na hora. */
export async function baixarArteDoStory(story: Story, marca: MarcaDosStories): Promise<void> {
  let png: Blob | null = null;
  if (story.arte_url) {
    try {
      const r = await fetch(story.arte_url);
      png = r.ok ? await r.blob() : null;
    } catch {
      png = null;
    }
  }
  if (!png && story.file_id) {
    try {
      png = await arteRegistrada(story.file_id);
    } catch {
      png = null;
    }
  }
  if (!png) png = await montarArteDoStory(story, { paleta: marca.paleta, familia: marca.familia }, await fotoDoStory(story, marca));
  salvarBlob(png, nomeDaArte(story));
}
