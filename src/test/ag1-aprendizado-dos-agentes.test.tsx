/**
 * Frente AG1 (29/09): os agentes da Mesa aprendem com cada pedido do dono.
 * "Tem coisas que ele não pode mais fazer quando eu peço e não gostei. Tem que
 * ter inteligência de aprendizado. Cada ação tem que devolver."
 *
 * - a regra `evitar` é criada (Jev: preferência duradoura) e obedecida (entra
 *   primeiro no prompt do agente, com apelido);
 * - pedido de uma vez só não vira regra;
 * - "Esquecer" desliga a regra (a conversa mostra Esquecido e o prompt não a lê);
 * - regra repetida é reforçada, não duplicada.
 */
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anexoDasRegrasSeguidas,
  aprendizadoDosAnexos,
  blocoDasRegras,
  decidirAprendizado,
  decisaoSemJev,
  esquemaComAprendizado,
  fraseDoAprendizado,
  LIMIAR_DA_REGRA,
  perguntasDoAprendizado,
  regraDoModelo,
  regrasParaOAgente,
  regrasSeguidasDoModelo,
  regrasSeguidasDosAnexos,
  sinalDeRegra,
} from "../../supabase/functions/_shared/aprendizado-do-pedido";
import { aprenderComOPedido, lerRegrasDoDono } from "../../supabase/functions/_shared/aprendizado-nos-agentes";

// jsdom não tem AbortSignal.timeout (o Deno e os navegadores têm).
if (typeof (AbortSignal as any).timeout !== "function") (AbortSignal as any).timeout = () => new AbortController().signal;

// ---------------------------------------------------------------- banco de mentira (só o que o cérebro usa)

type Linha = Record<string, any>;

