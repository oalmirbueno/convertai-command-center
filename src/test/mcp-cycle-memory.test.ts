import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * O MCP é como os agentes de fora (ChatGPT, Codex, o segundo cérebro) enxergam
 * o painel. Quando o painel passou a gravar história do cliente e ciclo
 * semanal, o MCP precisava enxergar as duas coisas: um agente que lê memória
 * com os tipos antigos acha que o cliente não tem história nenhuma.
 */
const raiz = process.cwd();
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"),
  "utf8",
);
const servicosMemoria = readFileSync(
  resolve(raiz, "supabase/functions/_shared/project-memory-services.ts"),
  "utf8",
);
const servicosLeitura = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-read-services.ts"),
  "utf8",
);

describe("MCP enxerga a história e o ciclo do painel", () => {
  it("aceita os tipos de memória que o painel grava", () => {
    // Sem estes tipos, filtrar por ritual/ciclo pelo MCP dá erro de validação.
    for (const tipo of ["ritual", "ciclo", "entrega", "aprovacao", "decisao", "nota", "marco"]) {
      expect(servicosMemoria).toContain(`'${tipo}'`);
      expect(ferramentas).toContain(`'${tipo}'`);
    }
  });

  it("mantém os tipos antigos, usados por agentes externos", () => {
    for (const tipo of ["note", "summary", "decision", "fact", "second_brain", "external"]) {
      expect(servicosMemoria).toContain(`'${tipo}'`);
    }
  });

  it("expõe o ciclo semanal como ferramenta de leitura", () => {
    expect(ferramentas).toContain("aceleriq_get_weekly_cycle");
    expect(ferramentas).toContain("getWeeklyCycleTool,");
    // Leitura é read-only e passa pelo escopo de projetos.
    expect(ferramentas).toContain("scopes: ['projects:read'] as const");
  });

  it("lê o ciclo pela camada de serviços, não com cliente solto na ferramenta", () => {
    expect(servicosLeitura).toContain("export async function listWeeklyCycle");
    expect(ferramentas).toContain("listWeeklyCycle(parsed.data)");
    // A ferramenta não pode montar conexão própria: o padrão do projeto é o
    // serviço, que aplica limite de linhas e validações.
    const trecho = ferramentas.slice(
      ferramentas.indexOf("aceleriq_get_weekly_cycle"),
      ferramentas.indexOf("// ─── Project Memory"),
    );
    expect(trecho).not.toContain("createClient(");
  });

  it("agrupa o ciclo por semana com contagem e fechamento", () => {
    expect(servicosLeitura).toContain("done_count");
    expect(servicosLeitura).toContain("closed:");
    // As etapas de onboarding (7 a 10) não podem inflar o total de 6.
    expect(servicosLeitura).toContain("onboarding_steps");
  });

  it("anuncia uma versão de servidor válida, para os clientes recarregarem o catálogo", () => {
    // Sem pinar o número: pinado, o teste quebra a cada atualização legítima
    // sem que exista defeito nenhum. O alinhamento entre as duas pontas é
    // verificado no contrato do MCP legado.
    expect(ferramentas).toMatch(/version: '\d+\.\d+\.\d+'/);
  });
});
