/**
 * Créditos do Laboratório (20/10/2026): reserva na confirmação e estorno da falha, com o banco falso.
 *
 *   deno test --allow-env supabase/functions/laboratorio/creditos_test.ts
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Chamador, ErroHttp } from "./comum.ts";
import {
  carregarCreditos,
  cobrarConfirmacao,
  estornarCreditos,
  gastoDosMovimentos,
  inicioDoMes,
  type PortaDosCreditos,
  reservarCreditos,
  semCreditosNoBanco,
  valorDaCarga,
} from "./creditos.ts";

type Chamada = { nome: string; args: Record<string, unknown> };

/** Banco falso com a regra das RPCs: ativa debita e bloqueia sem saldo; inativa só registra. */
function bancoFalso(o: { saldo?: number; ativa?: boolean; erro?: { code?: string; message?: string } } = {}) {
  const chamadas: Chamada[] = [];
  let saldo = o.saldo ?? 0;
  const ativa = o.ativa ?? false;
  const usos = new Map<string, { valor: number; debitado: boolean; devolvido: number }>();
  let n = 0;
  const porta: PortaDosCreditos = {
    rpc: (nome, args) => {
      chamadas.push({ nome, args });
      if (o.erro) return Promise.resolve({ data: null, error: o.erro });
      if (nome === "lab_creditos_reservar") {
        const valor = Number(args.p_valor);
        if (ativa && saldo < valor) return Promise.resolve({ data: { ok: false, erro: "sem_credito", saldo_usd: saldo, custo_usd: valor, ativa: true }, error: null });
        if (ativa) saldo -= valor;
        const id = `mov-${++n}`;
        usos.set(id, { valor, debitado: ativa, devolvido: 0 });
        return Promise.resolve({ data: { ok: true, movimento_id: id, saldo_usd: saldo, ativa, custo_usd: valor }, error: null });
      }
      if (nome === "lab_creditos_estornar") {
        const u = usos.get(String(args.p_reserva_id))!;
        const pedido = args.p_valor == null ? u.valor : Number(args.p_valor);
        const valor = Math.min(pedido, u.valor - u.devolvido);
        u.devolvido += valor;
        if (u.debitado) saldo += valor;
        return Promise.resolve({ data: { ok: true, estornado_usd: valor, saldo_usd: saldo }, error: null });
      }
      if (nome === "lab_creditos_carregar") {
        saldo += Number(args.p_valor);
        return Promise.resolve({ data: { ok: true, movimento_id: "carga-1", saldo_usd: saldo, ativa: true, primeira: true }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: "nao existe" } });
    },
  };
  return { porta, chamadas, saldo: () => saldo, nomes: () => chamadas.map((c) => c.nome) };
}

const chamador = (papeis: string[]): Chamador => ({ userId: "u-1", token: "t", papeis, doChamador: null as never });

Deno.test("carteira inativa (o começo): só registra o uso, não bloqueia nem mexe no saldo", async () => {
  const b = bancoFalso({ saldo: 0, ativa: false });
  const r = await reservarCreditos({ valor: 1.25, projetoId: "p-1", nota: "Rodar Copy", userId: "u-1" }, b.porta);
  assert(r);
  assertEquals(r.ativa, false);
  assertEquals(b.saldo(), 0);
  assertEquals(b.chamadas[0].args.p_valor, 1.25);
  assertEquals(b.chamadas[0].args.p_projeto_id, "p-1");
});

Deno.test("carteira ativa com saldo: debita na confirmação", async () => {
  const b = bancoFalso({ saldo: 10, ativa: true });
  const r = await reservarCreditos({ valor: 4, projetoId: "p-1", nota: "x", userId: "u-1" }, b.porta);
  assertEquals(r?.saldo, 6);
  assertEquals(b.saldo(), 6);
});

