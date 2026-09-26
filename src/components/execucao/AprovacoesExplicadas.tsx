import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock, HandCoins,
  Loader2, PencilLine, ShieldAlert, Timer, UserCheck,
} from "lucide-react";
import { Carregando, EstadoDeErro, Secao, botao, campo, etiqueta, foco, juntar, superficie, texto } from "@/components/sistema";

/**
 * A aprovação explicada: o selo genérico vira um dossiê de decisão.
 *
 * "Aprovação necessária" sem contexto obriga o dono a caçar em três
 * lugares o que exatamente vai acontecer se ele disser sim. Aqui cada
 * pedido chega com o QUE, o PORQUÊ, os dados, o destino, o risco, o
 * custo e o payload congelado — e os botões decidem chamando um RPC que
 * audita e trava a redecisão.
 *
 * A regra de ouro está no banco, não na tela: o payload é imutável por
 * trigger, e o que for executado depois do sim tem que ser exatamente o
 * que está aqui. Mudou o plano? Nasce outra versão.
 */

type Aprovacao = {
  id: string;
  operator_id: string;
  task_link_id: string | null;
  kanban_task_id: string | null;
  action_kind: string;
  o_que: string;
  por_que: string;
  dados_usados: string | null;
  destino: string | null;
  impacto: string | null;
  risco: string | null;
  custo_previsto: number | null;
  prazo: string | null;
  reversivel: boolean;
  payload: Record<string, unknown>;
  payload_version: number;
  evidencia: string | null;
  status: string;
  valid_until: string | null;
  decision_note: string | null;
  created_at: string;
};

