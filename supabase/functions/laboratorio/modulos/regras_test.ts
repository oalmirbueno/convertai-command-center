/**
 * Laboratório: regras puras do canvas (sem rede, custo zero).
 *
 *   deno test supabase/functions/laboratorio/modulos/regras_test.ts
 */
import { assert, assertEquals, assertMatch, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aplicarOperacoes,
  type Canvas,
  canvasValido,
  canvasVazio,
  caminhoNoBucket,
  type Chamada,
  chamadasDoNo,
  ErroDoCanvas,
  errosDoCanvas,
  lerPlano,
  montarPromptDaImagem,
  motivoParaNaoLigar,
  type NoDoCanvas,
  nomeDoArquivo,
  normalizarCanvas,
  ordemTopologica,
  pastasDoLaboratorio,
  somarEstimativa,
  TIPOS_DE_NO,
  gravityDe,
  configDe,
  ACAO_DO_ALVO,
  dadosDoTipo,
  ehExecutavel,
  ehPedidoDeProjetoCompleto,
  ENTRADAS_ACEITAS,
  ETAPA_DO_TIPO,
  ETAPAS_DO_PROJETO,
  formatosDoFilme,
  MAX_NOS_DO_PROJETO_COMPLETO,
  organizarPorEtapas,
} from "./regras.ts";
import { TEMPLATES_OFICIAIS, TEMPLATES_OFICIAIS_V2 } from "./templates.ts";
import { BLOCO_DO_PROJETO_COMPLETO, ESQUEMA_DA_OFERTA, ESQUEMA_DO_FUNIL } from "./prompts.ts";
import { perguntaDaMelhorLogo, promptDaLogo, CAMINHOS_DE_LOGO } from "./prompts.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados });
const canvas = (nos: NoDoCanvas[], ligs: Array<[string, string]> = []): Canvas => ({
  nos,
  ligacoes: ligs.map(([de, para], i) => ({ id: `l${i}`, de, para })),
  viewport: { x: 0, y: 0, zoom: 1 },
});

Deno.test("ligações: aceita as do contrato e recusa as proibidas com motivo", () => {
  const c = canvas([no("c", "contexto"), no("m", "midia"), no("cfg", "config"), no("cfg2", "config"), no("g", "gravity"), no("r", "imagem"), no("l", "logo"), no("a", "anuncio")]);
  assertEquals(motivoParaNaoLigar(c, "c", "r"), null);
  assertEquals(motivoParaNaoLigar(c, "g", "r"), null);
  assertEquals(motivoParaNaoLigar(c, "r", "a"), null);
  // Logo só aceita texto, config, gravity e mídia.
  assertMatch(motivoParaNaoLigar(c, "r", "l")!, /não entra em Logo/);
  assertEquals(motivoParaNaoLigar(c, "cfg", "l"), null);
  // Contexto não recebe nada; nó não liga nele mesmo; nó inexistente.
  assertMatch(motivoParaNaoLigar(c, "r", "c")!, /não recebe entrada/);
  assertMatch(motivoParaNaoLigar(c, "r", "r")!, /nele mesmo/);
  assertMatch(motivoParaNaoLigar(c, "x", "r")!, /não existe/);
  // Só uma configuração por destino.
  const c2 = canvas(c.nos, [["cfg", "r"]]);
  assertMatch(motivoParaNaoLigar(c2, "cfg2", "r")!, /já tem Configurações/);
  // Repetida.
  assertMatch(motivoParaNaoLigar(c2, "cfg", "r")!, /já estão ligados/);
});

Deno.test("ligações: laço recusado", () => {
  const c = canvas([no("a1", "agente"), no("a2", "agente"), no("a3", "agente")], [["a1", "a2"], ["a2", "a3"]]);
  assertMatch(motivoParaNaoLigar(c, "a3", "a1")!, /laço/);
});

