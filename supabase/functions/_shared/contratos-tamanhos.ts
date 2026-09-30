/**
 * Tamanho de uma chamada do agente de contratos, para a estimativa de custo
 * na tela (frente UXS, 30/09), do jeito de TAMANHOS_DA_IDENTIDADE e
 * TAMANHOS_DO_MOTION. Sem import: a tela e as funções leem o mesmo número.
 *
 * - conversa: o sistema do agente com os DADOS do cliente, os alvos do
 *   contrato, o mapa do painel e as regras (uns 7 mil tokens), mais o
 *   histórico; a saída tem teto de 3 mil tokens (contratos/index.ts,
 *   `maxTokensSaida` do agente_conversar).
 */
export const TAMANHOS_DOS_CONTRATOS = {
  conversa: { entrada: 9_000, saida: 3_000 },
} as const;
