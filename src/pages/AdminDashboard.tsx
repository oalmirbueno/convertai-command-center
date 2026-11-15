import type { ReactNode } from "react";
import { Card, CardSurface, Chip, EmptyState, PageHeader, PillTabs, StatCard, StatGrid, StatusDot } from "@/components/ds";
import { useProjects, useUpdates, useTasks, useClients } from "@/hooks/useSupabaseData";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { Clock, AlertTriangle, Plus, UserPlus, Upload, FileText, MoreHorizontal, Trash2, Edit3, Link2, TrendingUp, CreditCard, CheckCircle2, DollarSign, Wallet, Briefcase, Users, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
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

/** Título de um bloco do Dashboard: ícone pequeno num círculo suave, título curto e, à direita, o controle do bloco. */
function TituloDoBloco({ icone, acao, children }: { icone?: ReactNode; acao?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 items-center justify-between">
      <h2 className="flex min-w-0 items-center text-[15px] font-semibold leading-[22px] tracking-[-0.01em] text-foreground">
        {icone && <span aria-hidden="true" className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{icone}</span>}
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
    <TrendingUp key="r" className="h-4 w-4 text-success" />,
    <Clock key="p" className="h-4 w-4 text-warning" />,
    <CreditCard key="v" className="h-4 w-4 text-muted-foreground" />,
    <AlertTriangle key="a" className="h-4 w-4 text-destructive" />,
  ];
  const linha = "flex min-w-0 items-center gap-3 rounded-md px-2 py-2.5 transition-colors";

  return (
    <div className="min-w-0 space-y-6 animate-fade-in sm:space-y-7">
      <PageHeader title="Dashboard" />

      {/* Stats */}
      <div data-tour="dash-stats">
        <StatGrid cols={4} label="Resumo da operação">
          {stats.map((s, i) => {
            const Icone = iconesDosNumeros[i] || Briefcase;
            return <StatCard key={s.label} label={s.label} value={s.value} tone={i === 0 ? "accent" : "default"} icon={<Icone className="h-4 w-4" />} />;
          })}
        </StatGrid>
      </div>

      {/* Finance Stats - admin only */}
      {isAdmin && (
      <section className="min-w-0">
        <TituloDoBloco icone={<DollarSign className="h-3.5 w-3.5" />}>Financeiro</TituloDoBloco>
        <StatGrid cols={4} label="Financeiro do mês">
          {financeStats.map((s, i) => (
            <StatCard key={s.label} label={s.label} value={s.value} hint={(s as any).sub} icon={iconesDoFinanceiro[i]} onClick={() => navigate("/financeiro")} />
          ))}
        </StatGrid>
      </section>
      )}

      {/* Second Brain live pulse - admin only */}
      {isAdmin && <SecondBrainPulseWidget />}

      {/* Individual Project Payments - admin only */}
      {isAdmin && (projectPayments || []).length > 0 && (
        <section className="min-w-0">
          <TituloDoBloco icone={<Briefcase className="h-3.5 w-3.5" />}>Projetos individuais</TituloDoBloco>
          <StatGrid cols={4} label="Projetos individuais" className="mb-4">
            <StatCard label="Total contratado" value={fmt(individualTotal)} />
            <StatCard label="Recebido" value={fmt(individualPaid)} icon={<TrendingUp className="h-4 w-4 text-success" />} />
            <StatCard label="Pendente" value={fmt(individualPending)} icon={<Clock className="h-4 w-4 text-warning" />} />
            <StatCard label="Atrasado" value={fmt(individualOverdue)} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} />
          </StatGrid>
          <CardSurface className="divide-y divide-border/60 px-3 py-1 sm:px-4">
            {(projectPayments || []).map((pp: any) => {
              const paid = (pp.installments || [])
                .filter((i: any) => i.status === "paid" || i.status === "partial")
                .reduce((s: number, i: any) => s + receivedOf(i), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const hasOverdue = (pp.installments || []).some((i: any) => i.status === "pending" && new Date(i.due_date) < now);
              return (
                <div key={pp.id} className="flex min-w-0 items-center gap-4 px-1 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{pp.project?.name || "Projeto"}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{pp.client?.company_name || pp.client?.full_name}</p>
                  </div>
                  <div className="w-24 hidden sm:block">
                    <Progress value={pct} className="h-1.5" />
                    <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</p>
                  </div>
                  <div className="text-right hidden md:block">
                    <p className="text-[13px] font-medium tabular-nums text-success">{fmt(paid)}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">de {fmt(Number(pp.total_value))}</p>
                  </div>
                  {hasOverdue && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                </div>
              );
            })}
          </CardSurface>
        </section>
      )}

      {(isAdmin || isTeam) && (wallets || []).length > 0 && (
        <section className="min-w-0">
          <TituloDoBloco icone={<Wallet className="h-3.5 w-3.5" />}>Ads Wallet</TituloDoBloco>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {(wallets || []).map((w: any) => (
              <StatCard
                key={w.id}
                label={w.client?.company_name || w.client?.full_name}
                value={fmt(Number(w.balance))}
                hint={<Chip tone={Number(w.balance) < 100 ? "warning" : "neutral"} dot={Number(w.balance) < 100}>{w.platform}</Chip>}
                onClick={() => navigate("/financeiro")}
              />
            ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <div className="-m-1 flex flex-wrap" data-tour="dash-quick-actions">
        {quickActions.map((a, i) => (
          <button
            key={a.label}
            onClick={a.action}
            className={`m-1 inline-flex h-9 cursor-pointer items-center rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              i === 0 && isAdmin ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            <a.icon className="mr-2 h-3.5 w-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      <section className="min-w-0">
        <TituloDoBloco
          acao={
            <PillTabs
              label="Filtrar por marca"
              variant="soft"
              size="sm"
              value={brandFilter}
              onChange={(v) => setBrandFilter(v as BrandFilter)}
              tabs={BRAND_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
            />
          }
        >
          Projetos ativos
        </TituloDoBloco>
        {loadingProjects ? (
          <div className="py-8 text-center text-[13px] text-muted-foreground">Carregando...</div>
        ) : filteredProjects.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-5 w-5" />} title="Nenhum projeto encontrado." />
        ) : (
          <CardSurface className="divide-y divide-border/60 px-2 py-1 sm:px-3">
            {filteredProjects.map((p: any) => {
              const isHovered = hoveredProject === p.id;
              const showMenu = menuProject === p.id;
              const projectTeam = teamByProject[p.id] || [];
              return (
                <div
                  key={p.id}
                  className={`relative cursor-pointer rounded-md px-2 py-3.5 transition-colors hover:bg-muted/40 sm:px-3 ${showMenu ? "z-50" : ""}`}
                  onClick={() => setDrawerProject(p)}
                  onMouseEnter={() => setHoveredProject(p.id)}
                  onMouseLeave={() => { setHoveredProject(null); setMenuProject(null); }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground">{p.name}</span>
                        <Chip>{p.project_type?.replace("_", " ")}</Chip>
                        <Chip tone="accent">{getProjectBrand(p.project_type)}</Chip>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[12px] text-muted-foreground">{p.client?.company_name || p.client?.full_name}</p>
                        {projectTeam.length > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Users className="w-3 h-3" />
                            {projectTeam.map(m => m.name.split(" ")[0]).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-32 hidden md:block">
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <PipelineBar pipeline={p.pipeline} />
                        <p className="text-[12px] tabular-nums text-muted-foreground">{p.progress}%</p>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDate(p.deadline)}
                    </div>
                    {/* Editar, status, progresso e excluir mudam o projeto: só o admin pode (RLS). */}
                    {isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuProject(showMenu ? null : p.id); }}
                      aria-label="Ações do projeto"
                      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    )}
                  </div>

                  {isAdmin && showMenu && (
                    <div className="absolute right-4 top-full z-50 w-52 rounded-lg border border-border bg-popover p-2 shadow-pop animate-in fade-in zoom-in-95 duration-150">
                      <button onClick={(e) => { e.stopPropagation(); setEditProject(p); setMenuProject(null); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Edit3 className="w-3.5 h-3.5" /> Editar
                      </button>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Status</p>
                        <div className="flex flex-wrap gap-1">
                          {STATUS_OPTIONS.map((s) => (
                            <button key={s.value} onClick={(e) => { e.stopPropagation(); handleStatusChange(p.id, s.value); }}
                              className={`text-[11px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${p.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
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
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  )}

                  {isHovered && !showMenu && p.description && (
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between animate-fade-in">
                      <p className="text-[12px] text-muted-foreground">{p.description}</p>
                      <button className="text-[12px] font-medium text-primary hover:underline">Abrir</button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardSurface>
        )}
      </section>

      {/* Alerts Row: Clients renewal + Stalled Projects */}
      {isAdmin && (clientsRenewalAlert.length > 0 || stalledProjects.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {clientsRenewalAlert.length > 0 && (
            <Card title="Clientes com vencimento próximo" collapsible={false}>
              <div className="-mx-2">
                {clientsRenewalAlert.map((c: any) => {
                  const renewal = new Date(c.plan_renewal_date + "T00:00:00");
                  const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
                  const isExpired = diffDays < 0;
                  return (
                    <div key={c.id} className={`${linha} cursor-pointer hover:bg-muted/40`} onClick={() => navigate("/clientes")}>
                      <StatusDot tone={isExpired ? "danger" : "warning"} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[13px] text-foreground">{c.company_name || c.full_name}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {c.plan_name && `${c.plan_name} · `}
                          {c.plan_value && `${fmt(Number(c.plan_value))}`}
                        </p>
                      </div>
                      <Chip tone={isExpired ? "danger" : "warning"}>
                        {isExpired ? `Vencido há ${Math.abs(diffDays)}d` : diffDays === 0 ? "Vence hoje" : `Vence em ${diffDays}d`}
                      </Chip>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {stalledProjects.length > 0 && (
            <Card title="Projetos sem progresso recente" collapsible={false}>
              <div className="-mx-2">
                {stalledProjects.map((p: any) => {
                  const daysSince = Math.floor((now.getTime() - new Date(p.updated_at || p.created_at).getTime()) / 86400000);
                  return (
                    <div key={p.id} className={`${linha} cursor-pointer hover:bg-muted/40`} onClick={() => setDrawerProject(p)}>
                      <StatusDot />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[13px] text-foreground">{p.name}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {p.client?.company_name || p.client?.full_name} · {p.progress}%
                        </p>
                      </div>
                      <Chip>Parado há {daysSince}d</Chip>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Updates + Urgent Tasks */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
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
            <div className="-mx-2">
              {(activity || []).map((entrada) => (
                /* items-start + min-w-0 + quebra de palavra: no celular a linha
                   longa quebrava desalinhada do ponto colorido. */
                <div
                  key={entrada.id}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/40"
                  onClick={() => {
                    if (entrada.origin === "entrega") navigate("/relatorios");
                    else if (entrada.origin === "avulso" || entrada.origin === "ciclo") navigate("/ciclo");
                    else if (entrada.origin === "ritual") navigate("/central");
                    else if (entrada.projectId) navigate("/projetos");
                  }}
                >
                  <div className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${updateTypeDotColors[entrada.origin] || "bg-primary/60"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] leading-snug text-foreground">{entrada.message}</p>
                    <p className="mt-1 flex items-center text-[12px] text-muted-foreground">
                      <Chip className="mr-2">{entrada.originLabel}</Chip>
                      {new Date(entrada.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Tarefas urgentes" collapsible={false}>
          {urgentTasks.length === 0 ? (
            <EmptyState compact title="Nenhuma tarefa urgente." />
          ) : (
            <div className="-mx-2">
              {urgentTasks.map((t: any) => (
                <div key={t.id} className={linha}>
                  <StatusDot tone={t.priority === "urgent" ? "danger" : "warning"} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] text-foreground">{t.title}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{t.project?.name}</p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}</span>
                </div>
              ))}
            </div>
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
