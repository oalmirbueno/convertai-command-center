export interface OperatorProgressDetail {
  title?: string;
  summary?: string;
  page_url?: string;
  attachments?: { name: string; url: string }[];
}

export function evidenceLocation(raw: string): string {
  if (/^aceleriq-file:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw)) return raw;
  if (/^mcp-files:\/\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(raw) && !raw.includes('..')) return raw;
  if (/^files:\/\/task-attachments\/[a-f0-9-]{36}\//i.test(raw) && !raw.includes('..')) return raw;
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Comprovação precisa de um endereço HTTPS ou arquivo privado da tarefa.'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Endereço de comprovação inválido.');
  if ([...u.searchParams.keys()].some(k => /token|secret|password|signature|credential|api.?key|authorization/i.test(k))) throw new Error('Não registre links com credenciais ou assinaturas. Use o caminho privado do arquivo.');
  u.hash = '';
  return u.toString();
}

/** Contrato pequeno e explícito: nunca aceitar dumps de sessão/headers/cookies. */
export function progressDetail(input: OperatorProgressDetail | undefined, action?: string, evidence?: string, nextStep?: string) {
  const detail: Record<string, unknown> = {};
  if (action?.trim()) detail.action = action.trim().slice(0, 300);
  if (evidence?.trim()) {
    const value = evidence.trim();
    detail.evidence = /^https?:\/\/|^files:\/\//i.test(value) ? evidenceLocation(value) : value.slice(0, 2000);
  }
  if (nextStep?.trim()) detail.next_step = nextStep.trim().slice(0, 300);
  if (input?.title?.trim()) detail.title = input.title.trim().slice(0, 200);
  if (input?.summary?.trim()) detail.summary = input.summary.trim().slice(0, 3000);
  if (input?.page_url) detail.page_url = evidenceLocation(input.page_url);
  if (input?.attachments) {
    if (input.attachments.length > 12) throw new Error('Envie até 12 comprovações por atualização.');
    detail.attachments = input.attachments.map(a => ({ name: a.name.trim().slice(0, 120) || 'Comprovação', url: evidenceLocation(a.url) }));
  }
  return detail;
}
