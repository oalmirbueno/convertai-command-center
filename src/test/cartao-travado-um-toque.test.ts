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
    expect(pagina).toMatch(/rotulo: "Concluir"[^\n]*aoClicar: \(\) => decidirVinculo\(\{ id: v\.id \} as ItemDaMesa, "aprovado"/);
    expect(pagina).toMatch(/rotulo: "Encerrar"[^\n]*aoClicar: \(\) => encerrarVinculo\(v\)/);
  });

  /* 19/10 (dono: "tem coisas ficando rodando, rodando, não aprova"): os botões rodavam fora da
     mesa (void, sem esperar) e o cartão ficava na tela até a próxima leitura. Agora devolvem a
     promessa para a mesa: mostra que está salvando e o cartão sai na hora. */
  it("as ações que resolvem rodam pela mesa (devolvem true/false), nunca soltas", () => {
    expect(pagina).toMatch(/rotulo: "Pode seguir"[^\n]*aoClicar: \(\) => podeSeguir\(v\)/);
    expect(pagina).toMatch(/rotulo: "Aprovar e seguir"[^\n]*aoClicar: \(\) => aprovarESeguir\(v\)/);
    expect(pagina).toMatch(/rotulo: "Retomar"[^\n]*aoClicar: \(\) => retomarVinculo\(v\)/);
    expect(pagina).not.toMatch(/void (podeSeguir|encerrarVinculo|aprovarESeguir|retomarVinculo)\(v\)/);
    for (const nome of ["podeSeguir", "encerrarVinculo", "aprovarESeguir", "retomarVinculo"]) {
      expect(pagina).toContain(`const ${nome} = async (v: Vinculo): Promise<boolean> =>`);
    }
  });

  it("a Execução tem tela cheia (só o trabalho na tela, Esc volta)", () => {
    expect(pagina).toContain("const telaCheia = useTelaCheiaDaMesa();");
    expect(pagina).toContain("classeDaRaiz(telaCheia.cheia)");
    expect(pagina).toContain("<BotaoDeTelaCheia tela={telaCheia}");
  });
});
