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

/**
 * Serviço contratado, do jeito que foi marcado no cadastro do cliente.
 *
 * O ciclo de tráfego só faz sentido para quem contratou tráfego, e o de
 * social para quem contratou social. Vale só o que está marcado: serviço
 * ausente ou desmarcado significa que o cliente não entra naquela frente.
 */
export const hasService = (client: any, service: "social" | "trafego"): boolean =>
  client?.services_config?.[service] === true;
