import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { MessageCircle, Check, X, AlertTriangle, Wallet, CreditCard, Clock, Loader2, Briefcase } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { getProjectBrand } from "@/lib/brandHelpers";

const platformLabels: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  linkedin: "LinkedIn Ads",
  other: "Outros",
};

const typeLabels: Record<string, string> = {
  plan_renewal: "Renovação de Plano",
  renewal: "Renovação de Plano",
  ads_recharge: "Recarga Ads",
  extra_service: "Serviço Extra",
};

function formatCurrency(val: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClientFinanceiro() {
  const { user, profile: authProfile } = useAuth();
  const { clientId, profile } = useClientIdentity();
  const queryClient = useQueryClient();

  // ===== QUERIES =====
  const { data: billing, isLoading: loadingBilling } = useQuery({
    queryKey: ["billing-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("billing")
        .select("*")
        .eq("client_id", clientId!)
        .order("due_date", { ascending: false });
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const { data: wallets } = useQuery({
    queryKey: ["ads-wallet-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ads_wallet")
        .select("*")
        .eq("client_id", clientId!);
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const { data: rechargeRequests } = useQuery({
    queryKey: ["recharge-requests-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recharge_requests")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const { data: myProjectPayments } = useQuery({
    queryKey: ["client-project-payments", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_payments")
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type), installments:payment_installments(*)")
        .eq("client_id", clientId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  // ===== COMPUTED =====
  const showTraffic = (profile as any)?.services_config?.traffic !== false;
  const pendingRecharges = (rechargeRequests || []).filter((r: any) => r.status === "pending");
  const planBillings = (billing || []).filter(
    (b: any) => b.type === "plan_renewal" || b.type === "renewal"
  );
  const latestPlan = planBillings[0];

  // Plan time
  const renewalDateStr = profile?.plan_renewal_date || latestPlan?.due_date;
  const renewalDate = renewalDateStr ? new Date(renewalDateStr) : null;
  const today = new Date();
  const daysLeft = renewalDate
    ? Math.max(Math.ceil((renewalDate.getTime() - today.getTime()) / 86400000), 0)
    : 0;

  const periodStart = renewalDate ? new Date(renewalDate) : null;
  if (periodStart) periodStart.setMonth(periodStart.getMonth() - 1);
  const totalDays =
    periodStart && renewalDate
      ? (renewalDate.getTime() - periodStart.getTime()) / 86400000
      : 30;
  const passedDays = periodStart
    ? (today.getTime() - periodStart.getTime()) / 86400000
    : 0;
  const timePercent = Math.min(Math.max((passedDays / totalDays) * 100, 0), 100);

  const planStatus =
    daysLeft > 15 ? "active" : daysLeft > 0 ? "warning" : "overdue";
  const planStatusLabel =
    planStatus === "active"
      ? "Ativo"
      : planStatus === "warning"
        ? "Renova em breve"
        : "Pendente";
  const planStatusEmoji =
    planStatus === "active" ? "🟢" : planStatus === "warning" ? "🟡" : "🔴";
  const planStatusColor =
    planStatus === "active"
      ? "bg-success/10 text-success"
      : planStatus === "warning"
        ? "bg-warning/10 text-warning"
        : "bg-destructive/10 text-destructive";
  const barColor =
    planStatus === "active"
      ? "bg-success"
      : planStatus === "warning"
        ? "bg-warning"
        : "bg-destructive";

  // ===== ACTIONS =====
  const handleConfirmRecharge = async (
    requestId: string,
    amount: number,
    platform: string
  ) => {
    await supabase
      .from("recharge_requests")
      .update({ status: "approved" })
      .eq("id", requestId);
    await notifyAdmin(
      `${profile?.company_name || profile?.full_name || "Cliente"} confirmou recarga de ${formatCurrency(amount)} para ${platformLabels[platform] || platform}`,
      "billing",
      "/financeiro"
    );
    queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
    toast.success("Recarga confirmada! Aguarde a atualização do saldo.");
  };

  const handleRejectRecharge = async (requestId: string) => {
    await supabase
      .from("recharge_requests")
      .update({ status: "rejected" })
      .eq("id", requestId);
    await notifyAdmin(
      `${profile?.company_name || profile?.full_name || "Cliente"} recusou a recarga solicitada`,
      "billing",
      "/financeiro"
    );
    queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
    toast.success("Recarga recusada.");
  };

  const openWhatsApp = (message: string) => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  };

  // ===== LOADING =====
  if (loadingBilling) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Carregando dados financeiros...
        </span>
      </div>
    );
  }

  // ===== RENDER =====
  return (
    <div className="space-y-8 animate-fade-in w-full">
      <h1 className="text-xl font-semibold text-foreground">Financeiro</h1>

      {/* ========== SEÇÃO 1: MEU PLANO ========== */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Meu Plano
          </span>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          {latestPlan ? (
            <>
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {latestPlan.description || "Plano Mensal"}
                  </p>
                  <p className="text-2xl font-mono font-light text-foreground mt-1">
                    {formatCurrency(Number(latestPlan.amount))}
                    <span className="text-sm text-muted-foreground ml-1">/mês</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${planStatusColor}`}
                >
                  {planStatusEmoji} {planStatusLabel}
                </span>
                {renewalDate && (
                  <span className="text-sm text-muted-foreground">
                    Renovação: {formatDate(renewalDateStr!)}
                  </span>
                )}
              </div>

              {renewalDate && (
                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor} transition-all duration-500`}
                      style={{ width: `${timePercent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {daysLeft > 0 ? `${daysLeft} dias restantes` : "Período vencido"}
                  </p>
                </div>
              )}

              <button
                onClick={() =>
                  openWhatsApp(
                    "Olá! Gostaria de falar sobre a renovação do meu plano."
                  )
                }
                className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-xl text-[13px] bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Falar sobre renovação
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              Nenhum plano encontrado
            </p>
          )}
        </div>
      </section>

      {/* ========== SEÇÃO 2: INVESTIMENTO EM ANÚNCIOS ========== */}
      {showTraffic && (wallets || []).length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Investimento em Anúncios
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(wallets || []).map((w: any) => {
              const balance = Number(w.balance);
              const gaugePercent = Math.min((balance / 2000) * 100, 100);
              const gaugeColor =
                balance > 500
                  ? "bg-success"
                  : balance > 100
                    ? "bg-warning"
                    : "bg-destructive";
              const statusText =
                balance > 500
                  ? "Saldo OK ✓"
                  : balance > 100
                    ? "Saldo baixo ⚠"
                    : balance === 0
                      ? "Sem saldo ❌"
                      : "Saldo crítico ⚠";
              const statusTextColor =
                balance > 500
                  ? "text-success"
                  : balance > 100
                    ? "text-warning"
                    : "text-destructive";

              return (
                <div
                  key={w.id}
                  className="bg-card border border-border rounded-2xl p-5"
                >
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {platformLabels[w.platform] || w.platform}
                  </p>
                  <p className="text-xl font-mono font-light text-foreground mt-2">
                    {formatCurrency(balance)}
                  </p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-3">
                    <div
                      className={`h-full rounded-full ${gaugeColor} transition-all duration-500`}
                      style={{ width: `${gaugePercent}%` }}
                    />
                  </div>
                  <p className={`text-[11px] mt-1.5 ${statusTextColor}`}>
                    {statusText}
                  </p>
                  {w.last_recharge_date && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Última recarga: {formatDate(w.last_recharge_date)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ========== SEÇÃO 3: RECARGAS PENDENTES ========== */}
      {pendingRecharges.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Recargas Pendentes
            </span>
          </div>

          <div className="space-y-3">
            {pendingRecharges.map((r: any) => (
              <div
                key={r.id}
                className="bg-card border border-warning/30 rounded-2xl p-5"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    ⚡ Recarga {platformLabels[r.platform] || r.platform}
                  </p>
                  <p className="text-xl font-mono font-light text-foreground mt-1">
                    {formatCurrency(Number(r.amount))}
                  </p>
                  {r.reason && (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      "{r.reason}"
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Solicitado em {formatDate(r.created_at)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() =>
                      handleConfirmRecharge(r.id, Number(r.amount), r.platform)
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-success text-white hover:bg-success/90 transition-colors cursor-pointer border-none"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Confirmar Recarga
                  </button>
                  <button
                    onClick={() =>
                      openWhatsApp(
                        `Olá! Sobre a recarga de ${formatCurrency(Number(r.amount))} para ${platformLabels[r.platform] || r.platform}...`
                      )
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors cursor-pointer border border-border"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Discutir
                  </button>
                  <button
                    onClick={() => handleRejectRecharge(r.id)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border border-destructive/30"
                  >
                    <X className="w-3.5 h-3.5" />
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {pendingRecharges.length === 0 && showTraffic && (
        <p className="text-xs text-muted-foreground/60 text-center py-2">
          Nenhuma recarga pendente no momento ✓
        </p>
      )}

      {/* ========== SEÇÃO: PROJETOS INDIVIDUAIS ========== */}
      {(myProjectPayments || []).length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Projetos Individuais
            </span>
          </div>

          <div className="space-y-3">
            {(myProjectPayments || []).map((pp: any) => {
              const installments = pp.installments || [];
              const paid = installments.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const remaining = Number(pp.total_value) - paid;
              const sortedInstallments = [...installments].sort((a: any, b: any) => a.installment_number - b.installment_number);

              return (
                <div key={pp.id} className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{pp.project?.name || "Projeto"}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{getProjectBrand(pp.project?.project_type)}</span>
                      </div>
                      <p className="text-xl font-mono font-light text-foreground mt-1">{formatCurrency(Number(pp.total_value))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-success font-mono">{formatCurrency(paid)} pago</p>
                      {remaining > 0 && <p className="text-xs text-warning font-mono">{formatCurrency(remaining)} restante</p>}
                    </div>
                  </div>

                  <div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">{pct}% concluído</p>
                  </div>

                  <div className="divide-y divide-border">
                    {sortedInstallments.map((inst: any) => {
                      const isOverdue = inst.status === "pending" && new Date(inst.due_date) < today;
                      const statusLabel = inst.status === "paid" ? "Pago" : isOverdue ? "Atrasado" : "Pendente";
                      const dotColor = inst.status === "paid" ? "bg-success" : isOverdue ? "bg-destructive" : "bg-warning";
                      const badgeColor = inst.status === "paid" ? "bg-success/10 text-success" : isOverdue ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning";

                      return (
                        <div key={inst.id} className="flex items-center gap-3 py-2.5">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-foreground">
                              {inst.installment_number === 0 ? "Entrada" : `Parcela ${inst.installment_number}`}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{formatDate(inst.due_date)}</p>
                          </div>
                          <p className="text-sm font-mono text-foreground">{formatCurrency(Number(inst.amount))}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${badgeColor}`}>
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ========== SEÇÃO 4: HISTÓRICO ========== */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Histórico de Pagamentos
          </span>
        </div>

        <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {(!billing || billing.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum pagamento registrado
            </p>
          ) : (
            billing.map((b: any) => {
              const isOverdue =
                b.status === "pending" && new Date(b.due_date) < today;
              const statusLabel =
                b.status === "paid"
                  ? "Pago"
                  : isOverdue
                    ? "Atrasado"
                    : "Pendente";
              const dotColor =
                b.status === "paid"
                  ? "bg-success"
                  : isOverdue
                    ? "bg-destructive"
                    : "bg-warning";
              const badgeColor =
                b.status === "paid"
                  ? "bg-success/10 text-success"
                  : isOverdue
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning";

              return (
                <div
                  key={b.id}
                  className="flex items-center gap-4 px-5 py-3.5"
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground truncate">
                      {b.description || typeLabels[b.type] || b.type}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(b.due_date)}
                    </p>
                  </div>
                  <p className="text-sm font-mono text-foreground whitespace-nowrap">
                    {formatCurrency(Number(b.amount))}
                  </p>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${badgeColor}`}
                  >
                    {statusLabel}
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
