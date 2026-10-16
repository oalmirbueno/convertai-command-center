import { describe, expect, it } from "vitest";
import { leituraSimples, limparTecnico } from "@/lib/cadernoExecucao";
import { leituraDaFala, palpiteDaFala, perguntaDaFala } from "../../supabase/functions/gestor-aceleriq/modulos/fala-do-diario";

/**
 * 16/10/2026, dono: "quando eu abro um card ele vem muito poluído... não montar questão com códigos"
 * e "quando escrever algo, a gente já tem que entender".
 */
const REAL = "Ciclo interno 09/10/2026, corte 19:45:51Z (16h45 BRT). Augusto coordenação; especialidade Atlas na conciliação documental. Cliente4dd691a7-d481-451f-800b-5e6b6fdc8721; projeto=0f2c9a10-1111-4222-8333-123456789abc v113; tarefa 9b2e1c3d-2222-4333-8444-abcdefabcdef. CONCLUÍDAS: nenhuma tarefa rastreada; conciliação documental executada. AVANÇOS: calendário vivo retornou6 itens, total6 has_more=false; complemento retornou2. PRÓXIMO PASSO: Revisor conferir fontes e concluir parecer.";

describe("leitura simples do diário", () => {
  it("tira ids, chave=valor e segundos com Z, sem deixar 'registro vinculado' colado", () => {
    const t = limparTecnico(REAL);
    expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(t).not.toContain("registro vinculado");
    expect(t).not.toContain("has_more");
    expect(t).not.toContain("19:45:51Z");
    expect(t).toContain("19:45");
    expect(t).toContain("retornou 6 itens");
  });
  it("separa os blocos em maiúsculas com o tom certo e dá um resumo curto", () => {
    const l = leituraSimples(REAL);
    expect(l.secoes.map((s) => [s.rotulo, s.tom])).toEqual([["Concluídas", "feito"], ["Avanços", "andamento"], ["Próximo passo", "proximo"]]);
    expect(l.secoes[2].texto).toBe("Revisor conferir fontes e concluir parecer.");
    expect(l.resumo.length).toBeLessThanOrEqual(240);
    expect(l.resumo.startsWith("Ciclo interno 09/10/2026")).toBe(true);
    expect(l.temMais).toBe(true);
  });
  it("descola palavra de número, troca status em inglês e não mexe no link", () => {
    const t = limparTecnico("calendário vivo por projeto09-15/10; 09/10, approved/agency approved; published12:33Z, permalinkhttps://www.instagram.com/p/DeRgxt2lmow/. 10/10, approved; scheduled14Z; task_id ausente.. fim...");
    expect(t).toContain("projeto 09-15/10");
    expect(t).toContain("aprovado/aprovado pela agência");
    expect(t).toContain("publicado 12:33,");
    expect(t).toContain("permalink https://www.instagram.com/p/DeRgxt2lmow/");
    expect(t).toContain("agendado 14;");
    expect(t).not.toContain("task_id");
    expect(t).toContain("ausente. fim...");
  });
  it("texto simples continua igual", () => {
    expect(leituraSimples("Post publicado às 10h. Link no anexo.")).toEqual({ resumo: "Post publicado às 10h. Link no anexo.", secoes: [], temMais: false });
  });
});

describe("o que o dono quis dizer (Jev)", () => {
  it("pergunta é um Choice com as opções do diário e o contexto da tarefa", () => {
    const p = perguntaDaFala("faz três versões", { tarefa: "Carrossel", situacao: "em revisão" });
    expect(p.questions.tipo.type).toBe("choice");
    expect(Object.keys(p.questions.tipo.criteria)).toEqual(["comentario", "instrucao", "correcao", "decisao", "resposta_insumo", "pedido_revisao", "aprovacao", "rejeicao", "outro"]);
    expect(p.state).toMatchObject({ fala: "faz três versões", tarefa: "Carrossel", situacao_da_tarefa: "em revisão" });
  });
  it("aprovação com certeza oferece o botão, nunca age sozinha", () => {
    expect(leituraDaFala({ choice: "aprovacao", confidence: 0.8, probabilities: { aprovacao: 0.82 } })).toEqual({ tipo: "aprovacao", confianca: 0.82, acao: "aprovar", fonte: "jev" });
    expect(leituraDaFala({ choice: "aprovacao", confidence: 0.5, probabilities: { aprovacao: 0.52 } }).acao).toBeNull();
    expect(leituraDaFala({ choice: "rejeicao", probabilities: { rejeicao: 0.7 } }).acao).toBe("reprovar");
  });
  it("certeza baixa ou 'outro' vira comentário (não manda o agente fazer nada)", () => {
    expect(leituraDaFala({ choice: "instrucao", probabilities: { instrucao: 0.3 } }).tipo).toBe("comentario");
    expect(leituraDaFala({ choice: "outro", probabilities: { outro: 0.9 } }).tipo).toBe("comentario");
    expect(leituraDaFala(undefined).tipo).toBe("comentario");
  });
  it("sem o Jev, o palpite por palavras nunca oferece aprovar", () => {
    expect(palpiteDaFala("faz três versões do carrossel")).toMatchObject({ tipo: "instrucao", acao: null, fonte: "palpite" });
    expect(palpiteDaFala("o preço está errado, é 49,90").tipo).toBe("correcao");
    expect(palpiteDaFala("aprovado, pode concluir").acao).toBeNull();
  });
});
