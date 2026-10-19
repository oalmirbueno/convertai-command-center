/**
 * Laboratório v2: nó Filme (sem rede, custo zero). A mesa-motion é falsa: o teste confere a ordem das
 * ações (as mesmas da Mesa Identidade), o 'aguardando' com os 3 storyboards, a escolha e o render.
 *
 *   deno test --allow-env supabase/functions/laboratorio/filme_test.ts
 */
import { assert, assertEquals, assertMatch, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ErroHttp } from "./comum.ts";
import { acompanharFilme, andamentoDasCenas, brandDoFluxo, type ChamarMotion, escolherStoryboard, rodarFilme, type SaidaDoFilme, uidDoPedido, videosDaMontagem } from "./filme.ts";

const STORYBOARDS = [0, 1, 2].map((i) => ({
  conceito: `Conceito ${i + 1}`,
  resumo: `Resumo ${i + 1}`,
  cenas: [
    { id: `c${i}a`, tipo_plano: "hf", duracao_s: 5 },
    { id: `c${i}b`, tipo_plano: "hf", duracao_s: 6 },
    ...(i === 2 ? [{ id: "c2v", tipo_plano: "gerado", duracao_s: 4, arquivo: null }] : []),
  ],
}));

type Chamada = { acao: string; corpo: Record<string, unknown> };

