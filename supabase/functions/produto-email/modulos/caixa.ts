/**
 * A caixa de e-mail oficial da Aceleriq dentro do painel, com o Zoho por trás.
 *
 * Fica DESLIGADA até o dono decidir: ligar pede o segredo ACELERIQ_CAIXA_LIGADA=sim na função e o token
 * do Zoho da Aceleriq guardado no domínio da Aceleriq (Integração, Zoho). Só leitura: lista as mensagens
 * recentes da caixa; responder e enviar continuam no webmail do Zoho.
 *
 * Por que desligada: no Zoho gratuito não há IMAP nem POP (página de preços, 18/11/2026) e a
 * documentação da API não diz se o gratuito pode ler mensagens pela API. O caminho garantido é o
 * Mail Lite (pago, só anual), que libera IMAP e a API. Sem import: roda na função e no vitest.
 */

export interface EstadoDaCaixa {
  ligada: boolean;
  motivo: string | null;
  plano_necessario: string;
  custo: { por_usuario_mes: string; cobranca: string; fonte: string };
}

export const CUSTO_DO_PLANO_PAGO = {
  por_usuario_mes: "R$ 6,25 por usuário por mês (Mail Lite, cobrança anual)",
  cobranca: "Só anual, sem plano mensal",
  fonte: "zoho.com/mail/zohomail-pricing.html (conferir o valor do dia antes de contratar)",
};

export function estadoDaCaixa(p: { flag: string | undefined | null; temToken: boolean; temDominio: boolean }): EstadoDaCaixa {
  const base = { plano_necessario: "Zoho Mail Lite (ou superior) na conta da Aceleriq", custo: CUSTO_DO_PLANO_PAGO };
  if (String(p.flag || "").trim().toLowerCase() !== "sim") {
    return { ligada: false, motivo: "A caixa está desligada. Ligar é decisão do dono: veja o custo abaixo.", ...base };
  }
  if (!p.temDominio) return { ligada: false, motivo: "Falta cadastrar o domínio da Aceleriq em E-mail.", ...base };
  if (!p.temToken) return { ligada: false, motivo: "Falta guardar o token do Zoho da Aceleriq (Integração, Zoho).", ...base };
  return { ligada: true, motivo: null, ...base };
}

export interface MensagemDaCaixa {
  id: string;
  de: string;
  assunto: string;
  resumo: string;
  recebida_em: string | null;
  lida: boolean;
}

/** As mensagens como a tela mostra (sem corpo: só o resumo que o Zoho dá). */
export function lerMensagens(lista: unknown): MensagemDaCaixa[] {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 50).map((m) => {
    const x = (m || {}) as Record<string, unknown>;
    const quando = Number(x.receivedTime || x.sentDateInGMT || 0);
    return {
      id: String(x.messageId || ""),
      de: String(x.fromAddress || x.sender || ""),
      assunto: String(x.subject || "(sem assunto)").slice(0, 200),
      resumo: String(x.summary || "").slice(0, 280),
      recebida_em: quando > 0 ? new Date(quando).toISOString() : null,
      lida: String(x.status || "") === "1" || x.status === 1,
    };
  }).filter((m) => m.id);
}
