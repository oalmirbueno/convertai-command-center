import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { falarComoGente } from "@/lib/falarComoGente";

/**
 * "Está muito técnico, não dá pra entender nada, só fala parece por código."
 *
 * O painel mostrava log de máquina numa tela de gente: identificador de
 * 36 caracteres, nome de ferramenta interna e coluna de banco crua.
 */

describe("o texto real que estava na tela", () => {
  const REAL = "Evidência verificável: tarefa 9623ab68-cf83-4e1c-af44-edbb62533121 "
    + "foi lida via aceleriq_fetch (status backlog, prioridade high, prazo 2026-07-20, "
    + "assigned_to null).";

  it("some com o identificador de máquina", () => {
    const { humano } = falarComoGente(REAL);
    expect(humano).not.toContain("9623ab68");
    expect(humano).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("some com o nome da ferramenta interna", () => {
    // "lida via aceleriq_fetch" vira "lida": o nome da ferramenta é
    // vocabulário interno e não muda o que aconteceu.
    const { humano } = falarComoGente(REAL);
    expect(humano).not.toContain("aceleriq_fetch");
    expect(humano).not.toContain("via");
  });

  it("traduz coluna de banco para frase", () => {
    const { humano } = falarComoGente(REAL);
    expect(humano).toContain("sem responsável");
    expect(humano).toContain("ainda na fila");
    expect(humano).toContain("prioridade alta");
    expect(humano).not.toContain("assigned_to");
  });

  it("corta o prefixo cerimonial", () => {
    expect(falarComoGente(REAL).humano).not.toMatch(/^Evid[êe]ncia verific/i);
  });

  it("continua sendo uma frase, sem buraco nem pontuação solta", () => {
    const { humano } = falarComoGente(REAL);
    expect(humano).not.toMatch(/\s,|\(\s|,\s*\)/);
    expect(humano).not.toMatch(/\s{2,}/);
    expect(humano[0]).toBe(humano[0].toUpperCase());
  });

  it("marca que há detalhe técnico guardado", () => {
    expect(falarComoGente(REAL).temDetalheTecnico).toBe(true);
  });
});

describe("o original nunca se perde", () => {
  it("guarda o texto palavra por palavra", () => {
    // Apagar evidência para deixar a tela bonita seria trocar um problema
    // por outro pior: a evidência é o que sustenta a entrega.
    const bruto = "tarefa 9623ab68-cf83-4e1c-af44-edbb62533121 lida";
    expect(falarComoGente(bruto).original).toBe(bruto);
  });

  it("link é evidência forte e não se toca", () => {
    const url = "https://drive.google.com/file/d/abc123/view";
    const r = falarComoGente(url);
    expect(r.humano).toBe(url);
    expect(r.temDetalheTecnico).toBe(false);
  });
});

describe("texto que já era humano passa intacto", () => {
  it("não mexe numa frase limpa", () => {
    const frase = "Checkpoint não pode ser fechado: o relatório semanal não traz métricas.";
    const r = falarComoGente(frase);
    expect(r.humano).toBe(frase);
    expect(r.temDetalheTecnico).toBe(false);
  });

  it("vazio devolve vazio, e não a palavra 'undefined'", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(falarComoGente(v).humano).toBe("");
    }
  });

  it("texto que vira vazio depois da limpeza volta ao original", () => {
    // Melhor mostrar algo feio que mostrar nada: sumir com a linha
    // esconderia que houve trabalho.
    const so_id = "9623ab68-cf83-4e1c-af44-edbb62533121";
    expect(falarComoGente(so_id).humano).toBe(so_id);
  });
});

describe("o cartão da Execução usa a tradução", () => {
  const pagina = readFileSync(
    resolve(__dirname, "../..", "src/pages/AdminExecucao.tsx"), "utf8");

  it("ação, evidência, próximo passo e bloqueio passam pela tradução", () => {
    expect(pagina).toContain("falarComoGente(v.last_action).humano");
    expect(pagina).toContain("const ev = falarComoGente(v.last_evidence);");
    expect(pagina).toContain("falarComoGente(v.next_step).humano");
    expect(pagina).toContain("falarComoGente(v.block_reason).humano");
  });

  it("o original fica a um toque, e não apagado", () => {
    // A evidência é o que sustenta a entrega; some com ela e o painel
    // volta a afirmar sem provar.
    expect(pagina).toContain("{ev.original}");
    expect(pagina).toContain("detalhe técnico");
  });

  it("abrir o detalhe não abre a tarefa", () => {
    // O cartão inteiro é clicável; o clique aqui é outra intenção.
    const bloco = pagina.slice(pagina.indexOf("<details"), pagina.indexOf("</details>"));
    expect(bloco).toContain("onClick={(e) => e.stopPropagation()}");
  });

  it("traduz uma vez por cartão, e não três", () => {
    const bloco = pagina.slice(pagina.indexOf("const ev = falarComoGente"), pagina.indexOf("</details>"));
    expect(bloco).not.toContain("falarComoGente(v.last_evidence).temDetalheTecnico");
  });
});