Deno.test("ordem topológica: segue as ligações e recusa ciclo", () => {
  const c = canvas([no("r", "imagem"), no("c", "contexto"), no("ag", "agente"), no("an", "anuncio")], [["c", "ag"], ["ag", "r"], ["r", "an"], ["c", "r"]]);
  const ordem = ordemTopologica(c);
  assert(ordem.indexOf("c") < ordem.indexOf("ag"));
  assert(ordem.indexOf("ag") < ordem.indexOf("r"));
  assert(ordem.indexOf("r") < ordem.indexOf("an"));
  // Com alvo: só ele e o que vem antes.
  assertEquals(ordemTopologica(c, ["ag"]), ["c", "ag"]);
  // Ciclo (gravado à força, sem passar pela validação): recusado com os nós presos.
  const comCiclo = canvas([no("a1", "agente"), no("a2", "agente")], [["a1", "a2"], ["a2", "a1"]]);
  const erro = assertThrows(() => ordemTopologica(comCiclo), ErroDoCanvas);
  assertEquals((erro as ErroDoCanvas).codigo, "ciclo");
  assertEquals((erro as ErroDoCanvas).erros.sort(), ["a1", "a2"]);
});

Deno.test("canvas: normaliza a forma do React Flow e valida limites e tipos", () => {
  const c = normalizarCanvas({
    nodes: [{ id: "n1", type: "contexto", position: { x: 10, y: 20 }, data: { texto: "oi" }, selected: true }, { id: "n2", type: "imagem", position: { x: 1, y: 2 }, data: {} }],
    edges: [{ id: "e1", source: "n1", target: "n2" }],
  });
  assertEquals(c.nos[0], { id: "n1", tipo: "contexto", x: 10, y: 20, dados: { texto: "oi" } });
  assertEquals(c.ligacoes[0], { id: "e1", de: "n1", para: "n2" });
  assertEquals(errosDoCanvas(c), []);
  // "video" virou nó na v4: o tipo desconhecido aqui é outro.
  assertThrows(() => canvasValido({ nos: [{ id: "a", tipo: "holograma" }], ligacoes: [] }), ErroDoCanvas);
  const muitos = { nos: Array.from({ length: 81 }, (_, i) => ({ id: `n${i}`, tipo: "contexto" })), ligacoes: [] };
  assertMatch(errosDoCanvas(normalizarCanvas(muitos))[0], /80 nós/);
  const invalida = { nos: [{ id: "i", tipo: "imagem" }, { id: "l", tipo: "logo" }], ligacoes: [{ id: "x", de: "i", para: "l" }] };
  const e = assertThrows(() => canvasValido(invalida), ErroDoCanvas) as ErroDoCanvas;
  assertMatch(e.erros[0], /Resultado não entra em Logo/);
});

Deno.test("prompt do Resultado: base comum (gravity) primeiro, depois pedido, textos, marca e quadro", () => {
  const c = canvas([no("g", "gravity", { prompt_base: "Paleta verde e luz suave", referencias: [{ path: "global/x.png" }] }), no("cfg", "config", { proporcao: "9:16", quantidade: 3 }), no("r", "imagem", { prompt: "Produto na mesa" })], [["g", "r"], ["cfg", "r"]]);
  const r = c.nos[2];
  const gravity = gravityDe(c, r);
  const cfg = configDe(c, r);
  assertEquals(cfg.proporcao, "9:16");
  assertEquals(cfg.quantidade, 3);
  const p = montarPromptDaImagem({ pedido: "Produto na mesa", textos: ["Oferta: 20% off"], gravity, config: cfg, marca: "Cliente: Loja X" });
  assert(p.indexOf("BASE COMUM") === 0);
  assert(p.indexOf("Paleta verde e luz suave") < p.indexOf("Produto na mesa"));
  assert(p.indexOf("Produto na mesa") < p.indexOf("Oferta: 20% off"));
  assert(p.indexOf("Loja X") > 0);
  assertMatch(p, /9:16/);
  assertMatch(p, /referência visual/);
  // Sem gravity, não fala em base comum.
  assert(montarPromptDaImagem({ pedido: "x" }).indexOf("BASE COMUM") < 0);
});

