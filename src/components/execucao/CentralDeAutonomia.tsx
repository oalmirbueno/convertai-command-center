import { Fragment, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bot, ChevronDown, ChevronRight, FileCheck2, FileText, History, LayoutGrid, Maximize2, MessagesSquare, Minimize2, NotebookPen, PanelRightOpen, Scale, Sparkles, X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { LateralEsquerda } from "@/components/workspace/LateralEsquerda";
import { chamarFuncao } from "@/lib/mesa/api";
import ConversasDoGestor, { CHAVE_DAS_CONVERSAS, type ConversaResumo, useOpcoesDeContexto } from "@/components/execucao/central/ConversasDoGestor";
import ChatDoHermes from "@/components/execucao/central/ChatDoHermes";
import DiarioDaCoordenacao from "@/components/execucao/central/DiarioDaCoordenacao";
import ObjetoDaCentral from "@/components/execucao/central/ObjetoDaCentral";
import { ArquivosDoCliente, BotoesDaFerramenta, FerramentaEmbutida, type FerramentaAberta, MenuDeFerramentas, type ModoDaFerramenta, NavegadorIntegrado } from "@/components/execucao/central/PainelDasMesas";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ObjetoAberto } from "@/lib/centralObjetos";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, JanelaCentral, SeletorCompacto, botao, juntar, superficie, texto, useEstadoDaTela, useLargo,
} from "@/components/sistema";
import AprovacoesExplicadas from "@/components/execucao/AprovacoesExplicadas";
import GestorConversa, { type ContextoDaConversa, type PedidoAoHermes } from "@/components/execucao/GestorConversa";
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

/**
 * Estação de trabalho (09/10/2026): Gestor e Hermes lado a lado, cada um com
 * o próprio campo de mensagem, recolher, ampliar e arrastar a divisória; uma
 * área ao lado (Resumo, Histórico, Decisões, Arquivos e o objeto aberto, na
 * lateral nativa); ferramentas em pop-up interno, na lateral ou na área maior.
 * O chat é o centro: cabeçalho de uma linha, explicação no "?".
 */
type AbaDaArea = "resumo" | "historico" | "decisoes" | "arquivos";
const ABAS_DA_AREA: AbaDaArea[] = ["resumo", "historico", "decisoes", "arquivos"];
type Painel = "gestor" | "hermes" | "area";
const PAINEIS: Painel[] = ["gestor", "hermes", "area"];
const NOME_DO_PAINEL: Record<Painel, string> = { gestor: "Gestor", hermes: "Hermes", area: "Área" };

/**
 * Altura de um painel no celular: do topo do painel até a barra de baixo do
 * app (72 px + respiro), para o campo de mensagem ficar à vista sem rolar a
 * página; nunca menos de 340 px. Medida em código: Safari 11 não tem dvh.
 */
function useAlturaNoCelular(ref: RefObject<HTMLElement>): number {
  const [altura, setAltura] = useState(480);
  useEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + (window.pageYOffset || 0);
      const casca = el.closest("[data-casca='conteudo']") as HTMLElement | null;
      const rolado = casca ? casca.scrollTop : 0;
      setAltura(Math.max(340, Math.round(window.innerHeight - (topo + rolado) - 84)));
    };
    medir();
    const t = window.setTimeout(medir, 400);
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", medir); window.removeEventListener("orientationchange", medir); };
  }, [ref]);
  return altura;
}

/** Largura atual de um elemento (ResizeObserver; sem ele, o resize da janela). */
function useLargura(ref: RefObject<HTMLElement>): number {
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(el.getBoundingClientRect().width);
    medir();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) { const o = new RO(medir); o.observe(el); return () => o.disconnect(); }
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  });
  return largura;
}

