import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colar imagem no Workspace (Ctrl+V).
 *
 * O pedido: "se eu copiar a imagem, dá pra colar e salvar" — sem o desvio
 * de salvar no disco para depois arrastar. As regras abaixo são as que
 * fariam o recurso incomodar em silêncio se quebrassem.
 */

const raiz = resolve(__dirname, "../..");
const pagina = readFileSync(resolve(raiz, "src/pages/Workspace.tsx"), "utf8");

describe("colar imagem no workspace", () => {
  it("o colar usa o MESMO caminho de upload do arrastar", () => {
    // Colar não é um segundo jeito de subir arquivo: é uma segunda porta
    // para o mesmo handleUpload (fila, progresso, pasta aberta). Um
    // caminho paralelo divergiria do principal no primeiro conserto.
    const trecho = pagina.slice(
      pagina.indexOf("colarImagemRef"),
      pagina.indexOf("async function performDelete"),
    );
    expect(trecho).toContain("void handleUpload(dt.files)");
    expect(trecho).not.toContain("uploads.enqueue");
  });

  it("colar dentro de campo de texto continua colando texto", () => {
    // Sem esta guarda, renomear um arquivo com Ctrl+V viraria upload
    // acidental — o recurso novo quebraria um gesto que sempre funcionou.
    expect(pagina).toContain("input, textarea, [contenteditable=true]");
  });

  it("imagem colada ganha nome com data e hora", () => {
    // Toda imagem da área de transferência chega como "image.png". Sem
    // renomear, a pasta vira uma pilha de homônimos indistinguíveis.
    expect(pagina).toContain("Colado ${carimbo}");
    // E arquivo copiado do Explorer mantém o nome que já tem: só o nome
    // GENÉRICO é trocado.
    expect(pagina).toMatch(/generico/);
  });

  it("clipboard sem arquivo nao e capturado", () => {
    // Colar texto puro fora de campo segue com o comportamento nativo; o
    // preventDefault só acontece quando há arquivo para subir.
    const trecho = pagina.slice(
      pagina.indexOf("colarImagemRef"),
      pagina.indexOf("async function performDelete"),
    );
    expect(trecho.indexOf("if (arquivos.length === 0) return;"))
      .toBeLessThan(trecho.indexOf("e.preventDefault()"));
  });

  it("o listener e registrado uma vez, lendo o handler pela ref", () => {
    // handleUpload nasce de novo a cada render; assinar o document a cada
    // render para acompanhá-lo seria ruído. A ref desacopla.
    expect(pagina).toContain('document.addEventListener("paste"');
    expect(pagina).toContain('document.removeEventListener("paste"');
  });

  it("a tela conta que colar existe", () => {
    // Recurso invisível é recurso que não existe: as dicas de arrastar
    // passam a mencionar o Ctrl+V.
    expect(pagina).toContain("cole uma imagem (Ctrl+V)");
  });
});
