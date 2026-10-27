import { assert, assertEquals } from "jsr:@std/assert@1";
import { caminhoDaArte, mimeReal, modeloPermitido, openaiPronta, pedidoDeImagem, pedidoDeTexto, textoSimulado, validarConteudo, type Briefing } from "./regras.ts";
import { openai, simulado } from "./provedores.ts";

const BRIEFING: Briefing = { tipo: "venda", produto: "Bolo de pote", cta: "Peça no direct", condicoes: "" };
const MARCA = { nome: "Doceria A", tom: "acolhedor", cores: ["#0F172A"] };

Deno.test("texto simulado usa só o que o membro escreveu e é marcado como demonstração", () => {
  const t = textoSimulado(MARCA, BRIEFING);
  assert(t.texto.startsWith("[DEMONSTRAÇÃO]"));
  assert(t.mensagem.startsWith("[DEMONSTRAÇÃO]"));
  assert(!/R\$|%|desconto/i.test(Object.values(t).join(" ")), "não inventa condição comercial");
  assertEquals(t.cta, "Peça no direct");
});

Deno.test("saída com preço que o membro não informou é recusada", () => {
  const r = validarConteudo({ mensagem: "m", texto: "Bolo por R$ 9,90 com 20% de desconto", cta: "c" }, BRIEFING);
  assert(!r.ok);
});

Deno.test("preço informado no briefing pode aparecer", () => {
  const r = validarConteudo({ mensagem: "m", texto: "Bolo por R$ 12" }, { ...BRIEFING, condicoes: "R$ 12 cada" });
  assert(r.ok);
});

Deno.test("confere valor comercial inteiro, incluindo centavos, porcentagem e parcelas", () => {
  const saida = (texto: string) => ({ mensagem: "Bolo de pote", texto });
  for (const [aprovado, alterado] of [["R$ 12", "R$ 19"], ["R$ 12,50", "R$ 12,99"], ["1,5%", "1,9%"], ["3x de R$ 12", "9x de R$ 12"], ["12 dias", "19 dias"], ["3 parcelas", "3x sem juros"]]) {
    const b = { ...BRIEFING, condicoes: aprovado };
    assert(validarConteudo(saida(aprovado), b).ok, `aceita ${aprovado}`);
    assert(!validarConteudo(saida(alterado), b).ok, `recusa ${alterado} em vez de ${aprovado}`);
  }
  assert(validarConteudo(saida("R$12,00 em 3 parcelas"), { ...BRIEFING, condicoes: "R$ 12 em 3x" }).ok);
  assert(validarConteudo(saida("R$1250,50"), { ...BRIEFING, condicoes: "R$ 1.250,50" }).ok);
});

Deno.test("escala visual não é parcela; a direção ainda não pode inventar condições", () => {
  const base = { mensagem: "Bolo de pote", texto: "Peça no direct" };
  assert(validarConteudo({ ...base, direcao_visual: "Uma xícara em escala 3x maior sobre uma mesa." }, BRIEFING).ok);
  assert(validarConteudo({ ...base, direcao_visual: "Zoom de 3x no objeto protagonista." }, BRIEFING).ok);
  for (const direcao_visual of ["Escreva em até 3x no canto.", "Exiba 3x de R$ 12.", "Escala 3x sem juros.", "Uma xícara em escala 3x maior; escreva R$ 99 na headline.", "Texto: 3 parcelas sem juros."]) {
    assert(!validarConteudo({ ...base, direcao_visual }, BRIEFING).ok, direcao_visual);
  }
  assert(!validarConteudo({ ...base, texto: "Pague em 3x" }, BRIEFING).ok);
  assert(validarConteudo({ ...base, texto: "Pague em 3x" }, { ...BRIEFING, condicoes: "3 parcelas" }).ok);
});

Deno.test("texto usa método comum e projeta somente os campos da campanha", () => {
  const pedido = pedidoDeTexto({ ...MARCA, extra: "dado de outra área" } as typeof MARCA, { ...BRIEFING, crm: "contato privado" } as Briefing);
  assert(pedido.sistema.includes("CAMPANHA ANTES DA ARTE"));
  const contexto = JSON.parse(pedido.usuario);
  assertEquals(contexto.marca.extra, undefined);
  assertEquals(contexto.campanha.crm, undefined);
  assertEquals(contexto.campanha.produto, BRIEFING.produto);
});

Deno.test("arte recebe headline e CTA exatos da versão escolhida; legenda não é texto da imagem", () => {
  const p = pedidoDeImagem(MARCA, BRIEFING, { mensagem: "Uma pausa mais doce.", texto: "Corpo longo que só pertence à legenda.", cta: "Peça no direct", direcao_visual: "Um bolo de pote em escala inesperada, em uma mesa de café." }, "feed_4x5");
  const dados = JSON.parse(p.split("\n").at(-1)!);
  assertEquals(dados.textos_exatos, { headline: "Uma pausa mais doce.", cta: "Peça no direct" });
  assert(!p.includes("Corpo longo que só pertence à legenda."));
  assert(p.includes("preservando integralmente"));
  assert(p.includes("DIREÇÃO CRIATIVA DA CAMPANHA"));
  assert(p.includes("Não use logotipos de terceiros nem pessoas reais identificáveis"));
});

Deno.test("arte de texto legado longo usa imagem-base sem cortar ou substituir a versão", () => {
  for (const versao of [{ mensagem: "a".repeat(81), cta: "Peça" }, { mensagem: "Seu bolo", cta: "a".repeat(51) }, null]) {
    const p = pedidoDeImagem(MARCA, BRIEFING, versao, "stories_9x16");
    assertEquals(JSON.parse(p.split("\n").at(-1)!).textos_exatos, null);
    assert(p.includes("sem tipografia"));
    assert(p.includes("não corte, resuma"));
    assert(p.includes("14% superiores"));
  }
});

