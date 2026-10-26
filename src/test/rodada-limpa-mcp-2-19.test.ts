import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import * as zod from "zod";
import * as progresso from "../../supabase/functions/_shared/operator-progress-detail";
import * as robustez from "../../supabase/functions/mcp-server/modulos/robustez";
import * as seguranca from "../../supabase/functions/_shared/mcp-security";
import * as guardaDoCliente from "../../supabase/functions/_shared/mcp-client-id-guard";
import * as rodadaEProva from "../../supabase/functions/mcp-server/modulos/rodada-e-prova";
import * as travaDoDono from "../../supabase/functions/_shared/trava-do-dono";
import * as freshness from "../../supabase/functions/_shared/operator-freshness";
import * as guardaDoVinculo from "../../supabase/functions/_shared/vinculo-guard";

/**
 * MCP 2.19 (26/10/2026). Diagnóstico: o Hermes lia o diário ~100 mil vezes/dia e repetia comentários;
 * o Paperclip recriava tarefas a cada troca de chave; o fim da rodada devolvia tudo para a fila; o sino
 * tocava em todo "iniciou"; ações nos anúncios e o boletim não chegavam ao painel; o dossiê ganhava ~7
 * versões/dia; qualquer chave assinava como qualquer agente; "feito" sem prova.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

// ─── Banco de mentira ───────────────────────────────────────────

type Consulta = { tabela: string; op: string; valor?: unknown; colunas?: string; filtros: Array<[string, string, unknown]> };
type Resposta = { data: unknown; error: unknown };

function bancoFalso(responder: (q: Consulta) => Resposta, rpc: (nome: string, args: Record<string, unknown>) => Resposta = () => ({ data: null, error: null })) {
  const consultas: Consulta[] = [];
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const from = (tabela: string) => {
    const q: Consulta = { tabela, op: "", filtros: [] };
    consultas.push(q);
    const b: Record<string, unknown> = {};
    const filtro = (nome: string) => (col: string, v?: unknown) => { q.filtros.push([nome, col, v]); return b; };
    Object.assign(b, {
      select: (c?: string) => { if (!q.op) q.op = "select"; q.colunas = c; return b; },
      insert: (v: unknown) => { q.op = "insert"; q.valor = v; return b; },
      update: (v: unknown) => { q.op = "update"; q.valor = v; return b; },
      upsert: (v: unknown) => { q.op = "upsert"; q.valor = v; return b; },
      eq: filtro("eq"), neq: filtro("neq"), in: filtro("in"), is: filtro("is"), gte: filtro("gte"), gt: filtro("gt"), lt: filtro("lt"),
      contains: filtro("contains"), not: (c: string, o: string, v: unknown) => { q.filtros.push(["not", c, [o, v]]); return b; },
      order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(responder(q)).then(ok, erro),
    });
    return b;
  };
  return {
    consultas, rpcs,
    banco: { from, rpc: async (nome: string, args: Record<string, unknown>) => { rpcs.push([nome, args]); return rpc(nome, args); } },
  };
}

/** Carrega um módulo TS do Deno com as dependências trocadas (as URLs do esm.sh não rodam no vitest). */
function carregar(caminho: string, deps: Record<string, unknown>) {
  const js = transpileModule(ler(caminho), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exp: Record<string, unknown> = {};
  new Function("exports", "require", "Deno", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "chave" : undefined) } });
  return exp as Record<string, any>;
}

const UUID_OK = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const LINK = "11111111-1111-4111-8111-111111111111";
const ENTRADA = "22222222-2222-4222-8222-222222222222";
const CLIENTE = "33333333-3333-4333-8333-333333333333";
const PROJETO = "44444444-4444-4444-8444-444444444444";

function autoriaCom(banco: unknown) {
  return carregar("supabase/functions/mcp-server/modulos/autoria.ts", {
    "../../_shared/aceleriq-read-services.ts": { db: () => banco, isUuid: UUID_OK },
  });
}

