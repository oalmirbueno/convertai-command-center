import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AG2 (29/09/2026): o agente roteirista da Mesa Roteiros.
 * Nunca usado de verdade (0 conversas mesa_roteiros no banco em 29/09): a
 * leitura foi de "primeiro uso".
 * - a conversa grava sem perder a mensagem (gravarTroca) e avisa quando não gravou;
 * - a mensagem digitada nunca some nem duplica quando o envio falha;
 * - "esse roteiro", "o segundo", "todos da semana" pela lista da tela (Jev Choice);
 * - ações novas: PDF (um só, Confirmar, sem Desfazer), resolver comentário,
 *   desarquivar; arquivar vai direto com Desfazer;
 * - aprendizado: a regra que a equipe ensina entra no roteirista e na conversa.
 * Função, banco e Jev falsos: nada sai para o Supabase real nem para API paga.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "gte", "lt"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: () => consulta() } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

// O jsdom não tem AbortSignal.timeout (o Deno e o Node têm): o Jev usa para o tempo limite.
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import AgenteRoteirista, { observacaoDosRoteiros, roteiroDoResultado } from "@/components/mesa-roteiros/AgenteRoteirista";
import {
  alvosDosComentarios,
  blocoDasAcoesDosRoteiros,
  caminhoDosRoteiros,
  type ComentarioParaAcao,
  idsDoPdf,
  itensDaReferencia,
  normalizarAcoesDosRoteiros,
  type PecaParaAcao,
  regrasDosRoteiros,
  respostaPromete,
  type RoteiroParaAcao,
} from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { lerIdDoComentario, regrasDeEdicao } from "../../supabase/functions/mesa-roteiros/acoes-de-edicao";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { blocoDaReferencia, referenciaDoPedido } from "../../supabase/functions/_shared/conversa-das-mesas";
import { aprenderDoPedido, regrasDaMesa, rotasDoAprendizado, type JulgamentoDoEnsino } from "../../supabase/functions/_shared/aprendizado-das-mesas";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const HOJE = "2026-09-29";

const roteiro = (n: number, extra: Partial<RoteiroParaAcao> = {}): RoteiroParaAcao => ({
  id: U(n), titulo: `Roteiro ${n}`, tipo: "fala_camera", status: "rascunho", versao_atual: 1, arquivado: false, data_da_peca: null, ...extra,
});
const peca = (n: number, data: string, extra: Partial<PecaParaAcao> = {}): PecaParaAcao => ({ id: U(500 + n), titulo: `Peça ${n}`, formato: "reels", data, roteiro_status: null, ...extra });

// ------------------------------------------------------------------ 1. ações novas

