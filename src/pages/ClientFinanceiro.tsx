import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { DollarSign, CheckCircle2, XCircle, MessageCircle } from "lucide-react";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default function ClientFinanceiro() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: billing } = useBilling(user?.id);
  const { data: wallets } = useAdsWallet(user?.id);
  const { data: recharges } = useRechargeRequests(user?.id);

  const renewalBill = (billing || []).find((b: any) => b.type === "renewal" && b.status === "pending");
  const renewalDate = profile?.plan_renewal_date ? new Date(profile.plan_renewal_date) : null;
  const now = new Date();
  const daysLeft = renewalDate ? Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Time bar calculation
  const startDate = renewalDate ? new Date(renewalDate) : null;
  if (startDate) startDate.setMonth(startDate.getMonth() - 1);
  const totalDays = startDate && renewalDate ? Math.ceil((renewalDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 30;
  const elapsedDays = startDate ? Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const progressPercent = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  const remainingPercent = 100 - progressPercent;

  const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";
  const barColor = remainingPercent > 50 ? "bg-success" : remainingPercent > 30 ? "bg-warning" : "bg-destructive";

  const handleConfirmRecharge = async (id: string, amount: number, platform: string) => {
    await supabase.from("recharge_requests").update({ status: "approved" }).eq("id", id);
    await notifyAdmin(`Cliente confirmou recarga de ${fmt(amount)} para ${platform}`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    toast.success("Recarga confirmada!");
  };

  const handleRejectRecharge = async (id: string) => {
    await supabase.from("recharge_requests").update({ status: "rejected" }).eq("id", id);
    await notifyAdmin("Cliente recusou solicitação de recarga", "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    toast.success("Recarga recusada");
  };

  const openWhatsApp = (message: string) => {
    // Try to use admin phone - fallback to generic
    const msg = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const showTraffic = (profile as any)?.services_config?.traffic !== false;
  const pendingRecharges = (recharges || []).filter((r: any) => r.status === "pending");

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page">Financeiro</p>

      {/* My Plan */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-foreground">{renewalBill?.description || "Meu Plano"}</p>
          {planStatus === "active" && <span className="text-xs px-2.5 py-1 rounded-full bg-success/15 text-success">🟢 Ativo</span>}
          {planStatus === "soon" && <span className="text-xs px-2.5 py-1 rounded-full bg-warning/15 text-warning">🟡 Renovação em breve</span>}
          {planStatus === "overdue" && <span className="text-xs px-2.5 py-1 rounded-full bg-destructive/15 text-destructive">🔴 Pendente</span>}
        </div>

        {renewalBill && (
          <p className="text-2xl font-mono font-light text-foreground">{fmt(Number(renewalBill.amount))}<span className="text-sm text-muted-foreground">/mês</span></p>
        )}

        {renewalDate && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Próxima renovação: {renewalDate.toLocaleDateString("pt-BR")}</span>
              {daysLeft !== null && daysLeft >= 0 && <span>{daysLeft} dias restantes</span>}
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        <button onClick={() => openWhatsApp("Olá! Gostaria de falar sobre a renovação do meu plano.")}
          className="inline-flex items-center gap-2 text-[12px] px-4 py-2 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border">
          <MessageCircle className="w-3.5 h-3.5" /> Falar sobre renovação
        </button>
      </div>

      {/* Ads Wallet */}
      {showTraffic && (wallets || []).length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Investimento em Anúncios</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(wallets || []).map((w: any) => {
              const balance = Number(w.balance);
              const maxBalance = 2000;
              const pct = Math.min(100, (balance / maxBalance) * 100);
              const statusText = balance === 0 ? "Sem saldo ❌" : balance < 500 ? "Saldo baixo ⚠" : "Saldo OK ✓";
              const statusColor = balance === 0 ? "text-destructive" : balance < 500 ? "text-warning" : "text-success";
              const barColor2 = balance === 0 ? "bg-destructive" : balance < 500 ? "bg-warning" : "bg-success";

              return (
                <div key={w.id} className="bg-card border border-border rounded-2xl p-5 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{w.platform} Ads</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{fmt(balance)}</p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${barColor2} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-xs ${statusColor}`}>{statusText}</p>
                </div>
              );
            })}
          </div>
          {(wallets || []).some((w: any) => w.last_recharge_date) && (
            <p className="text-[11px] text-muted-foreground">
              Última recarga: {new Date((wallets || []).find((w: any) => w.last_recharge_date)?.last_recharge_date).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
      )}

      {/* Pending Recharges */}
      {pendingRecharges.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Recargas Pendentes</p>
          {pendingRecharges.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-2xl p-5 space-y-3">
              <div className="flex items-start gap-3">
                <DollarSign className="w-4 h-4 text-warning mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Recarga {r.platform} Ads — {fmt(Number(r.amount))}</p>
                  {r.requester?.full_name && <p className="text-xs text-muted-foreground">Solicitado por {r.requester.full_name} • {new Date(r.created_at).toLocaleDateString("pt-BR")}</p>}
                  {r.reason && <p className="text-xs text-muted-foreground mt-1 italic">"{r.reason}"</p>}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => handleConfirmRecharge(r.id, Number(r.amount), r.platform)}
                  className="inline-flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-full bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar Recarga
                </button>
                <button onClick={() => openWhatsApp(`Olá! Sobre a recarga de ${fmt(Number(r.amount))} para ${r.platform}...`)}
                  className="inline-flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
                <button onClick={() => handleRejectRecharge(r.id)}
                  className="inline-flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer border-none">
                  <XCircle className="w-3.5 h-3.5" /> Recusar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingRecharges.length === 0 && showTraffic && (
        <div className="text-xs text-muted-foreground/60 text-center py-2">Nenhuma recarga pendente no momento ✓</div>
      )}

      {/* Payment History */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Histórico de Pagamentos</p>
        <div className="bg-card border border-border rounded-2xl divide-y divide-border">
          {(billing || []).map((b: any) => {
            const isOverdue = new Date(b.due_date) < now && b.status === "pending";
            return (
              <div key={b.id} className="px-5 py-3 flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full shrink-0 ${b.status === "paid" ? "bg-success" : isOverdue ? "bg-destructive" : "bg-warning"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{b.description || b.type}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(b.due_date).toLocaleDateString("pt-BR")}</p>
                </div>
                <p className="text-sm font-mono text-foreground">{fmt(Number(b.amount))}</p>
                {b.status === "paid"
                  ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">Pago</span>
                  : isOverdue
                    ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">Atrasado</span>
                    : <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Pendente</span>
                }
              </div>
            );
          })}
          {(!billing || billing.length === 0) && <p className="text-sm text-muted-foreground text-center py-6">Nenhum pagamento registrado.</p>}
        </div>
      </div>
    </div>
  );
}
