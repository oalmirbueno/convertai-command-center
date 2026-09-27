/**
 * E-mail do lead no quiz público (QuizPublicPage).
 *
 * Mesma régua do servidor (supabase/functions/submit-quiz/email-do-lead.ts)
 * e do banco (app_private.quiz_payload_is_valid). Antes a tela deixava
 * seguir com "joao@gmail" e, dez perguntas depois, o envio falhava com
 * "Não conseguimos enviar" sem dizer o motivo.
 */
export const PADRAO_EMAIL_DO_LEAD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const FRASE_EMAIL_INVALIDO = "E-mail inválido. Confira o endereço (exemplo: nome@empresa.com.br) e tente de novo.";

/** Vazio vale (o e-mail é opcional); preenchido precisa passar na régua. */
export function emailDoLeadValido(email: string | null | undefined): boolean {
  const limpo = String(email || "").trim();
  return limpo === "" || PADRAO_EMAIL_DO_LEAD.test(limpo);
}

/**
 * O código e a frase que o submit-quiz devolveu no corpo do erro. O SDK do
 * Supabase embrulha a resposta 4xx em `error.context` (a Response); sem
 * corpo legível, volta vazio e a tela usa a frase genérica.
 */
export async function motivoDoErroDoQuiz(error: unknown): Promise<{ code: string | null; message: string | null }> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  try {
    if (ctx && typeof ctx.json === "function") {
      const corpo = (await ctx.json()) as { code?: unknown; message?: unknown } | null;
      return {
        code: typeof corpo?.code === "string" ? corpo.code : null,
        message: typeof corpo?.message === "string" && corpo.message.trim() ? corpo.message : null,
      };
    }
  } catch { /* corpo ilegível: segue a frase genérica */ }
  return { code: null, message: null };
}