Deno.test("planejar: operações validadas com recibo; gerar e ligação proibida recusadas", () => {
  const { resposta, operacoes } = lerPlano({
    resposta: "Montei.",
    operacoes: [
      { op: "criar", ref: "ctx", tipo: "contexto", dados_json: JSON.stringify({ texto: "Black Friday", senha: "x" }) },
      { op: "criar", ref: "res", tipo: "imagem", dados_json: JSON.stringify({ quantidade: 9, proporcao: "4:5" }) },
      { op: "criar", ref: "logo", tipo: "logo", dados_json: "{}" },
      { op: "ligar", de: "ctx", para: "res" },
      { op: "ligar", de: "res", para: "logo" },
      { op: "gerar", no: "res" },
      { op: "criar", tipo: "holograma" },
      { op: "definir", no: "res", dados_json: JSON.stringify({ prompt: "Arte do feed" }) },
      { op: "organizar" },
    ],
  }, "");
  assertEquals(resposta, "Montei.");
  const r = aplicarOperacoes(canvasVazio(), operacoes);
  const aceitas = r.recibos.filter((x) => x.aceita).map((x) => x.op);
  assertEquals(aceitas, ["criar", "criar", "criar", "ligar", "definir", "organizar"]);
  const recusas = r.recibos.filter((x) => !x.aceita);
  assertEquals(recusas.length, 3);
  assertMatch(recusas[0].recibo, /não entra em Logo/);
  assertMatch(recusas[1].recibo, /Não gero nem publico/);
  assertMatch(recusas[2].recibo, /Tipo de nó desconhecido/);
  // Campo que o tipo não aceita é ignorado (com aviso); quantidade fica no teto.
  const ctx = r.canvas.nos.find((n) => n.tipo === "contexto")!;
  assertEquals(ctx.dados, { texto: "Black Friday" });
  assertMatch(r.recibos[0].recibo, /Ignorei: senha/);
  const res = r.canvas.nos.find((n) => n.tipo === "imagem")!;
  assertEquals(res.dados, { quantidade: 4, proporcao: "4:5", prompt: "Arte do feed" });
  // O apelido virou id real nas ligações, e o canvas resultante é válido.
  assertEquals(r.canvas.ligacoes.length, 1);
  assertEquals(r.canvas.ligacoes[0].de, ctx.id);
  assertEquals(errosDoCanvas(r.canvas), []);
  // Operação aceita volta com os ids reais.
  assertEquals((r.recibos[3].operacao as { de: string }).de, ctx.id);
  // Organizar põe o Resultado à direita do Contexto.
  assert(res.x > ctx.x);
});

Deno.test("estimar: soma por nó e total; nós estáticos e externos não custam", () => {
  const c = canvas([
    no("c", "contexto", { texto: "x" }),
    no("cfg", "config", { quantidade: 3, qualidade: "alta", motor: "img:teste" }),
    no("r", "imagem"),
    no("ag", "agente", { modelo_id: "txt:teste" }),
    no("car", "carrossel", { laminas: 4, modelo_id: "txt:teste", motor: "img:teste" }),
    no("ext", "agente_externo"),
  ], [["c", "r"], ["cfg", "r"], ["c", "ag"], ["c", "car"]]);
  const preco = (ch: Chamada) => (ch.tipo === "imagem" ? ch.imagens * 0.1 : 0.05);
  const r = somarEstimativa(c, ["c", "cfg", "r", "ag", "car", "ext"], preco);
  // 20/10: Resultado e Carrossel no motor da casa (direção + imagens + conferência de cada lâmina).
  assertEquals(r.por_no.map((p) => [p.no_id, p.custo_usd]), [["r", 0.4], ["ag", 0.05], ["car", 0.5], ["ext", 0]]);
  assertEquals(r.total_usd, 0.95);
  // A chamada de imagem leva a configuração ligada.
  const ch = chamadasDoNo(c, c.nos[2]).find((x) => x.tipo === "imagem")!;
  assertEquals([ch.modelo_id, ch.imagens, ch.qualidade], ["img:teste", 3, "alta"]);
});

