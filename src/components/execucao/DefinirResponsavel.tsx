import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search, UserRound, UserX } from "lucide-react";
import { Carregando, EstadoDeErro, botao, campo, foco, juntar, texto } from "@/components/sistema";

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

  const { data: pessoas = [], error, isLoading, refetch } = useQuery({
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
      <DialogContent className="flex max-h-[80vh] max-w-sm flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-5 pb-3 pt-5 pr-12">
          <DialogTitle className={juntar(texto.tituloSecao, "text-left")}>Quem responde por esta tarefa</DialogTitle>
          <DialogDescription className={juntar(texto.auxiliar, "mt-1 truncate text-left")}>
            {tituloDaTarefa || "O agente executa; a conta continua sendo de uma pessoa."}
          </DialogDescription>
        </div>

        {error ? (
          <div className="p-4">
            <EstadoDeErro
              titulo="Não consegui ler a equipe."
              descricao={<>{error instanceof Error ? error.message : String(error)}. A lista não está vazia, está ilegível.</>}
              acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void refetch()}>Tentar de novo</button>}
            />
          </div>
        ) : (
          <>
            <div className="shrink-0 px-4 pt-3">
              <label className="relative block">
                <span className="sr-only">Buscar pessoa</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar pessoa"
                  className={juntar(campo, "pl-8")}
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {isLoading ? (
                <Carregando linhas={4} rotulo="Carregando a equipe" className="px-2" />
              ) : filtradas.length === 0 ? (
                <p className={juntar(texto.auxiliar, "py-4 text-center")}>
                  Ninguém encontrado.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtradas.map((p: any) => {
                    const atual = p.id === responsavelAtual;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={definir.isPending}
                          onClick={() => definir.mutate(p.id)}
                          aria-current={atual ? "true" : undefined}
                          className={juntar(
                            "flex w-full min-w-0 items-center rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-50",
                            atual && "bg-primary/10",
                            foco,
                          )}
                        >
                          <UserRound className={juntar("mr-2 h-3.5 w-3.5 shrink-0", atual ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-foreground">
                              {p.full_name || "(sem nome)"}
                            </span>
                            <span className="block text-[11.5px] text-muted-foreground">{p.role}</span>
                          </span>
                          {atual && <span className="ml-2 text-[11.5px] font-medium text-primary">atual</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {responsavelAtual && (
              <div className="shrink-0 border-t border-border px-4 py-3">
                <button
                  type="button"
                  disabled={definir.isPending}
                  onClick={() => definir.mutate(null)}
                  className={juntar(botao.secundario, "w-full hover:text-destructive")}
                >
                  {definir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <UserX className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  Deixar sem responsável
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
