import type { Database } from "@/integrations/supabase/types";

export type PaymentInstallmentInsert =
  Database["public"]["Tables"]["payment_installments"]["Insert"];

interface BuildInstallmentsInput {
  paymentId: string;
  total: number;
  installmentsCount: number;
  firstDueDate: string;
  paidInstallments: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addMonthsClamped(isoDate: string, monthsToAdd: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  return [
    targetYear.toString().padStart(4, "0"),
    (normalizedMonthIndex + 1).toString().padStart(2, "0"),
    targetDay.toString().padStart(2, "0"),
  ].join("-");
}

export function splitAmount(total: number, installmentsCount: number) {
  const normalizedTotal = normalizeMoney(total);
  if (!Number.isFinite(normalizedTotal) || normalizedTotal <= 0) {
    throw new Error("O valor total deve ser maior que zero");
  }
  if (!Number.isInteger(installmentsCount) || installmentsCount < 1) {
    throw new Error("A quantidade de parcelas deve ser um número inteiro positivo");
  }

  const totalCents = Math.round(normalizedTotal * 100);
  const regularCents = Math.floor(totalCents / installmentsCount);
  const amounts = Array.from(
    { length: installmentsCount },
    () => regularCents / 100,
  );

  amounts[amounts.length - 1] =
    (totalCents - regularCents * (installmentsCount - 1)) / 100;

  return amounts;
}

export function normalizeMoney(value: number) {
  if (!Number.isFinite(value)) throw new Error("Informe um valor total válido");

  const cents = Math.round((value + Number.EPSILON) * 100);
  if (cents < 1) throw new Error("O valor total mínimo é R$ 0,01");

  return cents / 100;
}

export function buildPaymentInstallments({
  paymentId,
  total,
  installmentsCount,
  firstDueDate,
  paidInstallments,
}: BuildInstallmentsInput): PaymentInstallmentInsert[] {
  if (!paymentId) throw new Error("Pagamento inválido");
  if (!ISO_DATE_PATTERN.test(firstDueDate)) throw new Error("Data de pagamento inválida");

  const amounts = splitAmount(total, installmentsCount);
  const paidCount = Math.min(Math.max(Math.trunc(paidInstallments), 0), installmentsCount);

  return amounts.map((amount, index) => {
    const installmentNumber = index + 1;
    const dueDate = addMonthsClamped(firstDueDate, index);
    const isPaid = installmentNumber <= paidCount;

    return {
      payment_id: paymentId,
      installment_number: installmentNumber,
      amount,
      due_date: dueDate,
      status: isPaid ? "paid" : "pending",
      paid_amount: isPaid ? amount : null,
      // Para registros históricos, a data informada (ou o vencimento de cada
      // parcela) é a melhor evidência disponível; nunca inventamos "hoje".
      paid_date: isPaid ? dueDate : null,
      description:
        installmentsCount === 1
          ? "Pagamento à vista"
          : `Parcela ${installmentNumber}/${installmentsCount}`,
    };
  });
}

interface PlanoComEntradaInput {
  paymentId: string;
  total: number;
  /** Valor livre da entrada em R$ (0 = sem entrada). */
  entrada: number;
  entradaEm: string;
  entradaPaga: boolean;
  /** Em quantas parcelas fica o restante. */
  parcelas: number;
  primeiraEm: string;
  /** Quantas das parcelas do restante já foram pagas (lançamento de histórico). */
  parcelasPagas?: number;
}

/**
 * Entrada de qualquer valor mais o restante em N parcelas (16/11/2026, pedido do dono: "poder colocar o
 * valor que deu de entrada e quantos restou; fazendo a conta geral tira a liberdade"). A entrada é a
 * parcela 0; o restante é dividido em partes iguais e o centavo que sobra vai na última.
 */
export function buildPlanoComEntrada({
  paymentId,
  total,
  entrada,
  entradaEm,
  entradaPaga,
  parcelas,
  primeiraEm,
  parcelasPagas = 0,
}: PlanoComEntradaInput): PaymentInstallmentInsert[] {
  if (!paymentId) throw new Error("Pagamento inválido");
  const totalCents = Math.round(normalizeMoney(total) * 100);
  const entradaCents = Math.round((Number(entrada) || 0) * 100);
  if (entradaCents < 0) throw new Error("A entrada não pode ser negativa");
  if (entradaCents > totalCents) throw new Error("A entrada é maior que o valor total");
  const linhas: PaymentInstallmentInsert[] = [];
  if (entradaCents > 0) {
    if (!ISO_DATE_PATTERN.test(entradaEm)) throw new Error("Data da entrada inválida");
    const valor = entradaCents / 100;
    linhas.push({
      payment_id: paymentId,
      installment_number: 0,
      amount: valor,
      due_date: entradaEm,
      status: entradaPaga ? "paid" : "pending",
      paid_amount: entradaPaga ? valor : null,
      paid_date: entradaPaga ? entradaEm : null,
      description: entradaCents === totalCents ? "Pagamento à vista" : "Entrada",
    });
  }
  const restoCents = totalCents - entradaCents;
  if (restoCents > 0) {
    const resto = buildPaymentInstallments({
      paymentId,
      total: restoCents / 100,
      installmentsCount: Math.max(Math.trunc(parcelas) || 1, 1),
      firstDueDate: primeiraEm,
      paidInstallments: parcelasPagas,
    });
    if (resto.length === 1) resto[0].description = entradaCents > 0 ? "Restante" : "Pagamento à vista";
    linhas.push(...resto);
  }
  return linhas;
}

/** Percentual da entrada sobre o total, só para registro (project_payments.entry_percentage). */
export function percentualDaEntrada(total: number, entrada: number): number {
  if (!(total > 0)) return 0;
  return Math.round((Math.min(Math.max(entrada, 0), total) / total) * 10000) / 100;
}

/** Lê o valor digitado: aceita "3.000", "3.000,50", "3000,50" e "3000.50". */
export function lerValorBR(t: string | number | null | undefined): number {
  const v = String(t ?? "").trim();
  if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", ".")) || 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, "")) || 0;
  return Number(v) || 0;
}