Deno.test("carteira ativa sem saldo: 402 sem_credito com saldo e custo, nada debitado", async () => {
  const b = bancoFalso({ saldo: 0.5, ativa: true });
  const e = await assertRejects(() => reservarCreditos({ valor: 2, projetoId: "p-1", nota: "x", userId: "u-1" }, b.porta), ErroHttp);
  assertEquals(e.status, 402);
  assertEquals(e.codigo, "sem_credito");
  assertEquals(e.extra, { saldo_usd: 0.5, custo_usd: 2 });
  assert(/Carregue créditos/.test(e.message));
  assertEquals(b.saldo(), 0.5);
});

Deno.test("custo zero não reserva nada; banco sem a migration não trava", async () => {
  const b = bancoFalso({ ativa: true });
  assertEquals(await reservarCreditos({ valor: 0, projetoId: "p-1", nota: "x", userId: "u-1" }, b.porta), null);
  assertEquals(b.chamadas.length, 0);
  const sem = bancoFalso({ erro: { code: "PGRST202", message: "Could not find the function public.lab_creditos_reservar" } });
  assertEquals(await reservarCreditos({ valor: 3, projetoId: "p-1", nota: "x", userId: "u-1" }, sem.porta), null);
  assert(semCreditosNoBanco({ code: "42883", message: "function does not exist" }));
  assert(!semCreditosNoBanco({ code: "23505", message: "duplicate" }));
});

Deno.test("rodar tudo: reserva o total e cada nó que falha devolve só a parte dele, uma vez", async () => {
  const b = bancoFalso({ saldo: 10, ativa: true });
  const c = await cobrarConfirmacao({ porNo: [{ no_id: "copy_1", custo_usd: 1 }, { no_id: "imagem_1", custo_usd: 3 }], total: 4, projetoId: "p-1", nota: "Rodar tudo (2 nós)", userId: "u-1" }, b.porta);
  assertEquals(b.saldo(), 6);
  await c.devolverNo("imagem_1", "ex-2", "o provedor caiu");
  await c.devolverNo("imagem_1", "ex-2", "de novo");
  assertEquals(b.saldo(), 9);
  const estornos = b.chamadas.filter((x) => x.nome === "lab_creditos_estornar");
  assertEquals(estornos.length, 1);
  assertEquals(estornos[0].args.p_valor, 3);
  assertEquals(estornos[0].args.p_execucao_id, "ex-2");
  assert(String(estornos[0].args.p_nota).indexOf("Falha não cobra") === 0);
});

Deno.test("nada chegou a rodar: devolve o que sobrou da reserva", async () => {
  const b = bancoFalso({ saldo: 10, ativa: true });
  const c = await cobrarConfirmacao({ porNo: [{ no_id: "a", custo_usd: 2 }, { no_id: "b", custo_usd: 2 }], total: 4, projetoId: "p-1", nota: "x", userId: "u-1" }, b.porta);
  await c.devolverNo("a", null, "falhou");
  await c.devolverTudo("a rodada não começou");
  assertEquals(b.saldo(), 10);
  // Depois do devolverTudo, nenhum nó devolve de novo.
  await c.devolverNo("b", null, "falhou");
  assertEquals(b.chamadas.filter((x) => x.nome === "lab_creditos_estornar").length, 2);
});

Deno.test("estorno com a carteira inativa não mexe no saldo; estorno nunca lança", async () => {
  const b = bancoFalso({ saldo: 0, ativa: false });
  const c = await cobrarConfirmacao({ porNo: [{ no_id: "a", custo_usd: 2 }], total: 2, projetoId: "p-1", nota: "x", userId: "u-1" }, b.porta);
  await c.devolverNo("a", "ex-1", "falhou");
  assertEquals(b.saldo(), 0);
  const quebrado: PortaDosCreditos = { rpc: () => Promise.reject(new Error("rede caiu")) };
  await estornarCreditos({ movimentoId: "m", valor: 1, ativa: true, saldo: 0 }, { nota: "x", userId: "u-1" }, quebrado);
  await estornarCreditos(null, { nota: "x", userId: "u-1" }, quebrado);
});

