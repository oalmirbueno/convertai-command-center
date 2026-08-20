import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { editorialErrorMessage } from "@/lib/editorialErrorMessage";

/**
 * O dono agendou um conteúdo APROVADO e a tela disse "está em revisão".
 * Nada estava em revisão: vários erros do banco terminam em "create a
 * revision", e o padrão genérico no TOPO da lista capturava todos antes de
 * os específicos terem chance.
 */

describe("cada erro do banco vira a mensagem certa", () => {
  it("aprovado imutável não vira 'está em revisão'", () => {
    const msg = editorialErrorMessage(
      new Error("the approved editorial snapshot is immutable; create a revision"), "fallback",
    );
    expect(msg).not.toContain("está em revisão");
    expect(msg).toContain("registro de aprovação");
  });

  it("copy imutável idem", () => {
    const msg = editorialErrorMessage(
      new Error("approved editorial copy is immutable; create a revision"), "fallback",
    );
    expect(msg).not.toContain("está em revisão");
    expect(msg).toContain("Recarregue a página");
  });

  it("o genérico continua existindo como último recurso", () => {
    const msg = editorialErrorMessage(new Error("file is already under review"), "fallback");
    expect(msg).toContain("está em revisão");
  });

  it("os específicos vêm antes do genérico na lista", () => {
    const fonte = readFileSync(
      resolve(__dirname, "../..", "src/lib/editorialErrorMessage.ts"),
      "utf8",
    );
    expect(fonte.indexOf("approved editorial snapshot is immutable")).toBeLessThan(
      fonte.indexOf("already under review|create a revision"),
    );
  });
});
