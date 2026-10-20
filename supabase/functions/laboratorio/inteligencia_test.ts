/**
 * Laboratório (20/10/2026): nós inteligentes. fontes_do_cliente, no_preencher, ler_documento, o rodar
 * automático, a mídia de vídeo e o leitor de PDF/Word, sem rede (porta falsa).
 *
 *   deno test --allow-env supabase/functions/laboratorio/inteligencia_test.ts
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Chamador, ErroHttp } from "./comum.ts";
import type { ProjetoDoLab } from "./executar.ts";
import { fontesDoCliente, lerDocumento, noPreencher, type PortaDaInteligencia } from "./inteligencia.ts";
import {
  camposPreenchiveis,
  configDoProjeto,
  decidirAutomatico,
  esquemaDoPreenchimento,
  type FontesDoCliente,
  juntarMidias,
  limparPreenchimento,
  marcaParaATela,
  marcarNumerosSemFonte,
  montarDossie,
  tetoDoAutomatico,
  tetoPedido,
  tipoDaMidia,
} from "./modulos/inteligencia.ts";
import { arquivoDoZip, pareceTexto, textoDoDocx, textoDoPdf } from "./modulos/leitor.ts";
import { CAMPOS_DO_TIPO, dadosDoTipo, midiasDe } from "./modulos/regras.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PROJETO = "22222222-2222-4222-8222-222222222222";
const ch: Chamador = { userId: "u1", token: "t", papeis: ["design"], doChamador: {} as never };

const FONTES: FontesDoCliente = {
  cliente: { id: CLIENTE, nome: "Café X", nicho: "cafeteria" },
  dossie: { resumo: "Cafeteria de bairro em Curitiba. Combo café + pão de queijo por R$ 19.", pontos: ["Torra própria"] },
  marca: { cores: ["#3b2416"], fontes: ["Inter"], tom: "próximo e simples", logo_url: null, nunca: ["usar gíria"] },
  midias: [],
  documentos: [],
  marcas: [],
};

function projeto(dados: Record<string, unknown> = {}): ProjetoDoLab {
  return {
    id: PROJETO,
    nome: "Teste",
    client_id: CLIENTE,
    contexto: null,
    canvas: { nos: [{ id: "c1", tipo: "copy", x: 0, y: 0, dados: { formato: "anuncio", ...dados } }, { id: "k1", tipo: "checkout", x: 0, y: 0, dados: {} }, { id: "m1", tipo: "midia", x: 0, y: 0, dados: {} }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } },
    versao: 1,
    status: "ativo",
    template_de: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

type Registro = { nome: string; args: unknown[] };

function portaFalsa(o: { acesso?: boolean; respostaIa?: unknown; falhaIa?: boolean; documento?: { texto: string; lido: boolean } } = {}) {
  const chamadas: Registro[] = [];
  const reg = (nome: string, ...args: unknown[]) => chamadas.push({ nome, args });
  const porta: PortaDaInteligencia = {
    async garantirAcesso(_ch, clientId) {
      reg("garantirAcesso", clientId);
      if (o.acesso === false) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
    },
    async lerProjeto(_ch, id) {
      reg("lerProjeto", id);
      return projeto();
    },
    async lerFontes(clientId, marcaId) {
      reg("lerFontes", clientId, ...(marcaId ? [marcaId] : []));
      return FONTES;
    },
    async entradasDoNo(_ch, _p, no) {
      reg("entradasDoNo", no.id);
      return ["Oferta: combo café + pão de queijo por R$ 19, entrega no bairro."];
    },
    async modeloRapido() {
      return "txt:rapido";
    },
    async preco() {
      return 0.0021;
    },
    async cobrar(c) {
      reg("cobrar", c);
      return { devolverTudo: async (m: string) => void reg("devolverTudo", m) };
    },
    async texto(t) {
      reg("texto", t);
      if (o.falhaIa) throw new Error("provedor caiu");
      return { texto: "Resumo curto.", json: o.respostaIa ?? {}, custoUsd: 0.0018 };
    },
    async lerDocumento(_ch, _p, arquivo) {
      reg("lerDocumento", arquivo);
      return { ...(o.documento || { texto: "x".repeat(20_000), lido: true }), nome: "briefing.pdf" };
    },
  };
  return { porta, chamadas, nomes: () => chamadas.map((c) => c.nome) };
}

// ------------------------------------------------------------------ fontes_do_cliente

Deno.test("fontes_do_cliente: confere o acesso ao cliente; sem acesso, 403 e nada é lido", async () => {
  const f = portaFalsa({ acesso: false });
  const e = await assertRejects(() => fontesDoCliente(f.porta, ch, { client_id: CLIENTE }), ErroHttp);
  assertEquals((e as ErroHttp).status, 403);
  assertEquals(f.nomes(), ["garantirAcesso"]);
});

Deno.test("fontes_do_cliente: client_id nulo devolve a marca da Aceleriq sem conferir cliente; id ruim é 400", async () => {
  const f = portaFalsa();
  const r = await fontesDoCliente(f.porta, ch, { client_id: null });
  assertEquals(r.status, 200);
  assertEquals(f.chamadas, [{ nome: "lerFontes", args: [null] }]);
  const corpo = await r.json();
  assertEquals(Object.keys(corpo).sort(), ["cliente", "documentos", "dossie", "marca", "marcas", "midias"]);
  const e = await assertRejects(() => fontesDoCliente(portaFalsa().porta, ch, { client_id: "abc" }), ErroHttp);
  assertEquals((e as ErroHttp).status, 400);
});

Deno.test("fontes: dossiê, marca e mídias na forma do contrato", () => {
  const d = montarDossie({ dossie: `[contexto]\n${"Texto do dossiê. ".repeat(200)}`, diferenciais: ["Torra própria", ""], movimentos: [{ quando: "2026-10-18T10:00:00Z", titulo: "Post aprovado" }] })!;
  assert(d.resumo.length <= 1500);
  assert(d.resumo.indexOf("[contexto]") < 0);
  assertEquals(d.pontos, ["Torra própria", "18/10: Post aprovado"]);
  assertEquals(montarDossie({ dossie: null }), null);
  const m = marcaParaATela({ paleta: [{ hex: "#3B2416" }, { hex: "azul" }, { hex: "#3b2416" }], fontes: [{ nome: "Inter" }], tomDeVoz: null, estilo: "simples", regras: "- nunca usar gíria\n- nada de preço riscado" }, "https://x/logo.png")!;
  assertEquals(m, { cores: ["#3b2416"], fontes: ["Inter"], tom: "simples", logo_url: "https://x/logo.png", nunca: ["nunca usar gíria", "nada de preço riscado"] });
  assertEquals(marcaParaATela({ paleta: [], fontes: [] }, null), null);
  assertEquals(tipoDaMidia("video/mp4", "a"), "video");
  assertEquals(tipoDaMidia(null, "foto.JPG"), "imagem");
  assertEquals(tipoDaMidia("application/pdf", "a.pdf"), null);
  const midias = juntarMidias([
    [{ id: "a", tipo: "imagem", url: "u1", miniatura_url: "u1", nome: "a", origem: "acervo", criado_em: "2026-10-01" }],
    [{ id: "b", tipo: "video", url: "u2", miniatura_url: null, nome: "b", origem: "workspace", criado_em: "2026-10-10" }, { id: "a", tipo: "imagem", url: "u1", miniatura_url: null, nome: "a", origem: "x", criado_em: "2026-10-01" }, { id: "c", tipo: "imagem", url: "", miniatura_url: null, nome: "c", origem: "x" }],
  ], 60);
  assertEquals(midias.map((x) => x.id), ["b", "a"]);
});

// ------------------------------------------------------------------ no_preencher

Deno.test("no_preencher: sem confirmado, 409 com o custo e nada é cobrado nem gerado", async () => {
  const f = portaFalsa();
  const e = await assertRejects(() => noPreencher(f.porta, ch, { projeto_id: PROJETO, no_id: "c1", pedido: "anúncio do combo" }), ErroHttp);
  assertEquals((e as ErroHttp).status, 409);
  assertEquals((e as ErroHttp).codigo, "confirmacao_necessaria");
  assertEquals((e as ErroHttp).extra.total_usd, 0.0021);
  assertEquals(f.nomes().filter((n) => n === "cobrar" || n === "texto"), []);
});

Deno.test("no_preencher: só campos do tipo, sem técnico nem link; escolha fora da lista e número sem fonte não passam", async () => {
  const f = portaFalsa({ respostaIa: { formato: "carta", instrucao: "Combo por R$ 19 e 30% de desconto para 3 amigos", titulo: "Combo do dia", modelo_id: "txt:caro", link_pagamento: "https://golpe", explicacao: "Veio da oferta ligada." } });
  const r = await noPreencher(f.porta, ch, { projeto_id: PROJETO, no_id: "c1", pedido: "anúncio do combo", confirmado: true });
  const corpo = await r.json();
  assertEquals(Object.keys(corpo.dados).sort(), ["instrucao", "titulo"]);
  assertEquals(corpo.dados.instrucao, "Combo por R$ 19 e [PREENCHER: número] de desconto para 3 amigos");
  assertEquals(corpo.explicacao, "Veio da oferta ligada.");
  assertEquals(corpo.custo_usd, 0.0018);
  for (const k of Object.keys(corpo.dados)) assert(CAMPOS_DO_TIPO.copy.indexOf(k) >= 0, k);
  assertEquals(f.nomes().indexOf("cobrar") < f.nomes().indexOf("texto"), true);
  // O esquema só pede os campos preenchíveis.
  const t = f.chamadas.find((c) => c.nome === "texto")!.args[0] as { esquema: { schema: { required: string[] } }; mensagem: string };
  assertEquals(t.esquema.schema.required, ["titulo", "formato", "instrucao", "explicacao"]);
  assert(t.mensagem.indexOf("Café X") >= 0 && t.mensagem.indexOf("R$ 19") >= 0);
});

Deno.test("no_preencher: campos pedidos restringem; checkout não preenche link nem gateway; falha devolve os créditos", async () => {
  const f = portaFalsa({ respostaIa: { titulo: "x" } });
  const r = await noPreencher(f.porta, ch, { projeto_id: PROJETO, no_id: "c1", campos: ["titulo", "modelo_id"], confirmado: true });
  assertEquals((await r.json()).campos, ["titulo"]);
  const k = camposPreenchiveis("checkout");
  for (const proibido of ["gateway", "link_pagamento", "order_bump", "upsell", "produto_externo_id", "modelo_id", "auto"]) assert(k.indexOf(proibido) < 0, proibido);
  assertEquals(camposPreenchiveis("midia"), ["titulo"]);
  const falha = portaFalsa({ falhaIa: true });
  await assertRejects(() => noPreencher(falha.porta, ch, { projeto_id: PROJETO, no_id: "c1", confirmado: true }));
  assertEquals(falha.nomes().slice(-1), ["devolverTudo"]);
  const e = await assertRejects(() => noPreencher(portaFalsa().porta, ch, { projeto_id: PROJETO, no_id: "nao", confirmado: true }), ErroHttp);
  assertEquals((e as ErroHttp).status, 404);
});

Deno.test("no_preencher: esquema com escolha fechada e limpeza pela dadosDoTipo", () => {
  const e = esquemaDoPreenchimento("pagina", ["tipo_pagina", "objetivo", "caminho"]);
  assertEquals((e.schema.properties.tipo_pagina as { enum: string[] }).enum.indexOf("vsl") >= 0, true);
  assertEquals((e.schema.properties.objetivo as { enum: string[] }).enum.indexOf("vender") >= 0, true);
  const l = limparPreenchimento("pagina", ["tipo_pagina", "objetivo", "caminho"], { tipo_pagina: "vsl", objetivo: "voar", caminho: "/oferta" }, "");
  assertEquals(l.dados, { tipo_pagina: "vsl", caminho: "/oferta" });
  assertEquals(marcarNumerosSemFonte("Em 3 passos, 87% aprovam", "nada"), "Em 3 passos, [PREENCHER: número] aprovam");
  assertEquals(marcarNumerosSemFonte("Por R$ 47,90", "preço R$ 47,90"), "Por R$ 47,90");
});

// ------------------------------------------------------------------ ler_documento

Deno.test("ler_documento: ler não gasta; texto até 16.000; resumo pede confirmação; sem arquivo, 400", async () => {
  const f = portaFalsa();
  const r = await (await lerDocumento(f.porta, ch, { projeto_id: PROJETO, arquivo: { id: "abc", path: "global/laboratorio/x/entradas/a.pdf" } })).json();
  assertEquals(r.texto.length, 16_000);
  assertEquals(r.resumo, "");
  assertEquals(r.lido, true);
  assertEquals(f.nomes().indexOf("texto"), -1);
  const e = await assertRejects(() => lerDocumento(portaFalsa().porta, ch, { projeto_id: PROJETO, arquivo: { id: "abc" }, resumir: true }), ErroHttp);
  assertEquals((e as ErroHttp).status, 409);
  const ok = await (await lerDocumento(portaFalsa().porta, ch, { projeto_id: PROJETO, arquivo: { id: "abc" }, resumir: true, confirmado: true })).json();
  assertEquals(ok.resumo, "Resumo curto.");
  const sem = await assertRejects(() => lerDocumento(portaFalsa().porta, ch, { projeto_id: PROJETO }), ErroHttp);
  assertEquals((sem as ErroHttp).status, 400);
  const naoLido = await (await lerDocumento(portaFalsa({ documento: { texto: "", lido: false } }).porta, ch, { projeto_id: PROJETO, arquivo: { id: "abc" } })).json();
  assertEquals(naoLido.lido, false);
});

// ------------------------------------------------------------------ automático

Deno.test("automático: só com pedido, nó com auto, teto no projeto e custo dentro do teto", () => {
  assertEquals(decidirAutomatico({ automatico: true, auto: true, custo: 0.4, teto: 0.5 }).ok, true);
  assertEquals(decidirAutomatico({ automatico: true, auto: true, custo: 0.5, teto: 0.5 }).ok, true);
  assert(decidirAutomatico({ automatico: true, auto: true, custo: 0.51, teto: 0.5 }).motivo.indexOf("acima do teto") >= 0);
  assertEquals(decidirAutomatico({ automatico: true, auto: "true", custo: 0.1, teto: 1 }).ok, false);
  assertEquals(decidirAutomatico({ automatico: true, auto: true, custo: 0.1, teto: 0 }).ok, false);
  assertEquals(decidirAutomatico({ automatico: "sim", auto: true, custo: 0.1, teto: 1 }).ok, false);
  assertEquals(tetoDoAutomatico(9), 5);
  assertEquals(tetoDoAutomatico(-1), 0);
  assertEquals(tetoDoAutomatico("2.5"), 2.5);
  assertEquals(tetoPedido(5.01), null);
  assertEquals(tetoPedido("1"), null);
  assertEquals(tetoPedido(1.234), 1.23);
  assertEquals(configDoProjeto({ auto_ate_usd: 3, outro: 1 }), { auto_ate_usd: 3 });
  assertEquals(configDoProjeto(null), { auto_ate_usd: 0 });
});

Deno.test("automático e mídia: todo nó aceita auto booleano; o Mídia aceita até 8 imagens e vídeos mp4/mov/webm", () => {
  assertEquals(dadosDoTipo("copy", { auto: true }).dados, { auto: true });
  assertEquals(dadosDoTipo("copy", { auto: "sim" }).ignorados, ["auto"]);
  const m = midiasDe([
    { id: "1", tipo: "video", url: "u", path: "global/laboratorio/p/entradas/a.mp4", nome: "a.mp4" },
    { id: "2", tipo: "video", path: "global/laboratorio/p/entradas/a.avi", nome: "a.avi" },
    { id: "3", tipo: "imagem", path: "global/laboratorio/p/entradas/b.png" },
    { id: "4", tipo: "som", path: "x.mp3" },
    { id: "5", tipo: "imagem", path: "../../segredo" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, tipo: "video", path: `x/${i}.webm` })),
  ]);
  assertEquals(m.length, 8);
  assertEquals(m.slice(0, 2).map((x) => x.id), ["1", "3"]);
  assertEquals(m[1].nome, "b.png");
  assertEquals(dadosDoTipo("midia", { midias: [{ id: "1", tipo: "video", path: "a.mov" }] }).dados.midias, [{ id: "1", tipo: "video", url: "", path: "a.mov", nome: "a.mov" }]);
});

// ------------------------------------------------------------------ leitor de PDF e Word

const enc = new TextEncoder();
const juntar = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
async function comprimir(b: Uint8Array, formato: "deflate" | "deflate-raw"): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([new Uint8Array(b)]).stream().pipeThrough(new CompressionStream(formato))).arrayBuffer());
}

Deno.test("leitor: PDF simples com texto embutido (sem filtro e FlateDecode); escaneado ou lixo volta vazio", async () => {
  const conteudo = "BT /F1 12 Tf 72 712 Td (Proposta comercial da Cafe X) Tj 0 -14 Td [(Combo ) -300 (cafe e pao de queijo)] TJ T* (por R\\$ 19 \\(promocional\\)) Tj ET";
  const simples = enc.encode(`%PDF-1.4\n1 0 obj << /Length ${conteudo.length} >> stream\n${conteudo}\nendstream endobj\n%%EOF`);
  const t = await textoDoPdf(simples);
  assert(t.indexOf("Proposta comercial da Cafe X") >= 0, t);
  assert(t.indexOf("Combo  cafe e pao de queijo") >= 0 || t.indexOf("Combo cafe e pao de queijo") >= 0, t);
  assert(t.indexOf("por R$ 19 (promocional)") >= 0, t);
  const z = await comprimir(enc.encode(conteudo), "deflate");
  const flate = juntar(enc.encode(`%PDF-1.5\n1 0 obj << /Length ${z.length} /Filter /FlateDecode >> stream\n`), z, enc.encode("\nendstream endobj\n%%EOF"));
  assert((await textoDoPdf(flate)).indexOf("Proposta comercial") >= 0);
  const imagem = enc.encode("%PDF-1.4\n1 0 obj << /Subtype /Image /Length 4 >> stream\nABCD\nendstream endobj\n%%EOF");
  assertEquals(await textoDoPdf(imagem), "");
  assertEquals(await textoDoPdf(enc.encode("não é pdf")), "");
  assertEquals(pareceTexto("\u0001\u0002\u0003#$%&*@!@#$%^&*()"), false);
});

/** Um .docx mínimo: zip com word/document.xml em deflate. */
async function docx(xml: string): Promise<Uint8Array> {
  const nome = enc.encode("word/document.xml");
  const bruto = enc.encode(xml);
  const dados = await comprimir(bruto, "deflate-raw");
  const v = (n: number, tam: number) => {
    const b = new Uint8Array(tam);
    for (let i = 0; i < tam; i++) b[i] = (n >>> (8 * i)) & 0xff;
    return b;
  };
  const local = juntar(v(0x04034b50, 4), v(20, 2), v(0, 2), v(8, 2), v(0, 4), v(0, 4), v(dados.length, 4), v(bruto.length, 4), v(nome.length, 2), v(0, 2), nome, dados);
  const central = juntar(v(0x02014b50, 4), v(20, 2), v(20, 2), v(0, 2), v(8, 2), v(0, 4), v(0, 4), v(dados.length, 4), v(bruto.length, 4), v(nome.length, 2), v(0, 2), v(0, 2), v(0, 2), v(0, 2), v(0, 4), v(0, 4), nome);
  const fim = juntar(v(0x06054b50, 4), v(0, 2), v(0, 2), v(1, 2), v(1, 2), v(central.length, 4), v(local.length, 4), v(0, 2));
  return juntar(local, central, fim);
}

