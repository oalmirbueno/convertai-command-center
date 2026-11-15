import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { toast } from "sonner";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { MessageCircle, Check, X, AlertTriangle, Zap, ArrowRight, Clock } from "lucide-react";
import { AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, Secao, botao, espaco, juntar, superficie, texto } from "@/components/sistema";
import { Card, CardSurface, Chip, List, ListRow, PageHeader, ProgressBar, StatCard, StatusPill, type Tone } from "@/components/ds";
import { Bolha, type TomDaBolha } from "@/components/client/pecasOusadas";
import { getProjectBrand } from "@/lib/brandHelpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseAppDate } from "@/lib/dateBR";
import { cobrancaAtrasada, dataDoPortal } from "@/lib/clientes/cobrancaDoPortal";

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

// DATE ("AAAA-MM-DD") lido como dia de calendário: `new Date(d)` mostrava o vencimento um dia antes em UTC-3.
const formatDate = (d: string) => dataDoPortal(d);

export default function ClientFinanceiro() {
  const { user, profile: authProfile } = useAuth();
  const { clientId, profile, isImpersonating } = useClientIdentity();
  const queryClient = useQueryClient();

  // ===== QUERIES =====
  // As leituras lançam o erro em vez de devolver []: uma falha (RLS, rede) virava "nenhuma cobrança",
  // "nenhuma recarga" e, no refetch de 15 s, apagava a lista que já estava na tela. Com o erro, o
  // react-query mantém o último dado bom e a tela avisa que não conseguiu carregar.
  const { data: billing, isLoading: loadingBilling, isError: erroNoBilling } = useQuery({
    queryKey: ["billing-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing")
        .select("*")
        .eq("client_id", clientId!)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const { data: wallets, isError: erroNasWallets } = useQuery({
    queryKey: ["ads-wallet-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ads_wallet")
        .select("*")
        .eq("client_id", clientId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const { data: rechargeRequests, isError: erroNasRecargas } = useQuery({
    queryKey: ["recharge-requests-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recharge_requests")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
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
  const renewalDate = renewalDateStr ? parseAppDate(renewalDateStr) : null;
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
  const planStatusTone: Tone = planStatus === "active" ? "success" : planStatus === "warning" ? "warning" : "danger";

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
    // Só confirma o que ainda está pendente e confere a linha gravada: antes o cliente via "Recarga
    // confirmada" e a agência era avisada mesmo quando o update falhava (RLS, rede) ou o pedido já tinha
    // sido recusado, e o status continuava "pending".
    const { data: gravados, error } = await supabase
      .from("recharge_requests")
      .update({ status: "approved" })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (error || !gravados || gravados.length === 0) {
      queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
      toast.error(error ? "Não consegui confirmar a recarga. Tente de novo." : "Esta recarga não está mais aguardando sua confirmação.");
      return;
    }
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
    // Mesma guarda da confirmação: sem linha gravada, não avisa a agência nem diz que recusou.
    const { data: gravados, error } = await supabase
      .from("recharge_requests")
      .update({ status: "rejected" })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (error || !gravados || gravados.length === 0) {
      queryClient.invalidateQueries({ queryKey: ["recharge-requests-client"] });
      toast.error(error ? "Não consegui recusar a recarga. Tente de novo." : "Esta recarga não está mais aguardando sua confirmação.");
      return;
    }
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
    const isOverdue = cobrancaAtrasada(status, dueDate);
    return {
      label: status === "paid" ? "Pago" : status === "partial" ? "Parcial" : isOverdue ? "Atrasado" : "Pendente",
      tone: (status === "paid" ? "success" : status === "partial" ? "info" : isOverdue ? "danger" : "warning") as Tone,
    };
  };
  const falarSobreRenovacao = () => openWhatsApp("Olá! Gostaria de falar sobre a renovação do meu plano.");

  // ===== RENDER =====
  const temRecargaPendente = pendingRecharges.length > 0;
  const corDoPlano = planStatus === "active" ? "text-primary" : planStatus === "warning" ? "text-warning" : "text-destructive";
  const iconeDoPagamento = (status: string, tone: Tone) =>
    status === "paid" ? <Check className="h-4 w-4" /> : tone === "danger" ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />;
  const tomDaBolha = (tone: Tone): TomDaBolha => (tone === "success" ? "sucesso" : tone === "info" ? "info" : tone === "danger" ? "perigo" : "alerta");

  return (
    <div className={juntar(espaco.pagina, "w-full")}>
      <PageHeader
        title="Financeiro"
        subtitle={temRecargaPendente ? `${pendingRecharges.length} ${pendingRecharges.length === 1 ? "recarga esperando você" : "recargas esperando você"}` : undefined}
        help="Seu plano, o saldo dos anúncios, as recargas que a equipe pediu e o histórico de pagamentos. Recarga só acontece depois que você confirma."
        actions={
          latestPlan && (
            <button type="button" onClick={falarSobreRenovacao} className={botao.secundario} aria-label="Falar sobre renovação">
              <MessageCircle className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Falar sobre renovação</span>
            </button>
          )
        }
      />

      {(erroNoBilling || erroNasWallets || erroNasRecargas) && (
        <EstadoDeErro
          titulo="Não consegui carregar parte do seu financeiro."
          descricao="Os dados abaixo podem estar incompletos. A página tenta de novo sozinha em alguns segundos."
        />
      )}

      {/* ===== LOADING ===== */}
      {loadingBilling ? (
        <Carregando forma="aba" rotulo="Carregando dados financeiros" />
      ) : (
      <>
      {/* ========== SEÇÃO 1: MEU PLANO (cartão de tinta) + SEÇÃO 3: RECARGAS PARA CONFIRMAR (cartão sólido) ========== */}
      <div className={juntar(espaco.grade, "grid-cols-1 items-stretch", temRecargaPendente && "lg:grid-cols-5")}>
        <Card title="Plano" variant="ink" collapsible={false} className={temRecargaPendente ? "lg:col-span-3" : undefined}>
          {latestPlan ? (
            <>
              <div className="flex min-w-0 flex-wrap items-end justify-between">
                <div className="mr-4 min-w-0">
                  <p className={juntar(texto.rotulo, "truncate")}>{latestPlan.description || "Plano Mensal"}</p>
                  <p className="mt-2 text-[48px] font-semibold leading-[52px] tracking-[-0.04em] tabular-nums text-foreground max-sm:text-[32px] max-sm:leading-10">
                    {formatCurrency(Number(latestPlan.amount))}
                    <span className="ml-1.5 text-[15px] font-normal tracking-normal text-muted-foreground">/mês</span>
                  </p>
                </div>
                <div className="mt-3 flex min-w-0 items-center">
                  <StatusPill tone={planStatusTone}>{planStatusLabel}</StatusPill>
                  {renewalDate && <span className={juntar(texto.auxiliar, "ml-2.5")}>Renova em {formatDate(renewalDateStr!)}</span>}
                </div>
              </div>

              {renewalDate && (
                <div className="mt-6 sm:mt-8">
                  <ProgressBar value={timePercent} max={100} height={10} striped className={corDoPlano} label={`${Math.round(timePercent)}% do período do plano`} />
                  <p className="mt-2.5 flex min-w-0 items-baseline text-[13px] leading-5 text-muted-foreground">
                    {daysLeft > 0 ? (
                      <>
                        <span className="mr-1.5 text-[20px] font-semibold leading-7 tabular-nums text-foreground">{daysLeft}</span>
                        dias restantes
                      </>
                    ) : (
                      "Período vencido"
                    )}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className={texto.auxiliar}>Nenhum plano encontrado</p>
          )}
        </Card>

        {temRecargaPendente && (
          <Card
            variant="accent"
            className="lg:col-span-2"
            collapsible={`financeiro:recargas:${clientId || ""}`}
            title={
              <span className="inline-flex min-w-0 items-center">
                <AlertTriangle className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Recargas para confirmar</span>
              </span>
            }
            subtitle={`${pendingRecharges.length} ${pendingRecharges.length === 1 ? "pedido" : "pedidos"} da equipe`}
          >
            <List label="Recargas para confirmar">
              {pendingRecharges.map((r: any) => (
                <ListRow
                  key={r.id}
                  onClick={() => setRechargePopup(r)}
                  leading={<Bolha tom="tinta"><Zap className="h-4 w-4" /></Bolha>}
                  title={`Recarga ${platformLabels[r.platform] || r.platform}`}
                  subtitle={
                    <>
                      Pedido em {formatDate(r.created_at)}
                      {r.reason ? <span className="hidden sm:inline">{` · ${r.reason}`}</span> : ""}
                    </>
                  }
                  value={<span className="whitespace-nowrap text-[15px]">{formatCurrency(Number(r.amount))}</span>}
                  action={<ArrowRight className="pointer-events-none h-4 w-4" aria-hidden="true" />}
                />
              ))}
            </List>
          </Card>
        )}
      </div>

      {/* ========== SEÇÃO 2: INVESTIMENTO EM ANÚNCIOS ========== */}
      {showTraffic && (wallets || []).length > 0 && (
        <Secao
          titulo="Saldo de anúncios"
          descricao={pendingRecharges.length === 0 ? "Nenhuma recarga pendente" : undefined}
          ajuda="Quanto ainda tem de saldo em cada plataforma. A barra enche até R$ 2.000; abaixo de R$ 500 a equipe já avisa que vai precisar de recarga."
        >
          <div className={juntar(espaco.grade, "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3")}>
            {(wallets || []).map((w: any) => {
              const balance = Number(w.balance);
              const gaugeColor =
                balance > 500
                  ? "text-success"
                  : balance > 100
                    ? "text-warning"
                    : "text-destructive";
              const statusText =
                balance > 500
                  ? "Saldo OK"
                  : balance > 100
                    ? "Saldo baixo"
                    : balance === 0
                      ? "Sem saldo"
                      : "Saldo crítico";
              const statusTone: Tone = balance > 500 ? "success" : balance > 100 ? "warning" : "danger";

              return (
                <StatCard
                  key={w.id}
                  size="xl"
                  icon={<Zap className="h-4 w-4" />}
                  label={platformLabels[w.platform] || w.platform}
                  value={formatCurrency(balance)}
                  corner={<StatusPill tone={statusTone}>{statusText}</StatusPill>}
                  chart={
                    <>
                      <ProgressBar value={Math.min(Math.max(balance, 0), 2000)} max={2000} height={10} striped className={gaugeColor} label={`Saldo de ${formatCurrency(balance)}; a barra enche até R$ 2.000`} />
                      {w.last_recharge_date && <span className={juntar(texto.auxiliar, "mt-2.5 block min-w-0 truncate")}>última recarga {formatDate(w.last_recharge_date)}</span>}
                    </>
                  }
                />
              );
            })}
          </div>
        </Secao>
      )}

      {/* ========== SEÇÃO: PROJETOS INDIVIDUAIS ========== */}
      {(myProjectPayments || []).length > 0 && (
        <Secao titulo="Projetos avulsos">
          <div className="space-y-4 sm:space-y-5">
            {(myProjectPayments || []).map((pp: any) => {
              const installments = pp.installments || [];
              const paid = installments.reduce((s: number, i: any) => s + (i.status === "paid" ? Number(i.amount) : i.status === "partial" ? Number(i.paid_amount || 0) : 0), 0);
              const pct = pp.total_value > 0 ? Math.round((paid / Number(pp.total_value)) * 100) : 0;
              const remaining = Number(pp.total_value) - paid;
              const sortedInstallments = [...installments].sort((a: any, b: any) => a.installment_number - b.installment_number);

              return (
                <CardSurface key={pp.id} padded>
                  <div className="flex min-w-0 flex-wrap items-end justify-between">
                    <div className="mr-4 min-w-0">
                      <div className="flex min-w-0 items-center">
                        <p className="mr-2 truncate text-[15px] font-semibold leading-5 text-foreground">{pp.project?.name || "Projeto"}</p>
                        <Chip>{getProjectBrand(pp.project?.project_type)}</Chip>
                      </div>
                      <p className={juntar(texto.numeroGrande, "mt-2")}>{formatCurrency(Number(pp.total_value))}</p>
                    </div>
                    <div className="mt-2 text-right tabular-nums">
                      <p className="text-[13px] font-medium leading-5 text-success">{formatCurrency(paid)} pago</p>
                      {remaining > 0 && <p className="text-[13px] leading-5 text-warning">{formatCurrency(remaining)} restante</p>}
                    </div>
                  </div>

                  <div className="mt-5">
                    <ProgressBar value={paid} max={Number(pp.total_value)} height={10} tone={1} striped label={`${pct}% pago`} />
                    <p className={juntar(texto.auxiliar, "mt-2")}>{pct}% concluído</p>
                  </div>

                  <List className="mt-3" label={`Parcelas de ${pp.project?.name || "Projeto"}`}>
                    {sortedInstallments.map((inst: any) => {
                      const st = statusDoPagamento(inst.status, inst.due_date);
                      return (
                        <ListRow
                          key={inst.id}
                          dense
                          leading={<Bolha tom={tomDaBolha(st.tone)} tamanho="sm">{iconeDoPagamento(inst.status, st.tone)}</Bolha>}
                          title={inst.installment_number === 0 ? "Entrada" : `Parcela ${inst.installment_number}`}
                          subtitle={formatDate(inst.due_date)}
                          status={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
                          value={<span className={juntar("whitespace-nowrap", inst.status === "partial" && "text-info")}>{formatCurrency(inst.status === "pending" ? Number(inst.amount) : receivedOf(inst))}</span>}
                          valueHint={inst.status === "partial" ? `de ${formatCurrency(Number(inst.amount))}` : undefined}
                        />
                      );
                    })}
                  </List>
                </CardSurface>
              );
            })}
          </div>
        </Secao>
      )}

      {/* ========== SEÇÃO 4: HISTÓRICO ========== */}
      <Card title="Pagamentos" subtitle={billing && billing.length ? `${billing.length} ${billing.length === 1 ? "registro" : "registros"}` : undefined}>
        {(!billing || billing.length === 0) ? (
          <EstadoVazio compacto titulo="Nenhum pagamento registrado." />
        ) : (
          <List label="Pagamentos">
            {billing.map((b: any) => {
              const st = statusDoPagamento(b.status, b.due_date);
              return (
                <ListRow
                  key={b.id}
                  leading={<Bolha tom={tomDaBolha(st.tone)}>{iconeDoPagamento(b.status, st.tone)}</Bolha>}
                  title={b.description || typeLabels[b.type] || b.type}
                  subtitle={formatDate(b.due_date)}
                  status={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
                  value={<span className={juntar("whitespace-nowrap", b.status === "partial" && "text-info")}>{formatCurrency(b.status === "pending" ? Number(b.amount) : receivedOf(b))}</span>}
                  valueHint={b.status === "partial" ? `de ${formatCurrency(Number(b.amount))}` : undefined}
                />
              );
            })}
          </List>
        )}
      </Card>
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
                    <p className="text-[40px] font-semibold leading-[44px] tracking-[-0.035em] tabular-nums text-foreground">{formatCurrency(Number(r.amount))}</p>
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
                    <p className="text-center text-[12px] text-info" role="note">
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
