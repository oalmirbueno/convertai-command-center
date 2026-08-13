import { describe, expect, it } from "vitest";
import {
  FILE_FOLDER_DEFINITIONS,
  clientFolders,
  fileLocationLabel,
  folderLabel,
  matchesFolderFilter,
  resolveFolder,
  resolveKind,
  summarizeFiles,
} from "./fileTaxonomy";

/**
 * Contrato da organização de arquivos. O que estes testes protegem:
 * 1. Nenhum arquivo antigo muda de pasta sozinho (dados reais em produção).
 * 2. Material gráfico é separado em carrossel, post, story e vídeo.
 * 3. Nada some: sem classificação possível, o arquivo ainda aparece.
 */

describe("pasta gravada manda", () => {
  it("respeita as pastas que já existem no banco", () => {
    for (const folder of ["estrategicos", "contratos", "materiais", "entregas", "criativos", "relatorios", "operacionais"]) {
      expect(resolveFolder({ folder, file_name: "qualquer-coisa.pdf" })).toBe(folder);
    }
  });

  it("não deixa a leitura do nome sobrepor a pasta escolhida pela equipe", () => {
    // Arquivo chamado "contrato" mas guardado em materiais continua em materiais.
    expect(resolveFolder({ folder: "materiais", file_name: "contrato-social.pdf" })).toBe("materiais");
  });
});

describe("separação dentro de materiais gráficos", () => {
  it("reconhece carrossel, post, story e vídeo pelo nome", () => {
    expect(resolveKind({ file_name: "carrossel-outubro-01.png" })).toBe("carrossel");
    expect(resolveKind({ file_name: "story-promo-terca.png" })).toBe("story");
    expect(resolveKind({ file_name: "reels-bastidores.mp4" })).toBe("video");
    expect(resolveKind({ file_name: "post-feed-lancamento.png" })).toBe("post");
  });

  it("reconhece carrossel pela estrutura, sem depender do nome", () => {
    expect(resolveKind({ file_name: "arte-final.png", carousel_text: "card 1" })).toBe("carrossel");
    expect(resolveKind({ file_name: "arte-2.png", parent_file_id: "abc" })).toBe("carrossel");
  });

  it("traduz os tipos antigos gravados em inglês", () => {
    expect(resolveKind({ file_type: "creative", file_name: "arte.png" })).toBe("post");
    expect(resolveKind({ file_type: "strategic", file_name: "doc.pdf" })).toBe("estrategico");
    expect(resolveKind({ file_type: "relatório", file_name: "x.pdf" })).toBe("relatorio");
  });

  it("deixa o nome corrigir um tipo genérico demais", () => {
    // Salvo como "documento" mas é claramente um carrossel.
    expect(resolveKind({ file_type: "documento", file_name: "carrossel-black-friday.pdf" })).toBe(
      "carrossel",
    );
  });
});

describe("nada some", () => {
  it("arquivo sem pasta e sem tipo continua tendo um lugar", () => {
    const folder = resolveFolder({ file_name: "IMG_9931" });
    expect(FILE_FOLDER_DEFINITIONS.some((definition) => definition.id === folder)).toBe(true);
    expect(resolveKind({ file_name: "IMG_9931" })).toBeTruthy();
  });

  it("imagem solta sem nome útil vira material gráfico", () => {
    expect(resolveFolder({ file_name: "final.png", mime_type: "image/png" })).toBe("materiais");
  });

  it("o filtro 'todos' nunca esconde nada", () => {
    expect(matchesFolderFilter({ file_name: "x" }, "todos")).toBe(true);
  });
});

describe("contagem e rótulos para a tela", () => {
  it("conta por pasta e por tipo dentro dela", () => {
    const summary = summarizeFiles([
      { folder: "materiais", file_name: "carrossel-1.png" },
      { folder: "materiais", file_name: "carrossel-2.png" },
      { folder: "materiais", file_name: "story-a.png" },
      { folder: "contratos", file_name: "contrato.pdf" },
    ]);
    const materiais = summary.find((entry) => entry.folder.id === "materiais")!;
    expect(materiais.total).toBe(3);
    expect(materiais.byKind.find((entry) => entry.kind.id === "carrossel")?.total).toBe(2);
    expect(materiais.byKind.find((entry) => entry.kind.id === "story")?.total).toBe(1);
    // Tipo sem nenhum arquivo não vira filtro morto na tela.
    expect(materiais.byKind.every((entry) => entry.total > 0)).toBe(true);
  });

  it("dá nome em linguagem de cliente", () => {
    expect(folderLabel("materiais")).toBe("Materiais gráficos");
    expect(folderLabel("estrategicos")).toBe("Documentos estratégicos");
    expect(folderLabel("operacionais")).toBe("Documentos operacionais");
    expect(fileLocationLabel({ folder: "materiais", file_name: "carrossel-1.png" })).toBe(
      "Materiais gráficos · Carrossel",
    );
  });

  it("o cliente enxerga todas as pastas, sem tela cega", () => {
    // A regressão antiga: a tela do cliente listava só 4 das 7 pastas.
    expect(clientFolders().length).toBe(FILE_FOLDER_DEFINITIONS.length);
  });

  it("sem travessão nos rótulos", () => {
    for (const definition of FILE_FOLDER_DEFINITIONS) {
      expect(definition.label).not.toMatch(/[—–]/);
      expect(definition.hint).not.toMatch(/[—–]/);
    }
  });
});
