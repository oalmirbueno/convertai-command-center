import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { corDaEtapa } from "@/lib/editorialCores";
import { EDITORIAL_VISUAL_STAGE_LABELS } from "@/lib/editorial";

const views = readFileSync(
  resolve(__dirname, "../..", "src/components/editorial/EditorialCalendarViews.tsx"),
  "utf8",
);

/**
 * O post não tem data própria no banco — só created_at. O dia vem de
 * editorial_publications.scheduled_at. Conteúdo ainda sem publicação agendada
 * cai na lista de "sem prazo", e ali o card saía SÓ TEXTO: mesma borda cinza
 * para tudo, sem a arte que já estava vinculada. Era preciso abrir um por um
 * para saber se estava em revisão, pronto ou publicado.
 */

describe("cada etapa tem cor própria", () => {
  it("toda etapa conhecida devolve as quatro classes", () => {
    for (const etapa of Object.keys(EDITORIAL_VISUAL_STAGE_LABELS)) {
      const cor = corDaEtapa(etapa);
      expect(cor.borda).toBeTruthy();
      expect(cor.fundo).toBeTruthy();
      expect(cor.texto).toBeTruthy();
      expect(cor.ponto).toBeTruthy();
    }
  });

  it("os estados que pedem coisas diferentes não se parecem", () => {
    // O ponto da mudança: em revisão, programado e publicado precisam ser
    // distinguíveis antes da leitura, não depois.
    const producao = corDaEtapa("production").ponto;
    const programado = corDaEtapa("scheduled").ponto;
    const publicado = corDaEtapa("published").ponto;
    expect(new Set([producao, programado, publicado]).size).toBe(3);
  });

  it("o que falhou e o que passou da hora não se confundem com o normal", () => {
    expect(corDaEtapa("failed").texto).toContain("destructive");
    expect(corDaEtapa("overdue").ponto).not.toBe(corDaEtapa("scheduled").ponto);
  });

  it("etapa desconhecida cai no neutro em vez de ficar sem classe", () => {
    // Sem isto o card sairia com className vazio — invisível no tema escuro.
    expect(corDaEtapa("chute").borda).toBeTruthy();
    expect(corDaEtapa(null).borda).toBeTruthy();
    expect(corDaEtapa(undefined).ponto).toBeTruthy();
  });
});

describe("o card sem data mostra o que já existe", () => {
  it("traz a arte vinculada, que antes ficava escondida", () => {
    const trecho = views.slice(views.indexOf("{backlogItems.map("));
    expect(trecho).toContain("<EditorialFileThumbnail");
  });

  it("pinta pela mesma função de etapa do resto da tela", () => {
    // Reusar a função evita a agenda dizer "Programado" num lugar e outra
    // coisa no outro para a mesma publicação.
    const trecho = views.slice(views.indexOf("{backlogItems.map("));
    expect(trecho).toContain("editorialVisualStage(");
    expect(trecho).toContain("corDaEtapa(etapa)");
  });

  it("escreve o nome da etapa junto da cor", () => {
    // Cor sozinha exclui quem não distingue tons; o nome fica do lado.
    const trecho = views.slice(views.indexOf("{backlogItems.map("));
    expect(trecho).toContain("EDITORIAL_VISUAL_STAGE_LABELS[etapa]");
  });
});
