import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useQuery } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyUser } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { DollarSign, TrendingUp, Users, CreditCard, Plus, RefreshCw, Bell, Edit3, Zap, CheckCircle2, MessageCircle, Briefcase, AlertTriangle as AlertTriangleIcon, History, ChevronLeft, ChevronRight } from "lucide-react";
import { getProjectBrand, BrandFilter, BRAND_FILTERS, matchesBrandFilter } from "@/lib/brandHelpers";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CashFlow from "@/components/finance/CashFlow";
import InvestorCapital from "@/components/finance/InvestorCapital";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { todayBR as _todayBR, toBRDateKey as _toBRDateKey } from "@/lib/dateBR";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const parseAppDate = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }
  return new Date(value);
};

// Always returns YYYY-MM-DD in America/Sao_Paulo (GMT-3).
const toLocalDateKey = (date?: Date) => (date ? _toBRDateKey(date) : _todayBR());




const formatAppDate = (value?: string | null) => parseAppDate(value)?.toLocaleDateString("pt-BR") || "-";

// Returns the amount actually received for a billing/installment record,
// respecting partial payments. Use this for any "received" aggregation.
const receivedOf = (row: any): number => {
  if (!row) return 0;
  const total = Number(row.amount) || 0;
  const paid = Number(row.paid_amount) || 0;
  if (row.status === "partial") return Math.min(paid, total);
  if (row.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

const statusBadge = (status: string, dueDate?: string) => {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = parseAppDate(dueDate);
  const isOverdue = due && due < todayStart && status === "pending";
  if (status === "paid") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">✅ Pago</span>;
  if (status === "partial") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-info/15 text-info">◐ Parcial</span>;
  if (status === "completed") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">Concluída</span>;
  if (status === "approved") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-info/15 text-info">Aprovada pelo cliente</span>;
  if (isOverdue) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">Atrasado</span>;
  if (status === "pending") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Pendente</span>;
  if (status === "rejected") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">Recusada</span>;
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{status}</span>;
};

const typeIcon = (type: string) => {
  if (type === "renewal") return "🔄";
  if (type === "ads_recharge") return "📢";
  return "⭐";
};

export default function AdminFinanceiro() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const { data: billing } = useBilling();
  const { data: wallets } = useAdsWallet();
  const { data: recharges } = useRechargeRequests();
  const { data: clients } = useClients();
  const { data: projectPayments } = useQuery({
    queryKey: ["all-project-payments-finance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_payments")
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type, billing_mode, brand), client:profiles!project_payments_client_id_fkey(full_name, company_name, client_type, brand), installments:payment_installments(*)");
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });
  const { data: auditLogs } = useQuery({
    queryKey: ["payment-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      // Fetch performer names
      const performerIds = [...new Set((data || []).map((l: any) => l.performed_by).filter(Boolean))];
      let performers: Record<string, string> = {};
      if (performerIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", performerIds);
        (profiles || []).forEach((p: any) => { performers[p.id] = p.full_name; });
      }
      return (data || []).map((l: any) => ({ ...l, performerName: performers[l.performed_by] || null }));
    },
    enabled: isAdmin,
  });

  const [newBillingOpen, setNewBillingOpen] = useState(false);
  const [rechargeModal, setRechargeModal] = useState<{ clientId: string; platform: string } | null>(null);
  const [addWalletModal, setAddWalletModal] = useState(false);
  const [editPlanModal, setEditPlanModal] = useState<any>(null);
  const [receivedFilter, setReceivedFilter] = useState<string>("month");
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<"month" | "all">("month");
  const [payModal, setPayModal] = useState<{ id: string; type: "billing" | "installment"; label: string; amount: number; clientId?: string; billingType?: string; paidSoFar?: number; totalAmount?: number } | null>(null);
  const [payType, setPayType] = useState<"full" | "partial">("full");
  const [payPartialAmount, setPayPartialAmount] = useState("");
  const [receivedCollapsed, setReceivedCollapsed] = useState(false);
  const [indivCollapsed, setIndivCollapsed] = useState(true);
  const [renewalsView, setRenewalsView] = useState<"mensalistas" | "avulsos">("mensalistas");
  const [selMonth, setSelMonth] = useState<number>(new Date().getMonth());
  const [selYear, setSelYear] = useState<number>(new Date().getFullYear());

  const [billForm, setBillForm] = useState({ client_id: "", type: "renewal", amount: "", due_date: "", description: "" });
  const [rechargeForm, setRechargeForm] = useState({ amount: "", reason: "", period: "semanal" });
  const [addWalletForm, setAddWalletForm] = useState({ client_id: "", platform: "meta", balance: "0" });
  const [planForm, setPlanForm] = useState({ amount: "", renewal_date: "", description: "" });
  const [syncing, setSyncing] = useState(false);
  const autoSyncDone = useRef(false);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  // Auto-sync: create billing entries for clients with plan_value + plan_renewal_date but no billing record
  const handleSyncBilling = async (silent = false) => {
    if (!clients || !billing) return;
    setSyncing(true);
    let created = 0;
    for (const c of clients as any[]) {
      if (!c.plan_value || !c.plan_renewal_date) continue;
      if (c.plan_status !== "active") continue;
      const existingBill = (billing || []).find(
        (b: any) => b.client_id === c.id && b.type === "renewal" && b.status === "pending"
      );
      if (!existingBill) {
        await supabase.from("billing").insert({
          client_id: c.id,
          type: "renewal",
          amount: Number(c.plan_value),
          due_date: c.plan_renewal_date,
          description: c.plan_name ? `Renovação · ${c.plan_name}` : "Renovação Mensal",
        });
        created++;
      }
    }
    if (created > 0) {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      if (!silent) toast.success(`${created} cobrança(s) gerada(s) automaticamente`);
    } else {
      if (!silent) toast.info("Todas as cobranças já estão sincronizadas");
    }
    setSyncing(false);
  };

  // Auto-sync on first load when billing is empty but clients have plan data
  useEffect(() => {
    if (autoSyncDone.current || !isAdmin || !clients || !billing) return;
    const activeWithPlan = (clients as any[]).filter(c => c.plan_value && c.plan_renewal_date && c.plan_status === "active");
    const hasPendingRenewals = (billing || []).some((b: any) => b.type === "renewal" && b.status === "pending");
    if (activeWithPlan.length > 0 && !hasPendingRenewals) {
      autoSyncDone.current = true;
      handleSyncBilling(true);
    } else {
      autoSyncDone.current = true;
    }
  }, [clients, billing, isAdmin]);

  // Computed totals · combine billing + client plan data for accurate stats
  // "month" period is driven by the selected month/year (month picker)
  const isThisMonth = (d: string) => {
    const date = parseAppDate(d);
    if (!date) return false;
    return date.getMonth() === selMonth && date.getFullYear() === selYear;
  };
  const isCurrentMonthSelected = selMonth === thisMonth && selYear === thisYear;

  // Standby/inactive clients: pause their recurring pending charges from the finance view
  const pausedClientIds = new Set(
    (clients || [])
      .filter((c: any) => c.plan_status === "standby" || c.plan_status === "inactive")
      .map((c: any) => c.id)
  );
  const isPausedRenewal = (b: any) => b.type === "renewal" && pausedClientIds.has(b.client_id);

  const pendingBills = (billing || []).filter((b: any) => b.status === "pending" && !isPausedRenewal(b));
  // "Recebido" inclui parcial: o valor recebido vem de paid_amount nesse caso.
  const paidBills = (billing || []).filter((b: any) => b.status === "paid" || b.status === "partial");
  const overdueBills = pendingBills.filter((b: any) => {
    const due = parseAppDate(b.due_date);
    return due ? due < todayStart : false;
  });

  // "A Receber" · from billing pending + active clients with plan_value not yet in billing
  const isInActivePeriod = (date?: string | null) => periodFilter === "all" || (!!date && isThisMonth(date));
  const hasPaidRenewalInActiveMonth = (clientId: string) =>
    periodFilter === "month" && (billing || []).some((b: any) =>
      b.client_id === clientId &&
      b.type === "renewal" &&
      (b.status === "paid" || b.status === "partial") &&
      isThisMonth(b.paid_date || b.due_date)
    );
  const pendingBillsInActivePeriod = pendingBills.filter((b: any) => isInActivePeriod(b.due_date));
  const clientsWithPlanNotInBilling = (clients || []).filter((c: any) =>
    c.plan_value && c.plan_status === "active" &&
    isInActivePeriod(c.plan_renewal_date) &&
    !pendingBills.some((b: any) => b.client_id === c.id && b.type === "renewal") &&
    !hasPaidRenewalInActiveMonth(c.id)
  );
  const extraPending = clientsWithPlanNotInBilling.reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Period-aware filtering
  const monthPendingBills = pendingBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.due_date));
  const monthPaidBills = paidBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.paid_date || b.due_date));

  const monthlyRevenue = monthPaidBills.reduce((s: number, b: any) => s + receivedOf(b), 0);

  const pendingTotal = periodFilter === "month"
    ? monthPendingBills.reduce((s: number, b: any) => s + Number(b.amount), 0)
    : pendingBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + Number(b.amount), 0) + extraPending;

  const overdueTotal = periodFilter === "month"
    ? monthPendingBills.filter((b: any) => {
      const due = parseAppDate(b.due_date);
      return due ? due < todayStart : false;
    }).reduce((s: number, b: any) => s + Number(b.amount), 0)
    : overdueBills.reduce((s: number, b: any) => s + Number(b.amount), 0);

  const receivedTotal = periodFilter === "month"
    ? monthlyRevenue
    : paidBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + receivedOf(b), 0);

  // Receita Mensal Esperada = soma dos plan_value de clientes ativos
  const expectedMonthlyRevenue = (clients || [])
    .filter((c: any) => c.plan_value && c.plan_status === "active")
    .reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Projeção próximo mês
  const nextMonth = thisMonth === 11 ? 0 : thisMonth + 1;
  const nextYear = thisMonth === 11 ? thisYear + 1 : thisYear;
  const isNextMonth = (d: string) => {
    const date = parseAppDate(d);
    if (!date) return false;
    return date.getMonth() === nextMonth && date.getFullYear() === nextYear;
  };

  // Recurring: plan_value de clientes ativos (mesma receita esperada)
  const nextMonthRecurring = expectedMonthlyRevenue;

  // Individual: parcelas pendentes com vencimento no próximo mês
  const nextMonthIndiv = (projectPayments || [])
    .filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter))
    .reduce((sum: number, pp: any) =>
      sum + (pp.installments || []).filter((i: any) => i.status === "pending" && isNextMonth(i.due_date))
        .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const nextMonthTotal = (brandFilter === "all" || brandFilter === "aceleriq" ? nextMonthRecurring : 0)
    + (brandFilter === "all" || brandFilter === "sitebolt" ? nextMonthIndiv : 0);

  const totalAds = (wallets || []).reduce((s: number, w: any) => s + Number(w.balance), 0);

  // Individual project payments totals (period-aware)
  const filteredPayments = (projectPayments || []).filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter));

  const indivPaid = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || [])
      .filter((i: any) => (i.status === "paid" || i.status === "partial") && (periodFilter === "all" || isThisMonth(i.paid_date || i.due_date)))
      .reduce((s: number, i: any) => s + Number(i.status === "partial" ? (i.paid_amount || 0) : i.amount), 0), 0);

  const indivPendingAll = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending")
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPendingMonth = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending" && isThisMonth(i.due_date))
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPending = periodFilter === "month" ? indivPendingMonth : indivPendingAll;

  const indivOverdue = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => {
      const due = parseAppDate(i.due_date);
      return i.status === "pending" && !!due && due < todayStart && (periodFilter === "all" || isThisMonth(i.due_date));
    })
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivTotal = filteredPayments.reduce((sum: number, pp: any) => sum + Number(pp.total_value), 0);

  const handleMarkPaid = async (id: string) => {
    const localBill = (billing || []).find((b: any) => b.id === id);
    const { data: currentBill, error: fetchError } = await supabase
      .from("billing")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) {
      toast.error(fetchError.message);
      return;
    }
    const bill = currentBill || localBill;
    if (!bill) {
      toast.error("Cobrança não encontrada");
      return;
    }
    if (bill.status === "paid") {
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.info("Esse pagamento já estava registrado");
      return;
    }
    const today = toLocalDateKey();
    const { data: updatedRows, error: updateError } = await supabase
      .from("billing")
      .update({ status: "paid", paid_date: today, paid_amount: Number(bill.amount) || null } as any)
      .eq("id", id)
      .eq("status", "pending")
      .select();
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    if (!updatedRows || updatedRows.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.info("Esse lançamento já saiu dos pendentes");
      return;
    }

    // Registra no histórico de auditoria (caso o pagamento venha do botão direto, não do painel)
    if (bill) {
      await supabase.from("payment_audit_log").insert({
        entity_type: "billing",
        entity_id: id,
        action: "paid_full",
        old_status: bill.status || "pending",
        new_status: "paid",
        old_amount: Number(bill.amount),
        new_amount: Number(bill.amount),
        notes: bill.description || (bill.type === "renewal" ? "Renovação Mensal" : "Cobrança"),
        performed_by: user?.id || null,
      } as any);
      queryClient.invalidateQueries({ queryKey: ["payment-audit-log"] });
    }


    // If it's a renewal, advance the renewal date by 1 month, clear overdue,
    // reactivate paused projects and AUTO-CREATE the next month's billing entry
    if (bill?.client_id && bill?.type === "renewal") {
      const client = (clients || []).find((c: any) => c.id === bill.client_id);
      if (client?.plan_renewal_date) {
        const currentDate = new Date(client.plan_renewal_date + "T00:00:00");
        currentDate.setMonth(currentDate.getMonth() + 1);
        const newDate = toLocalDateKey(currentDate);
        await supabase.from("profiles").update({
          plan_renewal_date: newDate,
          overdue_since: null,
        } as any).eq("id", bill.client_id);

        // Reactivate paused projects
        const { data: pausedProjects } = await supabase
          .from("projects")
          .select("id")
          .eq("client_id", bill.client_id)
          .eq("status", "paused")
          .is("deleted_at", null);
        if (pausedProjects && pausedProjects.length > 0) {
          for (const p of pausedProjects) {
            await supabase.from("projects").update({ status: "in_progress" }).eq("id", p.id);
          }
        }

        // Create next month's renewal billing entry (if not already existing)
        const { data: existingNext } = await supabase
          .from("billing")
          .select("id")
          .eq("client_id", bill.client_id)
          .eq("type", "renewal")
          .eq("status", "pending")
          .eq("due_date", newDate)
          .maybeSingle();
        if (!existingNext) {
          await supabase.from("billing").insert({
            client_id: bill.client_id,
            type: "renewal",
            amount: Number(client.plan_value || bill.amount),
            due_date: newDate,
            description: client.plan_name ? `Renovação · ${client.plan_name}` : "Renovação Mensal",
          });
        }
      }
    }

    // Notify client
    if (bill?.client_id) {
      await notifyUser(bill.client_id, `Pagamento de ${fmt(Number(bill.amount))} registrado ✅`, "billing", "/financeiro");
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["billing"] }),
      queryClient.invalidateQueries({ queryKey: ["clients"] }),
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] }),
    ]);
    toast.success("Pagamento registrado! Próxima renovação gerada automaticamente.");
  };

  const handleCreateBilling = async () => {
    if (!billForm.client_id || !billForm.amount || !billForm.due_date) { toast.error("Preencha todos os campos"); return; }
    await supabase.from("billing").insert({
      client_id: billForm.client_id, type: billForm.type,
      amount: parseFloat(billForm.amount), due_date: billForm.due_date,
      description: billForm.description || null,
    });
    // Notify client
    await notifyUser(billForm.client_id, `Nova cobrança de ${fmt(parseFloat(billForm.amount))} registrada`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    toast.success("Cobrança criada");
    setNewBillingOpen(false);
    setBillForm({ client_id: "", type: "renewal", amount: "", due_date: "", description: "" });
  };

  const handleRequestRecharge = async () => {
    if (!rechargeModal || !rechargeForm.amount) { toast.error("Informe o valor"); return; }
    const amount = parseFloat(rechargeForm.amount);
    const periodLabel = rechargeForm.period === "mensal" ? "mensal" : "semanal";
    await supabase.from("recharge_requests").insert({
      client_id: rechargeModal.clientId, platform: rechargeModal.platform,
      amount, reason: rechargeForm.reason ? `${rechargeForm.reason} (${periodLabel})` : `Investimento ${periodLabel}`, requested_by: user?.id,
    });
    // Notify the CLIENT
    await notifyUser(rechargeModal.clientId, `Recarga de ${fmt(amount)} (${periodLabel}) solicitada para ${rechargeModal.platform}. Por favor, confirme.`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    toast.success("Solicitação de recarga enviada! Cliente será notificado.");

    // Fire webhook
    const client = (clients || []).find((c: any) => c.id === rechargeModal.clientId);
    fireWebhook(webhooks.adsRecharge, {
      client_id: rechargeModal.clientId,
      client_name: client?.full_name || '',
      client_email: client?.email || '',
      amount,
      platform: rechargeModal.platform,
      urgency: 'normal',
    });

    setRechargeModal(null);
    setRechargeForm({ amount: "", reason: "", period: "semanal" });
  };

  const handleCompleteRecharge = async (r: any) => {
    // Update wallet balance
    const wallet = (wallets || []).find((w: any) => w.client_id === r.client_id && w.platform === r.platform);
    if (wallet) {
      await supabase.from("ads_wallet").update({
        balance: Number(wallet.balance) + Number(r.amount),
        last_recharge_date: new Date().toISOString(),
      }).eq("id", wallet.id);
    }
    await supabase.from("recharge_requests").update({ status: "completed", approved_by: user?.id }).eq("id", r.id);
    // Notify client
    await notifyUser(r.client_id, `Recarga de ${fmt(Number(r.amount))} para ${r.platform} concluída! Saldo atualizado ✅`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
    toast.success("Saldo atualizado!");
  };

  const handleSendReminder = async (client: any, via: "notification" | "whatsapp") => {
    const billingRecord = (billing || []).find((b: any) => b.client_id === client.id && b.type === "renewal" && b.status === "pending");
    const renewalDate = client.plan_renewal_date ? formatAppDate(client.plan_renewal_date) : "em breve";

    if (via === "whatsapp") {
      const phone = client.phone?.replace(/\D/g, "") || "";
      const msg = encodeURIComponent(`Olá! Seu plano renova em ${renewalDate}. Os resultados estão crescendo! Para garantir a continuidade, confirme a renovação. 🚀`);
      window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
    } else {
      await notifyUser(client.id, `Olá! Seu plano renova em ${renewalDate}. Garanta a continuidade dos seus resultados! 🚀`, "billing", "/financeiro");
      toast.success("Lembrete enviado");
    }

    if (billingRecord) {
      await supabase.from("billing").update({ reminder_count: (billingRecord.reminder_count || 0) + 1 }).eq("id", billingRecord.id);
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    }
  };

  const handleEditPlan = async () => {
    if (!editPlanModal) return;
    if (planForm.renewal_date) {
      await supabase.from("profiles").update({ plan_renewal_date: planForm.renewal_date }).eq("id", editPlanModal.id);
    }
    if (planForm.amount || planForm.description) {
      const billingRecord = (billing || []).find((b: any) => b.client_id === editPlanModal.id && b.type === "renewal");
      if (billingRecord) {
        await supabase.from("billing").update({
          ...(planForm.amount ? { amount: parseFloat(planForm.amount) } : {}),
          ...(planForm.description ? { description: planForm.description } : {}),
          ...(planForm.renewal_date ? { due_date: planForm.renewal_date } : {}),
        }).eq("id", billingRecord.id);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    toast.success("Plano atualizado");
    setEditPlanModal(null);
    setPlanForm({ amount: "", renewal_date: "", description: "" });
  };

  const openWhatsAppReminder = (client: any, billingItem: any) => {
    const phone = client?.phone?.replace(/\D/g, "") || "";
    const msg = encodeURIComponent(`Olá! Lembramos que há uma fatura de ${fmt(Number(billingItem.amount))} com vencimento em ${formatAppDate(billingItem.due_date)}. Qualquer dúvida estamos à disposição! 😊`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  const logAudit = async (entityType: string, entityId: string, action: string, oldStatus: string | null, newStatus: string, oldAmount: number | null, newAmount: number, notes?: string) => {
    await supabase.from("payment_audit_log").insert({
      entity_type: entityType, entity_id: entityId, action, old_status: oldStatus, new_status: newStatus,
      old_amount: oldAmount, new_amount: newAmount, notes: notes || null, performed_by: user?.id || null,
    } as any);
    queryClient.invalidateQueries({ queryKey: ["payment-audit-log"] });
  };

  const handlePayFromPanel = async () => {
    if (!payModal) return;
    const today = toLocalDateKey();
    const paidAmount = payType === "full" ? payModal.amount : (parseFloat(payPartialAmount) || 0);

    if (payModal.type === "billing") {
      if (payType === "full") {
        await handleMarkPaid(payModal.id);
      } else {
        const { data: currentBill, error: fetchError } = await supabase
          .from("billing")
          .select("*")
          .eq("id", payModal.id)
          .maybeSingle();
        if (fetchError) {
          toast.error(fetchError.message);
          return;
        }
        if (!currentBill || currentBill.status !== "pending") {
          await queryClient.invalidateQueries({ queryKey: ["billing"] });
          toast.info("Esse lançamento já saiu dos pendentes");
          return;
        }
        const remaining = Math.max(payModal.amount - paidAmount, 0);
        const isFullyPaidNow = paidAmount >= payModal.amount;
        // Marca a fatura ORIGINAL como "partial" (não "paid") quando recebido < total.
        // Assim "Recebido" considera apenas o valor realmente pago e dashboards param de inflar.
        const { data: updatedRows, error: updateError } = await supabase.from("billing").update({
          status: isFullyPaidNow ? "paid" : "partial",
          paid_date: today,
          paid_amount: paidAmount,
          description: `${currentBill.description || "Fatura"} (parcial: ${fmt(paidAmount)} de ${fmt(payModal.amount)})`,
        } as any).eq("id", payModal.id).eq("status", "pending").select();
        if (updateError) {
          toast.error(updateError.message);
          return;
        }
        if (!updatedRows || updatedRows.length === 0) {
          await queryClient.invalidateQueries({ queryKey: ["billing"] });
          toast.info("Esse lançamento já saiu dos pendentes");
          return;
        }
        if (remaining > 0 && payModal.clientId) {
          await supabase.from("billing").insert({
            client_id: payModal.clientId,
            type: currentBill.type || "renewal",
            amount: remaining,
            due_date: currentBill.due_date || today,
            description: `Saldo restante · ${fmt(remaining)}`,
          });
        }
        await logAudit("billing", payModal.id, "paid_partial", "pending", isFullyPaidNow ? "paid" : "partial", payModal.amount, paidAmount, `${payModal.label} · restante: ${fmt(remaining)}`);
        if (payModal.clientId) {
          await notifyUser(payModal.clientId, `Pagamento parcial de ${fmt(paidAmount)} registrado ✅ (restante: ${fmt(remaining)})`, "billing", "/financeiro");
        }
        queryClient.invalidateQueries({ queryKey: ["billing"] });
        queryClient.invalidateQueries({ queryKey: ["clients"] });
        toast.success("Pagamento parcial registrado!");
      }
    } else if (payModal.type === "installment") {
      const { data: currentInstallment, error: fetchError } = await supabase
        .from("payment_installments")
        .select("*")
        .eq("id", payModal.id)
        .maybeSingle();
      if (fetchError) {
        toast.error(fetchError.message);
        return;
      }
      if (!currentInstallment || currentInstallment.status === "paid") {
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já estava quitada");
        return;
      }
      const total = Number(currentInstallment.amount) || Number(payModal.totalAmount) || payModal.amount;
      const currentPaid = Number(currentInstallment.paid_amount || 0);
      const amountDue = Math.max(total - currentPaid, 0);
      if (amountDue <= 0.01) {
        await supabase.from("payment_installments").update({ status: "paid", paid_amount: total, paid_date: currentInstallment.paid_date || today } as any).eq("id", payModal.id);
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já estava quitada");
        return;
      }
      const paymentValue = payType === "full" ? amountDue : Math.min(paidAmount, amountDue);
      const newPaidTotal = Math.min(currentPaid + paymentValue, total);
      const newStatus = newPaidTotal >= total ? "paid" : "partial";
      const updateInstallment = () => {
        let q = supabase
          .from("payment_installments")
          .update({ status: newStatus, paid_amount: newPaidTotal, paid_date: today } as any)
          .eq("id", payModal.id)
          .eq("status", currentInstallment.status || "pending");
        q = currentPaid > 0 ? q.eq("paid_amount", currentPaid) : q.or("paid_amount.is.null,paid_amount.eq.0");
        return q.select();
      };
      const { data: updatedRows, error: updateError } = await updateInstallment();
      if (updateError) {
        toast.error(updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        await queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
        toast.info("Essa parcela já saiu dos pendentes");
        return;
      }
      if (payType === "full") {
        await logAudit("installment", payModal.id, "paid_full", currentInstallment.status || "pending", newStatus, total, paymentValue, payModal.label);
      } else {
        await logAudit("installment", payModal.id, "paid_partial", currentInstallment.status || "pending", newStatus, total, paymentValue, payModal.label);
      }
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast.success(payType === "full" ? "Parcela paga!" : "Pagamento parcial registrado!");
    }

    setPayModal(null);
    setPayType("full");
    setPayPartialAmount("");
  };

  // Group wallets by client
  const walletsByClient: Record<string, any[]> = {};
  (wallets || []).forEach((w: any) => {
    if (!walletsByClient[w.client_id]) walletsByClient[w.client_id] = [];
    walletsByClient[w.client_id].push(w);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Financeiro</p>
        {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
              {[{ value: "month" as const, label: "Este Mês" }, { value: "all" as const, label: "Geral" }].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setPeriodFilter(f.value)}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer border-none ${
                    periodFilter === f.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground bg-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {periodFilter === "month" && (
              <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
                <button
                  onClick={() => {
                    const d = new Date(selYear, selMonth - 1, 1);
                    setSelMonth(d.getMonth());
                    setSelYear(d.getFullYear());
                  }}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer border-none bg-transparent"
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] font-medium text-foreground min-w-[110px] text-center tabular-nums">
                  {MONTHS_FULL[selMonth]} {selYear}
                </span>
                <button
                  disabled={isCurrentMonthSelected}
                  onClick={() => {
                    const d = new Date(selYear, selMonth + 1, 1);
                    setSelMonth(d.getMonth());
                    setSelYear(d.getFullYear());
                  }}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer border-none bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                {!isCurrentMonthSelected && (
                  <button
                    onClick={() => { setSelMonth(thisMonth); setSelYear(thisYear); }}
                    className="text-[10px] px-2 py-1 rounded-md text-primary hover:bg-card transition-colors cursor-pointer border-none bg-transparent"
                  >
                    Hoje
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
              {BRAND_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setBrandFilter(f.value)}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer border-none ${
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
        )}
      </div>

      {/* Stats - only admin sees revenue/pending/overdue */}
      {isAdmin && (() => {
        const showMonthly = brandFilter === "all" || brandFilter === "aceleriq";
        const showIndiv = brandFilter === "all" || brandFilter === "sitebolt";
        const pendingVal = (showMonthly ? pendingTotal : 0) + (showIndiv ? indivPending : 0);
        const receivedVal = (showMonthly ? receivedTotal : 0) + (showIndiv ? indivPaid : 0);
        const overdueVal = (showMonthly ? overdueTotal : 0) + (showIndiv ? indivOverdue : 0);
        const subLabel = brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? pendingTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivPending : 0)}` : undefined;
        const recSub = brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? receivedTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivPaid : 0)}` : undefined;
        const ovSub = brandFilter === "all" ? `AcelerIQ ${fmt(showMonthly ? overdueTotal : 0)} · SiteBolt ${fmt(showIndiv ? indivOverdue : 0)}` : undefined;
        const periodLabel = periodFilter === "month" ? `· ${MONTHS_FULL[selMonth]} ${selYear}` : "Geral";

        const nextMonthFull = MONTHS_FULL[nextMonth];
        const nextMonthSub = brandFilter === "all" ? `AcelerIQ ${fmt(nextMonthRecurring)} · SiteBolt ${fmt(nextMonthIndiv)}` : (brandFilter === "aceleriq" ? "Planos recorrentes" : "Parcelas de projetos");

        const receivedBreakdown = brandFilter === "all"
          ? `Planos ${fmt(showMonthly ? receivedTotal : 0)} · Projetos ${fmt(showIndiv ? indivPaid : 0)}`
          : recSub;

        const cards = [
          ...(showMonthly ? [{ label: `Recebido ${periodLabel}`, value: fmt(receivedVal), sub: receivedBreakdown, icon: TrendingUp, color: "text-success" }] : [
            { label: `Recebido ${periodLabel}`, value: fmt(receivedVal), sub: receivedBreakdown, icon: TrendingUp, color: "text-success" },
          ]),

          ...(!showMonthly ? [] : []),
          { label: `A Receber ${periodLabel}`, value: fmt(pendingVal), sub: subLabel, icon: CreditCard, color: "text-warning" },
          { label: `Atrasado`, value: fmt(overdueVal), sub: ovSub, icon: CreditCard, color: "text-destructive" },
          ...(periodFilter === "month" && showMonthly ? [{ label: "Receita Esperada", value: fmt(expectedMonthlyRevenue), sub: "Planos ativos AcelerIQ", icon: CheckCircle2, color: "text-info" }] : []),
        ];
        return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((s: any, i: number) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
              </div>
              <p className="text-lg font-semibold font-mono text-foreground">{s.value}</p>
              {s.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</p>}
            </div>
          ))}
          {/* Projeção card · clickable */}
          <div
            onClick={() => navigate("/financeiro/projecao")}
            className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-info/40 transition-colors group relative"
          >
            <div className="flex items-center gap-2 mb-2">
              <Briefcase className="w-4 h-4 text-info" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Projeção · Próximo Mês</span>
            </div>
            <p className="text-lg font-semibold font-mono text-foreground">{fmt(nextMonthTotal)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{nextMonthFull} {nextYear} · {nextMonthSub}</p>
            <span className="absolute top-3 right-3 text-[10px] text-info opacity-0 group-hover:opacity-100 transition-opacity">
              Ver projeção →
            </span>
          </div>
        </div>
        );
      })()}

      {/* Detalhamento A Receber */}
      {isAdmin && (() => {
        const showMonthly2 = brandFilter === "all" || brandFilter === "aceleriq";
        const showIndiv2 = brandFilter === "all" || brandFilter === "sitebolt";

        const monthlyPendingItems = showMonthly2 ? pendingBillsInActivePeriod.filter((b: any) => b.type !== "ads_recharge").map((b: any) => {
          const client = (clients || []).find((c: any) => c.id === b.client_id);
          const due = parseAppDate(b.due_date);
          return { id: b.id, label: b.description || "Renovação Mensal", client: client?.company_name || client?.full_name || "-", amount: Number(b.amount), due: b.due_date, brand: "AcelerIQ", isOverdue: due ? due < todayStart : false, itemType: "billing" as const, clientId: b.client_id, billingType: b.type };
        }) : [];

        const indivPendingItems = showIndiv2 ? filteredPayments.flatMap((pp: any) =>
          (pp.installments || []).filter((i: any) => i.status === "pending" || i.status === "partial").map((i: any) => ({
            id: i.id, label: `${pp.project?.name || "Projeto"} · ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
            client: pp.client?.company_name || pp.client?.full_name || "-", amount: Number(i.amount) - Number(i.paid_amount || 0), due: i.due_date,
            brand: getProjectBrand(pp.project?.project_type), isOverdue: (() => { const due = parseAppDate(i.due_date); return due ? due < todayStart : false; })(), itemType: "installment" as const, clientId: pp.client_id, paidSoFar: Number(i.paid_amount || 0), totalAmount: Number(i.amount),
          }))
        ) : [];

        const extraItems = showMonthly2 ? clientsWithPlanNotInBilling.map((c: any) => ({
          id: `extra-${c.id}`, label: c.plan_name ? `Renovação · ${c.plan_name}` : "Renovação Mensal",
          client: c.company_name || c.full_name, amount: Number(c.plan_value), due: c.plan_renewal_date || "",
          brand: "AcelerIQ", isOverdue: (() => { const due = parseAppDate(c.plan_renewal_date); return due ? due < todayStart : false; })(), itemType: "extra" as const, clientId: c.id,
        })) : [];

        const allPending = [...monthlyPendingItems, ...indivPendingItems, ...extraItems]
          .sort((a, b) => (parseAppDate(a.due)?.getTime() || 0) - (parseAppDate(b.due)?.getTime() || 0));

        if (allPending.length === 0) return null;
        return (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-warning" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Detalhamento · A Receber ({allPending.length})</span>
            </div>
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {allPending.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${item.isOverdue ? "bg-destructive" : "bg-warning"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground truncate">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground">{item.client}
                      {item.paidSoFar > 0 && <span className="ml-1 text-success">(já pago: {fmt(item.paidSoFar)})</span>}
                    </p>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground whitespace-nowrap">{item.brand}</span>
                  <p className="text-sm font-mono text-foreground whitespace-nowrap">{fmt(item.amount)}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${item.isOverdue ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                    {item.isOverdue ? "Atrasado" : formatAppDate(item.due)}
                  </span>
                  <button
                    onClick={async () => {
                      let realId = item.id;
                      // For "extra" items (plan_value but no billing row), create the billing first
                      if (item.itemType === "extra" && item.clientId) {
                        const { data: newBill, error } = await supabase.from("billing").insert({
                          client_id: item.clientId,
                          type: "renewal",
                          amount: item.amount,
                          due_date: item.due || toLocalDateKey(),
                          description: item.label,
                        }).select().single();
                        if (error || !newBill) { toast.error("Erro ao gerar cobrança"); return; }
                        realId = newBill.id;
                        await queryClient.invalidateQueries({ queryKey: ["billing"] });
                      }
                      setPayModal({
                        id: realId,
                        type: item.itemType === "installment" ? "installment" : "billing",
                        label: item.label,
                        amount: item.itemType === "installment" ? item.totalAmount || item.amount : item.amount,
                        clientId: item.clientId,
                        billingType: item.billingType || "renewal",
                        paidSoFar: item.paidSoFar || 0,
                        totalAmount: item.totalAmount || item.amount,
                      });
                      setPayType("full");
                      setPayPartialAmount("");
                    }}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors whitespace-nowrap font-medium"
                  >
                    💰 Pagar
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}



      {!isAdmin && (
        <div className="grid grid-cols-1 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-info" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Investimento Ads Total</span>
            </div>
            <p className="text-lg font-semibold font-mono text-foreground">{fmt(totalAds)}</p>
          </div>
        </div>
      )}

      {/* Revenue Chart - monthly comparison */}
      {isAdmin && (() => {
        const showMonthlyChart = brandFilter === "all" || brandFilter === "aceleriq";
        const showIndivChart = brandFilter === "all" || brandFilter === "sitebolt";
        const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const chartData: { name: string; recebido: number; pendente: number }[] = [];
        const currentYear = now.getFullYear();
        for (let m = 0; m < 12; m++) {
          let received = 0;
          let pending = 0;

          if (showMonthlyChart) {
            received += (billing || [])
              .filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge")
              .filter((b: any) => { const d = parseAppDate(b.paid_date || b.due_date); return !!d && d.getMonth() === m && d.getFullYear() === currentYear; })
              .reduce((s: number, b: any) => s + receivedOf(b), 0);
            pending += (billing || [])
              .filter((b: any) => b.status === "pending" && b.type !== "ads_recharge")
              .filter((b: any) => { const d = parseAppDate(b.due_date); return !!d && d.getMonth() === m && d.getFullYear() === currentYear; })
              .reduce((s: number, b: any) => s + Number(b.amount), 0);
          }

          if (showIndivChart) {
            filteredPayments.forEach((pp: any) => {
              (pp.installments || []).forEach((inst: any) => {
                const d = parseAppDate(inst.paid_date || inst.due_date);
                if (d && d.getMonth() === m && d.getFullYear() === currentYear) {
                  if (inst.status === "paid") received += Number(inst.amount);
                  else if (inst.status === "partial") received += Number(inst.paid_amount || 0);
                  else if (inst.status === "pending") pending += Number(inst.amount);
                }
              });
            });
          }

          if (received > 0 || pending > 0 || m <= now.getMonth()) {
            chartData.push({ name: MONTHS[m], recebido: received, pendente: pending });
          }
        }
        return chartData.length > 0 ? (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
                Receita {currentYear} {brandFilter !== "all" ? `- ${brandFilter === "aceleriq" ? "AcelerIQ" : "SiteBolt"}` : ""} · Mês a Mês
              </p>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}${v >= 1000 ? 'k' : ''}`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                    formatter={(value: number, name: string) => [fmt(value), name === "recebido" ? "Recebido" : "Pendente"]}
                  />
                  <Legend formatter={(value) => value === "recebido" ? "Recebido" : "Pendente"} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="recebido" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pendente" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null;
      })()}

      {/* Pie Chart: AcelerIQ vs SiteBolt */}
      {isAdmin && (() => {
        const allPayments = projectPayments || [];
        // AcelerIQ received = billing paid (non-ads)
        const aceleriqReceived = paidBills
          .filter((b: any) => b.type !== "ads_recharge")
          .reduce((s: number, b: any) => s + receivedOf(b), 0);
        // SiteBolt received = individual project installments paid
        const siteboltReceived = allPayments
          .filter((pp: any) => ["site", "landing_page", "event", "other"].includes(pp.project?.project_type))
          .reduce((sum: number, pp: any) =>
            sum + (pp.installments || [])
              .filter((i: any) => i.status === "paid" || i.status === "partial")
              .reduce((s: number, i: any) => s + receivedOf(i), 0), 0);
        // Joint (automation) received
        const jointReceived = allPayments
          .filter((pp: any) => pp.project?.project_type === "automation")
          .reduce((sum: number, pp: any) =>
            sum + (pp.installments || [])
              .filter((i: any) => i.status === "paid" || i.status === "partial")
              .reduce((s: number, i: any) => s + receivedOf(i), 0), 0);

        const pieData = [
          { name: "AcelerIQ", value: aceleriqReceived, color: "hsl(var(--success))" },
          { name: "SiteBolt", value: siteboltReceived, color: "hsl(var(--primary))" },
          ...(jointReceived > 0 ? [{ name: "AcelerIQ + SiteBolt", value: jointReceived, color: "hsl(var(--info))" }] : []),
        ].filter(d => d.value > 0);

        const total = pieData.reduce((s, d) => s + d.value, 0);
        if (total === 0) return null;

        return (
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2 mb-4">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              Proporção da Receita · AcelerIQ vs SiteBolt
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="h-[200px] w-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                      formatter={(value: number) => [fmt(value), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <div className="flex-1">
                      <p className="text-[13px] text-foreground font-medium">{d.name}</p>
                      <p className="text-[11px] text-muted-foreground">{Math.round((d.value / total) * 100)}% da receita</p>
                    </div>
                    <p className="text-sm font-mono text-foreground">{fmt(d.value)}</p>
                  </div>
                ))}
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Total</p>
                    <p className="text-sm font-mono font-semibold text-foreground">{fmt(total)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <Tabs defaultValue={isAdmin ? "overview" : "ads"} className="space-y-4">
        <TabsList className="bg-secondary/50 border border-border rounded-lg p-1 flex-wrap h-auto">
          {isAdmin && <TabsTrigger value="overview" className="text-[13px] rounded-md">Visão Geral</TabsTrigger>}
          {(isAdmin || profile?.role === "manager") && <TabsTrigger value="cashflow" className="text-[13px] rounded-md">💰 Fluxo de Caixa</TabsTrigger>}
          {(isAdmin || profile?.role === "manager") && <TabsTrigger value="capital" className="text-[13px] rounded-md">🏦 Capital</TabsTrigger>}
          <TabsTrigger value="ads" className="text-[13px] rounded-md">Ads Wallet</TabsTrigger>
          {isAdmin && <TabsTrigger value="renewals" className="text-[13px] rounded-md">Renovações</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit" className="text-[13px] rounded-md">📋 Histórico</TabsTrigger>}
        </TabsList>

        {(isAdmin || profile?.role === "manager") && (
          <TabsContent value="cashflow" className="space-y-6">
            <CashFlow billing={billing || []} projectPayments={projectPayments || []} />
          </TabsContent>
        )}

        {(isAdmin || profile?.role === "manager") && (
          <TabsContent value="capital" className="space-y-6">
            <InvestorCapital billing={billing || []} projectPayments={projectPayments || []} />
          </TabsContent>
        )}

        {/* Tab: Overview */}
        <TabsContent value="overview" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-muted-foreground">Controle Financeiro</span>
            <div className="flex gap-2">
              <button onClick={() => handleSyncBilling()} disabled={syncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border">
                <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} /> Sincronizar
              </button>
              <button onClick={() => setNewBillingOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
                <Plus className="w-3 h-3" /> Nova Cobrança
              </button>
            </div>
          </div>

          {/* Pendentes a Receber */}
          {pendingBillsInActivePeriod.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Pendentes a Receber ({pendingBillsInActivePeriod.length})
                </span>
                <span className="text-xs font-mono text-warning ml-auto">{fmt(pendingBillsInActivePeriod.reduce((s: number, b: any) => s + Number(b.amount || 0), 0))}</span>
              </div>
              {pendingBillsInActivePeriod.map((b: any) => {
                const due = parseAppDate(b.due_date);
                const isOverdue = due ? due < todayStart : false;
                return (
                  <div key={b.id} className={`bg-card border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap ${isOverdue ? "border-destructive/30" : "border-border"}`}>
                    <span className="text-lg">{typeIcon(b.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{b.description || (b.type === "renewal" ? "Renovação Mensal" : b.type === "ads_recharge" ? "Recarga Ads" : "Serviço Extra")}</p>
                      <p className="text-xs text-muted-foreground">{b.client?.company_name || b.client?.full_name} • Vence {formatAppDate(b.due_date)}</p>
                    </div>
                    <p className="text-sm font-mono font-medium text-foreground">{fmt(Number(b.amount))}</p>
                    {statusBadge(b.status, b.due_date)}
                    <div className="flex gap-1.5">
                      <button onClick={() => handleMarkPaid(b.id)}
                        className="text-[11px] px-3 py-1 rounded-full bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none">
                        Marcar como Pago
                      </button>
                      <button onClick={() => openWhatsAppReminder(b.client, b)}
                        className="text-[11px] px-2 py-1 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-none">
                        <MessageCircle className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Já Recebido · histórico unificado (planos + projetos) */}
          {(() => {
            const showMonthlyR = brandFilter === "all" || brandFilter === "aceleriq";
            const showIndivR = brandFilter === "all" || brandFilter === "sitebolt";

            // 1) Recebimentos de planos/serviços (billing)
            const billingItems = showMonthlyR
              ? paidBills
                  .filter((b: any) => b.type !== "ads_recharge")
                  .map((b: any) => ({
                    id: `bill-${b.id}`,
                    label: b.description || (b.type === "renewal" ? "Renovação Mensal" : "Serviço Extra"),
                    client: b.client?.company_name || b.client?.full_name || "-",
                    brand: "AcelerIQ",
                    amount: receivedOf(b),
                    totalAmount: Number(b.amount) || 0,
                    isPartial: b.status === "partial" || (Number(b.paid_amount) > 0 && Number(b.paid_amount) < Number(b.amount)),
                    date: b.paid_date || b.due_date,
                    icon: typeIcon(b.type),
                  }))
              : [];

            // 2) Recebimentos de projetos individuais (parcelas pagas)
            const installmentItems = showIndivR
              ? filteredPayments.flatMap((pp: any) =>
                  (pp.installments || [])
                    .filter((i: any) => i.status === "paid" || i.status === "partial")
                    .map((i: any) => ({
                      id: `inst-${i.id}`,
                      label: `${pp.project?.name || "Projeto"} · Parcela ${i.installment_number}${i.status === "partial" ? " (parcial)" : ""}`,
                      client: pp.client?.company_name || pp.client?.full_name || "-",
                      brand: getProjectBrand(pp.project?.project_type),
                      amount: receivedOf(i),
                      totalAmount: Number(i.amount) || 0,
                      isPartial: i.status === "partial" || (Number(i.paid_amount) > 0 && Number(i.paid_amount) < Number(i.amount)),
                      date: i.paid_date || i.due_date,
                      icon: "💼",
                    }))
                )
              : [];

            const allReceived = [...billingItems, ...installmentItems].sort(
              (a, b) => (parseAppDate(b.date)?.getTime() || 0) - (parseAppDate(a.date)?.getTime() || 0)
            );

            const filtered = allReceived.filter((it) => {
              const d = parseAppDate(it.date);
              if (!d) return false;
              if (receivedFilter === "month") return d.getMonth() === selMonth && d.getFullYear() === selYear;
              if (receivedFilter === "last3") { const lim = new Date(); lim.setMonth(lim.getMonth() - 3); return d >= lim; }
              if (receivedFilter === "year") return d.getFullYear() === selYear;
              return true;
            });
            const filteredTotal = filtered.reduce((s, it) => s + it.amount, 0);
            const grandTotal = allReceived.reduce((s, it) => s + it.amount, 0);

            return (
              <div className="space-y-2">
                <button
                  onClick={() => setReceivedCollapsed(v => !v)}
                  className="w-full flex items-center gap-2 flex-wrap bg-transparent border-none cursor-pointer p-0 text-left"
                >
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                    Histórico · Já Recebido ({allReceived.length})
                  </span>
                  <span className="text-xs font-mono text-success ml-auto">{fmt(grandTotal)}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{receivedCollapsed ? "▸ expandir" : "▾ recolher"}</span>
                </button>
                {!receivedCollapsed && (
                  <>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        { value: "all", label: "Todos" },
                        { value: "month", label: `${MONTHS_SHORT[selMonth]}/${selYear}` },
                        { value: "last3", label: "Últimos 3 meses" },
                        { value: "year", label: `Ano ${selYear}` },
                      ].map((f) => (
                        <button key={f.value} onClick={() => setReceivedFilter(f.value)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${receivedFilter === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground"}`}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {receivedFilter === "all" ? "Total recebido" : "Filtrado"}: <span className="font-mono text-success">{fmt(filteredTotal)}</span> ({filtered.length} {filtered.length === 1 ? "pagamento" : "pagamentos"})
                    </p>
                    {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhum pagamento neste período.</p>}
                    {filtered.map((it) => (
                      <div key={it.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                        <span className="text-lg">{it.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{it.label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {it.client}
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{it.brand}</span>
                            {" • "}Pago em {formatAppDate(it.date)}
                            {it.isPartial && <> • recebido {fmt(it.amount)} de {fmt(it.totalAmount)}</>}
                          </p>
                        </div>
                        <p className="text-sm font-mono font-medium text-success">{fmt(it.amount)}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })()}


          {/* Projetos Individuais (SiteBolt / Avulsos) */}
          {filteredPayments.length > 0 && (() => {
            const enriched = filteredPayments.map((pp: any) => {
              const paid = (pp.installments || [])
                .filter((i: any) => i.status === "paid" || i.status === "partial")
                .reduce((s: number, i: any) => s + receivedOf(i), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const hasOverdue = (pp.installments || []).some((i: any) => {
                const due = parseAppDate(i.due_date);
                return i.status === "pending" && !!due && due < todayStart;
              });
              const remaining = Number(pp.total_value) - paid;
              const group = remaining <= 0.01 ? "quitado" : hasOverdue ? "atrasado" : "andamento";
              return { ...pp, _paid: paid, _pct: pct, _remaining: remaining, _hasOverdue: hasOverdue, _group: group };
            });
            const quitados = enriched.filter((p: any) => p._group === "quitado");
            const andamento = enriched.filter((p: any) => p._group === "andamento");
            const atrasados = enriched.filter((p: any) => p._group === "atrasado");

            const renderItem = (pp: any) => (
              <div key={pp.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{pp.project?.name || "Projeto"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {pp.client?.company_name || pp.client?.full_name}
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{getProjectBrand(pp.project?.project_type)}</span>
                  </p>
                </div>
                <div className="w-20 hidden sm:block">
                  <Progress value={pp._pct} className="h-1.5" />
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5 text-right">{pp._pct}%</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-success">{fmt(pp._paid)}</p>
                  <p className="text-[10px] text-muted-foreground">de {fmt(Number(pp.total_value))}</p>
                </div>
                {pp._remaining > 0.01 && (
                  <div className="text-right hidden md:block">
                    <p className="text-xs font-mono text-warning">{fmt(pp._remaining)}</p>
                    <p className="text-[10px] text-muted-foreground">falta</p>
                  </div>
                )}
                {pp._hasOverdue && <AlertTriangleIcon className="w-3.5 h-3.5 text-destructive shrink-0" />}
              </div>
            );

            return (
              <div className="space-y-3">
                <button
                  onClick={() => setIndivCollapsed(v => !v)}
                  className="w-full flex items-center gap-2 flex-wrap bg-transparent border-none cursor-pointer p-0 text-left"
                >
                  <Briefcase className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                    Projetos Individuais ({enriched.length})
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-2">
                    <span className="text-success">●{quitados.length} quitados</span>
                    {andamento.length > 0 && <span className="text-warning">●{andamento.length} em andamento</span>}
                    {atrasados.length > 0 && <span className="text-destructive">●{atrasados.length} atrasados</span>}
                    <span className="text-muted-foreground">{indivCollapsed ? "▸" : "▾"}</span>
                  </span>
                </button>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: "Total Contratado", value: fmt(indivTotal), color: "text-primary" },
                    { label: "Recebido", value: fmt(indivPaid), color: "text-success" },
                    { label: "Pendente", value: fmt(indivPending), color: "text-warning" },
                    { label: "Atrasado", value: fmt(indivOverdue), color: "text-destructive" },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                      <p className={`text-sm font-mono font-medium mt-1 ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {!indivCollapsed && (
                  <div className="space-y-4">
                    {atrasados.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-destructive font-medium">Atrasados ({atrasados.length})</p>
                        {atrasados.map(renderItem)}
                      </div>
                    )}
                    {andamento.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-warning font-medium">Em andamento ({andamento.length})</p>
                        {andamento.map(renderItem)}
                      </div>
                    )}
                    {quitados.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-success font-medium">Quitados ({quitados.length})</p>
                        {quitados.map(renderItem)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}


          {(!billing || billing.length === 0) && pendingBills.length === 0 && paidBills.length === 0 && (projectPayments || []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma transação encontrada. Clique em "Sincronizar" para gerar cobranças dos clientes.</p>
          )}
        </TabsContent>

        {/* Tab: Ads Wallet */}
        <TabsContent value="ads" className="space-y-4">
          {/* Total Geral Ads */}
          {isAdmin && Object.entries(walletsByClient).length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-info" />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Geral Ads Wallet</span>
              </div>
              <p className="text-2xl font-mono font-light text-foreground">{fmt(totalAds)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{Object.entries(walletsByClient).length} clientes • {(wallets || []).length} carteiras</p>
            </div>
          )}

          {/* Add wallet button */}
          <div className="flex justify-end">
            <button onClick={() => setAddWalletModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer border-none">
              <Plus className="w-4 h-4" /> Adicionar Wallet
            </button>
          </div>

          {Object.entries(walletsByClient).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum wallet de anúncios cadastrado. Clique em "Adicionar Wallet" para começar.</p>}
          {Object.entries(walletsByClient).map(([clientId, clientWallets]) => {
            const clientTotal = clientWallets.reduce((s: number, w: any) => s + Number(w.balance), 0);
            const clientRecharges = (recharges || []).filter((r: any) => r.client_id === clientId && r.status === "completed");
            const totalInvested = clientRecharges.reduce((s: number, r: any) => s + Number(r.amount), 0);
            return (
            <div key={clientId} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{clientWallets[0]?.client?.company_name || clientWallets[0]?.client?.full_name}</p>
                <span className="text-xs font-mono text-info">{fmt(clientTotal)}</span>
              </div>
              <div className="space-y-2">
                {clientWallets.map((w: any) => (
                  <div key={w.id} className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground w-24 capitalize">{w.platform} Ads</span>
                    <p className={`text-sm font-mono font-medium flex-1 ${Number(w.balance) < 100 ? "text-warning" : "text-foreground"}`}>{fmt(Number(w.balance))}</p>
                    <button onClick={() => setRechargeModal({ clientId, platform: w.platform })}
                      className="text-[11px] px-3 py-1 rounded-full bg-info/10 text-info hover:bg-info/20 transition-colors cursor-pointer border-none flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" /> Solicitar Recarga
                    </button>
                  </div>
                ))}
              </div>
              {totalInvested > 0 && (
                <p className="text-[11px] text-muted-foreground">💰 Total já investido: <span className="font-mono text-foreground">{fmt(totalInvested)}</span> ({clientRecharges.length} recargas)</p>
              )}
              {clientWallets[0]?.last_recharge_date && (
                <p className="text-[11px] text-muted-foreground">Última recarga: {new Date(clientWallets[0].last_recharge_date).toLocaleDateString("pt-BR")}</p>
              )}
            </div>
            );
          })}

          {/* Recharge requests */}
          {(recharges || []).length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Solicitações de Recarga</p>
              {(recharges || []).map((r: any) => (
                <div key={r.id} className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
                  <Zap className="w-4 h-4 text-warning" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{fmt(Number(r.amount))} · {r.platform}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                    <p className="text-[11px] text-muted-foreground">Por {r.requester?.full_name} • {new Date(r.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  {statusBadge(r.status)}
                  {r.status === "approved" && (
                    <button onClick={() => handleCompleteRecharge(r)}
                      className="text-[11px] px-3 py-1 rounded-full bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Concluir Recarga
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab: Renewals & Avulsos */}
        <TabsContent value="renewals" className="space-y-4">
          {/* Sub-toggle */}
          <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5 w-fit">
            {[
              { value: "mensalistas" as const, label: "Mensalistas" },
              { value: "avulsos" as const, label: "Avulsos / Histórico" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setRenewalsView(f.value)}
                className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer border-none ${
                  renewalsView === f.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground bg-transparent"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {renewalsView === "mensalistas" && (() => {
            const mensalistas = (clients || []).filter((c: any) => c.plan_value && Number(c.plan_value) > 0);
            if (mensalistas.length === 0) {
              return <p className="text-sm text-muted-foreground text-center py-8">Nenhum cliente mensalista. Edite um cliente e adicione o valor do plano para marcá-lo como mensalista.</p>;
            }
            // Group by plan_name
            const groups: Record<string, any[]> = {};
            mensalistas.forEach((c: any) => {
              const key = c.plan_name || "Sem plano definido";
              if (!groups[key]) groups[key] = [];
              groups[key].push(c);
            });
            const planNames = Object.keys(groups).sort();

            return (
              <div className="space-y-5">
                {/* Summary */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: "Mensalistas", value: String(mensalistas.length), color: "text-foreground" },
                    { label: "Planos distintos", value: String(planNames.length), color: "text-primary" },
                    { label: "MRR Esperado", value: fmt(mensalistas.reduce((s: number, c: any) => s + Number(c.plan_value || 0), 0)), color: "text-success" },
                    { label: "Renovações ≤15 dias", value: String(mensalistas.filter((c: any) => {
                      const renewal = parseAppDate(c.plan_renewal_date);
                      if (!renewal) return false;
                      const d = Math.ceil((renewal.getTime() - todayStart.getTime()) / 86400000);
                      return d >= 0 && d <= 15;
                    }).length), color: "text-warning" },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                      <p className={`text-base font-mono font-medium mt-1 ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {planNames.map((planName) => {
                  const planClients = groups[planName];
                  const planMRR = planClients.reduce((s: number, c: any) => s + Number(c.plan_value || 0), 0);
                  return (
                    <div key={planName} className="space-y-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[11px] uppercase tracking-wider text-primary font-medium">{planName}</span>
                        <span className="text-[10px] text-muted-foreground">({planClients.length} {planClients.length === 1 ? "cliente" : "clientes"})</span>
                        <span className="text-[10px] font-mono text-success ml-auto">{fmt(planMRR)}/mês</span>
                      </div>
                      {planClients.map((c: any) => {
                        const renewalDate = parseAppDate(c.plan_renewal_date);
                        const daysLeft = renewalDate ? Math.ceil((renewalDate.getTime() - todayStart.getTime()) / 86400000) : null;
                        const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";
                        const clientBilling = (billing || []).find((b: any) => b.client_id === c.id && b.type === "renewal");
                        const reminderCount = clientBilling?.reminder_count || 0;
                        return (
                          <div key={c.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                              {planStatus === "active" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">🟢 Ativo</span>}
                              {planStatus === "soon" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">🟡 Renovação em breve</span>}
                              {planStatus === "overdue" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">🔴 Pendente</span>}
                              {planStatus === "unknown" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Sem data</span>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {fmt(Number(c.plan_value))}/mês
                              {renewalDate && <> • Renova {formatAppDate(c.plan_renewal_date)}{daysLeft !== null && daysLeft >= 0 && ` (${daysLeft} dias)`}</>}
                            </p>
                            <div className="flex gap-2 pt-1 flex-wrap">
                              <button onClick={() => handleSendReminder(c, "notification")}
                                className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                                <Bell className="w-3 h-3" /> {reminderCount > 0 ? `Lembrete (${reminderCount}x)` : "Notificar"}
                              </button>
                              <button onClick={() => handleSendReminder(c, "whatsapp")}
                                className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                                <MessageCircle className="w-3 h-3" /> WhatsApp
                              </button>
                              <button onClick={() => { setEditPlanModal(c); setPlanForm({ amount: clientBilling ? String(clientBilling.amount) : String(c.plan_value || ""), renewal_date: c.plan_renewal_date || "", description: clientBilling?.description || c.plan_name || "" }); }}
                                className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                                <Edit3 className="w-3 h-3" /> Editar Plano
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {renewalsView === "avulsos" && (() => {
            // Avulsos = clientes one_off OU sem plan_value que tenham QUALQUER lançamento
            // (project_payments ou billing avulso). Antes só considerávamos project_payments,
            // o que escondia recebimentos como o de Itamar (lançado via billing).
            const isAvulsoClient = (c: any) =>
              !!c && (c.client_type === "one_off" || !c.plan_value || Number(c.plan_value) === 0);

            const billingByClient = new Map<string, any[]>();
            (billing || []).forEach((b: any) => {
              if (!b.client_id) return;
              const c = (clients || []).find((cl: any) => cl.id === b.client_id);
              if (!isAvulsoClient(c)) return;
              const arr = billingByClient.get(b.client_id) || [];
              arr.push(b);
              billingByClient.set(b.client_id, arr);
            });
            const paymentsByClient = new Map<string, any[]>();
            (projectPayments || []).forEach((pp: any) => {
              if (!pp.client_id) return;
              const c = (clients || []).find((cl: any) => cl.id === pp.client_id);
              if (!isAvulsoClient(c)) return;
              const arr = paymentsByClient.get(pp.client_id) || [];
              arr.push(pp);
              paymentsByClient.set(pp.client_id, arr);
            });

            const avulsoClientIds = new Set<string>([
              ...billingByClient.keys(),
              ...paymentsByClient.keys(),
            ]);
            const avulsoClients = (clients || []).filter((c: any) => avulsoClientIds.has(c.id));

            if (avulsoClients.length === 0) {
              return <p className="text-sm text-muted-foreground text-center py-8">Nenhum cliente avulso com histórico.</p>;
            }

            const sumBillingPaid = (rows: any[]) =>
              (rows || []).filter((b: any) => b.status === "paid" || b.status === "partial")
                .reduce((s: number, b: any) => s + receivedOf(b), 0);
            const sumBillingOpen = (rows: any[]) =>
              (rows || []).filter((b: any) => b.status === "pending" || b.status === "partial")
                .reduce((s: number, b: any) => s + Math.max(Number(b.amount) - Number(b.paid_amount || 0), 0), 0);
            const sumInstallmentsPaid = (pps: any[]) =>
              (pps || []).reduce((s: number, pp: any) => s + (pp.installments || [])
                .filter((i: any) => i.status === "paid" || i.status === "partial")
                .reduce((x: number, i: any) => x + receivedOf(i), 0), 0);
            const sumInstallmentsOpen = (pps: any[]) =>
              (pps || []).reduce((s: number, pp: any) => s + (pp.installments || [])
                .filter((i: any) => i.status === "pending" || i.status === "partial")
                .reduce((x: number, i: any) => x + Math.max(Number(i.amount) - Number(i.paid_amount || 0), 0), 0), 0);

            const totalRecebido = avulsoClients.reduce((s, c) =>
              s + sumBillingPaid(billingByClient.get(c.id) || []) + sumInstallmentsPaid(paymentsByClient.get(c.id) || []), 0);
            const totalAberto = avulsoClients.reduce((s, c) =>
              s + sumBillingOpen(billingByClient.get(c.id) || []) + sumInstallmentsOpen(paymentsByClient.get(c.id) || []), 0);

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: "Clientes Avulsos", value: String(avulsoClients.length), color: "text-foreground" },
                    { label: "Total Recebido", value: fmt(totalRecebido), color: "text-success" },
                    { label: "Em aberto", value: fmt(totalAberto), color: "text-warning" },
                  ].map((s) => (
                    <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                      <p className={`text-base font-mono font-medium mt-1 ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {avulsoClients.map((c: any) => {
                  const clientProjects = paymentsByClient.get(c.id) || [];
                  const clientBills = billingByClient.get(c.id) || [];
                  const totalFaturado =
                    clientProjects.reduce((s: number, pp: any) => s + Number(pp.total_value), 0) +
                    clientBills.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
                  const totalPago = sumInstallmentsPaid(clientProjects) + sumBillingPaid(clientBills);
                  const aberto = Math.max(totalFaturado - totalPago, 0);
                  const lineCount = clientProjects.length + clientBills.length;
                  return (
                    <div key={c.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                          {lineCount} {lineCount === 1 ? "lançamento" : "lançamentos"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs flex-wrap">
                        <span className="text-muted-foreground">Faturado: <span className="font-mono text-foreground">{fmt(totalFaturado)}</span></span>
                        <span className="text-muted-foreground">Pago: <span className="font-mono text-success">{fmt(totalPago)}</span></span>
                        {aberto > 0.01 && <span className="text-muted-foreground">Aberto: <span className="font-mono text-warning">{fmt(aberto)}</span></span>}
                      </div>
                      <div className="space-y-1 pt-1">
                        {clientProjects.map((pp: any) => {
                          const paid = sumInstallmentsPaid([pp]);
                          const total = Number(pp.total_value) || 0;
                          const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                          const isPartial = paid > 0 && paid < total;
                          const isFull = paid >= total && total > 0;
                          return (
                            <div key={pp.id} className="flex items-center gap-3 text-xs text-muted-foreground px-2 py-1.5 rounded bg-secondary/30">
                              <span className="flex-1 truncate">📦 {pp.project?.name || "Projeto"}</span>
                              <span className={`text-[10px] font-mono ${isFull ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground"}`}>{pct}%</span>
                              <span className="font-mono">
                                <span className={isFull ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground"}>{fmt(paid)}</span>
                                {!isFull && <span className="text-muted-foreground"> / {fmt(total)}</span>}
                              </span>
                            </div>
                          );
                        })}
                        {clientBills.map((b: any) => {
                          const paid = sumBillingPaid([b]);
                          const total = Number(b.amount) || 0;
                          const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
                          const isPartial = b.status === "partial";
                          const isPaid = b.status === "paid" && paid >= total;
                          return (
                            <div key={b.id} className="flex items-center gap-3 text-xs text-muted-foreground px-2 py-1.5 rounded bg-secondary/30">
                              <span className="flex-1 truncate">💸 {b.description || "Cobrança avulsa"}</span>
                              <span className={`text-[10px] font-mono ${isPaid ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground"}`}>{pct}%</span>
                              <span className="font-mono">
                                <span className={isPaid ? "text-success" : isPartial ? "text-warning" : "text-muted-foreground"}>{fmt(paid)}</span>
                                {!isPaid && <span className="text-muted-foreground"> / {fmt(total)}</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </TabsContent>



        {/* Audit Log Tab */}
        {isAdmin && (
          <TabsContent value="audit" className="space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-info" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Histórico de Alterações · Últimos 50 registros</span>
              </div>
              {(auditLogs || []).length === 0 ? (
                <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                  Nenhuma alteração registrada ainda.
                </div>
              ) : (
                <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                  {(auditLogs || []).map((log: any) => {
                    const actionLabels: Record<string, { label: string; color: string }> = {
                      paid_full: { label: "Pago Total", color: "text-success bg-success/10" },
                      paid_partial: { label: "Pago Parcial", color: "text-warning bg-warning/10" },
                      status_change: { label: "Status Alterado", color: "text-info bg-info/10" },
                      amount_change: { label: "Valor Alterado", color: "text-primary bg-primary/10" },
                    };
                    const actionInfo = actionLabels[log.action] || { label: log.action, color: "text-muted-foreground bg-secondary" };
                    const typeLabel = log.entity_type === "billing" ? "Fatura" : "Parcela";

                    return (
                      <div key={log.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${actionInfo.color}`}>
                              {actionInfo.label}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{typeLabel}</span>
                          </div>
                          {log.notes && <p className="text-[12px] text-foreground mt-1 truncate">{log.notes}</p>}
                          <div className="flex items-center gap-3 mt-1">
                            {log.old_amount != null && log.new_amount != null && log.old_amount !== log.new_amount && (
                              <span className="text-[11px] text-muted-foreground">
                                {fmt(log.old_amount)} → {fmt(log.new_amount)}
                              </span>
                            )}
                            {log.new_amount != null && log.old_amount === log.new_amount && (
                              <span className="text-[11px] text-muted-foreground font-mono">{fmt(log.new_amount)}</span>
                            )}
                            {log.old_status && log.new_status && log.old_status !== log.new_status && (
                              <span className="text-[11px] text-muted-foreground">{log.old_status} → {log.new_status}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(log.created_at).toLocaleDateString("pt-BR")}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60">
                            {new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                          {log.performerName && (
                            <p className="text-[10px] text-primary mt-0.5">{log.performerName}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* New Billing Modal */}
      <Dialog open={newBillingOpen} onOpenChange={setNewBillingOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Cobrança</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Cliente</label>
              <select value={billForm.client_id} onChange={e => setBillForm(f => ({ ...f, client_id: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="">Selecionar...</option>
                {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <select value={billForm.type} onChange={e => setBillForm(f => ({ ...f, type: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="renewal">Renovação</option>
                <option value="ads_recharge">Recarga Ads</option>
                <option value="extra_service">Serviço Extra</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor (R$)</label>
              <Input type="number" value={billForm.amount} onChange={e => setBillForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Vencimento</label>
              <Input type="date" value={billForm.due_date} onChange={e => setBillForm(f => ({ ...f, due_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Descrição</label>
              <textarea value={billForm.description} onChange={e => setBillForm(f => ({ ...f, description: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none" rows={2} />
            </div>
            <button onClick={handleCreateBilling}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
              Criar Cobrança
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recharge Modal · Preset Values */}
      <Dialog open={!!rechargeModal} onOpenChange={() => setRechargeModal(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Solicitar Recarga · {rechargeModal?.platform}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Escolha o valor semanal de investimento para o cliente:</p>
            
            {/* Preset amount buttons */}
            <div className="grid grid-cols-3 gap-2">
              {[250, 500, 1000].map((val) => (
                <button
                  key={val}
                  onClick={() => setRechargeForm(f => ({ ...f, amount: String(val) }))}
                  className={`flex flex-col items-center gap-1 py-4 px-3 rounded-xl border-2 transition-all cursor-pointer ${
                    rechargeForm.amount === String(val)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/30 text-foreground hover:border-muted-foreground"
                  }`}
                >
                  <span className="text-lg font-mono font-semibold">{fmt(val)}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">/semana</span>
                </button>
              ))}
            </div>

            {/* Custom amount option */}
            <div className="relative">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">Ou valor personalizado</label>
              <Input
                type="number"
                value={![250, 500, 1000].includes(Number(rechargeForm.amount)) ? rechargeForm.amount : ""}
                onChange={e => setRechargeForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="Outro valor..."
                className="mt-1"
                onFocus={() => {
                  if ([250, 500, 1000].includes(Number(rechargeForm.amount))) {
                    setRechargeForm(f => ({ ...f, amount: "" }));
                  }
                }}
              />
            </div>

            {/* Period selector */}
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">Período</label>
              <div className="flex gap-2 mt-1">
                {["semanal", "mensal"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setRechargeForm(f => ({ ...f, period: p }))}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                      rechargeForm.period === p
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p === "semanal" ? "📅 Semanal" : "📆 Mensal"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">Observação (opcional)</label>
              <textarea value={rechargeForm.reason} onChange={e => setRechargeForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none" rows={2} placeholder="Ex: Manter campanha X ativa..." />
            </div>

            {/* Summary */}
            {rechargeForm.amount && (
              <div className="bg-secondary/50 border border-border rounded-xl p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Resumo da solicitação</p>
                <p className="text-sm text-foreground">
                  <span className="font-mono font-semibold text-primary">{fmt(Number(rechargeForm.amount))}</span>
                  <span className="text-muted-foreground"> / {rechargeForm.period}</span>
                  <span className="text-muted-foreground"> · {rechargeModal?.platform} Ads</span>
                </p>
                {rechargeForm.period === "mensal" && (
                  <p className="text-[11px] text-muted-foreground mt-1">≈ {fmt(Number(rechargeForm.amount) / 4)}/semana</p>
                )}
              </div>
            )}

            <button
              onClick={handleRequestRecharge}
              disabled={!rechargeForm.amount || Number(rechargeForm.amount) <= 0}
              className="w-full py-3 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Bell className="w-4 h-4" /> Enviar Solicitação ao Cliente
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Wallet Modal */}
      <Dialog open={addWalletModal} onOpenChange={setAddWalletModal}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Adicionar Wallet de Anúncios</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Cliente</label>
              <select value={addWalletForm.client_id} onChange={e => setAddWalletForm(f => ({ ...f, client_id: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="">Selecionar...</option>
                {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Plataforma</label>
              <select value={addWalletForm.platform} onChange={e => setAddWalletForm(f => ({ ...f, platform: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
                <option value="tiktok">TikTok Ads</option>
                <option value="linkedin">LinkedIn Ads</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Saldo Inicial (R$)</label>
              <Input type="number" value={addWalletForm.balance} onChange={e => setAddWalletForm(f => ({ ...f, balance: e.target.value }))} className="mt-1" placeholder="0" />
            </div>
            <button
              onClick={async () => {
                if (!addWalletForm.client_id) { toast.error("Selecione um cliente"); return; }
                const existing = (wallets || []).find((w: any) => w.client_id === addWalletForm.client_id && w.platform === addWalletForm.platform);
                if (existing) { toast.error("Este cliente já possui wallet para esta plataforma"); return; }
                await supabase.from("ads_wallet").insert({
                  client_id: addWalletForm.client_id,
                  platform: addWalletForm.platform,
                  balance: Number(addWalletForm.balance) || 0,
                });
                queryClient.invalidateQueries({ queryKey: ["ads-wallet"] });
                toast.success("Wallet criado com sucesso!");
                setAddWalletModal(false);
                setAddWalletForm({ client_id: "", platform: "meta", balance: "0" });
              }}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
            >
              Criar Wallet
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Plan Modal */}
      <Dialog open={!!editPlanModal} onOpenChange={() => setEditPlanModal(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Editar Plano · {editPlanModal?.company_name || editPlanModal?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Valor Mensal (R$)</label>
              <Input type="number" value={planForm.amount} onChange={e => setPlanForm(f => ({ ...f, amount: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Data de Renovação</label>
              <Input type="date" value={planForm.renewal_date} onChange={e => setPlanForm(f => ({ ...f, renewal_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Descrição do Plano</label>
              <textarea value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none" rows={2} />
            </div>
            <button onClick={handleEditPlan}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
              Salvar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pay Modal */}
      <Dialog open={!!payModal} onOpenChange={() => setPayModal(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Registrar Pagamento</DialogTitle></DialogHeader>
          {payModal && (
            <div className="space-y-4">
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-[13px] text-foreground font-medium">{payModal.label}</p>
                <p className="text-sm font-mono text-foreground mt-1">Valor: {fmt(payModal.amount)}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setPayType("full")}
                  className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors cursor-pointer border ${
                    payType === "full" ? "bg-success/15 border-success/30 text-success" : "bg-secondary border-border text-muted-foreground"
                  }`}
                >
                  ✅ Pago Total
                </button>
                <button
                  onClick={() => setPayType("partial")}
                  className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors cursor-pointer border ${
                    payType === "partial" ? "bg-warning/15 border-warning/30 text-warning" : "bg-secondary border-border text-muted-foreground"
                  }`}
                >
                  💳 Pagou Parte
                </button>
              </div>

              {payType === "partial" && (
                <div>
                  <label className="text-xs text-muted-foreground">Valor pago (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={payPartialAmount}
                    onChange={e => setPayPartialAmount(e.target.value)}
                    className="mt-1"
                    placeholder={`Máx: ${payModal.amount.toFixed(2)}`}
                  />
                  {payPartialAmount && parseFloat(payPartialAmount) > 0 && parseFloat(payPartialAmount) < payModal.amount && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Restante: {fmt(payModal.amount - parseFloat(payPartialAmount))}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handlePayFromPanel}
                disabled={payType === "partial" && (!payPartialAmount || parseFloat(payPartialAmount) <= 0)}
                className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-success text-success-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {payType === "full" ? `Confirmar · ${fmt(payModal.amount)}` : `Confirmar · ${fmt(parseFloat(payPartialAmount) || 0)}`}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
