import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as travaDoDono from "../../supabase/functions/_shared/trava-do-dono";
import * as freshness from "../../supabase/functions/_shared/operator-freshness";
import * as progresso from "../../supabase/functions/_shared/operator-progress-detail";
import * as guardaDoVinculo from "../../supabase/functions/_shared/vinculo-guard";
import { resultadoVerificado, ROTULO_DO_RESULTADO } from "@/lib/centralAutonomia";

/**
 * 19/10/2026 (dono: "tem coisas ficando rodando, rodando"). O time do Paperclip trabalha em
 * rodadas curtas e relatava `progress` no fim de cada uma, com a mesma run_key por tarefa
 * (link:<vínculo>). Sem relato final, a rodada ficava "em andamento" até o timeout de 15 min,
 * contava como falha (7 de 9 em 24 h) e, na terceira em 24 h, o banco travava a tarefa
 * ("parou 3 vezes sem sinal"): trava falsa. Com fim_da_rodada, a rodada fecha na hora e a
 * tarefa volta para a fila, esperando a próxima rodada.
 */

type Chamada = { tabela: string; patch?: Record<string, unknown>; linha?: Record<string, unknown>; filtros: Array<[string, string, unknown]> };

/** Roda o operatorReport de verdade, com banco de mentira que anota cada escrita. */
function relatoCom(resposta: Record<string, unknown>, opcoes: { vinculoMudou?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const rpc = vi.fn(async (nome: string, args?: Record<string, unknown>) => (
    nome === "operator_report_event" ? { data: { ok: true, ...resposta, _event: args?._event }, error: null } : { data: 0, error: null }
  ));
  const from = (tabela: string) => {
    const c: Chamada = { tabela, filtros: [] };
    const devolve = () => ({ data: tabela === "operator_task_links" && opcoes.vinculoMudou !== false ? [{ id: "link-1" }] : [], error: null });
    const construtor: Record<string, unknown> = {
      update: (patch: Record<string, unknown>) => { c.patch = patch; chamadas.push(c); return construtor; },
      insert: (linha: Record<string, unknown>) => { c.linha = linha; chamadas.push(c); return construtor; },
      select: () => construtor,
      eq: (col: string, v: unknown) => { c.filtros.push(["eq", col, v]); return construtor; },
      in: (col: string, v: unknown) => { c.filtros.push(["in", col, v]); return construtor; },
      maybeSingle: () => construtor,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(devolve()).then(ok, erro),
    };
    return construtor;
  };
  const deps: Record<string, unknown> = {
    "./aceleriq-read-services.ts": { db: () => ({ from, rpc }), isUuid: () => true, READ_LIMITS: { queryTimeoutMs: 8000, maxPageSize: 500 } },
    "./operator-freshness.ts": freshness,
    "./operator-progress-detail.ts": progresso,
    "./arquivos-da-execucao.ts": { organizarArquivosDaExecucao: async () => ({ organizados: 0, avisos: [] }) },
    "./vinculo-guard.ts": guardaDoVinculo,
    "./trava-do-dono.ts": travaDoDono,
    "./jev.ts": { jevPerguntar: async () => { throw new Error("sem Jev neste teste"); } },
  };
  const fonte = readFileSync(resolve(__dirname, "../..", "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8");
  const js = transpileModule(fonte, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exp: Record<string, unknown> = {};
  new Function("exports", "require", "Deno", "setTimeout", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: () => "https://app.example.com" } }, () => 0);
  return { rpc, chamadas, report: exp.operatorReport as (input: Record<string, unknown>, actor: string) => Promise<Record<string, unknown>> };
}

const RESPOSTA = { link_id: "link-1", run_id: "run-1", run_status: "progress", link_status: "in_progress", operator: "paperclip" };
const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

describe("fim da rodada: o relato fecha a rodada, a tarefa volta para a fila", () => {
  it("progress com fim_da_rodada: a rodada termina concluída e a tarefa em andamento volta para a fila", async () => {
    const { rpc, chamadas, report } = relatoCom(RESPOSTA);
    const r = await report({ operator: "paperclip", event: "progress", run_key: "link:3c11f390-a2be", action: "Softy: desconto definido", fim_da_rodada: true }, "chave");
    const args = rpc.mock.calls.find((c) => c[0] === "operator_report_event")![1]!;
    expect(args._event).toBe("progress");
    expect((args._detail as Record<string, unknown>).fim_da_rodada).toBe(true);

    const rodada = chamadas.find((c) => c.tabela === "operator_runs" && c.patch)!;
    expect(rodada.patch).toMatchObject({ status: "done" });
    expect(typeof rodada.patch!.finished_at).toBe("string");
    expect(rodada.filtros).toContainEqual(["eq", "id", "run-1"]);
    expect(rodada.filtros).toContainEqual(["in", "status", ["started", "progress"]]);

    const vinculo = chamadas.find((c) => c.tabela === "operator_task_links" && c.patch)!;
    expect(vinculo.patch).toMatchObject({ status: "queued" });
    expect(vinculo.filtros).toContainEqual(["eq", "id", "link-1"]);
    // Só o que estava em andamento: trava do dono, revisão e feito não mudam.
    expect(vinculo.filtros).toContainEqual(["eq", "status", "in_progress"]);

    const trilha = chamadas.find((c) => c.tabela === "operator_audit_log" && c.linha)!;
    expect(trilha.linha).toMatchObject({ task_link_id: "link-1", old_status: "in_progress", new_status: "queued", run_key: "link:3c11f390-a2be" });

    expect(r).toMatchObject({ rodada_fechada: true, run_status: "done", link_status: "queued" });
  });

  it("vínculo que não estava em andamento (trava do dono, documental): só a rodada fecha", async () => {
    const { chamadas, report } = relatoCom({ ...RESPOSTA, link_status: "blocked" }, { vinculoMudou: false });
    const r = await report({ operator: "paperclip", event: "progress", run_key: "link:3c11f390-a2be", fim_da_rodada: true }, "chave");
    expect(chamadas.some((c) => c.tabela === "operator_runs" && c.patch?.status === "done")).toBe(true);
    expect(chamadas.some((c) => c.tabela === "operator_audit_log")).toBe(false);
    expect(r).toMatchObject({ rodada_fechada: true, link_status: "blocked" });
  });

  it("sem fim_da_rodada nada muda: a rodada segue viva e o relato marca que não terminou", async () => {
    const { rpc, chamadas, report } = relatoCom({ ...RESPOSTA, operator: "augusto" });
    const r = await report({ operator: "augusto", event: "progress", run_key: "augusto-verzelo-0001" }, "chave");
    expect(chamadas.filter((c) => c.patch || c.linha)).toEqual([]);
    expect((rpc.mock.calls.find((c) => c[0] === "operator_report_event")![1]!._detail as Record<string, unknown>).fim_da_rodada).toBe(false);
    expect(r.rodada_fechada).toBeUndefined();
  });

  /* O time do Paperclip relata uma vez por rodada, com uma run por tarefa (link:<vínculo>): o
     progress dele é sempre fim de rodada. Fecha sozinho, sem depender do agente lembrar do campo;
     fim_da_rodada false mantém aberta. O Hermes também usa link:, mas trabalha com sinal: fica fora. */
  it("Paperclip com run por tarefa (link:): o progress fecha a rodada sozinho", async () => {
    const sozinho = relatoCom(RESPOSTA);
    const r = await sozinho.report({ operator: "paperclip", event: "progress", run_key: "link:e83938b4-43a3" }, "chave");
    expect(r).toMatchObject({ rodada_fechada: true, link_status: "queued" });

    const aberta = relatoCom(RESPOSTA);
    await aberta.report({ operator: "paperclip", event: "progress", run_key: "link:e83938b4-43a3", fim_da_rodada: false }, "chave");
    expect(aberta.chamadas.filter((c) => c.patch || c.linha)).toEqual([]);

    const hermes = relatoCom({ ...RESPOSTA, operator: "default" });
    await hermes.report({ operator: "default", event: "progress", run_key: "link:e83938b4-43a3" }, "chave");
    expect(hermes.chamadas.filter((c) => c.patch || c.linha)).toEqual([]);
  });

  it("evento que já é final (review, done, blocked) não passa pelo fechamento", async () => {
    const { chamadas, report } = relatoCom({ ...RESPOSTA, run_status: "review", link_status: "review" });
    await report({ operator: "paperclip", event: "review", run_key: "link:3c11f390-a2be", evidence: "https://exemplo.com/prova.png", fim_da_rodada: true }, "chave");
    expect(chamadas.filter((c) => c.patch || c.linha)).toEqual([]);
  });

  it("a ferramenta aceita e explica fim_da_rodada (esquema e validação)", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    const inicio = tools.indexOf("name: 'aceleriq_operator_report'");
    const trecho = tools.slice(inicio, inicio + 9000);
    expect(trecho).toContain("fim_da_rodada: { type: 'boolean'");
    expect(trecho).toContain("fim_da_rodada: z.boolean().optional()");
    expect(trecho).toMatch(/FIM DA RODADA/);
  });

  it("no painel, rodada concluída com a tarefa na fila não vira 'entrega em revisão'", () => {
    expect(resultadoVerificado({ status: "done" }, { status: "queued", last_evidence: null }, "doing")).toBe("rodada_concluida");
    expect(ROTULO_DO_RESULTADO.rodada_concluida).toBe("Rodada concluída · segue na fila");
    // Feito de verdade continua igual.
    expect(resultadoVerificado({ status: "done" }, { status: "done", last_evidence: "https://x/prova.png" }, "done")).toBe("concluida_com_prova");
    expect(ler("src/components/execucao/ExecucoesRecentes.tsx")).toContain("fim_da_rodada");
  });
});
