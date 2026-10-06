import { useEffect, useState, type ReactNode } from "react";
import { chamarFuncao } from "@/lib/mesa/api";
import type { ItemDoMes } from "./useItensDoMes";

const emCurso = new Map<string, Promise<string>>();
/** A ação oficial tem chave determinística por tema: repetir não duplica tarefas. */
export function prepararPautaPlanejada(item: ItemDoMes): Promise<string> {
  if (!item.planejamento) return Promise.resolve(item.id);
  const existente = emCurso.get(item.id);
  if (existente) return existente;
  const p = chamarFuncao<{ resultado?: { task_id: string | null; indice: number }[]; itens?: { task_id: string | null }[]; proposta?: { itens?: { tema_id: string; task_id?: string }[] } }>("agente-calendario", { acao: "gravar", proposta_id: item.planejamento.proposta_id, tema_ids: [item.planejamento.tema_id], project_id: item.project_id }).then((r) => {
    const id = r.proposta?.itens?.find((i) => i.tema_id === item.planejamento?.tema_id)?.task_id || r.itens?.find((i) => i.task_id)?.task_id;
    if (!id) throw new Error("Não foi possível confirmar a tarefa desta pauta. Tente novamente; a operação não duplica itens.");
    return id;
  });
  emCurso.set(item.id, p);
  void p.catch(() => emCurso.delete(item.id));
  return p;
}
export default function PautaPlanejada({ item, children, onPronta }: { item: ItemDoMes; onPronta?: (id: string) => void; children: (item: ItemDoMes) => ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => { let viva = true; setErro(""); void prepararPautaPlanejada(item).then((id) => { if (viva) { setId(id); onPronta?.(id); } }).catch((e) => { if (viva) setErro(e.message); }); return () => { viva = false; }; }, [item.id, tentativa]);
  return id ? children({ ...item, id, planejamento: undefined }) : <div className="rounded-xl border bg-card p-6" role={erro ? "alert" : "status"}>{erro || "Preparando esta pauta na Agenda…"}{erro && <button className="ml-3 text-primary" onClick={() => setTentativa((v) => v + 1)}>Tentar novamente</button>}</div>;
}
