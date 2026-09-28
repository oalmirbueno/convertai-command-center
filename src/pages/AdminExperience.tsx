import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RITUAL_DA_CENTRAL, marcarRitual, atualizarAvancosDoDossie } from "@/lib/esteira/esteiraAcoes";
import { completarProximoPasso, resumoDoRitual } from "@/lib/ritualTexto";
import ProjectJournal from "@/components/shared/ProjectJournal";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import {
  formatMetricNumber,
  useSocialMetricsWeekly,
  contaPrincipal,
  weekDeltaPct,
  type SocialMetricsWeek,
} from "@/hooks/useSocialMetrics";
import { useBilling } from "@/hooks/useFinancialData";
import { isInternalClient } from "@/lib/clientFlags";
import { SERVICE_LABELS as SERVICE_NAMES } from "@/lib/cycleDefs";
import { listInWords, readableFileName, readableProjectName } from "@/lib/clientText";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";
import DossieDoCliente from "@/components/admin/DossieDoCliente";
import CentralReviewQueue from "@/components/central/CentralReviewQueue";
import AgenteDaCentral from "@/components/central/AgenteDaCentral";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela, useRolagemDaTela } from "@/components/central/useEstadoDaTela";
import SeletorDeModelo, { useModeloDaCentral } from "@/components/central/SeletorDeModelo";
import { corpoDoModelo, rotuloDoModelo } from "@/components/central/modeloDaCentral";
import PromessasDoRascunho from "@/components/central/PromessasDoRascunho";
import { avisosDoRitual, extrasDoRitual } from "@/components/central/ritualAvisos";
import { applyCentralAiDraft, assertCentralReviewSource, captureCentralGenerationContext, centralGenerationFacts, centralCachedPlanFacts, centralFactsProvenance, persistCentralReviewDraft, readCentralReportPage, type CentralGenerationContext, type CentralGenerationProject } from "@/lib/centralReviewSource";
import { CONTEXTO_KINDS, oQueEsperarDoDossie, trechoDoContexto } from "@/lib/contextoDoCliente";
import { lerDossiesDaCarteira, rotuloDoDossie, type DossieDoCliente as DossieGeralDoCliente } from "@/lib/dossieGeral";
import { lerMovimentos, movimentosComoFatos } from "@/lib/movimentos";
import { ehEntregue } from "@/lib/contextoDaCentral";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";
import { useCentralReviewPendentes } from "@/hooks/useCentralReviewPendentes";
import { buscarTodas } from "@/lib/buscaCompleta";
import { AO_VIVO, AO_VIVO_CALMO, INTERVALO_AO_VIVO as LIVE } from "@/lib/consultaAoVivo";
import {
  porqueDaSemana as porqueDaSemana_,
  rotinaEmLinguagemDeCliente,
} from "@/lib/rotinaDoCliente";
import { ritualTiming } from "@/lib/ritualTiming";
import { stepLabelsForWeek } from "@/lib/cycleTasks";
import { addDays, localIso, mondayOf } from "@/lib/cycleWeek";
import { useAdsCampaigns, useAdsDaily } from "@/hooks/useAdsMetrics";
import { goalForCampaign, resultFromActions, statusLabel as adsStatusLabel } from "@/lib/adsLanguage";
import { memoryAsContext, readMemory, recordMemory } from "@/lib/clientMemory";
import { useNow } from "@/hooks/useNow";
import { buildGrowthSeries } from "@/lib/reportGrowth";
import {
  buildRadarIdeas,
  radarIdeaForClient,
  RADAR_LENSES,
  type RadarClientContext,
  type RadarIdea,
} from "@/lib/radarIdeas";
import { notifyUser } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowUpRight, BadgeDollarSign, BookOpen, CheckCircle2, ChevronDown, HeartPulse, Loader2, MoreHorizontal, Radar, RefreshCw, Send, Sparkles, Trash2, UserCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  RegiaoRolavel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  type ItemDeEtapa,
} from "@/components/sistema";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** Quanto para trás a Central lê material liberado (a maior conta olha 45 dias). */
const JANELA_DE_ENTREGAS_DIAS = 60;

/**
 * Toda leitura paginada da Central: até o fim, sem teto que corte, e falha de
 * página vira erro da consulta (o React Query tenta de novo e mantém o dado
 * anterior), nunca "não coube" (frente CE, 28/09).
 */
const LER_TUDO = { lancarErro: true } as const;

/**
 * O que a mensagem do grupo precisa da memória: avulsos da semana, plano da
 * esteira e, sem dossiê, o registro de contexto. O resto (ciclo, rituais,
 * checklists) era 80% das linhas e quase 1 MB de texto relido a cada 20 s.
 */
const KINDS_DA_MEMORIA_DA_CENTRAL = ["avulso", "esteira_plano", ...Array.from(CONTEXTO_KINDS)];

const daysSince = (value?: string | null): number | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

// O dia da semana de cada ritual (1 = segunda) é dado, não enfeite: a tela se
// chama "o que enviar e quando" e não dizia o que era HOJE. Quem abre precisa
// saber, em um olhar, o que já devia ter saído e o que é a próxima coisa.
const RITUALS = [
  { value: "rota_semana", dia: 1, label: "Rota da Semana (abertura)", cadence: "Semanal · segunda", why: "Abre a semana com foco e a única ação necessária do cliente" },
  { value: "meio_semana", dia: 3, label: "Check do Meio da Semana", cadence: "Semanal · quarta", why: "Mantém o cliente por dentro do andamento no meio do ciclo" },
  { value: "prova_movimento", dia: 5, label: "Prova de Movimento (fechamento)", cadence: "Semanal · sexta", why: "Fecha a semana provando o que avançou e o próximo passo" },
  { value: "radar_aceleriq", label: "Radar Aceleriq", cadence: "Mensal", why: "Leva uma ideia de diferenciação antes de o cliente pedir" },
  { value: "marco_90", label: "Marco 90", cadence: "Trimestral", why: "Mostra o antes e depois do trimestre com evidências" },
] as const;

const ritualMeta = (value?: string | null) => RITUALS.find((r) => r.value === value) || null;

// O que cada frente observa e como se chama, em português de cliente.
const FRONT_SIGNALS: Record<string, string> = {
  social_media: "alcance qualificado, salvamentos e contatos chegando pelo perfil",
  traffic: "custo por contato e volume de orçamentos gerados pelas campanhas",
  site: "visitas e pedidos de orçamento chegando pelo site",
  landing_page: "conversões da página (cadastros e chamadas)",
  automation: "tempo economizado e atendimentos respondidos automaticamente",
  event: "confirmações e participação no evento",
  other: "o indicador principal combinado para esta frente",
};
const FRONT_LABELS: Record<string, string> = {
  social_media: "Social Media", traffic: "Tráfego Pago", automation: "Automação",
  site: "Site", landing_page: "Landing Page", event: "Evento", other: "Projeto",
};

/** Ritual sugerido pelo dia da semana: segunda abre, quarta checa, sexta fecha. */
const ritualForToday = (): string => {
  const day = new Date().getDay();
  if (day === 1 || day === 0) return "rota_semana";
  if (day >= 2 && day <= 4) return "meio_semana";
  return "prova_movimento";
};

/** Última avaliação do Pulso guardada no cadastro do próprio cliente. */
const latestPulse = (client: any): { score: number; date: string; comment?: string } | null => {
  const history = client?.services_config?.pulse_history;
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || !Number.isFinite(Number(last.score))) return null;
  return { score: Number(last.score), date: String(last.date || ""), comment: last.comment };
};

interface HealthFactor {
  label: string;
  weight: number;
  earned: number | null;
  note: string;
}

interface ClientHealth {
  client: any;
  score: number | null;
  level: "healthy" | "attention" | "risk";
  factors: HealthFactor[];
  alerts: { kind: string; label: string }[];
  pulse: { score: number; date: string; comment?: string } | null;
}

interface DraftPreview {
  clientId: string;
  clientName: string;
  draft: any;
}

