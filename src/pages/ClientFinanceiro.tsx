import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { MessageCircle, Check, X, AlertTriangle, Zap, ArrowRight } from "lucide-react";
import { AjudaRecolhida, CabecalhoDePagina, Carregando, EstadoVazio, Painel, Secao, botao, etiqueta, foco, juntar, lista, superficie, texto } from "@/components/sistema";
import { Progress } from "@/components/ui/progress";
import { getProjectBrand } from "@/lib/brandHelpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

function receivedOf(row: any) {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClientFinanceiro() {
  const { user, profile: authProfile } = useAuth();
  const { clientId, profile, isImpersonating } = useClientIdentity();
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
  const [rechargePopup, setRechargePopup] = useState<any>(null);
  const [popupShown, setPopupShown] = useState(false);

  // Auto-open popup when there are pending recharges
  useEffect(() => {
    if (pendingRecharges.length > 0 && !popupShown) {
      setRechargePopup(pendingRecharges[0]);
      setPopupShown(true);
    }
  }, [pendingRecharges.length, popupShown]);
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
    if (isImpersonating) {
      toast.error("O modo de visualização do cliente é somente leitura");
      return;
    }
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
    toast.success("Recarga confirmada. O saldo atualiza em seguida.");
  };

  const handleRejectRecharge = async (requestId: string) => {
    if (isImpersonating) {
      toast.error("O modo de visualização do cliente é somente leitura");
      return;
    }
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
    toast.success("Recarga recusada");
  };

  const openWhatsApp = (message: string) => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  };

  const statusDoPagamento = (status: string, dueDate: string) => {
    const isOverdue = status === "pending" && new Date(dueDate) < today;
    return {
      label: status === "paid" ? "Pago" : status === "partial" ? "Parcial" : isOverdue ? "Atrasado" : "Pendente",
      dot: status === "paid" ? "bg-success" : status === "partial" ? "bg-info" : isOverdue ? "bg-destructive" : "bg-warning",
      badge: status === "paid" ? "bg-success/10 text-success" : status === "partial" ? "bg-info/10 text-info" : isOverdue ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
    };
  };
  const falarSobreRenovacao = () => openWhatsApp("Olá! Gostaria de falar sobre a renovação do meu plano.");

  // ===== RENDER =====
  return (
    <div className="w-full min-w-0 space-y-6">
      <CabecalhoDePagina
        titulo="Financeiro"
        descricao={pendingRecharges.length ? `${pendingRecharges.length} ${pendingRecharges.length === 1 ? "recarga esperando você" : "recargas esperando você"}` : undefined}
        ajuda="Seu plano, o saldo dos anúncios, as recargas que a equipe pediu e o histórico de pagamentos. Recarga só acontece depois que você confirma."
        acoes={
          latestPlan && (
            <button type="button" onClick={falarSobreRenovacao} className={botao.secundario} aria-label="Falar sobre renovação">
              <MessageCircle className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Falar sobre renovação</span>
            </button>
          )
        }
      />

      {/* ===== LOADING ===== */}
      {loadingBilling ? (
        <Carregando forma="aba" rotulo="Carregando dados financeiros" />
      ) : (
      <>
      {/* ========== SEÇÃO 1: MEU PLANO ========== */}
      <Secao titulo="Plano">
        {latestPlan ? (
          <>
            <div className="flex min-w-0 flex-wrap items-end justify-between">
              <div className="mr-4 min-w-0">
                <p className={juntar(texto.tituloSecao, "truncate")}>{latestPlan.description || "Plano Mensal"}</p>
                <p className={juntar(texto.numero, "mt-1 font-light")}>
                  {formatCurrency(Number(latestPlan.amount))}
                  <span className="ml-1 text-[13px] font-normal text-muted-foreground">/mês</span>
                </p>
              </div>
              <div className="mt-2 flex items-center">
                <span className={juntar(etiqueta, planStatusColor)}>{planStatusLabel}</span>
                {renewalDate && <span className={juntar(texto.auxiliar, "ml-2")}>Renova em {formatDate(renewalDateStr!)}</span>}
              </div>
            </div>

            {renewalDate && (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${timePercent}%` }} />
                </div>
                <p className={juntar(texto.auxiliar, "mt-1.5")}>{daysLeft > 0 ? `${daysLeft} dias restantes` : "Período vencido"}</p>
              </div>
            )}
          </>
        ) : (
          <p className={texto.auxiliar}>Nenhum plano encontrado</p>
        )}
      </Secao>

      {/* ========== SEÇÃO 2: INVESTIMENTO EM ANÚNCIOS ========== */}
      {showTraffic && (wallets || []).length > 0 && (
        <Secao
          divisoria
          titulo="Saldo de anúncios"
          descricao={pendingRecharges.length === 0 ? "Nenhuma recarga pendente" : undefined}
          ajuda="Quanto ainda tem de saldo em cada plataforma. A barra enche até R$ 2.000; abaixo de R$ 500 a equipe já avisa que vai precisar de recarga."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                  ? "Saldo OK"
                  : balance > 100
                    ? "Saldo baixo"
                    : balance === 0
                      ? "Sem saldo"
                      : "Saldo crítico";
              const statusTextColor =
                balance > 500
                  ? "text-success"
                  : balance > 100
                    ? "text-warning"
                    : "text-destructive";

              return (
                <Painel key={w.id}>
                  <p className={texto.rotulo}>{platformLabels[w.platform] || w.platform}</p>
                  <p className="mt-1.5 text-xl font-light tabular-nums text-foreground">{formatCurrency(balance)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className={`h-full rounded-full ${gaugeColor}`} style={{ width: `${gaugePercent}%` }} />
                  </div>
                  <p className="mt-1.5 truncate text-[12px] leading-4">
                    <span className={statusTextColor}>{statusText}</span>
                    {w.last_recharge_date && <span className="text-muted-foreground"> · última recarga {formatDate(w.last_recharge_date)}</span>}
                  </p>
                </Painel>
              );
            })}
          </div>
        </Secao>
      )}

      {/* ========== SEÇÃO 3: RECARGAS PENDENTES ========== */}
      {pendingRecharges.length > 0 && (
        <Secao
          divisoria
          recolher={`financeiro:recargas:${clientId || ""}`}
          titulo={
            <span className="inline-flex min-w-0 items-center">
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="truncate">Recargas para confirmar</span>
            </span>
          }
          descricao={`${pendingRecharges.length} ${pendingRecharges.length === 1 ? "pedido" : "pedidos"} da equipe`}
        >
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {pendingRecharges.map((r: any) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setRechargePopup(r)}
                  className={juntar("flex w-full min-w-0 items-center rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/40", foco)}
                >
                  <Zap className="mr-3 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">Recarga {platformLabels[r.platform] || r.platform}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      Pedido em {formatDate(r.created_at)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </span>
                  </span>
                  <span className="ml-3 text-[15px] font-semibold tabular-nums text-foreground">{formatCurrency(Number(r.amount))}</span>
                  <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {/* ========== SEÇÃO: PROJETOS INDIVIDUAIS ========== */}
      {(myProjectPayments || []).length > 0 && (
        <Secao divisoria titulo="Projetos avulsos">
          <div className="space-y-3">
            {(myProjectPayments || []).map((pp: any) => {
              const installments = pp.installments || [];
              const paid = installments.reduce((s: number, i: any) => s + (i.status === "paid" ? Number(i.amount) : i.status === "partial" ? Number(i.paid_amount || 0) : 0), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const remaining = Number(pp.total_value) - paid;
              const sortedInstallments = [...installments].sort((a: any, b: any) => a.installment_number - b.installment_number);

              return (
                <Painel key={pp.id}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between">
                    <div className="mr-4 min-w-0">
                      <div className="flex min-w-0 items-center">
                        <p className="mr-2 truncate text-[14px] font-semibold text-foreground">{pp.project?.name || "Projeto"}</p>
                        <span className={juntar(etiqueta, "bg-secondary text-muted-foreground")}>{getProjectBrand(pp.project?.project_type)}</span>
                      </div>
                      <p className="mt-1 text-xl font-light tabular-nums text-foreground">{formatCurrency(Number(pp.total_value))}</p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="text-[12px] text-success">{formatCurrency(paid)} pago</p>
                      {remaining > 0 && <p className="text-[12px] text-warning">{formatCurrency(remaining)} restante</p>}
                    </div>
                  </div>

                  <div className="mt-3">
                    <Progress value={pct} className="h-1.5" />
                    <p className={juntar(texto.auxiliar, "mt-1")}>{pct}% concluído</p>
                  </div>

                  <ul className="mt-2 divide-y divide-border">
                    {sortedInstallments.map((inst: any) => {
                      const st = statusDoPagamento(inst.status, inst.due_date);
                      return (
                        <li key={inst.id} className="flex min-w-0 items-center py-2.5">
                          <span className={`mr-3 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] text-foreground">
                              {inst.installment_number === 0 ? "Entrada" : `Parcela ${inst.installment_number}`}
                            </p>
                            <p className={texto.auxiliar}>{formatDate(inst.due_date)}</p>
                          </div>
                          <div className="ml-2 whitespace-nowrap text-right tabular-nums">
                            <p className={`text-[13px] ${inst.status === "partial" ? "text-info" : "text-foreground"}`}>
                              {formatCurrency(inst.status === "pending" ? Number(inst.amount) : receivedOf(inst))}
                            </p>
                            {inst.status === "partial" && <p className="text-[11px] text-muted-foreground">de {formatCurrency(Number(inst.amount))}</p>}
                          </div>
                          <span className={juntar(etiqueta, "ml-2", st.badge)}>{st.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Painel>
              );
            })}
          </div>
        </Secao>
      )}

      {/* ========== SEÇÃO 4: HISTÓRICO ========== */}
      <Secao divisoria titulo="Pagamentos" descricao={billing && billing.length ? `${billing.length} ${billing.length === 1 ? "registro" : "registros"}` : undefined}>
        {(!billing || billing.length === 0) ? (
          <EstadoVazio compacto titulo="Nenhum pagamento registrado." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {billing.map((b: any) => {
              const st = statusDoPagamento(b.status, b.due_date);
              return (
                <li key={b.id} className="flex min-w-0 items-center px-2 py-3">
                  <span className={`mr-3 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{b.description || typeLabels[b.type] || b.type}</p>
                    <p className={texto.auxiliar}>{formatDate(b.due_date)}</p>
                  </div>
                  <div className="ml-2 whitespace-nowrap text-right tabular-nums">
                    <p className={`text-[13px] ${b.status === "partial" ? "text-info" : "text-foreground"}`}>
                      {formatCurrency(b.status === "pending" ? Number(b.amount) : receivedOf(b))}
                    </p>
                    {b.status === "partial" && <p className="text-[11px] text-muted-foreground">de {formatCurrency(Number(b.amount))}</p>}
                  </div>
                  <span className={juntar(etiqueta, "ml-2", st.badge)}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
      </>
      )}

      {/* ========== POPUP: DETALHES DA RECARGA ========== */}
      <Dialog open={!!rechargePopup} onOpenChange={(open) => { if (!open) setRechargePopup(null); }}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          {rechargePopup && (() => {
            const r = rechargePopup;
            const platform = platformLabels[r.platform] || r.platform;
            // Extract period from reason
            const isPeriodic = r.reason?.includes("semanal") || r.reason?.includes("mensal");
            const period = r.reason?.includes("mensal") ? "mensal" : "semanal";

            return (
              <>
                <div className="border-b border-border px-5 py-4">
                  <div className="flex items-center">
                    <Zap className="mr-2 h-4 w-4 text-warning" aria-hidden="true" />
                    <DialogTitle className={texto.tituloSecao}>Recarga de anúncios</DialogTitle>
                    <AjudaRecolhida className="ml-1.5" titulo="Como funciona">
                      <ol className="list-inside list-decimal space-y-1">
                        <li>A equipe viu que {platform} precisa de investimento.</li>
                        <li>Depois que você confirma, a recarga é feita na plataforma.</li>
                        <li>O saldo atualiza sozinho no seu painel.</li>
                        <li>Você acompanha os resultados nos relatórios.</li>
                      </ol>
                    </AjudaRecolhida>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5")}>{platform} · pedido em {formatDate(r.created_at)}</p>
                </div>

                <div className="space-y-4 px-5 py-5">
                  <div className="text-center">
                    <p className="text-3xl font-semibold tabular-nums text-foreground">{formatCurrency(Number(r.amount))}</p>
                    {isPeriodic && <p className={juntar(texto.auxiliar, "mt-1")}>Investimento {period} em anúncios</p>}
                  </div>

                  {r.reason && (
                    <div className={juntar(superficie.poco, "px-3 py-2.5")}>
                      <p className={juntar(texto.rotulo, "mb-0.5")}>Observação da equipe</p>
                      <p className="text-[13px] text-foreground">{r.reason}</p>
                    </div>
                  )}

                  {/* Actions */}
                  {isImpersonating ? (
                    <p className="text-center text-[12px] text-sky-500" role="note">
                      Somente leitura: nenhuma decisão pode ser registrada neste modo.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleConfirmRecharge(r.id, Number(r.amount), r.platform);
                          setRechargePopup(null);
                        }}
                        className={juntar(botao.primario, "h-11 w-full")}
                      >
                        <Check className="mr-1.5 h-4 w-4" />
                        Confirmar pagamento
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            openWhatsApp(
                              `Olá! Sobre a recarga de ${formatCurrency(Number(r.amount))} para ${platform}, gostaria de conversar antes de confirmar.`
                            );
                          }}
                          className={botao.secundario}
                        >
                          <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                          Conversar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleRejectRecharge(r.id);
                            setRechargePopup(null);
                          }}
                          className={botao.perigo}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Recusar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
