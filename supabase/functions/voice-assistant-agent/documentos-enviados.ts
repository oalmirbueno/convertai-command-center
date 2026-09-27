/**
 * Os documentos que vão para o modelo do agente (voice-assistant-agent).
 *
 * Anexos da pessoa e documentos do sistema entram em ordem até o teto de
 * caracteres; o que passa do teto fica de fora. `_documentsCount` contava
 * TODOS (inclusive os que ficaram de fora) e a resposta dizia "li 9" quando
 * o modelo tinha lido 5. Agora a conta é dos enviados, e os que ficaram de
 * fora aparecem à parte.
 */
export type DocumentoDoAgente = { fileName: string; text: string; source?: string };

export const TETO_POR_DOCUMENTO = 12000;
export const TETO_TOTAL = 60000;

export function montarBlocosDeDocumentos(
  documentos: DocumentoDoAgente[],
  tetos: { porDocumento?: number; total?: number } = {},
): { blocos: string[]; enviados: number; deFora: number } {
  const porDocumento = tetos.porDocumento ?? TETO_POR_DOCUMENTO;
  const total = tetos.total ?? TETO_TOTAL;
  let usado = 0;
  const blocos: string[] = [];
  for (const d of documentos) {
    const trecho = d.text.slice(0, porDocumento);
    if (usado + trecho.length > total) break;
    usado += trecho.length;
    blocos.push(`\n\n[DOCUMENTO: ${d.fileName}${d.source ? ` · ${d.source}` : ""}]\n${trecho}`);
  }
  return { blocos, enviados: blocos.length, deFora: documentos.length - blocos.length };
}
