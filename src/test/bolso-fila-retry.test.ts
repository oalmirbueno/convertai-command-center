// @vitest-environment node
// Executa o handler real com Supabase e fetch isolados. Nenhum acesso à rede ou ambiente de produção.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as provedores from "../../supabase/functions/bolso/provedores";
import * as regras from "../../supabase/functions/bolso/regras";

const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/bolso/index.ts"), "utf8");
const js = transpileModule(fonte, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const AMBIENTE: Record<string, string> = {
  SUPABASE_URL: "https://teste.example.invalid",
  SUPABASE_ANON_KEY: "anon-isolada",
  SUPABASE_SERVICE_ROLE_KEY: "servico-isolado",
  BOLSO_OPENAI_HABILITADO: "sim",
  BOLSO_OPENAI_API_KEY: "credencial-de-teste",
  BOLSO_OPENAI_MODELO_TEXTO: "gpt-4.1-mini",
  BOLSO_OPENAI_MODELO_IMAGEM: "gpt-image-2",
};
const JOB = "11111111-1111-4111-8111-111111111111";

function filaIsolada(buscar: typeof fetch, quantidade = 1) {
  const jobs = Array.from({ length: quantidade }, (_, i) => ({
    id: i === 0 ? JOB : `job-${i + 1}`,
    estado: "na_fila",
    tentativa: 0,
  }));
  const rpc = vi.fn(async (nome: string, args?: Record<string, unknown>) => {
    if (nome === "bolso_trabalho_pegar") {
      const job = jobs.find((j) => j.estado === "na_fila");
      if (!job) return { data: null, error: null };
      job.estado = "processando";
      job.tentativa++;
      return { data: {
        job: { ...job, user_id: "dono", campanha_id: "campanha", tipo: "texto", formato: "feed_1x1", provedor: "openai" },
        marca: { nome: "Doceria", cores: ["#113355"], tom: "acolhedor" },
        briefing: { tipo: "venda", produto: "Bolo de pote", cta: "Peça no direct", condicoes: "" },
        versao: null,
      }, error: null };
    }
    const job = jobs.find((j) => j.id === args?._job);
    if (!job) throw new Error("Job inesperado");
    if (nome === "bolso_trabalho_falhar") {
      job.estado = args?._definitiva || job.tentativa >= 3 ? "falhou" : "na_fila";
      return { data: { estado: job.estado }, error: null };
    }
    if (nome === "bolso_trabalho_concluir") {
      job.estado = "concluido";
      return { data: { estado: job.estado }, error: null };
    }
    throw new Error(`RPC inesperada: ${nome}`);
  });
  const usuario = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "dono" } }, error: null })) },
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  const deps: Record<string, unknown> = {
    "npm:@supabase/supabase-js@2": { createClient: (_url: string, chave: string) => chave === AMBIENTE.SUPABASE_ANON_KEY ? usuario : { rpc } },
    "./provedores.ts": { ...provedores, openai: (config: provedores.ConfiguracaoOpenai) => provedores.openai(config, buscar) },
    "./regras.ts": regras,
  };
  let handler!: (req: Request) => Promise<Response>;
  new Function("exports", "require", "Deno", js)({}, (nome: string) => {
    if (!(nome in deps)) throw new Error(`Dependência inesperada: ${nome}`);
    return deps[nome];
  }, {
    env: { get: (nome: string) => AMBIENTE[nome] },
    serve: (receber: typeof handler) => { handler = receber; },
  });
  const processar = () => handler(new Request("https://teste.example.invalid/bolso", {
    method: "POST", headers: { authorization: "Bearer sessao-isolada", "content-type": "application/json" },
    body: JSON.stringify({ acao: "processar_fila" }),
  }));
  return { processar, rpc, jobs };
}

describe("lote do Bolso preserva tentativas e não reserva crédito novamente", () => {
  it("429 genérico deixa um único job na fila com uma tentativa e encerra o lote", async () => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => new Response("payload privado", { status: 429 }));
    const { processar, rpc, jobs } = filaIsolada(buscar);
    const res = await processar();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processados: [{ job_id: JOB, estado: "na_fila" }] });
    expect(jobs).toEqual([{ id: JOB, estado: "na_fila", tentativa: 1 }]);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([nome]) => nome)).toEqual(["bolso_trabalho_pegar", "bolso_trabalho_falhar"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ _job: JOB, _tentativa: 1, _definitiva: false });
  });

  it("resposta incerta interrompe o lote sem falhar, concluir ou pegar outro job", async () => {
    const buscar = vi.fn<typeof fetch>().mockRejectedValue(new Error("sem resposta"));
    const { processar, rpc, jobs } = filaIsolada(buscar, 2);
    expect(await (await processar()).json()).toEqual({ processados: [{ job_id: JOB, estado: "processando" }] });
    expect(jobs.map(({ estado, tentativa }) => ({ estado, tentativa }))).toEqual([
      { estado: "processando", tentativa: 1 }, { estado: "na_fila", tentativa: 0 },
    ]);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([nome]) => nome)).toEqual(["bolso_trabalho_pegar"]);
  });

  it("cota esgotada encerra o job existente pela RPC definitiva e preserva o diagnóstico seguro", async () => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      error: { code: "credit_balance_exhausted", message: "dado privado" },
    }, { status: 429 }));
    const { processar, rpc, jobs } = filaIsolada(buscar);
    expect(await (await processar()).json()).toEqual({ processados: [{ job_id: JOB, estado: "falhou" }] });
    expect(jobs[0]).toEqual({ id: JOB, estado: "falhou", tentativa: 1 });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([nome]) => nome)).toEqual(["bolso_trabalho_pegar", "bolso_trabalho_falhar", "bolso_trabalho_pegar"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ _job: JOB, _tentativa: 1, _definitiva: true, _erro: expect.stringContaining("(credit_balance_exhausted)") });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("dado privado");
  });

  it("conclusões bem-sucedidas continuam o lote até o limite de cinco jobs", async () => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      mensagem: "Uma pausa mais doce.", texto: "Escolha seu bolo de pote e peça no direct.", cta: "Peça no direct",
      aplicacao: "Instagram", direcao_visual: "Um bolo de pote sobre a mesa.",
    }) } }] }));
    const { processar, jobs } = filaIsolada(buscar, 6);
    const body = await (await processar()).json();
    expect(body.processados).toHaveLength(5);
    expect(body.processados.every((r: { estado: string }) => r.estado === "concluido")).toBe(true);
    expect(jobs[5]).toMatchObject({ estado: "na_fila", tentativa: 0 });
    expect(buscar).toHaveBeenCalledTimes(5);
  });
});
