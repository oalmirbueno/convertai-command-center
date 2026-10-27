import { assert, assertEquals } from "jsr:@std/assert@1";
import { caminhoDaArte, mimeReal, modeloPermitido, openaiPronta, textoSimulado, validarConteudo, type Briefing } from "./regras.ts";
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

Deno.test("saída sem texto ou fora do formato é recusada", () => {
  assert(!validarConteudo({ mensagem: "m" }, BRIEFING).ok);
  assert(!validarConteudo("texto solto", BRIEFING).ok);
  assert(!validarConteudo({ mensagem: "m", texto: "x".repeat(4001) }, BRIEFING).ok);
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
