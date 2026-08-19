import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (caminho: string) => readFileSync(resolve(raiz, caminho), "utf8");
const pagina = ler("src/pages/EditorialCalendar.tsx");
const views = ler("src/components/editorial/EditorialCalendarViews.tsx");
const zona = ler("src/components/editorial/EditorialArtDropZone.tsx");
const editor = ler("src/components/editorial/EditorialEditor.tsx");

/**
 * O sumiço que o dono viu: a tarefa com prazo aparecia no dia dela; quando o
 * conteúdo nascia dela (com a arte), o filtro tirava a tarefa da grade — e o
 * conteúdo novo não tem dia próprio no banco (editorial_posts não guarda
 * data; o dia é de editorial_publications.scheduled_at). O item desaparecia
 * do calendário exatamente no momento em que ganhava arte.
 */

describe("o conteúdo permanece no dia da tarefa", () => {
  it("a tarefa ligada não é mais filtrada da grade", () => {
    expect(pagina).not.toContain("deadlineTasksUnlinked");
    expect(pagina).toContain("deadlineTasksForGrid");
  });

  it("sai da grade só quando o agendamento de verdade assume o dia", () => {
    // Com plano vivo, quem ocupa o dia é a publicação; manter os dois seria
    // dupla contagem do mesmo conteúdo.
    expect(pagina).toContain("temPlanoVivo");
    expect(pagina).toMatch(/publication\.scheduled_at && publication\.status !== "cancelled"/);
  });

  it("a pílula pinta com a etapa e mostra a arte", () => {
    expect(views).toContain("linkedPost?: EditorialPostBundle | null");
    const pill = views.slice(
      views.indexOf("function TaskSchedulePill"),
      views.indexOf("function EmptyState"),
    );
    expect(pill).toContain("<EditorialFileThumbnail");
    expect(pill).toContain("corDaEtapa(etapa)");
    expect(pill).toContain("EDITORIAL_VISUAL_STAGE_LABELS");
  });

  it("as quatro posições de pílula recebem o conteúdo ligado", () => {
    const ligadas = views.match(/linkedPost=\{linkedPostByTaskId\.get\(task\.id\) \|\| null\}/g) || [];
    expect(ligadas.length).toBe(4);
  });

  it("quem está na grade não repete na lista de sem prazo", () => {
    expect(views).toContain("jaNaGrade?: Set<string>");
    expect(views).toContain("flattenBacklog(posts, naGrade)");
    expect(views).toContain("flattenBacklog(posts, naGradePorTarefa)");
  });
});

describe("o upload do card é o mesmo caminho do Arquivos", () => {
  it("grava pelo mesmo RPC, no mesmo bucket, com o padrão dominante", () => {
    // Atalho de verdade não cria segundo caminho: o registro nasce
    // indistinguível de um criado em Arquivos.
    expect(zona).toContain("createFileRecord");
    expect(zona).toContain('.from("files")');
    expect(zona).toContain('folder: "materiais"');
    expect(zona).toContain('"creative"');
  });

  it("o Arquivos aberto em outra aba vê o envio na hora", () => {
    for (const chave of ["all-files", "files", "workspace-client-files"]) {
      expect(zona).toContain(`queryKey: ["${chave}"]`);
    }
  });

  it("resposta perdida não vira erro falso nem arquivo órfão", () => {
    // O objeto pode ter subido mesmo com a resposta perdida; só é erro se ele
    // não estiver no storage.
    expect(zona).toContain("confirmStoredObject");
  });

  it("vários arquivos viram carrossel de imagens, como no Arquivos", () => {
    expect(zona).toContain('"carrossel"');
    expect(zona).toContain("parent_file_id");
    expect(zona).toMatch(/carrossel é só de imagens/);
  });

  it("o editor vincula o upload como arte do card na hora", () => {
    expect(editor).toContain("EditorialArtDropZone");
    const trecho = editor.slice(editor.indexOf("<EditorialArtDropZone"));
    expect(trecho).toContain("await refetchOptions()");
    expect(trecho).toContain("setPrimaryFileId(rootFileId)");
    expect(trecho).toContain("markChanged()");
  });

  it("conteúdo travado não aceita upload", () => {
    expect(editor).toMatch(/disabled=\{savedContentLocked\}/);
  });
});