describe("ações novas do roteirista", () => {
  const roteiros = [roteiro(1, { status: "aprovado" }), roteiro(2, { status: "gravado" }), roteiro(3), roteiro(4, { arquivado: true })];

  it("PDF: vários pedidos viram UM item (um PDF só, na ordem pedida), só aprovado ou gravado, Confirmar e sem Desfazer", () => {
    const a = normalizarAcoesDosRoteiros({ resumo: "PDF", itens: [
      { operacao: "gerar_pdf", ref: "r2", para: "" },
      { operacao: "gerar_pdf", ref: "r1", para: "" },
      { operacao: "gerar_pdf", ref: "r3", para: "" },
    ] }, roteiros, [], CLIENTE, 0.02)!;
    expect(a.itens).toHaveLength(1);
    expect(idsDoPdf(a.itens[0].alvo_id)).toEqual([U(2), U(1)]);
    expect(a.itens[0].titulo).toContain("2 roteiros");
    expect(a.recusados.map((r) => r.motivo)).toEqual(["Só roteiro aprovado vai para o PDF. Aprove antes."]);
    expect(a.custo_estimado_usd).toBe(0);
    expect(a.sem_desfazer).toBe(true);
    expect(podeExecutarDireto(a, regrasDosRoteiros(), { pedidoClaro: true }).direto).toBe(false);
    expect(caminhoDosRoteiros(CLIENTE, a)!.destino).toContain("etapa=pdf");
    expect(idsDoPdf(`${U(1)},nao-e-uuid,${U(1)}`)).toEqual([U(1)]);
  });

  it("arquivar vai direto (sem custo, com Desfazer); desarquivar só o arquivado; IA pede Confirmar", () => {
    const arq = normalizarAcoesDosRoteiros({ resumo: "", itens: [{ operacao: "arquivar_roteiro", ref: "r3", para: "" }] }, roteiros, [], CLIENTE, 0.02)!;
    expect(podeExecutarDireto(arq, regrasDosRoteiros(), { pedidoClaro: true }).direto).toBe(true);
    const des = normalizarAcoesDosRoteiros({ resumo: "", itens: [{ operacao: "desarquivar_roteiro", ref: "r4", para: "" }, { operacao: "desarquivar_roteiro", ref: "r1", para: "" }] }, roteiros, [], CLIENTE, 0.02)!;
    expect(des.itens.map((i) => i.alvo_id)).toEqual([U(4)]);
    expect(des.recusados[0].motivo).toBe("Este roteiro não está arquivado.");
    const ia = normalizarAcoesDosRoteiros({ resumo: "", itens: [{ operacao: "refazer_gancho", ref: "r3", para: "mais direto" }] }, roteiros, [], CLIENTE, 0.02)!;
    expect(ia.custo_estimado_usd).toBe(0.02);
    expect(podeExecutarDireto(ia, regrasDosRoteiros(), { pedidoClaro: true }).motivo).toBe("tem custo");
    expect(Object.values(regrasDeEdicao()).every((r) => r.direta === true)).toBe(true);
  });

  it("comentário do roteiro aberto vira c1..: resolver vai direto, o alvo leva roteiro e comentário, o resolvido é recusado", () => {
    const comentarios: ComentarioParaAcao[] = [
      { roteiro_id: U(3), id: U(900), texto: "Tira o jargão do bloco 2", autor: "Ana", resolvido: false, bloco_id: "b2" },
      { roteiro_id: U(3), id: U(901), texto: "Já foi", autor: null, resolvido: true },
    ];
    expect(alvosDosComentarios(comentarios).map((a) => a.ref)).toEqual(["c1", "c2"]);
    const bloco = blocoDasAcoesDosRoteiros(roteiros, [], undefined, 0, comentarios);
    expect(bloco).toContain("COMENTÁRIOS DA EQUIPE NO ROTEIRO ABERTO");
    expect(bloco).toContain("c1 | Tira o jargão do bloco 2");
    expect(bloco).not.toContain(U(900));
    const a = normalizarAcoesDosRoteiros({ resumo: "", itens: [
      { operacao: "resolver_comentario", ref: "c1", para: "" },
      { operacao: "resolver_comentario", ref: "c2", para: "" },
      { operacao: "resolver_comentario", ref: "r1", para: "" },
    ] }, roteiros, [], CLIENTE, 0.02, undefined, comentarios)!;
    expect(a.itens).toHaveLength(1);
    expect(lerIdDoComentario(a.itens[0].alvo_id)).toEqual({ roteiroId: U(3), comentarioId: U(900) });
    expect(a.recusados[0].motivo).toBe("Este comentário já está resolvido.");
    expect(a.ignorados).toEqual(["r1"]);
    expect(podeExecutarDireto(a, regrasDosRoteiros(), { pedidoClaro: true }).direto).toBe(false); // recusado junto: pede Confirmar
    const so = normalizarAcoesDosRoteiros({ resumo: "", itens: [{ operacao: "resolver_comentario", ref: "c1", para: "" }] }, roteiros, [], CLIENTE, 0, undefined, comentarios)!;
    expect(podeExecutarDireto(so, regrasDosRoteiros(), { pedidoClaro: true }).direto).toBe(true);
    // "Ir para": a Revisão do roteiro do comentário (não o id composto).
    expect(caminhoDosRoteiros(CLIENTE, so)!.destino).toContain(`roteiro=${U(3)}`);
    expect(roteiroDoResultado({ operacao: "resolver_comentario", alvo_id: `${U(3)}:${U(900)}` })).toBe(U(3));
    expect(roteiroDoResultado({ operacao: "gerar_pdf", alvo_id: `${U(1)},${U(2)}` })).toBeNull();
  });

  it("cartão: custo quando usa IA; o PDF avisa que vai para Arquivos e não volta", () => {
    expect(observacaoDosRoteiros({ itens: [{ operacao: "gerar_pdf" }], custo_estimado_usd: 0, sem_desfazer: true })).toMatch(/Sem custo\. O PDF vai para Arquivos .* não volta pelo Desfazer\.$/);
    expect(observacaoDosRoteiros({ itens: [{ operacao: "mudar_tom" }], custo_estimado_usd: 0.03 })).toMatch(/Custo estimado: .* o gasto não volta/);
    expect(observacaoDosRoteiros({ itens: [{ operacao: "aprovar_roteiro" }], custo_estimado_usd: 0 })).toBe("Sem custo. Dá para desfazer.");
  });

  it("resposta que promete sem trazer a lista é reconhecida", () => {
    expect(respostaPromete("Vou gerar os roteiros da semana.")).toBe(true);
    expect(respostaPromete("Vamos já preparar a lista.")).toBe(true);
    expect(respostaPromete("A lista está pronta para confirmar.")).toBe(false);
  });
});

