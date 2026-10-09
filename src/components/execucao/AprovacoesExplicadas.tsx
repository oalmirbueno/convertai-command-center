import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { comandoDaAprovacao } from "@/lib/execucaoApresentacao";
import { centralReviewError } from "@/lib/centralReview";
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
  origin?: string;
  report_id?: string;
  client_id?: string;
  payload_hash?: string;
  client?: { company_name?: string; full_name?: string };
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
  filtroCliente = "",
  filtroVinculos,
}: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  destaqueId: string | null;
  filtroCliente?: string;
  filtroVinculos?: string[];
  aoAbrirDiario: (linkId: string) => void;
}) {
  const queryClient = useQueryClient();
  const chaves = useRef(new Map<string, string>());
  const [notaPor, setNotaPor] = useState<Record<string, string>>({});
  const [payloadAberto, setPayloadAberto] = useState<Record<string, boolean>>({});

  const { data: todasAprovacoes = [], error, isLoading, refetch } = useQuery({
    queryKey: ["aprovacoes-explicadas", filtroVinculos],
    queryFn: async () => {
      if (filtroVinculos && !filtroVinculos.length) return [];
      const todas: Aprovacao[] = [];
      for (let offset = 0; ; offset += 200) {
      let query = (supabase as any)
        .from("operator_approvals")
        .select("*, client:profiles!operator_approvals_client_id_fkey(company_name,full_name)")
        .in("status", ["pendente", "adiado"])
        .order("created_at", { ascending: false })
        .order("id").range(offset, offset + 199);
      if (filtroVinculos) query = query.in("task_link_id", filtroVinculos);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      todas.push(...(data || []));
      if ((data || []).length < 200) return todas;
      }
    },
    refetchInterval: 30_000,
  });

  const aprovacoes = todasAprovacoes.filter(a => (!filtroVinculos || filtroVinculos.includes(a.task_link_id || "")) && (!filtroCliente || a.id === destaqueId || (a.client?.company_name || a.client?.full_name) === filtroCliente)).sort((a, b) => (a.client?.company_name || a.client?.full_name || "Operação interna").localeCompare(b.client?.company_name || b.client?.full_name || "Operação interna"));
  // 09/10: o pedido em destaque (vindo do cartão do vínculo ou do endereço) rola para a vista.
  useEffect(() => {
    if (!destaqueId || !aprovacoes.some((a) => a.id === destaqueId)) return;
    const el = document.querySelector(`[data-aprovacao-id="${destaqueId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destaqueId, aprovacoes.length]);

  const decidir = useMutation({
    mutationFn: async ({ id, decisao }: { id: string; decisao: string }) => {
      const aprovacao = aprovacoes.find(a => a.id === id);
      if (!aprovacao) throw new Error("Atualize a lista antes de decidir.");
      const nota = notaPor[id]?.trim() || "";
      const identidade = JSON.stringify([id, aprovacao.payload_version, decisao, nota]);
      if (!chaves.current.has(identidade)) chaves.current.set(identidade, crypto.randomUUID());
      const comando = comandoDaAprovacao(aprovacao, decisao, nota, chaves.current.get(identidade)!);
      const { data, error } = await (supabase as any).rpc(comando.rpc, comando.args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      // Só retirar depois do recibo do servidor; não aguardar outra leitura para atualizar a lista.
      if (vars.decisao !== "adiado") queryClient.setQueryData<Aprovacao[]>(["aprovacoes-explicadas", filtroVinculos], anterior => anterior?.filter(a => a.id !== vars.id));
      queryClient.invalidateQueries({ queryKey: ["execucao-performance-meta"] });
      queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
      queryClient.invalidateQueries({ queryKey: ["execucao-pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["central-review-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(
        vars.decisao === "aprovado"
          ? "Aprovado. O envio ainda precisa ser executado e confirmado pelo agente."
          : vars.decisao === "rejeitado"
            ? "Rejeitado. O agente não executa e fica registrado o porquê."
            : vars.decisao === "alteracoes_pedidas"
              ? "Alterações pedidas. O agente cria uma nova versão do pedido."
              : "Adiado. Volta à fila até você decidir.",
      );
    },
    onError: (e) => toast.error(centralReviewError(e)),
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
        {aprovacoes.map((a, i) => {
          const relatorio = a.payload?.report as Record<string, any> | undefined;
          const destino = a.payload?.destination as Record<string, any> | undefined;
          const destacada = a.id === destaqueId;
          // Um primário por área (SISTEMA.md seção 6): o pedido em destaque
          // (ou o primeiro, sem destaque) leva o verde; os outros, borda.
          const principal = destacada || (!aprovacoes.some((x) => x.id === destaqueId) && i === 0);
          const temPayload = a.payload && Object.keys(a.payload).length > 0;
          return (
            <li
              key={a.id}
              data-aprovacao-id={a.id}
              className={juntar("min-w-0 px-4 py-4", destacada && "bg-primary/10 ring-2 ring-inset ring-primary/50")}
            >
              {(i === 0 || a.client_id !== aprovacoes[i - 1].client_id) && <h3 className="mb-4 border-b border-border pb-2 text-base font-semibold">{a.client?.company_name || a.client?.full_name || "Operação interna"}</h3>}
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
                  pedido por <strong className="font-medium text-foreground/90">{a.origin === "central" ? "Central do cliente" : nomesDeAgentes.get(a.operator_id) || "agente"}</strong>
                  {" · "}{quando(a.created_at)}
                </span>
              </div>

              {a.client && <p className="mt-2 text-[12px] font-medium text-primary">{a.client.company_name || a.client.full_name}</p>}
              <p className="mt-2 text-[14px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{a.o_que}</p>
              {a.por_que && <p className={juntar(texto.corpo, "mt-1 text-foreground/85")}>{a.por_que}</p>}

              <div className={juntar(superficie.poco, "mt-2.5 space-y-1 p-3")}>
                <Campo rotulo="Tarefa">{a.kanban_task_id ? titulosDeTarefas.get(a.kanban_task_id) : null}</Campo>
                <Campo rotulo="Dados usados">{a.dados_usados}</Campo>
                <Campo rotulo="Para onde vai">{a.destino}</Campo>
                <Campo rotulo="Impacto">{a.impacto}</Campo>
                <Campo rotulo="Como medir">{typeof a.payload?.como_medir === "string" ? a.payload.como_medir : typeof a.payload?.measurement_plan === "string" ? a.payload.measurement_plan : "Critério de medição não informado nesta proposta."}</Campo>
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

              {relatorio && (
                <section className="mt-3 space-y-3 rounded-lg border border-border bg-background p-4" aria-label="Conteúdo para aprovação">
                  <h4 className="text-sm font-semibold">{String(relatorio.title || "Mensagem para o cliente")}</h4>
                  <Campo rotulo="Canal">{destino?.channel === "whatsapp" ? "WhatsApp" : destino?.channel === "portal" ? "Portal do cliente" : a.destino}</Campo>
                  <Campo rotulo="Destinatário">{typeof destino?.recipient === "string" ? destino.recipient : null}</Campo>
                  {[["Mensagem", relatorio.summary], ["Destaques", relatorio.highlights], ["Próximos passos", relatorio.next_steps]].map(([nome, valor]) => typeof valor === "string" && valor.trim() ? (
                    <div key={nome}><p className="text-xs font-medium text-muted-foreground">{nome}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{valor}</p></div>
                  ) : null)}
                  {!relatorio.summary && <p className="text-sm text-warning">A mensagem ainda não foi preparada. Peça alterações antes de aprovar.</p>}
                </section>
              )}
              {temPayload && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setPayloadAberto((s) => ({ ...s, [a.id]: !s[a.id] }))}
                    aria-expanded={Boolean(payloadAberto[a.id])}
                    className={juntar("inline-flex items-center rounded text-[12px] font-medium text-muted-foreground hover:text-foreground", foco)}
                  >
                    <ChevronDown className={juntar("mr-1 h-3 w-3 transition-transform", payloadAberto[a.id] && "rotate-180")} aria-hidden="true" />
                    Detalhes técnicos da versão
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
                    className={principal ? botao.primario : juntar(botao.secundario, "text-success")}
                  >
                    {decidir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                    {decidir.isPending && decidir.variables?.id === a.id ? "Confirmando decisão…" : "Aprovar"}
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
                  {a.status !== "adiado" && a.origin !== "central" && !a.report_id && (
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
