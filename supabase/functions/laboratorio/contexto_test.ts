import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Contexto, entradasMontadas, htmlDaResposta } from "./executar.ts";
import type { Canvas, NoDoCanvas } from "./modulos/regras.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, dados, x: 0, y: 0 });
Deno.test("contexto: a página recebe a copy, a arte e a base anteriores sem exigir fios duplicados", async () => {
  const nos = [no("contexto", "contexto", { texto: "Curso de confeitaria para iniciantes, venda por R$ 97" }), no("produto", "produto", { nome: "Confeitaria em casa", preco: "97" }), no("copy", "copy"), no("arte", "imagem"), no("pagina", "landing")];
  const c: Canvas = { nos, ligacoes: [["contexto", "copy"], ["produto", "copy"], ["copy", "arte"], ["arte", "pagina"]].map(([de, para], i) => ({ id: `l${i}`, de, para })), viewport: { x: 0, y: 0, zoom: 1 } };
  const ctx = { projeto: { contexto: "Campanha de lançamento" }, canvas: c, marca: "", nomeDoCliente: null, saidas: new Map([["copy", { texto: "Seu primeiro bolo pronto para vender" }], ["arte", { imagens: [{ path: "criativo.png", url: "https://exemplo.invalid/criativo.png" }] }]]) } as Contexto;
  const r = await entradasMontadas(ctx, nos[4]);
  assert(r.textos.some((t) => t.includes("iniciantes, venda por R$ 97")));
  assert(r.textos.some((t) => t.includes("Confeitaria em casa")));
  assert(r.textos.some((t) => t.includes("Seu primeiro bolo pronto para vender")));
  assertEquals(r.imagens.map((i) => i.path), ["criativo.png"]);
  assertEquals(r.textos.filter((t) => t.includes("Curso de confeitaria")).length, 1);
});

Deno.test("HTML: uma explicação ou plano nunca conta como landing pronta", async () => {
  const { assertThrows } = await import("https://deno.land/std@0.224.0/assert/mod.ts");
  assertThrows(() => htmlDaResposta("Vou criar uma página com título, checkout e botão."), Error, "não devolveu uma página HTML");
  assert(htmlDaResposta("```html\n<!doctype html><html lang=\"pt-BR\"><body><h1>Curso</h1></body></html>\n```").includes("<h1>Curso</h1>"));
});
