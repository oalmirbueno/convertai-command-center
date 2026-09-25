/**
 * Logo da AcelerIQ (26/09): "Aceler" branco + "iq" verde em PNG transparente.
 * Mede em pixels que a logo com parte branca é clara, que as cores saem e que
 * o anexo achatado tem o fundo cinza-escuro com a logo inteira por cima, em
 * poucos milissegundos (limite de 2 s de CPU por chamada).
 *
 *   deno test --allow-net=deno.land supabase/functions/_shared/logo-contraste_test.ts
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { analisarLogo, logoSobreContraste } from "./imagem-local.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function logoSintetica(): Promise<Uint8Array> {
  // 512 x 150, transparente; metade esquerda branca ("Aceler"), faixa verde à direita ("iq").
  const img = new Image(512, 150);
  img.fill(0x00000000);
  for (let y = 40; y < 110; y++) {
    for (let x = 20; x < 330; x++) img.setPixelAt(x + 1, y + 1, 0xffffffff);
    for (let x = 360; x < 490; x++) img.setPixelAt(x + 1, y + 1, 0x00d52bff);
  }
  return await img.encode(1);
}

Deno.test("logo com letras brancas e verdes é clara e tem as duas cores", async () => {
  const m = await analisarLogo(await logoSintetica());
  assert(m.clara === true, `clara esperada, veio ${JSON.stringify(m)}`);
  assert((m.cores ?? []).length === 2, `2 cores esperadas, veio ${JSON.stringify(m.cores)}`);
  assert((m.cores ?? [])[0] === "#FFFFFF", `branco primeiro, veio ${JSON.stringify(m.cores)}`);
});

Deno.test("logo achatada: fundo cinza-escuro liso com margem e a logo inteira por cima, rápido", async () => {
  const bytes = await logoSintetica();
  const t0 = performance.now();
  const achatada = await logoSobreContraste(bytes, true);
  const ms = performance.now() - t0;
  const img = await Image.decode(achatada) as Image;
  assert(img.width > 512 && img.height > 150, `margem esperada, veio ${img.width} x ${img.height}`);
  const canto = Image.colorToRGBA(img.getPixelAt(1, 1));
  assert(canto[0] === 0x2b && canto[1] === 0x2b && canto[2] === 0x2b && canto[3] === 255, `fundo #2B2B2B opaco, veio ${canto}`);
  const margem = Math.round(512 * 0.12);
  const branco = Image.colorToRGBA(img.getPixelAt(margem + 100, margem + 70));
  assert(branco[0] === 255 && branco[1] === 255 && branco[2] === 255, `letra branca visível, veio ${branco}`);
  assert(ms < 500, `achatar levou ${Math.round(ms)} ms`);
  console.log(`logoSobreContraste: ${Math.round(ms)} ms, ${img.width} x ${img.height}`);
});
