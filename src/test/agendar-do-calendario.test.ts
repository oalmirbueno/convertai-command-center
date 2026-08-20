import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const dialogo = readFileSync(
  resolve(raiz, "src/components/editorial/EditorialScheduleDialog.tsx"),
  "utf8",
);
const views = readFileSync(
  resolve(raiz, "src/components/editorial/EditorialCalendarViews.tsx"),
  "utf8",
);

/**
 * O diálogo de agendar sempre soube quais conteúdos do calendário estavam
 * prontos (schedulablePosts) — mas só os usava como índice interno. Quem
 * agendava era obrigado a reencontrar a mídia na lista de arquivos, mesmo
 * quando o card já existia com arte, título e plano de contas definidos.
 */

describe("agendar puxa os conteúdos do calendário", () => {
  it("a seção de um clique existe e vem antes dos arquivos", () => {
    expect(dialogo).toContain("Prontos no calendário — um clique");
    expect(dialogo.indexOf("Prontos no calendário")).toBeLessThan(
      dialogo.lastIndexOf("<ApprovedMediaPicker"),
    );
  });

  it("clicar no card usa o MESMO caminho da seleção por arquivo", () => {
    // selectAsset já resolve o vínculo com o post existente e trava o plano
    // de contas; um caminho paralelo criaria um post duplicado.
    const secao = dialogo.slice(
      dialogo.indexOf("Prontos no calendário"),
      dialogo.lastIndexOf("<ApprovedMediaPicker"),
    );
    expect(secao).toContain("approvedAssetByRootId.get(bundle.post.primary_file_id)");
    expect(secao).toContain("selectAsset(asset)");
  });

  it("card sem asset resolvível não vira botão morto", () => {
    const secao = dialogo.slice(
      dialogo.indexOf("Prontos no calendário"),
      dialogo.lastIndexOf("<ApprovedMediaPicker"),
    );
    expect(secao).toContain("if (!asset) return null;");
  });

  it("a miniatura é a mesma da agenda, exportada e não copiada", () => {
    expect(views).toContain("export function EditorialFileThumbnail");
    expect(dialogo).toContain(
      'import { EditorialFileThumbnail } from "@/components/editorial/EditorialCalendarViews"',
    );
  });

  it("os arquivos continuam disponíveis como segundo caminho", () => {
    // O atalho não pode remover o caminho antigo: arte recém-aprovada que
    // ainda não virou card do calendário só chega por Arquivos.
    expect(dialogo).toContain("ou escolha direto dos arquivos");
    expect(dialogo).toContain("<ApprovedMediaPicker");
  });
});
