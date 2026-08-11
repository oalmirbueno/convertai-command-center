/**
 * Parâmetros oficiais do Plano Diretor Financeiro (sócio único, v2.0 · 06/08/2026).
 *
 * Fonte: Aceleriq_Plano_Diretor_Financeiro_Socio_Unico_2026.pdf.
 * Nada aqui é aplicado automaticamente — a escada de pró-labore gera apenas
 * SUGESTÃO; a tabela de planos é usada como seed opcional do catálogo.
 */

export interface ProLaboreTier {
  /** Receita operacional mensal (após reserva tributária) que libera o degrau. */
  revenue: number;
  proLabore: number;
}

/** Escada oficial: pró-labore por estágio de receita operacional recebida. */
export const PRO_LABORE_LADDER: ProLaboreTier[] = [
  { revenue: 10_000, proLabore: 3_000 },
  { revenue: 15_000, proLabore: 4_000 },
  { revenue: 30_000, proLabore: 5_000 },
  { revenue: 50_000, proLabore: 7_000 },
  { revenue: 100_000, proLabore: 10_000 },
  { revenue: 250_000, proLabore: 15_000 },
  { revenue: 500_000, proLabore: 20_000 },
  { revenue: 1_000_000, proLabore: 25_000 },
];

/**
 * Sugere o pró-labore para uma receita operacional mensal.
 * Abaixo do primeiro degrau mantém o valor-base de R$ 3.000.
 */
export function suggestProLabore(operationalRevenue: number): number {
  let suggestion = PRO_LABORE_LADDER[0].proLabore;
  for (const tier of PRO_LABORE_LADDER) {
    if (operationalRevenue >= tier.revenue) suggestion = tier.proLabore;
  }
  return suggestion;
}

/** Próximo degrau da escada (ou null se já está no topo). */
export function nextProLaboreTier(operationalRevenue: number): ProLaboreTier | null {
  for (const tier of PRO_LABORE_LADDER) {
    if (operationalRevenue < tier.revenue) return tier;
  }
  return null;
}

export interface DirectorPlanSeed {
  name: string;
  code: string;
  /** Preço-base de lançamento (antes do gross-up tributário). */
  launchPrice: number;
  /** Preço-base padrão (fase seguinte). */
  standardPrice: number;
  setupFee: number;
  contractMonths: number;
  description: string;
}

/** Tabela de planos recorrentes do Plano Diretor (valores-base, antes do gross-up). */
export const DIRECTOR_PLAN_CATALOG: DirectorPlanSeed[] = [
  { name: "Start Assistido", code: "start-assistido", launchPrice: 997, standardPrice: 1197, setupFee: 397, contractMonths: 3, description: "Entrada limitada: até 3 h/mês, máximo 5 vagas e 1 canal." },
  { name: "Essencial", code: "essencial", launchPrice: 1297, standardPrice: 1497, setupFee: 497, contractMonths: 6, description: "Primeiro plano normal para cliente novo. Conteúdo enxuto e relatório." },
  { name: "Presença", code: "presenca", launchPrice: 1997, standardPrice: 2197, setupFee: 797, contractMonths: 6, description: "Conteúdo e rotina limitada, escopo mensal fechado em anexo." },
  { name: "Crescimento", code: "crescimento", launchPrice: 2997, standardPrice: 3297, setupFee: 997, contractMonths: 6, description: "Conteúdo, criativos e tráfego." },
  { name: "Estrutura", code: "estrutura", launchPrice: 4497, standardPrice: 4997, setupFee: 1497, contractMonths: 12, description: "CRM leve, automação e governança." },
  { name: "Engenharia / OS", code: "engenharia-os", launchPrice: 6997, standardPrice: 7997, setupFee: 2497, contractMonths: 12, description: "Operação integrada e dados." },
];

/**
 * Alíquota ilustrativa da fase atual (6%). É apenas o fallback de exibição:
 * a alíquota oficial de cada plano é editável no catálogo (Planos & Preços)
 * e deve ser confirmada pelo contador (CNAE, RBT12, Fator R).
 */
export const DEFAULT_TAX_RATE = 0.06;