function diarioCom(banco: unknown) {
  const autoria = autoriaCom(banco);
  return carregar("supabase/functions/mcp-server/modulos/diario.ts", {
    "../../_shared/aceleriq-read-services.ts": { db: () => banco, isUuid: UUID_OK },
    "../../_shared/aceleriq-operators-services.ts": { exigirVinculoExistente: async () => {} },
    "../../_shared/operator-progress-detail.ts": progresso,
    "../../_shared/arquivos-da-execucao.ts": { organizarArquivosDaExecucao: async () => ({ organizados: 0, avisos: [] }) },
    "./robustez.ts": robustez,
    "./autoria.ts": autoria,
  });
}

// ─── 1. Diário: limite de leitura ───────────────────────────────

describe("diário com limite de leitura", () => {
  it("acima do limite responde erro claro, sem nova tentativa automática", async () => {
    const { banco } = bancoFalso(() => ({ data: [], error: null }), () => ({ data: { ok: false, usos: 31, maximo: 30, libera_em: new Date(Date.now() + 20_000).toISOString() }, error: null }));
    const diario = diarioCom(banco);
    const erro = await diario.operatorDiary({ link_id: LINK }, { keyId: "27901254-b463-4f6c-8c39-92bd1884a250", origin: "mcp" }).catch((e: unknown) => e);
    expect(String((erro as Error).message)).toContain("limite de leitura do diário; espere");
    expect((erro as { transitorio?: boolean }).transitorio).toBe(false);
  });

  it("chaves do limite: por vínculo (30/min) e por credencial (120/min)", async () => {
    const { banco, rpcs } = bancoFalso(() => ({ data: [], error: null }), () => ({ data: { ok: true }, error: null }));
    await diarioCom(banco).operatorDiary({ link_id: LINK }, { keyId: "chave-1", origin: "mcp" });
    expect(rpcs).toContainEqual(["mcp_taxa_consumir", { _chave: `diario:key:chave-1:${LINK}`, _maximo: 30, _janela_seg: 60 }]);
    expect(rpcs).toContainEqual(["mcp_taxa_consumir", { _chave: "diario:key:chave-1", _maximo: 120, _janela_seg: 60 }]);
  });

  it("sem o banco do limite, o contador local segura", () => {
    const { banco } = bancoFalso(() => ({ data: [], error: null }));
    const d = diarioCom(banco);
    const agora = 1_000_000_000_000;
    for (let i = 0; i < 30; i++) expect(d.consumirNaMemoria("x", 30, agora).ok).toBe(true);
    expect(d.consumirNaMemoria("x", 30, agora).ok).toBe(false);
    expect(d.consumirNaMemoria("x", 30, agora + 60_000).ok).toBe(true);
  });

  it("leitura: mais recentes primeiro, desde, cursor e respondida_por", async () => {
    const resposta = { id: "r1", created_at: "2026-10-26T12:05:00Z", author_kind: "operador", operator_id: "op1", metadata: { reply_to_entry_id: ENTRADA } };
    const { banco, consultas } = bancoFalso((q) => {
      if (q.tabela === "operator_participations" && q.filtros.some(([f, c]) => f === "in" && c === "metadata->>reply_to_entry_id")) return { data: [resposta], error: null };
      if (q.tabela === "operator_participations") return { data: [{ id: ENTRADA, entry_type: "instrucao", body: "Faça X", author_kind: "humano", author_id: "u1", created_at: "2026-10-26T12:00:00Z", metadata: {} }], error: null };
      if (q.tabela === "internal_operators") return { data: [{ id: "op1", display_name: "Helena" }], error: null };
      if (q.tabela === "profiles") return { data: [{ id: "u1", full_name: "Almir" }], error: null };
      return { data: [], error: null };
    }, () => ({ data: { ok: true }, error: null }));
    const r = await diarioCom(banco).operatorDiary({ link_id: LINK, desde: "2026-10-26T11:00:00Z", cursor: "2026-10-26T13:00:00Z" }, { keyId: "k", origin: null });
    expect(r.ordem).toBe("mais_recentes_primeiro");
    expect(r.entradas[0].respondida_por).toEqual([{ id: "r1", quando: resposta.created_at, autor: "Helena" }]);
    const principal = consultas.find((q) => q.tabela === "operator_participations" && q.filtros.some(([f]) => f === "gt"))!;
    expect(principal.filtros).toContainEqual(["gt", "created_at", "2026-10-26T11:00:00.000Z"]);
    expect(principal.filtros).toContainEqual(["lt", "created_at", "2026-10-26T13:00:00.000Z"]);
  });
});

