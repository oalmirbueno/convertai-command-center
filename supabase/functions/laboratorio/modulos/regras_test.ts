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
} from "./regras.ts";
import { TEMPLATES_OFICIAIS } from "./templates.ts";
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
  assertThrows(() => canvasValido({ nos: [{ id: "a", tipo: "video" }], ligacoes: [] }), ErroDoCanvas);
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
      { op: "criar", tipo: "video" },
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
  assertEquals(r.por_no.map((p) => [p.no_id, p.custo_usd]), [["r", 0.3], ["ag", 0.05], ["car", 0.45], ["ext", 0]]);
  assertEquals(r.total_usd, 0.8);
  // A chamada de imagem leva a configuração ligada.
  const ch = chamadasDoNo(c, c.nos[2])[0];
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
