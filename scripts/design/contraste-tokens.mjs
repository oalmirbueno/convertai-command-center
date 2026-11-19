#!/usr/bin/env node
/**
 * Contraste dos tokens do painel e das cores da empresa (WCAG 2.2 AA).
 * Uso: npm run design:contraste  (ou node scripts/design/contraste-tokens.mjs [caminho/do/index.css])
 * Sai com código 1 se algum par reprovar. Node 24 (importa o .ts direto).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatarRazao, nota } from "../../src/lib/design/contraste.ts";
import { verificarTokens } from "../../src/lib/design/verificacoes.ts";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const caminho = process.argv[2] ? resolve(process.argv[2]) : resolve(raiz, "src/index.css");
const linhas = verificarTokens(readFileSync(caminho, "utf8"));

const TITULOS = {
  texto: "Texto sobre fundo (mínimo 4,5:1)",
  grafico: "Elementos gráficos: botão e anel (mínimo 3:1)",
  empresa: "Cores da empresa (botão 3:1; texto 4,5:1)",
};

const largura = Math.max(...linhas.map((l) => l.par.length)) + 2;
let reprovados = 0;
for (const grupo of ["texto", "grafico", "empresa"]) {
  for (const tema of ["escuro", "claro"]) {
    const doGrupo = linhas.filter((l) => l.grupo === grupo && l.tema === tema);
    console.log(`\n${TITULOS[grupo]} · tema ${tema}`);
    for (const l of doGrupo) {
      const marca = l.passa ? "ok " : "XX ";
      const rotulo = l.excecao ? "EXCEÇÃO do Almir (19/11)" : l.minimo === 3 ? (l.passa ? "passa 3:1" : "reprova") : nota(l.razao);
      console.log(`  ${marca}${l.par.padEnd(largura)}${formatarRazao(l.razao).padStart(8)}  ${rotulo}`);
      if (!l.passa) reprovados += 1;
    }
  }
}

console.log(`\n${linhas.length} pares, ${reprovados} reprovado(s), ${linhas.filter((l) => l.excecao).length} exceção(ões) decidida(s) pelo dono.`);
process.exit(reprovados ? 1 : 0);
