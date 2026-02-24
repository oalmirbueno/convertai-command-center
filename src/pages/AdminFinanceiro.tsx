import { useState } from "react";
import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyUser } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { DollarSign, TrendingUp, Users, CreditCard, Plus, RefreshCw, Bell, Edit3, Zap, CheckCircle2, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

  const [newBillingOpen, setNewBillingOpen] = useState(false);
  const [rechargeModal, setRechargeModal] = useState<{ clientId: string; platform: string } | null>(null);
  const [editPlanModal, setEditPlanModal] = useState<any>(null);

  const [billForm, setBillForm] = useState({ client_id: "", type: "renewal", amount: "", due_date: "", description: "" });
  const [rechargeForm, setRechargeForm] = useState({ amount: "", reason: "" });
  const [planForm, setPlanForm] = useState({ amount: "", renewal_date: "", description: "" });

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const monthlyRevenue = (billing || [])
    .filter((b: any) => b.status === "paid" && b.type !== "ads_recharge" && new Date(b.paid_date || b.due_date).getMonth() === thisMonth && new Date(b.paid_date || b.due_date).getFullYear() === thisYear)
    .reduce((s: number, b: any) => s + Number(b.amount), 0);

  const pendingTotal = (billing || [])
    .filter((b: any) => b.status === "pending" && b.type !== "ads_recharge")
    .reduce((s: number, b: any) => s + Number(b.amount), 0);

  const overdueTotal = (billing || [])
    .filter((b: any) => b.status === "pending" && new Date(b.due_date) < now)
    .reduce((s: number, b: any) => s + Number(b.amount), 0);

  const totalAds = (wallets || []).reduce((s: number, w: any) => s + Number(w.balance), 0);

  const handleMarkPaid = async (id: string) => {
    const bill = (billing || []).find((b: any) => b.id === id);
    await supabase.from("billing").update({ status: "paid", paid_date: new Date().toISOString().split("T")[0] }).eq("id", id);
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
      <p className="heading-page">Financeiro</p>

      {/* Stats - only admin sees revenue/pending/overdue */}
      {isAdmin && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Receita Mensal", value: fmt(monthlyRevenue), icon: TrendingUp, color: "text-success" },
            { label: "Pendente", value: fmt(pendingTotal), icon: CreditCard, color: "text-warning" },
            { label: "Investimento Ads", value: fmt(totalAds), icon: DollarSign, color: "text-info" },
            { label: "Atrasado", value: fmt(overdueTotal), icon: CreditCard, color: "text-destructive" },
          ].map((s, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
              </div>
              <p className="text-lg font-semibold font-mono text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      )}

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

      <Tabs defaultValue={isAdmin ? "overview" : "ads"} className="space-y-4">
        <TabsList className="bg-secondary/50 border border-border rounded-lg p-1">
          {isAdmin && <TabsTrigger value="overview" className="text-[13px] rounded-md">Visão Geral</TabsTrigger>}
          <TabsTrigger value="ads" className="text-[13px] rounded-md">Ads Wallet</TabsTrigger>
          {isAdmin && <TabsTrigger value="renewals" className="text-[13px] rounded-md">Renovações</TabsTrigger>}
        </TabsList>

        {/* Tab: Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Transações recentes</span>
            <button onClick={() => setNewBillingOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
              <Plus className="w-3 h-3" /> Nova Cobrança
            </button>
          </div>
          <div className="space-y-2 stagger-children">
            {(billing || []).map((b: any) => (
              <div key={b.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                <span className="text-lg">{typeIcon(b.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{b.description || (b.type === "renewal" ? "Renovação Mensal" : b.type === "ads_recharge" ? "Recarga Ads" : "Serviço Extra")}</p>
                  <p className="text-xs text-muted-foreground">{b.client?.company_name || b.client?.full_name} • Vence {new Date(b.due_date).toLocaleDateString("pt-BR")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono font-medium text-foreground">{fmt(Number(b.amount))}</p>
                  {b.type === "ads_recharge" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info font-medium">📢 Ads</span>
                  )}
                </div>
                {statusBadge(b.status, b.due_date)}
                {b.status === "pending" && (
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
                )}
              </div>
            ))}
            {(!billing || billing.length === 0) && <p className="text-sm text-muted-foreground text-center py-6">Nenhuma transação encontrada.</p>}
          </div>
        </TabsContent>

        {/* Tab: Ads Wallet */}
        <TabsContent value="ads" className="space-y-4">
          {Object.entries(walletsByClient).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum wallet de anúncios cadastrado.</p>}
          {Object.entries(walletsByClient).map(([clientId, clientWallets]) => (
            <div key={clientId} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <p className="text-sm font-medium text-foreground">{clientWallets[0]?.client?.company_name || clientWallets[0]?.client?.full_name}</p>
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
              {clientWallets[0]?.last_recharge_date && (
                <p className="text-[11px] text-muted-foreground">Última recarga: {new Date(clientWallets[0].last_recharge_date).toLocaleDateString("pt-BR")}</p>
              )}
            </div>
          ))}

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