function bancoFalso(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = { agente_memoria: [], cliente_marcas: [], ...inicial };
  let seq = 0;
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let modo: "select" | "insert" | "update" = "select";
    let dados: Linha | null = null;
    let unico = false;
    let limite = Infinity;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      order: () => q,
      limit: (n: number) => ((limite = n), q),
      single: () => ((unico = true), q),
      maybeSingle: () => ((unico = true), q),
      insert: (row: Linha) => ((modo = "insert"), (dados = row), q),
      update: (patch: Linha) => ((modo = "update"), (dados = patch), q),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        try {
          const lista = (tabelas[tabela] = tabelas[tabela] || []);
          if (modo === "insert") {
            const nova = { id: `m${++seq}`, ativa: true, reforcos: 1, criado_em: new Date(2026, 8, 29, 10, seq).toISOString(), ...dados };
            lista.push(nova);
            return Promise.resolve(ok({ data: unico ? { id: nova.id } : [{ id: nova.id }], error: null }));
          }
          const achadas = lista.filter((l) => filtros.every((f) => f(l)));
          if (modo === "update") {
            achadas.forEach((l) => Object.assign(l, dados));
            return Promise.resolve(ok({ data: null, error: null }));
          }
          const cortadas = achadas.slice(0, limite);
          return Promise.resolve(ok({ data: unico ? cortadas[0] ?? null : cortadas, error: null }));
        } catch (e) {
          return erro ? Promise.resolve(erro(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  };
  return { tabelas, db: { from: (t: string) => consulta(t) } };
}

// ---------------------------------------------------------------- Jev de mentira (por HTTP, como o de verdade)

type Resposta = { choice: string; p: number };
let respostaDoJev: { duracao: Resposta; categoria?: string; area?: string; repete?: string } = { duracao: { choice: "preferencia_duradoura", p: 0.9 } };
const pedidosAoJev: Array<Record<string, any>> = [];

function jevFalso() {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const corpo = JSON.parse(init.body);
    pedidosAoJev.push(corpo);
    const answers: Record<string, unknown> = {};
    const q = corpo.questions as Record<string, unknown>;
    if (q.duracao) {
      const d = respostaDoJev.duracao;
      answers.duracao = { choice: d.choice, confidence: d.p, probabilities: { preferencia_duradoura: d.choice === "preferencia_duradoura" ? d.p : 1 - d.p, so_desta_vez: d.choice === "so_desta_vez" ? d.p : (1 - d.p) / 2, incerto: 0.05 } };
      answers.categoria = { choice: respostaDoJev.categoria || "evitar", confidence: 0.9, probabilities: { evitar: 0.9, preferencia: 0.1 } };
      if (q.area) answers.area = { choice: respostaDoJev.area || "arte", confidence: 0.8, probabilities: { arte: 0.8 } };
    }
    if (q.repete) {
      const r = respostaDoJev.repete || "nenhum";
      answers.repete = { choice: r, confidence: 0.9, probabilities: { [r]: 0.9 } };
      answers.contradiz = { choice: "nenhum", confidence: 0.9, probabilities: { nenhum: 0.9 } };
    }
    return new Response(JSON.stringify({ answers, usage: null, model: "jev-latest" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  pedidosAoJev.length = 0;
  respostaDoJev = { duracao: { choice: "preferencia_duradoura", p: 0.9 } };
  (globalThis as any).Deno = { env: { get: (k: string) => (k === "TYPESAFE_API_KEY" ? "chave-de-teste" : undefined) } };
  vi.stubGlobal("fetch", jevFalso());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as any).Deno;
});

const PEDIDO_NAO_GOSTEI = "Não gostei desse fundo preto nas artes, nunca mais use fundo preto para esse cliente.";

describe("aprender com o pedido (Jev decide se vale para sempre)", () => {
  it("regra evitar é criada e volta como 'Aprendi', na área que o Jev escolheu", async () => {
    const { db, tabelas } = bancoFalso();
    const r = await aprenderComOPedido(db, {
      clientId: "c1", mensagem: PEDIDO_NAO_GOSTEI, regra: regraDoModelo({ texto: "Nunca usar fundo preto nas artes", categoria: "evitar" }),
      agente: "contexto", areas: ["geral", "arte", "copy"], areaPadrao: "geral", userId: "u1", fonte: "agente_contexto",
    });
    expect(r.decisao?.grava).toBe(true);
    expect(r.anexo).toMatchObject({ tipo: "aprendizado_do_agente", decisao: "preferencia_duradoura", texto: "Nunca usar fundo preto nas artes", categoria: "evitar", area: "arte", situacao: "criado" });
    const gravada = tabelas.agente_memoria[0];
    expect(gravada).toMatchObject({ client_id: "c1", agente: "diretor_arte", tipo: "evitar", categoria: "evitar", area: "arte", fonte: "agente_contexto", ativa: true });
    expect(gravada.motivo).toContain("Pedido do dono ao agente contexto: Não gostei desse fundo preto");
    expect(fraseDoAprendizado(r.anexo!)).toBe("Aprendi: Nunca usar fundo preto nas artes");
    // As três perguntas foram num pedido só (duração, categoria e área).
    expect(Object.keys(pedidosAoJev[0].questions).sort()).toEqual(["area", "categoria", "duracao"]);
    expect(pedidosAoJev[0].state.pedido_do_dono).toContain("nunca mais use fundo preto");
  });

  it("e é obedecida: a regra evitar entra primeiro no prompt, com apelido, e o 'Segui' só aceita apelido da lista", async () => {
    const { db } = bancoFalso({
      agente_memoria: [
        { id: "p1", client_id: "c1", agente: "estrategista", tipo: "preferencia", categoria: "preferencia", area: "copy", texto: "Sempre falar com o dono da empresa", ativa: true, reforcos: 3, criado_em: "2026-09-20" },
        { id: "e1", client_id: "c1", agente: "diretor_arte", tipo: "evitar", categoria: "evitar", area: "arte", texto: "Nunca usar fundo preto nas artes", ativa: true, reforcos: 1, criado_em: "2026-09-29" },
        { id: "x1", client_id: "c1", agente: "estrategista", tipo: "preferencia", categoria: "preferencia", area: "calendario", texto: "Plano do mês 2026-10: foco em poda", ativa: true },
        { id: "z1", client_id: "c1", agente: "diretor_arte", tipo: "evitar", categoria: "evitar", area: "arte", texto: "Esquecida", ativa: false },
      ],
    });
    const regras = await lerRegrasDoDono(db, "c1", { areas: ["arte", "copy"] });
    expect(regras.map((r) => r.id)).toEqual(["e1", "p1"]);
    expect(regras[0]).toMatchObject({ ref: "g1", categoria: "evitar" });
    const bloco = blocoDasRegras(regras);
    expect(bloco.indexOf("EVITAR:")).toBeLessThan(bloco.indexOf("PREFERÊNCIAS:"));
    expect(bloco).toContain("g1 | Nunca usar fundo preto nas artes");
    expect(bloco).toContain("(pedido 3 vezes)");
    expect(bloco).not.toContain("Esquecida");
    expect(bloco).not.toContain("Plano do mês");
    const seguidas = regrasSeguidasDoModelo(["g1", "g9", "G1"], regras);
    expect(seguidas).toEqual([{ id: "e1", texto: "Nunca usar fundo preto nas artes", categoria: "evitar", tipo: "evitar" }]);
    expect(regrasSeguidasDosAnexos([anexoDasRegrasSeguidas(seguidas)])).toHaveLength(1);
  });

  it("pedido de uma vez só não vira regra (nada é gravado)", async () => {
    respostaDoJev = { duracao: { choice: "so_desta_vez", p: 0.85 } };
    const { db, tabelas } = bancoFalso();
    const r = await aprenderComOPedido(db, {
      clientId: "c1", mensagem: "Mude a data desse post para sexta.", regra: regraDoModelo({ texto: "Postar às sextas", categoria: "preferencia" }),
      agente: "do Mês", areas: ["calendario"], areaPadrao: "calendario", userId: "u1", fonte: "agente_do_mes",
    });
    expect(r.anexo).toBeNull();
    expect(r.decisao).toMatchObject({ grava: false, motivo: "pedido só desta vez" });
    expect(tabelas.agente_memoria).toHaveLength(0);
  });

  it("incerto ou abaixo do limiar também não grava; sem regra do modelo nem pergunta ao Jev", async () => {
    expect(decidirAprendizado({ duracao: { choice: "incerto", probabilities: { incerto: 0.7 } } }, { regra: { texto: "x", categoria: null }, areas: ["arte"], areaPadrao: "arte" }).grava).toBe(false);
    expect(decidirAprendizado({ duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: LIMIAR_DA_REGRA - 0.01 } } }, { regra: { texto: "x", categoria: null }, areas: ["arte"], areaPadrao: "arte" }).grava).toBe(false);
    const { db } = bancoFalso();
    const r = await aprenderComOPedido(db, { clientId: "c1", mensagem: "oi", regra: null, agente: "contexto", areas: ["geral"], areaPadrao: "geral", userId: "u1", fonte: "agente_contexto" });
    expect(r).toEqual({ anexo: null, decisao: null, erro: null });
    expect(pedidosAoJev).toHaveLength(0);
  });

  it("regra repetida é reforçada, não duplicada", async () => {
    const { db, tabelas } = bancoFalso();
    const entrada = {
      clientId: "c1", mensagem: PEDIDO_NAO_GOSTEI, regra: regraDoModelo({ texto: "Nunca usar fundo preto nas artes", categoria: "evitar" }),
      agente: "contexto", areas: ["arte"] as Array<"arte">, areaPadrao: "arte" as const, userId: "u1", fonte: "agente_contexto",
    };
    const primeira = await aprenderComOPedido(db, entrada);
    const segunda = await aprenderComOPedido(db, { ...entrada, mensagem: "de novo o fundo preto, nunca mais" });
    expect(primeira.anexo?.situacao).toBe("criado");
    expect(segunda.anexo).toMatchObject({ situacao: "reforcado", id: primeira.anexo!.id, reforcos: 2 });
    expect(tabelas.agente_memoria).toHaveLength(1);
    expect(tabelas.agente_memoria[0].reforcos).toBe(2);
    expect(fraseDoAprendizado(segunda.anexo!)).toBe("Reforcei o que já sabia: Nunca usar fundo preto nas artes (2x)");
  });

  it("sem o Jev, só ordem explícita vira regra (reserva)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { db, tabelas } = bancoFalso();
    const nao = await aprenderComOPedido(db, { clientId: "c1", mensagem: "Coloque este post amanhã", regra: regraDoModelo({ texto: "Postar amanhã", categoria: "preferencia" }), agente: "do Mês", areas: ["calendario"], areaPadrao: "calendario", userId: "u1", fonte: "agente_do_mes" });
    expect(nao.anexo).toBeNull();
    const sim = await aprenderComOPedido(db, { clientId: "c1", mensagem: "Daqui pra frente sempre com CTA para o WhatsApp", regra: regraDoModelo({ texto: "Sempre terminar com CTA para o WhatsApp", categoria: "preferencia" }), agente: "do Mês", areas: ["calendario"], areaPadrao: "calendario", userId: "u1", fonte: "agente_do_mes" });
    expect(sim.anexo).toMatchObject({ categoria: "preferencia", area: "calendario" });
    expect(tabelas.agente_memoria).toHaveLength(1);
    expect(decisaoSemJev("não gostei, nunca mais", { texto: "Nunca usar rosa", categoria: null }, "arte")).toMatchObject({ grava: true, categoria: "evitar" });
    expect(sinalDeRegra("mude a data")).toEqual({ forte: false, negativo: false });
  });

  it("a regra aprendida numa marca não vale na outra (referencia_id = marca)", () => {
    const linhas = [
      { id: "a", texto: "Nunca usar rosa", categoria: "evitar", area: "arte", referencia_id: "11111111-1111-4111-8111-111111111111", ativa: true },
      { id: "b", texto: "Sempre verde", categoria: "preferencia", area: "arte", referencia_id: null, ativa: true },
      { id: "c", texto: "Sem marca, com tarefa", categoria: "evitar", area: "arte", referencia_id: "33333333-3333-4333-8333-333333333333", ativa: true },
    ];
    const marcas = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    expect(regrasParaOAgente(linhas, { areas: ["arte"], marcaId: "22222222-2222-4222-8222-222222222222", marcasDoCliente: marcas }).map((r) => r.id)).toEqual(["c", "b"]);
    expect(regrasParaOAgente(linhas, { areas: ["arte"], marcaId: "11111111-1111-4111-8111-111111111111", marcasDoCliente: marcas }).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("o esquema de cada agente ganha regra e seguiu (obrigatórios) sem mexer no original", () => {
    const base = { type: "object", properties: { resposta: { type: "string" } }, required: ["resposta"] };
    const novo = esquemaComAprendizado(base);
    expect(novo.required).toEqual(["resposta", "regra", "seguiu"]);
    expect(Object.keys(novo.properties)).toEqual(["resposta", "regra", "seguiu"]);
    expect(base.required).toEqual(["resposta"]);
    const q = perguntasDoAprendizado({ mensagem: "x", regra: { texto: "Nunca usar rosa", categoria: null }, agente: "contexto", areas: ["arte"] });
    expect(Object.keys(q.questions)).toEqual(["duracao", "categoria"]);
    expect(Object.keys(q.questions.duracao.criteria)).toEqual(["preferencia_duradoura", "so_desta_vez", "incerto"]);
  });
});

// ---------------------------------------------------------------- "Aprendi" e "Esquecer" na conversa

const supa = vi.hoisted(() => ({ ativas: ["m1"] as string[], updates: [] as Array<{ patch: Record<string, unknown>; filtros: Record<string, unknown> }> }));
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filtros[c] = v), q),
      limit: () => q,
      update: (p: Record<string, unknown>) => ((patch = p), q),
      then: (ok: (r: unknown) => unknown) => {
        if (patch) {
          supa.updates.push({ patch, filtros: { ...filtros } });
          if (patch.ativa === false) supa.ativas = supa.ativas.filter((x) => x !== filtros.id);
          return Promise.resolve(ok({ data: null, error: null }));
        }
        return Promise.resolve(ok({ data: supa.ativas.map((id) => ({ id })), error: null }));
      },
    };
    return q;
  };
  return { supabase: { from, functions: { invoke: vi.fn() } } };
});

