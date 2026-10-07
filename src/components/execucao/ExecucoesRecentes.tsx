import { useEffect, useRef } from "react";
import { Activity, CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { estadoDaExecucao, falhaDaExecucao } from "@/lib/execucaoApresentacao";
import { botao, juntar, superficie } from "@/components/sistema";
import EvidenciaVisual from "./EvidenciaVisual";

export default function ExecucoesRecentes({ runs, agentes, vinculos, tarefas, destaque, aoConversar }: {
  runs: Record<string, any>[]; agentes: { id: string; display_name: string; area?: string | null }[];
  vinculos: Record<string, any>[]; tarefas: Map<string, any>; destaque?: string | null;
  aoConversar: (id: string, titulo?: string) => void;
}) {
  const alvo = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (destaque) alvo.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [destaque, runs.length]);
  if (!runs.length) return <p className="text-[13px] text-muted-foreground">Nenhuma execução neste recorte.</p>;
  return <div className="space-y-3">{runs.map(r => {
    const agente = agentes.find(a => a.id === r.operator_id);
    const v = vinculos.find(v => v.id === r.task_link_id);
    const tarefa = tarefas.get(v?.kanban_task_id || v?.painel_task_id);
    const d = r.detail || {};
    const titulo = d.title || tarefa?.title || d.action || v?.last_action || "Execução sem título informado";
    const cliente = tarefa?.project?.client;
    const nomeCliente = cliente?.company_name || cliente?.full_name || d.client_name;
    const provas = Array.isArray(d.attachments) ? d.attachments : [];
    return <details key={r.id} open={r.id === destaque || undefined} ref={r.id === destaque ? alvo : undefined} className={juntar(superficie.painel, "group overflow-hidden", r.id === destaque && "ring-1 ring-primary")}>
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 hover:bg-muted/30">
        {r.status === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">{titulo}</p><p className="mt-1 text-[12px] text-muted-foreground">{agente?.display_name || "Agente"} · {agente?.area || "Sem departamento"}{nomeCliente ? ` · ${nomeCliente}` : " · Operação interna"}</p></div>
        <span className={juntar("text-right text-[12px]", ["failed", "timeout"].includes(r.status) ? "text-warning" : "text-primary")}>{estadoDaExecucao(r.status)}</span>
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Clock className="h-3 w-3" />Último registro: {new Date(r.heartbeat_at || r.started_at).toLocaleString("pt-BR")}</p>
        {d.action && <p className="whitespace-pre-wrap text-[13px]">{d.action}</p>}
        {d.summary && <p className="whitespace-pre-wrap text-[13px]">{d.summary}</p>}
        {d.page_url && <EvidenciaVisual url={d.page_url} nome="Página consultada" />}
        {r.error && <p className="text-[13px] text-warning">{falhaDaExecucao(r.error)}</p>}
        {(d.evidence || v?.last_evidence) && <EvidenciaVisual url={d.evidence || v.last_evidence} />}
        {provas.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{provas.map((a: any, i: number) => typeof a.url === "string" && <EvidenciaVisual key={i} url={a.url} nome={a.name || "Comprovação"} />)}</div>}
        {(d.next_step || v?.next_step) && <p className="text-[13px]"><strong>Próximo passo:</strong> {d.next_step || v.next_step}</p>}
        {r.task_link_id ? <button type="button" className={botao.secundario} onClick={() => aoConversar(r.task_link_id, titulo)}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Conversar ou pedir revisão</button> : <p className="text-[12px] text-muted-foreground">O agente ainda não vinculou esta execução a uma tarefa. O registro permanece disponível aqui.</p>}
        <details><summary className="cursor-pointer text-[11px] text-muted-foreground">Identificador técnico</summary><code className="break-all text-[11px]">{r.run_key}</code></details>
      </div>
    </details>;
  })}</div>;
}