// ─── 2. Diário: reply_to e nada novo ────────────────────────────

describe("diário: resposta ligada à instrução e texto sem fato novo", () => {
  it("reply_to_entry_id do mesmo vínculo fica em metadata da entrada nova", async () => {
    const { banco, consultas, rpcs } = bancoFalso((q) => {
      if (q.tabela === "operator_participations" && q.op === "select" && q.filtros.some(([, c, v]) => c === "id" && v === ENTRADA)) return { data: { id: ENTRADA }, error: null };
      if (q.tabela === "internal_operators") return { data: { id: "op1" }, error: null };
      return { data: [], error: null };
    }, (nome) => (nome === "operator_participar" ? { data: { ok: true, participation_id: "55555555-5555-4555-8555-555555555555" }, error: null } : { data: null, error: null }));
    const r = await diarioCom(banco).operatorDiary({ link_id: LINK, operator: "helena", entry_type: "comentario", body: "Feito: subi a arte nova.", reply_to_entry_id: ENTRADA });
    expect(rpcs[0][0]).toBe("operator_participar");
    const update = consultas.find((q) => q.tabela === "operator_participations" && q.op === "update")!;
    expect(update.valor).toEqual({ metadata: { reply_to_entry_id: ENTRADA } });
    expect(update.filtros).toContainEqual(["eq", "id", "55555555-5555-4555-8555-555555555555"]);
    expect(r.responde_a).toBe(ENTRADA);
  });

  it("reply_to_entry_id de outro vínculo é recusado", async () => {
    const { banco } = bancoFalso(() => ({ data: null, error: null }));
    await expect(diarioCom(banco).operatorDiary({ link_id: LINK, operator: "helena", body: "ok", reply_to_entry_id: ENTRADA }))
      .rejects.toThrow("reply_to_entry_id não é uma entrada deste vínculo");
  });

  it("mesmo autor, texto quase igual em 6 h: nada novo; não registrado", async () => {
    const { banco, rpcs } = bancoFalso((q) => {
      if (q.tabela === "internal_operators") return { data: { id: "op1" }, error: null };
      if (q.tabela === "operator_participations") return { data: [{ id: "antiga", title: "Status", body: "Conta preservada, sem alteração. Sigo monitorando a campanha de hoje.", attachments: [], metadata: {}, created_at: "2026-10-26T10:00:00Z" }], error: null };
      return { data: [], error: null };
    });
    const r = await diarioCom(banco).operatorDiary({ link_id: LINK, operator: "paperclip", title: "Status", body: "Conta preservada, sem alteração. Sigo monitorando a campanha hoje." });
    expect(r).toMatchObject({ registrado: false, motivo: "nada novo; não registrado", entrada_parecida: "antiga" });
    expect(rpcs.find(([n]) => n === "operator_participar")).toBeUndefined();
  });

  it("número novo, anexo novo ou outra instrução respondida é fato novo", () => {
    const d = diarioCom(bancoFalso(() => ({ data: [], error: null })).banco);
    const antiga = { titulo: "Gasto", texto: "Gasto do dia R$ 120 na campanha de Natal", anexos: [] };
    expect(d.semFatoNovo({ ...antiga, texto: "Gasto do dia R$ 180 na campanha de Natal" }, antiga)).toBe(false);
    expect(d.semFatoNovo({ ...antiga, anexos: [{ url: "aceleriq-file://x" }] }, antiga)).toBe(false);
    expect(d.semFatoNovo({ ...antiga, responde_a: ENTRADA }, antiga)).toBe(false);
    expect(d.semFatoNovo({ ...antiga }, antiga)).toBe(true);
  });
});

// ─── 3. Autoria ─────────────────────────────────────────────────