export default function AdminExperience({ cycleReview = false }: { cycleReview?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const reviewClientId = cycleReview ? new URLSearchParams(location.search).get("client") : null;
  const queryClient = useQueryClient();

  /**
   * Quais consultas bateram na guarda de páginas (200 mil linhas): defeito de
   * consulta, não carteira. Sem teto, a leitura vai até o fim; falha de
   * leitura não é corte e aparece pelo estado de erro de cada consulta.
   *
   * Fica em ref porque é efeito colateral da busca, não estado que comanda
   * renderização: gravar em state dentro do queryFn provocaria laço.
   */
  const cortes = useRef<Record<string, boolean>>({});
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients, isLoading: carregandoClientes } = useClients();
  const { data: projects } = useProjects();
  const { data: billing } = useBilling();
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genClientId, setGenClientId] = useState("__all__");
  const [genRitual, setGenRitual] = useState<string>(ritualForToday());
  const [genPreviews, setGenPreviews] = useState<DraftPreview[] | null>(null);
  const confirmingDrafts = useRef(false);
  const generatingDrafts = useRef(false);
  /** Ideia do Radar escolhida pela equipe para virar mensagem do cliente. */
  const [genIdeaId, setGenIdeaId] = useState<string | null>(null);
  /**
   * Sair e voltar não apaga nada (dono, 26/09): aba, cliente aberto, filtros,
   * rascunhos de mensagem, texto escrito pela IA e rolagem ficam guardados
   * neste navegador, por usuário. Na revisão do Ciclo nada disso é guardado.
   */
  const telaChave = !cycleReview && user?.id ? `central:${user.id}` : null;
  const guardar = (nome: string) => (telaChave ? `${telaChave}:${nome}` : null);
  const ehTexto = (v: unknown) => typeof v === "string";
  const ehObjeto = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const raizDaCentral = useRef<HTMLDivElement>(null);
  useRolagemDaTela(guardar("rolagem"), raizDaCentral);
  /** Ideias geradas com IA e busca na web, por cliente. */
  const [aiIdeas, setAiIdeas] = useEstadoDaTela<Record<string, RadarIdea[]>>(guardar("ideias-ia"), {}, ehObjeto);
  const [aiClientId, setAiClientId] = useEstadoDaTela<string>(guardar("radar-cliente"), "", ehTexto);
  const [aiLoading, setAiLoading] = useState(false);
  /** Prévia aberta da mensagem do grupo (ver antes de copiar). */
  const [groupMsgPreview, setGroupMsgPreview] = useState<string | null>(null);
  /** Mensagem do momento escrita pela IA, por cliente+momento (nesta sessão). */
  const [aiMoment, setAiMoment] = useEstadoDaTela<Record<string, { title: string | null; body: string; alertas: string[]; model: string | null }>>(guardar("momentos-ia"), {}, ehObjeto);
  const [aiMomentLoading, setAiMomentLoading] = useState<string | null>(null);
  /** Modelo que escreve (GPT-6 Luna, raciocínio máximo, por padrão), lembrado neste navegador. */
  const [escolhaDoModelo, setEscolhaDoModelo] = useModeloDaCentral();
  const [generating, setGenerating] = useState(false);
  /** Progresso do gerador (frente CE): com raciocínio máximo cada cliente leva até 2 min, e a tela diz em que ponto está. */
  const [progressoDaGeracao, setProgressoDaGeracao] = useState<{ feitos: number; total: number } | null>(null);
  const [expandedHealth, setExpandedHealth] = useEstadoDaTela<string | null>(guardar("carteira-aberto"), null, (v) => v === null || ehTexto(v));
  const [profileClientId, setProfileClientId] = useEstadoDaTela<string>(guardar("perfil-cliente"), "", ehTexto);
  // Link de pedido (?review=) sempre abre a fila: a aba guardada não passa na frente.
  const [activeTab, setActiveTab] = useEstadoDaTela<string>(
    new URLSearchParams(location.search).has("review") ? null : guardar("aba"),
    cycleReview ? "fila" : "carteira",
    (v) => typeof v === "string" && ["carteira", "perfis", "avulsos", "radar", "fila", "historico"].includes(v),
  );
  const revisoes = useCentralReviewPendentes(cycleReview);
  useEffect(() => {
    if (cycleReview || new URLSearchParams(location.search).has("review")) setActiveTab("fila");
  }, [location.search, cycleReview, setActiveTab]);
  /** Historico: um cliente so, ou a carteira inteira. */
  const [historicoClientId, setHistoricoClientId] = useEstadoDaTela<string>(guardar("historico-cliente"), "__all__", ehTexto);
  const [expandedDraft, setExpandedDraft] = useEstadoDaTela<string | null>(guardar("fila-aberto"), null, (v) => v === null || ehTexto(v));
  /** Rascunhos de mensagem em edição: guardados até publicar, descartar ou ficarem iguais ao salvo. */
  const [draftEdits, setDraftEdits] = useEstadoDaTela<Record<string, { summary: string; next_steps: string }>>(guardar("rascunhos"), {}, ehObjeto);
  const [aprimorando, setAprimorando] = useState<string | null>(null);
  /** Rascunho sendo publicado ou descartado agora: dois toques no mesmo botao
      publicavam (e gravavam no diario e no Ciclo) duas vezes. */
  const [rascunhoEmVoo, setRascunhoEmVoo] = useState<string | null>(null);

  // Tudo com atualização automática: a Central reflete a movimentação em tempo real.
  // A Central e a tela que o dono deixa aberta o dia todo: alem do intervalo
  // curto, ela revalida ao voltar para a aba e ao reconectar. O padrao global
  // do painel desliga a revalidacao por foco, e era por isso que a tela ficava
  // mostrando numeros de horas atras.
  // Sob demanda (frente R, 25/09): a Central abria disparando umas 27 leituras
  // de uma vez, a cada 20 s, e dez delas só servem para ESCREVER mensagem
  // (perfil, fila, histórico e o gerador). Na Carteira elas ficam paradas e
  // abrem quando a tela que usa aparece. O gerador só libera o botão quando
  // elas chegaram (contextoPronto), para nenhuma mensagem sair com meio dado.
  const precisaContexto = generatorOpen || expandedHealth !== null || activeTab === "perfis" || activeTab === "fila" || activeTab === "historico";
  const precisaHistorico = activeTab === "historico";
  // Trocar de cliente no Perfil fecha a prévia aberta do anterior.
  useEffect(() => { setGroupMsgPreview(null); }, [profileClientId]);

  // Estado das campanhas e o objetivo declarado pelo cliente: sem isso o
  // ritual só sabia falar de conteúdo, e tráfego é metade do trabalho.
  const { data: adsWallets = [], isFetched: adsWalletsProntos } = useQuery({
    queryKey: ["exp-ads-wallets"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ads_wallet")
        .select("client_id, balance, platform, last_recharge_date");
      return data || [];
    },
    enabled: precisaContexto,
    staleTime: 120_000,
  });

  const { data: briefings = [], isFetched: briefingsProntos } = useQuery({
    queryKey: ["exp-briefings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("briefings")
        .select("client_id, responses, submitted, created_at")
        .eq("submitted", true);
      return data || [];
    },
    enabled: precisaContexto,
    staleTime: 300_000,
  });


  const { data: pendingApprovalFiles = [], isError: falhouAprovacoes } = useQuery({
    queryKey: ["exp-pending-approvals"],
    queryFn: async () => {
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        supabase.from("files")
          .select("id, client_id, project_id, file_name, created_at")
          .eq("visibility", "approval")
          .eq("requires_approval", true)
          .eq("approval_status", "pending")
          .eq("status", "ready")
          .is("archived_at", null)
          .is("parent_file_id", null)
          .order("created_at", { ascending: true })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.aprovacoes = truncado;
      return linhas;
    },
    ...AO_VIVO,
  });

  // A leitura mais cara da Central (média de 708 ms no banco, 1,1 s medido):
  // a regra de acesso de files roda por linha, e ela trazia TODO material
  // liberado desde sempre. Toda conta que usa esta lista olha no máximo 45
  // dias (saúde: 14 e 45 dias; radar: 30; mensagem: 7), então a janela de 60
  // dias não muda nenhuma nota e corta metade das linhas.
  const { data: releasedFiles = [], isError: falhouArquivos } = useQuery({
    queryKey: ["exp-released-files"],
    queryFn: async () => {
      const desde = new Date(Date.now() - JANELA_DE_ENTREGAS_DIAS * 86_400_000).toISOString();
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        supabase.from("files")
          .select("id, client_id, file_name, created_at, visibility, approval_status")
          .in("visibility", ["client_shared", "approval"])
          .eq("status", "ready")
          .is("archived_at", null)
          .is("parent_file_id", null)
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.arquivos = truncado;
      return linhas;
    },
    staleTime: 60_000,
    ...AO_VIVO_CALMO,
  });
  // Entregue de verdade: compartilhado com o cliente ou aprovado por ele. O que
  // está só "enviado para aprovação" é pendência, não entrega: a Prova da Stop
  // de 25/09 dizia "2 entregas concluídas e liberadas" e, três linhas abaixo,
  // "2 materiais aguardando sua aprovação" (os mesmos dois).
  const entreguesFiles = useMemo(
    () => (releasedFiles as any[]).filter(ehEntregue),
    [releasedFiles],
  );
  // O Marco 90 é o único que conta a história inteira ("N entregas no total,
  // M neste trimestre"): a lista sem janela só é lida quando ele vai ser gerado.
  const precisaHistoriaDeEntregas = generatorOpen && genRitual === "marco_90";
  const { data: liberadosDesdeSempre = [], isFetched: historiaDeEntregasPronta } = useQuery({
    queryKey: ["exp-released-files-todos"],
    queryFn: async () => {
      const { linhas } = await buscarTodas<any>((de, ate) =>
        supabase.from("files")
          .select("id, client_id, created_at")
          .in("visibility", ["client_shared", "approval"])
          .eq("status", "ready")
          .is("archived_at", null)
          .is("parent_file_id", null)
          .order("created_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      return linhas;
    },
    enabled: precisaHistoriaDeEntregas,
    staleTime: 300_000,
  });

  const { data: allMilestones = [], isFetched: marcosProntos, isError: falhouMarcos } = useQuery({
    queryKey: ["exp-milestones"],
    queryFn: async () => {
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        supabase.from("milestones")
          .select("id, project_id, title, status, target_date, updated_at")
          .is("deleted_at", null)
          .order("target_date", { ascending: true })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.marcos = truncado;
      return linhas;
    },
    enabled: precisaContexto,
    staleTime: 60_000,
    ...AO_VIVO_CALMO,
  });

  // Metricas REAIS do Instagram para os rituais falarem de numeros, nao so
  // de entregas: o que mudou, por que e a decisao.
  const { data: igAllWeeks } = useSocialMetricsWeekly();

  // Estrelas do Ciclo da Semana (checklist de bolso do dono): a Prova de
  // sexta conta quantas etapas do ciclo interno fecharam para cada cliente.
  // A chave da semana e montada com a data LOCAL: toISOString() converte para
  // UTC e, as 22h de segunda no Brasil, ja dizia "terca" e pulava a semana.
  const cycleWeekKey = useMemo(() => localIso(mondayOf(new Date())), []);
  // Três semanas, não só a corrente: na segunda de manhã a semana atual está
  // vazia por definição, e tudo que dependia dela ("tráfego em operação",
  // rotina feita) dizia "sem registro" para um cliente que rodou a semana
  // inteira anterior.
  const cycleSince = useMemo(
    () => localIso(addDays(new Date(`${cycleWeekKey}T00:00:00`), -14)),
    [cycleWeekKey],
  );
  const { data: cycleRowsAll, isFetched: cicloPronto } = useQuery({
    queryKey: ["weekly-cycle-ritual", cycleWeekKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weekly_cycle_progress")
        .select("client_id, area, step, week_start")
        .gte("week_start", cycleSince);
      // Erro sobe: o React Query mantem o dado anterior e expoe isError, em
      // vez de a tela mostrar "sem registro" como se fosse verdade.
      if (error) throw error;
      return (data || []) as Array<{ client_id: string; area: string; step: number; week_start: string }>;
    },
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO,
  });
  // A semana corrente continua sendo a referência da rotina "desta semana".
  const cycleRows = useMemo(
    () => (cycleRowsAll || []).filter((row) => row.week_start === cycleWeekKey),
    [cycleRowsAll, cycleWeekKey],
  );
  const cycleDoneByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of cycleRows || []) {
      // Social e tráfego contam: a Prova de sexta fala do ciclo inteiro.
      if (row.step <= 6 && (row.area === "social" || row.area === "trafego")) {
        map.set(row.client_id, (map.get(row.client_id) || 0) + 1);
      }
    }
    return map;
  }, [cycleRows]);

  // Quem tem o checklist de TRÁFEGO sendo marcado: prova de que a frente de
  // campanhas está em operação de verdade, independente de carteira.
  const trafegoEmOperacao = useMemo(() => {
    const set = new Set<string>();
    for (const row of cycleRowsAll || []) {
      if (row.area === "trafego") set.add(row.client_id);
    }
    return set;
  }, [cycleRowsAll]);

  // O dossiê ATUAL de cada cliente (geral e por projeto). É a fonte de verdade
  // do "onde estamos": o MCP grava aqui, e a mensagem do grupo lia outra
  // tabela (project_memory) - por isso o dossiê mudava e a mensagem não.
  // Regra do dono: a leitura e SEMPRE do dossie GERAL final (nunca o de um
  // projeto por ser mais recente), comparado com a versao anterior para a
  // progressao. lerDossiesDaCarteira faz isso em duas consultas.
  // O texto inteiro dos dossiês da carteira (centenas de KB): só quando a tela
  // fala com o cliente. A caixa do dossiê no perfil tem leitura própria.
  const { data: expDossieMap, isFetched: dossiesProntos } = useQuery({
    queryKey: ["exp-dossies"],
    // Sem try/catch: falha na leitura sobe para o React Query, que preserva o
    // mapa anterior em vez de trocar todos os dossies por "sem dossie".
    queryFn: () => lerDossiesDaCarteira(),
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });
  const dossieDe = (clientId: string): DossieGeralDoCliente | null => expDossieMap?.get(clientId) ?? null;

  // Todas as versoes recentes do dossie geral: a linha do tempo mostra cada
  // reescrita como um evento, com o motivo.
  const { data: expDossieVersoes = [] } = useQuery({
    queryKey: ["exp-dossie-versoes"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { linhas } = await buscarTodas<any>((de, ate) =>
        (supabase as any)
          .from("client_dossiers")
          .select("id, client_id, project_id, dossier_type, version, change_reason, source, created_at")
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      return linhas;
    },
    // ~850 versões em 60 dias (a reescrita automática gera uma por movimento):
    // só a aba Histórico usa.
    enabled: precisaHistorico,
    staleTime: 60_000,
    ...AO_VIVO_CALMO,
  });

  // O plano desta semana pela esteira (foco, feito, proximos), um por cliente.
  const { data: expPlanos = [], isFetched: planosProntos } = useQuery({
    queryKey: ["exp-planos", cycleWeekKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("project_memory")
        .select("client_id, metadata, created_at")
        .eq("kind", "esteira_plano")
        .contains("metadata", { week_start: cycleWeekKey })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });
  const planoDe = (clientId: string): { foco: string; feito: string[]; proximos: Array<{ titulo: string; passo: string; motivo?: string }> } | null => {
    const p = (expPlanos as any[]).find((x) => x.client_id === clientId);
    if (!p?.metadata) return null;
    const m = p.metadata as Record<string, unknown>;
    return { foco: String(m.foco ?? ""), feito: Array.isArray(m.feito) ? (m.feito as string[]) : [], proximos: Array.isArray(m.proximos) ? (m.proximos as Array<{ titulo: string; passo: string; motivo?: string }>) : [] };
  };

  // Vendas registradas nos ultimos 30 dias: o numero que paga o anuncio
  // (a mensagem le 7; o historico e o perfil leem 30).
  const { data: expVendas = [], isFetched: vendasProntas } = useQuery({
    queryKey: ["exp-vendas"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("ads_sales")
        .select("client_id, sold_at, campaign_name, channel, quantity, value")
        .gte("sold_at", desde);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });
  const vendasDe = (clientId: string, dias = 7): { total: number; receita: number; porCampanha: string[] } => {
    const corte = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
    const linhas = (expVendas as any[]).filter((v) => v.client_id === clientId && String(v.sold_at) >= corte);
    const total = linhas.reduce((t, v) => t + Math.max(1, Number(v.quantity) || 1), 0);
    const receita = linhas.reduce((t, v) => t + (Number(v.value) || 0), 0);
    const porCampanha = Array.from(new Set(linhas.map((v) => String(v.campaign_name || "")).filter(Boolean)));
    return { total, receita, porCampanha };
  };

  // Tarefas concluídas nos últimos 7 dias: o trabalho real da semana, com nome.
  // Sem isto a mensagem só sabia de arquivo liberado e etapa de checklist.
  const { data: expTasksDone = [], isFetched: tarefasProntas } = useQuery({
    queryKey: ["exp-tasks-done", cycleWeekKey],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - 7);
      const { linhas } = await buscarTodas<any>((de, ate) =>
        (supabase as any)
          .from("tasks")
          .select("id, title, project_id, updated_at, workstream")
          .eq("status", "done")
          .is("deleted_at", null)
          .gte("updated_at", desde.toISOString())
          .order("updated_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      return linhas;
    },
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });
  const igByClient = useMemo(() => {
    const bruto = new Map<string, SocialMetricsWeek[]>();
    for (const row of igAllWeeks || []) {
      const list = bruto.get(row.client_id) || [];
      list.push(row);
      bruto.set(row.client_id, list);
    }
    // Cliente com duas contas de Instagram: o ritual fala de UMA (a principal),
    // nunca das duas misturadas - misturar comparava a semana de uma conta
    // com a mesma semana da outra e inventava variacao.
    const map = new Map<string, SocialMetricsWeek[]>();
    for (const [clientId, rows] of bruto) map.set(clientId, contaPrincipal(rows));
    return map;
  }, [igAllWeeks]);

  // A história de todos os clientes, ao vivo: é ela que faz a mensagem do
  // grupo mudar sozinha quando o dossiê é atualizado pelo agente, um avulso é
  // marcado no Ciclo ou uma decisão entra no Studio. Sem esta consulta, a
  // mensagem lia só arquivos e publicações — e saía igual a semana inteira.
  // Recorte: so os clientes carregados e os ultimos 60 dias. Antes a consulta
  // paginava a tabela inteira (todos os clientes, desde sempre) a cada 20 s.
  const idsDosClientes = useMemo(
    () => ((clients ?? []) as any[]).map((c) => String(c.id)).sort(),
    [clients],
  );
  const { data: expMemory = [], isFetched: memoriaPronta, isError: falhouMemoria } = useQuery({
    queryKey: ["exp-memory"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        (supabase as any)
          .from("project_memory")
          .select("client_id, kind, title, content, metadata, created_at")
          .gte("created_at", desde)
          .in("client_id", idsDosClientes)
          .in("kind", KINDS_DA_MEMORIA_DA_CENTRAL)
          .order("created_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.memoria = truncado;
      return linhas;
    },
    // Sem clientes carregados nao ha o que recortar: espera a lista chegar.
    enabled: precisaContexto && idsDosClientes.length > 0,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });

  // Campanhas reais: a mensagem fala de anúncio com número, não com promessa.
  const { data: adsWeekRows = [] } = useAdsDaily(undefined, 7);
  const { data: adsCampaignList = [] } = useAdsCampaigns();

  // O calendário editorial de todos os clientes: peça pronta com nome. Sem
  // isto a mensagem dependia só de arquivo liberado nos últimos 7 dias, e
  // caía no genérico quando o material tinha sido aprovado antes disso.
  const { data: expPautas = [], isFetched: pautasProntas, isError: falhouPautas } = useQuery({
    queryKey: ["exp-pautas"],
    queryFn: async () => {
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        supabase.from("editorial_posts")
          .select("client_id, title, production_status")
          .is("archived_at", null)
          .in("production_status", ["ready", "production"])
          .order("updated_at", { ascending: false })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.pautas = truncado;
      return linhas;
    },
    enabled: precisaContexto,
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });

  const { data: allPublications = [], isError: falhouPublicacoes } = useQuery({
    queryKey: ["exp-publications"],
    queryFn: async () => {
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        supabase.from("editorial_publications")
          // O título vem junto: "a publicação do dia 12/09" não diz nada ao
          // cliente; "o reel da vitrine, dia 12/09" diz.
          .select("id, client_id, status, platform, scheduled_at, published_at, post:editorial_posts(title)")
          .in("status", ["scheduled", "published"])
          .order("scheduled_at", { ascending: true })
          .range(de, ate),
        LER_TUDO,
      );
      cortes.current.publicacoes = truncado;
      return linhas;
    },
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });

  // Ponte com o Ciclo: rituais marcados na esteira nesta semana (por
  // cliente), para a Central mostrar "feito no Ciclo" mesmo sem relatorio.
  // Mesma chave local da semana: 22h de segunda no Brasil continua sendo
  // esta segunda, nao a terca em UTC.
  const semanaDoCiclo = cycleWeekKey;
  const { data: rituaisDoCiclo = [] } = useQuery({
    queryKey: ["cycle-rituals-central", semanaDoCiclo],
    queryFn: async () => {
      const { data } = await (supabase as any).from("cycle_rituals").select("client_id, ritual_key, source, done_at").eq("week_start", semanaDoCiclo);
      return (data ?? []) as Array<{ client_id: string; ritual_key: string; source: string; done_at: string }>;
    },
    staleTime: 30_000,
  });
  const { data: reports = [], isFetched: reportsLidos, isLoading: carregandoRelatorios, isError: erroNosRelatorios, refetch: releRelatorios } = useQuery({
    queryKey: ["exp-reports"],
    queryFn: async () => {
      const { linhas, truncado } = await buscarTodas<any>((de, ate) =>
        readCentralReportPage((withReviewVersion) =>
        supabase.from("reports")
          .select(`id, client_id, project_id, title, status, metrics, summary, next_steps, highlights, created_at, period_start, period_end, ${withReviewVersion ? "review_version, " : ""}client:profiles!reports_client_id_fkey(full_name, company_name)`)
          .order("created_at", { ascending: false })
          .range(de, ate)),
        LER_TUDO,
      );
      cortes.current.relatorios = truncado;
      return linhas;
    },
    // Toda ação da Central sobre relatório invalida esta chave na hora; o
    // intervalo só cobre o que é escrito por fora (Hermes, MCP).
    staleTime: 30_000,
    ...AO_VIVO_CALMO,
  });

  // Tudo o que a escrita de mensagem lê já chegou? O gerador, "Escrever com
  // IA" e "Aprimorar" esperam por isto: sem a trava, um clique logo depois de
  // abrir a tela escrevia com a memória vazia.
  const contextoPronto = adsWalletsProntos && briefingsProntos && marcosProntos && cicloPronto && dossiesProntos
    && planosProntos && vendasProntas && tarefasProntas && (memoriaPronta || idsDosClientes.length === 0) && pautasProntas
    && (!precisaHistoriaDeEntregas || historiaDeEntregasPronta);
  const avisarContextoCarregando = () => toast.info("Carregando os dados dos clientes. Tente de novo em alguns segundos.");

  // Carteira recorrente completa: ativos E em onboarding entram nos rituais.
  const clientesParaFoto = useMemo(() => ((clients ?? []) as any[]).map((c) => ({ id: String(c.id), nome: c.company_name || c.full_name, avatar_url: c.avatar_url })), [clients]);
  const { fotoDe } = useFotosDosClientes(clientesParaFoto);

  const portfolioClients = useMemo(
    () =>
      (clients || []).filter(
        (c: any) =>
          ["active", "onboarding"].includes(c.plan_status || "active") &&
          (c.client_type || "recurring") !== "one_off" &&
          !isInternalClient(c)
      ),
    [clients]
  );

  const oneOffClients = useMemo(
    () => (clients || []).filter((c: any) => (c.client_type || "recurring") === "one_off" && !isInternalClient(c)),
    [clients]
  );

  // ───────── Saúde da carteira: nota explicável, sem inventar dado ─────────
  const healthRows = useMemo<ClientHealth[]>(() => {
    const today = new Date();
    const lastReleaseByClient = new Map<string, string>();
    (releasedFiles || []).forEach((f: any) => {
      if (f.client_id && !lastReleaseByClient.has(f.client_id)) lastReleaseByClient.set(f.client_id, f.created_at);
    });
    const lastPublishedReportByClient = new Map<string, string>();
    (reports || []).forEach((r: any) => {
      if (r.status === "published" && r.client_id && !lastPublishedReportByClient.has(r.client_id)) {
        lastPublishedReportByClient.set(r.client_id, r.created_at);
      }
    });

    return portfolioClients.map((client: any) => {
      const factors: HealthFactor[] = [];
      const alerts: { kind: string; label: string }[] = [];

      const overdue = (billing || []).filter((b: any) => {
        if (b.client_id !== client.id || b.status !== "pending" || b.type === "ads_recharge") return false;
        const due = new Date(`${b.due_date}T12:00:00`);
        return due < today;
      });
      const overdueTotal = overdue.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
      factors.push({
        label: "Situação financeira",
        weight: 20,
        earned: overdue.length > 0 ? 0 : 20,
        note: overdue.length > 0 ? `${fmt(overdueTotal)} em atraso` : "Sem atrasos",
      });
      if (overdue.length > 0) alerts.push({ kind: "financeiro", label: `${fmt(overdueTotal)} vencidos` });

      const clientPending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
      const oldestPendingDays = clientPending.length
        ? Math.max(...clientPending.map((f: any) => daysSince(f.created_at) || 0))
        : null;
      factors.push({
        label: "Respostas e aprovações",
        weight: 15,
        earned: oldestPendingDays === null ? 15 : oldestPendingDays > 7 ? 0 : oldestPendingDays > 3 ? 7 : 12,
        note: oldestPendingDays === null ? "Nada pendente" : `Aprovação parada há ${oldestPendingDays}d`,
      });
      if (oldestPendingDays !== null && oldestPendingDays > 4) {
        alerts.push({ kind: "aprovacao", label: `Material parado há ${oldestPendingDays} dias` });
      }

      const lastRelease = lastReleaseByClient.get(client.id) || null;
      const releaseDays = daysSince(lastRelease);
      // "Sem avanço" se mede a partir do que o cliente VIU por último: a última
      // entrega liberada ou, se ainda não houve nenhuma, o dia em que ele
      // entrou. Antes, "nenhuma entrega" virava "45+ dias sem avanço" e um
      // cliente que chegou esta semana aparecia em vermelho com alerta de risco.
      const daysInHouse = daysSince(client.created_at);
      const onboarding = lastRelease === null && daysInHouse !== null && daysInHouse <= 21;
      const daysWithoutProgress = releaseDays ?? daysInHouse;
      factors.push({
        label: onboarding ? "Avanço percebido (onboarding)" : "Avanço percebido (entregas)",
        weight: 25,
        earned: onboarding
          ? null // sem dado ainda: não pune nem premia, e o peso sai da conta
          : daysWithoutProgress === null
            ? 0
            : daysWithoutProgress <= 14 ? 25 : daysWithoutProgress <= 45 ? 13 : 0,
        note: onboarding
          ? `Cliente novo: ${daysInHouse}d de casa, primeira entrega ainda não liberada`
          : lastRelease === null
            ? (daysInHouse ?? 0) > JANELA_DE_ENTREGAS_DIAS
              ? `Nenhuma entrega liberada nos últimos ${JANELA_DE_ENTREGAS_DIAS} dias`
              : `Nenhuma entrega liberada em ${daysWithoutProgress ?? "?"}d de casa`
            : `Última entrega há ${releaseDays}d`,
      });
      if (onboarding) {
        if ((daysInHouse ?? 0) >= 10) {
          alerts.push({ kind: "onboarding", label: `${daysInHouse}d de casa sem primeira entrega: liberar algo esta semana` });
        }
      } else if (daysWithoutProgress === null || daysWithoutProgress > 45) {
        alerts.push({ kind: "risco", label: "45+ dias sem avanço percebido" });
      }

      const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at);
      const stalled = clientProjects.filter((p: any) => (daysSince(p.updated_at || p.created_at) || 0) >= 14 && (p.progress || 0) < 100);
      factors.push({
        label: "Ritmo dos projetos",
        weight: 15,
        earned: clientProjects.length === 0 ? null : stalled.length === 0 ? 15 : stalled.length < clientProjects.length ? 7 : 0,
        note: clientProjects.length === 0 ? "Sem projeto ativo (sem dado)" : stalled.length === 0 ? "Tudo em movimento" : `${stalled.length} projeto(s) parados 14d+`,
      });

      const lastReport = lastPublishedReportByClient.get(client.id) || null;
      const reportDays = daysSince(lastReport);
      // Cliente com menos de 35 dias de casa ainda não teve o primeiro
      // relatório por definição: sem dado, não sem comunicação.
      const cedoParaRelatorio = reportDays === null && daysInHouse !== null && daysInHouse < 35;
      factors.push({
        label: "Comunicação publicada",
        weight: 10,
        earned: cedoParaRelatorio ? null : reportDays === null ? 0 : reportDays <= 35 ? 10 : 4,
        note: cedoParaRelatorio
          ? `Primeiro relatório previsto até o dia 35 (hoje: ${daysInHouse}d)`
          : reportDays === null ? "Nenhum relatório publicado" : `Último há ${reportDays}d`,
      });

      // Percepção de valor: agora com fonte real, o Pulso respondido pelo cliente.
      const pulse = latestPulse(client);
      const pulseAge = pulse ? daysSince(pulse.date) : null;
      const pulseFresh = pulse && pulseAge !== null && pulseAge <= 60;
      factors.push({
        label: "Percepção de valor (Pulso)",
        weight: 15,
        earned: pulseFresh ? [0, 0, 3, 7, 12, 15][pulse!.score] ?? 7 : null,
        note: pulseFresh
          ? `Nota ${pulse!.score}/5 há ${pulseAge}d`
          : pulse
            ? `Nota antiga (${pulseAge}d) · pedir novo Pulso`
            : "Cliente ainda não avaliou",
      });
      if (pulseFresh && pulse!.score <= 2) {
        alerts.push({ kind: "pulso", label: `Pulso crítico: nota ${pulse!.score}/5, retornar em 24h` });
      }

      const available = factors.filter((f) => f.earned !== null);
      const availableWeight = available.reduce((s, f) => s + f.weight, 0);
      const earned = available.reduce((s, f) => s + (f.earned || 0), 0);
      const score = availableWeight > 0 ? Math.round((earned / availableWeight) * 100) : null;
      const level: ClientHealth["level"] =
        alerts.some((a) => a.kind === "risco" || a.kind === "pulso") || (score !== null && score < 60)
          ? "risk"
          : score !== null && score < 80
            ? "attention"
            : "healthy";

      return { client, score, level, factors, alerts, pulse };
    }).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  }, [portfolioClients, billing, pendingApprovalFiles, releasedFiles, projects, reports]);

  const healthy = healthRows.filter((r) => r.level === "healthy").length;
  const attention = healthRows.filter((r) => r.level === "attention").length;
  const risk = healthRows.filter((r) => r.level === "risk").length;
  const pulseAnswers = healthRows.filter((r) => r.pulse).length;

  const draftReports = (reports || []).filter((r: any) => r.status !== "published");
  const publishedReports = (reports || []).filter((r: any) => r.status === "published");
  // Rascunho guardado que saiu da fila (publicado ou descartado) ou que ficou
  // igual ao que está salvo deixa de ser guardado. Só depois da leitura chegar.
  useEffect(() => {
    if (!reportsLidos) return;
    setDraftEdits((prev) => {
      const ids = Object.keys(prev);
      if (!ids.length) return prev;
      const naFila = new Map<string, any>((reports || []).filter((r: any) => r.status !== "published").map((r: any) => [r.id, r]));
      const fica: Record<string, { summary: string; next_steps: string }> = {};
      let mudou = false;
      for (const id of ids) {
        const r = naFila.get(id);
        if (!r || (prev[id].summary === (r.summary || "") && prev[id].next_steps === (r.next_steps || ""))) { mudou = true; continue; }
        fica[id] = prev[id];
      }
      return mudou ? fica : prev;
    });
  }, [reportsLidos, reports, setDraftEdits]);

  // ───────── Radar do mês: oportunidades com foco em retenção e expansão ─────────
  /**
   * O Radar do mês: ideias de diferenciação por cliente RECORRENTE, montadas
   * do contexto real dele (frentes, materiais recentes, publicações, Pulso,
   * crescimento medido nos relatórios). A leitura é a do marketing de
   * diferenciação (Fator X): a ideia nasce do que o cliente JÁ tem, e a
   * agência chega com ela pronta antes de ele pedir. Avulso fica de fora: o
   * ritual é da carteira; a reativação de avulso vive na aba Avulsos.
   */
  const opportunities = useMemo<RadarIdea[]>(() => {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000);

    const buildContext = (client: any): RadarClientContext => {
      const clientProjects = (projects || []).filter(
        (p: any) => p.client_id === client.id && !p.deleted_at,
      );
      const activeProjects = clientProjects.filter((p: any) => p.status !== "done");
      const services = [
        ...new Set(
          (activeProjects.length > 0 ? activeProjects : clientProjects)
            .map((p: any) => p.project_type)
            .filter(Boolean),
        ),
      ] as string[];

      const clientPubs = (allPublications || []).filter(
        (p: any) => p.client_id === client.id && p.status === "published",
      );
      const publishedLast30 = clientPubs.filter(
        (p: any) => p.published_at && new Date(p.published_at) >= d30,
      ).length;

      const recentReleased = (releasedFiles || []).filter(
        (f: any) => f.client_id === client.id,
      );
      const releasedLast30 = recentReleased.filter(
        (f: any) => new Date(f.created_at) >= d30,
      ).length;

      const firstProject = clientProjects
        .map((p: any) => p.created_at)
        .filter(Boolean)
        .sort()[0];
      const startedDays = daysSince(firstProject);
      const monthsTogether = startedDays !== null ? Math.max(1, Math.round(startedDays / 30)) : 1;

      const health = healthRows.find((row) => row.client.id === client.id);

      // Crescimento real de contatos entre a primeira e a última medição.
      const clientReports = (reports || []).filter(
        (r: any) => r.client_id === client.id && r.status === "published",
      );
      const growth = buildGrowthSeries(clientReports as any[]);
      let contactsTrendPct: number | null = null;
      if (growth.length >= 2) {
        const first = growth[0].contacts;
        const last = growth[growth.length - 1].contacts;
        if (first > 0 && last !== first) {
          contactsTrendPct = Math.round(((last - first) / first) * 100);
        }
      }

      return {
        clientId: client.id,
        clientName: client.company_name || client.full_name,
        services,
        serviceLabels: services.map((s) => FRONT_LABELS[s] || s).filter(Boolean),
        pulseScore: health?.pulse?.score ?? null,
        pulseAgeDays: health?.pulse ? daysSince(health.pulse.date) : null,
        releasedLast30,
        publishedLast30,
        publishedTotal: clientPubs.length,
        hasPublishedReport: clientReports.length > 0,
        monthsTogether,
        isOneOff: false,
        idleDays: null,
        month: now.getMonth(),
        recentMaterials: recentReleased.slice(0, 3).map((f: any) => f.file_name),
        contactsTrendPct,
        pendingApprovals: (pendingApprovalFiles || []).filter(
          (f: any) => f.client_id === client.id,
        ).length,
      };
    };

    const out: RadarIdea[] = [];
    healthRows.forEach((row) => {
      out.push(...buildRadarIdeas(buildContext(row.client), 3));
    });
    return out.sort((a, b) => b.score - a.score);
  }, [healthRows, projects, releasedFiles, allPublications, reports, pendingApprovalFiles]);

  // IA na frente, playbook depois. É esta lista que a tela e as mensagens usam.
  const allRadarIdeas = useMemo<RadarIdea[]>(
    () => [...Object.values(aiIdeas).flat(), ...opportunities],
    [aiIdeas, opportunities],
  );

  /**
   * Gera as ideias do mês com IA e busca na web, a partir do contexto real do
   * cliente. O motor local continua como base; a IA entra para trazer ideias
   * específicas do nicho, ancoradas em tendência atual.
   */
  const generateAiIdeas = async () => {
    if (!aiClientId || aiLoading) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("radar-ideas", {
        body: { client_id: aiClientId },
      });
      if (error) throw new Error(error.message || "O gerador não respondeu.");
      if (data?.error) throw new Error(data.error);
      const stamp = Date.now();
      const mapped: RadarIdea[] = (data?.ideas || []).map((idea: any, index: number) => ({
        id: `${aiClientId}:ia-${stamp}-${index}`,
        lens: "tendencia" as const,
        source: "ia" as const,
        title: `${data?.client_name || "Cliente"}: ${String(idea?.titulo || "Ideia do mês")}`,
        pitch: String(idea?.descricao || ""),
        moment: "",
        whyNow: String(idea?.por_que_agora || ""),
        moves: Array.isArray(idea?.passos) ? idea.passos.slice(0, 4).map(String) : [],
        signal: String(idea?.sinal || "O sinal principal da frente que a ideia move."),
        internal: {
          offer: String(idea?.interno_oferta || "A definir pela equipe"),
          range: [
            Number(idea?.interno_faixa_min) || 0,
            Number(idea?.interno_faixa_max) || 0,
          ] as [number, number],
          effort:
            idea?.interno_esforco === "alto" || idea?.interno_esforco === "baixo"
              ? idea.interno_esforco
              : ("medio" as const),
        },
        score: 200 - index,
      }));
      if (mapped.length === 0) throw new Error("A IA não devolveu ideias válidas.");
      setAiIdeas((previous) => ({ ...previous, [aiClientId]: mapped }));
      toast.success(
        data?.web_search
          ? "Ideias geradas com busca na web."
          : "Ideias geradas (sem busca na web disponível neste momento).",
      );
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível gerar as ideias agora.");
    } finally {
      setAiLoading(false);
    }
  };

  // ───────── Rascunhos: montagem com dados reais e processo explicado ─────────
  // Estrutura oficial de cada mensagem: o que fizemos, por que fizemos,
  // qual sinal vamos observar e quando revisamos.
  const buildDraft = (client: any, ritual: string, generationProjects?: CentralGenerationProject[]) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const clientProjects = generationProjects ?? (projects || []).filter((p: any) => p.client_id === client.id && !p.deleted_at);
    const activeProjects = clientProjects.filter((p: any) => p.status !== "done");
    const activeProject = activeProjects[0] || clientProjects[0] || null;
    const releasedWeek = entreguesFiles.filter(
      (f: any) => f.client_id === client.id && new Date(f.created_at) >= weekAgo
    );
    const released7d = releasedWeek.length;
    const releasedNames = releasedWeek.slice(0, 3).map((f: any) => f.file_name).join(", ");
    const pendingFiles = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
    const pending = pendingFiles.length;
    const pendingNames = pendingFiles.slice(0, 2).map((f: any) => f.file_name).join(", ");
    const name = client.company_name || client.full_name;
    const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    // Frentes descritas com o sinal que cada uma deve mover
    const frontsText = activeProjects
      .map((p: any) => `• ${FRONT_LABELS[p.project_type] || "Projeto"} (${p.name}): sinal observado: ${FRONT_SIGNALS[p.project_type] || FRONT_SIGNALS.other}`)
      .join("\n");

    // Próximas etapas com data (marcos dos projetos do cliente)
    const projectIds = new Set(clientProjects.map((p: any) => p.id));
    const nextMilestones = (allMilestones || [])
      .filter((m: any) => projectIds.has(m.project_id) && m.status !== "completed" && m.target_date)
      .slice(0, 2)
      .map((m: any) => `${m.title} (previsão ${new Date(`${m.target_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})`)
      .join("; ");

    // Publicações confirmadas
    const clientPubs = (allPublications || []).filter((p: any) => p.client_id === client.id);
    const scheduledPubs = clientPubs.filter((p: any) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) >= now);
    const publishedWeek = clientPubs.filter((p: any) => p.status === "published" && p.published_at && new Date(p.published_at) >= weekAgo);
    const nextPubText = scheduledPubs[0]
      ? new Date(scheduledPubs[0].scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })
      : null;

    const fridayReview = "Na sexta-feira voltamos com a Prova de Movimento mostrando o que avançou e o que aprendemos.";
    const mondayReview = "Na segunda-feira abrimos o próximo ciclo com a nova Rota da Semana.";

    // Âncora da semana: segunda 00:00. O meio e o fim da semana falam do que
    // aconteceu DESDE SEGUNDA, não de uma janela móvel de 7 dias - é isso que
    // faz a Rota, o Check e a Prova contarem UMA história contínua, sem
    // repetição entre elas.
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart.getTime() + 5 * 86400000);
    const weekRangeLabel = `${weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${weekEnd.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;

    const releasedSinceMonday = entreguesFiles.filter(
      (f: any) => f.client_id === client.id && new Date(f.created_at) >= weekStart,
    );
    const releasedMondayNames = releasedSinceMonday.slice(0, 6).map((f: any) => f.file_name).join(", ");
    const releasedMondayExtra = Math.max(0, releasedSinceMonday.length - 6);
    const publishedSinceMonday = clientPubs.filter(
      (p: any) => p.status === "published" && p.published_at && new Date(p.published_at) >= weekStart,
    );
    // Publicações agendadas para sair ainda ESTA semana.
    const scheduledThisWeek = clientPubs.filter(
      (p: any) =>
        p.status === "scheduled" && p.scheduled_at &&
        new Date(p.scheduled_at) >= now && new Date(p.scheduled_at) <= weekEnd,
    );
    // Etapas com data dentro desta semana: o que a Rota promete atacar.
    const milestonesThisWeek = (allMilestones || [])
      .filter((m: any) => {
        if (!projectIds.has(m.project_id) || m.status === "completed" || !m.target_date) return false;
        const due = new Date(`${m.target_date}T12:00:00`);
        return due >= weekStart && due <= weekEnd;
      })
      .slice(0, 3)
      .map((m: any) => m.title);

    // Foco da semana derivado do que realmente está acontecendo, com variação
    const seed = client.id + ritual;
    const focus = pending > 0
      ? pickVariant([
          `Destravar as aprovações pendentes e colocar as publicações no ar na data certa.`,
          `Fechar o ciclo de aprovações e garantir o calendário rodando sem atraso.`,
          `Aprovações em dia e conteúdo no ar: essa é a virada da semana.`,
        ], seed)
      : nextMilestones
        ? pickVariant([
            `Avançar nas etapas com data marcada: ${nextMilestones}.`,
            `Semana de execução: colocar ${nextMilestones} de pé.`,
            `Foco total em entregar as próximas etapas: ${nextMilestones}.`,
          ], seed)
        : scheduledPubs.length > 0
          ? pickVariant([
              `Manter a cadência de publicações e acompanhar os sinais de cada frente.`,
              `Conteúdo rodando no calendário e olho nos sinais que importam.`,
              `Consistência: publicar no ritmo planejado e medir o que volta.`,
            ], seed)
          : pickVariant([
              `Produzir as próximas entregas e manter a operação em movimento.`,
              `Semana de construção: preparar as entregas que sustentam o próximo ciclo.`,
              `Avançar a produção para chegar na próxima semana com material pronto.`,
            ], seed);

    // Números REAIS do Instagram na conversa: o ritual conta o que mudou,
    // por que e a decisão - nunca só a lista de entregas.
    const igRows = igByClient.get(client.id) || [];
    const igLatest = igRows[0];
    const igPct = (
      field: "followers" | "reach" | "total_interactions",
    ) => {
      const delta = weekDeltaPct(igRows, field);
      return delta == null
        ? ""
        : ` (${delta >= 0 ? "+" : ""}${delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs semana anterior)`;
    };
    const igNumbers = igLatest
      ? [
          `NÚMEROS REAIS DA SEMANA (Instagram)`,
          `Seguidores: ${formatMetricNumber(igLatest.followers)}${igPct("followers")}.`,
          `Alcance: ${formatMetricNumber(igLatest.reach)}${igPct("reach")} · Interações: ${formatMetricNumber(igLatest.total_interactions)}${igPct("total_interactions")}.`,
        ].join("\n")
      : null;
    const igReachDelta = weekDeltaPct(igRows, "reach");
    const igReading =
      igLatest && igReachDelta != null
        ? igReachDelta >= 0
          ? `Leitura dos números: o alcance cresceu ${igReachDelta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% na última semana medida. O conteúdo está chegando em gente nova; a decisão é manter o ritmo e repetir o formato que puxou esse número.`
          : `Leitura dos números: o alcance recuou ${Math.abs(igReachDelta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% na última semana medida. Normal em semana de transição; a decisão é variar formato e horário nas próximas publicações para retomar a curva.`
        : null;

    // Observação/aprendizado derivado do movimento real da semana
    const observation = publishedWeek.length > 0
      ? `Com ${publishedWeek.length} publicação(ões) no ar nesta semana, os próximos dias mostram a resposta do público. Vamos acompanhar os sinais de cada frente e trazer a leitura pronta: o que mudou, o que isso indica e a decisão que tomamos a partir disso.`
      : released7d > 0
        ? `Com as entregas desta semana liberadas, o próximo movimento é colocá-las para trabalhar. Acompanhamos os sinais de cada frente e trazemos a leitura interpretada na próxima atualização.`
        : `Semana de construção interna. Na próxima atualização mostramos o material pronto e o sinal que ele deve mover.`;

    // A ideia do Radar. Se a equipe escolheu uma na aba, é ela; senão vale a
    // mais forte detectada para este cliente. `radarIdeaForClient` devolve só a
    // parte que o cliente pode ler: a leitura comercial nunca chega aqui.
    const chosenIdea =
      allRadarIdeas.find((idea) => idea.id === genIdeaId && idea.id.startsWith(`${client.id}:`)) ||
      allRadarIdeas.find((idea) => idea.id.startsWith(`${client.id}:`)) ||
      null;
    const radarText = chosenIdea ? radarIdeaForClient(chosenIdea) : null;

    const base = {
      client_id: client.id,
      project_id: activeProject?.id || null,
      status: "draft",
      created_by: user?.id || null,
      period_start: weekAgo.toISOString().slice(0, 10),
      period_end: now.toISOString().slice(0, 10),
      metrics: { ritual_type: ritual } as any,
      internal_notes:
        "Rascunho gerado pela Central de Experiência com dados reais do painel (entregas, aprovações e projetos). Revise, complete e publique.",
    };

    if (ritual === "meio_semana") {
      // O meio de semana ATUALIZA a Rota de segunda: fala do que mudou desde
      // ela, nunca repete a abertura.
      const midOpening = pickVariant([
        `Meio de semana, ${name}. Atualização direta do que mudou desde a Rota de segunda.`,
        `${name}, check de quarta: o que já andou desde a abertura da semana e o que fecha até sexta.`,
        `Metade da semana vencida, ${name}. Aqui está o movimento real desde segunda.`,
      ], seed);
      return {
        ...base,
        title: `Check do Meio da Semana · ${dateLabel}`,
        summary: [
          midOpening,
          ``,
          `O QUE MUDOU DESDE SEGUNDA`,
          releasedSinceMonday.length > 0
            ? `${releasedSinceMonday.length} entrega(s) liberadas no painel desde a abertura da semana: ${releasedMondayNames}${releasedMondayExtra > 0 ? ` e mais ${releasedMondayExtra}` : ""}. Cada uma passou pela revisão interna antes de chegar até você.`
            : `As entregas da semana estão em produção e revisão interna. Elas aparecem no painel no momento em que forem liberadas, e você recebe o aviso.`,
          publishedSinceMonday.length > 0
            ? `${publishedSinceMonday.length} publicação(ões) já foram ao ar nesta semana, no calendário aprovado.`
            : ``,
          igNumbers ? `\n${igNumbers}` : ``,
          igReading || ``,
          ``,
          `O QUE FECHA ATÉ SEXTA`,
          milestonesThisWeek.length > 0
            ? `Etapas com data nesta semana: ${milestonesThisWeek.join("; ")}.`
            : scheduledThisWeek.length > 0
              ? `${scheduledThisWeek.length} publicação(ões) agendada(s) para sair ainda nesta semana.`
              : `Fechamento da produção em andamento para a Prova de Movimento de sexta chegar com a semana completa.`,
          ``,
          pending > 0
            ? `O QUE DEPENDE DE VOCÊS\n${pending} material(is) aguardando aprovação (${pendingNames}). Sua aprovação libera o agendamento na data planejada. Sem ela, o cronograma da semana trava.`
            : `Nenhuma pendência do lado de vocês. Seguimos no planejado.`,
          ``,
          `QUANDO REVISAMOS: ${fridayReview}`,
        ].filter(Boolean).join("\n"),
        next_steps: pending > 0
          ? `Aprovar os materiais pendentes ainda hoje (${pendingNames}). Leva 2 minutos na área de Aprovações.`
          : "Nenhuma ação necessária agora. A próxima parada é a Prova de Movimento na sexta.",
        highlights: `Desde segunda: ${releasedSinceMonday.length} entrega(s), ${publishedSinceMonday.length} publicação(ões) no ar`,
      };
    }
    if (ritual === "prova_movimento") {
      // A sexta fecha a história que a Rota abriu: puxa TUDO o que a semana
      // entregou, desde segunda, com nome e sobrenome, e aponta a próxima.
      const closeOpening = pickVariant([
        `Fechando a semana de ${weekRangeLabel}, ${name}. Aqui está tudo o que ela entregou.`,
        `${name}, sexta é dia de prova: o balanço completo da semana de ${weekRangeLabel}.`,
        `Semana de ${weekRangeLabel} encerrada, ${name}. O que prometemos na Rota e o que aconteceu de fato:`,
      ], seed);
      return {
        ...base,
        title: `Prova de Movimento · ${dateLabel}`,
        summary: [
          closeOpening,
          ``,
          `TUDO O QUE A SEMANA ENTREGOU`,
          releasedSinceMonday.length > 0
            ? `${releasedSinceMonday.length} entrega(s) concluídas e liberadas no painel: ${releasedMondayNames}${releasedMondayExtra > 0 ? ` e mais ${releasedMondayExtra}` : ""}.`
            : `Semana de construção interna: produção e preparação das próximas entregas. Elas aparecem no painel na hora em que forem liberadas.`,
          publishedSinceMonday.length > 0
            ? `${publishedSinceMonday.length} publicação(ões) foram ao ar, no calendário aprovado por vocês.`
            : ``,
          (cycleDoneByClient.get(client.id) || 0) > 0
            ? `Bastidores: nosso ciclo semanal de operação fechou ${cycleDoneByClient.get(client.id)} de 6 etapas para você (produção, painel, aprovação e agendamento).`
            : ``,
          igNumbers ? `\n${igNumbers}` : ``,
          ``,
          `POR QUE FIZEMOS`,
          activeProjects.length > 0
            ? `Cada frente tem um papel no seu crescimento:\n${frontsText}`
            : `Cada entrega desta fase constrói a base que sustenta o próximo ciclo de resultados.`,
          ``,
          `O QUE VAMOS OBSERVAR`,
          [igReading, observation].filter(Boolean).join("\n"),
          ``,
          `PRÓXIMOS PASSOS`,
          [
            nextMilestones ? `Avançar em ${nextMilestones}.` : ``,
            nextPubText ? `Próxima publicação confirmada: ${nextPubText}.` : ``,
            `A nova Rota chega segunda com o plano da próxima semana, continuando desta linha do tempo.`,
          ].filter(Boolean).join("\n"),
          ``,
          pending > 0 ? `PENDÊNCIA: ${pending} material(is) aguardando sua aprovação (${pendingNames}).` : `PENDÊNCIA: nenhuma. Tudo em dia do seu lado.`,
          ``,
          `QUANDO REVISAMOS: ${mondayReview}`,
        ].filter(Boolean).join("\n"),
        next_steps: pending > 0
          ? `Aprovar ${pendingNames} para liberarmos o agendamento. Depois disso, o próximo passo é nosso: abrir o ciclo de segunda com a nova Rota.`
          : nextMilestones
            ? `O próximo passo é nosso: avançar em ${nextMilestones}. Você acompanha tudo pelo painel e a nova Rota chega segunda.`
            : `O próximo passo é nosso: preparar o ciclo da próxima semana. A nova Rota chega segunda-feira com o plano completo.`,
        highlights: `Semana ${weekRangeLabel}: ${releasedSinceMonday.length} entrega(s) e ${publishedSinceMonday.length} publicação(ões) no ar`,
      };
    }
    if (ritual === "radar_aceleriq") {
      return {
        ...base,
        title: `Radar Aceleriq · ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`,
        summary: [
          `${name}, o Radar é o nosso ritual de antecipação: uma vez por mês trazemos uma ideia que enxergamos antes de você precisar pedir.`,
          ``,
          `A IDEIA DESTE MÊS`,
          radarText
            ? radarText.opportunity
            : `Dar um passo de diferenciação: sair do que todo mundo do seu setor faz e usar o que só a sua empresa tem.`,
          ``,
          `POR QUE AGORA`,
          radarText
            ? radarText.whyNow
            : `Cruzamos a movimentação do seu painel (entregas, publicações e sinais das frentes) e este é o momento com melhor relação esforço x retorno.`,
          ``,
          `COMO A GENTE FAZ`,
          radarText
            ? radarText.recommendation
            : `1. Leitura do que já existe e funciona hoje\n2. Produção da peça central da ideia\n3. Acompanhamento do sinal para decidir o próximo passo`,
          ``,
          `O QUE VAMOS OLHAR DEPOIS`,
          radarText
            ? radarText.signal
            : `O sinal principal da frente que essa ideia move.`,
          ``,
          `COMO RESPONDER (basta dizer no grupo):`,
          `1. Pode seguir  ·  2. Deixar para o próximo ciclo  ·  3. Quero entender melhor`,
        ].filter(Boolean).join("\n"),
        next_steps: "Escolher uma das três opções acima. Se aprovado, entra na próxima janela de produção e você acompanha tudo pelo painel.",
        highlights: "1 ideia de diferenciação do mês, com o motivo e o sinal que vamos acompanhar",
      };
    }
    if (ritual === "marco_90") {
      // O Marco 90 conta a história inteira: lê a lista sem janela (carregada só para ele).
      const clientFiles = (liberadosDesdeSempre || []).filter((f: any) => f.client_id === client.id);
      const d90 = new Date(now.getTime() - 90 * 86400000);
      const released90 = clientFiles.filter((f: any) => new Date(f.created_at) >= d90).length;
      const before90 = clientFiles.length - released90;
      const totalReleased = clientFiles.length;
      const doneProjects = clientProjects.filter((p: any) => p.status === "done").length;
      const totalPublished = clientPubs.filter((p: any) => p.status === "published").length;
      const clientHealthRow = healthRows.find((h) => h.client.id === client.id);
      const blockers = clientHealthRow?.alerts || [];
      return {
        ...base,
        period_start: d90.toISOString().slice(0, 10),
        title: `Marco 90 · ${name}`,
        summary: [
          `${name}, a cada 90 dias paramos para olhar o caminho inteiro: de onde saímos, o que foi construído e para onde vamos. É fácil esquecer como as coisas estavam antes; este registro existe para isso.`,
          ``,
          `ONDE ESTÁVAMOS`,
          before90 > 0
            ? `Há 90 dias o painel registrava ${before90} entrega(s) construídas. De lá para cá, somamos mais ${released90}: o acervo de ativos da sua operação não parou de crescer.`
            : `Há 90 dias esta operação estava começando do zero no painel. Tudo o que existe abaixo foi construído neste período.`,
          ``,
          `O QUE FOI CONSTRUÍDO (registrado no painel)`,
          `• ${totalReleased} entrega(s) liberadas no total${released90 > 0 ? ` (${released90} neste trimestre)` : ""}${totalPublished > 0 ? `\n• ${totalPublished} publicação(ões) no ar` : ""}${doneProjects > 0 ? `\n• ${doneProjects} projeto(s) concluídos` : ""}${activeProjects.length > 0 ? `\n• ${activeProjects.length} frente(s) ativas em operação` : ""}`,
          ``,
          `O QUE MELHOROU`,
          activeProjects.length > 0
            ? `As frentes ativas seguem movendo os sinais certos:\n${frontsText}`
            : `A base construída no período está pronta para sustentar o próximo ciclo de operação.`,
          ``,
          `O QUE AINDA TRAVA`,
          blockers.length > 0
            ? `Com transparência: ${blockers.map((b) => b.label.toLowerCase()).join("; ")}. Já estão no nosso plano de ação e acompanhamos de perto.`
            : `Nenhuma trava crítica registrada no período. O desafio agora é subir o nível, não corrigir rota.`,
          ``,
          `O PRÓXIMO NÍVEL`,
          nextMilestones
            ? `O trimestre que começa tem etapas com data marcada: ${nextMilestones}. É isso que destrava o próximo estágio da operação.`
            : `${focus} Esse é o movimento que abre o próximo estágio da operação.`,
        ].join("\n"),
        next_steps: nextMilestones
          ? `Primeira ação do trimestre: ${nextMilestones}. Próxima revisão completa em 90 dias, com os ritmos semanais continuando normalmente.`
          : `Seguimos com os ritmos semanais (Rota, Check e Prova) e a próxima revisão completa acontece em 90 dias.`,
        highlights: "Marco trimestral: antes, agora, evidências e o próximo nível",
      };
    }
    return {
      ...base,
      title: `Rota da Semana · ${dateLabel}`,
      summary: [
        pickVariant([
          `Bom dia, ${name}! Abrindo a semana de ${weekRangeLabel} com o plano claro: início, meio e fim já desenhados.`,
          `${name}, nova semana, novo ciclo (${weekRangeLabel}). Aqui está o caminho que vamos percorrer até sexta.`,
          `Segunda-feira, ${name}: o plano da semana de ${weekRangeLabel}, na sequência em que ele vai acontecer.`,
        ], seed),
        igNumbers ? `\n${igNumbers}` : ``,
        igReading || ``,
        ``,
        `FOCO DESTA SEMANA`,
        focus,
        ``,
        `COMO A SEMANA SE DESENROLA`,
        [
          `• Início (segunda e terça): ${
            pending > 0
              ? `destravar as aprovações pendentes (${pendingNames}) e abrir a produção da semana.`
              : milestonesThisWeek.length > 0
                ? `atacar ${milestonesThisWeek[0]}.`
                : `abrir a produção das entregas do ciclo.`
          }`,
          `• Meio (quarta): check de andamento aqui no grupo, com o que já foi liberado e o que fecha até sexta.`,
          `• Fim (sexta): ${
            scheduledThisWeek.length > 0
              ? `${scheduledThisWeek.length} publicação(ões) no ar e a Prova de Movimento com o balanço completo da semana.`
              : `entregas da semana liberadas no painel e a Prova de Movimento com o balanço completo.`
          }`,
        ].join("\n"),
        ``,
        `O QUE VAMOS FAZER E POR QUÊ`,
        activeProjects.length > 0
          ? frontsText
          : `Produção das próximas entregas do seu ciclo, cada uma com papel definido no seu resultado e revisão interna antes de chegar até você.`,
        nextMilestones ? `Etapas com data no radar: ${nextMilestones}.` : ``,
        nextPubText ? `Próxima publicação confirmada: ${nextPubText}.` : ``,
        released7d > 0 ? `Da semana passada, ${released7d} entrega(s) já estão liberadas no painel${releasedNames ? ` (${releasedNames})` : ""}.` : ``,
        ``,
        pending > 0
          ? `A ÚNICA AÇÃO DE VOCÊS\nAprovar ${pendingNames} até quarta-feira. É o que libera o agendamento das publicações na data certa.`
          : `A ÚNICA AÇÃO DE VOCÊS\nNenhuma por enquanto. Se algo surgir, avisamos aqui e no painel.`,
        ``,
        `QUANDO REVISAMOS: ${fridayReview}`,
      ].filter(Boolean).join("\n"),
      next_steps: pending > 0
        ? `Aprovar os materiais pendentes (${pendingNames}) até quarta. O painel mostra tudo na área de Aprovações.`
        : `Nenhuma ação necessária de vocês nesta semana. O movimento é nosso: ${focus.charAt(0).toLowerCase()}${focus.slice(1)}`,
      highlights: "Rota da semana: foco, o que vamos fazer, por quê e a única ação de vocês",
    };
  };

  /**
   * Os fatos daquele cliente naquela semana, em linhas secas. É o que a IA
   * recebe para escrever o ritual: ela não inventa nada, só interpreta o que
   * realmente aconteceu no painel.
   */
  // Quando os números foram lidos por último, em linguagem de gente.
  const [lastSync, setLastSync] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const nowTick = useNow(30_000);
  const lastSyncLabel = (() => {
    const min = Math.floor((nowTick.getTime() - lastSync) / 60_000);
    if (min < 1) return "agora";
    if (min === 1) return "1 minuto atrás";
    if (min < 60) return `${min} minutos atrás`;
    const h = Math.floor(min / 60);
    return h === 1 ? "1 hora atrás" : `${h} horas atrás`;
  })();

  const refreshCentral = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
      setLastSync(Date.now());
    } finally {
      setRefreshing(false);
    }
  };

  // Cada rodada automática também conta como leitura nova.
  useEffect(() => {
    setLastSync(Date.now());
  }, [pendingApprovalFiles, releasedFiles, allPublications, reports]);

  const collectFacts = (cachedClient: any, generation?: CentralGenerationContext): string => {
    const client = generation?.client ?? cachedClient;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const nome = client.company_name || client.full_name;
    const clientProjects = generation?.projects ?? (projects || []).filter(
      (p: any) => p.client_id === client.id && !p.deleted_at,
    );
    const ativos = clientProjects.filter((p: any) => p.status !== "done");
    const liberadas = entreguesFiles.filter(
      (f: any) => f.client_id === client.id && new Date(f.created_at) >= weekAgo,
    );
    const pendentes = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
    const maisAntiga = pendentes
      .map((f: any) => daysSince(f.created_at))
      .filter((d): d is number => d !== null)
      .sort((a, b) => b - a)[0];
    const pubs = (allPublications || []).filter((p: any) => p.client_id === client.id);
    const noAr = pubs.filter(
      (p: any) => p.status === "published" && p.published_at && new Date(p.published_at) >= weekAgo,
    );
    const agendadas = pubs.filter(
      (p: any) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) > now,
    );
    const etapas = (allMilestones || []).filter((m: any) =>
      clientProjects.some((p: any) => p.id === m.project_id),
    );
    // A coluna e target_date (due_date nunca existiu em milestones): o filtro
    // antigo descartava TODA etapa, e a IA nunca soube o que vinha a seguir.
    const proximas = etapas
      .filter((m: any) => m.status !== "completed" && m.target_date)
      .sort((a: any, b: any) => String(a.target_date).localeCompare(String(b.target_date)))
      .slice(0, 3);
    const concluidas = etapas.filter(
      (m: any) => m.status === "completed" && m.updated_at && new Date(m.updated_at) >= weekAgo,
    );
    // Material parado cuja data já passou. Detecta pelo nome (datas
    // comemorativas costumam vir batizadas) e pela publicação vinculada que
    // ficou para trás sem ir ao ar.
    const DATAS_MARCADAS =
      /(natal|ano novo|réveillon|reveillon|páscoa|pascoa|carnaval|dia das m|dia dos p|dia da|dia do|black friday|cyber|namorados|consumidor|criança|crianca|professor|cliente|mulher|trabalh|independência|independencia|finados|halloween|primavera|verão|verao|inverno|outono|aniversário|aniversario|lançamento|lancamento)/i;
    const vencidosPorData = pendentes
      .filter((f: any) => {
        if (!DATAS_MARCADAS.test(f.file_name || "")) return false;
        const idade = daysSince(f.created_at);
        // Material de data marcada parado há mais de duas semanas quase
        // sempre perdeu a janela; é o caso que o dono descreveu.
        return idade !== null && idade > 14;
      })
      .map((f: any) => f.file_name);

    const publicacoesPerdidas = pubs.filter(
      (p: any) =>
        p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) < now,
    ).length;

    const ig = igByClient.get(client.id) || [];
    const igUltima = ig[0];
    const pct = (campo: "followers" | "reach" | "total_interactions") => {
      const d = weekDeltaPct(ig, campo);
      return d === null ? "" : ` (${d >= 0 ? "+" : ""}${Math.round(d)}% vs semana anterior)`;
    };
    const cicloFeito = cycleDoneByClient.get(client.id) || 0;

    // Serviços contratados: o ritual precisa falar de TODAS as frentes que o
    // cliente paga, não só da que teve movimento na semana.
    const servicos = client.services_config || {};
    const contratados = Object.entries(SERVICE_NAMES)
      .filter(([chave]) => servicos[chave] === true)
      .map(([, nome]) => nome);

    // Tráfego: o painel só sabe o que foi registrado nele. A carteira de
    // anúncios é controle financeiro e nem todo cliente usa, então ausência
    // de carteira NÃO prova que a campanha não começou. Sem evidência, o
    // ritual não afirma nada: dizer a um cliente que roda anúncios que ele
    // "ainda vai iniciar" é pior do que não tocar no assunto.
    const temTrafego = servicos.trafego === true;
    const carteira = (adsWallets || []).find((w: any) => w.client_id === client.id);
    const termosDeAds = /(ads|tráfego|trafego|campanha|meta|google|anúncio|anuncio)/i;
    const sinaisDeOperacao = [
      carteira && Number(carteira.balance) > 0 ? "carteira de anúncios com saldo" : "",
      trafegoEmOperacao.has(client.id)
        ? "checklist semanal de tráfego sendo marcado pela equipe"
        : "",
      clientProjects.some((p: any) => termosDeAds.test(p.name || ""))
        ? `frente contratada de campanhas ("${clientProjects.find((p: any) => termosDeAds.test(p.name || ""))?.name}")`
        : "",
      etapas.some((m: any) => m.status === "completed" && termosDeAds.test(m.title || ""))
        ? "etapas de campanha já concluídas"
        : "",
    ].filter(Boolean);

    const trafegoLinha = !temTrafego
      ? ""
      : sinaisDeOperacao.length > 0
        ? `Tráfego pago: EM OPERAÇÃO (sinais no painel: ${sinaisDeOperacao.join("; ")}).` +
          (carteira && Number(carteira.balance) <= 0
            ? " Atenção: a verba de campanha registrada está zerada, então vale confirmar a recarga."
            : "")
        : `Tráfego pago: contratado, e o painel NÃO TEM REGISTRO do estado atual das campanhas. ` +
          `NÃO afirme que o tráfego começou nem que não começou. Se for falar do assunto, ` +
          `pergunte ou trate como acompanhamento, nunca como fato.`;

    // O que o cliente disse que quer, na entrada. É o objetivo que dá sentido
    // a tudo o que a gente faz por ele.
    const briefing = (briefings || []).find(
      (b: any) => b.client_id === client.id && b.submitted && b.responses,
    );
    const objetivo = briefing
      ? Object.entries(briefing.responses as Record<string, unknown>)
          .filter(([chave]) => /objetivo|meta|desafio|dor|espera|resultado/i.test(chave))
          .map(([, valor]) => String(valor))
          .filter((v) => v && v.length > 8)
          .slice(0, 2)
          .join(" | ")
      : "";

    // Continuidade: o que a gente prometeu na última mensagem. Sem isso, cada
    // ritual recomeça do zero e o cliente sente que ninguém lembra do anterior.
    const anterior = (reports || [])
      .filter((r: any) => r.client_id === client.id && r.status === "published")
      .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];

    // Os fatos são separados em dois blocos de propósito. O primeiro é o que
    // ACONTECEU e pode ser contado ao cliente. O segundo é sinal interno, para
    // a IA saber onde focar, e nunca vira frase de ausência na mensagem.
    // Antes tudo ia junto, com "nenhuma" e zeros, e o texto saía como
    // inventário de faltas em vez de relato do trabalho.
    return [
      `Cliente: ${nome}`,
      `Tempo de casa: ${daysSince(client.created_at) ?? "?"} dias`,
      client.plan_name ? `Plano: ${client.plan_name}` : "",
      contratados.length ? `Serviços contratados (fale do trabalho em todas as frentes): ${contratados.join(", ")}` : "",
      objetivo ? `Objetivo declarado pelo cliente no briefing: ${objetivo}` : "",
      trafegoLinha,
      anterior
        ? `Na última mensagem publicada (${new Date(anterior.created_at).toLocaleDateString("pt-BR")}) a gente disse: "${String(anterior.next_steps || anterior.summary || "").slice(0, 400)}" — retome isso mostrando o avanço.`
        : `Primeira mensagem para este cliente: apresente o método e o que ele pode esperar do nosso ritmo.`,
      ativos.length ? `Frentes ativas: ${ativos.map((p: any) => p.name).join("; ")}` : "",
      liberadas.length
        ? `Entregas liberadas nos últimos 7 dias: ${liberadas.length} (${liberadas.slice(0, 4).map((f: any) => f.file_name).join(", ")})`
        : "",
      pendentes.length
        ? `Materiais prontos esperando o aval dele: ${pendentes.length} ` +
          `(${pendentes.slice(0, 3).map((f: any) => f.file_name).join(", ")}` +
          `${maisAntiga !== undefined ? `; o primeiro há ${maisAntiga} dias` : ""}). ` +
          `Já estão prontos: fale do que entra no ar assim que ele aprovar, sem tom de cobrança.`
        : "",
      // Material de data marcada que não foi aprovado a tempo: cobrar
      // aprovação disso constrange o cliente e não resolve nada, porque a
      // data já passou. O caminho é reconhecer a perda e replanejar.
      vencidosPorData.length > 0
        ? `ATENÇÃO, MATERIAL COM DATA VENCIDA: ${vencidosPorData.length} ` +
          `(${vencidosPorData.slice(0, 3).join(", ")}). São conteúdos de data comemorativa ou ` +
          `campanha com dia certo que não foram aprovados a tempo. NÃO peça aprovação deles: ` +
          `a data passou e a publicação perdeu o sentido. Reconheça com naturalidade que a ` +
          `janela fechou, sem culpar ninguém, e proponha o replanejamento ou a próxima data.`
        : "",
      publicacoesPerdidas > 0
        ? `Publicações que estavam agendadas e não foram ao ar na data: ${publicacoesPerdidas}. ` +
          `Trate como fato a resolver, não como cobrança.`
        : "",
      noAr.length ? `Publicações no ar nos últimos 7 dias: ${noAr.length}` : "",
      agendadas.length ? `Publicações já agendadas: ${agendadas.length}` : "",
      concluidas.length ? `Etapas concluídas nos últimos 7 dias: ${concluidas.map((m: any) => m.title).join("; ")}` : "",
      proximas.length
        ? `Próximas etapas com data: ${proximas.map((m: any) => `${m.title} (${new Date(`${m.target_date}T12:00:00`).toLocaleDateString("pt-BR")})`).join("; ")}`
        : "",
      // Semana de bastidor: quando não houve publicação, o trabalho existiu
      // do mesmo jeito. É isto que a mensagem conta, em vez de dizer que nada
      // aconteceu.
      !noAr.length && !liberadas.length && cicloFeito > 0
        ? `SEMANA DE CONSTRUÇÃO: nada foi publicado, mas a operação avançou ${cicloFeito} etapas de bastidor. Conte o que foi construído e o que isso prepara, nunca diga que a semana foi parada.`
        : "",
      igUltima
        ? `Instagram na última semana medida: ${igUltima.followers ?? "?"} seguidores${pct("followers")}, alcance ${igUltima.reach ?? "?"}${pct("reach")}, ${igUltima.total_interactions ?? "?"} interações${pct("total_interactions")}`
        : `Instagram: sem medição registrada`,
      // O dossiê atual é a fonte de verdade do "onde estamos": entra inteiro
      // (resumido) para a IA escrever a partir dele, não do nome do cliente.
      (() => {
        // A geração recebe o dossiê integral antes dos fatos operacionais,
        // em centralGenerationFacts; não repetir uma versão resumida do cache.
        if (generation) return "";
        const d = dossieDe(client.id);
        if (!d?.geral) return "";
        const texto = String(d.geral.content || d.geral.summary || "").trim();
        if (!texto) return "";
        const idade = daysSince(d.geral.updated_at);
        const mudancas = d.mudancas.length
          ? `\nO QUE MUDOU DESDE A VERSÃO ANTERIOR (v${d.anterior?.version ?? "?"} -> v${d.geral.version ?? "?"}); é a progressão, retome-a como avanço:\n${d.mudancas.map((m) => `- ${m}`).join("\n")}`
          : "";
        const outros = d.outros.length ? `\nDossiês de projeto (complemento, não substituem o geral): ${d.outros.map((o) => `v${o.version ?? "?"} ${String(o.summary || o.content || "").slice(0, 160)}`).join(" | ")}` : "";
        return `DOSSIÊ GERAL ATUAL (${d.substituto ? "sem geral: usando o mais recente" : `v${d.geral.version ?? "?"}`}, escrito há ${idade ?? "?"} dia(s)) — fonte da verdade do "onde estamos" e do "para onde vamos":\n${texto.slice(0, 1800)}${mudancas}${outros}`;
      })(),
      (() => {
        // O plano histórico da Esteira não registra a versão da fonte usada.
        // Continua visível no painel, mas não define compromissos da geração nova.
        return centralCachedPlanFacts(planoDe(client.id), generation?.source);
      })(),
      (() => {
        const v = vendasDe(client.id);
        if (v.total === 0) return "";
        return `VENDAS registradas nos últimos 7 dias: ${v.total}${v.receita > 0 ? ` (R$ ${v.receita.toFixed(0)})` : ""}${v.porCampanha.length ? ` — campanhas: ${v.porCampanha.join(", ")}` : ""}. Conte como resultado concreto.`;
      })(),
      (() => {
        const ids = new Set(clientProjects.map((p: any) => p.id));
        const feitas = (expTasksDone || []).filter((t: any) => ids.has(t.project_id)).slice(0, 8);
        return feitas.length
          ? `Tarefas concluídas nos últimos 7 dias: ${feitas.map((t: any) => t.title).join("; ")}`
          : "";
      })(),
      cicloFeito > 0
        ? `Bastidor da semana: ${cicloFeito} de 6 etapas do nosso ciclo interno concluídas para este cliente`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  /**
   * Os fatos completos de um cliente (painel + historia + segundo cerebro),
   * os mesmos que o gerador de rituais usa. Uma funcao so, para a mensagem
   * do momento e o rascunho do ritual nunca lerem contextos diferentes.
   */
  // A mensagem fala com uma pessoa: o primeiro nome de quem recebe, nao a
  // razao social. Quando so ha o nome da empresa, a IA usa a empresa.
  const nomeDoContato = (client: any): string => {
    const pessoa = String(client?.full_name || "").trim();
    const empresa = String(client?.company_name || "").trim();
    if (!pessoa || (empresa && pessoa.toLowerCase() === empresa.toLowerCase())) return "";
    return pessoa.split(/\s+/)[0] || "";
  };

  const fatosCompletos = async (c: any, captured?: CentralGenerationContext): Promise<{ facts: string; context: CentralGenerationContext }> => {
    // CONTEXTO DO SEGUNDO CÉREBRO complementa a base persistida, sem redefinir seu escopo.
    const context = captured ?? await captureCentralGenerationContext(c.id);
    const clientName = context.client.company_name || context.client.full_name;
    const [historia, cerebro, ultima, movimentos] = await Promise.all([
      readMemory(c.id, { limit: 12, kinds: ["ritual", "decisao", "marco", "nota", "summary", "second_brain", "external"] as any }).then(memoryAsContext).catch(() => ""),
      supabase.functions.invoke("brain-client-context", { body: { client_id: c.id, client_name: clientName } }).then((r) => String(r.data?.context || "")).catch(() => ""),
      // A ultima mensagem que chegou ao cliente, inteira: e o que a de hoje
      // retoma para mostrar avanco ("combinamos X; X ja esta no ar").
      readMemory(c.id, { limit: 1, kinds: ["ritual"] as any }).then((rows) => {
        const r = rows[0];
        if (!r) return "";
        const quando = new Date(r.created_at).toLocaleDateString("pt-BR");
        return `ÚLTIMA MENSAGEM ENVIADA AO CLIENTE (${quando}; retome o que ela prometeu e mostre o que virou realidade):\n${String(r.content || "").slice(0, 1600)}`;
      }).catch(() => ""),
      // Todo movimento com data e hora reais (material novo e o que ele e,
      // enviado para aprovacao, aprovado, agendado, publicado, pedido...). A
      // mensagem de avanco fala do que aconteceu com o dia certo.
      lerMovimentos(c.id, { dias: 14 }).then((lista) => movimentosComoFatos(lista, { max: 40, dias: 14 })).catch(() => ""),
    ]);
    const painel = [collectFacts(c, context), movimentos, ultima].filter(Boolean).join("\n\n");
    return { facts: centralGenerationFacts(context, painel, historia, cerebro), context };
  };

  // Aprimorar um rascunho ja gerado: a IA rele os fatos de AGORA, mantem o
  // que esta certo, completa o que faltou e devolve o proximo passo separado.
  // O resultado ja e salvo no rascunho; nao precisa de mais um passo.
  const aprimorarRascunho = async (report: any) => {
    if (aprimorando) return;
    if (!contextoPronto) { avisarContextoCarregando(); return; }
    const client = portfolioClients.find((c: any) => c.id === report.client_id) || (clients || []).find((c: any) => c.id === report.client_id);
    if (!client) { toast.error("Cliente deste rascunho não está na carteira carregada."); return; }
    setAprimorando(report.id);
    try {
      const edits = draftEdits[report.id];
      const atual = { summary: edits?.summary || report.summary || "", next_steps: edits?.next_steps || report.next_steps || "" };
      const { facts, context } = await fatosCompletos(client);
      const provenance = await centralFactsProvenance(facts);
      const ritual = String((report.metrics as any)?.ritual_type || "meio_semana");
      const { data, error } = await supabase.functions.invoke("ritual-writer", {
        // client_id e report_id: o servidor monta a memória dos rituais e não compara o rascunho com ele mesmo.
        body: { ritual, client_id: report.client_id, report_id: report.id, client_name: context.client.company_name || context.client.full_name, contact_name: nomeDoContato(context.client), facts: provenance.facts, improve: atual, ...corpoDoModelo(escolhaDoModelo) },
      });
      if (error || !data?.body) { toast.error("A IA não respondeu agora. O texto atual foi mantido."); return; }
      const novo = { summary: String(data.body), next_steps: completarProximoPasso(typeof data.next_steps === "string" ? data.next_steps : "", String(data.body)) };
      const { error: saveError } = await supabase.from("reports").update({
        summary: novo.summary,
        next_steps: novo.next_steps,
        title: typeof data.title === "string" && data.title.trim() ? data.title.slice(0, 80) : report.title,
        metrics: {
          ...((report.metrics as any) || {}), written_by: "ai", model: data.model ?? null, improved_at: new Date().toISOString(),
          ...extrasDoRitual(data),
        },
      }).eq("id", report.id);
      if (saveError) throw saveError;
      setDraftEdits((prev) => ({ ...prev, [report.id]: novo }));
      toast.success("Rascunho aprimorado e salvo, com o próximo passo separado.");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível aprimorar agora.");
    } finally { setAprimorando(null); }
  };

  const escreverMomentoComIA = async (client: any, moment: "abertura" | "meio" | "fechamento") => {
    const chave = `${client.id}:${moment}`;
    if (aiMomentLoading) return;
    if (!contextoPronto) { avisarContextoCarregando(); return; }
    setAiMomentLoading(chave);
    try {
      const { facts, context } = await fatosCompletos(client);
      const provenance = await centralFactsProvenance(facts);
      const { data, error } = await supabase.functions.invoke("ritual-writer", { body: { moment, client_id: client.id, client_name: context.client.company_name || context.client.full_name, contact_name: nomeDoContato(context.client), facts: provenance.facts, ...corpoDoModelo(escolhaDoModelo) } });
      if (error || !data?.body) { toast.error("A IA não respondeu agora. O texto do painel continua disponível."); return; }
      await assertCentralReviewSource(client.id, context.source);
      setAiMoment((prev) => ({ ...prev, [chave]: { title: data.title ?? null, body: String(data.body), alertas: avisosDoRitual(data), model: data.model ?? null } }));
      setGroupMsgPreview(moment);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conferir o contexto da mensagem.");
    } finally { setAiMomentLoading(null); }
  };

  const hasRecentDraft = (clientId: string, ritual: string) =>
    (reports || []).some((r: any) => {
      if (r.client_id !== clientId) return false;
      if ((r.metrics as any)?.ritual_type !== ritual) return false;
      const age = daysSince(r.created_at);
      return age !== null && age <= 3;
    });

  // Passo 1: pré-visualizar. Nada é criado antes de você ver.
  const previewDrafts = async () => {
    if (generatingDrafts.current || confirmingDrafts.current) return;
    if (!contextoPronto) { avisarContextoCarregando(); return; }
    // O avulso também merece acompanhamento: enquanto o projeto dele está em
    // andamento, a experiência é a mesma da carteira. "Todos" continua
    // significando a carteira recorrente; o avulso entra quando escolhido.
    const universo = [...portfolioClients, ...oneOffClients];
    const targets = genClientId === "__all__"
      ? portfolioClients
      : universo.filter((c: any) => c.id === genClientId);
    if (targets.length === 0) { toast.error("Selecione um cliente"); return; }
    // Elegibilidade usa os projetos relidos, não a lista possivelmente antiga da tela.
    let skippedNoProject = 0;
    // Gerar e SEMPRE reler o painel agora: rascunho recente nao barra mais
    // (era o "nao atualiza"). O rascunho antigo do mesmo ritual sai da fila
    // quando o novo e criado.
    const alvos = targets;
    if (alvos.length === 0 && skippedNoProject === 0) {
      toast.info("Nenhum cliente elegível.");
      return;
    }

    // A IA escreve cada ritual a partir dos fatos reais do cliente. O texto de
    // molde vai junto como reserva: se a IA não responder, o rascunho sai
    // mesmo assim, e o dono revisa antes de qualquer coisa ser enviada.
    generatingDrafts.current = true;
    setGenerating(true);
    setGenPreviews(null);
    const errors: string[] = [];
    // Um cliente por vez pesa pouco, mas a carteira inteira de uma vez abria
    // dezenas de chamadas simultaneas (contexto, fatos, IA) e derrubava o
    // gerador. Lotes de 3: paralelo dentro do lote, lotes em sequencia.
    const gerarPrevia = async (c: any): Promise<DraftPreview | null> => {
        const clientName = c.company_name || c.full_name;
        try {
          const captured = await captureCentralGenerationContext(c.id);
          if (!captured.projects.length) { skippedNoProject += 1; return null; }
          let draft: any = { ...buildDraft(captured.client, genRitual, captured.projects), id: crypto.randomUUID() };
          // Três camadas de contexto: os números da semana, a história dentro
          // do painel e o que o segundo cérebro sabe daquele cliente fora
          // dele. Sem a terceira, a mensagem escreve com meio contexto.
          const { facts: fatos } = await fatosCompletos(c, captured);
          const provenance = await centralFactsProvenance(fatos);
          try {
            const { data, error } = await supabase.functions.invoke("ritual-writer", {
              body: { ritual: genRitual, client_id: c.id, client_name: captured.client.company_name || captured.client.full_name, contact_name: nomeDoContato(captured.client), facts: provenance.facts, ...corpoDoModelo(escolhaDoModelo) },
            });
            if (!error && data?.body) {
              draft = applyCentralAiDraft(draft, data);
              // Aviso de repetição, tarefas sugeridas e fase do método vão junto no rascunho.
              draft.metrics = { ...(draft.metrics || {}), ...extrasDoRitual(data) };
            }
          } catch {
            // Falha da IA mantém o texto de reserva; falha da fonte nunca é ignorada.
          }
          await assertCentralReviewSource(c.id, captured.source);
          draft.metrics = {
            ...(draft.metrics || {}),
            central_review_source: captured.source,
            central_review_generated_at: new Date().toISOString(),
            central_review_facts: provenance.metadata,
            substitui_recente: hasRecentDraft(c.id, genRitual),
          };
          return { clientId: c.id, clientName, draft } as DraftPreview;
        } catch (error) {
          errors.push(`${clientName}: ${error instanceof Error ? error.message : "Não foi possível conferir o contexto."}`);
          return null;
        }
    };
    const LOTE = 3;
    const results: Array<DraftPreview | null> = [];
    let prontos = 0;
    setProgressoDaGeracao({ feitos: 0, total: alvos.length });
    for (let i = 0; i < alvos.length; i += LOTE) {
      results.push(...(await Promise.all(alvos.slice(i, i + LOTE).map(async (c: any) => {
        const r = await gerarPrevia(c);
        prontos += 1;
        setProgressoDaGeracao({ feitos: prontos, total: alvos.length });
        return r;
      }))));
    }
    setProgressoDaGeracao(null);
    const previews = results.filter((preview): preview is DraftPreview => preview !== null);
    generatingDrafts.current = false;
    setGenerating(false);
    if (errors.length) toast.error(errors.join("\n"));
    if (skippedNoProject > 0) {
      toast.info(`${skippedNoProject} cliente(s) sem projeto cadastrado ficaram fora. Crie um projeto para eles entrarem nos rituais.`);
    }
    if (previews.length === 0) return;
    setGenPreviews(previews);
  };

  // Passo 2: confirmar e criar os rascunhos revisados.
  const confirmDrafts = async () => {
    if (!genPreviews || genPreviews.length === 0 || confirmingDrafts.current) return;
    confirmingDrafts.current = true;
    setGenerating(true);
    let created = 0;
    let primeiroCriado: string | null = null;
    const failed: DraftPreview[] = [];
    try {
      for (const preview of genPreviews) {
        try {
          await persistCentralReviewDraft(preview.draft);
          created += 1;
          if (!primeiroCriado) primeiroCriado = String(preview.draft.id);
        } catch (error) {
          failed.push(preview);
          toast.error(`${preview.clientName}: ${error instanceof Error ? error.message : "Não foi possível salvar. A prévia foi preservada."}`);
        }
      }
      setGenPreviews(failed.length ? failed : null);
      if (created > 0) {
        toast.success(`${created} mensagem(ns) pronta(s). Abra, copie para o grupo e registre o envio.${failed.length ? ` ${failed.length} não salvas, prévias preservadas.` : ""}`);
        void queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
        void queryClient.invalidateQueries({ queryKey: ["reports"] });
        if (!failed.length) {
          // Caminho curto: fecha o gerador ja na fila, com a primeira mensagem
          // aberta, em vez de deixar a pessoa procurar onde ela foi parar.
          setGeneratorOpen(false);
          setActiveTab("fila");
          if (primeiroCriado) setExpandedDraft(primeiroCriado);
        }
      }
    } finally {
      confirmingDrafts.current = false;
      setGenerating(false);
    }
  };

  const saveDraftEdits = async (report: any) => {
    const edits = draftEdits[report.id];
    if (!edits) return;
    try {
      const { error } = await supabase.from("reports")
        .update({ summary: edits.summary, next_steps: edits.next_steps })
        .eq("id", report.id);
      if (error) throw error;
      toast.success("Rascunho atualizado");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
  };

  // canal "portal": publica no portal e avisa o cliente. canal "grupo": a
  // pessoa ja mandou no WhatsApp; aqui so registra (historico, dossie, Ciclo)
  // e tira da fila. Nos dois casos o proximo passo nunca fica vazio.
  const publishDraft = async (report: any, canal: "portal" | "grupo" = "portal") => {
    if (rascunhoEmVoo) return;
    setRascunhoEmVoo(String(report.id));
    try {
      const edits = draftEdits[report.id];
      const textoFinal = edits?.summary || report.summary || "";
      const proximoPasso = completarProximoPasso(edits?.next_steps || report.next_steps, textoFinal);
      const payload: any = {
        status: "published",
        summary: textoFinal,
        next_steps: proximoPasso,
        metrics: { ...((report.metrics as any) || {}), sent_channel: canal === "grupo" ? "whatsapp_group" : "portal", sent_at: new Date().toISOString() },
      };
      const { error } = await supabase.from("reports").update(payload).eq("id", report.id);
      if (error) throw error;
      if (canal === "portal") await notifyUser(report.client_id, `Nova atualização disponível: ${report.title}`, "report", "/onde-estamos");

      // A mensagem enviada entra na história do cliente: é o que a próxima
      // vai retomar, em vez de recomeçar do zero.
      await recordMemory({
        clientId: report.client_id,
        projectId: report.project_id || null,
        kind: "ritual",
        title: report.title,
        content: [textoFinal, proximoPasso ? `Próximo passo combinado: ${proximoPasso}` : ""]
          .filter(Boolean)
          .join("\n\n"),
        source: "central",
        tags: [(report.metrics as any)?.ritual_type || "ritual"],
        metadata: {
          report_id: report.id,
          ritual_type: (report.metrics as any)?.ritual_type || null,
          written_by: (report.metrics as any)?.written_by || "modelo",
          sent_channel: canal === "grupo" ? "whatsapp_group" : "portal",
        },
        clientVisible: true,
      });
      // O dossie geral recebe a secao de avancos com a mensagem enviada.
      await atualizarAvancosDoDossie(report.client_id);
      // O combinado do ritual enviado entra no cérebro do cliente (melhor esforço).
      void supabase.functions.invoke("ritual-writer", { body: { action: "memorizar", report_id: report.id } }).catch(() => undefined);

      // Ponte com o Ciclo: o ritual publicado aqui marca a caixinha da
      // semana la, com origem "central". O diario ja recebeu o texto acima.
      const chaveCiclo = RITUAL_DA_CENTRAL[String((report.metrics as any)?.ritual_type || "")];
      if (chaveCiclo) {
        await marcarRitual({ clientId: report.client_id, weekStart: semanaDoCiclo, ritual: chaveCiclo, feito: true, source: "central", semDiario: true });
        void queryClient.invalidateQueries({ queryKey: ["cycle-rituals-central"] });
      }

      toast.success(canal === "grupo" ? "Envio registrado: histórico, dossiê e Ciclo atualizados." : "Publicado no portal do cliente e notificado.");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["exp-memory"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao publicar");
    } finally {
      setRascunhoEmVoo(null);
    }
  };

  const deleteDraft = async (report: any) => {
    if (rascunhoEmVoo) return;
    setRascunhoEmVoo(String(report.id));
    try {
      // A fila mostra tudo que não foi publicado; o descarte precisa cobrir o
      // mesmo conjunto, e dizer a verdade quando nada foi apagado.
      const { data: apagados, error } = await supabase
        .from("reports").delete().eq("id", report.id).neq("status", "published").select("id");
      if (error) throw error;
      if (!apagados || apagados.length === 0) {
        toast.error("Nada foi removido: este item já não estava na fila.");
        return;
      }
      toast.success("Rascunho removido");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    } finally {
      setRascunhoEmVoo(null);
    }
  };

  // Variação semanal: a mesma mensagem nunca se repete igual duas semanas seguidas.
  const isoWeek = () => {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  };
  const pickVariant = (options: string[], seed: string) => {
    const hash = seed.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    return options[(hash + isoWeek()) % options.length];
  };

  /**
   * A mensagem que vai para o grupo do cliente.
   *
   * Antes era um molde com contadores: "1 entrega(s) nova(s) liberadas no
   * painel", "Em movimento: SKC | Marketing, Presença Digital e Aquisição".
   * Um cliente reclamou, com razão: número solto não diz o que ele ganhou, e
   * nome interno de projeto não significa nada para quem está do outro lado.
   *
   * Agora a mensagem cita o que foi feito pelo nome, explica para que serve, e
   * muda de forma conforme a semana daquele cliente: quem teve entrega recebe
   * uma mensagem diferente de quem está em produção.
   */
  /**
   * Monta o retrato da semana daquele cliente e entrega para a biblioteca da
   * mensagem (src/lib/groupMessage.ts), onde cada momento tem um trabalho:
   * abertura conta o plano, quarta conta o movimento, sexta fecha o balanço.
   *
   * Tudo vem de consultas ao vivo — quando o dossiê muda, um avulso é marcado
   * ou uma campanha gasta, a mensagem seguinte já sai diferente.
   */
  /**
   * Recarrega as fontes que a mensagem lê e mostra o resultado na hora.
   *
   * Sem isto, quem liberava um material e vinha copiar o recado pegava o texto
   * anterior — a consulta ao vivo tem intervalo, e o intervalo aparecia como
   * "a mensagem não atualiza".
   */
  const [atualizandoMensagens, setAtualizandoMensagens] = useState(false);
  const atualizarMensagens = async () => {
    setAtualizandoMensagens(true);
    try {
      await Promise.all(
        [
          "exp-released-files", "exp-pending-approvals", "exp-publications",
          "exp-memory", "exp-pautas", "exp-reports", "weekly-cycle-ritual",
          "ads-daily", "ads-campaigns",
          // O dossiê tem consulta própria por cliente; sem esta chave, o
          // botão dizia "atualizado" e a caixa do dossiê seguia na versão
          // anterior — que é exatamente o que dá a impressão de nada mudar.
          "dossie-cliente",
        ].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] })),
      );
      toast.success("Mensagens atualizadas com o que há de mais recente.");
    } finally {
      setAtualizandoMensagens(false);
    }
  };

  const buildGroupMessage = (client: any, moment: "abertura" | "meio" | "fechamento" = "abertura") => {
    const name = client.company_name || client.full_name || "time";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    const segunda = new Date(`${cycleWeekKey}T00:00:00`);
    const proximaSegunda = new Date(segunda);
    proximaSegunda.setDate(proximaSegunda.getDate() + 7);

    const entregas = entreguesFiles.filter(
      (f: any) => f.client_id === client.id && (daysSince(f.created_at) ?? 99) <= 7,
    );
    const entregasDesdeSegunda = entregas.filter(
      (f: any) => f.created_at && new Date(f.created_at) >= segunda,
    );
    const pending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
    const publicacoes = (allPublications || []).filter((p: any) => p.client_id === client.id);
    const agendadasSemana = publicacoes
      .filter(
        (p: any) =>
          p.status === "scheduled" && p.scheduled_at &&
          new Date(p.scheduled_at) > new Date() && new Date(p.scheduled_at) < proximaSegunda,
      )
      .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .map((p: any) => {
        const dia = new Date(p.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const titulo = readableFileName(String(p.post?.title || ""));
        return titulo ? `${dia} (${titulo})` : dia;
      });
    const publicadasSemana = publicacoes.filter(
      (p: any) => p.status === "published" && p.published_at && new Date(p.published_at) >= segunda,
    ).length;

    // Etapas do ciclo desta semana, nas palavras daquele cliente e semana.
    const cicloDoCliente = (cycleRows || []).filter(
      (row: any) => row.client_id === client.id && row.step <= 6,
    );
    // As etapas do ciclo ditas na lingua do cliente. O checklist e escrito
    // para quem EXECUTA ("subir no painel"), e passa-lo cru mandava bastidor
    // da agencia como se fosse noticia do cliente.
    const cicloFeito = rotinaEmLinguagemDeCliente(
      cicloDoCliente.map((row: any) => ({ area: row.area, step: row.step })),
    );
    const porqueDaSemana = porqueDaSemana_(cicloDoCliente.map((row: any) => ({ area: row.area, step: row.step })));

    const memoriaDoCliente = (expMemory || []).filter((m: any) => m.client_id === client.id);
    const avulsosFeitos = memoriaDoCliente
      .filter(
        (m: any) =>
          m.kind === "avulso" && m.metadata?.week_start === cycleWeekKey && m.metadata?.done === true,
      )
      .map((m: any) => String(m.title || "").toLowerCase())
      .filter(Boolean);

    // O contexto vivo vem do DOSSIÊ ATUAL (client_dossiers, is_current): é
    // onde o MCP e a equipe escrevem "onde estamos". A memória (project_memory)
    // fica como reserva. Sem janela de 14 dias: dossiê velho continua sendo o
    // retrato até alguém escrever outro - o que muda e a idade dele, não a
    // existência.
    const dossieGeral = dossieDe(client.id);
    const dossieAtual = dossieGeral?.geral ?? null; // SEMPRE o geral; projeto so complementa
    const contextoEntrada = dossieAtual
      ? { kind: "summary", title: `Dossiê v${dossieAtual.version ?? ""}`, content: String(dossieAtual.content || dossieAtual.summary || ""), created_at: dossieAtual.updated_at }
      : memoriaDoCliente.find((m: any) => CONTEXTO_KINDS.has(m.kind)) || null;
    const planoDaSemana = planoDe(client.id);
    const vendasDaSemana = vendasDe(client.id);
    const contextoRecente = contextoEntrada ? trechoDoContexto(contextoEntrada) || null : null;
    const oQueEsperar = contextoEntrada
      ? oQueEsperarDoDossie(String(contextoEntrada.content || "")) || null
      : null;

    // Tarefas concluídas com nome: o trabalho de verdade da semana.
    const projetosDoCliente = new Set(
      (projects || []).filter((p: any) => p.client_id === client.id).map((p: any) => p.id),
    );
    const tarefasFeitas = (expTasksDone || []).filter((t: any) => projetosDoCliente.has(t.project_id));
    const tarefasConcluidas7d = tarefasFeitas.map((t: any) => readableFileName(String(t.title || ""))).filter(Boolean);
    const tarefasDesdeSegunda = tarefasFeitas
      .filter((t: any) => t.updated_at && new Date(t.updated_at) >= segunda)
      .map((t: any) => readableFileName(String(t.title || "")))
      .filter(Boolean);

    // O próximo passo combinado no último relatório publicado ainda fresco.
    const relatorioComPasso = (reports || []).find(
      (r: any) =>
        r.client_id === client.id && r.status === "published" &&
        String(r.next_steps || "").trim() && (daysSince(r.created_at) ?? 99) <= 21,
    );
    const proximoPasso = relatorioComPasso
      ? String(relatorioComPasso.next_steps).split(/\n/)[0].slice(0, 160).trim()
      : null;

    // Campanhas: o que a semana investiu e trouxe, em linguagem simples.
    const adsDoCliente = (adsWeekRows || []).filter((row: any) => row.client_id === client.id);
    const campanhasNoAr = (adsCampaignList || []).filter(
      (c: any) => c.client_id === client.id && adsStatusLabel(c.status, c.effective_status).noAr,
    ).length;
    let anuncios: GroupMessageContext["anuncios"] = null;
    if (adsDoCliente.length > 0 || campanhasNoAr > 0) {
      let investido = 0;
      let resultados = 0;
      let temResultado = false;
      const acoesTodas = adsDoCliente.flatMap((row: any) =>
        Array.isArray(row.actions) ? row.actions : [],
      );
      const meta = goalForCampaign(adsDoCliente[0]?.objective ?? null, acoesTodas);
      for (const row of adsDoCliente) {
        investido += Number(row.spend || 0);
        const achado = resultFromActions(row.actions, row.objective, meta);
        if (achado) {
          resultados += achado.count;
          temResultado = true;
        }
      }
      anuncios = {
        campanhasNoAr,
        investidoSemana: investido,
        resultadosSemana: temResultado ? resultados : null,
        nomeDoResultado: meta.resultPlural,
      };
    }

    const frentes = (projects || [])
      .filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at)
      .map((p: any) => readableProjectName(p.name, name))
      .filter(Boolean);

    const ctx: GroupMessageContext = {
      clientName: name,
      greeting,
      entregasSemana: entregas.map((f: any) => readableFileName(f.file_name)),
      entregasDesdeSegunda: entregasDesdeSegunda.map((f: any) => readableFileName(f.file_name)),
      aguardandoOk: pending.map((f: any) => readableFileName(f.file_name)),
      publicadasSemana,
      proximasAgendadas: agendadasSemana,
      cicloFeito,
      porqueDaSemana,
      avulsosFeitos,
      frentes,
      pautasProntas: (expPautas || [])
        .filter((linha: any) => linha.client_id === client.id && linha.production_status === "ready")
        .map((linha: any) => readableFileName(String(linha.title || "")))
        .filter(Boolean),
      contextoRecente,
      oQueEsperar,
      proximoPasso,
      anuncios,
      tarefasConcluidas7d,
      tarefasDesdeSegunda,
      dossieIdade: dossieAtual?.updated_at ?? null,
      dossieMudancas: dossieGeral?.mudancas ?? [],
      focoDaSemana: planoDaSemana?.foco || null,
      feitoDaEsteira: (planoDaSemana?.feito ?? []).map((f) => readableFileName(String(f))).filter(Boolean),
      vendas: vendasDaSemana.total > 0 ? { total: vendasDaSemana.total, receita: vendasDaSemana.receita } : null,
    };
    return buildGroupMessageText(ctx, moment);
  };

  const copyText = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMessage);
    } catch {
      toast.error("Não consegui copiar automaticamente.");
    }
  };

  const levelMeta: Record<ClientHealth["level"], { label: string; cls: string; dot: string }> = {
    healthy: { label: "Saudável", cls: "text-success", dot: "bg-success" },
    attention: { label: "Atenção", cls: "text-warning", dot: "bg-warning" },
    risk: { label: "Risco", cls: "text-destructive", dot: "bg-destructive" },
  };

  const openClientProfile = (clientId: string) => navigate(`/clientes?client=${clientId}`);

  // Sistema de design (E3, 26/09; docs/design/SISTEMA.md): as seis abas são
  // Etapas com o número no item, e o que a aba faz mora no "?" ao lado.
  const abasDaCentral: ItemDeEtapa[] = [
    { valor: "carteira", rotulo: "Carteira", contador: healthRows.length },
    { valor: "perfis", rotulo: "Perfis" },
    { valor: "avulsos", rotulo: "Avulsos", contador: oneOffClients.length },
    { valor: "radar", rotulo: "Radar de ideias", contador: allRadarIdeas.length },
    { valor: "fila", rotulo: "Fila de revisão", contador: draftReports.length },
    { valor: "historico", rotulo: "Histórico", contador: publishedReports.length },
  ];
  const ajudaDaAba: Record<string, string> = {
    carteira: "A saúde de cada cliente recorrente e o porquê da nota. Toque em um cliente para agir.",
    perfis: "Tudo de um cliente em um só lugar: o que enviar na semana, a mensagem pronta do grupo e o Diário do Trabalho.",
    avulsos: "Os clientes de projeto fechado: entrega, prazo e a próxima oferta natural.",
    radar: "As ideias de diferenciação do mês, uma por cliente, montadas do contexto real dele.",
    fila: "O que foi gerado e espera a sua revisão. Confira cada versão e registre sua decisão; aprovação não comprova publicação ou envio.",
    historico: "A linha do tempo completa do que já aconteceu e foi enviado.",
  };
  const podeAbrirMesas = ["admin", "manager", "design"].includes(profile?.role || "");
  const nomeDoCliente = (c: any) => c?.company_name || c?.full_name || "Cliente";
  const controlesDoRadar = (classeDoSeletor: string) => (
    <>
      <SeletorCompacto
        modo="lista"
        rotulo="Escolher cliente..."
        opcoes={portfolioClients.map((client: any) => ({ valor: String(client.id), rotulo: nomeDoCliente(client) }))}
        valor={aiClientId}
        onEscolher={setAiClientId}
        className={classeDoSeletor}
      />
      <button
        type="button"
        disabled={!aiClientId || aiLoading}
        onClick={() => void generateAiIdeas()}
        aria-label="Gerar ideias com IA + busca na web"
        title="Gerar ideias com IA + busca na web"
        className={botao.primario}
      >
        {aiLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
        {aiLoading ? "Pesquisando..." : <><span className="sm:hidden">Gerar ideias</span><span className="hidden sm:inline">Gerar ideias com IA</span></>}
      </button>
    </>
  );
  const linhaDeLista = juntar("flex w-full min-w-0 items-center px-1 py-2.5 text-left transition-colors hover:bg-muted/40", foco);
  const grupoDeBotoes = "-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1";

  return (
    <div ref={raizDaCentral} className={cycleReview ? "mx-auto min-h-dvh max-w-6xl space-y-5 bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-0 lg:pb-0 text-foreground central-celular" : "space-y-5 central-celular"}>
      {/* Mesmo cabecalho do Ciclo: respiro da safe area + 12px, Voltar com
          seta a esquerda. Antes era um link solto a 20px do topo. */}
      {cycleReview && (
        <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
          <nav aria-label="Navegação da revisão do Ciclo" className="flex min-w-0 items-center text-sm">
            <Link to="/ciclo" aria-label="Voltar ao Ciclo" className={juntar(botao.discreto, "-ml-2.5")}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Voltar ao Ciclo</Link>
            {reviewClientId && (
              <span className="ml-auto flex min-w-0 items-center">
                <span className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate")}>{clients?.find(client => client.id === reviewClientId)?.company_name || clients?.find(client => client.id === reviewClientId)?.full_name || "não encontrado nesta carteira"}</span>
                <Link to="/ciclo/revisao" className={juntar("shrink-0 rounded text-[12.5px] text-primary hover:underline", foco)}>Ver todos os clientes</Link>
              </span>
            )}
          </nav>
          <div className="mt-1 flex min-w-0 items-center">
            <p className={`min-w-0 truncate text-[12px] ${revisoes.total > 0 ? "font-medium text-warning" : "text-muted-foreground"}`}>
              {revisoes.total > 0
                ? `${revisoes.total} ${revisoes.total === 1 ? "pedido espera" : "pedidos esperam"} a sua decisão${reviewClientId && revisoes.porCliente.get(reviewClientId) ? ` (${revisoes.porCliente.get(reviewClientId)} deste cliente)` : ""}`
                : "Nada esperando decisão agora"}
            </p>
            <AjudaRecolhida className="ml-1.5" rotulo="Como chegam os pedidos">
              Você recebe um aviso no sino a cada pedido novo e a cada decisão. Quando um pedido de revisão for preparado, ele aparece aqui e no sino.
            </AjudaRecolhida>
          </div>
        </header>
      )}
      {/* Cabeçalho enxuto (dono, 26/09): título, "?" com o que a tela faz, a
          hora dos dados e as duas ações. A explicação longa mora no "?". */}
      <CabecalhoDePagina
        // O título quebra linha no celular em vez de cortar ("Ciclo · Revisão por clie...").
        titulo={<span className="whitespace-normal">{cycleReview ? "Ciclo · Revisão por cliente" : "Central"}</span>}
        ajuda={cycleReview ? "Esta área é a aprovação: o rascunho vira pedido, você decide (aqui ou pelo Hermes no WhatsApp) e quem envia registra o envio. O Hermes lê e escreve nesta mesma fila pelo MCP." : "Aqui você cuida da relação com cada cliente: gera as mensagens, revisa, publica e age nos alertas. Nada desta tela aparece ao cliente."}
        descricao={
          // Sinal de vida: quando os números foram lidos por último, e ler de novo.
          <button
            type="button"
            onClick={() => void refreshCentral()}
            title="Ler os dados de novo"
            className={juntar("inline-flex items-center rounded text-[12px] text-muted-foreground transition-colors hover:text-foreground", foco)}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Atualizando..." : `Dados de ${lastSyncLabel}`}
          </button>
        }
        acoes={
          <>
            {!cycleReview && <AgenteDaCentral />}
            <button
              type="button"
              data-tour="central-gerador"
              aria-label="Gerar mensagens de hoje"
              title="Gerar mensagens de hoje"
              onClick={() => { setGenClientId(reviewClientId || "__all__"); setGenRitual(ritualForToday()); setGenPreviews(null); setGeneratorOpen(true); }}
              className={botao.primario}
            >
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /><span className="sm:hidden">Gerar</span><span className="hidden sm:inline">Gerar mensagens de hoje</span>
            </button>
          </>
        }
      />
      {/* Leitura sem teto que corte (frente CE, 28/09): a Central lê tudo em
          páginas. O aviso só aparece quando uma leitura FALHOU agora (o
          painel tenta de novo sozinho e mantém o que já tinha) ou quando a
          guarda de páginas foi atingida, que é defeito de consulta. */}
      {(() => {
        const falhas = [
          falhouAprovacoes && "aprovações", falhouArquivos && "entregas", falhouMarcos && "marcos",
          falhouMemoria && "memória", falhouPautas && "pautas", falhouPublicacoes && "publicações",
        ].filter(Boolean) as string[];
        const cortadas = Object.entries(cortes.current).filter(([, cortado]) => cortado).map(([nome]) => nome);
        if (!falhas.length && !cortadas.length) return null;
        return (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning" role="status">
            {falhas.length > 0 && <>Não foi possível ler agora: {falhas.join(", ")}. O painel tenta de novo sozinho e mantém o que já tinha. </>}
            {cortadas.length > 0 && <>Leitura interrompida pela guarda de segurança em {cortadas.join(", ")}: avise o suporte.</>}
          </p>
        );
      })()}

      {/* Hoje, numa faixa só (dono, 26/09: "muito texto, muita coisa"): a
          saudação com o ritual do dia, o porquê no "?", e os números da
          carteira numa linha, sem caixa por número. Cada número leva à aba
          onde se age. */}
      {!cycleReview && (() => {
        const todayRitual = ritualMeta(ritualForToday())!;
        const stuckApprovals = healthRows.filter((r) => r.alerts.some((a) => a.kind === "aprovacao")).length;
        const financialAlerts = healthRows.filter((r) => r.alerts.some((a) => a.kind === "financeiro")).length;
        const greeting = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";
        const weekday = new Date().toLocaleDateString("pt-BR", { weekday: "long" });
        const numeros: { chave: string; valor: number; rotulo: string; dica: string; cor: string; tab: string }[] = [
          ...(stuckApprovals > 0 ? [{ chave: "aprovacoes", valor: stuckApprovals, rotulo: stuckApprovals === 1 ? "aprovação parada" : "aprovações paradas", dica: "Toque para ver quem cobrar", cor: "text-warning", tab: "carteira" }] : []),
          ...(financialAlerts > 0 ? [{ chave: "pagamentos", valor: financialAlerts, rotulo: financialAlerts === 1 ? "pagamento vencido" : "pagamentos vencidos", dica: "Toque para ver", cor: "text-destructive", tab: "carteira" }] : []),
          ...(opportunities.length > 0 ? [{ chave: "oportunidades", valor: opportunities.length, rotulo: opportunities.length === 1 ? "oportunidade" : "oportunidades", dica: "Ideias para vender mais: toque para abrir o Radar", cor: "text-info", tab: "radar" }] : []),
          { chave: "saudaveis", valor: healthy, rotulo: "saudáveis", dica: "Clientes com nota boa", cor: "text-success", tab: "carteira" },
          { chave: "atencao", valor: attention, rotulo: "em atenção", dica: "Clientes que pedem cuidado", cor: "text-warning", tab: "carteira" },
          { chave: "risco", valor: risk, rotulo: "risco alto", dica: "Clientes em risco", cor: "text-destructive", tab: "carteira" },
          { chave: "rascunhos", valor: draftReports.length, rotulo: draftReports.length === 1 ? "rascunho na fila" : "rascunhos na fila", dica: "Esperando a sua revisão", cor: "text-primary", tab: "fila" },
          { chave: "pulsos", valor: pulseAnswers, rotulo: "pulsos", dica: "Pulsos respondidos pelos clientes", cor: "text-info", tab: "radar" },
        ];
        return (
          <div className="flex min-w-0 flex-col xl:flex-row xl:items-center xl:justify-between" data-faixa-da-central="">
            <div className="flex min-w-0 items-center xl:mr-6">
              <p className={juntar(texto.corpo, "min-w-0")}>
                {greeting}, {(profile?.full_name || "").split(" ")[0] || "time"}. Hoje é {weekday}: dia de <span className="font-medium text-primary">{todayRitual.label}</span>.
              </p>
              <AjudaRecolhida className="ml-1.5" rotulo="Por que este ritual hoje">
                {todayRitual.why}. Use &quot;Gerar mensagens de hoje&quot;, revise cliente por cliente e publique. Os números ao lado levam direto à aba onde se age.
              </AjudaRecolhida>
            </div>
            {/* No celular os números ficam numa linha que corre para o lado (sem ocupar duas linhas de toque). */}
            <div className="scrollbar-hidden -mx-1.5 mt-1.5 flex min-w-0 items-center overflow-x-auto overscroll-x-contain sm:flex-wrap sm:overflow-visible xl:mt-0 xl:justify-end" data-fichas-da-central="">
              {numeros.map((f) => (
                <button
                  key={f.chave}
                  type="button"
                  title={f.dica}
                  onClick={() => setActiveTab(f.tab)}
                  className={juntar("inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", foco)}
                >
                  <span className={`mr-1 font-semibold tabular-nums ${f.cor}`}>{f.valor}</span>
                  {f.rotulo}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* As abas, e o que a aba aberta faz num "?" ao lado (antes era uma
          linha de texto fixa embaixo). */}
      {!cycleReview && (
        <Etapas
          rotulo="Abas da Central"
          itens={abasDaCentral}
          valor={activeTab}
          onEscolher={setActiveTab}
          className="-mx-1 border-b border-border"
          depois={<AjudaRecolhida className="ml-1 mr-1" rotulo="O que esta aba faz" lado="bottom">{ajudaDaAba[activeTab]}</AjudaRecolhida>}
        />
      )}

      {/* Do notebook para cima a aba ocupa a altura da janela e rola por
          dentro (a posição fica guardada por aba); no celular a página rola. */}
      <AreaDeTrabalho principalRolavel={false}>

        {/* ── Carteira recorrente ── */}
        {activeTab === "carteira" && (
          <RegiaoRolavel modo="lg" rotulo="Carteira" memoria="central:carteira" className="lg:pb-16 lg:pr-1">
            <Secao
              titulo="Saúde da carteira"
              descricao={`${healthRows.length} ${healthRows.length === 1 ? "cliente recorrente" : "clientes recorrentes"}`}
              ajuda="Cada cliente recebe uma nota de 0 a 100 calculada dos dados reais (financeiro, aprovações, entregas, Pulso). Toque em um cliente para ver o porquê da nota e as ações prontas: mensagem do grupo, ritual e cadastro."
            >
              {carregandoClientes && healthRows.length === 0 ? (
                <Carregando rotulo="Carregando a carteira" linhas={4} />
              ) : healthRows.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhum cliente ativo na carteira." />
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {healthRows.map((row) => {
                    const meta = levelMeta[row.level];
                    const open = expandedHealth === row.client.id;
                    return (
                      <li key={row.client.id} className="min-w-0">
                        <button type="button" aria-expanded={open} onClick={() => setExpandedHealth(open ? null : row.client.id)} className={linhaDeLista}>
                          <span className={`mr-3 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                            {nomeDoCliente(row.client)}
                            {row.pulse && <span className={juntar(etiqueta, "ml-1.5 bg-info/10 text-info")}>Pulso {row.pulse.score}/5</span>}
                          </span>
                          {row.alerts.slice(0, 1).map((a) => (
                            <span key={a.label} className={juntar(etiqueta, "ml-2 hidden bg-destructive/10 text-destructive sm:inline-flex")}>{a.label}</span>
                          ))}
                          <span className={`ml-3 w-10 shrink-0 text-right text-sm font-semibold tabular-nums ${meta.cls}`}>
                            {row.score === null ? "s/ dado" : row.score}
                          </span>
                          <ChevronDown className={`ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                        </button>
                        {open && (
                          <div className="space-y-3 pb-4 pl-1 pr-1 sm:pl-6">
                            <div className={juntar(superficie.poco, "space-y-1.5 px-3 py-2.5")}>
                              {row.factors.map((f) => (
                                <div key={f.label} className="flex min-w-0 items-baseline text-[12px]">
                                  <span className="min-w-0 flex-1 text-muted-foreground">{f.label}</span>
                                  <span className="ml-3 min-w-0 text-right text-muted-foreground">{f.note}</span>
                                  <span className={`ml-3 w-14 shrink-0 text-right tabular-nums ${f.earned === null ? "text-muted-foreground/60" : f.earned >= f.weight ? "text-success" : f.earned === 0 ? "text-destructive" : "text-warning"}`}>
                                    {f.earned === null ? "s/ dado" : `${f.earned}/${f.weight}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {row.alerts.length > 0 && (
                              <div className="-m-0.5 flex flex-wrap [&>*]:m-0.5">
                                {row.alerts.map((a) => (
                                  <span key={a.label} className={juntar(etiqueta, "bg-destructive/10 text-destructive")}>
                                    <AlertTriangle className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> {a.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className={grupoDeBotoes}>
                              <button
                                type="button"
                                onClick={() => (contextoPronto ? copyText(buildGroupMessage(row.client), "Mensagem do grupo copiada. É só colar no WhatsApp.") : avisarContextoCarregando())}
                                className={botao.secundario}
                              >
                                <Send className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Copiar mensagem do grupo
                              </button>
                              <button type="button" onClick={() => { setProfileClientId(row.client.id); setActiveTab("perfis"); }} className={botao.discreto}>
                                <UserCircle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Ver perfil completo
                              </button>
                              <button type="button" onClick={() => { setGenClientId(row.client.id); setGenRitual(ritualForToday()); setGenPreviews(null); setGeneratorOpen(true); }} className={botao.discreto}>
                                <Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Gerar ritual deste cliente
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </RegiaoRolavel>
        )}

        {/* ── Perfis: o plano de comunicação de cada cliente ── */}
        {activeTab === "perfis" && (() => {
          const selected = healthRows.find((r) => r.client.id === profileClientId) || healthRows[0] || null;
          if (!selected) {
            return carregandoClientes
              ? <Carregando forma="aba" rotulo="Carregando o perfil" />
              : <EstadoVazio icone={<UserCircle className="h-5 w-5" />} titulo="Nenhum cliente na carteira ainda." />;
          }
          const client = selected.client;
          const clientProjs = (projects || []).filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at);
          const meta = levelMeta[selected.level];
          // nowTick avança sozinho: virou o dia, a etiqueta "hoje" muda de linha
          // sem ninguém recarregar a tela.
          const ritualQuando = (r: { value: string; dia?: number }) => ritualTiming(r, nowTick);

          const ritualStatus = (ritual: string) => {
            const rows = (reports || []).filter((r: any) => r.client_id === client.id && (r.metrics as any)?.ritual_type === ritual);
            const latest = rows[0];
            // Marcado a mao no Ciclo nesta semana: vale como feito.
            const chaveCiclo = RITUAL_DA_CENTRAL[ritual];
            const noCiclo = chaveCiclo ? rituaisDoCiclo.find((r) => r.client_id === client.id && r.ritual_key === chaveCiclo) : undefined;
            if (!latest && noCiclo) return { label: `Feito no Ciclo (${noCiclo.source === "central" ? "daqui" : "à mão"})`, cls: "bg-success/10 text-success" };
            if (!latest) return { label: "Ainda não gerado", cls: "bg-muted text-muted-foreground" };
            const age = daysSince(latest.created_at) ?? 0;
            if (latest.status !== "published") return { label: `Rascunho na fila (${age}d)`, cls: "bg-warning/10 text-warning" };
            return { label: `Publicado há ${age}d`, cls: "bg-success/10 text-success" };
          };
          const d = dossieDe(client.id);
          const p = planoDe(client.id);
          const v30 = vendasDe(client.id, 30);
          const servicos = Object.entries(SERVICE_NAMES).filter(([k]) => (client.services_config || {})[k] === true).map(([, n]) => n);
          const dias = daysSince(client.created_at);
          const lastRitual = (reports || []).find(
            (r: any) => r.client_id === client.id && r.status === "published" && (r.metrics as any)?.ritual_type
          );
          return (
            <RegiaoRolavel modo="lg" rotulo="Perfil do cliente" memoria={`central:perfis:${client.id}`} className="lg:pb-16 lg:pr-1">
              <div className="space-y-6">
                {/* Quem é o cliente, sem caixa: foto, o seletor com o nome, o
                    estado numa linha e os atalhos à direita ("..." no celular). */}
                <div className="flex min-w-0 items-start">
                  <FotoDoCliente nome={nomeDoCliente(client)} foto={fotoDe({ id: String(client.id), nome: nomeDoCliente(client), avatar_url: client.avatar_url })} tamanho="xl" className="!h-12 !w-12 sm:!h-14 sm:!w-14" />
                  <div className="ml-3 min-w-0 flex-1">
                    <SeletorCompacto
                      modo="lista"
                      rotulo="Cliente do perfil"
                      opcoes={healthRows.map((r) => ({ valor: String(r.client.id), rotulo: nomeDoCliente(r.client) }))}
                      valor={String(client.id)}
                      onEscolher={setProfileClientId}
                      className="-ml-2.5 border-transparent text-[15px] font-semibold"
                    />
                    <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                      {[servicos.length ? servicos.join(" + ") : "sem frente marcada", client.plan_name || null, dias !== null ? `${dias} dias na casa` : null].filter(Boolean).join(" · ")}
                    </p>
                    <div className="-m-0.5 mt-1.5 flex min-w-0 flex-wrap [&>*]:m-0.5">
                      <span className={juntar(etiqueta, "bg-muted", meta.cls)}>{meta.label} · nota {selected.score ?? "s/ dado"}</span>
                      {selected.pulse && <span className={juntar(etiqueta, "bg-info/10 text-info")}>Pulso {selected.pulse.score}/5</span>}
                      <span className={juntar(etiqueta, "bg-primary/10 text-primary")}><BookOpen className="mr-1 h-3 w-3" aria-hidden="true" />{rotuloDoDossie(d, nowTick)}</span>
                      <span className={juntar(etiqueta, v30.total > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}><BadgeDollarSign className="mr-1 h-3 w-3" aria-hidden="true" />{v30.total > 0 ? `${v30.total} venda${v30.total === 1 ? "" : "s"} em 30 dias${v30.receita > 0 ? ` · R$ ${Math.round(v30.receita).toLocaleString("pt-BR")}` : ""}` : "sem venda registrada em 30 dias"}</span>
                      {clientProjs.length > 0 && <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{clientProjs.length} frente{clientProjs.length === 1 ? "" : "s"} ativa{clientProjs.length === 1 ? "" : "s"}</span>}
                    </div>
                  </div>
                  {/* Mesa do cliente: calendário e arte com IA (admin, gestor e design). */}
                  <div className="ml-2 hidden shrink-0 items-center md:flex [&>*+*]:ml-1">
                    {["admin", "manager", "design"].includes(profile?.role || "") && (
                      <>
                        <button type="button" onClick={() => navigate(`/mesa?client=${client.id}&aba=estudio`)} className={botao.discreto}>Mesa</button>
                        <button type="button" onClick={() => navigate(`/mesa-ads?client=${client.id}`)} className={botao.discreto}>Mesa Ads</button>
                        <button type="button" onClick={() => navigate(`/mesa-foto?client=${client.id}`)} className={botao.discreto}>Mesa Foto</button>
                      </>
                    )}
                    <button type="button" onClick={() => openClientProfile(client.id)} className={botao.secundario}>Abrir cadastro</button>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label="Atalhos do cliente" className={juntar(botao.icone, "ml-1 md:hidden")}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {podeAbrirMesas && <DropdownMenuItem onSelect={() => navigate(`/mesa?client=${client.id}&aba=estudio`)}>Mesa</DropdownMenuItem>}
                      {podeAbrirMesas && <DropdownMenuItem onSelect={() => navigate(`/mesa-ads?client=${client.id}`)}>Mesa Ads</DropdownMenuItem>}
                      {podeAbrirMesas && <DropdownMenuItem onSelect={() => navigate(`/mesa-foto?client=${client.id}`)}>Mesa Foto</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => openClientProfile(client.id)}>Abrir cadastro</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Duas colunas no computador, uma no celular. Sem caixas: cada
                    coluna é uma sequência de seções separadas por espaço e linha. */}
                <div data-tour="central-carteira" className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
                  {/* Plano de mensagens do período */}
                  <div className="min-w-0" data-coluna="rituais">
                    <Secao
                      titulo="O que enviar e quando"
                      ajuda="Cada geração usa a movimentação real deste cliente e varia o texto semana a semana. Você revisa e edita antes de qualquer coisa chegar nele."
                    >
                      <ul className="divide-y divide-border border-y border-border">
                        {RITUALS.map((r) => {
                          const status = ritualStatus(r.value);
                          const quando = ritualQuando(r);
                          return (
                            <li
                              key={r.value}
                              className={`relative flex min-w-0 flex-wrap items-center py-3 pl-3 pr-1 transition-colors ${quando.destaque ? "bg-primary/[0.04]" : ""}`}
                            >
                              {/* Faixa lateral só no que é de hoje: dá para achar
                                  a linha certa sem ler as cinco. */}
                              <span aria-hidden className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r ${quando.destaque ? "bg-primary" : "bg-transparent"}`} />
                              <div className="w-full min-w-0 sm:mr-3 sm:w-auto sm:flex-1">
                                <div className="flex min-w-0 flex-wrap items-center">
                                  <p className="text-[13.5px] font-medium leading-tight text-foreground">{r.label}</p>
                                  {quando.etiqueta && <span className={juntar(etiqueta, "ml-2", quando.cls)}>{quando.etiqueta}</span>}
                                </div>
                                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={`${r.cadence} · ${r.why}`}>{r.cadence} · {r.why}</p>
                              </div>
                              <div className="mt-2 flex w-full min-w-0 items-center justify-between sm:mt-0 sm:w-auto sm:justify-end">
                                <span className={juntar(etiqueta, "mr-2", status.cls)}>{status.label}</span>
                                <button
                                  type="button"
                                  onClick={() => { setGenClientId(client.id); setGenRitual(r.value); setGenPreviews(null); setGeneratorOpen(true); }}
                                  className={quando.destaque ? botao.primario : botao.secundario}
                                >
                                  Gerar agora
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </Secao>
                  </div>

                  {/* Mensagens do grupo por momento + contexto */}
                  <div className="min-w-0 space-y-6" data-coluna="mensagens">
                    {/* A mensagem é montada da leitura ao vivo do painel. Se
                        alguém acabou de liberar material, marcar etapa ou
                        registrar decisão, "Atualizar" traz o texto já com isso,
                        sem recarregar a página inteira. */}
                    <Secao
                      titulo="Mensagem do grupo"
                      ajuda="Escolha o momento da semana. A mensagem é montada na hora com entregas, frentes e pendências reais, seguindo a linha da semana (abertura, meio e fechamento). O texto varia a cada semana para nunca soar repetido."
                      acao={
                        <button type="button" onClick={() => void atualizarMensagens()} disabled={atualizandoMensagens} className={botao.discreto} title="Ler de novo o que a mensagem usa">
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${atualizandoMensagens ? "animate-spin" : ""}`} aria-hidden="true" />
                          {atualizandoMensagens ? "Atualizando..." : "Atualizar"}
                        </button>
                      }
                    >
                      <div className={juntar(superficie.poco, "px-3 py-2")}>
                        <p className="text-[12px] text-primary">{rotuloDoDossie(d, nowTick)}{p?.foco ? ` · plano da semana lido` : " · sem plano da semana ainda"}</p>
                        {d?.substituto && <p className="mt-0.5 text-[12px] text-warning">Este cliente não tem dossiê geral; a leitura está usando o de projeto. Escreva o geral para a mensagem ficar certa.</p>}
                        {d && d.mudancas.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {d.mudancas.slice(0, 4).map((m, i) => <li key={i} className="text-[12px] leading-snug text-foreground/90">• {m}</li>)}
                          </ul>
                        )}
                        {p?.foco && <p className="mt-1 text-[12px] text-foreground/90"><span className="text-muted-foreground">Foco: </span>{p.foco}</p>}
                      </div>
                      <div className="mt-3">
                        <SeletorDeModelo escolha={escolhaDoModelo} onMudar={setEscolhaDoModelo} compacto />
                      </div>
                      <ul className="mt-3 divide-y divide-border border-t border-border">
                        {[
                          { moment: "abertura" as const, label: "Abertura da semana (segunda)" },
                          { moment: "meio" as const, label: "Meio da semana (quarta)" },
                          { moment: "fechamento" as const, label: "Fechamento (sexta)" },
                        ].map((m) => {
                          const isPreviewOpen = groupMsgPreview === m.moment;
                          const chaveIA = `${client.id}:${m.moment}`;
                          const escrita = aiMoment[chaveIA] ?? null;
                          const textoParaCopiar = escrita ? escrita.body : buildGroupMessage(client, m.moment);
                          return (
                            <li key={m.moment} className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center py-1.5 pl-1">
                                <span className="w-full min-w-0 text-[13px] text-foreground sm:mr-3 sm:w-auto sm:flex-1">{m.label}</span>
                                <span className="-ml-2.5 flex shrink-0 items-center sm:ml-0">
                                  <button
                                    type="button"
                                    data-botao-do-momento=""
                                    aria-expanded={isPreviewOpen}
                                    onClick={() => setGroupMsgPreview(isPreviewOpen ? null : m.moment)}
                                    className={botao.discreto}
                                  >
                                    {isPreviewOpen ? "Fechar" : "Ver"}
                                  </button>
                                  <button
                                    type="button"
                                    data-botao-do-momento=""
                                    onClick={() => void escreverMomentoComIA(client, m.moment)}
                                    disabled={aiMomentLoading !== null}
                                    className={juntar(botao.discreto, "text-primary")}
                                    title="Escreve esta mensagem com a IA a partir do dossiê, da esteira, dos números e das vendas de agora"
                                  >
                                    <Sparkles className={`mr-1 h-3.5 w-3.5 ${aiMomentLoading === chaveIA ? "animate-pulse" : ""}`} aria-hidden="true" /> {aiMomentLoading === chaveIA ? "Escrevendo…" : escrita ? "Reescrever com IA" : "Escrever com IA"}
                                  </button>
                                  <button
                                    type="button"
                                    data-botao-do-momento=""
                                    onClick={() => (escrita || contextoPronto ? copyText(textoParaCopiar, `Mensagem de ${m.label.toLowerCase()} copiada.`) : avisarContextoCarregando())}
                                    className={juntar(botao.discreto, "text-primary")}
                                  >
                                    <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Copiar{escrita ? " (IA)" : ""}
                                  </button>
                                </span>
                              </div>
                              {/* Ver antes de enviar: o texto completo, gerado na
                                  hora com os dados reais e a lógica da semana. */}
                              {isPreviewOpen && (
                                <div className={juntar(superficie.poco, "mb-3 px-3 py-3")}>
                                  {escrita && (
                                    <p className="mb-1.5 text-[12px] text-primary">Escrita pela IA{escrita.model ? ` (${escrita.model})` : ""} com o dossiê, a esteira, os números e as vendas de agora. O texto do painel fica abaixo como reserva.</p>
                                  )}
                                  {escrita && escrita.alertas.length > 0 && (
                                    <div className="mb-2">
                                      <p className="text-[12px] font-medium text-warning">Avisos para a equipe (não vão ao cliente)</p>
                                      <ul className="mt-0.5 space-y-0.5">{escrita.alertas.map((a, i) => <li key={i} className="text-[12px] leading-snug text-foreground/85">• {a}</li>)}</ul>
                                    </div>
                                  )}
                                  <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-foreground">
                                    {escrita ? escrita.body : buildGroupMessage(client, m.moment)}
                                  </p>
                                  {escrita && (
                                    <details className="mt-2">
                                      <summary className="cursor-pointer text-[12px] text-muted-foreground">Ver o texto do painel (reserva)</summary>
                                      <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">{buildGroupMessage(client, m.moment)}</p>
                                    </details>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => (contextoPronto ? copyText(buildGroupMessage(client, m.moment), "Mensagem copiada. É só colar no WhatsApp.") : avisarContextoCarregando())}
                                    className={juntar(botao.secundario, "mt-2")}
                                  >
                                    <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar esta mensagem
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </Secao>

                    <Secao
                      divisoria
                      titulo="Onde estamos com este cliente"
                      acao={lastRitual ? (
                        <button type="button" onClick={() => navigate(`/relatorios/${lastRitual.id}`)} className={botao.discreto}>
                          Ver completa <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : undefined}
                    >
                      {lastRitual ? (
                        <>
                          <p className="text-[13px] font-medium text-foreground">{lastRitual.title}</p>
                          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{resumoDoRitual(lastRitual.summary, 420)}</p>
                        </>
                      ) : (
                        <EstadoVazio compacto titulo="Nenhuma atualização publicada ainda." descricao="Gere a Rota da Semana para abrir o primeiro ciclo." />
                      )}
                    </Secao>

                    {/* key por cliente: trocar de cliente no seletor zera o que
                        estava aberto ou digitado. Sem ela, uma nota escrita no
                        diário de um cliente podia ser salva no seguinte. */}
                    <DossieDoCliente
                      key={`dossie-${client.id}`}
                      clientId={client.id}
                      clientName={nomeDoCliente(client)}
                    />

                    <div className="min-w-0 border-t border-border pt-5">
                      <ProjectJournal key={`diario-${client.id}`} clientId={client.id} canWrite />
                    </div>

                    <Secao divisoria titulo="Contexto agora">
                      <dl className="space-y-1 text-[12.5px]">
                        <div className="flex min-w-0"><dt className="mr-1.5 shrink-0 text-muted-foreground">Plano:</dt><dd className="min-w-0 text-foreground">{client.plan_name || "Sem plano"}{client.plan_value ? ` · ${fmt(Number(client.plan_value))}/mês` : ""}</dd></div>
                        <div className="flex min-w-0"><dt className="mr-1.5 shrink-0 text-muted-foreground">Frentes ativas:</dt><dd className="min-w-0 text-foreground">{clientProjs.length > 0 ? clientProjs.map((p: any) => p.name).join(", ") : "nenhuma"}</dd></div>
                        {selected.factors.map((f) => (
                          <div key={f.label} className="flex min-w-0"><dt className="mr-1.5 shrink-0 text-muted-foreground">{f.label}:</dt><dd className="min-w-0 text-foreground">{f.note}</dd></div>
                        ))}
                      </dl>
                    </Secao>
                  </div>
                </div>
              </div>
            </RegiaoRolavel>
          );
        })()}

        {/* ── Avulsos: experiência e reativação ── */}
        {activeTab === "avulsos" && (
          <RegiaoRolavel modo="lg" rotulo="Clientes avulsos" memoria="central:avulsos" className="lg:pb-16 lg:pr-1">
            <Secao
              titulo="Clientes avulsos"
              descricao={`${oneOffClients.length} ${oneOffClients.length === 1 ? "cliente" : "clientes"}`}
              ajuda="Pós-entrega e reativação. Cada avulso bem atendido é um recorrente em potencial: quem está parado há 3 semanas ou mais aparece como pronto para reativação."
            >
              {carregandoClientes && oneOffClients.length === 0 ? (
                <Carregando rotulo="Carregando os avulsos" linhas={3} />
              ) : oneOffClients.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhum cliente avulso cadastrado." />
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {oneOffClients.map((client: any) => {
                    const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && !p.deleted_at);
                    const activeCount = clientProjects.filter((p: any) => p.status !== "done").length;
                    const doneCount = clientProjects.filter((p: any) => p.status === "done").length;
                    const lastActivity = clientProjects
                      .map((p: any) => p.updated_at || p.created_at)
                      .sort()
                      .reverse()[0];
                    const age = daysSince(lastActivity);
                    const idle = activeCount === 0 && doneCount > 0 && age !== null && age >= 21;
                    return (
                      <li key={client.id} className="flex min-w-0 flex-wrap items-center px-1 py-2.5">
                        <div className="w-full min-w-0 sm:mr-3 sm:w-auto sm:flex-1">
                          <p className="truncate text-[13px] text-foreground">{nomeDoCliente(client)}</p>
                          <p className={juntar(texto.auxiliar, "truncate")}>
                            {activeCount > 0
                              ? `${activeCount} projeto(s) em andamento`
                              : doneCount > 0
                                ? `${doneCount} projeto(s) entregues · última movimentação há ${age ?? "?"}d`
                                : "Sem projetos registrados"}
                          </p>
                        </div>
                        <div className="mt-1.5 flex min-w-0 items-center sm:mt-0 [&>*+*]:ml-2">
                          {idle && <span className={juntar(etiqueta, "bg-warning/10 text-warning")}>Pronto para reativação</span>}
                          {activeCount > 0 && <span className={juntar(etiqueta, "bg-success/10 text-success")}>Em atendimento</span>}
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                `Oi, ${client.full_name?.split(" ")[0] || "tudo bem"}! Aqui é da Aceleriq. 😊\n\n${
                                  doneCount > 0
                                    ? `Faz ${age ?? "algum tempo"} dia(s) que entregamos ${doneCount === 1 ? "o seu projeto" : `os seus ${doneCount} projetos`} e queremos saber: como estão os resultados por aí?`
                                    : "Queremos saber como estão as coisas por aí."
                                }\n\nSe fizer sentido, a gente conversa sobre o próximo passo — pode ser um acompanhamento contínuo ou um trabalho pontual, o que fizer mais sentido para o momento de vocês.\n\nTopa conversar esta semana?`,
                                "Mensagem de reativação copiada."
                              )
                            }
                            className={botao.secundario}
                          >
                            Copiar mensagem
                          </button>
                          <button type="button" onClick={() => openClientProfile(client.id)} aria-label="Abrir cadastro" title="Abrir cadastro" className={botao.icone}>
                            <UserCircle className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </RegiaoRolavel>
        )}

        {/* ── Radar do mês ── */}
        {activeTab === "radar" && (
          <RegiaoRolavel modo="lg" rotulo="Radar de ideias" memoria="central:radar" className="lg:pb-16 lg:pr-1">
            <Secao
              titulo="Radar de ideias"
              descricao={opportunities.length > 0 ? "Valor e serviço avulso aparecem só para a equipe." : undefined}
              ajuda="O Radar é o ritual de antecipação da carteira recorrente: uma vez por mês a Aceleriq chega com uma ideia de diferenciação que o cliente até já pensou em fazer e nunca executou. Cada ideia carrega o momento real dele (frentes, materiais recentes, publicações, Pulso, crescimento medido). A faixa de valor e o serviço avulso nunca entram na mensagem que o cliente recebe: para ele é ideia, não proposta comercial. A IA lê o contexto real do cliente e busca tendências do nicho antes de propor."
              // Gerador com IA (ideias do nicho, com busca na web): na linha do
              // título no computador; no celular numa linha própria, logo abaixo.
              acao={opportunities.length > 0 ? <div className="hidden items-center sm:flex [&>*+*]:ml-2">{controlesDoRadar("max-w-[240px]")}</div> : undefined}
            >
              {opportunities.length > 0 && <div className="mb-3 flex min-w-0 items-center sm:hidden [&>*+*]:ml-2">{controlesDoRadar("min-w-0 flex-1")}</div>}
              {opportunities.length === 0 ? (
                <EstadoVazio
                  icone={<Radar className="h-5 w-5" />}
                  titulo="Nenhuma ideia no radar agora."
                  descricao="Assim que houver material produzido, publicações no ar ou Pulso respondido, as ideias do mês aparecem aqui por cliente."
                />
              ) : (
                <ul className="lista-longa divide-y divide-border border-y border-border">
                  {allRadarIdeas.map((idea) => {
                    const lens = RADAR_LENSES[idea.lens];
                    const [low, high] = idea.internal.range;
                    return (
                      <li key={idea.id} className="flex min-w-0 py-4 pl-1 pr-1">
                        <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-info/10 text-info" aria-hidden="true">
                          <Radar className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center">
                            <span className={juntar(etiqueta, "mr-2 bg-primary/10 text-primary")}>
                              {idea.source === "ia" ? "IA + busca na web" : lens.label}
                            </span>
                            <p className="min-w-0 text-[13.5px] font-medium text-foreground">{idea.title}</p>
                          </div>

                          {/* A IDEIA, descrita por completo. */}
                          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/85">{idea.pitch}</p>

                          {/* O retrato real do cliente: é ele que faz a ideia deixar
                              de parecer genérica. A IA já embute o contexto no motivo. */}
                          {idea.moment && (
                            <p className={juntar(superficie.poco, "mt-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-muted-foreground")}>{idea.moment}</p>
                          )}

                          <p className="mt-2 text-[12px] text-muted-foreground">
                            <span className="text-foreground/70">Por que agora: </span>
                            {idea.whyNow}
                          </p>

                          <ul className="mt-1.5 space-y-0.5">
                            {idea.moves.map((move) => (
                              <li key={move} className="text-[12px] text-muted-foreground">· {move}</li>
                            ))}
                          </ul>

                          <p className="mt-1.5 text-[12px] text-muted-foreground">
                            <span className="text-foreground/70">Sinal que vamos olhar: </span>
                            {idea.signal}
                          </p>

                          {/* Leitura da equipe. Nunca vai para o cliente. */}
                          <div className="mt-2.5 rounded-md bg-warning/[0.07] px-3 py-2">
                            <p className="flex items-center text-[12px] font-medium text-warning">
                              Só a equipe vê · sugestão
                              <AjudaRecolhida className="ml-1" rotulo="Sobre a faixa de valor">
                                Você decide se cobra, quanto cobra ou se entrega como cortesia. A faixa é só um ponto de partida e nada disso vai para o cliente.
                              </AjudaRecolhida>
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              Se aprovada, pode virar: <span className="text-foreground/80">{idea.internal.offer}</span>
                              {high > 0 && ` · referência ${fmt(low)} a ${fmt(high)}`} · esforço {idea.internal.effort}
                            </p>
                          </div>

                          <div className={juntar(grupoDeBotoes, "mt-2.5")}>
                            <button
                              type="button"
                              onClick={() => {
                                setGenClientId(idea.id.split(":")[0]);
                                setGenRitual("radar_aceleriq");
                                setGenIdeaId(idea.id);
                                setGenPreviews(null);
                                setGeneratorOpen(true);
                              }}
                              className={botao.secundario}
                            >
                              Levar esta ideia ao cliente
                            </button>
                            <button type="button" onClick={() => { setProfileClientId(idea.id.split(":")[0]); setActiveTab("perfis"); }} className={botao.discreto}>
                              Ver perfil do cliente
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </RegiaoRolavel>
        )}

        {/* ── Fila de revisão ── */}
        {activeTab === "fila" && (() => {
          const comPedido = cycleReview || new URLSearchParams(location.search).has("review");
          const rascunhosVisiveis = draftReports.filter((r) => !reviewClientId || r.client_id === reviewClientId);
          return (
            <RegiaoRolavel modo="lg" rotulo="Fila de revisão" memoria={cycleReview ? `ciclo-revisao:${reviewClientId || "todos"}` : "central:fila"} className="lg:pb-16 lg:pr-1">
              <div className="space-y-8">
                {/* A revisao formal (preparar, decidir, registrar envio) e a area do
                    Hermes em Ciclo > Revisao. Na Central ela so aparece quando um
                    link de pedido chega (?review=...). O resto e caminho curto:
                    gerar, aprimorar, copiar para o grupo, publicar. */}
                {(cycleReview || new URLSearchParams(location.search).has("review")) && (
                  <CentralReviewQueue key={reviewClientId || "all-clients"} memoria={cycleReview && user?.id ? `ciclo-revisao:${user.id}` : null} reports={reviewClientId ? reports.filter(report => report.client_id === reviewClientId) : reports} clients={reviewClientId ? (clients || []).filter(client => client.id === reviewClientId) : clients || []} isAdmin={isAdmin} onRefresh={async () => {
                    await queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
                  }} />
                )}
                <Secao
                  divisoria={comPedido}
                  titulo="Mensagens geradas"
                  descricao={`${rascunhosVisiveis.length} ${rascunhosVisiveis.length === 1 ? "rascunho" : "rascunhos"} na fila`}
                  ajuda="Nada daqui chegou ao cliente ainda. Abra a mensagem, aprimore com a IA se quiser, copie para o grupo ou publique no portal. Ao registrar o envio, ela entra no histórico, no dossiê e marca o ritual no Ciclo. A revisão formal com o Hermes fica em Ciclo › Revisão."
                >
                  {carregandoRelatorios ? (
                    <Carregando rotulo="Carregando as mensagens" linhas={3} />
                  ) : erroNosRelatorios && reports.length === 0 ? (
                    <EstadoDeErro titulo="Não foi possível ler as mensagens." acao={<button type="button" onClick={() => void releRelatorios()} className={botao.secundario}>Tentar de novo</button>} />
                  ) : rascunhosVisiveis.length === 0 ? (
                    <EstadoVazio compacto titulo="Fila vazia." descricao={`Use "Gerar mensagens de hoje" para criar os rituais do dia com os dados de cada cliente.`} />
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {rascunhosVisiveis.map((r: any) => {
                        const meta = ritualMeta(r.metrics?.ritual_type);
                        const open = expandedDraft === r.id;
                        const edits = draftEdits[r.id] || { summary: r.summary || "", next_steps: r.next_steps || "" };
                        const modelo = (r.metrics as any)?.model;
                        return (
                          <li key={r.id} className="min-w-0">
                            <button type="button" aria-expanded={open} onClick={() => setExpandedDraft(open ? null : r.id)} className={linhaDeLista}>
                              <span className="mr-3 min-w-0 flex-1">
                                <span className="flex min-w-0 items-center">
                                  <span className="min-w-0 truncate text-[13px] text-foreground">{r.title}</span>
                                  {meta && <span className={juntar(etiqueta, "ml-2 hidden bg-primary/10 text-primary sm:inline-flex")}>{meta.label}</span>}
                                </span>
                                <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                                  {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                                </span>
                              </span>
                              <span className="shrink-0 text-[12px] text-muted-foreground">{open ? "Fechar" : "Revisar"}</span>
                              <ChevronDown className={`ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                            </button>
                            {open && (
                              <div className="space-y-3 pb-4 pl-1 pr-1 pt-1">
                                {meta && (
                                  <div className="flex min-w-0 items-center">
                                    <p className={juntar(texto.auxiliar, "min-w-0 truncate")}>{meta.label} · {meta.cadence}{modelo ? ` · IA (${rotuloDoModelo(modelo)})` : ""}</p>
                                    <AjudaRecolhida className="ml-1.5" rotulo="Por que este rascunho existe">
                                      Por que este rascunho existe: {meta.why}. Cadência: {meta.cadence}. Gerado com os dados reais do painel deste cliente{modelo ? ` pela IA (${rotuloDoModelo(modelo)})` : ""}.
                                    </AjudaRecolhida>
                                  </div>
                                )}
                                {Array.isArray((r.metrics as any)?.alertas) && (r.metrics as any).alertas.length > 0 && (
                                  <div className="rounded-md bg-warning/10 px-3 py-2">
                                    <p className="text-[12px] font-medium text-warning">Avisos para a equipe (o que faltou no painel, reforços e modelo; nada disso vai ao cliente)</p>
                                    <ul className="mt-0.5 space-y-0.5">{(r.metrics as any).alertas.map((a: string, i: number) => <li key={i} className="text-[12px] leading-snug text-foreground/85">• {a}</li>)}</ul>
                                  </div>
                                )}
                                <PromessasDoRascunho metricas={r.metrics} />
                                <CampoDeFormulario rotulo="Mensagem ao cliente (resultado explicado)">
                                  <textarea
                                    value={edits.summary}
                                    onChange={(e) => setDraftEdits((prev) => ({ ...prev, [r.id]: { ...edits, summary: e.target.value } }))}
                                    rows={4}
                                    className={juntar(campoTexto, "resize-y")}
                                  />
                                </CampoDeFormulario>
                                <CampoDeFormulario rotulo="Próxima etapa">
                                  <textarea
                                    value={edits.next_steps}
                                    onChange={(e) => setDraftEdits((prev) => ({ ...prev, [r.id]: { ...edits, next_steps: e.target.value } }))}
                                    rows={2}
                                    className={juntar(campoTexto, "min-h-[60px] resize-y")}
                                  />
                                </CampoDeFormulario>
                                <div className={grupoDeBotoes}>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => publishDraft(r, "grupo")}
                                      disabled={rascunhoEmVoo !== null}
                                      className={botao.primario}
                                      title="Registra que a mensagem foi enviada no grupo: entra no histórico, no dossiê e marca o ritual no Ciclo"
                                    >
                                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Enviei no grupo
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => copyText(edits.summary || r.summary || "", "Mensagem copiada. É só colar no grupo.")}
                                    className={botao.secundario}
                                  >
                                    <Send className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Copiar para o grupo
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void aprimorarRascunho(r)}
                                    disabled={aprimorando !== null}
                                    className={botao.secundario}
                                    title="A IA relê os fatos de agora, mantém o que está certo, completa o que falta e separa o próximo passo"
                                  >
                                    <Sparkles className={`mr-1.5 h-3.5 w-3.5 shrink-0 ${aprimorando === r.id ? "animate-pulse" : ""}`} aria-hidden="true" /> {aprimorando === r.id ? "Aprimorando…" : "Aprimorar com IA"}
                                  </button>
                                  {isAdmin && (
                                    <button type="button" onClick={() => publishDraft(r)} disabled={rascunhoEmVoo !== null} className={botao.secundario}>
                                      Publicar no portal
                                    </button>
                                  )}
                                  <button type="button" onClick={() => saveDraftEdits(r)} className={botao.discreto}>
                                    Salvar edição
                                  </button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button type="button" aria-label="Mais ações do rascunho" className={botao.icone}>
                                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onSelect={() => navigate(`/relatorios/${r.id}`)}>Abrir completo</DropdownMenuItem>
                                      {isAdmin && (
                                        <DropdownMenuItem disabled={rascunhoEmVoo !== null} onSelect={() => deleteDraft(r)} className="text-destructive focus:text-destructive">
                                          <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Descartar
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Secao>
              </div>
            </RegiaoRolavel>
          );
        })()}

        {/* ── Histórico: linha do tempo com o contexto inteiro do painel ── */}
        {activeTab === "historico" && (() => {
          const nameOf = (clientId: string) => {
            const client = portfolioClients.find((c: any) => c.id === clientId);
            return client ? (client.company_name || client.full_name) : "Cliente";
          };
          type TimelineEvent = { at: string; icon: "report" | "publication" | "approval" | "file" | "dossie" | "plano" | "venda"; text: string; clientId: string };
          const timeline: TimelineEvent[] = [
            // O dossie reescrito e o evento mais importante da semana: e
            // onde a leitura do cliente muda. Cada versao entra com o motivo.
            ...(expDossieVersoes as any[]).map((v) => ({
              at: v.created_at,
              icon: "dossie" as const,
              text: `Dossiê ${v.project_id ? "do projeto" : "geral"} v${v.version ?? "?"}${v.change_reason ? `: ${String(v.change_reason).slice(0, 110)}` : v.source ? ` (${v.source})` : ""}`,
              clientId: v.client_id,
            })),
            ...((expMemory as any[]) || []).filter((m) => m.kind === "esteira_plano" && m.metadata?.foco).map((m) => ({
              at: m.created_at,
              icon: "plano" as const,
              text: `Plano da semana ${String(m.metadata?.week_start || "").slice(5)}: ${String(m.metadata?.foco).slice(0, 120)}`,
              clientId: m.client_id,
            })),
            ...(expVendas as any[]).map((v) => ({
              at: `${v.sold_at}T12:00:00`,
              icon: "venda" as const,
              text: `Venda registrada${Number(v.quantity) > 1 ? ` (${v.quantity})` : ""}${v.value != null ? ` · R$ ${Math.round(Number(v.value)).toLocaleString("pt-BR")}` : ""}${v.campaign_name ? ` · ${v.campaign_name}` : ""}${v.channel ? ` · ${v.channel}` : ""}`,
              clientId: v.client_id,
            })),
            ...publishedReports.map((r: any) => ({
              at: r.created_at,
              icon: "report" as const,
              text: `Atualização publicada: ${r.title}`,
              clientId: r.client_id,
            })),
            ...allPublications
              .filter((p: any) => p.status === "published" && p.published_at)
              .map((p: any) => ({
                at: p.published_at,
                icon: "publication" as const,
                text: `Publicação no ar (${p.platform === "instagram" ? "Instagram" : p.platform})`,
                clientId: p.client_id,
              })),
            ...allPublications
              .filter((p: any) => p.status === "scheduled" && p.scheduled_at)
              .map((p: any) => ({
                at: p.scheduled_at,
                icon: "publication" as const,
                text: `Publicação programada (${p.platform === "instagram" ? "Instagram" : p.platform})`,
                clientId: p.client_id,
              })),
            ...pendingApprovalFiles.map((f: any) => ({
              at: f.created_at,
              icon: "approval" as const,
              text: `Enviado para aprovação: ${f.file_name}`,
              clientId: f.client_id,
            })),
            ...entreguesFiles.map((f: any) => ({
              at: f.created_at,
              icon: "file" as const,
              text: `Material liberado: ${f.file_name}`,
              clientId: f.client_id,
            })),
          ]
            .filter((event) => event.at)
            .filter((event) => historicoClientId === "__all__" || event.clientId === historicoClientId)
            .sort((a, b) => (a.at < b.at ? 1 : -1))
            .slice(0, 160);
          const iconMap = { report: CheckCircle2, publication: ArrowUpRight, approval: HeartPulse, file: CheckCircle2, dossie: BookOpen, plano: Sparkles, venda: BadgeDollarSign } as const;
          const corDoEvento = { report: "text-success", publication: "text-muted-foreground", approval: "text-warning", file: "text-muted-foreground", dossie: "text-primary", plano: "text-primary", venda: "text-success" } as const;
          return (
            <RegiaoRolavel modo="lg" rotulo="Histórico" memoria="central:historico" className="lg:pb-16 lg:pr-1">
              <div className="space-y-8">
                <Secao
                  titulo="Linha do tempo"
                  descricao={`${timeline.length} ${timeline.length === 1 ? "movimento" : "movimentos"}`}
                  ajuda="Dossiê, plano da semana, vendas, mensagens, publicações, aprovações e materiais, do mais novo para o mais antigo."
                  acao={
                    <SeletorCompacto
                      modo="lista"
                      rotulo="Cliente do histórico"
                      icone={<UserCircle className="h-3.5 w-3.5" />}
                      opcoes={[{ valor: "__all__", rotulo: "Toda a carteira" }, ...portfolioClients.map((c: any) => ({ valor: String(c.id), rotulo: nomeDoCliente(c) }))]}
                      valor={historicoClientId}
                      onEscolher={setHistoricoClientId}
                      className="max-w-[200px] sm:max-w-[260px]"
                    />
                  }
                >
                  {timeline.length === 0 ? (
                    carregandoRelatorios ? <Carregando rotulo="Carregando a linha do tempo" linhas={4} /> : <EstadoVazio compacto titulo="Nenhum movimento registrado ainda." />
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {timeline.map((event, index) => {
                        const EventIcon = iconMap[event.icon];
                        return (
                          <li key={`${event.at}-${index}`} className="flex min-w-0 items-center px-1 py-2">
                            <EventIcon className={`mr-3 h-3.5 w-3.5 shrink-0 ${corDoEvento[event.icon]}`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] text-foreground">{event.text}</p>
                              <p className={juntar(texto.auxiliar, "truncate")}>
                                {nameOf(event.clientId)} · {new Date(event.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Secao>

                <Secao
                  divisoria
                  titulo="Atualizações enviadas aos clientes"
                  descricao={`${publishedReports.length} ${publishedReports.length === 1 ? "publicada" : "publicadas"}`}
                >
                  {publishedReports.length === 0 ? (
                    carregandoRelatorios ? <Carregando rotulo="Carregando as atualizações" linhas={3} /> : <EstadoVazio compacto titulo="Nada publicado ainda." />
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {publishedReports.map((r: any) => {
                        const meta = ritualMeta(r.metrics?.ritual_type);
                        return (
                          <li key={r.id}>
                            <button type="button" onClick={() => navigate(`/relatorios/${r.id}`)} className={linhaDeLista}>
                              <span className="mr-3 min-w-0 flex-1">
                                <span className="flex min-w-0 items-center">
                                  <span className="min-w-0 truncate text-[12.5px] text-foreground">{r.title}</span>
                                  {meta && <span className={juntar(etiqueta, "ml-2 hidden bg-success/10 text-success sm:inline-flex")}>{meta.label}</span>}
                                </span>
                                <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                                  {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                                </span>
                              </span>
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Secao>
              </div>
            </RegiaoRolavel>
          );
        })()}
      </AreaDeTrabalho>

      {/* Modal gerador: selecionar, PRÉ-VISUALIZAR e só então criar */}
      <Dialog open={generatorOpen} onOpenChange={(v) => { setGeneratorOpen(v); if (!v) { setGenPreviews(null); setGenIdeaId(null); } }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className={texto.tituloSecao}>
              {genPreviews ? `Pré-visualização (${genPreviews.length})` : "Gerar mensagens com dados reais"}
            </DialogTitle>
          </DialogHeader>

          {!genPreviews ? (
            <div className="space-y-4">
              <CampoDeFormulario rotulo="Para quem">
                <select
                  value={genClientId}
                  onChange={(e) => setGenClientId(e.target.value)}
                  className={campo}
                >
                  <option value="__all__">Todos os clientes da carteira ({portfolioClients.length})</option>
                  {portfolioClients.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                  ))}
                  {/* Avulso em projeto aberto também merece acompanhamento:
                      é o mesmo cuidado, só que com começo e fim. */}
                  {oneOffClients.length > 0 && (
                    <optgroup label="Projetos avulsos">
                      {oneOffClients.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </CampoDeFormulario>
              <div>
                <p className={juntar(texto.rotulo, "mb-1.5")}>Ritual</p>
                <div role="radiogroup" aria-label="Ritual" className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {RITUALS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={genRitual === r.value}
                      onClick={() => setGenRitual(r.value)}
                      className={juntar(
                        "flex w-full min-w-0 items-center justify-between px-3 py-2.5 text-left transition-colors",
                        foco,
                        genRitual === r.value ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center text-[13px]">
                        <span className={`mr-2.5 h-3.5 w-3.5 shrink-0 rounded-full border ${genRitual === r.value ? "border-[4px] border-primary" : "border-border"}`} aria-hidden="true" />
                        <span className="min-w-0 truncate">{r.label}</span>
                      </span>
                      <span className="ml-3 shrink-0 text-[11.5px]">{r.cadence}</span>
                    </button>
                  ))}
                </div>
              </div>
              <SeletorDeModelo escolha={escolhaDoModelo} onMudar={setEscolhaDoModelo} />
              <button
                type="button"
                onClick={previewDrafts}
                disabled={!contextoPronto || progressoDaGeracao !== null}
                className={juntar(botao.primario, "w-full disabled:cursor-wait")}
              >
                {progressoDaGeracao ? `Escrevendo ${progressoDaGeracao.feitos} de ${progressoDaGeracao.total}...` : contextoPronto ? "Ver antes de criar" : "Carregando os dados dos clientes..."}
              </button>
              <p className={texto.auxiliar}>Nada é criado nesta etapa: você lê cada mensagem antes de confirmar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className={texto.auxiliar}>
                Leia, ajuste e confirme. Já está bom? Copie daqui e mande no grupo; ao confirmar, ela vai para a fila aberta.
              </p>
              <ul className="divide-y divide-border border-y border-border">
                {genPreviews.map((preview, index) => (
                  <li key={preview.clientId} className="space-y-2.5 py-3">
                    <div className="flex min-w-0 flex-wrap items-center justify-between">
                      <p className="mr-2 min-w-0 text-[13px] font-medium text-foreground">{preview.clientName}{preview.draft.metrics?.substitui_recente ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">substitui o rascunho recente</span> : null}</p>
                      <button
                        type="button"
                        onClick={() => copyText(preview.draft.summary || "", `Mensagem de ${preview.clientName} copiada. É só colar no grupo.`)}
                        className={juntar(botao.discreto, "text-primary")}
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar para o grupo
                      </button>
                    </div>
                    <p className="text-[12px] font-medium text-primary">{preview.draft.title}{preview.draft.metrics?.written_by === "ai" ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">IA · {rotuloDoModelo(preview.draft.metrics?.model) || "modelo"}</span> : <span className="ml-1.5 text-[11px] font-normal text-warning">texto de reserva (IA não respondeu)</span>}</p>
                    {Array.isArray(preview.draft.metrics?.alertas) && preview.draft.metrics.alertas.length > 0 && (
                      <div className="rounded-md bg-warning/10 px-3 py-2">
                        <p className="text-[12px] font-medium text-warning">Avisos para a equipe (não vão ao cliente)</p>
                        <ul className="mt-0.5 space-y-0.5">{preview.draft.metrics.alertas.map((a: string, i: number) => <li key={i} className="text-[12px] leading-snug text-foreground/85">• {a}</li>)}</ul>
                      </div>
                    )}
                    <PromessasDoRascunho metricas={preview.draft.metrics} />
                    <CampoDeFormulario rotulo="Mensagem">
                      <textarea
                        value={preview.draft.summary}
                        onChange={(e) =>
                          setGenPreviews((prev) =>
                            prev
                              ? prev.map((p, i) => (i === index ? { ...p, draft: { ...p.draft, summary: e.target.value } } : p))
                              : prev
                          )
                        }
                        rows={4}
                        className={juntar(campoTexto, "resize-y")}
                      />
                    </CampoDeFormulario>
                    <CampoDeFormulario
                      rotulo="Próxima etapa"
                      apoio={preview.draft.metrics?.central_review_next_steps_required ? "A IA não propôs uma próxima etapa separada. Revise este campo na fila antes de aprovar." : undefined}
                    >
                      <textarea
                        value={preview.draft.next_steps}
                        onChange={(e) =>
                          setGenPreviews((prev) =>
                            prev
                              ? prev.map((p, i) => (i === index ? { ...p, draft: { ...p.draft, next_steps: e.target.value } } : p))
                              : prev
                          )
                        }
                        rows={2}
                        className={juntar(campoTexto, "min-h-[60px] resize-y")}
                      />
                    </CampoDeFormulario>
                  </li>
                ))}
              </ul>
              <div className="flex">
                <button type="button" onClick={() => setGenPreviews(null)} className={juntar(botao.secundario, "flex-1")}>
                  Voltar
                </button>
                <button type="button" onClick={confirmDrafts} disabled={generating} className={juntar(botao.primario, "ml-2 flex-1")}>
                  {generating ? "Criando…" : `Criar ${genPreviews.length} rascunho(s)`}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
