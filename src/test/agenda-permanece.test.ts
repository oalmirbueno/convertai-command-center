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

describe("o conteúdo permanece no dia, e quem decide é o post", () => {
  it("a decisão saiu da régua das tarefas", () => {
    // A primeira tentativa segurava a TAREFA na grade e falhou: dependia de
    // ela sobreviver a tipo publicável, escopo e prazo vencido há mais de 7
    // dias. Qualquer um desses cortes e o conteúdo seguia invisível.
    expect(pagina).toContain("ancorasPorDia({");
    expect(pagina).toContain("idsAncorados(ancoradosPorDia)");
  });

  it("a âncora recebe só os posts que a tela já decidiu mostrar", () => {
    // Ancorar um post filtrado o traria de volta por cima do filtro escolhido.
    expect(pagina).toContain("posts: filteredPosts.map((bundle) => ({");
  });

  it("o conteúdo ancorado tem card próprio, com arte e cor da etapa", () => {
    const card = views.slice(
      views.indexOf("function AnchoredPostPill"),
      views.indexOf("function TaskSchedulePill"),
    );
    expect(card).toContain("<EditorialFileThumbnail");
    expect(card).toContain("corDaEtapa(etapa)");
    expect(card).toContain("EDITORIAL_VISUAL_STAGE_LABELS");
    expect(card).toContain("editorialVisualStage(post.post.production_status)");
  });

  it("as quatro células da grade desenham o ancorado", () => {
    // Mês (visível e dentro do "+N"), semana e mobile. Faltar uma deixaria o
    // conteúdo invisível justamente para quem usa o celular.
    expect((views.match(/<AnchoredPostPill/g) || []).length).toBe(4);
  });

  it("o ancorado entra na contagem do dia e no corte do +N", () => {
    expect(views).toContain("dayItems.length + dayTasks.length + dayAnchored.length");
    expect(views).toContain("hiddenAnchored");
  });

  it("quem está na grade não repete na lista de sem prazo", () => {
    expect(views).toContain("jaNaGrade?: Set<string>");
    expect(views).toContain("flattenBacklog(posts, idsNaGrade)");
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
