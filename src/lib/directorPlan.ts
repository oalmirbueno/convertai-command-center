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

/**
 * Pró-labore proporcional ao que entrou, sem saltos:
 * - abaixo de R$ 10 mil acompanha proporcionalmente (ex.: R$ 5 mil → R$ 1.500);
 * - em R$ 10 mil vale exatamente R$ 3.000;
 * - entre degraus soma a diferença proporcional (ex.: R$ 12,5 mil → R$ 3.500);
 * - acima do último degrau trava em R$ 25.000.
 */
export function interpolateProLabore(operationalRevenue: number): number {
  if (!Number.isFinite(operationalRevenue) || operationalRevenue <= 0) return 0;
  const first = PRO_LABORE_LADDER[0];
  if (operationalRevenue < first.revenue) {
    return Math.round((operationalRevenue / first.revenue) * first.proLabore);
  }
  let prev = first;
  for (const tier of PRO_LABORE_LADDER.slice(1)) {
    if (operationalRevenue < tier.revenue) {
      const fraction = (operationalRevenue - prev.revenue) / (tier.revenue - prev.revenue);
      return Math.round(prev.proLabore + fraction * (tier.proLabore - prev.proLabore));
    }
    prev = tier;
  }
  return prev.proLabore;
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

export interface OneOffSeed {
  name: string;
  /** Preço de lançamento (antes do gross-up). */
  launchPrice: number;
  /** Preço padrão (fase seguinte). */
  standardPrice: number;
  /** Limite de horas/escopo travado. */
  limit: string;
  /** Condição de pagamento oficial. */
  payment: string;
  /** true quando o preço é "a partir de". */
  fromPrice?: boolean;
}

/** Tabela de avulsos do Plano Diretor. Não entram no MRR; prazo, horas e revisão travados. */
export const ONE_OFF_CATALOG: OneOffSeed[] = [
  { name: "Diagnóstico express", launchPrice: 497, standardPrice: 697, limit: "3 h", payment: "100% antecipado" },
  { name: "Diagnóstico completo", launchPrice: 697, standardPrice: 997, limit: "6 h", payment: "100% antecipado" },
  { name: "Pacote de conteúdo", launchPrice: 997, standardPrice: 1297, limit: "9 h", payment: "100% antecipado" },
  { name: "Landing page express", launchPrice: 1297, standardPrice: 1697, limit: "11 h", payment: "60/40" },
  { name: "Landing page estratégica", launchPrice: 1797, standardPrice: 2497, limit: "17 h", payment: "60/40" },
  { name: "Site institucional enxuto", launchPrice: 2197, standardPrice: 2997, limit: "18 h", payment: "50/30/20" },
  { name: "Automação simples", launchPrice: 1297, standardPrice: 1797, limit: "9 h", payment: "60/40" },
  { name: "Implantação de CRM", launchPrice: 1497, standardPrice: 1997, limit: "11 h", payment: "60/40" },
  { name: "Dashboard inicial", launchPrice: 1497, standardPrice: 1997, limit: "11 h", payment: "60/40" },
  { name: "Identidade visual essencial", launchPrice: 1497, standardPrice: 1997, limit: "15 h", payment: "60/40" },
  { name: "Vídeo com IA", launchPrice: 797, standardPrice: 1297, limit: "8 h", payment: "100% antecipado" },
  { name: "Sistema customizado", launchPrice: 2997, standardPrice: 4997, limit: "Descoberta", payment: "Por marcos", fromPrice: true },
];

/**
 * Alíquota ilustrativa da fase atual (6%). É apenas o fallback de exibição:
 * a alíquota oficial de cada plano é editável no catálogo (Planos & Preços)
 * e deve ser confirmada pelo contador (CNAE, RBT12, Fator R).
 */
export const DEFAULT_TAX_RATE = 0.06;