Deno.test("leitor: Word (.docx) vira texto em parágrafos; zip sem o documento volta vazio", async () => {
  const b = await docx('<w:document><w:body><w:p><w:r><w:t>Briefing da Café X</w:t></w:r></w:p><w:p><w:r><w:t>Público: &amp; vizinhança</w:t></w:r></w:p></w:body></w:document>');
  assertEquals(await textoDoDocx(b), "Briefing da Café X\nPúblico: & vizinhança");
  assertEquals(await arquivoDoZip(b, "outro.xml"), null);
  assertEquals(await textoDoDocx(enc.encode("não é zip")), "");
});

// ------------------------------------------------------------------ nó Cliente com cliente próprio e papel do Agente

Deno.test("nó Cliente: client_id só uuid; com outro cliente confere o acesso de quem roda e, sem acesso, não lê nada", async () => {
  const { saidaDoNoCliente } = await import("./nos-v4.ts");
  assertEquals(dadosDoTipo("cliente", { client_id: CLIENTE.toUpperCase() }).dados, { client_id: CLIENTE });
  assertEquals(dadosDoTipo("cliente", { client_id: "abc" }).ignorados, ["client_id"]);
  const OUTRO = "33333333-3333-4333-8333-333333333333";
  const lidos: string[] = [];
  const porta = (acesso: boolean) => ({
    podeAcessar: async (id: string, token: string) => (lidos.push(`acesso:${id}:${token}`), acesso),
    marca: async (id: string) => (lidos.push(`marca:${id}`), "Paleta: #000000"),
    nome: async (id: string) => (lidos.push(`nome:${id}`), "Loja Y"),
  });
  const ctx = { marca: "Marca do projeto", nomeDoCliente: "Café X", projeto: projeto(), token: "jwt" };
  const no = { id: "cl", tipo: "cliente" as const, x: 0, y: 0, dados: { client_id: OUTRO, foco: "lançamento" } };
  const e = await assertRejects(() => saidaDoNoCliente(ctx, no, porta(false)), ErroHttp);
  assertEquals((e as ErroHttp).status, 403);
  assertEquals(lidos, [`acesso:${OUTRO}:jwt`]);
  const ok = await saidaDoNoCliente(ctx, no, porta(true));
  assert((ok!.texto || "").indexOf("Cliente: Loja Y") === 0 && (ok!.texto || "").indexOf("#000000") > 0, ok!.texto);
  // Sem o campo (ou o mesmo do projeto): o do projeto, sem conferir de novo.
  lidos.length = 0;
  const doProjeto = await saidaDoNoCliente(ctx, { ...no, dados: { foco: "x" } }, porta(false));
  assert((doProjeto!.texto || "").indexOf("Cliente: Café X") === 0);
  assertEquals(lidos, []);
});

