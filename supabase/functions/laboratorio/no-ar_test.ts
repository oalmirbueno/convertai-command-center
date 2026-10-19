/**
 * Laboratório v2: nó "Pôr no ar" (sem rede, custo zero). Confere que ele só cria o pedido de aprovação
 * do dono, nunca chama nada de fora, e que o estado acompanha a decisão.
 *
 *   deno test --allow-env supabase/functions/laboratorio/no-ar_test.ts
 */
import { assert, assertEquals, assertMatch, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ErroHttp } from "./comum.ts";
import { acompanharNoAr, estadoDoPedido, montarPacote, type Operador, operadorParaOAlvo, pedirNoAr, type PortaDoNoAr, primeiroLink, type SaidaDoNoAr } from "./no-ar.ts";
import type { NoDoCanvas } from "./modulos/regras.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados });

const OPERADORES: Operador[] = [
  { id: "op-hermes", slug: "default", display_name: "Hermes", role: "coordenador", scope: "geral" },
  { id: "op-pc", slug: "paperclip-trafego", display_name: "Gestor de Tráfego (Paperclip)", role: "trafego", scope: "anuncios" },
  { id: "op-x", slug: "editor", display_name: "Editor", role: "conteudo", scope: "videos" },
];

type Chamada = { nome: string; args: unknown[] };

/** Porta falsa: guarda tudo o que o nó pediu ao banco. */
function portaFalsa(o: { aberto?: { id: string; status: string } | null; aprovacao?: Record<string, unknown> } = {}) {
  const chamadas: Chamada[] = [];
  const reg = (nome: string, ...args: unknown[]) => chamadas.push({ nome, args });
  let aprovacao = o.aprovacao ?? null;
  const porta: PortaDoNoAr = {
    operadoresAtivos: () => (reg("operadoresAtivos"), Promise.resolve(OPERADORES)),
    pedidoAberto: (p, n) => (reg("pedidoAberto", p, n), Promise.resolve(o.aberto ?? null)),
    projetoDoKanban: () => (reg("projetoDoKanban"), Promise.resolve("proj-kanban")),
    criarTarefa: (t) => (reg("criarTarefa", t), Promise.resolve("tarefa-1")),
    apagarTarefa: (id) => (reg("apagarTarefa", id), Promise.resolve()),
    criarAprovacao: (a) => (reg("criarAprovacao", a), Promise.resolve("aprov-1")),
    registrar: (acao, x) => (reg("registrar", acao, x), Promise.resolve()),
    avisarAdmins: (m, l) => (reg("avisarAdmins", m, l), Promise.resolve()),
    lerAprovacao: (id) => (reg("lerAprovacao", id), Promise.resolve(aprovacao as never)),
    entregarAoOperador: (slug, task, nota) => (reg("entregarAoOperador", slug, task, nota), Promise.resolve("link-1")),
    ligarAprovacao: (a, l) => {
      reg("ligarAprovacao", a, l);
      if (aprovacao) aprovacao = { ...aprovacao, task_link_id: l };
      return Promise.resolve();
    },
    instruir: (l, t, c) => (reg("instruir", l, t, c), Promise.resolve()),
    statusDoVinculo: (l) => (reg("statusDoVinculo", l), Promise.resolve("queued")),
  };
  return { porta, chamadas, nomes: () => chamadas.map((c) => c.nome) };
}

/** Qualquer fetch no teste é falha: o Pôr no ar nunca sai do banco. */
async function semRede<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let chamou = false;
  globalThis.fetch = (() => {
    chamou = true;
    return Promise.reject(new Error("rede proibida no Pôr no ar"));
  }) as typeof fetch;
  try {
    const r = await fn();
    assertEquals(chamou, false, "o Pôr no ar chamou a rede");
    return r;
  } finally {
    globalThis.fetch = original;
  }
}

const entradasDoAnuncio = () => [
  { no: no("lan", "landing", { titulo: "Página de vendas" }), saida: { html_path: "global/laboratorio/p/e-01.html", html_url: "https://arquivo.test/e-01.html", no_workspace_id: "w1" } },
  { no: no("anu", "anuncio", { titulo: "Anúncio" }), saida: { json: { titulos: ["Compre"], cta: "COMPRAR", status: "ativo" } } },
  { no: no("img", "imagem", { titulo: "Criativo 1" }), saida: { imagens: [{ path: "global/laboratorio/p/e-02.png", url: "https://arquivo.test/e-02.png" }] } },
];

