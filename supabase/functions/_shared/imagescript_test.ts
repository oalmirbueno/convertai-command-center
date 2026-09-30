/**
 * FN-08 (30/09/2026): a cópia local do imagescript sai com os mesmos bytes do
 * imagescript@1.3.0 de deno.land e não faz nenhum download.
 *
 * Os valores esperados foram medidos com o imagescript de deno.land na mesma
 * imagem (3 rodadas, todas iguais). Roda sem permissão de rede:
 *   deno test supabase/functions/_shared/imagescript_test.ts
 */
import { Image } from "./imagescript.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function sha(b: Uint8Array | Uint8ClampedArray): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)));
  return Array.from(h).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** A mesma imagem da medição (1600 x 1200, colunas coloridas a cada 7 px). */
function imagemDaMedicao(): InstanceType<typeof Image> {
  const img = new Image(1600, 1200);
  for (let y = 1; y <= 1200; y += 1) {
    for (let x = 1; x <= 1600; x += 7) img.setPixelAt(x, y, Image.rgbaToColor((x * 3) & 255, (y * 5) & 255, ((x + y) * 2) & 255, 255));
  }
  return img;
}

Deno.test("mesmos bytes do imagescript de deno.land: JPEG 85, PNG, decodificar e reduzir", async () => {
  const pedidos: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) => {
    pedidos.push(String(u));
    return original(u, i);
  }) as typeof fetch;
  try {
    const img = imagemDaMedicao();
    const jpg = await img.encodeJPEG(85);
    const png = await img.encode(1);
    const dj = await Image.decode(jpg);
    const dp = await Image.decode(png);
    assert(dj instanceof Image && dp instanceof Image, "decodificar devolveu outra classe");
    const reduzida = await (dj as InstanceType<typeof Image>).clone().resize(640, Image.RESIZE_AUTO).encodeJPEG(85);
    assert((await sha(jpg)) === "7b3f0122d6d37e61", `JPEG mudou: ${await sha(jpg)}`);
    assert((await sha(png)) === "718d909e28de8db5", `PNG mudou: ${await sha(png)}`);
    assert((await sha((dj as InstanceType<typeof Image>).bitmap)) === "70066ad92f322885", "JPEG decodificado mudou");
    assert((await sha((dp as InstanceType<typeof Image>).bitmap)) === "d9331bc434d090d4", "PNG decodificado mudou");
    assert((await sha(reduzida)) === "fd90774af59fdf61", "redução mudou");
    assert(pedidos.length === 0, `baixou: ${pedidos.join(", ")}`);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("jpegSobreBranco (documentos) dá os mesmos bytes da composição que ele substituiu", async () => {
  const { jpegSobreBranco } = await import("./imagem-sob-demanda.ts");
  const img = new Image(120, 80);
  for (let y = 1; y <= 80; y++) for (let x = 1; x <= 120; x++) img.setPixelAt(x, y, Image.rgbaToColor(x * 2, y * 3, 90, (x + y) % 256));
  const png = await img.encode(1);
  const aberta = await Image.decode(png) as InstanceType<typeof Image>;
  const antes = await new Image(aberta.width, aberta.height).fill(0xffffffff).composite(aberta, 0, 0).encodeJPEG(90);
  const agora = await jpegSobreBranco(png, 90);
  assert((await sha(antes)) === (await sha(agora)), "jpegSobreBranco mudou os bytes");
});
