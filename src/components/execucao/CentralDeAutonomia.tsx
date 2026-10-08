import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileCheck2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, SeletorCompacto, botao, juntar, texto, useEstadoDaTela,
} from "@/components/sistema";
import AprovacoesExplicadas from "@/components/execucao/AprovacoesExplicadas";
import GestorConversa, { type PedidoAoHermes } from "@/components/execucao/GestorConversa";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";
import {
  calcularIndicadores, divergenciaDoVinculo, execucaoNoIntervalo, PERIODOS_DA_CENTRAL, resultadoVerificado, ROTULO_DO_RESULTADO, variacao,
  type ExecucaoContada, type PeriodoDaCentral, type ResultadoVerificado, type VinculoContado,
} from "@/lib/centralAutonomia";
import { periodoDaPergunta } from "../../../supabase/functions/gestor-aceleriq/modulos/ficha";

/**
 * Central de Autonomia (aba "Central" da Execução, 08/10/2026).
 *
 * Uma tela que responde "o que a operação fez, com prova":
 * - Gestor Aceleriq: o chat do dono sobre os dados reais (função
 *   gestor-aceleriq). Toda frase cita fontes do OS; o código e o Jev recusam
 *   o que não bate. Encaminhar ao Hermes usa o diário (o canal que o
 *   consumidor do Hermes já lê); quem envia é o dono.
 * - Indicadores: tarefa e execução contadas separadas, com o período anterior.
 * - Histórico: cada execução com agente, tarefa, cliente, início/fim, trilha,
 *   provas, resultado verificado (revisão nunca vira concluída), bloqueio e
 *   próximo passo.
 * - Decisões: as aprovações pendentes, pelo mecanismo que já existe.
 */

export type { PedidoAoHermes } from "@/components/execucao/GestorConversa";

const quando = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

const COR_DO_RESULTADO: Record<ResultadoVerificado, string> = {
  concluida_com_prova: "border-success/40 text-success",
  execucao_concluida_entrega_em_revisao: "border-info/40 text-info",
  em_revisao: "border-info/40 text-info",
  em_andamento: "border-border text-muted-foreground",
  bloqueada: "border-warning/40 text-warning",
  aguardando_insumo: "border-warning/40 text-warning",
  falhou: "border-destructive/40 text-destructive",
  sem_sinal: "border-destructive/40 text-destructive",
  concluida_sem_prova: "border-warning/40 text-warning",
};

// ------------------------------------------------------------------ dados dos indicadores e do histórico

type LinhaDoHistorico = ExecucaoContada & { run_key: string; error: string | null; detail: Record<string, unknown> | null };

function useDadosDaCentral(chave: PeriodoDaCentral) {
  const p = useMemo(() => periodoDaPergunta("", new Date(), chave), [chave]);
  return useQuery({
    queryKey: ["central-autonomia", chave, p.desde],
    refetchInterval: 60_000,
    queryFn: async () => {
      const s = supabase as any;
      const [abertas, feitas, feitasAntes, runs, vinculos, aprov, agentes] = await Promise.all([
        s.from("tasks").select("id,status,updated_at").is("deleted_at", null).in("status", ["backlog", "todo", "doing", "review"]).limit(5000),
        s.from("tasks").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "done").gte("updated_at", p.desde).lt("updated_at", p.ate),
        s.from("tasks").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "done").gte("updated_at", p.anterior.desde).lt("updated_at", p.anterior.ate),
        s.from("operator_runs").select("id,operator_id,task_link_id,status,started_at,finished_at,heartbeat_at,run_key,error,detail").or(`heartbeat_at.gte.${p.anterior.desde},started_at.gte.${p.anterior.desde}`).order("started_at", { ascending: false }).limit(1000),
        s.from("operator_task_links").select("id,status,operator_id,kanban_task_id,painel_task_id,last_action,last_evidence,next_step,block_reason,updated_at").limit(2000),
        s.from("operator_approvals").select("id", { count: "exact", head: true }).in("status", ["pendente", "adiado"]),
        s.from("internal_operators").select("id,status,display_name").limit(200),
      ]);
      const erro = [abertas, feitas, feitasAntes, runs, vinculos, aprov, agentes].find((r: any) => r.error);
      if (erro) throw new Error(erro.error.message);
      const links = (vinculos.data || []) as Array<VinculoContado & { last_action: string | null; next_step: string | null; block_reason: string | null }>;
      const idsDeTarefa = [...new Set(links.map((v) => v.kanban_task_id || v.painel_task_id).filter(Boolean))] as string[];
      const tarefas = new Map<string, { id: string; title: string; status: string; cliente: string | null }>();
      for (let i = 0; i < idsDeTarefa.length; i += 150) {
        const q = await s.from("tasks").select("id,title,status,project:projects!tasks_project_id_fkey(client:profiles!projects_client_id_fkey(company_name,full_name))").in("id", idsDeTarefa.slice(i, i + 150));
        if (q.error) throw new Error(q.error.message);
        for (const t of q.data || []) tarefas.set(t.id, { id: t.id, title: t.title, status: t.status, cliente: t.project?.client?.company_name || t.project?.client?.full_name || null });
      }
      return { periodo: p, abertas: abertas.data || [], feitas: feitas.count || 0, feitasAntes: feitasAntes.count || 0, runs: (runs.data || []) as LinhaDoHistorico[], links, tarefas, aprovacoes: aprov.count || 0, agentes: agentes.data || [] };
    },
  });
}

