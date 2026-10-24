/**
 * Lançador de pautas prontas (scripts/lancar-pautas.ts): leitura do JSON, descrição da Agenda, chave
 * idempotente e roteiro do reel, sem rede e sem banco.
 *
 *   deno test -A scripts/lancar-pautas_test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { blocosDoRoteiro, chaveDaPeca, descricaoDaPeca, itemDaProposta, LIMITES, lerPeca } from "./lancar-pautas.ts";

const carrossel = {
  data: "2026-10-31",
  hora: "10:30",
  formato: "carrossel",
  serie: "Perfil que vende",
  titulo: "Três segundos",
  gancho: "Seu cliente decide em 3 segundos.",
  capa: { palavra_gigante: "3 SEGUNDOS", frase: "É o tempo do seu perfil", numero: "3" },
  laminas: [
    { papel: "fato", titulo: "A primeira olhada decide", texto: "Bio, foto e 3 posts.", visual: "Celular na mão", layout: "coluna-esquerda" },
    { papel: "cta", titulo: "Quer o checklist?", texto: "Comente PERFIL.", visual: "", layout: null },
  ],
  legenda: "Legenda.",
  cta: "Comente PERFIL",
  palavra_comentario: "PERFIL",
  hashtags: ["#aceleriq", "marketing"],
  arquivo_capa: "capa.png",
};

Deno.test("carrossel válido: capa como card 1, lâminas numeradas, arquivo_capa só avisa", async () => {
  const r = lerPeca(carrossel, 0);
  assert(r.peca);
  assertEquals(r.erros.length, 1);
  assertStringIncludes(r.erros[0], "AVISO");
  assertEquals(r.peca.hashtags, ["#aceleriq", "#marketing"]);
  const d = descricaoDaPeca(r.peca, await chaveDaPeca(r.peca));
  assertStringIncludes(d, "Série: Perfil que vende");
  assertStringIncludes(d, "Roteiro dos cards:\nCard 1 (capa): 3 / 3 SEGUNDOS / É o tempo do seu perfil");
  assertStringIncludes(d, "Card 2 (fato): A primeira olhada decide / Bio, foto e 3 posts.\n  Ilustração: Celular na mão");
  assertStringIncludes(d, "Card 3 (cta): Quer o checklist?");
  assertStringIncludes(d, "CTA: Comente PERFIL");
  assertStringIncludes(d, "Origem: lançador de pautas, chave lancar-pautas:");
});

Deno.test("erros: data, formato, limites e lâminas", () => {
  const r = lerPeca({ ...carrossel, data: "2026-02-30", formato: "post", titulo: "x".repeat(201) }, 0);
  assertEquals(r.peca, null);
  assert(r.erros.some((e) => e.indexOf("data") >= 0));
  assert(r.erros.some((e) => e.indexOf("formato") >= 0));
  assert(r.erros.some((e) => e.indexOf("titulo passa de 200") >= 0));
  const poucas = lerPeca({ ...carrossel, laminas: [carrossel.laminas[0]] }, 0);
  assert(poucas.erros.some((e) => e.indexOf("de 2 a 19 lâminas") >= 0));
  const zona = lerPeca({ ...carrossel, laminas: [{ ...carrossel.laminas[0], layout: { zona_texto: "meio" } }, carrossel.laminas[1]] }, 0);
  assert(zona.erros.some((e) => e.indexOf("zona_texto") >= 0));
});

Deno.test("chave estável pela data, formato e título", async () => {
  const a = await chaveDaPeca({ data: "2026-10-31", formato: "carrossel", titulo: "Três  Segundos" });
  const b = await chaveDaPeca({ data: "2026-10-31", formato: "carrossel", titulo: "três segundos" });
  assertEquals(a, b);
  assert(/^lancar-pautas:[0-9a-f]{24}$/.test(a));
});

Deno.test("reel: roteiro com cenas vira blocos; descrição longa encurta o roteiro e fica no limite", async () => {
  const blocos = blocosDoRoteiro("[Close]\nFala um.\nTela: Texto\n\nCena: mesa\nFala dois.");
  assertEquals(blocos.length, 2);
  assertEquals(blocos[0], { funcao: "Abertura", fala: "Fala um.", visual: "Close", texto_na_tela: "Texto", broll: "", segundos: 2 });
  assertEquals(blocos[1].visual, "mesa");
  const r = lerPeca({ ...carrossel, formato: "reel", roteiro: "Fala longa. ".repeat(600), laminas: undefined, capa: undefined }, 0);
  assert(r.peca);
  const d = descricaoDaPeca(r.peca, await chaveDaPeca(r.peca));
  assert(d.length <= LIMITES.descricao);
  assertStringIncludes(d, "Caminho do vídeo: Gravar com roteiro");
  assertStringIncludes(d, "Texto cortado para caber na Agenda");
});

Deno.test("espelho da proposta: carrossel com capa e lâminas; reel no caminho gravar", () => {
  const c = lerPeca(carrossel, 0).peca!;
  const ic = itemDaProposta(c, "t1") as { formato: string; cards: Array<{ ordem: number; funcao: string; texto: string }>; task_id: string; copy: string };
  assertEquals(ic.formato, "carrossel");
  assertEquals(ic.cards.map((x) => x.funcao), ["capa", "fato", "cta"]);
  assertEquals(ic.cards[0].texto, "3\n3 SEGUNDOS\nÉ o tempo do seu perfil");
  assertEquals(ic.copy, "Legenda.\n\n#aceleriq #marketing");
  const r = lerPeca({ ...carrossel, formato: "reel", roteiro: "Fala." }, 0).peca!;
  const ir = itemDaProposta(r, "t2") as { formato: string; caminho_video: string; mesa: string };
  assertEquals([ir.formato, ir.caminho_video, ir.mesa], ["video", "gravar", "video"]);
});
