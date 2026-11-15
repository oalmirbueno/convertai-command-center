import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Leitura da Esteira em linha do tempo: poucas consultas em lote (nunca uma
 * por cliente), só leitura, e erro do banco vira erro da tela em vez de
 * grade vazia. O banco aqui é simulado: nada bate na rede.
 */

interface Chamada {
  tabela: string;
  passos: Array<[string, ...unknown[]]>;
}

const banco = vi.hoisted(() => ({
  chamadas: [] as Array<{ tabela: string; passos: Array<[string, ...unknown[]]> }>,
  linhas: {} as Record<string, unknown[]>,
  erroEm: null as string | null,
  /** Erro só nas consultas que pedem esta coluna (banco sem a migration da fase 2). */
  colunaAusente: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => {
    const chamada = { tabela, passos: [] as Array<[string, ...unknown[]]> };
    banco.chamadas.push(chamada);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "is", "neq", "or", "gte", "lte", "order"]) {
      q[m] = (...args: unknown[]) => {
        chamada.passos.push([m, ...args]);
        return q;
      };
    }
    q.range = async (...args: unknown[]) => {
      chamada.passos.push(["range", ...args]);
      const semColuna = Boolean(banco.colunaAusente) && chamada.passos.some((p) => p[0] === "select" && String(p[1]).includes(banco.colunaAusente!));
      if (banco.erroEm === tabela || semColuna) return { data: null, error: { message: "falhou" } };
      // As linhas de `profiles` dependem do que a consulta pede (nome do revisor ou regra do cadastro).
      const chave = tabela === "profiles" && chamada.passos.some((p) => p[0] === "select" && String(p[1]).includes("modo_aprovacao_do_cliente")) ? "profiles:modo" : tabela;
      return { data: banco.linhas[chave] ?? [], error: null };
    };
    return q;
  };
  return { supabase: { from } };
});

import { lerLinhasDaEsteiraLinha, lerModosDeAprovacao, lerPecasDaEsteiraLinha } from "@/lib/esteiraLinha/esteiraLinhaFatos";
import { dataDaPeca, decidirEtapa } from "@/lib/esteiraLinha/esteiraLinha";

const CLIENTES = Array.from({ length: 30 }, (_, i) => `c${i + 1}`);

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.erroEm = null;
  banco.colunaAusente = null;
  banco.linhas = {
    editorial_publications: [{ id: "u1", post_id: "p1", client_id: "c1", file_id: "f1", status: "scheduled", scheduled_at: "2026-11-18T01:30:00Z", published_at: null, permalink: null }],
    tasks: [{ id: "t1", title: "Reel", status: "todo", due_date: "2026-11-20", delivery_type: "reel", source: null, projects: { client_id: "c2", deleted_at: null } }],
    editorial_post_internal: [],
    estudio_trabalhos: [{ id: "w1", task_id: "t1", post_id: null, client_id: "c2", status: "entregue", entrega_status: "aguardando_agencia", file_ids: ["f2"], atualizado_em: "2026-11-15T10:00:00Z" }],
    editorial_posts: [{ id: "p1", client_id: "c1", title: "Post", content_type: "static", production_status: "ready", primary_file_id: "f1", archived_at: null }],
    staff_files_secure: [{ id: "f1", approval_status: "approved", agency_approval_status: "approved" }, { id: "f2", approval_status: "none", agency_approval_status: "pending" }],
  };
});

describe("leitura em lote", () => {
  it("lê a carteira inteira em poucas consultas, sem uma por cliente, e monta as peças", async () => {
    const pecas = await lerPecasDaEsteiraLinha(CLIENTES, "2026-11-16");
    // 30 clientes: uma consulta por tabela e por passo, não 30.
    expect(banco.chamadas.length).toBeLessThanOrEqual(9);
    expect(new Set(banco.chamadas.map((c) => c.tabela))).toEqual(
      new Set(["editorial_publications", "tasks", "editorial_post_internal", "estudio_trabalhos", "editorial_posts", "staff_files_secure"]),
    );
    const daSemana = banco.chamadas[0] as Chamada;
    expect(daSemana.passos).toContainEqual(["in", "client_id", CLIENTES]);
    expect(daSemana.passos).toContainEqual(["neq", "status", "cancelled"]);
    // A janela tem um dia de folga de cada lado; o dia certo sai da regra pura.
    expect(String(daSemana.passos.find((p) => p[0] === "or")?.[1])).toContain("scheduled_at.gte.2026-11-15T00:00:00Z");

    expect(pecas.map((p) => p.chave).sort()).toEqual(["post:p1", "task:t1"]);
    const post = pecas.find((p) => p.chave === "post:p1")!;
    expect(decidirEtapa(post)?.etapa).toBe("agendado");
    expect(dataDaPeca(post)).toBe("2026-11-17");
    const tarefa = pecas.find((p) => p.chave === "task:t1")!;
    expect(tarefa.clientId).toBe("c2");
    expect(decidirEtapa(tarefa)?.etapa).toBe("revisao");
  });

  it("sem cliente não consulta nada; erro do banco vira erro, não grade vazia", async () => {
    expect((await lerLinhasDaEsteiraLinha([], "2026-11-16")).posts).toEqual([]);
    expect(banco.chamadas).toHaveLength(0);
    banco.erroEm = "estudio_trabalhos";
    await expect(lerPecasDaEsteiraLinha(CLIENTES, "2026-11-16")).rejects.toThrow("Não foi possível ler todos os dados da Esteira");
  });
});

