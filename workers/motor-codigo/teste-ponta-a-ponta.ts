/**
 * Teste de ponta a ponta do motor (local, sem banco): gera um site de uma
 * página para o cliente AcelerIQ com um modelo barato pelo OpenRouter, com a
 * fila em arquivos (FilaLocal), e mede o custo real.
 *
 *   node --env-file-if-exists=.env teste-ponta-a-ponta.ts [--modelo deepseek/deepseek-v4-flash] [--teto 0.8]
 *
 * Precisa só de OPENROUTER_API_KEY no ambiente. O kit da marca é o do banco
 * (lido antes, só leitura) gravado em <pasta do teste>/aceleriq-kit.json, fora do git; a logo real é
 * copiada do acervo local. O conteúdo (3 opções, escolhe a primeira) sai do
 * mesmo modelo, pela fórmula de copy da Mesa Site, e entra no custo.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { filaLocal } from "./lib/fila.ts";
import { executarTrabalho } from "./lib/executar.ts";
import { desligarTodas } from "./lib/previa.ts";
import { estimarTrabalho, nomeDoProjeto } from "../../supabase/functions/_shared/motor-codigo.ts";
import { ESQUEMA_DO_CONTEUDO, normalizarOpcoesDeCopy, SECOES_PADRAO } from "../../supabase/functions/_shared/site-metodo.ts";

const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const MODELO_API = arg("modelo", "deepseek/deepseek-v4-flash");
const TETO = Number(arg("teto", "0.8"));
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const PASTA = process.env.MOTOR_TESTE_PASTA || "C:\\AI\\motor-codigo\\teste-e2e";
const CHAVE = process.env.OPENROUTER_API_KEY || "";
if (!CHAVE) {
  console.error("Falta OPENROUTER_API_KEY no ambiente.");
  process.exit(1);
}

async function usoDaChave(): Promise<number | null> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${CHAVE}` } });
    const j = (await r.json()) as { data?: { usage?: number } };
    return typeof j.data?.usage === "number" ? j.data.usage : null;
  } catch {
    return null;
  }
}

async function precoDoModelo(id: string) {
  const r = await fetch("https://openrouter.ai/api/v1/models");
  const j = (await r.json()) as { data: Array<{ id: string; context_length: number; pricing: Record<string, string> }> };
  const m = j.data.find((x) => x.id === id);
  if (!m) throw new Error(`modelo ${id} não está no OpenRouter`);
  const por1m = (v?: string) => (v ? Number(v) * 1e6 : null);
  return { id: `openrouter:${id}`, provedor: "openrouter", modelo_api: id, preco_entrada_1m: por1m(m.pricing.prompt), preco_saida_1m: por1m(m.pricing.completion), preco_cache_1m: por1m(m.pricing.input_cache_read), contexto_tokens: m.context_length };
}

const SISTEMA_DO_CONTEUDO = `Você é o redator de sites da Aceleriq. Escreve o conteúdo de um site de uma página, premium, na voz da marca do cliente, em português do Brasil.
Responda só com o JSON do esquema, com EXATAMENTE 3 opções de conceitos diferentes entre si:
- headline: resultado para o público, no máximo 8 palavras. subtitulo: 1 ou 2 frases. cta: até 5 palavras.
- secoes: uma por id pedido em SECOES (id igual), com titulo curto, texto de 1 a 3 frases e itens quando couber.
- faq: 4 a 6 perguntas reais do público. seo: titulo até 60 caracteres, descricao até 155, palavras: 5 a 8.
Nunca invente número, resultado, depoimento, prêmio ou cliente atendido. Sem travessão, sem emoji.`;

async function gerarCopy(kit: Record<string, unknown>, secoes: string[]) {
  const ctx = (kit.contexto || {}) as Record<string, unknown>;
  const dados = { cliente: "AcelerIQ", marca: { negocio: ctx.negocio, publico: ctx.publico, oferta: ctx.oferta, tom: ctx.tom_de_voz, diferenciais: ctx.diferenciais }, SECOES: secoes };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json", "X-OpenRouter-Title": "Aceleriq motor teste" },
    body: JSON.stringify({
      model: MODELO_API,
      messages: [{ role: "system", content: SISTEMA_DO_CONTEUDO }, { role: "user", content: `DADOS:\n${JSON.stringify(dados)}` }],
      response_format: { type: "json_schema", json_schema: { name: ESQUEMA_DO_CONTEUDO.nome, strict: true, schema: ESQUEMA_DO_CONTEUDO.schema } },
      usage: { include: true },
      max_tokens: 9000,
    }),
  });
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }; error?: unknown };
  if (!r.ok || !j.choices) throw new Error(`copy: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  const texto = j.choices[0]?.message?.content || "{}";
  const opcoes = normalizarOpcoesDeCopy(JSON.parse(texto.replace(/^```json\s*|```$/g, "")));
  return { opcoes, custo: Number(j.usage?.cost) || 0, tokens: j.usage };
}

async function principal() {
  mkdirSync(PASTA, { recursive: true });
  const fila = filaLocal(join(PASTA, "fila"));
  const kit = JSON.parse(readFileSync(process.env.MOTOR_TESTE_KIT || join(PASTA, "aceleriq-kit.json"), "utf8")) as Record<string, unknown>;
  const modelo = await precoDoModelo(MODELO_API);
  const secoes = ["topo", "hero", "servicos", "processo", "diferenciais", "faq", "chamada", "rodape"].filter((s) => (SECOES_PADRAO as readonly string[]).indexOf(s) >= 0);
  const est = estimarTrabalho(modelo, "construir", secoes.length);
  console.log(`[teste] modelo ${MODELO_API} (US$ ${modelo.preco_entrada_1m}/${modelo.preco_saida_1m} por 1M; cache ${modelo.preco_cache_1m}); estimativa US$ ${est.estimativa_usd}, teto sugerido US$ ${est.teto_sugerido_usd}, teto usado US$ ${TETO}`);

  const antes = await usoDaChave();
  const copy = await gerarCopy(kit, secoes);
  console.log(`[teste] conteúdo: ${copy.opcoes.length} opções, custo US$ ${copy.custo.toFixed(5)}; escolhida: "${copy.opcoes[0]?.headline}"`);

  // A logo real entra pelo código: copiada do acervo local para o "Storage" da fila local.
  const logoPath = String(kit.logo_path || `${CLIENTE}/marca/logo.png`);
  const logoLocal = process.env.MOTOR_TESTE_LOGO || "C:\\Users\\Usuario\\Desktop\\Projeto Aceleriq\\Claude\\Videos\\aceleriq\\remotion\\public\\brand\\logo-trim.png";
  const destinoLogo = join(PASTA, "fila", "armazem", "mesa", logoPath);
  mkdirSync(dirname(destinoLogo), { recursive: true });
  if (existsSync(logoLocal)) copyFileSync(logoLocal, destinoLogo);

  const siteId = randomUUID();
  const projeto = nomeDoProjeto("AcelerIQ site", siteId);
  const ctx = (kit.contexto || {}) as Record<string, unknown>;
  const pacote = {
    cliente: "AcelerIQ",
    marca: { nome: "AcelerIQ", negocio: ctx.negocio, publico: ctx.publico, oferta: ctx.oferta, tom: ctx.tom_de_voz, diferenciais: ctx.diferenciais },
    paleta: kit.paleta,
    fontes: [],
    dna: { atributos: [{ id: "quase_preto", prob: null }, { id: "sans_pesada", prob: null }, { id: "luz_dramatica", prob: null }, { id: "bento", prob: null }], movimento: "sutil", nivel: "saas", nicho: "agencia", cores_das_referencias: [], observacoes: String(kit.estilo || "").slice(0, 1500), fonte: "manual" },
    direcao: { nicho: "agencia", peca: "site de uma página", referencia_de_nivel: "saas", observacao: "Verde vivo, preto e branco; setas e traços verdes de acento; CTA para conversar no WhatsApp." },
    copy: copy.opcoes[0] || null,
    imagens: [],
    fotos_reais: [],
    logo: "/marca/logo.png",
    secoes,
    regras_da_equipe: ["EVITAR: prometer resultado ou número que o cliente não deu"],
    arquivos: [{ bucket: "mesa", path: logoPath, destino: "public/marca/logo.png" }],
  };
  const t = {
    id: randomUUID(), client_id: CLIENTE, marca_id: null, mesa: "site", projeto, referencia_tipo: "site", referencia_id: siteId, tipo: "construir", estado: "na_fila",
    modelo: modelo.id, instrucao: "Construir o site de uma página", pedido: { secoes, secao: null, modelo, pacote }, teto_usd: TETO, estimativa_usd: est.estimativa_usd, custo_usd: 0, criado_por: null,
  };
  fila.enfileirar(t);
  const pego = await fila.pegar("teste-local");
  if (!pego) throw new Error("a fila local não devolveu o trabalho");
  const inicio = Date.now();
  const r = await executarTrabalho(pego, fila, { pastaProjetos: join(PASTA, "projetos"), prazoPorPassadaMs: 12 * 60_000, comPrevia: process.env.MOTOR_PREVIA !== "nao" });
  const depois = await usoDaChave();
  const final = fila.ler(t.id);
  const relatorio = {
    projeto,
    pasta: join(PASTA, "projetos", projeto),
    estado: r.estado,
    minutos: Math.round((Date.now() - inicio) / 6000) / 10,
    custo_motor_usd: r.custo,
    custo_motor_real_openrouter_usd: (final.resultado as Record<string, unknown>)?.custo_real_usd ?? null,
    custo_motor_tabela_usd: (final.resultado as Record<string, unknown>)?.custo_tabela_usd ?? null,
    custo_conteudo_usd: copy.custo,
    custo_total_estimado_usd: Math.round((r.custo + copy.custo) * 1e6) / 1e6,
    uso_da_chave_openrouter_delta_usd: antes !== null && depois !== null ? Math.round((depois - antes) * 1e6) / 1e6 : null,
    estimativa_do_painel_usd: est.estimativa_usd,
    teto_usd: TETO,
    preview_url: final.preview_url || null,
    commit: final.commit,
    zip_path: final.zip_path,
    resultado: final.resultado,
    erro: final.erro,
    eventos: fila.eventos(t.id).length,
  };
  writeFileSync(join(PASTA, "relatorio.json"), JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
  if (process.env.MOTOR_MANTER_PREVIA !== "1") desligarTodas();
}

/**
 * Segunda parte (--ajustar <projeto>): um ajuste pedido "por conversa" numa
 * seção já construída e, em seguida, o Desfazer (volta o commit). Mede o custo.
 */
