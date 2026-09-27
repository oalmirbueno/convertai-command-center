/**
 * Anti-bug 26/09: vinculos_automaticos abria até 90 imagens numa chamada e
 * caía com "CPU Time exceeded" (logs de 26/09 21:31, corpo com jev:true).
 * Confere o orçamento: uma imagem aberta por vez, o que passa volta PENDENTE,
 * imagem grande demais nem abre, e a mesma impressão de antes para a mesma imagem.
 *
 *   deno test --allow-net=deno.land supabase/functions/mesa-ads/vinculo-imagem_test.ts
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import {
  impressaoDaImagem,
  impressaoNoOrcamento,
  MAX_PIXELS_NA_IMPRESSAO,
  novoOrcamentoDasImpressoes,
  PENDENTE,
} from "./vinculo-imagem.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function png(l: number, a: number): Promise<Uint8Array> {
  const img = new Image(l, a);
  for (let y = 1; y <= a; y++) for (let x = 1; x <= l; x++) img.setPixelAt(x, y, Image.rgbaToColor((x * 5) & 255, (y * 3) & 255, 90, 255));
  return await img.encode(1);
}

/** Cabeçalho PNG com as dimensões pedidas (só o cabeçalho é lido antes de abrir). */
function cabecalhoPng(l: number, a: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, l);
  dv.setUint32(20, a);
  return b;
}

const ocupar = (ms: number) => {
  const fim = performance.now() + ms;
  while (performance.now() < fim) { /* CPU */ }
};

Deno.test("mesma impressão de antes para a mesma imagem", async () => {
  const bytes = await png(120, 150);
  const antes = await impressaoDaImagem(bytes);
  const agora = await impressaoNoOrcamento(bytes, novoOrcamentoDasImpressoes());
  assert(antes && antes === agora, `impressão mudou: ${antes} x ${agora}`);
});

Deno.test("orçamento gasto: o resto volta PENDENTE e as imagens abrem uma por vez", async () => {
  const orcamento = novoOrcamentoDasImpressoes(100);
  let abertasAoMesmoTempo = 0;
  let pico = 0;
  let abertas = 0;
  const calcular = async () => {
    abertasAoMesmoTempo++;
    pico = Math.max(pico, abertasAoMesmoTempo);
    await Promise.resolve();
    ocupar(40);
    abertas++;
    abertasAoMesmoTempo--;
    return "0f0f0f0f0f0f0f0f";
  };
  const bytes = cabecalhoPng(100, 100);
  const r = await Promise.all(Array.from({ length: 10 }, () => impressaoNoOrcamento(bytes, orcamento, calcular)));
  assert(pico === 1, `abriu ${pico} ao mesmo tempo`);
  assert(abertas === 3, `abriu ${abertas} (esperado 3 com 100 ms de orçamento e 40 ms cada)`);
  assert(r.filter((x) => x === PENDENTE).length === 7, `pendentes: ${r.filter((x) => x === PENDENTE).length}`);
  assert(orcamento.gastoMs < 100 + 45, `passou do orçamento mais de uma imagem: ${orcamento.gastoMs}`);
});

Deno.test("imagem acima do teto de pixels nem abre", async () => {
  let abriu = false;
  const lado = Math.ceil(Math.sqrt(MAX_PIXELS_NA_IMPRESSAO)) + 10;
  const r = await impressaoNoOrcamento(cabecalhoPng(lado, lado), novoOrcamentoDasImpressoes(), async () => {
    abriu = true;
    return "x";
  });
  assert(r === null && !abriu, "abriu imagem grande demais");
});

Deno.test("falha ao abrir não trava a fila", async () => {
  const orcamento = novoOrcamentoDasImpressoes();
  const bytes = cabecalhoPng(10, 10);
  const falha = impressaoNoOrcamento(bytes, orcamento, () => Promise.reject(new Error("quebrou")));
  const depois = impressaoNoOrcamento(bytes, orcamento, () => Promise.resolve("ok"));
  let caiu = false;
  await falha.catch(() => (caiu = true));
  assert(caiu && (await depois) === "ok", "a fila parou depois de uma falha");
});

Deno.test("vinculos_automaticos passa o orçamento às impressões e conta o PENDENTE", async () => {
  const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(fonte.indexOf("const orcamento = novoOrcamentoDasImpressoes();") > 0, "sem orçamento na chamada");
  assert(fonte.indexOf("impressaoDoStorage(servico, bucket, resto.join(\"/\"), orcamento)") > 0, "arte sem orçamento");
  assert(fonte.indexOf("impressaoDeUrl(a.imagem_url, orcamento)") > 0, "anúncio sem orçamento");
  assert(fonte.indexOf("if (h === PENDENTE) {") > 0, "PENDENTE não conta como pendente");
  assert(fonte.indexOf("impressaoDaImagem(") < 0, "ainda abre imagem fora do orçamento");
});
