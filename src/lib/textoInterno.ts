/**
 * Nota interna não é mensagem para o cliente (19/10/2026).
 *
 * Em 09/10, 15 clientes receberam no portal a preparação interna do Hermes
 * ("Preparação interna para revisão; corte 09/10 ... Status ACTIVE não comprova
 * entrega"). Relatório publicado é imutável no banco (reports_secure_guard), então
 * o portal deixa de mostrar o que tem marca de nota interna, e o banco recusa
 * publicar texto novo assim (migration 20261019120000_portal_sem_texto_interno,
 * com as mesmas marcas).
 */
const MARCA_NO_TITULO = /prepara(ç|c)(ã|a)o interna|corte [0-9]{2}\/[0-9]{2}/i;
const MARCA_NO_TEXTO = /prepara(ç|c)(ã|a)o interna|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function ehTextoInterno(r: { title?: string | null; summary?: string | null } | null | undefined): boolean {
  if (!r) return false;
  return MARCA_NO_TITULO.test(String(r.title ?? "")) || MARCA_NO_TEXTO.test(String(r.summary ?? ""));
}

/** Só o que é para o cliente ver. */
export function semTextoInterno<T extends { title?: string | null; summary?: string | null }>(lista: readonly T[] | null | undefined): T[] {
  return (lista ?? []).filter((r) => !ehTextoInterno(r));
}