Deno.test("saída: caminho no workspace global e pastas Laboratório/<Livres|Cliente>/<projeto>", () => {
  assertEquals(pastasDoLaboratorio(null, "Campanha / Natal"), ["Laboratório", "Livres", "Campanha - Natal"]);
  assertEquals(pastasDoLaboratorio("Padaria Sol", "Logo"), ["Laboratório", "Padaria Sol", "Logo"]);
  const p = caminhoNoBucket("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", 0, "image/png");
  assertEquals(p, "global/laboratorio/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-01.png");
  assertEquals(caminhoNoBucket("p", "e", 2, "text/html"), "global/laboratorio/p/e-03.html");
  assertEquals(nomeDoArquivo("Criativo A", 1, 3, "image/webp"), "Criativo A 02.webp");
  assertEquals(nomeDoArquivo("Landing page", 0, 1, "text/html"), "Landing page.html");
});

Deno.test("templates oficiais: 6, nomes do contrato, canvas válidos e sem ciclo", () => {
  assertEquals(TEMPLATES_OFICIAIS.map((t) => t.nome), ["Carrossel", "Criativos de anúncio", "Logo", "Landing page", "Post + legenda", "Variação de criativos"]);
  for (const t of TEMPLATES_OFICIAIS) {
    assertEquals(errosDoCanvas(normalizarCanvas(t.canvas)), [], t.nome);
    ordemTopologica(t.canvas);
    for (const n of t.canvas.nos) assert((TIPOS_DE_NO as readonly string[]).indexOf(n.tipo) >= 0);
  }
  const anuncio = TEMPLATES_OFICIAIS.find((t) => t.nome === "Criativos de anúncio")!;
  assert(anuncio.canvas.nos.some((n) => n.tipo === "anuncio"));
});

Deno.test("logo: prompt de especialista (símbolo + logotipo, fundo liso, sem mockup) e pergunta do Jev", () => {
  const p = promptDaLogo({ nome: "Sol Nascente", conceito: "padaria de bairro", paleta: "amarelo e marrom" }, CAMINHOS_DE_LOGO[0]);
  assertMatch(p, /"Sol Nascente"/);
  assertMatch(p, /símbolo \+ logotipo/);
  assertMatch(p, /Sem mockup/);
  assertMatch(p, /FUNDO: liso/);
  const q = perguntaDaMelhorLogo([{ apelido: "v1", titulo: "A", descricao: "a" }, { apelido: "v2", titulo: "B", descricao: "b" }]);
  assertEquals(q.melhor.type, "choice");
  assertEquals(Object.keys(q.melhor.criteria), ["v1", "v2"]);
});

// ------------------------------------------------------------------ v2 (ESPEC-LABORATORIO-v2.md)

