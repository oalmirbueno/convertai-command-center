import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

// O jsdom não tem AbortSignal.timeout (o Deno e o Node têm): o Jev usa para o tempo limite.
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import {
  anexoDasRegrasSeguidas,
  aprenderDoPedido,
  blocoDasRegras,
  esquecerRegra,
  julgamentoPorPalavras,
  julgarEnsino,
  lerJulgamento,
  pareceEnsino,
  regrasDaMesa,
  rotasDoAprendizado,
  textoDaRegra,
  type JulgamentoDoEnsino,
} from "../../supabase/functions/_shared/aprendizado-das-mesas";

/**
 * Frente AG2 (29/09): "Todos eles têm que aprender com cada ajuste... Tem
 * coisas que não pode mais fazer quando eu peço e não gostei... Cada ação tem
 * que devolver." O helper comum das seis mesas de mídia.
 */

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const MARCA_A = "11111111-1111-4111-8111-111111111111";
const MARCA_B = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;

/** agente_memoria em memória, com o encadeamento do supabase-js que o cérebro usa. */
function bancoFalso(inicial: Linha[] = []) {
  const linhas: Linha[] = inicial.map((l) => ({ ativa: true, reforcos: 1, criado_em: "2026-09-01T00:00:00Z", ...l }));
  let n = 0;
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    let limite = Infinity;
    const q: Record<string, unknown> = {};
    const base = () => (tabela === "agente_memoria" ? linhas : []);
    const alvo = () => base().filter((l) => filtros.every((f) => f(l))).slice(0, limite);
    const fim = () => {
      if (op === "update") {
        const a = alvo();
        a.forEach((l) => Object.assign(l, patch));
        return { data: a.map((l) => ({ id: l.id })), error: null };
      }
      if (op === "insert" && novo) return { data: novo, error: null };
      return { data: alvo(), error: null };
    };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      order: () => q,
      limit: (k: number) => ((limite = k), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ativa: true, criado_em: new Date().toISOString(), ...p };
        linhas.push(novo);
        return q;
      },
      single: () => Promise.resolve(fim()),
      maybeSingle: () => Promise.resolve({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  return { db: { from: consulta }, linhas };
}

const duradoura = (tipo: "evitar" | "preferencia" = "evitar"): (() => Promise<JulgamentoDoEnsino>) => async () => ({ decisao: "preferencia_duradoura", tipo, probabilidade: 0.9, fonte: "jev" });

describe("registrar: o que o pedido ensina", () => {
  it("pedido comum não gasta Jev; \"não gostei\", \"nunca\" e \"sempre\" passam pela porta", async () => {
    expect(pareceEnsino("gere 3 fotos do produto")).toBe(false);
    expect(pareceEnsino("não gostei desse fundo escuro")).toBe(true);
    expect(pareceEnsino("nunca use modelo sorrindo de boca aberta")).toBe(true);
    expect(pareceEnsino("sempre coloque a logo embaixo")).toBe(true);
    const julgar = vi.fn();
    const { db } = bancoFalso();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "gere 3 fotos do produto" }, { julgarEnsino: julgar })).toBeNull();
    expect(julgar).not.toHaveBeenCalled();
  });

  it("preferência duradoura vira regra \"evitar\" no cérebro, na área da mesa, com a marca e a origem", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "não gostei do fundo escuro, nunca mais faça assim", regraSugerida: "Não usar fundo escuro nas fotos de produto", marcaId: MARCA_A, userId: "u1" }, { julgarEnsino: duradoura("evitar"), julgarDuplicidade: null });
    expect(a).toEqual(expect.objectContaining({ texto: "Não usar fundo escuro nas fotos de produto", categoria: "evitar", situacao: "criado", mesa: "foto" }));
    expect(a!.id).toBeTruthy();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, agente: "diretor_arte", area: "foto", categoria: "evitar", tipo: "evitar", fonte: "mesa_foto", criado_por: "u1" }));
    expect(String(linhas[0].evidencia)).toContain(`marca:${MARCA_A}`);
  });

  it("pedido de uma vez só não vira regra", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "roteiro", pedido: "menos formal só neste roteiro", regraSugerida: "Tom menos formal" }, { julgarEnsino: async () => ({ decisao: "so_desta_vez", tipo: "preferencia", probabilidade: 0.8, fonte: "jev" }) });
    expect(a).toBeNull();
    expect(linhas).toHaveLength(0);
  });

  it("incerto não grava: volta sem id para a tela oferecer \"Guardar\"", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "não gostei dessa cor" }, { julgarEnsino: async () => ({ decisao: "incerto", tipo: "evitar", probabilidade: null, fonte: "jev" }) });
    expect(a).toEqual(expect.objectContaining({ id: null, decisao: "incerto", categoria: "evitar" }));
    expect(a!.texto).toMatch(/^Evitar: não gostei dessa cor/);
    expect(linhas).toHaveLength(0);
  });

  it("regra repetida é reforçada, não duplicada", async () => {
    const { db, linhas } = bancoFalso();
    const pedir = () => aprenderDoPedido(db, { clientId: CLIENTE, mesa: "video", pedido: "nunca use transição de zoom", regraSugerida: "Não usar transição de zoom" }, { julgarEnsino: duradoura("evitar"), julgarDuplicidade: null });
    const primeira = await pedir();
    const segunda = await pedir();
    expect(linhas).toHaveLength(1);
    expect(segunda).toEqual(expect.objectContaining({ id: primeira!.id, situacao: "reforcado", reforcos: 2 }));
    expect(linhas[0].reforcos).toBe(2);
  });

  it("reprovação com motivo (forcar) passa pelo Jev mesmo sem as palavras de ensino", async () => {
    const julgar = vi.fn(duradoura("evitar"));
    const { db } = bancoFalso();
    await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "publicidade", pedido: "", motivo: "a modelo está com a pele artificial", forcar: true }, { julgarEnsino: julgar, julgarDuplicidade: null });
    expect(julgar).toHaveBeenCalledTimes(1);
  });

  it("o Jev é perguntado com Choice (duradoura/uma vez/incerto e evitar/preferência) numa chamada só", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: 0.86 } }, tipo: { choice: "evitar", probabilities: { evitar: 0.9 } } } }), { status: 200 }));
    const j = await julgarEnsino({ pedido: "nunca mais fundo preto", regra: "Não usar fundo preto", mesa: "foto" }, { chave: "k", fetchImpl: f as unknown as typeof fetch });
    expect(j).toEqual({ decisao: "preferencia_duradoura", tipo: "evitar", probabilidade: 0.86, fonte: "jev" });
    expect(f).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(Object.keys(corpo.questions.duracao.criteria)).toEqual(["preferencia_duradoura", "so_desta_vez", "incerto"]);
    expect(corpo.questions.tipo.type).toBe("choice");
  });

  it("duradoura com pouca certeza vira incerta; sem Jev vale a regra das palavras", async () => {
    expect(lerJulgamento({ duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: 0.45 } }, tipo: { choice: "preferencia" } })!.decisao).toBe("incerto");
    expect(julgamentoPorPalavras("nunca use fundo escuro")).toEqual(expect.objectContaining({ decisao: "preferencia_duradoura", tipo: "evitar" }));
    expect(julgamentoPorPalavras("não gostei").decisao).toBe("incerto");
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = vi.fn().mockRejectedValue(new Error("rede"));
    const j = await julgarEnsino({ pedido: "sempre coloque legenda amarela", regra: "x", mesa: "edicao" }, { chave: "k", fetchImpl: f as unknown as typeof fetch });
    expect(j).toEqual(expect.objectContaining({ decisao: "preferencia_duradoura", tipo: "preferencia", fonte: "regra" }));
    erro.mockRestore();
  });

  it("texto da regra: o que o modelo sugeriu; sem sugestão, o pedido curto", () => {
    expect(textoDaRegra("Não usar fundo escuro", "x", "evitar")).toBe("Não usar fundo escuro");
    expect(textoDaRegra(null, "fundo escuro", "evitar")).toBe("Evitar: fundo escuro");
    expect(textoDaRegra("", "legenda amarela", "preferencia")).toBe("legenda amarela");
  });
});