describe("carimbo da revisão interna e regra do cadastro (fase 2)", () => {
  const comCarimbo = () => {
    banco.linhas.estudio_trabalhos = [{
      id: "w1", task_id: "t1", post_id: null, client_id: "c2", status: "entregue", entrega_status: "aguardando_agencia", file_ids: ["f2"], atualizado_em: "2026-11-15T10:00:00Z",
      revisado_por: "u9", revisado_em: "2026-11-15T00:04:00Z", revisao_decisao: "aprovado", revisao_arquivo_id: "f2",
    }];
    banco.linhas.staff_files_secure = [{ id: "f1", approval_status: "approved", agency_approval_status: "approved" }, { id: "f2", approval_status: "none", agency_approval_status: "approved", agency_reviewed_by: "u9", agency_reviewed_at: "2026-11-15T00:04:00Z" }];
    banco.linhas.profiles = [{ id: "u9", full_name: "Ana" }];
  };

  it("traz o carimbo do trabalho, o nome de quem revisou e o portão do arquivo, ainda em lote", async () => {
    comCarimbo();
    const pecas = await lerPecasDaEsteiraLinha(CLIENTES, "2026-11-16");
    // Duas consultas a mais para a carteira inteira (carimbos e nomes), nunca uma por cliente.
    expect(banco.chamadas.length).toBeLessThanOrEqual(11);
    const doCarimbo = banco.chamadas.find((c) => c.tabela === "estudio_trabalhos" && c.passos.some((p) => p[0] === "select" && String(p[1]).includes("revisao_decisao")))!;
    expect(doCarimbo.passos).toContainEqual(["in", "id", ["w1"]]);
    expect(String(banco.chamadas.find((c) => c.tabela === "staff_files_secure")!.passos[0][1])).toContain("agency_reviewed_at");
    const tarefa = pecas.find((p) => p.chave === "task:t1")!;
    expect(tarefa.trabalho?.revisao).toEqual({ decisao: "aprovado", em: "2026-11-15T00:04:00Z", por: "u9", porNome: "Ana" });
    expect(tarefa.arquivos[0].agency_reviewed_by).toBe("u9");
    expect(decidirEtapa(tarefa)).toEqual({ etapa: "revisao", rotulo: "Revisado pela agência" });
  });

  it("banco ainda sem a migration: a Esteira lê tudo como na fase 1, só sem o carimbo", async () => {
    // Sem a migration, as linhas do banco não têm as colunas do carimbo e pedir por elas dá erro.
    banco.colunaAusente = "revisao_decisao";
    const pecas = await lerPecasDaEsteiraLinha(CLIENTES, "2026-11-16");
    expect(pecas.map((p) => p.chave).sort()).toEqual(["post:p1", "task:t1"]);
    const tarefa = pecas.find((p) => p.chave === "task:t1")!;
    expect(tarefa.trabalho?.revisao).toBeNull();
    expect(decidirEtapa(tarefa)?.rotulo).toBe("Revisão da agência");
    // A consulta principal dos trabalhos nunca pede as colunas novas.
    const principais = banco.chamadas.filter((c) => c.tabela === "estudio_trabalhos" && c.passos.some((p) => p[0] === "select" && String(p[1]).includes("entrega_status")));
    expect(principais.length).toBeGreaterThan(0);
    for (const c of principais) expect(String(c.passos.find((p) => p[0] === "select")![1])).not.toContain("revis");
  });

  it("regra do cadastro: lê em lote e, sem a coluna, todo mundo segue o caminho normal", async () => {
    banco.linhas["profiles:modo"] = [{ id: "c1", modo_aprovacao_do_cliente: "dispensada" }, { id: "c2", modo_aprovacao_do_cliente: "portal" }];
    expect(await lerModosDeAprovacao(CLIENTES)).toEqual({ c1: "dispensada", c2: "portal" });
    expect(banco.chamadas).toHaveLength(1);
    expect(await lerModosDeAprovacao([])).toEqual({});
    banco.colunaAusente = "modo_aprovacao_do_cliente";
    expect(await lerModosDeAprovacao(CLIENTES)).toEqual({});
  });
});
