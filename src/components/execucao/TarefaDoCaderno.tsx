import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { botao, campo, campoTexto } from "@/components/sistema";

export default function TarefaDoCaderno({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [descricao, setDescricao] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const tarefa = useQuery({
    queryKey: ["caderno-tarefa", linkId],
    queryFn: async () => {
      const v = await supabase.from("operator_task_links").select("kanban_task_id,painel_task_id").eq("id", linkId).single();
      if (v.error) throw v.error;
      const id = v.data.kanban_task_id || v.data.painel_task_id;
      if (!id) throw new Error("Esta execução ainda não tem tarefa vinculada.");
      const t = await supabase.from("tasks").select("id,title,description,due_date,status").eq("id", id).single();
      if (t.error) throw t.error;
      return t.data;
    },
  });
  const lista = useQuery({
    queryKey: ["task-checklist", tarefa.data?.id], enabled: !!tarefa.data?.id,
    queryFn: async () => {
      const r = await supabase.from("task_checklist_items").select("id,title,checked,item_order").eq("task_id", tarefa.data!.id).order("item_order");
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const salvar = useMutation({
    mutationFn: async (acao: { tipo: "descricao" | "adicionar" | "marcar"; id?: string; checked?: boolean }) => {
      if (!tarefa.data || !user) throw new Error("A tarefa ainda não foi carregada.");
      const r = acao.tipo === "descricao"
        ? await supabase.from("tasks").update({ description: (descricao ?? tarefa.data.description ?? "").trim() || null }).eq("id", tarefa.data.id).select("id").single()
        : acao.tipo === "adicionar"
          ? await supabase.from("task_checklist_items").insert({ task_id: tarefa.data.id, title: item.trim(), item_order: Math.max(-1, ...(lista.data || []).map(i => i.item_order)) + 1, created_by: user.id }).select("id").single()
          : await supabase.from("task_checklist_items").update({ checked: acao.checked }).eq("id", acao.id!).eq("task_id", tarefa.data.id).select("id").single();
      if (r.error) throw r.error;
      return acao.tipo;
    },
    onSuccess: tipo => {
      if (tipo === "adicionar") setItem("");
      if (tipo === "descricao") { setDescricao(null); toast.success("Descrição salva na tarefa."); }
      void qc.invalidateQueries({ queryKey: ["caderno-tarefa", linkId] });
      void qc.invalidateQueries({ queryKey: ["task-checklist", tarefa.data?.id] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: e => toast.error(e.message),
  });
  if (tarefa.isPending) return <p>Carregando tarefa…</p>;
  if (tarefa.error) return <div role="alert"><p>{tarefa.error.message}</p><button className={botao.secundario} onClick={() => void tarefa.refetch()}>Tentar novamente</button></div>;
  return <div className="mx-auto max-w-3xl space-y-6">
    <section className="space-y-3"><h3 className="font-semibold">Descrição</h3>
      <textarea aria-label="Descrição da tarefa" className={campoTexto + " min-h-32 w-full"} value={descricao ?? tarefa.data?.description ?? ""} onChange={e => setDescricao(e.target.value)} placeholder="O que será entregue e quais são os critérios de conclusão?" />
      <button className={botao.secundario} disabled={salvar.isPending || descricao === null} onClick={() => salvar.mutate({ tipo: "descricao" })}>{salvar.isPending ? "Salvando…" : "Salvar descrição"}</button>
    </section>
    <section className="space-y-3"><h3 className="font-semibold">Checklist <span className="text-sm text-muted-foreground">{(lista.data || []).filter(i => i.checked).length}/{lista.data?.length || 0}</span></h3>
      {lista.error && <button className="text-warning" onClick={() => void lista.refetch()}>Não consegui ler o checklist. Tentar novamente</button>}
      {lista.data?.map(i => <label key={i.id} className="flex items-start gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={i.checked} disabled={salvar.isPending} onChange={e => salvar.mutate({ tipo: "marcar", id: i.id, checked: e.target.checked })} className="mt-1 accent-primary" /><span className={i.checked ? "text-muted-foreground line-through" : ""}>{i.title}</span></label>)}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (item.trim()) salvar.mutate({ tipo: "adicionar" }); }}><input aria-label="Novo item do checklist" value={item} onChange={e => setItem(e.target.value)} className={campo + " flex-1"} placeholder="Adicionar uma etapa" maxLength={500} /><button className={botao.secundario} disabled={!item.trim() || salvar.isPending || lista.isPending || !!lista.error}>Adicionar</button></form>
    </section>
  </div>;
}
