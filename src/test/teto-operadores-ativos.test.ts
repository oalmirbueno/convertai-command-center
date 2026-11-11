import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as teto from "../../supabase/functions/_shared/teto-de-operadores";
import {
  MAXIMO_DE_OPERADORES_ATIVOS,
  mensagemTetoNaReativacao,
  mensagemTetoNoCadastro,
  podeCadastrar,
  podeReativar,
  reativacaoOcupaVaga,
} from "../../supabase/functions/_shared/teto-de-operadores";

/**
 * 11/11/2026 (dono, opção A): o teto de 40 conta só operadores ATIVOS.
 * Antes, o cadastro contava ativos + aposentados e recusava mesmo com vaga.
 */

type Op = { id: string; slug: string; status: string };

/** Roda operatorRegister/operatorOrganize de verdade sobre uma tabela em memória. */
function servicosCom(operadores: Op[]) {
  const rpc = vi.fn(async (_nome: string, args?: Record<string, unknown>) => {
    const op = operadores.find((o) => o.slug === args?._slug);
    if (op && args?._status) op.status = String(args._status);
    return { data: { ok: true, slug: args?._slug, status: op?.status }, error: null };
  });
  const insert = vi.fn();
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let head = false;
    const linhas = () => operadores.filter((o) => filtros.every(([c, v]) => (o as Record<string, unknown>)[c] === v));
    const q: Record<string, unknown> = {
      select: (_c: string, opts?: { head?: boolean }) => { head = opts?.head === true; return q; },
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      insert: (linha: Record<string, unknown>) => {
        insert(tabela, linha);
        if (tabela === "internal_operators") operadores.push({ id: `id-${linha.slug}`, slug: String(linha.slug), status: String(linha.status) });
        const r = Promise.resolve({ data: { id: `id-${linha.slug}`, ...linha }, error: null });
        return Object.assign(r, { select: () => ({ single: () => r }) });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(head ? { count: linhas().length, error: null } : { data: linhas(), error: null }).then(ok, ko),
    };
    return q;
  };
  const deps: Record<string, unknown> = {
    "./aceleriq-read-services.ts": { db: () => ({ from, rpc }), isUuid: () => true, READ_LIMITS: { queryTimeoutMs: 8000, maxPageSize: 500 } },
    "./operator-freshness.ts": {},
    "./operator-progress-detail.ts": {},
    "./vinculo-guard.ts": {},
    "./trava-do-dono.ts": {},
    "./jev.ts": {},
    "./teto-de-operadores.ts": teto,
    "../mcp-server/modulos/rodada-e-prova.ts": {},
  };
  const fonte = readFileSync(resolve(__dirname, "../..", "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8");
  const js = transpileModule(fonte, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exp: Record<string, unknown> = {};
  new Function("exports", "require", "Deno", "setTimeout", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: () => "https://app.example.com" } }, () => 0);
  type Fn = (input: Record<string, unknown>, actor: string) => Promise<Record<string, unknown>>;
  return { rpc, insert, register: exp.operatorRegister as Fn, organize: exp.operatorOrganize as Fn };
}

const elenco = (ativos: number, aposentados = 0, pausados = 0): Op[] => [
  ...Array.from({ length: ativos }, (_, i) => ({ id: `a${i}`, slug: `ativo-${i}`, status: "active" })),
  ...Array.from({ length: aposentados }, (_, i) => ({ id: `r${i}`, slug: `aposentado-${i}`, status: "retired" })),
  ...Array.from({ length: pausados }, (_, i) => ({ id: `p${i}`, slug: `pausado-${i}`, status: "paused" })),
];

const novo = { slug: "sonar", display_name: "Sonar", role: "QA", scope: "Testes" };

describe("regra pura do teto de ativos", () => {
  it("o teto e 40 ativos", () => {
    expect(MAXIMO_DE_OPERADORES_ATIVOS).toBe(40);
    expect(podeCadastrar(39)).toBe(true);
    expect(podeCadastrar(40)).toBe(false);
    expect(podeReativar(39)).toBe(true);
    expect(podeReativar(40)).toBe(false);
  });

  it("so ocupa vaga quem vai para active vindo de paused ou retired", () => {
    expect(reativacaoOcupaVaga("paused", "active")).toBe(true);
    expect(reativacaoOcupaVaga("retired", "active")).toBe(true);
    expect(reativacaoOcupaVaga("active", "active")).toBe(false);
    expect(reativacaoOcupaVaga("active", "retired")).toBe(false);
    expect(reativacaoOcupaVaga("retired", "retired")).toBe(false);
    expect(reativacaoOcupaVaga("paused", null)).toBe(false);
  });

  it("a mensagem diz a verdade sobre como liberar vaga", () => {
    for (const m of [mensagemTetoNoCadastro(40), mensagemTetoNaReativacao("atlas", 40)]) {
      expect(m).not.toMatch(/Desative os que nao usa/);
      expect(m).toContain("40 operadores ativos");
      expect(m).toMatch(/pause ou aposente um operador que esteja ATIVO/);
      expect(m).toMatch(/Aposentar quem ja esta pausado ou aposentado nao libera vaga/);
      expect(m).toMatch(/Reativar um operador pausado ou aposentado tambem conta no teto de 40 ativos/);
    }
    expect(mensagemTetoNaReativacao("atlas", 40)).toContain('nao da para reativar "atlas"');
  });
});

describe("operatorRegister conta so ativos", () => {
  it("39 ativos + 30 aposentados: cadastra (aposentado nao ocupa vaga)", async () => {
    const s = servicosCom(elenco(39, 30));
    const r = await s.register(novo, "chave");
    expect(r.criado).toBe(true);
    expect(s.insert).toHaveBeenCalledWith("internal_operators", expect.objectContaining({ slug: "sonar", status: "active" }));
  });

  it("40 ativos: recusa novo cadastro com a mensagem nova", async () => {
    const s = servicosCom(elenco(40, 5));
    await expect(s.register(novo, "chave")).rejects.toThrow(mensagemTetoNoCadastro(40));
    expect(s.insert).not.toHaveBeenCalled();
  });
});

describe("operatorOrganize respeita o teto na reativacao", () => {
  it("40 ativos: recusa reativar aposentado, sem chamar o RPC", async () => {
    const s = servicosCom(elenco(40, 1));
    await expect(s.organize({ slug: "aposentado-0", status: "active" }, "chave"))
      .rejects.toThrow(mensagemTetoNaReativacao("aposentado-0", 40));
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("40 ativos: recusa reativar pausado", async () => {
    const s = servicosCom(elenco(40, 0, 1));
    await expect(s.organize({ slug: "pausado-0", status: "active" }, "chave")).rejects.toThrow(/nao da para reativar "pausado-0"/);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("abaixo de 40: reativacao permitida e segue para o operator_update", async () => {
    const s = servicosCom(elenco(39, 1));
    await s.organize({ slug: "aposentado-0", status: "active" }, "chave");
    expect(s.rpc).toHaveBeenCalledWith("operator_update", expect.objectContaining({ _slug: "aposentado-0", _status: "active" }));
  });

  it("quem ja e active nao e recusado por teto", async () => {
    const s = servicosCom(elenco(40));
    await s.organize({ slug: "ativo-3", status: "active", role: "Lider" }, "chave");
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });

  it("pausar ou aposentar com 40 ativos continua permitido", async () => {
    const s = servicosCom(elenco(40));
    await s.organize({ slug: "ativo-0", status: "retired" }, "chave");
    expect(s.rpc).toHaveBeenCalledWith("operator_update", expect.objectContaining({ _status: "retired" }));
  });
});
