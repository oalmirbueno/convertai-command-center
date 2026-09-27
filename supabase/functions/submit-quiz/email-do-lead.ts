/**
 * E-mail do lead no quiz público.
 *
 * Mesma régua do banco (app_private.quiz_payload_is_valid): algo@algo.algo,
 * sem espaço e com uma @ só. Antes, um e-mail fora disso virava
 * "Invalid payload" (400 sem motivo) e a tela dizia só "Não conseguimos
 * enviar"; o salvamento automático também falhava calado a cada tecla.
 * Agora o erro tem código e frase em português, e a tela confere antes.
 */
export const PADRAO_EMAIL_DO_LEAD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Vazio vale (o e-mail é opcional); preenchido precisa passar na régua. */
export function emailDoLeadValido(email: string): boolean {
  const limpo = email.trim();
  return limpo === "" || PADRAO_EMAIL_DO_LEAD.test(limpo);
}

export const ERRO_EMAIL_INVALIDO = {
  error: "Invalid email",
  code: "email_invalido",
  field: "lead_email",
  message: "E-mail inválido. Confira o endereço (exemplo: nome@empresa.com.br) e tente de novo.",
} as const;
