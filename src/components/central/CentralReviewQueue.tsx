import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Copy, Link2, Users } from "lucide-react";
import { callReviewRpc, prepareCentralReview, saveCentralReviewDraft, useCentralReviews } from "@/hooks/useCentralReviews";
import { centralReviewError, centralReviewLink, latestReviewReports, reviewAlerts, reviewContentComplete, reviewDecisionArgs, reviewLane } from "@/lib/centralReview";
import type { CentralApproval, ReviewClient, ReviewDecision, ReviewDestination, ReviewDraftEdits, ReviewLane, ReviewReport } from "@/lib/centralReview";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { proximoPassoDoTexto } from "@/lib/ritualTexto";
import { AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, MenuMais, SeletorCompacto, botao, campo, campoTexto, foco, juntar, superficie, texto } from "@/components/sistema";
import { useEstadoDaTela } from "@/components/central/useEstadoDaTela";

const LANES: { value: ReviewLane; label: string }[] = [
  { value: "decisao", label: "Precisa decisão" }, { value: "revisar", label: "Pronto para revisar" }, { value: "aguardando", label: "Aprovados · a enviar" }, { value: "enviado", label: "Enviados" },
];
const STATUS: Record<string, string> = { pendente: "Preparado · aguardando revisão", aprovado: "Aprovado · envio não realizado", rejeitado: "Rejeitado", alteracoes_pedidas: "Ajuste solicitado", adiado: "Adiado", expirado: "Desatualizado · nova revisão necessária" };
const RITUAL: Record<string, string> = { rota_semana: "Rota da semana", meio_semana: "Meio da semana", prova_movimento: "Prova de movimento" };
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Não registrado";
const detailText = (value: unknown) => typeof value === "string" && value.trim() ? value : Array.isArray(value) ? value.filter(item => typeof item === "string").join("\n") : "";
const quando = (iso?: string | null) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "data não registrada"; };
const viaHermes = (note?: string | null) => typeof note === "string" && note.startsWith("[via Hermes");
const nomeDoRitual = (tipo: unknown) => typeof tipo === "string" ? RITUAL[tipo] ?? tipo : "Ritual";
function statusLabel(approval: CentralApproval): string {
  if (approval.executed_at) return `Enviado · registrado em ${quando(approval.executed_at)}`;
  return STATUS[approval.status] || approval.status;
}
function tomDoStatus(approval?: CentralApproval): string {
  if (approval?.executed_at) return "text-success";
  if (approval?.status === "aprovado") return "text-primary";
  if (approval && ["rejeitado", "expirado"].includes(approval.status)) return "text-destructive";
  return approval ? "text-warning" : "text-muted-foreground";
}

