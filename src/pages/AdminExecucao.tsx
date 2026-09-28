import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Activity, AlertTriangle, Bot, Building2, CheckCircle2, ClipboardCopy, Clock,
  FileCheck2, ListChecks, PauseCircle, RefreshCw, ShieldAlert, Wrench, X, XCircle,
} from "lucide-react";
import OrganogramaAgentes, { type NoDoOrganograma } from "@/components/execucao/OrganogramaAgentes";
import PerfilDoAgente from "@/components/execucao/PerfilDoAgente";
import DiarioDaExecucao from "@/components/execucao/DiarioDaExecucao";
import Escritorio from "@/components/execucao/Escritorio";
import DefinirResponsavel from "@/components/execucao/DefinirResponsavel";
import { falarComoGente } from "@/lib/falarComoGente";
import { precisaDecisao } from "@/lib/precisaDecisao";
import { vinculoEncerrado } from "@/lib/execucaoVinculos";
import OrdensAutorizadas from "@/components/execucao/OrdensAutorizadas";
import OQueFoiFeito from "@/components/execucao/OQueFoiFeito";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { useProjects, useTeamMembers } from "@/hooks/useSupabaseData";
import AprovacoesExplicadas from "@/components/execucao/AprovacoesExplicadas";
import PropostasDeResponsavel from "@/components/execucao/PropostasDeResponsavel";
import {
  ROTULO_CATEGORIA, ROTULO_ORIGEM, categoriaDaTarefa, origemDaExecucao, passaNoFiltro,
} from "@/lib/execucaoBadges";
import { MenuDeContexto, type ItemDeMenu } from "@/components/ui/menu-de-contexto";
import { alternarFechadas, areaComecaFechada } from "@/lib/execucaoAreas";
import { excluirTarefa } from "@/lib/taskDelete";
import {
  AjudaRecolhida, AreaDeTrabalho, BarraDeControles, CabecalhoDePagina, CampoDeBusca, Carregando,
  EstadoDeErro, EstadoVazio, Etapas, Painel, RegiaoRolavel, Secao, SeletorCompacto, botao, etiqueta,
  juntar, superficie, texto, useAreaDeTrabalho, useEstadoDaTela,
} from "@/components/sistema";

/**
 * Na gaveta do celular a lateral (o resumo) não tem cabeçalho de agente:
 * este X fecha a gaveta. No computador não aparece (a área põe o botão de
 * recolher no vão entre as colunas).
 */
