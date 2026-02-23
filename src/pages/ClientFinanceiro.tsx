import { useBilling, useAdsWallet, useRechargeRequests } from "@/hooks/useFinancialData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { DollarSign, CheckCircle2 } from "lucide-react";

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

  const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";

  const handleConfirmRecharge = async (id: string) => {
    await supabase.from("recharge_requests").update({ status: "approved" }).eq("id", id);
    await notifyAdmin(`Cliente confirmou recarga`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests"] });
    toast.success("Recarga confirmada!");
  };

  const showTraffic = (profile as any)?.services_config?.traffic !== false;

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page">Financeiro</p>

      {/* My Plan */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{renewalBill?.description || "Meu Plano"}</p>
          {planStatus === "active" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">🟢 Ativo</span>}
          {planStatus === "soon" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">🟡 Renovação em breve</span>}
          {planStatus === "overdue" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">🔴 Pendente</span>}
        </div>
        {renewalBill && <p className="text-lg font-mono font-semibold text-foreground">{fmt(Number(renewalBill.amount))}/mês</p>}
        {renewalDate && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Próxima renovação: {renewalDate.toLocaleDateString("pt-BR")}
              {daysLeft !== null && daysLeft >= 0 && ` • ${daysLeft} dias restantes`}
            </p>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${planStatus === "active" ? "bg-success" : planStatus === "soon" ? "bg-warning" : "bg-destructive"}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Ads Wallet */}
      {showTraffic && (wallets || []).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Investimento em Anúncios</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(wallets || []).map((w: any) => {
              const maxBalance = 5000;
              const pct = Math.min(100, (Number(w.balance) / maxBalance) * 100);
              const color = pct > 50 ? "bg-success" : pct > 20 ? "bg-warning" : "bg-destructive";
              return (
                <div key={w.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                  <p className="text-xs text-muted-foreground capitalize">{w.platform} Ads</p>
                  <p className="text-lg font-mono font-semibold text-foreground">{fmt(Number(w.balance))}</p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recharge Requests */}
      {(recharges || []).filter((r: any) => r.status === "pending").length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Solicitações de Recarga</p>
          {(recharges || []).filter((r: any) => r.status === "pending").map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4">
              <DollarSign className="w-4 h-4 text-warning" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{fmt(Number(r.amount))} — {r.platform}</p>
                {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
              </div>
              <button onClick={() => handleConfirmRecharge(r.id)}
                className="text-[11px] px-3 py-1.5 rounded-full bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Confirmar Recarga
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Payment History */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Histórico de Pagamentos</p>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {(billing || []).map((b: any) => (
            <div key={b.id} className="px-5 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{b.description || b.type}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(b.due_date).toLocaleDateString("pt-BR")}</p>
              </div>
              <p className="text-sm font-mono text-foreground">{fmt(Number(b.amount))}</p>
              {b.status === "paid"
                ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">Pago</span>
                : <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Pendente</span>
              }
            </div>
          ))}
          {(!billing || billing.length === 0) && <p className="text-sm text-muted-foreground text-center py-6">Nenhum pagamento registrado.</p>}
        </div>
      </div>
    </div>
  );
}
