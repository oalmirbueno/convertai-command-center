/**
 * Laboratório v3 (Aceleriq-Laboratorio/clickmax-rea.md): especialistas de criação, perguntas guiadas,
 * regra contra invenção (trava do Pôr no ar) e os 3 templates novos. Sem rede.
 *
 *   deno test supabase/functions/laboratorio/modulos/v3_test.ts
 */
import { assert, assertEquals, assertMatch, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ancestraisDe,
  blocosPendentes,
  blocosSemFonte,
  type Canvas,
  canvasValido,
  chamadasDoNo,
  dadosDoTipo,
  ehExecutavel,
  ehPedidoDeProjetoCompleto,
  ENTRADAS_ACEITAS,
  ErroDoCanvas,
  errosDoCanvas,
  ESQUEMA_DO_PLANEJAR,
  marcadoresSemFonte,
  motivoParaNaoLigar,
  type NoDoCanvas,
  normalizarCanvas,
  NOS_COM_PROVA,
  NOS_ESPECIALISTAS,
  perguntasDoJevSobreOEssencial,
  perguntasQueFaltam,
  resolverBloco,
  TIPOS_DE_NO,
  travaDoNoAr,
} from "./regras.ts";
import { TEMPLATES_OFICIAIS, TEMPLATES_OFICIAIS_V2, TEMPLATES_OFICIAIS_V3, TODOS_OS_TEMPLATES_OFICIAIS } from "./templates.ts";
import {
  BLOCOS_SEM_FONTE,
  ESPECIALISTAS,
  ESQUEMA_DA_COPY,
  ESQUEMA_DA_OFERTA,
  ESQUEMA_DO_ANUNCIO,
  ESQUEMA_DO_FUNIL,
  REGRA_SEM_INVENCAO,
  SISTEMA_DA_LANDING,
  SISTEMA_DA_OFERTA,
  SISTEMA_DO_AGENTE,
  SISTEMA_DO_ANUNCIO,
  SISTEMA_DO_PLANEJAR,
  sistemaDaCopy,
} from "./prompts.ts";
import { perguntasGuiadas } from "../perguntas.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados });
const canvas = (nos: NoDoCanvas[], ligs: Array<[string, string]> = []): Canvas => ({
  nos,
  ligacoes: ligs.map(([de, para], i) => ({ id: `l${i}`, de, para })),
  viewport: { x: 0, y: 0, zoom: 1 },
});

// ------------------------------------------------------------------ nós novos

Deno.test("v3: os 8 especialistas existem, rodam e ligam pesquisa → avatar → oferta → carrinho → página → mensagens → refino", () => {
  const novos = ["avatar", "order_bump", "upsell", "downsell", "sequencia_ofertas", "secoes_pagina", "sequencia_mensagens", "refino_tom"];
  assertEquals([...NOS_ESPECIALISTAS], novos);
  for (const t of novos) {
    assert((TIPOS_DE_NO as readonly string[]).includes(t), t);
    assert(ehExecutavel(t as NoDoCanvas["tipo"]), t);
    assert(NOS_COM_PROVA.includes(t as NoDoCanvas["tipo"]), `${t} marca prova sem fonte`);
  }
  const c = canvas([
    no("c", "contexto"), no("p", "pesquisa"), no("a", "avatar"), no("o", "oferta"), no("ob", "order_bump"), no("up", "upsell"), no("dw", "downsell"),
    no("so", "sequencia_ofertas"), no("sp", "secoes_pagina"), no("l", "landing"), no("sm", "sequencia_mensagens"), no("rt", "refino_tom"), no("cp", "copy"), no("ar", "por_no_ar"), no("lg", "logo"), no("r", "imagem"),
  ]);
  for (const [de, para] of [["p", "a"], ["c", "a"], ["a", "o"], ["o", "ob"], ["ob", "up"], ["up", "dw"], ["dw", "so"], ["so", "sp"], ["sp", "l"], ["l", "sm"], ["sp", "sm"], ["sm", "rt"], ["rt", "cp"], ["rt", "l"], ["sm", "ar"], ["a", "r"], ["rt", "r"], ["ob", "ar"]]) {
    assertEquals(motivoParaNaoLigar(c, de, para), null, `${de} → ${para}`);
  }
  // Logo continua só com texto, config, gravity e mídia; especialista não recebe imagem.
  assertMatch(motivoParaNaoLigar(c, "a", "lg")!, /não entra em Logo/);
  assertMatch(motivoParaNaoLigar(c, "r", "a")!, /não entra em Avatar/);
  assertMatch(motivoParaNaoLigar(c, "sm", "sp")!, /não entra em Seções da página/);
  // Todo tipo na regra de entrada só cita tipos que existem.
  for (const [t, lista] of Object.entries(ENTRADAS_ACEITAS)) for (const x of lista) assert((TIPOS_DE_NO as readonly string[]).includes(x), `${t} ← ${x}`);
});

