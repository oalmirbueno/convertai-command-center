import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  adminTourSteps, clientTourSteps, teamTourSteps,
} from "@/components/onboarding/tourConfigs";

/**
 * O tour aponta para elementos por data-tour. Quando uma tela é reescrita e a
 * âncora some, o passo vira um destaque no vazio: o usuário recebe uma
 * explicação apontando para lugar nenhum. Este teste liga as duas pontas.
 */

function todosOsArquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return todosOsArquivos(caminho);
    return /\.(tsx|ts)$/.test(nome) ? [caminho] : [];
  });
}

const fonte = todosOsArquivos(resolve(process.cwd(), "src"))
  .filter((caminho) => !caminho.includes(`${"src"}\\test`) && !caminho.includes("src/test"))
  .map((caminho) => readFileSync(caminho, "utf8"))
  .join("\n");

const ancorasExistentes = new Set(
  [...fonte.matchAll(/data-tour=["'{]+([a-z0-9-]+)["'}]+/gi)].map((m) => m[1]),
);

const alvosDe = (passos: Array<{ target: string }>) =>
  passos
    .map((passo) => passo.target.match(/data-tour='([^']+)'/)?.[1])
    .filter((alvo): alvo is string => !!alvo);

describe("âncoras do tour existem nas telas", () => {
  it("tour do admin não aponta para o vazio", () => {
    const faltando = alvosDe(adminTourSteps).filter((alvo) => !ancorasExistentes.has(alvo));
    expect(faltando).toEqual([]);
  });

  it("tour do cliente não aponta para o vazio", () => {
    const faltando = alvosDe(clientTourSteps).filter((alvo) => !ancorasExistentes.has(alvo));
    expect(faltando).toEqual([]);
  });

  it("tour da equipe não aponta para o vazio", () => {
    const faltando = alvosDe(teamTourSteps).filter((alvo) => !ancorasExistentes.has(alvo));
    expect(faltando).toEqual([]);
  });
});

describe("o tour explica o que o painel virou", () => {
  const textoAdmin = adminTourSteps.map((p) => `${p.title} ${p.description}`).join(" ");
  const textoCliente = clientTourSteps.map((p) => `${p.title} ${p.description}`).join(" ");

  it("apresenta o método da casa, não só as telas", () => {
    expect(textoAdmin).toContain("A.C.E.L.E.R.A");
    for (const fase of ["Analisar", "Clarear", "Estruturar", "Lançar", "Executar", "Revisar", "Acelerar"]) {
      expect(textoAdmin).toContain(fase);
    }
  });

  it("cobre a Central e o Ciclo", () => {
    expect(textoAdmin).toMatch(/Central de Experiência/);
    expect(textoAdmin).toMatch(/Ciclo da Semana/);
    // O Ciclo é aplicativo separado: quem faz o tour precisa saber instalar.
    expect(textoAdmin).toMatch(/tela inicial/i);
  });

  it("é honesto sobre o que a IA faz e não faz", () => {
    expect(textoAdmin).toMatch(/nunca inventa/i);
    expect(textoAdmin).toMatch(/revisa antes de publicar/i);
  });

  it("mostra ao cliente os bastidores e a história", () => {
    expect(textoCliente).toMatch(/bastidor/i);
    expect(textoCliente).toMatch(/história/i);
  });
});
