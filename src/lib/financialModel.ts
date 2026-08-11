/**
 * Canonical financial calculations for Financeiro V2.
 *
 * Values are accepted and returned in BRL, but every operation is performed in
 * integer cents. This keeps cards, tables and charts on the same rounding rule.
 */

export type PaymentStatus = "pending" | "partial" | "paid" | "cancelled" | "reversed" | string;

export type AllocationMethod = "equal" | "revenue" | "custom" | "none";

export type BillingPeriod = "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";

export interface ClientMarginInput {
  operationalRevenue: number;
  directCosts: number;
  allocatedFixedCosts?: number;
}

export interface GlobalResultInput {
  operationalRevenue: number;
  oneOffRevenue?: number;
  directCosts: number;
  fixedCosts: number;
  otherExpenses?: number;
  proLabore: number;
}

export interface AllocationItem {
  id: string;
  operationalRevenue: number;
  customShare?: number;
}

export interface AllocationResult extends AllocationItem {
  allocatedFixedCosts: number;
}

const CENTS = 100;

export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * CENTS);
}

export function fromCents(value: number): number {
  return Math.round(value) / CENTS;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function normalizeTaxRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  const normalized = rate > 1 ? rate / 100 : rate;
  if (normalized < 0 || normalized >= 1) {
    throw new RangeError("A alíquota deve ser maior ou igual a zero e menor que 100%.");
  }
  return normalized;
}

/** final = operational / (1 - tax rate) */
export function grossUp(operationalAmount: number, taxRate: number): number {
  const operationalCents = toCents(Math.max(0, operationalAmount));
  const normalizedRate = normalizeTaxRate(taxRate);
  if (normalizedRate === 0) return fromCents(operationalCents);
  return fromCents(Math.round(operationalCents / (1 - normalizedRate)));
}

export function splitGrossAmount(operationalAmount: number, taxRate: number) {
  const operational = roundMoney(Math.max(0, operationalAmount));
  const finalAmount = grossUp(operational, taxRate);
  return {
    operationalAmount: operational,
    finalAmount,
    taxReserve: fromCents(toCents(finalAmount) - toCents(operational)),
  };
}

/** Discounts reduce the operational base before tax gross-up. */
export function grossUpAfterDiscount(
  operationalAmount: number,
  discountAmount: number,
  taxRate: number,
) {
  const discounted = fromCents(Math.max(0, toCents(operationalAmount) - toCents(discountAmount)));
  return splitGrossAmount(discounted, taxRate);
}

export function monthlyEquivalent(amount: number, period: BillingPeriod): number {
  const months: Record<BillingPeriod, number> = {
    monthly: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12,
  };
  return fromCents(Math.round(toCents(Math.max(0, amount)) / months[period]));
}

export function recognizedPayment(
  totalAmount: number,
  paidAmount: number | null | undefined,
  status: PaymentStatus,
): number {
  const totalCents = Math.max(0, toCents(totalAmount));
  const paidCents = Math.max(0, toCents(paidAmount ?? 0));
  if (status === "partial") return fromCents(Math.min(paidCents, totalCents));
  if (status === "paid") {
    return fromCents(paidCents > 0 && paidCents < totalCents ? paidCents : totalCents);
  }
  return 0;
}

export function remainingBalance(totalAmount: number, receivedAmount: number): number {
  return fromCents(Math.max(0, toCents(totalAmount) - toCents(receivedAmount)));
}

/** Tax reserve follows the proportion actually received, including partial payments. */
export function taxReserveForPayment(
  finalAmount: number,
  fullTaxReserve: number,
  receivedAmount: number,
): number {
  const finalCents = Math.max(0, toCents(finalAmount));
  if (finalCents === 0) return 0;
  const reserveCents = Math.max(0, toCents(fullTaxReserve));
  const receivedCents = Math.min(Math.max(0, toCents(receivedAmount)), finalCents);
  return fromCents(Math.round((reserveCents * receivedCents) / finalCents));
}

export function calculateClientMargin(input: ClientMarginInput) {
  const revenue = toCents(input.operationalRevenue);
  const direct = toCents(input.directCosts);
  const allocated = toCents(input.allocatedFixedCosts ?? 0);
  const directContribution = revenue - direct;
  const fullEstimatedMargin = directContribution - allocated;
  return {
    directContribution: fromCents(directContribution),
    fullEstimatedMargin: fromCents(fullEstimatedMargin),
    marginPercent: revenue > 0 ? roundMoney((fullEstimatedMargin / revenue) * 100) : 0,
  };
}

export function calculateGlobalOperatingResult(input: GlobalResultInput): number {
  return fromCents(
    toCents(input.operationalRevenue)
      + toCents(input.oneOffRevenue ?? 0)
      - toCents(input.directCosts)
      - toCents(input.fixedCosts)
      - toCents(input.otherExpenses ?? 0)
      - toCents(input.proLabore),
  );
}

export function calculateBreakEvenRevenue(
  fixedCosts: number,
  proLabore: number,
  averageDirectCostRate: number,
): number {
  const rate = normalizeTaxRate(averageDirectCostRate);
  const baseCents = toCents(Math.max(0, fixedCosts) + Math.max(0, proLabore));
  return fromCents(Math.round(baseCents / (1 - rate)));
}

/**
 * Allocates a managerial view of fixed costs. The allocated values must never
 * be subtracted again from the global result, where fixed costs are deducted once.
 */
export function allocateFixedCosts(
  items: AllocationItem[],
  fixedCosts: number,
  method: AllocationMethod,
): AllocationResult[] {
  if (items.length === 0) return [];
  const totalCents = Math.max(0, toCents(fixedCosts));
  if (method === "none" || totalCents === 0) {
    return items.map((item) => ({ ...item, allocatedFixedCosts: 0 }));
  }

  let weights: number[];
  if (method === "equal") {
    weights = items.map(() => 1);
  } else if (method === "revenue") {
    weights = items.map((item) => Math.max(0, toCents(item.operationalRevenue)));
  } else {
    weights = items.map((item) => Math.max(0, item.customShare ?? 0));
  }

  let weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) {
    weights = items.map(() => 1);
    weightTotal = items.length;
  }

  let allocatedCents = 0;
  return items.map((item, index) => {
    const cents = index === items.length - 1
      ? totalCents - allocatedCents
      : Math.round((totalCents * weights[index]) / weightTotal);
    allocatedCents += cents;
    return { ...item, allocatedFixedCosts: fromCents(cents) };
  });
}
