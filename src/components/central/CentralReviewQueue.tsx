import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Users } from "lucide-react";
import { callReviewRpc, prepareCentralReview, saveCentralReviewDraft, useCentralReviews } from "@/hooks/useCentralReviews";
import { centralReviewError, centralReviewLink, latestReviewReports, reviewAlerts, reviewContentComplete, reviewDecisionArgs, reviewLane } from "@/lib/centralReview";
import type { CentralApproval, ReviewClient, ReviewDecision, ReviewDestination, ReviewDraftEdits, ReviewLane, ReviewReport } from "@/lib/centralReview";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { proximoPassoDoTexto } from "@/lib/ritualTexto";
import { AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, Secao, SeletorCompacto, botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { useEstadoDaTela } from "@/components/central/useEstadoDaTela";

const LANES: { value: ReviewLane; label: string }[] = [
  { value: "decisao", label: "Precisa decisão" }, { value: "revisar", label: "Pronto para revisar" }, { value: "aguardando", label: "Aprovados · a enviar" }, { value: "enviado", label: "Enviados" },
];
const STATUS: Record<string, string> = { pendente: "Preparado · aguardando revisão", aprovado: "Aprovado · envio não realizado", rejeitado: "Rejeitado", alteracoes_pedidas: "Ajuste solicitado", adiado: "Adiado", expirado: "Desatualizado · nova revisão necessária" };
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Não registrado";
const detailText = (value: unknown) => typeof value === "string" && value.trim() ? value : Array.isArray(value) ? value.filter(item => typeof item === "string").join("\n") : "";
const quando = (iso?: string | null) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "data não registrada"; };
const viaHermes = (note?: string | null) => typeof note === "string" && note.startsWith("[via Hermes");
function statusLabel(approval: CentralApproval): string {
  if (approval.executed_at) return `Enviado · registrado em ${quando(approval.executed_at)}`;
  return STATUS[approval.status] || approval.status;
}

/** O que a pessoa cola no WhatsApp do Hermes para ele assumir esta área. */
export const PEDIDO_PARA_O_HERMES = [
  "Hermes, assuma a Revisão do Ciclo (/ciclo/revisao) pelo MCP:",
  "1. aceleriq_central_review_fila (operator: default) — leia rascunhos_sem_pedido, esperando_decisao e aprovados_para_enviar.",
  "2. Rascunho sem pedido: revise o texto e prepare com aceleriq_central_review_preparar (channel whatsapp, recipient = nome exato do grupo).",
  "3. Pedido esperando decisão: me mande a mensagem aqui; quando eu responder, registre com aceleriq_central_review_decidir citando minha mensagem como evidence.",
  "4. Aprovado: envie no grupo do cliente e registre com aceleriq_central_review_marcar_enviado com a evidência do envio.",
  "Nunca decida por conta própria e nunca envie sem aprovação registrada.",
].join("\n");

export interface CentralReviewQueueProps {
  reports: readonly ReviewReport[]; clients: readonly ReviewClient[]; isAdmin: boolean;
  onRefresh: () => void | Promise<unknown>;
  /**
   * Chave (useEstadoDaTela da Central, formato tela:v1:) para lembrar a faixa
   * e o cliente escolhidos ao sair e voltar. Sem ela, nada é guardado.
   */
  memoria?: string | null;
}

/*
 * Sistema de design (docs/design/SISTEMA.md, 26/09): a fila é uma seção sem
 * caixa, com o título curto e a explicação no "?". As faixas viram um seletor
 * segmentado (lista no celular), o filtro de cliente um seletor compacto, e os
 * pedidos são linhas de uma lista com divisória, não cartões empilhados.
 * Regras do fluxo (conferência explícita, versão/hash, envio à parte) não mudam.
 */
