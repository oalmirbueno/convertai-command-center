/**
 * Cópia leve de UMA imagem por chamada (26/09/2026).
 *
 * Por que existe: sem a transformação do Storage, abrir e reduzir fotos grandes
 * dentro de uma geração estourava o limite de 2 s de CPU da função ("CPU Time
 * exceeded" na variação do clone) e mandar o original inteiro passava do limite
 * de 30 MB do provedor. Cada chamada desta função tem o seu próprio limite de
 * CPU: quem precisa de várias cópias chama uma vez por imagem, em paralelo.
 *
 * Entrada: { bucket, caminho }. Grava ao lado do original, sem apagar nada:
 * - `<caminho>.media.jpg`: lado maior até 2048 px (sempre, mesmo quando o
 *   original é menor: PNG de 1536 px vira um JPEG de poucas centenas de KB);
 * - `<caminho>.mini.jpg`: lado maior 640 px, quando ainda não existe.
 * Imagem com transparência grava as cópias em PNG (mesmo nome), como o painel.
 *
 * Só aceita a chave de serviço (chamada entre funções). Buckets: os do painel.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { dimensoesDoCabecalho, mimeDaImagem } from "../_shared/imagem-local.ts";
import { caminhoDaMedia, caminhoDaMiniatura, LADO_MEDIA, LADO_MINIATURA } from "../_shared/imagem-reduzida.ts";

const BUCKETS = ["files", "mcp-files", "workspace", "mesa"];
/** Acima disto nem abre (12 MP levam ~1,1 s só para abrir). */
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 30 * 1024 * 1024;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function tamanho(l: number, a: number, lado: number) {
  const escala = Math.min(1, lado / Math.max(l, a));
  return { l: Math.max(1, Math.round(l * escala)), a: Math.max(1, Math.round(a * escala)) };
}

function temAlfa(img: Image): boolean {
  // Amostra da borda e do centro: basta um pixel com alfa < 250 para tratar como transparente.
  const pontos: Array<[number, number]> = [];
  const passo = Math.max(1, Math.floor(Math.min(img.width, img.height) / 24));
  for (let x = 1; x <= img.width; x += passo) pontos.push([x, 1], [x, img.height]);
  for (let y = 1; y <= img.height; y += passo) pontos.push([1, y], [img.width, y]);
  pontos.push([Math.ceil(img.width / 2), Math.ceil(img.height / 2)]);
  for (const [x, y] of pontos) if ((img.getPixelAt(x, y) & 0xff) < 250) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  if (!chave || auth !== `Bearer ${chave}`) return json({ error: "nao_autorizado" }, 401);

  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "entrada_invalida" }, 400);
  }
  const bucket = String(corpo.bucket || "");
  const caminho = String(corpo.caminho || "");
  if (BUCKETS.indexOf(bucket) < 0 || !caminho || caminho.indexOf("..") >= 0 || /\.(mini|media)\.jpg$/.test(caminho)) {
    return json({ error: "entrada_invalida" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, chave, { auth: { persistSession: false } });
  const { data, error } = await db.storage.from(bucket).download(caminho);
  if (error || !data) return json({ error: "sem_original" }, 404);
  if (data.size > MAX_BYTES) return json({ error: "grande_demais" }, 413);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mime = mimeDaImagem(bytes);
  if (mime !== "image/jpeg" && mime !== "image/png") return json({ error: "formato", mime }, 415);
  const d = dimensoesDoCabecalho(bytes);
  if (!d || d.largura * d.altura > MAX_PIXELS) return json({ error: "pixels_demais", largura: d?.largura, altura: d?.altura }, 413);

  let img: Image;
  try {
    const aberta = await Image.decode(bytes);
    if (!(aberta instanceof Image)) return json({ error: "formato" }, 415);
    img = aberta;
  } catch {
    return json({ error: "nao_abriu" }, 422);
  }

  const alfa = mime === "image/png" && temAlfa(img);
  const tipo = alfa ? "image/png" : "image/jpeg";
  const codificar = async (i: Image) => (alfa ? await i.encode(1) : await i.encodeJPEG(85));

  const t = tamanho(img.width, img.height, LADO_MEDIA);
  const media = t.l === img.width && t.a === img.height ? img : img.clone().resize(t.l, t.a);
  const bytesMedia = await codificar(media);
  const envios = [
    db.storage.from(bucket).upload(caminhoDaMedia(caminho), new Blob([new Uint8Array(bytesMedia)], { type: tipo }), { contentType: tipo, upsert: true, cacheControl: "86400" }),
  ];
  if (corpo.com_miniatura !== false) {
    const m = tamanho(media.width, media.height, LADO_MINIATURA);
    const mini = media.clone().resize(m.l, m.a);
    envios.push(db.storage.from(bucket).upload(caminhoDaMiniatura(caminho), new Blob([new Uint8Array(await codificar(mini))], { type: tipo }), { contentType: tipo, upsert: true, cacheControl: "86400" }));
  }
  const res = await Promise.all(envios);
  const falhou = res.find((r) => r.error);
  if (falhou) return json({ error: "gravacao", detalhe: String(falhou.error?.message || "") }, 503);
  return json({ ok: true, media: caminhoDaMedia(caminho), largura: media.width, altura: media.height, bytes: bytesMedia.byteLength });
});
