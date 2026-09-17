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
    expect(central).toContain('data-tour="central-carteira" className="grid gap-4 lg:auto-rows-fr lg:grid-cols-2 xl:gap-5"');
  });

  it("content-visibility só liga no computador", () => {
    const regra = css.slice(css.indexOf("@media (min-width: 1024px) {\n    .lista-longa > *"));
    expect(regra).toContain("content-visibility: auto;");
    // Fora da media query a regra não pode existir.
    expect(css).not.toMatch(/\n {2}\.lista-longa > \* \{/);
  });

  it("os dois cartões do perfil podem encolher até a largura da tela", () => {
    expect(central).toContain('className="min-w-0 bg-card border border-border rounded-xl overflow-hidden lg:h-full flex flex-col"');
    expect(central).toContain('<div className="min-w-0 space-y-4">');
  });
});

describe("nada vaza para o lado nem prende o toque", () => {
  it("a Central inteira tem a regra de celular: corta vazamento, deixa filho encolher e quebra palavra sem espaço", () => {
    expect(central).toContain('"space-y-7 central-celular"');
    expect(central).toContain("text-foreground central-celular");
    const regra = css.slice(css.indexOf("@media (max-width: 639px) {\n    .central-celular"));
    expect(regra).toContain("overflow-x: clip;");
    expect(regra).toContain(".central-celular :where(.grid) > *,");
    expect(regra).toContain("overflow-wrap: anywhere;");
  });

  it("caixa com rolagem própria só existe no computador; no celular a página rola inteira", () => {
    expect(central).not.toMatch(/"divide-y divide-border max-h-\[\d+px\] overflow-y-auto"/);
    expect(central.match(/sm:max-h-\[560px\] sm:overflow-y-auto/g)?.length).toBe(4);
    expect(diario).toContain("sm:max-h-[380px] sm:overflow-y-auto");
    expect(diario).not.toContain('"relative max-h-[380px]');
  });

  it("os botões dos momentos têm área de toque no celular", () => {
    expect(central.match(/flex min-h-9 items-center gap-1 rounded-lg border/g)?.length).toBe(3);
  });

  it("'Onde estamos com este cliente' mostra o resumo limpo, não o texto cru do WhatsApp", () => {
    expect(central).toContain("{resumoDoRitual(lastRitual.summary, 420)}");
  });
});