describe("autoria: operator só da própria credencial", () => {
  const { banco } = bancoFalso(() => ({ data: [], error: null }));
  const a = autoriaCom(banco);
  const HERMES = [{ operator_slug: "default", padrao: true }, { operator_slug: "helena", padrao: false }, { operator_slug: "augusto", padrao: false }];

  it("principal: chave pelo id, OAuth pelo client", () => {
    expect(a.principalDaChamada({ keyId: "27901254-b463-4f6c-8c39-92bd1884a250", origin: "mcp" })).toBe("key:27901254-b463-4f6c-8c39-92bd1884a250");
    expect(a.principalDaChamada({ keyId: "oauth:06848537", origin: "oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd:06848537" })).toBe("oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd");
  });

  it("operador ligado passa; outro vira o padrão com aviso; sem vínculo, recusa", () => {
    expect(a.decidirAutoria(HERMES, "Helena")).toEqual({ tipo: "ok", operador: "helena" });
    const trocado = a.decidirAutoria(HERMES, "paperclip");
    expect(trocado).toMatchObject({ tipo: "trocado", operador: "default", pedido: "paperclip" });
    expect(trocado.aviso).toContain("registrado como \"default\"");
    expect(a.decidirAutoria([], "default").tipo).toBe("recusado");
    expect(a.decidirAutoria(null, "qualquer").tipo).toBe("livre");
  });

  it("só a escrita assina: ler o diário com outro operator continua livre", async () => {
    const carregar = async () => HERMES;
    const ctx = { keyId: "27901254-b463-4f6c-8c39-92bd1884a250", origin: "mcp" };
    const diario = { name: "aceleriq_operator_diary", annotations: { readOnlyHint: false } };
    expect((await a.prepararAutoria(diario, { link_id: LINK, operator: "paperclip" }, ctx, carregar)).args).toEqual({ link_id: LINK, operator: "paperclip" });
    const escrita = await a.prepararAutoria(diario, { link_id: LINK, operator: "paperclip", body: "oi" }, ctx, carregar);
    expect((escrita.args as Record<string, unknown>).operator).toBe("default");
    expect(escrita.aviso).toBeTruthy();
    const relato = await a.prepararAutoria({ name: "aceleriq_operator_report" }, { operator: "gestor-trafego", event: "done", run_key: "x".repeat(10) }, ctx, carregar);
    expect((relato.args as Record<string, unknown>).operator).toBe("default");
  });

  it("o servidor aplica antes de executar e anexa o aviso", () => {
    const servidor = ler("supabase/functions/mcp-server/index.ts");
    expect(servidor).toContain("const autoria = await prepararAutoria(tool, args, ctx);");
    expect(servidor).toContain("executarFerramenta(tool, autoria.args,");
    expect(servidor).toContain("anexarAviso(desfecho.result, autoria.aviso)");
  });

  it("a semente liga a chave do Hermes aos operadores do Hermes e as do Paperclip aos do Paperclip", () => {
    const sql = ler("supabase/migrations/20261026120000_autoria_e_limite_do_mcp.sql");
    expect(sql).toContain("select 'key:27901254-b463-4f6c-8c39-92bd1884a250', o.slug, 'Hermes Agent MCP'");
    expect(sql).toContain("where coalesce(o.area, '') <> 'Paperclip'");
    expect(sql).toContain("('oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd', 'Paperclip (OAuth)')");
    expect(sql).toContain("where o.area = 'Paperclip'");
  });
});

// ─── 4. Tarefa sem duplicar ─────────────────────────────────────

function servicoDeEscrita(responder: (q: Consulta) => Resposta) {
  const falso = bancoFalso(responder);
  const mod = carregar("supabase/functions/_shared/mcp-write-services.ts", {
    "https://esm.sh/@supabase/supabase-js@2.45.4": { createClient: () => falso.banco },
    "https://esm.sh/zod@3.23.8": zod,
    "./mcp-security.ts": seguranca,
    "./mcp-client-id-guard.ts": guardaDoCliente,
  });
  return { ...falso, mod };
}
const CTX = { keyId: "532d49bb-9b15-427f-bada-ce4e10bb5092", origin: "mcp", correlationId: "c1", dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: "api_key" } };

