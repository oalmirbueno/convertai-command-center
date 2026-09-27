/**
 * AB2 (26/09): atalho da média de área da copias-leves. A metade por bloco 2x2
 * tem de dar a mesma média de área que reduzirPorArea na razão exata 2, sem
 * escurecer a borda transparente; o atalho só divide enquanto sobra o dobro.
 *
 *   deno test --allow-net=deno.land supabase/functions/_shared/metade-por-bloco_test.ts
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { metadePorBloco, reduzirPorArea, reduzirPorAreaRapido } from "./imagem-local.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function listrada(l: number, a: number): Image {
  const img = new Image(l, a);
  const b = img.bitmap;
  for (let y = 0; y < a; y++) {
    for (let x = 0; x < l; x++) {
      const i = (y * l + x) * 4;
      b[i] = (x * 37 + y * 11) & 255;
      b[i + 1] = (x * 5 + y * 29) & 255;
      b[i + 2] = (x ^ y) & 255;
      b[i + 3] = 255;
    }
  }
  return img;
}

Deno.test("metadePorBloco = reduzirPorArea na razão 2 (diferença de arredondamento no máximo 1)", () => {
  const img = listrada(64, 48);
  const a = metadePorBloco(img);
  const b = reduzirPorArea(img, 32, 24);
  assert(a.width === 32 && a.height === 24, `tamanho ${a.width}x${a.height}`);
  let pior = 0;
  for (let i = 0; i < a.bitmap.length; i++) pior = Math.max(pior, Math.abs(a.bitmap[i] - b.bitmap[i]));
  assert(pior <= 1, `diferença máxima ${pior}`);
});

Deno.test("metadePorBloco não escurece a borda da logo transparente", () => {
  const img = new Image(4, 2);
  // Bloco da esquerda: 1 pixel branco opaco + 3 transparentes (preto com alfa 0).
  img.bitmap.set([255, 255, 255, 255], 0);
  const m = metadePorBloco(img);
  const [r, g, bl, al] = m.bitmap.slice(0, 4);
  assert(r === 255 && g === 255 && bl === 255, `cor ${r},${g},${bl}`);
  assert(al === 64, `alfa ${al}`);
  const [, , , a2] = m.bitmap.slice(4, 8);
  assert(a2 === 0, `bloco vazio alfa ${a2}`);
});

Deno.test("metadePorBloco aceita lado ímpar (a última coluna e linha repetem)", () => {
  const m = metadePorBloco(listrada(7, 5));
  assert(m.width === 3 && m.height === 2, `tamanho ${m.width}x${m.height}`);
});

Deno.test("reduzirPorAreaRapido chega ao tamanho pedido e só divide enquanto sobra o dobro", () => {
  const r = reduzirPorAreaRapido(listrada(900, 600), 200, 133);
  assert(r.width === 200 && r.height === 133, `tamanho ${r.width}x${r.height}`);
  const img = listrada(300, 200);
  const perto = reduzirPorAreaRapido(img, 200, 133);
  const direto = reduzirPorArea(img, 200, 133);
  let igual = true;
  for (let i = 0; i < perto.bitmap.length; i++) if (perto.bitmap[i] !== direto.bitmap[i]) igual = false;
  assert(igual, "abaixo do dobro deve ser a mesma média de área de antes");
});
