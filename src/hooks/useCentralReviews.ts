import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CentralApproval, ReviewDestination, ReviewDraftEdits, ReviewReport } from "@/lib/centralReview";
import { assertCentralReviewSource, parseCentralReviewSource } from "@/lib/centralReviewSource";

type Reply<T> = { data: T | null; error: { message: string } | null };
type ReviewRpc = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Reply<unknown>> };
const rpcClient = supabase as unknown as ReviewRpc;
type ReviewEventRow = NonNullable<CentralApproval["events"]>[number] & { approval_id: string };
type ReviewTables = { reports: ReviewReport; operator_approvals: CentralApproval; central_review_events: ReviewEventRow };
// Narrow the new schema locally until generated Supabase types include the migration.
type ReviewQuery<T> = PromiseLike<Reply<T[]>> & {
  select: (columns: string) => ReviewQuery<T>;
  update: (values: Record<string, unknown>) => ReviewQuery<T>;
  eq: (column: string, value: unknown) => ReviewQuery<T>;
  in: (column: string, values: readonly string[]) => ReviewQuery<T>;
  not: (column: string, operator: string, value: unknown) => ReviewQuery<T>;
  order: (column: string, options: { ascending: boolean }) => ReviewQuery<T>;
  limit: (count: number) => ReviewQuery<T>;
  maybeSingle: () => PromiseLike<Reply<T>>;
};
const reviewStorage = supabase as unknown as { from: <K extends keyof ReviewTables>(name: K) => ReviewQuery<ReviewTables[K]> };

export async function callReviewRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("O servidor não confirmou a operação. Atualize antes de tentar novamente.");
  return data as T;
}

export function prepareCentralReview(reportId: string, version: number, destination: ReviewDestination, key: string) {
  return callReviewRpc<CentralApproval>("central_review_prepare", {
    _report_id: reportId, _expected_version: version,
    _destination: destination, _idempotency_key: key,
  });
}

export async function saveCentralReviewDraft(report: ReviewReport, edits: ReviewDraftEdits): Promise<ReviewReport> {
  if (report.status !== "draft" || !Number.isInteger(report.review_version)) throw new Error("Somente a versão atual de um rascunho pode ser editada. Atualize a fila.");
  if (!edits.summary.trim()) throw new Error("A mensagem não pode ficar vazia.");
  await assertCentralReviewSource(report.client_id, parseCentralReviewSource(report.metrics?.central_review_source));
  // Both predicates are enforced atomically by PostgreSQL; a concurrent save cannot be overwritten.
  const { data, error } = await reviewStorage.from("reports")
    .update({ summary: edits.summary.trim(), next_steps: edits.next_steps.trim() })
    .eq("id", report.id).eq("client_id", report.client_id).eq("review_version", report.review_version).eq("status", "draft")
    .select("id, client_id, project_id, title, summary, next_steps, highlights, metrics, status, review_version, created_at, period_start, period_end").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("O rascunho mudou enquanto você editava. Recarregue a fila; sua edição não sobrescreveu a outra versão.");
  return data as ReviewReport;
}

export function useCentralReviews(enabled: boolean, focusId: string | null) {
  return useQuery({
    queryKey: ["central-review-approvals", focusId], enabled,
    queryFn: async () => {
      const table = () => reviewStorage.from("operator_approvals");
      const recent = table().select("*").eq("origin", "central").order("created_at", { ascending: false }).limit(200);
      const focused = focusId ? table().select("*").eq("origin", "central").eq("id", focusId).maybeSingle() : Promise.resolve({ data: null, error: null });
      const [list, detail] = await Promise.all([recent, focused]);
      if (list.error || detail.error) throw new Error((list.error || detail.error).message);
      const rows = (list.data ?? []) as CentralApproval[];
      if (detail.data && !rows.some(row => row.id === detail.data.id)) rows.unshift(detail.data as CentralApproval);
      if (rows.length) {
        const events = await reviewStorage.from("central_review_events")
          .select("id, approval_id, event, comment, created_at").in("approval_id", rows.map(row => row.id))
          .not("comment", "is", null).order("created_at", { ascending: false }).limit(500);
        if (events.error) throw new Error(events.error.message);
        for (const row of rows) row.events = (events.data ?? []).filter((event: { approval_id: string }) => event.approval_id === row.id);
      }
      const selected = focusId ? rows.find(row => row.id === focusId) : undefined;
      if (selected) {
        const current = await reviewStorage.from("reports")
          .select("id, client_id, project_id, title, summary, next_steps, highlights, metrics, status, review_version, created_at, period_start, period_end")
          .eq("id", selected.report_id).eq("client_id", selected.client_id).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        selected.current_report = current.data as ReviewReport | null;
      }
      return rows;
    },
    refetchInterval: 20_000,
  });
}
