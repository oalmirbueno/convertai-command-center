import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Ban, Bot, CheckCircle2, Clock, Loader2, UserPlus } from "lucide-react";
import { EstadoDeErro, Secao, botao, juntar } from "@/components/sistema";
import MesaDeDecisao, { type DecisaoDaMesa, type ItemDaMesa } from "@/components/decisao/MesaDeDecisao";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { buscarTodas } from "@/lib/buscaCompleta";

/**
 * Propostas de responsável: o agente sugere, o humano decide.
 *
 * O `assigned_to` é território de gente — o agente nunca escreve nele.
 * O que ele pode é perceber que a tarefa está órfã e propor um dono, com
 * justificativa e confiança. A ÚNICA escrita no responsável acontece no
 * RPC de decisão, atrás do clique de um admin — e a trilha registra o
 * antes e o depois.
 */

type Proposta = {
  id: string;
  kanban_task_id: string;
  current_assignee: string | null;
  suggested_assignee: string;
  operator_id: string;
  justificativa: string;
  confianca: number | null;
  prazo: string | null;
  impacto: string | null;
  status: string;
  created_at: string;
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function PropostasDeResponsavel({
  nomesDeAgentes,
  titulosDeTarefas,
  destaqueId,
}: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  destaqueId: string | null;
}) {
  const queryClient = useQueryClient();

  const { data: propostas = [], error, refetch } = useQuery({
    queryKey: ["propostas-responsavel"],
    queryFn: async () => {
      // Todas as pendentes, sem teto escondido: com 30 de 300 na tela, o
      // dono decidia a vida inteira e a fila nunca zerava.
      const { linhas } = await buscarTodas<Proposta>((de, ate) =>
        (supabase as any)
          .from("assignment_proposals")
          .select("*")
          .eq("status", "pendente")
          .order("created_at", { ascending: false })
          .range(de, ate),
      );
      return linhas;
    },
    refetchInterval: 30_000,
  });

  // Os nomes das pessoas resolvidos AQUI: o sugerido pode nao aparecer em
  // nenhuma outra lista da pagina, e proposta exibindo UUID nao decide nada.
  const idsDePessoas = [...new Set(
    propostas.flatMap((p) => [p.suggested_assignee, p.current_assignee]).filter(Boolean),
  )] as string[];
  const { data: nomesDePessoas = new Map<string, string>() } = useQuery({
    queryKey: ["propostas-pessoas", idsDePessoas.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles").select("id, full_name").in("id", idsDePessoas);
      if (error) throw new Error(error.message);
      const m = new Map<string, string>();
      for (const p of data || []) m.set(String(p.id), p.full_name || "pessoa");
      return m;
    },
    enabled: idsDePessoas.length > 0,
  });

  // Titulo, cliente e prazo de cada tarefa proposta: a pagina so conhece as
  // tarefas que ja tem vinculo, e proposta sem nome nao decide nada.
  const idsDeTarefas = [...new Set(propostas.map((p) => p.kanban_task_id).filter(Boolean))];
  const { data: tarefasDasPropostas = new Map<string, { titulo: string; cliente: string | null; prazo: string | null }>() } = useQuery({
    queryKey: ["propostas-tarefas", idsDeTarefas.join(",")],
    queryFn: async () => {
      const m = new Map<string, { titulo: string; cliente: string | null; prazo: string | null }>();
      for (let i = 0; i < idsDeTarefas.length; i += 100) {
        const { data } = await (supabase as any)
          .from("tasks")
          .select("id, title, due_date, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))")
          .in("id", idsDeTarefas.slice(i, i + 100));
        for (const t of data || []) {
          const c = t.project?.client;
          m.set(String(t.id), { titulo: String(t.title || ""), cliente: c ? (c.company_name || c.full_name) : null, prazo: t.due_date ?? null });
        }
      }
      return m;
    },
    enabled: idsDeTarefas.length > 0,
  });
  const tituloDe = (id: string) => tarefasDasPropostas.get(id)?.titulo || titulosDeTarefas.get(id) || "a tarefa";

  // Agrupadas por pessoa sugerida: 126 propostas para a mesma pessoa se
  // decidem em um clique, nao em 126.
  const grupos = useMemo(() => {
    const m = new Map<string, Proposta[]>();
    for (const p of propostas) m.set(p.suggested_assignee, [...(m.get(p.suggested_assignee) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [propostas]);
  const [lote, setLote] = useState<string | null>(null);

  const decidirLote = async (ids: string[], decisao: "aprovada" | "rejeitada", rotulo: string) => {
    if (ids.length === 0 || lote) return;
    if (!window.confirm(`${decisao === "aprovada" ? "Aprovar e designar" : "Rejeitar"} ${ids.length} proposta${ids.length === 1 ? "" : "s"} para ${rotulo}?`)) return;
    setLote(rotulo);
    try {
      const { data, error } = await (supabase as any).rpc("assignment_proposal_decidir_lote", { _proposal_ids: ids, _decisao: decisao, _nota: null });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { decididas?: number; erros?: unknown[] };
      queryClient.invalidateQueries({ queryKey: ["propostas-responsavel"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas-disponiveis"] });
      const erros = Array.isArray(r.erros) ? r.erros.length : 0;
      if (erros > 0) toast.warning(`${r.decididas ?? 0} decidida${(r.decididas ?? 0) === 1 ? "" : "s"}, ${erros} com erro (ficaram pendentes).`);
      else toast.success(`${r.decididas ?? 0} proposta${(r.decididas ?? 0) === 1 ? "" : "s"} ${decisao === "aprovada" ? "aprovada(s) e designada(s)" : "rejeitada(s)"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setLote(null); }
  };

  const decidir = useMutation({
    mutationFn: async ({ id, decisao, nota }: { id: string; decisao: string; nota: string }) => {
      const { error } = await (supabase as any).rpc("assignment_proposal_decidir", {
        _proposal_id: id,
        _decisao: decisao,
        _nota: nota.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["propostas-responsavel"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas-disponiveis"] });
      toast.success(
        vars.decisao === "aprovada"
          ? "Aprovada: o responsável foi atualizado e a pessoa foi avisada."
          : vars.decisao === "rejeitada"
            ? "Rejeitada. Nada mudou na tarefa."
            : "Pedido de esclarecimento registrado.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (error) {
    return (
      <EstadoDeErro
        titulo="Não consegui ler as propostas de responsável."
        descricao={error instanceof Error ? error.message : String(error)}
        acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void refetch()}>Tentar de novo</button>}
      />
    );
  }
  if (propostas.length === 0) return null;

  // Mesa de decisão (15/10/2026): uma proposta por vez; o lote por pessoa fica recolhido em cima.
  const mapa: Record<DecisaoDaMesa, string> = { aprovado: "aprovada", rejeitado: "rejeitada", ajuste: "esclarecimento", adiado: "esclarecimento" };
  const itens: ItemDaMesa[] = propostas.map((p) => {
    const tarefa = tarefasDasPropostas.get(p.kanban_task_id);
    const pessoa = nomesDePessoas.get(p.suggested_assignee) || "pessoa";
    return {
      id: p.id,
      tipo: "Responsável sugerido",
      tomDoTipo: "primario",
      cliente: tarefa?.cliente || "Operação interna",
      avatar: <FotoDoCliente nome={pessoa} foto={null} tamanho="sm" />,
      titulo: `${pessoa} para ${tituloDe(p.kanban_task_id)}`,
      mensagem: p.justificativa,
      passo: p.impacto ? `Se ninguém assumir: ${p.impacto}` : null,
      sinais: [
        { icone: <Bot className="h-3 w-3" />, texto: nomesDeAgentes.get(p.operator_id) || "operador" },
        ...(typeof p.confianca === "number" ? [{ texto: `confiança ${(p.confianca * 100).toFixed(0)}%`, tom: (p.confianca >= 0.7 ? "primario" : "aviso") as "primario" | "aviso" }] : []),
        { icone: <UserPlus className="h-3 w-3" />, texto: p.current_assignee ? `hoje com ${nomesDePessoas.get(p.current_assignee) || "outra pessoa"}` : "hoje sem responsável", tom: p.current_assignee ? "neutro" : "aviso" },
        ...(tarefa?.prazo ? [{ icone: <Clock className="h-3 w-3" />, texto: `prazo ${tarefa.prazo.slice(8, 10)}/${tarefa.prazo.slice(5, 7)}` }] : []),
      ],
      detalhes: <div className="space-y-1">
        {p.prazo && <p>Prazo relevante: {p.prazo}</p>}
        <p>Sugerido em {quando(p.created_at)}</p>
      </div>,
      podeAjuste: true,
      podeRejeitar: true,
      rotuloAjuste: "Pedir esclarecimento",
      sugestoesAjuste: ["Por que essa pessoa?", "Tem outra pessoa livre?", "Qual o prazo real?"],
    };
  });

  return (
    <Secao
      nivel={3}
      titulo="Responsáveis sugeridos"
      descricao={`${propostas.length} ${propostas.length === 1 ? "proposta" : "propostas"}`}
      ajuda="O agente sugere quem deveria responder por uma tarefa; quem decide é você. Aprovar grava o responsável e avisa a pessoa; nada muda sem o seu clique."
    >
      {grupos.length > 0 && propostas.length > 1 && (
        <details className="mb-3 text-[13px]">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Decidir em lote por pessoa</summary>
          <ul className="mt-2 divide-y divide-border">
            {grupos.map(([pessoaId, lista]) => {
              const nomePessoa = nomesDePessoas.get(pessoaId) || "pessoa";
              return (
                <li key={pessoaId} className="flex min-w-0 flex-wrap items-center py-2">
                  <span className="mr-2 min-w-0 flex-1 truncate">{nomePessoa} · {lista.length} proposta{lista.length === 1 ? "" : "s"}</span>
                  <span className="-m-0.5 flex shrink-0 flex-wrap [&>*]:m-0.5">
                    <button type="button" disabled={lote !== null} onClick={() => void decidirLote(lista.map((p) => p.id), "rejeitada", nomePessoa)} className={juntar(botao.perigo, "h-8 px-2.5 text-[12px]")}>
                      <Ban className="mr-1 h-3 w-3" aria-hidden="true" /> Rejeitar todas
                    </button>
                    <button type="button" disabled={lote !== null} onClick={() => void decidirLote(lista.map((p) => p.id), "aprovada", nomePessoa)} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px] text-success")}>
                      {lote === nomePessoa ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />} Aprovar todas
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <MesaDeDecisao
        rotulo="Responsáveis sugeridos"
        itens={itens}
        inicialId={destaqueId && propostas.some((p) => p.id === destaqueId) ? destaqueId : null}
        onDecidir={async (item, decisao, nota) => {
          try { await decidir.mutateAsync({ id: item.id, decisao: mapa[decisao], nota }); return true; }
          catch { return false; }
        }}
      />
    </Secao>
  );
}