Deno.test("v3: campos dos especialistas (mensagens 2 a 15, canal e tipo de página fechados) e custo de uma chamada de texto", () => {
  const sm = dadosDoTipo("sequencia_mensagens", { canal: "whatsapp", mensagens: 40, objetivo: "agenda", cor: "x" });
  assertEquals(sm.dados, { canal: "whatsapp", mensagens: 15, objetivo: "agenda" });
  assertEquals(sm.ignorados, ["cor"]);
  assertEquals(dadosDoTipo("sequencia_mensagens", { canal: "sms" }).ignorados, ["canal"]);
  assertEquals(dadosDoTipo("secoes_pagina", { tipo_pagina: "aplicacao" }).dados, { tipo_pagina: "aplicacao" });
  assertEquals(dadosDoTipo("secoes_pagina", { tipo_pagina: "blog" }).ignorados, ["tipo_pagina"]);
  assertEquals(dadosDoTipo("refino_tom", { tom: "próximo e direto" }).dados, { tom: "próximo e direto" });
  for (const t of NOS_ESPECIALISTAS) {
    const ch = chamadasDoNo(canvas([no("x", t, { instrucao: "algo" })]), no("x", t, { instrucao: "algo" }));
    assertEquals(ch.length, 1, t);
    assertEquals(ch[0].tipo, "texto");
    assert(ch[0].tokens_saida >= 1500, t);
  }
  // O planejar pode criar os nós novos.
  const enumDeTipos = ESQUEMA_DO_PLANEJAR.schema.properties.operacoes.items.properties.tipo.enum as readonly string[];
  for (const t of NOS_ESPECIALISTAS) assert(enumDeTipos.includes(t), t);
});

Deno.test("v3: cada especialista tem sistema com a regra contra invenção, esquema com blocos_sem_fonte e texto legível", () => {
  for (const t of NOS_ESPECIALISTAS) {
    const e = ESPECIALISTAS[t as keyof typeof ESPECIALISTAS];
    assert(e.sistema.includes(REGRA_SEM_INVENCAO), t);
    const sc = e.esquema.schema as { required: string[]; properties: Record<string, unknown> };
    assert(sc.required.includes("blocos_sem_fonte"), t);
    assertEquals(sc.properties.blocos_sem_fonte, BLOCOS_SEM_FONTE);
  }
  assertMatch(ESPECIALISTAS.avatar.texto({ resumo: "Donas de confeitaria caseira", dores: ["vender pouco"], desejos: ["renda"], objecoes: ["tempo"], linguagem: { palavras_que_usa: ["encomenda"], como_fala: "informal" } }), /Dores: vender pouco[\s\S]*Objeções: tempo/);
  assertMatch(ESPECIALISTAS.sequencia_mensagens.texto({ mensagens: [{ dia: 0, canal: "whatsapp", objetivo: "boas-vindas", texto: "Oi!" }] }), /Dia 0 \(whatsapp\): boas-vindas\. Oi!/);
  assertMatch(ESPECIALISTAS.secoes_pagina.texto({ secoes: [{ nome: "Topo", papel: "promessa" }], quiz: { perguntas: [{ pergunta: "Fatura quanto?" }], corte: "7 pontos" } }), /1\. Topo: promessa[\s\S]*Quiz de qualificação: Fatura quanto\?\. Corte: 7 pontos/);
  assertEquals(ESPECIALISTAS.sequencia_mensagens.pedido({ mensagens: 99, canal: "email" }).slice(0, 2), ["Quantidade de mensagens: 15.", "Canal: e-mail."]);
  // Os nós antigos que escrevem prova também ganharam a regra e o campo.
  for (const s of [SISTEMA_DA_OFERTA, SISTEMA_DO_ANUNCIO, sistemaDaCopy("landing")]) assert(s.includes(REGRA_SEM_INVENCAO));
  assertMatch(SISTEMA_DO_AGENTE, /NÃO INVENTE PROVA NEM NÚMERO/);
  assertMatch(SISTEMA_DA_LANDING, /\[RASCUNHO SEM FONTE: o que falta\]/);
  for (const e of [ESQUEMA_DA_COPY, ESQUEMA_DA_OFERTA, ESQUEMA_DO_ANUNCIO, ESQUEMA_DO_FUNIL]) assert((e.schema.required as readonly string[]).includes("blocos_sem_fonte"), e.nome);
  assertMatch(SISTEMA_DO_PLANEJAR, /Avatar[\s\S]*Sequência de mensagens[\s\S]*Refino de tom/);
});

// ------------------------------------------------------------------ regra contra invenção

