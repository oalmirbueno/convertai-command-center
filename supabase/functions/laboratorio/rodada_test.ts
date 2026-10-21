import { assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assinaturaDoFluxo, assinaturaDoNo, cancelarPendentes, continuarRodada, encerrarDependenciaPersistida, type ExecucaoDaRodada, planoDaRodada, type PortaDaContinuacao, prepararFilasDaRodada } from "./rodada.ts";
import type { Canvas, NoDoCanvas } from "./modulos/regras.ts";
import { ErroHttp } from "./comum.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"]): NoDoCanvas => ({ id, tipo, dados: {}, x: 0, y: 0 });
function canvas(): Canvas { return { nos: [no("base", "contexto"), no("arte", "imagem"), no("pagina", "landing"), no("anuncio", "anuncio")], ligacoes: [{ id: "a", de: "base", para: "arte" }, { id: "b", de: "arte", para: "pagina" }, { id: "c", de: "pagina", para: "anuncio" }], viewport: { x: 0, y: 0, zoom: 1 } }; }
async function linhas(c: Canvas): Promise<ExecucaoDaRodada[]> {
  return await Promise.all(["arte", "pagina", "anuncio"].map(async (id, i) => ({ id: `ex-${id}`, no_id: id, created_by: "dono", status: i ? "aguardando" : "pronto", saida: i ? { aguardando_dependencias: true } : { imagens: [{ path: "arte.png" }] }, entrada: { lab_rodada: { assinatura: await assinaturaDoNo(c, id), ator_id: "dono", reserva: { movimentoId: "reserva-unica", valor: 2, ativa: true, saldo: 10 }, custo_usd: i ? 1 : 0 } } })));
}
function porta(o: { perderCas?: boolean; esperarPagina?: boolean } = {}) {
  const rodados: string[] = [], encerrados: string[] = [], reservas: string[] = [];
  const p: PortaDaContinuacao = {
    assumir: async () => !o.perderCas,
    rodar: async (n, _e, a) => { rodados.push(n.id); reservas.push(a.reserva!.movimentoId); return { status: o.esperarPagina && n.id === "pagina" ? "aguardando" : "pronto", saida: { texto: "Entrega real" } }; },
    encerrar: async (e) => { encerrados.push(e.no_id); },
  };
  return { p, rodados, encerrados, reservas };
}

Deno.test("rodada: continua depois da arte pronta, na ordem, com a reserva original e sem refazer a arte", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, ["pagina", "anuncio"]);
  assertEquals(f.reservas, ["reserva-unica", "reserva-unica"]);
  assertEquals(ex.map((e) => e.status), ["pronto", "pronto", "pronto"]);
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados.length, 2);
});
Deno.test("rodada: arte ainda aguardando mantém os dependentes parados", async () => {
  const c = canvas(), ex = await linhas(c), f = porta(); ex[0].status = "aguardando";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []); assertEquals(f.encerrados, []);
});
Deno.test("rodada: uma nova etapa assíncrona segura o próximo nó", async () => {
  const c = canvas(), ex = await linhas(c), f = porta({ esperarPagina: true });
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, ["pagina"]); assertEquals(ex[2].status, "aguardando");
});
Deno.test("rodada: duas abas não assumem a mesma etapa", async () => {
  const c = canvas(), ex = await linhas(c), f = porta({ perderCas: true });
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []); assertEquals(f.encerrados, []);
});
Deno.test("rodada: conteúdo alterado cancela pendentes e devolve suas partes sem executar", async () => {
  const c = canvas(), ex = await linhas(c), f = porta(); c.nos[2].dados.modelo_id = "outro-modelo";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []); assertEquals(f.encerrados, ["pagina", "anuncio"]);
  assertEquals(ex[0].status, "pronto");
});
Deno.test("rodada: editar outra frente não cancela esta cadeia; mudar o contexto do projeto cancela", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  c.nos.push(no("outra-frente", "copy")); c.nos.at(-1)!.dados.instrucao = "Outro produto";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, ["pagina", "anuncio"]);
  const ex2 = await linhas(c), g = porta();
  await continuarRodada(c, ex2, "dono", g.p, "Nova campanha");
  assertEquals(g.rodados, []); assertEquals(g.encerrados, ["pagina", "anuncio"]);
});
Deno.test("rodada: falha do antecessor encerra toda a cadeia pendente", async () => {
  const c = canvas(), ex = await linhas(c), f = porta(); ex[0].status = "erro";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []); assertEquals(f.encerrados, ["pagina", "anuncio"]);
});
Deno.test("rodada: outro ator, confirmação ausente e execução de terceiro nunca continuam", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  await continuarRodada(c, ex, "outro", f.p);
  ex[1].entrada = {}; ex[2].created_by = "terceiro";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []); assertEquals(f.encerrados, []);
});
Deno.test("assinatura: posição, viewport e ordem das chaves não invalidam; modelo e ligação invalidam", async () => {
  const c = canvas(), original = await assinaturaDoFluxo(c);
  c.nos[0].x = 900; c.viewport.zoom = 0.5; c.nos.reverse();
  assertEquals(await assinaturaDoFluxo(c), original);
  c.nos[0].dados.modelo_id = "escolhido";
  assertNotEquals(await assinaturaDoFluxo(c), original);
  delete c.nos[0].dados.modelo_id; c.ligacoes[0].de = "pagina";
  assertNotEquals(await assinaturaDoFluxo(c), original);
});

