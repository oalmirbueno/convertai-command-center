import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, BarChart3, Brain, CalendarDays, Check, ChevronLeft, ChevronRight,
  ChevronRight as Caret, Columns3, DollarSign, ExternalLink, FileArchive,
  HeartPulse, LayoutDashboard, ListChecks, Megaphone, Menu, RefreshCw, Share2,
  Smartphone, Sparkles, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService, isInternalClient } from "@/lib/clientFlags";
import { etapasDoServico, servicosDoCliente } from "@/lib/servicosCliente";
import { entregaConcluida, listEtapasDeVarios, marcarEtapa } from "@/lib/entregaAvulsa";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { extraAreas, inCycle, setCycleExtra } from "@/lib/cycleExtras";
import { apagarRegistroDoCiclo, recordMemory } from "@/lib/clientMemory";
import { provaDaEtapa } from "@/lib/cycleEvidencia";
import {
  PHASE_LABELS, phaseForClient, stepLabelForWeek, stepLabelsForWeek, stepsForWeek,
  type StepsOptions,
} from "@/lib/cycleTasks";
import { lerSituacoes } from "@/lib/cycleSituation";
import { lerVendasDaSemana, leituraDasCompras, registrarVendas } from "@/lib/cycleVendas";
import { lerSituacaoDosAvulsos, pendenciasDoAvulso } from "@/lib/cycleAvulsos";
import { fatosDoPainel } from "@/lib/cycleRitual";
import { AO_VIVO_CALMO } from "@/lib/consultaAoVivo";
import { congelarPlano, lerPlanoAnterior, lerPlanosDaSemana, substituirPlano } from "@/lib/cycleWeekPlan";
import { etapasPorSlot } from "@/lib/cycleSuggest";
import { ROTATING_SLOTS, stepsForWeek as etapasDoSorteio } from "@/lib/cycleTasks";
import {
  evidenciasDe, jornadaDaEntrada, ondeEstaNaEntrada, type EtapaDaJornada,
} from "@/lib/cycleJourney";
import {
  acoesDoDia, leituraDaCarteira, ordenarPelaUrgencia, pendenciasDoCliente,
  pendenciasVisiveis,
  textoDaEtapa,
  type Pendencia,
} from "@/lib/cycleSuggest";
import { usePwaProfile, useStandalone } from "@/hooks/usePwaProfile";
import { useNow } from "@/hooks/useNow";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import ClientCycleSheet from "@/components/ciclo/ClientCycleSheet";
import {
  CYCLES, FRENTES_DA_SEMANA, HISTORY_WEEKS, ONBOARDING_STEPS, type CycleArea,
} from "@/lib/cycleDefs";
import {
  WEEKDAY_INITIALS, addDays, closedStreak, isSameDay, localIso, mondayOf,
  weekDays, weekLabel,
} from "@/lib/cycleWeek";

// O Ciclo é um aplicativo à parte, instalável pelo próprio /ciclo. A tela tem
// a altura exata do aparelho: topo fixo com a semana, uma única área que rola
// (a carteira) e a barra de baixo com as duas frentes.
//
// Duas regras de estabilidade, porque a tela é usada com o polegar:
//  • a ordem dos clientes é congelada enquanto a semana está sendo trabalhada
//    (marcar uma etapa nunca faz o card pular de lugar);
//  • cada linha tem altura e largura reservadas, então nada dança quando o
//    número muda de 3/6 para 10/10.

const AREA_STORAGE_KEY = "aceleriq-ciclo-area";

// As três frentes moram em cycleDefs: card e folha mostram as MESMAS
// filas, e em dois lugares uma divergiria da outra no primeiro conserto.

const MENU_LINKS = [
  { title: "Painel", url: "/dashboard", icon: LayoutDashboard },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Central de Experiência", url: "/central", icon: HeartPulse },
  { title: "Métricas", url: "/metricas", icon: BarChart3 },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Arquivos", url: "/arquivos", icon: FileArchive },
];

interface CycleRow {
  id: string;
  client_id: string;
  area: string;
  week_start: string;
  step: number;
  done_at?: string | null;
  done_by?: string | null;
}

const shortDate = (date: Date) =>
  date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const hourOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

