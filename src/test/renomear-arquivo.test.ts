import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260819210000_renomear_arquivo.sql");
const tela = ler("src/pages/AdminFiles.tsx");
const zona = ler("src/components/editorial/EditorialArtDropZone.tsx");

/**
 * Renomear era bloqueado pela mesma régua de editar conteúdo
 * (file_is_editable): interno, sem aprovação, sem revisão. Todo arquivo já
 * compartilhado ficava preso ao nome com que subiu — em geral o do celular —
 * e a lista de Arquivos parecia genérica sem jeito de arrumar.
 */

describe("renomear tem régua própria, e não afrouxa a de conteúdo", () => {
  it("é função separada, não mudança em file_is_editable", () => {
    // Afrouxar file_is_editable liberaria junto visibilidade, aprovação e
    // substituição de material.
    expect(migration).toContain("create or replace function public.rename_file");
    expect(migration).not.toMatch(/create or replace function public\.file_is_editable/);
  });

  it("exige os mesmos papéis e o mesmo acesso ao cliente de can_write_file", () => {
    for (const papel of ["admin", "manager", "design", "traffic"]) {
      expect(migration).toContain(`'${papel}'::public.app_role`);
    }
    expect(migration).toContain("public.can_access_client(_row.client_id)");
  });

  it("peça travada continua imutável, inclusive no nome", () => {
    expect(migration).toContain("_row.locked_at is not null");
  });

  it("só toca no nome — nada de conteúdo, versão ou aprovação", () => {
    const update = migration.slice(migration.indexOf("update public.files"));
    expect(update).toContain("set file_name = _limpo");
    for (const coluna of ["storage_path", "approval_status", "visibility", "version"]) {
      expect(update).not.toContain(coluna);
    }
  });

  it("recusa nome vazio e nome absurdo", () => {
    expect(migration).toContain("_limpo = '' or length(_limpo) > 200");
  });

  it("anon não executa", () => {
    expect(migration).toContain("revoke execute on function public.rename_file(uuid, text) from anon");
    expect(migration).toContain("grant execute on function public.rename_file(uuid, text) to authenticated");
  });
});

describe("a tela usa a função e não o update direto", () => {
  it("chama rename_file", () => {
    // O update direto falharia justamente nos arquivos que mais precisam de
    // um nome decente.
    expect(tela).toContain('rpc("rename_file"');
  });

  it("o lápis aparece para qualquer arquivo não travado", () => {
    expect(tela).toContain("{!previewFile?.locked_at && (");
  });
});

describe("o nome pode ser escolhido já no envio", () => {
  it("a zona de upload tem campo de nome", () => {
    // Sem isto o registro nasce com o nome do arquivo do celular, que é a
    // origem dos nomes genéricos.
    expect(zona).toContain("Nome da peça");
    expect(zona).toContain("nomeDaPeca(nome, files, i, isCarousel)");
  });

  it("no carrossel o nome numera as imagens seguintes", () => {
    expect(zona).toMatch(/\$\{base\} \(\$\{indice \+ 1\}\/\$\{files\.length\}\)/);
  });
});

describe("arrastar diz a intenção, em vez de adivinhar", () => {
  it("cada alvo declara o que significa soltar ali", () => {
    // Antes o arrasto deduzia pela quantidade: duas artes separadas viravam
    // carrossel, e um arquivo pretendendo carrossel virava arte única.
    expect(zona).toContain("const alvoDeArrasto = (intencao: Intencao)");
    expect(zona).toContain('void enviar(e.dataTransfer.files, intencao)');
  });

  it("o alvo sob o cursor se anuncia", () => {
    expect(zona).toContain("Soltar como arte");
    expect(zona).toContain("Soltar como carrossel");
  });
});