Deno.test("v3: marcador [RASCUNHO SEM FONTE: ...] e blocos declarados viram rascunho_sem_fonte, sem repetir", () => {
  assertEquals(marcadoresSemFonte("Topo. [RASCUNHO SEM FONTE: depoimento de cliente] e [rascunho sem fonte: 87% aprovam]"), [
    { marcador: "[RASCUNHO SEM FONTE: depoimento de cliente]", texto: "depoimento de cliente" },
    { marcador: "[rascunho sem fonte: 87% aprovam]", texto: "87% aprovam" },
  ]);
  const b = blocosSemFonte({
    declarados: [{ tipo: "depoimento", texto: "depoimento de cliente", onde: "Prova" }, { tipo: "garantia", texto: "Garantia de 30 dias", onde: "Oferta" }, { tipo: "x", texto: "" }],
    textos: ["Veja: [RASCUNHO SEM FONTE: depoimento de cliente]", { secoes: [{ conteudo: "[RASCUNHO SEM FONTE: resultado de faturamento]" }] }],
  });
  assertEquals(b.map((x) => [x.id, x.tipo, x.texto, x.confirmado]), [
    ["b1", "depoimento", "depoimento de cliente", false],
    ["b2", "resultado", "resultado de faturamento", false],
    ["b3", "garantia", "Garantia de 30 dias", false],
  ]);
  assertEquals(blocosSemFonte({ textos: ["Sem prova inventada aqui."] }), []);
});

Deno.test("v3: Pôr no ar TRAVA com bloco sem fonte em qualquer nó antes dele; fonte confirmada ou edição destrava", () => {
  const c = canvas([no("o", "oferta"), no("cp", "copy", { titulo: "Copy da página" }), no("l", "landing"), no("ar", "por_no_ar"), no("solto", "copy")], [["o", "cp"], ["cp", "l"], ["l", "ar"]]);
  assertEquals(ancestraisDe(c, "ar"), ["o", "cp", "l"]);
  const copy = { texto: "Clientes amam. [RASCUNHO SEM FONTE: depoimento de cliente]", json: { texto_completo: "Clientes amam. [RASCUNHO SEM FONTE: depoimento de cliente]" }, rascunho_sem_fonte: blocosSemFonte({ textos: ["[RASCUNHO SEM FONTE: depoimento de cliente]"] }) };
  const saidas: Record<string, unknown> = { o: { texto: "ok", rascunho_sem_fonte: [] }, cp: copy, l: { html_path: "x.html" }, solto: { rascunho_sem_fonte: blocosSemFonte({ textos: ["[RASCUNHO SEM FONTE: 99% de aprovação]"] }) } };
  const t = travaDoNoAr(c, "ar", saidas);
  assert(t.travado);
  // O nó solto (não ligado ao Pôr no ar) não conta.
  assertEquals(t.blocos.map((x) => [x.no_id, x.no_rotulo, x.texto]), [["cp", "Copy da página", "depoimento de cliente"]]);
  assertMatch(t.motivo, /Travado: 1 bloco\(s\) de prova ou número sem fonte em Copy da página/);

  // Fonte confirmada (exige dizer de onde vem).
  assertThrows(() => resolverBloco(copy, "b1", { modo: "fonte", fonte: " ", por: "u1", quando: "2026-10-20" }), ErroDoCanvas, "Diga de onde vem");
  const comFonte = resolverBloco(copy, "b1", { modo: "fonte", fonte: "Print do WhatsApp da cliente Ana, autorizado", por: "u1", quando: "2026-10-20" });
  assertEquals(blocosPendentes(comFonte.saida), []);
  assertEquals(comFonte.bloco.como, "fonte");
  assertEquals(travaDoNoAr(c, "ar", { ...saidas, cp: comFonte.saida }).travado, false);

  // Editar troca o marcador em toda a saída (texto e json) e destrava.
  const editado = resolverBloco(copy, "b1", { modo: "editar", texto: "Atendimento no mesmo dia.", por: "u1", quando: "2026-10-20" });
  assertEquals(editado.trocado, "[RASCUNHO SEM FONTE: depoimento de cliente]");
  assertEquals(editado.saida.texto, "Clientes amam. Atendimento no mesmo dia.");
  assertEquals((editado.saida.json as Record<string, string>).texto_completo, "Clientes amam. Atendimento no mesmo dia.");
  assertEquals(travaDoNoAr(c, "ar", { ...saidas, cp: editado.saida }).travado, false);
  assertThrows(() => resolverBloco(copy, "b9", { modo: "fonte", fonte: "xyz", por: "u1", quando: "" }), ErroDoCanvas, "não está mais");
});

// ------------------------------------------------------------------ perguntas guiadas