export default function AdminCiclo() {
  const { user, profile } = useAuth();
  const canWrite = ["admin", "manager"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const queryClient = useQueryClient();

  usePwaProfile({
    manifestHref: "/ciclo.webmanifest",
    appleTitle: "Ciclo",
    appleIcon: "/ciclo-apple-touch-icon.png",
  });
  const standalone = useStandalone();
  const today = useNow();

  const [area, setArea] = useState<CycleArea>(() => {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem(AREA_STORAGE_KEY);
    return saved === "trafego" ? "trafego" : "social";
  });
  // A aba de avulsos convive com a frente escolhida em vez de substituí-la:
  // ao voltar para Social ou Tráfego, a frente anterior continua valendo.
  const [avulsosAbertos, setAvulsosAbertos] = useState(false);
  // Qual serviço está sendo olhado na aba de avulsos. Nulo = todos.
  const [servicoAvulso, setServicoAvulso] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(AREA_STORAGE_KEY, area); } catch { /* sem cache */ }
  }, [area]);

  // O topo tem altura variável (semana, dias, progresso). Medindo o header de
  // verdade, a área de conteúdo começa exatamente onde ele termina, sem número
  // chutado que descole em algum aparelho.
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState(168);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const medir = () => setHeaderH(node.getBoundingClientRect().height);
    medir();

    // Navegador sem ResizeObserver (versões antigas) continua funcionando com
    // a medida inicial mais o reajuste ao girar a tela.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", medir);
      return () => window.removeEventListener("resize", medir);
    }
    const observer = new ResizeObserver(medir);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const realMonday = useMemo(() => mondayOf(today), [today]);
  const weekStart = useMemo(() => addDays(realMonday, weekOffset * 7), [realMonday, weekOffset]);
  const weekKey = localIso(weekStart);
  const isCurrentWeek = weekOffset === 0;

  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;

  /**
   * Quem aparece na lista, e por quê.
   *
   * O ciclo semanal é rotina de quem tem contrato correndo. Cliente avulso
   * (client_type one_off) não tem semana que se repete — tem uma entrega com
   * começo e fim —, então misturá-lo na mesma lista faria a contagem
   * "3/6 desta semana" mentir para os dois lados.
   *
   * Por isso ele ganhou aba própria, em vez de continuar invisível: eram seis
   * clientes ativos que simplesmente não existiam nesta tela.
   */
  const ehAvulso = (client: any) => (client.client_type || "recurring") === "one_off";

  /**
   * A empresa do grupo TRABALHA, então aparece na operação.
   *
   * A flag de empresa interna existe para tirar de COBRANÇA — MRR, alerta de
   * atraso, pendência de plano. Ela estava também escondendo essas empresas
   * do ciclo, e o efeito era concreto: Jalimpo, Stop Informática e AcelerIQ
   * tinham social e tráfego marcados no cadastro e não apareciam em frente
   * nenhuma. As duas abas mostravam os mesmos cinco clientes, e o dono via
   * uma tela que não continha o trabalho que ele estava fazendo.
   *
   * Quem esconde de cobrança é o financeiro; aqui a régua é só se há trabalho.
   */
  const activeClients = useMemo(
    () =>
      ((clients || []) as any[]).filter((client) => {
        if ((client.plan_status || "active") !== "active") return false;
        if (avulsosAbertos) {
          if (!ehAvulso(client)) return false;
          // Entrega dada por concluida sai da lista de trabalho: ela vive no
          // historico do cliente e na gaveta de concluidos em Clientes.
          if (entregaConcluida(client)) return false;
          // Cliente avulso costuma ter mais de um serviço (site e design, por
          // exemplo), então ele aparece em cada um deles — não é uma gaveta só.
          return !servicoAvulso || servicosDoCliente(client).includes(servicoAvulso);
        }
        return !ehAvulso(client) && inCycle(client, area, hasService);
      }),
    [clients, area, avulsosAbertos, servicoAvulso],
  );

  /**
   * A situação REAL de cada cliente, lida do painel.
   *
   * O ciclo era cego: sorteava tarefas sem saber se havia arte pronta,
   * agenda vazia ou aprovação parada. Uma consulta por tabela para a
   * carteira inteira — por cliente seriam dezenas de idas por abertura.
   */
  const idsNoCiclo = useMemo(
    () => activeClients.map((c: any) => String(c.id)).sort(),
    [activeClients],
  );
  const { data: situacoes } = useQuery({
    queryKey: ["ciclo-situacao", idsNoCiclo.join(",")],
    queryFn: () => lerSituacoes(idsNoCiclo),
    enabled: idsNoCiclo.length > 0 && !avulsosAbertos,
    staleTime: 30_000,
    // O Ciclo é cockpit: o mundo muda por fora (o robô publica, o cliente
    // aprova) e a pendência tem que SUMIR sozinha quando o fato acontecer.
    // Aviso que fica depois de resolvido ensina a ignorar avisos.
    ...AO_VIVO_CALMO,
  });

  /**
   * O número que fecha o funil não existe em API nenhuma: quem sabe se o
   * lead virou venda é o dono, no WhatsApp. Aqui é onde ele marca.
   */
  const { data: vendas } = useQuery({
    queryKey: ["ciclo-vendas", idsNoCiclo.join(","), weekKey],
    queryFn: () => lerVendasDaSemana(idsNoCiclo, weekKey),
    enabled: idsNoCiclo.length > 0 && area === "trafego" && !avulsosAbertos,
  });
  const [salvandoVenda, setSalvandoVenda] = useState<string | null>(null);

  const marcarCompra = async (clientId: string, delta: number) => {
    const atual = vendas?.get(clientId) ?? { id: null, compras: 0 };
    const proximo = Math.max(0, atual.compras + delta);
    if (proximo === atual.compras) return;
    setSalvandoVenda(clientId);
    const salvo = await registrarVendas({
      clientId, weekStart: weekKey, compras: proximo, registroId: atual.id,
    });
    if (salvo) {
      await queryClient.invalidateQueries({ queryKey: ["ciclo-vendas"] });
    } else {
      toast.error("Não foi possível registrar a compra.");
    }
    setSalvandoVenda(null);
  };

  /**
   * O plano congelado da semana: as quatro etapas que giram, escolhidas da
   * REALIDADE no momento em que a semana começa a ser trabalhada.
   * Congeladas porque a marcação guarda só o número da etapa — rótulo que
   * muda no meio da semana faria o histórico mentir.
   */
  const { data: planos } = useQuery({
    queryKey: ["ciclo-planos", idsNoCiclo.join(","), area, weekKey],
    queryFn: () => lerPlanosDaSemana(idsNoCiclo, area, weekKey),
    enabled: idsNoCiclo.length > 0 && !avulsosAbertos,
  });
  const { data: planosAnteriores } = useQuery({
    queryKey: ["ciclo-planos-anteriores", idsNoCiclo.join(","), area, weekKey],
    queryFn: () => lerPlanoAnterior(idsNoCiclo, area, localIso(addDays(weekStart, -7))),
    enabled: idsNoCiclo.length > 0 && !avulsosAbertos,
  });

  /**
   * Duas listas, de propósito.
   *
   * REAIS: tudo que o painel acusa. É o que monta a semana e o que prova a
   * etapa — pendência encaminhada para o Kanban saiu do alerta, mas não foi
   * resolvida, e dá-la por feita seria o falso positivo de sempre.
   *
   * VISÍVEIS: o que ainda merece o vermelho na tela. O que virou tarefa
   * sai daqui: "senão fica um monte de vermelho".
   */
  const pendenciasReaisPorCliente = useMemo(() => {
    const mapa = new Map<string, Pendencia[]>();
    if (!situacoes) return mapa;
    for (const client of activeClients as any[]) {
      const s = situacoes.get(String(client.id));
      if (s) mapa.set(String(client.id), pendenciasDoCliente(s, area));
    }
    return mapa;
  }, [situacoes, activeClients, area]);

  const pendenciasPorCliente = useMemo(() => {
    const mapa = new Map<string, Pendencia[]>();
    for (const [id, lista] of pendenciasReaisPorCliente) {
      const s = situacoes?.get(id);
      mapa.set(id, pendenciasVisiveis(lista, s?.pendenciasEncaminhadas));
    }
    return mapa;
  }, [pendenciasReaisPorCliente, situacoes]);

  /**
   * A jornada de entrada, só para quem ainda está entrando. Sai da
   * situação real e dos serviços contratados — nunca de caixinha marcada.
   */
  const jornadaDe = (client: any): EtapaDaJornada[] | null => {
    const s = situacoes?.get(String(client.id));
    if (!s) return null;
    const servicos = client.services_config || {};
    return jornadaDaEntrada(
      evidenciasDe({
        situacao: s,
        briefingRespondido: s.briefingRespondido,
        contaSocialConectada: s.contaSocialConectada,
        contaAdsConectada: s.contaAdsConectada,
        temDossie: s.temDossie,
      }),
      {
        social: servicos.social === true || area === "social",
        trafego: servicos.trafego === true,
      },
    );
  };

  /**
   * Congela o plano de quem ainda não tem, uma vez por sessão.
   *
   * A pendência real ocupa a etapa; o acervo (o sorteio antigo) só
   * preenche o que sobrar, sem repetir a semana anterior. É a ligação que
   * faltava: o motor de contexto existia e o checklist seguia cego.
   */
  const congeladosRef = useRef(new Set<string>());
  useEffect(() => {
    if (!situacoes || !planos || !planosAnteriores || avulsosAbertos) return;
    (async () => {
      let algum = false;
      for (const client of activeClients as any[]) {
        const id = String(client.id);
        const chave = `${id}:${area}:${weekKey}`;
        if (congeladosRef.current.has(chave)) continue;
        const pend = pendenciasReaisPorCliente.get(id);
        if (!pend) continue;
        const acervoPorSlot: Record<number, string> = {};
        for (const slot of etapasDoSorteio(area, id, weekKey, stepOptionsFor(client))) {
          if (!slot.fixed) acervoPorSlot[slot.step] = slot.label;
        }
        // Cada pendência cai no slot da FRENTE dela: agendar em
        // Publicação, arte em Produção, diário em Painel — a etapa certa
        // na fila errada lia como bagunça.
        const etapas = etapasPorSlot({
          pendencias: pend,
          acervoPorSlot,
          usadasAntes: planosAnteriores.get(id) || [],
          slots: ROTATING_SLOTS,
        });
        const existente = planos.get(id);
        if (!existente) {
          congeladosRef.current.add(chave);
          if (await congelarPlano({ clientId: id, area, weekStart: weekKey, etapas })) {
            algum = true;
          }
          continue;
        }
        // O plano é DINÂMICO enquanto nenhuma etapa girante foi marcada:
        // pendência nova entra, resolvida sai — "atualiza conforme". A
        // primeira marcação trava, porque ela guarda só o número e trocar
        // o rótulo depois faria o histórico mentir.
        const nenhumaGiranteMarcada = ROTATING_SLOTS.every(
          (step) => !etapaFeita(client, step),
        );
        if (
          nenhumaGiranteMarcada
          && JSON.stringify(existente.etapas) !== JSON.stringify(etapas)
        ) {
          congeladosRef.current.add(chave);
          if (await substituirPlano({
            registroId: existente.id, area, weekStart: weekKey, etapas,
          })) {
            algum = true;
          }
        }
      }
      if (algum) {
        await queryClient.invalidateQueries({ queryKey: ["ciclo-planos"] });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situacoes, planos, planosAnteriores, avulsosAbertos, area, weekKey]);

  /** O rótulo de uma etapa que gira, vindo do plano congelado. */
  const rotuloDoPlano = (clientId: string, step: number): string | null => {
    const indice = ROTATING_SLOTS.indexOf(step);
    if (indice < 0) return null;
    return planos?.get(clientId)?.etapas[indice] ?? null;
  };

  const leitura = useMemo(
    () =>
      leituraDaCarteira(
        (activeClients as any[]).map((client) => ({
          nome: client.company_name || client.full_name || "Cliente",
          pendencias: pendenciasPorCliente.get(String(client.id)) || [],
        })),
      ),
    [activeClients, pendenciasPorCliente],
  );

  /**
   * Os serviços que existem entre os avulsos ativos, com quantos clientes cada
   * um tem.
   *
   * Sai dos clientes de verdade em vez de listar o catálogo inteiro: uma fila
   * de onze serviços em que oito estão vazios não organiza nada.
   */
  const servicosDosAvulsos = useMemo(() => {
    const conta = new Map<string, number>();
    for (const client of (clients || []) as any[]) {
      if (!ehAvulso(client) || (client.plan_status || "active") !== "active") continue;
      for (const servico of servicosDoCliente(client)) {
        conta.set(servico, (conta.get(servico) || 0) + 1);
      }
    }
    return [...conta.entries()]
      .map(([servico, total]) => ({ servico, total }))
      .sort((a, b) => b.total - a.total || a.servico.localeCompare(b.servico));
  }, [clients]);

  /**
   * Quem está cadastrado e ainda não aparece nesta frente.
   *
   * A regra aqui era restritiva demais e escondia justamente quem o dono mais
   * queria incluir. A flag de empresa interna (AcelerIQ, Stop Informática,
   * Jalimpo, PlayBet) existe para tirar da COBRANÇA — MRR, alerta de atraso,
   * pendência de plano —, e estava bloqueando também a OPERAÇÃO: trabalho
   * acontece para essas empresas do mesmo jeito. Plano em standby idem.
   *
   * Então a lista passa a oferecer todo mundo que está cadastrado e fora da
   * frente, com o motivo escrito ao lado para a escolha ser consciente. Só o
   * avulso continua de fora, porque tem aba própria e régua diferente.
   */
  const clientesDeFora = useMemo(
    () =>
      ((clients || []) as any[])
        .filter((client) => !ehAvulso(client) && !inCycle(client, area, hasService))
        .map((client) => ({
          client,
          nota: isInternalClient(client)
            ? "empresa do grupo"
            : (client.plan_status || "active") !== "active"
              ? `plano ${client.plan_status}`
              : "sem serviço marcado",
        }))
        // Quem só não tem serviço marcado vem primeiro: é o caso mais comum.
        .sort((a, b) => a.nota.localeCompare(b.nota)),
    [clients, area],
  );

  const [incluindo, setIncluindo] = useState(false);
  const [abrirInclusao, setAbrirInclusao] = useState(false);

  const incluirNoCiclo = async (clientId: string, nome: string) => {
    setIncluindo(true);
    try {
      if (await setCycleExtra(clientId, area, true)) {
        toast.success(`${nome} entrou no ciclo de ${CYCLES[area].label}.`);
        await queryClient.invalidateQueries({ queryKey: ["clients"] });
      } else {
        toast.error("Não foi possível incluir.");
      }
    } finally {
      setIncluindo(false);
    }
  };

  const tirarDoCiclo = async (clientId: string, nome: string) => {
    if (await setCycleExtra(clientId, area, false)) {
      toast.success(`${nome} saiu do ciclo de ${CYCLES[area].label}.`);
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
    } else {
      toast.error("Não foi possível remover.");
    }
  };

  const unassignedCount = useMemo(
    () =>
      ((clients || []) as any[]).filter(
        (client) =>
          (client.plan_status || "active") === "active" &&
          (client.client_type || "recurring") !== "one_off" &&
          !hasService(client, "social") &&
          !hasService(client, "trafego"),
      ).length,
    [clients],
  );

  const { data: rows } = useQuery({
    queryKey: ["weekly-cycle", user?.id, weekKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("id, client_id, area, week_start, step, done_at, done_by")
        .eq("week_start", weekKey);
      if (error) throw error;
      return (data || []) as CycleRow[];
    },
    enabled: !!user,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const doneMap = useMemo(() => {
    const map = new Map<string, CycleRow>();
    for (const row of rows || []) map.set(`${row.client_id}:${row.area}:${row.step}`, row);
    return map;
  }, [rows]);

  /**
   * As etapas de entrega dos avulsos, numa consulta só.
   *
   * O card contava exclusivamente de `weekly_cycle_progress`, e entrega
   * avulsa não mora lá — mora em `project_memory`, porque "site construído"
   * acontece uma vez, não toda segunda. O efeito era o relato do dono:
   * marcava a etapa na folha, voltava, e o card seguia dizendo 0/6. Nenhum
   * avulso tem uma linha sequer na tabela semanal — o contador nunca teve
   * como se mexer.
   */
  const idsAvulsos = useMemo(
    () =>
      ((clients || []) as any[])
        .filter(
          (client) =>
            (client.plan_status || "active") === "active" &&
            (client.client_type || "recurring") === "one_off",
        )
        .map((client) => String(client.id))
        .sort(),
    [clients],
  );

  const { data: etapasAvulsas } = useQuery({
    queryKey: ["entrega-etapas-lista", idsAvulsos],
    queryFn: () => listEtapasDeVarios(idsAvulsos),
    enabled: idsAvulsos.length > 0,
    staleTime: 10_000,
  });

  /** Entregas avulsas: última marcação e prazo, para acusar o que esfriou. */
  const { data: situacaoAvulsos } = useQuery({
    queryKey: ["ciclo-avulsos-situacao", idsAvulsos.join(",")],
    queryFn: () => lerSituacaoDosAvulsos(idsAvulsos),
    enabled: idsAvulsos.length > 0 && avulsosAbertos,
    staleTime: 60_000,
  });

  /** O serviço que o card mostra: o filtrado na fila, ou o primeiro do cliente. */
  const servicoDoCard = (client: any) =>
    servicoAvulso || servicosDoCliente(client)[0] || null;

  const etapasFeitasDe = (client: any, servico: string | null) =>
    (servico && etapasAvulsas?.get(`${client.id}:${servico}`)) || new Set<number>();

  const { data: historyRows } = useQuery({
    queryKey: ["weekly-cycle-history", area, localIso(realMonday)],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("client_id, week_start, step")
        .eq("area", area)
        .gte("week_start", localIso(addDays(realMonday, -(HISTORY_WEEKS - 1) * 7)));
      if (error) throw error;
      return (data || []) as Array<{ client_id: string; week_start: string; step: number }>;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  // Semana anterior com identificador de cada marcação: é o que permite
  // corrigir o que já foi feito lá atrás sem sair da semana atual.
  const pastWeekKey = localIso(addDays(weekStart, -7));
  const { data: pastRows } = useQuery({
    queryKey: ["weekly-cycle-past", user?.id, pastWeekKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("id, client_id, area, week_start, step, done_at, done_by")
        .eq("week_start", pastWeekKey);
      if (error) throw error;
      return (data || []) as CycleRow[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const historySets = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const row of historyRows || []) {
      if (row.step > 6) continue;
      const key = `${row.client_id}:${row.week_start}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(row.step);
    }
    return map;
  }, [historyRows]);

  const historyWeekKeys = useMemo(
    () =>
      Array.from({ length: HISTORY_WEEKS }, (_, index) =>
        localIso(addDays(realMonday, (index - (HISTORY_WEEKS - 1)) * 7)),
      ),
    [realMonday],
  );

  // Quem marcou cada etapa. Se a leitura do perfil da equipe não for
  // permitida, a tela simplesmente mostra a hora sem o nome.
  const doneByIds = useMemo(
    () => [...new Set((rows || []).map((row) => row.done_by).filter(Boolean))] as string[],
    [rows],
  );
  const { data: doneByNames } = useQuery({
    queryKey: ["cycle-done-by", doneByIds.join(",")],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles").select("id, full_name").in("id", doneByIds);
      const map: Record<string, string> = {};
      for (const row of data || []) map[row.id] = (row as any).full_name;
      return map;
    },
    enabled: doneByIds.length > 0,
    staleTime: 300_000,
  });

  const isOnboarding = (client: any) => client.onboarding_done === false;

  // O motor precisa saber onde o cliente está na jornada: quem entrou agora
  // recebe tarefas de diagnóstico, quem já tem rotina fechando recebe as de
  // escala. A sequência de semanas 100% é a prova de rotina madura.
  const stepOptionsFor = (client: any): StepsOptions => ({
    services: client.services_config || {},
    phaseInput: {
      onboardingDone: client.onboarding_done !== false,
      daysAsClient: client.created_at
        ? Math.floor((today.getTime() - new Date(client.created_at).getTime()) / 86400000)
        : 0,
      closedStreak: closedStreak(
        historyWeekKeys.slice(0, HISTORY_WEEKS - 1),
        (key) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
      ),
    },
  });

  const phaseOf = (client: any) =>
    phaseForClient(stepOptionsFor(client).phaseInput!);
  const totalFor = (client: any) => {
    // Avulso conta as etapas da entrega dele, não as seis da rotina semanal.
    if (ehAvulso(client)) {
      const servico = servicoDoCard(client);
      return servico ? etapasDoServico(servico).length : 0;
    }
    return totalSteps + (isOnboarding(client) ? ONBOARDING_STEPS.length : 0);
  };
  // Cada cliente tem a sua semana: DUAS etapas fixas e quatro que giram.
  const stepLabelOf = (client: any, step: number) => {
    if (ehAvulso(client)) {
      const servico = servicoDoCard(client);
      return servico ? etapasDoServico(servico)[step - 1] || "" : "";
    }
    if (step > totalSteps) return ONBOARDING_STEPS[step - totalSteps - 1];
    // O plano congelado (escolhido da realidade) manda nas etapas que
    // giram; o sorteio antigo fica só de reserva para semana sem plano.
    return rotuloDoPlano(String(client.id), step)
      ?? stepLabelForWeek(area, client.id, weekKey, step, stepOptionsFor(client));
  };

  /**
   * A etapa que o painel já prova, sem ninguém marcar.
   *
   * "Se for atualizado tudo lá dentro pelo painel, o ciclo reconhece e
   * coloca como concluído. Se não, fica pendente, e eu não quero que fique
   * pendente." A prova é lida na hora: se o fato sumir do painel, a etapa
   * volta a pedir atenção sozinha — nada é gravado às escondidas.
   */
  const provaDaEtapaDe = (client: any, step: number): string | null => {
    if (ehAvulso(client)) return null;
    const s = situacoes?.get(String(client.id));
    if (!s) return null;
    return provaDaEtapa({
      area,
      step,
      rotulo: stepLabelOf(client, step),
      fatos: s,
      pendenciasReais: pendenciasReaisPorCliente.get(String(client.id)) ?? null,
      agoraMs: Date.now(),
    });
  };

  const doneCountFor = (client: any) => {
    if (ehAvulso(client)) {
      const feitas = etapasFeitasDe(client, servicoDoCard(client));
      const total = totalFor(client);
      let count = 0;
      // Conta só o que existe hoje: etapa marcada num desenho antigo do
      // serviço não pode inflar o contador acima do total.
      for (let step = 1; step <= total; step += 1) if (feitas.has(step)) count += 1;
      return count;
    }
    let count = 0;
    for (let step = 1; step <= totalFor(client); step += 1) {
      // Marcada por alguém OU provada pelo painel: as duas contam, senão o
      // cliente fica pendente com o trabalho todo feito lá dentro.
      if (doneMap.has(`${client.id}:${area}:${step}`) || provaDaEtapaDe(client, step)) {
        count += 1;
      }
    }
    return count;
  };

  /**
   * Fechado e ter cumprido tudo que existia para cumprir.
   *
   * O `total > 0` importa para o avulso: servico sem etapas desenhadas tem
   * total zero, e "0 de 0" passaria por completo — o cliente cairia na
   * gaveta de fechados sem ninguem ter feito nada.
   */
  const estaFechado = (client: any) => {
    const total = totalFor(client);
    return total > 0 && doneCountFor(client) >= total;
  };

  // Ordem congelada: recalcula ao trocar de frente, de semana ou quando a
  // carteira muda. Marcar etapa não reordena, então o card fica onde está.
  const clientsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const client of activeClients) map.set(client.id, client);
    return map;
  }, [activeClients]);

  const orderRef = useRef<{ key: string; open: string[]; closed: string[] }>({
    key: "", open: [], closed: [],
  });
  /**
   * A ordem só congela depois que os dados chegaram do banco: congelar antes
   * deixaria quem já fechou ocupando a lista de trabalho até trocar de aba.
   * Na aba de avulsos quem manda é `etapasAvulsas` — congelar esperando só a
   * semana jogaria todo avulso completo de volta para "em andamento".
   *
   * A chave carrega a aba e o serviço filtrado porque o tamanho da lista não
   * basta: duas listas diferentes com a mesma quantidade de clientes reusavam
   * a ordem uma da outra, e como os ids não batem, a tela ficava vazia.
   */
  const listaPronta = rows !== undefined
    && (!avulsosAbertos || idsAvulsos.length === 0 || etapasAvulsas !== undefined);
  const orderKey = !listaPronta
    ? ""
    : `${area}:${weekKey}:${
        avulsosAbertos ? `avulsos:${servicoAvulso || "todos"}` : "ciclo"
      }:${activeClients.length}:${
        // Fechar um cliente reordena a fila: é o momento em que "vai
        // movendo e os que faltam sobem" acontece. Entre uma marcação e
        // outra a ordem fica quieta, senão o card foge do dedo.
        (activeClients as any[]).filter(estaFechado).length
      }:${situacoes ? "s" : "-"}`;
  if (orderRef.current.key !== orderKey) {
    // Quem pede ação sobe. Urgência manda mais que contagem de etapa: um
    // cliente com 5 de 6 e a conexão caída importa mais hoje do que um com
    // 1 de 6 e tudo em ordem. A ordem só é recalculada quando a chave muda
    // (semana, frente, alguém fechou) — recalcular a cada clique faria o
    // card fugir do dedo no meio da marcação.
    const sorted = ordenarPelaUrgencia(activeClients as any[], (client) => ({
      pendencias: pendenciasPorCliente.get(String(client.id)) || [],
      feitas: doneCountFor(client),
      nome: client.company_name || client.full_name || "",
    }));
    orderRef.current = {
      key: orderKey,
      open: sorted.filter((c) => !estaFechado(c)).map((c) => c.id),
      closed: sorted.filter(estaFechado).map((c) => c.id),
    };
  }
  const openClients = orderRef.current.open.map((id) => clientsById.get(id)).filter(Boolean);
  const closedClients = orderRef.current.closed.map((id) => clientsById.get(id)).filter(Boolean);

  const weekTotals = useMemo(() => {
    let done = 0, total = 0;
    for (const client of activeClients) {
      total += totalFor(client);
      done += doneCountFor(client);
    }
    return { done, total, pct: total > 0 ? done / total : 0 };
    // etapasAvulsas entra aqui porque na aba de avulsos a conta sai dele:
    // sem a dependência, marcar etapa não mexia a barra do topo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClients, doneMap, area, etapasAvulsas, servicoAvulso]);

  const otherArea: CycleArea = area === "social" ? "trafego" : "social";
  const otherAreaTotals = useMemo(() => {
    const list = ((clients || []) as any[]).filter(
      (client) =>
        (client.plan_status || "active") === "active" &&
        (client.client_type || "recurring") !== "one_off" &&
        hasService(client, otherArea),
    );
    let done = 0, total = 0;
    for (const client of list) {
      const clientTotal =
        CYCLES[otherArea].steps.length + (isOnboarding(client) ? ONBOARDING_STEPS.length : 0);
      total += clientTotal;
      for (let step = 1; step <= clientTotal; step += 1) {
        if (doneMap.has(`${client.id}:${otherArea}:${step}`)) done += 1;
      }
    }
    return { done, total };
  }, [clients, otherArea, doneMap]);

  const carteiraStreak = useMemo(() => {
    if (activeClients.length === 0) return 0;
    return closedStreak(historyWeekKeys.slice(0, HISTORY_WEEKS - 1), (key) =>
      activeClients.every(
        (client) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
      ),
    );
  }, [activeClients, historySets, historyWeekKeys, totalSteps]);

  const timeline = useMemo(
    () =>
      historyWeekKeys.map((key, index) => {
        const offset = index - (HISTORY_WEEKS - 1);
        const start = addDays(realMonday, offset * 7);
        let done = 0;
        for (const client of activeClients) {
          done += historySets.get(`${client.id}:${key}`)?.size || 0;
        }
        return {
          key, offset, start,
          label: shortDate(start),
          range: `${start.getDate()} a ${addDays(start, 6).getDate()}`,
          pct: activeClients.length > 0 ? done / (activeClients.length * totalSteps) : 0,
        };
      }),
    [activeClients, historySets, historyWeekKeys, realMonday, totalSteps],
  );

  // O que aconteceu em cada dia da semana: a marcação guarda a hora, então o
  // dia pode ser reconstruído exatamente como foi vivido.
  const dayEvents = useMemo(() => {
    const map = new Map<string, CycleRow[]>();
    for (const row of rows || []) {
      if (!row.done_at) continue;
      const key = localIso(new Date(row.done_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.done_at || "").localeCompare(b.done_at || ""));
    }
    return map;
  }, [rows]);

  const nextUp = useMemo(() => {
    const client = openClients.find((c) => !estaFechado(c));
    if (!client) return null;
    const step = Array.from({ length: totalFor(client) }, (_, i) => i + 1).find(
      (candidate) => !doneMap.has(`${client.id}:${area}:${candidate}`),
    );
    if (!step) return null;
    return {
      client, step,
      label: step <= totalSteps
        ? stepLabelForWeek(area, client.id, weekKey, step, stepOptionsFor(client))
        : ONBOARDING_STEPS[step - totalSteps - 1],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClients, doneMap, area]);

  const jumpToNext = () => {
    if (!nextUp) return;
    cardRefs.current[nextUp.client.id]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlighted(nextUp.client.id);
  };

  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [area]);

  const coachCacheKey = `aceleriq-coach-${area}-${weekKey}`;
  const { data: coach, isFetching: coachLoading, refetch: refetchCoach } = useQuery({
    queryKey: ["cycle-coach", area, weekKey],
    queryFn: async (): Promise<{ coach: string | null } | null> => {
      try {
        const cached = localStorage.getItem(coachCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - (parsed.at || 0) < 6 * 3600_000) return parsed.value;
        }
      } catch { /* cache corrompido: gera de novo */ }
      const { data, error } = await supabase.functions.invoke("cycle-coach", {
        body: { week_start: weekKey, area },
      });
      if (error || data?.error || !data?.coach) return null;
      const value = { coach: data.coach as string };
      try {
        localStorage.setItem(coachCacheKey, JSON.stringify({ at: Date.now(), value }));
      } catch { /* armazenamento cheio */ }
      return value;
    },
    enabled: !!user && weekOffset <= 0,
    staleTime: 6 * 3600_000,
    retry: 0,
  });

  const refreshCoach = () => {
    try { localStorage.removeItem(coachCacheKey); } catch { /* sem cache */ }
    void refetchCoach();
  };

  // A semana vira memória: o resumo do que a carteira entregou vai para a
  // caixa de entrada do segundo cérebro, para consulta depois.
  const [brainSaving, setBrainSaving] = useState(false);
  const logWeekToBrain = async () => {
    if (brainSaving) return;
    setBrainSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("cycle-brain-log", {
        body: { week_start: weekKey },
      });
      if (error || data?.error) throw new Error(data?.error || "falha ao registrar");
      if (data?.written) {
        // O painel é o registro que vale; o cérebro é espelho. A mensagem
        // conta a verdade dos dois, sem dizer que salvou onde não salvou.
        toast.success(
          `Semana guardada na história de ${data.saved_to_panel} cliente(s).` +
            (data.mirror?.ok
              ? " Também espelhada no segundo cérebro."
              : data.mirror?.reason
                ? ` No segundo cérebro não deu: ${data.mirror.reason}.`
                : ""),
        );
        setMenuOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["memoria-cliente"] });
      } else {
        toast.info("Nenhuma etapa marcada nesta semana ainda.");
      }
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível registrar.");
    } finally {
      setBrainSaving(false);
    }
  };

  const toggle = async (client: any, step: number, semana?: string) => {
    if (!canWrite) return;
    const alvoSemana = semana || weekKey;
    const daSemanaAtual = alvoSemana === weekKey;
    const key = `${client.id}:${area}:${step}${daSemanaAtual ? "" : `:${alvoSemana}`}`;
    if (pendingKey === key) return;
    setPendingKey(key);
    // O cache é a fonte, não o doneMap do render: dentro do laço do "Fechar
    // semana" o render fica para trás, e o mapa congelado deixaria inserir a
    // mesma etapa duas vezes.
    const existing = daSemanaAtual
      ? (
          queryClient.getQueryData<CycleRow[]>(["weekly-cycle", user?.id, weekKey]) || []
        ).find(
          (row) => row.client_id === client.id && row.area === area && row.step === step,
        ) ?? doneMap.get(key)
      : (pastRows || []).find(
          (row) => row.client_id === client.id && row.area === area
            && row.step === step && row.week_start === alvoSemana,
        );

    if (daSemanaAtual) queryClient.setQueryData<CycleRow[]>(["weekly-cycle", user?.id, weekKey], (current) => {
      const list = current || [];
      return existing
        ? list.filter((row) => row.id !== existing.id)
        : [...list, {
            id: `otimista-${key}`, client_id: client.id, area, week_start: alvoSemana, step,
            done_at: new Date().toISOString(), done_by: user?.id || null,
          }];
    });

    try {
      if (existing) {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress").delete().eq("id", existing.id);
        if (error) throw error;
        // Desfazer conserta a história também: o rastro da etapa sai, e o
        // fechamento da semana (se havia) deixa de valer — registro de coisa
        // desmarcada é a história mentindo.
        await apagarRegistroDoCiclo({
          clientId: client.id,
          metadata: { week_start: alvoSemana, area, step, registro: "etapa" },
        });
        await apagarRegistroDoCiclo({
          clientId: client.id,
          metadata: { week_start: alvoSemana, area, registro: "fechamento" },
        });
      } else {
        const { error } = await (supabase as any)
          .from("weekly_cycle_progress")
          .insert({ client_id: client.id, area, week_start: alvoSemana, step, done_by: user?.id || null });
        if (error) throw error;

        // Cada ação feita entra na história NA HORA, não só a semana
        // fechada: o histórico completo do cliente é a linha do tempo de
        // marcações, e uma ação sem rastro é ação que a história perde.
        const rotuloDaAcao = daSemanaAtual
          ? stepLabelOf(client, step)
          : step > totalSteps
            ? ONBOARDING_STEPS[step - totalSteps - 1] || `Etapa ${step}`
            : stepLabelForWeek(area, client.id, alvoSemana, step, stepOptionsFor(client));
        await recordMemory({
          clientId: client.id,
          kind: "ciclo",
          title: `Etapa concluída: ${rotuloDaAcao || `Etapa ${step}`}`,
          content:
            `A etapa "${rotuloDaAcao || step}" de ${cycle.label} foi concluída ` +
            `na semana de ${alvoSemana}.`,
          source: "ciclo",
          tags: [area, "etapa"],
          metadata: { week_start: alvoSemana, area, step, registro: "etapa" },
        });

        if (isOnboarding(client) && step === totalSteps + ONBOARDING_STEPS.length) {
          const { error: graduateError } = await supabase
            .from("profiles").update({ onboarding_done: true }).eq("id", client.id);
          if (!graduateError) {
            toast.success(`${client.company_name || client.full_name} concluiu o onboarding.`);
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle"] });
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle-history"] });
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle-past"] });
      // A história da folha acompanha CADA ação (gravada ou desfeita), não
      // só o fechamento da semana.
      await queryClient.invalidateQueries({ queryKey: ["memoria-cliente"] });

      // Semana fechada vira registro na história do cliente: o trabalho de
      // bastidor deixa de existir só como seis quadradinhos marcados.
      if (daSemanaAtual && !existing) {
        const total = totalFor(client);
        // A conta sai do CACHE, não do doneMap do render: o "Fechar semana"
        // da folha marca as etapas num laço com um fechamento só, e o mapa
        // congelado nunca via as marcações recém-feitas. A conta parava em
        // menos que o total e a semana fechava sem deixar registro nenhum.
        const linhasDaSemana =
          queryClient.getQueryData<CycleRow[]>(["weekly-cycle", user?.id, weekKey]) || [];
        const marcadas = new Set(
          linhasDaSemana
            .filter((row) => row.client_id === client.id && row.area === area)
            .map((row) => row.step),
        );
        marcadas.add(step);
        const feitas = Array.from({ length: total }, (_, i) => i + 1).filter((s) =>
          marcadas.has(s),
        ).length;
        if (feitas >= total) {
          await recordMemory({
            clientId: client.id,
            kind: "ciclo",
            title: `Semana de ${cycle.label} fechada`,
            content:
              `A operação de ${cycle.label.toLowerCase()} completou as ${total} etapas do ciclo ` +
              `na semana de ${weekLabel(weekStart)}: ${stepLabelsForWeek(area, client.id, weekKey, stepOptionsFor(client)).join("; ")}.`,
            source: "ciclo",
            tags: [area, "semana-fechada"],
            metadata: { week_start: alvoSemana, area, etapas: total, registro: "fechamento" },
          });
          // A folha aberta lê a história desta consulta; sem invalidar, o
          // registro só apareceria ao fechar e reabrir o cliente.
          await queryClient.invalidateQueries({ queryKey: ["memoria-cliente"] });
        }
      }
    } catch (error: unknown) {
      await queryClient.invalidateQueries({ queryKey: ["weekly-cycle"] });
      toast.error(
        (error as { message?: string })?.message || "Não foi possível marcar. Tente de novo.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  const etapaFeita = (client: any, step: number) =>
    ehAvulso(client)
      ? etapasFeitasDe(client, servicoDoCard(client)).has(step)
      : doneMap.has(`${client.id}:${area}:${step}`)
        || Boolean(provaDaEtapaDe(client, step));

  const nextStepOf = (client: any) =>
    Array.from({ length: totalFor(client) }, (_, i) => i + 1).find(
      (step) => !etapaFeita(client, step),
    ) || null;

  /**
   * Marcar a etapa da entrega direto do card.
   *
   * Antes o card do avulso trazia os seis botoes do ciclo semanal, que
   * gravam em `weekly_cycle_progress` — tabela que a entrega avulsa nao usa.
   * Tocar ali nao mexia no que a folha mostra, e o contador seguia parado.
   */
  const marcarEtapaAvulsa = async (client: any, step: number) => {
    if (!canWrite) return;
    const servico = servicoDoCard(client);
    if (!servico) return;
    const chave = `${client.id}:avulso:${step}`;
    if (pendingKey === chave) return;
    setPendingKey(chave);
    const feito = !etapaFeita(client, step);
    const ok = await marcarEtapa({
      clientId: client.id,
      servico,
      step,
      rotulo: etapasDoServico(servico)[step - 1] || `Etapa ${step}`,
      feito,
    });
    setPendingKey(null);
    if (!ok) {
      toast.error("Nao foi possivel marcar.");
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entrega-etapas-lista"] }),
      queryClient.invalidateQueries({ queryKey: ["entrega-etapas", client.id, servico] }),
    ]);
  };

  const renderClientCard = (client: any) => {
    const onboarding = isOnboarding(client);
    const avulso = ehAvulso(client);
    const clientTotal = totalFor(client);
    const doneCount = doneCountFor(client);
    const complete = estaFechado(client);
    const nextStep = complete ? null : nextStepOf(client);

    const stepButton = (step: number, onboardingTrack: boolean) => {
      const key = avulso ? `${client.id}:avulso:${step}` : `${client.id}:${area}:${step}`;
      const done = etapaFeita(client, step);
      const isNext = step === nextStep;
      return (
        <button
          key={key}
          type="button"
          title={stepLabelOf(client, step)}
          disabled={!canWrite || pendingKey === key}
          onClick={() =>
            void (avulso ? marcarEtapaAvulsa(client, step) : toggle(client, step))
          }
          className={`flex h-8 items-center justify-center rounded-lg border text-[11.5px] font-bold tabular-nums transition-colors active:scale-95 ${
            done
              ? onboardingTrack
                ? "border-info bg-info text-white"
                : "border-primary bg-primary text-primary-foreground"
              : isNext
                ? "border-primary bg-primary/10 text-primary"
                : onboardingTrack
                  ? "border-info/25 bg-info/5 text-info/70"
                  : "border-border bg-secondary/30 text-muted-foreground"
          } ${pendingKey === key ? "opacity-50" : ""}`}
        >
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : step}
        </button>
      );
    };

    return (
      <div
        key={client.id}
        ref={(node) => { cardRefs.current[client.id] = node; }}
        className={`rounded-2xl border p-3 transition-colors ${
          complete ? "border-success/40 bg-success/[0.06]" : "border-border bg-card"
        } ${highlighted === client.id ? "ring-2 ring-primary" : ""}`}
      >
        {/* Linha de identidade: altura fixa, contador com largura reservada */}
        <button
          type="button"
          onClick={() => setDetailId(client.id)}
          className="flex h-8 w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
            {client.company_name || client.full_name}
          </span>
          {avulso ? (
            <span
              title="Entrega avulsa: as etapas sao as do servico contratado"
              className="shrink-0 truncate rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-muted-foreground"
            >
              {SERVICE_LABELS[servicoDoCard(client) || ""] || "avulso"}
            </span>
          ) : onboarding ? (
            <span
              title="Em onboarding: 6 etapas do ciclo + 4 de entrada"
              className="shrink-0 rounded bg-info/15 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-info"
            >
              Novo
            </span>
          ) : (
            <span
              title={`Fase do método A.C.E.L.E.R.A: ${PHASE_LABELS[phaseOf(client)]}`}
              className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-muted-foreground"
            >
              {PHASE_LABELS[phaseOf(client)]}
            </span>
          )}
          <span className="w-11 shrink-0 text-right text-[12px] font-bold tabular-nums text-muted-foreground">
            {doneCount}/{clientTotal}
          </span>
          <Caret className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        {/* O que o painel está pedindo para este cliente AGORA.
            Fica acima das etapas de propósito: é o que decide se marcar
            a etapa faz sentido hoje. Só as duas mais graves — lista
            longa vira ruído e ninguém lê. */}
        {!avulso && (pendenciasPorCliente.get(String(client.id))?.length ?? 0) > 0 && (
          <div className="mb-2 space-y-0.5">
            {(pendenciasPorCliente.get(String(client.id)) || []).slice(0, 2).map((p) => (
              <p
                key={p.chave}
                className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                  p.gravidade === "urgente" ? "text-destructive" : "text-warning"
                }`}
              >
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-current" />
                <span className="min-w-0">{p.texto}</span>
              </p>
            ))}
          </div>
        )}

        {/* Entrega avulsa: o que denuncia que ela travou — parado na mesma
            etapa, prazo vencido — e o próximo passo pelo NOME, porque a
            confusão de "por onde começar" não se resolve com número. */}
        {avulso && situacaoAvulsos?.get(String(client.id)) && (() => {
          const pend = pendenciasDoAvulso({
            situacao: situacaoAvulsos.get(String(client.id))!,
            feitas: doneCount,
            total: clientTotal,
            proximaEtapa: nextStep ? stepLabelOf(client, nextStep) : null,
          });
          if (pend.length === 0) return null;
          return (
            <div className="mb-2 space-y-0.5">
              {pend.slice(0, 2).map((p) => (
                <p
                  key={p.chave}
                  className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                    p.gravidade === "urgente" ? "text-destructive" : "text-warning"
                  }`}
                >
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0">{p.texto}</span>
                </p>
              ))}
            </div>
          );
        })()}

        {/* Compras da semana: o número que fecha o funil, marcado à mão.
            Só no tráfego, porque é lá que o lead nasce e a pergunta "virou
            venda?" pertence. */}
        {!avulso && area === "trafego" && vendas && (
          <div className="mb-2 flex h-7 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {leituraDasCompras(
                vendas.get(String(client.id))?.compras ?? 0,
                situacoes?.get(String(client.id))?.leads7d ?? 0,
              )}
            </span>
            <button
              type="button"
              disabled={!canWrite || salvandoVenda === client.id}
              onClick={() => void marcarCompra(String(client.id), -1)}
              aria-label="Tirar uma compra"
              className="h-6 w-6 rounded-md border border-border text-[13px] font-bold text-muted-foreground disabled:opacity-40"
            >
              −
            </button>
            <span className="w-5 text-center text-[13px] font-bold tabular-nums text-foreground">
              {vendas.get(String(client.id))?.compras ?? 0}
            </span>
            <button
              type="button"
              disabled={!canWrite || salvandoVenda === client.id}
              onClick={() => void marcarCompra(String(client.id), 1)}
              aria-label="Marcar uma compra"
              className="h-6 w-6 rounded-md border border-primary/40 bg-primary/10 text-[13px] font-bold text-primary disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        {/* Barra segmentada: um bloco por etapa, na mesma ordem dos botões */}
        <div className="mb-2 flex h-1 gap-[3px]">
          {Array.from({ length: clientTotal }, (_, index) => (
            <span
              key={index}
              className={`flex-1 rounded-full ${
                etapaFeita(client, index + 1)
                  ? !avulso && index + 1 > totalSteps ? "bg-info" : "bg-primary"
                  : "bg-secondary"
              }`}
            />
          ))}
        </div>

        {/* Avulso: uma entrega, uma fila — o holofote sequencial. */}
        {avulso && nextStep && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-primary">
                Agora · {doneCount + 1} de {clientTotal}
              </p>
              <p className="truncate text-[12.5px] font-semibold leading-snug text-foreground">
                {stepLabelOf(client, nextStep)}
              </p>
            </div>
            <button
              type="button"
              disabled={!canWrite || pendingKey === (avulso ? `${client.id}:avulso:${nextStep}` : `${client.id}:${area}:${nextStep}`)}
              onClick={() =>
                void (avulso ? marcarEtapaAvulsa(client, nextStep) : toggle(client, nextStep))
              }
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
              Feito
            </button>
          </div>
        )}
        {complete && (
          <p className="mb-1.5 rounded-xl border border-success/30 bg-success/[0.08] p-2 text-center text-[11.5px] font-semibold text-success">
            {avulso ? "Entrega completa 🎉" : "Semana fechada 🎉 Cliente sai da fila."}
          </p>
        )}

        {/* AS TRÊS FRENTES DA SEMANA. O pedido do dono, na íntegra: "ao
            invés de 6 opções deixe 3; cada fila é uma frente da semana;
            preencheu a primeira tarefa, segue para a segunda" — o avanço
            de jogo, REAL: cada Feito marca a etapa de verdade no
            histórico. Corrigir uma marcação é na folha (toque no nome). */}
        {!avulso ? (
          <div className="space-y-1.5">
            {FRENTES_DA_SEMANA.map((frente) => {
              const aberta = frente.steps.find((s) => !etapaFeita(client, s)) ?? null;
              const feitasNaFila = frente.steps.filter((s) => etapaFeita(client, s)).length;
              if (!aberta) {
                return (
                  <div
                    key={frente.nome}
                    className="flex h-8 items-center gap-2 rounded-lg border border-success/25 bg-success/[0.05] px-2.5"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={3} />
                    <span className="text-[11px] font-semibold text-success">
                      {frente.nome} fechada
                    </span>
                  </div>
                );
              }
              const chaveBotao = `${client.id}:${area}:${aberta}`;
              return (
                <div
                  key={frente.nome}
                  className="flex items-center gap-2 rounded-xl border border-border bg-secondary/20 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      {frente.nome} · {feitasNaFila + 1} de {frente.steps.length}
                    </p>
                    <p className="truncate text-[12px] font-semibold leading-snug text-foreground">
                      {stepLabelOf(client, aberta)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canWrite || pendingKey === chaveBotao}
                    onClick={() => void toggle(client, aberta)}
                    className={`flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11.5px] font-bold text-primary-foreground transition-transform active:scale-95 disabled:opacity-50 ${
                      pendingKey === chaveBotao ? "opacity-50" : ""
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    Feito
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: clientTotal }, (_, i) => i).map((index) =>
              stepButton(index + 1, false),
            )}
          </div>
        )}
        {onboarding && !avulso && (
          <div className="mt-1.5 grid grid-cols-6 gap-1.5">
            {ONBOARDING_STEPS.map((_, index) => stepButton(totalSteps + index + 1, true))}
            <span className="col-span-2" />
          </div>
        )}

        {/* A entrada do cliente, conferida no dado. Ninguém marca nada:
            cada etapa fecha quando o fato aconteceu — o briefing voltou, a
            conta conectou, a arte subiu. E a sequência sai do que ELE
            contratou, então quem não tem tráfego nunca vê campanha. */}
        {onboarding && !avulso && jornadaDe(client) && (
          <div className="mt-2 space-y-1 rounded-xl border border-info/25 bg-info/[0.04] p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-info">
              Entrada do cliente · {ondeEstaNaEntrada(jornadaDe(client)!)}
            </p>
            {jornadaDe(client)!.map((etapa) => (
              <p
                key={etapa.chave}
                className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                  etapa.feita
                    ? "text-muted-foreground line-through decoration-muted-foreground/40"
                    : etapa.atual
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground/70"
                }`}
              >
                <span className="mt-[3px] shrink-0">
                  {etapa.feita ? <Check className="h-3 w-3 text-success" strokeWidth={3} /> : "○"}
                </span>
                <span className="min-w-0">
                  {etapa.titulo}
                  {etapa.atual && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {etapa.comoFecha}
                    </span>
                  )}
                </span>
              </p>
            ))}
          </div>
        )}

        {/* Linha de estado: altura reservada, nunca muda o tamanho do card */}
        <p className="mt-2 flex h-4 items-center truncate text-[11.5px]">
          {complete ? (
            <span className="font-semibold text-success">
              {avulso ? "Entrega completa" : "Semana fechada"}
            </span>
          ) : nextStep ? (
            <>
              <span className="font-semibold text-foreground">Agora:</span>
              <span className="ml-1 truncate text-muted-foreground">
                {nextStep}. {stepLabelOf(client, nextStep)}
              </span>
            </>
          ) : null}
        </p>
      </div>
    );
  };

  /**
   * Os avulsos EM ANDAMENTO, contados para a aba mesmo quando ela está
   * fechada. O concluído sai da conta junto com o card: um número que não
   * bate com a lista faz procurar um cliente que já não está lá.
   */
  const totalAvulsos = useMemo(
    () =>
      ((clients || []) as any[]).filter(
        (client) =>
          (client.plan_status || "active") === "active" &&
          ehAvulso(client) &&
          !entregaConcluida(client),
      ).length,
    [clients],
  );

  /** Quantos já foram entregues — a linha que diz para onde eles foram. */
  const avulsosConcluidos = useMemo(
    () =>
      ((clients || []) as any[]).filter(
        (client) =>
          (client.plan_status || "active") === "active" &&
          ehAvulso(client) &&
          entregaConcluida(client),
      ).length,
    [clients],
  );

  const AvulsosTab = () => (
    <button
      type="button"
      onClick={() => setAvulsosAbertos(true)}
      className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
        avulsosAbertos ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <Sparkles className="h-5 w-5" />
      <span className="flex items-center gap-1">
        Avulsos
        <span className="tabular-nums opacity-70">{totalAvulsos > 0 ? totalAvulsos : ""}</span>
      </span>
    </button>
  );

  const AreaTab = ({ target }: { target: CycleArea }) => {
    const config = CYCLES[target];
    const Icon = config.icon;
    const selected = area === target && !avulsosAbertos;
    const totals = selected ? weekTotals : otherAreaTotals;
    return (
      // Mesma anatomia das abas do painel: ocupa toda a altura da barra,
      // ícone em cima e texto pequeno embaixo.
      <button
        type="button"
        onClick={() => { setArea(target); setAvulsosAbertos(false); setServicoAvulso(null); }}
        className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
          selected ? "text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="h-5 w-5" />
        <span className="flex items-center gap-1">
          {config.short}
          <span className="tabular-nums opacity-70">
            {totals.total > 0 ? `${totals.done}/${totals.total}` : ""}
          </span>
        </span>
      </button>
    );
  };

  const detailClient = detailId ? clientsById.get(detailId) : null;
  const dayList = dayKey ? dayEvents.get(dayKey) || [] : [];

  return (
    // Mesma estrutura do painel (a referência que funciona em todo aparelho):
    // moldura simples, topo e barra presos às bordas, e o conteúdo ancorado
    // entre os dois. Nada de travar a raiz nem de altura herdada.
    <div className="min-h-screen bg-background">
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]"
      >
        <div className="flex h-12 items-center justify-between gap-2 px-2">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[15px] font-bold leading-tight text-foreground">
              <ListChecks className="h-4 w-4 text-primary" /> Ciclo da Semana
            </p>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">{avulsosAbertos ? "Clientes avulsos" : cycle.label}</p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Ver histórico"
          >
            <TrendingUp className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex h-10 items-center justify-between gap-1 px-2">
          <button
            type="button"
            onClick={() => setWeekOffset((current) => current - 1)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/60"
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setWeekOffset(0)} className="min-w-0 flex-1 text-center">
            <span className="block truncate text-[12.5px] font-semibold capitalize leading-tight text-foreground">
              {weekLabel(weekStart)}
            </span>
            <span className="block text-[9.5px] leading-tight text-muted-foreground">
              {isCurrentWeek
                ? "toque num dia para ver o que aconteceu"
                : `${Math.abs(weekOffset)} ${Math.abs(weekOffset) === 1 ? "semana" : "semanas"} ${weekOffset < 0 ? "atrás" : "à frente"} · voltar para hoje`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((current) => current + 1)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/60"
            aria-label="Próxima semana"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Dias: cada um abre o que foi feito naquele dia */}
        <div className="grid grid-cols-7 gap-1 px-2">
          {weekDays(weekStart).map((day, index) => {
            const key = localIso(day);
            const isToday = isSameDay(day, today);
            const count = dayEvents.get(key)?.length || 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDayKey(key)}
                className={`flex h-12 flex-col items-center justify-center rounded-md transition-colors ${
                  isToday ? "bg-primary/15" : count > 0 ? "bg-secondary/50" : ""
                }`}
                aria-label={`Dia ${day.getDate()}: ${count} ${count === 1 ? "marcação" : "marcações"}`}
              >
                <span className={`text-[8.5px] uppercase leading-none ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                  {WEEKDAY_INITIALS[index]}
                </span>
                <span className={`text-[13px] font-semibold leading-tight tabular-nums ${isToday ? "text-primary" : "text-foreground"}`}>
                  {day.getDate()}
                </span>
                <span className="flex h-1.5 items-center">
                  {count > 0 && (
                    <span className={`h-1 w-1 rounded-full ${isToday ? "bg-primary" : "bg-muted-foreground/60"}`} />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex h-8 items-center gap-2 px-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round(weekTotals.pct * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {weekTotals.done}/{weekTotals.total}
          </span>
        </div>

        {/* A leitura da carteira: responde "está tudo certo?" antes de
            alguém abrir cliente por cliente. A barra acima conta etapa
            marcada, que é esforço; isto conta o que o painel está
            pedindo, que é a realidade. */}
        {!avulsosAbertos && situacoes && activeClients.length > 0 && (
          <div className="flex h-7 items-center gap-1.5 px-3 pb-1">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                leitura.urgentes > 0
                  ? "bg-destructive"
                  : leitura.emAtencao > 0
                    ? "bg-warning"
                    : "bg-success"
              }`}
            />
            <span className="truncate text-[10.5px] text-muted-foreground">
              {leitura.frase}
            </span>
          </div>
        )}
      </header>

      {/* min-h-0 é o que faz a lista caber de verdade: sem isso o filho de um
          flex não encolhe, o conteúdo vaza e a tela sai do lugar. */}
      {/* Conteúdo ancorado entre o topo e a barra, exatamente como no painel:
          a rolagem acontece aqui dentro e a área termina onde a barra começa,
          sem sobra e sem depender de altura de tela reportada pelo sistema. */}
      <div
        ref={scrollRef}
        className="fixed inset-x-0 z-0 mx-auto w-full max-w-3xl overflow-y-auto overflow-x-hidden px-3 py-3"
        style={{
          top: headerH,
          bottom: "calc(env(safe-area-inset-bottom) + 56px)",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
        }}
      >
        <div className="w-full space-y-2.5">
          {nextUp && canWrite && (
            <button
              type="button"
              onClick={jumpToNext}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold tabular-nums text-primary">
                {nextUp.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                  Continuar de onde parou
                </span>
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {nextUp.client.company_name || nextUp.client.full_name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{nextUp.label}</span>
              </span>
              <ArrowDown className="h-4 w-4 shrink-0 text-primary" />
            </button>
          )}

          {coach?.coach && (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <Sparkles className="h-3 w-3" /> Coach da semana
                </p>
                <button
                  type="button" onClick={refreshCoach} disabled={coachLoading}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Atualizar coach"
                >
                  <RefreshCw className={`h-3 w-3 ${coachLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/90">{coach.coach}</p>
            </div>
          )}

          {/* A fila de serviços dos avulsos.

              Cliente avulso não tem frente semanal — ele tem o serviço que
              contratou. Sem esta fila, os seis avulsos vinham num monte só e
              abrir qualquer um levava ao checklist de social media, que não
              é o trabalho dele. */}
          {avulsosAbertos && servicosDosAvulsos.length > 0 && (
            <div className="-mx-0.5 flex snap-x gap-1.5 overflow-x-auto px-0.5 pb-0.5">
              <button
                type="button"
                onClick={() => setServicoAvulso(null)}
                className={`shrink-0 snap-start cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                  servicoAvulso === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Todos
                <span className="ml-1 tabular-nums opacity-70">{totalAvulsos}</span>
              </button>
              {servicosDosAvulsos.map(({ servico, total }) => (
                <button
                  key={servico}
                  type="button"
                  onClick={() => setServicoAvulso(servico)}
                  className={`shrink-0 snap-start cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                    servicoAvulso === servico
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {SERVICE_LABELS[servico] || servico}
                  <span className="ml-1 tabular-nums opacity-70">{total}</span>
                </button>
              ))}
            </div>
          )}

          {/* A faixa de HOJE: as ações mais urgentes da carteira inteira,
              em cima da lista de sempre — nada abaixo mudou. Responde "se
              eu fizer isso agora, o dia está sob controle", e cada linha
              leva ao card do cliente num toque. */}
          {!avulsosAbertos && situacoes && (() => {
            const acoes = acoesDoDia(
              (activeClients as any[]).map((c) => ({
                clientId: String(c.id),
                nome: c.company_name || c.full_name || "Cliente",
                pendencias: pendenciasPorCliente.get(String(c.id)) || [],
              })),
            );
            if (acoes.length === 0) return null;
            return (
              <div className="mb-3 rounded-2xl border border-border bg-card p-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  O que pede ação hoje
                </p>
                <div className="space-y-1.5">
                  {acoes.map((acao, indice) => (
                    <div
                      key={`${acao.clientId}:${acao.acao}:${indice}`}
                      className="rounded-lg px-1 py-0.5 transition-colors hover:bg-secondary/50"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          cardRefs.current[acao.clientId]?.scrollIntoView?.({
                            behavior: "smooth", block: "center",
                          });
                          setHighlighted(acao.clientId);
                        }}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span
                          className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                            acao.gravidade === "urgente" ? "bg-destructive" : "bg-warning"
                          }`}
                        />
                        <span className="min-w-0 flex-1 text-[12px] text-foreground">
                          {acao.acao}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">
                          {acao.nome}
                        </span>
                      </button>

                      {/* OS NOMES e O CAMINHO. A pendência sempre carregou os
                          dois, e a faixa jogava fora: "aprovação parada" sem
                          dizer qual post nem para onde ir era o que fazia
                          isto parecer genérico com a informação a um campo
                          de distância. */}
                      {(acao.detalhes?.length || acao.rota) && (
                        <p className="ml-3.5 mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[10.5px] leading-snug">
                          {acao.detalhes?.length ? (
                            <span className="text-muted-foreground">
                              {acao.detalhes.slice(0, 3).join(" · ")}
                            </span>
                          ) : null}
                          {acao.rota && (
                            <Link
                              to={acao.rota}
                              className="shrink-0 font-medium text-primary underline"
                            >
                              resolver aqui
                            </Link>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {openClients.map(renderClientCard)}

          {activeClients.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {avulsosAbertos
                  ? servicoAvulso
                    ? `Nenhum avulso de ${SERVICE_LABELS[servicoAvulso] || servicoAvulso}`
                    : "Nenhum cliente avulso ativo"
                  : `Nenhum cliente de ${cycle.label.toLowerCase()}`}
              </p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {avulsosAbertos
                  ? servicoAvulso
                    ? `Nenhum cliente avulso de ${SERVICE_LABELS[servicoAvulso] || servicoAvulso} agora. Toque em "Todos" para ver os outros.`
                    : "Cliente avulso é o cadastrado como entrega pontual, sem contrato correndo. Nenhum está ativo agora."
                  : `A lista usa o serviço marcado no cadastro. Marque "${area === "social" ? "Social" : "Tráfego"}" em Clientes, ou use "Incluir cliente nesta frente" aqui embaixo.`}
              </p>
            </div>
          )}

          {/* Sumiu da lista? Foi concluído. Dizer para onde foi evita a
              procura por um cliente que ninguém tirou do ar. */}
          {avulsosAbertos && avulsosConcluidos > 0 && (
            <p className="px-1 pt-1 text-center text-[10.5px] text-muted-foreground">
              {avulsosConcluidos}{" "}
              {avulsosConcluidos === 1 ? "projeto concluído" : "projetos concluídos"} —{" "}
              <Link to="/clientes" className="font-semibold text-primary hover:underline">
                no histórico, em Clientes
              </Link>
            </p>
          )}

          {closedClients.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowClosed((current) => !current)}
                className="flex h-10 w-full items-center justify-between rounded-xl border border-success/25 bg-success/5 px-3 text-left"
              >
                <span className="text-[11.5px] font-semibold text-success">
                  {closedClients.length} {closedClients.length === 1 ? "cliente fechado" : "clientes fechados"}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  {showClosed ? "esconder" : "ver"}
                </span>
              </button>
              {showClosed && closedClients.map(renderClientCard)}
            </div>
          )}

          {/* Incluir quem ficou de fora. O cadastro define o padrão, mas existe
              o caso real: o cliente em preparação, o que entrou no meio da
              semana, o que pediu uma frente por fora. */}
          {!avulsosAbertos && clientesDeFora.length > 0 && (
            <div className="mt-1 rounded-2xl border border-border bg-card px-3 py-2">
              <button
                type="button"
                onClick={() => setAbrirInclusao((valor) => !valor)}
                className="w-full text-left text-[11px] font-semibold text-foreground"
              >
                Incluir cliente nesta frente
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({clientesDeFora.length} fora)
                </span>
              </button>
              {/* Os nomes só entram na tela quando o painel abre: soltos aqui,
                  se misturariam com a lista do ciclo e dariam a impressão de
                  que aquele cliente já está na frente. */}
              {abrirInclusao && (
                <>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Marca o serviço no cadastro do cliente, então ele passa a
                aparecer aqui e na ficha dele. Não mexe em cobrança nem no plano.
              </p>
              <div className="mt-2 space-y-1">
                {clientesDeFora.map(({ client, nota }) => (
                  <button
                    key={client.id}
                    type="button"
                    disabled={incluindo}
                    onClick={() =>
                      void incluirNoCiclo(
                        client.id,
                        client.company_name || client.full_name || "Cliente",
                      )
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-left disabled:opacity-40"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[12px] text-foreground">
                        {client.company_name || client.full_name}
                      </span>
                      {/* O motivo de estar fora fica visível: incluir uma
                          empresa do grupo é escolha legítima, mas consciente. */}
                      <span className="truncate text-[10px] text-muted-foreground">{nota}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-primary">incluir</span>
                  </button>
                ))}
              </div>
                </>
              )}
            </div>
          )}

          {/* Quem está aqui por inclusão manual pode sair pelo mesmo caminho. */}
          {activeClients.filter((client) => extraAreas(client).includes(area)).length > 0 && (
            <p className="px-1 pt-2 text-[10px] leading-relaxed text-muted-foreground">
              Incluídos à mão nesta frente:{" "}
              {activeClients
                .filter((client) => extraAreas(client).includes(area))
                .map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() =>
                      void tirarDoCiclo(
                        client.id,
                        client.company_name || client.full_name || "Cliente",
                      )
                    }
                    className="mr-1.5 underline decoration-dotted hover:text-destructive"
                  >
                    {client.company_name || client.full_name} ✕
                  </button>
                ))}
            </p>
          )}
        </div>
      </div>

      {/* Barra idêntica à do painel: colada na borda de baixo, com o recuo do
          indicador POR DENTRO. O fundo dela pinta até o fim do vidro, então
          não existe faixa de cor diferente em nenhum aparelho. */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Frentes do ciclo"
      >
        <div className="flex items-stretch h-14 max-w-[560px] mx-auto">
          <AreaTab target="social" />
          <AreaTab target="trafego" />
          <AvulsosTab />
        </div>
      </nav>

      {/* Detalhe do cliente: contexto, ferramentas e evolucao */}
      <ClientCycleSheet
        client={detailClient}
        area={area}
        /* Abrir um avulso mostra a entrega do serviço dele.

           Sem serviço escolhido na fila, vale o primeiro que ele tem — abrir
           um cliente de site e cair no checklist de social media era
           exatamente o "genérico" que não descrevia o trabalho. */
        servicoAvulso={
          avulsosAbertos && detailClient
            ? servicoAvulso || servicosDoCliente(detailClient)[0] || null
            : null
        }
        /* A situação completa entra na folha: o clique no card tem que
           revelar mais do que o card já mostrava, senão parece que nada
           aconteceu. */
        pendencias={
          detailClient && !avulsosAbertos
            ? pendenciasPorCliente.get(String(detailClient.id)) ?? (situacoes ? [] : undefined)
            : undefined
        }
        jornada={
          detailClient && !avulsosAbertos && isOnboarding(detailClient)
            ? jornadaDe(detailClient)
            : undefined
        }
        rotuloDaEtapa={
          detailClient && !avulsosAbertos
            ? (step: number) => stepLabelOf(detailClient, step)
            : undefined
        }
        /* O que o painel já prova sozinho: a folha mostra como concluído,
           com o motivo, em vez de cobrar de novo. */
        provaDaEtapa={
          detailClient && !avulsosAbertos
            ? (step: number) => provaDaEtapaDe(detailClient, step)
            : undefined
        }
        /* Os fatos desta semana e deste cliente, lidos do painel: são o
           que tira a mensagem do grupo do texto genérico da fase. */
        fatosDoPainel={
          detailClient && situacoes?.get(String(detailClient.id))
            ? fatosDoPainel({
                area,
                publicadosNaSemana: situacoes.get(String(detailClient.id))!.publicadosNaSemana,
                agendados: situacoes.get(String(detailClient.id))!.agendados,
                proximoAgendado: situacoes.get(String(detailClient.id))!.proximoAgendado,
                aguardandoAprovacao: situacoes.get(String(detailClient.id))!.aguardandoAprovacao,
                leads7d: situacoes.get(String(detailClient.id))!.leads7d,
                compras: vendas?.get(String(detailClient.id))?.compras,
              })
            : undefined
        }
        weekStart={weekStart}
        realMonday={realMonday}
        historyWeekKeys={historyWeekKeys}
        historySets={historySets}
        doneMap={doneMap}
        pastRows={pastRows || []}
        pastWeekKey={pastWeekKey}
        doneByNames={doneByNames}
        currentUserId={user?.id}
        canWrite={canWrite}
        pendingKey={pendingKey}
        onToggle={toggle}
        onClose={() => setDetailId(null)}
      />

      {/* O dia: o que foi feito, na ordem em que aconteceu */}
      <Sheet open={!!dayKey} onOpenChange={(open) => !open && setDayKey(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
        >
          <SheetHeader className="px-4">
            <SheetTitle className="pr-8 text-left text-base capitalize">
              {dayKey &&
                new Date(`${dayKey}T12:00:00`).toLocaleDateString("pt-BR", {
                  weekday: "long", day: "2-digit", month: "long",
                })}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-1.5 px-4">
            {dayList.length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                Nenhuma etapa marcada neste dia.
              </p>
            )}
            {dayList.map((row) => {
              const client = clientsById.get(row.client_id)
                || ((clients || []) as any[]).find((c) => c.id === row.client_id);
              const rowCycle = CYCLES[(row.area as CycleArea) || "social"];
              const label = row.step <= rowCycle.steps.length
                ? rowCycle.steps[row.step - 1]
                : ONBOARDING_STEPS[row.step - rowCycle.steps.length - 1];
              const who = row.done_by
                ? row.done_by === user?.id ? "você" : doneByNames?.[row.done_by] || "equipe"
                : null;
              return (
                <div key={row.id} className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-2.5">
                  <span className="w-10 shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                    {hourOf(row.done_at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-foreground">
                      {client?.company_name || client?.full_name || "Cliente"}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {row.step}. {label}
                    </span>
                  </span>
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    {rowCycle.short}
                  </span>
                </div>
              );
            })}
            {dayList.length > 0 && (
              <p className="pt-1 text-center text-[10.5px] text-muted-foreground">
                {dayList.length} {dayList.length === 1 ? "etapa marcada" : "etapas marcadas"} neste dia
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Menu do painel */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-[280px] flex-col gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <SheetHeader className="border-b border-border px-4 pb-3 pt-5">
            <SheetTitle className="flex items-center gap-2 text-left text-base">
              <ListChecks className="h-4 w-4 text-primary" /> Ciclo Aceleriq
            </SheetTitle>
            <SheetDescription className="sr-only">
              Atalhos do painel e ajustes do Ciclo.
            </SheetDescription>
          </SheetHeader>
          <div className="p-2">
            <button
              type="button"
              onClick={() => { setLegendOpen(true); setMenuOpen(false); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:bg-secondary/60"
            >
              <ListChecks className="h-4 w-4 text-primary" /> Como funciona o ciclo
            </button>
            {!standalone && (
              <div className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-foreground">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  Instalar o Ciclo no celular
                  <span className="block text-[10.5px] font-normal leading-snug text-muted-foreground">
                    você já está na página certa: abra o menu do navegador e
                    toque em "Adicionar à tela inicial". O atalho sai com o
                    ícone e o nome do Ciclo.
                  </span>
                </span>
              </div>
            )}
            {profile?.role === "admin" && (
              <button
                type="button"
                onClick={() => void logWeekToBrain()}
                disabled={brainSaving}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:bg-secondary/60 disabled:opacity-50"
              >
                <Brain className={`h-4 w-4 text-primary ${brainSaving ? "animate-pulse" : ""}`} />
                Guardar a semana no segundo cérebro
              </button>
            )}
            <div className="my-2 border-t border-border" />
            <p className="px-3 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ir para o painel
            </p>
            {MENU_LINKS.map((link) => (
              <Link
                key={link.url}
                to={link.url}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <link.icon className="h-4 w-4" /> {link.title}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Histórico da carteira */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
        >
          <SheetHeader className="px-4">
            <SheetTitle className="pr-8 text-left text-base">Histórico · {cycle.label}</SheetTitle>
            <SheetDescription className="sr-only">
              Evolução das últimas semanas da carteira.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 px-4">
            <div className="flex items-end gap-1.5">
              {timeline.map((week) => {
                const selected = week.offset === weekOffset;
                return (
                  <button
                    key={week.key}
                    type="button"
                    onClick={() => { setWeekOffset(week.offset); setHistoryOpen(false); }}
                    className="flex flex-1 flex-col items-center gap-1"
                    aria-label={`Semana de ${week.range}: ${Math.round(week.pct * 100)}%`}
                  >
                    <span className="text-[9px] font-semibold tabular-nums text-muted-foreground">
                      {Math.round(week.pct * 100)}%
                    </span>
                    <span className="flex h-24 w-full items-end overflow-hidden rounded-md bg-secondary/40">
                      <span
                        className={`block w-full rounded-md ${
                          selected ? "bg-primary" : week.pct >= 1 ? "bg-success/70" : "bg-primary/40"
                        }`}
                        style={{ height: `${Math.max(week.pct * 100, week.pct > 0 ? 8 : 3)}%` }}
                      />
                    </span>
                    <span className={`text-[9px] tabular-nums ${selected ? "font-bold text-primary" : "text-muted-foreground"}`}>
                      {week.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Sequência
                </p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                  {carteiraStreak}{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {carteiraStreak === 1 ? "semana 100%" : "semanas 100%"}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Esta semana
                </p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                  {Math.round(weekTotals.pct * 100)}%{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">
                    de {weekTotals.total}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Legenda */}
      <Sheet open={legendOpen} onOpenChange={setLegendOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
        >
          <SheetHeader className="px-4">
            <SheetTitle className="pr-8 text-left text-base">O ciclo · {cycle.label}</SheetTitle>
            <SheetDescription className="sr-only">
              Como o ciclo da semana é montado.
            </SheetDescription>
          </SheetHeader>
          <p className="mt-2 px-4 text-[12px] leading-relaxed text-muted-foreground">
            Três etapas são fixas, porque acontecem toda semana: criar o
            conteúdo, atualizar o painel e agendar. As outras três mudam a cada
            semana e são diferentes para cada cliente, para o checklist não
            virar rotina automática. Abra um cliente para ver as etapas dele.
          </p>
          <ol className="mt-4 space-y-2 px-4">
            {stepsForWeek(
              area,
              activeClients[0]?.id || "exemplo",
              weekKey,
              activeClients[0] ? stepOptionsFor(activeClients[0]) : undefined,
            ).map((slot) => (
              <li key={slot.step} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                    slot.fixed ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {slot.step}
                </span>
                <span className="min-w-0">
                  {slot.label}
                  {!slot.fixed && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      · muda toda semana
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 px-4 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Onboarding · etapas 7 a 10
          </p>
          <ol className="mt-2 space-y-2 px-4">
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/15 text-[11px] font-bold tabular-nums text-info">
                  {index + 7}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 px-4 text-[11px] leading-relaxed text-muted-foreground">
            Cada frente mostra apenas os clientes com aquele serviço no
            cadastro. Toque no nome do cliente para ver a evolução dele, e num
            dia da semana para ver o que foi feito naquele dia.
          </p>
        </SheetContent>
      </Sheet>
    </div>
  );
}