/** Tirinha de 32 px (padrão da AreaDeTrabalho): o painel recolhido, nome em pé. Clicar abre. */
function Tirinha({ rotulo, icone, onAbrir }: { rotulo: string; icone: ReactNode; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Abrir ${rotulo}`}
      title={`Abrir ${rotulo}`}
      data-lateral-recolhida=""
      className="toque-compacto flex h-full w-8 shrink-0 flex-col items-center rounded-lg pt-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      {icone}
      <span className="mt-3 text-[11px] font-medium" style={{ writingMode: "vertical-rl" }}>{rotulo}</span>
    </button>
  );
}

export default function CentralDeAutonomia({ nomesDeAgentes, titulosDeTarefas, aoAbrirDiario, aoEncaminhar }: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
}) {
  const { profile } = useAuth();
  const ehAdmin = profile?.role === "admin";
  const largo = useLargo();
  const [periodo, setPeriodo] = useEstadoDaTela<PeriodoDaCentral>("execucao:central:periodo", "semana", { validar: (v) => PERIODOS_DA_CENTRAL.some((p) => p.valor === v) });
  const [aba, setAba] = useEstadoDaTela<AbaDaArea>("execucao:central:aba-da-area", "resumo", { validar: (v) => ABAS_DA_AREA.includes(v as AbaDaArea) });
  const [recolhidos, setRecolhidos] = useEstadoDaTela<Painel[]>("execucao:central:recolhidos", [], { validar: (v) => Array.isArray(v) && v.every((x) => PAINEIS.includes(x as Painel)) });
  const [conversasRecolhidas, setConversasRecolhidas] = useEstadoDaTela<boolean>("execucao:central:conversas-recolhidas", false, { validar: (v) => typeof v === "boolean" });
  const [conversaId, setConversaId] = useEstadoDaTela<string>("execucao:central:conversa", "");
  const [noCelular, setNoCelular] = useEstadoDaTela<Painel>("execucao:central:no-celular", "gestor", { validar: (v) => PAINEIS.includes(v as Painel) });
  const [conversasNoCelular, setConversasNoCelular] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const [objeto, setObjeto] = useState<ObjetoAberto | null>(null);
  const [ferramenta, setFerramenta] = useState<FerramentaAberta | null>(null);
  const [navegador, setNavegador] = useState(false);
  const [diario, setDiario] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const refDoCelular = useRef<HTMLDivElement>(null);
  const alturaNoCelular = useAlturaNoCelular(refDoCelular);
  const refDaArea = useRef<HTMLElement>(null);
  const larguraDaArea = useLargura(refDaArea);
  // Área estreita: as abas viram ícones (nome no title e no leitor de tela), sem cortar palavra.
  const areaEstreita = larguraDaArea > 0 && larguraDaArea < 360;
  const dados = useDadosDaCentral(periodo);
  const decisoesPendentes = dados.data?.aprovacoes ?? 0;

  // A conversa aberta e o recorte dela (cliente e projeto), lidos da lista de conversas.
  const conversas = useQuery({
    queryKey: [...CHAVE_DAS_CONVERSAS, ""],
    enabled: ehAdmin,
    queryFn: async () => (await chamarFuncao<{ conversas: ConversaResumo[] }>("gestor-aceleriq", { acao: "conversas", busca: "" })).conversas || [],
    staleTime: 30_000,
  });
  const conversa = (conversas.data || []).find((c) => c.id === conversaId) || null;
  const opcoes = useOpcoesDeContexto(conversa?.client_id || null, ehAdmin && !!conversa?.client_id);
  const projetoNome = conversa?.project_id ? opcoes.data?.projetos.find((p) => p.id === conversa.project_id)?.nome || null : null;
  const contextoDaConversa: ContextoDaConversa = {
    conversaId: conversa ? conversa.id : null,
    cliente: conversa?.client_id ? { id: conversa.client_id, nome: conversa.cliente_nome || "Cliente" } : null,
    projeto: conversa?.project_id ? { id: conversa.project_id, nome: projetoNome || "Projeto" } : null,
    titulo: conversa?.titulo || null,
  };
  const contextoDoAtalho = { clientId: contextoDaConversa.cliente?.id || null, projectId: contextoDaConversa.projeto?.id || null, clienteNome: contextoDaConversa.cliente?.nome || null };

  // Tela cheia: ocupa a janela inteira (sem menu nem abas do painel); Esc sai.
  useEffect(() => {
    if (!telaCheia) return;
    const sair = (e: KeyboardEvent) => { if (e.key === "Escape" && !ferramenta && !diario) setTelaCheia(false); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", sair);
    return () => { window.removeEventListener("keydown", sair); document.body.style.overflow = antes; };
  }, [telaCheia, ferramenta, diario]);

  const recolhido = (p: Painel) => recolhidos.includes(p);
  const alternar = (p: Painel, recolher: boolean) => setRecolhidos(recolher ? [...new Set([...recolhidos, p])] : recolhidos.filter((x) => x !== p));
  /** Ampliar uma conversa: recolhe as outras (desfaz ao abrir a tirinha delas). */
  const ampliar = (p: Painel) => setRecolhidos(PAINEIS.filter((x) => x !== p && (x !== "hermes" || ehAdmin)));
  const mostrarArea = () => { alternar("area", false); if (!largo) setNoCelular("area"); };

  const abrirObjeto = (o: ObjetoAberto) => { setObjeto(o); setFerramenta((f) => (f && f.modo === "lateral" ? null : f)); setNavegador(false); mostrarArea(); };
  const abrirFerramenta = (rotulo: string, caminho: string, modo: ModoDaFerramenta = "popup") => {
    setMenuAberto(false);
    setFerramenta({ rotulo, caminho, modo });
    if (modo === "lateral") { setObjeto(null); setNavegador(false); mostrarArea(); }
  };
  const mudarModo = (modo: ModoDaFerramenta) => {
    setFerramenta((f) => (f ? { ...f, modo } : f));
    if (modo === "lateral") { setObjeto(null); setNavegador(false); mostrarArea(); }
  };

  const icone = "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";
  const botoesDoPainel = (p: Painel) => largo ? (
    <>
      <button type="button" className={icone} onClick={() => ampliar(p)} aria-label={`Ampliar ${NOME_DO_PAINEL[p]}`} title="Ampliar (recolhe os outros)"><Maximize2 className="h-3.5 w-3.5" /></button>
      <button type="button" className={icone} onClick={() => alternar(p, true)} aria-label={`Recolher ${NOME_DO_PAINEL[p]}`} title="Recolher para o lado" data-recolher-lateral=""><ChevronRight className="h-4 w-4" /></button>
    </>
  ) : null;

  // ---------------------------------------------------------------- os três painéis
  const chatDoGestor = ehAdmin ? (
    <GestorConversa
      periodoDaTela={periodo}
      aoAbrirDiario={aoAbrirDiario}
      aoEncaminhar={aoEncaminhar}
      acoes={<>
        {!largo && <button type="button" className={icone} onClick={() => setConversasNoCelular((v) => !v)} aria-expanded={conversasNoCelular} aria-label="Conversas" title="Conversas"><MessagesSquare className="h-4 w-4" /></button>}
        {botoesDoPainel("gestor")}
      </>}
      contexto={contextoDaConversa}
      aoConversaCriada={(id) => setConversaId(id)}
      aoAbrirNoPainel={(caminho, rotulo) => abrirFerramenta(rotulo, caminho)}
      aoAbrirObjeto={abrirObjeto}
      className="h-full min-h-0"
    />
  ) : (
    <section className={juntar(superficie.painel, "p-4")}><EstadoVazio titulo="O Gestor Aceleriq é do admin." descricao="O resumo, o histórico e as decisões ao lado continuam abertos para a equipe." /></section>
  );

  const chatDoHermes = ehAdmin ? (
    <ChatDoHermes
      contexto={{ cliente: contextoDaConversa.cliente, projeto: contextoDaConversa.projeto }}
      aoAbrirDiario={() => setDiario(true)}
      acoes={botoesDoPainel("hermes")}
      className="h-full min-h-0"
    />
  ) : null;

  const abasDaArea: Array<{ id: AbaDaArea; rotulo: string; icone: typeof History; contador?: number }> = [
    { id: "resumo", rotulo: "Resumo", icone: BarChart3 },
    { id: "historico", rotulo: "Histórico", icone: History },
    { id: "decisoes", rotulo: "Decisões", icone: Scale, contador: decisoesPendentes },
    { id: "arquivos", rotulo: "Arquivos", icone: FileText },
  ];
  const ferramentaNaLateral = ferramenta && ferramenta.modo === "lateral" ? ferramenta : null;
  const area = (
    <aside ref={refDaArea} aria-label="Área ao lado das conversas" className={juntar(superficie.painel, "flex h-full min-h-0 min-w-0 flex-col overflow-hidden")}>
      {objeto ? (
        <ObjetoDaCentral key={`${objeto.tipo}-${objeto.id}`} objeto={objeto} aoFechar={() => setObjeto(null)} aoAbrirFerramenta={(caminho, rotulo) => abrirFerramenta(rotulo, caminho)} aoAbrirDiario={aoAbrirDiario} />
      ) : ferramentaNaLateral ? (
        <FerramentaEmbutida ferramenta={ferramentaNaLateral} clienteNome={contextoDoAtalho.clienteNome} aoMudarModo={mudarModo} aoFechar={() => setFerramenta(null)} />
      ) : navegador ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">Navegador</p>
            <button type="button" className={icone} onClick={() => setNavegador(false)} aria-label="Fechar o navegador"><X className="h-4 w-4" /></button>
          </div>
          <NavegadorIntegrado />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-border/70 p-1.5">
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-0.5" role="tablist" aria-label="Área ao lado das conversas">
              {abasDaArea.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={aba === a.id}
                  onClick={() => setAba(a.id)}
                  aria-label={a.rotulo}
                  title={a.rotulo}
                  className={juntar("flex min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[12px] font-medium transition-colors", aba === a.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}
                >
                  {areaEstreita ? <a.icone className="h-4 w-4 shrink-0" aria-hidden="true" /> : <span className="truncate">{a.rotulo}</span>}
                  {!!a.contador && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">{a.contador}</span>}
                </button>
              ))}
            </div>
            {largo && botoesDoPainel("area")}
          </div>
          <div className={juntar("flex min-h-0 flex-1 flex-col p-3", aba === "arquivos" ? "" : ROLAGEM_OPERACAO)}>
            {aba === "resumo" && <Indicadores q={dados} aoVerDecisoes={() => setAba("decisoes")} />}
            {aba === "historico" && <Historico q={dados} aoAbrirDiario={aoAbrirDiario} />}
            {aba === "decisoes" && <AprovacoesExplicadas nomesDeAgentes={nomesDeAgentes} titulosDeTarefas={titulosDeTarefas} destaqueId={null} aoAbrirDiario={(id) => aoAbrirDiario(id)} />}
            {aba === "arquivos" && <ArquivosDoCliente clientId={contextoDoAtalho.clientId} aoAbrirObjeto={abrirObjeto} aoAbrirFerramenta={(rotulo, caminho) => abrirFerramenta(rotulo, caminho)} />}
          </div>
        </>
      )}
    </aside>
  );

  const listaDeConversas = ehAdmin ? (
    <ConversasDoGestor ativa={conversaId || null} aoEscolher={(c) => { setConversaId(c ? c.id : ""); setConversasNoCelular(false); setNoCelular("gestor"); }} />
  ) : null;

  // ---------------------------------------------------------------- cabeçalho de uma linha
  const cabecalho = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="text-[16px] font-semibold leading-tight">Central</h2>
        <AjudaRecolhida rotulo="O que é a Central?">
          Converse com o Gestor (dados do OS, com prova) e com o Hermes ao lado. O que for criado ou citado abre na área ao lado; as ferramentas abrem em pop-up, na lateral ou na área maior. Revisão não conta como feito.
        </AjudaRecolhida>
        {contextoDaConversa.cliente && <span className="hidden truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">{contextoDaConversa.cliente.nome}{contextoDaConversa.projeto ? ` · ${contextoDaConversa.projeto.nome}` : ""}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <SeletorCompacto rotulo="Período" valor={periodo} onEscolher={(v) => setPeriodo(v as PeriodoDaCentral)} modo="segmentado" listaQuandoNaoCabe opcoes={PERIODOS_DA_CENTRAL} />
        <Popover open={menuAberto} onOpenChange={setMenuAberto}>
          <PopoverTrigger asChild>
            <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} aria-label="Ferramentas">
              <LayoutGrid className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Ferramentas</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-2">
            <MenuDeFerramentas contexto={contextoDoAtalho} aoAbrir={(a) => abrirFerramenta(a.rotulo, a.caminho)} aoAbrirNavegador={() => { setMenuAberto(false); setObjeto(null); setNavegador(true); mostrarArea(); }} />
          </PopoverContent>
        </Popover>
        {ehAdmin && (
          <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => setDiario(true)} aria-label="Diário da coordenação">
            <NotebookPen className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Diário</span>
          </button>
        )}
        <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => setTelaCheia(!telaCheia)} aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"}>
          {telaCheia ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- miolo: computador
  const visiveis = PAINEIS.filter((p) => !recolhido(p) && (p !== "hermes" || ehAdmin) && (p !== "gestor" || true));
  const tamanhoPadrao: Record<Painel, number> = { gestor: 42, hermes: 33, area: 25 };
  const conteudoDe: Record<Painel, ReactNode> = { gestor: chatDoGestor, hermes: chatDoHermes, area };
  const iconeDe: Record<Painel, ReactNode> = { gestor: <Sparkles className="h-4 w-4" />, hermes: <Bot className="h-4 w-4" />, area: <PanelRightOpen className="h-4 w-4" /> };
  const tirinhas = PAINEIS.filter((p) => recolhido(p) && (p !== "hermes" || ehAdmin));

  const ferramentaGrande = ferramenta && ferramenta.modo === "grande" ? ferramenta : null;
  const mioloLargo = ferramentaGrande ? (
    <div className={juntar(superficie.painel, "min-h-0 min-w-0 overflow-hidden")}>
      <FerramentaEmbutida ferramenta={ferramentaGrande} clienteNome={contextoDoAtalho.clienteNome} aoMudarModo={mudarModo} aoFechar={() => setFerramenta(null)} />
    </div>
  ) : (
    <div className="flex min-h-0 min-w-0 gap-2">
      {visiveis.length ? (
        <ResizablePanelGroup direction="horizontal" autoSaveId={`central-estacao-${visiveis.join("-")}`} className="min-h-0 min-w-0 flex-1">
          {visiveis.map((p, i) => (
            <Fragment key={p}>
              {i > 0 && <ResizableHandle withHandle className="mx-1 bg-transparent" />}
              <ResizablePanel id={p} order={PAINEIS.indexOf(p)} defaultSize={tamanhoPadrao[p] * (100 / visiveis.reduce((t, x) => t + tamanhoPadrao[x], 0))} minSize={18} className="flex min-h-0 min-w-0 flex-col" data-painel-da-central={p}>
                {conteudoDe[p]}
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      ) : <div className="flex-1" />}
      {tirinhas.map((p) => <Tirinha key={p} rotulo={NOME_DO_PAINEL[p]} icone={iconeDe[p]} onAbrir={() => alternar(p, false)} />)}
    </div>
  );

  // ---------------------------------------------------------------- miolo: celular (um painel por vez, sem empilhar)
  const mioloCelular = (
    <div className="flex min-w-0 flex-col gap-2">
      {ehAdmin && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1" role="tablist" aria-label="Painel da Central">
          {PAINEIS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={noCelular === p} onClick={() => setNoCelular(p)} className={juntar("rounded-lg py-1.5 text-[12px] font-medium", noCelular === p ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {NOME_DO_PAINEL[p]}{p === "area" && decisoesPendentes ? ` · ${decisoesPendentes}` : ""}
            </button>
          ))}
        </div>
      )}
      {ehAdmin && conversasNoCelular && <div className={juntar(superficie.painel, "p-3")}>{listaDeConversas}</div>}
      <div ref={refDoCelular} style={{ height: alturaNoCelular }}>
        {ferramentaGrande ? (
          <div className={juntar(superficie.painel, "h-full overflow-hidden")}><FerramentaEmbutida ferramenta={ferramentaGrande} clienteNome={contextoDoAtalho.clienteNome} aoMudarModo={mudarModo} aoFechar={() => setFerramenta(null)} /></div>
        ) : ehAdmin ? conteudoDe[noCelular] : area}
      </div>
    </div>
  );

  const ferramentaEmPopup = ferramenta && ferramenta.modo === "popup" ? ferramenta : null;
  return (
    <div
      className={telaCheia ? "fixed inset-0 z-50 flex flex-col gap-2 bg-background p-3" : "flex min-w-0 flex-col gap-2 lg:h-full lg:min-h-0"}
      role={telaCheia ? "dialog" : undefined}
      aria-modal={telaCheia || undefined}
      aria-label={telaCheia ? "Central de Autonomia em tela cheia" : undefined}
    >
      {cabecalho}
      {largo ? (
        <div className={juntar("grid min-h-0 min-w-0 flex-1 gap-2", ehAdmin ? (conversasRecolhidas ? "grid-cols-[32px_minmax(0,1fr)]" : "grid-cols-[230px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)]") : "grid-cols-1")}>
          {ehAdmin && (
            <LateralEsquerda rotulo="Conversas" icone={<MessagesSquare className="h-4 w-4" />} recolhida={conversasRecolhidas} onAlternar={() => setConversasRecolhidas(!conversasRecolhidas)}>
              {listaDeConversas}
            </LateralEsquerda>
          )}
          {mioloLargo}
        </div>
      ) : mioloCelular}

      <JanelaCentral
        aberta={!!ferramentaEmPopup}
        onMudar={(a) => { if (!a) setFerramenta(null); }}
        titulo={ferramentaEmPopup ? `${ferramentaEmPopup.rotulo}${contextoDoAtalho.clienteNome ? ` · ${contextoDoAtalho.clienteNome}` : ""}` : "Ferramenta"}
        descricaoOculta="Ferramenta do painel aberta dentro da Central, com o cliente da conversa."
        acoes={ferramentaEmPopup ? <BotoesDaFerramenta ferramenta={ferramentaEmPopup} aoMudarModo={mudarModo} /> : null}
        largura="tela"
        corpo="fixo"
        semEspaco
        classeDoCorpo="flex min-h-0 flex-1 flex-col"
      >
        {ferramentaEmPopup && <FerramentaEmbutida ferramenta={ferramentaEmPopup} clienteNome={contextoDoAtalho.clienteNome} aoMudarModo={mudarModo} aoFechar={() => setFerramenta(null)} semCabecalho />}
      </JanelaCentral>

      {ehAdmin && (
        <JanelaCentral aberta={diario} onMudar={setDiario} titulo="Diário da coordenação" largura="lg" corpo="fixo" classeDoCorpo="flex min-h-0 flex-1 flex-col"
          ajuda="O canal que o Hermes já lê a cada minuto: a instrução vai para a tarefa escolhida e a resposta volta aqui.">
          <DiarioDaCoordenacao contexto={{ cliente: contextoDaConversa.cliente, projeto: contextoDaConversa.projeto }} />
        </JanelaCentral>
      )}
    </div>
  );
}