async function ajustarEDesfazer(projeto: string) {
  const fila = filaLocal(join(PASTA, "fila"));
  const modelo = await precoDoModelo(MODELO_API);
  const pasta = join(PASTA, "projetos", projeto);
  const pacote = JSON.parse(readFileSync(join(pasta, ".aceleriq", "pacote.json"), "utf8")) as Record<string, unknown>;
  const cfg = { pastaProjetos: join(PASTA, "projetos"), prazoPorPassadaMs: 12 * 60_000, comPrevia: false };
  const base = { client_id: CLIENTE, marca_id: null, mesa: "site", projeto, referencia_tipo: "site", referencia_id: randomUUID(), estado: "na_fila", modelo: modelo.id, custo_usd: 0, criado_por: null, estimativa_usd: null };
  const instrucao = arg("instrucao", "No hero, deixe o título maior e ponha uma linha fina verde de acento acima dele.");
  const aj = { ...base, id: randomUUID(), tipo: "ajustar", instrucao, teto_usd: 0.2, pedido: { secao: arg("secao", "hero"), secoes: [], modelo, pacote } };
  fila.enfileirar(aj);
  const r1 = await executarTrabalho((await fila.pegar("teste-local"))!, fila, cfg);
  const feito = fila.ler(aj.id);
  const df = { ...base, id: randomUUID(), tipo: "desfazer", instrucao: "Desfazer o ajuste", teto_usd: 0, pedido: { alvo: { commit: feito.commit, commit_anterior: feito.commit_anterior } } };
  fila.enfileirar(df);
  const r2 = await executarTrabalho((await fila.pegar("teste-local"))!, fila, cfg);
  const desfeito = fila.ler(df.id);
  const rel = {
    ajuste: { estado: r1.estado, custo_usd: r1.custo, real: (feito.resultado as Record<string, unknown>)?.custo_real_usd ?? null, commit: feito.commit, commit_anterior: feito.commit_anterior, erro: feito.erro },
    desfazer: { estado: r2.estado, commit: desfeito.commit, erro: desfeito.erro },
  };
  writeFileSync(join(PASTA, "relatorio-ajuste.json"), JSON.stringify(rel, null, 2));
  console.log(JSON.stringify(rel, null, 2));
}

const projetoParaAjustar = process.argv.indexOf("--ajustar") >= 0 ? arg("ajustar", "") : "";
await (projetoParaAjustar ? ajustarEDesfazer(projetoParaAjustar) : principal()).catch((e) => {
  console.error("[teste] falhou:", e instanceof Error ? e.stack || e.message : e);
  desligarTodas();
  process.exit(1);
});
