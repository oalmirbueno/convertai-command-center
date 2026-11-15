import { ArrowUpRight, Avatar, AvatarStack, ChartLegend, Donut, EmptyState, IconButton, List, ListRow, OverflowMenu, PageHeader, PillTabs, ProgressBar, StatusPill } from "@/components/ds";
import BarrasPilula from "@/components/finance/BarrasPilula";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjects, useUpdates, useTasks, useClients } from "@/hooks/useSupabaseData";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { AlertTriangle, CalendarDays, Plus, UserPlus, Upload, FileText, MoreHorizontal, Trash2, Edit3, Link2, TrendingUp, CheckCircle2, DollarSign, Wallet, Briefcase, Users, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CreateProjectModal from "@/components/admin/CreateProjectModal";
import ProjectDrawer from "@/components/admin/ProjectDrawer";
import CreateClientModal from "@/components/admin/CreateClientModal";
import MeetingNotesModal from "@/components/admin/MeetingNotesModal";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";
import { Slider } from "@/components/ui/slider";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { BrandFilter, BRAND_FILTERS, matchesBrandFilter, getProjectBrand } from "@/lib/brandHelpers";
import { PipelineBar } from "@/components/admin/ProjectPipeline";
import SecondBrainPulseWidget from "@/components/dashboard/SecondBrainPulseWidget";
import { projectHasLinkedRequestTasks } from "@/lib/requestTaskWorkflow";
import { appPublicUrl } from "@/lib/publicUrl";
import { isInternalClient } from "@/lib/clientFlags";
import { moedaDe } from "@/lib/freela/freelaLib";
import { acoesRapidasDoPapel } from "@/lib/acoesRapidasDoPapel";

const statusDotColors: Record<string, string> = {
  active: "bg-info pulse-dot",
  review: "bg-warning",
  planning: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  done: "bg-success",
};

const updateTypeDotColors: Record<string, string> = {
  task: "bg-success",
  creative: "bg-primary",
  milestone: "bg-info",
  alert: "bg-warning",
  report: "bg-primary",
  system: "bg-muted-foreground",
};

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativo" },
  { value: "review", label: "Revisão" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

const parseAppDate = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  return new Date(value);
};

export default function AdminDashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const { data: activity, isLoading: loadingActivity } = useRecentActivity();
  const { data: allTasks } = useTasks();
  const { data: clients } = useClients();
  const { data: billing } = useBilling();
  const { data: wallets } = useAdsWallet();
  const { data: projectPayments } = useQuery({
    queryKey: ["all-project-payments"],
    queryFn: async () => {
      const { data: payments, error } = await supabase
        .from("project_payments")
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type), client:profiles!project_payments_client_id_fkey(full_name, company_name), installments:payment_installments(*)");
      if (error) throw error;
      return payments || [];
    },
    enabled: isAdmin,
  });
  const isTeam = ["design", "traffic", "manager"].includes(profile?.role || "");
  const [menuProject, setMenuProject] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<any>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);
  const [briefingLinkOpen, setBriefingLinkOpen] = useState(false);
  const [drawerProject, setDrawerProject] = useState<any>(null);
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [aba, setAba] = useState<"projetos" | "parcelas" | "atualizacoes" | "urgentes" | "vencimentos" | "parados">("projetos");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const activeProjects = projects?.filter((p: any) => p.status !== "done") || [];
  const filteredProjects = activeProjects.filter((p: any) => matchesBrandFilter(p.project_type, brandFilter));

  // Build team members map per project from tasks
  const teamByProject: Record<string, { name: string; id: string }[]> = {};
  (allTasks || []).forEach((t: any) => {
    if (t.assigned_to && t.assignee?.full_name && t.project_id) {
      if (!teamByProject[t.project_id]) teamByProject[t.project_id] = [];
      if (!teamByProject[t.project_id].some((m: any) => m.id === t.assigned_to)) {
        teamByProject[t.project_id].push({ name: t.assignee.full_name, id: t.assigned_to });
      }
    }
  });
  const urgentTasks = (allTasks || []).filter((t: any) => (t.priority === "urgent" || t.priority === "high") && t.status !== "done").slice(0, 5);

  // Clients with upcoming renewal (next 7 days) or expired
  const clientsRenewalAlert = (clients || []).filter((c: any) => {
    if (!c.plan_renewal_date || isInternalClient(c)) return false;
    const renewal = new Date(c.plan_renewal_date + "T00:00:00");
    const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
    return diffDays <= 7;
  }).sort((a: any, b: any) => new Date(a.plan_renewal_date).getTime() - new Date(b.plan_renewal_date).getTime());

  // Projects with no progress update in last 14 days
  const stalledProjects = activeProjects.filter((p: any) => {
    const lastUpdate = new Date(p.updated_at || p.created_at);
    const daysSince = Math.floor((now.getTime() - lastUpdate.getTime()) / 86400000);
    return daysSince >= 14 && p.progress < 100;
  });

  // Ignore renewal charges for clients in Standby/Inactive so pending totals stay in sync with client status
  const pausedClientIds = new Set(
    (clients || [])
      .filter((c: any) => c.plan_status === "standby" || c.plan_status === "inactive" || isInternalClient(c))
      .map((c: any) => c.id)
  );
  // Totais do painel são em real. Dólar do freela não entra na soma.
  const billingEmReal = (billing || []).filter((b: any) => moedaDe(b) === "BRL");
  const pendingBills = billingEmReal.filter(
    (b: any) =>
      b.status === "pending" &&
      b.type !== "ads_recharge" &&
      !(b.type === "renewal" && pausedClientIds.has(b.client_id))
  );
  // Inclui parciais: a fatura original recebida em partes ainda conta no recebido pelo valor já pago.
  const paidBills = billingEmReal.filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge");
  const receivedOf = (b: any) => {
    const total = Number(b?.amount) || 0;
    const paid = Number(b?.paid_amount) || 0;
    if (b?.status === "partial") return Math.min(paid, total);
    if (b?.status === "paid") return paid > 0 && paid < total ? paid : total;
    return 0;
  };
  const pendingTotal = pendingBills.reduce((s: number, b: any) => s + Number(b.amount), 0);
  const receivedTotal = paidBills.reduce((s: number, b: any) => s + receivedOf(b), 0);
  const overdueTotal = pendingBills.filter((b: any) => {
    const due = parseAppDate(b.due_date);
    return due ? due < todayStart : false;
  }).reduce((s: number, b: any) => s + Number(b.amount), 0);
  const monthlyRevenue = paidBills
    .filter((b: any) => {
      const paid = parseAppDate(b.paid_date || b.due_date);
      return !!paid && paid.getMonth() === thisMonth && paid.getFullYear() === thisYear;
    })
    .reduce((s: number, b: any) => s + receivedOf(b), 0);
  const totalAds = (wallets || []).reduce((s: number, w: any) => s + Number(w.balance), 0);

  // Individual project payments
  const individualPaidThisMonth = (projectPayments || []).reduce((sum: number, pp: any) => {
    const paidThisMonth = (pp.installments || []).filter((i: any) => {
      if (!['paid', 'partial'].includes(i.status) || !i.paid_date) return false;
      const d = parseAppDate(i.paid_date);
      return !!d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    return sum + paidThisMonth.reduce((s: number, i: any) => s + receivedOf(i), 0);
  }, 0);

  const pendingBillsThisMonth = pendingBills
    .filter((b: any) => { const d = parseAppDate(b.due_date); return !!d && d.getMonth() === thisMonth && d.getFullYear() === thisYear; })
    .reduce((s: number, b: any) => s + Number(b.amount), 0);
  const individualPendingThisMonth = (projectPayments || []).reduce((sum: number, pp: any) => {
    const pending = (pp.installments || []).filter((i: any) => {
      if (i.status !== "pending") return false;
      const d = parseAppDate(i.due_date);
      return !!d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    return sum + pending.reduce((s: number, i: any) => s + Number(i.amount), 0);
  }, 0);

  const in7days = new Date(now);
  in7days.setDate(in7days.getDate() + 7);
  const dueSoon7Billing = pendingBills
    .filter((b: any) => { const d = new Date(b.due_date); return d >= now && d <= in7days; })
    .reduce((s: number, b: any) => s + Number(b.amount), 0);
  const dueSoon7Individual = (projectPayments || []).reduce((sum: number, pp: any) => {
    const soon = (pp.installments || []).filter((i: any) => {
      if (i.status !== "pending") return false;
      const d = new Date(i.due_date);
      return d >= now && d <= in7days;
    });
    return sum + soon.reduce((s: number, i: any) => s + Number(i.amount), 0);
  }, 0);

  const individualPaid = (projectPayments || []).reduce((sum: number, pp: any) => {
    const paidInstallments = (pp.installments || []).filter((i: any) => i.status === "paid" || i.status === "partial");
    return sum + paidInstallments.reduce((s: number, i: any) => s + receivedOf(i), 0);
  }, 0);
  const individualTotal = (projectPayments || []).reduce((sum: number, pp: any) => sum + Number(pp.total_value), 0);
  const individualPending = individualTotal - individualPaid;
  const individualOverdue = (projectPayments || []).reduce((sum: number, pp: any) => {
    const overdue = (pp.installments || []).filter((i: any) => i.status === "pending" && new Date(i.due_date) < now);
    return sum + overdue.reduce((s: number, i: any) => s + Number(i.amount), 0);
  }, 0);

  const totalReceivedThisMonth = monthlyRevenue + individualPaidThisMonth;
  const totalPendingThisMonth = pendingBillsThisMonth + individualPendingThisMonth;
  const totalDueSoon7 = dueSoon7Billing + dueSoon7Individual;

  const stats = [
    { label: "Projetos", value: String(activeProjects.length), color: "bg-primary" },
    { label: "Clientes", value: String((clients || []).filter((c: any) => c.plan_status === "active" && (c.client_type || "recurring") !== "one_off" && !isInternalClient(c)).length), color: "bg-success" },
    { label: "Tarefas", value: String((allTasks || []).filter((t: any) => t.status !== "done").length), color: "bg-warning" },
    { label: "Em revisão", value: String(projects?.filter((p: any) => p.status === "review").length || 0), color: "bg-info" },
  ];

  // Linha de apoio curta: de onde vem o valor (recorrente, projetos ou os dois). O valor cheio fica na dica.
  const curto = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  const handleStatusChange = async (projectId: string, newStatus: string) => {
    await supabase.from("projects").update({ status: newStatus }).eq("id", projectId);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Status atualizado");
    setMenuProject(null);
  };

  const handleProgressChange = async (projectId: string, progress: number) => {
    await supabase.from("projects").update({ progress }).eq("id", projectId);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const [confirmDeleteProject, setConfirmDeleteProject] = useState<string | null>(null);

  const handleDeleteProject = async () => {
    if (!confirmDeleteProject) return;
    const projectId = confirmDeleteProject;
    try {
      if (await projectHasLinkedRequestTasks(projectId)) {
        toast.error(
          "Este projeto possui um Pedido vinculado ao Kanban e não pode ser excluído.",
        );
        setConfirmDeleteProject(null);
        return;
      }
      await supabase.from("tasks").delete().eq("project_id", projectId);
      await supabase.from("milestones").delete().eq("project_id", projectId);
      await supabase.from("updates").delete().eq("project_id", projectId);
      await supabase.from("projects").delete().eq("id", projectId);
      // Avisa o Ops em background — UI já foi liberada.
      const { notifyOpsDelete } = await import("@/lib/opsSync");
      notifyOpsDelete("project", projectId);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto excluído");
      setConfirmDeleteProject(null);
      setMenuProject(null);
    } catch (error) {
      console.error("Project delete guard failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o projeto.",
      );
      setConfirmDeleteProject(null);
    }
  };

  const generateQuizLink = async () => {
    const { data, error } = await supabase.rpc("issue_quiz_invitation_v2");
    const issued = Array.isArray(data) ? data[0] : data;
    const token = issued && typeof issued === "object" && "token" in issued
      ? issued.token
      : null;
    if (error || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      toast.error("Não foi possível gerar o link do quiz");
      return;
    }
    const url = appPublicUrl(`/quiz/${token}`);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do quiz copiado!", {
        description: "Envie ao lead pra ele responder o diagnóstico.",
      });
    } catch {
      toast.error("Não foi possível copiar", { description: url });
    }
  };

  // A equipe (design, tráfego, gestor) também abre este painel, mas criar
  // projeto, criar cliente e a ata de reunião são só do admin no servidor
  // (RLS de projects, manage-team e process-meeting-notes): o botão levava
  // a um 403. Aparece só o que o papel consegue fazer.
  const quickActions = acoesRapidasDoPapel(isAdmin, [
    { label: "Novo Projeto", icon: Plus, action: () => setCreateProjectOpen(true), soAdmin: true },
    { label: "Novo Cliente", icon: UserPlus, action: () => setCreateClientOpen(true), soAdmin: true },
    { label: "Nova Ata de Reunião", icon: FileText, action: () => setMeetingNotesOpen(true), soAdmin: true },
    { label: "Gerar Link Briefing", icon: Link2, action: () => setBriefingLinkOpen(true) },
    { label: "Gerar link de quiz", icon: ClipboardList, action: generateQuizLink },
    { label: "Upload", icon: Upload, action: () => navigate("/arquivos") },
  ]);

  const iconesDosNumeros = [Briefcase, Users, ClipboardList, CheckCircle2];
  // Saudação do topo: a hora do aparelho e o primeiro nome de quem entrou.
  const hora = now.getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const primeiroNome = String(profile?.full_name || "").trim().split(/\s+/)[0] || "";
  const hojePorExtenso = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  // Minigráficos: só razões e contagens que a tela já tem (nada inventado).
  const statusDosAtivos = STATUS_OPTIONS.filter((s) => s.value !== "done");
  const projetosPorStatus = statusDosAtivos.map((s) => activeProjects.filter((p: any) => p.status === s.value).length);
  const recorrentes = (clients || []).filter((c: any) => (c.client_type || "recurring") !== "one_off" && !isInternalClient(c));
  const recorrentesAtivos = recorrentes.filter((c: any) => c.plan_status === "active").length;
  const totalDeTarefas = (allTasks || []).length;
  const tarefasFeitas = (allTasks || []).filter((t: any) => t.status === "done").length;
  const emRevisao = projects?.filter((p: any) => p.status === "review").length || 0;
  const dicasDosNumeros = [
    activeProjects.length > 0 ? `projetos · ${projetosPorStatus[statusDosAtivos.findIndex((s) => s.value === "active")] || 0} em andamento` : undefined,
    recorrentes.length > 0 ? `clientes ativos de ${recorrentes.length} recorrentes` : undefined,
    totalDeTarefas > 0 ? `tarefas pendentes · ${tarefasFeitas} de ${totalDeTarefas} feitas` : undefined,
    activeProjects.length > 0 ? `em revisão de ${activeProjects.length} projetos` : undefined,
  ];
  const previstoNoMes = totalReceivedThisMonth + totalPendingThisMonth;
  const individualEmDia = Math.max(individualPending - individualOverdue, 0);

  // Recebido por mês (últimos 6): as mesmas faturas e parcelas pagas que a tela já lê, agrupadas pela data do pagamento.
  const mesesDoGrafico = Array.from({ length: 6 }, (_, i) => new Date(thisYear, thisMonth - 5 + i, 1));
  const chaveDoMes = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const recebidoPorMes = new Map<number, number>();
  paidBills.forEach((b: any) => {
    const d = parseAppDate(b.paid_date || b.due_date);
    if (d) recebidoPorMes.set(chaveDoMes(d), (recebidoPorMes.get(chaveDoMes(d)) || 0) + receivedOf(b));
  });
  (projectPayments || []).forEach((pp: any) => (pp.installments || []).forEach((i: any) => {
    if (!["paid", "partial"].includes(i.status) || !i.paid_date) return;
    const d = parseAppDate(i.paid_date);
    if (d) recebidoPorMes.set(chaveDoMes(d), (recebidoPorMes.get(chaveDoMes(d)) || 0) + receivedOf(i));
  }));
  const barrasDoRecebido = mesesDoGrafico.map((d, i) => ({
    rotulo: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    valor: recebidoPorMes.get(chaveDoMes(d)) || 0,
    previsto: i === 5 ? totalPendingThisMonth : 0,
  }));
  const barrasDosProjetos = statusDosAtivos.map((s, i) => ({ rotulo: s.label, valor: projetosPorStatus[i] }));
  const pctRecebido = previstoNoMes > 0 ? Math.round((totalReceivedThisMonth / previstoNoMes) * 100) : 0;
  const atrasadoTotal = overdueTotal + individualOverdue;
  const temParcelas = isAdmin && (projectPayments || []).length > 0;

  type Aba = "projetos" | "parcelas" | "atualizacoes" | "urgentes" | "vencimentos" | "parados";
  const abas: Array<{ value: Aba; label: string; count?: number }> = [
    { value: "projetos", label: "Projetos", count: filteredProjects.length },
    ...(temParcelas ? [{ value: "parcelas" as Aba, label: "Parcelas" }] : []),
    { value: "atualizacoes", label: "Atualizações" },
    { value: "urgentes", label: "Urgentes", count: urgentTasks.length },
    ...(isAdmin ? [{ value: "vencimentos" as Aba, label: "Vencimentos", count: clientsRenewalAlert.length }, { value: "parados" as Aba, label: "Parados", count: stalledProjects.length }] : []),
  ];
  const abaAberta: Aba = abas.some((a) => a.value === aba) ? aba : "projetos";

  const [principal, ...outras] = quickActions;
  const cartao = "min-w-0 rounded-lg border border-border bg-card shadow-card";
  const abrir = (para: string, rotulo: string) => <IconButton to={para} label={rotulo} icon={<ArrowUpRight />} size="md" />;
  const rolagemPropria = "lg:max-h-[420px] lg:overflow-y-auto lg:overscroll-contain lg:pr-1";

  return (
    <div className="min-w-0 animate-fade-in">
      <PageHeader
        title={primeiroNome ? `${saudacao},` : "Dashboard"}
        greeting={primeiroNome || undefined}
        actions={
          <div className="flex min-w-0 items-center" data-tour="dash-quick-actions">
            <span className="mr-2 hidden h-11 items-center whitespace-nowrap rounded-full bg-card px-4 text-[13px] font-medium text-foreground shadow-card md:inline-flex">
              <CalendarDays aria-hidden="true" className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="first-letter:uppercase">{hojePorExtenso}</span>
            </span>
            {principal && (
              <button onClick={principal.action} className="toque-compacto inline-flex h-11 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full bg-accent-solid px-3.5 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-solid/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
                <principal.icon aria-hidden="true" className="h-4 w-4 sm:mr-2" />
                <span className="sr-only sm:not-sr-only">{principal.label}</span>
              </button>
            )}
            <OverflowMenu label="Mais ações" className="ml-1.5" items={outras.map((a) => ({ label: a.label, icon: <a.icon className="h-4 w-4" />, onSelect: a.action }))} />
          </div>
        }
      />

      {/* Bento de três colunas (referência Quixotic): destaque verde, gráfico no meio, operação à direita. */}
      <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 sm:mt-7 lg:grid-cols-12 lg:gap-5">
        {/* Esquerda */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3 lg:gap-5">
          <section className={`${cartao} flex flex-1 flex-col p-3`}>
            <div className="flex items-start justify-between px-3 pb-3 pt-2">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground">{isAdmin ? "Recebido no mês" : "Projetos"}</h2>
                <p className="truncate text-[12px] leading-4 text-muted-foreground">{isAdmin ? `de ${curto(previstoNoMes)} previstos` : "em andamento"}</p>
              </div>
              {abrir(isAdmin ? "/financeiro" : "/projetos", isAdmin ? "Abrir o Financeiro" : "Abrir Projetos")}
            </div>
            <div className="flex min-h-[168px] flex-1 flex-col justify-between rounded-[20px] bg-accent-solid p-5 text-on-accent">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium leading-4 text-on-accent-muted">{isAdmin ? "Entrou" : "Ativos"}</span>
                {isAdmin ? <TrendingUp aria-hidden="true" className="h-4 w-4" /> : <Briefcase aria-hidden="true" className="h-4 w-4" />}
              </div>
              <p className="mt-3 truncate text-[30px] font-medium leading-9 tracking-[-0.03em] tabular-nums xl:text-[34px] xl:leading-10">{isAdmin ? fmt(totalReceivedThisMonth) : activeProjects.length}</p>
              <div className="mt-4">
                {isAdmin && (
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-black/15">
                    <span className="block h-full rounded-full bg-on-accent" style={{ width: `${Math.min(100, pctRecebido)}%` }} />
                  </span>
                )}
                <div className="mt-2 flex items-center justify-between text-[12px] leading-4 text-on-accent-muted">
                  <span className="truncate">{isAdmin ? (monthlyRevenue > 0 && individualPaidThisMonth > 0 ? "recorrente + projetos" : individualPaidThisMonth > 0 ? "projetos" : "recorrente") : `${emRevisao} em revisão`}</span>
                  {isAdmin && <span className="ml-2 shrink-0 font-semibold tabular-nums text-on-accent">{pctRecebido}%</span>}
                </div>
              </div>
            </div>
          </section>
          {isAdmin && (
            <button type="button" onClick={() => navigate("/financeiro")} className={`${cartao} flex cursor-pointer items-center justify-between p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
              <span className="min-w-0">
                <span className="block text-[12px] leading-4 text-muted-foreground">A vencer em 7 dias</span>
                <span className="mt-1 block truncate text-[22px] font-medium leading-7 tracking-[-0.02em] tabular-nums text-foreground">{curto(totalDueSoon7)}</span>
              </span>
              <span className="ml-3 shrink-0 rounded-full bg-accent-solid px-2.5 py-1 text-[11px] font-semibold leading-4 tabular-nums text-on-accent">{curto(totalPendingThisMonth)} no mês</span>
            </button>
          )}
        </div>

        {/* Centro: gráfico */}
        <section className={`${cartao} p-5 sm:p-6 lg:col-span-6`}>
          <div className="mb-5 flex min-w-0 items-center justify-between">
            <div className="flex min-w-0 items-center">
              <span aria-hidden="true" className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">{isAdmin ? <DollarSign className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}</span>
              <h2 className="truncate text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground">{isAdmin ? "Recebido por mês" : "Projetos por etapa"}</h2>
            </div>
            {abrir(isAdmin ? "/financeiro" : "/projetos", isAdmin ? "Ver no Financeiro" : "Ver Projetos")}
          </div>
          {isAdmin ? (
            <BarrasPilula itens={barrasDoRecebido} destaque={5} formatar={curto} altura={264} rotuloAcessivel="Recebido por mês, últimos 6 meses" />
          ) : (
            <BarrasPilula itens={barrasDosProjetos} destaque={statusDosAtivos.findIndex((s) => s.value === "active")} formatar={(v) => String(v)} altura={264} rotuloAcessivel="Projetos por etapa" />
          )}
        </section>

        {/* Direita: operação e atraso */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3 lg:gap-5">
          <section className={`${cartao} p-3`} data-tour="dash-stats" aria-label="Resumo da operação">
            <div className="grid grid-cols-2 gap-2">
              {stats.map((s, i) => {
                const Icone = iconesDosNumeros[i] || Briefcase;
                const para = ["/projetos", "/clientes", "/kanban", "/projetos"][i];
                return (
                  <button key={s.label} type="button" onClick={() => navigate(para)} title={dicasDosNumeros[i] ? `${s.value} ${dicasDosNumeros[i]}` : undefined} className={`flex min-w-0 cursor-pointer flex-col rounded-[18px] p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === 0 ? "bg-foreground text-background hover:bg-foreground/90" : "bg-muted/70 text-foreground hover:bg-muted"}`}>
                    <span className="flex items-center justify-between">
                      <span className={`truncate text-[12px] font-medium leading-4 ${i === 0 ? "text-background/70" : "text-muted-foreground"}`}>{s.label}</span>
                      <Icone aria-hidden="true" className={`ml-1 h-3.5 w-3.5 shrink-0 ${i === 0 ? "text-background/70" : "text-muted-foreground"}`} />
                    </span>
                    <span className="mt-3 text-[28px] font-medium leading-8 tracking-[-0.03em] tabular-nums">{s.value}</span>
                  </button>
                );
              })}
            </div>
          </section>
          {isAdmin && (
            <section className={`${cartao} flex flex-1 flex-col p-5`}>
              <div className="flex items-center">
                <span aria-hidden="true" className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><AlertTriangle className="h-4 w-4" /></span>
                <h2 className="truncate text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground">Atrasado</h2>
              </div>
              <p className={`mt-4 truncate text-[30px] font-medium leading-9 tracking-[-0.03em] tabular-nums ${atrasadoTotal > 0 ? "text-destructive" : "text-foreground"}`}>{fmt(atrasadoTotal)}</p>
              <button type="button" onClick={() => setAba("vencimentos")} className="mt-4 flex min-h-[64px] w-full cursor-pointer items-center justify-between rounded-[18px] bg-muted/70 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium leading-5 text-foreground">Vencimento próximo</span>
                  <span className="block truncate text-[12px] leading-4 text-muted-foreground">{clientsRenewalAlert.length === 0 ? "nenhum cliente" : `${clientsRenewalAlert.length} ${clientsRenewalAlert.length === 1 ? "cliente" : "clientes"}`}</span>
                </span>
                <AvatarStack className="ml-3" people={clientsRenewalAlert.map((c: any) => c.company_name || c.full_name)} max={3} />
              </button>
            </section>
          )}
        </div>

        {/* Linha de baixo: uma lista só, com abas */}
        <section className={`${cartao} p-5 sm:p-6 lg:col-span-9`}>
          <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-y-3">
            <PillTabs label="O que ver" value={abaAberta} onChange={(v) => setAba(v as Aba)} tabs={abas} />
            {abaAberta === "projetos" && (
              <PillTabs label="Filtrar por marca" variant="soft" size="sm" value={brandFilter} onChange={(v) => setBrandFilter(v as BrandFilter)} tabs={BRAND_FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
            )}
          </div>

          {abaAberta === "projetos" && (
            loadingProjects ? (
              <div aria-busy="true" className="space-y-2">{[0, 1, 2, 3].map((n) => <div key={n} className="h-[60px] rounded-lg bg-muted/60" />)}</div>
            ) : filteredProjects.length === 0 ? (
              <EmptyState icon={<Briefcase className="h-5 w-5" />} title="Nenhum projeto encontrado." />
            ) : (
              <div className={`min-w-0 ${rolagemPropria}`}>
                <div aria-hidden="true" className="hidden items-center px-3 pb-2 text-[12px] leading-4 text-muted-foreground md:flex">
                  <span className="min-w-0 flex-1">Projeto</span>
                  <span className="w-40 shrink-0">Andamento</span>
                  <span className="w-28 shrink-0">Prazo</span>
                  <span className="w-24 shrink-0">Marca</span>
                  {isAdmin && <span className="w-9 shrink-0" />}
                </div>
                {filteredProjects.map((p: any) => {
                  const showMenu = menuProject === p.id;
                  const projectTeam = teamByProject[p.id] || [];
                  const cliente = p.client?.company_name || p.client?.full_name;
                  return (
                    <div
                      key={p.id}
                      className="flex min-w-0 cursor-pointer items-center rounded-[14px] px-3 py-2.5 transition-colors hover:bg-muted/60"
                      onClick={() => setDrawerProject(p)}
                      title={[p.description, p.project_type?.replace("_", " "), projectTeam.length > 0 ? projectTeam.map((m) => m.name.split(" ")[0]).join(", ") : ""].filter(Boolean).join(" · ") || undefined}
                    >
                      <span className="relative mr-3 shrink-0">
                        <Avatar name={cliente || p.name} />
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                      </span>
                      <div className="mr-3 min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium leading-5 text-foreground">{p.name}</p>
                        <p className="truncate text-[12px] leading-4 text-muted-foreground">{cliente}<span className="md:hidden">{p.deadline ? ` · ${new Date(p.deadline).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : ""}</span></p>
                      </div>
                      <div className="hidden w-40 shrink-0 pr-6 md:block">
                        <div className="mb-1.5 flex items-center justify-between">
                          <PipelineBar pipeline={p.pipeline} />
                          <p className="ml-2 text-[12px] font-medium tabular-nums text-foreground">{p.progress}%</p>
                        </div>
                        <ProgressBar value={Number(p.progress) || 0} max={100} height={6} label={`${p.progress}% concluído`} />
                      </div>
                      <span className="hidden w-28 shrink-0 truncate text-[13px] tabular-nums text-foreground md:block">{p.deadline ? formatDate(p.deadline) : "-"}</span>
                      <span className="hidden w-24 shrink-0 md:block"><StatusPill plain tone="success">{getProjectBrand(p.project_type)}</StatusPill></span>
                      <span className="mr-1 shrink-0 text-[12px] font-medium tabular-nums text-muted-foreground md:hidden">{Number(p.progress) || 0}%</span>
                      {/* Editar, status, progresso e excluir mudam o projeto: só o admin pode (RLS). */}
                      {isAdmin && (
                        <Popover open={showMenu} onOpenChange={(o) => setMenuProject(o ? p.id : null)}>
                          <PopoverTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Ações do projeto"
                              className="toque-compacto inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-56 p-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setEditProject(p); setMenuProject(null); }}
                              className="flex w-full cursor-pointer items-center rounded-sm border-none bg-transparent px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                              <Edit3 className="mr-2.5 h-3.5 w-3.5" /> Editar
                            </button>
                            <div className="px-3 py-2">
                              <p className="mb-1.5 text-[11px] text-muted-foreground">Status</p>
                              <div className="-m-0.5 flex flex-wrap">
                                {STATUS_OPTIONS.map((s) => (
                                  <button key={s.value} onClick={() => handleStatusChange(p.id, s.value)}
                                    className={`m-0.5 cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors ${p.status === s.value ? "border-accent-solid bg-accent-solid text-on-accent" : "border-border bg-transparent text-muted-foreground hover:text-foreground"}`}>
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="px-3 py-2">
                              <p className="mb-1.5 text-[11px] text-muted-foreground">Progresso: {p.progress}%</p>
                              <Slider defaultValue={[p.progress]} max={100} step={5} onValueCommit={(val) => handleProgressChange(p.id, val[0])} className="w-full" />
                            </div>
                            <button onClick={() => setConfirmDeleteProject(p.id)}
                              className="flex w-full cursor-pointer items-center rounded-sm border-none bg-transparent px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10">
                              <Trash2 className="mr-2.5 h-3.5 w-3.5" /> Excluir
                            </button>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {abaAberta === "parcelas" && (
            <div className={`min-w-0 ${rolagemPropria}`}>
              <div className="mb-3 flex min-w-0 items-center rounded-[18px] bg-muted/60 p-4">
                <Donut
                  size={72}
                  thickness={10}
                  segments={[
                    { value: individualPaid, label: "Recebido", tone: 1 },
                    { value: individualEmDia, label: "Pendente", tone: "muted" },
                    { value: individualOverdue, label: "Atrasado", tone: 4 },
                  ]}
                >
                  <span className="text-[13px] font-semibold leading-5 tabular-nums">{individualTotal > 0 ? Math.round((individualPaid / individualTotal) * 100) : 0}%</span>
                </Donut>
                <div className="ml-4 min-w-0 flex-1">
                  <p className="text-[12px] leading-4 text-muted-foreground">Total contratado</p>
                  <p className="truncate text-[22px] font-medium leading-7 tracking-[-0.02em] tabular-nums text-foreground">{fmt(individualTotal)}</p>
                </div>
                <ChartLegend
                  className="ml-4 hidden w-56 shrink-0 sm:block"
                  items={[
                    { label: "Recebido", value: fmt(individualPaid), tone: 1 },
                    { label: "Pendente", value: fmt(individualPending), tone: "muted" },
                    { label: "Atrasado", value: fmt(individualOverdue), tone: 4 },
                  ]}
                />
              </div>
              <List label="Projetos individuais" divided={false}>
                {(projectPayments || []).map((pp: any) => {
                  const paid = (pp.installments || [])
                    .filter((i: any) => i.status === "paid" || i.status === "partial")
                    .reduce((s: number, i: any) => s + receivedOf(i), 0);
                  const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
                  const hasOverdue = (pp.installments || []).some((i: any) => i.status === "pending" && new Date(i.due_date) < now);
                  const cliente = pp.client?.company_name || pp.client?.full_name;
                  return (
                    <ListRow
                      key={pp.id}
                      avatar={cliente || pp.project?.name || "Projeto"}
                      title={pp.project?.name || "Projeto"}
                      subtitle={cliente}
                      status={
                        <span className="flex min-w-0 items-center">
                          <span className="mr-3 hidden w-24 md:block"><ProgressBar value={pct} max={100} tone={hasOverdue ? 4 : 1} label={`${pct}% recebido`} /></span>
                          <StatusPill plain tone={hasOverdue ? "danger" : pct >= 100 ? "success" : "neutral"}>{hasOverdue ? "Atrasado" : `${pct}%`}</StatusPill>
                        </span>
                      }
                      value={fmt(paid)}
                      valueHint={`de ${fmt(Number(pp.total_value))}`}
                    />
                  );
                })}
              </List>
            </div>
          )}

          {/* O feed lê as DUAS fontes: os updates de projeto e a memória dos
              clientes (ritual, entrega, avulso, decisão, relatório). */}
          {abaAberta === "atualizacoes" && (
            loadingActivity ? (
              <div aria-busy="true" className="space-y-2">{[0, 1, 2, 3].map((n) => <div key={n} className="h-[52px] rounded-lg bg-muted/60" />)}</div>
            ) : (activity || []).length === 0 ? (
              <EmptyState compact title="Nenhuma atualização." />
            ) : (
              <div className={`min-w-0 ${rolagemPropria}`}>
                {(activity || []).map((entrada) => (
                  <div
                    key={entrada.id}
                    className="flex min-w-0 cursor-pointer items-start rounded-[14px] px-3 py-2.5 transition-colors hover:bg-muted/60"
                    onClick={() => {
                      if (entrada.origin === "entrega") navigate("/relatorios");
                      else if (entrada.origin === "avulso" || entrada.origin === "ciclo") navigate("/ciclo");
                      else if (entrada.origin === "ritual") navigate("/central");
                      else if (entrada.projectId) navigate("/projetos");
                    }}
                  >
                    <div className={`mr-3 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${updateTypeDotColors[entrada.origin] || "bg-primary/60"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13px] leading-5 text-foreground">{entrada.message}</p>
                      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                        {entrada.originLabel} · {new Date(entrada.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {abaAberta === "urgentes" && (
            urgentTasks.length === 0 ? (
              <EmptyState compact title="Nenhuma tarefa urgente." />
            ) : (
              <div className={`min-w-0 ${rolagemPropria}`}>
                <List label="Tarefas urgentes" divided={false}>
                  {urgentTasks.map((t: any) => (
                    <ListRow
                      key={t.id}
                      leading={
                        <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground">
                          <AlertTriangle className="h-4 w-4" />
                        </span>
                      }
                      title={t.title}
                      subtitle={t.project?.name}
                      status={<StatusPill plain tone={t.priority === "urgent" ? "danger" : "warning"}>{t.priority === "urgent" ? "Urgente" : "Alta"}</StatusPill>}
                      value={t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : undefined}
                    />
                  ))}
                </List>
              </div>
            )
          )}

          {abaAberta === "vencimentos" && (
            clientsRenewalAlert.length === 0 ? (
              <EmptyState compact title="Nenhum vencimento nos próximos 7 dias." />
            ) : (
              <div className={`min-w-0 ${rolagemPropria}`}>
                <List label="Clientes com vencimento próximo" divided={false}>
                  {clientsRenewalAlert.map((c: any) => {
                    const renewal = new Date(c.plan_renewal_date + "T00:00:00");
                    const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
                    const isExpired = diffDays < 0;
                    return (
                      <ListRow
                        key={c.id}
                        avatar={c.company_name || c.full_name}
                        title={c.company_name || c.full_name}
                        subtitle={c.plan_name || undefined}
                        status={
                          <StatusPill plain tone={isExpired ? "danger" : "warning"}>
                            {isExpired ? `Vencido há ${Math.abs(diffDays)}d` : diffDays === 0 ? "Vence hoje" : `Vence em ${diffDays}d`}
                          </StatusPill>
                        }
                        value={c.plan_value ? fmt(Number(c.plan_value)) : undefined}
                        onClick={() => navigate("/clientes")}
                      />
                    );
                  })}
                </List>
              </div>
            )
          )}

          {abaAberta === "parados" && (
            stalledProjects.length === 0 ? (
              <EmptyState compact title="Nenhum projeto parado há 14 dias." />
            ) : (
              <div className={`min-w-0 ${rolagemPropria}`}>
                <List label="Projetos sem progresso recente" divided={false}>
                  {stalledProjects.map((p: any) => {
                    const daysSince = Math.floor((now.getTime() - new Date(p.updated_at || p.created_at).getTime()) / 86400000);
                    return (
                      <ListRow
                        key={p.id}
                        avatar={p.client?.company_name || p.client?.full_name || p.name}
                        title={p.name}
                        subtitle={p.client?.company_name || p.client?.full_name}
                        status={<StatusPill plain>Parado há {daysSince}d</StatusPill>}
                        value={`${p.progress}%`}
                        onClick={() => setDrawerProject(p)}
                      />
                    );
                  })}
                </List>
              </div>
            )
          )}
        </section>

        {/* Coluna direita de baixo: carteiras de anúncio e o Segundo Cérebro */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3 lg:gap-5">
          {(isAdmin || isTeam) && (wallets || []).length > 0 && (
            <section className={`${cartao} p-5`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex min-w-0 items-center">
                  <span aria-hidden="true" className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><Wallet className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground">Ads Wallet</h2>
                    <p className="truncate text-[12px] leading-4 tabular-nums text-muted-foreground">{fmt(totalAds)}</p>
                  </div>
                </div>
                {abrir("/financeiro", "Abrir o Financeiro")}
              </div>
              <div className="-mx-2 lg:max-h-[220px] lg:overflow-y-auto lg:overscroll-contain">
                {(wallets || []).map((w: any) => (
                  <button key={w.id} type="button" onClick={() => navigate("/financeiro")} className="flex w-full min-w-0 cursor-pointer items-center rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-muted/60">
                    <Avatar name={w.client?.company_name || w.client?.full_name} size="sm" />
                    <span className="ml-3 min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{w.client?.company_name || w.client?.full_name}</span>
                      <span className="block truncate text-[12px] leading-4 text-muted-foreground">{w.platform}</span>
                    </span>
                    <span className={`ml-2 shrink-0 text-[13px] font-medium tabular-nums ${Number(w.balance) < 100 ? "text-warning" : "text-foreground"}`}>{fmt(Number(w.balance))}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {isAdmin && <SecondBrainPulseWidget />}
        </div>
      </div>

      <CreateProjectModal open={createProjectOpen || !!editProject} onClose={() => { setCreateProjectOpen(false); setEditProject(null); }} editProject={editProject} />
      <CreateClientModal open={createClientOpen} onClose={() => setCreateClientOpen(false)} />
      <MeetingNotesModal open={meetingNotesOpen} onClose={() => setMeetingNotesOpen(false)} />
      <BriefingLinkModal open={briefingLinkOpen} onClose={() => setBriefingLinkOpen(false)} />

      <ProjectDrawer
        project={drawerProject}
        open={!!drawerProject}
        onClose={() => setDrawerProject(null)}
        onEdit={(p) => {
          setDrawerProject(null);
          if (isAdmin) setEditProject(p);
          else toast.info("Só o administrador edita projetos.");
        }}
      />

      <ConfirmModal
        open={!!confirmDeleteProject}
        title="Excluir projeto"
        description="Todas as tarefas, milestones e atualizações deste projeto serão removidos permanentemente."
        onConfirm={handleDeleteProject}
        onCancel={() => setConfirmDeleteProject(null)}
      />
    </div>
  );
}
