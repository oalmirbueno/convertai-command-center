import { useProjects, useUpdates, useTasks, useClients } from "@/hooks/useSupabaseData";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { Clock, AlertTriangle, Plus, UserPlus, Upload, FileText, MoreHorizontal, Trash2, Edit3, Link2, Users, ClipboardList, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { useState, type ReactNode } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoVazio,
  RegiaoRolavel,
  Secao,
  SeletorCompacto,
  botao,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";

// Sem pulse-dot: nada piscando na tela parada (docs/design/SISTEMA.md, "Estados").
const statusDotColors: Record<string, string> = {
  active: "bg-info",
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

/** Lista de uma coisa só: um painel, linhas com divisória (sem cartão por linha). */
function Lista({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  return (
    <ul aria-label={rotulo} className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
      {children}
    </ul>
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
  const [menuProject, setMenuProject] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<any>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);
  const [briefingLinkOpen, setBriefingLinkOpen] = useState(false);
  const [drawerProject, setDrawerProject] = useState<any>(null);
  // Filtro de marca lembrado ao sair e voltar (useEstadoDaTela).
  const [brandFilter, setBrandFilter] = useEstadoDaTela<BrandFilter>("projetos:marca", "all", {
    validar: (v) => BRAND_FILTERS.some((f) => f.value === v),
  });
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
    { rotulo: "Projetos ativos", valor: String(activeProjects.length), ponto: "verde" as const },
    { rotulo: "Clientes ativos", valor: String((clients || []).filter((c: any) => c.plan_status === "active" && (c.client_type || "recurring") !== "one_off" && !isInternalClient(c)).length), ponto: "verde" as const },
    { rotulo: "Tarefas pendentes", valor: String((allTasks || []).filter((t: any) => t.status !== "done").length), ponto: "alerta" as const },
    { rotulo: "Em revisão", valor: String(projects?.filter((p: any) => p.status === "review").length || 0), ponto: "info" as const },
  ];

  const abrirFinanceiro = () => navigate("/financeiro");
  const financeStats = [
    { rotulo: "Recebido no mês", valor: fmt(totalReceivedThisMonth), ponto: "verde" as const, apoio: `Recorrente ${fmt(monthlyRevenue)} · Projetos ${fmt(individualPaidThisMonth)}`, para: "/financeiro" },
    { rotulo: "Pendente do mês", valor: fmt(totalPendingThisMonth), ponto: "alerta" as const, apoio: `Recorrente ${fmt(pendingBillsThisMonth)} · Projetos ${fmt(individualPendingThisMonth)}`, para: "/financeiro" },
    { rotulo: "Vence em 7 dias", valor: fmt(totalDueSoon7), ponto: totalDueSoon7 > 0 ? ("alerta" as const) : ("neutro" as const), apoio: `Recorrente ${fmt(dueSoon7Billing)} · Projetos ${fmt(dueSoon7Individual)}`, para: "/financeiro" },
    { rotulo: "Atrasado", valor: fmt(overdueTotal + individualOverdue), ponto: "perigo" as const, apoio: `Recorrente ${fmt(overdueTotal)} · Projetos ${fmt(individualOverdue)}`, para: "/financeiro" },
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

  // "Novo projeto" fica à vista (o primário da tela); o resto mora no "...".
  const quickActions = [
    { label: "Novo cliente", icon: UserPlus, action: () => setCreateClientOpen(true) },
    { label: "Nova ata de reunião", icon: FileText, action: () => setMeetingNotesOpen(true) },
    { label: "Gerar link de briefing", icon: Link2, action: () => setBriefingLinkOpen(true) },
    { label: "Gerar link de quiz", icon: ClipboardList, action: generateQuizLink },
    { label: "Enviar arquivo", icon: Upload, action: () => navigate("/arquivos") },
  ];

  const nomeDoCliente = (c: any) => c?.company_name || c?.full_name || "";

  const linhaDoProjeto = (p: any) => {
    const showMenu = menuProject === p.id;
    const projectTeam = teamByProject[p.id] || [];
    const equipe = projectTeam.map((m) => m.name.split(" ")[0]).join(", ");
    return (
      <li key={p.id} className="min-w-0">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Abrir projeto ${p.name}`}
          title={p.description || undefined}
          onClick={() => setDrawerProject(p)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setDrawerProject(p);
            }
          }}
          className={juntar("flex min-w-0 cursor-pointer items-center px-4 py-3 transition-colors hover:bg-muted/40", foco)}
        >
          <span aria-hidden="true" className={juntar("mr-3 h-2 w-2 shrink-0 rounded-full", statusDotColors[p.status] || "bg-muted-foreground")} />
          <div className="mr-3 min-w-0 flex-1">
            <div className="flex min-w-0 items-center">
              <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{p.name}</span>
              <span className={juntar(etiqueta, "ml-2 hidden bg-muted text-muted-foreground sm:inline-flex")}>{p.project_type?.replace("_", " ")}</span>
              <span className={juntar(etiqueta, "ml-1.5 hidden bg-primary/10 text-primary md:inline-flex")}>{getProjectBrand(p.project_type)}</span>
            </div>
            <p className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
              <span className="truncate">{nomeDoCliente(p.client)}</span>
              {equipe && (
                <span className="ml-2 hidden min-w-0 items-center truncate sm:flex">
                  <Users className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{equipe}</span>
                </span>
              )}
            </p>
          </div>
          <div className="mr-3 hidden w-28 shrink-0 md:block">
            <div className="h-[3px] overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-end">
              <PipelineBar pipeline={p.pipeline} />
              <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">{p.progress}%</span>
            </div>
          </div>
          {p.deadline && (
            <span className={juntar(texto.auxiliar, "mr-2 hidden shrink-0 items-center tabular-nums sm:flex")}>
              <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
              {formatDate(p.deadline)}
            </span>
          )}
          <Popover open={showMenu} onOpenChange={(aberto) => setMenuProject(aberto ? p.id : null)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Ações do projeto ${p.name}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className={botao.icone}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => { setEditProject(p); setMenuProject(null); }}
                className={juntar("flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", foco)}
              >
                <Edit3 className="mr-2.5 h-3.5 w-3.5" /> Editar
              </button>
              <div className="px-2.5 py-2">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Status</p>
                <div className="flex flex-wrap">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => handleStatusChange(p.id, s.value)}
                      aria-pressed={p.status === s.value}
                      className={juntar(
                        "mb-1 mr-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        p.status === s.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                        foco,
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-2.5 py-2">
                <p className={juntar(texto.rotulo, "mb-2")}>Progresso: {p.progress}%</p>
                <Slider defaultValue={[p.progress]} max={100} step={5} onValueCommit={(val) => handleProgressChange(p.id, val[0])} className="w-full" />
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteProject(p.id)}
                className={juntar("flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10", foco)}
              >
                <Trash2 className="mr-2.5 h-3.5 w-3.5" /> Excluir
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </li>
    );
  };

  const principal = (
    <div className="space-y-6">
      <FaixaDeNumeros rotulo="Resumo da operação" itens={stats} data-tour="dash-stats" />

      {isAdmin && (
        <Secao
          titulo="Financeiro"
          acao={
            <button type="button" onClick={abrirFinanceiro} className={botao.discreto}>
              Abrir <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
        >
          <FaixaDeNumeros rotulo="Financeiro do mês" itens={financeStats} />
        </Secao>
      )}

      <Secao
        titulo="Projetos ativos"
        descricao={loadingProjects ? undefined : `${filteredProjects.length} ${filteredProjects.length === 1 ? "projeto" : "projetos"}`}
        acao={
          <SeletorCompacto
            rotulo="Marca"
            opcoes={BRAND_FILTERS.map((f) => ({ valor: f.value, rotulo: f.label }))}
            valor={brandFilter}
            onEscolher={(v) => setBrandFilter(v as BrandFilter)}
          />
        }
      >
        {loadingProjects ? (
          <Carregando rotulo="Carregando projetos" linhas={4} />
        ) : filteredProjects.length === 0 ? (
          <EstadoVazio
            compacto
            titulo="Nenhum projeto ativo."
            acao={
              <button type="button" onClick={() => setCreateProjectOpen(true)} className={botao.secundario}>
                Novo projeto
              </button>
            }
          />
        ) : (
          <Lista rotulo="Projetos ativos">{filteredProjects.map(linhaDoProjeto)}</Lista>
        )}
      </Secao>

      {isAdmin && (projectPayments || []).length > 0 && (
        <Secao titulo="Projetos avulsos" descricao={`Recebido ${fmt(individualPaid)} de ${fmt(individualTotal)}`}>
          <FaixaDeNumeros
            rotulo="Projetos avulsos"
            className="mb-3"
            itens={[
              { rotulo: "Contratado", valor: fmt(individualTotal), ponto: "verde" },
              { rotulo: "Recebido", valor: fmt(individualPaid), ponto: "verde" },
              { rotulo: "Pendente", valor: fmt(individualPending), ponto: "alerta" },
              { rotulo: "Atrasado", valor: fmt(individualOverdue), ponto: "perigo" },
            ]}
          />
          <Lista rotulo="Pagamentos dos projetos avulsos">
            {(projectPayments || []).map((pp: any) => {
              const paid = (pp.installments || [])
                .filter((i: any) => i.status === "paid" || i.status === "partial")
                .reduce((s: number, i: any) => s + receivedOf(i), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const hasOverdue = (pp.installments || []).some((i: any) => i.status === "pending" && new Date(i.due_date) < now);
              return (
                <li key={pp.id} className="flex min-w-0 items-center px-4 py-3">
                  <div className="mr-3 min-w-0 flex-1">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>{pp.project?.name || "Projeto"}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>{nomeDoCliente(pp.client)}</p>
                  </div>
                  <div className="mr-3 hidden w-24 shrink-0 sm:block">
                    <Progress value={pct} className="h-1.5" />
                    <p className="mt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</p>
                  </div>
                  <div className="hidden shrink-0 text-right md:block">
                    <p className="text-[12px] tabular-nums text-success">{fmt(paid)}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">de {fmt(Number(pp.total_value))}</p>
                  </div>
                  {hasOverdue && <AlertTriangle className="ml-3 h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Parcela atrasada" />}
                </li>
              );
            })}
          </Lista>
        </Secao>
      )}

      {(isAdmin || isTeam) && (wallets || []).length > 0 && (
        <Secao titulo="Saldo de anúncios" descricao={`Total ${fmt(totalAds)}`}>
          <Lista rotulo="Saldo de anúncios por cliente">
            {(wallets || []).map((w: any) => (
              <li key={w.id} className="min-w-0">
                <button
                  type="button"
                  onClick={abrirFinanceiro}
                  className={juntar("flex w-full min-w-0 items-center px-4 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                >
                  <span aria-hidden="true" className={juntar("mr-3 h-1.5 w-1.5 shrink-0 rounded-full", Number(w.balance) < 100 ? "bg-warning" : "bg-info")} />
                  <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate")}>{nomeDoCliente(w.client)}</span>
                  <span className={juntar(etiqueta, "mr-3 bg-muted uppercase text-muted-foreground")}>{w.platform}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-foreground">{fmt(Number(w.balance))}</span>
                </button>
              </li>
            ))}
          </Lista>
        </Secao>
      )}
    </div>
  );

  const movimento = (
    <div className="space-y-6">
      <Secao titulo="Atualizações recentes">
        {/* O feed lê as DUAS fontes: os updates de projeto e a memória dos
            clientes (ritual, entrega, avulso, decisão, relatório). */}
        {loadingActivity ? (
          <Carregando rotulo="Carregando atualizações" linhas={4} />
        ) : (activity || []).length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma atualização." />
        ) : (
          <Lista rotulo="Atualizações recentes">
            {(activity || []).map((entrada) => (
              <li key={entrada.id} className="min-w-0">
                {/* items-start + min-w-0 + break-words: no celular a linha
                    longa quebrava desalinhada do ponto colorido. */}
                <button
                  type="button"
                  className={juntar("flex w-full min-w-0 items-start px-4 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                  onClick={() => {
                    if (entrada.origin === "entrega") navigate("/relatorios");
                    else if (entrada.origin === "avulso" || entrada.origin === "ciclo") navigate("/ciclo");
                    else if (entrada.origin === "ritual") navigate("/central");
                    else if (entrada.projectId) navigate("/projetos");
                  }}
                >
                  <span aria-hidden="true" className={`mr-3 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${updateTypeDotColors[entrada.origin] || "bg-primary/60"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] leading-snug text-foreground">{entrada.message}</span>
                    <span className={juntar(texto.auxiliar, "mt-0.5 block")}>
                      <span className="mr-1.5 inline-block rounded bg-muted px-1 py-px text-[11px] font-medium">{entrada.originLabel}</span>
                      <span className="tabular-nums">{new Date(entrada.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </Lista>
        )}
      </Secao>

      <Secao titulo="Tarefas urgentes" descricao={urgentTasks.length ? `${urgentTasks.length} em aberto` : undefined}>
        {urgentTasks.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma tarefa urgente." />
        ) : (
          <Lista rotulo="Tarefas urgentes">
            {urgentTasks.map((t: any) => (
              <li key={t.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(`/kanban?project=${t.project_id}&task=${t.id}`)}
                  className={juntar("flex w-full min-w-0 items-center px-4 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                >
                  <span aria-hidden="true" className={juntar("mr-3 h-1.5 w-1.5 shrink-0 rounded-full", t.priority === "urgent" ? "bg-destructive" : "bg-warning")} />
                  <span className="mr-3 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{t.title}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{t.project?.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {t.due_date ? new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}
                  </span>
                </button>
              </li>
            ))}
          </Lista>
        )}
      </Secao>

      {isAdmin && clientsRenewalAlert.length > 0 && (
        <Secao titulo="Vencimentos próximos" descricao={`${clientsRenewalAlert.length} ${clientsRenewalAlert.length === 1 ? "cliente" : "clientes"}`}>
          <Lista rotulo="Clientes com vencimento próximo">
            {clientsRenewalAlert.map((c: any) => {
              const renewal = new Date(c.plan_renewal_date + "T00:00:00");
              const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
              const isExpired = diffDays < 0;
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate("/clientes")}
                    className={juntar("flex w-full min-w-0 items-center px-4 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                  >
                    <span aria-hidden="true" className={juntar("mr-3 h-1.5 w-1.5 shrink-0 rounded-full", isExpired ? "bg-destructive" : "bg-warning")} />
                    <span className="mr-3 min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{nomeDoCliente(c)}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {[c.plan_name, c.plan_value ? fmt(Number(c.plan_value)) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={juntar("shrink-0 text-[12px] tabular-nums", isExpired ? "font-medium text-destructive" : "text-warning")}>
                      {isExpired ? `Vencido há ${Math.abs(diffDays)}d` : diffDays === 0 ? "Vence hoje" : `Vence em ${diffDays}d`}
                    </span>
                  </button>
                </li>
              );
            })}
          </Lista>
        </Secao>
      )}

      {isAdmin && stalledProjects.length > 0 && (
        <Secao titulo="Projetos parados" ajuda="Projetos ativos sem nenhuma atualização há 14 dias ou mais." descricao={`${stalledProjects.length} sem movimento`}>
          <Lista rotulo="Projetos sem progresso recente">
            {stalledProjects.map((p: any) => {
              const daysSince = Math.floor((now.getTime() - new Date(p.updated_at || p.created_at).getTime()) / 86400000);
              return (
                <li key={p.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setDrawerProject(p)}
                    className={juntar("flex w-full min-w-0 items-center px-4 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                  >
                    <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span className="mr-3 min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{p.name}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{nomeDoCliente(p.client)} · {p.progress}%</span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{daysSince}d</span>
                  </button>
                </li>
              );
            })}
          </Lista>
        </Secao>
      )}

      {/* Segundo Cérebro (só admin). */}
      {isAdmin && <SecondBrainPulseWidget />}
    </div>
  );

  return (
    <div className="min-w-0">
      <CabecalhoDePagina
        titulo="Dashboard"
        ajuda="Resumo do dia: números da operação, projetos ativos, o que mudou e o que está urgente. Clique num projeto para abrir o detalhe."
        acoes={
          <div className="flex items-center [&>*+*]:ml-2" data-tour="dash-quick-actions">
            <button type="button" onClick={() => setCreateProjectOpen(true)} className={botao.primario} aria-label="Novo projeto">
              <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Novo projeto</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={botao.secundario} aria-label="Mais ações">
                  <MoreHorizontal className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Mais</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {quickActions.map((a) => (
                  <DropdownMenuItem key={a.label} onSelect={() => a.action()} className="text-[13px]">
                    <a.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* De 1024 px para cima cada coluna rola sozinha e a página fica parada;
          no celular e no tablet a página rola normal (docs/design/SISTEMA.md). */}
      <AreaDeTrabalho principalRolavel={false} className="mt-4">
        <div className="grid min-w-0 gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
          <RegiaoRolavel rotulo="Operação" memoria="dashboard:principal" className="lg:pb-8 lg:pr-2">
            {principal}
          </RegiaoRolavel>
          <RegiaoRolavel rotulo="Movimento" memoria="dashboard:movimento" className="lg:pb-16 lg:pr-1">
            {movimento}
          </RegiaoRolavel>
        </div>
      </AreaDeTrabalho>

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
