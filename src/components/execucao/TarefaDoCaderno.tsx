import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, CircleDot } from "lucide-react";
import { Carregando, botao, campo, campoTexto, juntar } from "@/components/sistema";

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
      // maybeSingle: a tarefa pode ter sido apagada no Kanban (o vinculo nao tem FK dura).
      const t = await supabase.from("tasks").select("id,title,description,due_date,status").eq("id", id).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) throw new Error("A tarefa desta execução foi apagada do Kanban.");
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
  if (tarefa.isPending) return <Carregando linhas={3} rotulo="Carregando tarefa" />;
  if (tarefa.error) return <div role="alert"><p>{tarefa.error.message}</p><button className={botao.secundario} onClick={() => void tarefa.refetch()}>Tentar novamente</button></div>;
  // 16/10 (dono: "deixar mais intuitiva e mais visual, vendo o que foi feito, o que está fazendo e o
  // que está em andamento"): progresso, a etapa de agora em destaque e o resto em ordem.
  const itens = lista.data || [];
  const feitos = itens.filter(i => i.checked);
  const abertos = itens.filter(i => !i.checked);
  const [agora, ...depois] = abertos;
  const pct = itens.length ? Math.round((feitos.length / itens.length) * 100) : 0;
  const marcar = (id: string, checked: boolean) => salvar.mutate({ tipo: "marcar", id, checked });
  const Linha = ({ i, destaque = false }: { i: { id: string; title: string; checked: boolean }; destaque?: boolean }) => (
    <label className={juntar("flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors", destaque ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/50")}>
      <input type="checkbox" checked={i.checked} disabled={salvar.isPending} onChange={e => marcar(i.id, e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
      <span className={juntar("text-[14px] leading-6", i.checked && "text-muted-foreground line-through")}>{i.title}</span>
    </label>
  );
  return <div className="mx-auto max-w-3xl space-y-6">
    <section className="rounded-xl bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{tarefa.data?.title}</h3>
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{feitos.length} de {itens.length} etapas</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do checklist">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {!itens.length && !lista.isPending && <p className="mt-3 text-[13px] text-muted-foreground">Sem etapas ainda. O agente preenche o checklist quando começa; você também pode adicionar abaixo.</p>}
    </section>
    {lista.error && <button className="text-warning" onClick={() => void lista.refetch()}>Não consegui ler o checklist. Tentar novamente</button>}
    {agora && <section className="space-y-1.5"><h4 className="flex items-center gap-1.5 text-[12px] font-medium text-primary"><CircleDot className="h-3.5 w-3.5" />Fazendo agora</h4><Linha i={agora} destaque /></section>}
    {depois.length > 0 && <section className="space-y-0.5"><h4 className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" />Depois</h4>{depois.map(i => <Linha key={i.id} i={i} />)}</section>}
    {feitos.length > 0 && <section className="space-y-0.5"><h4 className="flex items-center gap-1.5 text-[12px] font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" />Feito</h4>{feitos.map(i => <Linha key={i.id} i={i} />)}</section>}
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (item.trim()) salvar.mutate({ tipo: "adicionar" }); }}><input aria-label="Novo item do checklist" value={item} onChange={e => setItem(e.target.value)} className={campo + " flex-1"} placeholder="Adicionar uma etapa" maxLength={500} /><button className={botao.secundario} disabled={!item.trim() || salvar.isPending || lista.isPending || !!lista.error}>Adicionar</button></form>
    <details className="rounded-xl bg-card p-4">
      <summary className="cursor-pointer text-[13px] font-medium">Descrição e critérios da tarefa</summary>
      <div className="mt-3 space-y-3">
        <textarea aria-label="Descrição da tarefa" className={campoTexto + " min-h-32 w-full"} value={descricao ?? tarefa.data?.description ?? ""} onChange={e => setDescricao(e.target.value)} placeholder="O que será entregue e quais são os critérios de conclusão?" />
        <button className={botao.secundario} disabled={salvar.isPending || descricao === null} onClick={() => salvar.mutate({ tipo: "descricao" })}>{salvar.isPending ? "Salvando…" : "Salvar descrição"}</button>
      </div>
    </details>
  </div>;
}
