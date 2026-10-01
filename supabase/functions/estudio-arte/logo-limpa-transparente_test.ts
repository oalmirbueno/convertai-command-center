/**
 * Frente IDR, revisão de 01/10 (VIFUT e CME, logos reais da casa): a
 * logoLimpa do Estúdio e do selo devolve o PNG já transparente como veio. A
 * versão de 30/09 tirava "franja" sozinha e apagava as pontas claras da
 * bússola da VIFUT e o anel branco da CME, sem prévia. Agora a franja só sai
 * na janela "Limpar fundo" da Mesa Identidade.
 *
 *   npx --yes deno test --allow-env --allow-read supabase/functions/estudio-arte/logo-limpa-transparente_test.ts
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "../_shared/imagescript.ts";
import { logoLimpa } from "../_shared/imagem-local.ts";

type Rgb = [number, number, number];
const MARINHO: Rgb = [20, 40, 100];
const CINZA_CLARO: Rgb = [168, 176, 192];
const BRANCO: Rgb = [255, 255, 255];
const ROSA: Rgb = [214, 70, 130];

/** PNG transparente com antisserrilhado (4x4 por pixel). */
async function png(W: number, H: number, forma: (x: number, y: number) => Rgb | null): Promise<Uint8Array> {
  const im = new Image(W, H);
  const b = im.bitmap;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, r = 0, g = 0, bl = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const c = forma(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
          if (!c) continue;
          n++;
          r += c[0];
          g += c[1];
          bl += c[2];
        }
      }
      const i = (y * W + x) * 4;
      if (!n) continue;
      b[i] = Math.round(r / n);
      b[i + 1] = Math.round(g / n);
      b[i + 2] = Math.round(bl / n);
      b[i + 3] = Math.round((255 * n) / 16);
    }
  }
  return await im.encode(1);
}

const bussola = (x: number, y: number): Rgb | null => {
  const dx = x - 60, dy = y - 60, d = Math.hypot(dx, dy);
  if (dx > 18 && dx < 40 && Math.abs(dy) < 1.5 * (1 - (dx - 18) / 22)) return BRANCO;
  if (dy < -18 && dy > -40 && Math.abs(dx) < 1.5 * (1 - (-dy - 18) / 22)) return CINZA_CLARO;
  if (d < 20) return d > 18 && dy > 8 ? BRANCO : MARINHO;
  return null;
};
const anelBranco = (x: number, y: number): Rgb | null => {
  const d = Math.hypot(x - 50, y - 50);
  return d < 30 ? ROSA : d < 32 ? BRANCO : null;
};

for (const [nome, W, forma] of [["VIFUT (pontas claras e gomo branco)", 120, bussola], ["CME (anel branco chapado)", 100, anelBranco]] as const) {
  Deno.test(`logoLimpa: ${nome} sai como veio`, async () => {
    const bytes = await png(W, W, forma);
    const sem = await logoLimpa(bytes, {});
    assertEquals(sem, bytes, "sem aparar: os mesmos bytes");
    const aparada = await Image.decode(await logoLimpa(bytes, { aparar: true }));
    const original = await Image.decode(bytes);
    // Aparar só tira margem transparente: todo pixel opaco do original continua opaco.
    let opacos = 0, opacosDepois = 0;
    for (let i = 3; i < original.bitmap.length; i += 4) if (original.bitmap[i] === 255) opacos++;
    for (let i = 3; i < aparada.bitmap.length; i += 4) if (aparada.bitmap[i] === 255) opacosDepois++;
    assert(opacos > 0);
    assertEquals(opacosDepois, opacos);
  });
}