Deno.test("v3: perguntas guiadas: o Jev decide (4 Noul juntas); sem Jev vale a pista do texto; até 4, com exemplos", async () => {
  const q = perguntasDoJevSobreOEssencial();
  assertEquals(Object.keys(q), ["produto", "publico", "preco", "objetivo"]);
  for (const k of Object.keys(q)) {
    assertEquals(q[k].type, "noul");
    assertMatch(q[k].instructions, /`pedido`/);
  }
  // Jev: público e objetivo faltam.
  const comJev = await perguntasGuiadas(
    { pedido: "Quero montar um produto low ticket de confeitaria a R$ 47" },
    {
      perguntar: async (estado, perguntas) => {
        assertEquals(Object.keys(perguntas).length, 4);
        assertEquals((estado as { pedido: string }).pedido, "Quero montar um produto low ticket de confeitaria a R$ 47");
        return { answers: { produto: { noul: 0.92 }, publico: { noul: 0.2 }, preco: { noul: 0.97 }, objetivo: { noul: 0.3 } }, usage: { input_tokens: 300 }, modelo: "jev-latest" };
      },
      cobrar: async () => 0.0004,
    },
  );
  assertEquals(comJev.fonte, "jev");
  assertEquals(comJev.custo_usd, 0.0004);
  assertEquals(comJev.perguntas.map((p) => p.id), ["publico", "objetivo"]);
  for (const p of comJev.perguntas) assert(p.exemplos.length >= 2 && p.pergunta.indexOf("?") > 0);

  // Jev fora do ar: a pista do texto decide (nada trava o pedido).
  const semJev = await perguntasGuiadas({ pedido: "Quero montar uma empresa do zero" }, { perguntar: async () => { throw new Error("jev fora"); } });
  assertEquals(semJev.fonte, "pista");
  assertEquals(semJev.perguntas.map((p) => p.id), ["produto", "publico", "preco", "objetivo"]);
  // Pedido completo: nada a perguntar.
  assertEquals(perguntasQueFaltam("Curso de confeitaria para mulheres que querem renda extra, R$ 97, para vender direto no anúncio", null), []);
  // As respostas do dono entram na conta.
  assertEquals(perguntasQueFaltam("Quero um funil.\nRESPOSTAS: consultoria para donos de restaurante, R$ 3.000, agendar calls", null), []);
  assert(ehPedidoDeProjetoCompleto("quero um high ticket com aplicação") && ehPedidoDeProjetoCompleto("montar um webinar de vendas"));
});

// ------------------------------------------------------------------ templates

Deno.test("v3: os 3 templates novos (high ticket, lançamento, webinar) são canvas válidos, com ids únicos e Pôr no ar no fim", () => {
  assertEquals(TEMPLATES_OFICIAIS_V3.map((t) => t.nome), ["High ticket com aplicação", "Lançamento", "Webinar"]);
  // Ids únicos em todos os oficiais (a v4 soma os dela: modulos/v4_test.ts).
  assertEquals(new Set(TODOS_OS_TEMPLATES_OFICIAIS.map((t) => t.id)).size, TODOS_OS_TEMPLATES_OFICIAIS.length);
  assert(TODOS_OS_TEMPLATES_OFICIAIS.length >= TEMPLATES_OFICIAIS.length + TEMPLATES_OFICIAIS_V2.length + 3);
  const tem = (t: (typeof TEMPLATES_OFICIAIS_V3)[number], tipos: string[]) => tipos.every((x) => t.canvas.nos.some((n) => n.tipo === x));
  for (const t of TEMPLATES_OFICIAIS_V3) {
    assertEquals(errosDoCanvas(normalizarCanvas(t.canvas)), [], t.nome);
    canvasValido(t.canvas);
    const ar = t.canvas.nos.filter((n) => n.tipo === "por_no_ar");
    assert(ar.length >= 2, t.nome);
    // Pôr no ar fica na última coluna.
    const maxX = Math.max(...t.canvas.nos.map((n) => n.x));
    for (const n of ar) assertEquals(n.x, maxX, `${t.nome}: ${n.id}`);
  }
  const [high, lancamento, webinar] = TEMPLATES_OFICIAIS_V3;
  assert(tem(high, ["pesquisa", "avatar", "oferta", "secoes_pagina", "landing", "sequencia_mensagens", "imagem", "anuncio", "por_no_ar"]));
  assertEquals(high.canvas.nos.find((n) => n.tipo === "secoes_pagina")!.dados.tipo_pagina, "aplicacao");
  assert(tem(lancamento, ["sequencia_mensagens", "secoes_pagina", "landing", "order_bump", "upsell", "por_no_ar"]));
  assertEquals(lancamento.canvas.nos.filter((n) => n.tipo === "landing").length, 2);
  assert(tem(webinar, ["secoes_pagina", "landing", "sequencia_mensagens", "agente", "oferta", "por_no_ar"]));
  assertEquals(webinar.canvas.nos.find((n) => n.tipo === "secoes_pagina")!.dados.tipo_pagina, "inscricao");
});