Deno.test("v2: nós novos, ligações do contrato e Pôr no ar só recebe (ninguém recebe dele)", () => {
  for (const t of ["pesquisa", "oferta", "funil", "filme", "por_no_ar"] as const) {
    assert((TIPOS_DE_NO as readonly string[]).indexOf(t) >= 0, t);
    assert(ehExecutavel(t), t);
  }
  const c = canvas([
    no("c", "contexto"), no("p", "pesquisa"), no("p2", "pesquisa"), no("o", "oferta"), no("f", "funil"), no("cp", "copy"), no("l", "landing"),
    no("i", "imagem"), no("a", "anuncio"), no("fi", "filme"), no("n", "por_no_ar"), no("lg", "logo"), no("g", "gravity"),
  ]);
  // A cadeia do projeto completo vale.
  for (const [de, para] of [["c", "p"], ["p", "p2"], ["p", "o"], ["p", "f"], ["o", "f"], ["o", "cp"], ["f", "cp"], ["f", "l"], ["o", "i"], ["o", "a"], ["i", "a"], ["l", "n"], ["a", "n"], ["fi", "n"], ["o", "fi"], ["lg", "fi"]]) {
    assertEquals(motivoParaNaoLigar(c, de, para), null, `${de} → ${para}`);
  }
  // Ninguém recebe o Pôr no ar; o funil não recebe imagem; logo não recebe pesquisa; base comum não recebe oferta.
  for (const t of TIPOS_DE_NO) assertEquals(ENTRADAS_ACEITAS[t].indexOf("por_no_ar"), -1, t);
  assertMatch(motivoParaNaoLigar(c, "n", "a")!, /não entra em Anúncio/);
  assertMatch(motivoParaNaoLigar(c, "i", "f")!, /não entra em Funil/);
  assertMatch(motivoParaNaoLigar(c, "p", "lg")!, /não entra em Logo/);
  assertMatch(motivoParaNaoLigar(c, "o", "g")!, /não entra em Base comum/);
});

Deno.test("v2: campos dos nós novos (alvo e formato validados; o resto ignorado com aviso)", () => {
  assertEquals(dadosDoTipo("por_no_ar", { alvo: "subir_anuncio_pausado", operador: "default", instrucao: "x", verba: 100 }), { dados: { alvo: "subir_anuncio_pausado", operador: "default", instrucao: "x" }, ignorados: ["verba"] });
  assertEquals(dadosDoTipo("por_no_ar", { alvo: "ativar_campanha" }).ignorados, ["alvo"]);
  assertEquals(dadosDoTipo("filme", { ideia: "a", formato: "9:16" }).dados, { ideia: "a", formato: "9:16" });
  assertEquals(dadosDoTipo("filme", { formato: "anuncio" }).ignorados, ["formato"]);
  assertEquals(dadosDoTipo("copy", { formato: "9:16" }).ignorados, ["formato"]);
  assertEquals(dadosDoTipo("pesquisa", { tema: "t", modelo_id: "m" }).dados, { tema: "t", modelo_id: "m" });
  assertEquals(dadosDoTipo("oferta", { produto: "p", preco: "47 reais" }).dados, { produto: "p", preco: "47 reais" });
  assertEquals(formatosDoFilme(undefined), ["16:9", "9:16"]);
  assertEquals(formatosDoFilme("1:1"), ["1:1"]);
  // action_kind do vocabulário fechado de operator_approvals (anúncio sobe pausado = publicar, nunca ativar).
  // v4: ligar_mensagens = enviar_mensagem (o envio a leads só começa depois do sim do dono).
  assertEquals(ACAO_DO_ALVO, { publicar_site: "publicar", subir_anuncio_pausado: "publicar", conectar_pagina: "alterar_permissoes", ligar_mensagens: "enviar_mensagem", outro: "publicar" });
});