Deno.test("saída sem texto ou fora do formato é recusada", () => {
  assert(!validarConteudo({ mensagem: "m" }, BRIEFING).ok);
  assert(!validarConteudo("texto solto", BRIEFING).ok);
  assert(!validarConteudo({ mensagem: "m", texto: "x".repeat(4001) }, BRIEFING).ok);
});

Deno.test("nova copy respeita 80/50 sem truncar; legenda mantém seu limite próprio", () => {
  const base = { mensagem: "a".repeat(80), cta: "b".repeat(50), texto: "c".repeat(4000) };
  const r = validarConteudo(base, BRIEFING);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.conteudo.mensagem, base.mensagem);
    assertEquals(r.conteudo.cta, base.cta);
    assertEquals(r.conteudo.texto, base.texto);
  }
  assert(!validarConteudo({ ...base, mensagem: "a".repeat(81) }, BRIEFING).ok);
  assert(!validarConteudo({ ...base, cta: "b".repeat(51) }, BRIEFING).ok);
});

Deno.test("caminho da arte sempre na pasta do dono e só com ids válidos", () => {
  const u = "aaaaaaaa-0000-4000-8000-000000000001", c = "bbbbbbbb-0000-4000-8000-000000000002", j = "cccccccc-0000-4000-8000-000000000003";
  assertEquals(caminhoDaArte(u, c, j, "png"), `${u}/${c}/${j}.png`);
  let erro = false;
  try { caminhoDaArte("../x", c, j, "png"); } catch { erro = true; }
  assert(erro);
});

Deno.test("tipo do arquivo pela assinatura, não pelo que o fornecedor diz", async () => {
  const r = await simulado.imagem({ marca: MARCA, briefing: BRIEFING, versao: null, formato: "feed_4x5" });
  assert(r.ok);
  if (r.ok) {
    assertEquals(mimeReal(r.bytes), "image/png");
    assert(r.bytes.length > 1000);
  }
  assertEquals(mimeReal(new TextEncoder().encode("<svg></svg>")), null);
});

Deno.test("modelo fora da lista não passa; OpenAI desligada por padrão", () => {
  assertEquals(modeloPermitido("texto", "gpt-qualquer"), null);
  assert(!openaiPronta({}).ok);
  assert(!openaiPronta({ habilitado: "sim", chave: "x", modeloTexto: "gpt-qualquer", modeloImagem: "gpt-image-1" }).ok);
});

Deno.test("adaptador OpenAI desligado não chama a rede", async () => {
  let chamadas = 0;
  const p = openai({}, () => { chamadas++; return Promise.resolve(new Response("{}")); });
  const r = await p.texto({ marca: MARCA, briefing: BRIEFING, versao: null, formato: null });
  assert(!r.ok);
  assertEquals(chamadas, 0);
});

Deno.test("adaptador OpenAI (fetch simulado): resposta válida passa pela conferência; rede caída fica incerta", async () => {
  const env = { habilitado: "sim", chave: "chave-de-teste", modeloTexto: "gpt-4.1-mini", modeloImagem: "gpt-image-1" };
  const ok = openai(env, () => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mensagem: "m", texto: "Bolo de pote fresquinho", cta: "Peça no direct" }) } }] }))));
  const r1 = await ok.texto({ marca: MARCA, briefing: BRIEFING, versao: null, formato: null });
  assert(r1.ok);
  const caiu = openai(env, () => Promise.reject(new Error("rede")));
  const r2 = await caiu.texto({ marca: MARCA, briefing: BRIEFING, versao: null, formato: null });
  assert(!r2.ok && r2.incerto === true);
  const recusou = openai(env, () => Promise.resolve(new Response("{}", { status: 400 })));
  const r3 = await recusou.texto({ marca: MARCA, briefing: BRIEFING, versao: null, formato: null });
  assert(!r3.ok && r3.definitiva);
});

Deno.test("adaptador recusa copy nova longa e ainda envia arte de versão histórica sem cortar texto", async () => {
  const env = { habilitado: "sim", chave: "chave-de-teste", modeloTexto: "gpt-4.1-mini", modeloImagem: "gpt-image-1" };
  const contexto = { marca: MARCA, briefing: BRIEFING, versao: null, formato: null };
  for (const versao of [{ mensagem: "a".repeat(81), cta: "Peça" }, { mensagem: "Seu bolo", cta: "b".repeat(51) }]) {
    const p = openai(env, () => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...versao, texto: "Legenda completa" }) } }] }))));
    const r = await p.texto(contexto);
    assert(!r.ok && r.definitiva && !r.incerto);
  }
  let promptEnviado = "";
  const imagem = openai(env, (_url, init) => {
    const pedido = JSON.parse(init?.body as string);
    promptEnviado = pedido.prompt;
    return Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: "AA==" }] })));
  });
  const historico = { mensagem: "a".repeat(81), cta: "Peça", texto: "Legenda preservada" };
  const r = await imagem.imagem({ ...contexto, formato: "stories_9x16", versao: historico });
  assert(r.ok);
  assert(promptEnviado.includes("DIREÇÃO CRIATIVA DA CAMPANHA"));
  assert(promptEnviado.includes("sem tipografia"));
  assertEquals(JSON.parse(promptEnviado.split("\n").at(-1)!).textos_exatos, null);
  assertEquals(historico.mensagem.length, 81);
  const curta = { ...historico, mensagem: "Uma pausa mais doce." };
  assert((await imagem.imagem({ ...contexto, formato: "feed_4x5", versao: curta })).ok);
  assertEquals(JSON.parse(promptEnviado.split("\n").at(-1)!).textos_exatos, { headline: curta.mensagem, cta: curta.cta });
});
