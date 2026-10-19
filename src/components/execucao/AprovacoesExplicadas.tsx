import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { comandoDaAprovacao } from "@/lib/execucaoApresentacao";
import { centralReviewError } from "@/lib/centralReview";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Archive, Bot, Clock, HandCoins, Loader2, MessageCircle, MonitorSmartphone, Timer, UserCheck } from "lucide-react";
import { Carregando, EstadoDeErro, Secao, botao, juntar, superficie } from "@/components/sistema";
import MesaDeDecisao, { type DecisaoDaMesa, type ItemDaMesa } from "@/components/decisao/MesaDeDecisao";
import FotoDoCliente from "@/components/clients/FotoDoCliente";

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
  // 09/10: o pedido em destaque (cartão do vínculo ou endereço) abre direto na mesa (inicialId).

  const decidir = useMutation({
    mutationFn: async ({ id, decisao, nota }: { id: string; decisao: string; nota: string }) => {
      const aprovacao = aprovacoes.find(a => a.id === id);
      if (!aprovacao) throw new Error("Atualize a lista antes de decidir.");
      const identidade = JSON.stringify([id, aprovacao.payload_version, decisao, nota]);
      if (!chaves.current.has(identidade)) chaves.current.set(identidade, crypto.randomUUID());
      const comando = comandoDaAprovacao(aprovacao, decisao, nota, chaves.current.get(identidade)!);
      const { data, error } = await (supabase as any).rpc(comando.rpc, comando.args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (resposta, vars) => {
      // 19/10: a decisão do dono vale mesmo se os dados do cliente mudaram depois do texto (fonte_antiga); só avisa.
      const fonteAntiga = !!(resposta && typeof resposta === "object" && (resposta as { fonte_antiga?: boolean }).fonte_antiga);
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
          ? `Aprovado. O envio ainda precisa ser executado e confirmado pelo agente.${fonteAntiga ? " Os dados do cliente mudaram depois do texto; sua aprovação vale e ficou registrada." : ""}`
          : vars.decisao === "rejeitado"
            ? "Rejeitado. O agente não executa e fica registrado o porquê."
            : vars.decisao === "alteracoes_pedidas"
              ? "Alterações pedidas. O agente cria uma nova versão do pedido."
              : "Adiado. Volta à fila até você decidir.",
      );
    },
    onError: (e) => toast.error(centralReviewError(e)),
  });

  // 15/10 (dono: "fica muito poluído, com um monte de decisões que não dá
  // para decidir"): tirar da lista não apaga nem executa; o pedido vira
  // 'expirado' com o motivo e quem tirou (operator_approval_retirar).
  const retirar = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await (supabase as any).rpc("operator_approval_retirar", { _approval_id: id, _motivo: null });
        if (error) throw new Error(error.message);
      }
      return ids;
    },
    onSuccess: (ids) => {
      queryClient.setQueryData<Aprovacao[]>(["aprovacoes-explicadas", filtroVinculos], (anterior) => anterior?.filter((a) => !ids.includes(a.id)));
      queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
      queryClient.invalidateQueries({ queryKey: ["central-autonomia"] });
      toast.success(ids.length === 1 ? "Tirado da lista. Fica no histórico como expirado." : `${ids.length} pedidos tirados da lista. Ficam no histórico como expirados.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui tirar da lista."),
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

  // Vencida não aceita mais aprovar: sai da fila principal e vai para a lista curta do fim.
  const agora = Date.now();
  const venceu = (a: Aprovacao) => !!a.valid_until && Date.parse(a.valid_until) <= agora && a.id !== destaqueId;
  const vencidas = aprovacoes.filter(venceu);
  const ativas = aprovacoes.filter((a) => !venceu(a));

  const mapa: Record<DecisaoDaMesa, string> = { aprovado: "aprovado", ajuste: "alteracoes_pedidas", rejeitado: "rejeitado", adiado: "adiado" };
  // Mesa de decisão (15/10/2026): um pedido ativo por vez, o essencial à vista e o resto em "Detalhes".
  const itens: ItemDaMesa[] = ativas.map((a) => {
    const relatorio = a.payload?.report as Record<string, any> | undefined;
    const destino = a.payload?.destination as Record<string, any> | undefined;
    const cliente = a.client?.company_name || a.client?.full_name || "Operação interna";
    const comoMedir = typeof a.payload?.como_medir === "string" ? a.payload.como_medir : typeof a.payload?.measurement_plan === "string" ? a.payload.measurement_plan : null;
    const canal = destino?.channel === "whatsapp" ? `WhatsApp${typeof destino?.recipient === "string" ? ` · ${destino.recipient}` : ""}` : destino?.channel === "portal" ? "Portal do cliente" : a.destino;
    return {
      id: a.id,
      tipo: ROTULO_ACAO[a.action_kind] || a.action_kind,
      tomDoTipo: a.reversivel ? "aviso" : "perigo",
      cliente,
      avatar: <FotoDoCliente nome={cliente} foto={null} tamanho="sm" />,
      titulo: String(relatorio?.title || a.o_que),
      mensagem: typeof relatorio?.summary === "string" && relatorio.summary.trim() ? relatorio.summary : a.por_que,
      passo: typeof relatorio?.next_steps === "string" && relatorio.next_steps.trim() ? relatorio.next_steps : null,
      sinais: [
        { icone: <Bot className="h-3 w-3" />, texto: a.origin === "central" ? "Central do cliente" : nomesDeAgentes.get(a.operator_id) || "agente" },
        ...(canal ? [{ icone: destino?.channel === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <MonitorSmartphone className="h-3 w-3" />, texto: canal }] : []),
        ...(typeof a.custo_previsto === "number" ? [{ icone: <HandCoins className="h-3 w-3" />, texto: a.custo_previsto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), tom: "aviso" as const }] : []),
        ...(a.prazo ? [{ icone: <Clock className="h-3 w-3" />, texto: `prazo ${a.prazo}` }] : []),
        ...(a.valid_until ? [{ icone: <Timer className="h-3 w-3" />, texto: `vale até ${quando(a.valid_until)}` }] : []),
        ...(!a.reversivel ? [{ icone: <AlertTriangle className="h-3 w-3" />, texto: "irreversível", tom: "perigo" as const }] : []),
        ...(a.status === "adiado" ? [{ texto: "adiada" }] : []),
      ],
      detalhes: <div className="space-y-1">
        {relatorio && <Campo rotulo="Por quê">{a.por_que}</Campo>}
        <Campo rotulo="Tarefa">{a.kanban_task_id ? titulosDeTarefas.get(a.kanban_task_id) : null}</Campo>
        <Campo rotulo="Dados usados">{a.dados_usados}</Campo>
        <Campo rotulo="Impacto">{a.impacto}</Campo>
        <Campo rotulo="Como medir">{comoMedir}</Campo>
        <Campo rotulo="Risco">{a.risco}</Campo>
        <Campo rotulo="Evidência">{a.evidencia ? (/^https?:\/\//.test(a.evidencia) ? <a className="break-all text-primary underline" href={a.evidencia} target="_blank" rel="noopener noreferrer">{a.evidencia}</a> : a.evidencia) : null}</Campo>
        <Campo rotulo="Pedido em">{quando(a.created_at)}</Campo>
        {a.payload && Object.keys(a.payload).length > 0 && <details className="pt-1"><summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">Detalhes técnicos da versão {a.payload_version}</summary>
          <pre className={juntar(superficie.poco, "mt-1 max-h-60 overflow-auto p-2 text-[11px] leading-relaxed text-foreground/90")}>{JSON.stringify(a.payload, null, 2)}</pre>
        </details>}
      </div>,
      bloqueioDeAprovar: relatorio && !relatorio.summary ? "A mensagem ainda não foi preparada: peça ajuste." : null,
      podeAjuste: true,
      podeRejeitar: true,
      // Pedido da Central (ritual) exige o motivo também na rejeição (regra do banco).
      rejeitarPedeMotivo: a.origin === "central",
      podeAdiar: a.status !== "adiado" && a.origin !== "central" && !a.report_id,
      extras: <>
        {a.task_link_id && <button type="button" onClick={() => aoAbrirDiario(a.task_link_id!)} title="Responder no diário" className={juntar(botao.discreto, "h-11 px-3")}><UserCheck className="h-4 w-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">Diário</span></button>}
        <button type="button" disabled={retirar.isPending} onClick={() => retirar.mutate([a.id])} className={juntar(botao.icone, "h-11 w-11")} aria-label={`Tirar da lista: ${a.o_que}`} title="Tirar da lista (fica no histórico como expirado)">
          {retirar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
        </button>
      </>,
    };
  });

  return (
    <Secao
      nivel={3}
      titulo="Pedidos de aprovação"
      descricao={`${ativas.length} ${ativas.length === 1 ? "pedido" : "pedidos"}${vencidas.length ? ` · ${vencidas.length} ${vencidas.length === 1 ? "vencido" : "vencidos"}` : ""}`}
      ajuda="Um pedido por vez. Aprovar, pedir ajuste (diga o quê) ou rejeitar; decidiu, entra o próximo. O que for executado depois do sim é exatamente o que está no cartão: mudou o plano, nasce outra versão."
    >
      {ativas.length > 0 && <MesaDeDecisao
        rotulo="Pedidos de aprovação"
        itens={itens}
        inicialId={destaqueId && ativas.some((a) => a.id === destaqueId) ? destaqueId : null}
        onDecidir={async (item, decisao, nota) => {
          try { await decidir.mutateAsync({ id: item.id, decisao: mapa[decisao], nota }); return true; }
          catch { return false; }
        }}
      />}

      {vencidas.length > 0 && (
        <div className="mt-4" aria-label="Pedidos vencidos">
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <p className="text-[12px] text-muted-foreground">Venceram: não dá mais para aprovar</p>
            <button
              type="button"
              disabled={retirar.isPending}
              onClick={() => retirar.mutate(vencidas.map((a) => a.id))}
              className={juntar(botao.discreto, "h-7 px-2 text-[12px]")}
            >
              {retirar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Tirar todas da lista
            </button>
          </div>
          <ul className="space-y-0.5">
            {vencidas.map((a) => (
              <li key={a.id} data-aprovacao-id={a.id} className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <Timer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground/90">{a.o_que}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.client?.company_name || a.client?.full_name || "Operação interna"} · venceu {quando(a.valid_until!)}</span>
                </span>
                <button
                  type="button"
                  disabled={retirar.isPending}
                  onClick={() => retirar.mutate([a.id])}
                  className={botao.icone}
                  aria-label={`Tirar da lista: ${a.o_que}`}
                  title="Tirar da lista (fica no histórico como expirado)"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Secao>
  );
}