// ------------------------------------------------------------------ 2. "esse", "o segundo", "todos da semana"

describe("referência do pedido na ordem da tela", () => {
  const naTela = [roteiro(1, { data_da_peca: "2026-10-01" }), roteiro(2, { arquivado: true }), roteiro(3, { data_da_peca: "2026-10-20" }), roteiro(4, { data_da_peca: "2026-09-30" })];
  // O aberto (roteiro 3) vem primeiro nos apelidos: r1 = o aberto.
  const comApelido = [naTela[2], naTela[0], naTela[1], naTela[3]];
  const pecas = [peca(1, "2026-09-30"), peca(2, "2026-10-03"), peca(3, "2026-10-15")];

  it("roteiros: a ordem da Revisão (sem arquivados), com os apelidos que o modelo vê; o aberto é o selecionado", () => {
    const r = itensDaReferencia("aprove o segundo", naTela, comApelido, pecas, HOJE, U(3));
    expect(r.lista).toBe("roteiros");
    expect(r.itens.map((i) => i.ref)).toEqual(["r2", "r1", "r4"]);
    expect(r.selecionados).toEqual(["r1"]);
    expect(itensDaReferencia("desarquive esse arquivado", naTela, comApelido, pecas, HOJE, U(3)).itens.map((i) => i.ref)).toContain("r3");
  });

  it("\"todos da semana\": roteiros com peça nos próximos 7 dias; \"gere os da semana\": as peças da semana", () => {
    expect(itensDaReferencia("aprove todos da semana", naTela, comApelido, pecas, HOJE, null).itens.map((i) => i.ref)).toEqual(["r2", "r4"]);
    const p = itensDaReferencia("gere todos da semana", naTela, comApelido, pecas, HOJE, null);
    expect(p.lista).toBe("pecas");
    expect(p.itens.map((i) => i.titulo)).toEqual(["Peça 1", "Peça 2"]);
    expect(p.itens.map((i) => i.ref)).toEqual(["p1", "p2"]);
  });

  it("comentários quando o pedido fala deles", () => {
    const c: ComentarioParaAcao[] = [{ roteiro_id: U(3), id: U(900), texto: "Tira o jargão", autor: null, resolvido: false }];
    expect(itensDaReferencia("resolva esse comentário", naTela, comApelido, pecas, HOJE, U(3), c).itens).toEqual([{ ref: "c1", titulo: "Tira o jargão", detalhe: "aberto" }]);
  });

  it("o Jev escolhe entre os apelidos da tela (Choice) e o bloco vai para o sistema do modelo", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { alvo: { choice: "r1", probabilities: { r1: 0.93 } } } }), { status: 200 }));
    const ref = itensDaReferencia("aprove esse roteiro", naTela, comApelido, pecas, HOJE, U(3));
    const r = await referenciaDoPedido("aprove esse roteiro", ref.itens, { agente: "roteirista", selecionados: ref.selecionados, chave: "k", fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual(expect.objectContaining({ refs: ["r1"], alcance: "um", incerta: false }));
    const corpo = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(corpo.state.selecionados_na_tela).toEqual(["r1"]);
    expect(JSON.stringify(corpo)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(blocoDaReferencia(r, ref.itens)).toContain('r1 ("Roteiro 3")');
  });
});

