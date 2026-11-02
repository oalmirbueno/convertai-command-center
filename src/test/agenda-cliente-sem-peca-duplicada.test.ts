import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { indiceDoClienteAPartirDaResposta } from "@/lib/editorialTaskLinks";

/**
 * Agenda do cliente (01/11/2026): a mesma peça aparecia duas vezes, a tarefa no prazo e o card do conteúdo.
 * A agenda tira da grade a tarefa que já virou conteúdo usando o índice tarefa -> conteúdo, que vem de
 * editorial_post_internal, legível só pela equipe. Para o cliente o índice vinha vazio. Agora o cliente recebe
 * o índice pela função editorial_client_task_links (só ids dos conteúdos dele; teste do SQL em PGlite:
 * supabase/testes/vinculo_tarefa_conteudo_runner.mjs).
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("índice tarefa -> conteúdo do cliente", () => {
  it("monta o índice a partir dos vínculos devolvidos pela função", () => {
    const indice = indiceDoClienteAPartirDaResposta({
      data: [
        { post_id: "p1", task_id: "t1", revision_of_post_id: null },
        { post_id: "p2", task_id: "t2", revision_of_post_id: null },
      ],
      error: null,
    });
    expect(indice.postIdByTaskId).toEqual({ t1: "p1", t2: "p2" });
    expect(indice.taskIds).toEqual(["t1", "t2"]);
  });

  it("revisão: a tarefa aponta para a versão viva, não para a de origem", () => {
    const indice = indiceDoClienteAPartirDaResposta({
      data: [
        { post_id: "p-original", task_id: "t1", revision_of_post_id: null },
        { post_id: "p-revisao", task_id: "t1", revision_of_post_id: "p-original" },
      ],
      error: null,
    });
    expect(indice.postIdByTaskId).toEqual({ t1: "p-revisao" });
  });

  it("função ainda não aplicada no banco: índice vazio (o comportamento de antes, sem quebrar a agenda)", () => {
    expect(indiceDoClienteAPartirDaResposta({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }))
      .toEqual({ taskIds: [], postIdByTaskId: {} });
    expect(indiceDoClienteAPartirDaResposta({ data: null, error: { code: "42883", message: "function does not exist" } }))
      .toEqual({ taskIds: [], postIdByTaskId: {} });
  });

  it("outro erro sobe (não guarda 'sem vínculo' como dado bom)", () => {
    expect(() => indiceDoClienteAPartirDaResposta({ data: null, error: { code: "08006", message: "rede" } })).toThrow();
  });
});

describe("a agenda do cliente usa o índice", () => {
  const pagina = ler("src/pages/EditorialCalendar.tsx");

  it("o cliente real consulta a função; a equipe e o 'Ver como cliente' usam o índice da equipe", () => {
    expect(pagina).toMatch(/useEditorialClientTaskLinks\(\s*!canUseTeamData && !isImpersonating,?\s*\)/);
    expect(pagina).toMatch(/useEditorialLinkedTaskIds\(\s*canUseTeamData \|\| isImpersonating,/);
    expect(pagina).toMatch(/const taskLinkIndex = linkedTaskIdsQuery\.data \|\| clientTaskLinksQuery\.data;/);
  });

  it("a tarefa que já virou conteúdo sai da grade pelo mesmo índice, para todos", () => {
    expect(pagina).toMatch(/taskLinkIndex\?\.postIdByTaskId \|\| \{\}/);
    expect(pagina).toMatch(/editorialDeadlineTasks\.filter\(\(task\) => !linkedPostIdByTaskId\[task\.id\]\)/);
  });

  it("a função do banco só devolve ids dos conteúdos ativos do próprio cliente e não é aberta ao anon", () => {
    const sql = ler("supabase/migrations/20261101230000_cliente_ve_vinculo_tarefa_conteudo.sql");
    expect(sql).toMatch(/RETURNS TABLE \(post_id uuid, task_id uuid, revision_of_post_id uuid\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = ''/);
    expect(sql).toMatch(/post\.client_id = auth\.uid\(\)/);
    expect(sql).toMatch(/internal\.client_id = auth\.uid\(\)/);
    expect(sql).toMatch(/public\.has_role\(auth\.uid\(\), 'client'::public\.app_role\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.editorial_client_task_links\(\) FROM PUBLIC, anon;/);
    expect(sql).not.toMatch(/internal_notes|responsible_id/);
  });
});
