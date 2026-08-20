import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { editorialErrorMessage } from "@/lib/editorialErrorMessage";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const hook = ler("src/hooks/useEditorialCalendar.ts");
const editor = ler("src/components/editorial/EditorialEditor.tsx");
const sheet = ler("src/components/editorial/EditorialDetailSheet.tsx");

/**
 * "Subi conteúdo lá no Arquivos e não está puxando, e nem o botão atualizar."
 *
 * Medido: "Vai ao Startup Summit?.png" subiu às 16:41 SEM projeto — o upload
 * em Arquivos permite não escolher projeto — e a lista do card exigia
 * projeto exato. O arquivo era invisível por filtro, então atualizar não
 * tinha como trazê-lo: o botão funcionava, a consulta é que o excluía.
 */

describe("arquivo do cliente sem projeto aparece no card", () => {
  it("a consulta de opções inclui project_id nulo", () => {
    expect(hook).toContain("project_id.eq.${projectId},project_id.is.null");
  });

  it("ao ser escolhido, o arquivo é adotado no projeto", () => {
    // Aparecer mas não servir (o salvar recusaria por projeto) seria pior
    // do que não aparecer.
    expect(editor).toContain('.update({ project_id: projectId })');
    expect(editor).toContain('.is("project_id", null)');
  });

  it("a adoção cobre os slides do carrossel, não só a capa", () => {
    expect(editor).toContain("asset.files.map((f) => f.id)");
  });
});

describe("o erro da publicação diz a causa, não o genérico", () => {
  it("o catch passa pelo tradutor", () => {
    expect(sheet).toContain('editorialErrorMessage(error, "Não foi possível atualizar a publicação.")');
  });

  it("o gate de material aprovado explica e aponta a saída", () => {
    const msg = editorialErrorMessage(
      new Error("publication requires ready content and approved immutable files"),
      "x",
    );
    expect(msg).toContain("aprovado e travado");
    expect(msg).not.toContain("publication requires");
  });

  it("versão velha vira instrução de recarregar", () => {
    const msg = editorialErrorMessage(
      new Error("publication changed; refresh before transitioning"),
      "x",
    );
    expect(msg).toContain("Recarregue");
  });

  it("conta desvinculada aponta para Contas", () => {
    const msg = editorialErrorMessage(
      new Error("publication account is inactive, changed or unlinked"),
      "x",
    );
    expect(msg).toContain("Contas");
  });
});
