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
  // 15/10 (dono: "está bem confusa, não consigo entender o que é"): linha do tempo por dia; cada execução numa linha, o detalhe ao abrir.
  const diaDe = (r: Record<string, any>) => new Date(r.heartbeat_at || r.started_at).toLocaleDateString("pt-BR");
  const hoje = new Date().toLocaleDateString("pt-BR");
  const ontem = new Date(Date.now() - 86_400_000).toLocaleDateString("pt-BR");
  const rotuloDoDia = (dia: string) => (dia === hoje ? "Hoje" : dia === ontem ? "Ontem" : dia.slice(0, 5));
  const dias = [...new Set(runs.map(diaDe))];
  return <div className="space-y-5">{dias.map(dia => <section key={dia} aria-label={`Execuções de ${rotuloDoDia(dia)}`}>
    <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{rotuloDoDia(dia)}</p>
    <div className="space-y-1.5">{runs.filter(r => diaDe(r) === dia).map(r => {
    const agente = agentes.find(a => a.id === r.operator_id);
    const v = vinculos.find(v => v.id === r.task_link_id);
    const tarefa = tarefas.get(v?.kanban_task_id || v?.painel_task_id);
    const d = r.detail || {};
    const titulo = d.title || tarefa?.title || d.action || v?.last_action || "Execução sem título informado";
    const cliente = tarefa?.project?.client;
    const nomeCliente = cliente?.company_name || cliente?.full_name || d.client_name;
    const provas = Array.isArray(d.attachments) ? d.attachments : [];
    const ruim = ["failed", "timeout"].includes(r.status);
    return <details key={r.id} open={r.id === destaque || undefined} ref={r.id === destaque ? alvo : undefined} className={juntar(superficie.painel, "group overflow-hidden", r.id === destaque && "ring-1 ring-primary")}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-muted/30">
        {r.status === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Activity className={juntar("h-4 w-4 shrink-0", ruim ? "text-warning" : "text-muted-foreground")} />}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold" title={agente?.display_name || "Agente"} aria-hidden="true">{(agente?.display_name || "A").slice(0, 1)}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{titulo}</p><p className="truncate text-[12px] text-muted-foreground">{agente?.display_name || "Agente"}{nomeCliente ? ` · ${nomeCliente}` : " · operação interna"} · {new Date(r.heartbeat_at || r.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p></div>
        <span className={juntar("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", ruim ? "bg-warning/15 text-warning" : r.status === "done" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{estadoDaExecucao(r.status)}</span>
      </summary>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto border-t border-border/60 p-4">
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
  })}</div>
  </section>)}</div>;
}