function Indicadores({ q, aoVerDecisoes }: { q: ReturnType<typeof useDadosDaCentral>; aoVerDecisoes: () => void }) {
  if (q.isLoading) return <Carregando linhas={4} rotulo="Calculando os indicadores" />;
  if (q.isError || !q.data) return <EstadoDeErro titulo="Não foi possível calcular os indicadores." descricao="Nenhum número foi estimado." acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  const d = q.data;
  const statusDaTarefa = (id: string | null | undefined) => (id ? d.tarefas.get(id)?.status ?? null : null);
  const ind = calcularIndicadores({
    periodo: d.periodo, anterior: d.periodo.anterior, tarefasAbertas: d.abertas, concluidasPeriodo: d.feitas, concluidasAnterior: d.feitasAntes,
    execucoes: d.runs, vinculos: d.links, statusDaTarefa, aprovacoesPendentes: d.aprovacoes, agentes: d.agentes,
  });
  return (
    <div aria-label="Indicadores de autonomia" className="space-y-4">
      <p className="px-1 text-[12px] text-muted-foreground">{d.periodo.rotulo} · comparado a {d.periodo.anterior.rotulo}</p>
      <div>
        <p className={juntar(texto.rotulo, "mb-1.5 px-1")}>Tarefas (Kanban)</p>
        <FaixaDeNumeros tamanho="compacto" colunas={2} itens={[
          { rotulo: "Abertas", valor: ind.tarefasAbertas.total, apoio: `${ind.tarefasAbertas.doing} em andamento · ${ind.tarefasAbertas.todo} a fazer · ${ind.tarefasAbertas.backlog} backlog` },
          { rotulo: "Concluídas no período", valor: ind.tarefasConcluidas.periodo, apoio: variacao(ind.tarefasConcluidas.periodo, ind.tarefasConcluidas.anterior), dica: "Tarefas em done cuja última mudança caiu no período." },
          { rotulo: "Entregas em revisão", valor: ind.entregasEmRevisao, ponto: ind.entregasEmRevisao ? "info" : "neutro", apoio: "Esperam revisão humana; não contam como feitas" },
          { rotulo: "Decisões pendentes", valor: ind.aprovacoesPendentes, ponto: ind.aprovacoesPendentes ? "alerta" : "neutro", aoClicar: aoVerDecisoes, dica: "Abrir as decisões" },
        ]} />
      </div>
      <div>
        <p className={juntar(texto.rotulo, "mb-1.5 px-1")}>Execuções dos agentes</p>
        <FaixaDeNumeros tamanho="compacto" colunas={2} itens={[
          { rotulo: "No período", valor: ind.execucoes.periodo, apoio: variacao(ind.execucoes.periodo, ind.execucoes.anterior) },
          { rotulo: "Concluídas", valor: ind.execucoes.concluidas, apoio: variacao(ind.execucoes.concluidas, ind.execucoes.concluidasAnterior), dica: "Execução concluída não é tarefa concluída: veja o resultado verificado no histórico." },
          { rotulo: "Em andamento agora", valor: ind.execucoes.emAndamento },
          { rotulo: "Bloqueadas / aguardando", valor: `${ind.execucoes.bloqueadas} / ${ind.execucoes.aguardandoInsumo}`, ponto: ind.execucoes.bloqueadas + ind.execucoes.aguardandoInsumo ? "alerta" : "neutro" },
          { rotulo: "Incidentes", valor: ind.incidentes.periodo, ponto: ind.incidentes.periodo ? "perigo" : "neutro", apoio: `${ind.incidentes.falhas} falhas · ${ind.incidentes.semSinal} sem sinal · ${ind.incidentes.divergencias} divergências` },
          { rotulo: "Agentes ativos", valor: ind.agentesAtivos.periodo, apoio: `de ${ind.agentesAtivos.cadastrados} cadastrados · ${variacao(ind.agentesAtivos.periodo, ind.agentesAtivos.anterior)}` },
        ]} />
      </div>
    </div>
  );
}