describe("obedecer: as regras da mesa entram no modelo", () => {
  const memoria = [
    { id: "a0000000-0000-4000-8000-000000000001", client_id: CLIENTE, agente: "diretor_arte", area: "foto", tipo: "preferencia", categoria: "preferencia", texto: "Luz natural de janela", fonte: "mesa_foto", reforcos: 3 },
    { id: "a0000000-0000-4000-8000-000000000002", client_id: CLIENTE, agente: "diretor_arte", area: "foto", tipo: "evitar", categoria: "evitar", texto: "Não usar fundo escuro", fonte: "mesa_foto" },
    { id: "a0000000-0000-4000-8000-000000000003", client_id: CLIENTE, agente: "diretor_arte", area: "arte", tipo: "evitar", categoria: "evitar", texto: "Não usar transição de zoom", fonte: "mesa_videos" },
    { id: "a0000000-0000-4000-8000-000000000004", client_id: CLIENTE, agente: "diretor_arte", area: "foto", tipo: "evitar", categoria: "evitar", texto: "Sem rosa da marca B", fonte: "mesa_foto", evidencia: `marca:${MARCA_B}` },
    { id: "a0000000-0000-4000-8000-000000000005", client_id: CLIENTE, agente: "diretor_arte", area: "foto", tipo: "evitar", categoria: "evitar", texto: "Regra esquecida", fonte: "mesa_foto", ativa: false },
    { id: "a0000000-0000-4000-8000-000000000006", client_id: "outro", agente: "diretor_arte", area: "foto", tipo: "evitar", categoria: "evitar", texto: "De outro cliente", fonte: "mesa_foto" },
  ];

  it("EVITAR primeiro; regra de outra mesa AG2, de outra marca, esquecida ou de outro cliente não entra", async () => {
    const { db } = bancoFalso(memoria);
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto", marcaId: MARCA_A });
    expect(r.regras.map((x) => x.texto)).toEqual(["Não usar fundo escuro", "Luz natural de janela"]);
    expect(r.regras[0].ref).toBe("g1");
    expect(r.bloco).toMatch(/EVITAR vale acima/);
    expect(r.bloco).toMatch(/- g1: Não usar fundo escuro/);
    expect(r.bloco).toMatch(/- g2: Luz natural de janela \(pedido 3 vezes\)/);
    expect(r.bloco).not.toMatch(/zoom|rosa|esquecida|outro cliente/);
  });

  it("sem regras, o bloco é vazio (nada vai para o modelo)", () => {
    expect(blocoDasRegras([])).toBe("");
  });

  it("\"Segui: …\" traduz o apelido citado pelo modelo; apelido inventado sai", async () => {
    const { db } = bancoFalso(memoria);
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto", marcaId: MARCA_A });
    expect(anexoDasRegrasSeguidas(["g1", "g9"], r.regras)).toEqual({ tipo: "regras_seguidas", regras: [{ id: "a0000000-0000-4000-8000-000000000002", tipo: "evitar", texto: "Não usar fundo escuro" }] });
    expect(anexoDasRegrasSeguidas([], r.regras)).toBeNull();
  });

  it("a regra aprendida agora é obedecida na próxima conversa", async () => {
    const { db } = bancoFalso();
    await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "nunca use degradê", regraSugerida: "Não usar degradê" }, { julgarEnsino: duradoura("evitar"), julgarDuplicidade: null });
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "estilo" });
    expect(r.bloco).toMatch(/g1: Não usar degradê/);
  });
});

