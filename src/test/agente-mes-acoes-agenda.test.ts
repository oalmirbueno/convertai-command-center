import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blocoDaAgendaParaAcoes,
  normalizarAcoesNaAgenda,
  pecasComApelido,
  type PecaDaAgenda,
} from "../../supabase/functions/agente-calendario/acoes-agenda";
import { acaoNaAgendaDaMensagem, ehPedidoNaAgenda } from "@/components/mesa/planoDoMes";

const tarefas: PecaDaAgenda[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Carrossel outubro 2", due_date: "2026-10-08", delivery_type: "carousel", status: "todo" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Relatório mensal", due_date: "2026-10-01", delivery_type: "report", status: "todo" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Estático outubro 1", due_date: "2026-10-02", delivery_type: "static", status: "todo" },
  { id: "44444444-4444-4444-8444-444444444444", title: "Reels novembro", due_date: "2026-11-04", delivery_type: "reel", status: "todo" },
];

describe("ações do agente do mês na agenda gravada", () => {
  it("lista só peças (arte e vídeo), em ordem de data, com apelido", () => {
    const pecas = pecasComApelido(tarefas);
    expect(pecas.map((p) => [p.ref, p.title])).toEqual([
      ["a1", "Estático outubro 1"],
      ["a2", "Carrossel outubro 2"],
      ["a3", "Reels novembro"],
    ]);
    const bloco = blocoDaAgendaParaAcoes(pecas);
    expect(bloco).toContain("a1 | 2026-10-02 | estático | Estático outubro 1");
    expect(bloco).not.toContain("Relatório mensal");
    expect(bloco).not.toContain("11111111");
  });

  it("troca apelido por tarefa e ignora apelido inventado ou repetido", () => {
    const pecas = pecasComApelido(tarefas);
    const acao = normalizarAcoesNaAgenda({ resumo: "Apagar outubro.", apagar: ["a1", "A2", "a2", "a9"], mudar_data: [] }, pecas);
    expect(acao).not.toBeNull();
    expect(acao!.apagar.map((i) => i.task_id)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(acao!.ignorados).toEqual(["a2", "a9"]);
  });

  it("mudar data exige data válida e diferente, e a peça não entra duas vezes", () => {
    const pecas = pecasComApelido(tarefas);
    const acao = normalizarAcoesNaAgenda(
      { resumo: "", apagar: ["a1"], mudar_data: [{ ref: "a1", data: "2026-10-09" }, { ref: "a2", data: "amanhã" }, { ref: "a3", data: "2026-11-04" }, { ref: "a3", data: "2026-11-06" }] },
      pecas,
    );
    expect(acao!.apagar).toHaveLength(1);
    expect(acao!.mudar_data.map((m) => [m.titulo, m.data, m.para])).toEqual([["Reels novembro", "2026-11-04", "2026-11-06"]]);
    expect(acao!.resumo).toContain("apagar 1 peça");
  });

  it("sem nada para fazer, null", () => {
    expect(normalizarAcoesNaAgenda(null, pecasComApelido(tarefas))).toBeNull();
    expect(normalizarAcoesNaAgenda({ resumo: "x", apagar: ["a99"], mudar_data: [] }, pecasComApelido(tarefas))).toBeNull();
  });

  it("a tela lê o anexo da mensagem", () => {
    const a = acaoNaAgendaDaMensagem([{ tipo: "plano", mes: "2026-10" }, { tipo: "acao_agenda", resumo: "r", apagar: [{ task_id: "t", titulo: "x", data: null, formato: "carrossel" }] }]);
    expect(a && a.apagar).toHaveLength(1);
    expect(a && a.mudar_data).toEqual([]);
  });

  it("reconhece pedido de mexer na agenda no modo Criar conteúdos", () => {
    for (const t of ["Apague todos os conteúdos de outubro", "limpe a agenda de novembro", "remova os carrosséis da semana que vem", "exclua o post de sexta", "mude a data do reels para dia 10"]) {
      expect(ehPedidoNaAgenda(t)).toBe(true);
    }
    for (const t of ["Prepare a agenda de hoje", "3 conteúdos para a campanha de outubro", "Um conteúdo sobre o hype da semana"]) {
      expect(ehPedidoNaAgenda(t)).toBe(false);
    }
  });

  it("o servidor liga as ações, e o esquema pede acoes_na_agenda", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    expect(fonte).toContain("executar_acao_agenda: executarAcaoNaAgenda");
    expect(fonte).toContain("desfazer_acao_agenda: desfazerAcaoNaAgenda");
    expect(fonte).toContain("acoes_na_agenda: {");
    expect(fonte).toContain("blocoDaAgendaParaAcoes(pecasDaAgenda)");
  });
});
