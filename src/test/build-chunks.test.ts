import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkPara, PISO_DE_TAMANHO } from "../../config/chunk-strategy";

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
});
