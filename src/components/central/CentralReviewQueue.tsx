import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callReviewRpc, prepareCentralReview, saveCentralReviewDraft, useCentralReviews } from "@/hooks/useCentralReviews";
import { centralReviewError, centralReviewLink, latestReviewReports, reviewAlerts, reviewContentComplete, reviewDecisionArgs, reviewLane } from "@/lib/centralReview";
import type { CentralApproval, ReviewClient, ReviewDecision, ReviewDestination, ReviewDraftEdits, ReviewLane, ReviewReport } from "@/lib/centralReview";
import { SERVICE_LABELS } from "@/lib/cycleDefs";

const LANES: { value: ReviewLane; label: string }[] = [
  { value: "decisao", label: "Precisa decisão" }, { value: "revisar", label: "Pronto para revisar" }, { value: "aguardando", label: "Aguardando" },
];
const STATUS: Record<string, string> = { pendente: "Preparado · aguardando revisão", aprovado: "Aprovado · envio não realizado", rejeitado: "Rejeitado", alteracoes_pedidas: "Ajuste solicitado", adiado: "Adiado", expirado: "Desatualizado · nova revisão necessária" };
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Não registrado";
const detailText = (value: unknown) => typeof value === "string" && value.trim() ? value : Array.isArray(value) ? value.filter(item => typeof item === "string").join("\n") : "";

export interface CentralReviewQueueProps {
  reports: readonly ReviewReport[]; clients: readonly ReviewClient[]; isAdmin: boolean;
  onRefresh: () => void | Promise<unknown>;
}

