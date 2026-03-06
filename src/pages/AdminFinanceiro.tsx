import { useState, useEffect, useRef } from "react";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useQuery } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyUser } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { DollarSign, TrendingUp, Users, CreditCard, Plus, RefreshCw, Bell, Edit3, Zap, CheckCircle2, MessageCircle, Briefcase, AlertTriangle as AlertTriangleIcon } from "lucide-react";
import { getProjectBrand, BrandFilter, BRAND_FILTERS, matchesBrandFilter } from "@/lib/brandHelpers";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const statusBadge = (status: string, dueDate?: string) => {
  const isOverdue = dueDate && new Date(dueDate) < new Date() && status === "pending";
  if (status === "paid") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">✅ Pago</span>;
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
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type), client:profiles!project_payments_client_id_fkey(full_name, company_name), installments:payment_installments(*)");
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });

  const [newBillingOpen, setNewBillingOpen] = useState(false);
  const [rechargeModal, setRechargeModal] = useState<{ clientId: string; platform: string } | null>(null);
  const [editPlanModal, setEditPlanModal] = useState<any>(null);
  const [receivedFilter, setReceivedFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<"month" | "all">("month");

  const [billForm, setBillForm] = useState({ client_id: "", type: "renewal", amount: "", due_date: "", description: "" });
  const [rechargeForm, setRechargeForm] = useState({ amount: "", reason: "" });
  const [planForm, setPlanForm] = useState({ amount: "", renewal_date: "", description: "" });
  const [syncing, setSyncing] = useState(false);
  const autoSyncDone = useRef(false);

  const now = new Date();
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
          description: c.plan_name ? `Renovação — ${c.plan_name}` : "Renovação Mensal",
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

  // Computed totals — combine billing + client plan data for accurate stats
  const isThisMonth = (d: string) => {
    const date = new Date(d);
    return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
  };

  const pendingBills = (billing || []).filter((b: any) => b.status === "pending");
  const paidBills = (billing || []).filter((b: any) => b.status === "paid");
  const overdueBills = pendingBills.filter((b: any) => new Date(b.due_date) < now);

  // "A Receber" — from billing pending + active clients with plan_value not yet in billing
  const clientsWithPlanNotInBilling = (clients || []).filter((c: any) =>
    c.plan_value && c.plan_status === "active" &&
    !pendingBills.some((b: any) => b.client_id === c.id && b.type === "renewal") &&
    // Exclude clients already paid this month (no double counting)
    !(billing || []).some((b: any) => b.client_id === c.id && b.type === "renewal" && b.status === "paid" && isThisMonth(b.paid_date || b.due_date))
  );
  const extraPending = clientsWithPlanNotInBilling.reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Period-aware filtering
  const monthPendingBills = pendingBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.due_date));
  const monthPaidBills = paidBills.filter((b: any) => b.type !== "ads_recharge" && isThisMonth(b.paid_date || b.due_date));

  const monthlyRevenue = monthPaidBills.reduce((s: number, b: any) => s + Number(b.amount), 0);

  const pendingTotal = periodFilter === "month"
    ? monthPendingBills.reduce((s: number, b: any) => s + Number(b.amount), 0)
    : pendingBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + Number(b.amount), 0) + extraPending;

  const overdueTotal = periodFilter === "month"
    ? monthPendingBills.filter((b: any) => new Date(b.due_date) < now).reduce((s: number, b: any) => s + Number(b.amount), 0)
    : overdueBills.reduce((s: number, b: any) => s + Number(b.amount), 0);

  const receivedTotal = periodFilter === "month"
    ? monthlyRevenue
    : paidBills.filter((b: any) => b.type !== "ads_recharge").reduce((s: number, b: any) => s + Number(b.amount), 0);

  // Receita Mensal Esperada = soma dos plan_value de clientes ativos
  const expectedMonthlyRevenue = (clients || [])
    .filter((c: any) => c.plan_value && c.plan_status === "active")
    .reduce((s: number, c: any) => s + Number(c.plan_value), 0);

  // Projeção próximo mês
  const nextMonth = thisMonth === 11 ? 0 : thisMonth + 1;
  const nextYear = thisMonth === 11 ? thisYear + 1 : thisYear;
  const isNextMonth = (d: string) => {
    const date = new Date(d);
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
    sum + (pp.installments || []).filter((i: any) => i.status === "paid" && (periodFilter === "all" || isThisMonth(i.paid_date || i.due_date)))
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPendingAll = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending")
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPendingMonth = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending" && isThisMonth(i.due_date))
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivPending = periodFilter === "month" ? indivPendingMonth : indivPendingAll;

  const indivOverdue = filteredPayments.reduce((sum: number, pp: any) =>
    sum + (pp.installments || []).filter((i: any) => i.status === "pending" && new Date(i.due_date) < now && (periodFilter === "all" || isThisMonth(i.due_date)))
      .reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

  const indivTotal = filteredPayments.reduce((sum: number, pp: any) => sum + Number(pp.total_value), 0);

  const handleMarkPaid = async (id: string) => {
    const bill = (billing || []).find((b: any) => b.id === id);
    await supabase.from("billing").update({ status: "paid", paid_date: new Date().toISOString().split("T")[0] }).eq("id", id);

    // If it's a renewal, advance the renewal date by 1 month and clear overdue
    if (bill?.client_id && bill?.type === "renewal") {
      const client = (clients || []).find((c: any) => c.id === bill.client_id);
      if (client?.plan_renewal_date) {
        const currentDate = new Date(client.plan_renewal_date + "T00:00:00");
        currentDate.setMonth(currentDate.getMonth() + 1);
        const newDate = currentDate.toISOString().split("T")[0];
        await supabase.from("profiles").update({
          plan_renewal_date: newDate,
          overdue_since: null,
        } as any).eq("id", bill.client_id);

        // Reactivate paused projects
        const { data: pausedProjects } = await supabase
          .from("projects")
          .select("id")
          .eq("client_id", bill.client_id)
          .eq("status", "paused");
        if (pausedProjects && pausedProjects.length > 0) {
          for (const p of pausedProjects) {
            await supabase.from("projects").update({ status: "in_progress" }).eq("id", p.id);
          }
        }

        queryClient.invalidateQueries({ queryKey: ["clients"] });
      }
    }

    // Notify client
    if (bill?.client_id) {
      await notifyUser(bill.client_id, `Pagamento de ${fmt(Number(bill.amount))} registrado ✅`, "billing", "/financeiro");
    }
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    toast.success("Pagamento registrado!");
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
    await supabase.from("recharge_requests").insert({
      client_id: rechargeModal.clientId, platform: rechargeModal.platform,
      amount, reason: rechargeForm.reason || null, requested_by: user?.id,
    });
    // Notify the CLIENT
    await notifyUser(rechargeModal.clientId, `Recarga de ${fmt(amount)} solicitada para ${rechargeModal.platform}. Por favor, confirme.`, "billing", "/financeiro");
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
    setRechargeForm({ amount: "", reason: "" });
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
    const renewalDate = client.plan_renewal_date ? new Date(client.plan_renewal_date).toLocaleDateString("pt-BR") : "em breve";

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
    const msg = encodeURIComponent(`Olá! Lembramos que há uma fatura de ${fmt(Number(billingItem.amount))} com vencimento em ${new Date(billingItem.due_date).toLocaleDateString("pt-BR")}. Qualquer dúvida estamos à disposição! 😊`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
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
        const periodLabel = periodFilter === "month" ? "no Mês" : "Geral";

        const cards = [
          ...(showMonthly ? [{ label: `Recebido ${periodLabel}`, value: fmt(receivedVal), sub: periodFilter === "month" ? `de ${fmt(expectedMonthlyRevenue)} esperado` : recSub, icon: TrendingUp, color: "text-success" }] : [
            { label: `Recebido ${periodLabel}`, value: fmt(receivedVal), sub: recSub, icon: TrendingUp, color: "text-success" },
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
        </div>
        );
      })()}

      {/* Detalhamento A Receber */}
      {isAdmin && (() => {
        const showMonthly2 = brandFilter === "all" || brandFilter === "aceleriq";
        const showIndiv2 = brandFilter === "all" || brandFilter === "sitebolt";

        const monthlyPendingItems = showMonthly2 ? pendingBills.filter((b: any) => b.type !== "ads_recharge").map((b: any) => {
          const client = (clients || []).find((c: any) => c.id === b.client_id);
          return { id: b.id, label: b.description || "Renovação Mensal", client: client?.company_name || client?.full_name || "—", amount: Number(b.amount), due: b.due_date, brand: "AcelerIQ", isOverdue: new Date(b.due_date) < now };
        }) : [];

        const indivPendingItems = showIndiv2 ? filteredPayments.flatMap((pp: any) =>
          (pp.installments || []).filter((i: any) => i.status === "pending").map((i: any) => ({
            id: i.id, label: `${pp.project?.name || "Projeto"} — ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
            client: pp.client?.company_name || pp.client?.full_name || "—", amount: Number(i.amount), due: i.due_date,
            brand: getProjectBrand(pp.project?.project_type), isOverdue: new Date(i.due_date) < now,
          }))
        ) : [];

        const extraItems = showMonthly2 ? (clients || []).filter((c: any) =>
          c.plan_value && c.plan_status === "active" &&
          !pendingBills.some((b: any) => b.client_id === c.id && b.type === "renewal")
        ).map((c: any) => ({
          id: `extra-${c.id}`, label: c.plan_name ? `Renovação — ${c.plan_name}` : "Renovação Mensal",
          client: c.company_name || c.full_name, amount: Number(c.plan_value), due: c.plan_renewal_date || "",
          brand: "AcelerIQ", isOverdue: c.plan_renewal_date ? new Date(c.plan_renewal_date) < now : false,
        })) : [];

        const allPending = [...monthlyPendingItems, ...indivPendingItems, ...extraItems]
          .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

        if (allPending.length === 0) return null;
        return (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-warning" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Detalhamento — A Receber ({allPending.length})</span>
            </div>
            <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
              {allPending.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${item.isOverdue ? "bg-destructive" : "bg-warning"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground truncate">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground">{item.client}</p>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground whitespace-nowrap">{item.brand}</span>
                  <p className="text-sm font-mono text-foreground whitespace-nowrap">{fmt(item.amount)}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${item.isOverdue ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                    {item.isOverdue ? "Atrasado" : item.due ? new Date(item.due).toLocaleDateString("pt-BR") : "—"}
                  </span>
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
              .filter((b: any) => b.status === "paid" && b.type !== "ads_recharge")
              .filter((b: any) => { const d = new Date(b.paid_date || b.due_date); return d.getMonth() === m && d.getFullYear() === currentYear; })
              .reduce((s: number, b: any) => s + Number(b.amount), 0);
            pending += (billing || [])
              .filter((b: any) => b.status === "pending" && b.type !== "ads_recharge")
              .filter((b: any) => { const d = new Date(b.due_date); return d.getMonth() === m && d.getFullYear() === currentYear; })
              .reduce((s: number, b: any) => s + Number(b.amount), 0);
          }

          if (showIndivChart) {
            filteredPayments.forEach((pp: any) => {
              (pp.installments || []).forEach((inst: any) => {
                const d = new Date(inst.paid_date || inst.due_date);
                if (d.getMonth() === m && d.getFullYear() === currentYear) {
                  if (inst.status === "paid") received += Number(inst.amount);
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
                Receita {currentYear} {brandFilter !== "all" ? `— ${brandFilter === "aceleriq" ? "AcelerIQ" : "SiteBolt"}` : ""} — Mês a Mês
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
          .reduce((s: number, b: any) => s + Number(b.amount), 0);
        // SiteBolt received = individual project installments paid
        const siteboltReceived = allPayments
          .filter((pp: any) => ["site", "landing_page", "event", "other"].includes(pp.project?.project_type))
          .reduce((sum: number, pp: any) =>
            sum + (pp.installments || []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0), 0);
        // Joint (automation) received
        const jointReceived = allPayments
          .filter((pp: any) => pp.project?.project_type === "automation")
          .reduce((sum: number, pp: any) =>
            sum + (pp.installments || []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0), 0);

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
              Proporção da Receita — AcelerIQ vs SiteBolt
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
        <TabsList className="bg-secondary/50 border border-border rounded-lg p-1">
          {isAdmin && <TabsTrigger value="overview" className="text-[13px] rounded-md">Visão Geral</TabsTrigger>}
          <TabsTrigger value="ads" className="text-[13px] rounded-md">Ads Wallet</TabsTrigger>
          {isAdmin && <TabsTrigger value="renewals" className="text-[13px] rounded-md">Renovações</TabsTrigger>}
        </TabsList>

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
          {pendingBills.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Pendentes a Receber ({pendingBills.length})
                </span>
                <span className="text-xs font-mono text-warning ml-auto">{fmt(pendingTotal)}</span>
              </div>
              {pendingBills.map((b: any) => {
                const isOverdue = new Date(b.due_date) < now;
                return (
                  <div key={b.id} className={`bg-card border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap ${isOverdue ? "border-destructive/30" : "border-border"}`}>
                    <span className="text-lg">{typeIcon(b.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{b.description || (b.type === "renewal" ? "Renovação Mensal" : b.type === "ads_recharge" ? "Recarga Ads" : "Serviço Extra")}</p>
                      <p className="text-xs text-muted-foreground">{b.client?.company_name || b.client?.full_name} • Vence {new Date(b.due_date).toLocaleDateString("pt-BR")}</p>
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

          {/* Já Recebido */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Já Recebido
              </span>
              <span className="text-xs font-mono text-success ml-auto">{fmt(receivedTotal)}</span>
            </div>
            {/* Filter */}
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: "all", label: "Todos" },
                { value: "month", label: "Este mês" },
                { value: "last3", label: "Últimos 3 meses" },
                { value: "year", label: "Este ano" },
              ].map((f) => (
                <button key={f.value} onClick={() => setReceivedFilter(f.value)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${receivedFilter === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {(() => {
              const filtered = paidBills.filter((b: any) => {
                const paidDate = new Date(b.paid_date || b.due_date);
                if (receivedFilter === "month") return paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear;
                if (receivedFilter === "last3") { const d = new Date(); d.setMonth(d.getMonth() - 3); return paidDate >= d; }
                if (receivedFilter === "year") return paidDate.getFullYear() === thisYear;
                return true;
              });
              const filteredTotal = filtered.reduce((s: number, b: any) => s + Number(b.amount), 0);
              return (
                <>
                  {receivedFilter !== "all" && (
                    <p className="text-[11px] text-muted-foreground">Filtrado: <span className="font-mono text-success">{fmt(filteredTotal)}</span> ({filtered.length} pagamentos)</p>
                  )}
                  {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhum pagamento neste período.</p>}
                  {filtered.map((b: any) => (
                    <div key={b.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                      <span className="text-lg">{typeIcon(b.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{b.description || (b.type === "renewal" ? "Renovação Mensal" : b.type === "ads_recharge" ? "Recarga Ads" : "Serviço Extra")}</p>
                        <p className="text-xs text-muted-foreground">{b.client?.company_name || b.client?.full_name} • Pago em {b.paid_date ? new Date(b.paid_date).toLocaleDateString("pt-BR") : "—"}</p>
                      </div>
                      <p className="text-sm font-mono font-medium text-foreground">{fmt(Number(b.amount))}</p>
                      {statusBadge(b.status)}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>

          {/* Projetos Individuais */}
          {filteredPayments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Projetos Individuais
                </span>
              </div>
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
              {filteredPayments.map((pp: any) => {
                const paid = (pp.installments || []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
                const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
                const hasOverdue = (pp.installments || []).some((i: any) => i.status === "pending" && new Date(i.due_date) < now);
                const remaining = Number(pp.total_value) - paid;
                return (
                  <div key={pp.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{pp.project?.name || "Projeto"}</p>
                      <p className="text-xs text-muted-foreground">
                        {pp.client?.company_name || pp.client?.full_name}
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{getProjectBrand(pp.project?.project_type)}</span>
                      </p>
                    </div>
                    <div className="w-20 hidden sm:block">
                      <Progress value={pct} className="h-1.5" />
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5 text-right">{pct}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono text-success">{fmt(paid)}</p>
                      <p className="text-[10px] text-muted-foreground">de {fmt(Number(pp.total_value))}</p>
                    </div>
                    {remaining > 0 && (
                      <div className="text-right hidden md:block">
                        <p className="text-xs font-mono text-warning">{fmt(remaining)}</p>
                        <p className="text-[10px] text-muted-foreground">falta</p>
                      </div>
                    )}
                    {hasOverdue && <AlertTriangleIcon className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}

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

          {Object.entries(walletsByClient).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum wallet de anúncios cadastrado.</p>}
          {Object.entries(walletsByClient).map(([clientId, clientWallets]) => {
            const clientTotal = clientWallets.reduce((s: number, w: any) => s + Number(w.balance), 0);
            // Calculate total invested from completed recharges for this client
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
                  <div key={w.id} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 capitalize">{w.platform} Ads</span>
                    <p className="text-sm font-mono font-medium text-foreground flex-1">{fmt(Number(w.balance))}</p>
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
                    <p className="text-sm text-foreground">{fmt(Number(r.amount))} — {r.platform}</p>
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

        {/* Tab: Renewals */}
        <TabsContent value="renewals" className="space-y-3">
          {(clients || []).map((c: any) => {
            const renewalDate = c.plan_renewal_date ? new Date(c.plan_renewal_date) : null;
            const daysLeft = renewalDate ? Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
            const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";
            const clientBilling = (billing || []).find((b: any) => b.client_id === c.id && b.type === "renewal");
            const reminderCount = clientBilling?.reminder_count || 0;

            return (
              <div key={c.id} className="bg-card border border-border rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                  {planStatus === "active" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">🟢 Ativo</span>}
                  {planStatus === "soon" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">🟡 Renovação em breve</span>}
                  {planStatus === "overdue" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">🔴 Pendente</span>}
                </div>
                {clientBilling && (
                  <p className="text-xs text-muted-foreground">{clientBilling.description || "Plano"} • {fmt(Number(clientBilling.amount))}/mês</p>
                )}
                {!clientBilling && (c as any).plan_value && (
                  <p className="text-xs text-muted-foreground">Valor do plano: {fmt(Number((c as any).plan_value))}/mês</p>
                )}
                {renewalDate && (
                  <p className="text-xs text-muted-foreground">Renovação: {renewalDate.toLocaleDateString("pt-BR")}{daysLeft !== null && daysLeft >= 0 && ` (${daysLeft} dias)`}</p>
                )}
                <div className="flex gap-2 pt-1 flex-wrap">
                  <button onClick={() => handleSendReminder(c, "notification")}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                    <Bell className="w-3 h-3" /> {reminderCount > 0 ? `Lembrete enviado (${reminderCount}x)` : "📩 Notificação"}
                  </button>
                  <button onClick={() => handleSendReminder(c, "whatsapp")}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                    <MessageCircle className="w-3 h-3" /> 💬 WhatsApp
                  </button>
                  <button onClick={() => { setEditPlanModal(c); setPlanForm({ amount: clientBilling ? String(clientBilling.amount) : "", renewal_date: c.plan_renewal_date || "", description: clientBilling?.description || "" }); }}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border flex items-center gap-1.5">
                    <Edit3 className="w-3 h-3" /> Editar Plano
                  </button>
                </div>
              </div>
            );
          })}
        </TabsContent>
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

      {/* Recharge Modal */}
      <Dialog open={!!rechargeModal} onOpenChange={() => setRechargeModal(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Solicitar Recarga — {rechargeModal?.platform}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Valor (R$)</label>
              <Input type="number" value={rechargeForm.amount} onChange={e => setRechargeForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Motivo *</label>
              <textarea value={rechargeForm.reason} onChange={e => setRechargeForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none" rows={3} placeholder="Campanha X precisa de mais budget..." />
            </div>
            <button onClick={handleRequestRecharge}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
              Enviar Solicitação
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Plan Modal */}
      <Dialog open={!!editPlanModal} onOpenChange={() => setEditPlanModal(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Editar Plano — {editPlanModal?.company_name || editPlanModal?.full_name}</DialogTitle></DialogHeader>
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
    </div>
  );
}
