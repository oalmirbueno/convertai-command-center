import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LeituraEmBlocos from "@/components/execucao/LeituraEmBlocos";

/**
 * 19/10/2026 (dono, com o print de "Execuções externas": "quando vem assim fica muito confuso,
 * deixe mais intuitivo e simplificado, melhor para entender; no diário também"). O texto do
 * agente em FEITO / TRAVADO / PRÓXIMO PASSO vira blocos coloridos, o travado primeiro.
 */

const DO_GESTOR = `Verzelo: subir conjunto contínuo de R$ 12 por dia, sem data de fim (tarefa ACE-93)

FEITO:
- Assumi a tarefa da Verzelo.
- Tentei 3 vezes entrar na Meta pela minha conexão. As 3 foram recusadas.

TRAVADO:
- Só o Almir resolve: reautorizar a conexão Meta Ads do Gestor (Composio).

PRÓXIMO PASSO:
- Com o acesso de volta, subo o conjunto de R$ 12 por dia.`;

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

describe("texto do agente em blocos", () => {
  it("cada bloco vira uma caixa com título; o travado vem primeiro e os itens viram lista", () => {
    render(<LeituraEmBlocos texto={DO_GESTOR} />);
    const blocos = screen.getAllByRole("region");
    expect(blocos.map((b) => b.getAttribute("aria-label"))).toEqual(["Travado", "Próximo passo", "Feito"]);
    expect(blocos[0].getAttribute("data-tom")).toBe("travado");
    expect(within(blocos[2]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(blocos[0]).getByText(/reautorizar a conexão Meta Ads/)).toBeTruthy();
    // A frase de abertura fica em cima, como título do que é.
    expect(screen.getByText(/subir conjunto contínuo de R\$ 12 por dia/)).toBeTruthy();
  });

  it("texto sem blocos fica um parágrafo só", () => {
    render(<LeituraEmBlocos texto="Relatório da semana pronto e anexado." />);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.getByText("Relatório da semana pronto e anexado.")).toBeTruthy();
  });

  it("Execuções externas e o diário usam os blocos (e guardam o texto original)", () => {
    const execucoes = ler("src/components/execucao/ExecucoesRecentes.tsx");
    expect(execucoes).toContain("<LeituraEmBlocos texto={d.summary}");
    const diario = ler("src/components/execucao/DiarioDaExecucao.tsx");
    expect(diario).toContain("<LeituraEmBlocos texto={e.body}");
    expect(diario).toContain("Ver o registro técnico");
  });
});

describe("aprovar não fica rodando", () => {
  it("conflito de dado não usa o código que o PostgREST repete sem parar (40001)", () => {
    const sql = ler("supabase/migrations/20261019180129_sem_laco_de_40001.sql");
    expect(sql).toContain("'ERRCODE\\s*=\\s*''40001'''");
    expect(sql).toContain("'central_review_decide'");
  });

  it("a decisão do dono vale com a fonte mudada e fica registrada; a tela avisa", () => {
    const sql = ler("supabase/migrations/20261019180336_decisao_do_dono_com_fonte_antiga.sql");
    expect(sql).not.toContain("RAISE EXCEPTION 'CENTRAL_SOURCE_STALE'");
    expect(sql).toContain("'fonte_antiga',fonte_antiga");
    expect(sql).not.toMatch(/ERRCODE\s*=\s*'40001'/);
    expect(ler("src/components/execucao/AprovacoesExplicadas.tsx")).toContain("fonte_antiga");
  });
});
