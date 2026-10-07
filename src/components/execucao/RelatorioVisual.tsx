import { CheckCircle2, CircleAlert, Clock } from "lucide-react";
import { estadoDaExecucao, falhaDaExecucao } from "@/lib/execucaoApresentacao";
import { botao, superficie, juntar } from "@/components/sistema";

export default function RelatorioVisual({ vinculos, runs, agentes, tarefas, aoAbrir }: {
  vinculos: Record<string, any>[]; runs: Record<string, any>[]; agentes: { id: string; display_name: string }[];
  tarefas: Map<string, any>; aoAbrir: (id: string, titulo: string) => void;
}) {
  const grupos = [
    { nome: "Tarefas em andamento", icone: Clock, lista: vinculos.filter(v => ["queued", "in_progress"].includes(v.status)) },
    { nome: "Tarefas para revisar ou destravar", icone: CircleAlert, lista: vinculos.filter(v => ["blocked", "awaiting_input", "review"].includes(v.status)) },
    { nome: "Tarefas concluídas com prova", icone: CheckCircle2, lista: vinculos.filter(v => v.status === "done" && v.last_evidence) },
  ];
  const recentes = runs.filter(r => Date.parse(r.started_at) >= Date.now() - 7 * 86400000);
  const incidentes = recentes.filter(r => ["failed", "timeout"].includes(r.status));
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">{grupos.map(g => <div key={g.nome} className={juntar(superficie.painel, "p-4")}><g.icone className="mb-2 h-4 w-4 text-primary" /><p className="text-[24px] font-semibold tabular-nums">{g.lista.length}</p><p className="text-[12px] text-muted-foreground">{g.nome}</p></div>)}</div>
    {grupos.filter(g => g.lista.length).map(g => <section key={g.nome}><h3 className="mb-2 text-[15px] font-semibold">{g.nome}</h3><div className="divide-y divide-border">{g.lista.slice(0, 15).map(v => {
      const t = tarefas.get(v.kanban_task_id || v.painel_task_id);
      const titulo = t?.title || v.last_action || "Atividade do agente";
      const cliente = t?.project?.client;
      return <button type="button" key={v.id} className="block w-full py-3 text-left hover:bg-muted/30" onClick={() => aoAbrir(v.id, titulo)}><p className="text-[13px] font-medium">{titulo}</p><p className="mt-1 text-[12px] text-muted-foreground">{agentes.find(a => a.id === v.operator_id)?.display_name || "Agente"} · {cliente?.company_name || cliente?.full_name || "Operação interna"} · {estadoDaExecucao(v.status)}</p>{v.next_step && <p className="mt-1 text-[12px]">Próximo passo: {v.next_step}</p>}</button>;
    })}</div></section>)}
    <section className={juntar(superficie.painel, "p-4")}><h3 className="text-[15px] font-semibold">Execuções nos últimos 7 dias</h3><p className="mt-1 text-[13px] text-muted-foreground">{recentes.length} registradas · {incidentes.length} com falha ou sem atualização no prazo</p>{incidentes.slice(0, 6).map(r => <p key={r.id} className="mt-3 text-[13px]"><strong>{agentes.find(a => a.id === r.operator_id)?.display_name || "Agente"}:</strong> {falhaDaExecucao(r.error) || estadoDaExecucao(r.status)}</p>)}</section>
  </div>;
}
