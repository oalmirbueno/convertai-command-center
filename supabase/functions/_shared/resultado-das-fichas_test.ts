import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type DesfechoDaPeca, desfechoDoAds, desfechoDoEstudio, deveSair, pesoDaFicha, resultadosDasFichas, resumoDoResultado, taxaDeAprovacao } from "./resultado-das-fichas.ts";
import { fichasDoVencedor } from "../base-dos-agentes/index.ts";

Deno.test("o desfecho da peça do Estúdio e do Ads", () => {
  assertEquals(desfechoDoEstudio({ entrega_status: "aprovado", entrega_rodada: 1 }), "aprovada");
  assertEquals(desfechoDoEstudio({ entrega_status: "agendado", entrega_rodada: 2 }), "ajustada");
  assertEquals(desfechoDoEstudio({ entrega_status: "reprovado", entrega_rodada: 1 }), "reprovada");
  assertEquals(desfechoDoEstudio({ entrega_status: "aguardando_cliente", entrega_rodada: 1 }), "pendente");
  assertEquals(desfechoDoAds("no_ar"), "aprovada");
  assertEquals(desfechoDoAds("rascunho"), "pendente");
});

Deno.test("cada peça conta uma vez por ficha, com a média dos posts", () => {
  const usos = [
    { ficha_id: "f1", referencia_tipo: "estudio_trabalho", referencia_id: "t1" },
    { ficha_id: "f1", referencia_tipo: "estudio_trabalho", referencia_id: "t1" },
    { ficha_id: "f1", referencia_tipo: "estudio_trabalho", referencia_id: "t2" },
    { ficha_id: "f1", referencia_tipo: "cliente", referencia_id: "c1" },
  ];
  const desfechos = new Map<string, DesfechoDaPeca>([["estudio_trabalho:t1", "aprovada"], ["estudio_trabalho:t2", "ajustada"]]);
  const multiplos = new Map([["estudio_trabalho:t1", 2], ["estudio_trabalho:t2", 1]]);
  const r = resultadosDasFichas(usos, desfechos, multiplos).get("f1")!;
  assertEquals(r, { aprovadas: 1, ajustadas: 1, reprovadas: 0, posts: 2, multiplo: 1.5 });
  assertEquals(taxaDeAprovacao(r), 0.75);
  assertEquals(resumoDoResultado(r), "aprovou 2 de 2 (1 com ajuste) · 2 posts com 1,5x o normal");
});

Deno.test("a ficha que reprova quase sempre sai; a que aprova e rende ganha peso", () => {
  assert(deveSair({ aprovadas: 0, ajustadas: 0, reprovadas: 3, posts: 0, multiplo: null }));
  assert(deveSair({ aprovadas: 2, ajustadas: 0, reprovadas: 0, posts: 3, multiplo: 0.5 }));
  assert(!deveSair({ aprovadas: 1, ajustadas: 0, reprovadas: 1, posts: 0, multiplo: null }));
  assertEquals(pesoDaFicha({ aprovadas: 3, ajustadas: 0, reprovadas: 0, posts: 2, multiplo: 1.6 }), 1);
  assertEquals(pesoDaFicha(null), 0);
});

Deno.test("o post vencedor vira ficha do diretor e do Mês, sem travessão", () => {
  const [diretor, mes] = fichasDoVencedor({ multiplo: 2.34, medida: "alcance", capa: "Três erros do seu anúncio", conceito: "erros comuns", gancho: "Hype: Black Friday", formato: "carrossel", tituloDaPauta: "Erros de anúncio" });
  assertEquals(diretor.agente, "estudio.diretor");
  assert(diretor.titulo.startsWith("Rendeu 2,3x: Três erros"));
  assert(diretor.tecnica.includes("Gancho do momento: Hype: Black Friday"));
  assertEquals(mes.agente, "mes.estrategista");
  assert(!/[–—]/.test(diretor.tecnica + mes.tecnica));
});