describe("create_task não duplica entre credenciais", () => {
  it("mesma origem_externa no cliente devolve a existente", async () => {
    const { mod, consultas } = servicoDeEscrita((q) => {
      if (q.tabela === "projects" && q.filtros.some(([, c]) => c === "client_id")) return { data: [{ id: PROJETO }], error: null };
      if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
      if (q.tabela === "tasks" && q.filtros.some(([, c]) => c === "origem_externa")) return { data: [{ id: "t-velha", title: "Revisar campanha" }], error: null };
      return { data: [], error: null };
    });
    const input = mod.createTaskSchema.parse({ project_id: PROJETO, title: "Revisar campanha de novembro", idempotency_key: "nova-chave-123", origem_externa: "Paperclip:ACE-275" });
    expect(input.origem_externa).toBe("paperclip:ACE-275");
    const r = await mod.createTask(input, CTX);
    expect(r).toMatchObject({ ja_existia: true, record: { id: "t-velha" } });
    expect(consultas.find((q) => q.tabela === "tasks" && q.op === "insert")).toBeUndefined();
  });

  it("título normalizado igual a tarefa aberta no projeto devolve a existente", async () => {
    const { mod, consultas } = servicoDeEscrita((q) => {
      if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
      if (q.tabela === "tasks" && q.op === "select") return { data: [{ id: "t-aberta", title: "Relatório  Semanal — Verzelo", status: "todo" }], error: null };
      return { data: [], error: null };
    });
    const r = await mod.createTask(mod.createTaskSchema.parse({ project_id: PROJETO, title: "relatorio semanal verzelo", idempotency_key: "outra-chave-1" }), CTX);
    expect(r).toMatchObject({ ja_existia: true, record: { id: "t-aberta" } });
    const abertas = consultas.find((q) => q.tabela === "tasks" && q.filtros.some(([f, c, v]) => f === "neq" && c === "status" && v === "done"))!;
    expect(abertas.filtros).toContainEqual(["eq", "project_id", PROJETO]);
    expect(consultas.find((q) => q.tabela === "tasks" && q.op === "insert")).toBeUndefined();
  });

  it("título novo cria com a origem", async () => {
    const { mod, consultas } = servicoDeEscrita((q) => {
      if (q.tabela === "projects" && q.filtros.some(([, c]) => c === "client_id")) return { data: [{ id: PROJETO }], error: null };
      if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
      if (q.tabela === "tasks" && q.op === "insert") return { data: { id: "t-nova" }, error: null };
      return { data: [], error: null };
    });
    const r = await mod.createTask(mod.createTaskSchema.parse({ project_id: PROJETO, title: "Tarefa nova", idempotency_key: "chave-nova-1", origem_externa: "paperclip:ACE-9" }), CTX);
    expect(r).toMatchObject({ replayed: false, record: { id: "t-nova" } });
    expect((consultas.find((q) => q.tabela === "tasks" && q.op === "insert")!.valor as Record<string, unknown>).origem_externa).toBe("paperclip:ACE-9");
  });
});

// ─── 5. Fim da rodada sem fato e done só com prova ──────────────

function relato(responder: (q: Consulta) => Resposta, resposta: Record<string, unknown>) {
  const falso = bancoFalso(responder, (nome, args) => (nome === "operator_report_event" ? { data: { ok: true, ...resposta, _event: args._event }, error: null } : { data: 0, error: null }));
  const mod = carregar("supabase/functions/_shared/aceleriq-operators-services.ts", {
    "./aceleriq-read-services.ts": { db: () => falso.banco, isUuid: () => true, READ_LIMITS: { queryTimeoutMs: 8000, maxPageSize: 500 } },
    "./operator-freshness.ts": freshness,
    "./operator-progress-detail.ts": progresso,
    "./vinculo-guard.ts": guardaDoVinculo,
    "./trava-do-dono.ts": travaDoDono,
    "./jev.ts": { jevPerguntar: async () => { throw new Error("sem Jev"); } },
    "../mcp-server/modulos/rodada-e-prova.ts": rodadaEProva,
  });
  return { ...falso, report: mod.operatorReport as (i: Record<string, unknown>, a: string) => Promise<Record<string, unknown>> };
}
const RESPOSTA = { link_id: "link-1", run_id: "run-1", run_status: "progress", link_status: "in_progress", operator: "paperclip", kanban_task_id: "t1" };

