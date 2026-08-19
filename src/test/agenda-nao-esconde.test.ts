import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const views = readFileSync(
  resolve(__dirname, "../..", "src/components/editorial/EditorialCalendarViews.tsx"),
  "utf8",
);

/**
 * A agenda é montada a partir das PUBLICAÇÕES, não dos posts: o post não tem
 * data própria no banco — só created_at. Quem dá o dia é
 * editorial_publications.scheduled_at.
 *
 * Isso abria um buraco: a grade não desenha publicação cancelada (ela guarda
 * a data antiga e virava card fantasma) e o backlog só olhava para publicação
 * SEM data. Um post cujo plano foi todo cancelado não passava por nenhum dos
 * dois e ficava invisível na tela inteira — existindo no banco, com arte, sem
 * lugar nenhum para ser reaberto.
 */

describe("conteúdo que existe aparece em algum lugar", () => {
  it("plano todo cancelado cai no backlog em vez de sumir", () => {
    expect(views).toContain(
      'post.publications.every(({ publication }) => publication.status === "cancelled")',
    );
  });

  it("o caminho que escondia deixou de ser silencioso", () => {
    // O `return []` continua existindo — é correto para post cujas
    // publicações estão todas agendadas e vivas, porque essas JÁ aparecem na
    // grade. O que não pode é ele engolir o caso do cancelado.
    const trecho = views.slice(
      views.indexOf("function flattenBacklog"),
      views.indexOf("function contentTypeIcon"),
    );
    const posicaoCancelada = trecho.indexOf('publication.status === "cancelled"');
    const posicaoVazio = trecho.lastIndexOf("return [];");
    expect(posicaoCancelada).toBeGreaterThan(-1);
    // A checagem do cancelado vem ANTES do retorno vazio, senão nunca roda.
    expect(posicaoCancelada).toBeLessThan(posicaoVazio);
  });

  it("a grade continua sem desenhar cancelada", () => {
    // Cancelada mantém a data antiga: desenhar viraria card fantasma ao lado
    // do plano vivo. Ela aparece no backlog, não no dia.
    expect(views).toContain('publication.publication.status !== "cancelled"');
  });
});