Deno.test("v2: custo dos nós novos (pesquisa com busca na web, filme = storyboards, Pôr no ar de graça) e ordem", () => {
  const c = canvas([no("c", "contexto", { texto: "x" }), no("p", "pesquisa", { modelo_id: "txt:teste" }), no("o", "oferta", { modelo_id: "txt:teste" }), no("f", "funil", { modelo_id: "txt:teste" }), no("fi", "filme", { modelo_id: "txt:teste" }), no("n", "por_no_ar")], [["c", "p"], ["p", "o"], ["o", "f"], ["c", "fi"], ["o", "n"]]);
  const pesquisa = chamadasDoNo(c, c.nos[1]);
  assertEquals(pesquisa.length, 1);
  assertEquals(pesquisa[0].buscas_web, 3);
  assert(pesquisa[0].tokens_entrada > 10_000);
  assertEquals(chamadasDoNo(c, c.nos[4])[0].tokens_saida, 7_000);
  assertEquals(chamadasDoNo(c, c.nos[5]), []);
  const preco = (ch: Chamada) => 0.01 + (ch.buscas_web || 0) * 0.01;
  const r = somarEstimativa(c, ["c", "p", "o", "f", "fi", "n"], preco);
  assertEquals(r.por_no.map((x) => [x.no_id, x.custo_usd]), [["p", 0.04], ["o", 0.01], ["f", 0.01], ["fi", 0.01], ["n", 0]]);
  // Ordem: pesquisa antes da oferta, oferta antes do funil e do Pôr no ar.
  const ordem = ordemTopologica(c);
  assert(ordem.indexOf("p") < ordem.indexOf("o") && ordem.indexOf("o") < ordem.indexOf("f") && ordem.indexOf("o") < ordem.indexOf("n"));
});

Deno.test("v2: o pedido de montar empresa/produto/funil liga o projeto completo; post para a marca não", () => {
  for (const p of ["Quero montar uma empresa de marmitas", "monta um produto low ticket de receitas", "Funil de vendas completo para a clínica", "criar uma marca do zero", "Quero lançar um infoproduto", "planejar o lançamento do curso", "abrir minha loja online"]) {
    assert(ehPedidoDeProjetoCompleto(p), p);
  }
  for (const p of ["criar um post para a marca", "Montar um carrossel sobre a marca", "logo para a padaria", "3 criativos de anúncio", "post de lançamento do produto"]) {
    assertEquals(ehPedidoDeProjetoCompleto(p), false, p);
  }
  assertMatch(BLOCO_DO_PROJETO_COMPLETO, /até 40 nós/);
  assertMatch(BLOCO_DO_PROJETO_COMPLETO, /Pesquisa: contexto, midia, pesquisa/);
});

/** Um projeto completo como o agente devolve: 45 nós pedidos, ligados em cadeia por etapa. */
function planoGrande(): unknown[] {
  const ops: Array<Record<string, unknown>> = [
    { op: "criar", ref: "ctx", tipo: "contexto", dados_json: JSON.stringify({ titulo: "Pedido", texto: "Marmitas fit" }) },
    { op: "criar", ref: "pes", tipo: "pesquisa", dados_json: JSON.stringify({ tema: "mercado de marmitas" }) },
    { op: "criar", ref: "ofe", tipo: "oferta", dados_json: "{}" },
    { op: "criar", ref: "fun", tipo: "funil", dados_json: "{}" },
    { op: "criar", ref: "cpl", tipo: "copy", dados_json: JSON.stringify({ formato: "landing" }) },
    { op: "criar", ref: "lan", tipo: "landing", dados_json: "{}" },
    { op: "criar", ref: "cpa", tipo: "copy", dados_json: JSON.stringify({ formato: "anuncio" }) },
    { op: "criar", ref: "gra", tipo: "gravity", dados_json: JSON.stringify({ prompt_base: "mesma cara" }) },
    { op: "criar", ref: "anu", tipo: "anuncio", dados_json: "{}" },
    { op: "criar", ref: "ar1", tipo: "por_no_ar", dados_json: JSON.stringify({ alvo: "publicar_site" }) },
    { op: "criar", ref: "ar2", tipo: "por_no_ar", dados_json: JSON.stringify({ alvo: "subir_anuncio_pausado" }) },
    { op: "ligar", de: "ctx", para: "pes" }, { op: "ligar", de: "pes", para: "ofe" }, { op: "ligar", de: "ofe", para: "fun" },
    { op: "ligar", de: "ofe", para: "cpl" }, { op: "ligar", de: "fun", para: "cpl" }, { op: "ligar", de: "cpl", para: "lan" },
    { op: "ligar", de: "ofe", para: "cpa" }, { op: "ligar", de: "cpa", para: "anu" },
    { op: "ligar", de: "lan", para: "ar1" }, { op: "ligar", de: "anu", para: "ar2" }, { op: "ligar", de: "lan", para: "ar2" },
  ];
  // 34 criativos a mais (passa de 40 nós no total): os 5 últimos são recusados com recibo.
  for (let i = 0; i < 34; i++) {
    ops.push({ op: "criar", ref: `img${i}`, tipo: "imagem", dados_json: JSON.stringify({ titulo: `Criativo ${i + 1}`, proporcao: "4:5" }) });
    ops.push({ op: "ligar", de: "ofe", para: `img${i}` });
    ops.push({ op: "ligar", de: "gra", para: `img${i}` });
  }
  ops.push({ op: "organizar" });
  return ops;
}

