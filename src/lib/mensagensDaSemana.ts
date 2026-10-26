/**
 * Mensagens da semana numa tela só (26/10/2026).
 *
 * Os rituais de segunda, quarta e sexta ficavam prontos e expiravam sem
 * decisão (18 venceram; 9 aguardando no dia do diagnóstico). Aqui ficam todas
 * as mensagens prontas da semana, de todos os clientes, para o dono aprovar
 * uma a uma ou todas. Nada sai sem ele.
 *
 * Reaproveita o fluxo que já existe (nada de lógica nova de envio):
 * - texto: saveCentralReviewDraft (edição) e reescreverRitual (o ajuste da
 *   conversa do Agente da Central);
 * - pedido: prepareCentralReview com o MESMO destino quando o texto mudou ou o
 *   pedido venceu;
 * - decisão: central_review_decide (versão e hash exatos);
 * - envio: WhatsApp continua com o Hermes (ele lê "aprovados_para_enviar",
 *   envia e registra); portal registra o envio (central_review_marcar_enviado)
 *   e publica pelo caminho da Central (salvarEPublicarRitual com o rascunho).
 */
import { callReviewRpc, prepareCentralReview, saveCentralReviewDraft } from "@/hooks/useCentralReviews";
import { latestReviewReports, reviewDecisionArgs } from "@/lib/centralReview";
import type { CentralApproval, ReviewReport } from "@/lib/centralReview";
import { salvarEPublicarRitual, type RitualDoAgente } from "@/components/central/agenteCentralApi";

export type SituacaoDaMensagem = "pronta" | "venceu" | "aprovada";

export interface MensagemDaSemana {
  chave: string;
  clientId: string;
  report: ReviewReport;
  approval: CentralApproval;
  situacao: SituacaoDaMensagem;
  /** Quando o pedido vence (pronta) ou venceu (venceu). */
  venceEm: string | null;
  canal: "portal" | "whatsapp";
  destinatario: string;
  ritual: string;
}

export const NOME_DO_RITUAL: Record<string, string> = {
  rota_semana: "Segunda · Rota da semana",
  meio_semana: "Quarta · Meio da semana",
  prova_movimento: "Sexta · Prova de movimento",
  radar_aceleriq: "Radar Aceleriq",
  marco_90: "Marco 90",
};

