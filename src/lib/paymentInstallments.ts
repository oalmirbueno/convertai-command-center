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
