import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Link2,
  FileText,
  Megaphone,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService } from "@/lib/clientFlags";
import {
  collectAdsMetricsNow,
  connectAdsAccount,
  saveMetaAdsToken,
  useAdsCampaigns,
  useAdsConnection,
  useAdsDaily,
  type AdsCampaign,
  type AdsDaily,
} from "@/hooks/useAdsMetrics";
import {
  clientCampaignLine,
  clientCampaignSentence,
  dinheiro,
  numero,
  statusLabel,
  summarizeAccount,
  summarizeCampaign,
  teamAlert,
  teamCampaignLine,
  EXPLICACOES,
} from "@/lib/adsLanguage";

/**
 * A área de anúncios, no mesmo formato da de métricas do Instagram: um hub por
 * cliente, e o dossiê completo ao clicar.
 *
 * A diferença é para QUEM cada linha fala. A mesma campanha aparece duas vezes
 * na tela do dossiê: em cima, do jeito que o cliente vai ler no relatório; logo
 * abaixo, com os números que a equipe usa para decidir. Ver as duas juntas é o
 * que evita o relatório bonito que esconde uma campanha cara.
 */

const TOM: Record<string, string> = {
  ativa: "bg-success/10 text-success",
  pausada: "bg-muted text-muted-foreground",
  encerrada: "bg-muted text-muted-foreground",
  atencao: "bg-destructive/10 text-destructive",
};

