import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as travaDoDono from "../../supabase/functions/_shared/trava-do-dono";
import * as rodadaEProva from "../../supabase/functions/mcp-server/modulos/rodada-e-prova";
import { decidirTrava, MOTIVOS_DO_DONO, perguntaDaTrava } from "../../supabase/functions/_shared/trava-do-dono";
import * as freshness from "../../supabase/functions/_shared/operator-freshness";
import * as progresso from "../../supabase/functions/_shared/operator-progress-detail";
import * as guardaDoVinculo from "../../supabase/functions/_shared/vinculo-guard";

/** Roda o operatorReport de verdade, com banco e Jev de mentira. */
function relatoCom(jev: () => Promise<unknown>) {
  const rpc = vi.fn(async (_nome: string, args?: Record<string, unknown>) => ({ data: { status: args?._event }, error: null }));
  const promessa = Promise.resolve({ data: null, error: null });
  const from = () => Object.assign(promessa, { select: () => promessa, eq: () => promessa, maybeSingle: () => promessa });
  const deps: Record<string, unknown> = {
    "./aceleriq-read-services.ts": { db: () => ({ from, rpc }), isUuid: () => true, READ_LIMITS: { queryTimeoutMs: 8000, maxPageSize: 500 } },
    "./operator-freshness.ts": freshness,
    "./operator-progress-detail.ts": progresso,
    "./arquivos-da-execucao.ts": { organizarArquivosDaExecucao: async () => ({ organizados: 0, avisos: [] }) },
    "./vinculo-guard.ts": guardaDoVinculo,
    "./trava-do-dono.ts": travaDoDono,
    "../mcp-server/modulos/rodada-e-prova.ts": rodadaEProva,
    "./jev.ts": { jevPerguntar: jev },
  };
  const fonte = readFileSync(resolve(__dirname, "../..", "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8");
  const js = transpileModule(fonte, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exp: Record<string, unknown> = {};
  new Function("exports", "require", "Deno", "setTimeout", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: () => "https://app.example.com" } }, () => 0);
  return { rpc, report: exp.operatorReport as (input: Record<string, unknown>, actor: string) => Promise<Record<string, unknown>> };
}

/**
 * 19/10/2026 (dono: "tem muitos bloqueios e a dificuldade para desbloquear... proíbe demais os
 * agentes de trabalhar"). Dos 11 vínculos travados, só 1 dependia dele (sessão do Facebook com
 * verificação em duas etapas). Agora o agente só trava para o dono o que só o dono resolve; o resto
 * segue e o revisor desempata.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

describe("só trava para o dono o que só o dono resolve", () => {
  it("o agente diz o motivo: dinheiro, acesso, aprovar para o cliente ou estratégia", () => {
    expect([...MOTIVOS_DO_DONO]).toEqual(["dinheiro", "acesso_ou_senha", "aprovar_para_cliente", "decisao_de_estrategia"]);
    expect(decidirTrava({ precisaDoDono: "dinheiro" })).toEqual({ trava: true, motivo: "dinheiro", fonte: "agente" });
  });

  it("sem motivo declarado, o Jev decide; só destrava com certeza alta de que o time resolve", () => {
    const timeResolve = { choice: "o_time_resolve", probabilities: { o_time_resolve: 0.86, dinheiro: 0.04, acesso_ou_senha: 0.04, aprovar_para_cliente: 0.03, decisao_de_estrategia: 0.03 } };
    expect(decidirTrava({ jev: timeResolve })).toEqual({ trava: false, motivo: null, fonte: "jev" });
    const duvida = { choice: "o_time_resolve", probabilities: { o_time_resolve: 0.55, acesso_ou_senha: 0.4, dinheiro: 0.05 } };
    expect(decidirTrava({ jev: duvida })).toMatchObject({ trava: true, fonte: "jev" });
    const acesso = { choice: "acesso_ou_senha", probabilities: { acesso_ou_senha: 0.9, o_time_resolve: 0.1 } };
    expect(decidirTrava({ jev: acesso })).toEqual({ trava: true, motivo: "acesso_ou_senha", fonte: "jev" });
  });

  it("Jev fora do ar: continua travado (nenhuma pergunta legítima some)", () => {
    expect(decidirTrava({})).toEqual({ trava: true, motivo: null, fonte: "sem_julgamento" });
  });

  it("a pergunta ao Jev é Choice com as quatro razões do dono e a saída o_time_resolve", () => {
    const q = perguntaDaTrava();
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria).sort()).toEqual(["acesso_ou_senha", "aprovar_para_cliente", "decisao_de_estrategia", "dinheiro", "o_time_resolve"]);
  });

  it("no relato: conferência interna não trava; vira progresso com o revisor", async () => {
    const { rpc, report } = relatoCom(async () => ({ answers: { trava: { choice: "o_time_resolve", probabilities: { o_time_resolve: 0.9, acesso_ou_senha: 0.1 } } } }));
    const r = await report({ operator: "paperclip", event: "blocked", run_key: "teste-trava-0001", block_reason: "Divergência dos cliques sem validação independente." }, "teste");
    const args = rpc.mock.calls.find((c) => c[0] === "operator_report_event")![1]!;
    expect(args._event).toBe("progress");
    expect(args._block_reason).toBeNull();
    expect(String(args._next_step)).toContain("Revisor");
    expect(r.nao_travou).toBe(true);
  });

  it("no relato: dinheiro declarado trava com o rótulo; Jev fora do ar mantém a trava", async () => {
    const comMotivo = relatoCom(async () => { throw new Error("não deveria perguntar"); });
    await comMotivo.report({ operator: "paperclip", event: "awaiting_input", run_key: "teste-trava-0002", block_reason: "Recarga de R$ 120 na RD AR.", precisa_do_dono: "dinheiro" }, "teste");
    const a1 = comMotivo.rpc.mock.calls.find((c) => c[0] === "operator_report_event")![1]!;
    expect(a1._event).toBe("awaiting_input");
    expect(String(a1._block_reason)).toMatch(/^Precisa de você \(dinheiro\): Recarga/);

    const semJev = relatoCom(async () => { throw new Error("jev fora do ar"); });
    await semJev.report({ operator: "paperclip", event: "blocked", run_key: "teste-trava-0003", block_reason: "Não sei o que fazer." }, "teste");
    const a2 = semJev.rpc.mock.calls.find((c) => c[0] === "operator_report_event")![1]!;
    expect(a2._event).toBe("blocked");
  });

  it("o relato do agente usa a regra: trava vira progresso com o revisor quando o time resolve", () => {
    const servico = ler("supabase/functions/_shared/aceleriq-operators-services.ts");
    expect(servico).toContain("decidirTrava(");
    expect(servico).toContain("classificarTrava(");
    expect(servico).toContain("Revisor");
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    expect(tools).toContain("precisa_do_dono");
  });
});