export default function CentralReviewQueue({ reports, clients, isAdmin, onRefresh, memoria = null }: CentralReviewQueueProps) {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("review");
  const queryClient = useQueryClient();
  const query = useCentralReviews(isAdmin, focusId);
  const [lane, setLane] = useEstadoDaTela<ReviewLane>(memoria ? `${memoria}:faixa` : null, "decisao", (v) => LANES.some(item => item.value === v));
  const [clienteGuardado, setClientId] = useEstadoDaTela<string>(memoria ? `${memoria}:cliente` : null, "", (v) => typeof v === "string");
  // Cliente guardado que não está mais nesta lista (outra carteira, link de um cliente só) vale como "todos".
  const clientId = clients.some(client => client.id === clienteGuardado) ? clienteGuardado : "";
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
  // Envio registrado por quem enviou (a pessoa, aqui). O Hermes registra o dele
  // pelo MCP na mesma tabela; os dois lados leem o mesmo estado.
  const markSent = (approval: CentralApproval, evidence: string) => run(approval.report_id, async () => {
    if (evidence.trim().length < 3) throw new Error("Diga onde e quando enviou (grupo, data e hora) para registrar o envio.");
    const key = keyFor(JSON.stringify(["sent", approval.id, evidence.trim()]));
    await callReviewRpc("central_review_marcar_enviado", { _approval_id: approval.id, _evidence: evidence.trim(), _idempotency_key: key });
    toast.success("Envio registrado. O Hermes vê isso na próxima leitura da fila.");
  });
  const copyHermesRequest = async () => {
    try { await navigator.clipboard.writeText(PEDIDO_PARA_O_HERMES); toast.success("Pedido copiado. Cole no WhatsApp do Hermes."); }
    catch { toast.error("Não foi possível copiar o pedido."); }
  };
  const esperando = approvals.filter(a => ["pendente", "adiado"].includes(a.status) && !a.executed_at && !(a.valid_until && Date.parse(a.valid_until) <= Date.now())).length;
  const aEnviar = approvals.filter(a => a.status === "aprovado" && !a.executed_at).length;
  const enviados = approvals.filter(a => !!a.executed_at).length;
  const ultimosDoHermes = approvals.filter(a => viaHermes(a.decision_note) || (a.executed_at && /pelo Hermes|via Hermes/i.test(a.execution_evidence ?? ""))).slice(0, 3);
  const opcoesDeFaixa = LANES.map(item => ({ valor: item.value, rotulo: item.label, contador: cards.filter(report => reviewLane(report, latest.get(report.id)) === item.value).length }));
  const opcoesDeCliente = [{ valor: "", rotulo: "Todos os clientes" }, ...clients.map(client => ({ valor: client.id, rotulo: client.company_name || client.full_name || "Cliente" }))];

  if (!isAdmin) return null;
  return <section aria-label="Revisão por cliente" className="min-w-0">
    <Secao
      titulo="Revisão por cliente e ritual"
      descricao={focusId ? "Pedido aberto pelo link" : `${esperando} esperando decisão · ${aEnviar} aprovado${aEnviar === 1 ? "" : "s"} a enviar · ${enviados} enviado${enviados === 1 ? "" : "s"}`}
      ajuda={<>Confira a mensagem, a base usada e o destinatário. A revisão de materiais e a aprovação do cliente continuam no fluxo de conteúdo. O Hermes trabalha nesta fila pelo MCP: lê, prepara, registra a sua decisão do WhatsApp e marca o envio. Decidiu aqui? O Hermes vê. Decidiu no WhatsApp do Hermes? Aparece aqui com a sua mensagem como evidência.</>}
      acao={focusId
        ? <button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete("review"); setParams(next); }} className={botao.secundario}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Voltar à fila</button>
        : <button type="button" onClick={() => void copyHermesRequest()} className={botao.secundario} title="Copia o pedido para colar no WhatsApp do Hermes"><Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Copiar pedido para o Hermes</span><span className="sm:hidden">Pedido do Hermes</span></button>}
    >
      {!focusId && ultimosDoHermes.length > 0 && <ul className={juntar(texto.auxiliar, "-mt-1 mb-3 space-y-0.5")} aria-label="Hermes nesta área">
        {ultimosDoHermes.map(a => <li key={a.id} className="truncate">{quando(a.executed_at ?? a.created_at)} · {a.payload?.report?.title ?? "pedido"} · {a.executed_at ? "envio registrado pelo Hermes" : a.decision_note}</li>)}
      </ul>}
      {!focusId && <div className="mb-4 flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
        {/* Até 4 faixas: segmentado no computador; no celular vira lista para nada cortar. */}
        <SeletorCompacto opcoes={opcoesDeFaixa} valor={lane} onEscolher={(v) => setLane(v as ReviewLane)} rotulo="Faixa da revisão" modo="segmentado" className="hidden md:inline-flex" />
        <SeletorCompacto opcoes={opcoesDeFaixa} valor={lane} onEscolher={(v) => setLane(v as ReviewLane)} rotulo="Faixa da revisão" modo="lista" className="md:hidden" />
        <SeletorCompacto opcoes={opcoesDeCliente} valor={clientId} onEscolher={setClientId} rotulo="Filtrar revisão por cliente" modo="lista" icone={<Users className="h-3.5 w-3.5" />} />
      </div>}
      {query.isLoading && <Carregando rotulo="Carregando pedidos de revisão" linhas={3} />}
      {operationError && <EstadoDeErro titulo={operationError} className="mb-3" />}
      {query.error && <EstadoDeErro titulo="Não foi possível carregar a revisão." descricao={query.error.message} acao={<button type="button" onClick={() => void query.refetch()} className={botao.secundario}>Tentar de novo</button>} className="mb-3" />}
      {!query.isLoading && !query.error && visible.length === 0 && <EstadoVazio compacto titulo={focusId ? "Pedido não encontrado ou sem acesso para esta conta." : "Nenhum pacote nesta fila."} descricao={focusId ? undefined : "Gere um ritual com o dossiê atualizado para começar."} />}
      {visible.length > 0 && <div className="divide-y divide-border border-y border-border">
        {visible.map(({ report, approval }) => {
          const currentReport = reports.find(item => item.id === report.id) ?? approval?.current_report;
          const current = approval?.current_report && (approval.current_report.review_version ?? 0) >= (currentReport?.review_version ?? 0) ? approval.current_report : currentReport;
          return <ReviewCard key={`${approval?.id ?? report.id}:${approval?.payload_hash ?? ""}`} report={report} currentReport={current ?? undefined} historical={!!focusId} approval={approval} client={clients.find(client => client.id === report.client_id)} busy={busyId === report.id} disabled={!!query.error || !!busyId} onPrepare={prepare} onDecide={decide} onSave={save} onMarkSent={markSent} />;
        })}
      </div>}
    </Secao>
  </section>;
}