describe("fim da rodada sem fato novo não reenfileira", () => {
  it("rodada sem prova, entrega, estado ou diário: fecha a run e NÃO volta para a fila", async () => {
    const { report, consultas } = relato((q) => {
      if (q.tabela === "operator_runs") return { data: [{ operator_id: "op1", started_at: "2026-10-26T10:00:00Z" }], error: null };
      if (q.tabela === "operator_task_links" && q.op === "select") return { data: { status: "in_progress", created_at: new Date().toISOString() }, error: null };
      return { data: [], error: null };
    }, RESPOSTA);
    const r = await report({ operator: "paperclip", event: "progress", run_key: "link:abc12345", action: "Conta preservada, sem alteração", fim_da_rodada: true }, "chave");
    expect(r).toMatchObject({ rodada_fechada: true, sem_fato_novo: true, so_leitura: true });
    expect(consultas.find((q) => q.tabela === "operator_task_links" && q.op === "update")).toBeUndefined();
  });

  it("sem entrega há 72 h: o vínculo vai para parado, sem aviso", async () => {
    const { report, consultas } = relato((q) => {
      if (q.tabela === "operator_runs") return { data: [{ operator_id: "op1", started_at: "2026-10-26T10:00:00Z" }], error: null };
      if (q.tabela === "operator_task_links" && q.op === "select") return { data: { status: "in_progress", created_at: "2026-10-01T00:00:00Z" }, error: null };
      if (q.tabela === "operator_task_links" && q.op === "update") return { data: [{ id: "link-1" }], error: null };
      return { data: [], error: null };
    }, RESPOSTA);
    const r = await report({ operator: "paperclip", event: "progress", run_key: "link:abc12345", action: "Olhei a conta", fim_da_rodada: true }, "chave");
    expect(r.link_status).toBe("parado");
    const upd = consultas.find((q) => q.tabela === "operator_task_links" && q.op === "update")!;
    expect(upd.valor).toMatchObject({ status: "parado" });
    expect(consultas.find((q) => q.tabela === "notifications")).toBeUndefined();
  });

  it("rodada com entrega registrada volta para a fila como antes", async () => {
    const { report, consultas } = relato((q) => {
      if (q.tabela === "operator_runs") return { data: [{ operator_id: "op1", started_at: "2026-10-26T10:00:00Z" }], error: null };
      if (q.tabela === "operator_deliveries") return { data: [{ id: "d1" }], error: null };
      if (q.tabela === "operator_task_links" && q.op === "update") return { data: [{ id: "link-1" }], error: null };
      return { data: [], error: null };
    }, RESPOSTA);
    const r = await report({ operator: "paperclip", event: "progress", run_key: "link:abc12345", action: "Arte 1 de 3 pronta", fim_da_rodada: true }, "chave");
    expect(r.link_status).toBe("queued");
    expect(consultas.find((q) => q.tabela === "operator_task_links" && q.op === "update")!.valor).toMatchObject({ status: "queued" });
  });

  it("relato de só leitura vira documental (não move card)", async () => {
    const { report, rpcs } = relato(() => ({ data: [], error: null }), RESPOSTA);
    await report({ operator: "default", event: "progress", run_key: "run-somente-1", action: "Recuperação: só leitura da conta" }, "chave");
    const args = rpcs.find(([n]) => n === "operator_report_event")![1];
    expect((args._detail as Record<string, unknown>).work_kind).toBe("documental");
  });
});