Deno.test("v2: projeto completo monta até 40 nós já ligados, válido e em colunas por etapa", () => {
  const { operacoes } = lerPlano({ resposta: "Montei.", operacoes: planoGrande() }, "");
  const r = aplicarOperacoes(canvasVazio(), operacoes, { projetoCompleto: true });
  assertEquals(r.canvas.nos.length, MAX_NOS_DO_PROJETO_COMPLETO);
  const recusas = r.recibos.filter((x) => !x.aceita);
  // 11 + 34 = 45 pedidos: 5 criativos além do teto e as 10 ligações deles (o nó não existe).
  assertEquals(recusas.filter((x) => x.op === "criar").length, 5);
  assert(recusas.filter((x) => x.op === "criar").every((x) => /para em 40 nós/.test(x.recibo)));
  assertEquals(recusas.filter((x) => x.op === "ligar").length, 10);
  assertEquals(errosDoCanvas(r.canvas), []);
  ordemTopologica(r.canvas);
  // Colunas na ordem das etapas, sem buraco, e nenhuma ligação volta para a esquerda.
  assertEquals(r.colunas.map((x) => x.titulo), ["Pesquisa", "Oferta", "Conteúdo", "Página", "Criativos", "Anúncios", "Pôr no ar"]);
  const xDe = new Map(r.canvas.nos.map((n) => [n.id, n.x]));
  for (const l of r.canvas.ligacoes) assert(xDe.get(l.de)! <= xDe.get(l.para)!, `${l.de} → ${l.para}`);
  const xDoTipo = (t: string) => r.canvas.nos.find((n) => n.tipo === t)!.x;
  assert(xDoTipo("pesquisa") < xDoTipo("oferta") && xDoTipo("oferta") < xDoTipo("copy") && xDoTipo("copy") < xDoTipo("landing"));
  assert(xDoTipo("landing") < xDoTipo("imagem") && xDoTipo("imagem") < xDoTipo("anuncio") && xDoTipo("anuncio") < xDoTipo("por_no_ar"));
  // Base comum fica na coluna dos criativos que ela alimenta.
  assertEquals(xDoTipo("gravity"), xDoTipo("imagem"));
  // Cada "criar" aceito já leva a posição final; "organizar" leva as posições e as colunas.
  const criarPes = r.recibos.find((x) => x.aceita && x.op === "criar" && (x.operacao as { tipo?: string }).tipo === "pesquisa")!.operacao as { ref: string; x: number; y: number };
  const pes = r.canvas.nos.find((n) => n.id === criarPes.ref)!;
  assertEquals([criarPes.x, criarPes.y], [pes.x, pes.y]);
  const org = r.recibos.find((x) => x.op === "organizar")!.operacao as { modo: string; colunas: unknown[]; posicoes: Record<string, unknown> };
  assertEquals(org.modo, "etapas");
  assertEquals(Object.keys(org.posicoes).length, 40);
  // Sem o modo, o mesmo plano organiza por profundidade (v1) e não devolve colunas.
  const simples = aplicarOperacoes(canvasVazio(), operacoes);
  assertEquals(simples.colunas, []);
});

