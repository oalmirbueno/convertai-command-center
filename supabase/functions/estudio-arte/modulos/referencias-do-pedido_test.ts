import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escolherPelasNotas, REFERENCIAS_NO_DIRETOR, referenciasDoPedido } from "./referencias-do-pedido.ts";
import type { RespostaJev } from "../../_shared/jev.ts";

const ref = (i: number, papel = "tecnica") => ({ papel, leitura: `técnica ${i}`, tags: [] as string[], i });

Deno.test("com até 10 referências, vão todas, sem chamar o Jev", async () => {
  let chamou = false;
  const r = await referenciasDoPedido([ref(1), ref(2)], "post de oferta", async () => { chamou = true; return {}; });
  assertEquals(r.length, 2);
  assertEquals(chamou, false);
});

Deno.test("com muitas, ficam as de nota maior e até 2 artes publicadas da marca", () => {
  const refs = Array.from({ length: 15 }, (_, i) => ref(i, i === 14 ? "identidade" : "tecnica"));
  const respostas: Record<string, RespostaJev> = {};
  refs.forEach((_, i) => { respostas[`r${i}`] = { score: i === 3 ? 3 : i === 14 ? 0 : 1 }; });
  const escolhidas = escolherPelasNotas(refs, respostas);
  assertEquals(escolhidas.length, REFERENCIAS_NO_DIRETOR);
  assertEquals(escolhidas[0].i, 14);
  assertEquals(escolhidas[1].i, 3);
});

Deno.test("sem o Jev, as 10 mais novas, como antes", async () => {
  const refs = Array.from({ length: 20 }, (_, i) => ref(i));
  const r = await referenciasDoPedido(refs, "post", async () => { throw new Error("fora do ar"); });
  assertEquals(r.map((x) => x.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
