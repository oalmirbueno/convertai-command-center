import { supabase } from "@/integrations/supabase/client";
import { ehHype, type Ocupacao, regraDoCliente, type RegraDoDia } from "../../../supabase/functions/_shared/agenda-inteligente";

/**
 * Agenda inteligente na tela (17/10/2026): o que já está marcado para o cliente nos próximos dias (um post por
 * tarefa da agenda, com a hora da publicação quando houver) e a regra do dia dele. As contas puras moram em
 * supabase/functions/_shared/agenda-inteligente.ts, as mesmas do servidor.
 */
export type AgendaDoCliente = { ocupacao: Ocupacao[]; regra: RegraDoDia };

const horaLocal = (iso: string) => {
  const d = new Date(Date.parse(iso) - 3 * 3600_000).toISOString();
  return { data: d.slice(0, 10), hora: d.slice(11, 16) };
};

export async function lerAgendaDoCliente(
  clientId: string,
  desde: string,
  ate: string,
  excluir: { taskId?: string | null; postId?: string | null } = {},
): Promise<AgendaDoCliente> {
  const db = supabase as any;
  const [projetos, pubs, cfg] = await Promise.all([
    db.from("projects").select("id").eq("client_id", clientId).is("deleted_at", null).limit(200),
    db.from("editorial_publications").select("post_id, scheduled_at, status").eq("client_id", clientId)
      .gte("scheduled_at", `${desde}T03:00:00Z`).lte("scheduled_at", `${ate}T23:59:59Z`).limit(400),
    db.from("mesa_cliente_config").select("posts_por_dia, hypes_por_dia, horas_entre_posts").eq("client_id", clientId).maybeSingle(),
  ]);
  const ids = ((projetos.data ?? []) as Array<{ id: string }>).map((p) => p.id);
  const tarefas = ids.length
    ? await db.from("tasks").select("id, due_date, description").in("project_id", ids).not("delivery_type", "is", null)
      .is("deleted_at", null).gte("due_date", desde).lte("due_date", ate).limit(400)
    : { data: [] };
  const ocupacao: Ocupacao[] = ((tarefas.data ?? []) as Array<{ id: string; due_date: string | null; description: string | null }>)
    .filter((t) => t.due_date && t.id !== excluir.taskId)
    .map((t) => ({ data: String(t.due_date).slice(0, 10), hora: null, hype: ehHype((/Gancho do momento:\s*([^\n]+)/.exec(String(t.description || "")) || [])[1]) }));
  for (const p of (pubs.data ?? []) as Array<{ post_id: string; scheduled_at: string | null; status: string }>) {
    if (!p.scheduled_at || p.post_id === excluir.postId || p.status === "failed" || p.status === "cancelled") continue;
    const { data, hora } = horaLocal(p.scheduled_at);
    const semHora = ocupacao.find((o) => o.data === data && !o.hora);
    if (semHora) semHora.hora = hora;
    else ocupacao.push({ data, hora, hype: false });
  }
  return { ocupacao, regra: regraDoCliente(cfg.data) };
}

/** Salva a regra do dia do cliente (admin ou gestor com acesso). */
export async function salvarRegraDoDia(clientId: string, r: RegraDoDia): Promise<void> {
  const { error } = await (supabase as any).rpc("mesa_config_agenda", {
    _client_id: clientId,
    _posts_por_dia: r.porDia,
    _hypes_por_dia: r.hypesPorDia,
    _horas_entre_posts: r.horasEntre,
  });
  if (error) throw error;
}