function StatusChip({ campaign }: { campaign?: AdsCampaign }) {
  const { label, tone } = statusLabel(campaign?.status, campaign?.effective_status);
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TOM[tone]}`}>
      {label}
    </span>
  );
}

/** Um número com o que ele quer dizer logo embaixo, para não precisar explicar. */
function Numero({
  rotulo,
  valor,
  explicacao,
}: {
  rotulo: string;
  valor: string;
  explicacao?: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {rotulo}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{valor}</p>
      {explicacao && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{explicacao}</p>
      )}
    </div>
  );
}

/** Dossiê de UM cliente: a carteira dele e cada campanha nas duas leituras. */
function ClientAdsDetail({
  clientId,
  clientName,
  rows,
  campaigns,
  onBack,
}: {
  clientId: string;
  clientName: string;
  rows: AdsDaily[];
  campaigns: AdsCampaign[];
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const porCampanha = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of rows) {
      const lista = mapa.get(row.campaign_id) || [];
      lista.push(row);
      mapa.set(row.campaign_id, lista);
    }
    return [...mapa.entries()]
      .map(([id, lista]) => ({
        resumo: summarizeCampaign(lista)!,
        ficha: campaigns.find((c) => c.campaign_id === id),
      }))
      .filter((item) => item.resumo)
      .sort((a, b) => b.resumo.investido - a.resumo.investido);
  }, [rows, campaigns]);

  const carteira = useMemo(() => summarizeAccount(rows), [rows]);

  /**
   * Abre o relatório já preenchido com o que a Meta devolveu.
   *
   * O resumo sai na língua do cliente (a mesma camada que alimenta o portal),
   * e os números vão nos nomes que o relatório já entende — nada de digitar de
   * novo o que o painel acabou de ler.
   */
  const gerarRelatorio = () => {
    const dias = [...rows].map((row) => row.day).sort();
    const linhas = porCampanha
      .map(({ resumo }) => `· ${resumo.name}: ${clientCampaignLine(resumo)}`)
      .join("\n");

    const parametros = new URLSearchParams({
      cliente: clientId,
      titulo: `Anúncios · ${clientName}`,
      inicio: dias[0] || "",
      fim: dias[dias.length - 1] || "",
      resumo: `Resumo dos anúncios no período:\n${linhas}`,
      destaques: porCampanha[0] ? clientCampaignSentence(porCampanha[0].resumo) : "",
      metricas: JSON.stringify({
        ad_spend: Number(carteira.investido.toFixed(2)),
        reach: carteira.alcance,
        ...(carteira.resultados != null ? { results: carteira.resultados } : {}),
      }),
    });
    navigate(`/relatorios/novo?${parametros.toString()}`);
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Todos os clientes
      </button>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{clientName}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Últimos 30 dias · {carteira.campanhas}{" "}
              {carteira.campanhas === 1 ? "campanha" : "campanhas"}
            </p>
          </div>
          {/* O relatório de anúncios nasce aqui, onde o dado está. Antes era
              exportar a planilha do Gerenciador e subir em Relatórios; agora
              os números já vêm preenchidos e ninguém redigita. */}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={gerarRelatorio}>
            <FileText className="h-3.5 w-3.5" /> Gerar relatório
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Numero
            rotulo="Investido"
            valor={dinheiro(carteira.investido)}
            explicacao={EXPLICACOES.investido}
          />
          <Numero
            rotulo="Pessoas alcançadas"
            valor={numero(carteira.alcance)}
            explicacao={EXPLICACOES.alcance}
          />
          {carteira.resultados != null && (
            <Numero
              rotulo="Resultados"
              valor={numero(carteira.resultados)}
              explicacao={EXPLICACOES.resultados}
            />
          )}
        </div>
      </div>

      {porCampanha.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma campanha com movimento nos últimos 30 dias nesta conta.
        </div>
      ) : (
        porCampanha.map(({ resumo, ficha }) => {
          const alerta = teamAlert(resumo);
          return (
            <div key={resumo.campaignId} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{resumo.name}</p>
                <StatusChip campaign={ficha} />
              </div>

              {/* A leitura do cliente, exatamente como sai no relatório dele. */}
              <div className="mt-3 rounded-xl border border-border/60 bg-secondary/40 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Como o cliente lê
                </p>
                <p className="mt-1 text-xs leading-relaxed text-foreground">
                  {clientCampaignSentence(resumo)}
                </p>
              </div>

              {/* E os números de operar. */}
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {teamCampaignLine(resumo)}
              </p>

              {ficha?.daily_budget != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Verba diária configurada: {dinheiro(Number(ficha.daily_budget))}
                </p>
              )}

              {alerta && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-[11px] leading-relaxed text-foreground">{alerta}</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** Ligar a conta de anúncios: o token da agência e o número de cada conta. */
function ConexaoAds({ onDone }: { onDone: () => void }) {
  const { data: conexao } = useAdsConnection();
  const { data: clients } = useClients();
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [clientId, setClientId] = useState("");
  const [actId, setActId] = useState("");
  const [nome, setNome] = useState("");

  const comTrafego = (clients || []).filter((client: any) => hasService(client, "trafego"));

  const salvarToken = async () => {
    setSalvando(true);
    try {
      await saveMetaAdsToken(token, "Token da agência");
      setToken("");
      toast.success("Token guardado no cofre.");
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível guardar.");
    } finally {
      setSalvando(false);
    }
  };

  const ligarConta = async () => {
    setSalvando(true);
    try {
      await connectAdsAccount({ clientId, actId, displayName: nome });
      setActId("");
      setNome("");
      toast.success("Conta ligada. A primeira leitura chega em alguns minutos.");
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível ligar a conta.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">1. Token de leitura</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Um token só, do Business Manager da Aceleriq, cobre todas as contas de anúncio
          que já estão sob a nossa gestão. Ele é guardado no cofre do banco e nunca mais
          aparece nesta tela — nem para nós.
        </p>
        {conexao?.agencia ? (
          <p className="mt-2 text-[11px] text-success">
            Token guardado em{" "}
            {new Date(conexao.agencia.saved_at).toLocaleDateString("pt-BR")}. Salvar outro
            substitui este.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">Nenhum token guardado ainda.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Colar o token aqui"
            className="min-w-[240px] flex-1 rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <Button size="sm" onClick={salvarToken} disabled={salvando || token.trim().length < 20}>
            Guardar no cofre
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">2. Contas de anúncio</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          O número da conta está no Gerenciador de Anúncios, no formato act_123456789.
          Pode colar com ou sem o "act_".
        </p>

        {(conexao?.contas || []).length > 0 && (
          <div className="mt-3 space-y-1.5">
            {conexao!.contas.map((conta) => (
              <div
                key={conta.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2"
              >
                <div>
                  <p className="text-xs font-medium text-foreground">{conta.display_name}</p>
                  <p className="text-[10px] text-muted-foreground">act_{conta.external_id}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {conta.ultima_coleta
                    ? `Lida ${new Date(conta.ultima_coleta).toLocaleString("pt-BR")}`
                    : "Aguardando a primeira leitura"}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
          >
            <option value="">Cliente...</option>
            {comTrafego.map((client: any) => (
              <option key={client.id} value={client.id}>
                {client.company_name || client.full_name}
              </option>
            ))}
          </select>
          <input
            value={actId}
            onChange={(event) => setActId(event.target.value)}
            placeholder="act_123456789"
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Como chamar esta conta"
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <Button
          size="sm"
          className="mt-2 gap-2"
          onClick={ligarConta}
          disabled={salvando || !clientId || !actId.trim()}
        >
          <Link2 className="h-3.5 w-3.5" /> Ligar conta ao cliente
        </Button>
      </div>
    </div>
  );
}

export default function AdminAds() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState("");
  const [coletando, setColetando] = useState(false);
  const [mostrarConexao, setMostrarConexao] = useState(false);

  const clienteAberto = params.get("cliente") || "";
  const { data: rows, isLoading } = useAdsDaily(undefined, 30);
  const { data: campaigns } = useAdsCampaigns();
  const { data: clients } = useClients();
  const { data: conexao } = useAdsConnection();

  const nomes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const client of clients || []) {
      mapa.set(client.id, (client as any).company_name || (client as any).full_name || "Cliente");
    }
    return mapa;
  }, [clients]);

  const porCliente = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of rows || []) {
      const lista = mapa.get(row.client_id) || [];
      lista.push(row);
      mapa.set(row.client_id, lista);
    }
    return [...mapa.entries()].sort(
      (a, b) => summarizeAccount(b[1]).investido - summarizeAccount(a[1]).investido,
    );
  }, [rows]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return porCliente;
    return porCliente.filter(([clientId]) =>
      (nomes.get(clientId) || "").toLowerCase().includes(termo),
    );
  }, [porCliente, busca, nomes]);

  const atualizarAgora = async () => {
    setColetando(true);
    try {
      const resultado = await collectAdsMetricsNow();
      toast.success(
        `Leitura disparada para ${resultado.dispatched} consulta(s). Os números chegam em alguns minutos.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ads-daily"] }),
        queryClient.invalidateQueries({ queryKey: ["ads-campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["ads-connection"] }),
      ]);
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível atualizar agora.");
    } finally {
      setColetando(false);
    }
  };

  if (!isStaff) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  const semConta = (conexao?.contas || []).length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Megaphone className="h-5 w-5 text-primary" />
            Anúncios · Meta Ads real
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Um hub por cliente, com as campanhas puxadas direto da Meta de hora em hora.
            Clique para abrir: cada campanha aparece do jeito que o cliente lê e com os
            números que a equipe usa para decidir.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMostrarConexao((valor) => !valor)}
            className="gap-2"
          >
            <Link2 className="h-3.5 w-3.5" />
            {mostrarConexao ? "Fechar conexão" : "Conectar"}
          </Button>
          <Button size="sm" onClick={atualizarAgora} disabled={coletando} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${coletando ? "animate-spin" : ""}`} />
            {coletando ? "Atualizando..." : "Atualizar agora"}
          </Button>
        </div>
      </div>

      {mostrarConexao && (
        <ConexaoAds
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["ads-connection"] });
          }}
        />
      )}

      {clienteAberto ? (
        <ClientAdsDetail
          clientId={clienteAberto}
          clientName={nomes.get(clienteAberto) || "Cliente"}
          rows={(rows || []).filter((row) => row.client_id === clienteAberto)}
          campaigns={(campaigns || []).filter((row) => row.client_id === clienteAberto)}
          onBack={() => {
            const proximo = new URLSearchParams(params);
            proximo.delete("cliente");
            setParams(proximo, { replace: true });
          }}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando campanhas...</p>
      ) : semConta ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">
            Nenhuma conta de anúncios ligada ainda.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Clique em "Conectar" para guardar o token da agência e ligar a conta de cada
            cliente. A partir daí o painel lê as campanhas sozinho, de hora em hora, e a
            planilha do Gerenciador deixa de ser necessária.
          </p>
        </div>
      ) : porCliente.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          As contas estão ligadas e a primeira leitura está a caminho. Clique em "Atualizar
          agora" para apressar; os números aparecem aqui em alguns minutos.
        </div>
      ) : (
        <>
          {porCliente.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar cliente..."
                className="w-full rounded-xl border border-border bg-secondary px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtrados.map(([clientId, lista]) => {
              const carteira = summarizeAccount(lista);
              return (
                <button
                  key={clientId}
                  type="button"
                  onClick={() => {
                    const proximo = new URLSearchParams(params);
                    proximo.set("cliente", clientId);
                    setParams(proximo, { replace: true });
                  }}
                  className="group rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {nomes.get(clientId) || "Cliente"}
                    </p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {carteira.campanhas} {carteira.campanhas === 1 ? "campanha" : "campanhas"} ·
                    últimos 30 dias
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Numero rotulo="Investido" valor={dinheiro(carteira.investido)} />
                    <Numero
                      rotulo={carteira.resultados != null ? "Resultados" : "Alcance"}
                      valor={numero(
                        carteira.resultados != null ? carteira.resultados : carteira.alcance,
                      )}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
