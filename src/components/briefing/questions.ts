import { MODELOS_DE_FABRICA } from "../../../supabase/functions/_shared/briefing-modelos";

/**
 * As perguntas do diagnóstico geral, no formato de sempre (block, blockLabel,
 * question, hint...). Frente BRF (30/09): a fonte passou a ser o modelo
 * "diagnostico" em supabase/functions/_shared/briefing-modelos.ts, com as
 * mesmas chaves, textos e opções. Quem lê QUESTIONS continua igual.
 */
export type QuestionType = "text" | "textarea" | "single-chip" | "multi-chip";

export interface Question {
  key: string;
  block: string;
  blockLabel: string;
  question: string;
  hint: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  maxChars?: number;
  maxSelect?: number;
}

export const QUESTIONS: Question[] = MODELOS_DE_FABRICA.diagnostico.blocos.reduce<Question[]>((acc, bloco) => {
  bloco.campos.forEach((c) => {
    const q: Question = {
      key: c.key,
      block: bloco.id,
      blockLabel: bloco.titulo,
      question: c.pergunta,
      hint: c.apoio || "",
      type: c.tipo as QuestionType,
      required: !!c.obrigatorio,
    };
    if (c.opcoes) q.options = c.opcoes;
    if (c.placeholder) q.placeholder = c.placeholder;
    if (c.maxChars) q.maxChars = c.maxChars;
    if (c.maxSelect) q.maxSelect = c.maxSelect;
    acc.push(q);
  });
  return acc;
}, []);
