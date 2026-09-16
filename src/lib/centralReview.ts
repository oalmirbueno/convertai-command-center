export type ReviewDecision = "aprovado" | "rejeitado" | "alteracoes_pedidas" | "comentario";
export type ReviewLane = "decisao" | "revisar" | "aguardando" | "enviado";
export interface ReviewReport {
  id: string; client_id: string; project_id?: string | null; title: string;
  summary?: string | null; next_steps?: string | null; highlights?: string | null; created_at: string;
  period_start?: string | null; period_end?: string | null;
  review_version?: number; status?: string; metrics?: Record<string, unknown> | null;
}
export interface ReviewDestination { channel: "portal" | "whatsapp"; recipient: string }
export interface CentralApproval {
  id: string; report_id: string; client_id: string; payload_version: number;
  payload_hash: string; status: string; created_at: string; decision_note?: string | null;
  valid_until?: string | null;
  /** Envio registrado (pelo painel ou pelo Hermes). Sem isto, a mensagem conta como nao enviada. */
  executed_at?: string | null; execution_evidence?: string | null;
  current_report?: ReviewReport | null;
  events?: { id: string; event: string; comment?: string | null; created_at: string }[];
  payload: { report: ReviewReport; destination: ReviewDestination; source?: Record<string, unknown>; scope?: { plan_name?: string | null; service_keys?: string[] } };
}
export interface ReviewClient { id: string; company_name?: string | null; full_name?: string | null; plan_name?: string | null; services_config?: unknown }
export interface ReviewDraftEdits { summary: string; next_steps: string }

/** PostgreSQL date_trunc('week', created_at AT TIME ZONE 'UTC') starts on Monday. */
function reviewWeek(createdAt: string): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return createdAt;
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

/** Only presentation grouping. The database independently validates the approved version. */
export function latestReviewReports(reports: readonly ReviewReport[]): ReviewReport[] {
  const grouped = new Map<string, ReviewReport>();
  for (const report of reports) {
    if (!report.metrics?.central_review_source) continue;
    const key = [report.client_id, report.metrics.ritual_type, report.period_start ?? reviewWeek(report.created_at), report.period_end].join(":");
    const previous = grouped.get(key);
    if (!previous || report.created_at > previous.created_at || (report.created_at === previous.created_at && report.id > previous.id)) grouped.set(key, report);
  }
  return [...grouped.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function reviewAlerts(report: ReviewReport): string[] {
  const alerts = report.metrics?.alertas;
  return Array.isArray(alerts) ? alerts.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
}

export function reviewLane(report: ReviewReport, approval?: CentralApproval): ReviewLane {
  // Enviado e o fim da linha: a mensagem chegou ao cliente e o registro diz quando.
  if (approval?.executed_at) return "enviado";
  if (approval && approval.payload_version !== report.review_version) return "decisao";
  if (approval?.valid_until && Date.parse(approval.valid_until) <= Date.now()) return "decisao";
  if (approval && ["aprovado", "adiado"].includes(approval.status)) return "aguardando";
  if (approval && ["rejeitado", "alteracoes_pedidas", "expirado"].includes(approval.status)) return "decisao";
  return reviewAlerts(report).length || !report.summary?.trim() || !report.next_steps?.trim() ? "decisao" : "revisar";
}

export function reviewContentComplete(report: Pick<ReviewReport, "summary" | "next_steps">): boolean {
  return !!report.summary?.trim() && !!report.next_steps?.trim();
}

export function centralReviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Não foi possível confirmar a operação.";
  if (message.includes("CENTRAL_SOURCE_STALE")) return "O contexto ou o plano do cliente mudou. Gere uma nova prévia com a fonte atual antes de preparar ou aprovar. Editar o texto não atualiza a fonte.";
  if (/CENTRAL_(REPORT_VERSION_CONFLICT|ALREADY_DECIDED|APPROVAL_EXPIRED)/.test(message)) return "Este pedido foi alterado, decidido ou venceu. Atualize a revisão para conferir a versão atual.";
  if (message.includes("CENTRAL_NEXT_STEPS_REQUIRED")) return "Registre o próximo passo no rascunho antes de preparar ou aprovar.";
  if (message.includes("CENTRAL_SUMMARY_REQUIRED")) return "Registre a mensagem no rascunho antes de preparar ou aprovar.";
  return message;
}

export function centralReviewLink(id: string): string {
  return `/ciclo/revisao?review=${encodeURIComponent(id)}`;
}

export function reviewDecisionArgs(approval: CentralApproval, decision: ReviewDecision, comment: string, idempotencyKey: string) {
  if (!approval.id || !approval.client_id || !approval.payload_hash || !Number.isInteger(approval.payload_version)) throw new Error("Pedido sem identidade completa. Atualize a revisão.");
  if (decision !== "comentario" && !["pendente", "adiado"].includes(approval.status)) throw new Error("Este pedido já foi decidido. Atualize a revisão.");
  if (decision === "aprovado" && !reviewContentComplete(approval.payload.report)) throw new Error("Registre a mensagem e o próximo passo no rascunho antes de aprovar.");
  if (["rejeitado", "alteracoes_pedidas", "comentario"].includes(decision) && !comment.trim()) throw new Error("Escreva um comentário para explicar a decisão.");
  return {
    _approval_id: approval.id, _expected_client_id: approval.client_id,
    _expected_version: approval.payload_version, _expected_payload_hash: approval.payload_hash,
    _decision: decision, _comment: comment.trim() || null, _idempotency_key: idempotencyKey,
  };
}
