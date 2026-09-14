import { centralReviewLink, type CentralApproval } from "./centralReview";

export type DeliveryState = "preparado" | "aprovado" | "enviado" | "confirmado" | "erro" | "incerto";
export type TransportCapability = "authenticated_link" | "verified_native_decision";
export interface PreparedReviewNotice {
  text: string;
  deduplicationKey: string;
  approvalIds: string[];
  capability: TransportCapability;
  sendingEnabled: false;
}

/** A single notice for the explicitly selected requests. Does not send or infer recipient identity. */
export function prepareReviewNotice(presented: readonly CentralApproval[], appOrigin: string): PreparedReviewNotice {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Origem autenticada inválida.");
  const unique = new Map<string, CentralApproval>();
  for (const approval of presented) {
    if (!approval.id || !approval.payload_hash || !["pendente", "adiado"].includes(approval.status)) continue;
    const previous = unique.get(approval.id);
    if (previous && (previous.payload_hash !== approval.payload_hash || previous.payload_version !== approval.payload_version)) throw new Error("Versões conflitantes no aviso.");
    unique.set(approval.id, approval);
  }
  const items = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!items.length || items.length > 30) throw new Error("Selecione de 1 a 30 pedidos apresentados para um aviso consolidado.");
  return {
    text: [`Aceleriq: ${items.length} pedido(s) aguardam sua revisão.`,
      ...items.map(item => `${item.payload.report.title} · v${item.payload_version}\n${origin.origin}${centralReviewLink(item.id)}`),
      "Abra o link e entre com sua conta administrativa para aprovar, rejeitar ou comentar. Responder apenas 'aprovo' nesta conversa não decide o pedido.",
    ].join("\n\n"),
    deduplicationKey: JSON.stringify(items.map(item => [item.id, item.payload_version, item.payload_hash])),
    approvalIds: items.map(item => item.id), capability: "authenticated_link", sendingEnabled: false,
  };
}

/** An ambiguous external response needs reconciliation; this is not permission to retry a send. */
export function deliveryTransition(current: DeliveryState, next: DeliveryState): DeliveryState {
  const allowed: Record<DeliveryState, readonly DeliveryState[]> = {
    preparado: ["aprovado"], aprovado: ["enviado", "erro", "incerto"], enviado: ["confirmado", "incerto"],
    confirmado: [], erro: [], incerto: ["enviado", "confirmado", "erro"],
  };
  if (!allowed[current].includes(next)) throw new Error("Transição de envio inválida. Concilie o resultado antes de qualquer nova tentativa.");
  return next;
}