describe("done só com prova", () => {
  it("done sem prova vira review com aviso", async () => {
    const { report, rpcs } = relato(() => ({ data: [], error: null }), { ...RESPOSTA, link_status: "review" });
    const r = await report({ operator: "paperclip", event: "done", run_key: "run-sem-prova", evidence: "Feito conforme combinado" }, "chave");
    expect(rpcs.find(([n]) => n === "operator_report_event")![1]._event).toBe("review");
    expect(r.sem_prova).toBe(true);
  });

  it("done com permalink do post vira entrega registrada", async () => {
    const { report, rpcs, consultas } = relato((q) => {
      if (q.tabela === "internal_operators") return { data: { id: "op1" }, error: null };
      if (q.tabela === "operator_deliveries" && q.op === "insert") return { data: { id: "d-nova" }, error: null };
      return { data: [], error: null };
    }, { ...RESPOSTA, link_status: "done" });
    const r = await report({ operator: "paperclip", event: "done", run_key: "run-com-prova", action: "Post publicado", evidence: "https://www.instagram.com/p/ABC123/" }, "chave");
    expect(rpcs.find(([n]) => n === "operator_report_event")![1]._event).toBe("done");
    expect(r).toMatchObject({ prova: "post_publicado", entrega_registrada: true, delivery_id: "d-nova" });
    expect(consultas.find((q) => q.tabela === "operator_deliveries" && q.op === "insert")!.valor).toMatchObject({ onde_acessar: "https://www.instagram.com/p/ABC123/", run_key: "run-com-prova" });
  });

  it("o que vale e o que não vale como prova", () => {
    const p = rodadaEProva.classificarProva;
    expect(p("ads_acao:55555555-5555-4555-8555-555555555555")?.tipo).toBe("acao_de_anuncio");
    expect(p("envio:55555555-5555-4555-8555-555555555555")?.tipo).toBe("mensagem_enviada");
    expect(p(null, [{ url: "aceleriq-file://55555555-5555-4555-8555-555555555555" }])?.tipo).toBe("arquivo_entregue");
    expect(p("https://www.tiktok.com/@loja/video/123")?.tipo).toBe("post_publicado");
    expect(p("https://business.facebook.com/adsmanager/manage")).toBeNull();
    expect(p("https://aceleriq.online/execucao?vinculo=1")).toBeNull();
    expect(p("Conferido no painel")).toBeNull();
  });
});

// ─── 6. Anúncios ────────────────────────────────────────────────

function anuncios(responder: (q: Consulta) => Resposta, rpc?: (n: string, a: Record<string, unknown>) => Resposta) {
  const falso = bancoFalso(responder, rpc);
  const mod = carregar("supabase/functions/mcp-server/modulos/anuncios-registro.ts", {
    "https://esm.sh/zod@3.23.8": zod,
    "../../_shared/aceleriq-read-services.ts": { db: () => falso.banco },
    "../../_shared/mcp-security.ts": seguranca,
    "./autoria.ts": autoriaCom(falso.banco),
  });
  return { ...falso, mod };
}

