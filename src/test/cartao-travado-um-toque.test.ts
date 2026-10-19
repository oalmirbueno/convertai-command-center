import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 19/10/2026 (dono, sobre o cartão travado: "esse responder e destravar está complexo demais, nem
 * sei o que responder, não está claro, e não tem aprovar ali"). O cartão travado decide com um
 * toque: Pode seguir (o agente segue com o melhor julgamento e o revisor confere), Concluir ou
 * Encerrar. Responder continua, para quando ele quiser escrever.
 */

const pagina = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExecucao.tsx"), "utf8");

describe("cartão travado: decide com um toque", () => {
  it("o botão principal do travado é Pode seguir", () => {
    expect(pagina).toContain('rotulo: "Pode seguir"');
    expect(pagina).not.toContain("Responder e destravar");
  });

  it("Pode seguir manda o agente seguir com o melhor julgamento e o revisor conferir", () => {
    const seguir = pagina.slice(pagina.indexOf("const podeSeguir = async"), pagina.indexOf("const podeSeguir = async") + 1600);
    expect(seguir).toContain('_new_status: "queued"');
    expect(seguir).toContain("melhor julgamento");
    expect(seguir).toContain("revisor");
  });

  it("Concluir e Encerrar fecham pela mão humana, com o porquê no diário", () => {
    expect(pagina).toContain("const encerrarVinculo = async");
    const encerrar = pagina.slice(pagina.indexOf("const encerrarVinculo = async"), pagina.indexOf("const encerrarVinculo = async") + 1200);
    expect(encerrar).toContain('rpc("operator_human_action"');
    expect(encerrar).toContain('_new_status: "done"');
    expect(encerrar).toContain("Encerrada: não continuar.");
    expect(pagina).toMatch(/travada && [^\n]*decidirVinculo\([^\n]*"aprovado"/);
    expect(pagina).toMatch(/travada && [^\n]*encerrarVinculo\(v\)/);
  });
});
