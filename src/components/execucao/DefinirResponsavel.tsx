import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, UserRound, UserX } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quem responde por esta tarefa.
 *
 * O agente executa; a conta é de uma pessoa. Até aqui só dava para
 * definir isso no card do Kanban — e na Execução, onde o dono passa o dia
 * olhando o trabalho acontecer, ele via "sem responsável" e não tinha o
 * que fazer a respeito.
 *
 * A escrita é a mesma de sempre (`tasks.assigned_to`), feita por uma
 * pessoa logada. Agente nenhum passa por aqui: quando um agente acha que
 * a tarefa é de alguém, ele PROPÕE, e a proposta é decidida no painel de
 * aprovações.
 */

export default function DefinirResponsavel({
  taskId,
  tituloDaTarefa,
  responsavelAtual,
  aberto,
  aoFechar,
}: {
  taskId: string | null;
  tituloDaTarefa?: string | null;
  responsavelAtual?: string | null;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const { data: pessoas = [], error } = useQuery({
    queryKey: ["responsaveis-possiveis"],
    queryFn: async () => {
      // Só quem é da casa: papéis não-cliente. Oferecer um cliente como
      // responsável interno seria um erro fácil de cometer e caro de
      // desfazer.
      const { data: papeis, error: erroPapeis } = await (supabase as any)
        .from("user_roles").select("user_id, role").neq("role", "client");
      if (erroPapeis) throw new Error(erroPapeis.message);
      const ids = [...new Set(((papeis || []) as any[]).map((p) => p.user_id))];
      if (ids.length === 0) return [];

      const { data, error: erroPerfis } = await (supabase as any)
        .from("profiles").select("id, full_name")
        .in("id", ids)
        // Desativado não pode receber tarefa nova: perdeu o acesso.
        .is("deleted_at", null)
        .order("full_name");
      if (erroPerfis) throw new Error(erroPerfis.message);

      const papelDe = new Map(((papeis || []) as any[]).map((p) => [p.user_id, p.role]));
      return ((data || []) as any[]).map((p) => ({ ...p, role: papelDe.get(p.id) || "equipe" }));
    },
    enabled: aberto,
  });

  const definir = useMutation({
    mutationFn: async (novoId: string | null) => {
      const { error } = await (supabase as any)
        .from("tasks").update({ assigned_to: novoId }).eq("id", taskId);
      if (error) throw new Error(error.message);
      return novoId;
    },
    onSuccess: (novoId) => {
      for (const k of [["operador-tarefas"], ["operador-tarefas-disponiveis"], ["tasks"],
                       ["contexto-do-agente", taskId]]) {
        qc.invalidateQueries({ queryKey: k as any });
      }
      toast.success(novoId ? "Responsável definido" : "Responsável removido");
      aoFechar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const filtradas = pessoas.filter((p: any) =>
    !busca.trim() || String(p.full_name || "").toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="max-h-[80vh] max-w-sm overflow-y-auto">
        <DialogTitle className="text-[15px]">Quem responde por esta tarefa</DialogTitle>
        <DialogDescription className="text-[11.5px]">
          {tituloDaTarefa || "O agente executa; a conta continua sendo de uma pessoa."}
        </DialogDescription>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-secondary p-3 text-[11.5px] text-destructive">
            Não consegui ler a equipe: {error instanceof Error ? error.message : String(error)}.
            A lista <strong>não</strong> está vazia — está ilegível.
          </p>
        ) : (
          <>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa…"
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {filtradas.length === 0 && (
                <p className="py-4 text-center text-[11px] text-muted-foreground">
                  Ninguém encontrado.
                </p>
              )}
              {filtradas.map((p: any) => {
                const atual = p.id === responsavelAtual;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={definir.isPending}
                    onClick={() => definir.mutate(p.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50",
                      atual ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                    )}
                  >
                    <UserRound className={cn("h-3.5 w-3.5", atual ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">
                        {p.full_name || "(sem nome)"}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">{p.role}</span>
                    </span>
                    {atual && <span className="text-[10px] font-semibold text-primary">atual</span>}
                  </button>
                );
              })}
            </div>

            {responsavelAtual && (
              <button
                type="button"
                disabled={definir.isPending}
                onClick={() => definir.mutate(null)}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                {definir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                Deixar sem responsável
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