const ROTULO_ACAO: Record<string, string> = {
  publicar: "Publicar",
  agendar: "Agendar",
  enviar_mensagem: "Enviar mensagem",
  contatar_cliente: "Contatar cliente",
  criar_proposta: "Criar proposta",
  enviar_contrato: "Enviar contrato",
  ativar_campanha: "Ativar campanha",
  alterar_orcamento: "Alterar orçamento",
  gastar: "Gastar",
  alterar_financeiro: "Alterar financeiro",
  alterar_permissoes: "Alterar permissões",
  exportar_dados: "Exportar dados",
  excluir_dados: "Excluir dados",
  mudar_estrategia: "Mudar estratégia",
  alterar_responsavel: "Alterar responsável",
  promover_autonomia: "Promover autonomia",
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/** Um campo do dossiê; só aparece se tiver conteúdo — linha vazia é ruído. */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="text-[12px] leading-5 [overflow-wrap:anywhere]">
      <span className="font-medium text-muted-foreground">{rotulo}: </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

export default function AprovacoesExplicadas({
  nomesDeAgentes,
  titulosDeTarefas,
  destaqueId,
  aoAbrirDiario,
}: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  destaqueId: string | null;
  aoAbrirDiario: (linkId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notaPor, setNotaPor] = useState<Record<string, string>>({});
  const [payloadAberto, setPayloadAberto] = useState<Record<string, boolean>>({});

  const { data: aprovacoes = [], error, isLoading, refetch } = useQuery({
    queryKey: ["aprovacoes-explicadas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("*")
        .in("status", ["pendente", "adiado"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data || []) as Aprovacao[];
    },
    refetchInterval: 30_000,
  });

  const decidir = useMutation({
    mutationFn: async ({ id, decisao }: { id: string; decisao: string }) => {
      const { data, error } = await (supabase as any).rpc("operator_approval_decidir", {
        _approval_id: id,
        _decisao: decisao,
        _nota: notaPor[id]?.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
      toast.success(
        vars.decisao === "aprovado"
          ? "Aprovado. O agente só pode executar exatamente este payload."
          : vars.decisao === "rejeitado"
            ? "Rejeitado. O agente não executa e fica registrado o porquê."
            : vars.decisao === "alteracoes_pedidas"
              ? "Alterações pedidas. O agente cria uma nova versão do pedido."
              : "Adiado. Volta à fila até você decidir.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (error) {
    // Falha de leitura NÃO é fila vazia: fila vazia diz "nada esperando
    // você", e isso seria mentira aqui.
    return (
      <EstadoDeErro
        titulo="Não consegui ler as aprovações."
        descricao={<>{error instanceof Error ? error.message : String(error)}. A lista NÃO está vazia, está ilegível.</>}
        acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void refetch()}>Tentar de novo</button>}
      />
    );
  }
  if (isLoading) {
    return <Carregando linhas={2} rotulo="Carregando aprovações" />;
  }
  if (aprovacoes.length === 0) return null;

  return (
    <Secao
      nivel={3}
      titulo="Pedidos de aprovação"
      descricao={`${aprovacoes.length} ${aprovacoes.length === 1 ? "pedido" : "pedidos"}`}
      ajuda="Cada pedido chega com o que vai acontecer, o porquê, os dados, o destino, o risco e o custo. O que for executado depois do sim é exatamente o que está aqui; mudou o plano, nasce outra versão."
    >
      <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")} aria-label="Pedidos de aprovação">
        {aprovacoes.map((a) => {
          const destacada = a.id === destaqueId;
          const temPayload = a.payload && Object.keys(a.payload).length > 0;
          return (
            <li
              key={a.id}
              className={juntar("min-w-0 px-4 py-4", destacada && "bg-primary/10 ring-2 ring-inset ring-primary/50")}
            >
              <div className="-m-0.5 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
                <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>
                  <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />
                  {ROTULO_ACAO[a.action_kind] || a.action_kind}
                </span>
                {a.status === "adiado" && (
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>adiada</span>
                )}
                {!a.reversivel && (
                  <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")}>
                    <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" /> irreversível
                  </span>
                )}
                <span className={juntar(texto.auxiliar, "min-w-0")}>
                  pedido por <strong className="font-medium text-foreground/90">{nomesDeAgentes.get(a.operator_id) || "operador"}</strong>
                  {" · "}{quando(a.created_at)}
                </span>
              </div>

              <p className="mt-2 text-[14px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{a.o_que}</p>
              {a.por_que && <p className={juntar(texto.corpo, "mt-1 text-foreground/85")}>{a.por_que}</p>}

              <div className={juntar(superficie.poco, "mt-2.5 space-y-1 p-3")}>
                <Campo rotulo="Tarefa">{a.kanban_task_id ? titulosDeTarefas.get(a.kanban_task_id) : null}</Campo>
                <Campo rotulo="Dados usados">{a.dados_usados}</Campo>
                <Campo rotulo="Para onde vai">{a.destino}</Campo>
                <Campo rotulo="Impacto">{a.impacto}</Campo>
                <Campo rotulo="Risco">{a.risco}</Campo>
                <Campo rotulo="Evidência">
                  {a.evidencia
                    ? (/^https?:\/\//.test(a.evidencia)
                      ? <a className="break-all text-primary underline" href={a.evidencia} target="_blank" rel="noopener noreferrer">{a.evidencia}</a>
                      : a.evidencia)
                    : null}
                </Campo>
                {(typeof a.custo_previsto === "number" || a.prazo || a.valid_until) && (
                  <div className="-mx-2 flex flex-wrap pt-0.5 [&>*]:mx-2">
                    {typeof a.custo_previsto === "number" && (
                      <span className="inline-flex items-center text-[12px] font-semibold tabular-nums text-foreground">
                        <HandCoins className="mr-1 h-3 w-3 text-warning" aria-hidden="true" />
                        {a.custo_previsto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    )}
                    {a.prazo && (
                      <span className="inline-flex items-center text-[12px] text-muted-foreground">
                        <Clock className="mr-1 h-3 w-3" aria-hidden="true" /> prazo {a.prazo}
                      </span>
                    )}
                    {a.valid_until && (
                      <span className="inline-flex items-center text-[12px] text-muted-foreground">
                        <Timer className="mr-1 h-3 w-3" aria-hidden="true" /> válida até {quando(a.valid_until)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {temPayload && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setPayloadAberto((s) => ({ ...s, [a.id]: !s[a.id] }))}
                    aria-expanded={Boolean(payloadAberto[a.id])}
                    className={juntar("inline-flex items-center rounded text-[12px] font-medium text-muted-foreground hover:text-foreground", foco)}
                  >
                    <ChevronDown className={juntar("mr-1 h-3 w-3 transition-transform", payloadAberto[a.id] && "rotate-180")} aria-hidden="true" />
                    ver exatamente o que será executado se você aprovar (uso técnico)
                  </button>
                  {payloadAberto[a.id] && (
                    <pre className={juntar(superficie.poco, "mt-1 overflow-x-auto p-2 text-[11px] leading-relaxed text-foreground/90")}>
                      {JSON.stringify(a.payload, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              <label className="mt-3 block">
                <span className="sr-only">Nota da decisão</span>
                <input
                  value={notaPor[a.id] || ""}
                  onChange={(e) => setNotaPor((s) => ({ ...s, [a.id]: e.target.value }))}
                  placeholder="Nota da decisão (opcional; obrigatória em pedido de alterações)"
                  className={campo}
                />
              </label>

              <div className="mt-2.5">
                <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
                  <button
                    type="button"
                    disabled={decidir.isPending}
                    onClick={() => decidir.mutate({ id: a.id, decisao: "aprovado" })}
                    className={botao.primario}
                  >
                    {decidir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={decidir.isPending}
                    onClick={() => decidir.mutate({ id: a.id, decisao: "rejeitado" })}
                    className={botao.perigo}
                  >
                    <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Rejeitar
                  </button>
                  <button
                    type="button"
                    disabled={decidir.isPending}
                    onClick={() => {
                      if (!notaPor[a.id]?.trim()) {
                        toast.error("Diga O QUE alterar na nota. Pedido de alterações sem direção só devolve o problema.");
                        return;
                      }
                      decidir.mutate({ id: a.id, decisao: "alteracoes_pedidas" });
                    }}
                    className={botao.secundario}
                  >
                    <PencilLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Pedir alterações
                  </button>
                  {a.status !== "adiado" && (
                    <button
                      type="button"
                      disabled={decidir.isPending}
                      onClick={() => decidir.mutate({ id: a.id, decisao: "adiado" })}
                      className={botao.discreto}
                    >
                      Adiar
                    </button>
                  )}
                  {a.task_link_id && (
                    <button
                      type="button"
                      onClick={() => aoAbrirDiario(a.task_link_id!)}
                      className={juntar(botao.discreto, "sm:ml-auto")}
                    >
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Responder no diário
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
