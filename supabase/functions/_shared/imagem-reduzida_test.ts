/**
 * Redução local sem a transformação de imagem do Storage (cota estourada em
 * 26/09/2026). Confere a média de área, o "já cabe sem abrir", o teto de
 * pixels, o recorte na proporção e a ordem cópia do painel → original, e que
 * nenhum download leva opção de transformação.
 *
 *   deno test --allow-net=deno.land supabase/functions/_shared/imagem-reduzida_test.ts
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { recortarNaProporcao, reduzirParaCaber, reduzirPorArea } from "./imagem-local.ts";
import { reduzidaSemTransformacao } from "./imagem-reduzida.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function png(l: number, a: number, cor = 0x3080c0ff): Promise<Uint8Array> {
  const img = new Image(l, a);
  img.fill(cor);
  return await img.encode(1);
}

async function jpeg(l: number, a: number): Promise<Uint8Array> {
  const img = new Image(l, a);
  img.fill(0x808080ff);
  return await img.encodeJPEG(85);
}

type Chamada = { bucket: string; caminho: string; args: number };

/** Storage falso: guarda os objetos por caminho e registra cada download. */
function storageFalso(objetos: Record<string, Uint8Array>) {
  const chamadas: Chamada[] = [];
  const db = {
    storage: {
      from: (bucket: string) => ({
        download: (caminho: string, ...resto: unknown[]) => {
          chamadas.push({ bucket, caminho, args: resto.length });
          const b = objetos[caminho];
          return Promise.resolve(b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } });
        },
      }),
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, chamadas };
}

Deno.test("média de área: cor lisa continua igual e o tamanho sai certo", () => {
  const img = new Image(400, 300);
  img.fill(0x3080c0ff);
  const r = reduzirPorArea(img, 133, 100);
  assert(r.width === 133 && r.height === 100, `tamanho ${r.width}x${r.height}`);
  for (const [x, y] of [[0, 0], [66, 50], [132, 99]]) {
    const i = (y * r.width + x) * 4;
    const px = [r.bitmap[i], r.bitmap[i + 1], r.bitmap[i + 2], r.bitmap[i + 3]];
    assert(px.join() === "48,128,192,255", `pixel ${x},${y} = ${px.join()}`);
  }
});

Deno.test("média de área: borda transparente da logo não escurece (alfa pré-multiplicado)", () => {
  const img = new Image(4, 2);
  img.fill(0x00000000);
  // Metade esquerda branca opaca, direita transparente (preto com alfa 0).
  for (const y of [1, 2]) for (const x of [1, 2]) img.setPixelAt(x, y, 0xffffffff);
  const r = reduzirPorArea(img, 2, 1);
  const esq = [r.bitmap[0], r.bitmap[1], r.bitmap[2], r.bitmap[3]];
  const dir = [r.bitmap[4], r.bitmap[5], r.bitmap[6], r.bitmap[7]];
  assert(esq.join() === "255,255,255,255", `esquerda ${esq.join()}`);
  assert(dir[3] === 0, `direita deve ficar transparente, veio ${dir.join()}`);
});

Deno.test("já cabe: devolve os mesmos bytes sem abrir", async () => {
  const b = await png(800, 600);
  const r = await reduzirParaCaber(b, 1024, 1024);
  assert(r && !r.reduziu && r.bytes === b, "deveria devolver os mesmos bytes");
});

Deno.test("reduz mantendo o formato (JPEG continua JPEG) e sem ampliar", async () => {
  const r = await reduzirParaCaber(await jpeg(1600, 1200), 640, 640);
  assert(r && r.reduziu && r.mime === "image/jpeg", `mime ${r?.mime}`);
  assert(r!.largura === 640 && r!.altura === 480, `tamanho ${r!.largura}x${r!.altura}`);
});

Deno.test("acima do teto de pixels não abre (quem chamou usa o original)", async () => {
  const r = await reduzirParaCaber(await png(3000, 2000), 1024, 1024, { maxPixels: 5_000_000 });
  assert(r === null, "deveria recusar");
});

Deno.test("recorte na proporção: lâmina já 4:5 vai como foi gerada; 2:3 é recortada sem ampliar", async () => {
  const lamina = await png(1088, 1360);
  const igual = await recortarNaProporcao(lamina, 1080, 1350, { folga: 1.5 });
  assert(igual && igual.bytes === lamina && !igual.reduziu, "4:5 deveria voltar igual");
  const r = await recortarNaProporcao(await png(1024, 1536), 1080, 1350, { folga: 1.5 });
  assert(r && r.reduziu && r.largura === 1024 && r.altura === 1280, `recorte ${r?.largura}x${r?.altura}`);
});

Deno.test("prefere a cópia média do painel e nunca pede transformação ao Storage", async () => {
  const media = await jpeg(2048, 1536);
  const { db, chamadas } = storageFalso({ "c/foto.jpg.media.jpg": media, "c/foto.jpg": await jpeg(4032, 3024) });
  const r = await reduzidaSemTransformacao(db, "mesa", "c/foto.jpg", 2000, 2500, { folga: 1.05 });
  assert(r && r.cabe && r.origem === "media" && r.bytes.byteLength === media.byteLength, `origem ${r?.origem}`);
  assert(chamadas.every((c) => c.args === 0), "download com opções (transformação?)");
  assert(!chamadas.some((c) => c.caminho === "c/foto.jpg"), "não deveria baixar o original");
});

Deno.test("caixa pequena usa a miniatura; sem cópia, o original pequeno é reduzido aqui", async () => {
  const mini = await jpeg(640, 480);
  const a = storageFalso({ "c/a.jpg.mini.jpg": mini, "c/a.jpg": await jpeg(1600, 1200) });
  const ra = await reduzidaSemTransformacao(a.db, "mesa", "c/a.jpg", 640, 640);
  assert(ra && ra.origem === "miniatura" && ra.bytes.byteLength === mini.byteLength, `origem ${ra?.origem}`);

  const b = storageFalso({ "c/b.jpg": await jpeg(1600, 1200) });
  const rb = await reduzidaSemTransformacao(b.db, "mesa", "c/b.jpg", 768, 768);
  assert(rb && rb.cabe && rb.origem === "original" && rb.largura === 768 && rb.altura === 576, `original ${rb?.largura}x${rb?.altura}`);
  assert(b.chamadas.every((c) => c.args === 0), "download com opções (transformação?)");
});

Deno.test("original grande demais para a CPU volta sem reduzir (cabe: false)", async () => {
  const grande = await png(3000, 2500);
  const { db } = storageFalso({ "c/g.png": grande });
  const r = await reduzidaSemTransformacao(db, "mesa", "c/g.png", 2000, 2500, { maxPixels: 5_000_000 });
  assert(r && !r.cabe && r.bytes.byteLength === grande.byteLength, "deveria devolver o original sem reduzir");
});

Deno.test("logo só aceita cópia PNG", async () => {
  const { db } = storageFalso({ "c/logo.png.media.jpg": await jpeg(2048, 2048), "c/logo.png": await png(1000, 1000) });
  const r = await reduzidaSemTransformacao(db, "mesa", "c/logo.png", 1024, 1024, { copiaSoEmPng: true });
  assert(r && r.origem === "original" && r.mime === "image/png", `origem ${r?.origem} ${r?.mime}`);
});