describe("anúncios: ação registrada e boletim", () => {
  it("aceleriq_ads_registrar_acao grava em ads_rotina_acoes e devolve a prova", async () => {
    const { mod, consultas } = anuncios((q) => {
      if (q.tabela === "profiles") return { data: { id: CLIENTE }, error: null };
      if (q.tabela === "ads_rotina_acoes" && q.op === "insert") return { data: { id: "66666666-6666-4666-8666-666666666666" }, error: null };
      return { data: [], error: null };
    });
    const tool = mod.FERRAMENTAS_DE_ANUNCIOS.find((t: { name: string }) => t.name === "aceleriq_ads_registrar_acao");
    const r = await tool.handler({ client_id: CLIENTE, conta_id: "act_1", alvo_tipo: "conjunto", alvo_id: "120", alvo_nome: "Curitiba | Direct", acao: "verba", antes: 30, depois: 50, motivo: "CPA abaixo da meta há 3 dias", operator: "gestor-trafego" },
      { keyId: "31aa8b16-36a4-4525-b095-04c70611caeb", origin: "mcp", dataScope: { unrestricted: true, clientIds: [] } });
    expect(r.prova).toBe("ads_acao:66666666-6666-4666-8666-666666666666");
    const linha = consultas.find((q) => q.tabela === "ads_rotina_acoes" && q.op === "insert")!.valor as Record<string, any>;
    expect(linha).toMatchObject({ client_id: CLIENTE, origem: "agente", tipo: "orcamento", estado: "feita", alvo: { nivel: "conjunto", meta_id: "120", nome: "Curitiba | Direct", conta_id: "act_1" } });
    expect(linha.resumo).toBe("Mudou a verba de o conjunto Curitiba | Direct de 30 para 50.");
    expect(linha.prova).toMatchObject({ antes: 30, depois: 50, operator: "gestor-trafego", principal: "key:31aa8b16-36a4-4525-b095-04c70611caeb" });
  });

  it("aceleriq_ads_boletim grava pelo RPC e devolve boletim_id e notification_id; resultado aceita número", async () => {
    const { mod, rpcs } = anuncios(() => ({ data: [], error: null }), () => ({ data: { ok: true, boletim_id: "b1", novo: true, avisados: 3, notification_id: "n1" }, error: null }));
    const tool = mod.FERRAMENTAS_DE_ANUNCIOS.find((t: { name: string }) => t.name === "aceleriq_ads_boletim");
    const r = await tool.handler({ periodo: "09h", resumo: "Tudo rodando; 1 alerta.", alertas: [{ nivel: "atencao", texto: "CPA subiu" }], por_cliente: [{ client_id: CLIENTE, gasto: 120.5, resultado: 7 }, { client_id: CLIENTE }] }, { keyId: "k", origin: null });
    expect(rpcs[0][0]).toBe("ads_boletim_registrar");
    expect(rpcs[0][1]).toMatchObject({ _periodo: "09h", _resumo: "Tudo rodando; 1 alerta." });
    expect(r).toMatchObject({ boletim_id: "b1", notification_id: "n1", onde_ver: "/anuncios/hoje?boletim=b1" });
  });

  it("o banco toca o sino UMA vez por boletim (só no novo) e a página é /anuncios/hoje", () => {
    const sql = ler("supabase/migrations/20261026120300_ads_registro_e_boletim.sql");
    expect(sql).toContain("unique (dia, periodo)");
    expect(sql).toMatch(/if _novo then\s+_avisados := public\.avisar_equipe\(/);
    expect(sql).toContain("'/anuncios/hoje?boletim=' || _id::text");
    expect(sql).toContain("'notification_id', _aviso_id");
    expect(sql).toContain("using (public.is_staff(auth.uid()))");
  });

  it("as duas ferramentas estão no catálogo e no guia", () => {
    expect(ler("supabase/functions/_shared/mcp-tools.ts")).toContain("...FERRAMENTAS_DE_ANUNCIOS,");
    const guia = ler("supabase/functions/mcp-server/modulos/guia-do-painel.ts");
    expect(guia).toContain("'aceleriq_ads_registrar_acao', 'aceleriq_ads_boletim'],");
  });
});

// ─── 7. Avisos e dossiê (SQL) ───────────────────────────────────

describe("avisos sem ruído e dossiê com 1 versão automática por dia", () => {
  const avisos = ler("supabase/migrations/20261026120100_rodada_e_avisos_sem_ruido.sql");
  const dossie = ler("supabase/migrations/20261026120400_dossie_uma_versao_por_dia.sql");

  it("started, progress e heartbeat não notificam", () => {
    expect(avisos).toContain(`  _notifica := not _repetido and (
    (_event = 'done' and _status_novo = 'done' and not _documental)
    or _event in ('failed', 'blocked', 'awaiting_input')
    or (_event = 'review' and _approval_required)
  );`);
    expect(avisos).not.toContain("_notifica := _event <> 'heartbeat'");
  });

  it("lembretes com teto de 1 por semana e pedido repetido agrupado no dia", () => {
    expect(avisos).toContain("b.lembrete_avisado_em < now() - interval '7 days'");
    expect(avisos).toContain("atividade.reminded_on <= _hoje - 7");
    expect(avisos).toContain("set agrupados = coalesce(n.agrupados, 1) + 1");
    expect(avisos).toContain("'blocked', 'parado'");
  });

  it("a seção automática cria no máximo 1 versão por dia e sai da fonte da revisão", () => {
    expect(dossie).toContain("and app_private.dossie_versao_automatica(d.change_reason, d.tags)");
    expect(dossie).toContain("d.created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')");
    expect(dossie).toContain("CROSS JOIN LATERAL app_private.dossie_base_humana(c0.id) cd");
    expect(dossie).toContain("'content',app_private.dossie_sem_avancos(cd.content)");
  });
});