Deno.test("carregar: só admin, de 1 a 10.000, registro manual com quem carregou", async () => {
  const b = bancoFalso({ saldo: 0, ativa: false });
  const e = await assertRejects(() => carregarCreditos(chamador(["design"]), { valor_usd: 50 }, b.porta), ErroHttp);
  assertEquals(e.status, 403);
  assertEquals(b.chamadas.length, 0);
  await assertRejects(() => carregarCreditos(chamador(["admin"]), { valor_usd: 0.5 }, b.porta), ErroHttp);
  await assertRejects(() => carregarCreditos(chamador(["admin"]), { valor_usd: 10001 }, b.porta), ErroHttp);
  const r = await carregarCreditos(chamador(["admin"]), { valor_usd: "50,5", nota: "Pix do mês" }, b.porta);
  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals(corpo.saldo_usd, 50.5);
  assertEquals(corpo.ativa, true);
  assertEquals(b.chamadas[0].args, { p_valor: 50.5, p_nota: "Pix do mês", p_ator: "u-1" });
  assertEquals(valorDaCarga(1), 1);
  assertEquals(valorDaCarga("10000"), 10000);
});

Deno.test("gasto do mês: uso menos estorno, por projeto, maior primeiro", () => {
  const g = gastoDosMovimentos([
    { tipo: "uso", valor_usd: 4, projeto_id: "a" },
    { tipo: "estorno", valor_usd: 3, projeto_id: "a" },
    { tipo: "uso", valor_usd: 2, projeto_id: "b" },
    { tipo: "carga", valor_usd: 100, projeto_id: null },
    { tipo: "uso", valor_usd: 0.5, projeto_id: null },
  ]);
  assertEquals(g.total, 3.5);
  assertEquals(g.porProjeto, [
    { projeto_id: "b", gasto_usd: 2 },
    { projeto_id: "a", gasto_usd: 1 },
    { projeto_id: null, gasto_usd: 0.5 },
  ]);
  // 1º de outubro em Brasília = 03:00 UTC.
  assertEquals(inicioDoMes(new Date("2026-10-20T12:00:00Z")), "2026-10-01T03:00:00.000Z");
  assertEquals(inicioDoMes(new Date("2026-11-01T01:00:00Z")), "2026-10-01T03:00:00.000Z");
});

Deno.test("seguirRodada (executar.ts): o nó que falha e o que dependia dele devolvem a parte deles", async () => {
  // Banco do serviço falso: toda chamada HTTP responde vazio (as linhas de lab_execucoes só são atualizadas).
  Deno.env.set("SUPABASE_URL", "http://banco-falso.local");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-falsa");
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }))) as typeof fetch;
  try {
    const { seguirRodada } = await import("./executar.ts");
    const b = bancoFalso({ saldo: 10, ativa: true });
    const cobranca = await cobrarConfirmacao({ porNo: [{ no_id: "copy_1", custo_usd: 1 }, { no_id: "copy_2", custo_usd: 2 }], total: 3, projetoId: "p-1", nota: "Rodar tudo (2 nós)", userId: "u-1" }, b.porta);
    assertEquals(b.saldo(), 7);
    const canvas = {
      nos: [
        { id: "copy_1", tipo: "copy", x: 0, y: 0, dados: {} },
        { id: "copy_2", tipo: "copy", x: 300, y: 0, dados: {} },
      ],
      ligacoes: [{ id: "l1", de: "copy_1", para: "copy_2" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const ctx = {
      projeto: { id: "p-1", nome: "Teste", client_id: null, contexto: null, canvas, versao: 1, status: "ativo", template_de: null, created_by: null, created_at: "", updated_at: "" },
      canvas,
      carteira: { clientId: "interno", livre: true },
      marca: "",
      nomeDoCliente: null,
      userId: "u-1",
      token: "t",
      rodadaId: "r-1",
      saidas: new Map(),
      cobranca,
    } as never;
    await seguirRodada(ctx, ["copy_1", "copy_2"], { copy_1: "ex-1", copy_2: "ex-2" });
    const estornos = b.chamadas.filter((x) => x.nome === "lab_creditos_estornar");
    assertEquals(estornos.map((e) => [e.args.p_execucao_id, e.args.p_valor]), [["ex-1", 1], ["ex-2", 2]]);
    assertEquals(b.saldo(), 10);
  } finally {
    globalThis.fetch = original;
  }
});
