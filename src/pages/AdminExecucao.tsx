import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronRight, ClipboardCopy, Clock,
  FileCheck2, PauseCircle, RefreshCw, ShieldAlert, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import OrganogramaAgentes, { type NoDoOrganograma } from "@/components/execucao/OrganogramaAgentes";
import PerfilDoAgente from "@/components/execucao/PerfilDoAgente";
import DiarioDaExecucao from "@/components/execucao/DiarioDaExecucao";
import Escritorio from "@/components/execucao/Escritorio";
import DefinirResponsavel from "@/components/execucao/DefinirResponsavel";
import { falarComoGente } from "@/lib/falarComoGente";
import { precisaDecisao } from "@/lib/precisaDecisao";
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
  const [visao, setVisao] = useState<(typeof VISOES)[number]["id"]>("escritorio");
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("pessoas");
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
  const [diarioAberto, setDiarioAberto] = useState<{ linkId: string; titulo?: string } | null>(null);
  const [responsavelAberto, setResponsavelAberto] = useState<
    { taskId: string; titulo?: string; atual?: string | null } | null>(null);
  // Os filtros do centro de comando: 606 tarefas abertas nao cabem numa
  // lista sem recorte. Busca e livre; cliente e prazo sao os dois cortes
  // que o dono realmente usa para decidir onde olhar primeiro.
  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroPrazo, setFiltroPrazo] = useState<"todas" | "vencidas" | "semana">("todas");
  const queryClient = useQueryClient();
  const destacadoRef = useRef<HTMLDivElement | null>(null);
  const abasRef = useRef<Record<string, HTMLButtonElement | null>>({});

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
  const { data: flag } = useQuery({
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
      if (error) return [];
      return (data || []) as Operador[];
    },
    enabled: flag === "on",
  });

  const { data: vinculos = [], dataUpdatedAt } = useQuery({
    queryKey: ["operador-vinculos"],
    queryFn: async () => {
      // A leitura expira runs penduradas antes de mostrar: execução sem
      // heartbeat vira timeout VISÍVEL, nunca "em andamento" eterno.
      await (supabase as any).rpc("operator_expire_stale_runs");
      const { data, error } = await (supabase as any)
        .from("operator_task_links").select("*").order("updated_at", { ascending: false }).limit(300);
      if (error) return [];
      return (data || []) as Vinculo[];
    },
    enabled: flag === "on",
    refetchInterval: 30_000,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["operador-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_runs")
        .select("id, operator_id, run_key, task_link_id, status, attempt, started_at, heartbeat_at, finished_at, error")
        .order("started_at", { ascending: false }).limit(200);
      if (error) return [];
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
  const { data: tarefas = new Map() } = useQuery({
    queryKey: ["operador-tarefas", taskIds.join(",")],
    queryFn: async () => {
      if (taskIds.length === 0) return new Map();
      // FK nomeada: projects aponta para profiles por client_id E por
      // created_by, e sem escolher o caminho a consulta inteira e recusada.
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select("id, title, due_date, assigned_to, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))")
        .in("id", taskIds);
      // Erro nao vira mapa vazio: um mapa vazio faz a tela desenhar tarefa
      // sem projeto nem cliente, como se o dado nao existisse.
      if (error) throw new Error(error.message);
      const mapa = new Map<string, any>();
      for (const t of data || []) mapa.set(String(t.id), t);
      return mapa;
    },
    enabled: flag === "on" && taskIds.length > 0,
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
  const numeros = useMemo(() => {
    const por = (st: string) => vinculos.filter((v) => v.status === st).length;
    const comOperador = new Set(vinculos.map((v) => v.kanban_task_id).filter(Boolean));
    const semOperador = disponiveis.filter((t) => !comOperador.has(String(t.id)));
    return {
      fila: por("queued") + por("in_progress"),
      andamento: por("in_progress"),
      feitas: vinculos.filter((v) => v.status === "done" && v.last_evidence).length,
      revisao: por("review"),
      aguardando: por("awaiting_input"),
      bloqueadas: por("blocked"),
      aprovacoes: vinculos.filter((v) => precisaDecisao(v)).length,
      kanbanAbertas: disponiveis.length,
      semOperador,
      // Prazo estourado é a única contagem que vale por si: ela decide o dia.
      vencidas: vinculos.filter((v) => {
        const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
        return t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
      }).length,
    };
  }, [vinculos, disponiveis, tarefas, hoje]);

  const numerosDoOperador = (operatorId: string) => {
    const meus = vinculos.filter((v) => v.operator_id === operatorId);
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
    const conta = (fn: (v: Vinculo) => boolean) => vinculos.filter(fn).length;
    return {
      quadro: vinculos.length,
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
  }, [vinculos, operadores]);

  /**
   * Quando a visao muda sozinha (notificacao apontando para um vinculo), a
   * aba escolhida pode estar fora da faixa visivel no telefone. Trazer ela
   * para a tela evita a impressao de que nada aconteceu ao tocar no aviso.
   */
  useEffect(() => {
    abasRef.current[visao]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [visao]);

  // O filtro roda ANTES das visoes: quadro, fila e listas enxergam o
  // mesmo recorte, senao o numero da aba discorda do conteudo dela.
  const vinculosVisiveis = useMemo(() => {
    if (!busca.trim() && !filtroCliente && filtroPrazo === "todas") return vinculos;
    return vinculos.filter((v) => {
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
  }, [vinculos, tarefas, busca, filtroCliente, filtroPrazo, hoje]);

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
  useEffect(() => {
    const dona = ABAS.find((a) => (a.visoes as readonly string[]).includes(visao));
    if (dona && dona.id !== aba) setAba(dona.id);
  }, [visao]);

  const irParaAba = (id: (typeof ABAS)[number]["id"]) => {
    setAba(id);
    const primeira = ABAS.find((a) => a.id === id)?.visoes[0];
    if (primeira) setVisao(primeira as (typeof VISOES)[number]["id"]);
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
    const emRevisao = vinculos.filter((v) => v.status === "review");
    const aguardando = vinculos.filter((v) => v.status === "awaiting_input");
    const bloqueadas = vinculos.filter((v) => v.status === "blocked");
    const andamento = vinculos.filter((v) => v.status === "in_progress");
    const prazoCritico = vinculos.filter((v) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      return t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
    });

    const abertura = [
      `ABERTURA · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Em andamento", andamento),
      bloco("Na fila", vinculos.filter((v) => v.status === "queued")),
      bloco("Aguardando insumo", aguardando),
    ].join("\n\n");

    const excecoes = [
      `EXCECOES · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Bloqueadas", bloqueadas),
      bloco("Prazo critico (vence hoje ou venceu)", prazoCritico),
      bloco("Aprovacoes pendentes", vinculos.filter((v) => precisaDecisao(v))),
      incidentes.length
        ? `Falhas de execucao (${incidentes.length})\n` + incidentes.slice(0, 10).map((r) =>
            `- ${opDe(String(r.operator_id))?.display_name || "?"} · run ${r.run_key} · ${r.status}${r.error ? " · " + r.error : ""}`,
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
  }, [vinculos, runs, incidentes, tarefas, humanos, operadores, hoje]);


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
      toast.success("Quadro atualizado.");
    } finally {
      setAtualizando(false);
    }
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
      itens.push({ rotulo: "Copiar ID da tarefa", acao: () => void copiar(String(v.kanban_task_id), "ID") });
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
    [operadores, vinculos],
  );

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }
  if (flag === "off") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        A camada de operadores está <strong>desligada</strong> (flag <code>operators_layer</code>).
        Nada foi apagado; religar a flag traz tudo de volta.
      </div>
    );
  }
  if (flag === "erro") {
    // A distinção que faltava: não é "desligada", é "não consegui ler".
    return (
      <div className="mx-auto max-w-lg p-6">
        <p className="text-sm font-medium text-foreground">Não consegui ler a configuração desta área.</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Isso não quer dizer que ela esteja desligada. Costuma acontecer nos primeiros minutos
          depois que as tabelas nascem, enquanto a API ainda não as enxerga. Recarregue em
          instantes; se persistir, confira se a migration dos operadores foi aplicada.
        </p>
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
        className={cn(
          "cursor-pointer rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/50",
          destacado ? "border-primary ring-2 ring-primary/40" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              {t?.title || v.last_action || "(sem tarefa vinculada)"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {[cliente ? (cliente.company_name || cliente.full_name) : null, t?.project?.name]
                .filter(Boolean).join(" · ") || "sem projeto"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {/* ORIGEM: isso depende de mim? CATEGORIA: que trabalho e este?
                Sao os dois badges que faltavam para "em revisao" nao
                parecer "arte final publicada". */}
            {(() => {
              const origem = origemDaExecucao(v);
              return origem !== "interno" && (
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  origem === "aguardando_almir" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive",
                )}>
                  {ROTULO_ORIGEM[origem]}
                </span>
              );
            })()}
            {(() => {
              const cat = categoriaDaTarefa(t?.title);
              return cat !== "geral" && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {ROTULO_CATEGORIA[cat]}
                </span>
              );
            })()}
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              v.status === "done" ? "bg-success/15 text-success"
                : v.status === "blocked" ? "bg-destructive/15 text-destructive"
                : v.status === "review" ? "bg-warning/15 text-warning"
                : "bg-secondary text-muted-foreground",
            )}>
              {STATUS_ROTULO[v.status] || v.status}
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3 w-3" /> {op?.display_name || "?"}
          </span>
          <span>
            humano: <span className="font-medium text-foreground/80">
              {t?.assigned_to ? humanos.get(String(t.assigned_to)) || "?" : "sem responsável"}
            </span>
          </span>
          {t?.due_date && (
            <span className={cn("inline-flex items-center gap-1", prazoVencido && "font-semibold text-destructive")}>
              <Clock className="h-3 w-3" /> {t.due_date}
            </span>
          )}
          <span>{dataCurta(v.updated_at)}</span>
        </div>

        {v.last_action && (
          <p className="mt-1.5 text-[11.5px] text-foreground/85">
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
            <summary className="cursor-pointer list-none text-[11px] text-muted-foreground marker:hidden">
              <span className="break-words">
                {v.last_evidence.startsWith("http")
                  ? <a className="break-all text-primary underline" href={v.last_evidence} target="_blank" rel="noopener noreferrer">{v.last_evidence}</a>
                  : ev.humano}
              </span>
              {ev.temDetalheTecnico && (
                <span className="ml-1 whitespace-nowrap text-[10px] text-primary/70 underline">
                  detalhe técnico
                </span>
              )}
            </summary>
            {ev.temDetalheTecnico && (
              <p className="mt-1 break-all rounded-lg bg-secondary/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {ev.original}
              </p>
            )}
          </details>
          );
        })()}
        {v.next_step && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            próximo passo: {falarComoGente(v.next_step).humano}
          </p>
        )}
        {v.block_reason && (
          <p className="mt-1 rounded-lg border border-destructive/25 bg-secondary px-2 py-1 text-[11px] text-destructive">
            bloqueio: {falarComoGente(v.block_reason).humano}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {precisaDecisao(v) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVisao("aprovacao"); }}
              className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-semibold text-warning hover:bg-warning/25"
            >
              <ShieldAlert className="h-3 w-3" /> aprovação necessária — decidir
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDiarioAberto({ linkId: v.id, titulo: t?.title || v.last_action || undefined }); }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
            title="Conversar com o agente nesta execução: instrução, contexto, correção"
          >
            diário
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
        <h1 className="text-lg font-bold text-foreground">Execução da equipe</h1>
        <p className="text-[12px] text-muted-foreground">
          Operadores internos executam e relatam; o responsável humano continua sendo quem responde.
          Atualizado {dataCurta(new Date(dataUpdatedAt || Date.now()).toISOString())}.
        </p>
        </div>
        <button
          type="button"
          onClick={() => void atualizarTudo()}
          disabled={atualizando}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", atualizando && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {/* O placar do dia: o que decide a atenção, em números. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {[
          { rotulo: "Em andamento", valor: numeros.andamento, tom: "text-info" },
          { rotulo: "Feitas com evidência", valor: numeros.feitas, tom: "text-success" },
          { rotulo: "Em revisão", valor: numeros.revisao, tom: "text-warning" },
          { rotulo: "Aguardando insumo", valor: numeros.aguardando, tom: "text-muted-foreground" },
          { rotulo: "Bloqueadas", valor: numeros.bloqueadas, tom: "text-destructive" },
          { rotulo: "Prazo estourado", valor: numeros.vencidas, tom: "text-destructive" },
        ].map((k) => (
          <div key={k.rotulo} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className={cn("text-[19px] font-bold tabular-nums leading-none", k.valor > 0 ? k.tom : "text-muted-foreground/50")}>
              {k.valor}
            </p>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{k.rotulo}</p>
          </div>
        ))}
      </div>

      {/* A ponte com o Kanban.
          Com o Kanban vazio, a versão anterior escrevia "0 tarefas abertas
          · 0 com operador · 0 ainda sem": três zeros dizendo a mesma coisa
          e ocupando uma faixa inteira. Nada para ler não merece o mesmo
          espaço que algo para fazer. */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
        <p className="text-[12px] text-foreground">
          {numeros.kanbanAbertas === 0 ? (
            <span className="text-muted-foreground">
              Nenhuma tarefa aberta no Kanban agora. Quando houver, ela aparece aqui
              para encaminhar a um agente.
            </span>
          ) : (
            <>
              <strong className="tabular-nums">{numeros.kanbanAbertas}</strong>{" "}
              {numeros.kanbanAbertas === 1 ? "tarefa aberta" : "tarefas abertas"} no Kanban ·{" "}
              <strong className="tabular-nums">{numeros.kanbanAbertas - numeros.semOperador.length}</strong> com operador ·{" "}
              <strong className="tabular-nums">{numeros.semOperador.length}</strong> ainda sem
            </>
          )}
          {numeros.aprovacoes > 0 && (
            <> · <span className="font-semibold text-warning">{numeros.aprovacoes} esperando sua aprovação</span></>
          )}
        </p>
      </div>

      {/* AS AREAS COMO FAIXA, e nao como pilha.
          Minha versao anterior recolhia cada area numa barra de largura
          inteira: nove barras quase vazias empilhadas, que polui mais do
          que o problema que eu tinha ido resolver. Recolhido nao pode
          ocupar o mesmo espaco que aberto.
          Agora fechada e uma pastilha, e as nove cabem em duas linhas.
          Aberta vira bloco, logo abaixo. */}
      <div className="flex flex-wrap items-center gap-1.5">
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
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                aberta
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {/* O ponto so aparece onde HA movimento: pintar todas faria a
                  cor deixar de significar alguma coisa. */}
              {temMovimento && (
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  bloqueadas > 0 ? "bg-destructive" : emAndamento > 0 ? "bg-info" : "bg-success",
                )} aria-hidden />
              )}
              {area}
              <span className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                aberta ? "bg-primary/20" : "bg-muted",
              )}>
                {doGrupo.length}
              </span>
            </button>
          );
        })}

        {agrupadosPorArea.length > 1 && (
          <button
            type="button"
            onClick={() => alternarArea("", agrupadosPorArea.map(([a]) => a))}
            className="ml-auto text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {agrupadosPorArea.every(([a]) => estaFechada(a)) ? "abrir todas" : "fechar todas"}
          </button>
        )}
      </div>

      {/* So as areas ABERTAS viram bloco. Fechada ja disse o que tinha a
          dizer na pastilha acima. */}
      {agrupadosPorArea.filter(([area]) => !estaFechada(area)).map(([area, doGrupo]) => (
        <section key={area} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary px-3 py-2">
            <span className="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
            <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground">{area}</h3>
            {(() => {
              const emAndamento = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).andamento, 0);
              const feitas = doGrupo.reduce((t, o) => t + numerosDoOperador(o.id).feitas, 0);
              return (
                <span className="ml-auto flex gap-2.5 text-[9.5px] tabular-nums">
                  {emAndamento > 0 && <span className="text-info">{emAndamento} em andamento</span>}
                  {feitas > 0 && <span className="text-success">{feitas} feitas</span>}
                </span>
              );
            })()}
            <button
              type="button"
              onClick={() => alternarArea(area)}
              className="rounded-md px-1.5 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              fechar
            </button>
          </div>
          <div className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {doGrupo.map((o) => {
              const n = numerosDoOperador(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setAgenteAberto(o)}
                  className="rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                    <p className="text-[12.5px] font-semibold text-foreground">{o.display_name}</p>
                    {o.is_coordinator && (
                      <span className="rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">coordenador</span>
                    )}
                    <span className={cn(
                      "ml-auto h-2 w-2 rounded-full",
                      o.status === "active" ? "bg-success" : "bg-muted-foreground/40",
                    )} />
                  </div>
                  <p className="mt-0.5 text-[10px] font-medium text-foreground/80">{o.role}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">{o.scope}</p>
                  {o.parent_slug && (
                    <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground/80">
                      responde a {operadores.find((p) => p.slug === o.parent_slug)?.display_name ?? o.parent_slug}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]">
                    {n.total === 0 ? (
                      <span className="text-muted-foreground/70">nenhuma tarefa ainda</span>
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
                  </div>
                  <p className="mt-1 text-[9.5px] text-muted-foreground">
                    {o.last_run_at ? `última execução ${dataCurta(o.last_run_at)}` : "sem execução ainda"}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {incidentes.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-secondary p-3">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {incidentes.length} incidente(s) de execução
          </p>
          <div className="mt-1 space-y-0.5">
            {incidentes.slice(0, 5).map((r) => (
              <p key={String(r.id)} className="text-[11px] text-muted-foreground">
                {opDe(String(r.operator_id))?.display_name || "?"} · run {String(r.run_key)} · {String(r.status)}
                {r.error ? ` · ${String(r.error)}` : ""} {r.attempt > 1 ? ` · tentativa ${r.attempt}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* A barra de recorte: busca, cliente e prazo. Aplica antes das
          visoes para numero e conteudo nunca discordarem. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar tarefa, cliente, projeto ou agente…"
          className="h-8 w-full max-w-xs rounded-lg border border-border bg-card px-2.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/60"
        />
        <select
          value={filtroCliente}
          onChange={(e) => setFiltroCliente(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground"
        >
          <option value="">todos os clientes</option>
          {clientesDoQuadro.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filtroPrazo}
          onChange={(e) => setFiltroPrazo(e.target.value as typeof filtroPrazo)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground"
        >
          <option value="todas">qualquer prazo</option>
          <option value="vencidas">vencidas</option>
          <option value="semana">próximos 7 dias</option>
        </select>
        {(busca || filtroCliente || filtroPrazo !== "todas") && (
          <button
            type="button"
            onClick={() => { setBusca(""); setFiltroCliente(""); setFiltroPrazo("todas"); }}
            className="text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            limpar ({vinculosVisiveis.length}/{vinculos.length})
          </button>
        )}
      </div>

      {/* AS ABAS: separam por pergunta, e ficam acima de tudo. */}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-0 scrollbar-hidden">
        {ABAS.map((x) => {
          const ativa = aba === x.id;
          // A aba "O que foi feito" nao tem visao nenhuma, e uma lista vazia
          // faz o TypeScript inferir never[]. O tipo explicito resolve sem
          // obrigar a aba a inventar uma visao que ela nao tem.
          const quantos = (x.visoes as readonly string[])
            .reduce((s, id) => s + (contagemDaVisao[id] ?? 0), 0);
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => irParaAba(x.id)}
              className={cn(
                "relative shrink-0 px-3 pb-2 pt-1 text-[13px] font-semibold transition-colors",
                ativa ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {x.rotulo}
              {quantos > 0 && (
                <span className={cn(
                  "ml-1.5 rounded-full px-1.5 text-[10px] tabular-nums",
                  ativa ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {quantos}
                </span>
              )}
              {ativa && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* No telefone as dez visoes empilhavam em cinco fileiras e comiam a
          tela antes do conteudo comecar. Vira faixa que corre para o lado,
          e volta a quebrar em linhas no desktop, onde ha largura de sobra.
          Mesmo padrao da Central, para as duas areas se comportarem igual. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        {visoesDaAba.map((x) => {
          const quantos = contagemDaVisao[x.id] ?? null;
          return (
            <button
              key={x.id}
              type="button"
              ref={(el) => { abasRef.current[x.id] = el; }}
              onClick={() => setVisao(x.id)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-colors",
                visao === x.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {x.rotulo}
              {quantos !== null && quantos > 0 && (
                <span className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  visao === x.id ? "bg-primary/15" : "bg-muted",
                )}>
                  {quantos}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visao === "escritorio" ? (
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
      ) : visao === "quadro" ? (
        /* O quadro: colunas com ROLAGEM PRÓPRIA. Sem isso, uma coluna
           cheia empurra a página inteira e as outras somem de vista. */
        <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
          {COLUNAS.map((c) => {
            const daColuna = vinculosVisiveis.filter((v) => v.status === c.id);
            return (
              <div key={c.id} className="flex w-[250px] shrink-0 flex-col rounded-xl border border-border bg-card/60 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", c.cor)} />
                  <p className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">{c.titulo}</p>
                  <span className="ml-auto shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                    {daColuna.length}
                  </span>
                </div>
                <div className="mt-2 max-h-[62vh] space-y-1.5 overflow-y-auto pr-0.5">
                  {daColuna.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-2 py-4 text-center text-[10px] text-muted-foreground">
                      vazia
                    </p>
                  ) : (
                    daColuna.map((v) => <Cartao key={v.id} v={v} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { titulo: "Abertura do dia", texto: relatorio.abertura, icone: Activity },
            { titulo: "Checkpoint de exceções", texto: relatorio.excecoes, icone: AlertTriangle },
            { titulo: "Fechamento do dia", texto: relatorio.fechamento, icone: CheckCircle2 },
            { titulo: "Semana do piloto", texto: relatorio.semanal, icone: FileCheck2 },
          ].map((r) => (
            <div key={r.titulo} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between">
                <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                  <r.icone className="h-3.5 w-3.5 text-primary" /> {r.titulo}
                </p>
                <button
                  type="button"
                  onClick={() => void copiar(r.texto, r.titulo)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ClipboardCopy className="h-3 w-3" /> Copiar
                </button>
              </div>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-muted-foreground">
                {r.texto}
              </pre>
            </div>
          ))}
        </div>
      ) : visao === "fila" ? (
        <div className="space-y-4">
          {operadores.filter((o) => !o.is_coordinator).map((o) => {
            const doOperador = filtrados.filter((v) => v.operator_id === o.id);
            return (
              <div key={o.id}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {o.display_name} · {doOperador.length} na fila
                </p>
                {doOperador.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                    {o.display_name} ainda não pegou nenhuma tarefa.
                    {numeros.semOperador.length > 0 && ` Há ${numeros.semOperador.length} esperando alguém.`}
                  </p>
                ) : (
                  <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">{doOperador.map((v) => <Cartao key={v.id} v={v} />)}</div>
                )}
              </div>
            );
          })}

          {/* Esperando alguém: as tarefas reais do Kanban sem operador, com
              o id pronto para copiar. É o que transforma "está vazio" em
              "comece por aqui" — e o que o Hermes precisa para escolher uma
              tarefa de verdade em vez de inventar. */}
          {numeros.semOperador.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Esperando um operador · {numeros.semOperador.length} no Kanban
              </p>
              <div className="space-y-1">
                {numeros.semOperador.slice(0, 8).map((t) => {
                  const cliente = t.project?.client;
                  const vencida = t.due_date && String(t.due_date) <= hoje;
                  return (
                    <div key={String(t.id)} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] text-foreground">{t.title}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {[cliente ? (cliente.company_name || cliente.full_name) : null, t.project?.name]
                            .filter(Boolean).join(" · ") || "sem projeto"}
                          {t.due_date && (
                            <span className={cn("ml-1", vencida && "font-semibold text-destructive")}>
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
                        className="shrink-0 rounded-lg border border-primary/40 bg-secondary px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10"
                      >
                        encaminhar
                      </button>
                    </div>
                  );
                })}
                {numeros.semOperador.length > 8 && (
                  <p className="text-[10px] text-muted-foreground">
                    e mais {numeros.semOperador.length - 8} no Kanban.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : visao === "aprovacao" ? (
        <div className="space-y-4">
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
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Vínculos marcados com o selo · {filtrados.length}
              </p>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">{filtrados.map((v) => <Cartao key={v.id} v={v} />)}</div>
            </div>
          )}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <PauseCircle className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-1 text-[12px] text-muted-foreground">
            Nada em <strong>{VISOES.find((x) => x.id === visao)?.rotulo.toLowerCase()}</strong> agora.
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {numeros.andamento > 0
              ? `${numeros.andamento} tarefa(s) em andamento em outra visão.`
              : `${numeros.kanbanAbertas} tarefas abertas no Kanban esperando execução.`}
          </p>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">{filtrados.map((v) => <Cartao key={v.id} v={v} />)}</div>
      )}

      {visao === "done" && filtrados.some((v) => !v.last_evidence) && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-secondary px-2.5 py-1.5 text-[11px] text-warning">
          <XCircle className="h-3.5 w-3.5" />
          Concluída sem evidência não deveria existir aqui: o banco rebaixa para revisão na gravação.
        </p>
      )}

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

      {/* O espelho de "precisa de você": o que já saiu das suas mãos e agora
          espera o agente. Sem isto, autorizar parecia concluir. */}
      {aba === "decisoes" && <OrdensAutorizadas />}
      {aba === "feito" && <OQueFoiFeito />}

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
