/**
 * Conferências do Jev na Mesa Proposta (só aviso, sem laço de correção).
 *
 * 1. Dado de mercado contra o trecho da fonte (cookbook "citation check" do
 *    TypeSafe: Choice supports / contradicts / says_nothing). O código monta
 *    o estado e as perguntas; quem chama passa as respostas do Jev.
 * 2. Revisão da proposta inteira: clareza (Score), promessa de resultado e
 *    voz do cliente (Noul), com os limiares em código.
 *
 * Sem import de Deno: o Vitest testa com respostas falsas do Jev.
 */
import type { DadoDeMercado } from "../_shared/proposta-modelo.ts";

export type Veredito = "confere" | "contradiz" | "nao_mostra" | "sem_trecho" | "sem_conferencia";
export type ConferenciaDoDado = { rotulo: string; valor: string; url: string; veredito: Veredito; confianca: number | null };
type RespostaMinima = { choice?: string; confidence?: number; score?: number; noul?: number } | undefined;

/** Estado e perguntas para conferir os dados que trazem o trecho da fonte. */
export function perguntasDaConferencia(dados: DadoDeMercado[]): { state: Record<string, unknown>; questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> } | null {
  const state: Record<string, unknown> = {};
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  dados.forEach((d, i) => {
    if (!d.trecho) return;
    state[`dado_${i}`] = { claim: `${d.rotulo}: ${d.valor}`, section: d.trecho };
    questions[`r${i}`] = {
      type: "choice",
      instructions: `How does \`dado_${i}.section\` (the excerpt from the cited source) relate to \`dado_${i}.claim\`, including the exact number?`,
      criteria: {
        supports: "The section states the claim, with the same number, or directly implies it is true",
        contradicts: "The section states a different number or the opposite of the claim",
        says_nothing: "The section does not address what the claim asserts, either way",
      },
    };
  });
  return Object.keys(questions).length ? { state, questions } : null;
}

/** Confiança mínima para dizer "confere" (começa alta, como o cookbook recomenda). */
export const CONFIANCA_PARA_CONFERIR = 0.8;

/** Lê as respostas: sem trecho, "sem_trecho"; sem resposta, "sem_conferencia"; "confere" só com confiança. */
export function lerConferencia(dados: DadoDeMercado[], respostas: Record<string, RespostaMinima> | null): ConferenciaDoDado[] {
  return dados.map((d, i) => {
    const base = { rotulo: d.rotulo, valor: d.valor, url: d.fonte.url };
    if (!d.trecho) return { ...base, veredito: "sem_trecho" as const, confianca: null };
    const r = respostas ? respostas[`r${i}`] : undefined;
    const conf = r && typeof r.confidence === "number" ? r.confidence : null;
    const escolha = r && typeof r.choice === "string" ? r.choice : "";
    let veredito: Veredito = "sem_conferencia";
    if (escolha === "supports") veredito = conf === null || conf >= CONFIANCA_PARA_CONFERIR ? "confere" : "sem_conferencia";
    else if (escolha === "contradicts") veredito = "contradiz";
    else if (escolha === "says_nothing") veredito = "nao_mostra";
    return { ...base, veredito, confianca: conf };
  });
}

export const NIVEIS_CLAREZA = [
  "Confusa: o cliente não entende o que vai receber nem por quê",
  "Vaga: entende o assunto, mas o escopo e o próximo passo ficam soltos",
  "Clara: escopo, preço e próximo passo dá para entender numa leitura",
  "Muito clara: direta, fala do cliente e não deixa dúvida sobre escopo, preço e aceite",
];

export const PERGUNTAS_DA_REVISAO = {
  clareza: { type: "score" as const, instructions: "Para o cliente que lê no celular, quão clara é a `proposta` (o que recebe, quanto custa, como aceitar)?", criteria: NIVEIS_CLAREZA },
  promessa: {
    type: "noul" as const,
    instructions: "A `proposta` promete resultado garantido (vendas, faturamento, posição no Google, número de seguidores) em vez de descrever o trabalho?",
    criteria: { true: "promete resultado que depende do mercado", false: "descreve o trabalho e o método, sem garantir resultado" },
  },
  voz: {
    type: "noul" as const,
    instructions: "O bloco do desafio usa as palavras e os problemas que o cliente trouxe no `material_do_cliente`, em vez de um texto genérico que serviria para qualquer empresa?",
    criteria: { true: "usa o que o cliente disse", false: "texto genérico ou sem base no material" },
  },
};

/** Avisos da revisão pelos números do Jev (limiares aqui; nada é refeito). */
export function avisosDaRevisao(n: { clareza: number | null; promessa: number | null; voz: number | null }): string[] {
  const avisos: string[] = [];
  if (n.clareza !== null && n.clareza < 2) avisos.push("A proposta ainda está vaga: deixe escopo, preço e aceite mais diretos.");
  if (n.promessa !== null && n.promessa >= 0.6) avisos.push("Há promessa de resultado. O contrato não garante resultado: troque por método e entrega.");
  if (n.voz !== null && n.voz < 0.4) avisos.push("O desafio parece genérico: use o que o cliente disse na reunião.");
  return avisos;
}