Deno.test("Pôr no ar: só cria o pedido de aprovação (pendente), sem rede e sem entregar ao agente", async () => {
  const f = portaFalsa();
  const saida = await semRede(() =>
    pedirNoAr(f.porta, {
      projetoId: "proj-1",
      projetoNome: "Marmitas",
      nomeDoCliente: "Cliente X",
      execucaoId: "exec-1",
      no: no("ar", "por_no_ar", { titulo: "Subir o anúncio", alvo: "subir_anuncio_pausado" }),
      entradas: entradasDoAnuncio(),
      userId: "user-1",
    })
  );
  assertEquals(f.nomes(), ["pedidoAberto", "operadoresAtivos", "projetoDoKanban", "criarTarefa", "criarAprovacao", "registrar", "avisarAdmins"]);
  // Nada vai para a fila do agente antes do sim do dono.
  assert(!f.nomes().includes("entregarAoOperador"));
  const aprov = f.chamadas.find((c) => c.nome === "criarAprovacao")!.args[0] as Record<string, unknown>;
  assertEquals(aprov.status, "pendente");
  assertEquals(aprov.action_kind, "publicar");
  assertEquals(aprov.task_link_id, null);
  assertEquals(aprov.kanban_task_id, "tarefa-1");
  assertEquals(aprov.operator_id, "op-pc"); // anúncio: o gestor de tráfego do Paperclip
  assertEquals(aprov.custo_previsto, 0);
  assertMatch(String(aprov.destino), /PAUSADO/);
  const payload = aprov.payload as Record<string, unknown>;
  assertEquals(payload.origem, "laboratorio");
  assertEquals([payload.projeto_id, payload.no_id, payload.execucao_id], ["proj-1", "ar", "exec-1"]);
  assertMatch(String(payload.instrucao), /PAUSADO/);
  assertMatch(String(payload.instrucao), /nunca senha/);
  // O anúncio do pacote vai sempre pausado, mesmo que o rascunho dissesse outra coisa.
  const pacote = payload.pacote as ReturnType<typeof montarPacote>;
  assertEquals(pacote.anuncios[0].pacote.status, "pausado");
  assertEquals(pacote.paginas[0].url, "https://arquivo.test/e-01.html");
  assertEquals(pacote.criativos.length, 1);
  // A saída do nó: aguardando a aprovação, com o link do pedido.
  assertEquals(saida.estado, "aguardando_aprovacao");
  assertEquals(saida.aprovacao_id, "aprov-1");
  assertEquals(saida.link_aprovacao, "/execucao?aprovacao=aprov-1");
  assertEquals(saida.operador, "paperclip-trafego");
  assertMatch(saida.texto, /nada foi ao ar/);
  const aviso = f.chamadas.find((c) => c.nome === "avisarAdmins")!.args;
  assertEquals(aviso[1], "/execucao?aprovacao=aprov-1");
});