Deno.test("plano: estimativa e execução incluem ancestrais faltantes, mas reusam as entradas prontas fora dos alvos", async () => {
  const c = canvas(), ex = await linhas(c);
  ex[0].entrada.assinatura_no = await assinaturaDoNo(c, "arte");
  const r = await planoDaRodada(c, ["pagina"], [ex[0]]);
  assertEquals(r.ordem, ["pagina"]); assertEquals(r.reutilizados.map((e) => e.no_id), ["arte"]);
  const semArte = await planoDaRodada(c, ["pagina"], []);
  assertEquals(semArte.ordem, ["arte", "pagina"]);
  const refazerArte = await planoDaRodada(c, ["arte", "pagina"], [ex[0]]);
  assertEquals(refazerArte.ordem, ["arte", "pagina"]); assertEquals(refazerArte.reutilizados, []);
});
Deno.test("plano: alterações semânticas invalidam o ancestral; layout não o refaz; andamento não duplica geração", async () => {
  const c = canvas(), ex = await linhas(c);
  ex[0].entrada.assinatura_no = await assinaturaDoNo(c, "arte");
  c.nos[1].x = 50;
  assertEquals((await planoDaRodada(c, ["pagina"], [ex[0]])).reutilizados.length, 1);
  c.nos[0].dados.texto = "Nova oferta";
  assertEquals((await planoDaRodada(c, ["pagina"], [ex[0]])).ordem, ["arte", "pagina"]);
  ex[0].status = "aguardando";
  assertEquals((await planoDaRodada(c, ["pagina"], [ex[0]])).ocupados, ["arte"]);
});
Deno.test("plano: continuar não cobra de novo as entradas reutilizadas e não depende de uma execução nova delas", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  // A execução pronta anterior pode ter sido feita por outro operador autorizado no mesmo projeto.
  ex[0].entrada = {}; ex[0].created_by = "colega";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, ["pagina", "anuncio"]);
  assertEquals(f.reservas, ["reserva-unica", "reserva-unica"]);
});

Deno.test("cancelar: devolve somente etapas não iniciadas, uma vez, e mantém arte pronta e trabalhos reais", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  const ativo = { ...ex[1], id: "trabalho-externo", no_id: "externo", saida: { tarefa_id: "tarefa-real" } };
  const gerando = { ...ex[1], id: "gerando", no_id: "gerando", status: "rodando" };
  const lista = [...ex, ativo, gerando];
  assertEquals(await cancelarPendentes(lista, "dono", f.p), ["pagina", "anuncio"]);
  assertEquals(f.encerrados, ["pagina", "anuncio"]);
  assertEquals(await cancelarPendentes(lista, "dono", f.p), []);
  assertEquals(f.encerrados.length, 2);
  assertEquals([ex[0].status, ativo.status, gerando.status], ["pronto", "aguardando", "rodando"]);
});
Deno.test("cancelar: outro ator e uma segunda aba sem CAS não cancelam nem devolvem a reserva", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  assertEquals(await cancelarPendentes(ex, "outro", f.p), []);
  assertEquals(f.encerrados, []);
  const perdendo = porta({ perderCas: true });
  assertEquals(await cancelarPendentes(ex, "dono", perdendo.p), []);
  assertEquals(perdendo.encerrados, []);
});

