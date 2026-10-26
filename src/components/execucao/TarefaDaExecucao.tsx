import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * 26/10/2026 (dono: "Tarefas: quando eu clico em algumas coisas, está bem bugado"): a Execução
 * abria o cartão do Kanban com a linha ENXUTA que ela lê para o quadro (sem prioridade, sem área,
 * às vezes só o id). A janela mostrava prioridade e área vazias, salvar regravava a área como
 * "Geral" e, quando a tarefa ainda não tinha chegado ao mapa, o título vinha vazio e salvar
 * quebrava. Aqui a tarefa inteira é lida antes de a janela abrir; o Esc fecha, como nas outras
 * janelas do painel.
 */
export default function TarefaDaExecucao({ tarefa, aoFechar, desenhar }: {
  tarefa: { id: string } & Record<string, unknown>;
  aoFechar: () => void;
  desenhar: (completa: Record<string, any>) => ReactNode;
}) {
  const id = String(tarefa.id);
  const q = useQuery({
    queryKey: ["execucao-tarefa-completa", id],
    staleTime: 0,
    // Releitura no foco trocaria o objeto e a janela descartaria a edição em curso.
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tasks").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Record<string, any> | null;
    },
  });

  useEffect(() => {
    if (q.isSuccess && !q.data) { toast.error("Esta tarefa não existe mais ou você não tem acesso a ela."); aoFechar(); }
    if (q.isError && !tarefa.title) { toast.error("Não foi possível abrir a tarefa agora. Tente de novo."); aoFechar(); }
  }, [q.isSuccess, q.isError, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // O campo de menção da janela usa o Esc para fechar a lista dele (preventDefault).
      if (e.key === "Escape" && !e.defaultPrevented) aoFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aoFechar]);

  // Falhou a leitura completa mas a linha do quadro tem título: abre com ela (melhor que nada).
  const completa = q.data ?? (q.isError && tarefa.title ? tarefa : null);
  if (!completa) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="status" aria-label="Abrindo a tarefa" onClick={aoFechar}>
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
      </div>
    );
  }
  return <>{desenhar(completa)}</>;
}