Deno.test("Pôr no ar: site vai ao Hermes; pedido repetido, sem pacote ou sem a peça do alvo é recusado", async () => {
  const f = portaFalsa();
  await pedirNoAr(f.porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar", { alvo: "publicar_site" }), entradas: entradasDoAnuncio().slice(0, 1), userId: "u" });
  const aprov = f.chamadas.find((c) => c.nome === "criarAprovacao")!.args[0] as Record<string, unknown>;
  assertEquals([aprov.operator_id, aprov.action_kind], ["op-hermes", "publicar"]);
  // conectar página = mexer em acesso de ativo.
  const g = portaFalsa();
  await pedirNoAr(g.porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar", { alvo: "conectar_pagina", instrucao: "Ligar a página X à BM" }), entradas: [], userId: "u" });
  assertEquals((g.chamadas.find((c) => c.nome === "criarAprovacao")!.args[0] as Record<string, unknown>).action_kind, "alterar_permissoes");
  // Já tem pedido aberto: 409 com o id, sem criar tarefa.
  const h = portaFalsa({ aberto: { id: "aprov-velho", status: "pendente" } });
  const e = await assertRejects(() => pedirNoAr(h.porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar", { alvo: "publicar_site" }), entradas: entradasDoAnuncio(), userId: "u" }), ErroHttp);
  assertEquals((e as ErroHttp).codigo, "ja_pedido");
  assert(!h.nomes().includes("criarTarefa"));
  // Sem nada ligado e sem instrução; publicar site sem landing.
  await assertRejects(() => pedirNoAr(portaFalsa().porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar"), entradas: [], userId: "u" }), ErroHttp, "Ligue");
  await assertRejects(() => pedirNoAr(portaFalsa().porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar", { alvo: "publicar_site" }), entradas: entradasDoAnuncio().slice(1), userId: "u" }), ErroHttp, "Landing");
});

Deno.test("Pôr no ar: a aprovação que falha desfaz a tarefa (nada fica pela metade)", async () => {
  const f = portaFalsa();
  f.porta.criarAprovacao = () => Promise.reject(new ErroHttp(503, "aprovacao_nao_criada", "falhou"));
  await assertRejects(() => pedirNoAr(f.porta, { projetoId: "p", projetoNome: "P", nomeDoCliente: null, execucaoId: "e", no: no("ar", "por_no_ar", { alvo: "publicar_site" }), entradas: entradasDoAnuncio(), userId: "u" }), ErroHttp);
  assertEquals(f.chamadas.find((c) => c.nome === "apagarTarefa")!.args[0], "tarefa-1");
});

Deno.test("Pôr no ar: quem faz (operador pedido, tráfego do Paperclip no anúncio, senão o Hermes)", () => {
  assertEquals(operadorParaOAlvo(OPERADORES, "subir_anuncio_pausado", null).slug, "paperclip-trafego");
  assertEquals(operadorParaOAlvo(OPERADORES, "publicar_site", null).slug, "default");
  assertEquals(operadorParaOAlvo(OPERADORES.filter((o) => o.id !== "op-pc"), "subir_anuncio_pausado", null).slug, "default");
  assertEquals(operadorParaOAlvo(OPERADORES, "publicar_site", "editor").slug, "editor");
  let erro: unknown = null;
  try {
    operadorParaOAlvo(OPERADORES, "publicar_site", "fantasma");
  } catch (e) {
    erro = e;
  }
  assertEquals((erro as ErroHttp).codigo, "operador_inativo");
});

const saidaPedida = (): SaidaDoNoAr => ({
  texto: "",
  estado: "aguardando_aprovacao",
  alvo: "subir_anuncio_pausado",
  action_kind: "publicar",
  aprovacao_id: "aprov-1",
  link_aprovacao: "/execucao?aprovacao=aprov-1",
  operador: "paperclip-trafego",
  operador_nome: "Gestor de Tráfego (Paperclip)",
  tarefa_id: "tarefa-1",
  link_id: null,
  prova: "",
  link_no_ar: "",
  pacote: montarPacote([]),
});

const aprovacao = (x: Record<string, unknown>) => ({ id: "aprov-1", status: "pendente", executed_at: null, execution_evidence: null, decision_note: null, task_link_id: null, kanban_task_id: "tarefa-1", operator_slug: "paperclip-trafego", payload: { alvo: "subir_anuncio_pausado", instrucao: "Subir PAUSADO" }, ...x });

Deno.test("Pôr no ar: acompanhar segue a decisão (aguardando → com o agente → feito com prova; recusado)", async () => {
  // Pendente: nada muda e ninguém é chamado.
  const p = portaFalsa({ aprovacao: aprovacao({}) });
  const r1 = await semRede(() => acompanharNoAr(p.porta, saidaPedida()));
  assertEquals([r1.saida.estado, r1.status], ["aguardando_aprovacao", "aguardando"]);
  assert(!p.nomes().includes("entregarAoOperador"));
  // Aprovado sem vínculo (o gatilho não entregou): entrega uma vez pela fila, liga e instrui.
  const a = portaFalsa({ aprovacao: aprovacao({ status: "aprovado" }) });
  const r2 = await semRede(() => acompanharNoAr(a.porta, saidaPedida()));
  assertEquals([r2.saida.estado, r2.status, r2.saida.link_id], ["com_agente", "aguardando", "link-1"]);
  assertEquals(a.nomes().filter((n) => n === "entregarAoOperador").length, 1);
  assertEquals(a.chamadas.find((c) => c.nome === "entregarAoOperador")!.args.slice(0, 2), ["paperclip-trafego", "tarefa-1"]);
  assert(a.nomes().includes("ligarAprovacao") && a.nomes().includes("instruir"));
  // Aprovado com vínculo: não entrega de novo.
  const b = portaFalsa({ aprovacao: aprovacao({ status: "aprovado", task_link_id: "link-9" }) });
  await acompanharNoAr(b.porta, saidaPedida());
  assert(!b.nomes().includes("entregarAoOperador"));
  // Feito: com a prova e o link.
  const c = portaFalsa({ aprovacao: aprovacao({ status: "aprovado", task_link_id: "link-9", executed_at: "2026-10-20T10:00:00Z", execution_evidence: "Anúncio 123 criado PAUSADO: https://adsmanager.test/123 ok" }) });
  const r3 = await acompanharNoAr(c.porta, saidaPedida());
  assertEquals([r3.saida.estado, r3.status, r3.saida.link_no_ar], ["feito", "pronto", "https://adsmanager.test/123"]);
  assertMatch(r3.saida.prova, /PAUSADO/);
  // Recusado: erro com a nota do dono.
  const d = portaFalsa({ aprovacao: aprovacao({ status: "rejeitado", decision_note: "Troque a foto" }) });
  const r4 = await acompanharNoAr(d.porta, saidaPedida());
  assertEquals([r4.saida.estado, r4.status], ["recusado", "erro"]);
  assertMatch(r4.erro!, /Troque a foto/);
});

Deno.test("Pôr no ar: estado e link da prova", () => {
  assertEquals(estadoDoPedido({ status: "adiado", executed_at: null }), "aguardando_aprovacao");
  assertEquals(estadoDoPedido({ status: "alteracoes_pedidas", executed_at: null }), "recusado");
  assertEquals(estadoDoPedido({ status: "expirado", executed_at: null }), "recusado");
  assertEquals(estadoDoPedido({ status: "aprovado", executed_at: "x" }), "feito");
  assertEquals(primeiroLink("veja (https://site.test/a?b=1) feito"), "https://site.test/a?b=1");
  assertEquals(primeiroLink(null), "");
});
