export type IncomeRollbackTable = "projects" | "project_payments";

interface CompensationInput {
  createdProjectId: string | null;
  createdPaymentId: string | null;
}

type DeleteById = (
  table: IncomeRollbackTable,
  id: string,
) => Promise<{
  error: { message?: string } | null;
  deletedCount: number;
}>;

export async function compensateNewIncome(
  { createdProjectId, createdPaymentId }: CompensationInput,
  deleteById: DeleteById,
) {
  // Um projeto criado por este fluxo é o agregado raiz: suas tarefas,
  // milestones, updates e pagamentos usam FKs com ON DELETE CASCADE.
  const target = createdProjectId
    ? { table: "projects" as const, id: createdProjectId }
    : createdPaymentId
      ? { table: "project_payments" as const, id: createdPaymentId }
      : null;

  if (!target) return;

  const { error, deletedCount } = await deleteById(target.table, target.id);
  if (error) {
    throw new Error(error.message || "Não foi possível desfazer o lançamento incompleto");
  }
  if (deletedCount !== 1) {
    throw new Error("A compensação não confirmou a remoção do lançamento incompleto");
  }
}
