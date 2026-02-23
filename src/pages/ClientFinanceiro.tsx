import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { DollarSign, CheckCircle2, XCircle, MessageCircle } from "lucide-react";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const platformLabels: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

const typeLabels: Record<string, string> = {
  plan_renewal: "Renovação de Plano",
  renewal: "Renovação de Plano",
  ads_recharge: "Recarga Ads",
  extra_service: "Serviço Extra",
};

export default function ClientFinanceiro() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: billing } = useQuery({
    queryKey: ["billing-client", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("billing")
        .select("*")
        .eq("client_id", user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const { data: wallets } = useQuery({
    queryKey: ["ads-wallet-client", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("ads_wallet")
        .select("*")
        .eq("client_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: rechargeRequests } = useQuery({
    queryKey: ["recharge-requests-client", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("recharge_requests")
        .select("*, requester:profiles!recharge_requests_requested_by_fkey(full_name)")
        .eq("client_id", user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  const showTraffic = (profile as any)?.services_config?.traffic !== false;
  const pendingRecharges = (rechargeRequests || []).filter((r: any) => r.status === "pending");

  // Plan info
  const planBilling = (billing || []).filter((b: any) => b.type === "plan_renewal" || b.type === "renewal");
  const currentPlan = planBilling.find((b: any) => b.status === "pending") || planBilling.find((b: any) => b.status === "paid");

  const renewalDate = profile?.plan_renewal_date ? new Date(profile.plan_renewal_date) : null;
  const now = new Date();
  const daysLeft = renewalDate ? Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Time bar
  const startDate = renewalDate ? new Date(renewalDate) : null;
  if (startDate) startDate.setMonth(startDate.getMonth() - 1);
  const totalDays = startDate && renewalDate ? Math.ceil((renewalDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 30;
  const elapsedDays = startDate ? Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const progressPercent = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  const remainingPercent = 100 - progressPercent;
  const barColor = remainingPercent > 50 ? "bg-success" : remainingPercent > 30 ? "bg-warning" : "bg-destructive";

  const planStatus = !renewalDate || daysLeft === null ? "unknown" : daysLeft < 0 ? "overdue" : daysLeft <= 15 ? "soon" : "active";

  const handleConfirmRecharge = async (requestId: string, amount: number, platform: string) => {
    await supabase.from("recharge_requests").update({ status: "approved" }).eq("id", requestId);
    await notifyAdmin(`${profile?.company_name || profile?.full_name} confirmou recarga de ${fmt(amount)} para ${platformLabels[platform] || platform}`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
    toast.success("Recarga confirmada! Aguarde a atualização do saldo.");
  };

  const handleRejectRecharge = async (requestId: string) => {
    await supabase.from("recharge_requests").update({ status: "rejected" }).eq("id", requestId);
    await notifyAdmin(`${profile?.company_name || profile?.full_name} recusou a recarga solicitada`, "billing", "/financeiro");
    queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
    toast.success("Recarga recusada.");
  };

  const openWhatsApp = (message: string) => {
    const msg = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <p className="heading-page">Financeiro</p>

      {/* SECTION 1: MY PLAN */}
      <section>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Meu Plano</p>
        <div className="bg-card border border-border rounded-2xl p-6">
          {currentPlan ? (
            <>
              <p className="text-lg font-semibold text-foreground">{currentPlan.description || "Plano Mensal"}</p>
              <p className="text-2xl font-mono font-light text-foreground mt-1">
                {fmt(Number(currentPlan.amount))}
                <span className="text-sm text-muted-foreground">/mês</span>
              </p>

              <div className="mt-4 flex items-center gap-3">
                {planStatus === "active" && <span className="text-xs px-2.5 py-1 rounded-full bg-success/15 text-success">🟢 Ativo</span>}
                {planStatus === "soon" && <span className="text-xs px-2.5 py-1 rounded-full bg-warning/15 text-warning">🟡 Renovação em breve</span>}
                {planStatus === "overdue" && <span className="text-xs px-2.5 py-1 rounded-full bg-destructive/15 text-destructive">🔴 Pendente</span>}
                <span className="text-sm text-muted-foreground">
                  Renovação: {renewalDate ? formatDate(renewalDate.toISOString()) : "—"}
                </span>
              </div>

              {renewalDate && (
                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${progressPercent}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {daysLeft !== null && daysLeft >= 0 ? `${daysLeft} dias restantes` : "Período vencido"}
                  </p>
                </div>
              )}

              <button
                onClick={() => openWhatsApp("Olá! Gostaria de falar sobre a renovação do meu plano.")}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-[13px] bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Falar sobre renovação
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum plano ativo</p>
          )}
        </div>
      </section>

      {/* SECTION 2: ADS INVESTMENT */}
      {showTraffic && wallets && wallets.length > 0 && (
        <section>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Investimento em Anúncios</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {wallets.map((w: any) => {
              const balance = Number(w.balance);
              const pct = Math.min(100, (balance / 2000) * 100);
              const statusText = balance === 0 ? "Sem saldo ❌" : balance < 500 ? "Saldo baixo ⚠" : "Saldo OK ✓";
              const statusColor = balance === 0 ? "text-destructive" : balance < 500 ? "text-warning" : "text-success";
              const bColor = balance === 0 ? "bg-destructive" : balance < 500 ? "bg-warning" : "bg-success";

              return (
                <div key={w.id} className="bg-card border border-border rounded-2xl p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{platformLabels[w.platform] || w.platform}</p>
                  <p className="text-xl font-mono font-light text-foreground mt-2">{fmt(balance)}</p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-3">
                    <div className={`h-full rounded-full ${bColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-[11px] mt-1 ${statusColor}`}>{statusText}</p>
                </div>
              );
            })}
          </div>
          {wallets.some((w: any) => w.last_recharge_date) && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Última recarga: {formatDate(wallets.find((w: any) => w.last_recharge_date)?.last_recharge_date)}
            </p>
          )}
        </section>
      )}

      {/* SECTION 3: PENDING RECHARGES */}
      {pendingRecharges.length > 0 && (
        <section>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Recargas Pendentes</p>
          <div className="space-y-3">
            {pendingRecharges.map((r: any) => (
              <div key={r.id} className="bg-card border border-warning/30 rounded-2xl p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">⚡ Recarga {platformLabels[r.platform] || r.platform}</p>
                  <p className="text-xl font-mono font-light text-foreground mt-1">{fmt(Number(r.amount))}</p>
                  {r.reason && <p className="text-xs text-muted-foreground mt-2 italic">"{r.reason}"</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {r.requester?.full_name && `Solicitado por ${r.requester.full_name} • `}
                    {formatDate(r.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button onClick={() => handleConfirmRecharge(r.id, Number(r.amount), r.platform)}
                    className="px-4 py-2 rounded-xl text-[13px] font-medium bg-success/90 text-white hover:bg-success transition-colors cursor-pointer border-none">
                    ✅ Confirmar Recarga
                  </button>
                  <button onClick={() => openWhatsApp(`Olá! Sobre a recarga de ${fmt(Number(r.amount))} para ${platformLabels[r.platform] || r.platform}...`)}
                    className="px-4 py-2 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors cursor-pointer border border-border inline-flex items-center gap-1">
                    <MessageCircle className="w-3.5 h-3.5" /> Discutir
                  </button>
                  <button onClick={() => handleRejectRecharge(r.id)}
                    className="px-4 py-2 rounded-xl text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border border-destructive/30">
                    ❌ Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {pendingRecharges.length === 0 && showTraffic && (
        <div className="text-xs text-muted-foreground/60 text-center py-2">Nenhuma recarga pendente no momento ✓</div>
      )}

      {/* SECTION 4: PAYMENT HISTORY */}
      <section>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Histórico de Pagamentos</p>
        <div className="bg-card border border-border rounded-2xl divide-y divide-border">
          {(!billing || billing.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum pagamento registrado</p>
          ) : (
            billing.map((b: any) => {
              const isOverdue = new Date(b.due_date) < now && b.status === "pending";
              return (
                <div key={b.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${b.status === "paid" ? "bg-success" : isOverdue ? "bg-destructive" : "bg-warning"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground">{b.description || typeLabels[b.type] || b.type}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(b.due_date)}</p>
                  </div>
                  <p className="text-sm font-mono text-foreground">{fmt(Number(b.amount))}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    b.status === "paid" ? "bg-success/15 text-success" :
                    isOverdue ? "bg-destructive/15 text-destructive" :
                    "bg-warning/15 text-warning"
                  }`}>
                    {b.status === "paid" ? "Pago" : isOverdue ? "Atrasado" : "Pendente"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