/** O que a pessoa cola no WhatsApp do Hermes para ele assumir esta área. */
export const PEDIDO_PARA_O_HERMES = [
  "Hermes, assuma a Revisão do Ciclo (/ciclo/revisao) pelo MCP:",
  "1. aceleriq_central_review_fila (operator: default) — leia rascunhos_sem_pedido, esperando_decisao e aprovados_para_enviar.",
  "2. Rascunho sem pedido: revise o texto e prepare com aceleriq_central_review_preparar (channel whatsapp, recipient = nome exato do grupo).",
  "3. Pedido esperando decisão: me mande a mensagem aqui; quando eu responder, registre com aceleriq_central_review_decidir citando minha mensagem como evidence.",
  "4. Aprovado: envie no grupo do cliente e registre com aceleriq_central_review_marcar_enviado com a evidência do envio.",
  "5. Avisos de post no ar: aceleriq_aviso_publicacao_fila, com o mesmo rito (preparar, a minha decisão, marcar enviado).",
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
 * Revisão enxuta (15/10/2026, pedido do dono: "muito poluída"). Uma linha de
 * controles (faixas, cliente e o "..."), e cada pedido é uma linha fechada com
 * título, cliente e situação; ao abrir, só o que decide: mensagem, destino e a
 * decisão. Plano, base, período e histórico ficam em "Detalhes". Pelo link
 * (?review=) o pedido já abre inteiro. As regras do fluxo (conferência
 * explícita, versão e hash, envio registrado à parte) não mudam.
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
  const [aberto, setAberto] = useState<string | null>(null);
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
  const opcoesDeFaixa = LANES.map(item => ({ valor: item.value, rotulo: item.label, contador: cards.filter(report => (!clientId || report.client_id === clientId) && reviewLane(report, latest.get(report.id)) === item.value).length }));
  const opcoesDeCliente = [{ valor: "", rotulo: "Todos os clientes" }, ...clients.map(client => ({ valor: client.id, rotulo: client.company_name || client.full_name || "Cliente" }))];
  const nomeDoCliente = (id: string) => { const c = clients.find(client => client.id === id); return c?.company_name || c?.full_name || "Cliente"; };

  if (!isAdmin) return null;
  return <section aria-label="Revisão por cliente" className="min-w-0">
    {focusId
      ? <div className="mb-3"><button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete("review"); setParams(next); }} className={botao.discreto}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Voltar à fila</button></div>
      : <div className="mb-3 flex min-w-0 items-center">
        {/* Uma linha: faixas (segmentado no computador, lista no celular), cliente e o "...". */}
        <SeletorCompacto opcoes={opcoesDeFaixa} valor={lane} onEscolher={(v) => { setLane(v as ReviewLane); setAberto(null); }} rotulo="Faixa da revisão" modo="segmentado" className="hidden md:inline-flex" />
        <SeletorCompacto opcoes={opcoesDeFaixa} valor={lane} onEscolher={(v) => { setLane(v as ReviewLane); setAberto(null); }} rotulo="Faixa da revisão" modo="lista" className="md:hidden" />
        <div className="ml-auto flex shrink-0 items-center pl-2 [&>*+*]:ml-1">
          {clients.length > 1 && <SeletorCompacto opcoes={opcoesDeCliente} valor={clientId} onEscolher={setClientId} rotulo="Filtrar revisão por cliente" modo="lista" icone={<Users className="h-3.5 w-3.5" />} />}
          <MenuMais rotulo="Mais ações da revisão" itens={[{ rotulo: "Copiar pedido para o Hermes", icone: <Copy className="h-3.5 w-3.5" />, aoEscolher: () => void copyHermesRequest() }]} />
        </div>
      </div>}
    {query.isLoading && <Carregando rotulo="Carregando pedidos de revisão" linhas={3} />}
    {operationError && <EstadoDeErro titulo={operationError} className="mb-3" />}
    {query.error && <EstadoDeErro titulo="Não foi possível carregar a revisão." descricao={query.error.message} acao={<button type="button" onClick={() => void query.refetch()} className={botao.secundario}>Tentar de novo</button>} className="mb-3" />}
    {!query.isLoading && !query.error && visible.length === 0 && <EstadoVazio compacto titulo={focusId ? "Pedido não encontrado ou sem acesso para esta conta." : "Nada nesta faixa."} />}
    {visible.length > 0 && <ul className="divide-y divide-border border-y border-border">
      {visible.map(({ report, approval }) => {
        const currentReport = reports.find(item => item.id === report.id) ?? approval?.current_report;
        const current = approval?.current_report && (approval.current_report.review_version ?? 0) >= (currentReport?.review_version ?? 0) ? approval.current_report : currentReport;
        const chave = `${approval?.id ?? report.id}:${approval?.payload_hash ?? ""}`;
        const estaAberto = !!focusId || aberto === report.id;
        const titulo = (approval && approval.payload_version === current?.review_version ? approval.payload.report : report).title;
        return <li key={chave} className="min-w-0">
          {!focusId && <button type="button" aria-expanded={estaAberto} onClick={() => setAberto(estaAberto ? null : report.id)} className={juntar("flex w-full min-w-0 items-center px-1 py-3 text-left transition-colors hover:bg-muted/40", foco)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-foreground" title={titulo}>{titulo}</span>
              <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                {nomeDoCliente(report.client_id)} · {nomeDoRitual(report.metrics?.ritual_type)} · <span className={tomDoStatus(approval)}>{approval ? statusLabel(approval) : "Rascunho · pedido ainda não preparado"}</span>{approval && viaHermes(approval.decision_note) ? " · pelo Hermes" : ""}
              </span>
            </span>
            <ChevronDown className={juntar("ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform", estaAberto && "rotate-180")} aria-hidden="true" />
          </button>}
          {estaAberto && <ReviewCard report={report} currentReport={current ?? undefined} historical={!!focusId} approval={approval} client={clients.find(client => client.id === report.client_id)} busy={busyId === report.id} disabled={!!query.error || !!busyId} onPrepare={prepare} onDecide={decide} onSave={save} onMarkSent={markSent} />}
        </li>;
      })}
    </ul>}
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
  const extras = ([["Entregas e mudanças", frozen.highlights || frozen.metrics?.entregas], ["Pendências", frozen.metrics?.pendencias], ["Objetivo/meta", frozen.metrics?.objetivo ?? frozen.metrics?.meta]] as const)
    .map(([label, value]) => [label, detailText(value)] as const).filter(([, value]) => value);
  return <article className="min-w-0 space-y-4 pb-5 pl-1 pr-1 pt-1" aria-label={`Revisão de ${client?.company_name || client?.full_name || report.client_id}`}>
    {/* Pelo link o pedido abre sozinho: aqui ele mostra de quem é e em que pé está. */}
    {historical && <header className="min-w-0">
      <p className={juntar(texto.auxiliar, "truncate")}>{client?.company_name || client?.full_name || report.client_id} · {nomeDoRitual(frozen.metrics?.ritual_type)} · versão {showingSnapshot ? approval?.payload_version : report.review_version ?? "não carregada"}</p>
      <h3 className={juntar(texto.tituloSecao, "mt-1 min-w-0 truncate")} title={frozen.title ?? undefined}>{frozen.title}</h3>
      <p className={juntar("mt-0.5 text-[12px] font-medium", tomDoStatus(approval))}>{approval ? statusLabel(approval) : "Rascunho · pedido ainda não preparado"}{approval && viaHermes(approval.decision_note) ? " · decidido pelo Hermes" : ""}</p>
    </header>}
    {approval?.executed_at && <p className="text-[13px] text-foreground"><strong className="font-medium text-success">Enviado.</strong> {approval.execution_evidence || "Sem detalhe do envio."}</p>}
    {approval && !sameVersion && <p role="note" className="text-[13px] text-warning">Este pedido corresponde a outra versão. {currentReport ? `A versão atual é ${currentReport.review_version}. Prepare um novo pedido após conferir a edição.` : "A versão atual não está disponível; atualize a fila antes de decidir."}</p>}
    {expired && <p role="note" className="flex items-center text-[13px] text-warning">O prazo deste pedido venceu. Prepare uma nova revisão.<AjudaRecolhida className="ml-1.5" rotulo="Por que preparar de novo">A nova revisão confere a fonte e o destinatário outra vez antes de decidir.</AjudaRecolhida></p>}
    {alerts.length > 0 && <div role="note" className="rounded-md bg-warning/10 px-3 py-2.5 text-[13px]"><strong className="font-medium text-warning">Pontos que precisam de decisão</strong><ul className="mt-1 list-disc pl-5">{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul></div>}
    {!editing && <div className="min-w-0 space-y-3">
      <div className="min-w-0"><h4 className={rotuloDeBloco}>Mensagem</h4><p className={juntar(texto.corpo, "mt-1 max-w-[72ch] whitespace-pre-wrap")}>{frozen.summary || "Mensagem ausente: volte ao rascunho antes de aprovar."}</p></div>
      <div className="min-w-0"><h4 className={rotuloDeBloco}>Próximo passo</h4><p className={juntar(texto.corpo, "mt-1 max-w-[72ch] whitespace-pre-wrap")}>{frozen.next_steps || "Próximo passo ausente. Edite o rascunho e registre a próxima ação antes de preparar ou aprovar."}</p>
        {editable && !currentReport?.next_steps?.trim() && proximoPassoDoTexto(currentReport?.summary) && (
          <button type="button" disabled={disabled} onClick={() => void onSave(currentReport!, { summary: currentReport!.summary ?? "", next_steps: proximoPassoDoTexto(currentReport!.summary) })} className={juntar(botao.secundario, "mt-2")}>Completar próximo passo a partir do texto</button>
        )}
      </div>
      {destination && <p className={texto.auxiliar}>Destino: {destination.channel === "portal" ? "Portal do cliente" : "WhatsApp"} · {destination.recipient}</p>}
    </div>}
    {editing && <div className={juntar(superficie.poco, "space-y-3 p-3 sm:p-4")}>
      <p className={juntar(texto.corpo, "flex items-center")}>Editando a versão {editingReport.review_version}.<AjudaRecolhida className="ml-1.5" rotulo="O que acontece ao salvar">Salvar invalida a aprovação deste item; depois prepare uma nova revisão.</AjudaRecolhida></p>
      {editingReport.review_version !== currentReport?.review_version && <p role="note" className="text-[13px] text-warning">Outra versão chegou durante a edição. Seu texto ficou aqui, mas não sobrescreve a nova.</p>}
      <label className={rotuloDeBloco}>Mensagem do rascunho<textarea value={edits.summary} onChange={event => setEdits(previous => ({ ...previous, summary: event.target.value }))} rows={5} className={juntar(campoTexto, "mt-1.5")} /></label>
      <label className={rotuloDeBloco}>Próximo passo do rascunho<textarea value={edits.next_steps} onChange={event => setEdits(previous => ({ ...previous, next_steps: event.target.value }))} rows={3} className={juntar(campoTexto, "mt-1.5")} /></label>
      <div className="flex flex-wrap items-center justify-end [&>*+*]:ml-2">
        <button type="button" disabled={disabled} onClick={() => setEditingReport(null)} className={botao.discreto}>Cancelar edição</button>
        <button type="button" disabled={disabled || editingReport.review_version !== currentReport?.review_version || !edits.summary.trim() || (edits.summary.trim() === editingReport.summary?.trim() && edits.next_steps.trim() === editingReport.next_steps?.trim())} onClick={() => void saveEdits()} className={botao.primario}>{busy ? "Salvando…" : "Salvar rascunho"}</button>
      </div>
    </div>}

    {sendable && <div className="min-w-0 space-y-2" aria-label="Enviar e registrar">
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
    {approval && !editing && <div className="space-y-3">
      {decidable && <label className="flex items-start text-[13px]"><input type="checkbox" checked={reviewed} onChange={event => setReviewedIdentity(event.target.checked ? reviewIdentity : null)} className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" />Conferi o texto, a base e o destino desta versão.</label>}
      <label className={rotuloDeBloco}>Comentário<textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={4000} placeholder="Obrigatório para pedir ajuste, rejeitar ou só registrar um comentário" className={juntar(campoTexto, "mt-1.5 min-h-[56px]")} /></label>
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        {decidable && <><button type="button" disabled={disabled || !reviewed || !reviewContentComplete(frozen)} onClick={() => void onDecide(approval, "aprovado", comment)} className={botao.primario}>Aprovar esta versão</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "alteracoes_pedidas", comment)} className={botao.secundario}>Pedir ajuste</button>
          <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "rejeitado", comment)} className={botao.discreto}>Rejeitar</button></>}
        <button type="button" disabled={disabled || !comment.trim()} onClick={() => void onDecide(approval, "comentario", comment)} className={botao.discreto}>Comentar</button>
        <AjudaRecolhida rotulo="Como funciona a decisão">A decisão fica neste mesmo pedido, seja dada aqui ou ao Hermes no WhatsApp. Aprovar não envia: o envio é registrado à parte, com evidência.</AjudaRecolhida>
      </div>
    </div>}
    {editable && !editing && <button type="button" disabled={disabled} onClick={() => { setEdits({ summary: currentReport!.summary ?? "", next_steps: currentReport!.next_steps ?? "" }); setReviewedIdentity(null); setEditingReport(currentReport!); }} className={botao.discreto}>Editar rascunho atual</button>}

    <details className="text-[13px]"><summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Detalhes</summary>
      <dl className="mt-2 grid gap-2 pl-1 text-[12px]">
        <div><dt className="font-medium">{scope ? "Plano e frentes deste pedido" : "Plano e frentes no cadastro atual"}</dt><dd className="text-muted-foreground">{planName || "Plano não registrado"} · {services.length ? services.map(key => SERVICE_LABELS[key] ?? key).join(" · ") : "Frentes não registradas"}</dd></div>
        <div><dt className="font-medium">Dossiê usado</dt><dd className="text-muted-foreground">Versão {text(source?.dossier_version)} · {text(source?.dossier_updated_at)}</dd></div>
        <div><dt className="font-medium">Período</dt><dd className="text-muted-foreground">{frozen.period_start || "Não registrado"} até {frozen.period_end || "Não registrado"}{showingSnapshot || report.review_version ? ` · versão ${showingSnapshot ? approval?.payload_version : report.review_version}` : ""}</dd></div>
        {extras.map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{value}</dd></div>)}
        {approval?.decision_note && <div><dt className="font-medium">Último comentário da decisão</dt><dd className="whitespace-pre-wrap text-muted-foreground">{approval.decision_note}</dd></div>}
        {!!approval?.events?.length && <div><dt className="font-medium">Comentários registrados</dt><dd><ul className="space-y-2">{approval.events.map(event => <li key={event.id}><time dateTime={event.created_at} className="text-muted-foreground">{quando(event.created_at)}</time><p className="whitespace-pre-wrap">{event.comment}</p></li>)}</ul></dd></div>}
        {approval && <div><button type="button" onClick={() => void copyLink()} className={juntar(botao.discreto, "relative -left-1 h-7 px-1 text-[12px]")}><Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Copiar link do pedido</button></div>}
      </dl>
    </details>
  </article>;
}