// ------------------------------------------------------------------ 3. a função (ligação no código)

describe("a função mesa-roteiros", () => {
  const f = ler("supabase/functions/mesa-roteiros/index.ts");
  const conversa = f.slice(f.indexOf("async function agenteConversar("), f.indexOf("/** agente_historico"));

  it("a conversa grava pelo gravarTroca, devolve mensagem_id e o aviso quando não gravou (antes: insert em lote sem olhar o erro)", () => {
    expect(conversa).toContain("await gravarTroca(servico(), {");
    expect(conversa).toContain("mensagem_id: troca.agenteId");
    expect(conversa).toContain("aviso_registro: `${AVISO_SEM_REGISTRO}${feitaNaHora}`");
    expect(conversa).not.toMatch(/from\("agente_mensagens"\)\s*\.insert\(\[/);
    // O resultado da ação no fim também não engole o erro (e leva anexos: []).
    expect(f).toContain('registrarFalha("mesa-roteiros: resultado da ação não gravado na conversa"');
    expect(f).not.toContain(".then(() => undefined, () => undefined)");
  });

  it("estado real e referência: comentários, o aberto como r1, o bloco do Jev e as regras no sistema", () => {
    expect(conversa).toContain("itensDaReferencia(mensagem, l.roteiros, ordenados, l.pecas, hojeDoPedido, aberto ? aberto.id : null, comentarios)");
    expect(conversa).toContain("referenciaDoPedido(mensagem, ref.itens,");
    expect(conversa).toContain("blocoDaReferencia(referencia.r, referencia.itens)");
    expect(conversa).toContain('regrasDaMesa(servico(), { clientId, mesa: "roteiro" })');
    expect(conversa).toContain("${extras}`,");
    expect(conversa).toContain("lido && lido.client_id === clientId ? lido : null");
  });

  it("direto só o que é sem custo e com Desfazer (regras completas), e a promessa sem lista é dita", () => {
    expect(conversa).toContain("podeExecutarDireto(acao, regrasDosRoteiros(), { pedidoClaro: true })");
    expect(conversa).toContain("respostaPromete(resposta)");
  });

  it("executores: PDF pelo mesmo caminho do Compartilhar; comentário e desarquivar com Desfazer", () => {
    expect(f).toContain("const r = await pdfDosRoteiros(ch, clientId, ids);");
    expect(f).toContain('return json(await pdfDosRoteiros(ch, clientId, ids));');
    expect(f).toContain('tipo: "reabrir_comentario"');
    expect(f).toContain('tipo: "rearquivar"');
    expect(f).toContain('d.tipo === "arquivar_criado" || d.tipo === "rearquivar"');
    expect(f).toContain("return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, custo_usd: 0 });");
  });

  it("aprendizado: registrar na conversa e nos ajustes da tela, obedecer no roteirista, devolver e esquecer", () => {
    expect(conversa).toContain('aprenderDoPedido(servico(), { clientId, mesa: "roteiro", pedido: mensagem, regraSugerida: j.regra_aprendida');
    expect(conversa).toContain("anexoDasRegrasSeguidas(j.regras_seguidas, regras.regras)");
    expect(f).toContain("...CAMPOS_DO_APRENDIZADO,");
    expect(f).toContain('required: ["resposta", "sugestoes", "acoes", "regra_aprendida", "regras_seguidas"]');
    // Obedecer na geração (escrever e refazer gancho): o bloco vai no sistema do roteirista.
    expect(f.match(/sistema: `\$\{SISTEMA_ROTEIRISTA\}\\n\\n\$\{CONHECIMENTO_DO_ROTEIRO\}` \+ \(regras\.bloco \?/g)).toHaveLength(2);
    // Ajustes sem conversa: pedido do gancho e tom forçam o Jev; comentário só quando soa como regra.
    expect(f).toContain("const aprendendo = aprenderDoAjuste(linha.client_id, ch.userId, pedido);");
    expect(f).toContain("aprenderDoAjuste(linha.client_id, ch.userId, `Mudar o tom do roteiro para: ${tom}`)");
    expect(f).toContain("aprenderDoAjuste(linha.client_id, ch.userId, texto, false)");
    expect(f).toContain('...rotasDoAprendizado({ mesa: "roteiro", servico, garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId), json }),');
  });
});

// ------------------------------------------------------------------ 4. aprendizado ligado à mesa "roteiro"

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

const duradoura = async (): Promise<JulgamentoDoEnsino> => ({ decisao: "preferencia_duradoura", tipo: "evitar", probabilidade: 0.9, fonte: "jev" });

describe("aprendizado do roteirista", () => {
  it("a regra ensinada é criada na área do roteiro e obedecida: o bloco entra no sistema da próxima conversa", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "roteiro", pedido: "não gostei desse gancho de pergunta, nunca abra com pergunta", regraSugerida: "Não abrir o roteiro com pergunta" }, { julgarEnsino: duradoura, julgarDuplicidade: null });
    expect(a).toEqual(expect.objectContaining({ texto: "Não abrir o roteiro com pergunta", categoria: "evitar", mesa: "roteiro" }));
    expect(linhas[0]).toEqual(expect.objectContaining({ area: "copy", fonte: "mesa_roteiros", tipo: "evitar" }));
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "roteiro" });
    expect(r.bloco).toContain("EVITAR:\n- g1: Não abrir o roteiro com pergunta");
    // É esse bloco que vai no fim do sistema do agente e do roteirista (ver a ligação acima).
  });

  it("pedido de uma vez só (\"só neste roteiro\") não vira regra; pedido comum nem chama o Jev", async () => {
    const { db, linhas } = bancoFalso();
    const julgar = vi.fn(async (): Promise<JulgamentoDoEnsino> => ({ decisao: "so_desta_vez", tipo: "preferencia", probabilidade: 0.8, fonte: "jev" }));
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "roteiro", pedido: "deixa menos formal, só neste roteiro", forcar: true }, { julgarEnsino: julgar })).toBeNull();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "roteiro", pedido: "gere os roteiros da semana" }, { julgarEnsino: julgar })).toBeNull();
    expect(julgar).toHaveBeenCalledTimes(1);
    expect(linhas).toHaveLength(0);
  });

  it("regra repetida é reforçada (não duplica) e \"Esquecer\" pela rota da função tira a regra (ativa=false)", async () => {
    const { db, linhas } = bancoFalso();
    const pedir = () => aprenderDoPedido(db, { clientId: CLIENTE, mesa: "roteiro", pedido: "nunca use jargão técnico", regraSugerida: "Não usar jargão técnico" }, { julgarEnsino: duradoura, julgarDuplicidade: null });
    const primeira = await pedir();
    const segunda = await pedir();
    expect(linhas).toHaveLength(1);
    expect(segunda).toEqual(expect.objectContaining({ id: primeira!.id, situacao: "reforcado", reforcos: 2 }));
    const acesso = vi.fn().mockResolvedValue(undefined);
    const rotas = rotasDoAprendizado({ mesa: "roteiro", servico: () => db, garantirAcesso: acesso, json: (c, s = 200) => new Response(JSON.stringify(c), { status: s }) });
    const r = await rotas.aprendizado_esquecer({ userId: "u1" }, { client_id: CLIENTE, id: primeira!.id });
    expect(r.status).toBe(200);
    expect(acesso).toHaveBeenCalledWith({ userId: "u1" }, CLIENTE);
    expect(linhas[0].ativa).toBe(false);
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "roteiro" })).bloco).toBe("");
  });
});