/** Mesa Motion falsa: responde por ação e guarda as chamadas. */
function motionFalsa(respostas: Record<string, (corpo: Record<string, unknown>) => Record<string, unknown>>) {
  const chamadas: Chamada[] = [];
  const motion: ChamarMotion = (acao, corpo) => {
    chamadas.push({ acao, corpo });
    const r = respostas[acao];
    if (!r) return Promise.reject(new Error(`ação inesperada: ${acao}`));
    try {
      return Promise.resolve(r(corpo));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return { motion, chamadas, acoes: () => chamadas.map((c) => c.acao) };
}

const BASE = {
  filme_criar: () => ({ filme: { id: "filme-1" } }),
  filme_salvar: () => ({ filme: { id: "filme-1" } }),
  storyboards_gerar: () => ({ filme: { id: "filme-1", storyboards: STORYBOARDS }, custo_usd: 0.12 }),
  filme_arquivar: () => ({ filme: { id: "filme-1" } }),
};

async function semRede<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("rede proibida no teste"))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const rodar = (m: ChamarMotion) =>
  rodarFilme(m, { clientId: "cli-1", nome: "Filme da marca", ideia: "Pão quente às 6h", textos: ["Contexto: padaria de bairro"], oferta: { promessa: "Pão quente sempre", publico: "vizinhos" }, formatos: ["16:9", "9:16"], modeloId: "openrouter:anthropic/claude-opus-5.5" });

Deno.test("Filme: rodar cria o filme na Mesa Motion e fica esperando a escolha com 3 storyboards", async () => {
  const f = motionFalsa(BASE);
  const r = await semRede(() => rodar(f.motion));
  assertEquals(f.acoes(), ["filme_criar", "filme_salvar", "storyboards_gerar"]);
  assertEquals(f.chamadas[0].corpo, { client_id: "cli-1", nome: "Filme da marca", tipo: "filme_marca", formatos: ["16:9", "9:16"] });
  const salvar = f.chamadas[1].corpo;
  assertEquals((salvar.brand as Record<string, unknown>).promessa, "Pão quente sempre");
  assertMatch(String((salvar.entrevista as Record<string, unknown>).observacoes), /padaria/);
  assertEquals(f.chamadas[2].corpo.modelo_id, "openrouter:anthropic/claude-opus-5.5");
  assertEquals(r.custo, 0.12);
  assertEquals(r.saida.etapa, "escolher");
  assertEquals(r.saida.storyboard_escolhido, null);
  assertEquals(r.saida.storyboards.map((s) => [s.indice, s.titulo, s.cenas, s.duracao_s]), [[0, "Conceito 1", 2, 11], [1, "Conceito 2", 2, 11], [2, "Conceito 3", 3, 15]]);
  assertEquals(r.saida.storyboards[2].planos_de_video, 1);
  assertEquals(r.saida.filme_id, "filme-1");
});

Deno.test("Filme: storyboards que falham arquivam o filme vazio (não apagam)", async () => {
  const f = motionFalsa({ ...BASE, storyboards_gerar: () => { throw new ErroHttp(402, "saldo_insuficiente", "sem saldo"); } });
  await assertRejects(() => rodar(f.motion), ErroHttp, "sem saldo");
  assertEquals(f.acoes(), ["filme_criar", "filme_salvar", "storyboards_gerar", "filme_arquivar"]);
  assertEquals(f.chamadas[3].corpo, { filme_id: "filme-1", arquivar: true });
});

async function saidaEsperando(): Promise<SaidaDoFilme> {
  return (await rodar(motionFalsa(BASE).motion)).saida;
}

Deno.test("Filme: escolher o storyboard pede o render final das cenas (aguardando → renderizando)", async () => {
  const saida = await saidaEsperando();
  const f = motionFalsa({
    storyboard_escolher: (c) => ({ filme: { id: "filme-1", cenas: STORYBOARDS[Number(c.indice)].cenas } }),
    cena_pedir: () => ({ pedidos: [{ id: "p" }] }),
  });
  const nova = await semRede(() => escolherStoryboard(f.motion, saida, 2, "exec1234"));
  assertEquals(f.acoes(), ["storyboard_escolher", "cena_pedir", "cena_pedir"]);
  assertEquals(f.chamadas[0].corpo, { filme_id: "filme-1", indice: 2 });
  const pedido = f.chamadas[1].corpo;
  assertEquals([pedido.cena_id, pedido.modo, pedido.formatos], ["c2a", "final", ["16:9", "9:16"]]);
  assertMatch(String(pedido.uid), /^[A-Za-z0-9_-]{8,80}$/);
  assertEquals(nova.etapa, "renderizando");
  assertEquals(nova.storyboard_escolhido, 2);
  assertEquals(nova.render.total, 2);
  // O plano de vídeo (gerado) não renderiza aqui: fica como pendência dita em português.
  assertEquals(nova.render.faltando.length, 1);
  assertMatch(nova.render.faltando[0], /plano de vídeo/);
  // Escolher de novo (ou fora do intervalo) é recusado.
  await assertRejects(() => escolherStoryboard(f.motion, nova, 0, "exec1234"), ErroHttp, "já foi escolhido");
  await assertRejects(() => escolherStoryboard(f.motion, saida, 5, "exec1234"), ErroHttp, "Escolha um storyboard");
  // O mesmo pedido gera a mesma marca (pedir de novo não renderiza duas vezes).
  assertEquals(uidDoPedido("exec1234-c2a"), uidDoPedido("exec1234-c2a"));
});

Deno.test("Filme: acompanhar monta quando as cenas ficam prontas e traz o vídeo final", async () => {
  const saida0 = await saidaEsperando();
  const escolha = motionFalsa({ storyboard_escolher: () => ({ filme: { id: "filme-1", cenas: STORYBOARDS[0].cenas } }), cena_pedir: () => ({}) });
  const saida = await escolherStoryboard(escolha.motion, saida0, 0, "exec1234");
  const pronto = (cena: string, formato: string) => ({ cena_id: cena, modo: "final", formato, estado: "pronto" });
  // 1) Uma cena pronta: espera, sem montar.
  const a = motionFalsa({ filme_ler: () => ({ filme: { id: "filme-1", cenas: STORYBOARDS[0].cenas, renders: [pronto("c0a", "16:9"), pronto("c0a", "9:16")], montagem: {} } }) });
  const r1 = await acompanharFilme(a.motion, saida, "exec1234");
  assertEquals(a.acoes(), ["filme_ler"]);
  assertEquals([r1.status, r1.saida.render.prontas, r1.saida.render.total, r1.saida.render_progresso], ["aguardando", 1, 2, 40]);
  // 2) Todas prontas: pede a montagem (uma vez).
  const todos = [pronto("c0a", "16:9"), pronto("c0a", "9:16"), pronto("c0b", "16:9"), pronto("c0b", "9:16")];
  const b = motionFalsa({ filme_ler: () => ({ filme: { id: "filme-1", cenas: STORYBOARDS[0].cenas, renders: todos, montagem: {} } }), montar: () => ({ pedidos: { "16:9": "r1", "9:16": "r2" } }) });
  const r2 = await acompanharFilme(b.motion, r1.saida, "exec1234");
  assertEquals(b.acoes(), ["filme_ler", "montar"]);
  assertEquals(r2.saida.etapa, "montando");
  assertEquals(r2.saida.render.montagem, { "16:9": "r1", "9:16": "r2" });
  // 2b) Montagem já pedida (outra aba): não monta de novo.
  const b2 = motionFalsa({ filme_ler: () => ({ filme: { id: "filme-1", cenas: STORYBOARDS[0].cenas, renders: todos, montagem: { pedidos: { "16:9": "r1" } } } }) });
  const r2b = await acompanharFilme(b2.motion, r1.saida, "exec1234");
  assertEquals(b2.acoes(), ["filme_ler"]);
  assertEquals(r2b.saida.etapa, "montando");
  // 3) Render final pronto nos dois formatos: pronto, com o link.
  const finais = [{ estado: "pronto", saida_path: "cli-1/v/16x9.mp4", entrada: { formato: "16:9" } }, { estado: "pronto", saida_path: "cli-1/v/9x16.mp4", entrada: { formato: "9:16" } }];
  const c = motionFalsa({ render_status: () => ({ finais, links: { "cli-1/v/16x9.mp4": "https://arquivo.test/16x9.mp4", "cli-1/v/9x16.mp4": "https://arquivo.test/9x16.mp4" } }) });
  const r3 = await acompanharFilme(c.motion, r2.saida, "exec1234");
  assertEquals([r3.status, r3.saida.etapa, r3.saida.render_progresso], ["pronto", "pronto", 100]);
  assertEquals(r3.saida.video_url, "https://arquivo.test/16x9.mp4");
  assertEquals(r3.saida.videos.map((v) => v.formato), ["16:9", "9:16"]);
  // 4) Render final que falhou: erro dito.
  const d = motionFalsa({ render_status: () => ({ finais: [{ estado: "erro", erro_mensagem: "worker caiu", entrada: { formato: "16:9" } }], links: {} }) });
  const r4 = await acompanharFilme(d.motion, r2.saida, "exec1234");
  assertEquals(r4.status, "erro");
  assertMatch(r4.erro!, /worker caiu/);
  // 5) Montagem recusada por cena faltando: para e diz o que falta (sem laço).
  const e = motionFalsa({
    filme_ler: () => ({ filme: { id: "filme-1", cenas: STORYBOARDS[0].cenas, renders: todos, montagem: {} } }),
    montar: () => { throw new ErroHttp(409, "cenas_faltando", "Falta: cena 1.", { faltando: ["cena 1 (16:9): a cena mudou depois do render"] }); },
  });
  const r5 = await acompanharFilme(e.motion, r1.saida, "exec1234");
  assertEquals([r5.status, r5.saida.etapa], ["aguardando", "parado"]);
  assertMatch(r5.saida.render.faltando[0], /mudou depois do render/);
});

Deno.test("Filme: peças puras (andamento, vídeos da montagem, brand do fluxo)", () => {
  const filme = { cenas: [{ id: "a", tipo_plano: "hf" }, { id: "b" }, { id: "v", tipo_plano: "real", arquivo: { path: "x" } }, { id: "w", tipo_plano: "gerado" }], renders: [{ cena_id: "a", modo: "final", formato: "9:16", estado: "pronto" }, { cena_id: "b", modo: "amostra", formato: "9:16", estado: "pronto" }] };
  assertEquals(andamentoDasCenas(filme, ["9:16"]), { total: 2, prontas: 1, planosSemVideo: 1 });
  assertEquals(videosDaMontagem({ finais: [], links: {} }, ["9:16"]), { videos: [], erro: null, prontos: false });
  assertEquals(brandDoFluxo({ ideia: "", oferta: null, textos: ["Contexto"] }), { essencia: "Contexto", publico: "", promessa: "" });
  assert(uidDoPedido("a").length >= 8);
});
