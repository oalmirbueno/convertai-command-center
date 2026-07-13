import { useProjects, useUpdates, useTasks, useClients } from "@/hooks/useSupabaseData";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
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
  const { data: updates, isLoading: loadingUpdates } = useUpdates();
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
    if (!c.plan_renewal_date) return false;
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
      .filter((c: any) => c.plan_status === "standby" || c.plan_status === "inactive")
      .map((c: any) => c.id)
  );
  const pendingBills = (billing || []).filter(
    (b: any) =>
      b.status === "pending" &&
      b.type !== "ads_recharge" &&
      !(b.type === "renewal" && pausedClientIds.has(b.client_id))
  );
  // Inclui parciais: a fatura original recebida em partes ainda conta no recebido pelo valor já pago.
  const paidBills = (billing || []).filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge");
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
    { label: "Clientes Ativos", value: String((clients || []).filter((c: any) => c.plan_status === "active").length), color: "bg-success" },
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
  };

  const generateQuizLink = async () => {
    const token = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `https://aceleriq.online/quiz/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link do quiz copiado!", {
        description: "Envie ao lead pra ele responder o diagnóstico.",
      });
    } catch {
      toast.error("Não foi possível copiar", { description: url });
    }
  };

  const quickActions = [
    { label: "Novo Projeto", icon: Plus, action: () => setCreateProjectOpen(true) },
    { label: "Novo Cliente", icon: UserPlus, action: () => setCreateClientOpen(true) },
    { label: "Nova Ata de Reunião", icon: FileText, action: () => setMeetingNotesOpen(true) },
    { label: "Gerar Link Briefing", icon: Link2, action: () => setBriefingLinkOpen(true) },
    { label: "Gerar link de quiz", icon: ClipboardList, action: generateQuizLink },
    { label: "Upload", icon: Upload, action: () => navigate("/arquivos") },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <p className="heading-page">Dashboard</p>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children" data-tour="dash-stats">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors">
            <p className="label-sm">{s.label}</p>
            <p className="font-mono font-light text-[28px] leading-none text-foreground mt-2">{s.value}</p>
            <div className={`h-0.5 w-8 ${s.color} rounded-full mt-3 opacity-60`} />
          </div>
        ))}
      </div>

      {/* Finance Stats - admin only */}
      {isAdmin && (
      <div>
        <p className="label-sm mb-3 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5 text-success" />
          Financeiro
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
          {financeStats.map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors cursor-pointer" onClick={() => navigate("/financeiro")}>
              <p className="label-sm">{s.label}</p>
              <p className="font-mono font-light text-[22px] leading-none text-foreground mt-2">{s.value}</p>
              {(s as any).sub && <p className="text-[10px] text-muted-foreground mt-1.5">{(s as any).sub}</p>}
              <div className={`h-0.5 w-8 ${s.color} rounded-full mt-3 opacity-60`} />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Individual Project Payments - admin only */}
      {isAdmin && (projectPayments || []).length > 0 && (
        <div>
          <p className="label-sm mb-3 flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-primary" />
            Projetos Individuais
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children mb-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm">Total Contratado</p>
              <p className="font-mono font-light text-[22px] leading-none text-foreground mt-2">{fmt(individualTotal)}</p>
              <div className="h-0.5 w-8 bg-primary rounded-full mt-3 opacity-60" />
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm">Recebido</p>
              <p className="font-mono font-light text-[22px] leading-none text-foreground mt-2">{fmt(individualPaid)}</p>
              <div className="h-0.5 w-8 bg-success rounded-full mt-3 opacity-60" />
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm">Pendente</p>
              <p className="font-mono font-light text-[22px] leading-none text-foreground mt-2">{fmt(individualPending)}</p>
              <div className="h-0.5 w-8 bg-warning rounded-full mt-3 opacity-60" />
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm">Atrasado</p>
              <p className="font-mono font-light text-[22px] leading-none text-foreground mt-2">{fmt(individualOverdue)}</p>
              <div className="h-0.5 w-8 bg-destructive rounded-full mt-3 opacity-60" />
            </div>
          </div>
          <div className="space-y-1">
            {(projectPayments || []).map((pp: any) => {
              const paid = (pp.installments || [])
                .filter((i: any) => i.status === "paid" || i.status === "partial")
                .reduce((s: number, i: any) => s + receivedOf(i), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const hasOverdue = (pp.installments || []).some((i: any) => i.status === "pending" && new Date(i.due_date) < now);
              return (
                <div key={pp.id} className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4 hover:border-muted-foreground/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{pp.project?.name || "Projeto"}</p>
                    <p className="text-[11px] text-muted-foreground">{pp.client?.company_name || pp.client?.full_name}</p>
                  </div>
                  <div className="w-24 hidden sm:block">
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5 text-right">{pct}%</p>
                  </div>
                  <div className="text-right hidden md:block">
                    <p className="text-xs font-mono text-success">{fmt(paid)}</p>
                    <p className="text-[10px] text-muted-foreground">de {fmt(Number(pp.total_value))}</p>
                  </div>
                  {hasOverdue && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(isAdmin || isTeam) && (wallets || []).length > 0 && (
        <div>
          <p className="label-sm mb-3 flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5 text-info" />
            Ads Wallet
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {(wallets || []).map((w: any) => (
              <div
                key={w.id}
                className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors cursor-pointer"
                onClick={() => navigate("/financeiro")}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] text-muted-foreground truncate">{w.client?.company_name || w.client?.full_name}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{w.platform}</span>
                </div>
                <p className="font-mono font-light text-[22px] leading-none text-foreground">{fmt(Number(w.balance))}</p>
                <div className={`h-0.5 w-8 rounded-full mt-3 opacity-60 ${Number(w.balance) < 100 ? "bg-warning" : "bg-info"}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2" data-tour="dash-quick-actions">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={a.action}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent"
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="label-sm">Projetos Ativos</p>
          <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
            {BRAND_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setBrandFilter(f.value)}
                className={`text-[11px] px-3 py-1 rounded-md transition-colors cursor-pointer border-none ${
                  brandFilter === f.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground bg-transparent"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {loadingProjects ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhum projeto encontrado.</div>
        ) : (
          <div className="space-y-0.5 stagger-children">
            {filteredProjects.map((p: any) => {
              const isHovered = hoveredProject === p.id;
              const showMenu = menuProject === p.id;
              const projectTeam = teamByProject[p.id] || [];
              return (
                <div
                  key={p.id}
                  className={`bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors relative ${showMenu ? "z-50" : ""}`}
                  onClick={() => setDrawerProject(p)}
                  onMouseEnter={() => setHoveredProject(p.id)}
                  onMouseLeave={() => { setHoveredProject(null); setMenuProject(null); }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{p.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{p.project_type?.replace("_", " ")}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{getProjectBrand(p.project_type)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground">{p.client?.company_name || p.client?.full_name}</p>
                        {projectTeam.length > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Users className="w-3 h-3" />
                            {projectTeam.map(m => m.name.split(" ")[0]).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-32 hidden md:block">
                      <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <PipelineBar pipeline={p.pipeline} />
                        <p className="text-xs font-mono text-muted-foreground">{p.progress}%</p>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDate(p.deadline)}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuProject(showMenu ? null : p.id); }}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1 rounded hover:bg-secondary"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {showMenu && (
                    <div className="absolute right-4 top-full z-50 bg-popover border border-border rounded-xl p-1.5 shadow-lg w-48 animate-in fade-in zoom-in-95 duration-150">
                      <button onClick={(e) => { e.stopPropagation(); setEditProject(p); setMenuProject(null); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Edit3 className="w-3.5 h-3.5" /> Editar
                      </button>
                      <div className="px-3 py-2">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Status</p>
                        <div className="flex flex-wrap gap-1">
                          {STATUS_OPTIONS.map((s) => (
                            <button key={s.value} onClick={(e) => { e.stopPropagation(); handleStatusChange(p.id, s.value); }}
                              className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${p.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
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
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none text-left">
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  )}

                  {isHovered && !showMenu && p.description && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between animate-fade-in">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <button className="text-xs text-primary hover:underline">Abrir</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Alerts Row: Clients renewal + Stalled Projects */}
      {isAdmin && (clientsRenewalAlert.length > 0 || stalledProjects.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {clientsRenewalAlert.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm mb-4 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-warning" />
                Clientes com Vencimento Próximo
              </p>
              <div className="space-y-0">
                {clientsRenewalAlert.map((c: any, i: number) => {
                  const renewal = new Date(c.plan_renewal_date + "T00:00:00");
                  const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
                  const isExpired = diffDays < 0;
                  return (
                    <div key={c.id}>
                      {i > 0 && <div className="border-t border-border" />}
                      <div className="flex items-center gap-3 py-3 cursor-pointer hover:bg-secondary/30 rounded-lg px-1"
                        onClick={() => navigate("/clientes")}>
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isExpired ? "bg-destructive" : "bg-warning"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-foreground">{c.company_name || c.full_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {c.plan_name && `${c.plan_name} · `}
                            {c.plan_value && `${fmt(Number(c.plan_value))} · `}
                            <span className={isExpired ? "text-destructive font-medium" : "text-warning"}>
                              {isExpired ? `Vencido há ${Math.abs(diffDays)}d` : diffDays === 0 ? "Vence hoje" : `Vence em ${diffDays}d`}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stalledProjects.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="label-sm mb-4 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                Projetos sem Progresso Recente
              </p>
              <div className="space-y-0">
                {stalledProjects.map((p: any, i: number) => {
                  const daysSince = Math.floor((now.getTime() - new Date(p.updated_at || p.created_at).getTime()) / 86400000);
                  return (
                    <div key={p.id}>
                      {i > 0 && <div className="border-t border-border" />}
                      <div className="flex items-center gap-3 py-3 cursor-pointer hover:bg-secondary/30 rounded-lg px-1"
                        onClick={() => setDrawerProject(p)}>
                        <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-foreground">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {p.client?.company_name || p.client?.full_name} · {p.progress}% · Parado há {daysSince}d
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Updates + Urgent Tasks */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4">Atualizações Recentes</p>
          {loadingUpdates ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Carregando...</div>
          ) : (updates || []).length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma atualização.</div>
          ) : (
          <div className="space-y-0">
              {(updates || []).map((u: any, i: number) => (
                <div key={u.id}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div
                    className="flex items-start gap-3 py-3 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors px-1"
                    onClick={() => {
                      if (u.update_type === "system" && u.message.includes("pedido")) navigate("/pedidos");
                      else if (u.update_type === "creative") navigate("/arquivos");
                      else if (u.project_id) navigate("/projetos");
                    }}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${updateTypeDotColors[u.update_type] || "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground">{u.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(u.created_at).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            Tarefas Urgentes
          </p>
          {urgentTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma tarefa urgente.</div>
          ) : (
            <div className="space-y-0">
              {urgentTasks.map((t: any, i: number) => (
                <div key={t.id}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div className="flex items-center gap-3 py-3">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === "urgent" ? "bg-destructive" : "bg-warning"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">{t.project?.name}</p>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
        onEdit={(p) => { setDrawerProject(null); setEditProject(p); }}
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