export default function CentralReviewQueue({ reports, clients, isAdmin, onRefresh }: CentralReviewQueueProps) {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("review");
  const queryClient = useQueryClient();
  const query = useCentralReviews(isAdmin, focusId);
  const [lane, setLane] = useState<ReviewLane>("decisao");
  const [clientId, setClientId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const busy = useRef(false);
  const keys = useRef(new Map<string, string>());
  const keyFor = (command: string) => {
    let key = keys.current.get(command);
    if (!key) { key = crypto.randomUUID(); keys.current.set(command, key); }
    return key;
  };
  const approvals = query.data ?? [];
  const latest = new Map<string, CentralApproval>();
  for (const approval of approvals) if (!latest.has(approval.report_id)) latest.set(approval.report_id, approval);
  const cards = latestReviewReports(reports);
  const focused = focusId ? approvals.find(item => item.id === focusId) : undefined;
  const focusedReport = focused?.payload?.report;
  // An authenticated link resolves historical decisions independently of the current queue.
  const visible = focusId ? (focusedReport ? [{ report: focusedReport, approval: focused }] : [])
    : cards.filter(report => (!clientId || report.client_id === clientId) && reviewLane(report, latest.get(report.id)) === lane)
      .map(report => ({ report, approval: latest.get(report.id) }));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["central-review-approvals"] }),
      queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] }),
      Promise.resolve(onRefresh()),
    ]);
  };
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busy.current) return false;
    busy.current = true; setBusyId(id); setOperationError(null);
    try { await action(); await refresh(); return true; }
    catch (error) { const message = centralReviewError(error); setOperationError(message); toast.error(message); return false; }
    finally { busy.current = false; setBusyId(null); }
  };
  const prepare = (report: ReviewReport, destination: ReviewDestination) => run(report.id, async () => {
    if (!Number.isInteger(report.review_version)) throw new Error("Atualize o painel: a versão deste rascunho não foi carregada.");
    if (!reviewContentComplete(report)) throw new Error("Registre a mensagem e o próximo passo no rascunho antes de preparar.");
    if (!destination.recipient.trim()) throw new Error("Informe o destinatário antes de preparar o pedido.");
    const key = keyFor(JSON.stringify(["prepare", report.id, report.review_version, destination, latest.get(report.id)?.id ?? null]));
    const prepared = await prepareCentralReview(report.id, report.review_version!, destination, key);
    if (focusId) { const next = new URLSearchParams(params); next.set("review", prepared.id); setParams(next); }
    toast.success("Pedido preparado. Confira a versão e o destino antes de aprovar.");
  });
  const decide = (approval: CentralApproval, decision: ReviewDecision, comment: string) => run(approval.report_id, async () => {
    const key = keyFor(JSON.stringify(["decide", approval.id, approval.payload_hash, decision, comment.trim()]));
    await callReviewRpc("central_review_decide", reviewDecisionArgs(approval, decision, comment, key));
    toast.success(decision === "comentario" ? "Comentário registrado." : "Decisão registrada. Nenhuma mensagem foi enviada.");
  });
  const save = (report: ReviewReport, edits: ReviewDraftEdits) => run(report.id, async () => {
    await saveCentralReviewDraft(report, edits);
    toast.success("Rascunho salvo. A alteração exige um novo pedido de revisão desta versão.");
  });

  if (!isAdmin) return null;
  return <section aria-label="Revisão por cliente" className="mb-6 space-y-3">
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">Revisão por cliente e ritual</h2>
      <p className="mt-1 text-sm text-muted-foreground">Confira a mensagem, a base usada e o destinatário. A revisão de materiais e a aprovação do cliente continuam no fluxo de conteúdo.</p>
      <p className="mt-2 text-xs text-muted-foreground">WhatsApp: use o link autenticado deste pedido. Envio automático e respostas nativas dependem de conexão validada.</p>
      {focusId && <button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete("review"); setParams(next); }} className="mt-2 rounded border px-3 py-2 text-sm">Voltar à fila</button>}
      {!focusId && <div className="mt-3 flex flex-wrap gap-2">
        {LANES.map(item => <button key={item.value} type="button" aria-pressed={lane === item.value} onClick={() => setLane(item.value)} className={`rounded-lg border px-3 py-2 text-sm ${lane === item.value ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
          {item.label} ({cards.filter(report => reviewLane(report, latest.get(report.id)) === item.value).length})
        </button>)}
        <select aria-label="Filtrar revisão por cliente" value={clientId} onChange={event => setClientId(event.target.value)} className="rounded-lg border bg-card px-2 py-2 text-sm">
          <option value="">Todos os clientes</option>
          {clients.map(client => <option key={client.id} value={client.id}>{client.company_name || client.full_name || "Cliente"}</option>)}
        </select>
      </div>}
    </div>
    {query.isLoading && <p role="status">Carregando pedidos de revisão…</p>}
    {operationError && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">{operationError}</p>}
    {query.error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">Não foi possível carregar a revisão. {query.error.message} <button type="button" onClick={() => void query.refetch()} className="underline">Tentar novamente</button></p>}
    {!query.isLoading && !query.error && visible.length === 0 && <p className="p-3 text-sm text-muted-foreground">{focusId ? "Pedido não encontrado ou sem acesso para esta conta." : "Nenhum pacote nesta fila. Gere um ritual com o dossiê atualizado para começar."}</p>}
    {visible.map(({ report, approval }) => {
      const currentReport = reports.find(item => item.id === report.id) ?? approval?.current_report;
      const current = approval?.current_report && (approval.current_report.review_version ?? 0) >= (currentReport?.review_version ?? 0) ? approval.current_report : currentReport;
      return <ReviewCard key={`${approval?.id ?? report.id}:${approval?.payload_hash ?? ""}`} report={report} currentReport={current ?? undefined} historical={!!focusId} approval={approval} client={clients.find(client => client.id === report.client_id)} busy={busyId === report.id} disabled={!!query.error || !!busyId} onPrepare={prepare} onDecide={decide} onSave={save} />;
    })}
  </section>;
}

function ReviewCard({ report, currentReport, historical, approval, client, busy, disabled, onPrepare, onDecide, onSave }: {
  report: ReviewReport; currentReport?: ReviewReport; historical: boolean; approval?: CentralApproval; client?: ReviewClient; busy: boolean; disabled: boolean;
  onPrepare: (report: ReviewReport, destination: ReviewDestination) => Promise<boolean>;
  onDecide: (approval: CentralApproval, decision: ReviewDecision, comment: string) => Promise<boolean>;
  onSave: (report: ReviewReport, edits: ReviewDraftEdits) => Promise<boolean>;
}) {
  const [comment, setComment] = useState("");
  const [reviewedIdentity, setReviewedIdentity] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReviewDestination["channel"]>(approval?.payload.destination.channel ?? "portal");
  const [recipient, setRecipient] = useState(approval?.payload.destination.recipient ?? "");
  const [editingReport, setEditingReport] = useState<ReviewReport | null>(null);
  const editing = editingReport !== null;
  const [edits, setEdits] = useState<ReviewDraftEdits>({ summary: currentReport?.summary ?? "", next_steps: currentReport?.next_steps ?? "" });
  const sameVersion = !!currentReport && approval?.payload_version === currentReport.review_version;
  const reviewIdentity = [approval?.id, approval?.payload_hash, currentReport?.review_version].join(":");
  const reviewed = reviewedIdentity === reviewIdentity;
  const showingSnapshot = !!approval && (historical || sameVersion);
  const frozen = showingSnapshot ? approval!.payload.report : report;
  const source = showingSnapshot ? approval?.payload.source : (report.metrics?.central_review_source as Record<string, unknown> | undefined);
  const destination = approval?.payload.destination;
  const alerts = reviewAlerts(frozen);
  const expired = !!approval?.valid_until && Date.parse(approval.valid_until) <= Date.now();
  const decidable = approval && sameVersion && currentReport?.status === "draft" && !expired && ["pendente", "adiado"].includes(approval.status);
  const editable = currentReport?.status === "draft" && Number.isInteger(currentReport.review_version);
  const preparable = editable && (!approval || !sameVersion || expired || ["expirado", "rejeitado", "alteracoes_pedidas"].includes(approval.status));
  const scope = showingSnapshot ? approval?.payload.scope : undefined;
  const services = scope?.service_keys ?? Object.entries(client?.services_config && typeof client.services_config === "object" ? client.services_config : {}).filter(([, value]) => value === true).map(([key]) => key);
  const planName = scope ? scope.plan_name : client?.plan_name;
  const saveEdits = async () => { if (editingReport && await onSave(editingReport, edits)) { setEditingReport(null); setReviewedIdentity(null); } };
  const copyLink = async () => {
    if (!approval) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${centralReviewLink(approval.id)}`); toast.success("Link copiado. Ele exige login administrativo."); }
    catch { toast.error("Não foi possível copiar o link."); }
  };
  return <article className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label={`Revisão de ${client?.company_name || client?.full_name || report.client_id}`}>
    <header><p className="text-xs text-muted-foreground">{client?.company_name || client?.full_name || report.client_id} · {text(frozen.metrics?.ritual_type)} · versão {showingSnapshot ? approval?.payload_version : report.review_version ?? "não carregada"}</p>
      <h3 className="mt-1 font-semibold">{frozen.title}</h3><p className="text-xs mt-1">{approval ? STATUS[approval.status] || approval.status : "Rascunho · pedido ainda não preparado"}</p></header>
    {approval && !sameVersion && <p role="note" className="text-sm text-warning">Este pedido corresponde a outra versão. {currentReport ? `A versão atual é ${currentReport.review_version}. Prepare um novo pedido após conferir a edição.` : "A versão atual não está disponível; atualize a fila antes de decidir."}</p>}
    {expired && <p role="note" className="text-sm text-warning">O prazo deste pedido venceu. Prepare uma nova revisão para conferir a fonte e o destinatário novamente.</p>}
    <div className="text-sm"><h4 className="text-xs font-semibold uppercase">{scope ? "Plano e frentes deste pedido" : "Plano e frentes no cadastro atual"}</h4><p>{planName || "Plano não registrado"} · {services.length ? services.map(key => SERVICE_LABELS[key] ?? key).join(" · ") : "Frentes não registradas"}</p></div>
    {alerts.length > 0 && <div role="note" className="rounded-lg border border-warning p-3 text-sm"><strong>Pontos que precisam de decisão</strong><ul className="list-disc pl-5">{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul></div>}
    <div><h4 className="text-xs font-semibold uppercase">Mensagem preparada</h4><p className="mt-1 whitespace-pre-wrap text-sm">{frozen.summary || "Mensagem ausente: volte ao rascunho antes de aprovar."}</p></div>
    <div><h4 className="text-xs font-semibold uppercase">Próximo passo e expectativa</h4><p className="mt-1 whitespace-pre-wrap text-sm">{frozen.next_steps || "Próximo passo ausente. Edite o rascunho e registre a próxima ação antes de preparar ou aprovar."}</p></div>
    {editable && !editing && <button type="button" disabled={disabled} onClick={() => { setEdits({ summary: currentReport!.summary ?? "", next_steps: currentReport!.next_steps ?? "" }); setReviewedIdentity(null); setEditingReport(currentReport!); }} className="rounded border px-3 py-2 text-sm">Editar rascunho atual</button>}
    {editing && <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm">Editando a versão {editingReport.review_version}. Salvar invalida a aprovação deste item; depois prepare uma nova revisão.</p>
      {editingReport.review_version !== currentReport?.review_version && <p role="note" className="text-sm text-warning">Outra versão chegou durante a edição. Seu texto foi preservado, mas não pode sobrescrever a versão nova.</p>}
      <label className="block text-xs">Mensagem do rascunho<textarea value={edits.summary} onChange={event => setEdits(previous => ({ ...previous, summary: event.target.value }))} rows={5} className="mt-1 w-full rounded border bg-card p-2 text-sm" /></label>
      <label className="block text-xs">Próximo passo do rascunho<textarea value={edits.next_steps} onChange={event => setEdits(previous => ({ ...previous, next_steps: event.target.value }))} rows={3} className="mt-1 w-full rounded border bg-card p-2 text-sm" /></label>
      <div className="flex gap-2"><button type="button" disabled={disabled || editingReport.review_version !== currentReport?.review_version || !edits.summary.trim() || (edits.summary.trim() === editingReport.summary?.trim() && edits.next_steps.trim() === editingReport.next_steps?.trim())} onClick={() => void saveEdits()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Salvando…" : "Salvar rascunho"}</button><button type="button" disabled={disabled} onClick={() => setEditingReport(null)} className="rounded border px-3 py-2 text-sm">Cancelar edição</button></div>
    </div>}
    <details className="text-sm"><summary className="cursor-pointer font-medium">Base, período e detalhes da revisão</summary>
      <dl className="mt-2 grid gap-2 text-xs">
        <div><dt className="font-semibold">Dossiê usado</dt><dd>Versão {text(source?.dossier_version)} · {text(source?.dossier_updated_at)} · referência {text(source?.dossier_id)}</dd></div>
        <div><dt className="font-semibold">Escopo do cliente</dt><dd className="break-all">Identidade da fonte: {text(source?.scope_hash)}. Conferir todas as frentes contratadas no dossiê e no plano.</dd></div>
        <div><dt className="font-semibold">Período</dt><dd>{frozen.period_start || "Não registrado"} até {frozen.period_end || "Não registrado"}</dd></div>
        <div><dt className="font-semibold">Geração</dt><dd>{text(frozen.metrics?.central_review_generated_at)}</dd></div>
        {[["Entregas e mudanças", frozen.highlights || frozen.metrics?.entregas], ["Pendências", frozen.metrics?.pendencias], ["Objetivo/meta", frozen.metrics?.objetivo ?? frozen.metrics?.meta]].map(([label, value]) => <div key={String(label)}><dt className="font-semibold">{String(label)}</dt><dd className="whitespace-pre-wrap">{detailText(value) || "Não registrado separadamente. Confira a mensagem e o plano antes de decidir."}</dd></div>)}
        {approval?.decision_note && <div><dt className="font-semibold">Último comentário da decisão</dt><dd className="whitespace-pre-wrap">{approval.decision_note}</dd></div>}
        {!!approval?.events?.length && <div><dt className="font-semibold">Comentários registrados</dt><dd><ul className="space-y-2">{approval.events.map(event => <li key={event.id}><time dateTime={event.created_at}>{event.created_at}</time><p className="whitespace-pre-wrap">{event.comment}</p></li>)}</ul></dd></div>}
      </dl>
    </details>
    {destination && <p className="text-sm"><strong>Destino congelado:</strong> {destination.channel === "portal" ? "Portal do cliente" : "WhatsApp"} · {destination.recipient}</p>}
    {preparable && !editing && <div className="flex flex-wrap gap-2">
        <label className="text-xs">Canal<select value={channel} onChange={event => setChannel(event.target.value as ReviewDestination["channel"])} className="block rounded border bg-card p-2"><option value="portal">Portal do cliente</option><option value="whatsapp">WhatsApp — destino a confirmar</option></select></label>
        {channel === "whatsapp" && <label className="text-xs flex-1">Destinatário identificado<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Identificação exata do grupo ou destinatário" className="block w-full rounded border bg-card p-2" /></label>}
        <button type="button" disabled={disabled || !reviewContentComplete(currentReport!) || (channel === "whatsapp" && !recipient.trim())} onClick={() => void onPrepare(currentReport!, { channel, recipient: channel === "portal" ? currentReport!.client_id : recipient.trim() })} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Preparando…" : "Preparar pedido desta versão"}</button>
      </div>}
    {approval && <>
      <label className="block text-xs">Comentário<textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={4000} className="mt-1 w-full rounded border bg-card p-2 text-sm" /></label>
      {decidable && <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewedIdentity(event.target.checked ? reviewIdentity : null)} />Conferi esta versão, as fontes, os alertas e o destinatário.</label>}
      <div className="flex flex-wrap gap-2">
        {decidable && <><button type="button" disabled={disabled || editing || !reviewed || !reviewContentComplete(frozen)} onClick={() => void onDecide(approval, "aprovado", comment)} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Aprovar esta versão</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "alteracoes_pedidas", comment)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Pedir ajuste</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "rejeitado", comment)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Rejeitar</button></>}
        <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "comentario", comment)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Comentar</button>
        <button type="button" onClick={() => void copyLink()} className="rounded border px-3 py-2 text-sm">Copiar link autenticado</button>
      </div>
      <p className="text-xs text-muted-foreground">A decisão fica neste mesmo pedido, independentemente de onde o link foi aberto. Aprovação não comprova publicação ou envio.</p>
    </>}
  </article>;
}