Deno.test("encerrar: falha ao persistir não estorna nem confirma cancelamento e recupera a espera para retentar", async () => {
  const ex = (await linhas(canvas())).filter((e) => e.no_id === "pagina");
  let estadoNoBanco = "aguardando", falhar = true, estornos = 0, incidentes = 0;
  const p = {
    assumir: async () => { if (estadoNoBanco !== "aguardando") return false; estadoNoBanco = "na_fila"; return true; },
    encerrar: () => encerrarDependenciaPersistida({
      salvarFim: async () => { if (falhar) throw new Error("banco recusou o fim"); estadoNoBanco = "erro"; return true; },
      reabrirEspera: async () => { if (estadoNoBanco !== "na_fila") return false; estadoNoBanco = "aguardando"; return true; },
      estornar: async () => { assertEquals(estadoNoBanco, "erro"); estornos++; },
      incidente: () => { incidentes++; },
    }),
  };
  const erro = await assertRejects(() => cancelarPendentes(ex, "dono", p), ErroHttp);
  assertEquals(erro.codigo, "encerramento_pendente_nao_salvo");
  assertEquals([estadoNoBanco, ex[0].status, estornos, incidentes], ["aguardando", "aguardando", 0, 0]);
  falhar = false;
  assertEquals(await cancelarPendentes(ex, "dono", p), ["pagina"]);
  assertEquals([estadoNoBanco, ex[0].status, estornos], ["erro", "erro", 1]);
  assertEquals(await cancelarPendentes(ex, "dono", p), []);
  assertEquals(estornos, 1);
});

Deno.test("encerrar: ausência de confirmação e recuperação recusada viram incidente explícito sem estorno", async () => {
  let estornos = 0, incidentes = 0;
  const erro = await assertRejects(() => encerrarDependenciaPersistida({
    salvarFim: async () => false,
    reabrirEspera: async () => { throw new Error("rede indisponível"); },
    estornar: async () => { estornos++; },
    incidente: () => { incidentes++; },
  }), ErroHttp);
  assertEquals(erro.codigo, "encerramento_pendente_incerto");
  assertEquals([estornos, incidentes], [0, 1]);
});

Deno.test("cliente: mudar o titular invalida cache e confirmação; estorno referencia apenas a reserva original", async () => {
  const c = canvas(), ex = await linhas(c), f = porta();
  const clienteA = "11111111-1111-4111-8111-111111111111", clienteB = "22222222-2222-4222-8222-222222222222";
  for (const e of ex) {
    e.entrada.assinatura_no = await assinaturaDoNo(c, e.no_id, null, clienteA);
    Object.assign(e.entrada.lab_rodada as object, { assinatura: e.entrada.assinatura_no, client_id: clienteA });
  }
  assertEquals((await planoDaRodada(c, ["pagina"], [ex[0]], null, clienteB)).reutilizados, []);
  const estornos: unknown[] = [];
  f.p.encerrar = async (_e, _m, a) => { estornos.push([a.client_id, a.reserva?.movimentoId]); };
  await continuarRodada(c, ex, "dono", f.p, null, clienteB);
  assertEquals(f.rodados, []);
  assertEquals(estornos, [[clienteA, "reserva-unica"], [clienteA, "reserva-unica"]]);
});
Deno.test("dependência: um nó estático entre duas imagens não deixa o segundo gerar cedo", async () => {
  const c: Canvas = { nos: [no("arte", "imagem"), no("base", "gravity"), no("pagina", "imagem")], ligacoes: [{ id: "a", de: "arte", para: "base" }, { id: "b", de: "base", para: "pagina" }], viewport: { x: 0, y: 0, zoom: 1 } };
  const ex = (await linhas(c)).filter((e) => e.no_id !== "anuncio"), f = porta();
  ex[0].status = "aguardando";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, []);
  ex[0].status = "pronto";
  await continuarRodada(c, ex, "dono", f.p);
  assertEquals(f.rodados, ["pagina"]);
});
Deno.test("fila: falha no segundo registro encerra só os registros parciais antes de propagar a falha", async () => {
  const criadas: string[] = [], abortadas: string[][] = [];
  await assertRejects(() => prepararFilasDaRodada(["a", "b", "c"], {
    criar: async (id) => { criadas.push(id); if (id === "b") throw new Error("banco recusou"); return `ex-${id}`; },
    abortar: async (ids) => { abortadas.push(ids); },
  }), Error, "banco recusou");
  assertEquals(criadas, ["a", "b"]); assertEquals(abortadas, [["ex-a"]]);
  const completo = await prepararFilasDaRodada(["a", "b"], { criar: async (id) => `nova-${id}`, abortar: async () => { throw new Error("não deve abortar"); } });
  assertEquals(completo, { a: "nova-a", b: "nova-b" });
});
