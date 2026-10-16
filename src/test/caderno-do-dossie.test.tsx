import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CadernoDoDossie, {
  preservarQuebras, secoesDoDossie, tituloLegivel, useCaderno,
} from "@/components/admin/CadernoDoDossie";

/**
 * O dossiê lido como caderno (16/10, dono: "abrindo como se fosse um caderno
 * mesmo ... e não um monte de código"). O texto do banco é o mesmo; estes
 * testes guardam que ele vira seções com título, sumário e recolher, nos dois
 * formatos que existem (Markdown com ## e o texto puro do prompt semanal).
 */

const raiz = resolve(__dirname, "../..");
const fonte = readFileSync(resolve(raiz, "src/components/admin/CadernoDoDossie.tsx"), "utf8");
const painel = readFileSync(resolve(raiz, "src/components/admin/DossieDoCliente.tsx"), "utf8");

const PROMPT_SEMANAL = [
  "Cliente: Vifut.com.br",
  "",
  "ONDE ESTAMOS",
  "Em 18/08/2026 o plano Vid Pro segue ativo.",
  "",
  "FRENTES CONTRATADAS E ESTADO DE CADA UMA",
  "Conteúdo: 3 reels na semana",
  "Tráfego: pausado",
  "",
  "CAMPANHAS E TRÁFEGO",
  "DESCONHECIDO",
  "",
  "SEO E GMB",
  "Ficha do Google revisada.",
].join("\n");

describe("o texto vira seções", () => {
  it("formato do prompt semanal: título em caixa alta numa linha sozinha", () => {
    const p = secoesDoDossie(PROMPT_SEMANAL);
    expect(p.abertura).toBe("Cliente: Vifut.com.br");
    expect(p.secoes.map((s) => s.titulo)).toEqual([
      "Onde estamos",
      "Frentes contratadas e estado de cada uma",
      "Campanhas e tráfego",
      "SEO e GMB",
    ]);
    // "DESCONHECIDO" é a palavra do formato, não título.
    expect(p.secoes[2].corpo).toBe("DESCONHECIDO");
  });

  it("Markdown: o # sozinho fica na abertura e os ## viram as seções", () => {
    const p = secoesDoDossie("# Dossiê Vifut\n\n## Quem é\nTexto.\n\n## Próximo passo\n- Ativar mídia\n- Revisar verba");
    expect(p.abertura).toBe("# Dossiê Vifut");
    expect(p.secoes.map((s) => s.titulo)).toEqual(["Quem é", "Próximo passo"]);
    expect(p.secoes[1].resumo).toBe("Ativar mídia Revisar verba");
  });

  it("título dentro de bloco de código não corta seção", () => {
    const p = secoesDoDossie("## Um\n```\n## não é título\n```\n## Dois\nfim");
    expect(p.secoes.map((s) => s.titulo)).toEqual(["Um", "Dois"]);
  });

  it("texto sem título nenhum fica inteiro na abertura", () => {
    const p = secoesDoDossie("Só um parágrafo.\nOutra linha.");
    expect(p.secoes).toEqual([]);
    expect(p.abertura).toContain("Outra linha.");
  });

  it("título em caixa alta fica legível e sigla curta continua sigla", () => {
    expect(tituloLegivel("ONDE ESTAMOS")).toBe("Onde estamos");
    expect(tituloLegivel("O QUE FOI PROMETIDO NA ÚLTIMA MENSAGEM")).toBe("O que foi prometido na última mensagem");
    expect(tituloLegivel("CAMPANHAS NO CRM")).toBe("Campanhas no CRM");
    expect(tituloLegivel("1. **Quem é**:")).toBe("Quem é");
  });

  it("Enter simples do texto puro vira quebra de linha, lista e tabela não", () => {
    expect(preservarQuebras("Conteúdo: x\nTráfego: y")).toBe("Conteúdo: x  \nTráfego: y");
    expect(preservarQuebras("Itens:\n- a\n- b")).toBe("Itens:\n- a\n- b");
    expect(preservarQuebras("| a | b |\n|---|---|")).toBe("| a | b |\n|---|---|");
  });

  it("seção longa nasce recolhida, curta nasce aberta", () => {
    const p = secoesDoDossie(`## Curta\nok\n\n## Longa\n${"palavra ".repeat(120)}`);
    expect(p.secoes[0].longa).toBe(false);
    expect(p.secoes[1].longa).toBe(true);
  });
});