const rotuloDeBloco = juntar(texto.rotulo, "block");

function ReviewCard({ report, currentReport, historical, approval, client, busy, disabled, onPrepare, onDecide, onSave, onMarkSent }: {
  report: ReviewReport; currentReport?: ReviewReport; historical: boolean; approval?: CentralApproval; client?: ReviewClient; busy: boolean; disabled: boolean;
  onPrepare: (report: ReviewReport, destination: ReviewDestination) => Promise<boolean>;
  onDecide: (approval: CentralApproval, decision: ReviewDecision, comment: string) => Promise<boolean>;
  onSave: (report: ReviewReport, edits: ReviewDraftEdits) => Promise<boolean>;
  onMarkSent: (approval: CentralApproval, evidence: string) => Promise<boolean>;
}) {
  const [comment, setComment] = useState("");
  const [evidence, setEvidence] = useState("");
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
  // Aprovado e ainda nao enviado: e a vez de quem tem o canal. O texto e o
  // congelado no pedido, nunca o rascunho editado depois.
  const sendable = !!approval && approval.status === "aprovado" && !approval.executed_at;
  const mensagemParaEnviar = approval ? [approval.payload.report.summary ?? "", approval.payload.report.next_steps ? `\n${approval.payload.report.next_steps}` : ""].join("").trim() : "";
  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(mensagemParaEnviar); toast.success("Mensagem aprovada copiada."); }
    catch { toast.error("Não foi possível copiar a mensagem."); }
  };
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
  const tomDoStatus = approval?.executed_at ? "text-success" : approval?.status === "aprovado" ? "text-primary" : approval && ["rejeitado", "expirado"].includes(approval.status) ? "text-destructive" : approval ? "text-warning" : "text-muted-foreground";
  return <article className="min-w-0 space-y-4 py-5" aria-label={`Revisão de ${client?.company_name || client?.full_name || report.client_id}`}>
    <header className="min-w-0">
      <p className={juntar(texto.auxiliar, "truncate")}>{client?.company_name || client?.full_name || report.client_id} · {text(frozen.metrics?.ritual_type)} · versão {showingSnapshot ? approval?.payload_version : report.review_version ?? "não carregada"}</p>
      <h3 className={juntar(texto.tituloSecao, "mt-1")}>{frozen.title}</h3>
      <p className={juntar("mt-0.5 text-[12px] font-medium", tomDoStatus)}>{approval ? statusLabel(approval) : "Rascunho · pedido ainda não preparado"}{approval && viaHermes(approval.decision_note) ? " · decidido pelo Hermes" : ""}</p>
    </header>
    {approval?.executed_at && <p className="rounded-md bg-success/10 px-3 py-2 text-[13px] text-foreground"><strong className="text-success">Enviado.</strong> {approval.execution_evidence || "Sem detalhe do envio."}</p>}
    {approval && !sameVersion && <p role="note" className="text-[13px] text-warning">Este pedido corresponde a outra versão. {currentReport ? `A versão atual é ${currentReport.review_version}. Prepare um novo pedido após conferir a edição.` : "A versão atual não está disponível; atualize a fila antes de decidir."}</p>}
    {expired && <p role="note" className="text-[13px] text-warning">O prazo deste pedido venceu. Prepare uma nova revisão para conferir a fonte e o destinatário novamente.</p>}
    <div className="min-w-0"><h4 className={rotuloDeBloco}>{scope ? "Plano e frentes deste pedido" : "Plano e frentes no cadastro atual"}</h4><p className={juntar(texto.corpo, "mt-1")}>{planName || "Plano não registrado"} · {services.length ? services.map(key => SERVICE_LABELS[key] ?? key).join(" · ") : "Frentes não registradas"}</p></div>
    {alerts.length > 0 && <div role="note" className="rounded-md bg-warning/10 px-3 py-2.5 text-[13px]"><strong className="font-medium text-warning">Pontos que precisam de decisão</strong><ul className="mt-1 list-disc pl-5">{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul></div>}
    <div className="min-w-0"><h4 className={rotuloDeBloco}>Mensagem preparada</h4><p className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap")}>{frozen.summary || "Mensagem ausente: volte ao rascunho antes de aprovar."}</p></div>
    <div className="min-w-0"><h4 className={rotuloDeBloco}>Próximo passo e expectativa</h4><p className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap")}>{frozen.next_steps || "Próximo passo ausente. Edite o rascunho e registre a próxima ação antes de preparar ou aprovar."}</p>
      {editable && !editing && !currentReport?.next_steps?.trim() && proximoPassoDoTexto(currentReport?.summary) && (
        <button type="button" disabled={disabled} onClick={() => void onSave(currentReport!, { summary: currentReport!.summary ?? "", next_steps: proximoPassoDoTexto(currentReport!.summary) })} className={juntar(botao.secundario, "mt-2")}>Completar próximo passo a partir do texto</button>
      )}
    </div>
    {editable && !editing && <button type="button" disabled={disabled} onClick={() => { setEdits({ summary: currentReport!.summary ?? "", next_steps: currentReport!.next_steps ?? "" }); setReviewedIdentity(null); setEditingReport(currentReport!); }} className={botao.secundario}>Editar rascunho atual</button>}
    {editing && <div className={juntar(superficie.poco, "space-y-3 p-3 sm:p-4")}>
      <p className={texto.corpo}>Editando a versão {editingReport.review_version}. Salvar invalida a aprovação deste item; depois prepare uma nova revisão.</p>
      {editingReport.review_version !== currentReport?.review_version && <p role="note" className="text-[13px] text-warning">Outra versão chegou durante a edição. Seu texto foi preservado, mas não pode sobrescrever a versão nova.</p>}
      <label className={rotuloDeBloco}>Mensagem do rascunho<textarea value={edits.summary} onChange={event => setEdits(previous => ({ ...previous, summary: event.target.value }))} rows={5} className={juntar(campoTexto, "mt-1.5")} /></label>
      <label className={rotuloDeBloco}>Próximo passo do rascunho<textarea value={edits.next_steps} onChange={event => setEdits(previous => ({ ...previous, next_steps: event.target.value }))} rows={3} className={juntar(campoTexto, "mt-1.5")} /></label>
      <div className="flex flex-wrap items-center justify-end [&>*+*]:ml-2">
        <button type="button" disabled={disabled} onClick={() => setEditingReport(null)} className={botao.discreto}>Cancelar edição</button>
        <button type="button" disabled={disabled || editingReport.review_version !== currentReport?.review_version || !edits.summary.trim() || (edits.summary.trim() === editingReport.summary?.trim() && edits.next_steps.trim() === editingReport.next_steps?.trim())} onClick={() => void saveEdits()} className={botao.primario}>{busy ? "Salvando…" : "Salvar rascunho"}</button>
      </div>
    </div>}
    <details className="text-[13px]"><summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Base, período e detalhes da revisão</summary>
      <dl className={juntar(superficie.poco, "mt-2 grid gap-2 p-3 text-[12px]")}>
        <div><dt className="font-medium">Dossiê usado</dt><dd className="text-muted-foreground">Versão {text(source?.dossier_version)} · {text(source?.dossier_updated_at)} · referência {text(source?.dossier_id)}</dd></div>
        <div><dt className="font-medium">Escopo do cliente</dt><dd className="break-all text-muted-foreground">Identidade da fonte: {text(source?.scope_hash)}. Conferir todas as frentes contratadas no dossiê e no plano.</dd></div>
        <div><dt className="font-medium">Período</dt><dd className="text-muted-foreground">{frozen.period_start || "Não registrado"} até {frozen.period_end || "Não registrado"}</dd></div>
        <div><dt className="font-medium">Geração</dt><dd className="text-muted-foreground">{text(frozen.metrics?.central_review_generated_at)}</dd></div>
        {[["Entregas e mudanças", frozen.highlights || frozen.metrics?.entregas], ["Pendências", frozen.metrics?.pendencias], ["Objetivo/meta", frozen.metrics?.objetivo ?? frozen.metrics?.meta]].map(([label, value]) => <div key={String(label)}><dt className="font-medium">{String(label)}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{detailText(value) || "Não registrado separadamente. Confira a mensagem e o plano antes de decidir."}</dd></div>)}
        {approval?.decision_note && <div><dt className="font-medium">Último comentário da decisão</dt><dd className="whitespace-pre-wrap text-muted-foreground">{approval.decision_note}</dd></div>}
        {!!approval?.events?.length && <div><dt className="font-medium">Comentários registrados</dt><dd><ul className="space-y-2">{approval.events.map(event => <li key={event.id}><time dateTime={event.created_at} className="text-muted-foreground">{event.created_at}</time><p className="whitespace-pre-wrap">{event.comment}</p></li>)}</ul></dd></div>}
      </dl>
    </details>
    {destination && <p className={texto.corpo}><strong className="font-medium">Destino congelado:</strong> {destination.channel === "portal" ? "Portal do cliente" : "WhatsApp"} · {destination.recipient}</p>}
    {sendable && <div className={juntar(superficie.poco, "space-y-3 p-3 sm:p-4")} aria-label="Enviar e registrar">
      <p className="flex items-center text-[13px] font-medium">Aprovado. Agora é enviar e registrar.
        <AjudaRecolhida className="ml-1.5" rotulo="Como registrar o envio">Envie o texto congelado ao destino acima (ou deixe o Hermes enviar pelo WhatsApp dele). Quem enviar registra aqui; sem o registro, a fila continua mostrando "não enviado".</AjudaRecolhida>
      </p>
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        <button type="button" onClick={() => void copyMessage()} className={botao.secundario}>Copiar mensagem aprovada</button>
        {destination?.channel === "whatsapp" && <a href={`https://wa.me/?text=${encodeURIComponent(mensagemParaEnviar)}`} target="_blank" rel="noopener noreferrer" className={botao.secundario}>Abrir no WhatsApp</a>}
      </div>
      <div className="flex min-w-0 flex-col sm:flex-row sm:items-end">
        <label className={juntar(rotuloDeBloco, "min-w-0 flex-1")}>Evidência do envio<input value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Ex.: enviado no grupo do cliente hoje às 10h15" className={juntar(campo, "mt-1.5")} /></label>
        <button type="button" disabled={disabled || evidence.trim().length < 3} onClick={() => void onMarkSent(approval!, evidence)} className={juntar(botao.primario, "mt-2 sm:ml-2 sm:mt-0")}>{busy ? "Registrando…" : "Marcar como enviado"}</button>
      </div>
    </div>}
    {preparable && !editing && <div className="flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-end">
        <label className={juntar(rotuloDeBloco, "sm:mr-2 sm:w-56")}>Canal<select value={channel} onChange={event => setChannel(event.target.value as ReviewDestination["channel"])} className={juntar(campo, "mt-1.5")}><option value="portal">Portal do cliente</option><option value="whatsapp">WhatsApp, destino a confirmar</option></select></label>
        {channel === "whatsapp" && <label className={juntar(rotuloDeBloco, "mt-3 min-w-0 flex-1 sm:mr-2 sm:mt-0")}>Destinatário identificado<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Identificação exata do grupo ou destinatário" className={juntar(campo, "mt-1.5")} /></label>}
        <button type="button" disabled={disabled || !reviewContentComplete(currentReport!) || (channel === "whatsapp" && !recipient.trim())} onClick={() => void onPrepare(currentReport!, { channel, recipient: channel === "portal" ? currentReport!.client_id : recipient.trim() })} className={juntar(botao.secundario, "mt-3 sm:mt-0")}>{busy ? "Preparando…" : "Preparar pedido desta versão"}</button>
      </div>}
    {approval && <div className="space-y-3">
      <label className={rotuloDeBloco}>Comentário<textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={4000} className={juntar(campoTexto, "mt-1.5 min-h-[60px]")} /></label>
      {decidable && <label className="flex items-start text-[13px]"><input type="checkbox" checked={reviewed} onChange={event => setReviewedIdentity(event.target.checked ? reviewIdentity : null)} className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" />Conferi esta versão, as fontes, os alertas e o destinatário.</label>}
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        {decidable && <><button type="button" disabled={disabled || editing || !reviewed || !reviewContentComplete(frozen)} onClick={() => void onDecide(approval, "aprovado", comment)} className={botao.primario}>Aprovar esta versão</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "alteracoes_pedidas", comment)} className={botao.secundario}>Pedir ajuste</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "rejeitado", comment)} className={botao.secundario}>Rejeitar</button></>}
        <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "comentario", comment)} className={botao.secundario}>Comentar</button>
        <button type="button" onClick={() => void copyLink()} className={botao.discreto}>Copiar link autenticado</button>
        <AjudaRecolhida rotulo="Como funciona a decisão">A decisão fica neste mesmo pedido, seja dada aqui ou ao Hermes no WhatsApp. Aprovar não envia: o envio é registrado à parte, com evidência.</AjudaRecolhida>
      </div>
    </div>}
  </article>;
}
