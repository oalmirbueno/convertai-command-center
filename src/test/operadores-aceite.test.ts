import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * As pendências do aceite, uma a uma.
 *
 * O relato do teste em sessão nova foi preciso, e três das cinco eram
 * defeito de verdade. As outras duas eu confirmei no banco que NÃO eram:
 *
 *  - "idempotência incompleta": project_memory tem UMA linha para aquele
 *    run_key. A entrega não duplicou. O que duplicou foi a CONTAGEM do
 *    digest, que somava linhas da trilha em vez de execuções.
 *  - "a tarefa real mudou": a trilha do MCP registra só leituras
 *    (aceleriq_fetch) e chamadas de operador. Nenhuma escrita em tarefa
 *    partiu daqui.
 */

const raiz = resolve(__dirname, "../..");
const servicos = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8",
);

describe("o digest conta entregas, nao linhas da trilha", () => {
  it("a mesma execucao so conta uma vez", () => {
    // Reportar done duas vezes grava dois eventos, e isso esta certo: a
    // trilha e append-only e o segundo relato aconteceu. Contar como duas
    // entregas e que estava errado — o trabalho foi um so.
    expect(servicos).toContain("chavesEntregues: Set<string>");
    expect(servicos).toContain("if (!linha.chavesEntregues.has(chaveDaExecucao))");
  });

  it("evento sem run_key nao some da conta", () => {
    // Pior contar uma vez a mais do que perder a entrega.
    expect(servicos).toContain("?? `evento:${String(e.occurred_at)}`");
  });

  it("a regra da contagem vai escrita na resposta", () => {
    // Quem le precisa saber por que o numero do digest difere do numero
    // de eventos, senao volta a parecer defeito.
    expect(servicos).toContain("como_contamos");
    expect(servicos).toContain("continua sendo UMA entrega");
  });

  it("o Set nao vaza para o JSON da resposta", () => {
    // Sairia como objeto vazio e confundiria quem le.
    expect(servicos).toContain("const { chavesEntregues, ...visivel } = linha;");
  });
});

describe("deep-link: onde clicar", () => {
  it("existe um so lugar que monta o endereco", () => {
    expect(servicos).toContain("export function deepLinkDoVinculo");
  });

  it("a origem e configuravel, com queda para o dominio de producao", () => {
    // Preview e producao nao moram no mesmo endereco, e link com dominio
    // errado e pior que link nenhum: parece que funciona ate clicarem.
    expect(servicos).toContain("Deno.env.get('PAINEL_ORIGIN')");
    expect(servicos).toContain("https://aceleriq.online");
  });

  it("sem vinculo nao inventa link", () => {
    expect(servicos).toContain("if (!linkId) return null;");
  });

  it("o board e a fila devolvem o deep_link", () => {
    expect((servicos.match(/deep_link: deepLinkDoVinculo/g) ?? []).length).toBe(2);
  });
});

describe("o vinculo devolve o contexto humano", () => {
  it("a tarefa e procurada tambem por painel_task_id", () => {
    // Ignorar o segundo campo devolvia tarefa nula num vinculo que TEM
    // tarefa — que foi o null relatado no aceite.
    expect(servicos).toContain(
      "vinculos.flatMap((l) => [texto(l.kanban_task_id), texto(l.painel_task_id)])",
    );
    expect(servicos).toContain("texto(l.kanban_task_id) ?? texto(l.painel_task_id)");
  });

  it("falha ao enriquecer NAO vira silencio", () => {
    // Sem isto, uma consulta que falha devolve tudo nulo e quem le conclui
    // "nao tem dado" quando a verdade e "nao consegui buscar".
    expect(servicos).toContain("if (error) falhaAoEnriquecer = error.message;");
    expect(servicos).toContain("por FALHA DE LEITURA, e nao por ausencia de dado");
  });
});

describe("a hierarquia sai no proprio quadro", () => {
  it("area, responde_a e ordem vao na lista de operadores", () => {
    // Sem isto nao ha como conferir o organograma que acabou de ser
    // configurado sem fazer outra chamada.
    expect(servicos).toContain("area: o.area ?? null,");
    expect(servicos).toContain("responde_a: o.parent_slug ?? null,");
    expect(servicos).toContain("ordem: o.display_order ?? null,");
  });

  it("a consulta traz os campos e ordena pelo organograma", () => {
    expect(servicos).toContain("area, parent_slug, display_order");
    expect(servicos).toContain("order('display_order', { ascending: true })");
  });
});