function Caderno({ texto }: { texto: string }) {
  const caderno = useCaderno(texto);
  return h("div", null,
    h("button", { type: "button", onClick: caderno.alternarTudo }, caderno.tudoAberto ? "Recolher seções" : "Ler o dossiê inteiro"),
    h(CadernoDoDossie, { caderno }));
}

describe("o caderno na tela", () => {
  const TEXTO = `Abertura curta.\n\n## Quem é\nCliente de **futebol**.\n\n## Histórico\n${"Linha longa de histórico. ".repeat(40)}`;

  it("mostra o sumário com as seções e o Markdown formatado, sem HTML cru", () => {
    const { container } = render(h(Caderno, { texto: `${TEXTO}\n\n<script>alert(1)</script>` }));
    const sumario = screen.getByRole("navigation", { name: "Sumário do dossiê" });
    expect(sumario.textContent).toContain("01Quem é");
    expect(sumario.textContent).toContain("02Histórico");
    expect(container.querySelector("strong")?.textContent).toBe("futebol");
    expect(container.querySelector("script")).toBeNull();
  });

  it("a seção longa abre pelo sumário, pelo título e pelo abrir tudo", () => {
    const { container } = render(h(Caderno, { texto: TEXTO }));
    const secoes = () => Array.from(container.querySelectorAll("[data-secao-do-caderno]")).map((s) => s.getAttribute("data-secao-do-caderno"));
    expect(secoes()).toEqual(["aberta", "recolhida"]);

    const titulo = screen.getByRole("button", { name: /Histórico/, expanded: false });
    fireEvent.click(titulo);
    expect(secoes()).toEqual(["aberta", "aberta"]);
    fireEvent.click(titulo);
    expect(secoes()).toEqual(["aberta", "recolhida"]);

    fireEvent.click(screen.getByText("Ler o dossiê inteiro"));
    expect(secoes()).toEqual(["aberta", "aberta"]);
    fireEvent.click(screen.getByText("Recolher seções"));
    expect(secoes()).toEqual(["recolhida", "recolhida"]);

    const atalhos = container.querySelectorAll("[data-atalho-do-sumario]");
    fireEvent.click(atalhos[1]);
    expect(secoes()).toEqual(["recolhida", "aberta"]);
  });
});

describe("regras do painel no código do caderno", () => {
  it("compatível com navegador antigo: sem lookbehind, \\p{} nem grupo nomeado", () => {
    for (const arquivo of [fonte, painel]) {
      expect(arquivo).not.toMatch(/\(\?<[=!]/);
      expect(arquivo).not.toMatch(/\\p\{/);
      expect(arquivo).not.toMatch(/\(\?<[A-Za-z]/);
    }
  });

  it("nunca HTML cru e nenhuma cor fixa", () => {
    for (const arquivo of [fonte, painel]) {
      expect(arquivo).not.toContain("dangerouslySetInnerHTML");
      expect(arquivo).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("o dossiê usa o caderno e mantém as funções", () => {
    expect(painel).toContain("<CadernoDoDossie caderno={caderno} />");
    for (const funcao of ["Ler o dossiê inteiro", "Ver histórico", "Outros dossiês atuais", "<EntregasNoDossie clientId={clientId} />", "Abrir memória e aprendizados", 'aria-label="Atualizar dossiê"']) {
      expect(painel).toContain(funcao);
    }
  });
});