describe("devolver e esquecer", () => {
  it("Esquecer tira a regra (ativa=false) só do cliente certo, e ela não volta ao modelo", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "nunca fundo escuro", regraSugerida: "Não usar fundo escuro" }, { julgarEnsino: duradoura("evitar"), julgarDuplicidade: null });
    expect((await esquecerRegra(db, { clientId: "33333333-3333-4333-8333-333333333333", id: a!.id! })).ok).toBe(false);
    expect(linhas[0].ativa).toBe(true);
    expect((await esquecerRegra(db, { clientId: CLIENTE, id: a!.id! })).ok).toBe(true);
    expect(linhas[0].ativa).toBe(false);
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto" })).bloco).toBe("");
  });

  it("rotas: aprendizado_esquecer confere o acesso antes de mexer", async () => {
    const { db, linhas } = bancoFalso([{ id: "a0000000-0000-4000-8000-000000000009", client_id: CLIENTE, agente: "diretor_arte", area: "foto", tipo: "evitar", texto: "x", fonte: "mesa_foto" }]);
    const garantirAcesso = vi.fn().mockRejectedValue(new Error("sem acesso"));
    const rotas = rotasDoAprendizado({ mesa: "foto", servico: () => db, garantirAcesso, json: (c, s) => new Response(JSON.stringify(c), { status: s || 200 }) });
    await expect(rotas.aprendizado_esquecer({ userId: "u" }, { client_id: CLIENTE, id: "a0000000-0000-4000-8000-000000000009" })).rejects.toThrow(/sem acesso/);
    expect(linhas[0].ativa).toBe(true);
    garantirAcesso.mockResolvedValue(undefined);
    const r = await rotas.aprendizado_esquecer({ userId: "u" }, { client_id: CLIENTE, id: "a0000000-0000-4000-8000-000000000009" });
    expect(r.status).toBe(200);
    expect(linhas[0].ativa).toBe(false);
  });

  it("tela: \"Aprendi\" com Esquecer, \"Segui\", e o incerto com Guardar", async () => {
    const onEsquecer = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(h(AprendizadoDoAgente, {
      anexos: [
        { tipo: "aprendizado_do_agente", id: "r1", texto: "Não usar fundo escuro", categoria: "evitar", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1 },
        { tipo: "regras_seguidas", regras: [{ id: "g", tipo: "preferencia", texto: "Luz natural de janela" }] },
      ],
      onEsquecer,
    }));
    expect(screen.getByText("Aprendi:")).toBeTruthy();
    expect(screen.getByText(/Luz natural de janela/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Esquecer/ }));
    await waitFor(() => expect(document.querySelector("[data-aprendi]")!.getAttribute("data-aprendi")).toBe("esquecido"));
    expect(onEsquecer).toHaveBeenCalledWith("r1");
    unmount();
    const onGuardar = vi.fn().mockResolvedValue({ aprendido: { tipo: "aprendizado_do_agente", id: "r2", texto: "Evitar: cor laranja", categoria: "evitar", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1 } });
    render(h(AprendizadoDoAgente, { anexos: [{ tipo: "aprendizado_do_agente", id: null, texto: "Evitar: cor laranja", categoria: "evitar", decisao: "incerto", situacao: null, reforcos: null }], onGuardar }));
    expect(screen.getByText("Guardar como regra?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(screen.getByText("Aprendi:")).toBeTruthy());
    expect(onGuardar).toHaveBeenCalledWith("Evitar: cor laranja", "evitar");
  });

  it("sem aprendizado nem regra seguida, não mostra nada", () => {
    const { container } = render(h(AprendizadoDoAgente, { anexos: [{ tipo: "acao_agente" }] }));
    expect(container.innerHTML).toBe("");
  });
});
