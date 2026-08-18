import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

const ciclo = ler("src/pages/AdminCiclo.tsx");
const folha = ler("src/components/ciclo/ClientCycleSheet.tsx");
const hook = ler("src/hooks/useClientGroupMessage.ts");
const central = ler("src/pages/AdminExperience.tsx");

/**
 * Dois buracos que o Ciclo tinha: seis clientes avulsos ativos simplesmente
 * não existiam na tela, e a mensagem do grupo só podia ser copiada na Central
 * — longe de quem acabou de marcar a semana e quer mandar o recado.
 */

describe("clientes avulsos ganharam aba própria", () => {
  it("a barra de baixo tem a terceira aba", () => {
    expect(ciclo).toContain("<AvulsosTab />");
    expect(ciclo).toContain("setAvulsosAbertos(true)");
  });

  it("a lista troca de recorte conforme a aba", () => {
    // Sem isso, avulso continuava invisível na tela inteira.
    expect(ciclo).toContain("if (!ehAvulso(client)) return false;");
    expect(ciclo).toContain("return !ehAvulso(client) && inCycle(client, area, hasService);");
    // E, dentro da aba, o recorte é o serviço: avulso não tem frente semanal,
    // tem o serviço que contratou.
    expect(ciclo).toContain("servicosDoCliente(client).includes(servicoAvulso)");
  });

  it("voltar para uma frente sai da aba de avulsos", () => {
    expect(ciclo).toContain("setArea(target); setAvulsosAbertos(false);");
  });

  it("avulso não é oferecido para entrar numa frente semanal", () => {
    // Ele tem entrega com começo e fim, não rotina que se repete: convidar a
    // colocá-lo numa frente semanal seria empurrar a régua errada.
    expect(ciclo).toMatch(/clientesDeFora[\s\S]{0,420}!ehAvulso\(client\)/);
    expect(ciclo).toContain("{!avulsosAbertos && clientesDeFora.length > 0 && (");
  });

  it("o cabeçalho e o vazio dizem em qual recorte a pessoa está", () => {
    expect(ciclo).toContain('avulsosAbertos ? "Clientes avulsos" : cycle.label');
    // O vazio precisa dizer QUAL filtro está escondendo os clientes, senão
    // parece que não há avulso nenhum quando é só o serviço escolhido.
    expect(ciclo).toContain('"Nenhum cliente avulso ativo"');
    expect(ciclo).toContain("Nenhum avulso de ");
  });

  it("a contagem da aba não depende de ela estar aberta", () => {
    // O número precisa aparecer para chamar atenção de que há gente ali.
    expect(ciclo).toContain("const totalAvulsos = useMemo(");
    expect(ciclo).toMatch(/totalAvulsos > 0 \? totalAvulsos : ""/);
  });
});

describe("a mensagem do grupo agora nasce também no Ciclo", () => {
  it("a folha do cliente oferece os três momentos", () => {
    expect(folha).toContain("Mensagem do grupo");
    for (const momento of ["abertura", "meio", "fechamento"]) {
      expect(folha).toContain(`momento: "${momento}" as const`);
    }
  });

  it("usa a MESMA biblioteca da Central, não uma cópia", () => {
    // Texto duplicado nas duas telas divergiria na primeira correção que
    // alguém fizesse num lado só.
    expect(hook).toContain('from "@/lib/groupMessage"');
    expect(hook).toContain("buildGroupMessageText");
    expect(central).toContain("buildGroupMessageText");
  });

  it("monta com os fatos daquele cliente, incluindo ciclo e avulsos", () => {
    expect(hook).toContain("cicloFeito");
    expect(hook).toContain("avulsosFeitos");
    expect(hook).toContain("stepLabelsForWeek");
  });

  it("lê a memória para o contexto vivo, como a Central faz", () => {
    expect(hook).toContain('from("project_memory")');
    expect(hook).toContain("contextoRecente");
  });

  it("puxa campanhas só quando existem de verdade", () => {
    expect(hook).toContain("if (dias.length > 0 || campanhasNoAr > 0)");
  });

  it("avisa em vez de copiar vazio enquanto os dados chegam", () => {
    expect(folha).toMatch(/if \(!texto\)[\s\S]{0,140}toast\.error/);
  });
});