/** Segunda-feira 00:00 (horário local) da semana de `agora`. */
export function inicioDaSemana(agora: number): number {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * As mensagens da semana que pedem o dono: prontas (pedido em aberto no prazo),
 * vencidas (o prazo passou ou o pedido foi invalidado, sem decisão) e
 * aprovadas ainda não enviadas. Rejeitadas (puladas) e enviadas saem.
 */
export function montarMensagens(reports: readonly ReviewReport[], approvals: readonly CentralApproval[], agora: number): MensagemDaSemana[] {
  const ultimoPedido = new Map<string, CentralApproval>();
  for (const a of [...approvals].sort((x, y) => y.created_at.localeCompare(x.created_at))) if (!ultimoPedido.has(a.report_id)) ultimoPedido.set(a.report_id, a);
  const desde = inicioDaSemana(agora);
  const saida: MensagemDaSemana[] = [];
  for (const report of latestReviewReports(reports)) {
    if (report.status !== "draft") continue;
    if (Date.parse(report.created_at) < desde) continue;
    const a = ultimoPedido.get(report.id);
    if (!a || a.executed_at) continue;
    const venceu = !!a.valid_until && Date.parse(a.valid_until) <= agora;
    let situacao: SituacaoDaMensagem | null = null;
    if (a.status === "aprovado") situacao = "aprovada";
    else if (a.status === "expirado") situacao = "venceu";
    else if (["pendente", "adiado"].indexOf(a.status) >= 0) situacao = venceu || a.payload_version !== report.review_version ? "venceu" : "pronta";
    if (!situacao) continue;
    saida.push({
      chave: `${report.id}:${a.id}`,
      clientId: report.client_id,
      report,
      approval: a,
      situacao,
      venceEm: a.valid_until || null,
      canal: a.payload.destination.channel,
      destinatario: a.payload.destination.recipient,
      ritual: String(report.metrics?.ritual_type ?? ""),
    });
  }
  const ordem: Record<SituacaoDaMensagem, number> = { pronta: 0, venceu: 1, aprovada: 2 };
  return saida.sort((x, y) => ordem[x.situacao] - ordem[y.situacao] || (x.venceEm || "").localeCompare(y.venceEm || ""));
}

/** "vence em 3 h", "vence hoje às 18:00", "venceu há 2 dias". */
export function prazoEmPalavras(venceEm: string | null, agora: number): string {
  if (!venceEm) return "sem prazo";
  const t = Date.parse(venceEm);
  if (!Number.isFinite(t)) return "sem prazo";
  const horas = Math.round((t - agora) / 3_600_000);
  const hora = new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (t <= agora) {
    const dias = Math.floor((agora - t) / 86_400_000);
    return dias >= 1 ? `venceu há ${dias} ${dias === 1 ? "dia" : "dias"}` : `venceu às ${hora}`;
  }
  if (horas < 1) return `vence em ${Math.max(1, Math.round((t - agora) / 60_000))} min`;
  if (new Date(t).toDateString() === new Date(agora).toDateString()) return `vence hoje às ${hora}`;
  if (horas < 48) return `vence amanhã às ${hora}`;
  return `vence em ${new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

const chave = (partes: unknown[]) => {
  const base = JSON.stringify(partes);
  let h = 0;
  for (let i = 0; i < base.length; i += 1) h = (h * 31 + base.charCodeAt(i)) | 0;
  return `msg-semana-${(h >>> 0).toString(36)}-${base.length}`;
};

function ritualDoRelatorio(report: ReviewReport): RitualDoAgente {
  return {
    tipo: String(report.metrics?.ritual_type ?? ""),
    title: report.title,
    body: report.summary || "",
    next_steps: report.next_steps || "",
    alertas: [],
    tarefas_sugeridas: [],
    model: null,
    repeticao: null,
    fase: null,
  };
}

export interface ResultadoDoEnvio {
  /** "hermes": aprovado; o Hermes envia no grupo e registra. "portal": publicado no portal. */
  via: "hermes" | "portal";
  avisos: string[];
}

/**
 * Aprova (e, no portal, envia) uma mensagem. `texto` é o texto que está na
 * tela: se mudou, salva o rascunho e prepara um pedido novo com o mesmo
 * destino antes de aprovar. Pedido vencido também é preparado de novo.
 */
export async function aprovarEEnviar(m: MensagemDaSemana, texto: string, userId: string): Promise<ResultadoDoEnvio> {
  let report = m.report;
  let pedido = m.approval;
  const novo = texto.trim();
  if (!novo) throw new Error("A mensagem não pode ficar vazia.");
  const mudou = novo !== (report.summary || "").trim();
  if (mudou) report = await saveCentralReviewDraft(report, { summary: novo, next_steps: report.next_steps || "" });
  if (pedido.status !== "aprovado" && (mudou || m.situacao === "venceu" || pedido.payload_version !== report.review_version)) {
    pedido = await prepareCentralReview(report.id, report.review_version as number, pedido.payload.destination, chave(["preparar", report.id, report.review_version, pedido.payload.destination]));
  }
  if (pedido.status !== "aprovado") {
    await callReviewRpc("central_review_decide", reviewDecisionArgs(pedido, "aprovado", "", chave(["aprovar", pedido.id, pedido.payload_hash])));
  }
  if (pedido.payload.destination.channel !== "portal") return { via: "hermes", avisos: [] };
  // Portal: registra o envio ANTES de publicar (publicar muda o texto e invalidaria o pedido aprovado).
  const agora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  await callReviewRpc("central_review_marcar_enviado", { _approval_id: pedido.id, _evidence: `Publicado no portal pelo painel (Mensagens da semana) em ${agora}.`, _idempotency_key: chave(["enviado", pedido.id]) });
  const r = await salvarEPublicarRitual({ clientId: report.client_id, ritual: ritualDoRelatorio(report), publicar: true, userId, reportId: report.id, canal: "portal" });
  if (!r.publicado) throw new Error(r.avisos[0] || "Aprovada, mas a publicação no portal falhou. Tente de novo.");
  return { via: "portal", avisos: r.avisos };
}

/** Pular = decisão registrada de não enviar esta (rejeitada com o motivo). Pedido vencido só sai da lista. */
export async function pularMensagem(m: MensagemDaSemana): Promise<"pulada" | "sem_pedido_aberto"> {
  const a = m.approval;
  if (m.situacao !== "pronta") return "sem_pedido_aberto";
  const comentario = "Pulada pelo dono em Mensagens da semana: não enviar esta.";
  await callReviewRpc("central_review_decide", reviewDecisionArgs(a, "rejeitado", comentario, chave(["pular", a.id, a.payload_hash])));
  return "pulada";
}