// ------------------------------------------------------------------ 5. tela

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  } as ModeloIa,
];

let respostas: Record<string, any> = {};

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  respostas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 0, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-roteiros" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function Casca() {
  const [rascunho, setRascunho] = useState("");
  return h(AgenteRoteirista, { roteiroId: null, rascunho, onRascunho: setRascunho });
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mesa = {
    clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo, catalogoCarregando: false,
    atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as unknown as MesaValor;
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-roteiros?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: mesa, children: h(Casca) })))));
}

/** Bolhas com o texto (fora do campo de digitar). */
const bolhasCom = (texto: string) => screen.queryAllByText(texto).filter((el) => el.tagName !== "TEXTAREA");

describe("tela do agente roteirista", () => {
  it("envio que falha: a bolha otimista sai e o texto volta ao campo; reenviar não duplica", async () => {
    respostas.agente_historico = { conversa_id: null, mensagens: [] };
    respostas.agente_conversar = { error: "conversa_indisponivel", mensagem: "Não foi possível falar com o agente agora." };
    montar();
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    const campo = screen.getByRole("textbox", { name: "Mensagem ao agente" }) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "Aprove o segundo roteiro" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    await waitFor(() => expect(campo.value).toBe("Aprove o segundo roteiro"));
    expect(bolhasCom("Aprove o segundo roteiro")).toHaveLength(0);
    respostas.agente_conversar = { conversa_id: U(77), mensagem_id: U(78), resposta: "Pronto.", sugestoes: [], anexos: [], custo_usd: 0.001 };
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await screen.findByText("Pronto.");
    expect(bolhasCom("Aprove o segundo roteiro")).toHaveLength(1);
  });

  it("aviso de registro aparece; \"Aprendi\" com Esquecer chama a função com a mensagem", async () => {
    respostas.agente_historico = { conversa_id: null, mensagens: [] };
    respostas.agente_conversar = {
      conversa_id: U(77), mensagem_id: U(79), resposta: "Anotado: nada de pergunta na abertura.", sugestoes: [], custo_usd: 0.001,
      anexos: [{ tipo: "aprendizado_do_agente", id: U(600), texto: "Não abrir o roteiro com pergunta", categoria: "evitar", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1, mesa: "roteiro" }],
      aviso_registro: "A resposta chegou, mas não ficou guardada na conversa.",
    };
    montar();
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem ao agente" }), { target: { value: "Nunca abra com pergunta" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await screen.findByText("Anotado: nada de pergunta na abertura.");
    expect(document.querySelector("[data-aviso-registro]")!.textContent).toContain("não ficou guardada");
    expect(document.querySelector("[data-aprendi]")!.getAttribute("data-aprendi")).toBe("guardado");
    fireEvent.click(screen.getByRole("button", { name: /Esquecer/ }));
    await waitFor(() => expect(chamadasDe("aprendizado_esquecer")).toHaveLength(1));
    expect(chamadasDe("aprendizado_esquecer")[0]).toMatchObject({ client_id: CLIENTE, id: U(600), mensagem_id: U(79) });
  });
});
