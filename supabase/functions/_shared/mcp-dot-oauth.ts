const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DOT_OFFICE_OPERATOR = 'dot' as const;

export interface DotOAuthBinding {
  clientId: string;
  subjectId: string;
}

interface DotOAuthAttempt extends DotOAuthBinding {
  verifiedClaims: boolean;
  staff: boolean;
  admin: boolean;
  legacyBinding: boolean;
}

/** Uma única combinação aprovada fora do fluxo OAuth normal: client_id:sub. */
export function parseDotOAuthBinding(raw: string | undefined): DotOAuthBinding | null {
  if (!raw) return null;
  const [clientId, subjectId, extra] = raw.split(':');
  if (!subjectId || extra !== undefined || !UUID.test(clientId) || !UUID.test(subjectId)) return null;
  return { clientId: clientId.toLowerCase(), subjectId: subjectId.toLowerCase() };
}

export function dotOAuthDecision(
  binding: DotOAuthBinding | null,
  attempt: DotOAuthAttempt,
): 'unrelated' | 'denied' | 'allowed' {
  if (!binding) return 'unrelated';
  const sameClient = UUID.test(attempt.clientId) && attempt.clientId.toLowerCase() === binding.clientId;
  const sameSubject = UUID.test(attempt.subjectId) && attempt.subjectId.toLowerCase() === binding.subjectId;
  // Só a conta dedicada muda de fluxo. Outros sujeitos preservam a autorização existente.
  if (!sameSubject) return 'unrelated';
  if (!sameClient || !attempt.verifiedClaims || attempt.staff || attempt.admin || attempt.legacyBinding) {
    return 'denied';
  }
  return 'allowed';
}

export function isDotOfficeTool(name: string): boolean {
  return name === 'aceleriq_escritorio_entrar' || name === 'aceleriq_escritorio_caixa';
}