Deno.test("Agente: papel só da lista fechada; Mídia guarda a capa do vídeo", () => {
  assertEquals(dadosDoTipo("agente", { papel: "diretor_arte" }).dados, { papel: "diretor_arte" });
  assertEquals(dadosDoTipo("agente", { papel: "diretor_de_arte" }).ignorados, ["papel"]);
  const m = dadosDoTipo("midia", { midias: [{ id: "v", tipo: "video", url: "u", path: "global/laboratorio/p/entradas/a.mp4", nome: "a.mp4", capa: "data:image/jpeg;base64,xx" }], auto: true });
  assertEquals(m.dados.auto, true);
  assertEquals((m.dados.midias as Array<{ capa?: string }>)[0].capa, "data:image/jpeg;base64,xx");
  assertEquals(camposPreenchiveis("cliente"), ["titulo", "foco"]);
  assert(camposPreenchiveis("agente").indexOf("papel") >= 0);
});

Deno.test("Mídia: item da biblioteca do cliente (só link https, sem caminho) também entra; link sem https não", () => {
  const m = midiasDe([
    { id: "b1", tipo: "video", url: "https://x.supabase.co/storage/v1/object/sign/workspace/c/a.mp4?token=1", path: "", nome: "Reel", capa: "https://x/capa.jpg" },
    { id: "b2", tipo: "imagem", url: "https://x/foto.jpg", path: "", nome: "foto" },
    { id: "b3", tipo: "imagem", url: "http://x/foto.jpg", path: "" },
  ]);
  assertEquals(m.map((x) => x.id), ["b1", "b2"]);
  assertEquals(m[0].capa, "https://x/capa.jpg");
});

Deno.test("fontes_do_cliente: marca_id do cliente vai para a leitura (a marca devolvida é só a dela); sem cliente, ignorado", async () => {
  const MARCA = "44444444-4444-4444-8444-444444444444";
  const f = portaFalsa();
  await fontesDoCliente(f.porta, ch, { client_id: CLIENTE, marca_id: MARCA });
  assertEquals(f.chamadas.find((c) => c.nome === "lerFontes")!.args, [CLIENTE, MARCA]);
  const livre = portaFalsa();
  await fontesDoCliente(livre.porta, ch, { client_id: null, marca_id: MARCA });
  assertEquals(livre.chamadas.find((c) => c.nome === "lerFontes")!.args, [null]);
  const ruim = await assertRejects(() => fontesDoCliente(portaFalsa().porta, ch, { client_id: CLIENTE, marca_id: "cme" }), ErroHttp);
  assertEquals((ruim as ErroHttp).status, 400);
});