Deno.test("v2: organizar por etapas põe cada tipo na coluna da etapa dele", () => {
  assertEquals(ETAPAS_DO_PROJETO.map((e) => e.titulo), ["Pesquisa", "Oferta", "Conteúdo", "Página", "Criativos", "Anúncios", "Pôr no ar"]);
  for (const t of TIPOS_DE_NO) assert(t in ETAPA_DO_TIPO, t);
  const c = canvas([no("n", "por_no_ar"), no("l", "landing"), no("c", "contexto"), no("cfg", "config"), no("i", "imagem")], [["c", "l"], ["l", "n"], ["cfg", "i"], ["c", "i"], ["i", "n"]]);
  const r = organizarPorEtapas(c);
  const x = (id: string) => r.canvas.nos.find((n) => n.id === id)!.x;
  assert(x("c") < x("l") && x("l") < x("i") && x("i") < x("n"));
  assertEquals(x("cfg"), x("i"));
  assertEquals(r.colunas.map((k) => k.etapa), ["pesquisa", "pagina", "criativos", "no_ar"]);
});

Deno.test("v2: templates oficiais novos são canvas válidos, sem ciclo e organizados por etapa", () => {
  assertEquals(TEMPLATES_OFICIAIS_V2.map((t) => t.nome), ["Produto low ticket do zero", "Funil de vendas completo", "Montar empresa / marca do zero", "Filme da marca"]);
  for (const t of TEMPLATES_OFICIAIS_V2) {
    assertEquals(errosDoCanvas(normalizarCanvas(t.canvas)), [], t.nome);
    ordemTopologica(t.canvas);
    assertEquals(t.canvas, organizarPorEtapas(t.canvas).canvas, t.nome);
    assert(t.canvas.nos.length <= MAX_NOS_DO_PROJETO_COMPLETO, t.nome);
  }
  const low = TEMPLATES_OFICIAIS_V2[0].canvas;
  for (const tipo of ["pesquisa", "oferta", "funil", "copy", "landing", "imagem", "anuncio", "por_no_ar"]) assert(low.nos.some((n) => n.tipo === tipo), tipo);
  assertEquals(low.nos.filter((n) => n.tipo === "imagem").length, 3);
  assert(low.nos.some((n) => n.tipo === "por_no_ar" && n.dados.alvo === "subir_anuncio_pausado"));
  const funil = TEMPLATES_OFICIAIS_V2[1].canvas;
  assertEquals(funil.nos.filter((n) => n.tipo === "landing").length, 2);
  const empresa = TEMPLATES_OFICIAIS_V2[2].canvas;
  for (const tipo of ["pesquisa", "agente", "logo", "landing", "imagem", "por_no_ar"]) assert(empresa.nos.some((n) => n.tipo === tipo), tipo);
  const filme = TEMPLATES_OFICIAIS_V2[3].canvas;
  assertEquals(filme.nos.map((n) => n.tipo), ["contexto", "filme"]);
  // Os ids não colidem com os 6 da v1.
  const ids = new Set([...TEMPLATES_OFICIAIS, ...TEMPLATES_OFICIAIS_V2].map((t) => t.id));
  assertEquals(ids.size, 10);
});

Deno.test("v2: esquemas da oferta e do funil (tudo obrigatório, sem campo livre)", () => {
  assertEquals(ESQUEMA_DA_OFERTA.schema.additionalProperties, false);
  assertEquals([...ESQUEMA_DA_OFERTA.schema.required].sort(), Object.keys(ESQUEMA_DA_OFERTA.schema.properties).sort());
  assertEquals([...ESQUEMA_DO_FUNIL.schema.required].sort(), Object.keys(ESQUEMA_DO_FUNIL.schema.properties).sort());
});
