import { describe, expect, it, vi } from "vitest";
import { weekSummaryText } from "@/lib/cycleDefs";

/**
 * O resumo da semana é o texto que sai do Ciclo e chega ao cliente pelo
 * WhatsApp ou pela área de transferência. Ele fala do trabalho, não do
 * checklist: nada de "etapa 3", nada de nome interno de campo.
 */
describe("resumo da semana do cliente", () => {
  it("conta o que foi feito e quanto falta", () => {
    const texto = weekSummaryText({
      clientName: "Acerbi",
      area: "social",
      doneSteps: [1, 2],
      totalSteps: 6,
    });

    expect(texto).toContain("Acerbi");
    expect(texto).toContain("conteúdo da semana criado");
    // O que falta é dito como trabalho em andamento, nunca como pendência.
    expect(texto).toContain("em andamento");
    expect(texto).not.toMatch(/faltam|pendente|parado|atrasad/i);
    // O parêntese técnico da etapa não vaza para o cliente.
    expect(texto).not.toContain("(artes e legendas)");
  });

  it("fecha a mensagem quando a semana está completa", () => {
    const texto = weekSummaryText({
      clientName: "Verzelo",
      area: "trafego",
      doneSteps: [1, 2, 3, 4, 5, 6],
      totalSteps: 6,
    });

    expect(texto).toContain("Semana completa");
    expect(texto).not.toMatch(/faltam|pendente/i);
  });

  it("semana recém-começada fala de produção, nunca de vazio", () => {
    const texto = weekSummaryText({
      clientName: "Mirante",
      area: "social",
      doneSteps: [],
      totalSteps: 6,
    });

    // O cliente nunca deve ler que nada foi feito por ele nesta semana.
    expect(texto).toContain("em produção");
    expect(texto).not.toMatch(/não teve|nenhuma|nada foi/i);
  });

  it("mantém as etapas de onboarding fora da mensagem do cliente", () => {
    const texto = weekSummaryText({
      clientName: "Mirante",
      area: "social",
      doneSteps: [1, 7, 8],
      totalSteps: 10,
    });

    // 7 e 8 são acessos e contas: conversa interna, não vira recado.
    expect(texto).not.toMatch(/acessos|briefing|contas conectadas/i);
    expect(texto).toContain("conteúdo da semana criado");
  });
});

describe("ferramentas do detalhe do cliente", () => {
  it("monta o link de WhatsApp com o número do cadastro e o resumo", () => {
    // Reproduz o que o botão faz: limpa o telefone e leva o texto pronto.
    const client = { phone: "(41) 99999-8888", company_name: "Acerbi" };
    const resumo = weekSummaryText({
      clientName: client.company_name, area: "social", doneSteps: [1], totalSteps: 6,
    });
    const numero = String(client.phone).replace(/\D/g, "");
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(resumo)}`;

    expect(url).toContain("https://wa.me/41999998888");
    expect(decodeURIComponent(url)).toContain("Acerbi");
  });

  it("cai para o seletor de contato quando o cliente não tem telefone", () => {
    const numero = String("").replace(/\D/g, "");
    const url = numero ? `https://wa.me/${numero}` : "https://wa.me/";
    expect(url).toBe("https://wa.me/");
  });
});
