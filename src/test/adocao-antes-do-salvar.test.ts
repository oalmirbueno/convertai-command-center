import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const editor = readFileSync(
  resolve(__dirname, "../..", "src/components/editorial/EditorialEditor.tsx"),
  "utf8",
);

/**
 * O dono selecionou a arte sem projeto e o salvar recusou com "editorial
 * files must be readable root files from the selected client and project" —
 * em cima do arquivo CERTO. A adoção do arquivo no projeto rodava em segundo
 * plano no clique, e o salvar corria mais rápido que ela. Erro meu de
 * desenho: corrida entre o clique e o salvar, com a falha ainda por cima
 * engolida num if (!error) silencioso.
 */

describe("a adoção do arquivo no projeto não corre contra o salvar", () => {
  it("é uma função aguardável, não um disparo solto", () => {
    expect(editor).toContain("const adotarArquivoNoProjeto = async (");
    expect(editor).toContain("Promise<boolean>");
  });

  it("o salvar espera a adoção quando o arquivo segue sem projeto", () => {
    const save = editor.slice(editor.indexOf("const handleSave"));
    expect(save).toContain("const adotado = await adotarArquivoNoProjeto(");
    expect(save).toContain("if (!adotado) return;");
  });

  it("a adoção cobre os filhos do carrossel no salvar também", () => {
    const save = editor.slice(editor.indexOf("const handleSave"));
    expect(save).toContain("file.parent_file_id === primaryFileId");
  });

  it("falha na adoção aparece, em vez de ser engolida", () => {
    expect(editor).toContain("A arte não pôde entrar no projeto");
    expect(editor).not.toContain("if (!error) void refetchOptions();");
  });

  it("o catch final passa pelo tradutor — cru em inglês não chega à tela", () => {
    expect(editor).toContain("toast.error(editorialErrorMessage(error, message));");
  });
});
