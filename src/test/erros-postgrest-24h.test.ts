import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mensagemVinculoInexistente, sugerirVinculo } from "../../supabase/functions/_shared/vinculo-guard";
import { organizarArquivosDaExecucao } from "../../supabase/functions/_shared/arquivos-da-execucao";

/**
 * Tres erros do PostgREST no log de 24h (18/10/2026) e as regras que impedem
 * a volta deles:
 *
 *   68x 400  POST rpc/operator_participar  link_not_found (id remendado ou id da tarefa)
 *    7x 400  GET internal_operators?id=in.(...,null)  operator_id nulo da revisao central
 *    9x 406  GET tasks?id=eq...  .single() em tarefa apagada do Kanban
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

// Ids reais do log: o vinculo existe, a tarefa existe, e o agente mandou outra coisa.
const VINCULO = "098906d9-8cac-4b47-96f1-32b8a081b25c";
const TAREFA = "adbb644b-3a84-40ba-8a5e-1a5feecf65b7";
const OUTRO = { id: "ba27f71b-7a50-44fb-b052-05fdbb9131b8", kanban_task_id: "96c5280e-0a7e-4088-9cc9-d8ada40d95c6", titulo: "Post Verzelo" };
const candidatos = [{ id: VINCULO, kanban_task_id: TAREFA, titulo: "Carrossel Mirante" }, OUTRO];

describe("operator_participar: o link_id e conferido antes do RPC", () => {
  it("id da tarefa no lugar do vinculo aponta o vinculo certo", () => {
    expect(sugerirVinculo(TAREFA, candidatos)).toEqual({ tipo: "id_da_tarefa", vinculo: candidatos[0] });
    const msg = mensagemVinculoInexistente(TAREFA, candidatos, "registro");
    expect(msg).toContain(`O link_id do vinculo dela e ${VINCULO}`);
    expect(msg).toContain("nada foi gravado");
  });

  it("id remendado (comeco de um vinculo, fim de outro uuid) sugere o vinculo mais parecido", () => {
    // Caso do log: "098906d9-8cac-4b47-96f1-..." virou "098906d9-8cac-4b47-be61-08e34e18e4c9".
    const sugestao = sugerirVinculo("098906d9-8cac-4b47-be61-08e34e18e4c9", candidatos);
    expect(sugestao).toEqual({ tipo: "parecido", vinculo: candidatos[0] });
  });

  it("dois caracteres trocados tambem e reconhecido", () => {
    expect(sugerirVinculo("098906d9-8cac-4b47-96f1-32b8a081b52c", candidatos)?.vinculo.id).toBe(VINCULO);
  });

  it("sem parecido nao inventa: lista os abertos", () => {
    const msg = mensagemVinculoInexistente("11111111-2222-4333-8444-555555555555", candidatos, null);
    expect(sugerirVinculo("11111111-2222-4333-8444-555555555555", candidatos)).toBeNull();
    expect(msg).toContain(`"Post Verzelo" = ${OUTRO.id}`);
  });

  it("o diario confere o vinculo antes de ler ou escrever", () => {
    const servico = ler("supabase/functions/_shared/aceleriq-operators-services.ts");
    const diario = servico.slice(servico.indexOf("export async function operatorDiary"));
    const guarda = diario.indexOf("await exigirVinculoExistente(");
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(diario.indexOf("rpc('operator_participar'"));
  });
});

describe("internal_operators: nunca mandar null no in.()", () => {
  it("OrdensAutorizadas filtra operator_id nulo antes de consultar", () => {
    const tela = ler("src/components/execucao/OrdensAutorizadas.tsx");
    expect(tela).toContain(".map((l) => l.operator_id).filter(Boolean)");
    expect(tela).not.toContain('.in("id", [...new Set(linhas.map((l) => l.operator_id))])');
  });
});

describe("tasks: tarefa apagada e caso normal, sem 406", () => {
  it("nenhum leitor de tarefa do vinculo usa .single()", () => {
    const leitores = [
      "supabase/functions/_shared/arquivos-da-execucao.ts",
      "src/components/execucao/DiarioDaExecucao.tsx",
      "src/components/execucao/TarefaDoCaderno.tsx",
      "src/lib/arquivosDoCaderno.ts",
    ];
    for (const arquivo of leitores) {
      const leituras = ler(arquivo).split("\n")
        .filter((l) => /from\(["']tasks["']\)\.select\(/.test(l) && /\.eq\(["']id["']/.test(l));
      expect(leituras.length, arquivo).toBeGreaterThan(0);
      for (const linha of leituras) expect(linha, arquivo).toContain(".maybeSingle()");
    }
  });

  it("organizar anexos de vinculo com tarefa apagada devolve aviso, nao erro", async () => {
    const download = vi.fn();
    const db = {
      storage: { from: () => ({ download, upload: vi.fn() }) },
      from: (tabela: string) => {
        const q: any = {
          select: () => q, eq: () => q,
          single: async () => ({ data: null, error: { code: "PGRST116" } }),
          maybeSingle: async () => {
            if (tabela === "operator_task_links") return { data: { operator_id: "op", kanban_task_id: "apagada" }, error: null };
            if (tabela === "internal_operators") return { data: { display_name: "Registro" }, error: null };
            return { data: null, error: null };
          },
        };
        return q;
      },
    };
    // O vinculo e lido com single(): ele foi conferido antes pelo diario.
    db.from = ((orig) => (t: string) => {
      const q = orig(t);
      if (t === "operator_task_links") q.single = q.maybeSingle;
      return q;
    })(db.from);
    const r = await organizarArquivosDaExecucao(db, "link", [{ name: "Prova", url: "aceleriq-file://00000000-0000-0000-0000-000000000002" }]);
    expect(r.organizados).toBe(0);
    expect(r.avisos[0]).toContain("não existe mais no Kanban");
    expect(download).not.toHaveBeenCalled();
  });
});
