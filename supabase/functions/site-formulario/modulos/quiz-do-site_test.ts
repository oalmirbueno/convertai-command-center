/**
 * Quiz pelo formulário do site: o que passa e o que vira quiz_invalido.
 *
 *   deno test supabase/functions/site-formulario/modulos/quiz-do-site_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lerQuiz } from "./quiz-do-site.ts";

Deno.test("sem quiz: envio comum, como antes", () => {
  assertEquals(lerQuiz(undefined), { quiz: null, invalido: false });
  assertEquals(lerQuiz(null), { quiz: null, invalido: false });
});

Deno.test("quiz válido: limpa espaços e arredonda a pontuação", () => {
  assertEquals(lerQuiz({ pontuacao: 72.456, faixa: "  Quente ", respostas: { "Qual o faturamento?": " Acima de 50 mil " } }), {
    quiz: { pontuacao: 72.46, faixa: "Quente", respostas: { "Qual o faturamento?": "Acima de 50 mil" } },
    invalido: false,
  });
  assertEquals(lerQuiz({ pontuacao: 0, faixa: "Frio" }).quiz, { pontuacao: 0, faixa: "Frio", respostas: {} });
});

Deno.test("quiz fora do formato: inválido", () => {
  const respostas: Record<string, string> = {};
  for (let i = 0; i < 31; i++) respostas[`p${i}`] = "x";
  const casos: unknown[] = [
    "quente",
    [],
    { pontuacao: "10", faixa: "Quente" },
    { pontuacao: Number.NaN, faixa: "Quente" },
    { pontuacao: 1e9, faixa: "Quente" },
    { pontuacao: 10, faixa: "" },
    { pontuacao: 10, faixa: "x".repeat(61) },
    { pontuacao: 10, faixa: "<b>Quente</b>" },
    { pontuacao: 10, faixa: "Quente", respostas: [] },
    { pontuacao: 10, faixa: "Quente", respostas },
    { pontuacao: 10, faixa: "Quente", respostas: { p: 3 } },
    { pontuacao: 10, faixa: "Quente", respostas: { p: "x".repeat(201) } },
    { pontuacao: 10, faixa: "Quente", respostas: { ["x".repeat(201)]: "a" } },
    { pontuacao: 10, faixa: "Quente", respostas: { p: "<script>" } },
  ];
  for (const c of casos) assertEquals(lerQuiz(c).invalido, true, JSON.stringify(c).slice(0, 80));
});
