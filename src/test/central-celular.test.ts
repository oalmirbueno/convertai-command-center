import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Central no celular (2026-09-17).
 *
 * O "espaço gigante" no perfil do cliente tinha uma causa só: a grade de dois
 * cartões usava `lista-longa`, que liga content-visibility:auto em cada filho.
 * A classe foi feita para lista longa de cartões pequenos; em dois cartões
 * grandes, o iPhone reservava a caixa e não desenhava o conteúdo, que também
 * ficava sem toque. O resto da auditoria: nada vaza para o lado, nenhuma caixa
 * com rolagem própria prende o dedo, botão pequeno ganha área de toque.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const central = ler("src/pages/AdminExperience.tsx");
const css = ler("src/index.css");
const diario = ler("src/components/shared/ProjectJournal.tsx");

describe("o perfil do cliente desenha inteiro no celular", () => {
  it("a grade de dois cartões não usa mais a otimização de lista longa", () => {
    expect(central).not.toContain('className="lista-longa grid');
    // E3 (26/09, sistema de design): as duas colunas viraram seções sem caixa;
    // uma coluna no celular, duas do notebook para cima.
    expect(central).toMatch(/data-tour="central-carteira" className="grid [^"]*lg:grid-cols-2[^"]*"/);
  });

  it("content-visibility só liga no computador", () => {
    const regra = css.slice(css.indexOf("@media (min-width: 1024px) {\n    .lista-longa > *"));
    expect(regra).toContain("content-visibility: auto;");
    // Fora da media query a regra não pode existir.
    expect(css).not.toMatch(/\n {2}\.lista-longa > \* \{/);
  });

  it("as duas colunas do perfil podem encolher até a largura da tela", () => {
    expect(central).toContain('<div className="min-w-0" data-coluna="rituais">');
    expect(central).toContain('<div className="min-w-0 space-y-6" data-coluna="mensagens">');
  });
});

describe("nada vaza para o lado nem prende o toque", () => {
  it("a Central inteira tem a regra de celular: corta vazamento, deixa filho encolher e quebra palavra sem espaço", () => {
    expect(central).toContain('"space-y-5 central-celular"');
    expect(central).toContain("text-foreground central-celular");
    const regra = css.slice(css.indexOf("@media (max-width: 639px) {\n    .central-celular"));
    expect(regra).toContain("overflow-x: clip;");
    expect(regra).toContain(".central-celular :where(.grid) > *,");
    expect(regra).toContain("overflow-wrap: anywhere;");
  });

  it("caixa com rolagem própria só existe no computador; no celular a página rola inteira", () => {
    expect(central).not.toMatch(/"divide-y divide-border max-h-\[\d+px\] overflow-y-auto"/);
    // E3 (26/09): as listas rolam por dentro só de 1024 px para cima
    // (RegiaoRolavel modo "lg", dentro da AreaDeTrabalho); abaixo disso a página rola.
    expect(central).not.toMatch(/max-h-\[\d+px\] sm:overflow-y-auto/);
    expect(central.match(/<RegiaoRolavel modo="lg"/g)?.length).toBe(6);
    expect(central).toContain("<AreaDeTrabalho principalRolavel={false}>");
    // O diário não tem caixa com rolagem própria: ele mora dentro de regiões
    // que já rolam; o tamanho fica nos 12 mais recentes e "Ver tudo".
    expect(diario).not.toMatch(/max-h-\[\d+px\]/);
    expect(diario).not.toContain("overflow-y-auto");
    expect(diario).toContain("entries.slice(0, 12)");
  });

  it("os botões dos momentos têm área de toque no celular", () => {
    // Botões do sistema (36 px de altura em toda largura).
    const momentos = central.split('data-botao-do-momento=""').slice(1);
    expect(momentos.length).toBe(3);
    for (const trecho of momentos) expect(trecho.slice(0, 700)).toMatch(/className=\{(juntar\()?botao\.discreto/);
  });

  it("'Onde estamos com este cliente' mostra o resumo limpo, não o texto cru do WhatsApp", () => {
    expect(central).toContain("{resumoDoRitual(lastRitual.summary, 420)}");
  });
});
