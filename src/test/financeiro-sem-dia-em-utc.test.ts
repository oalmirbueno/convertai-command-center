import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Telas de dinheiro: "hoje" nunca vem de `new Date().toISOString().slice(0, 10)` (ou `.split("T")[0]`).
 * Isso é o dia em UTC: depois das 21h no Brasil já é amanhã, e o pagamento, o vencimento padrão de uma
 * despesa ou o nome do relatório ficavam com o dia seguinte. O dia de São Paulo é `todayBR()` (@/lib/dateBR).
 */

const raiz = resolve(__dirname, "../..");
const pasta = "src/components/finance";
const arquivos = [
  ...readdirSync(join(raiz, pasta)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => `${pasta}/${f}`),
  "src/pages/AdminFinanceiro.tsx",
  "src/pages/ClientFinanceiro.tsx",
];

describe("o Financeiro usa o dia de São Paulo", () => {
  it.each(arquivos)("%s não tira o dia de hoje do texto UTC", (arquivo) => {
    const fonte = readFileSync(join(raiz, arquivo), "utf8");
    expect(fonte).not.toMatch(/new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\])/);
  });
});
