import { describe, expect, it } from "vitest";
import { periodoDaSemana, weekRitualMessage } from "@/lib/cycleRitual";

/**
 * A mensagem antiga listava as etapas e parava aí: servia de comprovante e
 * falhava como comunicação. O cliente lia "posts agendados, painel atualizado"
 * sem saber por que aquilo era bom para ele. Estes testes guardam as três
 * perguntas que a mensagem passou a responder — o que saiu, por que importa
 * agora, o que vem — e o tom que já é regra no resto do painel.
 */

const base = {
  clientName: "Mirante",
  area: "social" as const,
  weekStart: "2026-08-11",
  totalSteps: 6,
  stepNames: [
    "Conteúdo da semana criado (artes e legendas)",
    "Posts agendados",
    "Painel atualizado",
    "Relatório enviado",
    "Reunião de alinhamento",
    "Ideias da próxima semana",
  ],
};

describe("o período em português", () => {
  it("diz a semana do jeito que se fala", () => {
    expect(periodoDaSemana("2026-08-11")).toBe("11 a 17 de agosto");
  });

  it("atravessa a virada de mês sem esconder o mês de início", () => {
    expect(periodoDaSemana("2026-08-28")).toBe("28 de agosto a 3 de setembro");
  });

  it("data inválida não quebra a mensagem", () => {
    expect(periodoDaSemana("")).toBe("");
  });
});

describe("a mensagem do ritual", () => {
  it("responde o que saiu, por que importa e o que vem", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [1, 2], phase: "executar" });

    expect(texto).toContain("O que saiu esta semana:");
    expect(texto).toContain("conteúdo da semana criado");
    // O porquê é o que faltava: sem ele a lista não significa nada.
    expect(texto).toContain("constância");
    expect(texto).toContain("em produção");
  });

  it("o parêntese técnico da etapa não vaza para o cliente", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [1] });
    expect(texto).not.toContain("(artes e legendas)");
  });

  it("nunca fala de pendência, atraso ou cobrança", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [1, 2, 3], phase: "estruturar" });
    expect(texto).not.toMatch(/faltam|pendente|parado|atrasad|aguardando você|não recebemos/i);
  });

  it("inclui o trabalho avulso, que a rotina fixa não mostrava", () => {
    // Gravação na loja, reunião no meio da semana: sem isto a semana parecia
    // menor do que foi.
    const texto = weekRitualMessage({
      ...base,
      doneSteps: [1],
      avulsosFeitos: ["gravação na loja com o time"],
    });
    expect(texto).toContain("gravação na loja com o time");
  });

  it("semana recém-começada fala de produção, nunca de vazio", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [], phase: "lancar" });
    expect(texto).toContain("em produção");
    expect(texto).not.toMatch(/nada|nenhum|vazi/i);
    // Mesmo sem entrega, o porquê da fase continua explicando o momento.
    expect(texto).toContain("estrutura na rua");
  });

  it("semana completa é dita como completa", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [1, 2, 3, 4, 5, 6] });
    expect(texto).toContain("Semana completa");
    expect(texto).not.toContain("segue em produção");
  });

  it("continuidade só aparece quando existe", () => {
    // "1ª semana seguida" não prova nada; a partir de duas, vira constância.
    expect(weekRitualMessage({ ...base, doneSteps: [1], sequencia: 1 })).not.toMatch(/semana seguida/);
    expect(weekRitualMessage({ ...base, doneSteps: [1], sequencia: 5 })).toContain(
      "5ª semana seguida",
    );
  });

  it("o porquê muda com a fase do cliente", () => {
    const nova = weekRitualMessage({ ...base, doneSteps: [1], phase: "analisar" });
    const madura = weekRitualMessage({ ...base, doneSteps: [1], phase: "acelerar" });
    expect(nova).toContain("leitura do seu negócio");
    expect(madura).toContain("escala");
    expect(nova).not.toBe(madura);
  });

  it("traz o cliente e o período no cabeçalho", () => {
    const texto = weekRitualMessage({ ...base, doneSteps: [1] });
    expect(texto).toContain("Mirante · Social Media");
    expect(texto).toContain("11 a 17 de agosto");
  });
});