import AprendizadoNaConversa, { observacaoDoCusto } from "@/components/agentes/AprendizadoNaConversa";

describe("a conversa devolve: Aprendi (com Esquecer) e Segui", () => {
  it("Esquecer desliga a regra no cérebro e a linha passa a Esquecido", async () => {
    supa.ativas = ["m1"];
    supa.updates.length = 0;
    const anexos = [
      { tipo: "aprendizado_do_agente", id: "m1", texto: "Nunca usar fundo preto nas artes", categoria: "evitar", area: "arte", situacao: "criado", reforcos: 1 },
      { tipo: "regras_seguidas", regras: [{ id: "p1", texto: "Sempre falar com o dono da empresa", categoria: "preferencia" }] },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(AprendizadoNaConversa, { anexos, clientId: "c1" })));
    expect(screen.getByText(/Aprendi: Nunca usar fundo preto nas artes/)).toBeTruthy();
    expect(screen.getByText(/não faço mais/)).toBeTruthy();
    expect(screen.getByText("Segui: Sempre falar com o dono da empresa")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Esquecer esta regra" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Esquecer esta regra" }));
    await waitFor(() => expect(supa.updates).toHaveLength(1));
    expect(supa.updates[0]).toEqual({ patch: { ativa: false }, filtros: { id: "m1", client_id: "c1" } });
    await waitFor(() => expect(screen.getByText("Esquecido")).toBeTruthy());
  });

  it("sem aprendizado nem regra seguida, nada aparece; o custo aparece na observação do cartão", () => {
    const qc = new QueryClient();
    const { container } = render(h(QueryClientProvider, { client: qc }, h(AprendizadoNaConversa, { anexos: [{ tipo: "caminho_do_agente" }], clientId: "c1" })));
    expect(container.innerHTML).toBe("");
    expect(aprendizadoDosAnexos([{ tipo: "aprendizado_do_agente", id: 1 }])).toBeNull();
    // O "incerto" das outras frentes (sem id) não ganha Esquecer; o "Segui" delas (com tipo) aparece igual.
    expect(aprendizadoDosAnexos([{ tipo: "aprendizado_do_agente", id: null, texto: "talvez", decisao: "incerto" }])).toBeNull();
    expect(regrasSeguidasDosAnexos([{ tipo: "regras_seguidas", regras: [{ id: "r1", tipo: "evitar", texto: "Nunca rosa" }] }])[0]).toMatchObject({ categoria: "evitar", texto: "Nunca rosa" });
    expect(observacaoDoCusto({ custo_estimado_usd: 0.035 }, "Sem custo.")).toBe("Usa IA: cerca de US$ 0.035. Nada muda até confirmar, e dá para desfazer.");
    expect(observacaoDoCusto({ custo_estimado_usd: 0.2, sem_desfazer: true }, "Sem custo.")).toBe("Usa IA: cerca de US$ 0.20. Nada muda até confirmar.");
    expect(observacaoDoCusto({}, "Sem custo.")).toBe("Sem custo.");
  });
});
