import { reviewDecisionArgs, type CentralApproval, type ReviewDecision } from "./centralReview";

export function comandoDaAprovacao(a: Record<string, any>, decisao: string, nota: string, chave: string) {
  if (a.origin === "central" || a.report_id) {
    if (!a.payload?.report) throw new Error("Este pedido está sem o relatório. Atualize a revisão antes de decidir.");
    if (decisao === "adiado") throw new Error("Este relatório deve ser aprovado, devolvido ou rejeitado.");
    return { rpc: "central_review_decide", args: reviewDecisionArgs(a as CentralApproval, decisao as ReviewDecision, nota, chave) };
  }
  return { rpc: "operator_approval_decidir", args: { _approval_id: a.id, _decisao: decisao, _nota: nota.trim() || null } };
}

export function avisoDaExecucao(n: { notification_type?: string; link?: string | null }) {
  return /^operator(?:_|$)/.test(n.notification_type || "") || /^\/execucao(?:[?#]|$)/.test(n.link || "");
}

export function contagensDasAbas(vinculos: readonly { id: string; status: string; approval_required?: boolean }[], agentes: number) {
  const unicos = [...new Map(vinculos.map(v => [v.id, v])).values()];
  return { pessoas: agentes, trabalho: unicos.length,
    decisoes: unicos.filter(v => ["awaiting_input", "blocked"].includes(v.status) || (v.approval_required && v.status !== "done")).length,
    feito: 0, relatorios: 0 };
}

const estados: Record<string, string> = { started: "Iniciada", progress: "Em andamento", queued: "Na fila", in_progress: "Em andamento", done: "Concluída", review: "Em revisão", awaiting_input: "Aguardando sua resposta", blocked: "Bloqueada", failed: "Falhou", timeout: "Sem atualização no prazo" };
export const estadoDaExecucao = (valor: unknown) => estados[String(valor)] || "Estado não informado";
export function falhaDaExecucao(erro: unknown): string {
  const s = String(erro || "");
  if (/readback|registro.*confirmado/i.test(s)) return "O agente não confirmou o registro do resultado no painel. A conclusão precisa ser verificada.";
  if (/timeout|timed out/i.test(s)) return "A execução excedeu o prazo sem confirmar o resultado.";
  return s || "";
}

/** Somente destinos navegáveis; anexos privados são assinados sob a sessão do leitor. */
export function destinoDaEvidencia(url: string): "arquivo" | "privado" | "web" | null {
  if (/^aceleriq-file:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url)) return "arquivo";
  if (/^workspace:\/\/(?:client\/[a-f0-9-]{36}|global\/global)\/[a-f0-9-]{36}\.[a-z0-9]+$/i.test(url)) return "privado";
  if (/^mcp-files:\/\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(url) && !url.includes("..")) return "privado";
  if (/^files:\/\/(?:task-attachments|clients)\//.test(url) && !url.includes("..")) return "privado";
  try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password ? "web" : null; } catch { return null; }
}
