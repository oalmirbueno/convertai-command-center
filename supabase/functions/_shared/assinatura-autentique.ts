/**
 * Autentique como assinatura opcional (frente CON, 30/09/2026): DESLIGADA.
 *
 * Decisão do dono: a assinatura do painel (nome, e-mail, aceite, IP, data,
 * hash SHA-256 do documento congelado e página de carimbo) é a padrão. A
 * Autentique fica pronta para quando houver chave no Cofre, sem conta criada
 * e sem nenhuma chamada externa daqui. Este módulo só:
 * - diz se a integração pode ser ligada (e por que não);
 * - monta o pedido que seria enviado (GraphQL createDocument), para revisão.
 *
 * Nada aqui faz fetch. Quem for ligar de verdade escreve o envio numa função
 * própria, com Confirmar, lendo a chave do Cofre só no servidor.
 */

export type EstadoDaAutentique = { ligada: false; pronta: boolean; motivo: string };

/**
 * Sempre desligada nesta versão. `pronta` diz se já existe chave configurada
 * (AUTENTIQUE_API_KEY no ambiente do servidor), sem nunca devolver a chave.
 */
export function estadoDaAutentique(ambiente: { get(nome: string): string | undefined } | null): EstadoDaAutentique {
  const temChave = !!(ambiente && String(ambiente.get("AUTENTIQUE_API_KEY") || "").trim());
  return {
    ligada: false,
    pronta: temChave,
    motivo: temChave
      ? "A chave existe, mas a integração continua desligada até o dono ligar."
      : "Sem chave da Autentique no Cofre. A assinatura do painel continua valendo.",
  };
}

/** Pedido que iria à API (só para conferência; não é enviado). */
export function pedidoDeDocumentoAutentique(p: { nome: string; signatarios: Array<{ email: string; acao?: "SIGN" }>; mensagem?: string | null }) {
  return {
    query: "mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(document: $document, signers: $signers, file: $file) { id name } }",
    variables: {
      document: { name: String(p.nome || "Contrato").slice(0, 180), message: p.mensagem ? String(p.mensagem).slice(0, 500) : undefined, sandbox: true },
      signers: p.signatarios.map((s) => ({ email: String(s.email || "").trim().toLowerCase(), action: s.acao || "SIGN" })),
    },
  };
}
