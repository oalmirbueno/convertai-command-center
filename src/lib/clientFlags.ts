/**
 * Flags leves de cliente guardadas em profiles.services_config (jsonb),
 * sem precisar de migration.
 */

/**
 * Empresa do grupo (interna): cadastrada para organização (projetos, arquivos),
 * mas não paga mensalidade — deve ficar fora de cobranças, alertas de atraso,
 * pendência de "sem plano", MRR e análises do assistente.
 */
export const isInternalClient = (client: any): boolean =>
  Boolean(client?.services_config?.internal_company);
