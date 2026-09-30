import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkPara, PISO_DE_TAMANHO } from "../../config/chunk-strategy";
import { ciclosEntrePedacos } from "../../config/pedacos-sem-ciclo";

/**
 * O painel abria devagar no desktop e às vezes nem abria. A causa não era o
 * peso: era o build gerando 194 arquivos, 116 deles com menos de 5 KB. Cada um
 * custava uma ida e volta até o servidor, e um ícone de 288 bytes chegou a
 * levar 3,3 segundos em produção.
 *
 * Estes testes guardam as duas bordas do conserto. Errar para qualquer um dos
 * lados volta a deixar o painel lento, e nenhum dos dois erros quebra o build.
 */

const caminho = (...p: string[]) => resolve(__dirname, "../..", ...p);
const modulo = (nome: string) => `/projeto/node_modules/${nome}/dist/index.js`;

describe("bibliotecas que toda tela usa ficam juntas", () => {
  it("o React inteiro cai em um pedaço só", () => {
    // Dividido, passam a existir duas cópias do mesmo módulo e os hooks quebram.
    for (const lib of ["react", "react-dom", "scheduler", "react-router-dom"]) {
      expect(chunkPara(modulo(lib))).toBe("react");
    }
  });

  it("os ícones param de virar um arquivo cada", () => {
    // Era a origem dos 116 arquivinhos.
    expect(chunkPara(modulo("lucide-react"))).toBe("icones");
  });

  it("consulta e banco andam juntos", () => {
    expect(chunkPara(modulo("@tanstack/react-query"))).toBe("dados");
    expect(chunkPara(modulo("@supabase/supabase-js"))).toBe("dados");
  });

  it("funciona com barra do Windows, que é onde o build roda", () => {
    expect(chunkPara("C:\\projeto\\node_modules\\react\\index.js")).toBe("react");
  });
});

describe("o que só uma tela usa continua sob demanda", () => {
  it("não arrasta para a abertura biblioteca que começa com 'react'", () => {
    // Sem a barra no fim do padrão, "react" casava estes também, e eles
    // vinham parar na primeira tela: 64 KB comprimidos carregados por engano.
    for (const lib of ["react-hook-form", "react-day-picker", "react-resizable-panels"]) {
      expect(chunkPara(modulo(lib))).toBeUndefined();
    }
  });

  it("PDF, planilha e envio de arquivo ficam fora do carregamento inicial", () => {
    // Agrupá-los à força os transformou em dependência fixa da primeira tela e
    // a abertura saltou de 419 KB para 709 KB, mesmo só o Studio usando.
    for (const lib of ["pdfjs-dist", "read-excel-file", "jszip", "tus-js-client"]) {
      expect(chunkPara(modulo(lib))).toBeUndefined();
    }
  });

  it("gráfico e animação também esperam a tela que os usa", () => {
    expect(chunkPara(modulo("recharts"))).toBeUndefined();
    expect(chunkPara(modulo("framer-motion"))).toBeUndefined();
  });

  it("código do próprio painel nunca é agrupado à mão", () => {
    expect(chunkPara("/projeto/src/pages/AdminCiclo.tsx")).toBeUndefined();
    expect(chunkPara("/projeto/src/components/mesa/contextoDoCliente.ts")).toBeUndefined();
    expect(chunkPara("/projeto/src/components/mesa-site/EstilosDaBase.tsx")).toBeUndefined();
    // O código leve da base (sem dado) fica solto: com nome, a abertura cresceu mais (build de 2026-09-30).
    expect(chunkPara("/projeto/supabase/functions/_shared/uiux/consultas.ts")).toBeUndefined();
    expect(chunkPara("/projeto/supabase/functions/_shared/uiux/checklist-de-ux.ts")).toBeUndefined();
  });

  it("a base de design da tela ganha pedaço com nome próprio, e o piso não gruda nada nela", () => {
    // Solta, ela virava destino do piso: contextoDoCliente e o kit da marca foram
    // parar dentro dela, 67 pedaços passaram a importá-la de forma fixa e a
    // pré-carga ociosa baixava a base (medido no build de 2026-09-30).
    expect(chunkPara("/projeto/src/lib/uiux/dados/indice-leve.ts")).toBe("base-uiux");
    expect(chunkPara("C:\\projeto\\src\\lib\\uiux\\dados\\indice-leve.ts")).toBe("base-uiux");
    expect(chunkPara("/projeto/supabase/functions/_shared/uiux/pt.ts")).toBe("base-uiux-pt");
    expect(chunkPara("/projeto/supabase/functions/_shared/uiux/dados/ux.ts")).toBe("base-uiux-regras");
    // A base completa (servidor) nunca é agrupada à mão para a tela.
    expect(chunkPara("/projeto/supabase/functions/_shared/uiux/dados/estilos.ts")).toBeUndefined();
  });

  it("os arquivos da base que ganham nome não importam nada de valor (senão os vizinhos iriam junto)", () => {
    for (const f of ["src/lib/uiux/dados/indice-leve.ts", "supabase/functions/_shared/uiux/pt.ts", "supabase/functions/_shared/uiux/dados/ux.ts"]) {
      const importacoes = readFileSync(caminho(f), "utf8").split(/\r?\n/).filter((l) => /^import\b/.test(l));
      expect(importacoes.filter((l) => !/^import type\b/.test(l)), f).toEqual([]);
    }
  });
});

