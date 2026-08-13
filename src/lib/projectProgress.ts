/**
 * Como mostrar o andamento de um projeto.
 *
 * Porcentagem só faz sentido em trabalho com fim: um site, uma identidade, um
 * pacote avulso. Em contrato recorrente não existe "80% de social media" - o
 * que importa é o ritmo do ciclo atual: quanto já foi entregue no mês, o que
 * ainda está em pé e qual é a próxima entrega.
 *
 * Regra: billing_mode 'one_off' usa porcentagem; 'included' (parte do plano
 * recorrente) usa ritmo do ciclo.
 */

export interface ProgressProject {
  id: string;
  billing_mode?: string | null;
  project_type?: string | null;
  progress?: number | null;
  status?: string | null;
}

export interface ProgressTask {
  project_id?: string | null;
  status?: string | null;
  due_date?: string | null;
  title?: string | null;
  deleted_at?: string | null;
}

export type ProgressView =
  | { mode: "percent"; percent: number }
  | {
      mode: "cycle";
      done: number;
      total: number;
      label: string;
      nextTitle: string | null;
      nextDate: string | null;
    };

const DONE_STATUSES = new Set(["done", "completed", "concluido", "concluído", "delivered"]);

export function usesPercentProgress(project: ProgressProject | null | undefined) {
  if (!project) return true;
  // Projeto avulso tem começo, meio e fim: a barra representa algo real.
  return (project.billing_mode || "one_off") === "one_off";
}

function monthBounds(reference: Date) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildProgressView(
  project: ProgressProject,
  tasks: readonly ProgressTask[] = [],
  reference: Date = new Date(),
): ProgressView {
  if (usesPercentProgress(project)) {
    const raw = Number(project.progress);
    const percent = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 0;
    return { mode: "percent", percent };
  }

  const { start, end } = monthBounds(reference);
  const projectTasks = tasks.filter(
    (task) => task.project_id === project.id && !task.deleted_at,
  );

  const inMonth = projectTasks.filter((task) => {
    const due = parseDate(task.due_date);
    return due !== null && due >= start && due <= end;
  });

  const done = inMonth.filter((task) =>
    DONE_STATUSES.has((task.status || "").toLowerCase()),
  ).length;
  const total = inMonth.length;

  const pending = projectTasks
    .filter((task) => !DONE_STATUSES.has((task.status || "").toLowerCase()))
    .map((task) => ({ task, due: parseDate(task.due_date) }))
    .filter((entry) => entry.due !== null && entry.due >= start)
    .sort((left, right) => left.due!.getTime() - right.due!.getTime());

  const next = pending[0] || null;

  const pendingCount = projectTasks.filter(
    (task) => !DONE_STATUSES.has((task.status || "").toLowerCase()),
  ).length;

  const label =
    total > 0
      ? `${done} de ${total} entregas do mês`
      : done > 0
        ? `${done} entrega(s) concluída(s) no mês`
        : pendingCount > 0
          ? `${pendingCount} entrega(s) em produção`
          : "Ciclo em andamento";

  return {
    mode: "cycle",
    done,
    total,
    label,
    nextTitle: next?.task.title || null,
    nextDate: next?.due ? next.due.toISOString().slice(0, 10) : null,
  };
}

/** Percentual do ciclo apenas para desenhar a barra; nunca exibido como número. */
export function cycleFillPercent(view: ProgressView) {
  if (view.mode === "percent") return view.percent;
  if (view.total <= 0) return 0;
  return Math.round((view.done / view.total) * 100);
}