function DetalheDaExecucao({ runKey, linkId }: { runKey: string; linkId: string | null }) {
  const q = useQuery({
    queryKey: ["central-autonomia", "detalhe", runKey, linkId],
    queryFn: async () => {
      const s = supabase as any;
      const [trilha, diario] = await Promise.all([
        linkId ? s.from("operator_audit_log").select("id,occurred_at,actor,action,old_status,new_status,evidence").eq("task_link_id", linkId).order("occurred_at", { ascending: true }).limit(80) : s.from("operator_audit_log").select("id,occurred_at,actor,action,old_status,new_status,evidence").eq("run_key", runKey).order("occurred_at", { ascending: true }).limit(80),
        linkId ? s.from("operator_participations").select("id,entry_type,title,body,author_kind,created_at").eq("task_link_id", linkId).in("entry_type", ["evidencia", "pedido_revisao", "pedido_insumo", "decisao"]).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
      ]);
      if (trilha.error) throw new Error(trilha.error.message);
      if (diario.error) throw new Error(diario.error.message);
      return { trilha: trilha.data || [], diario: diario.data || [] };
    },
  });
  if (q.isLoading) return <Carregando linhas={2} rotulo="Lendo a trilha" />;
  if (q.isError || !q.data) return <p className="text-[12px] text-destructive">Não foi possível ler a trilha desta execução.</p>;
  return (
    <div className="grid gap-3">
      <div>
        <p className={juntar(texto.rotulo, "mb-1")}>Eventos</p>
        <ol className="space-y-1.5 text-[12px]">
          {q.data.trilha.length === 0 && <li className="text-muted-foreground">Sem eventos registrados.</li>}
          {q.data.trilha.map((e: any) => (
            <li key={e.id} className="border-l-2 border-border pl-2">
              <span className="text-muted-foreground">{quando(e.occurred_at)} · {e.actor}</span>
              <p className="break-words">{e.action}{e.old_status || e.new_status ? ` (${e.old_status || "—"} → ${e.new_status || "—"})` : ""}</p>
              {e.evidence && <p className="break-words text-muted-foreground">Prova: {String(e.evidence).slice(0, 400)}</p>}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className={juntar(texto.rotulo, "mb-1")}>Provas no diário</p>
        <ul className="space-y-2 text-[12px]">
          {q.data.diario.length === 0 && <li className="text-muted-foreground">Nenhuma prova anexada no diário.</li>}
          {q.data.diario.map((p: any) => (
            <li key={p.id} className="rounded-lg border border-border p-2">
              <p className="font-medium">{p.title || p.entry_type} <span className="font-normal text-muted-foreground">· {quando(p.created_at)}</span></p>
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Historico({ q, aoAbrirDiario }: { q: ReturnType<typeof useDadosDaCentral>; aoAbrirDiario: (linkId: string, titulo?: string) => void }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "atencao" | "concluidas">("todas");
  if (q.isLoading) return <Carregando linhas={4} rotulo="Carregando o histórico" />;
  if (q.isError || !q.data) return <EstadoDeErro titulo="Não foi possível ler o histórico." acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  const d = q.data;
  const linkPorId = new Map(d.links.map((l) => [l.id, l]));
  const nomeDoAgente = new Map((d.agentes as Array<{ id: string; display_name: string }>).map((a) => [a.id, a.display_name]));
  const linhas = d.runs.filter((r) => execucaoNoIntervalo(r, d.periodo)).map((r) => {
    const v = r.task_link_id ? linkPorId.get(r.task_link_id) || null : null;
    const t = v ? d.tarefas.get(v.kanban_task_id || v.painel_task_id || "") || null : null;
    const resultado = resultadoVerificado(r, v, t?.status ?? null);
    return { r, v, t, resultado, divergencia: v ? divergenciaDoVinculo(v, t?.status) : null };
  }).filter((x) => filtro === "todas" || (filtro === "concluidas" ? x.resultado === "concluida_com_prova" : !["concluida_com_prova", "em_andamento"].includes(x.resultado) || !!x.divergencia));
  return (
    <div aria-label="Histórico e evidências">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[12px] text-muted-foreground">Cada execução com o resultado verificado: tarefa, execução e prova juntas.</p>
        <SeletorCompacto rotulo="Mostrar" valor={filtro} onEscolher={(v) => setFiltro(v as typeof filtro)} modo="segmentado" listaQuandoNaoCabe opcoes={[{ valor: "todas", rotulo: "Todas" }, { valor: "atencao", rotulo: "Atenção" }, { valor: "concluidas", rotulo: "Com prova" }]} />
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {linhas.length === 0 ? <div className="p-4"><EstadoVazio titulo="Nenhuma execução neste recorte." descricao="Execução só aparece aqui quando o agente relata pelo OS." /></div> : linhas.map(({ r, v, t, resultado, divergencia }) => {
          const titulo = t?.title || String(r.detail?.title || r.detail?.action || r.run_key);
          const aberto = aberta === r.id;
          return (
            <div key={r.id} className="px-3 py-3">
              <button type="button" className="flex w-full min-w-0 items-start gap-3 text-left" aria-expanded={aberto} onClick={() => setAberta(aberto ? null : r.id)}>
                <ChevronDown className={juntar("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{titulo}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {nomeDoAgente.get(r.operator_id) || "Agente"}{t?.cliente ? ` · ${t.cliente}` : ""} · início {quando(r.started_at)} · fim {r.finished_at ? quando(r.finished_at) : "—"}
                  </span>
                </span>
              </button>
              <span className={juntar("ml-7 mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium", COR_DO_RESULTADO[resultado])}>{ROTULO_DO_RESULTADO[resultado]}</span>
              {aberto && (
                <div className="mt-3 space-y-3 pl-7 text-[12px]">
                  <dl className="grid gap-x-4 gap-y-1">
                    <div><dt className="text-muted-foreground">Execução</dt><dd>{r.status}{r.error ? ` · ${r.error}` : ""}</dd></div>
                    <div><dt className="text-muted-foreground">Tarefa no Kanban</dt><dd>{t ? t.status : "sem tarefa vinculada"}</dd></div>
                    {v?.last_evidence && <div className="sm:col-span-2"><dt className="text-muted-foreground">Prova registrada</dt><dd className="break-words">{v.last_evidence}</dd></div>}
                    {v?.block_reason && <div className="sm:col-span-2"><dt className="text-muted-foreground">Bloqueio</dt><dd className="break-words text-warning">{v.block_reason}</dd></div>}
                    {v?.next_step && <div className="sm:col-span-2"><dt className="text-muted-foreground">Próximo passo</dt><dd className="break-words">{v.next_step}</dd></div>}
                    {divergencia && <div className="sm:col-span-2"><dt className="text-muted-foreground">Divergência</dt><dd className="text-warning">{divergencia}. O card não foi corrigido por inferência.</dd></div>}
                  </dl>
                  <DetalheDaExecucao runKey={r.run_key} linkId={r.task_link_id} />
                  {v && <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => aoAbrirDiario(v.id, titulo)}><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Abrir diário</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ a tela

type AbaLateral = "resumo" | "historico" | "decisoes";

export default function CentralDeAutonomia({ nomesDeAgentes, titulosDeTarefas, aoAbrirDiario, aoEncaminhar }: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
}) {
  const { profile } = useAuth();
  const ehAdmin = profile?.role === "admin";
  const [periodo, setPeriodo] = useEstadoDaTela<PeriodoDaCentral>("execucao:central:periodo", "semana", { validar: (v) => PERIODOS_DA_CENTRAL.some((p) => p.valor === v) });
  const [aba, setAba] = useEstadoDaTela<AbaLateral>("execucao:central:aba", "resumo", { validar: (v) => v === "resumo" || v === "historico" || v === "decisoes" });
  const [chatAmpliado, setChatAmpliado] = useEstadoDaTela<boolean>("execucao:central:chat-ampliado", false, { validar: (v) => typeof v === "boolean" });
  const [telaCheia, setTelaCheia] = useState(false);
  const dados = useDadosDaCentral(periodo);
  const decisoesPendentes = dados.data?.aprovacoes ?? 0;

  // Tela cheia: ocupa a janela inteira (sem menu nem abas do painel); Esc sai.
  useEffect(() => {
    if (!telaCheia) return;
    const sair = (e: KeyboardEvent) => { if (e.key === "Escape") setTelaCheia(false); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", sair);
    return () => { window.removeEventListener("keydown", sair); document.body.style.overflow = antes; };
  }, [telaCheia]);

  const botaoIcone = "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";
  const acoesDoChat = (
    <>
      <button type="button" className={botaoIcone} onClick={() => setChatAmpliado(!chatAmpliado)} aria-pressed={chatAmpliado} aria-label={chatAmpliado ? "Mostrar o painel ao lado" : "Ampliar o chat"} title={chatAmpliado ? "Mostrar resumo, histórico e decisões ao lado" : "Ampliar o chat"}>
        {chatAmpliado ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
      </button>
    </>
  );

  const abas: Array<{ id: AbaLateral; rotulo: string; contador?: number }> = [
    { id: "resumo", rotulo: "Resumo" },
    { id: "historico", rotulo: "Histórico" },
    { id: "decisoes", rotulo: "Decisões", contador: decisoesPendentes },
  ];
  const lateral = (
    <aside aria-label="Resumo, histórico e decisões" className="flex min-w-0 flex-col rounded-2xl border border-border bg-card lg:min-h-0">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 p-1.5" role="tablist" aria-label="Painel ao lado do chat">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={juntar("flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-medium transition-colors", aba === a.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}
          >
            {a.rotulo}
            {!!a.contador && <span className="rounded-full bg-warning/15 px-1.5 text-[11px] text-warning">{a.contador}</span>}
          </button>
        ))}
      </div>
      <div className={juntar(ROLAGEM_OPERACAO, "p-3 lg:min-h-0 lg:flex-1")}>
        {aba === "resumo" && <Indicadores q={dados} aoVerDecisoes={() => setAba("decisoes")} />}
        {aba === "historico" && <Historico q={dados} aoAbrirDiario={aoAbrirDiario} />}
        {aba === "decisoes" && (
          <div className="space-y-2">
            <p className="px-1 text-[12px] text-muted-foreground">Pedidos de aprovação dos agentes, pelo mesmo mecanismo auditado de “Precisa de você”. Decidir não executa nada sozinho.</p>
            <AprovacoesExplicadas nomesDeAgentes={nomesDeAgentes} titulosDeTarefas={titulosDeTarefas} destaqueId={null} aoAbrirDiario={(id) => aoAbrirDiario(id)} />
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div
      className={telaCheia
        ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-3 sm:p-4"
        : "flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0"}
      role={telaCheia ? "dialog" : undefined}
      aria-modal={telaCheia || undefined}
      aria-label={telaCheia ? "Central de Autonomia em tela cheia" : undefined}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-tight">Central de Autonomia</h2>
          <p className="truncate text-[12px] text-muted-foreground">O que os agentes fizeram, com prova. Revisão não conta como feito.</p>
        </div>
        <div className="flex items-center gap-2">
          <SeletorCompacto rotulo="Período" valor={periodo} onEscolher={(v) => setPeriodo(v as PeriodoDaCentral)} modo="segmentado" opcoes={PERIODOS_DA_CENTRAL} />
          <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => setTelaCheia(!telaCheia)}>
            {telaCheia ? <Minimize2 className="h-3.5 w-3.5 sm:mr-1.5" /> : <Maximize2 className="h-3.5 w-3.5 sm:mr-1.5" />}
            <span className="hidden sm:inline">{telaCheia ? "Sair da tela cheia" : "Tela cheia"}</span>
          </button>
        </div>
      </div>
      <div className={juntar("grid min-w-0 gap-3 lg:min-h-0 lg:flex-1", chatAmpliado ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_480px]", telaCheia && "min-h-0 flex-1")}>
        {ehAdmin ? (
          <GestorConversa
            periodoDaTela={periodo}
            aoAbrirDiario={aoAbrirDiario}
            aoEncaminhar={aoEncaminhar}
            acoes={acoesDoChat}
            className={telaCheia ? "h-full min-h-0" : "h-[78vh] min-h-[480px] lg:h-full lg:min-h-0"}
          />
        ) : (
          <section className="rounded-2xl border border-border bg-card p-4"><EstadoVazio titulo="O Gestor Aceleriq é do admin." descricao="O resumo, o histórico e as decisões ao lado continuam abertos para a equipe." /></section>
        )}
        {(!chatAmpliado || !ehAdmin) && lateral}
      </div>
    </div>
  );
}
