import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const sheet = ler("src/components/editorial/EditorialDetailSheet.tsx");
const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
const migration = ler("supabase/migrations/20260820220000_carrossel_liberado_agendavel.sql");

/**
 * "Não estou conseguindo agendar de nenhuma forma."
 *
 * Medido na base: liberar o material ao cliente movia os SLIDES do carrossel
 * para client_shared, e a regra dos filhos só aceitava 'approval' — a raiz
 * aceita os dois estados finais. O ato de liberar tirava o carrossel da
 * agenda. 98 slides estavam nesse estado na base inteira.
 */

describe("liberar não pode tirar da agenda", () => {
  it("o patch alinha os filhos à regra da raiz", () => {
    expect(migration).toContain("NOT IN (''approval'', ''client_shared'')");
    // e falha alto se o texto da função for outro
    expect(migration).toContain("alvo nao encontrado exatamente 1 vez");
  });

  it("o resto da régua dos filhos permanece", () => {
    // Só a visibilidade mudou: travado, agência e imagem continuam exigidos.
    expect(migration).not.toContain("locked_at");
    expect(migration).not.toContain("agency_approval_status");
  });
});

describe("post existente nunca vira duplicata", () => {
  it("o índice cobre todo post vivo, não só os estritos", () => {
    // Post fora da régua estrita fazia o save CRIAR outro com o mesmo
    // arquivo, e o banco recusava com "already linked to another content".
    expect(dialogo).toContain("TODO post vivo entra no índice");
    expect(dialogo).toMatch(/for \(const bundle of schedulablePosts\)/);
  });
});

describe("remarcar agendada é simples e no mesmo card", () => {
  it("trocar a conta usa o save aprovado, que edita agendada inteira", () => {
    expect(sheet).toContain("contaMudou");
    expect(sheet).toContain('active.publication.status === "scheduled"');
    const bloco = sheet.slice(sheet.indexOf("contaMudou"));
    expect(bloco).toContain("savePost.mutateAsync");
  });

  it("só a data usa a transição oficial, sem mexer no plano", () => {
    const bloco = sheet.slice(sheet.indexOf("contaMudou"));
    expect(bloco).toContain('action: "schedule"');
  });

  it("o formulário começa do estado real, não vazio", () => {
    // Campos vazios num card agendado davam a impressão de agendar do zero.
    expect(sheet).toContain("agendadaAtual");
    expect(sheet).toContain("isoUtcToZonedDateTimeLocal(");
    expect(sheet).toContain("setInlineAccountId(agendadaAtual.publication.external_account_id");
  });

  it("os rótulos dizem remarcar quando já há agendada", () => {
    expect(sheet).toContain('"Remarcar publicação" : "Programar publicação"');
    expect(sheet).toContain('"Remarcar" : "Programar"');
    expect(sheet).toContain("sem duplicar");
  });
});
