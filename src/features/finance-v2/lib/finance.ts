import type {
  CashFlowItem,
  ClientSubscription,
  FinanceClient,
  FixedCost,
  FlowBasis,
  FlowTotals,
  Money,
} from "../types";

const cents = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100);
const fromCents = (value: number) => Math.round(value) / 100;

export const addMoney = (...values: number[]): Money =>
  fromCents(values.reduce((sum, value) => sum + cents(value), 0));

export const subtractMoney = (left: number, right: number): Money =>
  fromCents(cents(left) - cents(right));

export const formatCurrency = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

export const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(value.slice(0, 10) + "T00:00:00Z"),
      )
    : "Sem data";

export const parseCurrencyInput = (raw: string): Money => {
  const cleaned = raw.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? fromCents(cents(parsed)) : 0;
};

export const clampBillingDay = (day: number) =>
  Math.min(28, Math.max(1, Math.trunc(Number.isFinite(day) ? day : 1)));

export const computeMarginPercent = (revenue: number, cost: number) =>
  revenue <= 0
    ? 0
    : Math.round(((revenue - cost) / revenue) * 10_000) / 100;

export const netAfterTax = (gross: number, taxPercent: number): Money =>
  fromCents(cents(gross * (1 - Math.min(100, Math.max(0, taxPercent)) / 100)));

export const grossUp = (desiredNet: number, taxPercent: number): Money => {
  const rate = Math.min(100, Math.max(0, taxPercent)) / 100;
  return rate >= 1 ? 0 : fromCents(cents(desiredNet / (1 - rate)));
};

export const monthlyEquivalent = (
  cost: Pick<FixedCost, "amount" | "frequency">,
): Money => {
  const factor = {
    monthly: 1,
    quarterly: 1 / 3,
    semiannual: 1 / 6,
    annual: 1 / 12,
  }[cost.frequency];
  return fromCents(cents(cost.amount * factor));
};

export const currentMonthRange = (today = new Date()) => {
  const local = (date: Date) =>
    String(date.getFullYear()) +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");
  return {
    start: local(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: local(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
};

export const flowFor = (rows: CashFlowItem[], basis: FlowBasis) =>
  rows.filter((row) => row.basis === basis);

export const flowTotals = (rows: CashFlowItem[]): FlowTotals => {
  const income = addMoney(
    ...rows.filter((row) => row.type === "income").map((row) => row.amount),
  );
  const out = addMoney(
    ...rows.filter((row) => row.type === "expense").map((row) => row.amount),
  );
  return { in: income, out, net: subtractMoney(income, out) };
};

export const buildCashFlowSeries = (rows: CashFlowItem[]) => {
  const grouped = new Map<
    string,
    { income: number[]; expense: number[] }
  >();
  for (const row of rows) {
    const current = grouped.get(row.date) ?? { income: [], expense: [] };
    current[row.type].push(row.amount);
    grouped.set(row.date, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => {
      const income = addMoney(...values.income);
      const expense = addMoney(...values.expense);
      return { date, income, expense, net: subtractMoney(income, expense) };
    });
};

export const subscriptionTotals = (rows: ClientSubscription[]) => {
  const active = rows.filter((row) => row.status === "active");
  return {
    activeCount: active.length,
    activeMrr: addMoney(...active.map((row) => row.amount)),
    customCount: active.filter((row) => row.is_custom).length,
    needsReviewCount: rows.filter(
      (row) => row.review_status === "needs_review",
    ).length,
  };
};

export const clientHealth = (client: FinanceClient) =>
  client.billing.overdue > 0
    ? "overdue"
    : client.subscription?.review_status === "needs_review"
      ? "review"
      : client.subscription?.status === "active"
        ? "healthy"
        : "inactive";
