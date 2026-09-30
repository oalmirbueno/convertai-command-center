import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Sem Access-Control-Max-Age o navegador repete o preflight (OPTIONS) a cada
// chamada, e cada OPTIONS sobe um worker e carrega o módulo inteiro da função
// (cerca de 2 s nas mesas grandes). Com o cabeçalho, o Chrome guarda por até
// 7.200 s e o Safari por até 600 s.

const raiz = resolve(process.cwd(), "supabase/functions");
const ler = (arq: string) => readFileSync(arq, "utf8");

const indices = readdirSync(raiz, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => join(raiz, d.name, "index.ts"))
  .filter((arq) => existsSync(arq));

const MAX_AGE = /["']Access-Control-Max-Age["']\s*:\s*["'](\d+)["']/g;

// A frente de funções (FN-02) põe o mesmo cabeçalho pela constante
// PREFLIGHT_CACHE de _shared/cors.ts; as duas formas valem.
const PELA_CONSTANTE = /\.\.\.PREFLIGHT_CACHE\b/;
const temMaxAge = (fonte: string) => fonte.includes("Access-Control-Max-Age") || PELA_CONSTANTE.test(fonte);

function idadesDe(fonte: string): number[] {
  const idades: number[] = [];
  let m: RegExpExecArray | null;
  MAX_AGE.lastIndex = 0;
  while ((m = MAX_AGE.exec(fonte))) idades.push(Number(m[1]));
  return idades;
}

describe("CORS das Edge Functions guarda o preflight", () => {
  it("encontra as funções do repositório", () => {
    expect(indices.length).toBeGreaterThan(60);
  });

  it("toda função que monta Access-Control-Allow-Origin também manda Access-Control-Max-Age", () => {
    const semMaxAge = indices
      .filter((arq) => ler(arq).includes("Access-Control-Allow-Origin"))
      .filter((arq) => !temMaxAge(ler(arq)))
      .map((arq) => arq.slice(raiz.length + 1));
    expect(semMaxAge).toEqual([]);
  });

  it("toda função que usa o corsHeaders do supabase-js acrescenta o Max-Age", () => {
    const semMaxAge = indices
      .filter((arq) => ler(arq).includes("supabase-js@2/cors"))
      .filter((arq) => !/\.\.\.corsDoSupabase,\s*["']Access-Control-Max-Age["']/.test(ler(arq)) && !PELA_CONSTANTE.test(ler(arq)))
      .map((arq) => arq.slice(raiz.length + 1));
    expect(semMaxAge).toEqual([]);
  });

  it("os cabeçalhos compartilhados entre módulos também têm Max-Age", () => {
    for (const rel of [
      "_shared/mcp-response.ts",
      "briefing-agente/base.ts",
      "contratos/base.ts",
      "mesa-identidade/comum.ts",
    ]) {
      const fonte = ler(join(raiz, rel));
      if (PELA_CONSTANTE.test(fonte)) expect(fonte, rel).toContain("_shared/cors.ts");
      else expect(fonte, rel).toMatch(/["']Access-Control-Max-Age["']\s*:\s*["']7200["']/);
    }
  });

  it("o valor é um número de segundos entre 600 e 7.200 (teto do Chrome)", () => {
    expect(idadesDe(ler(join(raiz, "_shared/cors.ts")))).toEqual([7200]);
    for (const arq of indices) {
      for (const idade of idadesDe(ler(arq))) {
        expect(idade, arq).toBeGreaterThanOrEqual(600);
        expect(idade, arq).toBeLessThanOrEqual(7200);
      }
    }
  });

  it("a resposta que devolve a origem de quem chamou separa o cache por Origin", () => {
    const origem = ler(join(raiz, "_shared/origem-do-painel.ts"));
    expect(origem).toContain('headers.set("Vary", vary ? `${vary}, Origin` : "Origin")');
  });
});
