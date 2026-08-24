import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const memoria = ler("supabase/functions/_shared/project-memory-services.ts");
const leitura = ler("supabase/functions/_shared/aceleriq-read-services.ts");
const migration = ler("supabase/migrations/20260824160000_auditoria_referencias_orfas.sql");
const criacao = ler("supabase/migrations/20260714135001_ddee07bf-a344-4fb0-8998-c642a8c4d36e.sql");

/**
 * O relato: gravar o start da semana da Verzelo "salvou o histórico" mas o
 * dossiê recusou com "client_id inexistente". A leitura do agente concluiu
 * que o defeito era do dossiê — e era o contrário.
 *
 * `project_memory` tem `client_id uuid NOT NULL` e NENHUMA chave
 * estrangeira: qualquer uuid passava e virava registro órfão. O agente
 * recebia "gravado com sucesso" e o dado não aparecia em lugar nenhum do
 * painel. O dossiê, que valida, recusou corretamente.
 *
 * E a auditoria não pegou porque procurava `client_id IS NULL` numa coluna
 * NOT NULL: uma verificação MORTA, que passava sempre. Foi por ela que o
 * relatório disse "0 problemas" enquanto o órfão existia.
 */

describe("a tabela que deixou o órfão entrar", () => {
  it("project_memory tem client_id NOT NULL e nenhuma chave estrangeira", () => {
    // Documenta a condição que causou tudo. Se um dia ganhar FK, este
    // teste falha e a validação da escrita pode ser revista.
    expect(criacao).toContain("client_id uuid NOT NULL");
    const bloco = criacao.slice(
      criacao.indexOf("CREATE TABLE IF NOT EXISTS public.project_memory"),
      criacao.indexOf(");", criacao.indexOf("CREATE TABLE IF NOT EXISTS public.project_memory")),
    );
    expect(bloco).not.toContain("REFERENCES");
  });
});

describe("a escrita de memória fecha a porta", () => {
  it("valida que o cliente existe antes de inserir", () => {
    const trecho = memoria.slice(
      memoria.indexOf("export async function upsertMemory"),
      memoria.indexOf("memoryToPromptBlock"),
    );
    expect(trecho).toContain("from('profiles')");
    expect(trecho).toContain("nao corresponde a nenhum cliente ativo");
    // A checagem vem ANTES do insert, senão o órfão já entrou.
    expect(trecho.indexOf("from('profiles')")).toBeLessThan(
      trecho.indexOf("from('project_memory').insert"),
    );
  });

  it("o erro ensina o caminho, em vez de só recusar", () => {
    // Quem recebe é um agente: dizer onde achar o id certo evita a
    // segunda tentativa igual.
    expect(memoria).toContain("aceleriq_list_clients");
  });

  it("recusa também cliente removido, não só inexistente", () => {
    expect(memoria).toContain("deleted_at");
  });
});

describe("a auditoria enxerga o que antes era invisível", () => {
  it("a verificação morta da memória saiu", () => {
    // `client_id IS NULL` numa coluna NOT NULL nunca acha nada. A de
    // project_memory era assim e foi trocada pela busca de órfão de
    // verdade. (As de files/reports seguem, e ali a coluna admite nulo
    // em pelo menos uma das duas.)
    const memoriaNoAudit = leitura.slice(
      leitura.indexOf("export async function auditIntegrity"),
    );
    expect(memoriaNoAudit).not.toMatch(/from\('project_memory'\)[\s\S]{0,200}is\('client_id', null\)/);
    expect(memoriaNoAudit).toContain("rpc('audit_referencias_orfas')");
  });

  it("procura id preenchido apontando para ninguém, em três tabelas", () => {
    for (const tabela of ["project_memory", "client_dossiers", "projects"]) {
      expect(migration).toContain(`'${tabela}'::text`);
    }
    expect(migration).toContain("not exists (");
    expect(migration).toContain("from public.profiles p where p.id = m.client_id");
  });

  it("o relatório diz em qual tabela está, não só quantas", () => {
    expect(leitura).toContain("referencia_orfa_${tabela}");
    expect(leitura).toContain("'alta'");
  });

  it("a migration não cria FK retroativa de propósito", () => {
    // Dados antigos fariam a FK falhar no meio da migration. A porta foi
    // fechada na escrita; o passado aparece no relatório para decisão
    // humana.
    expect(migration).not.toContain("add constraint");
    expect(migration).not.toContain("references public.profiles");
    expect(migration).toContain("Nao cria chave estrangeira em project_memory de proposito");
  });

  it("é leitura pura, como o resto da auditoria", () => {
    expect(migration).toContain("language sql");
    expect(migration).not.toContain("insert into");
    expect(migration).not.toContain("delete from");
  });
});
