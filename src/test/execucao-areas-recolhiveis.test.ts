import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alternarFechadas,
  areaComecaFechada,
  type AreaDaExecucao,
} from "@/lib/execucaoAreas";

/**
 * Recolher as áreas da Execução.
 *
 * Catorze agentes em nove áreas viravam uma tela que não acabava, e a
 * maior parte dela mostrando bloco vazio: na carteira de hoje só o
 * Registro tem tarefa. Rolar oito áreas paradas para chegar na que está
 * andando é o oposto de organizar.
 */

// O retrato real: só Operações tem trabalho.
const CARTEIRA: AreaDaExecucao[] = [
  { area: "Auditoria", tarefas: 0 },
  { area: "Clientes", tarefas: 0 },
  { area: "Comercial", tarefas: 0 },
  { area: "Core", tarefas: 0 },
  { area: "Dados", tarefas: 0 },
  { area: "Finanças", tarefas: 0 },
  { area: "Marketing", tarefas: 0 },
  { area: "Operações", tarefas: 1 },
  { area: "Tecnologia", tarefas: 0 },
];

const NADA = new Set<string>();

describe("o padrão encurta a tela sem esconder trabalho", () => {
  it("área sem tarefa nenhuma nasce recolhida", () => {
    for (const a of CARTEIRA.filter((x) => x.tarefas === 0)) {
      expect(areaComecaFechada(a.area, CARTEIRA, NADA, false), a.area).toBe(true);
    }
  });

  it("área com tarefa nasce aberta", () => {
    expect(areaComecaFechada("Operações", CARTEIRA, NADA, false)).toBe(false);
  });

  it("na carteira de hoje, 8 das 9 começam recolhidas", () => {
    const fechadas = CARTEIRA.filter((a) =>
      areaComecaFechada(a.area, CARTEIRA, NADA, false)).length;
    expect(fechadas).toBe(8);
  });

  it("área desconhecida fica ABERTA, nunca escondida", () => {
    // É mais fácil recolher o que apareceu do que descobrir que existia
    // algo escondido. Área nova do Hermes precisa aparecer.
    expect(areaComecaFechada("Área que acabou de nascer", CARTEIRA, NADA, false)).toBe(false);
  });
});

describe("depois do primeiro clique, manda a pessoa", () => {
  it("o padrão para de valer, inclusive para área vazia", () => {
    // O padrão serve à primeira visita, não para brigar com quem decidiu.
    expect(areaComecaFechada("Auditoria", CARTEIRA, NADA, true)).toBe(false);
  });

  it("o que ela fechou continua fechado, mesmo tendo tarefa", () => {
    expect(
      areaComecaFechada("Operações", CARTEIRA, new Set(["Operações"]), true),
    ).toBe(true);
  });
});

describe("alternar", () => {
  it("abre o que estava fechado e fecha o que estava aberto", () => {
    expect([...alternarFechadas(new Set(["A"]), "A")]).toEqual([]);
    expect([...alternarFechadas(NADA, "A")]).toEqual(["A"]);
  });

  it("recolher todas fecha tudo", () => {
    const r = alternarFechadas(NADA, "", ["A", "B", "C"]);
    expect([...r].sort()).toEqual(["A", "B", "C"]);
  });

  it("com tudo fechado, o mesmo botão ABRE tudo", () => {
    // Um botão que só fecha obrigaria a abrir nove áreas no clique a clique.
    const r = alternarFechadas(new Set(["A", "B", "C"]), "", ["A", "B", "C"]);
    expect([...r]).toEqual([]);
  });

  it("recolher todas não mexe em área fora da lista", () => {
    const r = alternarFechadas(new Set(["Z"]), "", ["A", "B"]);
    expect([...r].sort()).toEqual(["A", "B", "Z"]);
  });

  it("não altera o conjunto que recebeu", () => {
    // Estado de React não se muta no lugar: mutar faria o render não ver a
    // mudança e a seção não abriria ao clicar.
    const antes = new Set(["A"]);
    alternarFechadas(antes, "B");
    expect([...antes]).toEqual(["A"]);
  });
});

describe("recolhido nao ocupa o mesmo espaco que aberto", () => {
  const pagina = readFileSync(
    resolve(__dirname, "../pages/AdminExecucao.tsx"), "utf8",
  );

  it("area fechada e uma pastilha, nao uma barra de largura inteira", () => {
    // A primeira versao recolhia cada area numa <section> de largura
    // cheia: nove barras quase vazias empilhadas, ~540px de rolagem para
    // nao dizer nada. Medido depois da troca: 27px, tudo numa linha.
    expect(pagina).toContain("rounded-full border px-2.5 py-1 text-[11px] font-semibold");
    expect(pagina).toContain("AS AREAS COMO FAIXA");
  });

  it("so a area ABERTA vira bloco", () => {
    expect(pagina).toContain("agrupadosPorArea.filter(([area]) => !estaFechada(area)).map");
  });

  it("o ponto colorido so aparece onde HA movimento", () => {
    // Pintar todas faria a cor deixar de significar alguma coisa.
    expect(pagina).toContain("const temMovimento = emAndamento + feitas + bloqueadas > 0;");
    expect(pagina).toContain("{temMovimento && (");
  });

  it("bloqueio grita mais alto que andamento na pastilha", () => {
    expect(pagina).toContain(
      'bloqueadas > 0 ? "bg-destructive" : emAndamento > 0 ? "bg-info" : "bg-success"',
    );
  });

  it("Kanban vazio nao vira uma faixa de tres zeros", () => {
    // "0 tarefas abertas · 0 com operador · 0 ainda sem" dizia a mesma
    // coisa tres vezes e ocupava o mesmo espaco de algo para fazer.
    expect(pagina).toContain("numeros.kanbanAbertas === 0 ? (");
    expect(pagina).toContain("Nenhuma tarefa aberta no Kanban agora");
  });
});
