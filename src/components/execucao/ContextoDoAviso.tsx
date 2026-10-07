import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function destinoOperacional(link: string): string {
  if (!/^\/execucao(?:[?#]|$)/.test(link)) return link;
  const u = new URL(link, "https://aceleriq.online");
  if (u.searchParams.get("vinculo") && !u.searchParams.has("aprovacao")) u.searchParams.set("aba", "diario");
  return u.pathname + u.search;
}
export default function ContextoDoAviso({ link }: { link: string }) {
  const u = new URL(/^\/execucao(?:[?#]|$)/.test(link) ? link : "/", "https://aceleriq.online");
  const vinculo = u.searchParams.get("vinculo");
  const run = u.searchParams.get("run") || u.searchParams.get("execucao");
  const { data } = useQuery({
    queryKey: ["contexto-aviso-execucao", vinculo, run], staleTime: 30_000,
    enabled: /^\/execucao(?:[?#]|$)/.test(link) && !!(vinculo || run),
    queryFn: async () => {
      let id = vinculo;
      let titulo: string | undefined;
      if (run) {
        const r = await (supabase as any).from("operator_runs").select("task_link_id,detail").eq("id", run).maybeSingle();
        if (r.error) throw r.error;
        id ||= r.data?.task_link_id;
        titulo = r.data?.detail?.title || r.data?.detail?.action;
      }
      if (!id) return titulo || "Execução interna — abrir para conferir o andamento";
      const v = await (supabase as any).from("operator_task_links").select("kanban_task_id,painel_task_id,last_action").eq("id", id).maybeSingle();
      if (v.error) throw v.error;
      const taskId = v.data?.kanban_task_id || v.data?.painel_task_id;
      if (!taskId) return titulo || v.data?.last_action;
      const t = await (supabase as any).from("tasks").select("title,project:projects!tasks_project_id_fkey(name,client:profiles!projects_client_id_fkey(company_name,full_name))").eq("id", taskId).maybeSingle();
      if (t.error) throw t.error;
      const c = t.data?.project?.client;
      return [c?.company_name || c?.full_name, t.data?.title || titulo].filter(Boolean).join(" · ");
    },
  });
  return data ? <p className="mt-1 text-[12px] leading-relaxed text-foreground/80">{data}</p> : null;
}
