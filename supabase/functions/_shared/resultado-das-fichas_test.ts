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

Deno.test("a capa do vencedor é o título com o resto da capa, não só a primeira linha", async () => {
  const { textoDaCapa } = await import("../base-dos-agentes/index.ts");
  assertEquals(textoDaCapa({ texto_exato: "5 PONTOS\nAntes de trocar a bancada", blocos: [{ papel: "selo", texto: "5 PONTOS" }, { papel: "headline", texto: "Antes de trocar a bancada" }] }), "Antes de trocar a bancada · 5 PONTOS");
  assertEquals(textoDaCapa({ texto_exato: "Deu vontade?" }), "Deu vontade?");
});

Deno.test("post fora da curva de concorrente vira ficha por formato, sem copiar", async () => {
  const { fichasDoConcorrente } = await import("../base-dos-agentes/index.ts");
  const reel = fichasDoConcorrente({ handle: "loja", papel: "concorrente", vezes: 8, formato: "reel", legenda: "E disso a gente entende\nresto", leitura: "" });
  assertEquals(reel.map((f) => f.agente), ["mes.estrategista", "videos.diretor", "roteiros.roteirista"]);
  assert(reel[0].titulo.startsWith("@loja rendeu 8x: E disso a gente entende"));
  assert(reel[0].tecnica.includes("nunca copie"));
  const carrossel = fichasDoConcorrente({ handle: "ref", papel: "referencia", vezes: 7.7, formato: "carrossel", legenda: "", leitura: "lentes coloridas" });
  assertEquals(carrossel.map((f) => f.agente), ["mes.estrategista", "estudio.diretor"]);
});

Deno.test("o aviso da semana conta a origem e lista as carteiras baixas", async () => {
  const { textoDoResumo } = await import("../base-dos-agentes/index.ts");
  const t = textoDoResumo({ novas: { pesquisa: 12, materiais: 3, numeros: 2, concorrentes: 0 }, sairam: 1, referenciasLidas: 18, carteirasBaixas: [{ cliente: "Para Si", saldo: 0.18 }] });
  assert(t.startsWith("Base dos agentes na semana: 17 técnicas novas (12 da pesquisa, 3 do que você mandou, 2 dos posts que renderam)"));
  assert(t.includes("1 ficha saiu por atrapalhar"));
  assert(t.includes("Carteira baixa (pesquisa e leitura param): Para Si US$ 0,18."));
});