describe("o build pronto (só quando há um dist/ com a base)", () => {
  const assets = caminho("dist", "assets");
  const temBuild = existsSync(assets) && readdirSync(assets).some((n) => /^base-uiux-/.test(n));

  it.skipIf(!temBuild)("nenhum pedaço importa a base de forma fixa: ela só chega por import dinâmico", () => {
    // Fixo: import"./base-uiux-X.js" ou import{a as b}from"./base-uiux-X.js". Dinâmico: import("./base-uiux-X.js").
    const fixo = /import\s*(?:[\w$*{}\s,]*from\s*)?["']\.\/base-uiux-[^"']+["']/;
    const fixos = readdirSync(assets)
      .filter((n) => /\.js$/.test(n))
      .filter((n) => fixo.test(readFileSync(resolve(assets, n), "utf8")));
    expect(fixos).toEqual([]);
  });
});

describe("o build usa mesmo esta estratégia", () => {
  const config = readFileSync(caminho("vite.config.ts"), "utf8");

  it("o vite.config aponta para a regra testada, sem cópia paralela", () => {
    expect(config).toContain("manualChunks: chunkPara");
    expect(config).toContain("experimentalMinChunkSize: PISO_DE_TAMANHO");
  });

  it("o piso de tamanho gruda os fragmentos que sobrariam soltos", () => {
    // A rede de segurança para tudo que a regra acima deixa o Rollup decidir.
    expect(PISO_DE_TAMANHO).toBeGreaterThanOrEqual(10_000);
  });

  it("o piso não sobe a ponto de colar páginas de rotas diferentes", () => {
    // Com 20_000 o Rollup juntava no mesmo arquivo páginas sem relação: o
    // /login baixava o contrato e a votação de nomes, e quase toda tela
    // baixava relatórios e perfil. Medido em 30/09/2026: 44% do que as telas
    // baixavam de páginas não era usado; com 10_000, 22%.
    expect(PISO_DE_TAMANHO).toBeLessThanOrEqual(12_000);
  });

  it("o build confere que nenhum pedaço importa outro em círculo", () => {
    expect(config).toContain("pluginPedacosSemCiclo()");
  });
});

describe("o renderizador de servidor do React não vai para a abertura", () => {
  it("react-dom/server fica sob demanda (só a Mesa Identidade usa, ao exportar)", () => {
    for (const id of [
      "/projeto/node_modules/react-dom/server.browser.js",
      "/projeto/node_modules/react-dom/server.js",
      "/projeto/node_modules/react-dom/cjs/react-dom-server.browser.production.min.js",
      "/projeto/node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.min.js",
      "C:\\projeto\\node_modules\\react-dom\\server.browser.js",
      "C:\\projeto\\node_modules\\react-dom\\cjs\\react-dom-server.browser.production.min.js",
    ]) {
      expect(chunkPara(id)).toBeUndefined();
    }
  });

  it("o react-dom do navegador continua no pedaço do React", () => {
    for (const id of [
      "/projeto/node_modules/react-dom/index.js",
      "/projeto/node_modules/react-dom/client.js",
      "/projeto/node_modules/react-dom/cjs/react-dom.production.min.js",
      "C:\\projeto\\node_modules\\react-dom\\client.js",
    ]) {
      expect(chunkPara(id)).toBe("react");
    }
  });
});

describe("a casca do painel num pedaço de nome estável", () => {
  it("as bibliotecas que a casca usa caem em \"base\"", () => {
    // Soltas, iam no pedaço principal, que troca de nome a cada publicação, e
    // todo mundo baixava de novo biblioteca que não mudou.
    for (const lib of [
      "@radix-ui/react-dialog",
      "@radix-ui/react-popover",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-menu",
      "@radix-ui/react-popper",
      "@radix-ui/react-presence",
      "@radix-ui/react-dismissable-layer",
      "@radix-ui/react-focus-scope",
      "@radix-ui/react-portal",
      "@radix-ui/react-slot",
      "@radix-ui/react-avatar",
      "@radix-ui/react-alert-dialog",
      "@floating-ui/dom",
      "@floating-ui/react-dom",
      "sonner",
      "tailwind-merge",
      "cmdk",
      "class-variance-authority",
      "clsx",
      "react-remove-scroll",
      "aria-hidden",
    ]) {
      expect(chunkPara(modulo(lib)), lib).toBe("base");
    }
    expect(chunkPara("C:\\projeto\\node_modules\\@radix-ui\\react-dialog\\dist\\index.mjs")).toBe("base");
  });

  it("radix de uso só em tela continua sob demanda", () => {
    // Agrupá-los tornaria dependência fixa da abertura (lição 2 do arquivo).
    for (const lib of ["@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-accordion"]) {
      expect(chunkPara(modulo(lib)), lib).toBeUndefined();
    }
    // A barra no fim do nome: react-remove-scroll-bar não é o mesmo pacote.
    expect(chunkPara(modulo("react-remove-scroll-bar"))).toBeUndefined();
  });

  it("o ajudante de CommonJS fica com o React, e não no \"base\"", () => {
    // No "base", o React passava a depender do "base" e o "base" do React:
    // ciclo entre os dois pedaços da abertura e o painel não abria.
    expect(chunkPara("\u0000commonjsHelpers.js")).toBe("react");
  });
});

describe("o build acusa pedaços que se importam em círculo", () => {
  it("sem ciclo, nada a acusar", () => {
    expect(ciclosEntrePedacos({ index: ["react", "base"], base: ["react"], react: [] })).toEqual([]);
  });

  it("acha o ciclo direto entre dois pedaços", () => {
    expect(ciclosEntrePedacos({ index: ["react"], react: ["base"], base: ["react"] })).toEqual([["base", "react"]]);
  });

  it("acha o ciclo por um caminho maior e ignora import para fora do bundle", () => {
    const ciclos = ciclosEntrePedacos({ a: ["b", "externo"], b: ["c"], c: ["a"], d: ["a"] });
    expect(ciclos).toEqual([["a", "b", "c"]]);
  });
});
