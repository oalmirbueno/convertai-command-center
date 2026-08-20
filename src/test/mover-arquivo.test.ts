import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260821150000_mover_arquivo.sql");
const tela = ler("src/pages/AdminFiles.tsx");
const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
const indexHtml = ler("index.html");

/**
 * Mover de pasta/projeto é organização, como renomear: subiu o arquivo, quis
 * colocá-lo no lugar certo e o painel recusava porque a política de escrita
 * exige arquivo intocado. A saída é a mesma família de rename_file — RPC
 * SECURITY DEFINER com a própria régua — com UMA diferença deliberada:
 * arquivo travado PODE ser movido (a gaveta não faz parte da identidade
 * aprovada), e para isso o guarda de files passou a tolerar escrita
 * confiável em travado no ramo de UPDATE.
 */

describe("guarda de files: travado tolera escrita confiável só no UPDATE", () => {
  it("o patch troca a checagem de travado por travado-e-não-confiável", () => {
    expect(migration).toContain(String.raw`IF COALESCE(_root_locked, false)\n`);
    expect(migration).toContain("AND NOT _trusted_approval_write THEN");
  });

  it("a âncora inclui o trecho exclusivo do ramo de UPDATE", () => {
    // "IF NOT _trusted_approval_write AND (" com _root_editable acima só
    // existe no UPDATE — o ramo de DELETE termina antes, então apagar
    // travado segue proibido para todos.
    expect(migration).toContain("IF NOT _trusted_approval_write AND (");
    expect(migration).toContain("_root_editable :=");
  });

  it("a substituição é contada — texto divergente faz a migration falhar alto", () => {
    expect(migration).toContain("<> 1 THEN");
    expect(migration).toContain("alvo nao encontrado exatamente 1 vez");
  });
});

describe("move_file tem a régua da família rename_file", () => {
  it("é função separada, não afrouxamento de política", () => {
    expect(migration).toContain("create or replace function public.move_file");
    expect(migration).not.toMatch(/create or replace function public\.file_is_editable/);
  });

  it("mesmos papéis e mesmo acesso ao cliente", () => {
    for (const papel of ["admin", "manager", "design", "traffic"]) {
      expect(migration).toContain(`'${papel}'::public.app_role`);
    }
    expect(migration).toContain("public.can_access_client(_row.client_id)");
  });

  it("raiz apenas; os slides acompanham pelo parent_file_id", () => {
    expect(migration).toContain("_row.parent_file_id is not null");
    expect(migration).toContain("or parent_file_id = _file_id");
  });

  it("projeto de destino tem de ser do mesmo cliente e vivo", () => {
    expect(migration).toContain("p.client_id = _row.client_id");
    expect(migration).toContain("p.deleted_at is null");
  });

  it("arte de conteúdo editorial não muda de projeto por fora", () => {
    // O conteúdo aponta para o arquivo E para o projeto; o desencontro
    // quebraria cada salvar dali em diante, longe da causa.
    expect(migration).toContain("ep.primary_file_id = _row.id");
    expect(migration).toContain("pub.file_id = _row.id");
    expect(migration).toContain("mova pelo proprio conteudo");
  });

  it("null preserva — coalesce nos dois campos, sem jeito de limpar projeto", () => {
    expect(migration).toContain("coalesce(_folder, folder)");
    expect(migration).toContain("coalesce(_project_id, project_id)");
  });

  it("diferente do renomear, NÃO bloqueia travado — a diferença é documentada", () => {
    // O travamento protege a identidade da peça; a gaveta não faz parte dela.
    expect(migration).not.toContain("_row.locked_at is not null");
    expect(migration).toContain("Diferença deliberada em relação a rename_file");
  });

  it("anon não executa", () => {
    expect(migration).toContain(
      "revoke execute on function public.move_file(uuid, text, uuid) from anon",
    );
    expect(migration).toContain(
      "grant execute on function public.move_file(uuid, text, uuid) to authenticated",
    );
  });
});

describe("a tela usa a função, sem trava de editabilidade", () => {
  it("mover de pasta chama move_file", () => {
    expect(tela).toContain('rpc("move_file"');
  });

  it("o retorno é linha única, não array", () => {
    // .single()-like: a RPC returns public.files — data é objeto, não lista.
    const trecho = tela.slice(tela.indexOf('rpc("move_file"'));
    expect(trecho).not.toContain("data?.length");
  });

  it("o modal oferece projeto filtrado pelo cliente do arquivo", () => {
    expect(tela).toContain("pj.client_id === previewFile.client_id");
  });

  it('não existe opção "Sem projeto" — coalesce não limpa', () => {
    // Oferecer limpar seria mentir: a RPC preserva com null.
    const modal = tela.slice(tela.indexOf("pj.client_id === previewFile.client_id"));
    expect(modal.slice(0, 2000)).not.toContain("Sem projeto");
  });
});

describe("selo honesto no diálogo de agendar", () => {
  it("conteúdo não aprovado ganha o aviso 'entra na agenda, publica após aprovação'", () => {
    expect(dialogo).toContain("isFilePublishable(selectedAsset.root as never)");
    expect(dialogo).toContain("Entra na agenda · publica após aprovação");
  });
});

describe("CSP cobre exatamente os dois scripts inline", () => {
  it("a meta existe e libera os dois por hash", () => {
    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
    // Hash 1: o truque do manifest /ciclo. Hash 2: a tela de carregamento.
    // Se qualquer um dos scripts mudar, o build quebra este teste? Não — o
    // teste seguinte confere o conteúdo real contra o hash declarado.
    expect(indexHtml).toContain("'sha256-FZoK0LH5u342WeKcUReCZliwHoSlyRewd8+FMkrbIi0='");
    expect(indexHtml).toContain("'sha256-tlCwAKfqEy7+wdGMuN73mbzCuFfzYWn1s4ekekOifP0='");
  });

  it("os hashes batem com o conteúdo real dos scripts inline", async () => {
    // A CSP por hash é frágil por natureza: mudar UMA vírgula num script
    // inline sem recalcular o hash derruba o PWA do /ciclo ou a tela de
    // carregamento em produção, silenciosamente. Este teste transforma o
    // esquecimento em vermelho no CI.
    const { createHash } = await import("node:crypto");
    const inlines = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) =>
      m[1].replace(/\r\n/g, "\n"),
    );
    expect(inlines.length).toBe(2);
    for (const corpo of inlines) {
      const hash = createHash("sha256").update(corpo).digest("base64");
      expect(indexHtml).toContain(`'sha256-${hash}'`);
    }
  });

  it("supabase liberado em connect (https e wss), o resto fechado", () => {
    expect(indexHtml).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    expect(indexHtml).toContain("object-src 'none'");
    expect(indexHtml).toContain("base-uri 'self'");
  });
});
