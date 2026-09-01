import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { acoesDoDia, type Pendencia } from "@/lib/cycleSuggest";

/**
 * "O ciclo está muito genérico."
 *
 * Estava, e a causa era concreta: a pendência sempre carregou os NOMES
 * dos itens (`detalhes`) e a TELA onde se resolve (`rota`), e a faixa de
 * "o que pede ação hoje" jogava os dois fora no caminho.
 *
 * "Aprovação parada" sem dizer qual post nem para onde ir é genérico com
 * a informação específica a um campo de distância.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const pend = (extra: Partial<Pendencia> = {}): Pendencia => ({
  chave: "aprovacao-parada",
  texto: "Aprovação parada",
  gravidade: "urgente",
  viraEtapa: true,
  ...extra,
});

describe("a ação do dia carrega o específico", () => {
  it("leva os nomes dos itens junto", () => {
    const [a] = acoesDoDia([{
      clientId: "c1", nome: "Acerbi",
      pendencias: [pend({ detalhes: ["Post do pernil", "Carrossel de terça"] })],
    }]);
    expect(a.detalhes).toEqual(["Post do pernil", "Carrossel de terça"]);
  });

  it("leva a tela onde se resolve", () => {
    const [a] = acoesDoDia([{
      clientId: "c1", nome: "Acerbi",
      pendencias: [pend({ rota: "/aprovacoes" })],
    }]);
    expect(a.rota).toBe("/aprovacoes");
  });

  it("pendência sem detalhes não inventa detalhes", () => {
    const [a] = acoesDoDia([{ clientId: "c1", nome: "X", pendencias: [pend()] }]);
    expect(a.detalhes).toBeUndefined();
    expect(a.rota).toBeUndefined();
  });
});

describe("as regras da faixa continuam de pé", () => {
  it("aviso de leitura não vira ação de hoje", () => {
    const acoes = acoesDoDia([{
      clientId: "c1", nome: "X",
      pendencias: [pend({ viraEtapa: false })],
    }]);
    expect(acoes).toHaveLength(0);
  });

  it("um cliente incendiado não ocupa a faixa inteira", () => {
    // Senão ele esconde o incêndio menor dos outros.
    const incendiado = {
      clientId: "c1", nome: "Fogo",
      pendencias: [pend({ chave: "a" }), pend({ chave: "b" }), pend({ chave: "c" })],
    };
    const outro = { clientId: "c2", nome: "Outro", pendencias: [pend({ chave: "d" })] };
    const acoes = acoesDoDia([incendiado, outro], 3);
    expect(acoes.some((a) => a.clientId === "c2")).toBe(true);
  });

  it("o mais grave vem primeiro", () => {
    const acoes = acoesDoDia([
      { clientId: "c1", nome: "A", pendencias: [pend({ gravidade: "atencao" })] },
      { clientId: "c2", nome: "B", pendencias: [pend({ gravidade: "urgente" })] },
    ]);
    expect(acoes[0].gravidade).toBe("urgente");
  });

  it("respeita o limite", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      clientId: `c${i}`, nome: `C${i}`, pendencias: [pend({ chave: `k${i}` })],
    }));
    expect(acoesDoDia(muitos, 5)).toHaveLength(5);
  });
});

describe("a faixa na tela", () => {
  const pagina = ler("src/pages/AdminCiclo.tsx");

  it("mostra os nomes e o caminho", () => {
    expect(pagina).toContain("acao.detalhes.slice(0, 3).join(\" · \")");
    expect(pagina).toContain("resolver aqui");
  });

  it("só mostra a linha extra quando há o que mostrar", () => {
    // Uma linha vazia embaixo de cada ação seria poluição sem informação.
    expect(pagina).toContain("{(acao.detalhes?.length || acao.rota) && (");
  });

  it("o link não é um botão dentro de outro botão", () => {
    // Botão aninhado em botão é HTML inválido e o clique fica imprevisível.
    const inicio = pagina.indexOf("{acoes.map((acao, indice) => (");
    const bloco = pagina.slice(inicio, pagina.indexOf("))}", inicio));
    expect(bloco.indexOf("<Link")).toBeGreaterThan(bloco.indexOf("</button>"));
  });
});