function FecharResumo() {
  const area = useAreaDeTrabalho();
  if (!area || !area.fecharGaveta) return null;
  return (
    <div className="flex shrink-0 justify-end px-1 pb-1">
      <button type="button" onClick={area.fecharGaveta} aria-label="Fechar o resumo" className={juntar(botao.icone, "h-10 w-10")}>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Estado de uma execucao do agente, em palavras. */
const RUN_EM_PALAVRAS: Record<string, string> = {
  started: "começou",
  progress: "em andamento",
  done: "concluída",
  review: "esperando sua revisão",
  awaiting_input: "esperando uma resposta sua",
  failed: "falhou",
  timeout: "parou sem dar sinal",
};
const runEmPalavras = (status: unknown) => RUN_EM_PALAVRAS[String(status)] ?? String(status);
import { operatorRunIsStale } from "../../supabase/functions/_shared/operator-freshness";

/**
 * Execução da equipe: o que os operadores internos (Hermes) estão fazendo,
 * sob qual responsável humano, com que evidência.
 *
 * Três decisões sustentam a tela:
 *
 *  1. O RESPONSÁVEL HUMANO aparece em toda linha e nunca é alterado por
 *     aqui. Operador executa; quem responde pelo trabalho é gente. Uma
 *     tela que mostrasse só o agente ensinaria a esquecer isso.
 *  2. FEITO exige evidência. done sem evidência entra como revisão (o
 *     banco já rebaixa na gravação) e o relatório separa as duas coisas:
 *     "feito" e "feito-que-diz-que-fez" não podem somar juntos.
 *  3. Os RELATÓRIOS saem dos MESMOS dados da tela (vínculos, runs,
 *     auditoria). Relatório gerado de outra fonte discordaria do quadro
 *     na primeira divergência.
 *
 * A área inteira vive atrás da flag `operators_layer`: desligou, sumiu,
 * nada é apagado.
 */

type Vinculo = {
  id: string;
  operator_id: string;
  kanban_task_id: string | null;
  status: string;
  last_action: string | null;
  last_evidence: string | null;
  next_step: string | null;
  block_reason: string | null;
  approval_required: boolean;
  updated_at: string;
  created_at: string;
};

type Operador = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  status: string;
  scope: string;
  is_coordinator: boolean;
  area: string | null;
  parent_slug: string | null;
  last_run_at: string | null;
};

/**
 * As abas de cima, e as visões dentro de cada uma.
 *
 * Onze visões numa faixa só viravam uma fileira de pastilhas em que tudo
 * pesava igual — e nada dizia onde começar. Quatro abas separam por
 * PERGUNTA: quem está trabalhando, o que está andando, o que espera
 * decisão minha, e o que já virou relatório.
 *
 * A aba não é decoração: ela é a resposta a "onde eu olho agora".
 */
const ABAS = [
  { id: "pessoas", rotulo: "Escritório", visoes: ["escritorio", "hierarquia"] },
  { id: "trabalho", rotulo: "Trabalho", visoes: ["quadro", "fila", "in_progress", "done", "review"] },
  { id: "decisoes", rotulo: "Precisa de você", visoes: ["aprovacao", "awaiting_input", "blocked"] },
  { id: "feito", rotulo: "O que foi feito", visoes: [] },
  { id: "relatorios", rotulo: "Relatórios", visoes: ["relatorios"] },
] as const;

const VISOES = [
  { id: "escritorio", rotulo: "Escritório" },
  { id: "quadro", rotulo: "Quadro" },
  { id: "fila", rotulo: "Fila por operador" },
  { id: "in_progress", rotulo: "Em andamento" },
  { id: "done", rotulo: "Concluídas com evidência" },
  { id: "review", rotulo: "Em revisão" },
  { id: "awaiting_input", rotulo: "Aguardando insumo" },
  { id: "blocked", rotulo: "Bloqueadas" },
  { id: "aprovacao", rotulo: "Aprovações pendentes" },
  { id: "hierarquia", rotulo: "Hierarquia" },
  { id: "relatorios", rotulo: "Relatórios" },
] as const;

const STATUS_ROTULO: Record<string, string> = {
  queued: "na fila",
  in_progress: "em andamento",
  done: "concluída",
  review: "em revisão",
  awaiting_input: "aguardando insumo",
  blocked: "bloqueada",
};

/** Onde as áreas recolhidas ficam guardadas entre visitas. */
const AREAS_FECHADAS = "aceleriq-execucao-areas-fechadas";

const dataCurta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export default function AdminExecucao() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const vinculoAlvo = searchParams.get("vinculo");
  const aprovacaoAlvo = searchParams.get("aprovacao");
  const propostaAlvo = searchParams.get("proposta");
  const abaAlvo = searchParams.get("aba");
  // Aba e visão ficam guardadas (sair e voltar mantém). O padrão continua
  // sendo o Escritório: é a porta de entrada.
  const [visao, setVisao] = useEstadoDaTela<(typeof VISOES)[number]["id"]>("execucao:visao", "escritorio", {
    validar: (v) => VISOES.some((x) => x.id === v),
  });
  const [aba, setAba] = useEstadoDaTela<(typeof ABAS)[number]["id"]>("execucao:aba", "pessoas", {
    validar: (v) => ABAS.some((x) => x.id === v),
  });
  // A tarefa aberta DENTRO da Execução, em pop-up central. Antes isto era
  // window.open numa aba nova: o app inteiro recarregava, e a sensação era
  // de reiniciar em vez de navegar.
  const [tarefaAberta, setTarefaAberta] = useState<any | null>(null);
  const { data: equipe = [] } = useTeamMembers();
  const { data: projetos = [] } = useProjects();
  const [agenteAberto, setAgenteAberto] = useState<Operador | null>(null);
  const [menuCartao, setMenuCartao] = useState<{ x: number; y: number; v: Vinculo } | null>(null);
  const [menuEncaminhar, setMenuEncaminhar] = useState<{ x: number; y: number; tarefaId: string; titulo: string } | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [reconciliando, setReconciliando] = useState(false);
  const [diarioAberto, setDiarioAberto] = useState<{ linkId: string; titulo?: string } | null>(null);
  const [responsavelAberto, setResponsavelAberto] = useState<
    { taskId: string; titulo?: string; atual?: string | null } | null>(null);
  // Os filtros do centro de comando: 606 tarefas abertas nao cabem numa
  // lista sem recorte. Busca e livre; cliente e prazo sao os dois cortes
  // que o dono realmente usa para decidir onde olhar primeiro.
  // Busca e filtros persistentes (useEstadoDaTela): sair e voltar mantém.
  const [busca, setBusca] = useEstadoDaTela<string>("execucao:busca", "");
  const [filtroCliente, setFiltroCliente] = useEstadoDaTela<string>("execucao:cliente", "", { validar: (v) => typeof v === "string" });
  const [filtroPrazo, setFiltroPrazo] = useEstadoDaTela<"todas" | "vencidas" | "semana">("execucao:prazo", "todas", {
    validar: (v) => v === "todas" || v === "vencidas" || v === "semana",
  });
  /** Vínculo sem tarefa ativa fica no histórico, fora do quadro por padrão. */
  const [mostrarEncerradas, setMostrarEncerradas] = useEstadoDaTela<boolean>("execucao:encerradas", false, { validar: (v) => typeof v === "boolean" });
  const queryClient = useQueryClient();
  const destacadoRef = useRef<HTMLDivElement | null>(null);

  /**
   * A flag, com a distinção que faltava: DESLIGADA e NÃO-CONSEGUI-LER são
   * estados diferentes.
   *
   * A primeira versão devolvia `false` nos dois casos, e a tela anunciava
   * "a camada está desligada" quando a verdade era outra (a tabela tinha
   * acabado de nascer e o cache do PostgREST ainda não a via). Mensagem
   * errada com ar de certeza é pior que erro cru: manda consertar o que
   * não está quebrado.
   */
  const { data: flag, refetch: relerFlag, isFetching: lendoFlag, isError: flagFalhou } = useQuery({
    queryKey: ["flag-operators-layer"],
    queryFn: async (): Promise<"on" | "off" | "erro"> => {
      const { data, error } = await (supabase as any)
        .from("feature_flags").select("enabled").eq("flag_key", "operators_layer").maybeSingle();
      if (error) return "erro";
      if (!data) return "erro";
      return data.enabled === true ? "on" : "off";
    },
    retry: 2,
  });

  const { data: operadores = [] } = useQuery({
    queryKey: ["operadores-internos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("internal_operators")
        .select("id, slug, display_name, role, status, scope, is_coordinator, last_run_at, area, parent_slug")
        // A ordem do organograma sai do banco: o Hermes reordena por RPC e
        // o painel obedece, sem deploy no meio.
        .order("display_order", { ascending: true })
        .order("display_name", { ascending: true });
      if (error) throw error;
      return (data || []) as Operador[];
    },
    enabled: flag === "on",
  });

  const { data: vinculos = [], dataUpdatedAt, error: erroVinculos, isLoading: carregandoVinculos } = useQuery({
    queryKey: ["operador-vinculos"],
    queryFn: async () => {
      // Consultar e atualizar a tela não alteram execuções nem ordens.
      const { data, error } = await (supabase as any)
        .from("operator_task_links").select("*").order("updated_at", { ascending: false }).limit(300);
      if (error) throw error;
      return (data || []) as Vinculo[];
    },
    enabled: flag === "on",
    refetchInterval: 30_000,
  });

  const { data: runs = [], error: erroRuns } = useQuery({
    queryKey: ["operador-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_runs")
        .select("id, operator_id, run_key, task_link_id, status, attempt, started_at, heartbeat_at, timeout_seconds, finished_at, error")
        .order("started_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: flag === "on",
    refetchInterval: 30_000,
  });

  // Os dois campos: um vinculo criado pelo painel_task_id tem tarefa, e
  // ignora-lo devolvia uma linha sem contexto nenhum.
  const taskIds = useMemo(
    () => [...new Set(
      vinculos.flatMap((v) => [v.kanban_task_id, (v as any).painel_task_id]).filter(Boolean),
    )] as string[],
    [vinculos],
  );
  const { data: tarefas = new Map(), isSuccess: tarefasProntas } = useQuery({
    queryKey: ["operador-tarefas", taskIds.join(",")],
    queryFn: async () => {
      if (taskIds.length === 0) return new Map();
      // FK nomeada: projects aponta para profiles por client_id E por
      // created_by, e sem escolher o caminho a consulta inteira e recusada.
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select("id, title, status, deleted_at, due_date, assigned_to, project_id, source, ops_node_id, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))")
        .in("id", taskIds);
      // Erro nao vira mapa vazio: um mapa vazio faz a tela desenhar tarefa
      // sem projeto nem cliente, como se o dado nao existisse.
      if (error) throw new Error(error.message);
      const mapa = new Map<string, any>();
      for (const t of data || []) mapa.set(String(t.id), t);
      return mapa;
    },
    enabled: flag === "on" && taskIds.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const humanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tarefas.values()) if (t?.assigned_to) ids.add(String(t.assigned_to));
    return [...ids];
  }, [tarefas]);
  const { data: humanos = new Map() } = useQuery({
    queryKey: ["operador-humanos", humanIds.join(",")],
    queryFn: async () => {
      if (humanIds.length === 0) return new Map();
      const { data } = await (supabase as any).from("profiles").select("id, full_name").in("id", humanIds);
      const mapa = new Map<string, string>();
      for (const p of data || []) mapa.set(String(p.id), p.full_name || "(sem nome)");
      return mapa;
    },
    enabled: humanIds.length > 0,
  });

  /**
   * As tarefas do Kanban que ainda não têm operador.
   *
   * Sem isto, a tela vazia dizia só "nada em execução" — verdade que não
   * ajuda. Com isto ela responde a pergunta seguinte: quantas tarefas
   * existem esperando, e QUAIS. É o que liga esta área ao Kanban de
   * verdade em vez de deixá-la como um painel que só sabe falar de si.
   */
  const { data: disponiveis = [] } = useQuery({
    queryKey: ["operador-tarefas-disponiveis"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select("id, title, status, due_date, assigned_to, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))")
        .in("status", ["backlog", "todo", "doing", "review"])
        .is("deleted_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(200);
      // "Nenhuma tarefa esperando" e uma afirmacao forte. Nao pode sair de
      // uma consulta que falhou.
      if (error) throw new Error(error.message);
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: flag === "on",
    refetchInterval: 60_000,
  });

  const opDe = (id: string) => operadores.find((o) => o.id === id);
  const hoje = new Date().toISOString().slice(0, 10);

  /** Os números do quadro, uma vez só: cabeçalho, cartões e vazios usam. */
  // A tarefa concluída/arquivada pode ainda ter um vínculo aguardando insumo.
  // Preservamos seu estado histórico sem apresentá-lo como trabalho ativo.
  const encerrado = (v: Vinculo) => vinculoEncerrado(v, tarefas, tarefasProntas);
  const vinculosAtivos = useMemo(() => vinculos.filter((v) => !encerrado(v)), [vinculos, tarefas, tarefasProntas, taskIds]);
  const totalEncerradas = vinculos.length - vinculosAtivos.length;
  const diasParado = (v: Vinculo) => Math.floor((Date.now() - new Date(v.updated_at).getTime()) / 86_400_000);
  const ultimoRunDosAgentes = useMemo(() => {
    const datas = operadores.map((o) => o.last_run_at).filter(Boolean).map((d) => new Date(String(d)).getTime());
    return datas.length ? new Date(Math.max(...datas)) : null;
  }, [operadores]);
  const diasSemAgente = ultimoRunDosAgentes ? Math.floor((Date.now() - ultimoRunDosAgentes.getTime()) / 86_400_000) : null;

  const numeros = useMemo(() => {
    const por = (st: string) => vinculosAtivos.filter((v) => v.status === st).length;
    const comOperador = new Set(vinculos.map((v) => v.kanban_task_id).filter(Boolean));
    const semOperador = disponiveis.filter((t) => !comOperador.has(String(t.id)));
    return {
      fila: por("queued") + por("in_progress"),
      andamento: por("in_progress"),
      feitas: vinculosAtivos.filter((v) => v.status === "done" && v.last_evidence).length,
      revisao: por("review"),
      aguardando: por("awaiting_input"),
      bloqueadas: por("blocked"),
      aprovacoes: vinculosAtivos.filter((v) => precisaDecisao(v)).length,
      kanbanAbertas: disponiveis.length,
      semOperador,
      // Prazo estourado é a única contagem que vale por si: ela decide o dia.
      vencidas: vinculosAtivos.filter((v) => {
        const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
        return t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
      }).length,
    };
  }, [vinculosAtivos, disponiveis, tarefas, hoje]);

  const numerosDoOperador = (operatorId: string) => {
    const meus = vinculosAtivos.filter((v) => v.operator_id === operatorId);
    return {
      fila: meus.filter((v) => ["queued", "in_progress"].includes(v.status)).length,
      andamento: meus.filter((v) => v.status === "in_progress").length,
      feitas: meus.filter((v) => v.status === "done").length,
      bloqueadas: meus.filter((v) => v.status === "blocked").length,
      revisao: meus.filter((v) => v.status === "review").length,
      aguardando: meus.filter((v) => v.status === "awaiting_input").length,
      // Evidência é o que separa "feito" de "disse que fez".
      comEvidencia: meus.filter((v) => Boolean(v.last_evidence)).length,
      aprovacoes: meus.filter((v) => precisaDecisao(v)).length,
      total: meus.length,
    };
  };

  // A notificacao de aprovacao/proposta cai direto no painel certo, e
  // ?aba=diario abre a conversa do vinculo — o deep-link do MCP e este.
  useEffect(() => {
    if (aprovacaoAlvo || propostaAlvo) setVisao("aprovacao");
  }, [aprovacaoAlvo, propostaAlvo]);
  useEffect(() => {
    if (abaAlvo === "diario" && vinculoAlvo) {
      setDiarioAberto({ linkId: vinculoAlvo });
    }
  }, [abaAlvo, vinculoAlvo]);

  // A notificação abre direto o vínculo: rola até ele e destaca.
  useEffect(() => {
    if (!vinculoAlvo || vinculos.length === 0) return;
    const alvo = vinculos.find((v) => v.id === vinculoAlvo);
    if (!alvo) return;
    if (alvo.status !== "in_progress" && alvo.status !== "queued") {
      const direto = VISOES.find((x) => x.id === alvo.status);
      if (direto) setVisao(direto.id);
      else if (alvo.approval_required) setVisao("aprovacao");
    }
    const t = setTimeout(() => destacadoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(t);
  }, [vinculoAlvo, vinculos]);

  /**
   * Quantos itens tem cada visao, para o numero aparecer na propria aba.
   *
   * Numa faixa que corre para o lado, metade das abas fica fora da tela; o
   * numero ao lado do rotulo e o que faz valer a pena arrastar ate ela, em
   * vez de arrastar para descobrir que estava vazia.
   */
  const contagemDaVisao = useMemo(() => {
    const base = mostrarEncerradas ? vinculos : vinculosAtivos;
    const conta = (fn: (v: Vinculo) => boolean) => base.filter(fn).length;
    return {
      quadro: base.length,
      fila: conta((v) => ["queued", "in_progress"].includes(v.status)),
      in_progress: conta((v) => v.status === "in_progress"),
      done: conta((v) => v.status === "done"),
      review: conta((v) => v.status === "review"),
      awaiting_input: conta((v) => v.status === "awaiting_input"),
      blocked: conta((v) => v.status === "blocked"),
      aprovacao: conta((v) => precisaDecisao(v)),
      hierarquia: operadores.length,
      // Relatorios nao e uma lista de vinculos: numero ali seria invencao.
      relatorios: 0,
    } as Record<string, number>;
  }, [vinculos, vinculosAtivos, mostrarEncerradas, operadores]);

  /*
   * Quando a visao muda sozinha (notificacao apontando para um vinculo), a
   * aba dona abre sozinha (efeito "a aba segue a visao", abaixo) e as Etapas
   * do sistema trazem a aba aberta para a vista no telefone. A visao dentro
   * da aba fica no seletor ao lado dos filtros, sempre a vista.
   */

  // O filtro roda ANTES das visoes: quadro, fila e listas enxergam o
  // mesmo recorte, senao o numero da aba discorda do conteudo dela.
  const vinculosVisiveis = useMemo(() => {
    const base = mostrarEncerradas ? vinculos : vinculosAtivos;
    if (!busca.trim() && !filtroCliente && filtroPrazo === "todas") return base;
    return base.filter((v) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      const cliente = t?.project?.client;
      return passaNoFiltro({
        busca,
        cliente: filtroCliente,
        prazo: filtroPrazo,
        hoje,
        titulo: t?.title ?? v.last_action,
        nomeCliente: cliente ? (cliente.company_name || cliente.full_name) : null,
        nomeProjeto: t?.project?.name ?? null,
        nomeOperador: opDe(v.operator_id)?.display_name ?? null,
        dueDate: t?.due_date ?? null,
        statusFinal: v.status === "done",
      });
    });
  }, [vinculos, vinculosAtivos, mostrarEncerradas, tarefas, busca, filtroCliente, filtroPrazo, hoje]);

  const clientesDoQuadro = useMemo(() => {
    const nomes = new Set<string>();
    for (const t of tarefas.values()) {
      const c = t?.project?.client;
      if (c) nomes.add(c.company_name || c.full_name);
    }
    for (const t of disponiveis) {
      const c = (t as any).project?.client;
      if (c) nomes.add(c.company_name || c.full_name);
    }
    return [...nomes].sort();
  }, [tarefas, disponiveis]);

  /** As visões da aba atual: a faixa de baixo só mostra o que pertence a ela. */
  const visoesDaAba = useMemo(() => {
    const alvo = ABAS.find((a) => a.id === aba);
    return VISOES.filter((v) => (alvo?.visoes as readonly string[] | undefined)?.includes(v.id));
  }, [aba]);

  /*
   * A aba SEGUE a visão, e não o contrário.
   *
   * Um deep-link de notificação (?aprovacao=...) muda a visão direto. Sem
   * isto a aba ficaria em "Escritório" mostrando conteúdo de "Precisa de
   * você" — a aba diria uma coisa e a tela outra, que é pior do que não
   * ter aba nenhuma.
   */
  // Na abertura, "O que foi feito" guardada fica (ela nao tem visao propria);
  // depois disso, toda troca de visao leva a aba junto.
  const visaoAnterior = useRef<string | null>(null);
  useEffect(() => {
    const primeira = visaoAnterior.current === null;
    visaoAnterior.current = visao;
    if (primeira && aba === "feito") return;
    const dona = ABAS.find((a) => (a.visoes as readonly string[]).includes(visao));
    if (dona && dona.id !== aba) setAba(dona.id);
  }, [visao]);

  const irParaAba = (id: (typeof ABAS)[number]["id"]) => {
    setAba(id);
    const primeira = ABAS.find((a) => a.id === id)?.visoes[0];
    if (primeira) setVisao(primeira as (typeof VISOES)[number]["id"]);
  };

  /** Vai direto a uma visao (linha de "O que pede a sua atencao"), com a aba dona. */
  const irParaVisao = (id: (typeof VISOES)[number]["id"]) => {
    setVisao(id);
    const dona = ABAS.find((a) => (a.visoes as readonly string[]).includes(id));
    if (dona) setAba(dona.id);
  };

  const filtrados = useMemo(() => {
    if (visao === "fila") return vinculosVisiveis.filter((v) => ["queued", "in_progress"].includes(v.status));
    if (visao === "aprovacao") return vinculosVisiveis.filter((v) => precisaDecisao(v));
    if (visao === "done") return vinculosVisiveis.filter((v) => v.status === "done");
    if (visao === "relatorios" || visao === "escritorio") return [];
    return vinculosVisiveis.filter((v) => v.status === visao);
  }, [vinculosVisiveis, visao]);

  const nomesDeAgentes = useMemo(
    () => new Map(operadores.map((o) => [o.id, o.display_name])),
    [operadores],
  );
  const titulosDeTarefas = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, t] of tarefas) if (t?.title) m.set(id, String(t.title));
    for (const t of disponiveis) if ((t as any).title) m.set(String((t as any).id), String((t as any).title));
    return m;
  }, [tarefas, disponiveis]);

  const incidentes = useMemo(
    () => runs.filter((r) => ["failed", "timeout"].includes(String(r.status))),
    [runs],
  );
  const runsSemHeartbeat = runs.filter((run) => operatorRunIsStale(run)).length;

  /* ── Relatórios: gerados dos MESMOS eventos que a tela mostra ── */
  const relatorio = useMemo(() => {
    const doDia = (iso?: string | null) => Boolean(iso && String(iso).slice(0, 10) === hoje);
    const linha = (v: Vinculo) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      const cliente = t?.project?.client;
      return [
        "- " + [
          cliente ? (cliente.company_name || cliente.full_name) : null,
          t?.project?.name,
          t?.title || v.last_action || "(sem tarefa vinculada)",
        ].filter(Boolean).join(" · "),
        "  operador: " + (opDe(v.operator_id)?.display_name || "?")
          + " · humano: " + (t?.assigned_to ? (humanos.get(String(t.assigned_to)) || "?") : "sem responsavel")
          + (t?.due_date ? " · prazo: " + t.due_date : ""),
        v.last_evidence ? "  evidencia: " + v.last_evidence : null,
        v.next_step ? "  proximo passo: " + v.next_step : null,
        v.block_reason ? "  bloqueio: " + v.block_reason : null,
        precisaDecisao(v) ? "  DECISAO NECESSARIA do responsavel" : null,
      ].filter(Boolean).join("\n");
    };
    const bloco = (titulo: string, lista: Vinculo[]) =>
      lista.length ? `${titulo} (${lista.length})\n${lista.map(linha).join("\n")}` : `${titulo}: nada`;

    const feitasHoje = vinculos.filter((v) => v.status === "done" && doDia(v.updated_at));
    const emRevisao = vinculosAtivos.filter((v) => v.status === "review");
    const aguardando = vinculosAtivos.filter((v) => v.status === "awaiting_input");
    const bloqueadas = vinculosAtivos.filter((v) => v.status === "blocked");
    const andamento = vinculosAtivos.filter((v) => v.status === "in_progress");
    const prazoCritico = vinculosAtivos.filter((v) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      return t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
    });

    const abertura = [
      `ABERTURA · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Em andamento", andamento),
      bloco("Na fila", vinculosAtivos.filter((v) => v.status === "queued")),
      bloco("Aguardando insumo", aguardando),
    ].join("\n\n");

    const excecoes = [
      `EXCECOES · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Bloqueadas", bloqueadas),
      bloco("Prazo critico (vence hoje ou venceu)", prazoCritico),
      bloco("Aprovacoes pendentes", vinculosAtivos.filter((v) => precisaDecisao(v))),
      incidentes.length
        ? `Falhas de execucao (${incidentes.length})\n` + incidentes.slice(0, 10).map((r) =>
            `- ${opDe(String(r.operator_id))?.display_name || "Um agente"} ${runEmPalavras(r.status)}${r.error ? ": " + falarComoGente(String(r.error)).humano : ""}`,
          ).join("\n")
        : "Falhas de execucao: nenhuma",
    ].join("\n\n");

    const fechamento = [
      `FECHAMENTO · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Feito COM evidencia", feitasHoje.filter((v) => v.last_evidence)),
      bloco("Em revisao (inclui feito sem evidencia)", emRevisao),
      bloco("Aguardando insumo", aguardando),
      bloco("Bloqueado", bloqueadas),
    ].join("\n\n");

    const semanal = [
      `SEMANA DO PILOTO · ate ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Concluidas com evidencia", vinculos.filter((v) => v.status === "done" && v.last_evidence)),
      bloco("Em revisao", emRevisao),
      bloco("Bloqueadas", bloqueadas),
      `Runs na semana: ${runs.length} · falhas/timeouts: ${incidentes.length}`,
      "Regra do piloto: feito so conta com evidencia verificavel.",
    ].join("\n\n");

    return { abertura, excecoes, fechamento, semanal };
  }, [vinculos, vinculosAtivos, runs, incidentes, tarefas, humanos, operadores, hoje]);


  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  /** As colunas do quadro, na ordem em que o trabalho anda. */
  const COLUNAS = [
    { id: "queued", titulo: "Na fila", cor: "bg-muted-foreground" },
    { id: "in_progress", titulo: "Em andamento", cor: "bg-info" },
    { id: "review", titulo: "Em revisão", cor: "bg-warning" },
    { id: "awaiting_input", titulo: "Aguardando insumo", cor: "bg-muted-foreground" },
    { id: "blocked", titulo: "Bloqueada", cor: "bg-destructive" },
    { id: "done", titulo: "Concluída", cor: "bg-success" },
  ] as const;

  /**
   * Atualizar de verdade: recarrega TODAS as consultas da área, não só a
   * lista visível. Um botão que atualiza metade da tela é pior que
   * nenhum, porque ensina a confiar num número que não mudou.
   */
  const atualizarTudo = async () => {
    setAtualizando(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] }),
        queryClient.invalidateQueries({ queryKey: ["operador-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["operadores-internos"] }),
        queryClient.invalidateQueries({ queryKey: ["operador-tarefas-disponiveis"] }),
        queryClient.invalidateQueries({ queryKey: ["operador-tarefas"] }),
        queryClient.invalidateQueries({ queryKey: ["agente-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["agente-trilha"] }),
      ]);
      const keys = ["operador-vinculos", "operador-runs", "operadores-internos", "operador-tarefas-disponiveis", "operador-tarefas"];
      if (keys.some(key => queryClient.getQueryCache().findAll({ queryKey: [key] }).some(query => query.state.status === "error"))) {
        toast.error("Parte do quadro não pôde ser atualizada. Os últimos dados continuam visíveis.");
      } else toast.success("Quadro atualizado.");
    } finally {
      setAtualizando(false);
    }
  };

  const reconciliarExecucoes = async () => {
    if (reconciliando || profile?.role !== "admin") return;
    setReconciliando(true);
    try {
      const result = await supabase.rpc("operator_maintenance_tick");
      if (result.error) throw result.error;
      await atualizarTudo();
      toast.success("Reconciliação registrada. Histórico preservado.");
    } catch {
      toast.error("A reconciliação não foi concluída. Atualize o quadro antes de tentar novamente.");
    } finally { setReconciliando(false); }
  };

  /**
   * A mão humana no quadro. Passa pelo RPC, e não por update solto, para
   * gravar a MESMA trilha imutável das ações do agente: se a mão humana
   * escapasse da auditoria, "quem mudou isso?" ficaria sem resposta
   * justamente nos casos que mais importam.
   */
  /**
   * Entrega uma tarefa do Kanban a um agente.
   *
   * Era aqui que o ciclo travava: o botao antigo copiava o UUID para
   * alguem colar no grupo do Hermes. Isso nao e integracao, e digitacao —
   * e enquanto dependesse disso, o quadro ia continuar zerado. Agora o
   * painel coloca a tarefa na fila do agente, e ele puxa de la.
   *
   * `assigned_to` nao e tocado: oferecer trabalho a um agente nao tira a
   * tarefa de quem responde por ela.
   */
  const encaminharParaAgente = async (tarefaId: string, slug: string, nome: string) => {
    const { data, error } = await (supabase as any).rpc("operator_assign_task", {
      _operator_slug: slug,
      _kanban_task_id: tarefaId,
      _actor: profile?.full_name || "equipe",
      _note: null,
    });
    if (error) {
      toast.error(error.message || "Não foi possível encaminhar.");
      return;
    }
    toast.success(
      data?.ja_existia ? `Já estava na fila de ${nome}.` : `Na fila de ${nome}.`,
    );
    await atualizarTudo();
  };

  const moverVinculo = async (v: Vinculo, novoStatus: string) => {
    if (v.status === novoStatus) return;
    const { error } = await (supabase as any).rpc("operator_human_action", {
      _link_id: v.id,
      _new_status: novoStatus,
      _note: null,
      _resolve_approval: false,
    });
    if (error) {
      toast.error(error.message || "Não foi possível mover.");
      return;
    }
    if (novoStatus === "done") {
      // A régua vale para todos: concluir sem evidência vira revisão, e o
      // banco decide isso — a tela só conta o que aconteceu.
      toast.success(v.last_evidence ? "Movido para concluída." : "Sem evidência: foi para revisão.");
    } else {
      toast.success("Movido.");
    }
    await queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
  };

  const resolverAprovacao = async (v: Vinculo) => {
    const { error } = await (supabase as any).rpc("operator_human_action", {
      _link_id: v.id, _new_status: null, _note: null, _resolve_approval: true,
    });
    if (error) { toast.error(error.message || "Não foi possível resolver."); return; }
    toast.success("Aprovação resolvida.");
    await queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
  };

  const itensDoCartao = (v: Vinculo): ItemDeMenu[] => {
    const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
    const itens: ItemDeMenu[] = [
      { rotulo: "Ver o agente", acao: () => setAgenteAberto(opDe(v.operator_id) ?? null) },
      {
        rotulo: "Copiar resumo",
        acao: () => void copiar(
          [t?.title || v.last_action || "(tarefa)", `operador: ${opDe(v.operator_id)?.display_name || "?"}`,
           `status: ${STATUS_ROTULO[v.status] || v.status}`, v.last_evidence ? `evidencia: ${v.last_evidence}` : null,
           v.next_step ? `proximo passo: ${v.next_step}` : null].filter(Boolean).join("\n"),
          "Resumo",
        ),
      },
    ];
    if (v.kanban_task_id) {
      // A conta da tarefa e de gente. Antes so dava para mexer nisso no
      // Kanban, e aqui o dono via "sem responsavel" sem ter o que fazer.
      itens.push({
        rotulo: t?.assigned_to ? "Trocar responsável humano" : "Definir responsável humano",
        acao: () => setResponsavelAberto({
          taskId: String(v.kanban_task_id),
          titulo: t?.title,
          atual: t?.assigned_to ?? null,
        }),
      });
      itens.push({ rotulo: "Copiar código da tarefa (uso técnico)", acao: () => void copiar(String(v.kanban_task_id), "Código") });
      // Excluir aqui e excluir de verdade, pela mesma regra do Kanban: a tarefa
      // sai, o vinculo vira "encerrado" e o diario do cliente guarda o descarte.
      if (t) {
        itens.push({
          rotulo: "Excluir tarefa",
          acao: async () => {
            if (!window.confirm(`Excluir "${t.title}" de vez? Comentários, checklist e anexos vão junto; o diário do cliente guarda que ela foi descartada.`)) return;
            const r = await excluirTarefa({ id: String(t.id), title: t.title, project_id: t.project_id ?? null, source: t.source ?? null, ops_node_id: t.ops_node_id ?? null } as any, { motivo: "excluída pela Execução" });
            if (!r.ok) { toast.error(r.mensagem); return; }
            toast.success("Tarefa excluída. O vínculo do agente ficou como histórico.");
            for (const chave of ["operador-vinculos", "operador-tarefas", "operador-tarefas-disponiveis", "tasks", "execucao"]) void queryClient.invalidateQueries({ queryKey: [chave] });
          },
        });
      }
    }
    itens.push({ separador: true });
    for (const c of COLUNAS) {
      if (c.id === v.status) continue;
      itens.push({ rotulo: `Mover para ${c.titulo}`, acao: () => void moverVinculo(v, c.id) });
    }
    if (precisaDecisao(v)) {
      itens.push({ separador: true });
      itens.push({ rotulo: "Marcar aprovação como resolvida", acao: () => void resolverAprovacao(v) });
    }
    return itens;
  };

  /**
   * Os agentes agrupados pela área que o organograma define.
   *
   * A ordem dentro de cada bloco vem do display_order, que é o mesmo
   * número que o Hermes controla por operator_organize: quem manda na
   * apresentação é o dado, e não a ordem em que o banco devolveu.
   */
  /**
   * Quais áreas ficam abertas.
   *
   * Guardo as FECHADAS, e não as abertas: assim uma área que o Hermes
   * cadastrar amanhã nasce visível em vez de escondida por um estado que
   * não a conhecia.
   *
   * O padrão fecha quem não tem tarefa nenhuma. É o que encurta a tela sem
   * esconder trabalho: nove áreas paradas viravam nove blocos de rolagem
   * antes de chegar no que está andando.
   */
  const [areasFechadas, setAreasFechadas] = useState<Set<string>>(() => {
    try {
      const cru = localStorage.getItem(AREAS_FECHADAS);
      const lido = cru ? JSON.parse(cru) : null;
      return new Set(Array.isArray(lido) ? (lido as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  const [escolheuSozinho, setEscolheuSozinho] = useState(false);

  const alternarArea = (area: string, todas?: string[]) => {
    setEscolheuSozinho(true);
    setAreasFechadas((antes) => {
      const proximo = new Set(antes);
      const decidido = alternarFechadas(proximo, area, todas);
      try {
        localStorage.setItem(AREAS_FECHADAS, JSON.stringify([...decidido]));
      } catch { /* sem armazenamento, vale só nesta sessão */ }
      return decidido;
    });
  };

  const agrupadosPorArea = useMemo(() => {
    const porArea = new Map<string, Operador[]>();
    for (const o of operadores) {
      const chave = o.area?.trim() || "Sem área definida";
      const atual = porArea.get(chave);
      if (atual) atual.push(o);
      else porArea.set(chave, [o]);
    }
    return [...porArea.entries()].sort(([a], [b]) =>
      a === "Sem área definida" ? 1 : b === "Sem área definida" ? -1 : a.localeCompare(b, "pt-BR"),
    );
  }, [operadores]);

  /**
   * Está fechada?
   *
   * Enquanto a pessoa não mexeu, vale o padrão: área sem tarefa nenhuma
   * nasce recolhida. Depois do primeiro clique, manda a escolha dela — até
   * para reabrir uma área vazia, se for isso que quiser.
   */
  const estaFechada = (area: string) =>
    areaComecaFechada(
      area,
      agrupadosPorArea.map(([nome, doGrupo]) => ({
        area: nome,
        tarefas: doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).total, 0),
      })),
      areasFechadas,
      escolheuSozinho,
    );

  /** Os nós do organograma, montados dos operadores reais. */
  const nosDoOrganograma: NoDoOrganograma[] = useMemo(
    () => operadores.map((o) => {
      const n = numerosDoOperador(o.id);
      return {
        id: o.id,
        nome: o.display_name,
        papel: o.scope,
        nivel: o.is_coordinator ? ("coordenador" as const) : ("operador" as const),
        ativo: o.status === "active",
        emAndamento: n.andamento,
        feitas: n.feitas,
        bloqueadas: n.bloqueadas,
        area: o.area,
        // O chefe aparece pelo NOME, nao pelo slug: quem le o organograma
        // procura "Augusto", nao "augusto-coord".
        chefe: o.parent_slug
          ? operadores.find((p) => p.slug === o.parent_slug)?.display_name ?? o.parent_slug
          : null,
      };
    }),
    [operadores, vinculosAtivos],
  );

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <EstadoVazio icone={<ShieldAlert className="h-5 w-5" />} titulo="Esta área é da equipe." />;
  }
  if (flag === "off") {
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina titulo="Execução" />
        <EstadoVazio
          icone={<PauseCircle className="h-5 w-5" />}
          titulo="A camada de operadores está desligada."
          descricao={<>Flag <code>operators_layer</code>. Nada foi apagado; religar a flag traz tudo de volta.</>}
        />
      </div>
    );
  }
  if (flag === "erro" || (flag === undefined && flagFalhou)) {
    // A distinção que faltava: não é "desligada", é "não consegui ler".
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina titulo="Execução" />
        <EstadoDeErro
          titulo="Não consegui ler a configuração desta área."
          descricao="Isso não quer dizer que ela esteja desligada. Costuma acontecer nos primeiros minutos depois que as tabelas nascem, enquanto a API ainda não as enxerga. Se persistir, confira se a migration dos operadores foi aplicada."
          acao={
            <button type="button" className={botao.secundario} disabled={lendoFlag} onClick={() => void relerFlag()}>
              Tentar de novo
            </button>
          }
        />
      </div>
    );
  }
  if (flag === undefined) {
    // Primeira leitura: esqueleto no lugar da tela, sem piscar números zerados.
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina titulo="Execução" />
        <Carregando forma="aba" rotulo="Carregando a execução" />
      </div>
    );
  }

  const Cartao = ({ v }: { v: Vinculo }) => {
    const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
    const cliente = t?.project?.client;
    const op = opDe(v.operator_id);
    const destacado = v.id === vinculoAlvo;
    const prazoVencido = t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
    return (
      <div
        ref={destacado ? destacadoRef : undefined}
        /* Clicar ABRE a tarefa. O cartão só tinha menu de botão direito:
           quem clicava normalmente não via nada acontecer, e a conclusão
           natural era que o quadro estava quebrado. */
        onClick={() => {
          const id = v.kanban_task_id ?? (v as any).painel_task_id;
          if (id) setTarefaAberta(tarefas.get(String(id)) ?? { id });
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          const id = v.kanban_task_id ?? (v as any).painel_task_id;
          if (id) setTarefaAberta(tarefas.get(String(id)) ?? { id });
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenuCartao({ x: e.clientX, y: e.clientY, v }); }}
        className={juntar(
          "min-w-0 cursor-pointer px-3.5 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          destacado && "bg-primary/10 ring-2 ring-inset ring-primary/50",
        )}
      >
        <p className="text-[13px] font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
          {t?.title || v.last_action || "(sem tarefa vinculada)"}
        </p>
        <div className="mt-1">
          <div className="-m-0.5 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
            <span className={juntar(
              etiqueta,
              v.status === "done" ? "bg-success/15 text-success"
                : v.status === "blocked" ? "bg-destructive/15 text-destructive"
                : v.status === "review" ? "bg-warning/15 text-warning"
                : "bg-muted text-muted-foreground",
            )}>
              {STATUS_ROTULO[v.status] || v.status}
            </span>
            {/* ORIGEM: isso depende de mim? CATEGORIA: que trabalho e este?
                Sao os dois badges que faltavam para "em revisao" nao
                parecer "arte final publicada". */}
            {(() => {
              const origem = origemDaExecucao(v);
              return origem !== "interno" && (
                <span className={juntar(
                  etiqueta,
                  origem === "aguardando_almir" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive",
                )}>
                  {ROTULO_ORIGEM[origem]}
                </span>
              );
            })()}
            {(() => {
              const cat = categoriaDaTarefa(t?.title);
              return cat !== "geral" && (
                <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>
                  {ROTULO_CATEGORIA[cat]}
                </span>
              );
            })()}
            <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>
              {[cliente ? (cliente.company_name || cliente.full_name) : null, t?.project?.name]
                .filter(Boolean).join(" · ") || "sem projeto"}
            </span>
          </div>
        </div>

        <div className="-mx-1.5 mt-1.5 flex flex-wrap items-center text-[12px] text-muted-foreground [&>*]:mx-1.5">
          <span className="inline-flex items-center">
            <Bot className="mr-1 h-3 w-3" aria-hidden="true" /> {op?.display_name || "?"}
          </span>
          <span>
            humano: <span className="font-medium text-foreground/80">
              {t?.assigned_to ? humanos.get(String(t.assigned_to)) || "?" : "sem responsável"}
            </span>
          </span>
          {t?.due_date && (
            <span className={juntar("inline-flex items-center tabular-nums", prazoVencido && "font-semibold text-destructive")}>
              <Clock className="mr-1 h-3 w-3" aria-hidden="true" /> {t.due_date}
            </span>
          )}
          <span className="tabular-nums">{dataCurta(v.updated_at)}</span>
        </div>

        {v.last_action && (
          <p className={juntar(texto.corpo, "mt-1.5 text-foreground/85")}>
            {falarComoGente(v.last_action).humano}
          </p>
        )}
        {v.last_evidence && (() => {
          // Traduz UMA vez: o cartão é redesenhado a cada atualização da
          // fila, e três chamadas por cartão viram trabalho à toa.
          const ev = falarComoGente(v.last_evidence);
          return (
          /* A evidência em português, com o log de máquina guardado atrás de
             um toque. Traduzir é para dar de LER; apagar o original seria
             trocar um problema por outro pior, porque é a evidência que
             sustenta a entrega. */
          <details
            className="mt-1"
            /* Abrir o detalhe NÃO pode abrir a tarefa: o cartão inteiro é
               clicável, e o clique aqui é outra intenção. */
            onClick={(e) => e.stopPropagation()}
          >
            <summary className="cursor-pointer list-none text-[12px] text-muted-foreground marker:hidden">
              <span className="break-words">
                {v.last_evidence.startsWith("http")
                  ? <a className="break-all text-primary underline" href={v.last_evidence} target="_blank" rel="noopener noreferrer">{v.last_evidence}</a>
                  : ev.humano}
              </span>
              {ev.temDetalheTecnico && (
                <span className="ml-1 whitespace-nowrap text-[11px] text-primary/80 underline">
                  detalhe técnico
                </span>
              )}
            </summary>
            {ev.temDetalheTecnico && (
              <p className={juntar(superficie.poco, "mt-1 break-all p-2 font-mono text-[11px] leading-relaxed text-muted-foreground")}>
                {ev.original}
              </p>
            )}
          </details>
          );
        })()}
        {v.next_step && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            próximo passo: {falarComoGente(v.next_step).humano}
          </p>
        )}
        {encerrado(v) && (
          <p className="mt-1 text-[12px] text-muted-foreground" title="A tarefa foi concluída, arquivada ou excluída; o vínculo ficou como histórico.">
            encerrado: tarefa concluída, arquivada ou excluída
          </p>
        )}
        {!encerrado(v) && ["blocked", "awaiting_input", "review", "queued"].includes(v.status) && diasParado(v) >= 3 && (
          <p className="mt-1 text-[12px] text-warning">
            parado há {diasParado(v)} dias{v.status === "awaiting_input" ? ": o agente espera uma resposta sua" : v.status === "review" ? ": esperando sua revisão" : v.status === "queued" ? ": na fila, nenhum agente pegou" : ""}
          </p>
        )}
        {v.block_reason && !encerrado(v) && (
          <p className="mt-1 text-[12px] text-destructive">
            bloqueio: {falarComoGente(v.block_reason).humano}
          </p>
        )}
        <div className="mt-2">
          <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
            {precisaDecisao(v) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setVisao("aprovacao"); }}
                className="inline-flex h-7 items-center rounded-md bg-warning/15 px-2 text-[12px] font-medium text-warning hover:bg-warning/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" /> aprovação necessária: decidir
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setDiarioAberto({ linkId: v.id, titulo: t?.title || v.last_action || undefined }); }}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Conversar com o agente nesta execução: instrução, contexto, correção"
            >
              diário
            </button>
          </div>
        </div>
      </div>
    );
  };

  /** Lista de vínculos: linhas com divisória num painel só, sem caixa por linha. */
  const ListaDeCartoes = ({ lista, rotulo }: { lista: Vinculo[]; rotulo: string }) => (
    <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")} aria-label={rotulo}>
      {lista.map((v) => (
        <li key={v.id} className="min-w-0">
          <Cartao v={v} />
        </li>
      ))}
    </ul>
  );

  /* O que pede a sua atencao, em frases e na ordem de urgencia. Seis
     caixinhas com numero soltavam sete numeros na cara sem dizer o que
     fazer com eles; aqui cada linha e uma coisa para decidir e leva
     para a visao certa com um toque. */
  const linhasDeAtencao: Array<{ chave: string; texto: string; tom: string; ponto: string; visao: (typeof VISOES)[number]["id"] }> = [];
  if (numeros.aprovacoes > 0) linhasDeAtencao.push({ chave: "aprov", texto: `${numeros.aprovacoes} ${numeros.aprovacoes === 1 ? "ação espera a sua aprovação" : "ações esperam a sua aprovação"}`, tom: "text-warning", ponto: "bg-warning", visao: "aprovacao" });
  if (numeros.vencidas > 0) linhasDeAtencao.push({ chave: "venc", texto: `${numeros.vencidas} ${numeros.vencidas === 1 ? "tarefa passou do prazo" : "tarefas passaram do prazo"}`, tom: "text-destructive", ponto: "bg-destructive", visao: "quadro" });
  if (numeros.aguardando > 0) linhasDeAtencao.push({ chave: "aguard", texto: `${numeros.aguardando} ${numeros.aguardando === 1 ? "agente espera uma resposta sua" : "agentes esperam uma resposta sua"}`, tom: "text-warning", ponto: "bg-warning", visao: "awaiting_input" });
  if (numeros.revisao > 0) linhasDeAtencao.push({ chave: "rev", texto: `${numeros.revisao} ${numeros.revisao === 1 ? "entrega pronta para você revisar" : "entregas prontas para você revisar"}`, tom: "text-warning", ponto: "bg-warning", visao: "review" });
  if (numeros.bloqueadas > 0) linhasDeAtencao.push({ chave: "bloq", texto: `${numeros.bloqueadas} ${numeros.bloqueadas === 1 ? "tarefa travada" : "tarefas travadas"} (o motivo está no cartão)`, tom: "text-destructive", ponto: "bg-destructive", visao: "blocked" });
  if (numeros.andamento > 0) linhasDeAtencao.push({ chave: "and", texto: `${numeros.andamento} em andamento agora`, tom: "text-info", ponto: "bg-info", visao: "in_progress" });
  if (numeros.feitas > 0) linhasDeAtencao.push({ chave: "feitas", texto: `${numeros.feitas} ${numeros.feitas === 1 ? "concluída com prova" : "concluídas com prova"}`, tom: "text-success", ponto: "bg-success", visao: "done" });

  const atencao = (
    <Secao
      titulo="O que pede a sua atenção"
      descricao={numeros.kanbanAbertas === 0
        ? "Nenhuma tarefa aberta no Kanban agora"
        : `${numeros.kanbanAbertas} ${numeros.kanbanAbertas === 1 ? "tarefa aberta" : "tarefas abertas"} no Kanban${numeros.semOperador.length > 0 ? ` · ${numeros.semOperador.length} ainda sem agente` : " · todas com agente"}`}
    >
      {carregandoVinculos && vinculos.length === 0 ? (
        <Carregando linhas={3} rotulo="Carregando o resumo" />
      ) : linhasDeAtencao.length === 0 ? (
        <EstadoVazio compacto titulo="Nada esperando você agora." />
      ) : (
        <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
          {linhasDeAtencao.map((l) => (
            <li key={l.chave}>
              <button
                type="button"
                onClick={() => irParaVisao(l.visao)}
                className="flex w-full min-w-0 items-center px-3.5 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className={juntar("mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full", l.ponto)} aria-hidden="true" />
                <span className={juntar("min-w-0 flex-1 text-[13px] font-medium", l.tom)}>{l.texto}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );

  const areasEIncidentes = (
    <div className="space-y-6">
      {incidentes.length > 0 && (
        <Secao titulo={`${incidentes.length} incidente(s) de execução`} recolher="execucao:incidentes">
          <ul className="space-y-1.5">
            {incidentes.slice(0, 5).map((r) => (
              <li key={String(r.id)} className="flex min-w-0 items-start text-[12px] leading-5 text-muted-foreground" title={`execução ${String(r.run_key)}`}>
                <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <strong className="font-medium text-foreground/85">{opDe(String(r.operator_id))?.display_name || "Um agente"}</strong>{" "}
                  {runEmPalavras(r.status)} {dataCurta(String(r.finished_at || r.started_at))}
                  {r.error ? `: ${falarComoGente(String(r.error)).humano}` : ""}
                  {r.attempt > 1 ? ` (${r.attempt}ª tentativa)` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <Secao
        titulo="Áreas"
        descricao={`${operadores.length} ${operadores.length === 1 ? "agente" : "agentes"}`}
        acao={agrupadosPorArea.length > 1 ? (
          <button
            type="button"
            onClick={() => alternarArea("", agrupadosPorArea.map(([a]) => a))}
            className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
          >
            {agrupadosPorArea.every(([a]) => estaFechada(a)) ? "abrir todas" : "fechar todas"}
          </button>
        ) : undefined}
      >
        {/* AS AREAS COMO FAIXA, e nao como pilha.
            Minha versao anterior recolhia cada area numa barra de largura
            inteira: nove barras quase vazias empilhadas, que polui mais do
            que o problema que eu tinha ido resolver. Recolhido nao pode
            ocupar o mesmo espaco que aberto.
            Agora fechada e uma pastilha, e as nove cabem em duas linhas.
            Aberta vira bloco, logo abaixo. */}
        <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
          {agrupadosPorArea.map(([area, doGrupo]) => {
            const emAndamento = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).andamento, 0);
            const feitas = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).feitas, 0);
            const bloqueadas = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).bloqueadas, 0);
            const temMovimento = emAndamento + feitas + bloqueadas > 0;
            const aberta = !estaFechada(area);
            return (
              <button
                key={area}
                type="button"
                onClick={() => alternarArea(area)}
                aria-expanded={aberta}
                title={`${doGrupo.length} ${doGrupo.length === 1 ? "agente" : "agentes"}`}
                className={juntar(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  aberta
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {/* O ponto so aparece onde HA movimento: pintar todas faria a
                    cor deixar de significar alguma coisa. */}
                {temMovimento && (
                  <span className={juntar(
                    "mr-1.5 h-1.5 w-1.5 rounded-full",
                    bloqueadas > 0 ? "bg-destructive" : emAndamento > 0 ? "bg-info" : "bg-success",
                  )} aria-hidden />
                )}
                {area}
                <span className={juntar(
                  "ml-1.5 rounded-full px-1.5 text-[11px] tabular-nums",
                  aberta ? "bg-primary/20" : "bg-muted",
                )}>
                  {doGrupo.length}
                </span>
              </button>
            );
          })}
        </div>

        {/* So as areas ABERTAS viram bloco. Fechada ja disse o que tinha a
            dizer na pastilha acima. Dentro do bloco, os agentes sao linhas
            com divisoria: nada de cartao dentro de cartao. */}
        <div className="mt-3 space-y-3">
          {agrupadosPorArea.filter(([area]) => !estaFechada(area)).map(([area, doGrupo]) => {
            const emAndamentoDaArea = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).andamento, 0);
            const feitasDaArea = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).feitas, 0);
            return (
              <section key={area} aria-label={area} className={juntar(superficie.painel, "overflow-hidden")}>
                <div className="flex min-w-0 items-center border-b border-border py-1.5 pl-3.5 pr-1.5">
                  <span className="mr-2 h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                  <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{area}</h3>
                  {emAndamentoDaArea > 0 && <span className="ml-2 shrink-0 text-[11px] tabular-nums text-info">{emAndamentoDaArea} em andamento</span>}
                  {feitasDaArea > 0 && <span className="ml-2 shrink-0 text-[11px] tabular-nums text-success">{feitasDaArea} feitas</span>}
                  <button
                    type="button"
                    onClick={() => alternarArea(area)}
                    className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[12px]")}
                  >
                    fechar
                  </button>
                </div>
                <ul className="divide-y divide-border">
                  {doGrupo.map((o) => {
                    const n = numerosDoOperador(o.id);
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setAgenteAberto(o)}
                          className="flex w-full min-w-0 items-start px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <Bot className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center">
                              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{o.display_name}</span>
                              {o.is_coordinator && (
                                <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>coordenador</span>
                              )}
                            </span>
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {o.role}{o.scope ? ` · ${o.scope}` : ""}
                            </span>
                            {o.parent_slug && (
                              <span className={juntar(texto.auxiliar, "block truncate")}>
                                responde a {operadores.find((p) => p.slug === o.parent_slug)?.display_name ?? o.parent_slug}
                              </span>
                            )}
                            <span className="mt-1 flex flex-wrap text-[11px] [&>*]:mr-2.5">
                              {n.total === 0 ? (
                                <span className="text-muted-foreground">nenhuma tarefa ainda</span>
                              ) : (
                                <>
                                  {n.andamento > 0 && <span className="text-info">{n.andamento} em andamento</span>}
                                  {n.feitas > 0 && <span className="text-success">{n.feitas} feitas</span>}
                                  {n.bloqueadas > 0 && <span className="text-destructive">{n.bloqueadas} bloqueadas</span>}
                                  {n.revisao > 0 && <span className="text-warning">{n.revisao} em revisão</span>}
                                  {n.comEvidencia > 0 && (
                                    <span className="text-muted-foreground">{n.comEvidencia} com evidência</span>
                                  )}
                                </>
                              )}
                              <span className="text-muted-foreground">
                                {o.last_run_at ? `última execução ${dataCurta(o.last_run_at)}` : "sem execução ainda"}
                              </span>
                            </span>
                          </span>
                          <span
                            className={juntar("ml-2 mt-1.5 h-2 w-2 shrink-0 rounded-full", o.status === "active" ? "bg-success" : "bg-muted-foreground/40")}
                            aria-label={o.status === "active" ? "ativo" : "pausado"}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </Secao>
    </div>
  );

  /** A visão aberta: o conteúdo que rola na região principal. */
  const conteudoDaVisao = carregandoVinculos && vinculos.length === 0 ? (
    <Carregando linhas={4} rotulo="Carregando o trabalho dos agentes" />
  ) : visao === "escritorio" ? (
    <Escritorio
      agentes={operadores}
      trabalhos={vinculosVisiveis as any}
      tarefas={tarefas}
      humanos={humanos}
      aoAbrirAgente={(a) => {
        const op = operadores.find((o) => o.id === a.id);
        if (op) setAgenteAberto(op);
      }}
      aoAbrirTarefa={(id) => setTarefaAberta(tarefas.get(String(id)) ?? { id })}
    />
  ) : visao === "hierarquia" ? (
    <OrganogramaAgentes
      nos={nosDoOrganograma}
      nomeDoDono={profile?.full_name || "Você"}
      aoAbrir={(no) => {
        const op = operadores.find((o) => o.id === no.id);
        if (op) setAgenteAberto(op);
        else toast.info(
          no.nivel === "gateway"
            ? "O Hermes é a porta de entrada: a conversa acontece no grupo dele."
            : "Você está no topo: aprova, decide e recebe os relatórios.",
        );
      }}
    />
  ) : visao === "relatorios" ? (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        { titulo: "Abertura do dia", texto: relatorio.abertura, icone: Activity },
        { titulo: "Checkpoint de exceções", texto: relatorio.excecoes, icone: AlertTriangle },
        { titulo: "Fechamento do dia", texto: relatorio.fechamento, icone: CheckCircle2 },
        { titulo: "Semana do piloto", texto: relatorio.semanal, icone: FileCheck2 },
      ].map((r) => (
        /* Cada relatório é um item da grade (cartão com função): o Painel do
           sistema, que já recolhe. O ícone vai junto do título, então a chave
           de recolher é escolhida aqui. */
        <Painel
          key={r.titulo}
          as="section"
          aria-label={r.titulo}
          semEspaco
          recolher={`execucao:relatorio:${r.titulo}`}
          titulo={
            <span className="inline-flex min-w-0 max-w-full items-center">
              <r.icone className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">{r.titulo}</span>
            </span>
          }
          acao={
            <button
              type="button"
              onClick={() => void copiar(r.texto, r.titulo)}
              className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}
            >
              <ClipboardCopy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Copiar
            </button>
          }
        >
          <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {r.texto}
          </pre>
        </Painel>
      ))}
    </div>
  ) : visao === "fila" ? (
    <div className="space-y-6">
      {operadores.filter((o) => !o.is_coordinator).map((o) => {
        const doOperador = filtrados.filter((v) => v.operator_id === o.id);
        return (
          <Secao key={o.id} nivel={3} titulo={o.display_name} descricao={`${doOperador.length} na fila`}>
            {doOperador.length === 0 ? (
              <EstadoVazio
                compacto
                titulo={`${o.display_name} ainda não pegou nenhuma tarefa.`}
                descricao={numeros.semOperador.length > 0 ? `Há ${numeros.semOperador.length} esperando alguém.` : undefined}
              />
            ) : (
              <ListaDeCartoes lista={doOperador} rotulo={`Fila de ${o.display_name}`} />
            )}
          </Secao>
        );
      })}

      {/* Esperando alguém: as tarefas reais do Kanban sem operador, com
          o id pronto para copiar. É o que transforma "está vazio" em
          "comece por aqui" — e o que o Hermes precisa para escolher uma
          tarefa de verdade em vez de inventar. */}
      {numeros.semOperador.length > 0 && (
        <Secao nivel={3} titulo="Esperando um operador" descricao={`${numeros.semOperador.length} no Kanban`}>
          <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
            {numeros.semOperador.slice(0, 8).map((t) => {
              const cliente = t.project?.client;
              const vencida = t.due_date && String(t.due_date) <= hoje;
              return (
                <li key={String(t.id)} className="flex min-w-0 items-center px-3.5 py-2.5">
                  <div className="mr-3 min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{t.title}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {[cliente ? (cliente.company_name || cliente.full_name) : null, t.project?.name]
                        .filter(Boolean).join(" · ") || "sem projeto"}
                      {t.due_date && (
                        <span className={juntar("ml-1", vencida && "font-semibold text-destructive")}>
                          · prazo {t.due_date}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => setMenuEncaminhar({
                      x: e.clientX, y: e.clientY,
                      tarefaId: String(t.id), titulo: String(t.title),
                    })}
                    title="Colocar esta tarefa na fila de um agente"
                    className={juntar(botao.secundario, "h-8 px-3 text-[12px] text-primary")}
                  >
                    encaminhar
                  </button>
                </li>
              );
            })}
          </ul>
          {numeros.semOperador.length > 8 && (
            <p className={juntar(texto.auxiliar, "mt-2")}>
              e mais {numeros.semOperador.length - 8} no Kanban.
            </p>
          )}
        </Secao>
      )}
    </div>
  ) : visao === "aprovacao" ? (
    <div className="space-y-6">
      {/* Primeiro os pedidos EXPLICADOS (tabela nova), depois as
          propostas de responsavel, e por ultimo os vinculos que so
          carregam o selo antigo — visiveis para nada ficar invisivel
          enquanto o agente ainda nao migrou para o pedido explicado. */}
      <AprovacoesExplicadas
        nomesDeAgentes={nomesDeAgentes}
        titulosDeTarefas={titulosDeTarefas}
        destaqueId={aprovacaoAlvo}
        aoAbrirDiario={(linkId) => setDiarioAberto({ linkId })}
      />
      <PropostasDeResponsavel
        nomesDeAgentes={nomesDeAgentes}
        titulosDeTarefas={titulosDeTarefas}
        destaqueId={propostaAlvo}
      />
      {filtrados.length > 0 && (
        <Secao nivel={3} titulo="Vínculos marcados com o selo" descricao={`${filtrados.length}`}>
          <ListaDeCartoes lista={filtrados} rotulo="Vínculos marcados com o selo" />
        </Secao>
      )}
    </div>
  ) : filtrados.length === 0 ? (
    <EstadoVazio
      icone={<PauseCircle className="h-5 w-5" />}
      titulo={<>Nada em {VISOES.find((x) => x.id === visao)?.rotulo.toLowerCase()} agora.</>}
      descricao={numeros.andamento > 0
        ? `${numeros.andamento} tarefa(s) em andamento em outra visão.`
        : `${numeros.kanbanAbertas} tarefas abertas no Kanban esperando execução.`}
    />
  ) : (
    <div className="space-y-3">
      <ListaDeCartoes lista={filtrados} rotulo={VISOES.find((x) => x.id === visao)?.rotulo || "Vínculos"} />
      {visao === "done" && filtrados.some((v) => !v.last_evidence) && (
        <div className="flex items-center text-[12px] text-warning">
          <XCircle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {filtrados.filter((v) => !v.last_evidence).length} concluída(s) sem evidência
          </span>
          <AjudaRecolhida className="ml-1.5" rotulo="Por que isso é um problema?">
            Concluída sem evidência não deveria existir aqui: o banco rebaixa para revisão na gravação.
          </AjudaRecolhida>
        </div>
      )}
    </div>
  );

  /* O quadro: colunas com ROLAGEM PRÓPRIA no computador. Sem isso, uma
     coluna cheia empurra a página inteira e as outras somem de vista. No
     celular as colunas viram seções empilhadas e a página rola normal. */
  const quadro = (
    <div className="min-w-0 space-y-6 lg:flex lg:min-h-0 lg:flex-1 lg:space-y-0 lg:overflow-x-auto lg:pb-3 lg:[&>*+*]:ml-3">
      {COLUNAS.map((c) => {
        const daColuna = vinculosVisiveis.filter((v) => v.status === c.id);
        return (
          <section key={c.id} aria-label={c.titulo} className="min-w-0 lg:flex lg:min-h-0 lg:w-[264px] lg:shrink-0 lg:flex-col">
            <div className="mb-2 flex shrink-0 items-center">
              <span className={juntar("mr-2 h-1.5 w-1.5 shrink-0 rounded-full", c.cor)} aria-hidden="true" />
              <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">{c.titulo}</h3>
              <span className={juntar(etiqueta, "ml-auto bg-muted text-muted-foreground")}>{daColuna.length}</span>
            </div>
            {daColuna.length === 0 ? (
              <EstadoVazio compacto titulo="Vazia" />
            ) : (
              <RegiaoRolavel modo="lg" rotulo={`Coluna ${c.titulo}`} memoria={`execucao:quadro:${c.id}`}>
                <ListaDeCartoes lista={daColuna} rotulo={c.titulo} />
              </RegiaoRolavel>
            )}
          </section>
        );
      })}
    </div>
  );

  const filtrosAtivos = Boolean(busca.trim() || filtroCliente || filtroPrazo !== "todas");
  const mostraFiltros = aba !== "feito" && visao !== "relatorios" && visao !== "hierarquia";
  /** Quantos recortes da linha 2 estão ligados (o número do botão "Filtros"). */
  const recortesLigados = (filtroCliente ? 1 : 0) + (filtroPrazo !== "todas" ? 1 : 0);

  /** A visão dentro da aba: um seletor (mais de 4 opções vira lista). */
  const seletorDeVisao = aba !== "feito" && visoesDaAba.length > 1 ? (
    <SeletorCompacto
      rotulo="Visão"
      valor={visao}
      onEscolher={(v) => setVisao(v as (typeof VISOES)[number]["id"])}
      listaQuandoNaoCabe
      opcoes={visoesDaAba.map((x) => {
        const quantos = contagemDaVisao[x.id] ?? null;
        return { valor: x.id, rotulo: x.rotulo, contador: quantos !== null && quantos > 0 ? quantos : null };
      })}
    />
  ) : null;

  const principal = (
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <div className="shrink-0 border-b border-border">
        {/* AS ABAS: separam por pergunta, e ficam acima de tudo. */}
        <Etapas
          rotulo="Abas da Execução"
          valor={aba}
          onEscolher={(id) => irParaAba(id as (typeof ABAS)[number]["id"])}
          itens={ABAS.map((x) => {
            // A aba "O que foi feito" nao tem visao nenhuma, e uma lista vazia
            // faz o TypeScript inferir never[]. O tipo explicito resolve sem
            // obrigar a aba a inventar uma visao que ela nao tem.
            const quantos = (x.visoes as readonly string[])
              .reduce((s, id) => s + (contagemDaVisao[id] ?? 0), 0);
            return { valor: x.id, rotulo: x.rotulo, contador: quantos };
          })}
        />
      </div>

      {/* A visão da aba e os recortes numa BarraDeControles (no máximo duas
          linhas). Linha 1: a busca e a visão (um seletor; mais de 4 vira
          lista) e o "..." com limpar e os vínculos encerrados. Linha 2: cliente
          e prazo; se não couberem, viram "Filtros (n)". A busca, o cliente e o
          prazo aplicam antes das visões para número e conteúdo nunca
          discordarem. */}
      {mostraFiltros ? (
        <BarraDeControles
          rotulo="Filtros da Execução"
          className="mt-3 shrink-0"
          inicio={
            <CampoDeBusca
              valor={busca}
              onMudar={setBusca}
              placeholder="Buscar tarefa, cliente ou agente"
              rotulo="Buscar tarefa, cliente, projeto ou agente"
              className="sm:max-w-[280px]"
            />
          }
          acoes={seletorDeVisao || undefined}
          filtros={
            <>
              <SeletorCompacto
                rotulo="Cliente"
                icone={<Building2 className="h-3.5 w-3.5" />}
                valor={filtroCliente}
                onEscolher={setFiltroCliente}
                modo="lista"
                opcoes={[{ valor: "", rotulo: "Todos os clientes" }].concat(clientesDoQuadro.map((c) => ({ valor: c, rotulo: c })))}
              />
              <SeletorCompacto
                rotulo="Prazo"
                valor={filtroPrazo}
                onEscolher={(v) => setFiltroPrazo(v as typeof filtroPrazo)}
                modo="segmentado"
                listaQuandoNaoCabe
                opcoes={[
                  { valor: "todas", rotulo: "Qualquer prazo" },
                  { valor: "vencidas", rotulo: "Vencidas" },
                  { valor: "semana", rotulo: "Próximos 7 dias" },
                ]}
              />
            </>
          }
          filtrosAtivos={recortesLigados}
          aoLimparFiltros={() => { setFiltroCliente(""); setFiltroPrazo("todas"); }}
          mais={[
            filtrosAtivos && {
              rotulo: `Limpar busca e filtros (${vinculosVisiveis.length}/${vinculos.length})`,
              aoEscolher: () => { setBusca(""); setFiltroCliente(""); setFiltroPrazo("todas"); },
            },
            totalEncerradas > 0 && {
              rotulo: `${mostrarEncerradas ? "Esconder" : "Mostrar"} ${totalEncerradas} vínculo${totalEncerradas === 1 ? "" : "s"} encerrado${totalEncerradas === 1 ? "" : "s"}`,
              dica: "Tarefa concluída, arquivada ou excluída",
              aoEscolher: () => setMostrarEncerradas((v) => !v),
            },
          ]}
        />
      ) : seletorDeVisao ? (
        <div className="mt-3 shrink-0">{seletorDeVisao}</div>
      ) : null}

      <div className="mt-4 flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        {aba !== "feito" && visao === "quadro" ? (
          quadro
        ) : (
          <RegiaoRolavel
            modo="lg"
            rotulo="Trabalho dos agentes"
            memoria={`execucao:${aba === "feito" ? "feito" : visao}`}
          >
            <div className="space-y-6 lg:pb-6 lg:pr-1">
              {aba === "feito" && <OQueFoiFeito />}
              {aba !== "feito" && conteudoDaVisao}
              {/* O espelho de "precisa de você": o que já saiu das suas mãos e agora
                  espera o agente. Sem isto, autorizar parecia concluir. */}
              {aba === "decisoes" && <OrdensAutorizadas />}
            </div>
          </RegiaoRolavel>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-w-0">
      <CabecalhoDePagina
        titulo="Execução"
        descricao={dataUpdatedAt ? `Atualizado ${dataCurta(new Date(dataUpdatedAt).toISOString())}` : "Aguardando a primeira leitura"}
        ajuda="Operadores internos executam e relatam; o responsável humano continua sendo quem responde. Feito só conta com evidência. A fila só anda com o Hermes ligado: o painel não dispara agente."
        acoes={
          <>
            {profile?.role === "admin" && (
              <button
                type="button"
                onClick={() => void reconciliarExecucoes()}
                disabled={reconciliando}
                title="Registra timeout de execuções sem sinal e encerra vínculos sem tarefa ativa. Preserva o histórico."
                aria-label="Reconciliar execuções"
                className={botao.secundario}
              >
                <Wrench className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">{reconciliando ? "Reconciliando…" : "Reconciliar"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void atualizarTudo()}
              disabled={atualizando}
              aria-label="Atualizar"
              className={botao.secundario}
            >
              <RefreshCw className={juntar("h-3.5 w-3.5 sm:mr-1.5", atualizando && "animate-spin")} aria-hidden="true" />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </>
        }
      />

      {((erroVinculos || erroRuns) || runsSemHeartbeat > 0 || (diasSemAgente !== null && diasSemAgente >= 2)) && (
        <div className="mt-3 space-y-2">
          {(erroVinculos || erroRuns) && (
            <EstadoDeErro
              titulo="Não foi possível ler parte da execução."
              descricao="Os dados exibidos podem estar desatualizados."
              acao={<button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void atualizarTudo()}>Tentar de novo</button>}
            />
          )}
          {runsSemHeartbeat > 0 && (
            <div className="flex items-center text-[12px] text-warning">
              <Clock className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{runsSemHeartbeat} execução(ões) sem sinal dentro do prazo</span>
              <AjudaRecolhida className="ml-1.5">
                O estado registrado aguarda reconciliação (Reconciliar, no alto da tela).
              </AjudaRecolhida>
            </div>
          )}
          {diasSemAgente !== null && diasSemAgente >= 2 && (
            <p className="flex items-center text-[12px] text-warning">
              <PauseCircle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Nenhum agente roda há {diasSemAgente} dias (último em {ultimoRunDosAgentes ? dataCurta(ultimoRunDosAgentes.toISOString()) : "?"})
            </p>
          )}
        </div>
      )}

      {/* Sistema de design (docs/design/SISTEMA.md, 4.3 e 8): no computador a
          área tem a altura da janela; o trabalho (abas e lista) rola de um lado
          e o resumo (atenção, incidentes e áreas) do outro, cada um por conta
          própria. O resumo é a lateral da AreaDeTrabalho: recolhe para o lado
          numa tirinha (lembrado em "execucao-resumo"). No celular a página rola
          normal e o resumo abre pelo botão de baixo, numa gaveta. */}
      <AreaDeTrabalho
        className="mt-5"
        principalRolavel={false}
        rotuloDoPrincipal="Trabalho dos agentes"
        memoria="execucao-resumo"
        rotuloDaLateral="Atenção"
        iconeDaLateral={<ListChecks className="h-4 w-4" />}
        lateral={
          <>
            <FecharResumo />
            <RegiaoRolavel modo="sempre" rotulo="Áreas e incidentes" memoria="execucao:areas" className="lg:pr-1">
              <div className="space-y-6 pb-4">
                <div aria-label="O que pede a sua atenção" role="group">
                  {atencao}
                </div>
                {areasEIncidentes}
              </div>
            </RegiaoRolavel>
          </>
        }
      >
        <section aria-label="Trabalho dos agentes" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {principal}
        </section>
      </AreaDeTrabalho>

      {menuEncaminhar && (
        <MenuDeContexto
          x={menuEncaminhar.x}
          y={menuEncaminhar.y}
          itens={[
            { rotulo: `Para quem vai "${menuEncaminhar.titulo.slice(0, 28)}"?` },
            { separador: true },
            ...operadores
              .filter((o) => o.status === "active")
              .map((o) => ({
                rotulo: o.display_name,
                atalho: o.area ?? undefined,
                acao: () => void encaminharParaAgente(
                  menuEncaminhar.tarefaId, o.slug, o.display_name,
                ),
              })),
          ]}
          aoFechar={() => setMenuEncaminhar(null)}
        />
      )}

      {menuCartao && (
        <MenuDeContexto
          x={menuCartao.x}
          y={menuCartao.y}
          itens={itensDoCartao(menuCartao.v)}
          aoFechar={() => setMenuCartao(null)}
        />
      )}

      <PerfilDoAgente
        operador={agenteAberto}
        vinculos={vinculos}
        tarefas={tarefas}
        aoFechar={() => setAgenteAberto(null)}
      />

      {/* O card do Kanban, aqui dentro: contexto, entrega e histórico sem
          sair da Execução. */}
      {tarefaAberta && (
        <TaskDetailDrawer
          task={tarefaAberta}
          teamMembers={equipe as any[]}
          projects={projetos as any[]}
          onClose={() => setTarefaAberta(null)}
        />
      )}

      <DefinirResponsavel
        taskId={responsavelAberto?.taskId ?? null}
        tituloDaTarefa={responsavelAberto?.titulo}
        responsavelAtual={responsavelAberto?.atual}
        aberto={Boolean(responsavelAberto)}
        aoFechar={() => setResponsavelAberto(null)}
      />

      <DiarioDaExecucao
        linkId={diarioAberto?.linkId ?? null}
        titulo={diarioAberto?.titulo}
        nomesDeAgentes={nomesDeAgentes}
        aberto={Boolean(diarioAberto)}
        aoFechar={() => setDiarioAberto(null)}
      />
    </div>
  );
}
