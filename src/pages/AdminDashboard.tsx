import type { ReactNode } from "react";
import { Avatar, Card, CardSurface, ChartLegend, Chip, Donut, EmptyState, List, ListRow, MiniBars, PageHeader, PillTabs, ProgressBar, StatCard, StatGrid, StatusPill } from "@/components/ds";
import { useProjects, useUpdates, useTasks, useClients } from "@/hooks/useSupabaseData";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { Clock, AlertTriangle, Plus, UserPlus, Upload, FileText, MoreHorizontal, Trash2, Edit3, Link2, TrendingUp, CreditCard, CheckCircle2, DollarSign, Wallet, Briefcase, Users, ClipboardList } from "lucide-react";
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

/** Título de um bloco do Dashboard: ícone num círculo, título de 18 px e, à direita, o controle do bloco. */
function TituloDoBloco({ icone, acao, children }: { icone?: ReactNode; acao?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 flex min-w-0 items-center justify-between sm:mb-5">
      <h2 className="flex min-w-0 items-center text-[18px] font-semibold leading-6 tracking-[-0.02em] text-foreground">
        {icone && <span aria-hidden="true" className="mr-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-card">{icone}</span>}
        <span className="truncate">{children}</span>
      </h2>
      {acao && <div className="ml-3 shrink-0">{acao}</div>}
    </div>
  );
}

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
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [menuProject, setMenuProject] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<any>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);
  const [briefingLinkOpen, setBriefingLinkOpen] = useState(false);
  const [drawerProject, setDrawerProject] = useState<any>(null);
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
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
    { label: "Projetos Ativos", value: String(activeProjects.length), color: "bg-primary" },
    { label: "Clientes Ativos", value: String((clients || []).filter((c: any) => c.plan_status === "active" && (c.client_type || "recurring") !== "one_off" && !isInternalClient(c)).length), color: "bg-success" },
    { label: "Tarefas Pendentes", value: String((allTasks || []).filter((t: any) => t.status !== "done").length), color: "bg-warning" },
    { label: "Em Revisão", value: String(projects?.filter((p: any) => p.status === "review").length || 0), color: "bg-info" },
  ];

  const financeStats = [
    { label: "Recebido no Mês", value: fmt(totalReceivedThisMonth), color: "bg-success", sub: `Recorrente ${fmt(monthlyRevenue)} · Projetos ${fmt(individualPaidThisMonth)}` },
    { label: "Pendente do Mês", value: fmt(totalPendingThisMonth), color: "bg-warning", sub: `Recorrente ${fmt(pendingBillsThisMonth)} · Projetos ${fmt(individualPendingThisMonth)}` },
    { label: "Vence em 7 dias", value: fmt(totalDueSoon7), color: totalDueSoon7 > 0 ? "bg-warning" : "bg-muted-foreground", sub: `Recorrente ${fmt(dueSoon7Billing)} · Projetos ${fmt(dueSoon7Individual)}` },
    { label: "Atrasado", value: fmt(overdueTotal + individualOverdue), color: "bg-destructive", sub: `Recorrente ${fmt(overdueTotal)} · Projetos ${fmt(individualOverdue)}` },
  ];

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
  const iconesDoFinanceiro = [
    <TrendingUp key="r" className="h-4 w-4" />,
    <Clock key="p" className="h-4 w-4" />,
    <CreditCard key="v" className="h-4 w-4" />,
    <AlertTriangle key="a" className="h-4 w-4" />,
  ];

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
  const graficosDosNumeros: Array<{ chart?: ReactNode; hint?: ReactNode }> = [
    {
      chart: activeProjects.length > 0 ? <MiniBars values={projetosPorStatus} labels={statusDosAtivos.map((s) => s.label)} highlightIndex={statusDosAtivos.findIndex((s) => s.value === "active")} height={48} /> : undefined,
      hint: activeProjects.length > 0 ? `${projetosPorStatus[statusDosAtivos.findIndex((s) => s.value === "active")] || 0} em andamento` : undefined,
    },
    {
      chart: recorrentes.length > 0 ? <ProgressBar value={recorrentesAtivos} max={recorrentes.length} striped /> : undefined,
      hint: recorrentes.length > 0 ? `de ${recorrentes.length} recorrentes` : undefined,
    },
    {
      chart: totalDeTarefas > 0 ? <ProgressBar value={tarefasFeitas} max={totalDeTarefas} striped tone={2} label={`${tarefasFeitas} feitas de ${totalDeTarefas}`} /> : undefined,
      hint: totalDeTarefas > 0 ? `${tarefasFeitas} feitas de ${totalDeTarefas}` : undefined,
    },
    {
      chart: activeProjects.length > 0 ? <ProgressBar value={emRevisao} max={activeProjects.length} striped tone={4} /> : undefined,
      hint: activeProjects.length > 0 ? `de ${activeProjects.length} ativos` : undefined,
    },
  ];
  const previstoNoMes = totalReceivedThisMonth + totalPendingThisMonth;
  const individualEmDia = Math.max(individualPending - individualOverdue, 0);

  return (
    <div className="min-w-0 space-y-8 animate-fade-in sm:space-y-10">
      <PageHeader title={primeiroNome ? `${saudacao},` : "Dashboard"} greeting={primeiroNome || undefined} subtitle={<span className="first-letter:uppercase">{hojePorExtenso}</span>} />

      {/* Stats */}
      <div data-tour="dash-stats">
        <StatGrid cols={4} label="Resumo da operação">
          {stats.map((s, i) => {
            const Icone = iconesDosNumeros[i] || Briefcase;
            return (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                size="xl"
                variant={i === 0 ? "accent" : i === 3 ? "ink" : "default"}
                icon={<Icone className="h-4 w-4" />}
                hint={graficosDosNumeros[i]?.hint}
                chart={graficosDosNumeros[i]?.chart}
              />
            );
          })}
        </StatGrid>
      </div>

      {/* Finance Stats - admin only */}
      {isAdmin && (
      <section className="min-w-0">
        <TituloDoBloco icone={<DollarSign className="h-4 w-4" />}>Financeiro</TituloDoBloco>
        <StatGrid cols={4} label="Financeiro do mês">
          {financeStats.map((s, i) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              hint={(s as any).sub}
              icon={iconesDoFinanceiro[i]}
              variant={i === 0 ? "ink" : "default"}
              className={i === 3 && overdueTotal + individualOverdue > 0 ? "[&_.ds-stat-valor]:text-destructive" : ""}
              chart={
                i === 0 && previstoNoMes > 0 ? (
                  <ProgressBar value={totalReceivedThisMonth} max={previstoNoMes} label={`Recebido ${fmt(totalReceivedThisMonth)} de ${fmt(previstoNoMes)} previstos no mês`} />
                ) : i === 1 && previstoNoMes > 0 ? (
                  <ProgressBar value={totalPendingThisMonth} max={previstoNoMes} striped tone={4} label={`Pendente ${fmt(totalPendingThisMonth)} de ${fmt(previstoNoMes)} previstos no mês`} />
                ) : undefined
              }
              onClick={() => navigate("/financeiro")}
            />
          ))}
        </StatGrid>
      </section>
      )}

      {/* Second Brain live pulse - admin only */}
      {isAdmin && <SecondBrainPulseWidget />}

      {/* Individual Project Payments - admin only */}
      {isAdmin && (projectPayments || []).length > 0 && (
        <section className="min-w-0">
          <TituloDoBloco icone={<Briefcase className="h-4 w-4" />}>Projetos individuais</TituloDoBloco>
          <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-3">
            <CardSurface padded variant="ink" className="flex min-w-0 flex-col">
              <p className="text-[13px] font-medium leading-5 text-muted-foreground">Total contratado</p>
              <p className="mt-3 truncate text-[32px] font-semibold leading-10 tracking-[-0.035em] tabular-nums text-foreground sm:text-[40px] sm:leading-[44px]">{fmt(individualTotal)}</p>
              <div className="mt-6 flex min-w-0 items-center">
                <Donut
                  size={112}
                  thickness={14}
                  segments={[
                    { value: individualPaid, label: "Recebido", tone: 1 },
                    { value: individualEmDia, label: "Pendente", tone: "muted" },
                    { value: individualOverdue, label: "Atrasado", tone: 4 },
                  ]}
                >
                  <span className="text-[18px] font-semibold leading-6 tabular-nums">{individualTotal > 0 ? Math.round((individualPaid / individualTotal) * 100) : 0}%</span>
                </Donut>
                <ChartLegend
                  className="ml-5 flex-1"
                  items={[
                    { label: "Recebido", value: fmt(individualPaid), tone: 1 },
                    { label: "Pendente", value: fmt(individualPending), tone: "muted" },
                    { label: "Atrasado", value: fmt(individualOverdue), tone: 4 },
                  ]}
                />
              </div>
            </CardSurface>
            <Card title="Parcelas por projeto" subtitle={`${(projectPayments || []).length} ${(projectPayments || []).length === 1 ? "projeto" : "projetos"}`} collapsible={false} className="lg:col-span-2">
              <List label="Projetos individuais">
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
                          <StatusPill tone={hasOverdue ? "danger" : pct >= 100 ? "success" : "neutral"}>{hasOverdue ? "Atrasado" : `${pct}%`}</StatusPill>
                        </span>
                      }
                      value={fmt(paid)}
                      valueHint={`de ${fmt(Number(pp.total_value))}`}
                    />
                  );
                })}
              </List>
            </Card>
          </div>
        </section>
      )}

      {(isAdmin || isTeam) && (wallets || []).length > 0 && (
        <section className="min-w-0">
          <TituloDoBloco icone={<Wallet className="h-4 w-4" />}>Ads Wallet</TituloDoBloco>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {(wallets || []).map((w: any) => (
              <StatCard
                key={w.id}
                label={w.client?.company_name || w.client?.full_name}
                value={fmt(Number(w.balance))}
                icon={<Wallet className="h-4 w-4" />}
                hint={<StatusPill tone={Number(w.balance) < 100 ? "warning" : "neutral"}>{w.platform}</StatusPill>}
                onClick={() => navigate("/financeiro")}
              />
            ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <div className="-m-1.5 flex flex-wrap" data-tour="dash-quick-actions">
        {quickActions.map((a, i) => (
          <button
            key={a.label}
            onClick={a.action}
            className={`m-1.5 inline-flex h-11 cursor-pointer items-center rounded-full pl-1.5 pr-5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              i === 0 && isAdmin ? "bg-foreground text-background hover:bg-foreground/90" : "border border-border bg-card text-foreground shadow-card hover:bg-muted"
            }`}
          >
            <span aria-hidden="true" className={`mr-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${i === 0 && isAdmin ? "bg-accent-solid text-on-accent" : "bg-muted text-foreground"}`}>
              <a.icon className="h-4 w-4" />
            </span>
            {a.label}
          </button>
        ))}
      </div>

      <Card
        as="section"
        title="Projetos ativos"
        subtitle={`${filteredProjects.length} ${filteredProjects.length === 1 ? "projeto" : "projetos"}`}
        collapsible={false}
      >
        <PillTabs
          label="Filtrar por marca"
          variant="soft"
          size="sm"
          value={brandFilter}
          onChange={(v) => setBrandFilter(v as BrandFilter)}
          tabs={BRAND_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          className="mb-4"
        />
        {loadingProjects ? (
          <div className="py-8 text-center text-[13px] text-muted-foreground">Carregando...</div>
        ) : filteredProjects.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-5 w-5" />} title="Nenhum projeto encontrado." />
        ) : (
          <div className="-mx-3 min-w-0 divide-y divide-border/60">
            {filteredProjects.map((p: any) => {
              const isHovered = hoveredProject === p.id;
              const showMenu = menuProject === p.id;
              const projectTeam = teamByProject[p.id] || [];
              const cliente = p.client?.company_name || p.client?.full_name;
              return (
                <div
                  key={p.id}
                  className={`relative cursor-pointer rounded-lg px-3 py-4 transition-colors hover:bg-muted/60 ${showMenu ? "z-50" : ""}`}
                  onClick={() => setDrawerProject(p)}
                  onMouseEnter={() => setHoveredProject(p.id)}
                  onMouseLeave={() => { setHoveredProject(null); setMenuProject(null); }}
                >
                  <div className="flex min-w-0 items-center">
                    <span className="relative mr-3 shrink-0">
                      <Avatar name={cliente || p.name} />
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                    </span>
                    <div className="mr-3 min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center">
                        <span className="mr-2 min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{p.name}</span>
                        <Chip className="mr-1.5 max-sm:hidden">{p.project_type?.replace("_", " ")}</Chip>
                        <Chip tone="accent">{getProjectBrand(p.project_type)}</Chip>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center">
                        <p className="min-w-0 truncate text-[12px] leading-4 text-muted-foreground">{cliente}</p>
                        {projectTeam.length > 0 && (
                          <span className="ml-2 hidden min-w-0 items-center text-[11px] text-muted-foreground sm:flex">
                            <Users className="mr-1 h-3 w-3 shrink-0" />
                            <span className="truncate">{projectTeam.map(m => m.name.split(" ")[0]).join(", ")}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mr-4 hidden w-36 shrink-0 md:block">
                      <div className="mb-1.5 flex items-center justify-between">
                        <PipelineBar pipeline={p.pipeline} />
                        <p className="ml-2 text-[12px] font-medium tabular-nums text-foreground">{p.progress}%</p>
                      </div>
                      <ProgressBar value={Number(p.progress) || 0} max={100} height={6} label={`${p.progress}% concluído`} />
                    </div>
                    <div className="mr-1 hidden shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-[12px] tabular-nums text-muted-foreground sm:flex">
                      <Clock className="mr-1.5 h-3 w-3" />
                      {formatDate(p.deadline)}
                    </div>
                    {/* Editar, status, progresso e excluir mudam o projeto: só o admin pode (RLS). */}
                    {isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuProject(showMenu ? null : p.id); }}
                      aria-label="Ações do projeto"
                      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    )}
                  </div>

                  {isAdmin && showMenu && (
                    <div className="absolute right-4 top-full z-50 w-56 rounded-md border border-border bg-popover p-2 shadow-pop animate-in fade-in zoom-in-95 duration-150">
                      <button onClick={(e) => { e.stopPropagation(); setEditProject(p); setMenuProject(null); }}
                        className="flex items-center w-full px-3 py-2 rounded-sm text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Edit3 className="mr-2.5 w-3.5 h-3.5" /> Editar
                      </button>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Status</p>
                        <div className="-m-0.5 flex flex-wrap">
                          {STATUS_OPTIONS.map((s) => (
                            <button key={s.value} onClick={(e) => { e.stopPropagation(); handleStatusChange(p.id, s.value); }}
                              className={`m-0.5 text-[11px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${p.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Progresso: {p.progress}%</p>
                        <Slider defaultValue={[p.progress]} max={100} step={5} onValueCommit={(val) => handleProgressChange(p.id, val[0])} className="w-full" />
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteProject(p.id); }}
                        className="flex items-center w-full px-3 py-2 rounded-sm text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Trash2 className="mr-2.5 w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  )}

                  {isHovered && !showMenu && p.description && (
                    <div className="mt-3 flex items-center justify-between pl-[52px] animate-fade-in">
                      <p className="mr-3 min-w-0 text-[12px] leading-[18px] text-muted-foreground">{p.description}</p>
                      <button className="shrink-0 text-[12px] font-medium text-primary hover:underline">Abrir</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Alerts Row: Clients renewal + Stalled Projects */}
      {isAdmin && (clientsRenewalAlert.length > 0 || stalledProjects.length > 0) && (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          {clientsRenewalAlert.length > 0 && (
            <Card title="Clientes com vencimento próximo" subtitle={`${clientsRenewalAlert.length} ${clientsRenewalAlert.length === 1 ? "cliente" : "clientes"}`} collapsible={false}>
              <List label="Clientes com vencimento próximo">
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
                        <StatusPill tone={isExpired ? "danger" : "warning"}>
                          {isExpired ? `Vencido há ${Math.abs(diffDays)}d` : diffDays === 0 ? "Vence hoje" : `Vence em ${diffDays}d`}
                        </StatusPill>
                      }
                      value={c.plan_value ? fmt(Number(c.plan_value)) : undefined}
                      onClick={() => navigate("/clientes")}
                    />
                  );
                })}
              </List>
            </Card>
          )}

          {stalledProjects.length > 0 && (
            <Card title="Projetos sem progresso recente" subtitle={`${stalledProjects.length} ${stalledProjects.length === 1 ? "projeto" : "projetos"}`} collapsible={false}>
              <List label="Projetos sem progresso recente">
                {stalledProjects.map((p: any) => {
                  const daysSince = Math.floor((now.getTime() - new Date(p.updated_at || p.created_at).getTime()) / 86400000);
                  return (
                    <ListRow
                      key={p.id}
                      avatar={p.client?.company_name || p.client?.full_name || p.name}
                      title={p.name}
                      subtitle={p.client?.company_name || p.client?.full_name}
                      status={<StatusPill>Parado há {daysSince}d</StatusPill>}
                      value={`${p.progress}%`}
                      onClick={() => setDrawerProject(p)}
                    />
                  );
                })}
              </List>
            </Card>
          )}
        </div>
      )}

      {/* Updates + Urgent Tasks */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        {/* O feed lê as DUAS fontes: os updates de projeto e a memória dos
            clientes (ritual, entrega, avulso, decisão, relatório). Antes só
            a primeira aparecia, e o painel mostrava menos movimento do que
            houve. */}
        <Card title="Atualizações recentes" collapsible={false}>
          {loadingActivity ? (
            <div className="py-4 text-center text-[13px] text-muted-foreground">Carregando...</div>
          ) : (activity || []).length === 0 ? (
            <EmptyState compact title="Nenhuma atualização." />
          ) : (
            <div className="-mx-3 divide-y divide-border/60">
              {(activity || []).map((entrada) => (
                /* items-start + min-w-0 + quebra de palavra: no celular a linha
                   longa quebrava desalinhada do ponto colorido. */
                <div
                  key={entrada.id}
                  className="flex min-w-0 cursor-pointer items-start rounded-lg px-3 py-3.5 transition-colors hover:bg-muted/60"
                  onClick={() => {
                    if (entrada.origin === "entrega") navigate("/relatorios");
                    else if (entrada.origin === "avulso" || entrada.origin === "ciclo") navigate("/ciclo");
                    else if (entrada.origin === "ritual") navigate("/central");
                    else if (entrada.projectId) navigate("/projetos");
                  }}
                >
                  <div className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full mr-3 ${updateTypeDotColors[entrada.origin] || "bg-primary/60"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] leading-5 text-foreground">{entrada.message}</p>
                    <p className="mt-1.5 flex items-center text-[12px] text-muted-foreground">
                      <Chip className="mr-2">{entrada.originLabel}</Chip>
                      {new Date(entrada.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Tarefas urgentes" variant={urgentTasks.length > 0 ? "ink" : "default"} collapsible={false}>
          {urgentTasks.length === 0 ? (
            <EmptyState compact title="Nenhuma tarefa urgente." />
          ) : (
            <List label="Tarefas urgentes">
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
                  status={<StatusPill tone={t.priority === "urgent" ? "danger" : "warning"}>{t.priority === "urgent" ? "Urgente" : "Alta"}</StatusPill>}
                  value={t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : undefined}
                />
              ))}
            </List>
          )}
        </Card>
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
